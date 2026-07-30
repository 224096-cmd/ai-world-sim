import { GameWorld } from "../core/simulation";
import { powerScore } from "../core/nations";
import { cultureLabel } from "../core/nameGenerator";
import { Army, City, EventCategory, Nation, Person, PersonRole, ROLE_LABEL } from "../core/types";
import { insertInlineAd, renderAd } from "../ads";

const RELATION_LABEL: Record<string, string> = {
  peace: "平和",
  war: "交戦中",
  alliance: "同盟",
  vassal: "従属",
  truce: "休戦"
};

const RELATION_COLOR: Record<string, string> = {
  peace: "var(--text-muted)",
  war: "var(--crimson)",
  alliance: "var(--ink-green)",
  vassal: "#a06bb0",
  truce: "var(--gold-dim)"
};

const ARMY_STATE_LABEL: Record<string, string> = {
  idle: "待機",
  march: "進軍中",
  siege: "包囲中",
  battle: "交戦中",
  retreat: "撤退中"
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

function renameButton(onClick: () => void): HTMLElement {
  const btn = el("button", "icon-btn", "✎");
  btn.title = "名前を変更";
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    onClick();
  });
  return btn;
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
  container.appendChild(el("div", "list-caption", `現存 ${living.length}か国`));

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
        `人口 ${nation.population.toLocaleString()} ・ 領${nation.territory.size} ・ 都市${nation.cityIds.length} ・ 技Lv${nation.techLevel}`
      )
    );
    card.appendChild(bar("国力", powerScore(nation), Math.max(1, maxPower), nation.color));
    card.addEventListener("click", () => onSelect(nation.id));
    container.appendChild(card);
  }

  insertInlineAd(container, 6);
  renderAd(container, "panel-bottom");
}

// ================= 国家詳細 =================
export interface NationDetailHandlers {
  onSelectPerson: (id: string) => void;
  onFocusCity: (city: City) => void;
  onFocusArmy: (army: Army) => void;
  onSelectNation: (id: string) => void;
  onRenameNation: (nation: Nation) => void;
  onRenameCity: (city: City) => void;
}

