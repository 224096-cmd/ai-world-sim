// ============================================================
// ゲーム全体で使う型定義
// ============================================================

export type Terrain =
  | "ocean"
  | "plains"
  | "forest"
  | "mountain"
  | "desert"
  | "tundra";

export interface Tile {
  x: number;
  y: number;
  terrain: Terrain;
  elevation: number; // 0-1
  moisture: number; // 0-1
  fertility: number; // 0-1 (食料生産の基礎値)
  ownerId: string | null; // 所属国家ID
  resource?: ResourceType;
  cityId?: string | null; // このタイルにある都市
}

export type ResourceType = "gold" | "iron" | "grain" | "gem" | "timber";

export const RESOURCE_LABEL: Record<ResourceType, string> = {
  gold: "金",
  iron: "鉄",
  grain: "穀物",
  gem: "宝石",
  timber: "木材"
};

export type PersonRole = "king" | "general" | "merchant" | "scholar" | "heir";

export type Gender = "m" | "f";

export interface Person {
  id: string;
  name: string;
  role: PersonRole;
  nationId: string;
  age: number;
  gender: Gender;
  dynasty: string; // 所属王朝名
  parentId?: string | null; // 親(継承の血統表示用)
  reignStart?: number; // 即位年 (王のみ)
  traits: {
    wisdom: number; // 0-100 内政/技術
    ambition: number; // 0-100 開戦しやすさ/拡張欲
    cruelty: number; // 0-100 戦闘力↑ 安定度↓
    charisma: number; // 0-100 安定度/外交
  };
  alive: boolean;
  bornYear: number;
  diedYear?: number;
  achievements: string[]; // 功績・会話ログ
}

export type RelationStatus = "peace" | "war" | "alliance" | "vassal";

export interface Relation {
  status: RelationStatus;
  score: number; // -100 (険悪) 〜 100 (友好)
  since: number; // 開始年
}

export interface City {
  id: string;
  name: string;
  x: number;
  y: number;
  nationId: string;
  founded: number;
  isCapital: boolean;
  population: number; // 毎年 国家人口から按分して算出
  prosperity: number; // 0-100 繁栄度(人口按分・収入に影響)
  fortification: number; // 0-100 攻城戦の防御力
}

/** 統計グラフ用の1点 (年/人口/軍事力/領土数) */
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
  cultureId: string; // 文化圏(名前生成・称号に使用)
  dynasty: string; // 現王朝名
  founded: number;
  capital: { x: number; y: number };
  capitalCityId: string | null;
  cityIds: string[];
  territory: Set<string>; // "x,y" 形式のタイルキー
  population: number;
  treasury: number;
  military: number; // 総合軍事力
  techLevel: number; // 0-12
  stability: number; // 0-100 (低いと内乱/分裂リスク)
  warExhaustion: number; // 0-100 (高いと和平しやすい/安定度低下)
  kingId: string | null;
  overlordId: string | null; // 従属先(宗主国)
  relations: Record<string, Relation>; // 他国ID -> 関係
  laws: {
    taxRate: number; // 0-0.5
    militaryFocus: boolean;
    tradeOpen: boolean;
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
  | "divine"
  | "ai";

/** 0=些事 1=特筆 2=歴史的大事件 (通知と年表の重み付けに使用) */
export type Importance = 0 | 1 | 2;

export interface WorldEvent {
  id: string;
  year: number;
  category: EventCategory;
  text: string;
  nationIds: string[];
  personIds: string[];
  importance: Importance;
}

export interface WorldConfig {
  width: number;
  height: number;
  nationCount: number;
  seed: number;
}

export interface GodInterventionLog {
  year: number;
  kind: string;
  description: string;
}

/** 地図の表示モード */
export type MapMode = "political" | "terrain" | "population" | "relations" | "development";

export const MAP_MODE_LABEL: Record<MapMode, string> = {
  political: "政治",
  terrain: "地形",
  population: "人口",
  relations: "外交",
  development: "発展度"
};