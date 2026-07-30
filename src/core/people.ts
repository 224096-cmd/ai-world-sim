import { Rng } from "./rng";
import { NameGenerator } from "./nameGenerator";
import { Gender, Nation, Person, PersonRole } from "./types";
import { nextId } from "./ids";

function randomTraits(rng: Rng, bias = 0) {
  const roll = (min: number, max: number) =>
    Math.max(0, Math.min(100, rng.int(min, max) + bias));
  return {
    wisdom: roll(10, 95),
    ambition: roll(10, 95),
    cruelty: roll(0, 80),
    charisma: roll(10, 95)
  };
}

/** 親の資質を少し受け継ぐ(±20程度のブレ) */
function inheritTraits(parent: Person, rng: Rng) {
  const mix = (v: number) => Math.max(0, Math.min(100, Math.round(v * 0.5 + rng.int(10, 90) * 0.5 + rng.int(-12, 12))));
  return {
    wisdom: mix(parent.traits.wisdom),
    ambition: mix(parent.traits.ambition),
    cruelty: mix(parent.traits.cruelty),
    charisma: mix(parent.traits.charisma)
  };
}

export interface CreatePersonOptions {
  gender?: Gender;
  age?: number;
  dynasty?: string;
  parent?: Person | null;
  traitBias?: number;
}

export function createPerson(
  nation: Nation,
  role: PersonRole,
  names: NameGenerator,
  rng: Rng,
  currentYear: number,
  opts: CreatePersonOptions = {}
): Person {
  const gender: Gender = opts.gender ?? (rng.bool() ? "m" : "f");
  const age = opts.age ?? (role === "heir" ? rng.int(1, 14) : rng.int(22, 52));
  const dynasty = opts.dynasty ?? (role === "king" || role === "heir" ? nation.dynasty : "");
  // 王族は王朝の姓を名乗る
  const surname = dynasty
    ? names.surnameOfDynasty(nation.cultureId, dynasty)
    : undefined;

  return {
    id: nextId("person"),
    name: names.personName(nation.cultureId, gender, surname),
    role,
    nationId: nation.id,
    age,
    gender,
    dynasty,
    parentId: opts.parent?.id ?? null,
    traits: opts.parent ? inheritTraits(opts.parent, rng) : randomTraits(rng, opts.traitBias ?? 0),
    alive: true,
    bornYear: currentYear - age,
    achievements: []
  };
}

/** 王の子として世継ぎを生む */
export function createHeir(
  nation: Nation,
  king: Person,
  names: NameGenerator,
  rng: Rng,
  currentYear: number
): Person {
  return createPerson(nation, "heir", names, rng, currentYear, {
    age: 0,
    dynasty: king.dynasty || nation.dynasty,
    parent: king
  });
}

/** 建国時の宮廷一式(王・世継ぎ・将軍・商人・学者) */
export function spawnCourt(
  nation: Nation,
  names: NameGenerator,
  rng: Rng,
  currentYear: number
): Person[] {
  const king = createPerson(nation, "king", names, rng, currentYear, {
    age: rng.int(24, 46),
    dynasty: nation.dynasty
  });
  king.reignStart = currentYear;
  nation.kingId = king.id;

  const heir = createPerson(nation, "heir", names, rng, currentYear, {
    age: rng.int(1, 16),
    dynasty: nation.dynasty,
    parent: king
  });

  const general = createPerson(nation, "general", names, rng, currentYear);
  const merchant = createPerson(nation, "merchant", names, rng, currentYear);
  const scholar = createPerson(nation, "scholar", names, rng, currentYear);

  return [king, heir, general, merchant, scholar];
}

/** 役職の代表者(最も能力の高い生存者)を返す */
export function bestOfRole(
  people: Person[],
  nationId: string,
  role: PersonRole,
  key: "wisdom" | "ambition" | "cruelty" | "charisma"
): Person | undefined {
  let best: Person | undefined;
  for (const p of people) {
    if (!p.alive || p.nationId !== nationId || p.role !== role) continue;
    if (!best || p.traits[key] > best.traits[key]) best = p;
  }
  return best;
}