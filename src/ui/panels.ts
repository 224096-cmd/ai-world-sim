import { GameWorld } from "../core/simulation";
import { powerScore } from "../core/nations";
import { cultureLabel } from "../core/nameGenerator";
import { City, EventCategory, Nation, Person, PersonRole } from "../core/types";

const ROLE_LABEL: Record<PersonRole, string> = {
  king: "王",
  heir: "世継ぎ",
  general: "将軍",
  merchant: "商人",
  scholar: "学者"
};

const RELATION_LABEL: Record<string, string> = {
  peace: "平和",
  war: "交戦中",
  alliance: "同盟",
  vassal: "従属"
};

const RELATION_COLOR: Record<string, string> = {
  peace: "var(--text-muted)",
  war: "var(--crimson)",
  alliance: "var(--ink-green)",
  vassal: "#a06bb0"
};

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

/** 0-100 の値を横棒で表示する */
function bar(label: string, value: number, max = 100, color = "var(--gold)"): HTMLElement {
  const wrap = el("div", "meter");
  const head = el("div", "meter__head");
  head.appendChild(el("span", undefined, label));
  head.appendChild(el("span", "meter__value", String(Math.round(value))));
  const track = el("div", "meter__track");
  const fill = el("div", "meter__fill");
  fill.style.width = `${Math.max(0, Math.min(100, (value / max) * 100))}%`;
  fill.style.background = color;
  track.appendChild(fill);
  wrap.appendChild(head);
  wrap.appendChild(track);
  return wrap;
}

function badge(text: string, color: string): HTMLElement {
  const b = el("span", "badge", text);
  b.style.borderColor = color;
  b.style.color = color;
  return b;
}

// ================= 国家一覧 =================
export function renderNationList(
  container: HTMLElement,
  world: GameWorld,
  selectedId: string | null,
  onSelect: (id: string) => void
) {
  container.innerHTML = "";
  const living = world.livingNations().sort((a, b) => powerScore(b) - powerScore(a));

  if (living.length === 0) {
    container.appendChild(el("div", "empty-hint", "すべての国家が滅びました…"));
    return;
  }

  const maxPower = powerScore(living[0]);

  for (const nation of living) {
    const card = el("div", "card" + (selectedId === nation.id ? " selected" : ""));
    const title = el("div", "card__title");
    const swatch = el("span", "swatch");
    swatch.style.background = nation.color;
    title.appendChild(swatch);
    title.appendChild(document.createTextNode(nation.name));

    if (Object.values(nation.relations).some((r) => r.status === "war")) {
      title.appendChild(badge("戦争", "var(--crimson)"));
    }
    if (nation.overlordId) title.appendChild(badge("従属", "#a06bb0"));
    card.appendChild(title);

    card.appendChild(
      el(
        "div",
        "card__meta",
        `人口 ${nation.population.toLocaleString()} ・ 領土 ${nation.territory.size} ・ 都市 ${nation.cityIds.length} ・ 技術 Lv.${nation.techLevel}`
      )
    );
    card.appendChild(bar("国力", powerScore(nation), Math.max(1, maxPower), nation.color));
    card.addEventListener("click", () => onSelect(nation.id));
    container.appendChild(card);
  }
}

// ================= 国家詳細 =================
export interface NationDetailHandlers {
  onSelectPerson: (id: string) => void;
  onFocusCity: (city: City) => void;
  onSelectNation: (id: string) => void;
}

