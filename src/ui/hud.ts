import { World } from "../core/simulation";
import { formatNum } from "./renderer";
import {
  BRUSH_SIZES,
  City,
  MAP_MODE_LABEL,
  MONTH_LABEL,
  MapMode,
  R,
  T,
  TOOLS,
  TOOL_CATEGORY_LABEL,
  ToolCategory,
  ToolDef,
  ToolId,
  WorldConfig,
  seasonOf
} from "../core/types";
import { cultureById } from "../core/nameGenerator";
import { mountAd, mountInlineAd, refreshFooterAd, resetAdRotation } from "../ads";

// ============================================================
// HUD (DOM UI)
// 上部: 年月・速度・マップモード
// 下部: 神器帯 (カテゴリ + ツール + ブラシ)
// 左: ドロワー (国家 / 年代記 / 統計 / 設定)
// ============================================================

const TERRAIN_NAME: Record<number, string> = {
  [T.ocean]: "外洋",
  [T.coast]: "浅瀬",
  [T.plains]: "平原",
  [T.forest]: "森林",
  [T.jungle]: "密林",
  [T.swamp]: "湿地",
  [T.savanna]: "サバンナ",
  [T.hills]: "丘陵",
  [T.mountain]: "山岳",
  [T.desert]: "砂漠",
  [T.tundra]: "ツンドラ",
  [T.snow]: "雪原",
  [T.burnt]: "焦土",
  [T.lava]: "溶岩"
};

const RES_NAME: Record<number, string> = {
  [R.gold]: "◆ 金鉱",
  [R.iron]: "▲ 鉄鉱",
  [R.gem]: "❖ 宝石",
  [R.grain]: "🌾 穀倉",
  [R.horse]: "🐎 馬産地"
};

const SPEEDS = [0, 1, 2, 4, 8];

export interface HudCallbacks {
  onSpeedChange(speed: number): void;
  onModeChange(mode: MapMode): void;
  onToolChange(tool: ToolId): void;
  onBrushChange(radius: number): void;
  onSelectNation(id: string | null): void;
  onFocus(x: number, y: number, zoom?: number): void;
  onNewWorld(cfg: WorldConfig): void;
  onSave(): void;
  onLoad(): void;
  onToggleLabels(v: boolean): void;
  onToggleUnits(v: boolean): void;
  onMinimapClick(fx: number, fy: number): void;
}

type DrawerTab = "nations" | "chronicle" | "stats" | "settings";

const el = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls?: string,
  html?: string
): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
};

export class Hud {
  private world: World;
  private cb: HudCallbacks;

  private timeChip!: HTMLElement;
  private worldChip!: HTMLElement;
  private speedBtns: HTMLButtonElement[] = [];
  private modeBtns = new Map<MapMode, HTMLButtonElement>();
  private catBtns = new Map<ToolCategory, HTMLButtonElement>();
  private toolGrid!: HTMLElement;
  private toolDesc!: HTMLElement;
  private brushRow!: HTMLElement;
  private brushBtns: HTMLButtonElement[] = [];
  private drawer!: HTMLElement;
  private drawerBody!: HTMLElement;
  private drawerTabBtns = new Map<DrawerTab, HTMLButtonElement>();
  private inspectCard!: HTMLElement;
  private toastWrap!: HTMLElement;
  private drawerFoot!: HTMLElement;
  minimap!: HTMLCanvasElement;

  private activeCategory: ToolCategory = "inspect";
  private activeTool: ToolId = "inspect";
  private brushIndex = 1;
  private drawerTab: DrawerTab = "nations";
  private drawerOpen = false;
  private detailNationId: string | null = null;
  private chronicleFilter: "all" | "war" | "founding" | "divine" | "disaster" = "all";
  private lastChronicleLen = -1;

  selectedNationId: string | null = null;
  showLabels = true;
  showUnits = true;
  speed = 1;
  mode: MapMode = "political";

  constructor(root: HTMLElement, world: World, cb: HudCallbacks) {
    this.world = world;
    this.cb = cb;
    this.build(root);
  }

  setWorld(world: World): void {
    this.world = world;
    this.selectedNationId = null;
    this.detailNationId = null;
    this.lastChronicleLen = -1;
    this.minimap.height = Math.round((this.minimap.width * world.height) / world.width);
    this.hideInspect();
    this.renderDrawerBody();
  }

  get brushRadius(): number {
    return BRUSH_SIZES[this.brushIndex];
  }
  get tool(): ToolId {
    return this.activeTool;
  }
  get toolDef(): ToolDef {
    return TOOLS.find((t) => t.id === this.activeTool)!;
  }

