export type GodActionKind =
  | "disaster"
  | "blessing"
  | "resource"
  | "plague"
  | "uprising"
  | "hero"
  | "city"
  | "peace"
  | "lowerTax"
  | "raiseTax"
  | "militarize"
  | "openTrade"
  | "oracle";

export interface GodActionDef {
  kind: GodActionKind;
  icon: string;
  label: string;
  cost: number;
  hint: string;
}

/** 神の力の一覧。cost は「信仰力」の消費量 */
export const GOD_ACTIONS: GodActionDef[] = [
  { kind: "disaster", icon: "⚡", label: "天災を下す", cost: 25, hint: "人口-25% 安定度-18" },
  { kind: "plague", icon: "☠️", label: "疫病を放つ", cost: 22, hint: "人口-20% 軍-10%" },
  { kind: "uprising", icon: "🔥", label: "蜂起を扇動", cost: 20, hint: "安定度-30 軍-15%" },
  { kind: "blessing", icon: "🌾", label: "恵みを与える", cost: 18, hint: "国庫+ 安定度+15" },
  { kind: "resource", icon: "💎", label: "資源を授ける", cost: 15, hint: "領内に資源が出現" },
  { kind: "hero", icon: "🛡️", label: "英雄を遣わす", cost: 30, hint: "傑出した将軍が登場" },
  { kind: "city", icon: "🏛️", label: "都市を興す", cost: 35, hint: "領内に新都市を建設" },
  { kind: "peace", icon: "🕊️", label: "戦を止める", cost: 28, hint: "その国の戦争をすべて終結" },
  { kind: "lowerTax", icon: "📉", label: "減税の詔", cost: 8, hint: "税率-5% 安定度+6" },
  { kind: "raiseTax", icon: "📈", label: "増税の詔", cost: 8, hint: "税率+5% 安定度-6" },
  { kind: "militarize", icon: "⚔️", label: "軍拡/軍縮の詔", cost: 10, hint: "軍事重視を切替" },
  { kind: "openTrade", icon: "🚢", label: "交易開放/鎖国", cost: 10, hint: "交易方針を切替" },
  { kind: "oracle", icon: "🔮", label: "神託を授ける", cost: 12, hint: "AIまたは定型文で神託" }
];

export function renderGodPanel(
  container: HTMLElement,
  faith: number,
  faithRegen: number,
  onAction: (action: GodActionDef) => void
) {
  container.innerHTML = "";

  const meter = document.createElement("div");
  meter.className = "faith-meter";
  meter.innerHTML = `<span>信仰力</span><strong>${faith}</strong><span class="faith-meter__regen">(毎年 +${faithRegen})</span>`;
  container.appendChild(meter);

  const hint = document.createElement("div");
  hint.className = "card__meta";
  hint.style.marginBottom = "10px";
  hint.textContent =
    "信仰力は年を進めるごとに回復します。力を行使すると対象の国家を選択します。";
  container.appendChild(hint);

  const grid = document.createElement("div");
  grid.className = "god-grid";
  for (const action of GOD_ACTIONS) {
    const btn = document.createElement("button");
    const affordable = faith >= action.cost;
    btn.className = "god-action" + (affordable ? "" : " god-action--locked");
    btn.disabled = !affordable;
    btn.innerHTML =
      `<span class="god-action__icon">${action.icon}</span>` +
      `<span class="god-action__label">${action.label}</span>` +
      `<span class="god-action__cost">信仰 ${action.cost}</span>` +
      `<span class="god-action__hint">${action.hint}</span>`;
    btn.addEventListener("click", () => onAction(action));
    grid.appendChild(btn);
  }
  container.appendChild(grid);
}