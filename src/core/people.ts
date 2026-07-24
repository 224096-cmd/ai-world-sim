import { Rng } from "./rng";
import { NameGenerator } from "./nameGenerator";
import { Nation, Person, PersonRole } from "./types";
import { nextPersonId } from "./nations";

function randomTraits(rng: Rng) {
  return {
    wisdom: rng.int(10, 95),
    ambition: rng.int(10, 95),
    cruelty: rng.int(0, 80),
    charisma: rng.int(10, 95)
  };
}

export function createPerson(
  nation: Nation,
  role: PersonRole,
  names: NameGenerator,
  rng: Rng,
  currentYear: number
): Person {
  return {
    id: nextPersonId(),
    name: names.personName(nation.id),
    role,
    nationId: nation.id,
    age: role === "heir" ? rng.int(3, 16) : rng.int(20, 55),
    traits: randomTraits(rng),
    alive: true,
    bornYear: currentYear - rng.int(20, 55),
    achievements: []
  };
}

/** 建国時の主要人物一式(王・将軍・商人・学者)を生成する */
export function spawnCourt(
  nation: Nation,
  names: NameGenerator,
  rng: Rng,
  currentYear: number
): Person[] {
  const king = createPerson(nation, "king", names, rng, currentYear);
  nation.kingId = king.id;

  const general = createPerson(nation, "general", names, rng, currentYear);
  const merchant = createPerson(nation, "merchant", names, rng, currentYear);
  const scholar = createPerson(nation, "scholar", names, rng, currentYear);

  return [king, general, merchant, scholar];
}