  // ============================================================
  // 構築
  // ============================================================
  private build(root: HTMLElement): void {
    // ---------- 上部バー ----------
    const top = el("div", "topbar");

    const menuBtn = el("button", "icon-btn", "☰");
    menuBtn.title = "メニュー (Tab)";
    menuBtn.onclick = () => this.toggleDrawer();
    top.appendChild(menuBtn);

    this.timeChip = el("div", "chip time-chip");
    top.appendChild(this.timeChip);

    this.worldChip = el("div", "chip world-chip");
    top.appendChild(this.worldChip);

    const spacer = el("div", "spacer");
    top.appendChild(spacer);

    // マップモード
    const modeSeg = el("div", "segmented modes");
    (Object.keys(MAP_MODE_LABEL) as MapMode[]).forEach((m) => {
      const b = el("button", "seg-btn", MAP_MODE_LABEL[m]);
      b.onclick = () => this.setMode(m);
      modeSeg.appendChild(b);
      this.modeBtns.set(m, b);
    });
    top.appendChild(modeSeg);

    // 速度
    const speedGroup = el("div", "segmented speed-seg");
    SPEEDS.forEach((s) => {
      const b = el("button", "seg-btn", s === 0 ? "⏸" : `×${s}`);
      b.title = s === 0 ? "一時停止 (Space)" : `${s}倍速`;
      b.onclick = () => this.setSpeed(s);
      speedGroup.appendChild(b);
      this.speedBtns.push(b);
    });
    top.appendChild(speedGroup);
    root.appendChild(top);

    // ---------- ミニマップ ----------
    const mmWrap = el("div", "minimap-wrap");
    this.minimap = el("canvas", "minimap");
    this.minimap.width = 168;
    this.minimap.height = Math.round((168 * this.world.height) / this.world.width);
    this.minimap.addEventListener("pointerdown", (ev) => {
      const r = this.minimap.getBoundingClientRect();
      this.cb.onMinimapClick((ev.clientX - r.left) / r.width, (ev.clientY - r.top) / r.height);
    });
    mmWrap.appendChild(this.minimap);
    root.appendChild(mmWrap);

    // ---------- 検分カード ----------
    this.inspectCard = el("div", "inspect-card hidden");
    root.appendChild(this.inspectCard);

    // ---------- トースト ----------
    this.toastWrap = el("div", "toast-wrap");
    root.appendChild(this.toastWrap);

    // ---------- 神器帯 (下部ツールベルト) ----------
    const belt = el("div", "godbelt");

    const catRow = el("div", "cat-row");
    (Object.keys(TOOL_CATEGORY_LABEL) as ToolCategory[]).forEach((c) => {
      const b = el("button", "cat-btn", TOOL_CATEGORY_LABEL[c]);
      b.onclick = () => {
        this.activeCategory = c;
        this.renderToolGrid();
        this.syncCategories();
      };
      catRow.appendChild(b);
      this.catBtns.set(c, b);
    });
    belt.appendChild(catRow);

    this.toolGrid = el("div", "tool-grid");
    belt.appendChild(this.toolGrid);

    const bottomRow = el("div", "belt-bottom");
    this.toolDesc = el("div", "tool-desc");
    bottomRow.appendChild(this.toolDesc);

    this.brushRow = el("div", "brush-row");
    const brushLabel = el("span", "brush-label", "筆");
    this.brushRow.appendChild(brushLabel);
    BRUSH_SIZES.forEach((r, i) => {
      const b = el("button", "brush-btn");
      const dot = el("span", "brush-dot");
      const px = 6 + i * 5;
      dot.style.width = `${px}px`;
      dot.style.height = `${px}px`;
      b.appendChild(dot);
      b.title = r === 0 ? "1タイル" : `半径${r}`;
      b.onclick = () => {
        this.brushIndex = i;
        this.syncBrush();
        this.cb.onBrushChange(this.brushRadius);
      };
      this.brushRow.appendChild(b);
      this.brushBtns.push(b);
    });
    bottomRow.appendChild(this.brushRow);
    belt.appendChild(bottomRow);
    root.appendChild(belt);

    // ---------- ドロワー ----------
    this.drawer = el("div", "drawer");
    const dHead = el("div", "drawer-head");
    const tabs: [DrawerTab, string][] = [
      ["nations", "国家"],
      ["chronicle", "年代記"],
      ["stats", "統計"],
      ["settings", "設定"]
    ];
    const tabRow = el("div", "drawer-tabs");
    tabs.forEach(([id, label]) => {
      const b = el("button", "dtab", label);
      b.onclick = () => {
        this.drawerTab = id;
        this.detailNationId = null;
        this.syncDrawerTabs();
        this.renderDrawerBody();
        refreshFooterAd(this.drawerFoot, id);
      };
      tabRow.appendChild(b);
      this.drawerTabBtns.set(id, b);
    });
    dHead.appendChild(tabRow);
    const closeBtn = el("button", "icon-btn drawer-close", "✕");
    closeBtn.onclick = () => this.toggleDrawer(false);
    dHead.appendChild(closeBtn);
    this.drawer.appendChild(dHead);

    this.drawerBody = el("div", "drawer-body");
    this.drawer.appendChild(this.drawerBody);

    // 広告はこのメニューの中だけに出す。地図やツールベルトには重ねない。
    this.drawerFoot = el("div", "drawer-foot is-empty");
    this.drawer.appendChild(this.drawerFoot);
    root.appendChild(this.drawer);

    this.syncCategories();
    this.renderToolGrid();
    this.syncBrush();
    this.syncSpeed();
    this.syncMode();
    this.syncDrawerTabs();
    this.renderDrawerBody();
  }

