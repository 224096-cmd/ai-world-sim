export type GodActionKind =
  | "disaster"
  | "blessing"
  | "resource"
  | "lowerTax"
  | "raiseTax"
  | "militarize"
  | "openTrade"
  | "oracle";

interface GodActionDef {
  kind: GodActionKind;
  icon: string;
  label: string;
}

const ACTIONS: GodActionDef[] = [
  { kind: "disaster", icon: "⚡", label: "天災を下す" },
  { kind: "blessing", icon: "🌾", label: "恵みを与える" },
  { kind: "resource", icon: "💎", label: "資源を発見させる" },
  { kind: "lowerTax", icon: "📉", label: "減税の詔" },
  { kind: "raiseTax", icon: "📈", label: "増税の詔" },
  { kind: "militarize", icon: "⚔️", label: "軍拡/軍縮の詔" },
  { kind: "openTrade", icon: "🚢", label: "交易開放/鎖国" },
  { kind: "oracle", icon: "🔮", label: "神託を授ける (AI)" }
];

export function renderGodPanel(container: HTMLElement, onAction: (kind: GodActionKind) => void) {
  container.innerHTML = "";
  const hint = document.createElement("div");
  hint.className = "card__meta";
  hint.style.marginBottom = "10px";
  hint.textContent = "対象の国家を選んでから、下の力を行使してください。";
  container.appendChild(hint);

  const grid = document.createElement("div");
  grid.className = "god-grid";
  for (const action of ACTIONS) {
    const btn = document.createElement("button");
    btn.className = "god-action";
    btn.innerHTML = `<span class="god-action__icon">${action.icon}</span>${action.label}`;
    btn.addEventListener("click", () => onAction(action.kind));
    grid.appendChild(btn);
  }
  container.appendChild(grid);
}
