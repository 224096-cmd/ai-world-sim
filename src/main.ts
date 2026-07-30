import "./style.css";
import "./ui/ui-extra.css";
import { GameWorld, SNAPSHOT_VERSION, WorldSnapshot } from "./core/simulation";
import { City, EventCategory, MapMode, MAP_MODE_LABEL, Nation, RESOURCE_LABEL, WorldConfig } from "./core/types";
import { MapRenderer } from "./ui/renderer";
import {
  renderNationList,
  renderNationDetail,
  renderPeopleList,
  renderPersonDetail,
  renderHistory
} from "./ui/panels";
import { renderStatsTab, StatMetric } from "./ui/charts";
import { renderGodPanel, GodActionDef, GodActionKind } from "./ui/godActions";
import { ChatController } from "./ai/chatController";
import { aiService, DEFAULT_MODEL_ID, LIGHT_MODEL_ID } from "./ai/aiService";
import { setupPWA } from "./pwaRegister";

const SAVE_KEY = "ai-world-sim:save";
type TabId = "nations" | "people" | "history" | "stats" | "god" | "settings";

// 自動進行の速度 (ミリ秒)
const SPEEDS = [
  { label: "×1", interval: 1400 },
  { label: "×2", interval: 700 },
  { label: "×4", interval: 300 }
];

// ==============================================================
// 画面の骨格
// ==============================================================
const app = document.getElementById("app")!;
app.innerHTML = `
  <div class="top-bar">
    <div class="top-bar__title">🌍 AI世界シミュレーター</div>
    <div class="top-bar__year" id="year-display">1年</div>
    <div class="top-bar__faith" id="faith-display">信仰 30</div>
    <div class="top-bar__spacer"></div>
    <button class="btn btn--primary" id="btn-next-year">次の年へ</button>
    <div class="speed-group" id="speed-group"></div>
    <button class="btn" id="btn-new-world">新しい世界</button>
  </div>
  <div class="main-layout">
    <div class="map-panel">
      <canvas id="world-canvas"></canvas>
      <div class="map-modes" id="map-modes"></div>
      <div class="map-zoom">
        <button class="btn btn--icon" id="btn-zoom-in">＋</button>
        <button class="btn btn--icon" id="btn-zoom-out">−</button>
        <button class="btn btn--icon" id="btn-zoom-reset">⤢</button>
      </div>
      <div class="selection-tag" id="selection-tag" style="display:none;"></div>
      <div class="tile-inspector" id="tile-inspector" style="display:none;"></div>
      <div class="map-legend">ドラッグで移動 / ホイール・ピンチで拡大 / タップで選択</div>
    </div>
    <div class="side-panel">
      <div class="tabs">
        <button class="tab active" data-tab="nations">国家</button>
        <button class="tab" data-tab="people">人物</button>
        <button class="tab" data-tab="history">年表</button>
        <button class="tab" data-tab="stats">統計</button>
        <button class="tab" data-tab="god">神の力</button>
        <button class="tab" data-tab="settings">設定</button>
      </div>
      <div class="tab-content" id="tab-content"></div>
    </div>
  </div>
  <div class="toast-stack" id="toast-stack"></div>
  <div id="modal-root"></div>
`;

const yearDisplay = document.getElementById("year-display")!;
const faithDisplay = document.getElementById("faith-display")!;
const tabContent = document.getElementById("tab-content")!;
const selectionTag = document.getElementById("selection-tag")!;
const tileInspector = document.getElementById("tile-inspector")!;
const canvas = document.getElementById("world-canvas") as HTMLCanvasElement;
const modalRoot = document.getElementById("modal-root")!;
const toastStack = document.getElementById("toast-stack")!;

// ==============================================================
// 状態
// ==============================================================
let world = loadOrCreateWorld();
let renderer = new MapRenderer(canvas, world);
let chat = new ChatController(world);

let activeTab: TabId = "nations";
let selectedNationId: string | null = null;
let selectedPersonId: string | null = null;
let peopleFilter: string | "all" = "all";
let historyCategory: EventCategory | "all" = "all";
let historyKeyword = "";
let historyMajorOnly = true;
let statMetric: StatMetric = "p";
let speedIndex = 1;
let autoPlay = false;
let autoTimer: number | null = null;
let ticksSinceSave = 0;
let ticksSincePanel = 0;