  // ============================================================
  // ツールベルト
  // ============================================================
  private renderToolGrid(): void {
    this.toolGrid.innerHTML = "";
    const tools = TOOLS.filter((t) => t.category === this.activeCategory);
    for (const t of tools) {
      const b = el("button", "tool-btn");
      b.innerHTML = `<span class="tool-ico">${t.icon}</span><span class="tool-lbl">${t.label}</span>`;
      if (t.needsNation) b.classList.add("needs-nation");
      b.onclick = () => this.setTool(t.id);
      if (t.id === this.activeTool) b.classList.add("active");
      this.toolGrid.appendChild(b);
    }
    this.updateToolDesc();
  }

  setTool(id: ToolId): void {
    this.activeTool = id;
    const def = TOOLS.find((t) => t.id === id)!;
    if (def.category !== this.activeCategory) {
      this.activeCategory = def.category;
      this.syncCategories();
    }
    this.renderToolGrid();
    this.cb.onToolChange(id);
  }

  private updateToolDesc(): void {
    const def = this.toolDef;
    const needs = def.needsNation
      ? this.selectedNationId
        ? `<span class="ok">対象: ${this.world.nationById(this.selectedNationId)?.name ?? "?"}</span>`
        : `<span class="warn">要: 国家を選択</span>`
      : "";
    this.toolDesc.innerHTML = `<b>${def.icon} ${def.label}</b> — ${def.desc} ${needs}`;
    this.brushRow.style.visibility = def.usesBrush ? "visible" : "hidden";
  }

  private syncCategories(): void {
    this.catBtns.forEach((b, c) => b.classList.toggle("active", c === this.activeCategory));
  }

  private syncBrush(): void {
    this.brushBtns.forEach((b, i) => b.classList.toggle("active", i === this.brushIndex));
  }

  cycleBrush(): void {
    this.brushIndex = (this.brushIndex + 1) % BRUSH_SIZES.length;
    this.syncBrush();
    this.cb.onBrushChange(this.brushRadius);
  }

  // ============================================================
  // 速度・モード
  // ============================================================
  setSpeed(s: number): void {
    this.speed = s;
    this.syncSpeed();
    this.cb.onSpeedChange(s);
  }
  togglePause(): void {
    this.setSpeed(this.speed === 0 ? 1 : 0);
  }
  private syncSpeed(): void {
    this.speedBtns.forEach((b, i) => b.classList.toggle("active", SPEEDS[i] === this.speed));
  }

  setMode(m: MapMode): void {
    this.mode = m;
    this.syncMode();
    this.cb.onModeChange(m);
  }
  private syncMode(): void {
    this.modeBtns.forEach((b, m) => b.classList.toggle("active", m === this.mode));
  }

  // ============================================================
  // ドロワー
  // ============================================================
  toggleDrawer(force?: boolean): void {
    const was = this.drawerOpen;
    this.drawerOpen = force ?? !this.drawerOpen;
    this.drawer.classList.toggle("open", this.drawerOpen);
    if (this.drawerOpen) {
      this.renderDrawerBody();
      // 開いた瞬間だけ広告を用意する (開いている間は固定して切り替えない)
      if (!was) refreshFooterAd(this.drawerFoot, this.drawerTab);
    }
  }

  private syncDrawerTabs(): void {
    this.drawerTabBtns.forEach((b, t) => b.classList.toggle("active", t === this.drawerTab));
  }

  openNationDetail(id: string): void {
    this.detailNationId = id;
    this.drawerTab = "nations";
    this.syncDrawerTabs();
    this.toggleDrawer(true);
    this.renderDrawerBody();
  }

  private renderDrawerBody(): void {
    if (!this.drawerOpen) return;
    // 定期更新で読んでいる場所が飛ばないよう、スクロール位置を保つ
    const keepScroll = this.drawerBody.scrollTop;
    // タブごとに違う広告から始める
    resetAdRotation(this.drawerTab + (this.detailNationId ? ":detail" : ""));
    this.drawerBody.innerHTML = "";
    switch (this.drawerTab) {
      case "nations":
        this.detailNationId ? this.renderNationDetail() : this.renderNationList();
        break;
      case "chronicle":
        this.renderChronicle();
        break;
      case "stats":
        this.renderStats();
        break;
      case "settings":
        this.renderSettings();
        break;
    }
    if (keepScroll > 0) this.drawerBody.scrollTop = keepScroll;
  }

