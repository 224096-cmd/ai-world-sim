import "./style.css";
import { World } from "./core/simulation";
import { MapRenderer, RenderState } from "./ui/renderer";
import { Hud } from "./ui/hud";
import { MapMode, ToolId, WorldConfig } from "./core/types";
import { setupPWA } from "./pwaRegister";

// ============================================================
// AI世界シミュレーター — 神の視点で見守る国家シミュレーション
// ============================================================

const SAVE_KEY = "ai-world-sim.save.v2";
const TICK_MS = 900; // 1倍速で1ヶ月進む間隔

const DEFAULT_CONFIG: WorldConfig = {
  width: 140,
  height: 92,
  seed: Math.floor(Math.random() * 999999),
  nationCount: 8,
  landRatio: 0.42
};

const app = document.getElementById("app")!;
const canvas = document.createElement("canvas");
canvas.className = "map-canvas";
app.appendChild(canvas);

const boot = document.getElementById("boot");

// ---- 世界の用意 -------------------------------------------
let world = loadWorld() ?? new World(DEFAULT_CONFIG);
const renderer = new MapRenderer(canvas, world);

const hud = new Hud(app, world, {
  onSpeedChange: (s) => {
    speed = s;
    accumulator = 0;
  },
  onModeChange: (m: MapMode) => {
    renderState.mode = m;
    renderer.invalidateMode();
  },
  onToolChange: (t: ToolId) => {
    activeTool = t;
  },
  onBrushChange: (r) => {
    renderState.brushRadius = r;
  },
  onSelectNation: (id) => {
    renderState.selectedNationId = id;
    renderer.invalidateMode();
  },
  onFocus: (x, y, zoom) => {
    renderer.centerOn(x + 0.5, y + 0.5, zoom);
  },
  onNewWorld: (cfg) => newWorld(cfg),
  onSave: () => {
    saveWorld();
    hud.toast("💾 世界を保存しました", "info");
  },
  onLoad: () => {
    const w = loadWorld();
    if (!w) {
      hud.toast("保存データが見つかりません", "disaster");
      return;
    }
    swapWorld(w);
    hud.toast("📂 保存した世界を読み込みました", "info");
  },
  onToggleLabels: (v) => (renderState.showLabels = v),
  onToggleUnits: (v) => (renderState.showUnits = v),
  onMinimapClick: (fx, fy) => renderer.centerOn(fx * world.width, fy * world.height)
});

const renderState: RenderState = {
  mode: "political",
  selectedNationId: null,
  showLabels: true,
  showUnits: true,
  brushRadius: hud.brushRadius,
  pointer: { tx: 0, ty: 0, visible: false, paintTool: false }
};

let speed = 1;
let activeTool: ToolId = "inspect";
let accumulator = 0;
let lastFrame = performance.now();
let lastToolApply = 0;

// ============================================================
// 世界の入れ替え
// ============================================================
function newWorld(cfg: WorldConfig): void {
  hud.toast("🌍 新しい世界を創造しています…", "divine");
  setTimeout(() => {
    swapWorld(new World(cfg));
    hud.toast(`世界が生まれた (シード ${cfg.seed})`, "divine");
  }, 30);
}

function swapWorld(w: World): void {
  world = w;
  renderer.setWorld(w);
  hud.setWorld(w);
  renderState.selectedNationId = null;
  world.needFullRepaint = true;
  world.notifications.length = 0;
  accumulator = 0;
}

// ============================================================
// セーブ / ロード
// ============================================================
function saveWorld(): void {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(world.toSnapshot()));
  } catch (e) {
    console.error(e);
    hud.toast("保存に失敗しました (容量不足の可能性)", "disaster");
  }
}

function loadWorld(): World | null {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    return World.fromSnapshot(JSON.parse(raw));
  } catch (e) {
    console.warn("セーブデータの読み込みに失敗:", e);
    return null;
  }
}

setInterval(() => {
  if (world.tick > 0) saveWorld();
}, 30000);
window.addEventListener("beforeunload", () => saveWorld());

// ============================================================
// 入力
// ============================================================
let dragging = false;
let dragMoved = false;
let painting = false;
let lastPointer = { x: 0, y: 0 };
const pointers = new Map<number, { x: number; y: number }>();
let pinchDist = 0;

function isPaintMode(): boolean {
  const def = hud.toolDef;
  return def.id !== "inspect" && def.id !== "pan";
}

canvas.addEventListener("pointerdown", (ev) => {
  canvas.setPointerCapture(ev.pointerId);
  pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
  if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
    dragging = false;
    painting = false;
    return;
  }
  lastPointer = { x: ev.clientX, y: ev.clientY };
  dragMoved = false;
  const def = hud.toolDef;
  if (def.paint) {
    painting = true;
    applyToolAt(ev.clientX, ev.clientY, true);
  } else {
    dragging = true;
  }
});

canvas.addEventListener("pointermove", (ev) => {
  const rect = canvas.getBoundingClientRect();
  const t = renderer.screenToTile(ev.clientX - rect.left, ev.clientY - rect.top);
  renderState.pointer.tx = t.tx;
  renderState.pointer.ty = t.ty;
  renderState.pointer.visible = true;
  renderState.pointer.paintTool = isPaintMode() && hud.toolDef.usesBrush;

  if (pointers.has(ev.pointerId)) pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });

  if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    if (pinchDist > 0) {
      const cx = (a.x + b.x) / 2 - rect.left;
      const cy = (a.y + b.y) / 2 - rect.top;
      renderer.zoomAt(cx, cy, d / pinchDist);
    }
    pinchDist = d;
    return;
  }

  if (painting) {
    applyToolAt(ev.clientX, ev.clientY, false);
  } else if (dragging) {
    const dx = ev.clientX - lastPointer.x;
    const dy = ev.clientY - lastPointer.y;
    if (Math.abs(dx) > 2 || Math.abs(dy) > 2) dragMoved = true;
    renderer.pan(dx, dy);
    lastPointer = { x: ev.clientX, y: ev.clientY };
  }
});

