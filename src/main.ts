import "./style.css";
import "./ui/ui-extra.css";
import { GameWorld, SNAPSHOT_VERSION, WorldSnapshot } from "./core/simulation";
import {
  Army,
  City,
  EventCategory,
  MapMode,
  MAP_MODE_LABEL,
  Nation,
  Person,
  PersonRole,
  RESOURCE_LABEL,
  TERRAIN_LABEL,
  WorldConfig
} from "./core/types";
import { MapRenderer } from "./ui/renderer";
import {
  renderNationList,
  renderNationDetail,
  renderPeopleList,
  renderPersonDetail,
  renderHistory
} from "./ui/panels";
import { renderStatsTab, StatMetric } from "./ui/charts";
import { renderGodPanel, GodActionDef } from "./ui/godActions";
import { ChatController } from "./ai/chatController";
import { aiService } from "./ai/aiService";
import { renderAd, resetAdRotation } from "./ads";
import { setupPWA } from "./pwaRegister";

const SAVE_KEY = "ai-world-sim:save";
type TabId = "nations" | "people" | "history" | "stats" | "god" | "settings";

const TABS: { id: TabId; icon: string; label: string }[] = [
  { id: "nations", icon: "🏰", label: "国家" },
  { id: "people", icon: "👤", label: "人物" },
  { id: "history", icon: "📜", label: "年表" },
  { id: "stats", icon: "📊", label: "統計" },
  { id: "god", icon: "✦", label: "神の力" },
  { id: "settings", icon: "⚙", label: "設定" }
];

const SPEEDS = [
  { label: "×1", interval: 1600 },
  { label: "×2", interval: 800 },
  { label: "×4", interval: 380 },
  { label: "×8", interval: 170 }
];

// ==============================================================
// 画面の骨格 (地図を全面に敷き、UIは重ねる)
// ==============================================================
const app = document.getElementById("app")!;
app.innerHTML = `
  <canvas id="world-canvas"></canvas>

  <div class="hud hud--top">
    <button class="hud-btn" id="btn-panel" title="パネル">☰</button>
    <div class="hud-chip" id="year-display">1年</div>
    <div class="hud-chip hud-chip--faith" id="faith-display">✦ 30</div>
    <div class="hud-spacer"></div>
    <div class="hud-group" id="speed-group"></div>
  </div>

  <div class="map-modes" id="map-modes"></div>

  <div class="map-tools">
    <button class="hud-btn" id="btn-zoom-in">＋</button>
    <button class="hud-btn" id="btn-zoom-out">−</button>
    <button class="hud-btn" id="btn-zoom-reset">⤢</button>
    <button class="hud-btn" id="btn-labels" title="名前の表示">🏷</button>
  </div>

  <div class="tile-inspector" id="tile-inspector" style="display:none;"></div>
  <div class="toast-stack" id="toast-stack"></div>

  <section class="panel" id="panel">
    <button class="panel__handle" id="panel-handle"><span></span></button>
    <nav class="panel__tabs" id="panel-tabs"></nav>
    <div class="panel__body" id="tab-content"></div>
  </section>

  <div id="modal-root"></div>
`;

const yearDisplay = document.getElementById("year-display")!;
const faithDisplay = document.getElementById("faith-display")!;
const tabContent = document.getElementById("tab-content")!;
const tileInspector = document.getElementById("tile-inspector")!;
const canvas = document.getElementById("world-canvas") as HTMLCanvasElement;
const modalRoot = document.getElementById("modal-root")!;
const toastStack = document.getElementById("toast-stack")!;
const panel = document.getElementById("panel")!;

// ==============================================================
// 状態
// ==============================================================
let world = loadOrCreateWorld();
let renderer = new MapRenderer(canvas, world);
let chat = new ChatController(world);

let activeTab: TabId = "nations";
let panelOpen = window.innerWidth > 900;
let selectedNationId: string | null = null;
let selectedPersonId: string | null = null;
let peopleNationFilter: string | "all" = "all";
let peopleRoleFilter: PersonRole | "all" = "all";
let historyCategory: EventCategory | "all" = "all";
let historyKeyword = "";
let historyMajorOnly = true;
let statMetric: StatMetric = "p";
let speedIndex = 1;
let autoPlay = false;
let autoTimer: number | null = null;
let lastTickAt = performance.now();
let ticksSinceSave = 0;