  private renderNationList(): void {
    const list = this.world
      .aliveNations()
      .slice()
      .sort((a, b) => b.population - a.population);
    const head = el("div", "list-head", `現存 ${list.length}ヶ国 / 総人口 ${formatNum(this.world.worldPopulation())}`);
    this.drawerBody.appendChild(head);
    if (list.length === 0) {
      this.drawerBody.appendChild(el("p", "empty", "世界に国家は存在しない。<br>🧑‍🌾入植者や🏰建国で文明を興そう。"));
      return;
    }
    for (const n of list) {
      const row = el("button", "nation-row");
      if (n.id === this.selectedNationId) row.classList.add("selected");
      const atWar = Object.values(n.relations).some((r) => r.status === "war");
      row.innerHTML = `
        <span class="swatch" style="background:${n.color};border-color:${n.colorDark}"></span>
        <span class="nrow-main">
          <span class="nrow-name">${n.name}${atWar ? ' <span class="tag war">戦争中</span>' : ""}</span>
          <span class="nrow-sub">人口 ${formatNum(n.population)} ・ 都市 ${n.cityIds.length} ・ 領土 ${n.territoryCount}</span>
        </span>
        <span class="nrow-tech">Lv${n.tech.toFixed(1)}</span>`;
      row.onclick = () => {
        this.selectedNationId = n.id;
        this.cb.onSelectNation(n.id);
        this.openNationDetail(n.id);
      };
      this.drawerBody.appendChild(row);
    }
    // 一覧が長いときだけ途中に1枠挟む
    mountInlineAd(this.drawerBody, "nations-inline", 7);
    mountAd(this.drawerBody, "nations-bottom");
  }

  private renderNationDetail(): void {
    const n = this.world.nationById(this.detailNationId);
    if (!n) {
      this.detailNationId = null;
      this.renderNationList();
      return;
    }
    const back = el("button", "back-btn", "← 一覧へ");
    back.onclick = () => {
      this.detailNationId = null;
      this.renderDrawerBody();
    };
    this.drawerBody.appendChild(back);

    const king = this.world.people.get(n.kingId ?? "");
    const heir = this.world.people.get(n.heirId ?? "");
    const culture = cultureById(n.cultureId);
    const cap = this.world.cityById(n.capitalCityId);

    const head = el("div", "detail-head");
    head.innerHTML = `
      <div class="detail-title" style="border-color:${n.color}">
        <h2>${n.name}</h2>
        <div class="detail-sub">${culture.label} ・ ${n.dynasty} ・ ${n.foundedYear}年建国${
      n.alive ? "" : ` / ${n.fallYear}年滅亡`
    }</div>
      </div>`;
    this.drawerBody.appendChild(head);

    if (king) {
      const title = culture.kingTitle[king.gender];
      const k = el("div", "king-card");
      k.innerHTML = `
        <div class="king-name">${title} ${king.name}${king.epithet ? `<span class="epithet">「${king.epithet}」</span>` : ""}</div>
        <div class="king-meta">${king.age}歳 ・ 在位${this.world.year - (king.reignStart ?? this.world.year)}年 ${
        heir ? `・ 世継 ${heir.name} (${heir.age}歳)` : "・ <span class=\"warn\">世継なし</span>"
      }</div>
        <div class="traits">
          ${this.traitBar("英知", king.traits.wisdom)}
          ${this.traitBar("野心", king.traits.ambition)}
          ${this.traitBar("魅力", king.traits.charisma)}
        </div>`;
      this.drawerBody.appendChild(k);
    }

    const grid = el("div", "stat-grid");
    const cells: [string, string][] = [
      ["人口", formatNum(n.population)],
      ["国庫", `${Math.round(n.treasury)}G`],
      ["兵力", formatNum(Math.round(n.military))],
      ["技術", n.tech.toFixed(2)],
      ["安定度", `${Math.round(n.stability)}%`],
      ["戦争疲弊", `${Math.round(n.warExhaustion)}%`],
      ["領土", `${n.territoryCount}`],
      ["軍団", `${n.armyIds.length}`]
    ];
    for (const [k, v] of cells) {
      const c = el("div", "stat-cell");
      c.innerHTML = `<span class="sc-label">${k}</span><span class="sc-value">${v}</span>`;
      grid.appendChild(c);
    }
    this.drawerBody.appendChild(grid);
    if (n.blessedYears > 0) this.drawerBody.appendChild(el("div", "banner bless", `✨ 神の祝福 (残り${n.blessedYears}年)`));
    if (n.cursedYears > 0) this.drawerBody.appendChild(el("div", "banner curse", `🕯 呪詛 (残り${n.cursedYears}年)`));

    // 都市
    this.drawerBody.appendChild(el("h3", "sec-title", `都市 (${n.cityIds.length})`));
    const cityWrap = el("div", "city-list");
    const cities = n.cityIds
      .map((id) => this.world.cityById(id))
      .filter((c): c is City => !!c)
      .sort((a, b) => b.population - a.population);
    for (const c of cities) {
      const b = el("button", "city-row");
      b.innerHTML = `
        <span class="crow-name">${c.isCapital ? "★" : "・"}${c.name}${c.siegeBy ? ' <span class="tag war">包囲</span>' : ""}${
        c.plagueTicks > 0 ? ' <span class="tag plague">疫病</span>' : ""
      }</span>
        <span class="crow-sub">${formatNum(c.population)}人 ・ 繁栄${Math.round(c.prosperity)} ・ 城壁${Math.round(
        c.fortification
      )} ・ 不穏${Math.round(c.unrest)}</span>`;
      b.onclick = () => this.cb.onFocus(c.x, c.y, 16);
      cityWrap.appendChild(b);
    }
    this.drawerBody.appendChild(cityWrap);

    // 外交
    const rels = Object.entries(n.relations)
      .map(([id, r]) => ({ other: this.world.nationById(id), r }))
      .filter((x) => x.other && x.other.alive)
      .sort((a, b) => b.r.score - a.r.score);
    this.drawerBody.appendChild(el("h3", "sec-title", "外交"));
    if (rels.length === 0) {
      this.drawerBody.appendChild(el("p", "empty", "外交関係なし"));
    } else {
      const rw = el("div", "rel-list");
      for (const { other, r } of rels) {
        const row = el("button", "rel-row");
        const statusLabel =
          r.status === "war" ? "戦争" : r.status === "alliance" ? "同盟" : r.status === "truce" ? "休戦" : "平和";
        row.innerHTML = `
          <span class="swatch small" style="background:${other!.color}"></span>
          <span class="rel-name">${other!.name}</span>
          <span class="tag ${r.status}">${statusLabel}</span>
          <span class="rel-score ${r.score < 0 ? "neg" : "pos"}">${r.score > 0 ? "+" : ""}${Math.round(r.score)}</span>`;
        row.onclick = () => this.openNationDetail(other!.id);
        rw.appendChild(row);
      }
      this.drawerBody.appendChild(rw);
    }

    // 推移グラフ
    if (n.stats.length > 2) {
      this.drawerBody.appendChild(el("h3", "sec-title", "人口の推移"));
      const cv = el("canvas", "spark");
      cv.width = 300;
      cv.height = 84;
      this.drawerBody.appendChild(cv);
      drawSpark(
        cv,
        n.stats.map((s) => s.pop),
        n.color
      );
    }

    // アクション
    const actions = el("div", "detail-actions");
    const focusBtn = el("button", "act-btn", "🎯 首都へ移動");
    focusBtn.onclick = () => {
      if (cap) this.cb.onFocus(cap.x, cap.y, 14);
    };
    actions.appendChild(focusBtn);
    const selBtn = el("button", "act-btn", "👑 この国を選択");
    selBtn.onclick = () => {
      this.selectedNationId = n.id;
      this.cb.onSelectNation(n.id);
      this.updateToolDesc();
      this.toast(`${n.name}を選択しました`, "info");
    };
    actions.appendChild(selBtn);
    this.drawerBody.appendChild(actions);

    // その国の年代記
    const evs = this.world.events.filter((e) => e.nationIds.includes(n.id)).slice(-40).reverse();
    if (evs.length > 0) {
      this.drawerBody.appendChild(el("h3", "sec-title", "この国の記録"));
      const ul = el("div", "chron-list");
      for (const e of evs) {
        const li = el("div", `chron-item ${e.category}`);
        li.innerHTML = `<span class="cy">${e.year}年</span><span class="ct">${e.text}</span>`;
        ul.appendChild(li);
      }
      this.drawerBody.appendChild(ul);
    }
    mountAd(this.drawerBody, "detail-bottom", "detail-end");
  }

