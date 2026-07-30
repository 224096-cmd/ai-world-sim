import { Rng } from "./rng";
import { NameGenerator } from "./nameGenerator";
import {
  Army,
  BattleMark,
  City,
  COURT_ROLES,
  GodInterventionLog,
  Migration,
  Nation,
  Person,
  PersonRole,
  RESOURCE_LABEL,
  ResourceType,
  StatPoint,
  WorldConfig,
  WorldEvent
} from "./types";
import { generateWorld, WorldMap, findLandTile, isCoast, tileKey } from "./worldgen";
import {
  areAdjacent,
  carveRegion,
  computeAdjacency,
  createNation,
  expandTerritory,
  pickColor,
  powerScore,
  relationOf,
  spawnNations,
  transferTile
} from "./nations";
import { armySteps, battlePower, createArmy, stepArmy } from "./armies";
import { bestOfRole, createHeir, createPerson, spawnCourt } from "./people";
import { attachCity, cityIncome, createCity, findCitySite, updateCities } from "./cities";
import { generateTemplateEvent, makeAiEvent } from "./events";
import { getIdCounters, IdCounters, nextId, resetIdCounters, setIdCounters } from "./ids";

const START_YEAR = 1;
export const SNAPSHOT_VERSION = 3;

const MAX_EVENTS = 520;
const MAX_PEOPLE_RECORDS = 520;
const MAX_MARKS = 60;
const MAX_NATIONS = 30;
const STAT_INTERVAL = 5;
const MAX_STATS = 140;

export interface WorldSnapshot {
  version: number;
  config: WorldConfig;
  year: number;
  faith: number;
  counters: IdCounters;
  nations: (Omit<Nation, "territory"> & { territory: string[] })[];
  people: Person[];
  cities: City[];
  armies: Army[];
  events: WorldEvent[];
  battles: BattleMark[];
  migrations: Migration[];
  godLog: GodInterventionLog[];
}

export class GameWorld {
  map: WorldMap;
  nations: Nation[] = [];
  people: Person[] = [];
  cities: City[] = [];
  armies: Army[] = [];
  events: WorldEvent[] = [];
  battles: BattleMark[] = [];
  migrations: Migration[] = [];
  godLog: GodInterventionLog[] = [];
  year = START_YEAR;
  faith = 30;
  rng: Rng;
  names: NameGenerator;
  config: WorldConfig;

  private adjacency: Map<string, Set<string>> = new Map();
  private pending: WorldEvent[] = [];
  // ID -> 実体の索引。毎年の処理で何千回も参照するため線形探索を避ける
  private nationById = new Map<string, Nation>();
  private personById = new Map<string, Person>();
  private cityById = new Map<string, City>();
  private armyById = new Map<string, Army>();

  private constructor(config: WorldConfig) {
    this.config = config;
    this.rng = new Rng(config.seed);
    this.names = new NameGenerator(this.rng);
    this.map = generateWorld(config);
  }

  static create(config: WorldConfig): GameWorld {
    resetIdCounters();
    const world = new GameWorld(config);
    world.nations = spawnNations(world.map, config.nationCount, world.rng, world.names, START_YEAR);

    for (const nation of world.nations) {
      const court = spawnCourt(nation, world.names, world.rng, START_YEAR);
      world.addPeople(court);
      const king = court.find((p) => p.role === "king")!;

      const capital = createCity(
        nation,
        nation.capital.x,
        nation.capital.y,
        world.names,
        world.rng,
        START_YEAR,
        true
      );
      world.addCity(capital);
      attachCity(nation, capital, world.map);
      nation.capitalCityId = capital.id;

      world.pushEvent(
        generateTemplateEvent(
          "founding",
          "founding",
          START_YEAR,
          { nation: nation.name, king: king.name, capital: capital.name },
          world.rng,
          [nation.id],
          [king.id],
          2,
          { x: capital.x, y: capital.y }
        )
      );
    }

    world.adjacency = computeAdjacency(world.map);
    world.reindex();
    return world;
  }

  // ================= 参照ヘルパー =================
  /** 配列から索引を作り直す (毎年の開始時とロード直後に実行) */
  private reindex() {
    this.nationById = new Map(this.nations.map((n) => [n.id, n]));
    this.personById = new Map(this.people.map((p) => [p.id, p]));
    this.cityById = new Map(this.cities.map((c) => [c.id, c]));
    this.armyById = new Map(this.armies.map((a) => [a.id, a]));
  }

  private addNation(n: Nation) {
    this.nations.push(n);
    this.nationById.set(n.id, n);
  }
  private addPerson(p: Person) {
    this.people.push(p);
    this.personById.set(p.id, p);
  }
  private addPeople(list: Person[]) {
    for (const p of list) this.addPerson(p);
  }
  private addCity(c: City) {
    this.cities.push(c);
    this.cityById.set(c.id, c);
  }
  private addArmy(a: Army) {
    this.armies.push(a);
    this.armyById.set(a.id, a);
  }

  getNation(id: string | null | undefined): Nation | undefined {
    if (!id) return undefined;
    return this.nationById.get(id) ?? this.nations.find((n) => n.id === id);
  }
  getPerson(id: string | null | undefined): Person | undefined {
    if (!id) return undefined;
    return this.personById.get(id) ?? this.people.find((p) => p.id === id);
  }
  getCity(id: string | null | undefined): City | undefined {
    if (!id) return undefined;
    return this.cityById.get(id) ?? this.cities.find((c) => c.id === id);
  }
  getArmy(id: string | null | undefined): Army | undefined {
    if (!id) return undefined;
    return this.armyById.get(id) ?? this.armies.find((a) => a.id === id);
  }
  /** 新しい国を作る余地があるか (巨大帝国の崩壊だけは上限を無視して起こる) */
  canSpawnNation(force = false): boolean {
    return this.livingNations().length < MAX_NATIONS + (force ? 6 : 0);
  }
  livingNations(): Nation[] {
    return this.nations.filter((n) => n.alive);
  }
  peopleOf(nationId: string): Person[] {
    return this.people.filter((p) => p.nationId === nationId && p.alive);
  }
  citiesOf(nationId: string): City[] {
    return this.cities.filter((c) => c.nationId === nationId);
  }
  armiesOf(nationId: string): Army[] {
    return this.armies.filter((a) => a.nationId === nationId);
  }
  kingOf(nationId: string): Person | undefined {
    return this.getPerson(this.getNation(nationId)?.kingId);
  }
  eventsOfNation(nationId: string, limit = 40): WorldEvent[] {
    return this.events.filter((e) => e.nationIds.includes(nationId)).slice(-limit).reverse();
  }
  enemiesOf(nation: Nation): Nation[] {
    return this.livingNations().filter((n) => nation.relations[n.id]?.status === "war");
  }
  isAtWar(nation: Nation): boolean {
    return Object.values(nation.relations).some((r) => r.status === "war");
  }

  private pushEvent(e: WorldEvent) {
    this.events.push(e);
    this.pending.push(e);
  }

  private ev(
    key: string,
    category: WorldEvent["category"],
    ctx: Record<string, string | number>,
    nationIds: string[] = [],
    personIds: string[] = [],
    importance: 0 | 1 | 2 = 0,
    pos?: { x: number; y: number }
  ) {
    this.pushEvent(
      generateTemplateEvent(key, category, this.year, ctx, this.rng, nationIds, personIds, importance, pos)
    );
  }

  private mark(x: number, y: number, kind: BattleMark["kind"], attackerId: string, defenderId: string) {
    this.battles.push({ x, y, year: this.year, kind, attackerId, defenderId });
    if (this.battles.length > MAX_MARKS) this.battles.splice(0, this.battles.length - MAX_MARKS);
  }

  // ==========================================================
  // メインループ
  // ==========================================================
  tick(): WorldEvent[] {
    this.year += 1;
    this.pending = [];
    this.reindex();
    this.adjacency = computeAdjacency(this.map);
    this.syncCities();

    for (const army of this.armies) {
      army.prevX = army.x;
      army.prevY = army.y;
    }

    this.simulateEconomy();
    this.simulateExpansion();
    this.simulateDiplomacy();
    this.simulateArmies();
    this.simulateCities();
    this.simulateSuccession();
    this.simulateIntrigue();
    this.simulateNature();
    this.simulateTech();
    this.simulateUnrest();
    this.simulateAbsorption();
    this.simulateEmergentNations();
    this.checkNationFalls();
    this.recordStats();

    this.faith = Math.min(999, this.faith + this.faithRegen());
    this.trimAll();
    return this.pending;
  }

  faithRegen(): number {
    const pop = this.livingNations().reduce((s, n) => s + n.population, 0);
    return Math.round(3 + Math.min(9, pop / 40000));
  }

