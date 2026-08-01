import { Rng } from "./rng";
import { Gender } from "./types";

// ============================================================
// 文化圏ごとの音節パーツを組み合わせて、それらしい名前を作る。
// AIを使わず、毎回違う響きの国名・人名・都市名・王朝名を生成する。
// 文化は Nation.cultureId として保存され、ロード後も響きが保たれる。
// ============================================================

export interface Culture {
  id: string;
  label: string;
  nationPrefix: string[];
  nationSuffix: string[];
  nationTitle: string[]; // 「〜王国」「〜帝国」など
  cityPrefix: string[];
  citySuffix: string[];
  dynastySuffix: string[];
  maleGiven: string[];
  femaleGiven: string[];
  kingTitle: { m: string; f: string };
}

export const CULTURES: Culture[] = [
  {
    id: "northern",
    label: "北方",
    nationPrefix: ["ヴァル", "ノル", "スカ", "エイル", "フィヨル", "ブラン", "ヨト", "ウル", "グリム", "ヘル", "スノル", "アイス", "ドヴェル", "スヴァル"],
    nationSuffix: ["ヘイム", "ガルド", "マルク", "ラント", "ボルグ", "フェル", "スケグ", "ヴィズ", "スタッド", "ヨルド"],
    nationTitle: ["王国", "連合", "首長国"],
    cityPrefix: ["ノル", "イス", "ヴィ", "ソル", "ハフ", "スヴェ", "グリ", "トロ", "ラン", "オー", "ベル", "セル"],
    citySuffix: ["ヴィーク", "ホルム", "ダール", "ネス", "フォス", "スタ", "ハウン", "ベルグ", "ロフト", "サンド"],
    dynastySuffix: ["家", "の血族"],
    maleGiven: ["ハラルド", "スヴェン", "エイリーク", "ビョルン", "オラフ", "クヌート", "ラグナル", "シグルド"],
    femaleGiven: ["アストリッド", "フレイヤ", "シグリッド", "イングリッド", "ヘルガ", "トーラ"],
    kingTitle: { m: "王", f: "女王" }
  },
  {
    id: "desert",
    label: "砂漠",
    nationPrefix: ["アル=", "カシュ", "ザハラ", "バシール", "ヌール", "ミル", "サビ", "ハラ", "ジャズ", "カディ", "シャム", "ラハ"],
    nationSuffix: ["ラシード", "ダール", "シャム", "ハディア", "カリム", "ザーン", "マリク", "ワディ", "スーラ", "アミン"],
    nationTitle: ["首長国", "王国", "太守領"],
    cityPrefix: ["マディ", "カル", "サマル", "ジャ", "アイン", "ハル", "ダマ", "バス", "ニシャ", "タド", "ムル", "ケル"],
    citySuffix: ["カンド", "バード", "ラー", "ミール", "ワース", "ナ", "サン", "ジール", "ハーン", "テプ"],
    dynastySuffix: ["朝", "の血族"],
    maleGiven: ["ヤシル", "ハキム", "オマール", "タリク", "ラシード", "ジャミル", "ファリド"],
    femaleGiven: ["ライラ", "ナディア", "ヤスミン", "アミラ", "サフィヤ", "ザーラ"],
    kingTitle: { m: "スルタン", f: "スルタナ" }
  },
  {
    id: "forest",
    label: "森",
    nationPrefix: ["シルヴァ", "エル", "フェア", "ミラ", "ロス", "ティル", "アル", "グラン", "セラ", "イル", "ネモ", "ヴィリ"],
    nationSuffix: ["ウッド", "ローリエン", "ヴェイン", "セレス", "ディア", "サンド", "グレン", "モス", "リーフ", "ソーン"],
    nationTitle: ["王国", "評議会", "聖林国"],
    cityPrefix: ["エル", "リン", "セレ", "ファル", "ミス", "アヴァ", "ケレ", "ソル", "ニム", "テオ", "ブラ"],
    citySuffix: ["ドール", "リオン", "ヴェル", "ラス", "ミア", "セイル", "ノア", "グラス", "エン", "ウィル"],
    dynastySuffix: ["家", "の系譜"],
    maleGiven: ["エラン", "フィンロド", "セルディル", "ロヴァン", "タリオン", "ミルウェ"],
    femaleGiven: ["アルウェン", "リリエル", "セレネ", "ミリア", "ファエル", "ニムエ"],
    kingTitle: { m: "王", f: "女王" }
  },
  {
    id: "empire",
    label: "帝国",
    nationPrefix: ["アウレ", "カエル", "ヴェント", "ロマ", "ティベ", "ルクス", "セプ", "コル", "オクタ", "フラヴ", "マグ", "アドリ", "ノヴィ", "パラ"],
    nationSuffix: ["リア", "ニウム", "ティア", "ルム", "ニア", "アヌス", "ドニア", "キア", "ウィア", "セナ"],
    nationTitle: ["帝国", "共和国", "公国"],
    cityPrefix: ["アク", "ノヴァ", "ポル", "カス", "ウル", "セギ", "メディ", "ルグ", "アル", "タラ", "ヴィン"],
    citySuffix: ["トゥム", "ポリス", "テラ", "ニア", "ブルム", "ドゥヌム", "クム", "スタ", "ガラ", "ミナ"],
    dynastySuffix: ["朝", "家"],
    maleGiven: ["マルクス", "ルキウス", "アウレリウス", "ガイウス", "ティトゥス", "ユリアン"],
    femaleGiven: ["リヴィア", "ユリア", "オクタヴィア", "アウレリア", "カミラ"],
    kingTitle: { m: "皇帝", f: "女帝" }
  },
  {
    id: "eastern",
    label: "東方",
    nationPrefix: ["蒼", "玄", "白", "朱", "翠", "黎", "燕", "紅", "碧", "金", "銀", "霜", "雷", "幽"],
    nationSuffix: ["龍", "月", "河", "雲", "山", "峰", "淵", "原", "嶺", "海", "星", "門"],
    nationTitle: ["王朝", "帝国", "公国"],
    cityPrefix: ["龍", "鳳", "泉", "月", "霞", "楓", "梅", "雁", "石", "錦", "松", "柳"],
    citySuffix: ["京", "陽", "州", "港", "関", "郷", "城", "邑", "津", "谷", "台"],
    dynastySuffix: ["王朝", "氏"],
    maleGiven: ["劉燕", "白狼", "景雲", "玄真", "青嵐", "李峰"],
    femaleGiven: ["春鈴", "月華", "紅蓮", "小蘭", "翠玉", "雪音"],
    kingTitle: { m: "皇帝", f: "女帝" }
  },
  {
    id: "isles",
    label: "群島",
    nationPrefix: ["カイ", "モア", "テ・", "ラナ", "ヒロ", "ナル", "ハウ", "タヒ", "ヴァヴ", "オノ", "プア", "マウ"],
    nationSuffix: ["ヌイ", "ロア", "キナ", "モク", "タネ", "ラニ", "アヴァ", "ヒキ", "オラ", "マタ"],
    nationTitle: ["連邦", "海洋国", "部族連合"],
    cityPrefix: ["ワイ", "ホノ", "カハ", "マカ", "コナ", "プウ", "ラハ", "ヒロ", "ケア", "アナ", "モオ"],
    citySuffix: ["ルア", "キキ", "プナ", "ロロ", "ヴァイ", "ネイ", "タウ", "マニ", "ホア", "ケレ"],
    dynastySuffix: ["族", "の家"],
    maleGiven: ["カヴィカ", "マナロ", "テヴィタ", "ロンゴ", "ナイノア", "キオニ"],
    femaleGiven: ["モアナ", "レイラニ", "カイマナ", "ナニ", "アロヒ", "マレラ"],
    kingTitle: { m: "大首長", f: "大首長" }
  }
];