function loadOrCreateWorld(): GameWorld {
  const raw = localStorage.getItem(SAVE_KEY);
  if (raw) {
    try {
      const snapshot: WorldSnapshot = JSON.parse(raw);
      const restored = GameWorld.fromSnapshot(snapshot);
      if (restored) return restored;
      console.info("セーブデータの形式が古いため、新しい世界を生成します");
    } catch (err) {
      console.warn("セーブデータの読み込みに失敗、新しい世界を生成します", err);
    }
  }
  return createNewWorld();
}

function createNewWorld(config?: Partial<WorldConfig>): GameWorld {
  const full: WorldConfig = {
    width: config?.width ?? 52,
    height: config?.height ?? 34,
    nationCount: config?.nationCount ?? 7,
    seed: config?.seed ?? Math.floor(Math.random() * 2 ** 31)
  };
  return GameWorld.create(full);
}

function saveWorld() {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(world.toSnapshot()));
  } catch (err) {
    console.warn("自動保存に失敗しました", err);
  }
}

// ==============================================================
// 描画
// ==============================================================
function refreshAll(panels = true) {
  yearDisplay.textContent = `${world.year}年`;
  faithDisplay.textContent = `信仰 ${world.faith}`;
  renderer.draw({ type: selectedNationId ? "nation" : null, id: selectedNationId });
  updateSelectionTag();
  if (panels) renderActiveTab();
}

function updateSelectionTag() {
  const nation = selectedNationId ? world.getNation(selectedNationId) : undefined;
  if (nation) {
    selectionTag.style.display = "block";
    selectionTag.innerHTML = `<span class="swatch" style="background:${nation.color}"></span>${nation.name}`;
  } else {
    selectionTag.style.display = "none";
  }
}

function renderActiveTab() {
  for (const btn of document.querySelectorAll<HTMLButtonElement>(".tab")) {
    btn.classList.toggle("active", btn.dataset.tab === activeTab);
  }

  switch (activeTab) {
    case "nations":
      renderNationsTab();
      break;
    case "people":
      renderPeopleTab();
      break;
    case "history":
      renderHistoryTab();
      break;
    case "stats":
      renderStatsTab(tabContent, world, statMetric, (m) => {
        statMetric = m;
        renderActiveTab();
      }, (id) => {
        selectNation(id);
      });
      break;
    case "god":
      renderGodTab();
      break;
    case "settings":
      renderSettingsTab();
      break;
  }
}

function selectNation(id: string | null) {
  selectedNationId = id;
  activeTab = "nations";
  refreshAll();
}

// -------- 国家タブ --------
function renderNationsTab() {
  tabContent.innerHTML = "";
  const selected = selectedNationId ? world.getNation(selectedNationId) : undefined;

  if (selected && selected.alive) {
    tabContent.appendChild(backButton("← 国家一覧に戻る", () => selectNation(null)));
    const detail = document.createElement("div");
    tabContent.appendChild(detail);
    renderNationDetail(detail, world, selected, {
      onSelectPerson: (personId) => {
        selectedPersonId = personId;
        activeTab = "people";
        refreshAll();
      },
      onFocusCity: (city: City) => {
        renderer.focusOn(city.x, city.y, 3.2);
        refreshAll(false);
      },
      onSelectNation: (id) => selectNation(id)
    });
  } else {
    const list = document.createElement("div");
    tabContent.appendChild(list);
    renderNationList(list, world, selectedNationId, (id) => selectNation(id));
  }
}

// -------- 人物タブ --------
function renderPeopleTab() {
  tabContent.innerHTML = "";
  const selected = selectedPersonId ? world.getPerson(selectedPersonId) : undefined;

  if (selected && selected.alive) {
    tabContent.appendChild(
      backButton("← 人物一覧に戻る", () => {
        selectedPersonId = null;
        refreshAll();
      })
    );

    const detail = document.createElement("div");
    tabContent.appendChild(detail);
    renderPersonDetail(detail, world, selected);

    const nation = world.getNation(selected.nationId);
    if (nation) {
      const chatTitle = document.createElement("div");
      chatTitle.className = "section-title";
      chatTitle.textContent = "対話 (AI/フォールバック)";
      tabContent.appendChild(chatTitle);

      const chatBox = document.createElement("div");
      chatBox.style.height = "300px";
      tabContent.appendChild(chatBox);
      chat.render(chatBox, selected, nation, () => {});
    }
  } else {
    const list = document.createElement("div");
    tabContent.appendChild(list);
    renderPeopleList(
      list,
      world,
      selectedPersonId,
      peopleFilter,
      (id) => {
        selectedPersonId = id;
        refreshAll();
      },
      (filter) => {
        peopleFilter = filter;
        renderActiveTab();
      }
    );
  }
}

