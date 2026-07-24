import { Rng } from "./rng";
import { NameGenerator } from "./nameGenerator";
import {
  Nation,
  Person,
  PersonRole,
  WorldConfig,
  WorldEvent,
  GodInterventionLog
} from "./types";
import { generateWorld, WorldMap, tileKey } from "./worldgen";
import {
  spawnNations,
  expandTerritory,
  transferRandomTile,
  relationOf,
  areNeighbors,
  resetIdCounters
} from "./nations";
import { createPerson, spawnCourt } from "./people";
import { generateTemplateEvent, makeAiEvent } from "./events";

const START_YEAR = 1;

export interface WorldSnapshot {
  config: WorldConfig;
  year: number;
  nations: (Omit<Nation, "territory"> & { territory: string[] })[];
  people: Person[];
  events: WorldEvent[];
  godLog: GodInterventionLog[];
}

export class GameWorld {
  map: WorldMap;
  nations: Nation[] = [];
  people: Person[] = [];
  events: WorldEvent[] = [];
  godLog: GodInterventionLog[] = [];
  year = START_YEAR;
  rng: Rng;
  names: NameGenerator;
  config: WorldConfig;

  private constructor(config: WorldConfig) {
    this.config = config;
    this.rng = new Rng(config.seed);
    this.names = new NameGenerator(this.rng);
    this.map = generateWorld(config);
  }

  static create(config: WorldConfig): GameWorld {
    resetIdCounters();
    const world = new GameWorld(config);
    world.nations = spawnNations(
      world.map,
      config.nationCount,
      world.rng,
      world.names,
      START_YEAR
    );

    for (const nation of world.nations) {
      const court = spawnCourt(nation, world.names, world.rng, START_YEAR);
      world.people.push(...court);
      const king = court.find((p) => p.role === "king")!;
      world.events.push(
        generateTemplateEvent(
          "founding",
          "founding",
          START_YEAR,
          { nation: nation.name, king: king.name, capital: nation.name },
          world.rng,
          [nation.id],
          [king.id]
        )
      );
    }

    return world;
  }

  getNation(id: string | null | undefined): Nation | undefined {
    if (!id) return undefined;
    return this.nations.find((n) => n.id === id);
  }

  getPerson(id: string | null | undefined): Person | undefined {
    if (!id) return undefined;
    return this.people.find((p) => p.id === id);
  }

  livingNations(): Nation[] {
    return this.nations.filter((n) => n.alive);
  }

  peopleOf(nationId: string): Person[] {
    return this.people.filter((p) => p.nationId === nationId && p.alive);
  }

  kingOf(nationId: string): Person | undefined {
    const nation = this.getNation(nationId);
    return this.getPerson(nation?.kingId);
  }

  private pushEvent(e: WorldEvent) {
    this.events.push(e);
  }

  // ==========================================================
  // メインループ: 1年進める
  // ==========================================================
  tick(): WorldEvent[] {
    this.year += 1;
    const newEvents: WorldEvent[] = [];
    const before = this.events.length;

    this.simulatePopulationAndEconomy();
    this.simulateExpansionAndDiplomacy();
    this.simulateSuccession();
    this.simulateRandomNature();
    this.simulateTech();
    this.checkNationFalls();

    return this.events.slice(before);
  }

  // ---------------- 人口・経済 ----------------
  private simulatePopulationAndEconomy() {
    for (const nation of this.livingNations()) {
      const growth = 1 + (0.01 + nation.stability / 4000);
      nation.population = Math.round(nation.population * growth);

      const territorySize = nation.territory.size;
      const baseIncome = territorySize * 8 * (0.5 + nation.techLevel * 0.08);
      const tax = baseIncome * nation.laws.taxRate * 4;
      nation.treasury += Math.round(tax);

      // 軍事費・国庫が尽きると安定度が下がる
      if (nation.treasury < 0) {
        nation.treasury = 0;
        nation.stability = Math.max(0, nation.stability - 3);
      } else {
        nation.stability = Math.min(100, nation.stability + (this.rng.bool(0.3) ? 1 : 0));
      }

      nation.military = Math.round(
        20 + territorySize * (nation.laws.militaryFocus ? 14 : 8) + nation.techLevel * 10
      );
    }
  }