export function cultureById(id: string): Culture {
  return CULTURES.find((c) => c.id === id) ?? CULTURES[0];
}

export class NameGenerator {
  private usedNation = new Set<string>();
  private usedCity = new Set<string>();

  constructor(private rng: Rng) {}

  /** セーブ用: 使用済み名を書き出す */
  exportUsed(): { nation: string[]; city: string[] } {
    return { nation: [...this.usedNation], city: [...this.usedCity] };
  }

  /** ロード用: 使用済み名を復元して重複を防ぐ */
  importUsed(data?: { nation?: string[]; city?: string[] }): void {
    if (!data) return;
    this.usedNation = new Set(data.nation ?? []);
    this.usedCity = new Set(data.city ?? []);
  }

  /** 地形の気候から相性の良い文化を選ぶ */
  pickCultureFor(climate: "cold" | "hot" | "wet" | "temperate" | "coastal"): Culture {
    const pool: Record<string, string[]> = {
      cold: ["northern", "eastern"],
      hot: ["desert", "isles"],
      wet: ["forest", "isles", "eastern"],
      temperate: ["empire", "forest", "eastern", "northern"],
      coastal: ["isles", "northern", "empire"]
    };
    const ids = pool[climate];
    return cultureById(this.rng.pick(ids));
  }

  /** 「上」「新」「大」など、名前が尽きたときに付ける修飾 */
  private static readonly QUALIFIER = ["新", "大", "上", "下", "西", "東", "北", "南", "古", "聖"];

