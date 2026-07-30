import { Rng } from "./rng";
import { NameGenerator } from "./nameGenerator";
import { City, Nation } from "./types";
import { WorldMap, tileKey } from "./worldgen";
import { nextId } from "./ids";

/**
 * 都市システム
 *
 * - 都市の人口は「国家人口 × 繁栄度の比率」で毎年算出するため、
 *   国家人口と都市人口がズレることがない。
 * - 都市は税収・技術・防御に寄与し、戦争で陥落・略奪される。
 */

const URBAN_RATIO = 0.38; // 全人口のうち都市に住む割合

export function createCity(
  nation: Nation,
  x: number,
  y: number,
  names: NameGenerator,
  rng: Rng,
  year: number,
  isCapital = false
): City {
  return {
    id: nextId("city"),
    name: names.cityName(nation.cultureId),
    x,
    y,
    nationId: nation.id,
    founded: year,
    isCapital,
    population: 0,
    prosperity: isCapital ? rng.int(45, 60) : rng.int(20, 35),
    fortification: isCapital ? rng.int(25, 40) : rng.int(8, 20),
    unrest: 0,
    siegeBy: null
  };
}

/**
 * 新しい都市を建てるのに適したタイルを探す。
 * 肥沃で、資源があり、既存都市から離れている場所を高く評価する。
 */
export function findCitySite(
  nation: Nation,
  map: WorldMap,
  cities: City[],
  minDistance = 4
): { x: number; y: number } | null {
  let best: { x: number; y: number } | null = null;
  let bestScore = 0;

  for (const key of nation.territory) {
    const [x, y] = key.split(",").map(Number);
    const tile = map.tiles[y]?.[x];
    if (!tile || tile.cityId) continue;

    let nearest = Infinity;
    for (const c of cities) {
      const d = Math.abs(c.x - x) + Math.abs(c.y - y);
      if (d < nearest) nearest = d;
    }
    if (nearest < minDistance) continue;

    const score =
      tile.fertility * 3 +
      (tile.resource ? 1.2 : 0) +
      Math.min(nearest, 8) * 0.15 -
      (tile.terrain === "mountain" || tile.terrain === "desert" ? 1.5 : 0);

    if (score > bestScore) {
      bestScore = score;
      best = { x, y };
    }
  }

  return bestScore > 1.2 ? best : null;
}

export function attachCity(nation: Nation, city: City, map: WorldMap): void {
  nation.cityIds.push(city.id);
  nation.territory.add(tileKey(city.x, city.y));
  const tile = map.tiles[city.y]?.[city.x];
  if (tile) {
    tile.cityId = city.id;
    tile.ownerId = nation.id;
  }
}

export function detachCity(nation: Nation, cityId: string): void {
  nation.cityIds = nation.cityIds.filter((id) => id !== cityId);
  if (nation.capitalCityId === cityId) nation.capitalCityId = null;
}

/** 毎年の都市の成長と、人口の按分 */
export function updateCities(nation: Nation, cities: City[], rng: Rng): void {
  const own = cities.filter((c) => c.nationId === nation.id);
  if (own.length === 0) return;

  let total = 0;
  for (const city of own) {
    const growth =
      (nation.stability - 45) * 0.02 +
      nation.techLevel * 0.05 +
      (nation.laws.tradeOpen ? 0.25 : 0) -
      nation.warExhaustion * 0.02;
    city.prosperity = clamp(city.prosperity + growth + rng.range(-0.4, 0.6), 5, 100);

    const fortGoal = 15 + nation.techLevel * 5 + (city.isCapital ? 20 : 0);
    if (city.fortification < fortGoal && nation.treasury > 120) {
      city.fortification = Math.min(100, city.fortification + 0.6);
    }
    // 不満度: 安定度が低い・包囲されている都市はじわじわ荒れる
    const unrestDelta =
      (45 - nation.stability) * 0.05 + (city.siegeBy ? 3 : -0.8) + (city.isCapital ? -0.4 : 0);
    city.unrest = clamp(city.unrest + unrestDelta, 0, 100);

    total += city.prosperity;
  }

  for (const city of own) {
    const share = total > 0 ? city.prosperity / total : 1 / own.length;
    city.population = Math.max(200, Math.round(nation.population * URBAN_RATIO * share));
  }
}

export function cityIncome(nation: Nation, cities: City[]): number {
  let sum = 0;
  for (const city of cities) {
    if (city.nationId !== nation.id) continue;
    sum += city.population * 0.0025 * (1 + city.prosperity / 120);
  }
  return sum;
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}