function loadOrCreateWorld(): GameWorld {
  const raw = localStorage.getItem(SAVE_KEY);
  if (raw) {
    try {
      const restored = GameWorld.fromSnapshot(JSON.parse(raw) as WorldSnapshot);
      if (restored) return restored;
      console.info("セーブデータの形式が古いため、新しい世界を生成します");
    } catch (err) {
      console.warn("セーブデータの読み込みに失敗しました", err);
    }
  }
  return createNewWorld();
}

function createNewWorld(config?: Partial<WorldConfig>): GameWorld {
  return GameWorld.create({
    width: config?.width ?? 72,
    height: config?.height ?? 46,
    nationCount: config?.nationCount ?? 9,
    landRatio: config?.landRatio ?? 0.55,
    seed: config?.seed ?? Math.floor(Math.random() * 2 ** 31)
  });
}

function saveWorld() {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(world.toSnapshot()));
  } catch (err) {
    console.warn("自動保存に失敗しました", err);
  }
}

// ==============================================================
// 描画ループ
// ==============================================================
function frame(now: number) {
  if (!document.hidden) {
    const duration = SPEEDS[speedIndex].interval;
    const alpha = autoPlay ? Math.min(1, (now - lastTickAt) / duration) : 1;
    renderer.draw({ type: selectedNationId ? "nation" : null, id: selectedNationId }, alpha, now);
  }
  requestAnimationFrame(frame);
}

function refreshHud() {
  yearDisplay.textContent = `${world.year}年`;
  faithDisplay.textContent = `✦ ${world.faith}`;
}

function refreshAll(panels = true) {
  refreshHud();
  renderer.invalidate();
  if (panels) renderActiveTab();
}

function renderActiveTab() {
  resetAdRotation();
  for (const btn of document.querySelectorAll<HTMLButtonElement>(".panel-tab")) {
    btn.classList.toggle("active", btn.dataset.tab === activeTab);
  }
  tabContent.scrollTop = tabContent.scrollTop;

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
      renderStatsTab(
        tabContent,
        world,
        statMetric,
        (m) => {
          statMetric = m;
          renderActiveTab();
        },
        (id) => selectNation(id)
      );
      renderAd(tabContent, "panel-bottom");
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
  openPanel(true);
  refreshAll();
}

// -------- 国家 --------
function renderNationsTab() {
  tabContent.innerHTML = "";
  const selected = selectedNationId ? world.getNation(selectedNationId) : undefined;

  if (selected && selected.alive) {
    tabContent.appendChild(backButton("← 国家一覧", () => selectNation(null)));
    const detail = document.createElement("div");
    tabContent.appendChild(detail);
    renderNationDetail(detail, world, selected, {
      onSelectPerson: (personId) => {
        selectedPersonId = personId;
        activeTab = "people";
        refreshAll();
      },
      onFocusCity: (city: City) => {
        renderer.focusOn(city.x, city.y, 4);
      },
      onFocusArmy: (army: Army) => {
        renderer.focusOn(army.x, army.y, 4);
      },
      onSelectNation: (id) => selectNation(id),
      onRenameNation: (nation) =>
        promptModal("国名を変更", nation.name, (value) => {
          if (world.renameNation(nation.id, value)) {
            saveWorld();
            refreshAll();
          }
        }),
      onRenameCity: (city) =>
        promptModal("都市名を変更", city.name, (value) => {
          if (world.renameCity(city.id, value)) {
            saveWorld();
            refreshAll();
          }
        })
    });
  } else {
    const list = document.createElement("div");
    tabContent.appendChild(list);
    renderNationList(list, world, selectedNationId, (id) => selectNation(id));
  }
}

