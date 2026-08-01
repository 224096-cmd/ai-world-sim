import { Rng } from "./rng";
import { generateMap } from "./worldgen";
import { Culture, cultureById, NameGenerator, NATION_COLORS } from "./nameGenerator";
import {
  Army,
  City,
  EventCategory,
  Fx,
  Nation,
  Person,
  Relation,
  RelationStatus,
  ToolId,
  Unit,
  WorldConfig,
  WorldEvent,
  R,
  T,
  isLand,
  isPassable,
  isWater
} from "./types";

// ============================================================
// 世界シミュレーション本体
// 1 tick = 1ヶ月。国家の拡張・経済・外交・戦争・人物・住民ユニット・
// 神の介入(WorldBox風ツール)をすべてここで処理する。
// ============================================================

export const SNAPSHOT_VERSION = 2;

export interface Tornado {
  x: number;
  y: number;
  px: number;
  py: number;
  dir: number;
  ttl: number;
}

export interface Notification {
  text: string;
  kind: "info" | "war" | "divine" | "disaster";
}

export interface ToolResult {
  ok: boolean;
  msg?: string;
}

interface WorldStatPoint {
  y: number;
  pop: number;
  nations: number;
}

const DIRS4 = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1]
] as const;

const FLAMMABLE = new Set<number>([T.forest, T.jungle, T.savanna, T.plains, T.swamp]);

export class World {
  readonly config: WorldConfig;
  readonly width: number;
  readonly height: number;

  // ---- タイルデータ (typed array) ----
  terrain: Uint8Array;
  elevation: Float32Array;
  moisture: Float32Array;
  fertility: Float32Array;
  river: Uint8Array;
  resource: Uint8Array;
  owner: Int16Array; // nations配列のindex / -1
  cityAt: Int16Array; // cities配列のindex / -1
  burn: Uint8Array; // 残り燃焼月数

  // ---- エンティティ ----
  nations: Nation[] = [];
  cities: City[] = [];
  people = new Map<string, Person>();
  armies = new Map<string, Army>();
  units: Unit[] = [];
  tornadoes: Tornado[] = [];
  fx: Fx[] = [];
  events: WorldEvent[] = [];
  notifications: Notification[] = [];
  worldStats: WorldStatPoint[] = [];

  burningTiles = new Set<number>();

  tick = 0;
  rng: Rng;
  nameGen: NameGenerator;

  needFullRepaint = true;
  private dirty = new Set<number>();

  private idCounter = 1;
  private eventId = 1;
  private nationIdxById = new Map<string, number>();
  private borders = new Map<number, number[]>();
  private contacts = new Map<number, { i: number; enemy: number }[]>();

  // ------------------------------------------------------------
  constructor(config: WorldConfig, skipInit = false) {
    this.config = config;
    this.width = config.width;
    this.height = config.height;
    this.rng = new Rng(config.seed);
    this.nameGen = new NameGenerator(this.rng);

    const size = this.width * this.height;
    if (skipInit) {
      this.terrain = new Uint8Array(size);
      this.elevation = new Float32Array(size);
      this.moisture = new Float32Array(size);
      this.fertility = new Float32Array(size);
      this.river = new Uint8Array(size);
      this.resource = new Uint8Array(size);
    } else {
      const map = generateMap(this.width, this.height, config.seed, config.landRatio);
      this.terrain = map.terrain;
      this.elevation = map.elevation;
      this.moisture = map.moisture;
      this.fertility = map.fertility;
      this.river = map.river;
      this.resource = map.resource;
    }
    this.owner = new Int16Array(size).fill(-1);
    this.cityAt = new Int16Array(size).fill(-1);
    this.burn = new Uint8Array(size);

    if (!skipInit) {
      this.spawnInitialNations(config.nationCount);
      this.pushEvent("founding", 2, "神々の手により、新たな世界が生まれた。", []);
    }
  }

  // ---- 時刻 ----
  get year(): number {
    return Math.floor(this.tick / 12) + 1;
  }
  get month(): number {
    return this.tick % 12;
  }

