import { Rng } from "./rng";
import { NameGenerator } from "./nameGenerator";
import { Nation, Relation } from "./types";
import { WorldMap, findLandTile, neighborsOf, tileKey } from "./worldgen";

const PALETTE = [
  "#c9a44c", "#8c3b3b", "#4f7a63", "#5b7fb5",
  "#a06bb0", "#c47a3a", "#5aa3a3", "#b0555f",
  "#7d8f4a", "#9a6fd4"
];

let nationCounter = 0;
let personCounter = 0;

export function nextNationId(): string {
  nationCounter += 1;
  return `nation-${nationCounter}`;
}

export function nextPersonId(): string {
  personCounter += 1;
  return `person-${personCounter}`;
}

export function resetIdCounters(): void {
  nationCounter = 0;
  personCounter = 0;
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

    const id = nextNationId();
    const name = names.nationName(id);
    capitalTile.ownerId = id;

    const nation: Nation = {
      id,
      name,
      color: PALETTE[i % PALETTE.length],
      founded: startYear,
      capital: { x: capitalTile.x, y: capitalTile.y },
      territory: new Set([tileKey(capitalTile.x, capitalTile.y)]),
      population: rng.int(8000, 20000),
      treasury: rng.int(200, 600),
      military: rng.int(50, 150),
      techLevel: rng.int(1, 3),
      stability: rng.int(55, 85),
      kingId: null,
      relations: {},
      laws: { taxRate: 0.12, militaryFocus: false, tradeOpen: true },
      alive: true
    };

    // 開始時点で3タイル分ほど周囲に広げておく
    for (let step = 0; step < 3; step++) {
      expandTerritory(nation, map, rng);
    }

    nations.push(nation);
  }

  // 相互の外交関係を初期化(中立寄り)
  for (const a of nations) {
    for (const b of nations) {
      if (a.id === b.id) continue;
      a.relations[b.id] = { status: "peace", score: rng.int(-10, 30), since: startYear };
    }
  }

  return nations;
}

/** 隣接する未所属タイルを1つ自国領に組み込む */
export function expandTerritory(nation: Nation, map: WorldMap, rng: Rng): boolean {
  const frontier: { x: number; y: number }[] = [];
  for (const key of nation.territory) {
    const [x, y] = key.split(",").map(Number);
    for (const n of neighborsOf(map, x, y)) {
      if (n.terrain === "ocean") continue;
      if (n.ownerId === null) {
        frontier.push({ x: n.x, y: n.y });
      }
    }
  }
  if (frontier.length === 0) return false;
  const target = rng.pick(frontier);
  const tile = map.tiles[target.y][target.x];
  tile.ownerId = nation.id;
  nation.territory.add(tileKey(target.x, target.y));
  return true;
}

/** 敗戦国から勝者へタイルを1枚移譲する */
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
      if (n.ownerId === loser.id) {
        border.push({ x: n.x, y: n.y });
      }
    }
  }
  if (border.length === 0) return null;
  const target = rng.pick(border);
  const tile = map.tiles[target.y][target.x];
  loser.territory.delete(tileKey(target.x, target.y));
  winner.territory.add(tileKey(target.x, target.y));
  tile.ownerId = winner.id;
  return target;
}

export function relationOf(nation: Nation, otherId: string): Relation {
  if (!nation.relations[otherId]) {
    nation.relations[otherId] = { status: "peace", score: 0, since: 0 };
  }
  return nation.relations[otherId];
}

export function areNeighbors(a: Nation, b: Nation, map: WorldMap): boolean {
  for (const key of a.territory) {
    const [x, y] = key.split(",").map(Number);
    for (const n of neighborsOf(map, x, y)) {
      if (n.ownerId === b.id) return true;
    }
  }
  return false;
}