// -------- 人物 --------
function renderPeopleTab() {
  tabContent.innerHTML = "";
  const selected = selectedPersonId ? world.getPerson(selectedPersonId) : undefined;

  if (selected && selected.alive) {
    tabContent.appendChild(
      backButton("← 人物一覧", () => {
        selectedPersonId = null;
        refreshAll();
      })
    );
    const detail = document.createElement("div");
    tabContent.appendChild(detail);
    renderPersonDetail(detail, world, selected, (person: Person) =>
      promptModal("名前を変更", person.name, (value) => {
        if (world.renamePerson(person.id, value)) {
          saveWorld();
          refreshAll();
        }
      })
    );

    const nation = world.getNation(selected.nationId);
    if (nation) {
      tabContent.appendChild(sectionTitle("対話"));
      const chatBox = document.createElement("div");
      chatBox.style.height = "280px";
      tabContent.appendChild(chatBox);
      chat.render(chatBox, selected, nation, () => {});
      renderAd(tabContent, "compact");
    }
  } else {
    const list = document.createElement("div");
    tabContent.appendChild(list);
    renderPeopleList(
      list,
      world,
      selectedPersonId,
      peopleNationFilter,
      peopleRoleFilter,
      (id) => {
        selectedPersonId = id;
        refreshAll();
      },
      (filter) => {
        peopleNationFilter = filter;
        renderActiveTab();
      },
      (role) => {
        peopleRoleFilter = role;
        renderActiveTab();
      }
    );
  }
}

