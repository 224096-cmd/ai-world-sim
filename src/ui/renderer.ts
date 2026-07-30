import { GameWorld } from "../core/simulation";
import { Army, City, MapMode, Terrain, Tile } from "../core/types";

// ============================================================
// 地図描画
//
// - 地形・領土・国境・川は「基準レイヤー」としてオフスクリーンに
//   一度だけ描き、毎フレームは拡大縮小して転送するだけ(高速・高画質)
// - 軍団/矢印/戦闘マーク/ラベルは毎フレーム画面座標で描く
// ============================================================

const BASE_TILE = 16; // 基準レイヤー1タイルあたりのピクセル数

const TERRAIN_COLOR: Record<Terrain, string> = {
  ocean: "#16324d",
  plains: "#6f7f43",
  forest: "#3b5730",
  jungle: "#2f5a33",
  swamp: "#4a5a45",
  hills: "#7a7a4a",
  mountain: "#6d6a62",
  desert: "#b09a5f",
  tundra: "#8e9a97",
  snow: "#d6dce0"
};

const OCEAN_DEEP = "#0a1626";
const OCEAN_SHALLOW = "#1f4a6b";
const RIVER_COLOR = "#4f8fbf";

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace("#", ""), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function mix(a: string, b: string, t: number): string {
  const ca = hexToRgb(a);
  const cb = hexToRgb(b);
  return `rgb(${Math.round(ca[0] + (cb[0] - ca[0]) * t)},${Math.round(
    ca[1] + (cb[1] - ca[1]) * t
  )},${Math.round(ca[2] + (cb[2] - ca[2]) * t)})`;
}

function shade(color: string, amount: number): string {
  const [r, g, b] = hexToRgb(color);
  const f = 1 + amount;
  return `rgb(${clamp255(r * f)},${clamp255(g * f)},${clamp255(b * f)})`;
}

function clamp255(v: number): number {
  return Math.max(0, Math.min(255, Math.round(v)));
}

function heat(t: number): string {
  const v = Math.max(0, Math.min(1, t));
  return v < 0.5 ? mix("#2f4f7a", "#d8c05a", v * 2) : mix("#d8c05a", "#b0453d", (v - 0.5) * 2);
}

export interface MapSelection {
  type: "nation" | null;
  id: string | null;
}

interface NationLabel {
  id: string;
  name: string;
  x: number;
  y: number;
  size: number;
  color: string;
}

export class MapRenderer {
  private ctx: CanvasRenderingContext2D;
  private base: HTMLCanvasElement;
  private baseCtx: CanvasRenderingContext2D;
  private baseDirty = true;
  private labels: NationLabel[] = [];

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
  showArmies = true;
  showGrid = false;

  constructor(private canvas: HTMLCanvasElement, private world: GameWorld) {
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) throw new Error("Canvas 2D context を取得できません");
    this.ctx = ctx;