  // ---- 座標ヘルパ ----
  idx(x: number, y: number): number {
    return y * this.width + x;
  }
  inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.width && y < this.height;
  }
  nationAtTile(x: number, y: number): Nation | null {
    if (!this.inBounds(x, y)) return null;
    const o = this.owner[this.idx(x, y)];
    return o >= 0 ? this.nations[o] : null;
  }
  cityAtTile(x: number, y: number): City | null {
    if (!this.inBounds(x, y)) return null;
    const c = this.cityAt[this.idx(x, y)];
    return c >= 0 ? this.cities[c] : null;
  }
  nationById(id: string | null | undefined): Nation | null {
    if (!id) return null;
    const i = this.nationIdxById.get(id);
    return i === undefined ? null : this.nations[i];
  }
  cityById(id: string | null | undefined): City | null {
    if (!id) return null;
    return this.cities.find((c) => c.id === id) ?? null;
  }
  aliveNations(): Nation[] {
    return this.nations.filter((n) => n.alive);
  }
  worldPopulation(): number {
    let p = 0;
    for (const n of this.nations) if (n.alive) p += n.population;
    return p;
  }

  markDirty(i: number): void {
    this.dirty.add(i);
  }
  /** 描画側が変更タイルを取り出す (取り出したら空になる) */
  consumeDirty(): number[] {
    if (this.dirty.size === 0) return [];
    const arr = [...this.dirty];
    this.dirty.clear();
    return arr;
  }

  private newId(prefix: string): string {
    return `${prefix}${this.idCounter++}`;
  }

  // ============================================================
  // 年代記
  // ============================================================
  pushEvent(
    category: EventCategory,
    importance: 0 | 1 | 2,
    text: string,
    nationIds: string[],
    x?: number,
    y?: number
  ): void {
    this.events.push({ id: this.eventId++, year: this.year, category, text, importance, nationIds, x, y });
    if (this.events.length > 600) {
      // 重要度の低いものから間引く
      const minor = this.events.findIndex((e) => e.importance === 0);
      if (minor >= 0) this.events.splice(minor, 1);
      else this.events.shift();
    }
    if (importance === 2) {
      const kind: Notification["kind"] =
        category === "war" ? "war" : category === "disaster" ? "disaster" : category === "divine" ? "divine" : "info";
      this.notifications.push({ text: `${this.year}年 ${text}`, kind });
    }
  }

  // ============================================================
  // 初期国家の配置
  // ============================================================
  private spawnInitialNations(count: number): void {
    type Cand = { x: number; y: number; score: number };
    const cands: Cand[] = [];
    for (let n = 0; n < 900; n++) {
      const x = this.rng.int(3, this.width - 4);
      const y = this.rng.int(3, this.height - 4);
      const i = this.idx(x, y);
      if (!isPassable(this.terrain[i])) continue;
      let score = 0;
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (!this.inBounds(nx, ny)) continue;
          const j = this.idx(nx, ny);
          score += this.fertility[j];
          if (isWater(this.terrain[j])) score += 0.08;
          if (this.river[j]) score += 0.1;
        }
      }
      cands.push({ x, y, score });
    }
    cands.sort((a, b) => b.score - a.score);
    const minDist = Math.max(9, Math.min(this.width, this.height) / (Math.ceil(Math.sqrt(count)) + 1.2));
    const chosen: Cand[] = [];
    for (const c of cands) {
      if (chosen.length >= count) break;
      if (chosen.every((o) => Math.hypot(o.x - c.x, o.y - c.y) >= minDist)) chosen.push(c);
    }
    for (const c of chosen) {
      this.foundNation(c.x, c.y, { pop: this.rng.int(1200, 2200), radius: 2, silent: true });
    }
  }

  // ============================================================
  // 国家・都市・人物の生成
  // ============================================================
  private climateAt(x: number, y: number): "cold" | "hot" | "wet" | "temperate" | "coastal" {
    const t = this.terrain[this.idx(x, y)];
    if (t === T.snow || t === T.tundra) return "cold";
    if (t === T.desert || t === T.savanna) return "hot";
    if (t === T.jungle || t === T.swamp) return "wet";
    for (const [dx, dy] of DIRS4) {
      if (this.inBounds(x + dx, y + dy) && isWater(this.terrain[this.idx(x + dx, y + dy)])) return "coastal";
    }
    return "temperate";
  }

  private makePerson(nationId: string, culture: Culture, role: "king" | "heir", age: number): Person {
    const gender = this.rng.bool(0.55) ? "m" : ("f" as const);
    const p: Person = {
      id: this.newId("p"),
      name: this.nameGen.personName(culture, gender),
      nationId,
      role,
      age,
      gender,
      bornYear: this.year - age,
      traits: {
        wisdom: this.rng.int(15, 95),
        ambition: this.rng.int(10, 95),
        charisma: this.rng.int(15, 95)
      },
      alive: true
    };
    this.people.set(p.id, p);
    return p;
  }

  foundNation(
    x: number,
    y: number,
    opts: { pop?: number; radius?: number; silent?: boolean; cultureId?: string; fromCity?: City } = {}
  ): Nation | null {
    const spot = this.findLandNear(x, y, 3);
    if (!spot) return null;
    const culture = opts.cultureId
      ? cultureById(opts.cultureId)
      : this.nameGen.pickCultureFor(this.climateAt(spot.x, spot.y));
    const { name } = this.nameGen.nationName(culture);
    const color = NATION_COLORS[this.nations.length % NATION_COLORS.length];
    const id = this.newId("n");

    const nation: Nation = {
      id,
      name,
      color: color.main,
      colorDark: color.dark,
      cultureId: culture.id,
      dynasty: "",
      foundedYear: this.year,
      capitalCityId: null,
      kingId: null,
      heirId: null,
      cityIds: [],
      armyIds: [],
      population: 0,
      treasury: this.rng.int(120, 260),
      military: 0,
      tech: 1 + this.rng.range(0, 0.15),
      stability: this.rng.int(55, 75),
      warExhaustion: 0,
      relations: {},
      territoryCount: 0,
      alive: true,
      blessedYears: 0,
      cursedYears: 0,
      stats: []
    };
    const idx = this.nations.length;
    this.nations.push(nation);
    this.nationIdxById.set(id, idx);

    const king = this.makePerson(id, culture, "king", this.rng.int(24, 48));
    king.reignStart = this.year;
    const heir = this.makePerson(id, culture, "heir", Math.max(4, king.age - this.rng.int(20, 30)));
    nation.kingId = king.id;
    nation.heirId = heir.id;
    nation.dynasty = this.nameGen.dynastyName(culture, king.name);

    // 首都
    if (opts.fromCity) {
      this.attachCity(opts.fromCity, nation, true);
    } else {
      const c = this.createCity(nation, spot.x, spot.y, true, opts.pop ?? 1000);
      if (!c) {
        nation.alive = false;
        return null;
      }
    }
    // 初期領土
    const r = opts.radius ?? 1;
    this.forEachBrush(spot.x, spot.y, r, (i) => {
      if (isLand(this.terrain[i]) && this.owner[i] === -1) this.claimTile(nation, i);
    });

    nation.population = this.sumPopulation(nation);
    if (!opts.silent) {
      const title = cultureById(nation.cultureId).kingTitle[king.gender];
      this.pushEvent(
        "founding",
        2,
        `${nation.name}が建国された。初代${title}は${king.name}。`,
        [id],
        spot.x,
        spot.y
      );
    }
    return nation;
  }

  private createCity(nation: Nation, x: number, y: number, capital: boolean, pop: number): City | null {
    const spot = this.findLandNear(x, y, 2, (i) => this.cityAt[i] === -1);
    if (!spot) return null;
    const culture = cultureById(nation.cultureId);
    const city: City = {
      id: this.newId("c"),
      name: this.nameGen.cityName(culture),
      x: spot.x,
      y: spot.y,
      nationId: nation.id,
      foundedYear: this.year,
      isCapital: capital,
      population: pop,
      prosperity: this.rng.int(30, 50),
      fortification: capital ? 35 : 15,
      unrest: 10,
      plagueTicks: 0,
      siegeBy: null,
      siegeProgress: 0
    };
    const ci = this.cities.length;
    this.cities.push(city);
    this.cityAt[this.idx(spot.x, spot.y)] = ci;
    nation.cityIds.push(city.id);
    if (capital) nation.capitalCityId = city.id;
    this.claimTile(nation, this.idx(spot.x, spot.y));
    this.markDirty(this.idx(spot.x, spot.y));
    return city;
  }

  private attachCity(city: City, nation: Nation, capital: boolean): void {
    city.nationId = nation.id;
    city.isCapital = capital;
    nation.cityIds.push(city.id);
    if (capital) nation.capitalCityId = city.id;
    this.claimTile(nation, this.idx(city.x, city.y));
  }

  findLandNear(
    x: number,
    y: number,
    maxR: number,
    extra?: (i: number) => boolean
  ): { x: number; y: number } | null {
    for (let r = 0; r <= maxR; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (!this.inBounds(nx, ny)) continue;
          const i = this.idx(nx, ny);
          if (isPassable(this.terrain[i]) && (!extra || extra(i))) return { x: nx, y: ny };
        }
      }
    }
    return null;
  }

  // ============================================================
  // 領土
  // ============================================================
  private claimTile(nation: Nation, i: number): void {
    const prev = this.owner[i];
    const nIdx = this.nationIdxById.get(nation.id)!;
    if (prev === nIdx) return;
    if (prev >= 0) this.nations[prev].territoryCount--;
    this.owner[i] = nIdx;
    nation.territoryCount++;
    this.markDirty(i);
  }

  private freeTile(i: number): void {
    const prev = this.owner[i];
    if (prev >= 0) {
      this.nations[prev].territoryCount--;
      this.owner[i] = -1;
      this.markDirty(i);
    }
  }

  private forEachBrush(cx: number, cy: number, r: number, cb: (i: number, x: number, y: number) => void): void {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (dx * dx + dy * dy > r * r + r * 0.5) continue;
        const x = cx + dx;
        const y = cy + dy;
        if (!this.inBounds(x, y)) continue;
        cb(this.idx(x, y), x, y);
      }
    }
  }

  private sumPopulation(nation: Nation): number {
    let p = 0;
    for (const cid of nation.cityIds) {
      const c = this.cityById(cid);
      if (c) p += c.population;
    }
    return Math.round(p);
  }

  // ============================================================
  // 外交
  // ============================================================
  relation(a: Nation, b: Nation): Relation {
    let r = a.relations[b.id];
    if (!r) {
      const base = a.cultureId === b.cultureId ? this.rng.int(-5, 25) : this.rng.int(-25, 15);
      r = { status: "peace", score: base, sinceYear: this.year };
      a.relations[b.id] = r;
      b.relations[a.id] = { status: "peace", score: base, sinceYear: this.year };
    }
    return r;
  }

  private setRelation(a: Nation, b: Nation, status: RelationStatus, score?: number, truceUntil?: number): void {
    const ra = this.relation(a, b);
    const rb = b.relations[a.id]!;
    ra.status = rb.status = status;
    ra.sinceYear = rb.sinceYear = this.year;
    if (score !== undefined) ra.score = rb.score = score;
    ra.truceUntil = rb.truceUntil = truceUntil;
  }

  declareWar(a: Nation, b: Nation, reason: string, depth = 0): void {
    if (!a.alive || !b.alive || a.id === b.id) return;
    const r = this.relation(a, b);
    if (r.status === "war") return;
    this.setRelation(a, b, "war", -80);
    this.pushEvent("war", 2, `${a.name}が${b.name}に宣戦布告。${reason}`, [a.id, b.id]);
    // 同盟国の参戦 (1段のみ・義理堅い同盟だけが動く)
    if (depth === 0) {
      for (const ally of this.aliveNations()) {
        if (ally.id === a.id || ally.id === b.id) continue;
        if (this.relation(ally, b).status !== "alliance") continue;
        if (this.relation(ally, a).status === "war") continue;
        // 疲弊していると参戦を渋る
        if (ally.warExhaustion > 40 || ally.stability < 40) {
          this.pushEvent("diplomacy", 0, `${ally.name}は同盟の呼びかけに応じなかった。`, [ally.id, b.id]);
          this.relation(ally, b).score -= 25;
          b.relations[ally.id]!.score -= 25;
          continue;
        }
        this.pushEvent("war", 1, `${ally.name}は同盟に従い${b.name}側で参戦した。`, [ally.id]);
        this.declareWar(ally, a, "同盟の義務", 1);
      }
    }
  }

  makePeace(a: Nation, b: Nation, note = ""): void {
    const r = this.relation(a, b);
    if (r.status !== "war") return;
    this.setRelation(a, b, "truce", -15, this.year + 8);
    a.warExhaustion = Math.max(0, a.warExhaustion - 25);
    b.warExhaustion = Math.max(0, b.warExhaustion - 25);
    this.pushEvent("diplomacy", 1, `${a.name}と${b.name}が休戦した。${note}`, [a.id, b.id]);
    // 進軍中の軍を帰還させる
    for (const army of this.armies.values()) {
      if (
        (army.nationId === a.id || army.nationId === b.id) &&
        army.targetCityId &&
        this.cityById(army.targetCityId) &&
        (this.cityById(army.targetCityId)!.nationId === a.id || this.cityById(army.targetCityId)!.nationId === b.id)
      ) {
        this.sendArmyHome(army);
      }
    }
  }

  makeAlliance(a: Nation, b: Nation): void {
    this.setRelation(a, b, "alliance", Math.max(this.relation(a, b).score, 70));
    this.pushEvent("diplomacy", 2, `${a.name}と${b.name}が同盟を結んだ。`, [a.id, b.id]);
  }

  private atWarWith(n: Nation): Nation[] {
    return this.aliveNations().filter((o) => o.id !== n.id && this.relation(n, o).status === "war");
  }

  // ============================================================
  // メインループ: 1ヶ月進める
  // ============================================================
  step(): void {
    this.tick++;
    // 補間用に前位置を記録
    for (const a of this.armies.values()) {
      a.px = a.x;
      a.py = a.y;
    }
    for (const u of this.units) {
      u.px = u.x;
      u.py = u.y;
    }
    for (const t of this.tornadoes) {
      t.px = t.x;
      t.py = t.y;
    }

    this.updateEnvironment();
    this.rebuildBorders();
    this.updateNationsMonthly();
    this.updateWarFronts();
    this.updateArmies();
    if (this.month === 0) this.updateYearly();
    this.updateUnits();
    this.updateTornadoes();

    // fx寿命
    for (const f of this.fx) f.age++;
    this.fx = this.fx.filter((f) => f.age <= f.life);
    if (this.fx.length > 300) this.fx.splice(0, this.fx.length - 300);
  }

  // ---- 環境 (火事・疫病・再生) ------------------------------
  private updateEnvironment(): void {
    // 火の延焼と鎮火
    if (this.burningTiles.size > 0) {
      const toIgnite: number[] = [];
      for (const i of this.burningTiles) {
        this.burn[i]--;
        const x = i % this.width;
        const y = Math.floor(i / this.width);
        const cIdx = this.cityAt[i];
        if (cIdx >= 0) {
          const c = this.cities[cIdx];
          c.population = Math.max(0, Math.floor(c.population * 0.94));
          c.prosperity = Math.max(0, c.prosperity - 2);
        }
        if (this.burn[i] <= 0) {
          this.burningTiles.delete(i);
          if (FLAMMABLE.has(this.terrain[i])) {
            this.terrain[i] = T.burnt;
            this.fertility[i] = 0.2;
          }
          this.markDirty(i);
        } else {
          for (const [dx, dy] of DIRS4) {
            const nx = x + dx;
            const ny = y + dy;
            if (!this.inBounds(nx, ny)) continue;
            const j = this.idx(nx, ny);
            if (this.burn[j] === 0 && FLAMMABLE.has(this.terrain[j]) && this.terrain[j] !== T.plains && this.rng.bool(0.32)) {
              toIgnite.push(j);
            }
          }
        }
      }
      for (const j of toIgnite) this.igniteTile(j, this.rng.int(2, 4));
    }

    // 焦土・溶岩の回復 (毎月ランダムサンプリング)
    const samples = 240;
    const size = this.width * this.height;
    for (let s = 0; s < samples; s++) {
      const i = this.rng.int(0, size - 1);
      const t = this.terrain[i];
      if (t === T.burnt && this.rng.bool(0.12)) {
        this.terrain[i] = this.moisture[i] > 0.55 ? T.forest : T.plains;
        this.fertility[i] = Math.min(1, this.fertility[i] + 0.3);
        this.markDirty(i);
      } else if (t === T.lava && this.rng.bool(0.18)) {
        this.terrain[i] = T.mountain;
        this.markDirty(i);
      }
    }

    // 疫病
    for (const c of this.cities) {
      if (c.plagueTicks > 0) {
        c.plagueTicks--;
        c.population = Math.max(0, Math.floor(c.population * 0.972));
        c.prosperity = Math.max(0, c.prosperity - 1);
        c.unrest = Math.min(100, c.unrest + 1);
        if (c.plagueTicks === 0) {
          this.pushEvent("disaster", 0, `${c.name}の疫病が終息した。`, [c.nationId], c.x, c.y);
        } else if (this.rng.bool(0.05)) {
          // 近隣都市へ伝播
          let nearest: City | null = null;
          let best = 13;
          for (const o of this.cities) {
            if (o === c || o.plagueTicks > 0 || o.population < 100) continue;
            const d = Math.hypot(o.x - c.x, o.y - c.y);
            if (d < best) {
              best = d;
              nearest = o;
            }
          }
          if (nearest) {
            nearest.plagueTicks = this.rng.int(14, 22);
            this.pushEvent("disaster", 1, `疫病が${nearest.name}に飛び火した。`, [nearest.nationId], nearest.x, nearest.y);
          }
        }
      }
    }
  }

  igniteTile(i: number, months: number): void {
    if (isWater(this.terrain[i]) || this.terrain[i] === T.lava) return;
    if (!FLAMMABLE.has(this.terrain[i]) && this.cityAt[i] === -1) return;
    this.burn[i] = Math.max(this.burn[i], months);
    this.burningTiles.add(i);
  }

  // ---- 国境タイルの再計算 (月1回、全走査1パス) ---------------
  private rebuildBorders(): void {
    this.borders.clear();
    this.contacts.clear();
    const w = this.width;
    const h = this.height;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        const o = this.owner[i];
        if (o < 0 || !this.nations[o].alive) continue;
        let isBorder = false;
        for (const [dx, dy] of DIRS4) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const j = ny * w + nx;
          const oj = this.owner[j];
          if (oj === -1 && isLand(this.terrain[j])) {
            isBorder = true;
          } else if (oj >= 0 && oj !== o && isLand(this.terrain[j])) {
            // 他国と接するタイル (前線候補)
            let list = this.contacts.get(o);
            if (!list) this.contacts.set(o, (list = []));
            list.push({ i: j, enemy: oj });
          }
        }
        if (isBorder) {
          let arr = this.borders.get(o);
          if (!arr) this.borders.set(o, (arr = []));
          arr.push(i);
        }
      }
    }
  }

  /**
   * 戦争中の国境侵食。
   * 都市を落とさなくても、優勢な側が敵領を少しずつ削り取っていく。
   */
  private updateWarFronts(): void {
    for (const [nIdx, list] of this.contacts) {
      const n = this.nations[nIdx];
      if (!n.alive || list.length === 0) continue;
      const power = (x: Nation) =>
        x.military * 0.5 +
        x.armyIds.reduce((s, id) => s + (this.armies.get(id)?.strength ?? 0), 0) +
        x.population * 0.02 * x.tech;
      const myPower = power(n);
      const tries = Math.min(10, 2 + Math.floor(list.length / 24));
      for (let k = 0; k < tries; k++) {
        const pick = list[this.rng.int(0, list.length - 1)];
        const enemy = this.nations[pick.enemy];
        if (!enemy || !enemy.alive) continue;
        if (this.relation(n, enemy).status !== "war") continue;
        if (this.cityAt[pick.i] !== -1) continue; // 都市は包囲でしか取れない
        const ratio = myPower / (myPower + power(enemy) + 1);
        if (this.rng.bool(Math.max(0, (ratio - 0.5) * 0.5))) {
          this.claimTile(n, pick.i);
        }
      }
    }
  }

  // ---- 毎月の国家処理 (領土拡張・都市成長) -------------------
  private updateNationsMonthly(): void {
    for (let nIdx = 0; nIdx < this.nations.length; nIdx++) {
      const n = this.nations[nIdx];
      if (!n.alive) continue;

      // 領土拡張 (WorldBox風のにじみ拡大)
      const border = this.borders.get(nIdx);
      if (border && border.length > 0) {
        const attempts = Math.min(16, 2 + n.cityIds.length * 2);
        for (let a = 0; a < attempts; a++) {
          const i = border[this.rng.int(0, border.length - 1)];
          const x = i % this.width;
          const y = Math.floor(i / this.width);
          const [dx, dy] = DIRS4[this.rng.int(0, 3)];
          const nx = x + dx;
          const ny = y + dy;
          if (!this.inBounds(nx, ny)) continue;
          const j = this.idx(nx, ny);
          if (this.owner[j] !== -1 || !isLand(this.terrain[j])) continue;
          const t = this.terrain[j];
          if ((t === T.mountain || t === T.lava) && !this.rng.bool(0.08)) continue;
          let p = 0.2 + this.fertility[j] * 0.45 + (n.stability - 50) / 350;
          if (n.blessedYears > 0) p += 0.2;
          if (n.cursedYears > 0) p -= 0.2;
          if (this.rng.bool(Math.max(0.02, Math.min(0.9, p)))) {
            this.claimTile(n, j);
          }
        }
      }

      // 都市の成長 (毎月)
      for (const cid of n.cityIds) {
        const c = this.cityById(cid);
        if (!c) continue;
        if (c.siegeBy || c.plagueTicks > 0) continue;
        const fert = this.fertility[this.idx(c.x, c.y)];
        const cap = 2600 + c.prosperity * 190 + (c.isCapital ? 4200 : 0);
        const g = 0.004 * (0.5 + fert) * (0.6 + c.prosperity / 120) * (1 - c.unrest / 220);
        c.population = Math.min(cap, Math.floor(c.population * (1 + g)) + 1);
      }
      n.population = this.sumPopulation(n);
    }
  }

  // ============================================================
  // 軍団
  // ============================================================
  private createArmy(n: Nation, x: number, y: number, strength: number): Army {
    const army: Army = {
      id: this.newId("a"),
      nationId: n.id,
      name: this.nameGen.armyName(cultureById(n.cultureId), n.armyIds.length + 1),
      x,
      y,
      px: x,
      py: y,
      tx: x,
      ty: y,
      strength: Math.round(strength),
      morale: 80,
      state: "guard",
      targetCityId: null,
      atSea: false,
      seaMonths: 0
    };
    this.armies.set(army.id, army);
    n.armyIds.push(army.id);
    return army;
  }

  private disbandArmy(army: Army, returnManpower = true): void {
    const n = this.nationById(army.nationId);
    if (n) {
      n.armyIds = n.armyIds.filter((id) => id !== army.id);
      if (returnManpower) n.military += army.strength * 0.4;
    }
    // 包囲を解除
    if (army.targetCityId) {
      const c = this.cityById(army.targetCityId);
      if (c && c.siegeBy === army.nationId) {
        c.siegeBy = null;
        c.siegeProgress = 0;
      }
    }
    this.armies.delete(army.id);
  }

  private sendArmyHome(army: Army): void {
    const n = this.nationById(army.nationId);
    const cap = n ? this.cityById(n.capitalCityId) : null;
    if (army.targetCityId) {
      const c = this.cityById(army.targetCityId);
      if (c && c.siegeBy === army.nationId) {
        c.siegeBy = null;
        c.siegeProgress = 0;
      }
    }
    army.targetCityId = null;
    if (cap) {
      army.state = "return";
      army.tx = cap.x;
      army.ty = cap.y;
    } else {
      this.disbandArmy(army);
    }
  }

  private armyPickTarget(army: Army): void {
    const n = this.nationById(army.nationId);
    if (!n) return;
    const enemies = this.atWarWith(n);
    let best: City | null = null;
    let bestD = Infinity;
    for (const e of enemies) {
      for (const cid of e.cityIds) {
        const c = this.cityById(cid);
        if (!c) continue;
        const d = Math.hypot(c.x - army.x, c.y - army.y);
        if (d < bestD) {
          bestD = d;
          best = c;
        }
      }
    }
    if (best) {
      army.state = "march";
      army.targetCityId = best.id;
      army.tx = best.x;
      army.ty = best.y;
    } else {
      this.sendArmyHome(army);
    }
  }

  private updateArmies(): void {
    const list = [...this.armies.values()];

    // --- 会戦判定 (敵対する軍が接近したら) ---
    const fought = new Set<string>();
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i];
        const b = list[j];
        if (!this.armies.has(a.id) || !this.armies.has(b.id)) continue;
        if (a.nationId === b.nationId) continue;
        const na = this.nationById(a.nationId);
        const nb = this.nationById(b.nationId);
        if (!na || !nb) continue;
        if (this.relation(na, nb).status !== "war") continue;
        if (Math.hypot(a.x - b.x, a.y - b.y) > 1.7) continue;
        const key = a.id + b.id;
        if (fought.has(key)) continue;
        fought.add(key);
        this.resolveBattle(a, b, na, nb);
      }
    }

    // --- 移動と包囲 ---
    for (const army of list) {
      if (!this.armies.has(army.id)) continue;
      const n = this.nationById(army.nationId);
      if (!n || !n.alive) {
        this.disbandArmy(army, false);
        continue;
      }

      // 目標都市の状態確認
      if (army.targetCityId) {
        const c = this.cityById(army.targetCityId);
        const tn = c ? this.nationById(c.nationId) : null;
        if (!c || !tn || this.relation(n, tn).status !== "war") {
          this.armyPickTarget(army);
        }
      } else if (army.state === "guard" && this.atWarWith(n).length > 0) {
        this.armyPickTarget(army);
      }

      const dist = Math.hypot(army.tx - army.x, army.ty - army.y);
      if (dist > 0.7) {
        this.moveArmy(army);
      } else if (army.state === "march" && army.targetCityId) {
        // 包囲開始
        const c = this.cityById(army.targetCityId)!;
        army.state = "siege";
        if (!c.siegeBy) {
          c.siegeBy = army.nationId;
          c.siegeProgress = 0;
          this.pushEvent("war", 1, `${n.name}軍が${c.name}を包囲した。`, [n.id, c.nationId], c.x, c.y);
        }
      } else if (army.state === "return") {
        army.state = "guard";
      }

      // 包囲の進行
      if (army.state === "siege" && army.targetCityId) {
        const c = this.cityById(army.targetCityId)!;
        if (c.siegeBy === army.nationId) {
          c.siegeProgress += Math.max(2, 9 + army.strength / 80 - c.fortification / 7);
          c.population = Math.max(50, Math.floor(c.population * 0.985));
          c.fortification = Math.max(0, c.fortification - 1);
          if (c.siegeProgress >= 100) {
            this.captureCity(c, n, army);
          }
        }
      }

      // 士気の自然回復
      if (army.state !== "siege") army.morale = Math.min(100, army.morale + 2);
    }
  }

  private moveArmy(army: Army): void {
    const speed = army.atSea ? 0.5 : 0.9;
    const dx = army.tx - army.x;
    const dy = army.ty - army.y;
    const d = Math.hypot(dx, dy) || 1;
    let nx = army.x + (dx / d) * speed;
    let ny = army.y + (dy / d) * speed;
    const txi = Math.round(nx);
    const tyi = Math.round(ny);
    if (this.inBounds(txi, tyi)) {
      const t = this.terrain[this.idx(txi, tyi)];
      if (t === T.mountain || t === T.lava) {
        // 山は迂回を試みる
        const ang = Math.atan2(dy, dx) + (this.rng.bool() ? 0.9 : -0.9);
        nx = army.x + Math.cos(ang) * speed;
        ny = army.y + Math.sin(ang) * speed;
      }
    }
    nx = Math.max(0, Math.min(this.width - 1, nx));
    ny = Math.max(0, Math.min(this.height - 1, ny));
    army.x = nx;
    army.y = ny;
    const t = this.terrain[this.idx(Math.round(nx), Math.round(ny))];
    if (isWater(t)) {
      army.atSea = true;
      army.seaMonths++;
      army.strength = Math.floor(army.strength * 0.975);
      if (army.seaMonths > 20 || army.strength < 60) {
        const n = this.nationById(army.nationId);
        this.pushEvent("war", 1, `${n?.name ?? "?"}の${army.name}は嵐に呑まれ海に消えた。`, n ? [n.id] : [], army.x, army.y);
        this.disbandArmy(army, false);
      }
    } else {
      army.atSea = false;
      army.seaMonths = 0;
    }
  }

  private resolveBattle(a: Army, b: Army, na: Nation, nb: Nation): void {
    const homeA = this.nationAtTile(Math.round(a.x), Math.round(a.y))?.id === na.id ? 1.12 : 1;
    const homeB = this.nationAtTile(Math.round(b.x), Math.round(b.y))?.id === nb.id ? 1.12 : 1;
    const mult = (n: Nation) => 0.7 + n.tech * 0.3;
    const powA = a.strength * (0.8 + a.morale / 250) * mult(na) * homeA * this.rng.range(0.88, 1.12);
    const powB = b.strength * (0.8 + b.morale / 250) * mult(nb) * homeB * this.rng.range(0.88, 1.12);
    const winner = powA >= powB ? a : b;
    const loser = winner === a ? b : a;
    const wn = winner === a ? na : nb;
    const ln = winner === a ? nb : na;

    const lCas = Math.floor(loser.strength * this.rng.range(0.35, 0.55));
    const wCas = Math.floor(lCas * this.rng.range(0.35, 0.55));
    loser.strength -= lCas;
    winner.strength -= wCas;
    loser.morale = Math.max(5, loser.morale - 30);
    winner.morale = Math.min(100, winner.morale + 8);
    ln.warExhaustion = Math.min(100, ln.warExhaustion + 6);
    wn.warExhaustion = Math.min(100, wn.warExhaustion + 3);

    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2;
    this.fx.push({ kind: "battle", x: mx, y: my, age: 0, life: 20 });
    this.fx.push({ kind: "explosion", x: mx, y: my, age: 0, life: 8, radius: 1.2 });
    this.pushEvent(
      "war",
      1,
      `${wn.name}軍が${ln.name}軍を破った (損害 ${lCas}/${wCas})。`,
      [wn.id, ln.id],
      mx,
      my
    );

    if (loser.strength < 100) {
      this.pushEvent("war", 0, `${ln.name}の${loser.name}は壊滅した。`, [ln.id], mx, my);
      this.disbandArmy(loser, false);
      ln.military += 100;
    } else {
      // 敗軍は後退
      this.sendArmyHome(loser);
    }
  }

  private captureCity(city: City, winner: Nation, army: Army): void {
    const loser = this.nationById(city.nationId);
    if (!loser) return;
    const wasCapital = city.isCapital;

    // 都市の所属変更
    loser.cityIds = loser.cityIds.filter((id) => id !== city.id);
    city.nationId = winner.id;
    city.isCapital = false;
    city.siegeBy = null;
    city.siegeProgress = 0;
    city.unrest = 48;
    city.conqueredYear = this.year;
    city.fortification = Math.max(0, city.fortification - 25);
    winner.cityIds.push(city.id);

    // 周辺領土の割譲 (BFS 半径6)
    const loserIdx = this.nationIdxById.get(loser.id)!;
    const start = this.idx(city.x, city.y);
    const visited = new Set<number>([start]);
    let frontier = [start];
    this.claimTile(winner, start);
    for (let r = 0; r < 6; r++) {
      const next: number[] = [];
      for (const i of frontier) {
        const x = i % this.width;
        const y = Math.floor(i / this.width);
        for (const [dx, dy] of DIRS4) {
          const nx = x + dx;
          const ny = y + dy;
          if (!this.inBounds(nx, ny)) continue;
          const j = this.idx(nx, ny);
          if (visited.has(j)) continue;
          visited.add(j);
          if (this.owner[j] === loserIdx && this.cityAt[j] === -1) {
            this.claimTile(winner, j);
            next.push(j);
          }
        }
      }
      frontier = next;
    }

    // 略奪
    const loot = Math.min(Math.floor(loser.treasury * 0.35), 500);
    loser.treasury -= loot;
    winner.treasury += loot;
    loser.stability = Math.max(0, loser.stability - 12);
    army.strength = Math.floor(army.strength * 0.9);
    army.morale = Math.min(100, army.morale + 10);

    this.fx.push({ kind: "explosion", x: city.x, y: city.y, age: 0, life: 10, radius: 1.6 });
    this.pushEvent(
      "war",
      wasCapital ? 2 : 1,
      wasCapital
        ? `${winner.name}が${loser.name}の首都${city.name}を陥落させた!`
        : `${winner.name}が${city.name}を占領した。`,
      [winner.id, loser.id],
      city.x,
      city.y
    );

    // 首都を失った場合
    if (wasCapital) {
      const rest = loser.cityIds.map((id) => this.cityById(id)).filter((c): c is City => !!c);
      if (rest.length > 0) {
        const newCap = rest.reduce((a, b) => (a.population >= b.population ? a : b));
        newCap.isCapital = true;
        loser.capitalCityId = newCap.id;
        this.pushEvent("city", 1, `${loser.name}は${newCap.name}に遷都した。`, [loser.id], newCap.x, newCap.y);
      } else {
        loser.capitalCityId = null;
      }
    }
    this.checkNationDeath(loser, `${winner.name}に征服され`);
    this.armyPickTarget(army);
  }

  private checkNationDeath(n: Nation, cause: string): void {
    if (!n.alive || n.cityIds.length > 0) return;
    n.alive = false;
    n.fallYear = this.year;
    const nIdx = this.nationIdxById.get(n.id)!;
    // 残存領土の解放
    for (let i = 0; i < this.owner.length; i++) {
      if (this.owner[i] === nIdx) {
        this.owner[i] = -1;
        this.markDirty(i);
      }
    }
    n.territoryCount = 0;
    for (const aid of [...n.armyIds]) {
      const a = this.armies.get(aid);
      if (a) this.disbandArmy(a, false);
    }
    const king = this.people.get(n.kingId ?? "");
    if (king) king.alive = false;
    this.pushEvent("founding", 2, `${n.name}は${cause}、歴史から姿を消した (存続${this.year - n.foundedYear}年)。`, [n.id]);
  }

  // ============================================================
  // 毎年の処理
  // ============================================================
  private updateYearly(): void {
    // 資源カウント (1パス)
    const resCount = new Map<number, { gold: number; iron: number; gem: number; grain: number; horse: number; coast: number }>();
    for (let i = 0; i < this.owner.length; i++) {
      const o = this.owner[i];
      if (o < 0) continue;
      let rec = resCount.get(o);
      if (!rec) resCount.set(o, (rec = { gold: 0, iron: 0, gem: 0, grain: 0, horse: 0, coast: 0 }));
      switch (this.resource[i]) {
        case R.gold:
          rec.gold++;
          break;
        case R.iron:
          rec.iron++;
          break;
        case R.gem:
          rec.gem++;
          break;
        case R.grain:
          rec.grain++;
          break;
        case R.horse:
          rec.horse++;
          break;
      }
    }

    for (let nIdx = 0; nIdx < this.nations.length; nIdx++) {
      const n = this.nations[nIdx];
      if (!n.alive) continue;
      const res = resCount.get(nIdx) ?? { gold: 0, iron: 0, gem: 0, grain: 0, horse: 0, coast: 0 };
      const king = this.people.get(n.kingId ?? "");

      // --- 経済 ---
      let armyUpkeep = 0;
      for (const aid of n.armyIds) armyUpkeep += (this.armies.get(aid)?.strength ?? 0) * 0.05;
      const income =
        n.population * 0.016 * n.tech + res.gold * 35 + res.gem * 26 + res.grain * 9 + n.cityIds.length * 6;
      const upkeep = armyUpkeep + n.cityIds.length * 10;
      n.treasury = Math.max(-300, n.treasury + income - upkeep);
      if (n.treasury < 0) n.stability = Math.max(0, n.stability - 4);

      // --- 軍事力プール ---
      const manCap = n.population * 0.06 + res.iron * 120;
      n.military = Math.min(manCap, n.military + n.population * 0.014 + res.iron * 30);

      // --- 技術 ---
      n.tech += 0.016 + (king ? king.traits.wisdom * 0.0003 : 0) + (n.blessedYears > 0 ? 0.02 : 0);

      // --- 安定度 ---
      const target =
        52 +
        (king ? (king.traits.charisma - 50) / 5 : 0) -
        n.warExhaustion / 3 -
        (n.treasury < 0 ? 8 : 0) -
        (n.cursedYears > 0 ? 15 : 0) +
        (n.blessedYears > 0 ? 8 : 0);
      n.stability += (target - n.stability) * 0.25;
      n.stability = Math.max(0, Math.min(100, n.stability));

      // --- 戦争疲弊 ---
      if (this.atWarWith(n).length > 0) n.warExhaustion = Math.min(100, n.warExhaustion + 5);
      else n.warExhaustion = Math.max(0, n.warExhaustion - 8);

      if (n.blessedYears > 0) n.blessedYears--;
      if (n.cursedYears > 0) n.cursedYears--;

      // --- 都市: 繁栄と不穏 ---
      for (const cid of n.cityIds) {
        const c = this.cityById(cid);
        if (!c) continue;
        let resNear = false;
        this.forEachBrush(c.x, c.y, 2, (i) => {
          if (this.resource[i] !== R.none) resNear = true;
        });
        const pTarget =
          28 + this.fertility[this.idx(c.x, c.y)] * 42 + (c.isCapital ? 16 : 0) + (resNear ? 10 : 0) - (c.siegeBy ? 25 : 0);
        c.prosperity += (pTarget - c.prosperity) * 0.3;
        c.prosperity = Math.max(0, Math.min(100, c.prosperity));
        c.fortification = Math.min(100, c.fortification + (c.isCapital ? 3 : 2));

        // 統治が安定しているほど早く落ち着く (征服地の同化)
        let dUnrest = -4 - c.prosperity / 25 - (n.stability - 50) / 12;
        if (n.stability < 32) dUnrest += 6;
        if (c.conqueredYear && this.year - c.conqueredYear < 8) dUnrest += 5;
        if (c.plagueTicks > 0) dUnrest += 4;
        if (n.treasury < 0) dUnrest += 2;
        // 巨大帝国は辺境の統治が緩む
        if (n.cityIds.length > 8) dUnrest += (n.cityIds.length - 8) * 0.35;
        c.unrest = Math.max(0, Math.min(100, c.unrest + dUnrest));
      }

      // --- AIの都市建設 ---
      if (
        n.treasury > 320 &&
        n.cityIds.length < Math.max(2, Math.floor(n.territoryCount / 38) + 1) &&
        this.rng.bool(0.5)
      ) {
        this.aiFoundCity(n, nIdx);
      }

      // --- 軍の編成 (戦時) ---
      const enemies = this.atWarWith(n);
      if (enemies.length > 0) {
        const maxArmies = 1 + Math.floor(n.cityIds.length / 3);
        if (n.armyIds.length < maxArmies && n.military > 500 && n.treasury > 60) {
          const cap = this.cityById(n.capitalCityId);
          if (cap) {
            const strength = Math.min(n.military * 0.55, 500 + n.population * 0.04);
            n.military -= strength;
            const army = this.createArmy(n, cap.x, cap.y, strength);
            this.armyPickTarget(army);
            this.pushEvent("war", 0, `${n.name}が${army.name} (${Math.round(strength)}) を編成した。`, [n.id], cap.x, cap.y);
          }
        }
      } else if (n.armyIds.length > 0 && this.rng.bool(0.4)) {
        // 平時は徐々に解散
        const a = this.armies.get(n.armyIds[0]);
        if (a && a.state === "guard") this.disbandArmy(a);
      }

      // --- 反乱 ---
      this.checkRebellion(n);

      // --- 王位継承 ---
      this.updateSuccession(n);

      // --- 統計 ---
      n.stats.push({ y: this.year, pop: n.population, mil: Math.round(n.military), tech: n.tech });
      if (n.stats.length > 120) n.stats.shift();
    }

    this.updateDiplomacyYearly();

    this.worldStats.push({ y: this.year, pop: this.worldPopulation(), nations: this.aliveNations().length });
    if (this.worldStats.length > 240) this.worldStats.shift();
  }

  private aiFoundCity(n: Nation, nIdx: number): void {
    // 自国領土から都市候補を探す (他都市から距離7以上)
    for (let tries = 0; tries < 30; tries++) {
      const i = this.rng.int(0, this.owner.length - 1);
      if (this.owner[i] !== nIdx) continue;
      const x = i % this.width;
      const y = Math.floor(i / this.width);
      if (!isPassable(this.terrain[i]) || this.cityAt[i] !== -1) continue;
      let ok = true;
      for (const c of this.cities) {
        if (c.population > 0 && Math.hypot(c.x - x, c.y - y) < 7) {
          ok = false;
          break;
        }
      }
      if (!ok || this.fertility[i] < 0.3) continue;
      n.treasury -= 250;
      const city = this.createCity(n, x, y, false, this.rng.int(350, 600));
      if (city) {
        this.pushEvent("city", 1, `${n.name}が新都市${city.name}を築いた。`, [n.id], x, y);
      }
      return;
    }
  }

  private checkRebellion(n: Nation): void {
    // 都市が2つ以下の小国は分裂しない
    if (n.cityIds.length < 3) return;
    for (const cid of [...n.cityIds]) {
      const c = this.cityById(cid);
      if (!c || c.isCapital || c.population < 700) continue;
      // 中央から遠いほど反乱しやすい
      const cap = this.cityById(n.capitalCityId);
      const dist = cap ? Math.hypot(cap.x - c.x, cap.y - c.y) : 99;
      const far = dist > 12 ? 1 : dist / 12;
      const chance = 0.07 * far * (n.stability < 45 ? 1.8 : 1);
      if (c.unrest > 90 && this.rng.bool(chance)) {
        // 独立
        n.cityIds = n.cityIds.filter((id) => id !== cid);
        const rebel = this.foundNation(c.x, c.y, {
          cultureId: n.cultureId,
          fromCity: c,
          radius: 0,
          silent: true
        });
        if (!rebel) {
          n.cityIds.push(cid);
          continue;
        }
        // 周辺タイルを持っていく
        const nIdx = this.nationIdxById.get(n.id)!;
        this.forEachBrush(c.x, c.y, 5, (i) => {
          if (this.owner[i] === nIdx && this.cityAt[i] === -1) this.claimTile(rebel, i);
        });
        c.unrest = 25;
        n.stability = Math.max(0, n.stability - 10);
        this.pushEvent("founding", 2, `${c.name}が反乱! ${rebel.name}として独立を宣言した。`, [rebel.id, n.id], c.x, c.y);
        this.declareWar(rebel, n, "独立戦争", 1);
      }
    }
  }

  private updateSuccession(n: Nation): void {
    const king = this.people.get(n.kingId ?? "");
    const heir = this.people.get(n.heirId ?? "");
    const culture = cultureById(n.cultureId);
    if (heir) heir.age++;
    if (!king || !king.alive) return;
    king.age++;

    let deathChance = king.age < 50 ? 0.008 : (king.age - 45) * 0.0045;
    if (n.stability < 25 && this.rng.bool(0.06)) {
      deathChance = 1; // 暗殺
      this.pushEvent("succession", 2, `${n.name}の${king.name}が暗殺された!`, [n.id]);
      n.stability = Math.max(0, n.stability - 15);
    }
    if (this.rng.next() < deathChance) {
      king.alive = false;
      king.diedYear = this.year;
      // 二つ名
      const t = king.traits;
      if (t.ambition > 78) king.epithet = this.nameGen.epithet("conqueror");
      else if (t.wisdom > 78) king.epithet = this.nameGen.epithet("wise");
      else if (t.charisma > 78) king.epithet = this.nameGen.epithet(this.rng.bool() ? "pious" : "builder");

      const title = culture.kingTitle[king.gender];
      if (heir && heir.alive) {
        heir.role = "king";
        heir.reignStart = this.year;
        n.kingId = heir.id;
        const newHeir = this.makePerson(n.id, culture, "heir", this.rng.int(4, 14));
        n.heirId = newHeir.id;
        const reign = this.year - (king.reignStart ?? this.year);
        this.pushEvent(
          "succession",
          1,
          `${n.name}の${title}${king.name}${king.epithet ? `「${king.epithet}」` : ""}が崩御 (在位${reign}年)。${heir.name}が即位した。`,
          [n.id]
        );
      } else {
        // 継承危機
        const newKing = this.makePerson(n.id, culture, "king", this.rng.int(28, 50));
        newKing.reignStart = this.year;
        n.kingId = newKing.id;
        const newHeir = this.makePerson(n.id, culture, "heir", this.rng.int(4, 14));
        n.heirId = newHeir.id;
        n.stability = Math.max(0, n.stability - 20);
        n.dynasty = this.nameGen.dynastyName(culture, newKing.name);
        this.pushEvent("succession", 2, `${n.name}で継承危機! 重臣${newKing.name}が王位を奪い、${n.dynasty}が開かれた。`, [n.id]);
      }
    }
  }

  private updateDiplomacyYearly(): void {
    const alive = this.aliveNations();

    // 関係スコアの自然変動
    for (let i = 0; i < alive.length; i++) {
      for (let j = i + 1; j < alive.length; j++) {
        const a = alive[i];
        const b = alive[j];
        const r = this.relation(a, b);
        const rb = b.relations[a.id]!;
        if (r.status === "war") continue;
        if (r.status === "truce" && r.truceUntil !== undefined && this.year >= r.truceUntil) {
          this.setRelation(a, b, "peace", r.score);
        }
        const capA = this.cityById(a.capitalCityId);
        const capB = this.cityById(b.capitalCityId);
        const near =
          capA && capB ? Math.hypot(capA.x - capB.x, capA.y - capB.y) < (this.width + this.height) / 6.5 : false;
        let drift = this.rng.range(-1.6, 1.6);
        if (a.cultureId === b.cultureId) drift += 0.5;
        if (near) drift -= 1.4;
        if (r.status === "alliance") drift += 2;
        r.score = rb.score = Math.max(-100, Math.min(100, r.score + drift));
      }
    }

    // 各国の外交判断
    for (const n of this.rng.shuffle(alive)) {
      if (!n.alive) continue;
      const king = this.people.get(n.kingId ?? "");
      const ambition = king ? king.traits.ambition : 50;

      // 開戦
      if (this.atWarWith(n).length === 0 && n.warExhaustion < 25 && n.stability > 40) {
        const targets = alive.filter((o) => {
          if (o.id === n.id || !o.alive) return false;
          const r = this.relation(n, o);
          if (r.status !== "peace" || r.score > -35) return false;
          const capA = this.cityById(n.capitalCityId);
          const capB = this.cityById(o.capitalCityId);
          if (!capA || !capB) return false;
          return Math.hypot(capA.x - capB.x, capA.y - capB.y) < (this.width + this.height) / 5;
        });
        if (targets.length > 0 && this.rng.next() < 0.05 + ambition / 800) {
          const target = targets.reduce((a, b) =>
            this.relation(n, a).score <= this.relation(n, b).score ? a : b
          );
          if (n.military + 500 > target.military * 0.7) {
            this.declareWar(n, target, king ? `${king.name}の野心のままに。` : "");
          }
        }
      }

      // 講和
      for (const enemy of this.atWarWith(n)) {
        const r = this.relation(n, enemy);
        const yearsAtWar = this.year - r.sinceYear;
        if (
          n.warExhaustion > 65 ||
          (yearsAtWar > 12 && this.rng.bool(0.35)) ||
          (n.cityIds.length <= 1 && this.rng.bool(0.6))
        ) {
          this.makePeace(n, enemy);
          break;
        }
      }

      // 同盟
      if (this.rng.bool(0.12)) {
        const friend = alive.find(
          (o) => o.id !== n.id && o.alive && this.relation(n, o).status === "peace" && this.relation(n, o).score > 62
        );
        if (friend) this.makeAlliance(n, friend);
      }
    }
  }

  // ============================================================
  // ユニット (住民・動物・竜)
  // ============================================================
  private spawnUnit(kind: Unit["kind"], x: number, y: number, nationId: string | null, homeCityId?: string): Unit {
    const u: Unit = {
      id: this.newId("u"),
      kind,
      nationId,
      x,
      y,
      px: x,
      py: y,
      tx: x,
      ty: y,
      hp: kind === "dragon" ? 999 : kind === "wolf" ? 30 : 10,
      homeCityId: homeCityId ?? null,
      ttl: kind === "dragon" ? 90 : undefined
    };
    this.units.push(u);
    return u;
  }

  private updateUnits(): void {
    // 住民の補充 (都市ごとに人口比で維持)
    const villagerCount = new Map<string, number>();
    for (const u of this.units) {
      if (u.kind === "villager" && u.homeCityId) {
        villagerCount.set(u.homeCityId, (villagerCount.get(u.homeCityId) ?? 0) + 1);
      }
    }
    let totalVillagers = this.units.filter((u) => u.kind === "villager").length;
    for (const c of this.cities) {
      if (c.population < 150) continue;
      const want = Math.min(5, Math.max(1, Math.round(c.population / 900)));
      const have = villagerCount.get(c.id) ?? 0;
      if (have < want && totalVillagers < 240) {
        this.spawnUnit("villager", c.x + this.rng.range(-1, 1), c.y + this.rng.range(-1, 1), c.nationId, c.id);
        totalVillagers++;
      }
    }

    const dead = new Set<string>();
    for (const u of this.units) {
      if (dead.has(u.id)) continue;
      switch (u.kind) {
        case "villager": {
          const home = this.cityById(u.homeCityId);
          if (!home || home.population < 100) {
            dead.add(u.id);
            break;
          }
          u.nationId = home.nationId;
          this.wanderStep(u, home.x, home.y, 5, 0.35);
          break;
        }
        case "sheep": {
          this.wanderStep(u, u.x, u.y, 4, 0.25);
          break;
        }
        case "wolf": {
          // 獲物を探す
          let prey: Unit | null = null;
          let best = 6;
          for (const o of this.units) {
            if (o.kind !== "sheep" && o.kind !== "villager") continue;
            if (dead.has(o.id)) continue;
            const d = Math.hypot(o.x - u.x, o.y - u.y);
            if (d < best) {
              best = d;
              prey = o;
            }
          }
          if (prey) {
            u.tx = prey.x;
            u.ty = prey.y;
            this.stepToward(u, 0.5);
            if (Math.hypot(prey.x - u.x, prey.y - u.y) < 0.7) {
              dead.add(prey.id);
              u.hp = Math.min(60, u.hp + 10);
            }
          } else {
            this.wanderStep(u, u.x, u.y, 5, 0.4);
            u.hp -= 0.4;
            if (u.hp <= 0) dead.add(u.id);
          }
          break;
        }
        case "dragon": {
          if (u.ttl !== undefined) u.ttl--;
          if ((u.ttl ?? 0) <= 0) {
            dead.add(u.id);
            this.pushEvent("disaster", 1, "竜は破壊に飽き、山の彼方へ去っていった。", [], u.x, u.y);
            break;
          }
          // 都市を狙い、なければ徘徊
          if (Math.hypot(u.tx - u.x, u.ty - u.y) < 1 || this.rng.bool(0.05)) {
            const targetCity = this.cities.filter((c) => c.population > 300)[this.rng.int(0, Math.max(0, this.cities.length - 1))];
            if (targetCity && this.rng.bool(0.6)) {
              u.tx = targetCity.x;
              u.ty = targetCity.y;
            } else {
              u.tx = this.rng.range(2, this.width - 3);
              u.ty = this.rng.range(2, this.height - 3);
            }
          }
          this.stepToward(u, 0.8);
          const ti = this.idx(Math.round(u.x), Math.round(u.y));
          this.igniteTile(ti, 3);
          const cIdx = this.cityAt[ti];
          if (cIdx >= 0) {
            const c = this.cities[cIdx];
            c.population = Math.max(0, Math.floor(c.population * 0.9));
            c.fortification = Math.max(0, c.fortification - 8);
            if (this.rng.bool(0.3)) {
              this.pushEvent("disaster", 1, `竜が${c.name}を焼いている!`, [c.nationId], c.x, c.y);
            }
          }
          break;
        }
      }
      // 火・水・溶岩によるユニット死亡
      if (!dead.has(u.id) && u.kind !== "dragon") {
        const i = this.idx(Math.round(u.x), Math.round(u.y));
        if (this.burn[i] > 0 || this.terrain[i] === T.lava || isWater(this.terrain[i])) dead.add(u.id);
      }
    }
    if (dead.size > 0) this.units = this.units.filter((u) => !dead.has(u.id));
    if (this.units.length > 320) this.units.splice(0, this.units.length - 320);
  }

  private wanderStep(u: Unit, anchorX: number, anchorY: number, range: number, speed: number): void {
    if (Math.hypot(u.tx - u.x, u.ty - u.y) < 0.4 || this.rng.bool(0.06)) {
      for (let tries = 0; tries < 6; tries++) {
        const tx = anchorX + this.rng.range(-range, range);
        const ty = anchorY + this.rng.range(-range, range);
        const xi = Math.round(tx);
        const yi = Math.round(ty);
        if (this.inBounds(xi, yi) && isPassable(this.terrain[this.idx(xi, yi)])) {
          u.tx = tx;
          u.ty = ty;
          break;
        }
      }
    }
    this.stepToward(u, speed);
  }

  private stepToward(u: Unit, speed: number): void {
    const dx = u.tx - u.x;
    const dy = u.ty - u.y;
    const d = Math.hypot(dx, dy);
    if (d < 0.01) return;
    const s = Math.min(speed, d);
    const nx = u.x + (dx / d) * s;
    const ny = u.y + (dy / d) * s;
    const xi = Math.round(nx);
    const yi = Math.round(ny);
    if (u.kind === "dragon" || (this.inBounds(xi, yi) && isPassable(this.terrain[this.idx(xi, yi)]))) {
      u.x = nx;
      u.y = ny;
    } else {
      u.tx = u.x;
      u.ty = u.y;
    }
  }

  private updateTornadoes(): void {
    const remove: Tornado[] = [];
    for (const t of this.tornadoes) {
      t.ttl--;
      if (t.ttl <= 0) {
        remove.push(t);
        continue;
      }
      t.dir += this.rng.range(-0.7, 0.7);
      t.x = Math.max(1, Math.min(this.width - 2, t.x + Math.cos(t.dir) * 0.8));
      t.y = Math.max(1, Math.min(this.height - 2, t.y + Math.sin(t.dir) * 0.8));
      const i = this.idx(Math.round(t.x), Math.round(t.y));
      // 破壊
      const tt = this.terrain[i];
      if (tt === T.forest || tt === T.jungle) {
        this.terrain[i] = T.plains;
        this.markDirty(i);
      }
      const cIdx = this.cityAt[i];
      if (cIdx >= 0) {
        const c = this.cities[cIdx];
        c.population = Math.max(0, Math.floor(c.population * 0.93));
        c.fortification = Math.max(0, c.fortification - 6);
      }
      // 近くのユニットを吹き飛ばす
      this.units = this.units.filter((u) => u.kind === "dragon" || Math.hypot(u.x - t.x, u.y - t.y) > 1.2);
    }
    if (remove.length > 0) this.tornadoes = this.tornadoes.filter((t) => !remove.includes(t));
  }

  // ============================================================
  // 神のツール
  // ============================================================
  applyTool(tool: ToolId, x: number, y: number, brush: number, selNationId: string | null): ToolResult {
    if (!this.inBounds(x, y)) return { ok: false };
    const i = this.idx(x, y);
    const sel = this.nationById(selNationId);

    const needSel = (): ToolResult | null =>
      sel && sel.alive ? null : { ok: false, msg: "先に🔍検分で国家を選択してください" };

    switch (tool) {
      // ---- 自然 ----
      case "raise":
        this.forEachBrush(x, y, brush, (j) => {
          const t = this.terrain[j];
          if (t === T.ocean) {
            this.terrain[j] = T.coast;
          } else if (t === T.coast) {
            this.terrain[j] = T.plains;
            this.fertility[j] = 0.55;
            this.elevation[j] = 0.47;
          }
          this.markDirty(j);
        });
        return { ok: true };
      case "lower":
        this.forEachBrush(x, y, brush, (j) => {
          const t = this.terrain[j];
          if (t === T.mountain || t === T.lava) this.terrain[j] = T.hills;
          else if (t === T.hills) this.terrain[j] = T.plains;
          else if (isLand(t)) this.drownTile(j);
          else if (t === T.coast) this.terrain[j] = T.ocean;
          this.markDirty(j);
        });
        return { ok: true };
      case "mountain":
        this.forEachBrush(x, y, brush, (j) => {
          if (isLand(this.terrain[j]) && this.cityAt[j] === -1) {
            this.terrain[j] = T.mountain;
            this.elevation[j] = 0.85;
            this.markDirty(j);
          }
        });
        return { ok: true };
      case "forest":
        this.forEachBrush(x, y, brush, (j) => {
          const t = this.terrain[j];
          if (isLand(t) && t !== T.mountain && t !== T.lava && this.cityAt[j] === -1) {
            this.terrain[j] = T.forest;
            this.fertility[j] = Math.max(this.fertility[j], 0.55);
            this.markDirty(j);
          }
        });
        return { ok: true };
      case "desert":
        this.forEachBrush(x, y, brush, (j) => {
          if (isLand(this.terrain[j]) && this.terrain[j] !== T.mountain && this.cityAt[j] === -1) {
            this.terrain[j] = T.desert;
            this.fertility[j] = 0.1;
            this.markDirty(j);
          }
        });
        return { ok: true };
      case "snow":
        this.forEachBrush(x, y, brush, (j) => {
          if (isLand(this.terrain[j]) && this.cityAt[j] === -1) {
            this.terrain[j] = T.snow;
            this.fertility[j] = 0.06;
            this.markDirty(j);
          }
        });
        return { ok: true };
      case "water":
        this.forEachBrush(x, y, brush, (j) => {
          if (isLand(this.terrain[j])) this.drownTile(j);
          this.markDirty(j);
        });
        return { ok: true };
      case "fertile":
        this.forEachBrush(x, y, brush, (j) => {
          if (!isLand(this.terrain[j])) return;
          this.fertility[j] = Math.min(1, this.fertility[j] + 0.35);
          if (this.terrain[j] === T.desert) this.terrain[j] = T.savanna;
          if (this.terrain[j] === T.burnt) this.terrain[j] = T.plains;
          this.markDirty(j);
        });
        this.fx.push({ kind: "heal", x, y, age: 0, life: 14, radius: brush + 1 });
        return { ok: true };
      case "res_gold":
      case "res_iron":
      case "res_gem": {
        if (!isLand(this.terrain[i])) return { ok: false, msg: "陸地にしか埋められません" };
        this.resource[i] = tool === "res_gold" ? R.gold : tool === "res_iron" ? R.iron : R.gem;
        this.markDirty(i);
        this.fx.push({ kind: "spark", x, y, age: 0, life: 12 });
        return { ok: true };
      }

      // ---- 生命 ----
      case "settlers": {
        if (!isPassable(this.terrain[i])) return { ok: false, msg: "陸地に落としてください" };
        const ownerN = this.nationAtTile(x, y);
        if (ownerN) {
          // 既存国への移民
          const nearest = this.nearestCityOf(ownerN, x, y);
          if (nearest) nearest.population += 300;
          this.fx.push({ kind: "heal", x, y, age: 0, life: 12, radius: 1.5 });
          return { ok: true, msg: `${ownerN.name}に移民が加わった (+300人)` };
        }
        const nation = this.foundNation(x, y, { pop: 550, radius: 1 });
        if (!nation) return { ok: false, msg: "ここには住めません" };
        for (let k = 0; k < 3; k++) {
          this.spawnUnit("villager", x + this.rng.range(-1, 1), y + this.rng.range(-1, 1), nation.id, nation.capitalCityId ?? undefined);
        }
        this.fx.push({ kind: "heal", x, y, age: 0, life: 14, radius: 2 });
        return { ok: true, msg: `入植者が${nation.name}を興した` };
      }
      case "sheep":
      case "wolf": {
        if (!isPassable(this.terrain[i])) return { ok: false, msg: "陸地に放してください" };
        const animals = this.units.filter((u) => u.kind === "sheep" || u.kind === "wolf").length;
        if (animals > 120) return { ok: false, msg: "動物が多すぎます" };
        this.spawnUnit(tool, x, y, null);
        return { ok: true };
      }
      case "dragon": {
        this.spawnUnit("dragon", x, y, null);
        this.pushEvent("disaster", 2, "空が翳り、竜が舞い降りた!", [], x, y);
        return { ok: true };
      }

      // ---- 文明 ----
      case "found_nation": {
        if (!isPassable(this.terrain[i])) return { ok: false, msg: "陸地を選んでください" };
        if (this.nationAtTile(x, y)) return { ok: false, msg: "他国の領土です" };
        const nation = this.foundNation(x, y, { pop: 1500, radius: 2 });
        if (!nation) return { ok: false, msg: "ここには建国できません" };
        return { ok: true, msg: `${nation.name}が誕生した` };
      }
      case "found_city": {
        const err = needSel();
        if (err) return err;
        if (!isPassable(this.terrain[i]) || this.cityAt[i] !== -1) return { ok: false, msg: "ここには建てられません" };
        for (const c of this.cities) {
          if (c.population > 0 && Math.hypot(c.x - x, c.y - y) < 4) return { ok: false, msg: "他の都市に近すぎます" };
        }
        const other = this.nationAtTile(x, y);
        if (other && other.id !== sel!.id) return { ok: false, msg: "他国の領土です (領土授与で塗り替えられます)" };
        const city = this.createCity(sel!, x, y, false, 500);
        if (!city) return { ok: false };
        this.forEachBrush(x, y, 1, (j) => {
          if (isLand(this.terrain[j]) && this.owner[j] === -1) this.claimTile(sel!, j);
        });
        this.pushEvent("divine", 1, `神の意志により、${sel!.name}に都市${city.name}が築かれた。`, [sel!.id], x, y);
        return { ok: true, msg: `${city.name}を建設` };
      }
      case "claim": {
        const err = needSel();
        if (err) return err;
        this.forEachBrush(x, y, brush, (j) => {
          if (!isLand(this.terrain[j])) return;
          const cIdx = this.cityAt[j];
          if (cIdx >= 0) {
            const c = this.cities[cIdx];
            if (c.nationId !== sel!.id) this.handOverCity(c, sel!);
          }
          this.claimTile(sel!, j);
        });
        return { ok: true };
      }
      case "give_gold": {
        const err = needSel();
        if (err) return err;
        sel!.treasury += 500;
        const cap = this.cityById(sel!.capitalCityId);
        if (cap) this.fx.push({ kind: "heal", x: cap.x, y: cap.y, age: 0, life: 12, radius: 1.5 });
        return { ok: true, msg: `${sel!.name}に500Gを授けた` };
      }
      case "give_tech": {
        const err = needSel();
        if (err) return err;
        sel!.tech += 0.15;
        return { ok: true, msg: `${sel!.name}の技術が進歩した (${sel!.tech.toFixed(2)})` };
      }
      case "summon_army": {
        const err = needSel();
        if (err) return err;
        if (!isPassable(this.terrain[i])) return { ok: false, msg: "陸地に召喚してください" };
        const army = this.createArmy(sel!, x, y, 1200 * (0.7 + sel!.tech * 0.3));
        this.armyPickTarget(army);
        this.fx.push({ kind: "spark", x, y, age: 0, life: 12 });
        this.pushEvent("divine", 1, `神の号令により${sel!.name}の${army.name}が現れた。`, [sel!.id], x, y);
        return { ok: true };
      }

      // ---- 災厄 ----
      case "lightning": {
        this.fx.push({ kind: "lightning", x, y, age: 0, life: 8 });
        this.igniteTile(i, 2);
        const cIdx = this.cityAt[i];
        if (cIdx >= 0) {
          const c = this.cities[cIdx];
          c.population = Math.max(0, c.population - this.rng.int(80, 220));
          c.fortification = Math.max(0, c.fortification - 5);
        }
        this.units = this.units.filter((u) => u.kind === "dragon" || Math.hypot(u.x - x, u.y - y) > 1.1);
        return { ok: true };
      }
      case "meteor": {
        const r = Math.max(1, brush);
        this.fx.push({ kind: "meteor", x, y, age: 0, life: 10, radius: r });
        this.fx.push({ kind: "explosion", x, y, age: 0, life: 14, radius: r + 1 });
        let cityHit: City | null = null;
        this.forEachBrush(x, y, r, (j) => {
          if (isLand(this.terrain[j])) {
            this.terrain[j] = T.burnt;
            this.fertility[j] = 0.1;
            this.igniteTile(j, 2);
            this.markDirty(j);
          }
          const cIdx = this.cityAt[j];
          if (cIdx >= 0) {
            const c = this.cities[cIdx];
            c.population = Math.max(0, Math.floor(c.population * 0.4));
            c.fortification = Math.max(0, c.fortification - 50);
            cityHit = c;
            if (c.population < 150) this.destroyCity(c, "隕石の直撃で");
          }
        });
        this.units = this.units.filter((u) => Math.hypot(u.x - x, u.y - y) > r + 0.5);
        this.pushEvent(
          "disaster",
          cityHit ? 2 : 1,
          cityHit ? `隕石が${(cityHit as City).name}付近に落着! 大地が焼け焦げた。` : "隕石が大地に落ち、クレーターを刻んだ。",
          cityHit ? [(cityHit as City).nationId] : [],
          x,
          y
        );
        return { ok: true };
      }
      case "volcano": {
        if (isWater(this.terrain[i])) return { ok: false, msg: "海には火山を作れません" };
        this.terrain[i] = T.lava;
        this.elevation[i] = 0.95;
        this.markDirty(i);
        this.forEachBrush(x, y, 1, (j) => {
          if (j === i) return;
          if (isLand(this.terrain[j]) && this.cityAt[j] === -1) {
            this.terrain[j] = this.rng.bool(0.5) ? T.lava : T.mountain;
            this.markDirty(j);
          }
        });
        this.forEachBrush(x, y, 3, (j) => this.igniteTile(j, 3));
        this.fx.push({ kind: "explosion", x, y, age: 0, life: 16, radius: 3 });
        this.fx.push({ kind: "smoke", x, y, age: 0, life: 60 });
        this.pushEvent("disaster", 2, "大地が裂け、火山が噴火した!", [], x, y);
        return { ok: true };
      }
      case "fire": {
        this.forEachBrush(x, y, brush, (j) => this.igniteTile(j, 4));
        return { ok: true };
      }
      case "plague": {
        let target: City | null = null;
        let best = 4;
        for (const c of this.cities) {
          if (c.population < 100) continue;
          const d = Math.hypot(c.x - x, c.y - y);
          if (d < best) {
            best = d;
            target = c;
          }
        }
        if (!target) return { ok: false, msg: "都市の近くで使ってください" };
        target.plagueTicks = 24;
        this.pushEvent("disaster", 2, `${target.name}で疫病が発生! 街は死の影に覆われた。`, [target.nationId], target.x, target.y);
        return { ok: true };
      }
      case "earthquake": {
        const r = Math.max(2, brush + 1);
        this.fx.push({ kind: "quake", x, y, age: 0, life: 16, radius: r });
        let hitNation: string | null = null;
        this.forEachBrush(x, y, r, (j) => {
          if (this.terrain[j] === T.mountain && this.rng.bool(0.3)) {
            this.terrain[j] = T.hills;
            this.markDirty(j);
          }
          const cIdx = this.cityAt[j];
          if (cIdx >= 0) {
            const c = this.cities[cIdx];
            c.fortification = Math.max(0, c.fortification - 45);
            c.population = Math.max(0, Math.floor(c.population * 0.9));
            c.unrest = Math.min(100, c.unrest + 15);
            hitNation = c.nationId;
          }
        });
        this.pushEvent("disaster", hitNation ? 2 : 1, "大地が震え、城壁が崩れ落ちた。", hitNation ? [hitNation] : [], x, y);
        return { ok: true };
      }
      case "tornado": {
        this.tornadoes.push({ x, y, px: x, py: y, dir: this.rng.range(0, Math.PI * 2), ttl: 50 });
        this.pushEvent("disaster", 1, "不気味な風が渦を巻き、竜巻が生まれた。", [], x, y);
        return { ok: true };
      }
      case "curse": {
        const err = needSel();
        if (err) return err;
        sel!.cursedYears = 6;
        sel!.stability = Math.max(0, sel!.stability - 20);
        for (const cid of sel!.cityIds) {
          const c = this.cityById(cid);
          if (c) c.unrest = Math.min(100, c.unrest + 20);
        }
        this.pushEvent("divine", 2, `神の怒りが${sel!.name}に降りかかった。民心は乱れ、大地は痩せていく。`, [sel!.id]);
        return { ok: true };
      }

      // ---- 外交 ----
      case "peace_light": {
        const n = this.nationAtTile(x, y);
        if (!n) return { ok: false, msg: "国家の領土をクリックしてください" };
        const enemies = this.atWarWith(n);
        if (enemies.length === 0) return { ok: false, msg: `${n.name}は戦争をしていません` };
        for (const e of enemies) this.makePeace(n, e, "神の光が争いを鎮めた。");
        n.blessedYears = Math.max(n.blessedYears, 3);
        this.pushEvent("divine", 2, `神の光が${n.name}を包み、すべての戦火が消えた。`, [n.id]);
        return { ok: true };
      }
      case "war_seed": {
        const n = this.nationAtTile(x, y);
        if (!n) return { ok: false, msg: "国家の領土をクリックしてください" };
        const others = this.aliveNations().filter((o) => o.id !== n.id && this.relation(n, o).status !== "war");
        if (others.length === 0) return { ok: false, msg: "戦える相手がいません" };
        const target = others.reduce((a, b) => (this.relation(n, a).score <= this.relation(n, b).score ? a : b));
        this.relation(n, target).score = -80;
        target.relations[n.id]!.score = -80;
        this.declareWar(n, target, "神が憎悪の種を蒔いた。");
        return { ok: true };
      }
      case "alliance_bond": {
        const n = this.nationAtTile(x, y);
        if (!n) return { ok: false, msg: "国家の領土をクリックしてください" };
        const others = this.aliveNations().filter(
          (o) => o.id !== n.id && this.relation(n, o).status === "peace"
        );
        if (others.length === 0) return { ok: false, msg: "同盟できる相手がいません" };
        const friend = others.reduce((a, b) => (this.relation(n, a).score >= this.relation(n, b).score ? a : b));
        this.makeAlliance(n, friend);
        return { ok: true, msg: `${n.name}と${friend.name}が結ばれた` };
      }

      default:
        return { ok: false };
    }
  }

  private drownTile(j: number): void {
    const cIdx = this.cityAt[j];
    if (cIdx >= 0) this.destroyCity(this.cities[cIdx], "大水に呑まれ");
    this.freeTile(j);
    this.terrain[j] = T.coast;
    this.elevation[j] = 0.38;
    this.river[j] = 0;
    this.resource[j] = R.none;
    this.burn[j] = 0;
    this.burningTiles.delete(j);
  }

  private destroyCity(city: City, cause: string): void {
    const n = this.nationById(city.nationId);
    const i = this.idx(city.x, city.y);
    const cIdx = this.cityAt[i];
    if (cIdx >= 0 && this.cities[cIdx].id === city.id) this.cityAt[i] = -1;
    city.population = 0;
    city.siegeBy = null;
    if (n) {
      n.cityIds = n.cityIds.filter((id) => id !== city.id);
      this.pushEvent("disaster", 2, `都市${city.name}は${cause}滅びた。`, [n.id], city.x, city.y);
      if (city.isCapital) {
        city.isCapital = false;
        const rest = n.cityIds.map((id) => this.cityById(id)).filter((c): c is City => !!c);
        if (rest.length > 0) {
          const newCap = rest.reduce((a, b) => (a.population >= b.population ? a : b));
          newCap.isCapital = true;
          n.capitalCityId = newCap.id;
        } else {
          n.capitalCityId = null;
        }
      }
      this.checkNationDeath(n, cause);
    }
  }

  private handOverCity(city: City, to: Nation): void {
    const from = this.nationById(city.nationId);
    if (!from) return;
    from.cityIds = from.cityIds.filter((id) => id !== city.id);
    const wasCapital = city.isCapital;
    city.isCapital = false;
    city.nationId = to.id;
    city.siegeBy = null;
    city.siegeProgress = 0;
    to.cityIds.push(city.id);
    this.pushEvent("divine", 1, `神の采配で${city.name}は${to.name}のものとなった。`, [to.id, from.id], city.x, city.y);
    if (wasCapital) {
      const rest = from.cityIds.map((id) => this.cityById(id)).filter((c): c is City => !!c);
      if (rest.length > 0) {
        const newCap = rest.reduce((a, b) => (a.population >= b.population ? a : b));
        newCap.isCapital = true;
        from.capitalCityId = newCap.id;
      } else {
        from.capitalCityId = null;
      }
    }
    this.checkNationDeath(from, "神に見放され");
  }

  private nearestCityOf(n: Nation, x: number, y: number): City | null {
    let best: City | null = null;
    let bd = Infinity;
    for (const cid of n.cityIds) {
      const c = this.cityById(cid);
      if (!c) continue;
      const d = Math.hypot(c.x - x, c.y - y);
      if (d < bd) {
        bd = d;
        best = c;
      }
    }
    return best;
  }

  // ============================================================
  // セーブ / ロード
  // ============================================================
  toSnapshot(): unknown {
    const round3 = (arr: Float32Array) => Array.from(arr, (v) => Math.round(v * 1000) / 1000);
    return {
      v: SNAPSHOT_VERSION,
      config: this.config,
      tick: this.tick,
      rngState: this.rng.getState(),
      idCounter: this.idCounter,
      eventId: this.eventId,
      terrain: Array.from(this.terrain),
      elevation: round3(this.elevation),
      moisture: round3(this.moisture),
      fertility: round3(this.fertility),
      river: Array.from(this.river),
      resource: Array.from(this.resource),
      owner: Array.from(this.owner),
      burn: Array.from(this.burn),
      nations: this.nations.map((n) => ({ ...n, stats: n.stats.slice(-60) })),
      cities: this.cities,
      people: [...this.people.values()],
      armies: [...this.armies.values()],
      events: this.events.slice(-300),
      worldStats: this.worldStats.slice(-240),
      usedNames: this.nameGen.exportUsed()
    };
  }

  static fromSnapshot(data: any): World {
    if (!data || data.v !== SNAPSHOT_VERSION) throw new Error("セーブデータのバージョンが違います");
    const w = new World(data.config as WorldConfig, true);
    w.tick = data.tick;
    w.rng.setState(data.rngState);
    w.idCounter = data.idCounter;
    w.eventId = data.eventId;
    w.terrain = Uint8Array.from(data.terrain);
    w.elevation = Float32Array.from(data.elevation);
    w.moisture = Float32Array.from(data.moisture);
    w.fertility = Float32Array.from(data.fertility);
    w.river = Uint8Array.from(data.river);
    w.resource = Uint8Array.from(data.resource);
    w.owner = Int16Array.from(data.owner);
    w.burn = Uint8Array.from(data.burn);
    w.nations = data.nations;
    w.cities = data.cities;
    w.people = new Map((data.people as Person[]).map((p) => [p.id, p]));
    w.armies = new Map((data.armies as Army[]).map((a) => [a.id, a]));
    w.events = data.events;
    w.worldStats = data.worldStats ?? [];
    w.nameGen.importUsed(data.usedNames);
    // 再構築
    w.nationIdxById.clear();
    w.nations.forEach((n, i) => w.nationIdxById.set(n.id, i));
    w.cityAt.fill(-1);
    w.cities.forEach((c, i) => {
      if (c.population > 0) w.cityAt[w.idx(c.x, c.y)] = i;
    });
    w.burningTiles.clear();
    for (let i = 0; i < w.burn.length; i++) if (w.burn[i] > 0) w.burningTiles.add(i);
    w.needFullRepaint = true;
    return w;
  }
}
