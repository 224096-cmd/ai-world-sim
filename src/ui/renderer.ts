import { World } from "../core/simulation";
import { hash2 } from "../core/rng";
import { MapMode, R, T, isLand, isWater } from "../core/types";

// ============================================================
// 描画エンジン
// 地形と国境は offscreen canvas にベイクし、毎フレームは
// drawImage + 動的要素(都市/軍/住民/エフェクト)のみ描く。
// ============================================================

const TS = 6; // ベイク解像度 (px/タイル)

const TERRAIN_COLOR: Record<number, [string, string]> = {
  // [ベース色, まだら色]
  [T.ocean]: ["#12365c", "#0e2c4e"],
  [T.coast]: ["#1e5b86", "#194f77"],
  [T.plains]: ["#7aa74f", "#6f9c47"],
  [T.forest]: ["#3e7a3a", "#356b32"],
  [T.jungle]: ["#2e6b34", "#26592c"],
  [T.swamp]: ["#4e6b4a", "#435c40"],
  [T.savanna]: ["#a3a95c", "#969c52"],
  [T.hills]: ["#8a8a5c", "#7c7c50"],
  [T.mountain]: ["#8d8d94", "#77777e"],
  [T.desert]: ["#d3ba7a", "#c7ad6c"],
  [T.tundra]: ["#9aa591", "#8c9784"],
  [T.snow]: ["#e6ecef", "#d6dde2"],
  [T.burnt]: ["#4a4038", "#3d342d"],
  [T.lava]: ["#c8502c", "#a83a1c"]
};

const RES_COLOR: Record<number, string> = {
  [R.gold]: "#ffd24a",
  [R.iron]: "#b9c4cc",
  [R.gem]: "#c86ee0",
  [R.grain]: "#f0e08a",
  [R.horse]: "#c89a6a"
};

export interface RenderState {
  mode: MapMode;
  selectedNationId: string | null;
  showLabels: boolean;
  showUnits: boolean;
  brushRadius: number;
  pointer: { tx: number; ty: number; visible: boolean; paintTool: boolean };
}

export class MapRenderer {
  private ctx: CanvasRenderingContext2D;
  private terrainLayer: HTMLCanvasElement;
  private terrainCtx: CanvasRenderingContext2D;
  private ownerLayer: HTMLCanvasElement;
  private ownerCtx: CanvasRenderingContext2D;
  private modeLayer: HTMLCanvasElement;
  private modeCtx: CanvasRenderingContext2D;
  private modeDirty = true;
  private lastMode: MapMode = "political";
  private lastSelForMode: string | null = null;

  cam = { x: 0, y: 0, zoom: 8 }; // x,y=画面中央のタイル座標 / zoom=px per tile
  private dpr = 1;

  constructor(private canvas: HTMLCanvasElement, private world: World) {
    this.ctx = canvas.getContext("2d")!;
    this.terrainLayer = document.createElement("canvas");
    this.ownerLayer = document.createElement("canvas");
    this.modeLayer = document.createElement("canvas");
    this.terrainLayer.width = this.ownerLayer.width = this.modeLayer.width = world.width * TS;
    this.terrainLayer.height = this.ownerLayer.height = this.modeLayer.height = world.height * TS;
    this.terrainCtx = this.terrainLayer.getContext("2d")!;
    this.ownerCtx = this.ownerLayer.getContext("2d")!;
    this.modeCtx = this.modeLayer.getContext("2d")!;
    this.cam.x = world.width / 2;
    this.cam.y = world.height / 2;
    this.fitZoom();
    this.resize();
  }

  /** 世界を差し替える (新規生成/ロード時) */
  setWorld(world: World): void {
    this.world = world;
    this.terrainLayer.width = this.ownerLayer.width = this.modeLayer.width = world.width * TS;
    this.terrainLayer.height = this.ownerLayer.height = this.modeLayer.height = world.height * TS;
    this.cam.x = world.width / 2;
    this.cam.y = world.height / 2;
    this.fitZoom();
    this.modeDirty = true;
  }

  fitZoom(): void {
    const cw = this.canvas.clientWidth || window.innerWidth;
    const ch = this.canvas.clientHeight || window.innerHeight;
    this.cam.zoom = Math.max(2.5, Math.min(cw / this.world.width, ch / this.world.height) * 0.96);
  }

  resize(): void {
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    this.canvas.width = Math.round(w * this.dpr);
    this.canvas.height = Math.round(h * this.dpr);
  }