// -------- 年表タブ --------
function renderHistoryTab() {
  tabContent.innerHTML = "";

  const search = document.createElement("input");
  search.type = "search";
  search.className = "search-input";
  search.placeholder = "国名・人名・出来事で検索...";
  search.value = historyKeyword;
  search.addEventListener("input", () => {
    historyKeyword = search.value;
    renderHistory(list, world, {
      category: historyCategory,
      keyword: historyKeyword,
      majorOnly: historyMajorOnly
    });
  });
  tabContent.appendChild(search);

  const filterRow = document.createElement("div");
  filterRow.className = "chip-row";

  const filters: [EventCategory | "all", string][] = [
    ["all", "すべて"],
    ["war", "戦争"],
    ["diplomacy", "外交"],
    ["succession", "継承"],
    ["city", "都市"],
    ["nature", "天災/豊作"],
    ["economy", "経済"],
    ["discovery", "技術"],
    ["divine", "神の力"]
  ];
  for (const [key, label] of filters) {
    const btn = document.createElement("button");
    btn.className = "chip" + (historyCategory === key ? " chip--active" : "");
    btn.textContent = label;
    btn.addEventListener("click", () => {
      historyCategory = key;
      renderHistoryTab();
    });
    filterRow.appendChild(btn);
  }

  const majorChip = document.createElement("button");
  majorChip.className = "chip" + (historyMajorOnly ? " chip--active" : "");
  majorChip.textContent = historyMajorOnly ? "重要な出来事のみ" : "些細な出来事も表示";
  majorChip.addEventListener("click", () => {
    historyMajorOnly = !historyMajorOnly;
    renderHistoryTab();
  });
  filterRow.appendChild(majorChip);
  tabContent.appendChild(filterRow);

  const list = document.createElement("div");
  tabContent.appendChild(list);
  renderHistory(list, world, {
    category: historyCategory,
    keyword: historyKeyword,
    majorOnly: historyMajorOnly
  });
}

// -------- 神の力タブ --------
function renderGodTab() {
  tabContent.innerHTML = "";
  renderGodPanel(tabContent, world.faith, world.faithRegen(), (action) => {
    if (world.faith < action.cost) {
      showToast("信仰力が足りません", "warn");
      return;
    }
    openNationPicker(`${action.label}: 対象の国家`, (nation) => {
      void handleGodAction(action, nation);
    });
  });

  if (world.godLog.length > 0) {
    tabContent.appendChild(sectionTitle("介入の記録"));
    for (const log of world.godLog.slice(-15).reverse()) {
      const row = document.createElement("div");
      row.className = "card__meta";
      row.textContent = `${log.year}年 … ${log.description}`;
      tabContent.appendChild(row);
    }
  }
}

async function handleGodAction(action: GodActionDef, nation: Nation) {
  const kind: GodActionKind = action.kind;
  let ok: unknown = null;

  switch (kind) {
    case "disaster": ok = world.godDisaster(nation.id); break;
    case "blessing": ok = world.godBlessing(nation.id); break;
    case "resource": ok = world.godDiscoverResource(nation.id); break;
    case "plague": ok = world.godPlague(nation.id); break;
    case "uprising": ok = world.godUprising(nation.id); break;
    case "hero": ok = world.godSummonHero(nation.id); break;
    case "city": ok = world.godFoundCity(nation.id); break;
    case "peace": ok = world.godForcePeace(nation.id); break;
    case "lowerTax": ok = world.godProclaimLaw(nation.id, "lowerTax"); break;
    case "raiseTax": ok = world.godProclaimLaw(nation.id, "raiseTax"); break;
    case "militarize": ok = world.godProclaimLaw(nation.id, "militarize"); break;
    case "openTrade": ok = world.godProclaimLaw(nation.id, "openTrade"); break;
    case "oracle": ok = await handleOracle(nation); break;
  }

  if (!ok) {
    showToast("その力は今この国には及ばなかった", "warn");
    return;
  }

  world.spendFaith(action.cost);
  showToast(`${nation.name}に ${action.label}`, "divine");
  saveWorld();
  refreshAll();
}