  private traitBar(label: string, v: number): string {
    return `<div class="trait"><span>${label}</span><span class="tbar"><i style="width:${v}%"></i></span><b>${v}</b></div>`;
  }

  private renderChronicle(): void {
    const filters: [typeof this.chronicleFilter, string][] = [
      ["all", "すべて"],
      ["war", "戦争"],
      ["founding", "興亡"],
      ["divine", "神託"],
      ["disaster", "災厄"]
    ];
    const fr = el("div", "filter-row");
    for (const [id, label] of filters) {
      const b = el("button", "filter-btn", label);
      if (id === this.chronicleFilter) b.classList.add("active");
      b.onclick = () => {
        this.chronicleFilter = id;
        this.renderDrawerBody();
      };
      fr.appendChild(b);
    }
    this.drawerBody.appendChild(fr);

    const evs = this.world.events
      .filter((e) => this.chronicleFilter === "all" || e.category === this.chronicleFilter)
      .slice(-160)
      .reverse();
    if (evs.length === 0) {
      this.drawerBody.appendChild(el("p", "empty", "まだ何も起きていない。"));
      return;
    }
    const wrap = el("div", "chron-list");
    for (const e of evs) {
      const li = el("div", `chron-item ${e.category}${e.importance === 2 ? " major" : ""}`);
      li.innerHTML = `<span class="cy">${e.year}年</span><span class="ct">${e.text}</span>`;
      if (e.x !== undefined && e.y !== undefined) {
        li.classList.add("clickable");
        li.onclick = () => this.cb.onFocus(e.x!, e.y!, 14);
      }
      wrap.appendChild(li);
    }
    mountInlineAd(wrap, "chron-inline", 10);
    this.drawerBody.appendChild(wrap);
    mountAd(this.drawerBody, "chron-bottom");
    this.lastChronicleLen = this.world.events.length;
  }