  // ---------------- 拡張・戦争・外交 ----------------
  private simulateExpansionAndDiplomacy() {
    const nations = this.livingNations();

    // 領土拡張(未所属の空き地への平和的な入植)
    for (const nation of nations) {
      if (this.rng.bool(0.6)) {
        expandTerritory(nation, this.map, this.rng);
      }
    }

    // 隣接国同士の関係変化・開戦・和平判定
    for (const nation of nations) {
      for (const other of nations) {
        if (nation.id >= other.id) continue;
        if (!areNeighbors(nation, other, this.map)) continue;

        const relA = relationOf(nation, other.id);
        const relB = relationOf(other, nation.id);

        if (relA.status === "war") {
          this.resolveWarTurn(nation, other);
          continue;
        }

        // 関係値のドリフト(ランダムウォーク)
        const drift = this.rng.int(-4, 4);
        relA.score = clamp(relA.score + drift, -100, 100);
        relB.score = relA.score;

        if (relA.score < -60 && this.rng.bool(0.15)) {
          this.declareWar(nation, other);
        } else if (relA.score > 70 && relA.status === "peace" && this.rng.bool(0.05)) {
          relA.status = "alliance";
          relB.status = "alliance";
          this.pushEvent(
            generateTemplateEvent(
              "allianceFormed",
              "diplomacy",
              this.year,
              { nation: nation.name, enemy: other.name },
              this.rng,
              [nation.id, other.id]
            )
          );
        } else if (relA.score < -30 && this.rng.bool(0.08)) {
          this.pushEvent(
            generateTemplateEvent(
              "relationWorsen",
              "diplomacy",
              this.year,
              { nation: nation.name, enemy: other.name },
              this.rng,
              [nation.id, other.id]
            )
          );
        }
      }
    }
  }

  private declareWar(a: Nation, b: Nation) {
    relationOf(a, b.id).status = "war";
    relationOf(b, a.id).status = "war";
    this.pushEvent(
      generateTemplateEvent(
        "warDeclared",
        "war",
        this.year,
        { nation: a.name, enemy: b.name },
        this.rng,
        [a.id, b.id]
      )
    );
  }

  private resolveWarTurn(a: Nation, b: Nation) {
    // 単純な戦力比較 + 乱数で結果を決める
    const powerA = a.military * (0.85 + this.rng.next() * 0.3);
    const powerB = b.military * (0.85 + this.rng.next() * 0.3);
    const winner = powerA > powerB ? a : b;
    const loser = winner === a ? b : a;

    // 消耗
    winner.treasury = Math.max(0, winner.treasury - Math.round(winner.military * 0.4));
    loser.treasury = Math.max(0, loser.treasury - Math.round(loser.military * 0.6));
    loser.population = Math.round(loser.population * 0.97);
    winner.population = Math.round(winner.population * 0.99);
    loser.stability = Math.max(0, loser.stability - 5);

    if (this.rng.bool(0.35)) {
      const captured = transferRandomTile(loser, winner, this.map, this.rng);
      if (captured) {
        const general = this.people.find(
          (p) => p.nationId === winner.id && p.role === "general" && p.alive
        );
        this.pushEvent(
          generateTemplateEvent(
            "warVictory",
            "war",
            this.year,
            {
              nation: winner.name,
              enemy: loser.name,
              general: general?.name ?? winner.name
            },
            this.rng,
            [winner.id, loser.id],
            general ? [general.id] : []
          )
        );
      }
    }

    // 一定確率で戦争終結
    if (this.rng.bool(0.25) || loser.territory.size <= 1) {
      relationOf(a, b.id).status = "peace";
      relationOf(b, a.id).status = "peace";
      relationOf(a, b.id).score = -20;
      relationOf(b, a.id).score = -20;
      this.pushEvent(
        generateTemplateEvent(
          "warDefeatPeace",
          "diplomacy",
          this.year,
          { nation: a.name, enemy: b.name },
          this.rng,
          [a.id, b.id]
        )
      );
    }
  }