async function handleOracle(nation: Nation) {
  const king = world.kingOf(nation.id);
  const prompt = [
    `あなたは世界を見守る「語り部」です。${nation.name}という国の運命について、`,
    `詩的で少し神秘的な短い神託(2文以内、日本語)を告げてください。`,
    `${nation.name}の状況: 人口${nation.population}、安定度${Math.round(nation.stability)}/100、`,
    `王は${king?.name ?? "不在"}。`
  ].join("");

  const { text } = await aiService.generate(
    prompt,
    () => `${nation.name}よ、汝の道は霧に包まれている。されど星々はまだ、その名を忘れてはいない。`,
    { maxNewTokens: 60 }
  );

  return world.recordAiNarrative("divine", text, [nation.id], king ? [king.id] : []);
}

// -------- 設定タブ --------
function renderSettingsTab() {
  tabContent.innerHTML = "";

  // --- 表示 ---
  tabContent.appendChild(sectionTitle("表示"));
  const labelRow = document.createElement("div");
  labelRow.className = "settings-row";
  labelRow.appendChild(document.createTextNode("地図に都市名を表示"));
  const labelToggle = document.createElement("button");
  labelToggle.className = "btn" + (renderer.showLabels ? " btn--gold" : "");
  labelToggle.textContent = renderer.showLabels ? "ON" : "OFF";
  labelToggle.addEventListener("click", () => {
    renderer.showLabels = !renderer.showLabels;
    renderSettingsTab();
    refreshAll(false);
  });
  labelRow.appendChild(labelToggle);
  tabContent.appendChild(labelRow);

  // --- ローカルAI ---
  tabContent.appendChild(sectionTitle("ローカルAI (約1GBのモデル)"));

  const enableRow = document.createElement("div");
  enableRow.className = "settings-row";
  enableRow.appendChild(document.createTextNode("ローカルAIを有効化"));
  const enableToggle = document.createElement("button");
  enableToggle.className = "btn" + (aiService.enabled ? " btn--gold" : "");
  enableToggle.textContent = aiService.enabled ? "ON" : "OFF";
  enableToggle.addEventListener("click", () => {
    aiService.enabled = !aiService.enabled;
    renderSettingsTab();
  });
  enableRow.appendChild(enableToggle);
  tabContent.appendChild(enableRow);

  const modelRow = document.createElement("div");
  modelRow.className = "settings-row";
  modelRow.appendChild(document.createTextNode("モデルサイズ"));
  const modelSelect = document.createElement("select");
  modelSelect.className = "select";
  modelSelect.innerHTML = `
    <option value="${LIGHT_MODEL_ID}">軽量 (低スペック端末向け)</option>
    <option value="${DEFAULT_MODEL_ID}">標準 (約1GB)</option>
  `;
  modelSelect.value = aiService.modelId;
  modelSelect.addEventListener("change", () => {
    aiService.modelId = modelSelect.value;
  });
  modelRow.appendChild(modelSelect);
  tabContent.appendChild(modelRow);

  const statusRow = document.createElement("div");
  statusRow.className = "settings-row";
  const statusText = document.createElement("span");
  statusText.id = "ai-status-text";
  statusText.className = "card__meta";
  statusText.textContent = aiService.getStatus().message;
  const loadBtn = document.createElement("button");
  loadBtn.className = "btn btn--gold";
  loadBtn.textContent = "モデルを読み込む";
  loadBtn.addEventListener("click", async () => {
    aiService.enabled = true;
    await aiService.ensureLoaded();
  });
  statusRow.appendChild(statusText);
  statusRow.appendChild(loadBtn);
  tabContent.appendChild(statusRow);

  const note = document.createElement("div");
  note.className = "card__meta";
  note.style.marginTop = "10px";
  note.style.lineHeight = "1.6";
  note.textContent =
    "AIは王との会話・神託など「物語」が必要な場面のみ使用します。国家運営や戦争などの通常処理はAIなしで高速に動作します。無効時やモデル未読込時は自動的にテンプレート文で応答します。";
  tabContent.appendChild(note);

  // --- セーブデータ ---
  tabContent.appendChild(sectionTitle("セーブデータ"));
  const saveInfo = document.createElement("div");
  saveInfo.className = "card__meta";
  saveInfo.textContent = `この世界は自動保存されます (形式 v${SNAPSHOT_VERSION})`;
  tabContent.appendChild(saveInfo);

  const saveRow = document.createElement("div");
  saveRow.className = "settings-row";
  const exportBtn = document.createElement("button");
  exportBtn.className = "btn";
  exportBtn.textContent = "書き出し";
  exportBtn.addEventListener("click", exportSave);
  const importBtn = document.createElement("button");
  importBtn.className = "btn";
  importBtn.textContent = "読み込み";
  importBtn.addEventListener("click", importSave);
  const resetBtn = document.createElement("button");
  resetBtn.className = "btn btn--danger";
  resetBtn.textContent = "リセット";
  resetBtn.addEventListener("click", () =>
    confirmModal("本当に世界をリセットしますか?元に戻せません。", () => {
      localStorage.removeItem(SAVE_KEY);
      startNewWorld();
    })
  );
  saveRow.appendChild(exportBtn);
  saveRow.appendChild(importBtn);
  saveRow.appendChild(resetBtn);
  tabContent.appendChild(saveRow);

  // --- 操作説明 ---
  tabContent.appendChild(sectionTitle("キーボード操作"));
  const keys = document.createElement("div");
  keys.className = "card__meta";
  keys.style.lineHeight = "1.8";
  keys.innerHTML =
    "Space: 1年進める<br>A: 自動進行の切替<br>1〜5: 地図モード切替<br>+ / -: 拡大・縮小<br>0: 全体表示に戻す";
  tabContent.appendChild(keys);
}

