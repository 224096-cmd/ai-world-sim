import "./style.css";
import { GameWorld, WorldSnapshot } from "./core/simulation";
import { WorldConfig, EventCategory, Nation } from "./core/types";
import { MapRenderer } from "./ui/renderer";
import {
  renderNationList,
  renderNationDetail,
  renderPeopleList,
  renderPersonDetail,
  renderHistory
} from "./ui/panels";
import { renderGodPanel, GodActionKind } from "./ui/godActions";
import { ChatController } from "./ai/chatController";
import { aiService, DEFAULT_MODEL_ID, LIGHT_MODEL_ID } from "./ai/aiService";
import { setupPWA } from "./pwaRegister";

const SAVE_KEY = "ai-world-sim:save";
type TabId = "nations" | "people" | "history" | "god" | "settings";

// ==============================================================
// 画面の骨格を組み立てる
// ==============================================================
const app = document.getElementById("app")!;
app.innerHTML = `
  <div class="top-bar">
    <div class="top-bar__title">🌍 AI世界シミュレーター</div>
    <div class="top-bar__year" id="year-display">1年</div>
    <div class="top-bar__spacer"></div>
    <button class="btn btn--primary" id="btn-next-year">次の年へ</button>
    <button class="btn btn--gold" id="btn-auto">自動進行: OFF</button>
    <button class="btn" id="btn-new-world">新しい世界</button>
  </div>
  <div class="main-layout">
    <div class="map-panel">
      <canvas id="world-canvas"></canvas>
      <div class="selection-tag" id="selection-tag" style="display:none;"></div>
      <div class="map-legend">タップ/クリックで国家を選択</div>
    </div>
    <div class="side-panel">
      <div class="tabs">
        <button class="tab active" data-tab="nations">国家</button>
        <button class="tab" data-tab="people">人物</button>
        <button class="tab" data-tab="history">年表</button>
        <button class="tab" data-tab="god">神の力</button>
        <button class="tab" data-tab="settings">設定</button>
      </div>
      <div class="tab-content" id="tab-content"></div>
    </div>
  </div>
  <div id="modal-root"></div>
`;

const yearDisplay = document.getElementById("year-display")!;
const tabContent = document.getElementById("tab-content")!;
const selectionTag = document.getElementById("selection-tag")!;
const canvas = document.getElementById("world-canvas") as HTMLCanvasElement;
const modalRoot = document.getElementById("modal-root")!;

// ==============================================================
// 状態
// ==============================================================
let world = loadOrCreateWorld();
let renderer = new MapRenderer(canvas, world);
let chat = new ChatController(world);

let activeTab: TabId = "nations";
let selectedNationId: string | null = null;
let selectedPersonId: string | null = null;
let historyFilter: EventCategory | "all" = "all";
let autoPlay = false;
let autoTimer: number | null = null;

function loadOrCreateWorld(): GameWorld {
  const raw = localStorage.getItem(SAVE_KEY);
  if (raw) {
    try {
      const snapshot: WorldSnapshot = JSON.parse(raw);
      return GameWorld.fromSnapshot(snapshot);
    } catch (err) {
      console.warn("セーブデータの読み込みに失敗、新しい世界を生成します", err);
    }
  }
  return createNewWorld();
}

function createNewWorld(): GameWorld {
  const config: WorldConfig = {
    width: 52,
    height: 34,
    nationCount: 7,
    seed: Math.floor(Math.random() * 2 ** 31)
  };
  return GameWorld.create(config);
}

function saveWorld() {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(world.toSnapshot()));
  } catch (err) {
    console.warn("自動保存に失敗しました", err);
  }
}

// ==============================================================
// 描画のリフレッシュ
// ==============================================================
function refreshAll() {
  yearDisplay.textContent = `${world.year}年`;
  renderer.draw({ type: selectedNationId ? "nation" : null, id: selectedNationId });
  updateSelectionTag();
  renderActiveTab();
}

function updateSelectionTag() {
  if (selectedNationId) {
    const nation = world.getNation(selectedNationId);
    if (nation) {
      selectionTag.style.display = "block";
      selectionTag.textContent = `選択中: ${nation.name}`;
      return;
    }
  }
  selectionTag.style.display = "none";
}

function renderActiveTab() {
  for (const btn of document.querySelectorAll<HTMLButtonElement>(".tab")) {
    btn.classList.toggle("active", btn.dataset.tab === activeTab);
  }

  if (activeTab === "nations") {
    renderNationsTab();
  } else if (activeTab === "people") {
    renderPeopleTab();
  } else if (activeTab === "history") {
    renderHistoryTab();
  } else if (activeTab === "god") {
    renderGodTab();
  } else if (activeTab === "settings") {
    renderSettingsTab();
  }
}