// -------- 年表 --------
function renderHistoryTab() {
  tabContent.innerHTML = "";

  const search = document.createElement("input");
  search.type = "search";
  search.className = "search-input";
  search.placeholder = "国名・人名・出来事で検索";
  search.value = historyKeyword;
  search.addEventListener("input", () => {
    historyKeyword = search.value;
    draw();
  });
  tabContent.appendChild(search);

  const filterRow = document.createElement("div");
  filterRow.className = "chip-row";
  const filters: [EventCategory | "all", string][] = [
    ["all", "すべて"],
    ["war", "戦争"],
    ["diplomacy", "外交"],
    ["intrigue", "謀略"],
    ["succession", "継承"],
    ["city", "都市"],
    ["nature", "天災"],
    ["economy", "経済"],
    ["discovery", "技術"],
    ["divine", "神"]
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
  majorChip.textContent = historyMajorOnly ? "重要のみ" : "すべての事件";
  majorChip.addEventListener("click", () => {
    historyMajorOnly = !historyMajorOnly;
    renderHistoryTab();
  });
  filterRow.appendChild(majorChip);
  tabContent.appendChild(filterRow);

  const list = document.createElement("div");
  tabContent.appendChild(list);

  function draw() {
    renderHistory(
      list,
      world,
      { category: historyCategory, keyword: historyKeyword, majorOnly: historyMajorOnly },
      (x, y) => renderer.focusOn(x, y, 4)
    );
  }
  draw();
}

// -------- 神の力 --------
function renderGodTab() {
  tabContent.innerHTML = "";
  renderGodPanel(tabContent, world.faith, world.faithRegen(), (action) => {
    if (world.faith < action.cost) {
      showToast("信仰力が足りません", "warn");
      return;
    }
    openNationPicker(`${action.label}: 対象の国家`, (nation) => void handleGodAction(action, nation));
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

  renderAd(tabContent, "panel-bottom");
}

async function handleGodAction(action: GodActionDef, nation: Nation) {
  let ok: unknown = null;
  switch (action.kind) {
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
    case "conscription": ok = world.godProclaimLaw(nation.id, "conscription"); break;
    case "oracle": ok = await handleOracle(nation); break;
  }

  if (!ok) {
    showToast("その力は今この国には及ばなかった", "warn");
    return;
  }
  world.spendFaith(action.cost);
  showToast(`${nation.name}に「${action.label}」`, "divine");
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

// -------- 設定 --------
function renderSettingsTab() {
  tabContent.innerHTML = "";

  tabContent.appendChild(sectionTitle("世界"));
  const newWorldBtn = document.createElement("button");
  newWorldBtn.className = "btn btn--primary btn--wide";
  newWorldBtn.textContent = "新しい世界を生成";
  newWorldBtn.addEventListener("click", openNewWorldModal);
  tabContent.appendChild(newWorldBtn);

  tabContent.appendChild(sectionTitle("表示"));
  tabContent.appendChild(
    toggleRow("地図に名前を表示", renderer.showLabels, () => {
      renderer.showLabels = !renderer.showLabels;
      renderSettingsTab();
    })
  );
  tabContent.appendChild(
    toggleRow("軍団と矢印を表示", renderer.showArmies, () => {
      renderer.showArmies = !renderer.showArmies;
      renderSettingsTab();
    })
  );

  tabContent.appendChild(sectionTitle("会話"));
  tabContent.appendChild(el("div", "card__meta", aiService.getStatus().message));
  tabContent.appendChild(
    el(
      "div",
      "card__meta",
      "人物タブから王や将軍に話しかけると、役職と国の状況に応じた返答が返ります。外部への通信やモデルのダウンロードは一切ありません。"
    )
  );

  tabContent.appendChild(sectionTitle("セーブデータ"));
  const saveRow = document.createElement("div");
  saveRow.className = "settings-row settings-row--buttons";
  saveRow.appendChild(actionButton("書き出し", "btn", exportSave));
  saveRow.appendChild(actionButton("読み込み", "btn", importSave));
  saveRow.appendChild(
    actionButton("リセット", "btn btn--danger", () =>
      confirmModal("本当に世界をリセットしますか?元に戻せません。", () => {
        localStorage.removeItem(SAVE_KEY);
        startNewWorld();
      })
    )
  );
  tabContent.appendChild(saveRow);
  tabContent.appendChild(
    el("div", "card__meta", `自動保存されます (形式 v${SNAPSHOT_VERSION}) ・ ${world.events.length}件の記録`)
  );

  tabContent.appendChild(sectionTitle("操作"));
  const keys = document.createElement("div");
  keys.className = "card__meta";
  keys.style.lineHeight = "1.9";
  keys.innerHTML =
    "Space: 1年進める / A: 自動進行 / Tab: パネル開閉<br>1〜6: 地図モード / +・-: 拡大縮小 / 0: 全体表示<br>ドラッグ: 移動 / ピンチ・ホイール: 拡大";
  tabContent.appendChild(keys);

  renderAd(tabContent, "compact");
  renderAd(tabContent, "panel-bottom");
}

function toggleRow(label: string, value: boolean, onToggle: () => void): HTMLElement {
  const row = document.createElement("div");
  row.className = "settings-row";
  row.appendChild(document.createTextNode(label));
  const btn = document.createElement("button");
  btn.className = "btn" + (value ? " btn--gold" : "");
  btn.textContent = value ? "ON" : "OFF";
  btn.addEventListener("click", onToggle);
  row.appendChild(btn);
  return row;
}

function actionButton(label: string, className: string, onClick: () => void): HTMLElement {
  const btn = document.createElement("button");
  btn.className = className;
  btn.textContent = label;
  btn.addEventListener("click", onClick);
  return btn;
}

function el(tag: string, className: string, text: string): HTMLElement {
  const e = document.createElement(tag);
  e.className = className;
  e.textContent = text;
  return e;
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
      const restored = GameWorld.fromSnapshot(JSON.parse(await file.text()) as WorldSnapshot);
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
// 共通UI
// ==============================================================
function sectionTitle(text: string): HTMLElement {
  const e = document.createElement("div");
  e.className = "section-title";
  e.textContent = text;
  return e;
}

function backButton(text: string, onClick: () => void): HTMLElement {
  const btn = document.createElement("button");
  btn.className = "btn btn--back";
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
  }, 3400);
  while (toastStack.children.length > 4) toastStack.removeChild(toastStack.firstChild!);
}

function modalShell(title: string): { backdrop: HTMLElement; modal: HTMLElement; actions: HTMLElement } {
  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  const modal = document.createElement("div");
  modal.className = "modal";
  const h = document.createElement("h2");
  h.textContent = title;
  modal.appendChild(h);
  const actions = document.createElement("div");
  actions.className = "modal-actions";
  backdrop.appendChild(modal);
  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) closeModal();
  });
  return { backdrop, modal, actions };
}