function exportSave() {
  const blob = new Blob([JSON.stringify(world.toSnapshot())], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `ai-world-sim-${world.year}年.json`;
  a.click();
  URL.revokeObjectURL(url);
  showToast("セーブデータを書き出しました");
}

function importSave() {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "application/json";
  input.addEventListener("change", async () => {
    const file = input.files?.[0];
    if (!file) return;
    try {
      const snapshot = JSON.parse(await file.text()) as WorldSnapshot;
      const restored = GameWorld.fromSnapshot(snapshot);
      if (!restored) {
        showToast("このセーブデータは形式が異なります", "warn");
        return;
      }
      if (autoPlay) toggleAutoPlay();
      world = restored;
      renderer.setWorld(world);
      chat = new ChatController(world);
      selectedNationId = null;
      selectedPersonId = null;
      saveWorld();
      refreshAll();
      showToast("セーブデータを読み込みました");
    } catch (err) {
      console.warn(err);
      showToast("読み込みに失敗しました", "warn");
    }
  });
  input.click();
}

// ==============================================================
// 共通UI部品
// ==============================================================
function sectionTitle(text: string): HTMLElement {
  const e = document.createElement("div");
  e.className = "section-title";
  e.textContent = text;
  return e;
}

function backButton(text: string, onClick: () => void): HTMLElement {
  const btn = document.createElement("button");
  btn.className = "btn";
  btn.style.marginBottom = "10px";
  btn.textContent = text;
  btn.addEventListener("click", onClick);
  return btn;
}

function showToast(message: string, kind: "info" | "warn" | "divine" | "major" = "info") {
  const toast = document.createElement("div");
  toast.className = `toast toast--${kind}`;
  toast.textContent = message;
  toastStack.appendChild(toast);
  window.setTimeout(() => {
    toast.classList.add("toast--out");
    window.setTimeout(() => toast.remove(), 400);
  }, 3600);

  while (toastStack.children.length > 4) toastStack.removeChild(toastStack.firstChild!);
}

function openNationPicker(title: string, onPick: (nation: Nation) => void) {
  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  const modal = document.createElement("div");
  modal.className = "modal";
  modal.appendChild(headingEl(title));

  const list = document.createElement("div");
  for (const nation of world.livingNations()) {
    const card = document.createElement("div");
    card.className = "card";
    card.innerHTML =
      `<div class="card__title"><span class="swatch" style="background:${nation.color}"></span>${nation.name}</div>` +
      `<div class="card__meta">人口 ${nation.population.toLocaleString()} ・ 安定 ${Math.round(nation.stability)}</div>`;
    card.addEventListener("click", () => {
      closeModal();
      onPick(nation);
    });
    list.appendChild(card);
  }
  modal.appendChild(list);

  const actions = document.createElement("div");
  actions.className = "modal-actions";
  const cancel = document.createElement("button");
  cancel.className = "btn";
  cancel.textContent = "キャンセル";
  cancel.addEventListener("click", closeModal);
  actions.appendChild(cancel);
  modal.appendChild(actions);

  backdrop.appendChild(modal);
  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) closeModal();
  });
  modalRoot.appendChild(backdrop);
}