  // ---- 座標変換 --------------------------------------------
  tileToScreen(tx: number, ty: number): { x: number; y: number } {
    const cw = this.canvas.clientWidth;
    const ch = this.canvas.clientHeight;
    return {
      x: (tx - this.cam.x) * this.cam.zoom + cw / 2,
      y: (ty - this.cam.y) * this.cam.zoom + ch / 2
    };
  }

  screenToTile(sx: number, sy: number): { tx: number; ty: number } {
    const cw = this.canvas.clientWidth;
    const ch = this.canvas.clientHeight;
    return {
      tx: (sx - cw / 2) / this.cam.zoom + this.cam.x,
      ty: (sy - ch / 2) / this.cam.zoom + this.cam.y
    };
  }

  pan(dxPx: number, dyPx: number): void {
    this.cam.x -= dxPx / this.cam.zoom;
    this.cam.y -= dyPx / this.cam.zoom;
    this.clampCam();
  }

  zoomAt(sx: number, sy: number, factor: number): void {
    const before = this.screenToTile(sx, sy);
    this.cam.zoom = Math.max(2, Math.min(56, this.cam.zoom * factor));
    const after = this.screenToTile(sx, sy);
    this.cam.x += before.tx - after.tx;
    this.cam.y += before.ty - after.ty;
    this.clampCam();
  }

  centerOn(tx: number, ty: number, zoom?: number): void {
    this.cam.x = tx;
    this.cam.y = ty;
    if (zoom) this.cam.zoom = Math.max(2, Math.min(56, zoom));
    this.clampCam();
  }

  private clampCam(): void {
    const m = 6;
    this.cam.x = Math.max(-m, Math.min(this.world.width + m, this.cam.x));
    this.cam.y = Math.max(-m, Math.min(this.world.height + m, this.cam.y));
  }

  invalidateMode(): void {
    this.modeDirty = true;
  }