function openNationPicker(title: string, onPick: (nation: Nation) => void) {
  const { backdrop, modal, actions } = modalShell(title);
  const list = document.createElement("div");
  list.className = "modal-list";
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
  actions.appendChild(actionButton("キャンセル", "btn", closeModal));
  modal.appendChild(actions);
  modalRoot.appendChild(backdrop);
}

function confirmModal(message: string, onConfirm: () => void) {
  const { backdrop, modal, actions } = modalShell("確認");
  const p = document.createElement("p");
  p.textContent = message;
  p.style.color = "var(--text-muted)";
  modal.appendChild(p);
  actions.appendChild(actionButton("キャンセル", "btn", closeModal));
  actions.appendChild(
    actionButton("実行", "btn btn--danger", () => {
      closeModal();
      onConfirm();
    })
  );
  modal.appendChild(actions);
  modalRoot.appendChild(backdrop);
}

function promptModal(title: string, initial: string, onOk: (value: string) => void) {
  const { backdrop, modal, actions } = modalShell(title);
  const input = document.createElement("input");
  input.type = "text";
  input.className = "search-input";
  input.value = initial;
  input.maxLength = 24;
  modal.appendChild(input);
  const submit = () => {
    const value = input.value;
    closeModal();
    onOk(value);
  };
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") submit();
  });
  actions.appendChild(actionButton("キャンセル", "btn", closeModal));
  actions.appendChild(actionButton("変更", "btn btn--primary", submit));
  modal.appendChild(actions);
  modalRoot.appendChild(backdrop);
  window.setTimeout(() => {
    input.focus();
    input.select();
  }, 30);
}

