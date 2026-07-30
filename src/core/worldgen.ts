import { Rng } from "./rng";
import { Noise2D } from "./noise";
import { ResourceType, Terrain, Tile, WorldConfig } from "./types";

export interface WorldMap {
  width: number;
  height: number;
  tiles: Tile[][]; // [y][x]
  seaLevel: number;
}

const RESOURCE_TABLE: ResourceType[] = ["gold", "iron", "grain", "gem", "timber"];

/**
 * 地形生成 v2
 *
 * - ドメインワーピングで海岸線を有機的にする
 * - 海面高度は「目標の陸地率」から百分位で逆算するため、
 *   シードによらず必ず十分な広さの大陸ができる
 * - 緯度(南北)による気候帯 + 湿度 + 標高で地形を決める
 * - 山から海へ川を流し、流域の肥沃度を上げる
 */
export function generateWorld(config: WorldConfig): WorldMap {
  const { width, height } = config;
  const rng = new Rng(config.seed);
  const landRatio = clamp(config.landRatio ?? 0.55, 0.25, 0.85);

  const base = new Noise2D(config.seed);
  const warp = new Noise2D(config.seed ^ 0x9e3779b9);
  const detail = new Noise2D(config.seed ^ 0x85ebca6b);
  const ridge = new Noise2D(config.seed ^ 0xc2b2ae35);
  const moistNoise = new Noise2D(config.seed ^ 0x27d4eb2f);

  // ---- 1. 標高フィールド ----
  const elevation: number[][] = [];
  const flat: number[] = [];
  const scale = 1 / Math.max(18, Math.min(width, height) * 0.55);

  for (let y = 0; y < height; y++) {
    const row: number[] = [];
    for (let x = 0; x < width; x++) {
      // ドメインワーピング(座標自体をノイズでずらす)で海岸線を複雑にする
      const wx = x + (warp.fbm(x * scale * 2, y * scale * 2, 3) - 0.5) * 14;
      const wy = y + (warp.fbm(x * scale * 2 + 91, y * scale * 2 + 91, 3) - 0.5) * 14;

      let e = base.fbm(wx * scale, wy * scale, 6, 0.52) * 0.78 + detail.fbm(x * 0.18, y * 0.18, 3) * 0.22;

      // 地図の縁だけを海に落とす(中央は大陸のまま残す)
      const margin = Math.max(2, Math.round(Math.min(width, height) * 0.1));
      const edge = Math.min(x, y, width - 1 - x, height - 1 - y) / margin;
      e *= smoothstep(clamp(edge, 0, 1));

      row.push(e);
      flat.push(e);
    }
    elevation.push(row);
  }

  // ---- 2. 目標の陸地率になる海面高度を決める ----
  flat.sort((a, b) => a - b);
  const seaLevel = flat[Math.floor(flat.length * (1 - landRatio))] ?? 0.4;
  const maxElev = flat[flat.length - 1] ?? 1;
  const span = Math.max(0.001, maxElev - seaLevel);

  // ---- 3. 地形の決定 ----
  const tiles: Tile[][] = [];
  for (let y = 0; y < height; y++) {
    const row: Tile[] = [];
    for (let x = 0; x < width; x++) {
      const e = elevation[y][x];
      // 海抜0-1に正規化
      const h = e <= seaLevel ? 0 : (e - seaLevel) / span;
      // 緯度: 0(極) 〜 1(赤道)
      const lat = 1 - Math.abs(y / (height - 1) - 0.5) * 2;
      const ridgeValue = ridge.ridged(x * scale * 1.6, y * scale * 1.6, 4);
      // 湿度: ノイズ主体 + 海からの距離が近いほど湿る
      const moisture = clamp(
        (moistNoise.fbm(x * scale * 1.4 + 500, y * scale * 1.4 + 500, 4) - 0.5) * 1.5 + 0.52 - h * 0.1,
        0,
        1
      );

      const terrain = terrainFor(e <= seaLevel, h, moisture, lat, ridgeValue);
      const tile: Tile = {
        x,
        y,
        terrain,
        elevation: e,
        height: h,
        moisture,
        fertility: fertilityFor(terrain, moisture),
        ownerId: null,
        river: false
      };
      row.push(tile);
    }
    tiles.push(row);
  }

  const map: WorldMap = { width, height, tiles, seaLevel };

  // ---- 4. 川 ----
  carveRivers(map, rng);

  // ---- 5. 資源 ----
  const resourceRng = new Rng(config.seed ^ 0x9e3779b9);
  for (const row of tiles) {
    for (const tile of row) {
      if (tile.terrain === "ocean") continue;
      if (!resourceRng.bool(0.075)) continue;
      // 地形にふさわしい資源が出やすいようにする
      const pool: ResourceType[] =
        tile.terrain === "mountain" || tile.terrain === "hills"
          ? ["iron", "gold", "gem", "iron"]
          : tile.terrain === "forest" || tile.terrain === "jungle"
            ? ["timber", "timber", "grain"]
            : tile.terrain === "plains"
              ? ["grain", "grain", "iron"]
              : RESOURCE_TABLE;
      tile.resource = resourceRng.pick(pool);
    }
  }

  return map;
}

