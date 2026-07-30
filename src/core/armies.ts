import { Rng } from "./rng";
import { Army, Nation, Terrain } from "./types";
import { WorldMap, neighbors8 } from "./worldgen";
import { nextId } from "./ids";

// ============================================================
// 軍団: 地図上を実際に移動する部隊
//
// 戦争は「数値の比較」ではなく、軍団が国境へ進軍し、
// 敵軍と会敵して戦い、都市を包囲して陥とす形で進む。
// これにより地図上で戦線の動きが目に見えるようになる。
// ============================================================

/** 地形ごとの移動しやすさ (1タイル進むのに必要なコスト) */
const TERRAIN_COST: Record<Terrain, number> = {
  ocean: 999,
  plains: 1,
  forest: 1.4,
  jungle: 1.9,
  swamp: 1.8,
  hills: 1.5,
  mountain: 2.4,
  desert: 1.6,
  tundra: 1.5,
  snow: 2
};

export function createArmy(
  nation: Nation,
  x: number,
  y: number,
  strength: number,
  generalId: string | null,
  index: number
): Army {
  return {
    id: nextId("army"),
    nationId: nation.id,
    name: `第${index}軍`,
    x,
    y,
    prevX: x,
    prevY: y,
    targetX: x,
    targetY: y,
    strength: Math.max(1, Math.round(strength)),
    morale: 80,
    state: "idle",
    generalId,
    targetNationId: null
  };
}

/** 1年あたりの移動歩数 (技術が高いほど速い) */
export function armySteps(nation: Nation): number {
  return 1 + Math.floor(nation.techLevel / 5);
}

/**
 * 目標に向かって1歩進める。
 * 陸地のみを通り、山や密林は避けて回り道する簡易な貪欲探索。
 */
export function stepArmy(army: Army, map: WorldMap): void {
  const tx = Math.round(army.targetX);
  const ty = Math.round(army.targetY);
  const cx = Math.round(army.x);
  const cy = Math.round(army.y);
  if (cx === tx && cy === ty) return;

  let best: { x: number; y: number } | null = null;
  let bestScore = Infinity;

  for (const n of neighbors8(map, cx, cy)) {
    if (n.terrain === "ocean") continue;
    const dist = Math.hypot(n.x - tx, n.y - ty);
    const score = dist + TERRAIN_COST[n.terrain] * 0.55;
    if (score < bestScore) {
      bestScore = score;
      best = { x: n.x, y: n.y };
    }
  }

  if (best) {
    army.x = best.x;
    army.y = best.y;
  }
}

export function armyDistance(a: Army, x: number, y: number): number {
  return Math.hypot(a.x - x, a.y - y);
}

export function armyAt(army: Army, x: number, y: number): boolean {
  return Math.round(army.x) === x && Math.round(army.y) === y;
}

/** 戦闘力: 兵力 x 士気 x 将軍の技量 x 地形補正 */
export function battlePower(
  army: Army,
  generalSkill: number,
  terrain: Terrain,
  rng: Rng,
  defending: boolean
): number {
  const terrainBonus = defending
    ? terrain === "mountain" || terrain === "hills"
      ? 1.35
      : terrain === "forest" || terrain === "jungle" || terrain === "swamp"
        ? 1.2
        : 1
    : 1;
  return (
    army.strength *
    (0.55 + army.morale / 160) *
    (1 + generalSkill / 220) *
    terrainBonus *
    rng.range(0.85, 1.15)
  );
}