function openNewWorldModal() {
  const { backdrop, modal, actions } = modalShell("新しい世界を生成");

  const sizes: [string, number, number][] = [
    ["小さな島々 (56×36)", 56, 36],
    ["標準 (72×46)", 72, 46],
    ["広大な大陸 (96×60)", 96, 60]
  ];
  let sizeIndex = 1;
  let nationCount = 9;
  let landRatio = 0.55;
  let seedText = String(Math.floor(Math.random() * 2 ** 31));

  const sizeRow = document.createElement("div");
  sizeRow.className = "settings-row";
  sizeRow.appendChild(document.createTextNode("世界の広さ"));
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

  const landRow = document.createElement("div");
  landRow.className = "settings-row";
  const landLabel = document.createElement("span");
  landLabel.textContent = `陸地の割合 ${Math.round(landRatio * 100)}%`;
  const landInput = document.createElement("input");
  landInput.type = "range";
  landInput.min = "30";
  landInput.max = "80";
  landInput.value = String(landRatio * 100);
  landInput.className = "range";
  landInput.addEventListener("input", () => {
    landRatio = Number(landInput.value) / 100;
    landLabel.textContent = `陸地の割合 ${landInput.value}%`;
  });
  landRow.appendChild(landLabel);
  landRow.appendChild(landInput);
  modal.appendChild(landRow);

  const countRow = document.createElement("div");
  countRow.className = "settings-row";
  const countLabel = document.createElement("span");
  countLabel.textContent = `初期国家数 ${nationCount}`;
  const countInput = document.createElement("input");
  countInput.type = "range";
  countInput.min = "2";
  countInput.max = "18";
  countInput.value = String(nationCount);
  countInput.className = "range";
  countInput.addEventListener("input", () => {
    nationCount = Number(countInput.value);
    countLabel.textContent = `初期国家数 ${nationCount}`;
  });
  countRow.appendChild(countLabel);
  countRow.appendChild(countInput);
  modal.appendChild(countRow);

  const seedRow = document.createElement("div");
  seedRow.className = "settings-row";
  seedRow.appendChild(document.createTextNode("シード"));
  const seedInput = document.createElement("input");
  seedInput.type = "text";
  seedInput.className = "select";
  seedInput.value = seedText;
  seedInput.addEventListener("change", () => (seedText = seedInput.value));
  seedRow.appendChild(seedInput);
  modal.appendChild(seedRow);

  actions.appendChild(actionButton("キャンセル", "btn", closeModal));
  actions.appendChild(
    actionButton("生成する", "btn btn--primary", () => {
      closeModal();
      const [, width, height] = sizes[sizeIndex];
      const parsed = Number(seedText);
      startNewWorld({
        width,
        height,
        nationCount,
        landRatio,
        seed: Number.isFinite(parsed) && seedText.trim() !== "" ? Math.floor(parsed) : hashString(seedText)
      });
    })
  );
  modal.appendChild(actions);
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

function closeModal() {
  modalRoot.innerHTML = "";
}

// ==============================================================
// 年送り
// ==============================================================
function advanceYear(fromAuto = false) {
  const events = world.tick();
  lastTickAt = performance.now();
  renderer.invalidate();

  for (const e of events.filter((ev) => ev.importance >= 2).slice(0, 2)) showToast(e.text, "major");

  ticksSinceSave += 1;
  if (!fromAuto || ticksSinceSave >= 5) {
    saveWorld();
    ticksSinceSave = 0;
  }

  refreshHud();
  if (!fromAuto || speedIndex <= 1 || world.year % 3 === 0) renderActiveTab();
}

function toggleAutoPlay() {
  autoPlay = !autoPlay;
  if (autoTimer) {
    window.clearInterval(autoTimer);
    autoTimer = null;
  }
  if (autoPlay) {
    lastTickAt = performance.now();
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

  const step = document.createElement("button");
  step.className = "hud-btn";
  step.textContent = "▸|";
  step.title = "1年進める";
  step.addEventListener("click", () => advanceYear());
  group.appendChild(step);

  const playBtn = document.createElement("button");
  playBtn.className = "hud-btn" + (autoPlay ? " hud-btn--active" : "");
  playBtn.textContent = autoPlay ? "❚❚" : "▶";
  playBtn.addEventListener("click", toggleAutoPlay);
  group.appendChild(playBtn);

  SPEEDS.forEach((speed, i) => {
    const btn = document.createElement("button");
    btn.className = "hud-btn hud-btn--small" + (speedIndex === i ? " hud-btn--active" : "");
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
  peopleNationFilter = "all";
  historyKeyword = "";
  historyCategory = "all";
  tileInspector.style.display = "none";
  saveWorld();
  refreshAll();
  showToast("新しい世界が生まれました");
}

// ==============================================================
// パネル / タブ
// ==============================================================
function renderTabs() {
  const nav = document.getElementById("panel-tabs")!;
  nav.innerHTML = "";
  for (const tab of TABS) {
    const btn = document.createElement("button");
    btn.className = "panel-tab" + (activeTab === tab.id ? " active" : "");
    btn.dataset.tab = tab.id;
    btn.innerHTML = `<span class="panel-tab__icon">${tab.icon}</span><span class="panel-tab__label">${tab.label}</span>`;
    btn.addEventListener("click", () => {
      if (activeTab === tab.id && panelOpen) {
        openPanel(false);
        return;
      }
      activeTab = tab.id;
      openPanel(true);
      renderTabs();
      renderActiveTab();
    });
    nav.appendChild(btn);
  }
}

function openPanel(open: boolean) {
  panelOpen = open;
  panel.classList.toggle("panel--open", open);
  app.classList.toggle("panel-open", open);
  document.getElementById("btn-panel")!.classList.toggle("hud-btn--active", open);
}

// ==============================================================
// 地図モード
// ==============================================================
function renderMapModes() {
  const container = document.getElementById("map-modes")!;
  container.innerHTML = "";
  (Object.keys(MAP_MODE_LABEL) as MapMode[]).forEach((mode) => {
    const btn = document.createElement("button");
    btn.className = "mode-chip" + (renderer.mode === mode ? " mode-chip--active" : "");
    btn.textContent = MAP_MODE_LABEL[mode];
    btn.addEventListener("click", () => {
      renderer.mode = mode;
      renderer.invalidate();
      renderMapModes();
    });
    container.appendChild(btn);
  });
}

// ==============================================================
// タイル情報
// ==============================================================
function showTileInfo(clientX: number, clientY: number) {
  const tile = renderer.tileAt(clientX, clientY);
  if (!tile) {
    tileInspector.style.display = "none";
    return;
  }
  const nation = world.getNation(tile.ownerId);
  const city = tile.cityId ? world.getCity(tile.cityId) : undefined;
  const army = renderer.armyAt(clientX, clientY);

  const lines = [
    `${TERRAIN_LABEL[tile.terrain]}${tile.river ? " ・ 川" : ""} (${tile.x},${tile.y})`,
    nation ? `<b style="color:${nation.color}">${nation.name}</b>領` : "無主の地",
    city ? `${city.isCapital ? "★" : "◍"} ${city.name} 人口${city.population.toLocaleString()}` : "",
    army ? `⚔ ${world.getNation(army.nationId)?.name ?? ""} ${army.name} 兵${army.strength}` : "",
    tile.resource ? `資源: ${RESOURCE_LABEL[tile.resource]}` : "",
    `肥沃度 ${Math.round(tile.fertility * 100)}`
  ].filter(Boolean);

  tileInspector.style.display = "block";
  tileInspector.innerHTML = lines.map((l) => `<div>${l}</div>`).join("");
}

// ==============================================================
// 入力
// ==============================================================
document.getElementById("btn-panel")!.addEventListener("click", () => openPanel(!panelOpen));
document.getElementById("panel-handle")!.addEventListener("click", () => openPanel(!panelOpen));
document.getElementById("btn-zoom-in")!.addEventListener("click", () => renderer.zoomBy(1.4));
document.getElementById("btn-zoom-out")!.addEventListener("click", () => renderer.zoomBy(1 / 1.4));
document.getElementById("btn-zoom-reset")!.addEventListener("click", () => renderer.resetView());
document.getElementById("btn-labels")!.addEventListener("click", (e) => {
  renderer.showLabels = !renderer.showLabels;
  (e.currentTarget as HTMLElement).classList.toggle("hud-btn--active", renderer.showLabels);
});

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
    if (pinchDistance > 0) renderer.zoomBy(dist / pinchDistance, (a.x + b.x) / 2, (a.y + b.y) / 2);
    pinchDistance = dist;
    dragged = true;
    return;
  }

  const dx = e.clientX - prev.x;
  const dy = e.clientY - prev.y;
  if (Math.abs(dx) + Math.abs(dy) > 2) {
    dragged = true;
    renderer.panBy(dx, dy);
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
  if (ownerId) {
    selectedNationId = ownerId;
    activeTab = "nations";
    renderTabs();
    renderActiveTab();
    refreshHud();
  }
});
canvas.addEventListener("pointercancel", endPointer);
canvas.addEventListener("pointerleave", endPointer);

canvas.addEventListener(
  "wheel",
  (e) => {
    e.preventDefault();
    renderer.zoomBy(e.deltaY < 0 ? 1.16 : 1 / 1.16, e.clientX, e.clientY);
  },
  { passive: false }
);

window.addEventListener("keydown", (e) => {
  const target = e.target as HTMLElement | null;
  if (target && ["INPUT", "SELECT", "TEXTAREA"].includes(target.tagName)) return;

  switch (e.key) {
    case " ":
      e.preventDefault();
      advanceYear();
      break;
    case "a":
    case "A":
      toggleAutoPlay();
      break;
    case "Tab":
      e.preventDefault();
      openPanel(!panelOpen);
      break;
    case "+":
    case "=":
      renderer.zoomBy(1.4);
      break;
    case "-":
      renderer.zoomBy(1 / 1.4);
      break;
    case "0":
      renderer.resetView();
      break;
    default: {
      const n = Number(e.key);
      if (n >= 1 && n <= 6) {
        const modes = Object.keys(MAP_MODE_LABEL) as MapMode[];
        const mode = modes[n - 1];
        if (mode) {
          renderer.mode = mode;
          renderer.invalidate();
          renderMapModes();
        }
      }
    }
  }
});

window.addEventListener("beforeunload", saveWorld);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") saveWorld();
});

// ==============================================================
// 初期化
// ==============================================================
setupPWA();
renderTabs();
renderSpeedGroup();
renderMapModes();
openPanel(panelOpen);
refreshAll();
requestAnimationFrame(frame);