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
}

export type ResourceType = "gold" | "iron" | "grain" | "gem" | "timber";

export type PersonRole = "king" | "general" | "merchant" | "scholar" | "heir";

export interface Person {
  id: string;
  name: string;
  role: PersonRole;
  nationId: string;
  age: number;
  traits: {
    wisdom: number; // 0-100
    ambition: number;
    cruelty: number;
    charisma: number;
  };
  alive: boolean;
  bornYear: number;
  diedYear?: number;
  achievements: string[]; // AI/テンプレート生成のフレーバーテキスト用ログ
}

export type RelationStatus = "peace" | "war" | "alliance" | "vassal";

export interface Relation {
  status: RelationStatus;
  score: number; // -100 (険悪) 〜 100 (友好)
  since: number; // 開始年
}

export interface Nation {
  id: string;
  name: string;
  color: string;
  founded: number;
  capital: { x: number; y: number };
  territory: Set<string>; // "x,y" 形式のタイルキー
  population: number;
  treasury: number;
  military: number; // 総合軍事力
  techLevel: number; // 0-10
  stability: number; // 0-100 (低いと内乱リスク)
  kingId: string | null;
  relations: Record<string, Relation>; // 他国ID -> 関係
  laws: {
    taxRate: number; // 0-0.5
    militaryFocus: boolean;
    tradeOpen: boolean;
  };
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
  | "divine"
  | "ai";

export interface WorldEvent {
  id: string;
  year: number;
  category: EventCategory;
  text: string;
  nationIds: string[];
  personIds: string[];
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
