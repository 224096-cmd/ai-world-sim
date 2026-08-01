import { Noise2D } from "./noise";
import { Rng } from "./rng";
import { R, T, isLand, isWater } from "./types";

// ============================================================
// 世界生成
// 高度(fBm×大陸マスク) → 海面決定 → 山脈(リッジ) → 気温/湿度
// → バイオーム → 河川 → 肥沃度 → 資源 の順で作る。
// すべて typed array で保持し、シミュレーション/描画が直接読む。
// ============================================================

export interface GeneratedMap {
  width: number;
  height: number;
  terrain: Uint8Array;
  elevation: Float32Array; // 0-1 (海面はseaLevel)
  moisture: Float32Array; // 0-1
  fertility: Float32Array; // 0-1
  river: Uint8Array; // 0/1
  resource: Uint8Array; // R.*
  seaLevel: number;
}

export function generateMap(width: number, height: number, seed: number, landRatio: number): GeneratedMap {
  const rng = new Rng(seed);
  const nElev = new Noise2D(rng.int(1, 1e9));
  const nMtn = new Noise2D(rng.int(1, 1e9));
  const nMoist = new Noise2D(rng.int(1, 1e9));
  const nTemp = new Noise2D(rng.int(1, 1e9));

  const size = width * height;
  const elevation = new Float32Array(size);
  const moisture = new Float32Array(size);
  const terrain = new Uint8Array(size);
  const fertility = new Float32Array(size);
  const river = new Uint8Array(size);
  const resource = new Uint8Array(size);

  const scale = 4.2 / Math.max(width, height); // ノイズの粗さ

  // --- 1. 高度 (大陸マスクで縁を海に落とす) -----------------
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const nx = x * scale;
      const ny = y * scale;
      let e = nElev.fbm(nx, ny, 5, 0.52);
      // 縁ほど強く沈める放射状マスク (WorldBox風の島世界)
      const dx = (x / width) * 2 - 1;
      const dy = (y / height) * 2 - 1;
      const d = Math.sqrt(dx * dx + dy * dy);
      const mask = Math.max(0, 1 - Math.pow(d, 2.4) * 1.15);
      e = e * 0.75 * mask + e * 0.25;
      elevation[i] = e;
    }
  }

  // --- 2. 海面: 陸地率が landRatio になる高さを分位点で決める --
  const sample = Float32Array.from(elevation);
  sample.sort();
  const seaLevel = sample[Math.floor(size * (1 - landRatio))] ?? 0.5;

  // 正規化: 海面=0.42 に揃えて以後の判定を安定させる
  const SEA = 0.42;
  for (let i = 0; i < size; i++) {
    const e = elevation[i];
    elevation[i] =
      e < seaLevel
        ? (e / Math.max(1e-6, seaLevel)) * SEA
        : SEA + ((e - seaLevel) / Math.max(1e-6, 1 - seaLevel)) * (1 - SEA);
  }

  // --- 3. 山脈をリッジノイズで盛る ---------------------------
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (elevation[i] <= SEA) continue;
      const m = nMtn.ridged(x * scale * 1.6, y * scale * 1.6, 4);
      if (m > 0.62) {
        elevation[i] = Math.min(1, elevation[i] + (m - 0.62) * 1.1);
      }
    }
  }

  // --- 4. 気温・湿度 → バイオーム ---------------------------
  for (let y = 0; y < height; y++) {
    const lat = 1 - Math.abs(y / height - 0.5) * 2; // 1=赤道
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const e = elevation[i];
      if (e <= SEA) {
        terrain[i] = e > SEA - 0.045 ? T.coast : T.ocean;
        moisture[i] = 1;
        continue;
      }
      const temp = clamp01(lat * 0.95 + (nTemp.fbm(x * scale * 2, y * scale * 2, 3) - 0.5) * 0.3 - (e - SEA) * 0.9);
      const moist = clamp01(nMoist.fbm(x * scale * 1.3 + 100, y * scale * 1.3, 4) * 1.1 + (isNearWaterRaw(elevation, width, height, x, y, SEA) ? 0.15 : 0));
      moisture[i] = moist;

      terrain[i] = pickBiome(e, temp, moist, SEA);
    }
  }

  // --- 5. 河川: 高地の水源から低い方へ流す -------------------
  const riverCount = Math.round((width * height) / 1400);
  let made = 0;
  for (let tries = 0; tries < riverCount * 30 && made < riverCount; tries++) {
    const x = rng.int(2, width - 3);
    const y = rng.int(2, height - 3);
    const i = y * width + x;
    if (elevation[i] < SEA + 0.22 || isWater(terrain[i])) continue;
    if (traceRiver(x, y, elevation, terrain, river, width, height, rng)) made++;
  }

  // --- 6. 肥沃度 --------------------------------------------
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      fertility[i] = baseFertility(terrain[i]) * (0.6 + moisture[i] * 0.4);
      if (river[i]) fertility[i] = Math.min(1, fertility[i] + 0.25);
      // 海沿いボーナス
      if (isLand(terrain[i]) && hasNeighborWater(terrain, width, height, x, y)) {
        fertility[i] = Math.min(1, fertility[i] + 0.1);
      }
    }
  }

  // --- 7. 資源 ----------------------------------------------
  const resCount = Math.round((width * height) / 220);
  for (let n = 0; n < resCount; n++) {
    const x = rng.int(1, width - 2);
    const y = rng.int(1, height - 2);
    const i = y * width + x;
    const t = terrain[i];
    if (isWater(t) || resource[i] !== R.none) continue;
    if (t === T.mountain || t === T.hills) {
      resource[i] = rng.pick([R.gold, R.iron, R.iron, R.gem]);
    } else if (t === T.plains || t === T.savanna) {
      resource[i] = rng.pick([R.grain, R.grain, R.horse]);
    } else if (t === T.desert && rng.bool(0.35)) {
      resource[i] = rng.pick([R.gold, R.gem]);
    }
  }

  return { width, height, terrain, elevation, moisture, fertility, river, resource, seaLevel: SEA };
}