  private renderStats(): void {
    const w = this.world;
    const head = el("div", "list-head", `${w.year}年 ${MONTH_LABEL[w.month]}`);
    this.drawerBody.appendChild(head);

    const grid = el("div", "stat-grid");
    const armies = [...w.armies.values()];
    const cells: [string, string][] = [
      ["現存国家", `${w.aliveNations().length}`],
      ["滅亡国家", `${w.nations.filter((n) => !n.alive).length}`],
      ["総人口", formatNum(w.worldPopulation())],
      ["都市数", `${w.cities.filter((c) => c.population > 0).length}`],
      ["進軍中の軍", `${armies.length}`],
      ["総兵力", formatNum(armies.reduce((s, a) => s + a.strength, 0))],
      ["戦争数", `${this.countWars()}`],
      ["炎上タイル", `${w.burningTiles.size}`]
    ];
    for (const [k, v] of cells) {
      const c = el("div", "stat-cell");
      c.innerHTML = `<span class="sc-label">${k}</span><span class="sc-value">${v}</span>`;
      grid.appendChild(c);
    }
    this.drawerBody.appendChild(grid);

    if (w.worldStats.length > 2) {
      this.drawerBody.appendChild(el("h3", "sec-title", "世界人口の推移"));
      const cv = el("canvas", "spark");
      cv.width = 300;
      cv.height = 90;
      this.drawerBody.appendChild(cv);
      drawSpark(
        cv,
        w.worldStats.map((s) => s.pop),
        "#d9a441"
      );
      this.drawerBody.appendChild(el("h3", "sec-title", "国家数の推移"));
      const cv2 = el("canvas", "spark");
      cv2.width = 300;
      cv2.height = 70;
      this.drawerBody.appendChild(cv2);
      drawSpark(
        cv2,
        w.worldStats.map((s) => s.nations),
        "#6fae5c"
      );
    }

    // 勢力ランキング
    this.drawerBody.appendChild(el("h3", "sec-title", "勢力ランキング (領土)"));
    const rank = w.aliveNations().sort((a, b) => b.territoryCount - a.territoryCount).slice(0, 10);
    const max = rank[0]?.territoryCount || 1;
    const rw = el("div", "rank-list");
    for (const n of rank) {
      const row = el("button", "rank-row");
      row.innerHTML = `
        <span class="rank-name">${n.name}</span>
        <span class="rank-bar"><i style="width:${(n.territoryCount / max) * 100}%;background:${n.color}"></i></span>
        <span class="rank-val">${n.territoryCount}</span>`;
      row.onclick = () => this.openNationDetail(n.id);
      rw.appendChild(row);
    }
    this.drawerBody.appendChild(rw);
    mountAd(this.drawerBody, "stats-bottom");
  }

  private countWars(): number {
    const seen = new Set<string>();
    for (const n of this.world.aliveNations()) {
      for (const [id, r] of Object.entries(n.relations)) {
        if (r.status === "war") {
          const key = [n.id, id].sort().join("|");
          seen.add(key);
        }
      }
    }
    return seen.size;
  }

