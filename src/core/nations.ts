import { Rng } from "./rng";
import { NameGenerator } from "./nameGenerator";
import { Nation, Relation } from "./types";
import { WorldMap, findLandTile, neighborsOf, tileKey } from "./worldgen";
import { nextId } from "./ids";

const PALETTE = [
  "#c9a44c", "#8c3b3b", "#4f7a63", "#5b7fb5",
  "#a06bb0", "#c47a3a", "#5aa3a3", "#b0555f",
  "#7d8f4a", "#9a6fd4", "#4a8fb5", "#cf8f6a",
  "#6f9c5a", "#b5567f", "#7a7ac9", "#c9a06b"
];

/** まだ使われていない色を優先して返す */
export function pickColor(used: string[], rng: Rng): string {
  const free = PALETTE.filter((c) => !used.includes(c));
  return free.length > 0 ? rng.pick(free) : rng.pick(PALETTE);
}

export function createNation(
  id: string,
  name: string,
  cultureId: string,
  dynasty: string,
  color: string,
  capital: { x: number; y: number },
  year: number,
  rng: Rng
): Nation {
  return {
    id,
    name,
    color,
    cultureId,
    dynasty,
    founded: year,
    capital,
    capitalCityId: null,
    cityIds: [],
    territory: new Set([tileKey(capital.x, capital.y)]),
    population: rng.int(6000, 14000),
    treasury: rng.int(200, 600),
    military: rng.int(50, 150),
    techLevel: rng.int(1, 3),
    stability: rng.int(55, 85),
    warExhaustion: 0,
    kingId: null,
    overlordId: null,
    relations: {},
    laws: { taxRate: 0.12, militaryFocus: false, tradeOpen: true },
    stats: [],
    alive: true
  };
}

/** 世界に指定数の国家を配置する */
export function spawnNations(
  map: WorldMap,
  count: number,
  rng: Rng,
  names: NameGenerator,
  startYear: number
): Nation[] {
  const nations: Nation[] = [];

  for (let i = 0; i < count; i++) {
    const capitalTile = findLandTile(map, rng);
    if (!capitalTile) break;

    const id = nextId("nation");
    const cultureId = names.pickCultureId();
    capitalTile.ownerId = id;

    const nation = createNation(
      id,
      names.nationName(cultureId),
      cultureId,
      names.dynastyName(cultureId),
      pickColor(nations.map((n) => n.color), rng),
      { x: capitalTile.x, y: capitalTile.y },
      startYear,
      rng
    );

    for (let step = 0; step < 3; step++) expandTerritory(nation, map, rng);
    nations.push(nation);
  }

  for (const a of nations) {
    for (const b of nations) {
      if (a.id === b.id) continue;
      a.relations[b.id] = { status: "peace", score: rng.int(-10, 30), since: startYear };
    }
  }

  return nations;
}

/** 自国に隣接する未所属タイルの一覧 */
export function frontierTiles(nation: Nation, map: WorldMap): { x: number; y: number }[] {
  const frontier: { x: number; y: number }[] = [];
  const seen = new Set<string>();
  for (const key of nation.territory) {
    const [x, y] = key.split(",").map(Number);
    for (const n of neighborsOf(map, x, y)) {
      if (n.terrain === "ocean" || n.ownerId !== null) continue;
      const k = tileKey(n.x, n.y);
      if (seen.has(k)) continue;
      seen.add(k);
      frontier.push({ x: n.x, y: n.y });
    }
  }
  return frontier;
}

/**
 * 隣接する未所属タイルを1つ自国領に組み込む。
 * 候補を3つ引いて最も肥沃な土地を選ぶため、国は自然と平野に向かって広がる。
 */
export function expandTerritory(nation: Nation, map: WorldMap, rng: Rng): boolean {
  const frontier = frontierTiles(nation, map);
  if (frontier.length === 0) return false;

  let best = rng.pick(frontier);
  let bestScore = -1;
  for (let i = 0; i < 3; i++) {
    const cand = rng.pick(frontier);
    const tile = map.tiles[cand.y][cand.x];
    const score = tile.fertility * 2 + (tile.resource ? 0.6 : 0) - (tile.terrain === "mountain" ? 0.8 : 0);
    if (score > bestScore) {
      bestScore = score;
      best = cand;
    }
  }

  map.tiles[best.y][best.x].ownerId = nation.id;
  nation.territory.add(tileKey(best.x, best.y));
  return true;
}