    this.base = document.createElement("canvas");
    const baseCtx = this.base.getContext("2d");
    if (!baseCtx) throw new Error("オフスクリーンCanvasを作成できません");
    this.baseCtx = baseCtx;
  }

  setWorld(world: GameWorld) {
    this.world = world;
    this.baseDirty = true;
    this.resetView();
  }

  /** 領土・都市・地形が変化したら呼ぶ */
  invalidate() {
    this.baseDirty = true;
  }

  // ---------------- ビュー ----------------
  resetView() {
    this.zoom = 1;
    this.panX = 0;
    this.panY = 0;
  }
  getZoom(): number {
    return this.zoom;
  }
  zoomBy(factor: number, cx?: number, cy?: number) {
    const prev = this.zoom;
    this.zoom = Math.max(1, Math.min(12, this.zoom * factor));
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
  focusOn(tx: number, ty: number, zoom = 3) {
    this.zoom = Math.max(1, Math.min(12, zoom));
    const { width, height } = this.world.map;
    const size = this.baseTileSize() * this.zoom;
    this.panX = (width / 2 - tx - 0.5) * size;
    this.panY = (height / 2 - ty - 0.5) * size;
    this.clampPan();
  }
  private baseTileSize(): number {
    const { width, height } = this.world.map;
    return Math.max(2, Math.min(this.viewW / width, this.viewH / height));
  }
  private clampPan() {
    const { width, height } = this.world.map;
    const size = this.baseTileSize() * this.zoom;
    const limitX = Math.max(0, (width * size - this.viewW) / 2 + 30);
    const limitY = Math.max(0, (height * size - this.viewH) / 2 + 30);
    this.panX = Math.max(-limitX, Math.min(limitX, this.panX));
    this.panY = Math.max(-limitY, Math.min(limitY, this.panY));
  }

  private resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const rect = this.canvas.getBoundingClientRect();
    this.viewW = Math.max(1, rect.width);
    this.viewH = Math.max(1, rect.height);
    const w = Math.round(this.viewW * dpr);
    const h = Math.round(this.viewH * dpr);
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.ctx.imageSmoothingEnabled = true;

    const { width, height } = this.world.map;
    this.tileSize = this.baseTileSize() * this.zoom;
    this.offsetX = (this.viewW - width * this.tileSize) / 2 + this.panX;
    this.offsetY = (this.viewH - height * this.tileSize) / 2 + this.panY;
  }

  // ==========================================================
  // 基準レイヤー(地形+領土+国境+都市)
  // ==========================================================
  private renderBase() {
    const { world } = this;
    const { width, height } = world.map;
    const bw = width * BASE_TILE;
    const bh = height * BASE_TILE;
    if (this.base.width !== bw || this.base.height !== bh) {
      this.base.width = bw;
      this.base.height = bh;
    }
    const ctx = this.baseCtx;
    ctx.clearRect(0, 0, bw, bh);

    const maxDensity = this.maxDensity();

    // --- 地形 ---
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const tile = world.map.tiles[y][x];
        ctx.fillStyle = this.tileColor(tile, maxDensity);
        ctx.fillRect(x * BASE_TILE, y * BASE_TILE, BASE_TILE + 1, BASE_TILE + 1);
      }
    }

    // --- 川 ---
    if (this.mode === "terrain" || this.mode === "political") {
      ctx.strokeStyle = RIVER_COLOR;
      ctx.lineWidth = BASE_TILE * 0.22;
      ctx.lineCap = "round";
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const tile = world.map.tiles[y][x];
          if (!tile.river || tile.terrain === "ocean") continue;
          const cx = x * BASE_TILE + BASE_TILE / 2;
          const cy = y * BASE_TILE + BASE_TILE / 2;
          for (const [dx, dy] of [[1, 0], [0, 1]]) {
            const n = world.map.tiles[y + dy]?.[x + dx];
            if (!n || (!n.river && n.terrain !== "ocean")) continue;
            ctx.beginPath();
            ctx.moveTo(cx, cy);
            ctx.lineTo(cx + dx * BASE_TILE, cy + dy * BASE_TILE);
            ctx.stroke();
          }
        }
      }
    }

    // --- 海岸線 ---
    ctx.strokeStyle = "rgba(8,16,26,0.5)";
    ctx.lineWidth = BASE_TILE * 0.09;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (world.map.tiles[y][x].terrain !== "ocean") continue;
        const px = x * BASE_TILE;
        const py = y * BASE_TILE;
        if (world.map.tiles[y]?.[x + 1] && world.map.tiles[y][x + 1].terrain !== "ocean") {
          this.line(ctx, px + BASE_TILE, py, px + BASE_TILE, py + BASE_TILE);
        }
        if (world.map.tiles[y + 1]?.[x] && world.map.tiles[y + 1][x].terrain !== "ocean") {
          this.line(ctx, px, py + BASE_TILE, px + BASE_TILE, py + BASE_TILE);
        }
      }
    }

    // --- 国境 ---
    if (this.mode !== "terrain") this.renderBorders(ctx);

    // --- ラベル位置(領土の重心)を計算 ---
    this.computeLabels();
    this.baseDirty = false;
  }

  private line(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number) {
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  }

  private renderBorders(ctx: CanvasRenderingContext2D) {
    const { world } = this;
    const { width, height } = world.map;

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const owner = world.map.tiles[y][x].ownerId;
        if (!owner) continue;
        const nation = world.getNation(owner);
        if (!nation) continue;

        const px = x * BASE_TILE;
        const py = y * BASE_TILE;
        ctx.strokeStyle = shade(nation.color, 0.55);
        ctx.lineWidth = BASE_TILE * 0.16;

        const right = world.map.tiles[y]?.[x + 1]?.ownerId ?? null;
        const down = world.map.tiles[y + 1]?.[x]?.ownerId ?? null;
        const left = world.map.tiles[y]?.[x - 1]?.ownerId ?? null;
        const up = world.map.tiles[y - 1]?.[x]?.ownerId ?? null;
        if (right !== owner) this.line(ctx, px + BASE_TILE, py, px + BASE_TILE, py + BASE_TILE);
        if (down !== owner) this.line(ctx, px, py + BASE_TILE, px + BASE_TILE, py + BASE_TILE);
        if (left !== owner) this.line(ctx, px, py, px, py + BASE_TILE);
        if (up !== owner) this.line(ctx, px, py, px + BASE_TILE, py);
      }
    }
  }

  private computeLabels() {
    const sums = new Map<string, { x: number; y: number; n: number }>();
    for (const row of this.world.map.tiles) {
      for (const tile of row) {
        if (!tile.ownerId) continue;
        const acc = sums.get(tile.ownerId) ?? { x: 0, y: 0, n: 0 };
        acc.x += tile.x;
        acc.y += tile.y;
        acc.n += 1;
        sums.set(tile.ownerId, acc);
      }
    }
    this.labels = [];
    for (const [id, acc] of sums) {
      const nation = this.world.getNation(id);
      if (!nation?.alive || acc.n < 3) continue;
      this.labels.push({
        id,
        name: nation.name,
        x: acc.x / acc.n,
        y: acc.y / acc.n,
        size: acc.n,
        color: nation.color
      });
    }
    this.labels.sort((a, b) => b.size - a.size);
  }

  private maxDensity(): number {
    let max = 1;
    for (const n of this.world.livingNations()) {
      const d = n.population / Math.max(1, n.territory.size);
      if (d > max) max = d;
    }
    return max;
  }

  private tileColor(tile: Tile, maxDensity: number): string {
    if (tile.terrain === "ocean") {
      const depth = Math.min(1, Math.max(0, tile.elevation / this.world.map.seaLevel));
      return mix(OCEAN_DEEP, OCEAN_SHALLOW, depth * depth);
    }

    // 標高による陰影で立体感を出す
    let base = shade(TERRAIN_COLOR[tile.terrain], (tile.height - 0.4) * 0.35);
    if (tile.river) base = mix(base, RIVER_COLOR, 0.25);
    if (this.mode === "terrain" || !tile.ownerId) return base;

    const nation = this.world.getNation(tile.ownerId);
    if (!nation) return base;

    switch (this.mode) {
      case "population":
        return mix(base, heat(nation.population / Math.max(1, nation.territory.size) / maxDensity), 0.78);
      case "development":
        return mix(base, heat(nation.techLevel / 12), 0.78);
      case "military":
        return mix(base, heat(Math.min(1, nation.military / 2200)), 0.78);
      case "relations":
        return mix(base, nation.color, 0.45);
      default:
        return mix(base, nation.color, 0.5);
    }
  }

  // ==========================================================
  // 毎フレームの描画
  // ==========================================================
  /** alpha: 0-1 で軍団の移動を補間 (アニメーション用) */
  draw(selection: MapSelection, alpha = 1, time = 0) {
    this.resize();
    if (this.baseDirty) this.renderBase();

    const ctx = this.ctx;
    ctx.fillStyle = "#070d16";
    ctx.fillRect(0, 0, this.viewW, this.viewH);

    // 基準レイヤーを転送
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(
      this.base,
      this.offsetX,
      this.offsetY,
      this.world.map.width * this.tileSize,
      this.world.map.height * this.tileSize
    );

    if (this.mode === "relations" && selection.id) this.drawRelationOverlay(selection.id);
    if (selection.id) this.drawSelectionGlow(selection.id, time);

    this.drawMigrations(time);
    this.drawCities(selection);
    if (this.showArmies) this.drawArmies(alpha, time);
    this.drawBattleMarks(time);
    if (this.showLabels) this.drawNationLabels(selection);
  }

  private toScreen(tx: number, ty: number): [number, number] {
    return [this.offsetX + (tx + 0.5) * this.tileSize, this.offsetY + (ty + 0.5) * this.tileSize];
  }

  private drawRelationOverlay(selectedId: string) {
    const ctx = this.ctx;
    const selected = this.world.getNation(selectedId);
    if (!selected) return;

    for (const row of this.world.map.tiles) {
      for (const tile of row) {
        if (!tile.ownerId || tile.ownerId === selectedId) continue;
        const rel = selected.relations[tile.ownerId];
        if (!rel) continue;
        const color =
          rel.status === "war"
            ? "rgba(190,60,50,0.55)"
            : rel.status === "alliance"
              ? "rgba(70,150,110,0.5)"
              : rel.status === "vassal"
                ? "rgba(150,100,190,0.5)"
                : rel.status === "truce"
                  ? "rgba(200,170,90,0.35)"
                  : null;
        if (!color) continue;
        const px = this.offsetX + tile.x * this.tileSize;
        const py = this.offsetY + tile.y * this.tileSize;
        if (px + this.tileSize < 0 || py + this.tileSize < 0 || px > this.viewW || py > this.viewH) continue;
        ctx.fillStyle = color;
        ctx.fillRect(px, py, this.tileSize + 0.5, this.tileSize + 0.5);
      }
    }
  }

  private drawSelectionGlow(selectedId: string, time: number) {
    const ctx = this.ctx;
    const pulse = 0.35 + Math.sin(time / 420) * 0.18;
    ctx.strokeStyle = `rgba(245,230,184,${pulse})`;
    ctx.lineWidth = Math.max(1.2, this.tileSize * 0.16);

    const nation = this.world.getNation(selectedId);
    if (!nation) return;
    const s = this.tileSize;
    for (const key of nation.territory) {
      const [x, y] = key.split(",").map(Number);
      const px = this.offsetX + x * s;
      const py = this.offsetY + y * s;
      if (px + s < -10 || py + s < -10 || px > this.viewW + 10 || py > this.viewH + 10) continue;
      if (this.world.map.tiles[y]?.[x + 1]?.ownerId !== selectedId) this.line(ctx, px + s, py, px + s, py + s);
      if (this.world.map.tiles[y + 1]?.[x]?.ownerId !== selectedId) this.line(ctx, px, py + s, px + s, py + s);
      if (this.world.map.tiles[y]?.[x - 1]?.ownerId !== selectedId) this.line(ctx, px, py, px, py + s);
      if (this.world.map.tiles[y - 1]?.[x]?.ownerId !== selectedId) this.line(ctx, px, py, px + s, py);
    }
  }

  /** 入植・避難の流れを矢印で表示 */
  private drawMigrations(time: number) {
    const ctx = this.ctx;
    for (const m of this.world.migrations) {
      const age = this.world.year - m.year;
      if (age > 3) continue;
      const nation = this.world.getNation(m.nationId);
      if (!nation?.alive) continue;
      const [x1, y1] = this.toScreen(m.fromX, m.fromY);
      const [x2, y2] = this.toScreen(m.toX, m.toY);
      const fade = 0.5 - age * 0.12;
      ctx.strokeStyle = `rgba(230,220,190,${Math.max(0.08, fade)})`;
      ctx.lineWidth = Math.max(1, this.tileSize * 0.07);
      ctx.setLineDash([this.tileSize * 0.3, this.tileSize * 0.3]);
      ctx.lineDashOffset = -(time / 60) % 1000;
      this.line(ctx, x1, y1, x2, y2);
      ctx.setLineDash([]);
      this.arrowHead(x1, y1, x2, y2, `rgba(230,220,190,${Math.max(0.1, fade)})`, this.tileSize * 0.22);
    }
  }

  private drawCities(selection: MapSelection) {
    const ctx = this.ctx;
    const showName = this.showLabels && this.tileSize > 11;

    for (const city of this.world.cities) {
      const nation = this.world.getNation(city.nationId);
      if (!nation?.alive) continue;
      const [cx, cy] = this.toScreen(city.x, city.y);
      if (cx < -30 || cy < -30 || cx > this.viewW + 30 || cy > this.viewH + 30) continue;

      const selected = selection.id === nation.id;
      const r = Math.max(2, Math.min(this.tileSize * 0.45, 2.5 + Math.sqrt(city.population) / 26));

      // 都市の外周(城壁)
      ctx.beginPath();
      ctx.arc(cx, cy, r * 1.55, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(10,14,22,0.45)";
      ctx.fill();

      ctx.beginPath();
      if (city.isCapital) {
        const s = r * 1.35;
        ctx.moveTo(cx, cy - s);
        ctx.lineTo(cx + s, cy);
        ctx.lineTo(cx, cy + s);
        ctx.lineTo(cx - s, cy);
        ctx.closePath();
      } else {
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
      }
      ctx.fillStyle = city.isCapital ? "#f7ecc8" : "#e6e0cf";
      ctx.fill();
      ctx.lineWidth = Math.max(0.8, r * 0.28);
      ctx.strokeStyle = selected ? "#f0d98c" : shade(nation.color, -0.35);
      ctx.stroke();

      // 包囲中は赤い環
      if (city.siegeBy) {
        ctx.beginPath();
        ctx.arc(cx, cy, r * 2.1, 0, Math.PI * 2);
        ctx.strokeStyle = "rgba(200,70,60,0.85)";
        ctx.lineWidth = Math.max(1, r * 0.3);
        ctx.setLineDash([r * 0.9, r * 0.7]);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      if (showName) {
        this.text(city.name, cx, cy - r * 1.9, Math.min(14, Math.max(9, this.tileSize * 0.5)), city.isCapital ? "#f7ecc8" : "#ded8c6");
      }
    }
  }

  private drawArmies(alpha: number, time: number) {
    const ctx = this.ctx;
    for (const army of this.world.armies) {
      const nation = this.world.getNation(army.nationId);
      if (!nation?.alive) continue;

      const ix = army.prevX + (army.x - army.prevX) * alpha;
      const iy = army.prevY + (army.y - army.prevY) * alpha;
      const [ax, ay] = this.toScreen(ix, iy);
      if (ax < -40 || ay < -40 || ax > this.viewW + 40 || ay > this.viewH + 40) continue;

      // 進軍方向の矢印
      if (army.state === "march" || army.state === "retreat") {
        const [tx, ty] = this.toScreen(army.targetX, army.targetY);
        const dist = Math.hypot(tx - ax, ty - ay);
        if (dist > 6) {
          const col = army.state === "retreat" ? "rgba(190,150,90,0.5)" : hexToRgba(nation.color, 0.55);
          ctx.strokeStyle = col;
          ctx.lineWidth = Math.max(1, this.tileSize * 0.09);
          ctx.setLineDash([this.tileSize * 0.35, this.tileSize * 0.25]);
          ctx.lineDashOffset = -(time / 40) % 1000;
          this.line(ctx, ax, ay, tx, ty);
          ctx.setLineDash([]);
          this.arrowHead(ax, ay, tx, ty, col, this.tileSize * 0.3);
        }
      }

      const size = Math.max(2.5, Math.min(this.tileSize * 0.42, 3 + Math.sqrt(army.strength) / 9));
      const pulse = army.state === "siege" || army.state === "battle" ? 1 + Math.sin(time / 160) * 0.16 : 1;

      ctx.beginPath();
      ctx.arc(ax, ay, size * 1.5 * pulse, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(8,12,20,0.5)";
      ctx.fill();

      // 部隊マーク(四角=軍団)
      ctx.fillStyle = nation.color;
      ctx.strokeStyle = "#0d1420";
      ctx.lineWidth = Math.max(0.8, size * 0.22);
      ctx.beginPath();
      ctx.rect(ax - size * pulse, ay - size * 0.75 * pulse, size * 2 * pulse, size * 1.5 * pulse);
      ctx.fill();
      ctx.stroke();

      // 士気バー
      if (this.tileSize > 14) {
        const w = size * 2;
        ctx.fillStyle = "rgba(0,0,0,0.5)";
        ctx.fillRect(ax - w / 2, ay + size * 1.1, w, 2.5);
        ctx.fillStyle = army.morale > 50 ? "#7fb069" : army.morale > 25 ? "#d8b04a" : "#c0504a";
        ctx.fillRect(ax - w / 2, ay + size * 1.1, (w * army.morale) / 100, 2.5);
      }
    }
  }

  private drawBattleMarks(time: number) {
    const ctx = this.ctx;
    for (const mark of this.world.battles) {
      const age = this.world.year - mark.year;
      if (age > 6) continue;
      const [x, y] = this.toScreen(mark.x, mark.y);
      if (x < -20 || y < -20 || x > this.viewW + 20 || y > this.viewH + 20) continue;

      const fade = Math.max(0.12, 0.9 - age * 0.15);
      const s = Math.max(3, this.tileSize * 0.34) * (age === 0 ? 1 + Math.sin(time / 200) * 0.15 : 1);

      ctx.strokeStyle = mark.kind === "sack" ? `rgba(230,120,60,${fade})` : `rgba(220,90,80,${fade})`;
      ctx.lineWidth = Math.max(1.2, s * 0.3);
      ctx.lineCap = "round";
      this.line(ctx, x - s, y - s, x + s, y + s);
      this.line(ctx, x + s, y - s, x - s, y + s);
    }
  }

  private drawNationLabels(selection: MapSelection) {
    const shown = this.labels.slice(0, this.zoom > 2 ? 40 : 18);
    for (const label of shown) {
      const [x, y] = this.toScreen(label.x, label.y);
      if (x < -60 || y < -30 || x > this.viewW + 60 || y > this.viewH + 30) continue;
      // 小国は拡大しないと表示しない
      const minSize = this.zoom > 3 ? 2 : this.zoom > 1.6 ? 6 : 12;
      if (label.size < minSize) continue;

      const fontSize = Math.min(
        22,
        Math.max(10, Math.sqrt(label.size) * 2.4 * Math.min(1.6, this.tileSize / 10))
      );
      const emphasised = selection.id === label.id;
      this.text(
        label.name,
        x,
        y,
        fontSize,
        emphasised ? "#fff4d0" : "#efe8d4",
        emphasised ? 1 : 0.88,
        true
      );
    }
  }

  private text(
    value: string,
    x: number,
    y: number,
    size: number,
    color: string,
    alpha = 1,
    serif = false
  ) {
    const ctx = this.ctx;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.font = `${serif ? "600 " : ""}${size}px ${serif ? '"Hiragino Mincho ProN", "Noto Serif JP", serif' : "sans-serif"}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineWidth = Math.max(2.5, size * 0.3);
    ctx.strokeStyle = "rgba(6,10,18,0.9)";
    ctx.lineJoin = "round";
    ctx.strokeText(value, x, y);
    ctx.fillStyle = color;
    ctx.fillText(value, x, y);
    ctx.restore();
  }

  private arrowHead(x1: number, y1: number, x2: number, y2: number, color: string, size: number) {
    const ctx = this.ctx;
    const angle = Math.atan2(y2 - y1, x2 - x1);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(x2, y2);
    ctx.lineTo(x2 - Math.cos(angle - 0.4) * size, y2 - Math.sin(angle - 0.4) * size);
    ctx.lineTo(x2 - Math.cos(angle + 0.4) * size, y2 - Math.sin(angle + 0.4) * size);
    ctx.closePath();
    ctx.fill();
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

  armyAt(clientX: number, clientY: number): Army | undefined {
    const tile = this.tileAt(clientX, clientY);
    if (!tile) return undefined;
    return this.world.armies.find((a) => Math.round(a.x) === tile.x && Math.round(a.y) === tile.y);
  }

  hitTest(clientX: number, clientY: number): string | null {
    return this.tileAt(clientX, clientY)?.ownerId ?? null;
  }
}

function hexToRgba(hex: string, alpha: number): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r},${g},${b},${alpha})`;
}