  nationName(culture: Culture): { name: string; base: string } {
    for (let i = 0; i < 60; i++) {
      const base = this.rng.pick(culture.nationPrefix) + this.rng.pick(culture.nationSuffix);
      if (!this.usedNation.has(base)) {
        this.usedNation.add(base);
        return { name: base + this.rng.pick(culture.nationTitle), base };
      }
    }
    // 尽きたら3音節に伸ばす
    for (let i = 0; i < 40; i++) {
      const base =
        this.rng.pick(culture.nationPrefix) + this.rng.pick(culture.cityPrefix) + this.rng.pick(culture.nationSuffix);
      if (!this.usedNation.has(base)) {
        this.usedNation.add(base);
        return { name: base + this.rng.pick(culture.nationTitle), base };
      }
    }
    const base =
      this.rng.pick(NameGenerator.QUALIFIER) +
      this.rng.pick(culture.nationPrefix) +
      this.rng.pick(culture.nationSuffix);
    this.usedNation.add(base);
    return { name: base + this.rng.pick(culture.nationTitle), base };
  }

  cityName(culture: Culture): string {
    for (let i = 0; i < 60; i++) {
      const n = this.rng.pick(culture.cityPrefix) + this.rng.pick(culture.citySuffix);
      if (!this.usedCity.has(n)) {
        this.usedCity.add(n);
        return n;
      }
    }
    for (let i = 0; i < 40; i++) {
      const n =
        this.rng.pick(culture.cityPrefix) + this.rng.pick(culture.nationPrefix) + this.rng.pick(culture.citySuffix);
      if (!this.usedCity.has(n)) {
        this.usedCity.add(n);
        return n;
      }
    }
    const n = this.rng.pick(NameGenerator.QUALIFIER) + this.rng.pick(culture.cityPrefix) + this.rng.pick(culture.citySuffix);
    this.usedCity.add(n);
    return n;
  }

  personName(culture: Culture, gender: Gender): string {
    return gender === "m" ? this.rng.pick(culture.maleGiven) : this.rng.pick(culture.femaleGiven);
  }

  dynastyName(culture: Culture, founderName: string): string {
    return founderName + this.rng.pick(culture.dynastySuffix);
  }

  /** 王の二つ名 (功績に応じて) */
  epithet(kind: "conqueror" | "wise" | "cruel" | "builder" | "pious"): string {
    const table: Record<string, string[]> = {
      conqueror: ["征服王", "獅子王", "剣の", "苛烈なる"],
      wise: ["賢王", "叡智の", "静かなる"],
      cruel: ["残虐王", "血塗られた", "恐怖の"],
      builder: ["建設王", "礎の", "石積みの"],
      pious: ["聖王", "敬虔なる", "祈りの"]
    };
    return this.rng.pick(table[kind]);
  }

  armyName(culture: Culture, index: number): string {
    const flavors = ["軍", "騎士団", "軍団", "衆", "兵団"];
    return `第${index}${this.rng.pick(flavors)}`;
  }
}

/** 国家カラーパレット (視認性の高い32色) */
export const NATION_COLORS: { main: string; dark: string }[] = [
  { main: "#e05252", dark: "#8f2f2f" },
  { main: "#4f8fd0", dark: "#2c5a8a" },
  { main: "#58b368", dark: "#2f7a3d" },
  { main: "#d9a441", dark: "#8f6a24" },
  { main: "#9b6dd0", dark: "#5f3d8a" },
  { main: "#d0699e", dark: "#8a3f66" },
  { main: "#4fb8b0", dark: "#2c7a74" },
  { main: "#d07a45", dark: "#8a4c26" },
  { main: "#7d8fd0", dark: "#4a578a" },
  { main: "#a8c04a", dark: "#6a7a2c" },
  { main: "#c04a6e", dark: "#7a2c44" },
  { main: "#4ac0a0", dark: "#2c7a64" },
  { main: "#c08a4a", dark: "#7a562c" },
  { main: "#6e4ac0", dark: "#442c7a" },
  { main: "#4a9ec0", dark: "#2c637a" },
  { main: "#c0c04a", dark: "#7a7a2c" },
  { main: "#c04a4a", dark: "#7a2c2c" },
  { main: "#4ac05e", dark: "#2c7a3a" },
  { main: "#b04ac0", dark: "#6e2c7a" },
  { main: "#c06e4a", dark: "#7a442c" },
  { main: "#4a6ec0", dark: "#2c447a" },
  { main: "#8ac04a", dark: "#567a2c" },
  { main: "#c04a96", dark: "#7a2c5e" },
  { main: "#4ac0c0", dark: "#2c7a7a" },
  { main: "#e0a0a0", dark: "#8f5f5f" },
  { main: "#a0c0e0", dark: "#5f748f" },
  { main: "#a0e0b0", dark: "#5f8f6a" },
  { main: "#e0d0a0", dark: "#8f815f" },
  { main: "#c0a0e0", dark: "#745f8f" },
  { main: "#e0b0c8", dark: "#8f6a7c" },
  { main: "#b0e0d8", dark: "#6a8f86" },
  { main: "#e0c0a0", dark: "#8f745f" }
];