/** 敗戦国から勝者へ、国境のタイルを1枚移譲する */
export function transferRandomTile(
  loser: Nation,
  winner: Nation,
  map: WorldMap,
  rng: Rng
): { x: number; y: number } | null {
  const border: { x: number; y: number }[] = [];
  for (const key of winner.territory) {
    const [x, y] = key.split(",").map(Number);
    for (const n of neighborsOf(map, x, y)) {
      if (n.ownerId === loser.id) border.push({ x: n.x, y: n.y });
    }
  }
  if (border.length === 0) return null;

  // 都市のあるタイルは落としにくい(攻城戦は resolveWar 側で別途判定)
  const plain = border.filter((b) => !map.tiles[b.y][b.x].cityId);
  const target = rng.pick(plain.length > 0 ? plain : border);
  transferTile(loser, winner, map, target.x, target.y);
  return target;
}

export function transferTile(
  from: Nation,
  to: Nation,
  map: WorldMap,
  x: number,
  y: number
): void {
  const key = tileKey(x, y);
  from.territory.delete(key);
  to.territory.add(key);
  map.tiles[y][x].ownerId = to.id;
}

/**
 * 反乱・独立用に、首都から最も遠いタイルを起点とした
 * 連結した領域(全体の ratio 割)を切り出す。
 */
export function carveRegion(
  nation: Nation,
  map: WorldMap,
  ratio: number
): { x: number; y: number }[] {
  const keys = Array.from(nation.territory);
  if (keys.length < 4) return [];

  let seed: { x: number; y: number } | null = null;
  let farthest = -1;
  for (const key of keys) {
    const [x, y] = key.split(",").map(Number);
    const d = Math.abs(x - nation.capital.x) + Math.abs(y - nation.capital.y);
    if (d > farthest) {
      farthest = d;
      seed = { x, y };
    }
  }
  if (!seed) return [];

  const target = Math.max(2, Math.floor(keys.length * ratio));
  const region: { x: number; y: number }[] = [];
  const visited = new Set<string>([tileKey(seed.x, seed.y)]);
  const queue = [seed];

  while (queue.length > 0 && region.length < target) {
    const cur = queue.shift()!;
    region.push(cur);
    for (const n of neighborsOf(map, cur.x, cur.y)) {
      const k = tileKey(n.x, n.y);
      if (visited.has(k) || n.ownerId !== nation.id) continue;
      // 首都は絶対に渡さない
      if (n.x === nation.capital.x && n.y === nation.capital.y) continue;
      visited.add(k);
      queue.push({ x: n.x, y: n.y });
    }
  }

  return region;
}

export function relationOf(nation: Nation, otherId: string): Relation {
  if (!nation.relations[otherId]) {
    nation.relations[otherId] = { status: "peace", score: 0, since: 0 };
  }
  return nation.relations[otherId];
}

/**
 * 地図を1回走査して、全国家の隣接関係をまとめて求める。
 * 国ごとに毎回全タイルを舐める従来方式より圧倒的に速い。
 */
export function computeAdjacency(map: WorldMap): Map<string, Set<string>> {
  const adj = new Map<string, Set<string>>();
  const link = (a: string, b: string) => {
    if (!adj.has(a)) adj.set(a, new Set());
    if (!adj.has(b)) adj.set(b, new Set());
    adj.get(a)!.add(b);
    adj.get(b)!.add(a);
  };

  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      const owner = map.tiles[y][x].ownerId;
      if (!owner) continue;
      const right = x + 1 < map.width ? map.tiles[y][x + 1].ownerId : null;
      const down = y + 1 < map.height ? map.tiles[y + 1][x].ownerId : null;
      if (right && right !== owner) link(owner, right);
      if (down && down !== owner) link(owner, down);
    }
  }
  return adj;
}

export function areAdjacent(adj: Map<string, Set<string>>, a: string, b: string): boolean {
  return adj.get(a)?.has(b) ?? false;
}

/** 海に面しているか(交易ボーナス判定用) */
export function hasCoast(nation: Nation, map: WorldMap): boolean {
  for (const key of nation.territory) {
    const [x, y] = key.split(",").map(Number);
    for (const n of neighborsOf(map, x, y)) {
      if (n.terrain === "ocean") return true;
    }
  }
  return false;
}

/** 国力スコア(一覧の並び替え・戦争判断に使用) */
export function powerScore(nation: Nation): number {
  return Math.round(
    nation.military * 1.0 +
      nation.population / 200 +
      nation.territory.size * 4 +
      nation.techLevel * 25
  );
}