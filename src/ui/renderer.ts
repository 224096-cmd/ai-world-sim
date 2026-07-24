import { GameWorld } from "../core/simulation";
import { Terrain } from "../core/types";

const TERRAIN_COLOR: Record<Terrain, string> = {
  ocean: "#132436",
  plains: "#5c6b3e",
  forest: "#33492c",
  mountain: "#5a564c",
  desert: "#8a7a4e",
  tundra: "#7c8b93"
};

const OCEAN_DEEP = "#0a141f";
const OCEAN_SHALLOW = "#1c3550";

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace("#", ""), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function mix(hexA: string, hexB: string, t: number): string {
  const a = hexToRgb(hexA);
  const b = hexToRgb(hexB);
  const r = Math.round(a[0] + (b[0] - a[0]) * t);
  const g = Math.round(a[1] + (b[1] - a[1]) * t);
  const bl = Math.round(a[2] + (b[2] - a[2]) * t);
  return `rgb(${r},${g},${bl})`;
}

export interface MapSelection {
  type: "nation" | null;
  id: string | null;
}

export class MapRenderer {
  private ctx: CanvasRenderingContext2D;
  private tileSize = 10;
  private offsetX = 0;
  private offsetY = 0;

  constructor(private canvas: HTMLCanvasElement, private world: GameWorld) {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D context を取得できません");
    this.ctx = ctx;
  }

  private resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rect = this.canvas.getBoundingClientRect();
    this.canvas.width = Math.max(1, Math.round(rect.width * dpr));
    this.canvas.height = Math.max(1, Math.round(rect.height * dpr));
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const { width, height } = this.world.map;
    const availW = rect.width - 20;
    const availH = rect.height - 20;
    this.tileSize = Math.max(2, Math.min(availW / width, availH / height));
    this.offsetX = (rect.width - width * this.tileSize) / 2;
    this.offsetY = (rect.height - height * this.tileSize) / 2;
  }

  draw(selection: MapSelection) {
    this.resize();
    const { ctx, world, tileSize, offsetX, offsetY } = this;
    const rect = this.canvas.getBoundingClientRect();

    ctx.clearRect(0, 0, rect.width, rect.height);

    for (let y = 0; y < world.map.height; y++) {
      for (let x = 0; x < world.map.width; x++) {
        const tile = world.map.tiles[y][x];
        let color: string;

        if (tile.terrain === "ocean") {
          color = mix(OCEAN_DEEP, OCEAN_SHALLOW, Math.min(1, tile.elevation / 0.36));
        } else {
          color = TERRAIN_COLOR[tile.terrain];
          if (tile.ownerId) {
            const nation = world.getNation(tile.ownerId);
            if (nation) {
              const dim = !selection.id || selection.id === nation.id ? 0.55 : 0.3;
              color = mix(color, nation.color, dim);
            }
          }
        }

        ctx.fillStyle = color;
        ctx.fillRect(
          offsetX + x * tileSize,
          offsetY + y * tileSize,
          tileSize + 0.6,
          tileSize + 0.6
        );

        if (tile.resource && tileSize > 5) {
          ctx.fillStyle = "#f0d98c";
          const cx = offsetX + x * tileSize + tileSize / 2;
          const cy = offsetY + y * tileSize + tileSize / 2;
          ctx.beginPath();
          ctx.arc(cx, cy, Math.max(0.8, tileSize * 0.12), 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }

    // 首都マーカー
    for (const nation of world.livingNations()) {
      const cx = offsetX + nation.capital.x * tileSize + tileSize / 2;
      const cy = offsetY + nation.capital.y * tileSize + tileSize / 2;
      const isSelected = selection.id === nation.id;
      ctx.beginPath();
      ctx.arc(cx, cy, Math.max(2, tileSize * (isSelected ? 0.55 : 0.4)), 0, Math.PI * 2);
      ctx.fillStyle = isSelected ? "#f5e6b8" : "#e8e2d0";
      ctx.fill();
      ctx.lineWidth = 1;
      ctx.strokeStyle = "#0b111c";
      ctx.stroke();
    }
  }

  /** クライアント座標(canvas.getBoundingClientRectベース)からタイル所有国IDを返す */
  hitTest(clientX: number, clientY: number): string | null {
    const rect = this.canvas.getBoundingClientRect();
    const localX = clientX - rect.left - this.offsetX;
    const localY = clientY - rect.top - this.offsetY;
    const x = Math.floor(localX / this.tileSize);
    const y = Math.floor(localY / this.tileSize);
    if (x < 0 || y < 0 || x >= this.world.map.width || y >= this.world.map.height) return null;
    return this.world.map.tiles[y][x].ownerId;
  }
}