const endPointer = (ev: PointerEvent) => {
  pointers.delete(ev.pointerId);
  if (pointers.size < 2) pinchDist = 0;
  if (painting) {
    painting = false;
    return;
  }
  if (dragging && !dragMoved) {
    // クリック扱い
    handleClick(ev.clientX, ev.clientY);
  }
  dragging = false;
};
canvas.addEventListener("pointerup", endPointer);
canvas.addEventListener("pointercancel", endPointer);
canvas.addEventListener("pointerleave", () => (renderState.pointer.visible = false));

canvas.addEventListener(
  "wheel",
  (ev) => {
    ev.preventDefault();
    const rect = canvas.getBoundingClientRect();
    renderer.zoomAt(ev.clientX - rect.left, ev.clientY - rect.top, ev.deltaY < 0 ? 1.14 : 1 / 1.14);
  },
  { passive: false }
);

canvas.addEventListener("contextmenu", (ev) => ev.preventDefault());

function handleClick(cx: number, cy: number): void {
  const rect = canvas.getBoundingClientRect();
  const t = renderer.screenToTile(cx - rect.left, cy - rect.top);
  const tx = Math.floor(t.tx);
  const ty = Math.floor(t.ty);
  if (!world.inBounds(tx, ty)) return;
  const def = hud.toolDef;
  if (def.id === "inspect") {
    hud.showInspect(tx, ty);
  } else if (def.id !== "pan") {
    applyToolAt(cx, cy, true);
  }
}

function applyToolAt(cx: number, cy: number, force: boolean): void {
  const def = hud.toolDef;
  const now = performance.now();
  const cooldown = def.cooldownMs ?? 60;
  if (!force && now - lastToolApply < cooldown) return;
  lastToolApply = now;

  const rect = canvas.getBoundingClientRect();
  const t = renderer.screenToTile(cx - rect.left, cy - rect.top);
  const tx = Math.floor(t.tx);
  const ty = Math.floor(t.ty);
  if (!world.inBounds(tx, ty)) return;

  const brush = def.usesBrush ? hud.brushRadius : 0;
  const res = world.applyTool(activeTool, tx, ty, brush, hud.selectedNationId);
  if (res.msg) hud.toast(res.msg, res.ok ? "divine" : "disaster");
}

// ---- キーボード -------------------------------------------
window.addEventListener("keydown", (ev) => {
  if ((ev.target as HTMLElement)?.tagName === "INPUT") return;
  switch (ev.key) {
    case " ":
      ev.preventDefault();
      hud.togglePause();
      break;
    case "1":
      hud.setSpeed(0);
      break;
    case "2":
      hud.setSpeed(1);
      break;
    case "3":
      hud.setSpeed(2);
      break;
    case "4":
      hud.setSpeed(4);
      break;
    case "5":
      hud.setSpeed(8);
      break;
    case "q":
    case "Q":
      hud.setTool("inspect");
      break;
    case "w":
    case "W":
      hud.setTool("pan");
      break;
    case "b":
    case "B":
      hud.cycleBrush();
      break;
    case "m":
    case "M": {
      const modes: MapMode[] = ["political", "terrain", "population", "relations", "tech"];
      const i = modes.indexOf(hud.mode);
      hud.setMode(modes[(i + 1) % modes.length]);
      break;
    }
    case "Tab":
      ev.preventDefault();
      hud.toggleDrawer();
      break;
    case "Escape":
      hud.hideInspect();
      hud.toggleDrawer(false);
      break;
  }
});

window.addEventListener("resize", () => {
  renderer.resize();
});

// ============================================================
// メインループ
// ============================================================
function frame(now: number): void {
  const dt = Math.min(200, now - lastFrame);
  lastFrame = now;

  if (speed > 0) {
    accumulator += dt * speed;
    const interval = TICK_MS;
    let steps = 0;
    while (accumulator >= interval && steps < 8) {
      accumulator -= interval;
      world.step();
      steps++;
    }
  } else {
    accumulator = 0;
  }

  // 通知をトーストへ
  while (world.notifications.length > 0) {
    const n = world.notifications.shift()!;
    hud.toast(n.text, n.kind);
  }

  const simAlpha = speed > 0 ? Math.min(1, accumulator / TICK_MS) : 1;
  renderer.render(renderState, simAlpha, now);
  if (Math.floor(now / 500) !== Math.floor((now - dt) / 500)) {
    renderer.drawMinimap(hud.minimap);
  }
  hud.update();

  requestAnimationFrame(frame);
}

// ---- 起動 --------------------------------------------------
renderer.resize();
renderer.fitZoom();
requestAnimationFrame(frame);

if (boot) {
  boot.classList.add("done");
  setTimeout(() => boot.remove(), 500);
}

if (world.tick === 0) {
  hud.toast("🌍 世界が生まれた。下の神器帯から力を選び、大地に触れよう。", "divine");
} else {
  hud.toast(`📂 ${world.year}年の世界を再開しました`, "info");
}

setupPWA();