// -------- 国家タブ --------
function renderNationsTab() {
  tabContent.innerHTML = "";
  const selected = selectedNationId ? world.getNation(selectedNationId) : undefined;

  if (selected && selected.alive) {
    const back = document.createElement("button");
    back.className = "btn";
    back.style.marginBottom = "10px";
    back.textContent = "← 国家一覧に戻る";
    back.addEventListener("click", () => {
      selectedNationId = null;
      refreshAll();
    });
    tabContent.appendChild(back);

    const detail = document.createElement("div");
    tabContent.appendChild(detail);
    renderNationDetail(detail, world, selected, (personId) => {
      selectedPersonId = personId;
      activeTab = "people";
      refreshAll();
    });
  } else {
    const list = document.createElement("div");
    tabContent.appendChild(list);
    renderNationList(list, world, selectedNationId, (id) => {
      selectedNationId = id;
      refreshAll();
    });
  }
}

// -------- 人物タブ --------
function renderPeopleTab() {
  tabContent.innerHTML = "";
  const selected = selectedPersonId ? world.getPerson(selectedPersonId) : undefined;

  if (selected && selected.alive) {
    const back = document.createElement("button");
    back.className = "btn";
    back.style.marginBottom = "10px";
    back.textContent = "← 人物一覧に戻る";
    back.addEventListener("click", () => {
      selectedPersonId = null;
      refreshAll();
    });
    tabContent.appendChild(back);

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
      chat.render(chatBox, selected, nation, () => {
        // achievements更新後、詳細を再描画(会話ログ反映)せずチャットは維持
      });
    }
  } else {
    const list = document.createElement("div");
    tabContent.appendChild(list);
    renderPeopleList(list, world, selectedPersonId, (id) => {
      selectedPersonId = id;
      refreshAll();
    });
  }
}

// -------- 年表タブ --------
function renderHistoryTab() {
  tabContent.innerHTML = "";

  const filterRow = document.createElement("div");
  filterRow.style.display = "flex";
  filterRow.style.flexWrap = "wrap";
  filterRow.style.gap = "6px";
  filterRow.style.marginBottom = "10px";

  const filters: [EventCategory | "all", string][] = [
    ["all", "すべて"],
    ["war", "戦争"],
    ["diplomacy", "外交"],
    ["nature", "天災/豊作"],
    ["succession", "継承"],
    ["discovery", "技術/発見"],
    ["divine", "神の力"]
  ];
  for (const [key, label] of filters) {
    const btn = document.createElement("button");
    btn.className = "btn" + (historyFilter === key ? " btn--gold" : "");
    btn.style.fontSize = "0.72rem";
    btn.style.padding = "5px 9px";
    btn.textContent = label;
    btn.addEventListener("click", () => {
      historyFilter = key;
      renderHistoryTab();
    });
    filterRow.appendChild(btn);
  }
  tabContent.appendChild(filterRow);

  const list = document.createElement("div");
  tabContent.appendChild(list);
  renderHistory(list, world, historyFilter);
}

// -------- 神の力タブ --------
function renderGodTab() {
  tabContent.innerHTML = "";
  renderGodPanel(tabContent, (kind) => {
    openNationPicker("対象の国家を選んでください", (nation) => {
      handleGodAction(kind, nation);
    });
  });
}

async function handleGodAction(kind: GodActionKind, nation: Nation) {
  switch (kind) {
    case "disaster":
      world.godDisaster(nation.id);
      break;
    case "blessing":
      world.godBlessing(nation.id);
      break;
    case "resource":
      world.godDiscoverResource(nation.id);
      break;
    case "lowerTax":
      world.godProclaimLaw(nation.id, "lowerTax");
      break;
    case "raiseTax":
      world.godProclaimLaw(nation.id, "raiseTax");
      break;
    case "militarize":
      world.godProclaimLaw(nation.id, "militarize");
      break;
    case "openTrade":
      world.godProclaimLaw(nation.id, "openTrade");
      break;
    case "oracle":
      await handleOracle(nation);
      break;
  }
  saveWorld();
  refreshAll();
}

async function handleOracle(nation: Nation) {
  const king = world.kingOf(nation.id);
  const prompt = [
    `あなたは世界を見守る「語り部」です。${nation.name}という国の運命について、`,
    `詩的で少し神秘的な短い神託(2文以内、日本語)を告げてください。`,
    `${nation.name}の状況: 人口${nation.population}、安定度${nation.stability}/100、`,
    `王は${king?.name ?? "不在"}。`
  ].join("");

  const { text } = await aiService.generate(
    prompt,
    () => `${nation.name}よ、汝の道は霧に包まれている。されど星々はまだ、その名を忘れてはいない。`,
    { maxNewTokens: 60 }
  );

  world.recordAiNarrative("divine", text, [nation.id], king ? [king.id] : []);
}

