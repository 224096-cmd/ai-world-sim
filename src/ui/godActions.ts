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
  | "conscription"
  | "oracle";

export interface GodActionDef {
  kind: GodActionKind;
  icon: string;
  label: string;
  cost: number;
  hint: string;
  group: "災厄" | "恩恵" | "詔";
}

/** 神の力の一覧。cost は「信仰力」の消費量 */
export const GOD_ACTIONS: GodActionDef[] = [
  { kind: "disaster", icon: "⚡", label: "天災", cost: 25, hint: "人口-25% 安定-18", group: "災厄" },
  { kind: "plague", icon: "☠️", label: "疫病", cost: 22, hint: "人口-20% 軍-10%", group: "災厄" },
  { kind: "uprising", icon: "🔥", label: "蜂起扇動", cost: 20, hint: "安定-30 都市の不満+", group: "災厄" },
  { kind: "blessing", icon: "🌾", label: "恵み", cost: 18, hint: "国庫+ 安定+15", group: "恩恵" },
  { kind: "resource", icon: "💎", label: "資源", cost: 15, hint: "領内に資源が出現", group: "恩恵" },
  { kind: "hero", icon: "🛡️", label: "英雄", cost: 30, hint: "傑出した将軍が登場", group: "恩恵" },
  { kind: "city", icon: "🏛️", label: "都市建設", cost: 35, hint: "領内に新都市", group: "恩恵" },
  { kind: "peace", icon: "🕊️", label: "停戦", cost: 28, hint: "戦争をすべて終結", group: "恩恵" },
  { kind: "oracle", icon: "🔮", label: "神託", cost: 12, hint: "AI/定型文で神託", group: "恩恵" },
  { kind: "lowerTax", icon: "📉", label: "減税", cost: 8, hint: "税率-5% 安定+6", group: "詔" },
  { kind: "raiseTax", icon: "📈", label: "増税", cost: 8, hint: "税率+5% 安定-6", group: "詔" },
  { kind: "militarize", icon: "⚔️", label: "軍拡/軍縮", cost: 10, hint: "軍事重視を切替", group: "詔" },
  { kind: "conscription", icon: "🎖️", label: "徴兵令", cost: 12, hint: "兵力+35% 安定-", group: "詔" },
  { kind: "openTrade", icon: "🚢", label: "交易/鎖国", cost: 10, hint: "交易方針を切替", group: "詔" }
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
  meter.innerHTML = `<span>信仰力</span><strong>${faith}</strong><span class="faith-meter__regen">毎年 +${faithRegen}</span>`;
  container.appendChild(meter);

  for (const group of ["災厄", "恩恵", "詔"] as const) {
    const title = document.createElement("div");
    title.className = "section-title";
    title.textContent = group;
    container.appendChild(title);

    const grid = document.createElement("div");
    grid.className = "god-grid";
    for (const action of GOD_ACTIONS.filter((a) => a.group === group)) {
      const btn = document.createElement("button");
      const affordable = faith >= action.cost;
      btn.className = "god-action" + (affordable ? "" : " god-action--locked");