  // ---------------- 王位継承 ----------------
  private simulateSuccession() {
    for (const nation of this.livingNations()) {
      const king = this.kingOf(nation.id);
      if (!king) continue;
      king.age += 1;

      const deathChance = king.age > 60 ? 0.05 + (king.age - 60) * 0.01 : 0.005;
      if (this.rng.bool(deathChance)) {
        king.alive = false;
        king.diedYear = this.year;

        const heir = createPerson(nation, "king", this.names, this.rng, this.year);
        nation.kingId = heir.id;
        this.people.push(heir);

        this.pushEvent(
          generateTemplateEvent(
            "succession",
            "succession",
            this.year,
            { nation: nation.name, oldKing: king.name, newKing: heir.name },
            this.rng,
            [nation.id],
            [king.id, heir.id]
          )
        );
      }
    }

    // 他の人物も高齢になったら緩やかに引退/死去させ、稀に新しい人材を補充する
    for (const person of this.people) {
      if (!person.alive || person.role === "king") continue;
      person.age += 1;
      if (person.age > 65 && this.rng.bool(0.04)) {
        person.alive = false;
        person.diedYear = this.year;
        const nation = this.getNation(person.nationId);
        if (nation?.alive) {
          const replacement = createPerson(
            nation,
            person.role as PersonRole,
            this.names,
            this.rng,
            this.year
          );
          this.people.push(replacement);
        }
      }
    }
  }

  // ---------------- 自然・災厄・豊作 ----------------
  private simulateRandomNature() {
    for (const nation of this.livingNations()) {
      const roll = this.rng.next();
      if (roll < 0.03) {
        nation.population = Math.round(nation.population * 0.85);
        this.pushEvent(
          generateTemplateEvent(
            "plague",
            "nature",
            this.year,
            { nation: nation.name },
            this.rng,
            [nation.id]
          )
        );
      } else if (roll < 0.05) {
        nation.population = Math.round(nation.population * 0.92);
        nation.stability = Math.max(0, nation.stability - 8);
        this.pushEvent(
          generateTemplateEvent(
            "famine",
            "nature",
            this.year,
            { nation: nation.name },
            this.rng,
            [nation.id]
          )
        );
      } else if (roll < 0.09) {
        nation.treasury += Math.round(nation.population * 0.01);
        this.pushEvent(
          generateTemplateEvent(
            "goodHarvest",
            "nature",
            this.year,
            { nation: nation.name },
            this.rng,
            [nation.id]
          )
        );
      }

      if (nation.stability < 20 && this.rng.bool(0.1)) {
        nation.stability = Math.min(100, nation.stability + 15);
        nation.military = Math.round(nation.military * 0.8);
        this.pushEvent(
          generateTemplateEvent(
            "rebellion",
            "war",
            this.year,
            { nation: nation.name },
            this.rng,
            [nation.id]
          )
        );
      }
    }
  }

  // ---------------- 技術発展 ----------------
  private simulateTech() {
    for (const nation of this.livingNations()) {
      if (nation.techLevel < 10 && this.rng.bool(0.05 + nation.stability / 2000)) {
        nation.techLevel += 1;
        const scholar = this.people.find(
          (p) => p.nationId === nation.id && p.role === "scholar" && p.alive
        );
        this.pushEvent(
          generateTemplateEvent(
            "techBreakthrough",
            "discovery",
            this.year,
            { nation: nation.name, scholar: scholar?.name ?? nation.name },
            this.rng,
            [nation.id],
            scholar ? [scholar.id] : []
          )
        );
      }
    }
  }

  // ---------------- 滅亡判定 ----------------
  private checkNationFalls() {
    for (const nation of this.livingNations()) {
      if (nation.territory.size === 0 || nation.population <= 0) {
        nation.alive = false;
        nation.fallYear = this.year;
        this.pushEvent(
          generateTemplateEvent(
            "nationFall",
            "war",
            this.year,
            { nation: nation.name },
            this.rng,
            [nation.id]
          )
        );
      }
    }
  }