export function renderNationDetail(
  container: HTMLElement,
  world: GameWorld,
  nation: Nation,
  handlers: NationDetailHandlers
) {
  container.innerHTML = "";

  const header = el("div", "detail-header");
  header.appendChild(el("h3", undefined, nation.name));
  const swatch = el("span", "swatch");
  swatch.style.background = nation.color;
  header.appendChild(swatch);
  container.appendChild(header);

  const overlord = world.getNation(nation.overlordId);
  container.appendChild(
    el(
      "div",
      "card__meta",
      `建国 ${nation.founded}年 ・ ${cultureLabel(nation.cultureId)}文化 ・ ${nation.dynasty}` +
        (overlord ? ` ・ ${overlord.name}の従属国` : "")
    )
  );

  // --- 統治者 ---
  const king = world.kingOf(nation.id);
  if (king) {
    container.appendChild(el("div", "section-title", "統治者"));
    const card = el("div", "card");
    card.appendChild(
      el("div", "card__title", `👑 ${king.name}`)
    );
    const reign = king.reignStart !== undefined ? `${king.reignStart}年即位・在位${world.year - king.reignStart}年` : "";
    card.appendChild(el("div", "card__meta", `${king.age}歳 ・ ${reign}`));
    card.addEventListener("click", () => handlers.onSelectPerson(king.id));
    container.appendChild(card);
  }

  // --- 国勢 ---
  container.appendChild(el("div", "section-title", "国勢"));
  const grid = el("div", "stat-grid");
  const stats: [string, string][] = [
    ["人口", nation.population.toLocaleString()],
    ["国庫", nation.treasury.toLocaleString()],
    ["軍事力", nation.military.toLocaleString()],
    ["技術Lv", `${nation.techLevel} / 12`],
    ["領土", `${nation.territory.size} タイル`],
    ["税率", `${Math.round(nation.laws.taxRate * 100)}%`]
  ];
  for (const [label, value] of stats) {
    const row = document.createElement("div");
    row.innerHTML = `${label}: <strong>${value}</strong>`;
    grid.appendChild(row);
  }
  container.appendChild(grid);
  container.appendChild(bar("安定度", nation.stability, 100, "var(--ink-green)"));
  container.appendChild(bar("厭戦気分", nation.warExhaustion, 100, "var(--crimson)"));

  const laws = el("div", "chip-row");
  laws.appendChild(badge(nation.laws.militaryFocus ? "軍拡" : "軍縮", "var(--gold-dim)"));
  laws.appendChild(badge(nation.laws.tradeOpen ? "交易開放" : "鎖国", "var(--gold-dim)"));
  container.appendChild(laws);

  // --- 都市 ---
  const cities = world.citiesOf(nation.id).sort((a, b) => b.population - a.population);
  container.appendChild(el("div", "section-title", `都市 (${cities.length})`));
  if (cities.length === 0) {
    container.appendChild(el("div", "card__meta", "都市なし"));
  }
  for (const city of cities) {
    const card = el("div", "card");
    card.appendChild(el("div", "card__title", `${city.isCapital ? "★ " : "・"}${city.name}`));
    card.appendChild(
      el(
        "div",
        "card__meta",
        `人口 ${city.population.toLocaleString()} ・ 繁栄 ${Math.round(city.prosperity)} ・ 城壁 ${Math.round(city.fortification)} ・ ${city.founded}年建設`
      )
    );
    card.addEventListener("click", () => handlers.onFocusCity(city));
    container.appendChild(card);
  }

  // --- 外交 ---
  container.appendChild(el("div", "section-title", "外交"));
  const relations = Object.entries(nation.relations).filter(([id]) => world.getNation(id)?.alive);
  if (relations.length === 0) {
    container.appendChild(el("div", "card__meta", "既知の他国なし"));
  }
  for (const [otherId, rel] of relations.sort((a, b) => a[1].score - b[1].score)) {
    const other = world.getNation(otherId);
    if (!other) continue;
    const row = el("div", "relation-row");
    const name = el("span", undefined, other.name);
    const status = el("span", undefined, `${RELATION_LABEL[rel.status]} (${Math.round(rel.score)})`);
    status.style.color = RELATION_COLOR[rel.status] ?? "var(--text-muted)";
    row.appendChild(name);
    row.appendChild(status);
    row.addEventListener("click", () => handlers.onSelectNation(other.id));
    container.appendChild(row);
  }

  // --- 主要人物 ---
  container.appendChild(el("div", "section-title", "宮廷"));
  const people = world.peopleOf(nation.id).filter((p) => p.id !== nation.kingId);
  if (people.length === 0) container.appendChild(el("div", "card__meta", "登録された人物なし"));
  for (const person of people) {
    const card = el("div", "card");
    card.appendChild(el("div", "card__title", person.name));
    card.appendChild(el("div", "card__meta", `${ROLE_LABEL[person.role]} ・ ${person.age}歳`));
    card.addEventListener("click", () => handlers.onSelectPerson(person.id));
    container.appendChild(card);
  }

  // --- 年代記 ---
  container.appendChild(el("div", "section-title", "この国の年代記"));
  const chronicle = world.eventsOfNation(nation.id, 30);
  if (chronicle.length === 0) container.appendChild(el("div", "card__meta", "記録なし"));
  for (const e of chronicle) {
    const item = el("div", "event-item " + (CATEGORY_CLASS[e.category] ?? ""));
    item.appendChild(el("span", "event-year", `${e.year}年`));
    item.appendChild(document.createTextNode(e.text));
    container.appendChild(item);
  }
}