  spendFaith(cost: number): boolean {
    if (this.faith < cost) return false;
    this.faith -= cost;
    return true;
  }

  // ---------------- 経済 ----------------
  private foodCapacity(nation: Nation): number {
    let fertility = 0;
    for (const key of nation.territory) {
      const [x, y] = key.split(",").map(Number);
      const tile = this.map.tiles[y]?.[x];
      if (tile) fertility += tile.fertility;
    }
    return Math.round(fertility * 2400 * (1 + nation.techLevel * 0.13));
  }

  private resourceIncome(nation: Nation): number {
    let sum = 0;
    for (const key of nation.territory) {
      const [x, y] = key.split(",").map(Number);
      const r = this.map.tiles[y]?.[x]?.resource;
      if (!r) continue;
      sum += r === "gold" || r === "gem" ? 6 : 3;
    }
    return sum * (1 + nation.techLevel * 0.05);
  }

  private tradeIncome(nation: Nation): number {
    if (!nation.laws.tradeOpen) return 0;
    let sum = 0;
    for (const other of this.livingNations()) {
      if (other.id === nation.id || !other.laws.tradeOpen) continue;
      const rel = nation.relations[other.id];
      if (!rel || rel.status === "war") continue;
      if (!areAdjacent(this.adjacency, nation.id, other.id)) continue;
      sum += (8 + Math.min(nation.techLevel, other.techLevel) * 4) * (rel.status === "alliance" ? 1.6 : 1);
    }
    if (this.hasPort(nation)) sum *= 1.3;
    return sum;
  }

  private hasPort(nation: Nation): boolean {
    for (const city of this.citiesOf(nation.id)) {
      if (isCoast(this.map, city.x, city.y)) return true;
    }
    return false;
  }

  private simulateEconomy() {
    for (const nation of this.livingNations()) {
      const king = this.kingOf(nation.id);
      const merchant = bestOfRole(this.peopleOf(nation.id), nation.id, "merchant", "wisdom");
      const general = bestOfRole(this.peopleOf(nation.id), nation.id, "general", "wisdom");
      const priest = bestOfRole(this.peopleOf(nation.id), nation.id, "priest", "charisma");

      const capacity = Math.max(1, this.foodCapacity(nation));
      const crowd = 1 - nation.population / capacity;
      let growth = 0.02 * crowd * (0.55 + nation.stability / 120);
      growth = clamp(growth, -0.06, 0.05);
      nation.population = Math.max(0, Math.round(nation.population * (1 + growth)));

      if (nation.population > capacity * 1.08 && this.rng.bool(0.2)) {
        nation.population = Math.round(nation.population * 0.94);
        nation.stability = Math.max(0, nation.stability - 5);
        this.ev("overpopulation", "nature", { nation: nation.name }, [nation.id]);
      }

      const tradeSkill = 1 + (merchant?.traits.wisdom ?? 40) / 260;
      const tax =
        nation.population * nation.laws.taxRate * 0.035 * (1 + nation.techLevel * 0.08) * tradeSkill;
      const income =
        tax + cityIncome(nation, this.cities) + this.resourceIncome(nation) + this.tradeIncome(nation);
      const upkeep =
        nation.military * 0.12 * (nation.laws.militaryFocus ? 1.35 : 1) +
        nation.cityIds.length * 6 +
        nation.treasury * 0.03;

      let net = income - upkeep;
      if (nation.overlordId) {
        const overlord = this.getNation(nation.overlordId);
        const tribute = Math.round(Math.max(0, income) * 0.15);
        if (overlord?.alive) overlord.treasury += tribute;
        net -= tribute;
      }
      nation.treasury = Math.round(nation.treasury + net);

      // 動員可能兵力
      const genSkill = general ? general.traits.wisdom * 0.6 + general.traits.cruelty * 0.4 : 40;
      let target =
        (nation.population / 130) *
        (0.6 + nation.techLevel * 0.09) *
        (nation.laws.militaryFocus ? 1.5 : 1) *
        (nation.laws.conscription ? 1.35 : 1) *
        (1 + genSkill / 200);
      if (nation.treasury < 0) {
        target *= 0.75;
        nation.treasury = 0;
        nation.stability = Math.max(0, nation.stability - 2.5);
      }
      nation.military = Math.max(5, Math.round(nation.military + (target - nation.military) * 0.3));

      // 安定度
      let delta = 0.35;
      delta += ((king?.traits.charisma ?? 50) - 50) / 40;
      delta += (priest?.traits.charisma ?? 0) / 220;
      delta -= (nation.laws.taxRate - 0.12) * 30;
      delta -= nation.warExhaustion / 28;
      delta -= nation.laws.conscription ? 0.5 : 0;
      if ((king?.traits.cruelty ?? 30) > 70) delta -= 0.7;
      if (nation.treasury > 400) delta += 0.4;
      delta += nation.cityIds.length * 0.06;
      delta -= Math.min(5, Math.max(0, nation.territory.size - 25) * 0.05);
      delta += (nation.legitimacy - 60) / 120;
      if (this.isAtWar(nation)) delta -= 0.8;
      if (nation.overlordId) delta -= 0.35;
      nation.stability = clamp(nation.stability + delta, 0, 100);
      nation.legitimacy = clamp(nation.legitimacy + 0.4, 0, 100);

      if (!this.isAtWar(nation)) nation.warExhaustion = Math.max(0, nation.warExhaustion - 1.5);

      if (nation.stability > 88 && nation.treasury > 900 && this.rng.bool(0.02)) {
        nation.techLevel = Math.min(12, nation.techLevel + 1);
        this.ev("goldenAge", "economy", { nation: nation.name }, [nation.id], [], 1);
      } else if (nation.stability < 22 && this.rng.bool(0.02)) {
        this.ev("darkAge", "economy", { nation: nation.name }, [nation.id], [], 1);
      }

      if (priest && this.rng.bool(0.03)) {
        nation.stability = Math.min(100, nation.stability + 4);
        this.ev("festival", "economy", { nation: nation.name, priest: priest.name }, [nation.id], [priest.id]);
      }
    }
  }

  // ---------------- 拡張(入植) ----------------
  private simulateExpansion() {
    for (const nation of this.livingNations()) {
      const king = this.kingOf(nation.id);
      const pressure = nation.population / Math.max(1, nation.territory.size * 1500);
      const chance = Math.min(0.85, 0.12 + pressure * 0.35 + (king?.traits.ambition ?? 50) / 450);
      if (!this.rng.bool(chance)) continue;

      const before = nation.territory.size;
      const added = expandTerritory(nation, this.map, this.rng);
      if (!added || nation.territory.size === before) continue;

      const from = this.getCity(nation.capitalCityId);
      const key = Array.from(nation.territory).pop()!;
      const [tx, ty] = key.split(",").map(Number);
      this.migrations.push({
        fromX: from?.x ?? nation.capital.x,
        fromY: from?.y ?? nation.capital.y,
        toX: tx,
        toY: ty,
        nationId: nation.id,
        year: this.year,
        kind: "settle"
      });
      if (this.rng.bool(0.05)) {
        this.ev("settlers", "city", { nation: nation.name }, [nation.id], [], 0, { x: tx, y: ty });
      }
    }
  }

