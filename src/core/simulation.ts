import { Rng } from "./rng";
import { NameGenerator } from "./nameGenerator";
import {
  City,
  GodInterventionLog,
  Nation,
  Person,
  PersonRole,
  RESOURCE_LABEL,
  ResourceType,
  StatPoint,
  WorldConfig,
  WorldEvent
} from "./types";
import { generateWorld, WorldMap, findLandTile, tileKey } from "./worldgen";
import {
  areAdjacent,
  carveRegion,
  computeAdjacency,
  createNation,
  expandTerritory,
  frontierTiles,
  hasCoast,
  pickColor,
  powerScore,
  relationOf,
  spawnNations,
  transferRandomTile,
  transferTile
} from "./nations";
import { bestOfRole, createHeir, createPerson, spawnCourt } from "./people";
import { attachCity, cityIncome, createCity, detachCity, findCitySite, updateCities } from "./cities";
import { generateTemplateEvent, makeAiEvent } from "./events";
import { getIdCounters, IdCounters, nextId, resetIdCounters, setIdCounters } from "./ids";

const START_YEAR = 1;
export const SNAPSHOT_VERSION = 2;

const MAX_EVENTS = 520;
const MAX_PEOPLE_RECORDS = 500;
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
  events: WorldEvent[];
  godLog: GodInterventionLog[];
}

export class GameWorld {
  map: WorldMap;
  nations: Nation[] = [];
  people: Person[] = [];
  cities: City[] = [];
  events: WorldEvent[] = [];
  godLog: GodInterventionLog[] = [];
  year = START_YEAR;
  faith = 30; // 神の力を使うための「信仰力」
  rng: Rng;
  names: NameGenerator;
  config: WorldConfig;

