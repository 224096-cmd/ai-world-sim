import { Rng, ValueNoise2D } from "./rng";
import { ResourceType, Terrain, Tile, WorldConfig } from "./types";

export interface WorldMap {
  width: number;
  height: number;
  tiles: Tile[][]; // [y][x]
}

const RESOURCE_TABLE: ResourceType[] = ["gold", "iron", "grain", "gem", "timber"];

function terrainFor(elevation: number, moisture: number): Terrain {
  if (elevation < 0.36) return "ocean";
  if (elevation > 0.82) return "mountain";
  if (moisture < 0.28) return "desert";
  if (elevation > 0.62 && moisture < 0.5) return "tundra";
  if (moisture > 0.55) return "forest";
  return "plains";
}

function fertilityFor(terrain: Terrain, moisture: number): number {
  switch (terrain) {
    case "plains":
      return 0.7 + moisture * 0.3;
    case "forest":
      return 0.5 + moisture * 0.2;
    case "desert":
      return 0.05;
    case "tundra":
      return 0.15;
    case "mountain":
      return 0.1;
    default:
      return 0;
  }
}

/** ランダムな世界地図を生成する */
export function generateWorld(config: WorldConfig): WorldMap {
  const rng = new Rng(config.seed);
  const elevationNoise = new ValueNoise2D(rng, 6);
  const moistureNoise = new ValueNoise2D(rng, 4);
  const resourceRng = new Rng(config.seed ^ 0x9e3779b9);

  const tiles: Tile[][] = [];
  for (let y = 0; y < config.height; y++) {
    const row: Tile[] = [];
    for (let x = 0; x < config.width; x++) {
      // 島っぽくするため、中心からの距離で高度を減衰させる
      const nx = x / config.width - 0.5;
      const ny = y / config.height - 0.5;
      const distFromCenter = Math.sqrt(nx * nx + ny * ny) * 1.5;

      let elevation = elevationNoise.fractal(x, y, 5, 0.55);
      elevation = elevation * (1 - Math.min(1, distFromCenter));
      const moisture = moistureNoise.fractal(x + 500, y + 500, 4, 0.5);

      const terrain = terrainFor(elevation, moisture);
      const fertility = fertilityFor(terrain, moisture);

      const tile: Tile = {
        x,
        y,
        terrain,
        elevation,
        moisture,
        fertility,
        ownerId: null
      };

      if (terrain !== "ocean" && resourceRng.bool(0.08)) {
        tile.resource = resourceRng.pick(RESOURCE_TABLE);
      }

      row.push(tile);
    }
    tiles.push(row);
  }

  return { width: config.width, height: config.height, tiles };
}

export function tileKey(x: number, y: number): string {
  return `${x},${y}`;
}

export function neighborsOf(map: WorldMap, x: number, y: number): Tile[] {
  const deltas = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1]
  ];
  const result: Tile[] = [];
  for (const [dx, dy] of deltas) {
    const nx = x + dx;
    const ny = y + dy;
    if (nx >= 0 && nx < map.width && ny >= 0 && ny < map.height) {
      result.push(map.tiles[ny][nx]);
    }
  }
  return result;
}

export function findLandTile(map: WorldMap, rng: Rng): Tile | null {
  const candidates: Tile[] = [];
  for (const row of map.tiles) {
    for (const t of row) {
      if (t.terrain !== "ocean" && t.terrain !== "mountain" && !t.ownerId) {
        candidates.push(t);
      }
    }
  }
  if (candidates.length === 0) return null;
  return rng.pick(candidates);
}