// ------------------------------------------------------------

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function pickBiome(e: number, temp: number, moist: number, sea: number): number {
  if (e > sea + 0.34) return T.mountain;
  if (e > sea + 0.22) return temp < 0.22 ? T.snow : T.hills;
  if (temp < 0.14) return T.snow;
  if (temp < 0.26) return moist > 0.5 ? T.tundra : T.tundra;
  if (temp > 0.78) {
    if (moist < 0.3) return T.desert;
    if (moist > 0.72) return T.jungle;
    return T.savanna;
  }
  if (moist > 0.78) return T.swamp;
  if (moist > 0.52) return T.forest;
  return T.plains;
}

function baseFertility(t: number): number {
  switch (t) {
    case T.plains:
      return 0.85;
    case T.savanna:
      return 0.6;
    case T.forest:
      return 0.55;
    case T.jungle:
      return 0.45;
    case T.hills:
      return 0.4;
    case T.swamp:
      return 0.3;
    case T.tundra:
      return 0.18;
    case T.desert:
      return 0.1;
    case T.snow:
      return 0.06;
    case T.burnt:
      return 0.2;
    default:
      return 0;
  }
}

function isNearWaterRaw(elev: Float32Array, w: number, h: number, x: number, y: number, sea: number): boolean {
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      if (elev[ny * w + nx] <= sea) return true;
    }
  }
  return false;
}

function hasNeighborWater(terrain: Uint8Array, w: number, h: number, x: number, y: number): boolean {
  const dirs = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1]
  ];
  for (const [dx, dy] of dirs) {
    const nx = x + dx;
    const ny = y + dy;
    if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
    if (isWater(terrain[ny * w + nx])) return true;
  }
  return false;
}

/** 高地から水域まで最急降下で川筋を刻む */
function traceRiver(
  sx: number,
  sy: number,
  elev: Float32Array,
  terrain: Uint8Array,
  river: Uint8Array,
  w: number,
  h: number,
  rng: Rng
): boolean {
  let x = sx;
  let y = sy;
  const path: number[] = [];
  for (let step = 0; step < 400; step++) {
    const i = y * w + x;
    if (isWater(terrain[i]) || river[i]) {
      if (path.length < 6) return false;
      for (const p of path) river[p] = 1;
      return true;
    }
    path.push(i);
    // 最も低い隣へ (同じ高さならランダムで揺らす)
    let bx = x;
    let by = y;
    let be = elev[i];
    const order = rng.shuffle([
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1]
    ]);
    for (const [dx, dy] of order) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const ne = elev[ny * w + nx];
      if (ne < be + 0.002) {
        be = ne;
        bx = nx;
        by = ny;
      }
    }
    if (bx === x && by === y) {
      // 窪地: 湖にする
      if (path.length < 6) return false;
      terrain[y * w + x] = T.coast;
      for (const p of path) river[p] = 1;
      return true;
    }
    x = bx;
    y = by;
  }
  return false;
}