  // ============================================================
  // ベイク (地形・国境)
  // ============================================================
  repaintAll(): void {
    const w = this.world.width;
    const h = this.world.height;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) this.paintTerrainTile(x, y);
    }
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) this.paintOwnerTile(x, y);
    }
    this.modeDirty = true;
  }

  applyDirty(indices: number[]): void {
    if (indices.length === 0) return;
    const w = this.world.width;
    const need = new Set<number>();
    for (const i of indices) {
      need.add(i);
      const x = i % w;
      const y = (i - x) / w;
      if (x > 0) need.add(i - 1);
      if (x < w - 1) need.add(i + 1);
      if (y > 0) need.add(i - w);
      if (y < this.world.height - 1) need.add(i + w);
    }
    for (const i of indices) {
      const x = i % w;
      this.paintTerrainTile(x, (i - x) / w);
    }
    for (const i of need) {
      const x = i % w;
      this.paintOwnerTile(x, (i - x) / w);
    }
    this.modeDirty = true;
  }

  private paintTerrainTile(x: number, y: number): void {
    const wld = this.world;
    const i = wld.idx(x, y);
    const t = wld.terrain[i];
    const [base, speck] = TERRAIN_COLOR[t] ?? TERRAIN_COLOR[T.plains];
    const ctx = this.terrainCtx;
    const px = x * TS;
    const py = y * TS;

    // 標高で明暗をつける
    const e = wld.elevation[i];
    ctx.fillStyle = base;
    ctx.fillRect(px, py, TS, TS);
    const shade = isWater(t) ? (0.42 - e) * 0.9 : (e - 0.42) * 0.55;
    if (shade > 0.02) {
      ctx.fillStyle = isWater(t) ? `rgba(0,0,30,${Math.min(0.5, shade)})` : `rgba(255,255,235,${Math.min(0.3, shade)})`;
      ctx.fillRect(px, py, TS, TS);
    }
    // まだら模様 (ドット絵風の質感)
    ctx.fillStyle = speck;
    const h1 = hash2(x, y, 7);
    const h2 = hash2(x, y, 13);
    ctx.fillRect(px + Math.floor(h1 * (TS - 2)), py + Math.floor(h2 * (TS - 2)), 2, 2);
    if (h1 > 0.5) ctx.fillRect(px + Math.floor(h2 * (TS - 1)), py + Math.floor(h1 * (TS - 1)), 1, 1);

    // 山の稜線
    if (t === T.mountain) {
      ctx.fillStyle = "#e8e8ee";
      ctx.fillRect(px + 2, py + 1, 2, 1);
      ctx.fillStyle = "#5c5c64";
      ctx.fillRect(px + 1, py + 4, 4, 1);
    }
    // 川
    if (wld.river[i] && isLand(t)) {
      ctx.fillStyle = "#3d7fb8";
      ctx.fillRect(px + 2, py, 2, TS);
      if (hash2(x, y, 21) > 0.5) ctx.fillRect(px, py + 2, TS, 2);
    }
    // 資源
    const res = wld.resource[i];
    if (res !== R.none) {
      ctx.fillStyle = RES_COLOR[res];
      ctx.fillRect(px + TS / 2 - 1.5, py + TS / 2 - 1.5, 3, 3);
      ctx.fillStyle = "rgba(0,0,0,0.35)";
      ctx.fillRect(px + TS / 2 - 1.5, py + TS / 2 + 0.5, 3, 1);
    }
  }

  private paintOwnerTile(x: number, y: number): void {
    const wld = this.world;
    const i = wld.idx(x, y);
    const ctx = this.ownerCtx;
    const px = x * TS;
    const py = y * TS;
    ctx.clearRect(px, py, TS, TS);
    const o = wld.owner[i];
    if (o < 0 || !wld.nations[o]?.alive) return;
    const nation = wld.nations[o];
    ctx.fillStyle = nation.color;
    ctx.fillRect(px, py, TS, TS);
    // 国境: 隣が別勢力なら濃い縁を引く
    ctx.fillStyle = nation.colorDark;
    const diff = (nx: number, ny: number) =>
      !wld.inBounds(nx, ny) || wld.owner[wld.idx(nx, ny)] !== o;
    if (diff(x - 1, y)) ctx.fillRect(px, py, 1.4, TS);
    if (diff(x + 1, y)) ctx.fillRect(px + TS - 1.4, py, 1.4, TS);
    if (diff(x, y - 1)) ctx.fillRect(px, py, TS, 1.4);
    if (diff(x, y + 1)) ctx.fillRect(px, py + TS - 1.4, TS, 1.4);
  }

  // ---- 表示モードのヒートレイヤー ---------------------------
  private rebuildModeLayer(mode: MapMode, selId: string | null): void {
    const wld = this.world;
    const ctx = this.modeCtx;
    ctx.clearRect(0, 0, this.modeLayer.width, this.modeLayer.height);
    if (mode === "population") {
      for (const c of wld.cities) {
        if (c.population <= 0) continue;
        const r = (2 + Math.sqrt(c.population) / 9) * TS;
        const g = ctx.createRadialGradient(c.x * TS + TS / 2, c.y * TS + TS / 2, 0, c.x * TS + TS / 2, c.y * TS + TS / 2, r);
        g.addColorStop(0, "rgba(255,190,60,0.85)");
        g.addColorStop(0.6, "rgba(230,90,40,0.45)");
        g.addColorStop(1, "rgba(230,90,40,0)");
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(c.x * TS + TS / 2, c.y * TS + TS / 2, r, 0, Math.PI * 2);
        ctx.fill();
      }
    } else if (mode === "tech") {
      let min = Infinity;
      let max = -Infinity;
      for (const n of wld.nations) {
        if (!n.alive) continue;
        min = Math.min(min, n.tech);
        max = Math.max(max, n.tech);
      }
      const span = Math.max(0.001, max - min);
      for (let i = 0; i < wld.owner.length; i++) {
        const o = wld.owner[i];
        if (o < 0 || !wld.nations[o].alive) continue;
        const t = (wld.nations[o].tech - min) / span;
        const x = (i % wld.width) * TS;
        const y = Math.floor(i / wld.width) * TS;
        ctx.fillStyle = `rgba(${Math.round(60 + 190 * t)},${Math.round(90 + 120 * t)},${Math.round(220 - 150 * t)},0.6)`;
        ctx.fillRect(x, y, TS, TS);
      }
    } else if (mode === "relations" && selId) {
      const sel = wld.nationById(selId);
      if (sel) {
        for (let i = 0; i < wld.owner.length; i++) {
          const o = wld.owner[i];
          if (o < 0 || !wld.nations[o].alive) continue;
          const n = wld.nations[o];
          let color = "rgba(120,130,150,0.35)";
          if (n.id === sel.id) color = "rgba(240,240,255,0.55)";
          else {
            const r = sel.relations[n.id];
            if (r) {
              if (r.status === "war") color = "rgba(220,60,50,0.62)";
              else if (r.status === "alliance") color = "rgba(80,200,110,0.62)";
              else if (r.status === "truce") color = "rgba(230,160,60,0.55)";
              else color = `rgba(${r.score < 0 ? 200 : 90},${r.score < 0 ? 110 : 170},${150},0.4)`;
            }
          }
          const x = (i % wld.width) * TS;
          const y = Math.floor(i / wld.width) * TS;
          ctx.fillStyle = color;
          ctx.fillRect(x, y, TS, TS);
        }
      }
    }
  }

  // ============================================================
  // メイン描画
  // ============================================================
  render(state: RenderState, simAlpha: number, timeMs: number): void {
    const wld = this.world;
    if (wld.needFullRepaint) {
      wld.needFullRepaint = false;
      this.repaintAll();
    }
    this.applyDirty(wld.consumeDirty());
    if (this.modeDirty || state.mode !== this.lastMode || state.selectedNationId !== this.lastSelForMode) {
      this.rebuildModeLayer(state.mode, state.selectedNationId);
      this.modeDirty = false;
      this.lastMode = state.mode;
      this.lastSelForMode = state.selectedNationId;
    }

    const ctx = this.ctx;
    const cw = this.canvas.clientWidth;
    const ch = this.canvas.clientHeight;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = "#0a0e18";
    ctx.fillRect(0, 0, cw, ch);

    const z = this.cam.zoom;
    const origin = this.tileToScreen(0, 0);
    const scale = z / TS;
    ctx.imageSmoothingEnabled = z < TS;

    ctx.save();
    ctx.translate(origin.x, origin.y);
    ctx.scale(scale, scale);
    ctx.drawImage(this.terrainLayer, 0, 0);
    // 政治オーバーレイ
    if (state.mode === "political" || state.mode === "relations") {
      ctx.globalAlpha = state.mode === "political" ? 0.52 : 0.2;
      ctx.drawImage(this.ownerLayer, 0, 0);
      ctx.globalAlpha = 1;
    } else if (state.mode === "terrain") {
      ctx.globalAlpha = 0.16;
      ctx.drawImage(this.ownerLayer, 0, 0);
      ctx.globalAlpha = 1;
    } else {
      ctx.globalAlpha = 0.25;
      ctx.drawImage(this.ownerLayer, 0, 0);
      ctx.globalAlpha = 1;
    }
    if (state.mode === "population" || state.mode === "tech" || state.mode === "relations") {
      ctx.drawImage(this.modeLayer, 0, 0);
    }
    ctx.restore();
    ctx.imageSmoothingEnabled = true;

    // ---- 燃焼タイル ----
    if (wld.burningTiles.size > 0) {
      for (const i of wld.burningTiles) {
        const x = i % wld.width;
        const y = Math.floor(i / wld.width);
        const s = this.tileToScreen(x, y);
        if (s.x < -z || s.y < -z || s.x > cw + z || s.y > ch + z) continue;
        const flick = hash2(x, y, Math.floor(timeMs / 90));
        ctx.fillStyle = flick > 0.5 ? "rgba(255,150,40,0.85)" : "rgba(255,90,30,0.8)";
        ctx.beginPath();
        ctx.arc(s.x + z * 0.5, s.y + z * 0.45, z * (0.22 + flick * 0.14), 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "rgba(255,230,120,0.9)";
        ctx.beginPath();
        ctx.arc(s.x + z * 0.5, s.y + z * 0.5, z * 0.1, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // ---- 選択国の強調枠 ----
    if (state.selectedNationId) {
      this.drawSelectedBorder(ctx, state.selectedNationId, timeMs);
    }

    // ---- 住民/動物 ----
    if (state.showUnits && z >= 4) {
      for (const u of wld.units) {
        const ux = u.px + (u.x - u.px) * simAlpha;
        const uy = u.py + (u.y - u.py) * simAlpha;
        const s = this.tileToScreen(ux + 0.5, uy + 0.5);
        if (s.x < -20 || s.y < -20 || s.x > cw + 20 || s.y > ch + 20) continue;
        if (u.kind === "dragon") {
          this.drawDragon(ctx, s.x, s.y, z, timeMs);
          continue;
        }
        const r = Math.max(1.4, z * 0.14);
        let fill = "#ddd";
        if (u.kind === "villager") {
          const n = wld.nationById(u.nationId);
          fill = n ? n.color : "#ccc";
        } else if (u.kind === "sheep") fill = "#f2f0e6";
        else if (u.kind === "wolf") fill = "#4a4a52";
        ctx.fillStyle = "rgba(0,0,0,0.4)";
        ctx.beginPath();
        ctx.arc(s.x + 0.6, s.y + 0.8, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = fill;
        ctx.beginPath();
        ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // ---- 都市 ----
    const fontPx = Math.max(10, Math.min(14, z * 0.9));
    for (const c of wld.cities) {
      if (c.population <= 0) continue;
      const s = this.tileToScreen(c.x + 0.5, c.y + 0.5);
      if (s.x < -60 || s.y < -60 || s.x > cw + 60 || s.y > ch + 60) continue;
      const n = wld.nationById(c.nationId);
      const tier = c.population > 6000 ? 3 : c.population > 2200 ? 2 : 1;
      const base = Math.max(3, z * (0.32 + tier * 0.1));
      // 建物ブロック
      ctx.fillStyle = "rgba(0,0,0,0.45)";
      ctx.fillRect(s.x - base / 2 + 1.5, s.y - base / 2 + 1.5, base, base);
      ctx.fillStyle = "#d8cfb8";
      ctx.fillRect(s.x - base / 2, s.y - base / 2, base, base);
      ctx.fillStyle = "#8a7a5c";
      ctx.fillRect(s.x - base / 2, s.y - base / 2, base, base * 0.28);
      if (tier >= 2) {
        ctx.fillStyle = "#c8bda0";
        ctx.fillRect(s.x - base * 0.75, s.y - base * 0.1, base * 0.45, base * 0.6);
        ctx.fillRect(s.x + base * 0.32, s.y - base * 0.05, base * 0.45, base * 0.55);
      }
      // 城壁
      if (c.fortification > 55 && z > 6) {
        ctx.strokeStyle = "#9a9aa4";
        ctx.lineWidth = Math.max(1, z * 0.08);
        ctx.strokeRect(s.x - base * 0.95, s.y - base * 0.85, base * 1.9, base * 1.7);
      }
      // 首都の星
      if (c.isCapital && n) {
        ctx.fillStyle = "#ffd75e";
        ctx.font = `${Math.max(9, z * 0.7)}px sans-serif`;
        ctx.textAlign = "center";
        ctx.fillText("★", s.x, s.y - base * 0.8);
      }
      // 包囲・疫病
      if (c.siegeBy && Math.floor(timeMs / 400) % 2 === 0) {
        ctx.font = `${Math.max(11, z * 0.8)}px sans-serif`;
        ctx.textAlign = "center";
        ctx.fillText("⚔️", s.x + base, s.y - base * 0.6);
      }
      if (c.plagueTicks > 0) {
        ctx.font = `${Math.max(11, z * 0.7)}px sans-serif`;
        ctx.textAlign = "center";
        ctx.fillStyle = "#b6e04a";
        ctx.fillText("☠", s.x - base, s.y - base * 0.6);
      }
      // ラベル
      if (state.showLabels && z >= 7) {
        ctx.font = `${fontPx}px 'Hiragino Kaku Gothic ProN','Yu Gothic',sans-serif`;
        ctx.textAlign = "center";
        ctx.lineWidth = 3;
        ctx.strokeStyle = "rgba(8,10,18,0.85)";
        ctx.fillStyle = n ? "#f2ead6" : "#ccc";
        const label = `${c.isCapital ? "★" : ""}${c.name}`;
        ctx.strokeText(label, s.x, s.y + base + fontPx);
        ctx.fillText(label, s.x, s.y + base + fontPx);
        if (z >= 12) {
          ctx.font = `${fontPx * 0.8}px sans-serif`;
          ctx.fillStyle = "#b8b09a";
          ctx.strokeText(`${formatNum(c.population)}人`, s.x, s.y + base + fontPx * 2);
          ctx.fillText(`${formatNum(c.population)}人`, s.x, s.y + base + fontPx * 2);
        }
      }
    }

    // ---- 国名ラベル (首都の上に大きく) ----
    if (state.showLabels && z >= 3.2) {
      for (const n of wld.nations) {
        if (!n.alive) continue;
        const cap = wld.cityById(n.capitalCityId);
        if (!cap) continue;
        const s = this.tileToScreen(cap.x + 0.5, cap.y - 1.2);
        if (s.x < -100 || s.y < -40 || s.x > cw + 100 || s.y > ch + 40) continue;
        const size = Math.max(11, Math.min(20, z * 1.15));
        ctx.font = `600 ${size}px 'Hiragino Mincho ProN','Yu Mincho',serif`;
        ctx.textAlign = "center";
        ctx.lineWidth = 4;
        ctx.strokeStyle = "rgba(8,10,18,0.9)";
        ctx.strokeText(n.name, s.x, s.y);
        ctx.fillStyle = n.color;
        ctx.fillText(n.name, s.x, s.y);
      }
    }

    // ---- 軍団 ----
    for (const a of wld.armies.values()) {
      const ax = a.px + (a.x - a.px) * simAlpha;
      const ay = a.py + (a.y - a.py) * simAlpha;
      const s = this.tileToScreen(ax + 0.5, ay + 0.5);
      if (s.x < -40 || s.y < -40 || s.x > cw + 40 || s.y > ch + 40) continue;
      const n = wld.nationById(a.nationId);
      const size = Math.max(5, z * 0.55);
      if (a.atSea) {
        // 船
        ctx.fillStyle = "#7a5c3a";
        ctx.beginPath();
        ctx.moveTo(s.x - size * 0.8, s.y);
        ctx.lineTo(s.x + size * 0.8, s.y);
        ctx.lineTo(s.x + size * 0.45, s.y + size * 0.45);
        ctx.lineTo(s.x - size * 0.45, s.y + size * 0.45);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = n ? n.color : "#ccc";
        ctx.fillRect(s.x - size * 0.08, s.y - size, size * 0.16, size);
        ctx.beginPath();
        ctx.moveTo(s.x + size * 0.08, s.y - size);
        ctx.lineTo(s.x + size * 0.7, s.y - size * 0.55);
        ctx.lineTo(s.x + size * 0.08, s.y - size * 0.25);
        ctx.closePath();
        ctx.fill();
      } else {
        // 旗と兵
        ctx.fillStyle = "rgba(0,0,0,0.45)";
        ctx.beginPath();
        ctx.ellipse(s.x, s.y + size * 0.4, size * 0.7, size * 0.28, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = "#e8e0cc";
        ctx.lineWidth = Math.max(1, size * 0.12);
        ctx.beginPath();
        ctx.moveTo(s.x, s.y + size * 0.4);
        ctx.lineTo(s.x, s.y - size);
        ctx.stroke();
        ctx.fillStyle = n ? n.color : "#ccc";
        ctx.beginPath();
        ctx.moveTo(s.x, s.y - size);
        ctx.lineTo(s.x + size * 0.9, s.y - size * 0.7);
        ctx.lineTo(s.x, s.y - size * 0.4);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = n ? n.colorDark : "#888";
        ctx.lineWidth = 1;
        ctx.stroke();
      }
      if (z >= 6) {
        ctx.font = `bold ${Math.max(9, z * 0.55)}px sans-serif`;
        ctx.textAlign = "center";
        ctx.lineWidth = 3;
        ctx.strokeStyle = "rgba(8,10,18,0.85)";
        ctx.fillStyle = "#fff";
        const txt = `${Math.round(a.strength)}`;
        ctx.strokeText(txt, s.x, s.y + size * 1.3);
        ctx.fillText(txt, s.x, s.y + size * 1.3);
      }
    }

    // ---- 竜巻 ----
    for (const t of wld.tornadoes) {
      const txp = t.px + (t.x - t.px) * simAlpha;
      const typ = t.py + (t.y - t.py) * simAlpha;
      const s = this.tileToScreen(txp + 0.5, typ + 0.5);
      const rot = timeMs / 120;
      ctx.strokeStyle = "rgba(210,215,225,0.8)";
      for (let k = 0; k < 3; k++) {
        const rr = z * (0.35 + k * 0.3);
        ctx.lineWidth = Math.max(1.2, z * 0.12);
        ctx.beginPath();
        ctx.arc(s.x, s.y - k * z * 0.35, rr, rot + k, rot + k + Math.PI * 1.4);
        ctx.stroke();
      }
    }

    // ---- エフェクト ----
    this.drawFx(ctx, timeMs);

    // ---- ブラシカーソル ----
    if (state.pointer.visible) {
      const s = this.tileToScreen(Math.floor(state.pointer.tx) + 0.5, Math.floor(state.pointer.ty) + 0.5);
      ctx.strokeStyle = "rgba(217,164,65,0.9)";
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]);
      const r = state.pointer.paintTool ? (state.brushRadius + 0.5) * z : z * 0.6;
      ctx.beginPath();
      ctx.arc(s.x, s.y, Math.max(4, r), 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  private drawSelectedBorder(ctx: CanvasRenderingContext2D, selId: string, timeMs: number): void {
    const wld = this.world;
    const sel = wld.nationById(selId);
    if (!sel || !sel.alive) return;
    const cap = wld.cityById(sel.capitalCityId);
    if (!cap) return;
    const s = this.tileToScreen(cap.x + 0.5, cap.y + 0.5);
    const pulse = 1 + Math.sin(timeMs / 300) * 0.15;
    ctx.strokeStyle = "#f2e6b8";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(s.x, s.y, this.cam.zoom * 1.1 * pulse, 0, Math.PI * 2);
    ctx.stroke();
  }

  private drawDragon(ctx: CanvasRenderingContext2D, x: number, y: number, z: number, timeMs: number): void {
    const s = Math.max(8, z * 0.9);
    const flap = Math.sin(timeMs / 130) * s * 0.35;
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    ctx.beginPath();
    ctx.ellipse(x, y + s * 0.9, s * 0.8, s * 0.25, 0, 0, Math.PI * 2);
    ctx.fill();
    // 翼
    ctx.fillStyle = "#7a2f3a";
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x - s, y - s * 0.4 - flap);
    ctx.lineTo(x - s * 0.3, y + s * 0.1);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + s, y - s * 0.4 - flap);
    ctx.lineTo(x + s * 0.3, y + s * 0.1);
    ctx.closePath();
    ctx.fill();
    // 胴体
    ctx.fillStyle = "#a03a2a";
    ctx.beginPath();
    ctx.ellipse(x, y, s * 0.32, s * 0.55, 0, 0, Math.PI * 2);
    ctx.fill();
    // 目
    ctx.fillStyle = "#ffd75e";
    ctx.beginPath();
    ctx.arc(x - s * 0.1, y - s * 0.35, s * 0.07, 0, Math.PI * 2);
    ctx.arc(x + s * 0.1, y - s * 0.35, s * 0.07, 0, Math.PI * 2);
    ctx.fill();
  }

  private drawFx(ctx: CanvasRenderingContext2D, timeMs: number): void {
    const z = this.cam.zoom;
    for (const f of this.world.fx) {
      const s = this.tileToScreen(f.x + 0.5, f.y + 0.5);
      const t = f.age / f.life; // 0→1
      switch (f.kind) {
        case "explosion": {
          const r = (f.radius ?? 1.2) * z * (0.4 + t * 1.4);
          ctx.strokeStyle = `rgba(255,${Math.round(190 - t * 130)},60,${1 - t})`;
          ctx.lineWidth = Math.max(2, z * 0.25 * (1 - t));
          ctx.beginPath();
          ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
          ctx.stroke();
          if (t < 0.4) {
            ctx.fillStyle = `rgba(255,240,180,${0.8 - t * 2})`;
            ctx.beginPath();
            ctx.arc(s.x, s.y, r * 0.5, 0, Math.PI * 2);
            ctx.fill();
          }
          break;
        }
        case "lightning": {
          if (t < 0.6) {
            ctx.strokeStyle = `rgba(255,255,220,${1 - t})`;
            ctx.lineWidth = Math.max(2, z * 0.18);
            ctx.beginPath();
            let px = s.x;
            let py = s.y - Math.max(120, z * 14);
            ctx.moveTo(px, py);
            const segs = 6;
            for (let k = 1; k <= segs; k++) {
              px = s.x + (hash2(f.x * 3 + k, f.y, f.id ?? 1) - 0.5) * z * 2 * (1 - k / segs);
              py = s.y - Math.max(120, z * 14) * (1 - k / segs);
              ctx.lineTo(px, py);
            }
            ctx.lineTo(s.x, s.y);
            ctx.stroke();
            ctx.fillStyle = `rgba(255,255,255,${0.9 - t})`;
            ctx.beginPath();
            ctx.arc(s.x, s.y, z * 0.5, 0, Math.PI * 2);
            ctx.fill();
          }
          break;
        }
        case "meteor": {
          if (t < 0.5) {
            const p = t / 0.5;
            const sx = s.x + (1 - p) * Math.max(200, z * 20);
            const sy = s.y - (1 - p) * Math.max(260, z * 26);
            ctx.strokeStyle = `rgba(255,180,80,0.9)`;
            ctx.lineWidth = Math.max(3, z * 0.3);
            ctx.beginPath();
            ctx.moveTo(sx, sy);
            ctx.lineTo(sx + z, sy - z * 1.3);
            ctx.stroke();
            ctx.fillStyle = "#ffe9b0";
            ctx.beginPath();
            ctx.arc(sx, sy, Math.max(3, z * 0.35), 0, Math.PI * 2);
            ctx.fill();
          }
          break;
        }
        case "heal": {
          ctx.fillStyle = `rgba(140,230,140,${1 - t})`;
          for (let k = 0; k < 5; k++) {
            const a = hash2(k, f.x, f.y) * Math.PI * 2;
            const rr = (f.radius ?? 1.5) * z * (0.3 + hash2(k, f.y, f.x) * 0.7);
            ctx.beginPath();
            ctx.arc(s.x + Math.cos(a) * rr, s.y + Math.sin(a) * rr - t * z * 1.5, Math.max(1.5, z * 0.1), 0, Math.PI * 2);
            ctx.fill();
          }
          break;
        }
        case "smoke": {
          ctx.fillStyle = `rgba(90,90,100,${0.5 * (1 - t)})`;
          for (let k = 0; k < 3; k++) {
            ctx.beginPath();
            ctx.arc(
              s.x + (hash2(k, f.x, f.y) - 0.5) * z,
              s.y - t * z * 4 - k * z * 0.5,
              z * (0.3 + t * 0.5),
              0,
              Math.PI * 2
            );
            ctx.fill();
          }
          break;
        }
        case "battle": {
          const alpha = 1 - t;
          ctx.font = `${Math.max(12, z * 0.9)}px sans-serif`;
          ctx.textAlign = "center";
          ctx.globalAlpha = alpha;
          ctx.fillText("⚔️", s.x, s.y - t * z);
          ctx.globalAlpha = 1;
          break;
        }
        case "quake": {
          ctx.strokeStyle = `rgba(150,110,70,${1 - t})`;
          ctx.lineWidth = 2;
          for (let k = 0; k < 3; k++) {
            ctx.beginPath();
            ctx.arc(s.x, s.y, (f.radius ?? 3) * z * (t + k * 0.3), 0, Math.PI * 2);
            ctx.stroke();
          }
          break;
        }
        case "spark": {
          ctx.strokeStyle = `rgba(255,215,90,${1 - t})`;
          ctx.lineWidth = 2;
          const r = z * (0.4 + t * 0.8);
          ctx.beginPath();
          ctx.moveTo(s.x - r, s.y);
          ctx.lineTo(s.x + r, s.y);
          ctx.moveTo(s.x, s.y - r);
          ctx.lineTo(s.x, s.y + r);
          ctx.stroke();
          break;
        }
        case "tornado":
          break;
      }
    }
  }

  // ============================================================
  // ミニマップ
  // ============================================================
  drawMinimap(mm: HTMLCanvasElement): void {
    const ctx = mm.getContext("2d")!;
    const w = mm.width;
    const h = mm.height;
    ctx.imageSmoothingEnabled = true;
    ctx.fillStyle = "#0a0e18";
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(this.terrainLayer, 0, 0, w, h);
    ctx.globalAlpha = 0.65;
    ctx.drawImage(this.ownerLayer, 0, 0, w, h);
    ctx.globalAlpha = 1;
    // ビューポート枠
    const cw = this.canvas.clientWidth;
    const ch = this.canvas.clientHeight;
    const tl = this.screenToTile(0, 0);
    const br = this.screenToTile(cw, ch);
    const sx = (tl.tx / this.world.width) * w;
    const sy = (tl.ty / this.world.height) * h;
    const sw = ((br.tx - tl.tx) / this.world.width) * w;
    const sh = ((br.ty - tl.ty) / this.world.height) * h;
    ctx.strokeStyle = "#f2e6b8";
    ctx.lineWidth = 1.5;
    ctx.strokeRect(Math.max(0, sx), Math.max(0, sy), Math.min(w, sw), Math.min(h, sh));
  }
}

export function formatNum(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 10_000) return (n / 1000).toFixed(1) + "万";
  if (n >= 1000) return (n / 1000).toFixed(1) + "k";
  return String(Math.round(n));
}