  private renderSettings(): void {
    const cfg = this.world.config;
    this.drawerBody.appendChild(el("h3", "sec-title", "新しい世界を創る"));

    const form = el("div", "form");
    const sizeSel = el("select", "input");
    const sizes = [
      { label: "小 (96×64) 動作軽快", w: 96, h: 64 },
      { label: "中 (140×92) 標準", w: 140, h: 92 },
      { label: "大 (192×124) 重い", w: 192, h: 124 }
    ];
    sizes.forEach((s, i) => {
      const o = el("option", undefined, s.label);
      o.value = String(i);
      if (s.w === cfg.width) o.selected = true;
      sizeSel.appendChild(o);
    });
    form.appendChild(this.field("世界の大きさ", sizeSel));

    const seedInput = el("input", "input") as HTMLInputElement;
    seedInput.type = "number";
    seedInput.value = String(cfg.seed);
    const seedWrap = el("div", "seed-wrap");
    seedWrap.appendChild(seedInput);
    const diceBtn = el("button", "act-btn small", "🎲");
    diceBtn.onclick = () => (seedInput.value = String(Math.floor(Math.random() * 999999)));
    seedWrap.appendChild(diceBtn);
    form.appendChild(this.field("シード値", seedWrap));

    const landInput = el("input", "range") as HTMLInputElement;
    landInput.type = "range";
    landInput.min = "20";
    landInput.max = "75";
    landInput.value = String(Math.round(cfg.landRatio * 100));
    const landVal = el("span", "range-val", `${landInput.value}%`);
    landInput.oninput = () => (landVal.textContent = `${landInput.value}%`);
    const landWrap = el("div", "range-wrap");
    landWrap.appendChild(landInput);
    landWrap.appendChild(landVal);
    form.appendChild(this.field("陸地の割合", landWrap));

    const nationInput = el("input", "range") as HTMLInputElement;
    nationInput.type = "range";
    nationInput.min = "0";
    nationInput.max = "24";
    nationInput.value = String(cfg.nationCount);
    const nationVal = el("span", "range-val", `${nationInput.value}ヶ国`);
    nationInput.oninput = () => (nationVal.textContent = `${nationInput.value}ヶ国`);
    const nationWrap = el("div", "range-wrap");
    nationWrap.appendChild(nationInput);
    nationWrap.appendChild(nationVal);
    form.appendChild(this.field("初期国家数", nationWrap));

    const genBtn = el("button", "act-btn primary", "🌍 この設定で世界を創造する");
    genBtn.onclick = () => {
      const s = sizes[Number(sizeSel.value)];
      this.cb.onNewWorld({
        width: s.w,
        height: s.h,
        seed: Number(seedInput.value) || Math.floor(Math.random() * 999999),
        nationCount: Number(nationInput.value),
        landRatio: Number(landInput.value) / 100
      });
    };
    form.appendChild(genBtn);
    this.drawerBody.appendChild(form);

    this.drawerBody.appendChild(el("h3", "sec-title", "セーブ / ロード"));
    const saveRow = el("div", "detail-actions");
    const sb = el("button", "act-btn", "💾 保存");
    sb.onclick = () => this.cb.onSave();
    const lb = el("button", "act-btn", "📂 読込");
    lb.onclick = () => this.cb.onLoad();
    saveRow.appendChild(sb);
    saveRow.appendChild(lb);
    this.drawerBody.appendChild(saveRow);
    this.drawerBody.appendChild(
      el("p", "hint", "※ 30秒ごとに自動保存されます。ブラウザのデータを消すと失われます。")
    );

    this.drawerBody.appendChild(el("h3", "sec-title", "表示"));
    const t1 = this.toggle("地名・国名を表示", this.showLabels, (v) => {
      this.showLabels = v;
      this.cb.onToggleLabels(v);
    });
    const t2 = this.toggle("住民・動物を表示", this.showUnits, (v) => {
      this.showUnits = v;
      this.cb.onToggleUnits(v);
    });
    this.drawerBody.appendChild(t1);
    this.drawerBody.appendChild(t2);

    this.drawerBody.appendChild(el("h3", "sec-title", "操作方法"));
    this.drawerBody.appendChild(
      el(
        "div",
        "help",
        `
      <p><b>ドラッグ</b>: 地図を移動 / 塗りツール選択中はその場に適用</p>
      <p><b>ホイール・ピンチ</b>: 拡大縮小</p>
      <p><b>🔍検分</b>でタイルや都市をクリックすると詳細が出て、その国が「選択中の国」になります。<br>
      🏘築城・🚩領土授与・💰金貨の雨などは選択中の国に作用します。</p>
      <p><b>キー</b>: Space=一時停止 / 1〜5=速度 / Q=検分 / W=移動 / B=筆の太さ / M=マップモード / Tab=メニュー</p>`
      )
    );
    mountAd(this.drawerBody, "settings-bottom");
  }

  private field(label: string, input: HTMLElement): HTMLElement {
    const f = el("label", "field");
    f.appendChild(el("span", "field-label", label));
    f.appendChild(input);
    return f;
  }

  private toggle(label: string, value: boolean, onChange: (v: boolean) => void): HTMLElement {
    const wrap = el("label", "toggle");
    const cb = el("input") as HTMLInputElement;
    cb.type = "checkbox";
    cb.checked = value;
    cb.onchange = () => onChange(cb.checked);
    wrap.appendChild(cb);
    wrap.appendChild(el("span", undefined, label));
    return wrap;
  }