export function renderNationDetail(
  container: HTMLElement,
  world: GameWorld,
  nation: Nation,
  handlers: NationDetailHandlers
) {
  container.innerHTML = "";

  const header = el("div", "detail-header");
  const h3 = el("h3", undefined, nation.name);
  header.appendChild(h3);
  header.appendChild(renameButton(() => handlers.onRenameNation(nation)));
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

  const king = world.kingOf(nation.id);
  if (king) {
    container.appendChild(el("div", "section-title", "統治者"));
    const card = el("div", "card");
    card.appendChild(el("div", "card__title", `👑 ${king.name}`));
    const reign =
      king.reignStart !== undefined ? `${king.reignStart}年即位・在位${world.year - king.reignStart}年` : "";
    card.appendChild(el("div", "card__meta", `${king.age}歳 ・ ${reign}`));
    card.addEventListener("click", () => handlers.onSelectPerson(king.id));
    container.appendChild(card);
  }

  container.appendChild(el("div", "section-title", "国勢"));
  const grid = el("div", "stat-grid");
  const stats: [string, string][] = [
    ["人口", nation.population.toLocaleString()],
    ["国庫", nation.treasury.toLocaleString()],
    ["兵力", nation.military.toLocaleString()],
    ["技術", `Lv${nation.techLevel}/12`],
    ["領土", `${nation.territory.size}`],
    ["税率", `${Math.round(nation.laws.taxRate * 100)}%`]
  ];
  for (const [label, value] of stats) {
    const row = document.createElement("div");
    row.innerHTML = `${label}: <strong>${value}</strong>`;
    grid.appendChild(row);
  }
  container.appendChild(grid);
  container.appendChild(bar("安定度", nation.stability, 100, "var(--ink-green)"));
  container.appendChild(bar("正統性", nation.legitimacy, 100, "var(--gold)"));
  container.appendChild(bar("厭戦", nation.warExhaustion, 100, "var(--crimson)"));

  const laws = el("div", "chip-row");
  laws.appendChild(badge(nation.laws.militaryFocus ? "軍拡" : "軍縮", "var(--gold-dim)"));
  laws.appendChild(badge(nation.laws.tradeOpen ? "交易開放" : "鎖国", "var(--gold-dim)"));
  if (nation.laws.conscription) laws.appendChild(badge("徴兵令", "var(--crimson)"));
  container.appendChild(laws);

  // --- 軍団 ---
  const armies = world.armiesOf(nation.id);
  if (armies.length > 0) {
    container.appendChild(el("div", "section-title", `軍団 (${armies.length})`));
    for (const army of armies) {
      const target = world.getNation(army.targetNationId);
      const card = el("div", "card");
      card.appendChild(el("div", "card__title", `⚔ ${army.name}`));
      card.appendChild(
        el(
          "div",
          "card__meta",
          `兵${army.strength} ・ 士気${Math.round(army.morale)} ・ ${ARMY_STATE_LABEL[army.state] ?? army.state}` +
            (target ? ` → ${target.name}` : "")
        )
      );
      card.addEventListener("click", () => handlers.onFocusArmy(army));
      container.appendChild(card);
    }
  }

  // --- 都市 ---
  const cities = world.citiesOf(nation.id).sort((a, b) => b.population - a.population);
  container.appendChild(el("div", "section-title", `都市 (${cities.length})`));
  if (cities.length === 0) container.appendChild(el("div", "card__meta", "都市なし"));
  for (const city of cities.slice(0, 30)) {
    const card = el("div", "card");
    const title = el("div", "card__title", `${city.isCapital ? "★ " : "・"}${city.name}`);
    if (city.siegeBy) title.appendChild(badge("包囲", "var(--crimson)"));
    if (city.unrest > 60) title.appendChild(badge("不穏", "#c47a3a"));
    title.appendChild(renameButton(() => handlers.onRenameCity(city)));
    card.appendChild(title);
    card.appendChild(
      el(
        "div",
        "card__meta",
        `人口 ${city.population.toLocaleString()} ・ 繁栄${Math.round(city.prosperity)} ・ 城壁${Math.round(city.fortification)} ・ 不満${Math.round(city.unrest)}`
      )
    );
    card.addEventListener("click", () => handlers.onFocusCity(city));
    container.appendChild(card);
  }

  // --- 外交 ---
  container.appendChild(el("div", "section-title", "外交"));
  const relations = Object.entries(nation.relations).filter(([id]) => world.getNation(id)?.alive);
  if (relations.length === 0) container.appendChild(el("div", "card__meta", "既知の他国なし"));
  for (const [otherId, rel] of relations.sort((a, b) => a[1].score - b[1].score).slice(0, 20)) {
    const other = world.getNation(otherId);
    if (!other) continue;
    const row = el("div", "relation-row");
    const left = el("span", "relation-row__name");
    const sw = el("span", "swatch");
    sw.style.background = other.color;
    left.appendChild(sw);
    left.appendChild(document.createTextNode(other.name));
    const status = el("span", undefined, `${RELATION_LABEL[rel.status]} ${Math.round(rel.score)}`);
    status.style.color = RELATION_COLOR[rel.status] ?? "var(--text-muted)";
    row.appendChild(left);
    row.appendChild(status);
    row.addEventListener("click", () => handlers.onSelectNation(other.id));
    container.appendChild(row);
  }

  // --- 宮廷 ---
  container.appendChild(el("div", "section-title", "宮廷"));
  const people = world.peopleOf(nation.id).filter((p) => p.id !== nation.kingId);
  if (people.length === 0) container.appendChild(el("div", "card__meta", "人物なし"));
  for (const person of people) {
    const card = el("div", "card");
    card.appendChild(el("div", "card__title", person.name));
    card.appendChild(
      el("div", "card__meta", `${ROLE_LABEL[person.role]} ・ ${person.age}歳 ・ 忠誠${Math.round(person.loyalty)}`)
    );
    card.addEventListener("click", () => handlers.onSelectPerson(person.id));
    container.appendChild(card);
  }

  container.appendChild(el("div", "section-title", "この国の年代記"));
  const chronicle = world.eventsOfNation(nation.id, 30);
  if (chronicle.length === 0) container.appendChild(el("div", "card__meta", "記録なし"));
  for (const e of chronicle) {
    const item = el("div", "event-item " + (CATEGORY_CLASS[e.category] ?? ""));
    item.appendChild(el("span", "event-year", `${e.year}年`));
    item.appendChild(document.createTextNode(e.text));
    container.appendChild(item);
  }

  renderAd(container, "detail-end");
}