  // ==========================================================
  // 神の力 (プレイヤーによる介入)
  // ==========================================================
  godDisaster(nationId: string): WorldEvent | null {
    const nation = this.getNation(nationId);
    if (!nation || !nation.alive) return null;
    nation.population = Math.round(nation.population * 0.75);
    nation.stability = Math.max(0, nation.stability - 20);
    const e = generateTemplateEvent(
      "godDisaster",
      "divine",
      this.year,
      { nation: nation.name },
      this.rng,
      [nation.id]
    );
    this.pushEvent(e);
    this.godLog.push({ year: this.year, kind: "disaster", description: `${nation.name}に天災` });
    return e;
  }

  godBlessing(nationId: string): WorldEvent | null {
    const nation = this.getNation(nationId);
    if (!nation || !nation.alive) return null;
    nation.treasury += Math.round(nation.population * 0.02);
    nation.stability = Math.min(100, nation.stability + 15);
    const e = generateTemplateEvent(
      "godBlessing",
      "divine",
      this.year,
      { nation: nation.name },
      this.rng,
      [nation.id]
    );
    this.pushEvent(e);
    this.godLog.push({ year: this.year, kind: "blessing", description: `${nation.name}に恩恵` });
    return e;
  }

  godDiscoverResource(nationId: string): WorldEvent | null {
    const nation = this.getNation(nationId);
    if (!nation || !nation.alive) return null;
    const resources = ["gold", "iron", "grain", "gem", "timber"];
    const resource = this.rng.pick(resources);
    nation.treasury += this.rng.int(150, 400);
    const e = generateTemplateEvent(
      "discoveryResource",
      "divine",
      this.year,
      { nation: nation.name, resource },
      this.rng,
      [nation.id]
    );
    this.pushEvent(e);
    this.godLog.push({
      year: this.year,
      kind: "resource",
      description: `${nation.name}で${resource}発見`
    });
    return e;
  }

  godProclaimLaw(nationId: string, law: "lowerTax" | "raiseTax" | "militarize" | "openTrade"): WorldEvent | null {
    const nation = this.getNation(nationId);
    if (!nation || !nation.alive) return null;

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

    const e = generateTemplateEvent(
      "godLaw",
      "divine",
      this.year,
      { nation: nation.name },
      this.rng,
      [nation.id]
    );
    this.pushEvent(e);
    this.godLog.push({ year: this.year, kind: "law", description: `${nation.name}へ ${law} の詔` });
    return e;
  }

  /** AIが生成したナラティブをそのままイベントログへ記録する */
  recordAiNarrative(
    category: "ai" | "divine",
    text: string,
    nationIds: string[] = [],
    personIds: string[] = []
  ): WorldEvent {
    const e = makeAiEvent(this.year, category, text, nationIds, personIds);
    this.pushEvent(e);
    return e;
  }

  // ==========================================================
  // 保存 / 復元
  // ==========================================================
  toSnapshot(): WorldSnapshot {
    return {
      config: this.config,
      year: this.year,
      nations: this.nations.map((n) => ({ ...n, territory: Array.from(n.territory) })),
      people: this.people,
      events: this.events,
      godLog: this.godLog
    };
  }

  static fromSnapshot(snapshot: WorldSnapshot): GameWorld {
    const world = new GameWorld(snapshot.config);
    world.year = snapshot.year;
    world.nations = snapshot.nations.map((n) => ({
      ...n,
      territory: new Set(n.territory)
    }));
    world.people = snapshot.people;
    world.events = snapshot.events;
    world.godLog = snapshot.godLog ?? [];

    // マップの所有権情報を復元
    for (const nation of world.nations) {
      for (const key of nation.territory) {
        const [x, y] = key.split(",").map(Number);
        if (world.map.tiles[y]?.[x]) {
          world.map.tiles[y][x].ownerId = nation.id;
        }
      }
    }
    return world;
  }
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

export { tileKey };
