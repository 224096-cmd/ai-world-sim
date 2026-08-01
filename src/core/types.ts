// ============================================================
// ゲーム全体で使う型定義
// ============================================================

// ---- 地形 -------------------------------------------------
// 地形はタイルごとに Uint8Array で保持するため、数値コードで管理する。

export const T = {
  ocean: 0,
  coast: 1, // 浅瀬
  plains: 2,
  forest: 3,
  jungle: 4,
  swamp: 5,
  savanna: 6,
  hills: 7,
  mountain: 8,
  desert: 9,
  tundra: 10,
  snow: 11,
  burnt: 12, // 焦土 (時間で平野に戻る)
  lava: 13 // 溶岩 (冷えると山になる)
} as const;

export type TerrainCode = (typeof T)[keyof typeof T];

export const TERRAIN_LABEL: Record<number, string> = {
  [T.ocean]: "深海",
  [T.coast]: "浅瀬",
  [T.plains]: "平野",
  [T.forest]: "森林",
  [T.jungle]: "密林",
  [T.swamp]: "湿地",
  [T.savanna]: "草原",
  [T.hills]: "丘陵",
  [T.mountain]: "山岳",
  [T.desert]: "砂漠",
  [T.tundra]: "凍原",
  [T.snow]: "雪原",
  [T.burnt]: "焦土",
  [T.lava]: "溶岩"
};

export function isWater(t: number): boolean {
  return t === T.ocean || t === T.coast;
}
export function isLand(t: number): boolean {
  return !isWater(t);
}
/** 軍やユニットが通行できるか (山と溶岩は不可) */
export function isPassable(t: number): boolean {
  return isLand(t) && t !== T.mountain && t !== T.lava;
}

// ---- 資源 -------------------------------------------------

export const R = { none: 0, gold: 1, iron: 2, gem: 3, grain: 4, horse: 5 } as const;

export const RESOURCE_LABEL: Record<number, string> = {
  [R.none]: "なし",
  [R.gold]: "金鉱",
  [R.iron]: "鉄鉱",
  [R.gem]: "宝石",
  [R.grain]: "穀倉",
  [R.horse]: "軍馬"
};

export const RESOURCE_ICON: Record<number, string> = {
  [R.gold]: "◆",
  [R.iron]: "▲",
  [R.gem]: "❖",
  [R.grain]: "❋",
  [R.horse]: "♞"
};

// ---- 人物 -------------------------------------------------

export type Gender = "m" | "f";

export interface Person {
  id: string;
  name: string;
  nationId: string;
  role: "king" | "heir";
  age: number;
  gender: Gender;
  bornYear: number;
  reignStart?: number;
  traits: {
    wisdom: number; // 0-100 内政/技術
    ambition: number; // 0-100 開戦しやすさ
    charisma: number; // 0-100 安定/外交
  };
  alive: boolean;
  diedYear?: number;
  epithet?: string; // 「征服王」など
}

// ---- 外交 -------------------------------------------------

export type RelationStatus = "peace" | "war" | "alliance" | "truce";

export const RELATION_LABEL: Record<RelationStatus, string> = {
  peace: "平和",
  war: "戦争",
  alliance: "同盟",
  truce: "休戦"
};

export interface Relation {
  status: RelationStatus;
  score: number; // -100〜100
  sinceYear: number;
  truceUntil?: number; // 休戦が切れる年
}

// ---- 都市 -------------------------------------------------

export interface City {
  id: string;
  name: string;
  x: number;
  y: number;
  nationId: string;
  foundedYear: number;
  isCapital: boolean;
  population: number;
  prosperity: number; // 0-100
  fortification: number; // 0-100
  unrest: number; // 0-100 高いと反乱
  plagueTicks: number; // 疫病の残り月数
  siegeBy: string | null; // 包囲中の国ID
  siegeProgress: number; // 0-100
  conqueredYear?: number; // 直近で征服された年 (反乱リスク)
}

// ---- 軍団 -------------------------------------------------

export type ArmyState = "march" | "siege" | "return" | "guard";