  // ============================================================
  // 検分カード
  // ============================================================
  showInspect(tx: number, ty: number): void {
    const w = this.world;
    if (!w.inBounds(tx, ty)) return;
    const i = w.idx(tx, ty);
    const city = w.cityAtTile(tx, ty);
    const nation = w.nationAtTile(tx, ty);
    const t = w.terrain[i];
    const res = w.resource[i];

    let html = `<button class="card-close">✕</button>`;
    if (city) {
      const cn = w.nationById(city.nationId);
      html += `
        <div class="card-title">🏘 ${city.name}${city.isCapital ? " <span class='tag cap'>首都</span>" : ""}</div>
        <div class="card-sub" style="color:${cn?.color ?? "#ccc"}">${cn?.name ?? "無所属"} ・ ${city.foundedYear}年建設</div>
        <div class="card-rows">
          <span>人口</span><b>${formatNum(city.population)}</b>
          <span>繁栄</span><b>${Math.round(city.prosperity)}</b>
          <span>城壁</span><b>${Math.round(city.fortification)}</b>
          <span>不穏</span><b>${Math.round(city.unrest)}</b>
        </div>`;
      if (city.siegeBy) {
        const bes = w.nationById(city.siegeBy);
        html += `<div class="card-alert war">⚔️ ${bes?.name ?? "敵軍"}に包囲されている (${Math.round(
          city.siegeProgress
        )}%)</div>`;
      }
      if (city.plagueTicks > 0) html += `<div class="card-alert plague">☠ 疫病が蔓延している</div>`;
    } else {
      html += `<div class="card-title">${TERRAIN_NAME[t] ?? "土地"}</div>`;
      html += `<div class="card-sub" style="color:${nation?.color ?? "#8b93a7"}">${
        nation ? nation.name + "領" : "無主の地"
      } (${tx}, ${ty})</div>`;
      html += `<div class="card-rows">
        <span>標高</span><b>${(w.elevation[i] * 100).toFixed(0)}</b>
        <span>湿潤</span><b>${(w.moisture[i] * 100).toFixed(0)}</b>
        <span>肥沃</span><b>${(w.fertility[i] * 100).toFixed(0)}</b>
        <span>河川</span><b>${w.river[i] ? "あり" : "—"}</b>
      </div>`;
      if (res !== R.none) html += `<div class="card-res">${RES_NAME[res]}</div>`;
      if (w.burn[i] > 0) html += `<div class="card-alert war">🔥 燃えている</div>`;
    }

    if (nation) {
      const king = w.people.get(nation.kingId ?? "");
      const culture = cultureById(nation.cultureId);
      html += `<div class="card-nation">
        <span class="swatch small" style="background:${nation.color}"></span>
        ${king ? `${culture.kingTitle[king.gender]} ${king.name}` : "統治者不在"}
        <button class="card-link">詳細 →</button>
      </div>`;
    }

    this.inspectCard.innerHTML = html;
    this.inspectCard.classList.remove("hidden");
    (this.inspectCard.querySelector(".card-close") as HTMLElement).onclick = () => this.hideInspect();
    const link = this.inspectCard.querySelector(".card-link") as HTMLElement | null;
    if (link && nation) link.onclick = () => this.openNationDetail(nation.id);

    if (nation) {
      this.selectedNationId = nation.id;
      this.cb.onSelectNation(nation.id);
    }
    this.updateToolDesc();
  }

  hideInspect(): void {
    this.inspectCard.classList.add("hidden");
  }

  // ============================================================
  // トースト
  // ============================================================
  toast(text: string, kind: "info" | "war" | "divine" | "disaster" = "info"): void {
    const t = el("div", `toast ${kind}`, text);
    this.toastWrap.appendChild(t);
    setTimeout(() => t.classList.add("show"), 10);
    setTimeout(() => {
      t.classList.remove("show");
      setTimeout(() => t.remove(), 400);
    }, 3600);
    while (this.toastWrap.children.length > 5) this.toastWrap.removeChild(this.toastWrap.children[0]);
  }

  // ============================================================
  // 毎フレーム更新
  // ============================================================
  update(): void {
    const w = this.world;
    this.timeChip.innerHTML = `<b>${w.year}</b><span class="unit">年</span> <span class="mon">${
      MONTH_LABEL[w.month]
    }</span><span class="season">${seasonOf(w.month)}</span>`;
    this.worldChip.innerHTML = `<span>🏰 ${w.aliveNations().length}</span><span>👥 ${formatNum(
      w.worldPopulation()
    )}</span><span>⚔ ${this.countWars()}</span>`;

    if (this.drawerOpen) {
      if (this.drawerTab === "nations" || this.drawerTab === "stats") {
        // 高頻度の再構築を避けるため、値だけ差し替える簡易更新
        if (w.tick % 6 === 0) this.renderDrawerBody();
      } else if (this.drawerTab === "chronicle" && w.events.length !== this.lastChronicleLen) {
        this.renderDrawerBody();
      }
    }
  }
}

// ============================================================
// 簡易スパークライン
// ============================================================
function drawSpark(cv: HTMLCanvasElement, values: number[], color: string): void {
  const ctx = cv.getContext("2d")!;
  const w = cv.width;
  const h = cv.height;
  ctx.clearRect(0, 0, w, h);
  if (values.length < 2) return;
  const max = Math.max(...values);
  const min = Math.min(...values);
  const span = Math.max(1, max - min);
  ctx.strokeStyle = "rgba(255,255,255,0.08)";
  ctx.lineWidth = 1;
  for (let k = 0; k <= 3; k++) {
    const y = (h - 8) * (k / 3) + 4;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }
  ctx.beginPath();
  values.forEach((v, i) => {
    const x = (i / (values.length - 1)) * (w - 2) + 1;
    const y = h - 4 - ((v - min) / span) * (h - 12);
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  });
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.lineTo(w - 1, h);
  ctx.lineTo(1, h);
  ctx.closePath();
  ctx.fillStyle = color + "22";
  ctx.fill();
  ctx.fillStyle = "rgba(232,220,192,0.65)";
  ctx.font = "10px sans-serif";
  ctx.textAlign = "left";
  ctx.fillText(formatNum(max), 4, 11);
  ctx.textAlign = "right";
  ctx.fillText(formatNum(values[values.length - 1]), w - 4, 11);
}