  // ---------------- 外交 ----------------
  private simulateDiplomacy() {
    const nations = this.livingNations();

    for (const a of nations) {
      for (const b of nations) {
        if (a.id >= b.id) continue;
        if (!areAdjacent(this.adjacency, a.id, b.id)) continue;

        const relA = relationOf(a, b.id);
        const relB = relationOf(b, a.id);
        if (relA.status === "war") continue;
        if (relA.status === "truce") {
          if ((relA.truceUntil ?? 0) <= this.year) {
            relA.status = "peace";
            relB.status = "peace";
          } else {
            continue;
          }
        }

        const kingA = this.kingOf(a.id);
        const kingB = this.kingOf(b.id);
        const diplomatA = bestOfRole(this.peopleOf(a.id), a.id, "diplomat", "charisma");
        const diplomatB = bestOfRole(this.peopleOf(b.id), b.id, "diplomat", "charisma");
        const charisma = ((kingA?.traits.charisma ?? 50) + (kingB?.traits.charisma ?? 50)) / 2;
        const powerA = powerScore(a);
        const powerB = powerScore(b);

        let drift = this.rng.range(-3.4, 2.4) + (charisma - 50) / 30;
        drift += ((diplomatA?.traits.charisma ?? 0) + (diplomatB?.traits.charisma ?? 0)) / 160;
        if (a.laws.tradeOpen && b.laws.tradeOpen) drift += 0.5;
        if (a.laws.militaryFocus || b.laws.militaryFocus) drift -= 0.5;
        drift -= Math.min(1.4, Math.abs(powerA - powerB) / 2200);
        if (this.rng.bool(0.05)) drift -= this.rng.int(8, 22);
        relA.score = clamp(relA.score + drift, -100, 100);
        relB.score = relA.score;

        const sameOverlord =
          (a.overlordId && a.overlordId === b.overlordId) ||
          a.overlordId === b.id ||
          b.overlordId === a.id;

        if (relA.score < -45 && relA.status === "peace" && !sameOverlord) {
          const ambition = ((kingA?.traits.ambition ?? 50) + (kingB?.traits.ambition ?? 50)) / 2;
          const ratio = powerA / Math.max(1, powerB);
          if ((ratio > 0.7 || ratio < 1 / 0.7) && this.rng.bool(0.08 + ambition / 700)) {
            this.declareWar(ratio >= 1 ? a : b, ratio >= 1 ? b : a);
            continue;
          }
        }

        if (relA.status === "peace" && !sameOverlord) {
          const strong = powerA >= powerB ? a : b;
          const weak = strong === a ? b : a;
          const ratio = Math.max(powerA, powerB) / Math.max(1, Math.min(powerA, powerB));
          const amb = (strong === a ? kingA : kingB)?.traits.ambition ?? 50;
          if (ratio > 1.6 && amb > 60 && this.rng.bool(0.015 + (amb - 60) / 1200)) {
            this.declareWar(strong, weak);
            continue;
          }
        }

        if (relA.score > 70 && relA.status === "peace" && this.rng.bool(0.06)) {
          relA.status = "alliance";
          relB.status = "alliance";
          relA.since = this.year;
          relB.since = this.year;
          this.ev("allianceFormed", "diplomacy", { nation: a.name, enemy: b.name }, [a.id, b.id], [], 1);
        } else if (relA.status === "alliance" && relA.score < -10) {
          relA.status = "peace";
          relB.status = "peace";
          this.ev("allianceBroken", "diplomacy", { nation: a.name, enemy: b.name }, [a.id, b.id], [], 1);
        } else if (relA.score > 55 && this.rng.bool(0.03)) {
          relA.score = clamp(relA.score + 12, -100, 100);
          relB.score = relA.score;
          this.ev("royalMarriage", "diplomacy", { nation: a.name, enemy: b.name }, [a.id, b.id], [], 1);
        } else if (diplomatA && relA.score < 0 && this.rng.bool(0.05)) {
          relA.score = clamp(relA.score + 14, -100, 100);
          relB.score = relA.score;
          this.ev("treaty", "diplomacy", { nation: a.name, enemy: b.name, diplomat: diplomatA.name }, [a.id, b.id], [diplomatA.id]);
        } else if (relA.status === "peace" && relA.score > 20 && this.rng.bool(0.03)) {
          const merchant = bestOfRole(this.peopleOf(a.id), a.id, "merchant", "wisdom");
          this.ev("tradeRoute", "economy", { nation: a.name, enemy: b.name, merchant: merchant?.name ?? a.name }, [a.id, b.id], merchant ? [merchant.id] : []);
        }
      }
    }
  }

  private declareWar(a: Nation, b: Nation) {
    const relA = relationOf(a, b.id);
    const relB = relationOf(b, a.id);
    relA.status = "war";
    relB.status = "war";
    relA.since = this.year;
    relB.since = this.year;
    const king = this.kingOf(a.id);
    this.ev("warDeclared", "war", { nation: a.name, enemy: b.name, king: king?.name ?? a.name }, [a.id, b.id], king ? [king.id] : [], 2);

    for (const ally of this.livingNations()) {
      if (ally.id === a.id || ally.id === b.id) continue;
      if (b.relations[ally.id]?.status !== "alliance") continue;
      const r1 = relationOf(ally, a.id);
      const r2 = relationOf(a, ally.id);
      if (r1.status === "war") continue;
      r1.status = "war";
      r2.status = "war";
      r1.score = -60;
      r2.score = -60;
      this.ev("warDeclared", "war", { nation: ally.name, enemy: a.name, king: this.kingOf(ally.id)?.name ?? ally.name }, [ally.id, a.id], [], 2);
    }
  }

  // ==========================================================
  // 軍団: 編成 -> 進軍 -> 会戦 -> 攻城 -> 占領
  // ==========================================================
  private simulateArmies() {
    this.armies = this.armies.filter((a) => this.getNation(a.nationId)?.alive);

    for (const nation of this.livingNations()) {
      const own = this.armiesOf(nation.id);
      nation.armyIds = own.map((a) => a.id);

      if (this.isAtWar(nation)) {
        const maxArmies = Math.min(4, 1 + Math.floor(nation.military / 420));
        if (own.length < maxArmies && nation.treasury > 60) {
          const general = bestOfRole(this.peopleOf(nation.id), nation.id, "general", "wisdom");
          const capital = this.getCity(nation.capitalCityId);
          const army = createArmy(
            nation,
            capital?.x ?? nation.capital.x,
            capital?.y ?? nation.capital.y,
            nation.military * 0.35,
            general?.id ?? null,
            own.length + 1
          );
          this.addArmy(army);
          nation.armyIds.push(army.id);
          nation.treasury -= 50;
          this.ev("armyRaised", "war", { nation: nation.name, army: army.name, general: general?.name ?? "無名の将" }, [nation.id], general ? [general.id] : [], 0, { x: army.x, y: army.y });
        }
      }
    }

    for (const army of [...this.armies]) {
      const nation = this.getNation(army.nationId);
      if (!nation?.alive) continue;
      this.assignArmyTarget(army, nation);

      const steps = armySteps(nation);
      for (let i = 0; i < steps; i++) {
        stepArmy(army, this.map);
        if (this.resolveArmyEncounter(army, nation)) break;
      }

      army.morale = clamp(army.morale + (army.state === "retreat" ? -3 : 1.5), 10, 100);
      if (army.state !== "retreat" && !this.isAtWar(nation)) {
        // 平時は帰還して解散
        const home = this.getCity(nation.capitalCityId);
        if (home && Math.round(army.x) === home.x && Math.round(army.y) === home.y) {
          this.armies = this.armies.filter((a) => a.id !== army.id);
          nation.armyIds = nation.armyIds.filter((id) => id !== army.id);
        }
      }
    }

    this.resolveSieges();
    this.checkPeace();
  }

  private assignArmyTarget(army: Army, nation: Nation) {
    const enemies = this.enemiesOf(nation);

    if (enemies.length === 0) {
      const home = this.getCity(nation.capitalCityId);
      army.state = "march";
      army.targetNationId = null;
      army.targetX = home?.x ?? nation.capital.x;
      army.targetY = home?.y ?? nation.capital.y;
      return;
    }

    // 士気が折れた軍は撤退
    if (army.morale < 25) {
      const home = this.getCity(nation.capitalCityId);
      army.state = "retreat";
      army.targetX = home?.x ?? nation.capital.x;
      army.targetY = home?.y ?? nation.capital.y;
      return;
    }

    let best: { x: number; y: number; nationId: string } | null = null;
    let bestScore = Infinity;

    for (const enemy of enemies) {
      for (const city of this.citiesOf(enemy.id)) {
        const d = Math.hypot(city.x - army.x, city.y - army.y);
        const score = d - (city.isCapital ? 5 : 0) - (100 - city.fortification) * 0.05;
        if (score < bestScore) {
          bestScore = score;
          best = { x: city.x, y: city.y, nationId: enemy.id };
        }
      }
      // 都市が無ければ最寄りの敵タイル
      if (!best) {
        for (const key of enemy.territory) {
          const [x, y] = key.split(",").map(Number);
          const d = Math.hypot(x - army.x, y - army.y);
          if (d < bestScore) {
            bestScore = d;
            best = { x, y, nationId: enemy.id };
          }
        }
      }
    }

    if (best) {
      army.targetX = best.x;
      army.targetY = best.y;
      army.targetNationId = best.nationId;
      army.state = "march";
    }
  }