function confirmModal(message: string, onConfirm: () => void) {
  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  const modal = document.createElement("div");
  modal.className = "modal";
  modal.appendChild(headingEl("確認"));
  const p = document.createElement("p");
  p.textContent = message;
  p.style.color = "var(--text-muted)";
  modal.appendChild(p);

  const actions = document.createElement("div");
  actions.className = "modal-actions";
  const cancel = document.createElement("button");
  cancel.className = "btn";
  cancel.textContent = "キャンセル";
  cancel.addEventListener("click", closeModal);
  const ok = document.createElement("button");
  ok.className = "btn btn--danger";
  ok.textContent = "実行";
  ok.addEventListener("click", () => {
    closeModal();
    onConfirm();
  });
  actions.appendChild(cancel);
  actions.appendChild(ok);
  modal.appendChild(actions);

  backdrop.appendChild(modal);
  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) closeModal();
  });
  modalRoot.appendChild(backdrop);
}

/** 新しい世界の生成設定 */
function openNewWorldModal() {
  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  const modal = document.createElement("div");
  modal.className = "modal";
  modal.appendChild(headingEl("新しい世界を生成"));

  const sizes: [string, number, number][] = [
    ["小さな島 (40×26)", 40, 26],
    ["標準 (52×34)", 52, 34],
    ["大陸 (68×44)", 68, 44]
  ];
  let sizeIndex = 1;
  let nationCount = 7;
  let seedText = String(Math.floor(Math.random() * 2 ** 31));

  const sizeRow = document.createElement("div");
  sizeRow.className = "settings-row";
  sizeRow.appendChild(document.createTextNode("世界の大きさ"));
  const sizeSelect = document.createElement("select");
  sizeSelect.className = "select";
  sizes.forEach(([label], i) => {
    const opt = document.createElement("option");
    opt.value = String(i);
    opt.textContent = label;
    sizeSelect.appendChild(opt);
  });
  sizeSelect.value = "1";
  sizeSelect.addEventListener("change", () => (sizeIndex = Number(sizeSelect.value)));
  sizeRow.appendChild(sizeSelect);
  modal.appendChild(sizeRow);

  const countRow = document.createElement("div");
  countRow.className = "settings-row";
  countRow.appendChild(document.createTextNode("初期の国家数"));
  const countInput = document.createElement("input");
  countInput.type = "number";
  countInput.className = "select";
  countInput.min = "2";
  countInput.max = "14";
  countInput.value = "7";
  countInput.addEventListener("change", () => (nationCount = Number(countInput.value)));
  countRow.appendChild(countInput);
  modal.appendChild(countRow);

  const seedRow = document.createElement("div");
  seedRow.className = "settings-row";
  seedRow.appendChild(document.createTextNode("シード値"));
  const seedInput = document.createElement("input");
  seedInput.type = "text";
  seedInput.className = "select";
  seedInput.value = seedText;
  seedInput.addEventListener("change", () => (seedText = seedInput.value));
  seedRow.appendChild(seedInput);
  modal.appendChild(seedRow);

  const hint = document.createElement("div");
  hint.className = "card__meta";
  hint.style.marginTop = "10px";
  hint.textContent = "同じシード値を入れると、まったく同じ地形の世界が再生成されます。";
  modal.appendChild(hint);

  const actions = document.createElement("div");
  actions.className = "modal-actions";
  const cancel = document.createElement("button");
  cancel.className = "btn";
  cancel.textContent = "キャンセル";
  cancel.addEventListener("click", closeModal);
  const ok = document.createElement("button");
  ok.className = "btn btn--primary";
  ok.textContent = "生成する";
  ok.addEventListener("click", () => {
    closeModal();
    const [, width, height] = sizes[sizeIndex];
    const parsed = Number(seedText);
    startNewWorld({
      width,
      height,
      nationCount: Math.max(2, Math.min(14, nationCount)),
      seed: Number.isFinite(parsed) ? Math.floor(parsed) : hashString(seedText)
    });
  });
  actions.appendChild(cancel);
  actions.appendChild(ok);
  modal.appendChild(actions);

  backdrop.appendChild(modal);
  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) closeModal();
  });
  modalRoot.appendChild(backdrop);
}