// -------- 設定タブ --------
function renderSettingsTab() {
  tabContent.innerHTML = "";

  tabContent.appendChild(labelRow("ローカルAI (約1GBのモデル)", ""));

  const enableRow = document.createElement("div");
  enableRow.className = "settings-row";
  const enableLabel = document.createElement("span");
  enableLabel.textContent = "ローカルAIを有効化";
  const enableToggle = document.createElement("button");
  enableToggle.className = "btn" + (aiService.enabled ? " btn--gold" : "");
  enableToggle.textContent = aiService.enabled ? "ON" : "OFF";
  enableToggle.addEventListener("click", () => {
    aiService.enabled = !aiService.enabled;
    renderSettingsTab();
  });
  enableRow.appendChild(enableLabel);
  enableRow.appendChild(enableToggle);
  tabContent.appendChild(enableRow);

  const modelRow = document.createElement("div");
  modelRow.className = "settings-row";
  const modelLabel = document.createElement("span");
  modelLabel.textContent = "モデルサイズ";
  const modelSelect = document.createElement("select");
  modelSelect.style.background = "var(--bg)";
  modelSelect.style.color = "var(--text-main)";
  modelSelect.style.border = "1px solid var(--border)";
  modelSelect.style.borderRadius = "4px";
  modelSelect.innerHTML = `
    <option value="${LIGHT_MODEL_ID}">軽量 (低スペック端末向け)</option>
    <option value="${DEFAULT_MODEL_ID}">標準 (約1GB)</option>
  `;
  modelSelect.value = aiService.modelId;
  modelSelect.addEventListener("change", () => {
    aiService.modelId = modelSelect.value;
  });
  modelRow.appendChild(modelLabel);
  modelRow.appendChild(modelSelect);
  tabContent.appendChild(modelRow);

  const statusRow = document.createElement("div");
  statusRow.className = "settings-row";
  const statusText = document.createElement("span");
  statusText.id = "ai-status-text";
  statusText.style.color = "var(--text-muted)";
  statusText.style.fontSize = "0.75rem";
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
    "AIは王との会話・神託など「物語」が必要な場面のみ使用します。国家運営や戦争などの通常処理はAIなしで高速に動作します。無効時やモデル未読込時は自動的にテンプレート文で応答します。初回読み込み時のみモデルをダウンロードし、以降はオフラインでも動作します。";
  tabContent.appendChild(note);

  tabContent.appendChild(labelRow("セーブデータ", ""));
  const saveRow = document.createElement("div");
  saveRow.className = "settings-row";
  saveRow.appendChild(document.createTextNode("この世界は自動的にブラウザへ保存されます"));
  const resetBtn = document.createElement("button");
  resetBtn.className = "btn btn--danger";
  resetBtn.textContent = "世界をリセット";
  resetBtn.addEventListener("click", () => confirmModal("本当に世界をリセットしますか?元に戻せません。", () => {
    localStorage.removeItem(SAVE_KEY);
    startNewWorld();
  }));
  saveRow.appendChild(resetBtn);
  tabContent.appendChild(saveRow);
}

function labelRow(text: string, sub: string): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "section-title";
  wrap.textContent = text;
  if (sub) wrap.title = sub;
  return wrap;
}

// ==============================================================
// AI進捗の反映
// ==============================================================
aiService.onProgress((p) => {
  const el = document.getElementById("ai-status-text");
  if (el) el.textContent = p.message;
});

// ==============================================================
// モーダル (国家選択 / 確認)
// ==============================================================
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
    card.innerHTML = `<div class="card__title"><span class="swatch" style="background:${nation.color}"></span>${nation.name}</div>`;
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
  modalRoot.appendChild(backdrop);
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
function advanceYear() {
  world.tick();
  saveWorld();
  refreshAll();
}

function toggleAutoPlay() {
  autoPlay = !autoPlay;
  const btn = document.getElementById("btn-auto")!;
  btn.textContent = `自動進行: ${autoPlay ? "ON" : "OFF"}`;
  btn.classList.toggle("btn--gold", autoPlay);

  if (autoPlay) {
    autoTimer = window.setInterval(advanceYear, 2500);
  } else if (autoTimer) {
    window.clearInterval(autoTimer);
    autoTimer = null;
  }
}

function startNewWorld() {
  if (autoPlay) toggleAutoPlay();
  world = createNewWorld();
  renderer = new MapRenderer(canvas, world);
  chat = new ChatController(world);
  selectedNationId = null;
  selectedPersonId = null;
  historyFilter = "all";
  saveWorld();
  refreshAll();
}

// ==============================================================
// イベント結線
// ==============================================================
document.getElementById("btn-next-year")!.addEventListener("click", advanceYear);
document.getElementById("btn-auto")!.addEventListener("click", toggleAutoPlay);
document.getElementById("btn-new-world")!.addEventListener("click", () => {
  confirmModal("新しい世界を生成しますか?現在の進行状況は失われます。", startNewWorld);
});

document.querySelectorAll<HTMLButtonElement>(".tab").forEach((btn) => {
  btn.addEventListener("click", () => {
    activeTab = btn.dataset.tab as TabId;
    refreshAll();
  });
});

canvas.addEventListener("click", (e) => {
  const ownerId = renderer.hitTest(e.clientX, e.clientY);
  if (ownerId) {
    selectedNationId = ownerId;
    activeTab = "nations";
    refreshAll();
  }
});

window.addEventListener("resize", () => {
  renderer.draw({ type: selectedNationId ? "nation" : null, id: selectedNationId });
});

// ==============================================================
// 初期化
// ==============================================================
setupPWA();
refreshAll();