export interface Army {
  id: string;
  nationId: string;
  name: string;
  x: number;
  y: number;
  px: number; // 前tickの位置 (描画補間用)
  py: number;
  tx: number;
  ty: number;
  strength: number;
  morale: number; // 0-100
  state: ArmyState;
  targetCityId: string | null;
  atSea: boolean;
  seaMonths: number;
}

// ---- 地上を歩き回るユニット (WorldBox風の住民・動物) ------

export type UnitKind = "villager" | "sheep" | "wolf" | "dragon";

export interface Unit {
  id: string;
  kind: UnitKind;
  nationId: string | null;
  x: number;
  y: number;
  px: number; // 前tickの位置 (描画補間用)
  py: number;
  tx: number;
  ty: number;
  hp: number;
  homeCityId?: string | null;
  /** ドラゴン用: 残り滞在tick */
  ttl?: number;
}

// ---- 国家 -------------------------------------------------

export interface Nation {
  id: string;
  name: string;
  color: string;
  colorDark: string;
  cultureId: string;
  dynasty: string;
  foundedYear: number;
  capitalCityId: string | null;
  kingId: string | null;
  heirId: string | null;
  cityIds: string[];
  armyIds: string[];
  // ステータス
  population: number;
  treasury: number;
  military: number; // 動員可能な兵力プール
  tech: number; // 技術水準 1.0〜
  stability: number; // 0-100
  warExhaustion: number; // 0-100
  relations: Record<string, Relation>;
  territoryCount: number;
  alive: boolean;
  fallYear?: number;
  /** 神からの祝福/呪いの残り年数 */
  blessedYears: number;
  cursedYears: number;
  stats: { y: number; pop: number; mil: number; tech: number }[];
}

// ---- 年代記 -----------------------------------------------

export type EventCategory =
  | "founding"
  | "war"
  | "diplomacy"
  | "succession"
  | "city"
  | "disaster"
  | "divine"
  | "economy";

export const EVENT_CATEGORY_LABEL: Record<EventCategory, string> = {
  founding: "建国",
  war: "戦争",
  diplomacy: "外交",
  succession: "王位",
  city: "都市",
  disaster: "災厄",
  divine: "神託",
  economy: "経済"
};

export const EVENT_CATEGORY_COLOR: Record<EventCategory, string> = {
  founding: "#d9a441",
  war: "#c8503c",
  diplomacy: "#5c8fae",
  succession: "#b07cc6",
  city: "#6fae5c",
  disaster: "#e07a3f",
  divine: "#e8dcc0",
  economy: "#4fae9e"
};

export interface WorldEvent {
  id: number;
  year: number;
  category: EventCategory;
  text: string;
  importance: 0 | 1 | 2; // 2=歴史的大事件
  x?: number;
  y?: number;
  nationIds: string[];
}

// ---- 演出用エフェクト -------------------------------------

export type FxKind =
  | "explosion"
  | "lightning"
  | "meteor"
  | "smoke"
  | "heal"
  | "battle"
  | "tornado"
  | "quake"
  | "spark";

export interface Fx {
  kind: FxKind;
  x: number;
  y: number;
  /** 経過tick / 寿命tick */
  age: number;
  life: number;
  radius?: number;
  vx?: number;
  vy?: number;
  /** 描画のランダム化に使う任意のシード */
  id?: number;
}

// ---- 神のツール -------------------------------------------

export type ToolCategory = "inspect" | "nature" | "life" | "civ" | "disaster" | "diplo";

export const TOOL_CATEGORY_LABEL: Record<ToolCategory, string> = {
  inspect: "検分",
  nature: "自然",
  life: "生命",
  civ: "文明",
  disaster: "災厄",
  diplo: "外交"
};