  private adjacency: Map<string, Set<string>> = new Map();
  private pending: WorldEvent[] = [];

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
      world.people.push(...court);
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
      world.cities.push(capital);
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
          2
        )
      );
    }

    world.adjacency = computeAdjacency(world.map);
    return world;
  }

  // ================= 参照ヘルパー =================
  getNation(id: string | null | undefined): Nation | undefined {
    if (!id) return undefined;
    return this.nations.find((n) => n.id === id);
  }

  getPerson(id: string | null | undefined): Person | undefined {
    if (!id) return undefined;
    return this.people.find((p) => p.id === id);
  }

  getCity(id: string | null | undefined): City | undefined {
    if (!id) return undefined;
    return this.cities.find((c) => c.id === id);
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

  kingOf(nationId: string): Person | undefined {
    return this.getPerson(this.getNation(nationId)?.kingId);
  }

  eventsOfNation(nationId: string, limit = 40): WorldEvent[] {
    return this.events.filter((e) => e.nationIds.includes(nationId)).slice(-limit).reverse();
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
    importance: 0 | 1 | 2 = 0
  ) {
    this.pushEvent(
      generateTemplateEvent(key, category, this.year, ctx, this.rng, nationIds, personIds, importance)
    );
  }

  // ==========================================================
  // メインループ: 1年進める
  // ==========================================================
  tick(): WorldEvent[] {
    this.year += 1;
    this.pending = [];
    this.adjacency = computeAdjacency(this.map);
    this.syncCities();

    this.simulateEconomy();
    this.simulateExpansion();
    this.simulateDiplomacy();
    this.simulateWars();
    this.simulateCities();
    this.simulateSuccession();
    this.simulateNature();
    this.simulateTech();
    this.simulateUnrest();
    this.simulateEmergentNations();
    this.checkNationFalls();
    this.recordStats();

    this.faith = Math.min(999, this.faith + this.faithRegen());
    this.trimEvents();
    this.trimPeople();

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

  // ---------------- 食料容量・収入 ----------------
  private foodCapacity(nation: Nation): number {
    let fertility = 0;
    for (const key of nation.territory) {
      const [x, y] = key.split(",").map(Number);
      const tile = this.map.tiles[y]?.[x];
      if (tile) fertility += tile.fertility;
    }
    return Math.round(fertility * 2600 * (1 + nation.techLevel * 0.13));
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

  /** 交易収入: 平和で交易開放している隣接国どうしは双方が潤う */
  private tradeIncome(nation: Nation): number {
    if (!nation.laws.tradeOpen) return 0;
    let sum = 0;
    for (const other of this.livingNations()) {
      if (other.id === nation.id || !other.laws.tradeOpen) continue;
      const rel = nation.relations[other.id];
      if (!rel || rel.status === "war") continue;
      if (!areAdjacent(this.adjacency, nation.id, other.id)) continue;
      const bonus = rel.status === "alliance" ? 1.6 : 1;
      sum += (8 + Math.min(nation.techLevel, other.techLevel) * 4) * bonus;
    }
    if (hasCoast(nation, this.map)) sum *= 1.25;
    return sum;
  }

  // ---------------- 人口・経済・安定度 ----------------
  private simulateEconomy() {
    for (const nation of this.livingNations()) {
      const king = this.kingOf(nation.id);
      const merchant = bestOfRole(this.people, nation.id, "merchant", "wisdom");
      const general = bestOfRole(this.people, nation.id, "general", "wisdom");

      // --- 人口 ---
      const capacity = Math.max(1, this.foodCapacity(nation));
      const crowd = 1 - nation.population / capacity;
      const stabilityFactor = 0.55 + nation.stability / 120;
      let growth = 0.02 * crowd * stabilityFactor;
      growth = clamp(growth, -0.06, 0.05);
      nation.population = Math.max(0, Math.round(nation.population * (1 + growth)));

      if (nation.population > capacity * 1.08 && this.rng.bool(0.2)) {
        nation.population = Math.round(nation.population * 0.94);
        nation.stability = Math.max(0, nation.stability - 5);
        this.ev("overpopulation", "nature", { nation: nation.name }, [nation.id], [], 0);
      }

      // --- 収入 ---
      const tradeSkill = 1 + (merchant?.traits.wisdom ?? 40) / 260;
      const tax =
        nation.population * nation.laws.taxRate * 0.035 * (1 + nation.techLevel * 0.08) * tradeSkill;
      const income = tax + cityIncome(nation, this.cities) + this.resourceIncome(nation) + this.tradeIncome(nation);
      // 汚職・宮廷の浪費: 国庫が無限に膨らまないようにする自然な支出
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

      // --- 軍事力 (徐々に目標値へ近づく) ---
      const genSkill = general ? general.traits.wisdom * 0.6 + general.traits.cruelty * 0.4 : 40;
      let target =
        (nation.population / 130) *
        (0.6 + nation.techLevel * 0.09) *
        (nation.laws.militaryFocus ? 1.5 : 1) *
        (1 + genSkill / 200);
      if (nation.treasury < 0) {
        target *= 0.75;
        nation.treasury = 0;
        nation.stability = Math.max(0, nation.stability - 2.5);
      }
      nation.military = Math.max(5, Math.round(nation.military + (target - nation.military) * 0.35));

      // --- 安定度 ---
      let delta = 0.35;
      delta += ((king?.traits.charisma ?? 50) - 50) / 40;
      delta -= (nation.laws.taxRate - 0.12) * 30;
      delta -= nation.warExhaustion / 28;
      if ((king?.traits.cruelty ?? 30) > 70) delta -= 0.7;
      if (nation.treasury > 400) delta += 0.4;
      delta += nation.cityIds.length * 0.06;
      delta -= Math.max(0, nation.territory.size - 18) * 0.045; // 巨大帝国は統治が緩む
      if (this.isAtWar(nation)) delta -= 0.8;
      if (nation.overlordId) delta -= 0.35;
      nation.stability = clamp(nation.stability + delta, 0, 100);

      if (!this.isAtWar(nation)) {
        nation.warExhaustion = Math.max(0, nation.warExhaustion - 1.5);
      }

      // --- 黄金期 / 暗黒期 ---
      if (nation.stability > 88 && nation.treasury > 900 && this.rng.bool(0.02)) {
        nation.techLevel = Math.min(12, nation.techLevel + 1);
        this.ev("goldenAge", "economy", { nation: nation.name }, [nation.id], [], 1);
      } else if (nation.stability < 22 && this.rng.bool(0.02)) {
        this.ev("darkAge", "economy", { nation: nation.name }, [nation.id], [], 1);
      }
    }
  }

  private isAtWar(nation: Nation): boolean {
    return Object.values(nation.relations).some((r) => r.status === "war");
  }

  // ---------------- 領土拡張 ----------------
  private simulateExpansion() {
    for (const nation of this.livingNations()) {
      const king = this.kingOf(nation.id);
      const pressure = nation.population / Math.max(1, nation.territory.size * 1500);
      const chance = Math.min(0.85, 0.12 + pressure * 0.35 + (king?.traits.ambition ?? 50) / 450);
      if (this.rng.bool(chance)) expandTerritory(nation, this.map, this.rng);
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

        const kingA = this.kingOf(a.id);
        const kingB = this.kingOf(b.id);
        const charisma = ((kingA?.traits.charisma ?? 50) + (kingB?.traits.charisma ?? 50)) / 2;

        const powerA = powerScore(a);
        const powerB = powerScore(b);

        let drift = this.rng.range(-3.4, 2.4) + (charisma - 50) / 30;
        if (a.laws.tradeOpen && b.laws.tradeOpen) drift += 0.5;
        if (a.laws.militaryFocus || b.laws.militaryFocus) drift -= 0.5;
        // 強大な隣国は警戒される
        drift -= Math.min(1.4, Math.abs(powerA - powerB) / 2200);
        // 国境紛争: 突発的に関係が悪化する
        if (this.rng.bool(0.05)) drift -= this.rng.int(8, 22);
        relA.score = clamp(relA.score + drift, -100, 100);
        relB.score = relA.score;

        const sameOverlord =
          (a.overlordId && a.overlordId === b.overlordId) ||
          a.overlordId === b.id ||
          b.overlordId === a.id;

        // 開戦判定: 関係悪化 + 王の野心 + 戦力差
        if (relA.score < -45 && relA.status === "peace" && !sameOverlord) {
          const ambition = ((kingA?.traits.ambition ?? 50) + (kingB?.traits.ambition ?? 50)) / 2;
          const ratio = powerA / Math.max(1, powerB);
          const confident = ratio > 0.7 || ratio < 1 / 0.7;
          if (confident && this.rng.bool(0.08 + ambition / 700)) {
            const aggressor = ratio >= 1 ? a : b;
            const target = aggressor === a ? b : a;
            this.declareWar(aggressor, target);
            continue;
          }
        }

        // 征服戦争: 圧倒的に強い野心的な王は、関係が悪くなくても攻め込む
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
        } else if (relA.score < -30 && this.rng.bool(0.06)) {
          this.ev("relationWorsen", "diplomacy", { nation: a.name, enemy: b.name }, [a.id, b.id]);
        } else if (relA.status === "peace" && relA.score > 20 && this.rng.bool(0.03)) {
          const merchant = bestOfRole(this.people, a.id, "merchant", "wisdom");
          this.ev(
            "tradeRoute",
            "economy",
            { nation: a.name, enemy: b.name, merchant: merchant?.name ?? a.name },
            [a.id, b.id],
            merchant ? [merchant.id] : []
          );
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
    this.ev(
      "warDeclared",
      "war",
      { nation: a.name, enemy: b.name, king: king?.name ?? a.name },
      [a.id, b.id],
      king ? [king.id] : [],
      2
    );

    // 防衛側の同盟国が参戦し、大戦へ発展することがある
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
      r1.since = this.year;
      r2.since = this.year;
      this.ev("warDeclared", "war", { nation: ally.name, enemy: a.name, king: this.kingOf(ally.id)?.name ?? ally.name }, [ally.id, a.id], [], 2);
    }
  }

  // ---------------- 戦争 ----------------
  private simulateWars() {
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
        this.resolveWar(a, b);
      }
    }
  }

  private resolveWar(a: Nation, b: Nation) {
    const adjacent = areAdjacent(this.adjacency, a.id, b.id);
    a.warExhaustion = Math.min(100, a.warExhaustion + this.rng.range(1.5, 3.5));
    b.warExhaustion = Math.min(100, b.warExhaustion + this.rng.range(1.5, 3.5));

    if (!adjacent) {
      // 国境を接していない戦争はすぐに立ち消える
      a.warExhaustion += 3;
      b.warExhaustion += 3;
      if (this.rng.bool(0.5)) this.makePeace(a, b, false);
      return;
    }

    const genA = bestOfRole(this.people, a.id, "general", "wisdom");
    const genB = bestOfRole(this.people, b.id, "general", "wisdom");
    const powerA = a.military * this.rng.range(0.8, 1.2) * (1 + (genA?.traits.wisdom ?? 40) / 300);
    const powerB = b.military * this.rng.range(0.8, 1.2) * (1 + (genB?.traits.wisdom ?? 40) / 300);

    const winner = powerA >= powerB ? a : b;
    const loser = winner === a ? b : a;
    const ratio = Math.max(powerA, powerB) / Math.max(1, Math.min(powerA, powerB));
    const winnerGeneral = winner === a ? genA : genB;

    // 損害
    winner.military = Math.round(winner.military * 0.94);
    loser.military = Math.round(loser.military * 0.85);
    winner.treasury = Math.max(0, winner.treasury - Math.round(winner.military * 0.25));
    loser.treasury = Math.max(0, loser.treasury - Math.round(loser.military * 0.35));
    loser.population = Math.round(loser.population * 0.985);
    winner.population = Math.round(winner.population * 0.995);
    loser.stability = Math.max(0, loser.stability - 2);

    if (this.rng.bool(0.35)) {
      this.ev(
        "warBattle",
        "war",
        {
          nation: winner.name,
          enemy: loser.name,
          general: winnerGeneral?.name ?? winner.name,
          place: this.frontierName(winner, loser)
        },
        [winner.id, loser.id],
        winnerGeneral ? [winnerGeneral.id] : []
      );
    }

    // 領土の切り取り
    if (this.rng.bool(0.25 + Math.min(0.35, (ratio - 1) * 0.3))) {
      const captured = transferRandomTile(loser, winner, this.map, this.rng);
      if (captured) {
        this.ev(
          "warVictory",
          "war",
          { nation: winner.name, enemy: loser.name, general: winnerGeneral?.name ?? winner.name },
          [winner.id, loser.id],
          winnerGeneral ? [winnerGeneral.id] : [],
          1
        );
      }
    }

    // 攻城戦
    if (this.rng.bool(0.12 + Math.min(0.2, (ratio - 1) * 0.2))) {
      this.attemptSiege(winner, loser);
    }

    // 和平判定
    const exhausted = Math.max(a.warExhaustion, b.warExhaustion);
    if (loser.territory.size <= 1 || (exhausted > 45 && this.rng.bool(0.25)) || this.rng.bool(0.05)) {
      const decisive = powerScore(winner) > powerScore(loser) * 2.2 && loser.territory.size <= 8;
      this.makePeace(winner, loser, decisive);
    }
  }

  private frontierName(a: Nation, b: Nation): string {
    const city = this.citiesOf(b.id)[0];
    return city ? `${city.name}近郊` : `${a.name}と${b.name}の国境`;
  }

  private attemptSiege(attacker: Nation, defender: Nation) {
    // 攻撃側の領土に隣接する防衛側の都市を探す
    const targets = this.citiesOf(defender.id).filter((city) => {
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const t = this.map.tiles[city.y + dy]?.[city.x + dx];
        if (t?.ownerId === attacker.id) return true;
      }
      return false;
    });
    if (targets.length === 0) return;

    const city = this.rng.pick(targets);
    const siegePower = attacker.military * (1 + attacker.techLevel * 0.05);
    const defense = defender.military * 0.6 + city.fortification * 12;

    if (siegePower > defense * this.rng.range(0.9, 1.4)) {
      const wasCapital = city.isCapital;
      transferTile(defender, attacker, this.map, city.x, city.y);
      detachCity(defender, city.id);
      city.nationId = attacker.id;
      city.isCapital = false;
      city.prosperity = Math.max(8, city.prosperity * 0.6);
      city.fortification = Math.max(5, city.fortification * 0.5);
      attacker.cityIds.push(city.id);
      attacker.treasury += Math.round(city.population * 0.02);
      defender.stability = Math.max(0, defender.stability - (wasCapital ? 18 : 8));

      if (wasCapital) {
        this.ev(
          "capitalFallen",
          "war",
          { nation: attacker.name, enemy: defender.name, city: city.name },
          [attacker.id, defender.id],
          [],
          2
        );
        this.relocateCapital(defender);
      } else {
        this.ev(
          "cityCaptured",
          "war",
          { nation: attacker.name, enemy: defender.name, city: city.name },
          [attacker.id, defender.id],
          [],
          2
        );
      }
    } else if (this.rng.bool(0.5)) {
      this.ev("siegeFailed", "war", { nation: attacker.name, city: city.name }, [attacker.id, defender.id]);
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

  private makePeace(a: Nation, b: Nation, vassalize: boolean) {
    const relA = relationOf(a, b.id);
    const relB = relationOf(b, a.id);
    relA.status = "peace";
    relB.status = "peace";
    relA.score = -25;
    relB.score = -25;
    relA.since = this.year;
    relB.since = this.year;
    a.warExhaustion = Math.max(0, a.warExhaustion - 25);
    b.warExhaustion = Math.max(0, b.warExhaustion - 25);

    if (vassalize && !b.overlordId && b.id !== a.overlordId) {
      b.overlordId = a.id;
      relA.status = "vassal";
      relB.status = "vassal";
      this.ev("vassalized", "diplomacy", { nation: a.name, enemy: b.name }, [a.id, b.id], [], 2);
    } else {
      this.ev("warDefeatPeace", "diplomacy", { nation: a.name, enemy: b.name }, [a.id, b.id], [], 1);
    }
  }

  /**
   * タイルの所有者を正として都市の帰属を毎年同期する。
   * (占領・分裂・併合など、どの経路で領土が動いても矛盾が起きない)
   */
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

  // ---------------- 都市 ----------------
  private simulateCities() {
    for (const nation of this.livingNations()) {
      updateCities(nation, this.cities, this.rng);

      const quota = (nation.cityIds.length + 1) * 6;
      if (nation.territory.size >= quota && nation.treasury > 260 && this.rng.bool(0.16)) {
        const site = findCitySite(nation, this.map, this.cities);
        if (site) {
          const city = createCity(nation, site.x, site.y, this.names, this.rng, this.year);
          this.cities.push(city);
          attachCity(nation, city, this.map);
          nation.treasury -= 180;
          this.ev("cityFounded", "city", { nation: nation.name, city: city.name }, [nation.id], [], 1);
        }
      }

      for (const city of this.citiesOf(nation.id)) {
        if (city.prosperity > 85 && this.rng.bool(0.01)) {
          this.ev("cityBoom", "city", { nation: nation.name, city: city.name }, [nation.id], [], 1);
        }
      }
    }
  }

  // ---------------- 王位継承・人物 ----------------
  private simulateSuccession() {
    for (const person of this.people) {
      if (person.alive) person.age += 1;
    }

    for (const nation of this.livingNations()) {
      const king = this.kingOf(nation.id);
      if (!king) {
        this.enthroneNewRuler(nation, null);
        continue;
      }

      // 世継ぎの誕生
      const heirs = this.people.filter(
        (p) => p.alive && p.nationId === nation.id && p.role === "heir"
      );
      if (king.age >= 20 && king.age <= 58 && heirs.length < 3 && this.rng.bool(0.13)) {
        const heir = createHeir(nation, king, this.names, this.rng, this.year);
        this.people.push(heir);
        this.ev("heirBorn", "succession", { nation: nation.name, king: king.name, heir: heir.name }, [nation.id], [king.id, heir.id]);
      }

      // 王の死 (老衰 + 暴君は暗殺されやすい)
      let deathChance = king.age > 58 ? 0.04 + (king.age - 58) * 0.012 : 0.006;
      if (king.traits.cruelty > 75 && nation.stability < 40) deathChance += 0.03;
      if (this.rng.bool(deathChance)) {
        king.alive = false;
        king.diedYear = this.year;
        this.enthroneNewRuler(nation, king);
      }
    }

    // 王以外の人物の引退・世代交代
    for (const person of this.people) {
      if (!person.alive || person.role === "king") continue;
      const limit = person.role === "heir" ? 0.01 : 0.03;
      if (person.age > 62 && this.rng.bool(limit + (person.age - 62) * 0.01)) {
        person.alive = false;
        person.diedYear = this.year;
        const nation = this.getNation(person.nationId);
        if (nation?.alive && person.role !== "heir") {
          this.people.push(
            createPerson(nation, person.role as PersonRole, this.names, this.rng, this.year)
          );
        }
      }
    }
  }

  /** 王が死んだ/不在のときに次の統治者を立てる */
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
        this.ev("regency", "succession", { nation: nation.name, newKing: heir.name }, [nation.id], [heir.id], 1);
      } else {
        this.ev(
          "succession",
          "succession",
          {
            nation: nation.name,
            oldKing: oldKing?.name ?? "先王",
            newKing: heir.name,
            dynasty: nation.dynasty
          },
          [nation.id],
          oldKing ? [oldKing.id, heir.id] : [heir.id],
          1
        );
      }
      return;
    }

    // 世継ぎ不在 -> 王朝断絶
    const newDynasty = this.names.dynastyName(nation.cultureId);
    nation.dynasty = newDynasty;
    nation.stability = Math.max(0, nation.stability - 22);
    const usurper = createPerson(nation, "king", this.names, this.rng, this.year, {
      age: this.rng.int(26, 48),
      dynasty: newDynasty
    });
    usurper.reignStart = this.year;
    this.people.push(usurper);
    nation.kingId = usurper.id;

    this.ev(
      "successionCrisis",
      "succession",
      {
        nation: nation.name,
        oldKing: oldKing?.name ?? "先王",
        newKing: usurper.name,
        dynasty: newDynasty
      },
      [nation.id],
      oldKing ? [oldKing.id, usurper.id] : [usurper.id],
      2
    );
  }

  // ---------------- 自然・災厄 ----------------
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
      const scholar = bestOfRole(this.people, nation.id, "scholar", "wisdom");
      const chance =
        (0.03 +
          (scholar?.traits.wisdom ?? 40) / 2000 +
          nation.cityIds.length * 0.004 +
          nation.stability / 4000) /
        (1 + nation.techLevel * 0.55);
      if (this.rng.bool(chance)) {
        nation.techLevel += 1;
        this.ev(
          "techBreakthrough",
          "discovery",
          { nation: nation.name, scholar: scholar?.name ?? nation.name, tech: nation.techLevel },
          [nation.id],
          scholar ? [scholar.id] : [],
          1
        );
      }
    }
  }

  // ---------------- 内乱・独立 ----------------
  private simulateUnrest() {
    for (const nation of this.livingNations()) {
      // 従属国の独立運動
      if (nation.overlordId) {
        const overlord = this.getNation(nation.overlordId);
        if (!overlord?.alive) {
          nation.overlordId = null;
        } else {
          const strong = nation.military > overlord.military * 0.7 || overlord.stability < 35;
          if (strong && this.rng.bool(0.07)) {
            nation.overlordId = null;
            const relA = relationOf(nation, overlord.id);
            const relB = relationOf(overlord, nation.id);
            relA.status = "war";
            relB.status = "war";
            relA.score = -70;
            relB.score = -70;
            this.ev("vassalFreed", "diplomacy", { nation: nation.name, enemy: overlord.name }, [nation.id, overlord.id], [], 2);
          }
        }
      }

      // 弱りきった従属国は宗主国に併合される
      if (nation.overlordId) {
        const overlord = this.getNation(nation.overlordId);
        if (
          overlord?.alive &&
          powerScore(overlord) > powerScore(nation) * 3 &&
          this.rng.bool(0.035)
        ) {
          this.annexNation(nation, overlord);
          continue;
        }
      }

      if (nation.stability >= 26) continue;

      // 分裂 (領土が広く、極端に不安定なとき)
      if (nation.stability < 15 && nation.territory.size >= 8 && this.rng.bool(0.12)) {
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

  /** 国家をまるごと併合する */
  private annexNation(target: Nation, by: Nation) {
    for (const key of Array.from(target.territory)) {
      const [x, y] = key.split(",").map(Number);
      transferTile(target, by, this.map, x, y);
    }
    for (const city of this.citiesOf(target.id)) {
      city.nationId = by.id;
      city.isCapital = false;
      by.cityIds.push(city.id);
    }
    target.cityIds = [];
    target.overlordId = null;
    by.population += Math.round(target.population * 0.9);
    target.population = 0;
    this.ev("nationFall", "war", { nation: target.name }, [target.id, by.id], [], 2);
  }

  /** 国家の一部が独立して新国家になる */
  private secede(parent: Nation) {
    const region = carveRegion(parent, this.map, 0.35);
    if (region.length < 2) return;

    const id = nextId("nation");
    const cultureId = parent.cultureId;
    const seed = region[0];
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
    rebel.population = Math.round(parent.population * 0.3);
    rebel.stability = 55;
    parent.population = Math.round(parent.population * 0.7);
    parent.stability = Math.min(100, parent.stability + 12);

    for (const t of region) {
      transferTile(parent, rebel, this.map, t.x, t.y);
      const cityId = this.map.tiles[t.y][t.x].cityId;
      if (cityId) {
        const city = this.getCity(cityId);
        if (city) {
          detachCity(parent, city.id);
          city.nationId = rebel.id;
          city.isCapital = false;
          rebel.cityIds.push(city.id);
        }
      }
    }

    this.nations.push(rebel);
    this.people.push(...spawnCourt(rebel, this.names, this.rng, this.year));

    if (rebel.cityIds.length === 0) {
      const city = createCity(rebel, seed.x, seed.y, this.names, this.rng, this.year, true);
      this.cities.push(city);
      attachCity(rebel, city, this.map);
      rebel.capitalCityId = city.id;
    } else {
      this.relocateCapital(rebel);
    }

    for (const other of this.livingNations()) {
      if (other.id === rebel.id) continue;
      const score = other.id === parent.id ? -70 : this.rng.int(-20, 10);
      rebel.relations[other.id] = { status: other.id === parent.id ? "war" : "peace", score, since: this.year };
      other.relations[rebel.id] = { ...rebel.relations[other.id] };
    }

    this.ev("secession", "war", { nation: parent.name, rebel: rebel.name }, [parent.id, rebel.id], [], 2);
  }

  /** 空白地に新しい国が興る(世界が滅び切らないようにする) */
  private simulateEmergentNations() {
    const living = this.livingNations();
    if (living.length >= Math.max(3, this.config.nationCount - 1)) return;
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
    for (let i = 0; i < 3; i++) expandTerritory(nation, this.map, this.rng);

    this.nations.push(nation);
    const court = spawnCourt(nation, this.names, this.rng, this.year);
    this.people.push(...court);
    const king = court.find((p) => p.role === "king")!;

    const city = createCity(nation, tile.x, tile.y, this.names, this.rng, this.year, true);
    this.cities.push(city);
    attachCity(nation, city, this.map);
    nation.capitalCityId = city.id;

    for (const other of this.livingNations()) {
      if (other.id === nation.id) continue;
      const rel = { status: "peace" as const, score: this.rng.int(-10, 20), since: this.year };
      nation.relations[other.id] = { ...rel };
      other.relations[nation.id] = { ...rel };
    }

    this.ev("newNation", "founding", { nation: nation.name, king: king.name }, [nation.id], [king.id], 2);
  }

  // ---------------- 滅亡判定 ----------------
  private checkNationFalls() {
    for (const nation of this.livingNations()) {
      if (nation.territory.size > 0 && nation.population > 400) continue;

      nation.alive = false;
      nation.fallYear = this.year;
      for (const person of this.peopleOf(nation.id)) {
        person.alive = false;
        person.diedYear = this.year;
      }
      for (const city of this.citiesOf(nation.id)) {
        const tile = this.map.tiles[city.y]?.[city.x];
        if (tile?.ownerId && tile.ownerId !== nation.id) {
          city.nationId = tile.ownerId;
          this.getNation(tile.ownerId)?.cityIds.push(city.id);
        }
      }
      for (const other of this.nations) {
        if (other.overlordId === nation.id) other.overlordId = null;
        delete other.relations[nation.id];
      }
      // 滅んだ国のデータはセーブを軽くするため縮約する
      nation.relations = {};
      nation.stats = nation.stats.slice(-24);
      nation.cityIds = [];
      this.ev("nationFall", "war", { nation: nation.name }, [nation.id], [], 2);
    }
  }

  // ---------------- 統計・ログ整理 ----------------
  private recordStats() {
    if (this.year % STAT_INTERVAL !== 0) return;
    for (const nation of this.nations) {
      if (!nation.alive) continue;
      const point: StatPoint = {
        y: this.year,
        p: nation.population,
        m: nation.military,
        t: nation.territory.size
      };
      nation.stats.push(point);
      if (nation.stats.length > MAX_STATS) {
        // 古い区間を間引いて、全期間を保ったまま件数を半分にする
        const half = nation.stats.filter((_, i) => i % 2 === 0);
        half.push(point);
        nation.stats = half;
      }
    }
  }

  private trimEvents() {
    if (this.events.length <= MAX_EVENTS) return;
    const cut = this.events.length - Math.floor(MAX_EVENTS * 0.6);
    const kept = this.events.filter((e, i) => i >= cut || e.importance >= 2);
    this.events = kept.length > MAX_EVENTS * 1.5 ? kept.slice(-Math.floor(MAX_EVENTS * 1.5)) : kept;
  }

  private trimPeople() {
    if (this.people.length <= MAX_PEOPLE_RECORDS) return;
    const alive = this.people.filter((p) => p.alive);
    const dead = this.people.filter((p) => !p.alive);
    const notableDead = dead.filter((p) => p.reignStart !== undefined);
    const keepDead = notableDead.slice(-120);
    this.people = [...keepDead, ...alive];
  }

  // ==========================================================
  // 神の力 (プレイヤーによる介入)
  // ==========================================================
  private log(kind: string, description: string) {
    this.godLog.push({ year: this.year, kind, description });
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
    this.ev("godDisaster", "divine", { nation: nation.name }, [nation.id], [], 2);
    this.log("disaster", `${nation.name}に天災`);
    return this.pending[this.pending.length - 1] ?? null;
  }

  godBlessing(nationId: string): WorldEvent | null {
    const nation = this.getNation(nationId);
    if (!nation?.alive) return null;
    nation.treasury += Math.round(nation.population * 0.02);
    nation.stability = Math.min(100, nation.stability + 15);
    for (const c of this.citiesOf(nation.id)) c.prosperity = Math.min(100, c.prosperity + 6);
    this.ev("godBlessing", "divine", { nation: nation.name }, [nation.id], [], 1);
    this.log("blessing", `${nation.name}に恩恵`);
    return this.pending[this.pending.length - 1] ?? null;
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
    this.ev(
      "discoveryResource",
      "divine",
      { nation: nation.name, resource: RESOURCE_LABEL[resource] },
      [nation.id],
      [],
      1
    );
    this.log("resource", `${nation.name}で${RESOURCE_LABEL[resource]}発見`);
    return this.pending[this.pending.length - 1] ?? null;
  }

  godProclaimLaw(
    nationId: string,
    law: "lowerTax" | "raiseTax" | "militarize" | "openTrade"
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
    }

    this.ev("godLaw", "divine", { nation: nation.name }, [nation.id], [], 1);
    this.log("law", `${nation.name}へ ${law} の詔`);
    return this.pending[this.pending.length - 1] ?? null;
  }

  godPlague(nationId: string): WorldEvent | null {
    const nation = this.getNation(nationId);
    if (!nation?.alive) return null;
    nation.population = Math.round(nation.population * 0.8);
    nation.military = Math.round(nation.military * 0.9);
    this.ev("godPlague", "divine", { nation: nation.name }, [nation.id], [], 2);
    this.log("plague", `${nation.name}に疫病`);
    return this.pending[this.pending.length - 1] ?? null;
  }

  godUprising(nationId: string): WorldEvent | null {
    const nation = this.getNation(nationId);
    if (!nation?.alive) return null;
    nation.stability = Math.max(0, nation.stability - 30);
    nation.military = Math.round(nation.military * 0.85);
    this.ev("godUprising", "divine", { nation: nation.name }, [nation.id], [], 2);
    this.log("uprising", `${nation.name}で蜂起`);
    return this.pending[this.pending.length - 1] ?? null;
  }

  godSummonHero(nationId: string): WorldEvent | null {
    const nation = this.getNation(nationId);
    if (!nation?.alive) return null;
    const hero = createPerson(nation, "general", this.names, this.rng, this.year, {
      age: this.rng.int(24, 34),
      traitBias: 28
    });
    hero.achievements.push("天より遣わされた英雄");
    this.people.push(hero);
    nation.military = Math.round(nation.military * 1.15);
    this.ev("godHero", "divine", { nation: nation.name, hero: hero.name }, [nation.id], [hero.id], 2);
    this.log("hero", `${nation.name}に英雄${hero.name}`);
    return this.pending[this.pending.length - 1] ?? null;
  }

  godFoundCity(nationId: string): WorldEvent | null {
    const nation = this.getNation(nationId);
    if (!nation?.alive) return null;
    const site = findCitySite(nation, this.map, this.cities, 2);
    if (!site) return null;
    const city = createCity(nation, site.x, site.y, this.names, this.rng, this.year);
    city.prosperity = 45;
    this.cities.push(city);
    attachCity(nation, city, this.map);
    this.ev("godCity", "divine", { nation: nation.name, city: city.name }, [nation.id], [], 2);
    this.log("city", `${nation.name}に都市${city.name}`);
    return this.pending[this.pending.length - 1] ?? null;
  }

  godForcePeace(nationId: string): WorldEvent | null {
    const nation = this.getNation(nationId);
    if (!nation?.alive) return null;
    for (const [otherId, rel] of Object.entries(nation.relations)) {
      if (rel.status !== "war") continue;
      const other = this.getNation(otherId);
      if (!other) continue;
      rel.status = "peace";
      rel.score = 0;
      const back = relationOf(other, nation.id);
      back.status = "peace";
      back.score = 0;
      other.warExhaustion = 0;
    }
    nation.warExhaustion = 0;
    this.ev("godPeace", "divine", { nation: nation.name }, [nation.id], [], 2);
    this.log("peace", `${nation.name}に和平`);
    return this.pending[this.pending.length - 1] ?? null;
  }

  /** AIが生成したナラティブをそのままイベントログへ記録する */
  recordAiNarrative(
    category: "ai" | "divine",
    text: string,
    nationIds: string[] = [],
    personIds: string[] = []
  ): WorldEvent {
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
      events: this.events,
      godLog: this.godLog
    };
  }

  static fromSnapshot(snapshot: WorldSnapshot): GameWorld | null {
    if (!snapshot || snapshot.version !== SNAPSHOT_VERSION) return null;

    const world = new GameWorld(snapshot.config);
    world.year = snapshot.year;
    world.faith = snapshot.faith ?? 30;
    // ロード後の乱数は年に応じてずらす(同じ手順を繰り返しても展開が変わる)
    world.rng = new Rng((snapshot.config.seed ^ (snapshot.year * 2654435761)) >>> 0);
    world.names = new NameGenerator(world.rng);

    setIdCounters(snapshot.counters);

    world.nations = snapshot.nations.map((n) => ({ ...n, territory: new Set(n.territory) }));
    world.people = snapshot.people;
    world.cities = snapshot.cities ?? [];
    world.events = snapshot.events;
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
    return world;
  }
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

export { tileKey, frontierTiles, powerScore };