function terrainFor(
  isOcean: boolean,
  h: number,
  moisture: number,
  lat: number,
  ridgeValue: number
): Terrain {
  if (isOcean) return "ocean";

  // 山脈: 尾根ノイズが強い高地
  if (h > 0.5 && ridgeValue > 0.52) return "mountain";
  if (h > 0.72) return "mountain";

  // 気候帯 (極地は狭めにして、可住地を広く取る)
  if (lat < 0.1) return "snow";
  if (lat < 0.2) return moisture > 0.45 ? "tundra" : "snow";
  if (lat < 0.3 && moisture < 0.5) return "tundra";

  if (h > 0.45) return "hills";
  if (moisture < 0.24) return "desert";
  if (lat > 0.8 && moisture > 0.66) return "jungle";
  if (moisture > 0.62) return "forest";
  if (moisture > 0.52 && h < 0.1) return "swamp";
  return "plains";
}

function fertilityFor(terrain: Terrain, moisture: number): number {
  switch (terrain) {
    case "plains":
      return 0.72 + moisture * 0.28;
    case "forest":
      return 0.5 + moisture * 0.2;
    case "jungle":
      return 0.42;
    case "swamp":
      return 0.35;
    case "hills":
      return 0.38;
    case "desert":
      return 0.06;
    case "tundra":
      return 0.16;
    case "snow":
      return 0.04;
    case "mountain":
      return 0.1;
    default:
      return 0;
  }
}

/** 高地から海へ向かって川を流す */
function carveRivers(map: WorldMap, rng: Rng): void {
  const sources: Tile[] = [];
  for (const row of map.tiles) {
    for (const t of row) {
      if (t.terrain !== "ocean" && t.height > 0.45) sources.push(t);
    }
  }
  if (sources.length === 0) return;

  const count = Math.max(3, Math.round((map.width * map.height) / 260));
  for (let i = 0; i < count; i++) {
    let cur = rng.pick(sources);
    const seen = new Set<string>();

    for (let step = 0; step < map.width + map.height; step++) {
      const key = `${cur.x},${cur.y}`;
      if (seen.has(key)) break;
      seen.add(key);
      if (cur.terrain === "ocean") break;

      cur.river = true;
      cur.fertility = Math.min(1, cur.fertility + 0.25);

      // 最も低い隣接タイルへ流れる
      let next: Tile | null = null;
      for (const n of neighborsOf(map, cur.x, cur.y)) {
        if (seen.has(`${n.x},${n.y}`)) continue;
        if (!next || n.elevation < next.elevation) next = n;
      }
      if (!next || next.elevation > cur.elevation) break;
      cur = next;
    }
  }
}

export function tileKey(x: number, y: number): string {
  return `${x},${y}`;
}

export function neighborsOf(map: WorldMap, x: number, y: number): Tile[] {
  const result: Tile[] = [];
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const nx = x + dx;
    const ny = y + dy;
    if (nx >= 0 && nx < map.width && ny >= 0 && ny < map.height) {
      result.push(map.tiles[ny][nx]);
    }
  }
  return result;
}

/** 8方向の隣接 (軍の移動用) */
export function neighbors8(map: WorldMap, x: number, y: number): Tile[] {
  const result: Tile[] = [];
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      const nx = x + dx;
      const ny = y + dy;
      if (nx >= 0 && nx < map.width && ny >= 0 && ny < map.height) {
        result.push(map.tiles[ny][nx]);
      }
    }
  }
  return result;
}

export function isCoast(map: WorldMap, x: number, y: number): boolean {
  return neighborsOf(map, x, y).some((n) => n.terrain === "ocean");
}

/** 建国に適した未所属の陸地を探す */
export function findLandTile(map: WorldMap, rng: Rng): Tile | null {
  const candidates: Tile[] = [];
  for (const row of map.tiles) {
    for (const t of row) {
      if (t.ownerId) continue;
      if (t.terrain === "ocean" || t.terrain === "mountain" || t.terrain === "snow") continue;
      if (t.fertility < 0.3) continue;
      candidates.push(t);
    }
  }
  if (candidates.length === 0) {
    for (const row of map.tiles) {
      for (const t of row) if (!t.ownerId && t.terrain !== "ocean") candidates.push(t);
    }
  }
  if (candidates.length === 0) return null;

  // 候補を数回引いて、既存国から離れた場所を選ぶ
  let best = rng.pick(candidates);
  let bestScore = -Infinity;
  for (let i = 0; i < 12; i++) {
    const c = rng.pick(candidates);
    let nearest = Infinity;
    for (const row of map.tiles) {
      for (const t of row) {
        if (!t.ownerId) continue;
        const d = Math.abs(t.x - c.x) + Math.abs(t.y - c.y);
        if (d < nearest) nearest = d;
      }
    }
    const score = (nearest === Infinity ? 50 : Math.min(nearest, 24)) + c.fertility * 6;
    if (score > bestScore) {
      bestScore = score;
      best = c;
    }
  }
  return best;
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}