function hashString(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function headingEl(text: string): HTMLElement {
  const h = document.createElement("h2");
  h.textContent = text;
  return h;
}

function closeModal() {
  modalRoot.innerHTML = "";
}

// ==============================================================
// 年送り / 自動進行
// ==============================================================
function advanceYear(fromAuto = false) {
  const events = world.tick();

  for (const e of events.filter((ev) => ev.importance >= 2).slice(0, 2)) {
    showToast(e.text, "major");
  }

  ticksSinceSave += 1;
  ticksSincePanel += 1;

  // 高速進行中はセーブとパネル再描画を間引いて軽くする
  const panelInterval = fromAuto && speedIndex === 2 ? 3 : 1;
  const panels = ticksSincePanel >= panelInterval;
  if (panels) ticksSincePanel = 0;

  if (!fromAuto || ticksSinceSave >= 5) {
    saveWorld();
    ticksSinceSave = 0;
  }

  refreshAll(panels);
}

function toggleAutoPlay() {
  autoPlay = !autoPlay;
  if (autoTimer) {
    window.clearInterval(autoTimer);
    autoTimer = null;
  }
  if (autoPlay) {
    autoTimer = window.setInterval(() => advanceYear(true), SPEEDS[speedIndex].interval);
  } else {
    saveWorld();
  }
  renderSpeedGroup();
}

function setSpeed(index: number) {
  speedIndex = index;
  if (autoPlay) {
    if (autoTimer) window.clearInterval(autoTimer);
    autoTimer = window.setInterval(() => advanceYear(true), SPEEDS[speedIndex].interval);
  }
  renderSpeedGroup();
}

function renderSpeedGroup() {
  const group = document.getElementById("speed-group")!;
  group.innerHTML = "";

  const playBtn = document.createElement("button");
  playBtn.className = "btn" + (autoPlay ? " btn--gold" : "");
  playBtn.textContent = autoPlay ? "⏸ 停止" : "▶ 自動";
  playBtn.addEventListener("click", toggleAutoPlay);
  group.appendChild(playBtn);

  SPEEDS.forEach((speed, i) => {
    const btn = document.createElement("button");
    btn.className = "btn btn--icon" + (speedIndex === i ? " btn--gold" : "");
    btn.textContent = speed.label;
    btn.addEventListener("click", () => setSpeed(i));
    group.appendChild(btn);
  });
}

function startNewWorld(config?: Partial<WorldConfig>) {
  if (autoPlay) toggleAutoPlay();
  world = createNewWorld(config);
  renderer.setWorld(world);
  chat = new ChatController(world);
  selectedNationId = null;
  selectedPersonId = null;
  peopleFilter = "all";
  historyKeyword = "";
  historyCategory = "all";
  tileInspector.style.display = "none";
  saveWorld();
  refreshAll();
  showToast("新しい世界が生まれました");
}

// ==============================================================
// 地図モード
// ==============================================================
function renderMapModes() {
  const container = document.getElementById("map-modes")!;
  container.innerHTML = "";
  (Object.keys(MAP_MODE_LABEL) as MapMode[]).forEach((mode) => {
    const btn = document.createElement("button");
    btn.className = "chip" + (renderer.mode === mode ? " chip--active" : "");
    btn.textContent = MAP_MODE_LABEL[mode];
    btn.addEventListener("click", () => {
      renderer.mode = mode;
      renderMapModes();
      refreshAll(false);
    });
    container.appendChild(btn);
  });
}

// ==============================================================
// タイル情報
// ==============================================================
const TERRAIN_LABEL: Record<string, string> = {
  ocean: "海",
  plains: "平野",
  forest: "森林",
  mountain: "山岳",
  desert: "砂漠",
  tundra: "凍土"
};

function showTileInfo(clientX: number, clientY: number) {
  const tile = renderer.tileAt(clientX, clientY);
  if (!tile) {
    tileInspector.style.display = "none";
    return;
  }

  const nation = world.getNation(tile.ownerId);
  const city = tile.cityId ? world.getCity(tile.cityId) : undefined;
  const lines = [
    `(${tile.x}, ${tile.y}) ${TERRAIN_LABEL[tile.terrain] ?? tile.terrain}`,
    nation ? `${nation.name}領` : "無主の地",
    city ? `${city.isCapital ? "★" : "◍"} ${city.name} 人口${city.population.toLocaleString()}` : "",
    tile.resource ? `資源: ${RESOURCE_LABEL[tile.resource]}` : "",
    `肥沃度 ${Math.round(tile.fertility * 100)}`
  ].filter(Boolean);

  tileInspector.style.display = "block";
  tileInspector.innerHTML = lines.map((l) => `<div>${l}</div>`).join("");
}

// ==============================================================
// イベント結線
// ==============================================================
document.getElementById("btn-next-year")!.addEventListener("click", () => advanceYear());
document.getElementById("btn-new-world")!.addEventListener("click", openNewWorldModal);
document.getElementById("btn-zoom-in")!.addEventListener("click", () => {
  renderer.zoomBy(1.35);
  refreshAll(false);
});
document.getElementById("btn-zoom-out")!.addEventListener("click", () => {
  renderer.zoomBy(1 / 1.35);
  refreshAll(false);
});
document.getElementById("btn-zoom-reset")!.addEventListener("click", () => {
  renderer.resetView();
  refreshAll(false);
});

document.querySelectorAll<HTMLButtonElement>(".tab").forEach((btn) => {
  btn.addEventListener("click", () => {
    activeTab = btn.dataset.tab as TabId;
    refreshAll();
  });
});

// --- 地図の操作 (ドラッグ / ホイール / ピンチ) ---
const pointers = new Map<number, { x: number; y: number }>();
let dragged = false;
let pinchDistance = 0;

canvas.addEventListener("pointerdown", (e) => {
  canvas.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  dragged = false;
  if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    pinchDistance = Math.hypot(a.x - b.x, a.y - b.y);
  }
});