  /** 移動先での会戦・占領。戦闘が起きたら true */
  private resolveArmyEncounter(army: Army, nation: Nation): boolean {
    const x = Math.round(army.x);
    const y = Math.round(army.y);
    const tile = this.map.tiles[y]?.[x];
    if (!tile) return false;

    // --- 敵軍との会戦 ---
    const enemyArmy = this.armies.find(
      (a) =>
        a.id !== army.id &&
        a.nationId !== army.nationId &&
        nation.relations[a.nationId]?.status === "war" &&
        Math.hypot(a.x - army.x, a.y - army.y) <= 1.2
    );

    if (enemyArmy) {
      const enemyNation = this.getNation(enemyArmy.nationId)!;
      const genA = this.getPerson(army.generalId);
      const genB = this.getPerson(enemyArmy.generalId);
      const powerA = battlePower(army, genA?.traits.wisdom ?? 40, tile.terrain, this.rng, false);
      const powerB = battlePower(enemyArmy, genB?.traits.wisdom ?? 40, tile.terrain, this.rng, true);

      const winner = powerA >= powerB ? army : enemyArmy;
      const loser = winner === army ? enemyArmy : army;
      const winnerNation = this.getNation(winner.nationId)!;
      const loserNation = this.getNation(loser.nationId)!;
      const ratio = Math.max(powerA, powerB) / Math.max(1, Math.min(powerA, powerB));

      const winnerLoss = Math.round(winner.strength * 0.12);
      const loserLoss = Math.round(loser.strength * Math.min(0.75, 0.3 + ratio * 0.15));
      winner.strength = Math.max(0, winner.strength - winnerLoss);
      loser.strength = Math.max(0, loser.strength - loserLoss);
      winnerNation.military = Math.max(5, winnerNation.military - winnerLoss);
      loserNation.military = Math.max(5, loserNation.military - loserLoss);
      winner.morale = Math.min(100, winner.morale + 8);
      loser.morale = Math.max(0, loser.morale - 22);
      loser.state = "retreat";
      winnerNation.warExhaustion = Math.min(100, winnerNation.warExhaustion + 1.5);
      loserNation.warExhaustion = Math.min(100, loserNation.warExhaustion + 3);

      const winnerGeneral = this.getPerson(winner.generalId);
      this.mark(x, y, "field", winner.nationId, loser.nationId);
      this.ev(
        "fieldBattle",
        "war",
        {
          nation: winnerNation.name,
          enemy: loserNation.name,
          general: winnerGeneral?.name ?? winnerNation.name,
          place: this.placeName(x, y)
        },
        [winnerNation.id, loserNation.id],
        winnerGeneral ? [winnerGeneral.id] : [],
        1,
        { x, y }
      );

      if (loser.strength <= 5) {
        this.armies = this.armies.filter((a) => a.id !== loser.id);
        loserNation.armyIds = loserNation.armyIds.filter((id) => id !== loser.id);
        this.ev("armyDestroyed", "war", { nation: loserNation.name, army: loser.name, place: this.placeName(x, y) }, [loserNation.id], [], 1, { x, y });
        if (winnerGeneral) winnerGeneral.achievements.push(`${this.year}年 ${this.placeName(x, y)}の勝利`);
      }
      return true;
    }

    // --- 敵領タイルの占領 ---
    if (tile.ownerId && tile.ownerId !== nation.id && nation.relations[tile.ownerId]?.status === "war") {
      const defender = this.getNation(tile.ownerId)!;
      if (!tile.cityId) {
        transferTile(defender, nation, this.map, x, y);
        if (this.rng.bool(0.12)) {
          this.ev("tileTaken", "war", { nation: nation.name, enemy: defender.name }, [nation.id, defender.id], [], 0, { x, y });
        }
      }
    }

    return false;
  }

  /** 都市の包囲判定 */
  private resolveSieges() {
    for (const city of this.cities) {
      const owner = this.getNation(city.nationId);
      if (!owner?.alive) continue;

      const besieger = this.armies.find(
        (a) =>
          a.nationId !== city.nationId &&
          owner.relations[a.nationId]?.status === "war" &&
          Math.round(a.x) === city.x &&
          Math.round(a.y) === city.y
      );

      if (!besieger) {
        if (city.siegeBy) {
          const prev = this.getNation(city.siegeBy);
          city.siegeBy = null;
          if (prev) this.ev("siegeBroken", "war", { nation: prev.name, city: city.name }, [prev.id, owner.id], [], 0, { x: city.x, y: city.y });
        }
        continue;
      }

      const attacker = this.getNation(besieger.nationId)!;
      if (city.siegeBy !== attacker.id) {
        city.siegeBy = attacker.id;
        besieger.state = "siege";
        this.ev("siegeStart", "war", { nation: attacker.name, enemy: owner.name, city: city.name }, [attacker.id, owner.id], [], 1, { x: city.x, y: city.y });
      }

      // 城壁を削る
      const general = this.getPerson(besieger.generalId);
      const siegePower = besieger.strength * (1 + attacker.techLevel * 0.06) * (1 + (general?.traits.wisdom ?? 40) / 250);
      const defense = city.fortification * 9 + city.population * 0.01 + owner.military * 0.15;
      city.fortification = Math.max(0, city.fortification - (siegePower / Math.max(1, defense)) * 12);
      besieger.strength = Math.max(0, Math.round(besieger.strength * 0.97));

      if (city.fortification <= 1 || siegePower > defense * this.rng.range(1.1, 1.8)) {
        this.captureCity(city, attacker, owner);
      }
    }
  }

