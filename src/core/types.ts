// ============================================================
// ゲーム全体で使う型定義
// ============================================================

export type Terrain =
  | "ocean"
  | "plains"
  | "forest"
  | "jungle"
  | "swamp"
  | "hills"
  | "mountain"
  | "desert"
  | "tundra"
  | "snow";

export const TERRAIN_LABEL: Record<Terrain, string> = {
  ocean: "海",
  plains: "平野",
  forest: "森林",
  jungle: "密林",
  swamp: "湿地",
  hills: "丘陵",
  mountain: "山岳",
  desert: "砂漠",
  tundra: "凍原",
  snow: "雪原"
};

export interface Tile {
  x: number;
  y: number;
  terrain: Terrain;
  elevation: number; // 生の標高
  height: number; // 海抜0-1に正規化した高さ
  moisture: number; // 0-1
  fertility: number; // 0-1 (食料生産の基礎値)
  ownerId: string | null; // 所属国家ID
  resource?: ResourceType;
  cityId?: string | null;
  river: boolean;
}

export type ResourceType = "gold" | "iron" | "grain" | "gem" | "timber";

export const RESOURCE_LABEL: Record<ResourceType, string> = {
  gold: "金",
  iron: "鉄",
  grain: "穀物",
  gem: "宝石",
  timber: "木材"
};

export type PersonRole =
  | "king"
  | "heir"
  | "general"
  | "merchant"
  | "scholar"
  | "spy"
  | "priest"
  | "diplomat";

export const ROLE_LABEL: Record<PersonRole, string> = {
  king: "王",
  heir: "世継ぎ",
  general: "将軍",
  merchant: "商人",
  scholar: "学者",
  spy: "密偵",
  priest: "司祭",
  diplomat: "外交官"
};

/** 宮廷に自動補充される役職 */
export const COURT_ROLES: PersonRole[] = ["general", "merchant", "scholar", "spy", "priest", "diplomat"];

export type Gender = "m" | "f";

export interface Person {
  id: string;
  name: string;
  role: PersonRole;
  nationId: string;
  age: number;
  gender: Gender;
  dynasty: string;
  parentId?: string | null;
  reignStart?: number;
  loyalty: number; // 0-100 低いと謀反・亡命
  traits: {
    wisdom: number; // 内政/技術
    ambition: number; // 開戦・謀反
    cruelty: number; // 軍の強さ / 不安定
    charisma: number; // 安定度 / 外交
  };
  alive: boolean;
  bornYear: number;
  diedYear?: number;
  achievements: string[];
}

export type RelationStatus = "peace" | "war" | "alliance" | "vassal" | "truce";

export interface Relation {
  status: RelationStatus;
  score: number; // -100 〜 100
  since: number;
  truceUntil?: number;
}

export interface City {
  id: string;
  name: string;
  x: number;
  y: number;
  nationId: string;
  founded: number;
  isCapital: boolean;
  population: number;
  prosperity: number; // 0-100
  fortification: number; // 0-100
  unrest: number; // 0-100 高いと反乱
  siegeBy?: string | null; // 包囲中の国ID
}

/** 地図上を動く軍団 */
export type ArmyState = "idle" | "march" | "siege" | "battle" | "retreat";

export interface Army {
  id: string;
  nationId: string;
  name: string;
  x: number; // タイル座標(小数=移動中)
  y: number;
  prevX: number; // 補間表示用の前年位置
  prevY: number;
  targetX: number;
  targetY: number;
  strength: number;
  morale: number; // 0-100
  state: ArmyState;
  generalId: string | null;
  targetNationId: string | null;
}

/** 移民・入植の流れ (地図上の矢印表示用) */
export interface Migration {
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  nationId: string;
  year: number;
  kind: "settle" | "flee";
}

/** 戦闘の跡 (地図に数年間だけ表示) */
export interface BattleMark {
  x: number;
  y: number;
  year: number;
  attackerId: string;
  defenderId: string;
  kind: "field" | "siege" | "sack";
}

export interface StatPoint {
  y: number;
  p: number;
  m: number;
  t: number;
}

export interface Nation {
  id: string;
  name: string;
  color: string;
  cultureId: string;
  dynasty: string;
  founded: number;
  capital: { x: number; y: number };
  capitalCityId: string | null;
  cityIds: string[];
  territory: Set<string>;
  population: number;
  treasury: number;
  military: number;
  techLevel: number;
  stability: number;
  warExhaustion: number;
  legitimacy: number; // 0-100 王朝の正統性。低いと分裂しやすい
  kingId: string | null;
  overlordId: string | null;
  armyIds: string[];
  relations: Record<string, Relation>;
  laws: {
    taxRate: number;
    militaryFocus: boolean;
    tradeOpen: boolean;
    conscription: boolean;
  };
  stats: StatPoint[];
  alive: boolean;
  fallYear?: number;
}

export type EventCategory =
  | "founding"
  | "war"
  | "diplomacy"
  | "nature"
  | "succession"
  | "economy"
  | "discovery"
  | "city"
  | "intrigue"
  | "divine"
  | "ai";

export type Importance = 0 | 1 | 2;

export interface WorldEvent {
  id: string;
  year: number;
  category: EventCategory;
  text: string;
  nationIds: string[];
  personIds: string[];
  importance: Importance;
  x?: number;
  y?: number;
}

export interface WorldConfig {
  width: number;
  height: number;
  nationCount: number;
  seed: number;
  landRatio?: number; // 陸地の割合 (0.25-0.85)
}

export interface GodInterventionLog {
  year: number;
  kind: string;
  description: string;
}

export type MapMode =
  | "political"
  | "terrain"
  | "population"
  | "relations"
  | "development"
  | "military";

export const MAP_MODE_LABEL: Record<MapMode, string> = {
  political: "政治",
  terrain: "地形",
  population: "人口",
  relations: "外交",
  development: "発展",
  military: "軍事"
};