export type ToolId =
  // 検分
  | "inspect"
  | "pan"
  // 自然
  | "raise"
  | "lower"
  | "mountain"
  | "forest"
  | "desert"
  | "snow"
  | "water"
  | "fertile"
  | "res_gold"
  | "res_iron"
  | "res_gem"
  // 生命
  | "settlers"
  | "sheep"
  | "wolf"
  | "dragon"
  // 文明
  | "found_nation"
  | "found_city"
  | "claim"
  | "give_gold"
  | "give_tech"
  | "summon_army"
  // 災厄
  | "lightning"
  | "meteor"
  | "volcano"
  | "fire"
  | "plague"
  | "earthquake"
  | "tornado"
  | "curse"
  // 外交
  | "peace_light"
  | "war_seed"
  | "alliance_bond";

export interface ToolDef {
  id: ToolId;
  category: ToolCategory;
  icon: string;
  label: string;
  desc: string;
  /** ドラッグで連続適用できる塗りツールか */
  paint: boolean;
  /** ブラシ半径の影響を受けるか */
  usesBrush: boolean;
  /** 適用に「選択中の国家」が必要か */
  needsNation?: boolean;
  /** 連続適用の間隔tick (ドラッグ時の間引き) */
  cooldownMs?: number;
}

export const TOOLS: ToolDef[] = [
  { id: "inspect", category: "inspect", icon: "🔍", label: "検分", desc: "タイル・都市・国家を調べて選択する", paint: false, usesBrush: false },
  { id: "pan", category: "inspect", icon: "🖐", label: "移動", desc: "ドラッグで地図を動かす", paint: false, usesBrush: false },

  { id: "raise", category: "nature", icon: "⛰", label: "隆起", desc: "海を陸に、陸を丘に持ち上げる", paint: true, usesBrush: true },
  { id: "lower", category: "nature", icon: "🕳", label: "沈降", desc: "土地を沈めて海に還す", paint: true, usesBrush: true },
  { id: "mountain", category: "nature", icon: "🗻", label: "山脈", desc: "険しい山を築く", paint: true, usesBrush: true },
  { id: "forest", category: "nature", icon: "🌲", label: "植林", desc: "森を芽吹かせる", paint: true, usesBrush: true },
  { id: "desert", category: "nature", icon: "🏜", label: "砂漠化", desc: "大地を乾かし砂漠にする", paint: true, usesBrush: true },
  { id: "snow", category: "nature", icon: "❄", label: "凍結", desc: "土地を雪と氷で覆う", paint: true, usesBrush: true },
  { id: "water", category: "nature", icon: "💧", label: "水域", desc: "湖や入り江を作る", paint: true, usesBrush: true },
  { id: "fertile", category: "nature", icon: "🌾", label: "豊穣", desc: "土地を祝福し肥沃にする", paint: true, usesBrush: true },
  { id: "res_gold", category: "nature", icon: "◆", label: "金鉱", desc: "金脈を埋める (国庫収入+)", paint: false, usesBrush: false },
  { id: "res_iron", category: "nature", icon: "▲", label: "鉄鉱", desc: "鉄鉱脈を埋める (軍事+)", paint: false, usesBrush: false },
  { id: "res_gem", category: "nature", icon: "❖", label: "宝石", desc: "宝石鉱脈を埋める (繁栄+)", paint: false, usesBrush: false },

  { id: "settlers", category: "life", icon: "🧑‍🌾", label: "入植者", desc: "陸地に落とすと村を興し、新たな国家が生まれる", paint: false, usesBrush: false, cooldownMs: 400 },
  { id: "sheep", category: "life", icon: "🐑", label: "羊", desc: "羊を放つ (のどか)", paint: true, usesBrush: false, cooldownMs: 150 },
  { id: "wolf", category: "life", icon: "🐺", label: "狼", desc: "狼を放つ (羊や住民を襲う)", paint: true, usesBrush: false, cooldownMs: 150 },
  { id: "dragon", category: "life", icon: "🐉", label: "竜召喚", desc: "しばらく世界を焼き払い去っていく", paint: false, usesBrush: false, cooldownMs: 1000 },

  { id: "found_nation", category: "civ", icon: "🏰", label: "建国", desc: "その地に新しい国家を興す", paint: false, usesBrush: false, cooldownMs: 600 },
  { id: "found_city", category: "civ", icon: "🏘", label: "築城", desc: "選択中の国に新しい都市を建てる", paint: false, usesBrush: false, needsNation: true, cooldownMs: 400 },
  { id: "claim", category: "civ", icon: "🚩", label: "領土授与", desc: "塗った土地を選択中の国の領土にする", paint: true, usesBrush: true, needsNation: true },
  { id: "give_gold", category: "civ", icon: "💰", label: "金貨の雨", desc: "選択中の国の国庫に500Gを授ける", paint: false, usesBrush: false, needsNation: true, cooldownMs: 300 },
  { id: "give_tech", category: "civ", icon: "📜", label: "叡智", desc: "選択中の国の技術を進歩させる", paint: false, usesBrush: false, needsNation: true, cooldownMs: 300 },
  { id: "summon_army", category: "civ", icon: "⚔", label: "軍団召喚", desc: "選択中の国の軍団をその場に呼び出す", paint: false, usesBrush: false, needsNation: true, cooldownMs: 500 },

  { id: "lightning", category: "disaster", icon: "⚡", label: "落雷", desc: "一点に雷を落とす", paint: true, usesBrush: false, cooldownMs: 120 },
  { id: "meteor", category: "disaster", icon: "☄", label: "隕石", desc: "空から星を落としクレーターを刻む", paint: false, usesBrush: true, cooldownMs: 500 },
  { id: "volcano", category: "disaster", icon: "🌋", label: "火山", desc: "大地を裂き火山を生む", paint: false, usesBrush: false, cooldownMs: 800 },
  { id: "fire", category: "disaster", icon: "🔥", label: "業火", desc: "地表に火を放つ (森に燃え広がる)", paint: true, usesBrush: true },
  { id: "plague", category: "disaster", icon: "☠", label: "疫病", desc: "都市に疫病を蔓延させる", paint: false, usesBrush: false, cooldownMs: 400 },
  { id: "earthquake", category: "disaster", icon: "〰", label: "地震", desc: "一帯を揺らし城壁と人心を砕く", paint: false, usesBrush: true, cooldownMs: 600 },
  { id: "tornado", category: "disaster", icon: "🌪", label: "竜巻", desc: "彷徨う竜巻を発生させる", paint: false, usesBrush: false, cooldownMs: 600 },
  { id: "curse", category: "disaster", icon: "🕯", label: "呪い", desc: "選択中の国に不和と動乱を招く", paint: false, usesBrush: false, needsNation: true, cooldownMs: 500 },

  { id: "peace_light", category: "diplo", icon: "🕊", label: "和平の光", desc: "クリックした国の全戦争を終わらせる", paint: false, usesBrush: false, cooldownMs: 500 },
  { id: "war_seed", category: "diplo", icon: "🔥", label: "戦の種", desc: "クリックした国を最も憎む隣国と開戦させる", paint: false, usesBrush: false, cooldownMs: 500 },
  { id: "alliance_bond", category: "diplo", icon: "🤝", label: "同盟の絆", desc: "クリックした国と最も親しい国を同盟させる", paint: false, usesBrush: false, cooldownMs: 500 }
];

export const BRUSH_SIZES = [0, 1, 3, 6] as const; // 半径 (0=1タイル)

// ---- マップ表示モード -------------------------------------

export type MapMode = "political" | "terrain" | "population" | "relations" | "tech";

export const MAP_MODE_LABEL: Record<MapMode, string> = {
  political: "政治",
  terrain: "地形",
  population: "人口",
  relations: "外交",
  tech: "技術"
};

// ---- 世界設定 ---------------------------------------------

export interface WorldConfig {
  width: number;
  height: number;
  seed: number;
  nationCount: number;
  landRatio: number; // 0.2〜0.8
}

export const MONTH_LABEL = ["睦月", "如月", "弥生", "卯月", "皐月", "水無月", "文月", "葉月", "長月", "神無月", "霜月", "師走"];

export function seasonOf(month: number): string {
  if (month <= 1 || month === 11) return "冬";
  if (month <= 4) return "春";
  if (month <= 7) return "夏";
  return "秋";
}