  private captureCity(city: City, attacker: Nation, defender: Nation) {
    const wasCapital = city.isCapital;
    transferTile(defender, attacker, this.map, city.x, city.y);
    city.nationId = attacker.id;
    city.isCapital = false;
    city.siegeBy = null;
    city.prosperity = Math.max(8, city.prosperity * 0.55);
    city.fortification = Math.max(5, city.fortification * 0.4);
    city.unrest = Math.min(100, city.unrest + 35);
    attacker.treasury += Math.round(city.population * 0.03);
    defender.stability = Math.max(0, defender.stability - (wasCapital ? 18 : 8));
    defender.legitimacy = Math.max(0, defender.legitimacy - (wasCapital ? 15 : 5));

    // 周囲のタイルも一緒に落ちる
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const t = this.map.tiles[city.y + dy]?.[city.x + dx];
        if (t && t.ownerId === defender.id && !t.cityId) {
          transferTile(defender, attacker, this.map, t.x, t.y);
        }
      }
    }

    this.mark(city.x, city.y, "sack", attacker.id, defender.id);
    this.ev(
      wasCapital ? "capitalFallen" : "cityCaptured",
      "war",
      { nation: attacker.name, enemy: defender.name, city: city.name },
      [attacker.id, defender.id],
      [],
      2,
      { x: city.x, y: city.y }
    );
    if (wasCapital) this.relocateCapital(defender);
  }

  /** 厭戦が高まった戦争を終わらせる */
  private checkPeace() {
    const seen = new Set<string>();
    for (const a of this.livingNations()) {
      for (const [otherId, rel] of Object.entries(a.relations)) {
        if (rel.status !== "war") continue;
        const b = this.getNation(otherId);
        if (!b?.alive) {
          rel.status = "peace";
          continue;
        }
        const key = a.id < b.id ? `${a.id}|${b.id}` : `${b.id}|${a.id}`;
        if (seen.has(key)) continue;
        seen.add(key);

        a.warExhaustion = Math.min(100, a.warExhaustion + 0.8);
        b.warExhaustion = Math.min(100, b.warExhaustion + 0.8);

        const noContact = !areAdjacent(this.adjacency, a.id, b.id) && this.armiesOf(a.id).length + this.armiesOf(b.id).length === 0;
        const exhausted = Math.max(a.warExhaustion, b.warExhaustion);
        if (noContact || b.territory.size <= 1 || (exhausted > 45 && this.rng.bool(0.2))) {
          const winner = powerScore(a) >= powerScore(b) ? a : b;
          const loser = winner === a ? b : a;
          const decisive = powerScore(winner) > powerScore(loser) * 2.2 && loser.territory.size <= 8;
          this.makePeace(winner, loser, decisive);
        }
      }
    }
  }

  private makePeace(a: Nation, b: Nation, vassalize: boolean) {
    const relA = relationOf(a, b.id);
    const relB = relationOf(b, a.id);
    relA.score = -25;
    relB.score = -25;
    relA.since = this.year;
    relB.since = this.year;
    a.warExhaustion = Math.max(0, a.warExhaustion - 25);
    b.warExhaustion = Math.max(0, b.warExhaustion - 25);

    for (const city of this.cities) city.siegeBy = null;

    if (vassalize && !b.overlordId && b.id !== a.overlordId) {
      b.overlordId = a.id;
      relA.status = "vassal";
      relB.status = "vassal";
      this.ev("vassalized", "diplomacy", { nation: a.name, enemy: b.name }, [a.id, b.id], [], 2);
    } else {
      relA.status = "truce";
      relB.status = "truce";
      relA.truceUntil = this.year + this.rng.int(8, 20);
      relB.truceUntil = relA.truceUntil;
      this.ev("warDefeatPeace", "diplomacy", { nation: a.name, enemy: b.name }, [a.id, b.id], [], 1);
    }
  }

  private placeName(x: number, y: number): string {
    let nearest: City | null = null;
    let best = Infinity;
    for (const c of this.cities) {
      const d = Math.hypot(c.x - x, c.y - y);
      if (d < best) {
        best = d;
        nearest = c;
      }
    }
    if (nearest && best < 6) return `${nearest.name}近郊`;
    const tile = this.map.tiles[y]?.[x];
    return tile ? `${tile.terrain === "mountain" ? "山間" : tile.terrain === "forest" ? "森" : "平原"}の地` : "辺境";
  }

  // ---------------- 都市 ----------------
  private syncCities() {
    for (const nation of this.nations) nation.cityIds = [];
    for (const city of this.cities) {
      const owner = this.map.tiles[city.y]?.[city.x]?.ownerId ?? null;
      if (owner && owner !== city.nationId) {
        city.nationId = owner;
        city.isCapital = false;
        city.prosperity = Math.max(8, city.prosperity * 0.75);
      }
      const nation = this.getNation(city.nationId);
      if (nation?.alive) nation.cityIds.push(city.id);
    }
    for (const nation of this.livingNations()) {
      const capital = this.getCity(nation.capitalCityId);
      if (!capital || capital.nationId !== nation.id) this.relocateCapital(nation);
    }
  }

  private relocateCapital(nation: Nation) {
    const own = this.citiesOf(nation.id);
    if (own.length > 0) {
      const next = own.reduce((best, c) => (c.prosperity > best.prosperity ? c : best), own[0]);
      next.isCapital = true;
      nation.capitalCityId = next.id;
      nation.capital = { x: next.x, y: next.y };
    } else {
      const first = Array.from(nation.territory)[0];
      if (first) {
        const [x, y] = first.split(",").map(Number);
        nation.capital = { x, y };
        nation.capitalCityId = null;
      }
    }
  }

  private simulateCities() {
    for (const nation of this.livingNations()) {
      updateCities(nation, this.cities, this.rng);

      const quota = (nation.cityIds.length + 1) * 9;
      if (nation.territory.size >= quota && nation.treasury > 260 && this.rng.bool(0.16)) {
        const site = findCitySite(nation, this.map, this.cities);
        if (site) {
          const city = createCity(nation, site.x, site.y, this.names, this.rng, this.year);
          this.addCity(city);
          attachCity(nation, city, this.map);
          nation.treasury -= 180;
          this.ev("cityFounded", "city", { nation: nation.name, city: city.name }, [nation.id], [], 1, { x: city.x, y: city.y });
        }
      }

      for (const city of this.citiesOf(nation.id)) {
        if (city.prosperity > 85 && this.rng.bool(0.01)) {
          this.ev("cityBoom", "city", { nation: nation.name, city: city.name }, [nation.id], [], 1, { x: city.x, y: city.y });
        }
      }
    }
  }

  // ---------------- 継承 ----------------
  private simulateSuccession() {
    for (const person of this.people) if (person.alive) person.age += 1;

    for (const nation of this.livingNations()) {
      const king = this.kingOf(nation.id);
      if (!king) {
        this.enthroneNewRuler(nation, null);
        continue;
      }

      const heirs = this.people.filter((p) => p.alive && p.nationId === nation.id && p.role === "heir");
      if (king.age >= 20 && king.age <= 58 && heirs.length < 3 && this.rng.bool(0.13)) {
        const heir = createHeir(nation, king, this.names, this.rng, this.year);
        this.addPerson(heir);
        this.ev("heirBorn", "succession", { nation: nation.name, king: king.name, heir: heir.name }, [nation.id], [king.id, heir.id]);
      }

      let deathChance = king.age > 58 ? 0.04 + (king.age - 58) * 0.012 : 0.006;
      if (king.traits.cruelty > 75 && nation.stability < 40) deathChance += 0.03;
      if (this.rng.bool(deathChance)) {
        king.alive = false;
        king.diedYear = this.year;
        this.enthroneNewRuler(nation, king);
      }
    }

    for (const person of this.people) {
      if (!person.alive || person.role === "king") continue;
      const limit = person.role === "heir" ? 0.01 : 0.03;
      if (person.age > 62 && this.rng.bool(limit + (person.age - 62) * 0.01)) {
        person.alive = false;
        person.diedYear = this.year;
        const nation = this.getNation(person.nationId);
        if (nation?.alive && person.role !== "heir") {
          this.addPerson(createPerson(nation, person.role as PersonRole, this.names, this.rng, this.year));
        }
      }
    }

    // 空いた役職の補充
    for (const nation of this.livingNations()) {
      for (const role of COURT_ROLES) {
        const exists = this.people.some((p) => p.alive && p.nationId === nation.id && p.role === role);
        if (!exists && this.rng.bool(0.35)) {
          this.addPerson(createPerson(nation, role, this.names, this.rng, this.year));
        }
      }
    }
  }

  private enthroneNewRuler(nation: Nation, oldKing: Person | null) {
    const heirs = this.people
      .filter((p) => p.alive && p.nationId === nation.id && p.role === "heir")
      .sort((a, b) => b.age - a.age);

    if (heirs.length > 0) {
      const heir = heirs[0];
      heir.role = "king";
      heir.reignStart = this.year;
      nation.kingId = heir.id;
      nation.dynasty = heir.dynasty || nation.dynasty;

      if (heir.age < 16) {
        nation.stability = Math.max(0, nation.stability - 8);
        nation.legitimacy = Math.max(0, nation.legitimacy - 10);
        this.ev("regency", "succession", { nation: nation.name, newKing: heir.name }, [nation.id], [heir.id], 1);
      } else {
        this.ev("succession", "succession", { nation: nation.name, oldKing: oldKing?.name ?? "先王", newKing: heir.name, dynasty: nation.dynasty }, [nation.id], oldKing ? [oldKing.id, heir.id] : [heir.id], 1);
      }
      return;
    }

    const newDynasty = this.names.dynastyName(nation.cultureId);
    nation.dynasty = newDynasty;
    nation.stability = Math.max(0, nation.stability - 22);
    nation.legitimacy = Math.max(0, nation.legitimacy - 30);
    const usurper = createPerson(nation, "king", this.names, this.rng, this.year, { age: this.rng.int(26, 48), dynasty: newDynasty });
    usurper.reignStart = this.year;
    this.addPerson(usurper);
    nation.kingId = usurper.id;
    this.ev("successionCrisis", "succession", { nation: nation.name, oldKing: oldKing?.name ?? "先王", newKing: usurper.name, dynasty: newDynasty }, [nation.id], oldKing ? [oldKing.id, usurper.id] : [usurper.id], 2);
  }

  // ==========================================================
  // 諜報・謀反・亡命
  // ==========================================================
  private simulateIntrigue() {
    for (const nation of this.livingNations()) {
      const spy = bestOfRole(this.peopleOf(nation.id), nation.id, "spy", "wisdom");
      if (spy && this.rng.bool(0.1 + spy.traits.wisdom / 900)) this.runSpyOperation(nation, spy);

      // 将軍の謀反
      const general = bestOfRole(this.peopleOf(nation.id), nation.id, "general", "ambition");
      if (
        general &&
        general.traits.ambition > 72 &&
        general.loyalty < 35 &&
        nation.stability < 42 &&
        this.rng.bool(0.05)
      ) {
        const dynasty = this.names.dynastyName(nation.cultureId);
        const oldKing = this.kingOf(nation.id);
        if (oldKing) {
          oldKing.alive = false;
          oldKing.diedYear = this.year;
        }
        general.role = "king";
        general.dynasty = dynasty;
        general.reignStart = this.year;
        nation.kingId = general.id;
        nation.dynasty = dynasty;
        nation.stability = Math.max(0, nation.stability - 18);
        nation.legitimacy = Math.max(0, nation.legitimacy - 35);
        this.ev("coup", "intrigue", { nation: nation.name, general: general.name, dynasty }, [nation.id], [general.id], 2);
        continue;
      }

      // 忠誠が低い人物の亡命
      for (const person of this.peopleOf(nation.id)) {
        if (person.role === "king" || person.role === "heir") continue;
        person.loyalty = clamp(person.loyalty + (nation.stability - 50) / 40 + this.rng.range(-1.5, 1.5), 0, 100);
        if (person.loyalty > 18 || !this.rng.bool(0.06)) continue;

        const dest = this.livingNations().filter((n) => n.id !== nation.id && n.relations[nation.id]?.status !== "war");
        if (dest.length === 0) continue;
        const target = this.rng.pick(dest);
        person.nationId = target.id;
        person.loyalty = 55;
        this.ev("defect", "intrigue", { nation: nation.name, enemy: target.name, person: person.name }, [nation.id, target.id], [person.id], 1);
      }
    }
  }

  private runSpyOperation(nation: Nation, spy: Person) {
    const rivals = this.livingNations()
      .filter((n) => n.id !== nation.id && (nation.relations[n.id]?.score ?? 0) < 20)
      .sort((a, b) => (nation.relations[a.id]?.score ?? 0) - (nation.relations[b.id]?.score ?? 0));
    if (rivals.length === 0) return;
    const target = rivals[0];

    // 露見判定
    const targetSpy = bestOfRole(this.peopleOf(target.id), target.id, "spy", "wisdom");
    const caught = this.rng.bool(0.18 + ((targetSpy?.traits.wisdom ?? 20) - spy.traits.wisdom) / 400);
    if (caught) {
      const rel = relationOf(nation, target.id);
      const relB = relationOf(target, nation.id);
      rel.score = clamp(rel.score - 25, -100, 100);
      relB.score = rel.score;
      spy.alive = false;
      spy.diedYear = this.year;
      this.ev("spyCaught", "intrigue", { nation: nation.name, enemy: target.name, spy: spy.name }, [nation.id, target.id], [spy.id], 1);
      return;
    }

    const roll = this.rng.next();
    if (roll < 0.3) {
      const loot = Math.round(target.treasury * 0.15);
      target.treasury = Math.max(0, target.treasury - loot);
      this.ev("spySabotage", "intrigue", { nation: nation.name, enemy: target.name, spy: spy.name }, [nation.id, target.id], [spy.id], 1);
    } else if (roll < 0.55 && target.techLevel > nation.techLevel) {
      nation.techLevel += 1;
      this.ev("spyStealTech", "intrigue", { nation: nation.name, enemy: target.name, spy: spy.name }, [nation.id, target.id], [spy.id], 1);
    } else if (roll < 0.9) {
      const cities = this.citiesOf(target.id);
      if (cities.length === 0) return;
      const city = this.rng.pick(cities);
      city.unrest = Math.min(100, city.unrest + 28);
      target.stability = Math.max(0, target.stability - 5);
      this.ev("spyIncite", "intrigue", { nation: nation.name, enemy: target.name, city: city.name }, [nation.id, target.id], [spy.id], 1, { x: city.x, y: city.y });
    } else {
      const victim = this.kingOf(target.id);
      if (!victim || !this.rng.bool(0.4)) return;
      victim.alive = false;
      victim.diedYear = this.year;
      target.stability = Math.max(0, target.stability - 12);
      const rel = relationOf(target, nation.id);
      rel.score = clamp(rel.score - 40, -100, 100);
      this.ev("spyAssassinate", "intrigue", { nation: nation.name, enemy: target.name, victim: victim.name }, [nation.id, target.id], [spy.id, victim.id], 2);
      this.enthroneNewRuler(target, victim);
    }
  }

  // ---------------- 自然 ----------------
  private simulateNature() {
    for (const nation of this.livingNations()) {
      const roll = this.rng.next();
      const hygiene = 1 - nation.techLevel * 0.05;
      if (roll < 0.028 * hygiene) {
        nation.population = Math.round(nation.population * 0.86);
        for (const c of this.citiesOf(nation.id)) c.prosperity = Math.max(5, c.prosperity - 6);
        this.ev("plague", "nature", { nation: nation.name }, [nation.id], [], 1);
      } else if (roll < 0.05) {
        nation.population = Math.round(nation.population * 0.93);
        nation.stability = Math.max(0, nation.stability - 7);
        this.ev("famine", "nature", { nation: nation.name }, [nation.id], [], 1);
      } else if (roll < 0.1) {
        nation.treasury += Math.round(nation.population * 0.008);
        nation.stability = Math.min(100, nation.stability + 2);
        this.ev("goodHarvest", "nature", { nation: nation.name }, [nation.id]);
      }
    }
  }

  // ---------------- 技術 ----------------
  private simulateTech() {
    for (const nation of this.livingNations()) {
      if (nation.techLevel >= 12) continue;
      const scholar = bestOfRole(this.peopleOf(nation.id), nation.id, "scholar", "wisdom");
      const chance =
        (0.03 + (scholar?.traits.wisdom ?? 40) / 2000 + nation.cityIds.length * 0.004 + nation.stability / 4000) /
        (1 + nation.techLevel * 0.55);
      if (this.rng.bool(chance)) {
        nation.techLevel += 1;
        this.ev("techBreakthrough", "discovery", { nation: nation.name, scholar: scholar?.name ?? nation.name, tech: nation.techLevel }, [nation.id], scholar ? [scholar.id] : [], 1);
      }
    }
  }

  // ---------------- 内乱・分裂 ----------------
  private simulateUnrest() {
    for (const nation of this.livingNations()) {
      if (nation.overlordId) {
        const overlord = this.getNation(nation.overlordId);
        if (!overlord?.alive) {
          nation.overlordId = null;
        } else {
          if ((nation.military > overlord.military * 0.7 || overlord.stability < 35) && this.rng.bool(0.07)) {
            nation.overlordId = null;
            const relA = relationOf(nation, overlord.id);
            const relB = relationOf(overlord, nation.id);
            relA.status = "war";
            relB.status = "war";
            relA.score = -70;
            relB.score = -70;
            this.ev("vassalFreed", "diplomacy", { nation: nation.name, enemy: overlord.name }, [nation.id, overlord.id], [], 2);
          } else if (powerScore(overlord) > powerScore(nation) * 3 && this.rng.bool(0.035)) {
            this.annexNation(nation, overlord);
            continue;
          }
        }
      }

      // 都市の反乱。多くは鎮圧されるが、条件が揃うと独立国が生まれる
      for (const city of this.citiesOf(nation.id)) {
        if (city.unrest < 80) continue;
        const canBreakAway =
          this.canSpawnNation() &&
          nation.stability < 45 &&
          nation.territory.size >= 8 &&
          this.citiesOf(nation.id).length >= 2 &&
          this.rng.bool(0.18);
        if (canBreakAway) {
          this.cityRevolt(nation, city);
        } else if (this.rng.bool(0.4)) {
          city.unrest = Math.max(0, city.unrest - 35);
          nation.stability = Math.max(0, nation.stability - 3);
          nation.population = Math.round(nation.population * 0.99);
          this.ev("rebellion", "war", { nation: nation.name }, [nation.id], [], 1, { x: city.x, y: city.y });
        }
        break;
      }

      if (nation.stability >= 26) continue;

      if (nation.stability < 15 && nation.territory.size >= 10 && this.canSpawnNation(nation.territory.size > 50) && this.rng.bool(0.12)) {
        this.secede(nation);
        continue;
      }

      if (this.rng.bool(0.12)) {
        nation.stability = Math.min(100, nation.stability + 14);
        nation.military = Math.round(nation.military * 0.85);
        nation.population = Math.round(nation.population * 0.98);
        this.ev("rebellion", "war", { nation: nation.name }, [nation.id], [], 1);
      }
    }
  }

  /** 都市が反旗を翻して独立国になる */
  private cityRevolt(parent: Nation, city: City) {
    const rebel = this.spawnBreakawayNation(parent, { x: city.x, y: city.y }, 0.2);
    if (!rebel) return;
    city.unrest = 20;
    this.ev("cityRevolt", "intrigue", { nation: parent.name, city: city.name, rebel: rebel.name }, [parent.id, rebel.id], [], 2, { x: city.x, y: city.y });
  }

  private secede(parent: Nation) {
    const region = carveRegion(parent, this.map, 0.35);
    if (region.length < 2) return;
    const rebel = this.spawnBreakawayNation(parent, region[0], 0.35, region);
    if (!rebel) return;
    parent.stability = Math.min(100, parent.stability + 12);
    this.ev("secession", "war", { nation: parent.name, rebel: rebel.name }, [parent.id, rebel.id], [], 2, { x: rebel.capital.x, y: rebel.capital.y });
  }

  /** 親国から領域を切り出して独立国を作る共通処理 */
  private spawnBreakawayNation(
    parent: Nation,
    seed: { x: number; y: number },
    share: number,
    presetRegion?: { x: number; y: number }[]
  ): Nation | null {
    const region = presetRegion ?? this.regionAround(parent, seed, Math.max(3, Math.floor(parent.territory.size * share)));
    if (region.length < 2) return null;

    const id = nextId("nation");
    const cultureId = parent.cultureId;
    const rebel = createNation(
      id,
      this.names.nationName(cultureId),
      cultureId,
      this.names.dynastyName(cultureId),
      pickColor(this.nations.map((n) => n.color), this.rng),
      { x: seed.x, y: seed.y },
      this.year,
      this.rng
    );
    rebel.techLevel = parent.techLevel;
    rebel.population = Math.round(parent.population * share);
    rebel.stability = 55;
    rebel.legitimacy = 45;
    parent.population = Math.max(500, Math.round(parent.population * (1 - share)));

    for (const t of region) {
      if (this.map.tiles[t.y]?.[t.x]?.ownerId !== parent.id) continue;
      transferTile(parent, rebel, this.map, t.x, t.y);
    }
    if (rebel.territory.size < 2) return null;

    this.addNation(rebel);
    this.addPeople(spawnCourt(rebel, this.names, this.rng, this.year));

    // 領域内の都市を接収
    for (const city of this.cities) {
      if (this.map.tiles[city.y]?.[city.x]?.ownerId === rebel.id) city.nationId = rebel.id;
    }
    if (this.citiesOf(rebel.id).length === 0) {
      const city = createCity(rebel, seed.x, seed.y, this.names, this.rng, this.year, true);
      this.addCity(city);
      attachCity(rebel, city, this.map);
      rebel.capitalCityId = city.id;
    } else {
      this.relocateCapital(rebel);
    }

    for (const other of this.livingNations()) {
      if (other.id === rebel.id) continue;
      const atWar = other.id === parent.id;
      const rel = { status: atWar ? ("war" as const) : ("peace" as const), score: atWar ? -70 : this.rng.int(-20, 10), since: this.year };
      rebel.relations[other.id] = { ...rel };
      other.relations[rebel.id] = { ...rel };
    }
    return rebel;
  }

  private regionAround(nation: Nation, seed: { x: number; y: number }, size: number): { x: number; y: number }[] {
    const region: { x: number; y: number }[] = [];
    const visited = new Set<string>([tileKey(seed.x, seed.y)]);
    const queue = [seed];
    while (queue.length > 0 && region.length < size) {
      const cur = queue.shift()!;
      if (this.map.tiles[cur.y]?.[cur.x]?.ownerId !== nation.id) continue;
      region.push(cur);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = cur.x + dx;
        const ny = cur.y + dy;
        const k = tileKey(nx, ny);
        if (visited.has(k)) continue;
        visited.add(k);
        if (this.map.tiles[ny]?.[nx]?.ownerId === nation.id) queue.push({ x: nx, y: ny });
      }
    }
    return region;
  }

  private annexNation(target: Nation, by: Nation) {
    for (const key of Array.from(target.territory)) {
      const [x, y] = key.split(",").map(Number);
      transferTile(target, by, this.map, x, y);
    }
    for (const city of this.citiesOf(target.id)) {
      city.nationId = by.id;
      city.isCapital = false;
    }
    target.cityIds = [];
    target.overlordId = null;
    by.population += Math.round(target.population * 0.9);
    target.population = 0;
    this.ev("nationFall", "war", { nation: target.name }, [target.id, by.id], [], 2);
  }

  /** 力を失った小国は、隣の大国に平和的に併合される */
  private simulateAbsorption() {
    for (const nation of this.livingNations()) {
      if (nation.territory.size > 4 || this.isAtWar(nation)) continue;
      const neighbors = this.livingNations().filter(
        (n) => n.id !== nation.id && areAdjacent(this.adjacency, n.id, nation.id)
      );
      if (neighbors.length === 0) continue;
      const strongest = neighbors.reduce((a, b) => (powerScore(a) >= powerScore(b) ? a : b));
      if (powerScore(strongest) < powerScore(nation) * 4) continue;
      if (!this.rng.bool(0.15)) continue;
      this.annexNation(nation, strongest);
    }
  }

  private simulateEmergentNations() {
    const living = this.livingNations();
    if (living.length >= Math.max(3, this.config.nationCount - 1) || !this.canSpawnNation()) return;
    if (!this.rng.bool(0.06)) return;

    const tile = findLandTile(this.map, this.rng);
    if (!tile) return;

    const id = nextId("nation");
    const cultureId = this.names.pickCultureId();
    tile.ownerId = id;
    const nation = createNation(
      id,
      this.names.nationName(cultureId),
      cultureId,
      this.names.dynastyName(cultureId),
      pickColor(this.nations.map((n) => n.color), this.rng),
      { x: tile.x, y: tile.y },
      this.year,
      this.rng
    );
    for (let i = 0; i < 4; i++) expandTerritory(nation, this.map, this.rng);

    this.addNation(nation);
    const court = spawnCourt(nation, this.names, this.rng, this.year);
    this.addPeople(court);
    const king = court.find((p) => p.role === "king")!;

    const city = createCity(nation, tile.x, tile.y, this.names, this.rng, this.year, true);
    this.addCity(city);
    attachCity(nation, city, this.map);
    nation.capitalCityId = city.id;

    for (const other of this.livingNations()) {
      if (other.id === nation.id) continue;
      const rel = { status: "peace" as const, score: this.rng.int(-10, 20), since: this.year };
      nation.relations[other.id] = { ...rel };
      other.relations[nation.id] = { ...rel };
    }
    this.ev("newNation", "founding", { nation: nation.name, king: king.name }, [nation.id], [king.id], 2, { x: tile.x, y: tile.y });
  }

  private checkNationFalls() {
    for (const nation of this.livingNations()) {
      if (nation.territory.size > 0 && nation.population > 400) continue;
      nation.alive = false;
      nation.fallYear = this.year;
      for (const person of this.peopleOf(nation.id)) {
        person.alive = false;
        person.diedYear = this.year;
      }
      this.armies = this.armies.filter((a) => a.nationId !== nation.id);
      for (const other of this.nations) {
        if (other.overlordId === nation.id) other.overlordId = null;
        delete other.relations[nation.id];
      }
      nation.relations = {};
      nation.stats = nation.stats.slice(-24);
      nation.cityIds = [];
      nation.armyIds = [];
      this.ev("nationFall", "war", { nation: nation.name }, [nation.id], [], 2);
    }
  }

  private recordStats() {
    if (this.year % STAT_INTERVAL !== 0) return;
    for (const nation of this.nations) {
      if (!nation.alive) continue;
      const point: StatPoint = { y: this.year, p: nation.population, m: nation.military, t: nation.territory.size };
      nation.stats.push(point);
      if (nation.stats.length > MAX_STATS) {
        const half = nation.stats.filter((_, i) => i % 2 === 0);
        half.push(point);
        nation.stats = half;
      }
    }
  }

  private trimAll() {
    if (this.events.length > MAX_EVENTS) {
      const cut = this.events.length - Math.floor(MAX_EVENTS * 0.6);
      const kept = this.events.filter((e, i) => i >= cut || e.importance >= 2);
      this.events = kept.length > MAX_EVENTS * 1.5 ? kept.slice(-Math.floor(MAX_EVENTS * 1.5)) : kept;
    }
    if (this.people.length > MAX_PEOPLE_RECORDS) {
      const alive = this.people.filter((p) => p.alive);
      const notableDead = this.people.filter((p) => !p.alive && p.reignStart !== undefined).slice(-120);
      this.people = [...notableDead, ...alive];
    }
    this.migrations = this.migrations.filter((m) => this.year - m.year <= 3).slice(-80);
    this.battles = this.battles.filter((b) => this.year - b.year <= 6).slice(-MAX_MARKS);
  }

  // ==========================================================
  // 名前の変更 (プレイヤーが自由に命名できる)
  // ==========================================================
  renameNation(nationId: string, name: string): boolean {
    const nation = this.getNation(nationId);
    const trimmed = name.trim().slice(0, 24);
    if (!nation || !trimmed || trimmed === nation.name) return false;
    this.ev("renamed", "divine", { old: nation.name, new: trimmed }, [nation.id], [], 1);
    nation.name = trimmed;
    return true;
  }

  renamePerson(personId: string, name: string): boolean {
    const person = this.getPerson(personId);
    const trimmed = name.trim().slice(0, 24);
    if (!person || !trimmed || trimmed === person.name) return false;
    this.ev("renamed", "divine", { old: person.name, new: trimmed }, [person.nationId], [person.id], 1);
    person.name = trimmed;
    return true;
  }

  renameCity(cityId: string, name: string): boolean {
    const city = this.getCity(cityId);
    const trimmed = name.trim().slice(0, 24);
    if (!city || !trimmed || trimmed === city.name) return false;
    this.ev("renamed", "divine", { old: city.name, new: trimmed }, [city.nationId], [], 1, { x: city.x, y: city.y });
    city.name = trimmed;
    return true;
  }

  // ==========================================================
  // 神の力
  // ==========================================================
  private log(kind: string, description: string) {
    this.godLog.push({ year: this.year, kind, description });
  }
  private lastEvent(): WorldEvent | null {
    return this.pending[this.pending.length - 1] ?? null;
  }

  godDisaster(nationId: string): WorldEvent | null {
    const nation = this.getNation(nationId);
    if (!nation?.alive) return null;
    nation.population = Math.round(nation.population * 0.75);
    nation.stability = Math.max(0, nation.stability - 18);
    for (const c of this.citiesOf(nation.id)) {
      c.fortification = Math.max(0, c.fortification - 12);
      c.prosperity = Math.max(5, c.prosperity - 10);
    }
    this.ev("godDisaster", "divine", { nation: nation.name }, [nation.id], [], 2, { x: nation.capital.x, y: nation.capital.y });
    this.log("disaster", `${nation.name}に天災`);
    return this.lastEvent();
  }

  godBlessing(nationId: string): WorldEvent | null {
    const nation = this.getNation(nationId);
    if (!nation?.alive) return null;
    nation.treasury += Math.round(nation.population * 0.02);
    nation.stability = Math.min(100, nation.stability + 15);
    for (const c of this.citiesOf(nation.id)) c.prosperity = Math.min(100, c.prosperity + 6);
    this.ev("godBlessing", "divine", { nation: nation.name }, [nation.id], [], 1);
    this.log("blessing", `${nation.name}に恩恵`);
    return this.lastEvent();
  }

  godDiscoverResource(nationId: string): WorldEvent | null {
    const nation = this.getNation(nationId);
    if (!nation?.alive) return null;
    const resource = this.rng.pick(["gold", "iron", "grain", "gem", "timber"] as ResourceType[]);
    const candidates = Array.from(nation.territory)
      .map((k) => k.split(",").map(Number))
      .filter(([x, y]) => this.map.tiles[y]?.[x] && !this.map.tiles[y][x].resource);
    if (candidates.length > 0) {
      const [x, y] = this.rng.pick(candidates);
      this.map.tiles[y][x].resource = resource;
    }
    nation.treasury += this.rng.int(150, 400);
    this.ev("discoveryResource", "divine", { nation: nation.name, resource: RESOURCE_LABEL[resource] }, [nation.id], [], 1);
    this.log("resource", `${nation.name}で${RESOURCE_LABEL[resource]}発見`);
    return this.lastEvent();
  }

  godProclaimLaw(
    nationId: string,
    law: "lowerTax" | "raiseTax" | "militarize" | "openTrade" | "conscription"
  ): WorldEvent | null {
    const nation = this.getNation(nationId);
    if (!nation?.alive) return null;
    switch (law) {
      case "lowerTax":
        nation.laws.taxRate = Math.max(0.02, nation.laws.taxRate - 0.05);
        nation.stability = Math.min(100, nation.stability + 6);
        break;
      case "raiseTax":
        nation.laws.taxRate = Math.min(0.5, nation.laws.taxRate + 0.05);
        nation.stability = Math.max(0, nation.stability - 6);
        break;
      case "militarize":
        nation.laws.militaryFocus = !nation.laws.militaryFocus;
        break;
      case "openTrade":
        nation.laws.tradeOpen = !nation.laws.tradeOpen;
        break;
      case "conscription":
        nation.laws.conscription = !nation.laws.conscription;
        break;
    }
    this.ev("godLaw", "divine", { nation: nation.name }, [nation.id], [], 1);
    this.log("law", `${nation.name}へ ${law} の詔`);
    return this.lastEvent();
  }

  godPlague(nationId: string): WorldEvent | null {
    const nation = this.getNation(nationId);
    if (!nation?.alive) return null;
    nation.population = Math.round(nation.population * 0.8);
    nation.military = Math.round(nation.military * 0.9);
    this.ev("godPlague", "divine", { nation: nation.name }, [nation.id], [], 2);
    this.log("plague", `${nation.name}に疫病`);
    return this.lastEvent();
  }

  godUprising(nationId: string): WorldEvent | null {
    const nation = this.getNation(nationId);
    if (!nation?.alive) return null;
    nation.stability = Math.max(0, nation.stability - 30);
    nation.legitimacy = Math.max(0, nation.legitimacy - 15);
    for (const c of this.citiesOf(nation.id)) c.unrest = Math.min(100, c.unrest + 30);
    this.ev("godUprising", "divine", { nation: nation.name }, [nation.id], [], 2);
    this.log("uprising", `${nation.name}で蜂起`);
    return this.lastEvent();
  }

  godSummonHero(nationId: string): WorldEvent | null {
    const nation = this.getNation(nationId);
    if (!nation?.alive) return null;
    const hero = createPerson(nation, "general", this.names, this.rng, this.year, { age: this.rng.int(24, 34), traitBias: 28 });
    hero.achievements.push("天より遣わされた英雄");
    hero.loyalty = 95;
    this.addPerson(hero);
    nation.military = Math.round(nation.military * 1.15);
    this.ev("godHero", "divine", { nation: nation.name, hero: hero.name }, [nation.id], [hero.id], 2);
    this.log("hero", `${nation.name}に英雄${hero.name}`);
    return this.lastEvent();
  }

  godFoundCity(nationId: string): WorldEvent | null {
    const nation = this.getNation(nationId);
    if (!nation?.alive) return null;
    const site = findCitySite(nation, this.map, this.cities, 2);
    if (!site) return null;
    const city = createCity(nation, site.x, site.y, this.names, this.rng, this.year);
    city.prosperity = 45;
    this.addCity(city);
    attachCity(nation, city, this.map);
    this.ev("godCity", "divine", { nation: nation.name, city: city.name }, [nation.id], [], 2, { x: city.x, y: city.y });
    this.log("city", `${nation.name}に都市${city.name}`);
    return this.lastEvent();
  }

  godForcePeace(nationId: string): WorldEvent | null {
    const nation = this.getNation(nationId);
    if (!nation?.alive) return null;
    for (const [otherId, rel] of Object.entries(nation.relations)) {
      if (rel.status !== "war") continue;
      const other = this.getNation(otherId);
      if (!other) continue;
      rel.status = "truce";
      rel.score = 0;
      rel.truceUntil = this.year + 25;
      const back = relationOf(other, nation.id);
      back.status = "truce";
      back.score = 0;
      back.truceUntil = rel.truceUntil;
      other.warExhaustion = 0;
    }
    nation.warExhaustion = 0;
    for (const c of this.cities) c.siegeBy = null;
    this.ev("godPeace", "divine", { nation: nation.name }, [nation.id], [], 2);
    this.log("peace", `${nation.name}に和平`);
    return this.lastEvent();
  }

  recordAiNarrative(category: "ai" | "divine", text: string, nationIds: string[] = [], personIds: string[] = []): WorldEvent {
    const e = makeAiEvent(this.year, category, text, nationIds, personIds, 1);
    this.pushEvent(e);
    return e;
  }

  // ==========================================================
  // 保存 / 復元
  // ==========================================================
  toSnapshot(): WorldSnapshot {
    return {
      version: SNAPSHOT_VERSION,
      config: this.config,
      year: this.year,
      faith: this.faith,
      counters: getIdCounters(),
      nations: this.nations.map((n) => ({ ...n, territory: Array.from(n.territory) })),
      people: this.people,
      cities: this.cities,
      armies: this.armies,
      events: this.events,
      battles: this.battles,
      migrations: this.migrations,
      godLog: this.godLog
    };
  }

  static fromSnapshot(snapshot: WorldSnapshot): GameWorld | null {
    if (!snapshot || snapshot.version !== SNAPSHOT_VERSION) return null;

    const world = new GameWorld(snapshot.config);
    world.year = snapshot.year;
    world.faith = snapshot.faith ?? 30;
    world.rng = new Rng((snapshot.config.seed ^ (snapshot.year * 2654435761)) >>> 0);
    world.names = new NameGenerator(world.rng);
    setIdCounters(snapshot.counters);

    world.nations = snapshot.nations.map((n) => ({ ...n, territory: new Set(n.territory) }));
    world.people = snapshot.people;
    world.cities = snapshot.cities ?? [];
    world.armies = snapshot.armies ?? [];
    world.events = snapshot.events;
    world.battles = snapshot.battles ?? [];
    world.migrations = snapshot.migrations ?? [];
    world.godLog = snapshot.godLog ?? [];

    for (const nation of world.nations) {
      if (!nation.alive) continue;
      for (const key of nation.territory) {
        const [x, y] = key.split(",").map(Number);
        const tile = world.map.tiles[y]?.[x];
        if (tile) tile.ownerId = nation.id;
      }
    }
    for (const city of world.cities) {
      const tile = world.map.tiles[city.y]?.[city.x];
      if (tile) tile.cityId = city.id;
    }
    world.adjacency = computeAdjacency(world.map);
    world.reindex();
    return world;
  }
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

export { tileKey, powerScore };