// ================= 人物一覧 =================
export function renderPeopleList(
  container: HTMLElement,
  world: GameWorld,
  selectedId: string | null,
  nationFilter: string | "all",
  roleFilter: PersonRole | "all",
  onSelect: (id: string) => void,
  onNationFilter: (value: string | "all") => void,
  onRoleFilter: (value: PersonRole | "all") => void
) {
  container.innerHTML = "";

  const roleRow = el("div", "chip-row");
  const roles: (PersonRole | "all")[] = ["all", "king", "general", "spy", "scholar", "merchant", "priest", "diplomat"];
  for (const role of roles) {
    const chip = el("button", "chip" + (roleFilter === role ? " chip--active" : ""), role === "all" ? "全役職" : ROLE_LABEL[role]);
    chip.addEventListener("click", () => onRoleFilter(role));
    roleRow.appendChild(chip);
  }
  container.appendChild(roleRow);

  const nationRow = el("div", "chip-row");
  const allChip = el("button", "chip" + (nationFilter === "all" ? " chip--active" : ""), "全国家");
  allChip.addEventListener("click", () => onNationFilter("all"));
  nationRow.appendChild(allChip);
  for (const nation of world.livingNations().slice(0, 20)) {
    const chip = el("button", "chip" + (nationFilter === nation.id ? " chip--active" : ""), nation.name);
    chip.style.borderColor = nation.color;
    chip.addEventListener("click", () => onNationFilter(nation.id));
    nationRow.appendChild(chip);
  }
  container.appendChild(nationRow);

  const priority: Record<PersonRole, number> = {
    king: 0, heir: 1, general: 2, spy: 3, scholar: 4, merchant: 5, priest: 6, diplomat: 7
  };
  const people = world.people
    .filter((p) => p.alive)
    .filter((p) => nationFilter === "all" || p.nationId === nationFilter)
    .filter((p) => roleFilter === "all" || p.role === roleFilter)
    .filter((p) => world.getNation(p.nationId)?.alive)
    .sort((a, b) => priority[a.role] - priority[b.role]);

  if (people.length === 0) {
    container.appendChild(el("div", "empty-hint", "該当する人物がいません"));
    return;
  }

  container.appendChild(el("div", "list-caption", `${people.length}人`));
  for (const person of people.slice(0, 150)) {
    const nation = world.getNation(person.nationId)!;
    const card = el("div", "card" + (selectedId === person.id ? " selected" : ""));
    const title = el("div", "card__title");
    const swatch = el("span", "swatch");
    swatch.style.background = nation.color;
    title.appendChild(swatch);
    title.appendChild(document.createTextNode(`${person.name}${person.id === nation.kingId ? " 👑" : ""}`));
    card.appendChild(title);
    card.appendChild(el("div", "card__meta", `${nation.name} ・ ${ROLE_LABEL[person.role]} ・ ${person.age}歳`));
    card.addEventListener("click", () => onSelect(person.id));
    container.appendChild(card);
  }

  insertInlineAd(container, 11);
  renderAd(container, "panel-bottom");
}

// ================= 人物詳細 =================
export function renderPersonDetail(
  container: HTMLElement,
  world: GameWorld,
  person: Person,
  onRename: (person: Person) => void
) {
  container.innerHTML = "";
  const nation = world.getNation(person.nationId);
  const parent = world.getPerson(person.parentId);

  const header = el("div", "detail-header");
  header.appendChild(el("h3", undefined, `${person.name}${person.id === nation?.kingId ? " 👑" : ""}`));
  header.appendChild(renameButton(() => onRename(person)));
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
  container.appendChild(bar("忠誠心", person.loyalty, 100, "#7a9bd4"));

  const hint = el("div", "card__meta");
  hint.style.marginTop = "8px";
  hint.textContent =
    "知恵=技術と内政、野心=開戦と謀反、冷酷さ=軍の強さ、カリスマ=安定度と外交、忠誠心が低いと亡命や謀反が起きます。";
  container.appendChild(hint);

  const related = world.events.filter((e) => e.personIds.includes(person.id)).slice(-12).reverse();
  if (related.length > 0) {
    container.appendChild(el("div", "section-title", "記録"));
    for (const e of related) {
      const item = el("div", "event-item " + (CATEGORY_CLASS[e.category] ?? ""));
      item.appendChild(el("span", "event-year", `${e.year}年`));
      item.appendChild(document.createTextNode(e.text));
      container.appendChild(item);
    }
  }

  if (person.achievements.length > 0) {
    container.appendChild(el("div", "section-title", "会話・功績"));
    for (const a of person.achievements.slice(-6)) container.appendChild(el("div", "card__meta", a));
  }

  renderAd(container, "detail-end");
}

// ================= 年表 =================
const CATEGORY_CLASS: Partial<Record<EventCategory, string>> = {
  war: "event-item--war",
  diplomacy: "event-item--diplomacy",
  nature: "event-item--nature",
  economy: "event-item--economy",
  city: "event-item--city",
  succession: "event-item--succession",
  intrigue: "event-item--intrigue",
  ai: "event-item--ai",
  divine: "event-item--ai"
};

export interface HistoryOptions {
  category: EventCategory | "all";
  keyword: string;
  majorOnly: boolean;
  limit?: number;
}

export function renderHistory(
  container: HTMLElement,
  world: GameWorld,
  options: HistoryOptions,
  onFocus?: (x: number, y: number) => void
) {
  container.innerHTML = "";
  const keyword = options.keyword.trim();

  const events = world.events
    .filter((e) => options.category === "all" || e.category === options.category)
    .filter((e) => !options.majorOnly || e.importance >= 1)
    .filter((e) => keyword === "" || e.text.includes(keyword))
    .slice(-(options.limit ?? 140))
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
    if (event.x !== undefined && event.y !== undefined && onFocus) {
      item.classList.add("event-item--locatable");
      item.addEventListener("click", () => onFocus(event.x!, event.y!));
    }
    container.appendChild(item);
  }

  insertInlineAd(container, 14);
  insertInlineAd(container, 36);
  renderAd(container, "panel-bottom");
}