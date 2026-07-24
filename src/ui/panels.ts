import { GameWorld } from "../core/simulation";
import { EventCategory, Nation, Person, PersonRole } from "../core/types";

const ROLE_LABEL: Record<PersonRole, string> = {
  king: "王",
  heir: "王",
  general: "将軍",
  merchant: "商人",
  scholar: "学者"
};

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

// ================= 国家一覧 =================
export function renderNationList(
  container: HTMLElement,
  world: GameWorld,
  selectedId: string | null,
  onSelect: (id: string) => void
) {
  container.innerHTML = "";
  const living = world.livingNations().sort((a, b) => b.population - a.population);

  if (living.length === 0) {
    container.appendChild(el("div", "empty-hint", "すべての国家が滅びました…"));
    return;
  }

  for (const nation of living) {
    const card = el("div", "card" + (selectedId === nation.id ? " selected" : ""));
    const title = el("div", "card__title");
    const swatch = el("span", "swatch");
    swatch.style.background = nation.color;
    title.appendChild(swatch);
    title.appendChild(document.createTextNode(nation.name));
    card.appendChild(title);
    card.appendChild(
      el(
        "div",
        "card__meta",
        `人口 ${nation.population.toLocaleString()} ・ 領土 ${nation.territory.size} ・ 技術 Lv.${nation.techLevel}`
      )
    );
    card.addEventListener("click", () => onSelect(nation.id));
    container.appendChild(card);
  }
}

const RELATION_LABEL: Record<string, string> = {
  peace: "平和",
  war: "交戦中",
  alliance: "同盟",
  vassal: "従属"
};

// ================= 国家詳細 =================
export function renderNationDetail(
  container: HTMLElement,
  world: GameWorld,
  nation: Nation,
  onSelectPerson: (id: string) => void
) {
  container.innerHTML = "";

  const header = el("div", "detail-header");
  const h3 = el("h3", undefined, nation.name);
  header.appendChild(h3);
  const swatch = el("span", "swatch");
  swatch.style.background = nation.color;
  header.appendChild(swatch);
  container.appendChild(header);

  container.appendChild(el("div", "card__meta", `建国 ${nation.founded}年`));

  const grid = el("div", "stat-grid");
  const stats: [string, string][] = [
    ["人口", nation.population.toLocaleString()],
    ["国庫", nation.treasury.toLocaleString()],
    ["軍事力", nation.military.toLocaleString()],
    ["技術Lv", String(nation.techLevel)],
    ["安定度", `${nation.stability}/100`],
    ["税率", `${Math.round(nation.laws.taxRate * 100)}%`]
  ];
  for (const [label, value] of stats) {
    const row = document.createElement("div");
    row.innerHTML = `${label}: <strong>${value}</strong>`;
    grid.appendChild(row);
  }
  container.appendChild(grid);

  container.appendChild(el("div", "section-title", "外交"));
  const relList = el("div");
  const relations = Object.entries(nation.relations).filter(([id]) => world.getNation(id)?.alive);
  if (relations.length === 0) {
    relList.appendChild(el("div", "card__meta", "既知の他国なし"));
  } else {
    for (const [otherId, rel] of relations) {
      const other = world.getNation(otherId);
      if (!other) continue;
      const row = el("div", "card__meta", `${other.name}: ${RELATION_LABEL[rel.status]} (${rel.score})`);
      relList.appendChild(row);
    }
  }
  container.appendChild(relList);

  container.appendChild(el("div", "section-title", "主要人物"));
  const people = world.peopleOf(nation.id);
  if (people.length === 0) {
    container.appendChild(el("div", "card__meta", "登録された人物なし"));
  }
  for (const person of people) {
    const card = el("div", "card");
    const title = el(
      "div",
      "card__title",
      `${person.name}${person.id === nation.kingId ? " 👑" : ""}`
    );
    card.appendChild(title);
    card.appendChild(
      el("div", "card__meta", `${ROLE_LABEL[person.role]} ・ ${person.age}歳`)
    );
    card.addEventListener("click", () => onSelectPerson(person.id));
    container.appendChild(card);
  }
}

// ================= 人物一覧 =================
export function renderPeopleList(
  container: HTMLElement,
  world: GameWorld,
  selectedId: string | null,
  onSelect: (id: string) => void
) {
  container.innerHTML = "";
  const people = world.people
    .filter((p) => p.alive)
    .sort((a, b) => (a.role === "king" ? -1 : 0) - (b.role === "king" ? -1 : 0));

  if (people.length === 0) {
    container.appendChild(el("div", "empty-hint", "生存している人物がいません"));
    return;
  }

  for (const person of people) {
    const nation = world.getNation(person.nationId);
    if (!nation?.alive) continue;
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

  const header = el("div", "detail-header");
  header.appendChild(
    el("h3", undefined, `${person.name}${person.id === nation?.kingId ? " 👑" : ""}`)
  );
  container.appendChild(header);
  container.appendChild(
    el("div", "card__meta", `${nation?.name ?? "不明"} ・ ${ROLE_LABEL[person.role]} ・ ${person.age}歳`)
  );

  const grid = el("div", "stat-grid");
  const stats: [string, number][] = [
    ["知恵", person.traits.wisdom],
    ["野心", person.traits.ambition],
    ["冷酷さ", person.traits.cruelty],
    ["カリスマ", person.traits.charisma]
  ];
  for (const [label, value] of stats) {
    const row = document.createElement("div");
    row.innerHTML = `${label}: <strong>${value}</strong>`;
    grid.appendChild(row);
  }
  container.appendChild(grid);

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
  ai: "event-item--ai",
  divine: "event-item--ai"
};

export function renderHistory(
  container: HTMLElement,
  world: GameWorld,
  filter: EventCategory | "all" = "all",
  limit = 80
) {
  container.innerHTML = "";
  const events = world.events
    .filter((e) => filter === "all" || e.category === filter)
    .slice(-limit)
    .reverse();

  if (events.length === 0) {
    container.appendChild(el("div", "empty-hint", "まだ歴史が記されていません"));
    return;
  }

  for (const event of events) {
    const item = el("div", "event-item " + (CATEGORY_CLASS[event.category] ?? ""));
    item.appendChild(el("span", "event-year", `${event.year}年`));
    item.appendChild(document.createTextNode(event.text));
    container.appendChild(item);
  }
}
