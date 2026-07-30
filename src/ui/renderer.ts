import { GameWorld } from "../core/simulation";
import { City, MapMode, Terrain, Tile } from "../core/types";

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

/** 0(低)〜1(高) を 青 -> 黄 -> 赤 のヒートマップ色に変換 */
function heat(t: number): string {
  const v = Math.max(0, Math.min(1, t));
  return v < 0.5 ? mix("#2f4f7a", "#c9b04c", v * 2) : mix("#c9b04c", "#a8453f", (v - 0.5) * 2);
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
  private zoom = 1;
  private panX = 0;
  private panY = 0;
  private viewW = 0;
  private viewH = 0;

  mode: MapMode = "political";
  showLabels = true;

  constructor(private canvas: HTMLCanvasElement, private world: GameWorld) {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D context を取得できません");
    this.ctx = ctx;
  }

  setWorld(world: GameWorld) {
    this.world = world;
    this.resetView();
  }

  // ---------------- ビュー操作 ----------------
  resetView() {
    this.zoom = 1;
    this.panX = 0;
    this.panY = 0;
  }

  getZoom(): number {
    return this.zoom;
  }

  /** 画面上の(cx,cy)を中心に拡大縮小する */
  zoomBy(factor: number, cx?: number, cy?: number) {
    const prev = this.zoom;
    this.zoom = Math.max(1, Math.min(8, this.zoom * factor));
    if (this.zoom === prev) return;
    if (cx !== undefined && cy !== undefined) {
      const rect = this.canvas.getBoundingClientRect();
      const dx = cx - rect.left - this.viewW / 2;
      const dy = cy - rect.top - this.viewH / 2;
      const scale = this.zoom / prev;
      this.panX = (this.panX - dx) * scale + dx;
      this.panY = (this.panY - dy) * scale + dy;
    }
    this.clampPan();
  }

  panBy(dx: number, dy: number) {
    this.panX += dx;
    this.panY += dy;
    this.clampPan();
  }

  /** タイル座標を画面中央に持ってくる */
  focusOn(tx: number, ty: number, zoom = 2.4) {
    this.zoom = Math.max(1, Math.min(8, zoom));
    const { width, height } = this.world.map;
    const size = this.baseTileSize() * this.zoom;
    this.panX = (width / 2 - tx - 0.5) * size;
    this.panY = (height / 2 - ty - 0.5) * size;
    this.clampPan();
  }

  private baseTileSize(): number {
    const { width, height } = this.world.map;
    return Math.max(2, Math.min((this.viewW - 16) / width, (this.viewH - 16) / height));
  }

  private clampPan() {
    const { width, height } = this.world.map;
    const size = this.baseTileSize() * this.zoom;
    const mapW = width * size;
    const mapH = height * size;
    const limitX = Math.max(0, (mapW - this.viewW) / 2 + 40);
    const limitY = Math.max(0, (mapH - this.viewH) / 2 + 40);
    this.panX = Math.max(-limitX, Math.min(limitX, this.panX));
    this.panY = Math.max(-limitY, Math.min(limitY, this.panY));
  }

  private resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rect = this.canvas.getBoundingClientRect();
    this.viewW = rect.width;
    this.viewH = rect.height;
    this.canvas.width = Math.max(1, Math.round(rect.width * dpr));
    this.canvas.height = Math.max(1, Math.round(rect.height * dpr));
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const { width, height } = this.world.map;
    this.tileSize = this.baseTileSize() * this.zoom;
    this.offsetX = (rect.width - width * this.tileSize) / 2 + this.panX;
    this.offsetY = (rect.height - height * this.tileSize) / 2 + this.panY;
  }

  // ---------------- 描画 ----------------
  draw(selection: MapSelection) {
    this.resize();
    const { ctx, world, tileSize, offsetX, offsetY } = this;
    ctx.clearRect(0, 0, this.viewW, this.viewH);

    const maxDensity = this.maxDensity();

    for (let y = 0; y < world.map.height; y++) {
      const py = offsetY + y * tileSize;
      if (py + tileSize < 0 || py > this.viewH) continue;
      for (let x = 0; x < world.map.width; x++) {
        const px = offsetX + x * tileSize;
        if (px + tileSize < 0 || px > this.viewW) continue;

        const tile = world.map.tiles[y][x];
        ctx.fillStyle = this.colorFor(tile, selection, maxDensity);
        ctx.fillRect(px, py, tileSize + 0.6, tileSize + 0.6);

        if (tile.resource && tileSize > 6 && this.mode !== "population") {
          ctx.fillStyle = "rgba(240,217,140,0.85)";
          ctx.beginPath();
          ctx.arc(px + tileSize / 2, py + tileSize / 2, Math.max(0.8, tileSize * 0.11), 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }

    if (this.mode !== "terrain") this.drawBorders(selection);
    this.drawCities(selection);
  }

  private maxDensity(): number {
    let max = 1;
    for (const n of this.world.livingNations()) {
      const d = n.population / Math.max(1, n.territory.size);
      if (d > max) max = d;
    }
    return max;
  }

  private colorFor(tile: Tile, selection: MapSelection, maxDensity: number): string {
    if (tile.terrain === "ocean") {
      return mix(OCEAN_DEEP, OCEAN_SHALLOW, Math.min(1, tile.elevation / 0.36));
    }

    const base = TERRAIN_COLOR[tile.terrain];
    if (this.mode === "terrain" || !tile.ownerId) return base;

    const nation = this.world.getNation(tile.ownerId);
    if (!nation) return base;

    switch (this.mode) {
      case "population": {
        const density = nation.population / Math.max(1, nation.territory.size);
        return mix(base, heat(density / maxDensity), 0.8);
      }
      case "development":
        return mix(base, heat(nation.techLevel / 12), 0.8);
      case "relations": {
        if (!selection.id) return mix(base, nation.color, 0.4);
        if (nation.id === selection.id) return mix(base, "#f0d98c", 0.75);
        const rel = this.world.getNation(selection.id)?.relations[nation.id];
        const color =
          rel?.status === "war"
            ? "#a8453f"
            : rel?.status === "alliance"
              ? "#4f7a63"
              : rel?.status === "vassal"
                ? "#8a6bb0"
                : "#57617a";
        return mix(base, color, 0.7);
      }
      default: {
        const strength = !selection.id || selection.id === nation.id ? 0.6 : 0.32;
        return mix(base, nation.color, strength);
      }
    }
  }

  private drawBorders(selection: MapSelection) {
    const { ctx, world, tileSize, offsetX, offsetY } = this;
    ctx.lineWidth = Math.max(0.6, tileSize * 0.09);

    for (let y = 0; y < world.map.height; y++) {
      for (let x = 0; x < world.map.width; x++) {
        const owner = world.map.tiles[y][x].ownerId;
        if (!owner) continue;
        const px = offsetX + x * tileSize;
        const py = offsetY + y * tileSize;
        const selected = selection.id === owner;
        ctx.strokeStyle = selected ? "rgba(245,230,184,0.9)" : "rgba(10,14,22,0.55)";

        const right = x + 1 < world.map.width ? world.map.tiles[y][x + 1].ownerId : null;
        const down = y + 1 < world.map.height ? world.map.tiles[y + 1][x].ownerId : null;
        if (right !== owner) {
          ctx.beginPath();
          ctx.moveTo(px + tileSize, py);
          ctx.lineTo(px + tileSize, py + tileSize);
          ctx.stroke();
        }
        if (down !== owner) {
          ctx.beginPath();
          ctx.moveTo(px, py + tileSize);
          ctx.lineTo(px + tileSize, py + tileSize);
          ctx.stroke();
        }
        if (x === 0 || world.map.tiles[y][x - 1].ownerId !== owner) {
          ctx.beginPath();
          ctx.moveTo(px, py);
          ctx.lineTo(px, py + tileSize);
          ctx.stroke();
        }
        if (y === 0 || world.map.tiles[y - 1][x].ownerId !== owner) {
          ctx.beginPath();
          ctx.moveTo(px, py);
          ctx.lineTo(px + tileSize, py);
          ctx.stroke();
        }
      }
    }
  }

  private drawCities(selection: MapSelection) {
    const { ctx, world, tileSize, offsetX, offsetY } = this;
    const showName = this.showLabels && tileSize > 13;

    for (const city of world.cities) {
      const nation = world.getNation(city.nationId);
      if (!nation?.alive) continue;

      const cx = offsetX + city.x * tileSize + tileSize / 2;
      const cy = offsetY + city.y * tileSize + tileSize / 2;
      if (cx < -20 || cy < -20 || cx > this.viewW + 20 || cy > this.viewH + 20) continue;

      const selected = selection.id === nation.id;
      const r = Math.max(1.6, Math.min(tileSize * 0.42, 2 + Math.sqrt(city.population) / 22));

      ctx.beginPath();
      if (city.isCapital) {
        ctx.moveTo(cx, cy - r * 1.5);
        ctx.lineTo(cx + r * 1.5, cy);
        ctx.lineTo(cx, cy + r * 1.5);
        ctx.lineTo(cx - r * 1.5, cy);
        ctx.closePath();
      } else {
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
      }
      ctx.fillStyle = city.isCapital ? "#f5e6b8" : "#e8e2d0";
      ctx.fill();
      ctx.lineWidth = 1;
      ctx.strokeStyle = selected ? "#f0d98c" : "#0b111c";
      ctx.stroke();

      if (showName) {
        ctx.font = `${Math.min(13, Math.max(9, tileSize * 0.55))}px sans-serif`;
        ctx.textAlign = "center";
        ctx.lineWidth = 3;
        ctx.strokeStyle = "rgba(8,12,20,0.85)";
        ctx.strokeText(city.name, cx, cy - r - 3);
        ctx.fillStyle = city.isCapital ? "#f5e6b8" : "#d9d3c2";
        ctx.fillText(city.name, cx, cy - r - 3);
      }
    }
  }

  // ---------------- ヒットテスト ----------------
  tileAt(clientX: number, clientY: number): Tile | null {
    const rect = this.canvas.getBoundingClientRect();
    const x = Math.floor((clientX - rect.left - this.offsetX) / this.tileSize);
    const y = Math.floor((clientY - rect.top - this.offsetY) / this.tileSize);
    if (x < 0 || y < 0 || x >= this.world.map.width || y >= this.world.map.height) return null;
    return this.world.map.tiles[y][x];
  }

  cityAt(clientX: number, clientY: number): City | undefined {
    const tile = this.tileAt(clientX, clientY);
    return tile?.cityId ? this.world.getCity(tile.cityId) : undefined;
  }

  hitTest(clientX: number, clientY: number): string | null {
    return this.tileAt(clientX, clientY)?.ownerId ?? null;
  }
}