canvas.addEventListener("pointermove", (e) => {
  const prev = pointers.get(e.pointerId);
  if (!prev) return;
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

  if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    const dist = Math.hypot(a.x - b.x, a.y - b.y);
    if (pinchDistance > 0) {
      renderer.zoomBy(dist / pinchDistance, (a.x + b.x) / 2, (a.y + b.y) / 2);
      refreshAll(false);
    }
    pinchDistance = dist;
    dragged = true;
    return;
  }

  const dx = e.clientX - prev.x;
  const dy = e.clientY - prev.y;
  if (Math.abs(dx) + Math.abs(dy) > 2) {
    dragged = true;
    renderer.panBy(dx, dy);
    refreshAll(false);
  }
});

function endPointer(e: PointerEvent) {
  pointers.delete(e.pointerId);
  if (pointers.size < 2) pinchDistance = 0;
}
canvas.addEventListener("pointerup", (e) => {
  endPointer(e);
  if (dragged) return;
  showTileInfo(e.clientX, e.clientY);
  const ownerId = renderer.hitTest(e.clientX, e.clientY);
  if (ownerId) selectNation(ownerId);
  else refreshAll(false);
});
canvas.addEventListener("pointercancel", endPointer);
canvas.addEventListener("pointerleave", endPointer);

canvas.addEventListener(
  "wheel",
  (e) => {
    e.preventDefault();
    renderer.zoomBy(e.deltaY < 0 ? 1.15 : 1 / 1.15, e.clientX, e.clientY);
    refreshAll(false);
  },
  { passive: false }
);

// --- キーボードショートカット ---
window.addEventListener("keydown", (e) => {
  const target = e.target as HTMLElement | null;
  if (target && (target.tagName === "INPUT" || target.tagName === "SELECT" || target.tagName === "TEXTAREA")) return;

  switch (e.key) {
    case " ":
      e.preventDefault();
      advanceYear();
      break;
    case "a":
    case "A":
      toggleAutoPlay();
      break;
    case "+":
    case "=":
      renderer.zoomBy(1.35);
      refreshAll(false);
      break;
    case "-":
      renderer.zoomBy(1 / 1.35);
      refreshAll(false);
      break;
    case "0":
      renderer.resetView();
      refreshAll(false);
      break;
    case "1":
    case "2":
    case "3":
    case "4":
    case "5": {
      const modes = Object.keys(MAP_MODE_LABEL) as MapMode[];
      const mode = modes[Number(e.key) - 1];
      if (mode) {
        renderer.mode = mode;
        renderMapModes();
        refreshAll(false);
      }
      break;
    }
  }
});

window.addEventListener("resize", () => refreshAll(false));
window.addEventListener("beforeunload", saveWorld);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") saveWorld();
});

aiService.onProgress((p) => {
  const el = document.getElementById("ai-status-text");
  if (el) el.textContent = p.message;
});

// ==============================================================
// 初期化
// ==============================================================
setupPWA();
renderSpeedGroup();
renderMapModes();
refreshAll();