// ================= 人物一覧 =================
export function renderPeopleList(
  container: HTMLElement,
  world: GameWorld,
  selectedId: string | null,
  nationFilter: string | "all",
  onSelect: (id: string) => void,
  onFilterChange: (value: string | "all") => void
) {
  container.innerHTML = "";

  const filterRow = el("div", "chip-row");
  const allChip = el("button", "chip" + (nationFilter === "all" ? " chip--active" : ""), "すべて");
  allChip.addEventListener("click", () => onFilterChange("all"));
  filterRow.appendChild(allChip);
  for (const nation of world.livingNations()) {
    const chip = el("button", "chip" + (nationFilter === nation.id ? " chip--active" : ""), nation.name);
    chip.style.borderColor = nation.color;
    chip.addEventListener("click", () => onFilterChange(nation.id));
    filterRow.appendChild(chip);
  }
  container.appendChild(filterRow);

  const rolePriority: Record<PersonRole, number> = { king: 0, heir: 1, general: 2, merchant: 3, scholar: 4 };
  const people = world.people
    .filter((p) => p.alive && (nationFilter === "all" || p.nationId === nationFilter))
    .filter((p) => world.getNation(p.nationId)?.alive)
    .sort((a, b) => rolePriority[a.role] - rolePriority[b.role]);

  if (people.length === 0) {
    container.appendChild(el("div", "empty-hint", "生存している人物がいません"));
    return;
  }

  for (const person of people.slice(0, 120)) {
    const nation = world.getNation(person.nationId)!;
    const card = el("div", "card" + (selectedId === person.id ? " selected" : ""));
    const title = el("div", "card__title");
    const swatch = el("span", "swatch");
    swatch.style.background = nation.color;
    title.appendChild(swatch);
    title.appendChild(
      document.createTextNode(`${person.name}${person.id === nation.kingId ? " 👑" : ""}`)
    );
    card.appendChild(title);
    card.appendChild(
      el("div", "card__meta", `${nation.name} ・ ${ROLE_LABEL[person.role]} ・ ${person.age}歳`)
    );
    card.addEventListener("click", () => onSelect(person.id));
    container.appendChild(card);
  }
}

// ================= 人物詳細 =================
export function renderPersonDetail(container: HTMLElement, world: GameWorld, person: Person) {
  container.innerHTML = "";
  const nation = world.getNation(person.nationId);
  const parent = world.getPerson(person.parentId);

  const header = el("div", "detail-header");
  header.appendChild(
    el("h3", undefined, `${person.name}${person.id === nation?.kingId ? " 👑" : ""}`)
  );
  container.appendChild(header);

  const lines = [
    `${nation?.name ?? "不明"} ・ ${ROLE_LABEL[person.role]} ・ ${person.age}歳 (${person.gender === "m" ? "男" : "女"})`,
    person.dynasty ? `${person.dynasty}${parent ? ` ・ ${parent.name}の子` : ""}` : "",
    person.reignStart !== undefined
      ? `${person.reignStart}年即位 (在位${Math.max(0, world.year - person.reignStart)}年)`
      : `${person.bornYear}年生まれ`
  ].filter(Boolean);
  for (const line of lines) container.appendChild(el("div", "card__meta", line));

  container.appendChild(el("div", "section-title", "資質"));
  container.appendChild(bar("知恵", person.traits.wisdom));
  container.appendChild(bar("野心", person.traits.ambition, 100, "#c47a3a"));
  container.appendChild(bar("冷酷さ", person.traits.cruelty, 100, "var(--crimson)"));
  container.appendChild(bar("カリスマ", person.traits.charisma, 100, "var(--ink-green)"));

  const hint = el("div", "card__meta");
  hint.style.marginTop = "8px";
  hint.textContent =
    "知恵は技術と内政、野心は開戦しやすさ、冷酷さは軍の強さと不安定さ、カリスマは安定度と外交に影響します。";
  container.appendChild(hint);

  const related = world.events
    .filter((e) => e.personIds.includes(person.id))
    .slice(-10)
    .reverse();
  if (related.length > 0) {
    container.appendChild(el("div", "section-title", "この人物の記録"));
    for (const e of related) {
      const item = el("div", "event-item " + (CATEGORY_CLASS[e.category] ?? ""));
      item.appendChild(el("span", "event-year", `${e.year}年`));
      item.appendChild(document.createTextNode(e.text));
      container.appendChild(item);
    }
  }

  if (person.achievements.length > 0) {
    container.appendChild(el("div", "section-title", "会話の記録"));
    for (const a of person.achievements.slice(-5)) {
      container.appendChild(el("div", "card__meta", a));
    }
  }
}

// ================= 年表 / ニュース =================
const CATEGORY_CLASS: Partial<Record<EventCategory, string>> = {
  war: "event-item--war",
  diplomacy: "event-item--diplomacy",
  nature: "event-item--nature",
  economy: "event-item--economy",
  city: "event-item--city",
  succession: "event-item--succession",
  ai: "event-item--ai",
  divine: "event-item--ai"
};

export interface HistoryOptions {
  category: EventCategory | "all";
  keyword: string;
  majorOnly: boolean;
  limit?: number;
}

export function renderHistory(container: HTMLElement, world: GameWorld, options: HistoryOptions) {
  container.innerHTML = "";
  const keyword = options.keyword.trim();

  const events = world.events
    .filter((e) => options.category === "all" || e.category === options.category)
    .filter((e) => !options.majorOnly || e.importance >= 1)
    .filter((e) => keyword === "" || e.text.includes(keyword))
    .slice(-(options.limit ?? 120))
    .reverse();

  if (events.length === 0) {
    container.appendChild(el("div", "empty-hint", "該当する出来事はありません"));
    return;
  }

  for (const event of events) {
    const item = el(
      "div",
      "event-item " + (CATEGORY_CLASS[event.category] ?? "") + (event.importance >= 2 ? " event-item--major" : "")
    );
    item.appendChild(el("span", "event-year", `${event.year}年`));
    item.appendChild(document.createTextNode(event.text));
    container.appendChild(item);
  }
}