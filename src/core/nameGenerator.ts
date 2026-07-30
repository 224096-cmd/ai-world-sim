import { Rng } from "./rng";
import { Gender, PersonRole } from "./types";

// ============================================================
// 文化圏ごとの音節パーツを組み合わせて、それらしい名前を作る。
// AIを呼ばずに毎回違う響きの国名・人名・都市名・王朝名を生成できる。
//
// 文化は Nation.cultureId として保存されるため、
// セーブ/ロード後も同じ響きの名前が生成され続ける。
// ============================================================

export interface Culture {
  id: string;
  label: string;
  nationPrefix: string[];
  nationSuffix: string[];
  cityPrefix: string[];
  citySuffix: string[];
  dynastySuffix: string[];
  maleGiven: string[];
  femaleGiven: string[];
  surname: string[];
  title: Record<PersonRole, string>;
}

const CULTURES: Culture[] = [
  {
    id: "northern",
    label: "北方",
    nationPrefix: ["ヴァル", "ノル", "スカ", "エイル", "フィヨル", "ブラン", "ヨト"],
    nationSuffix: ["ヘイム", "ガルド", "フィヨルド", "ラント", "ボルグ"],
    cityPrefix: ["ノル", "イス", "ヴィ", "ソル", "ハフ"],
    citySuffix: ["ヴィーク", "ホルム", "ダール", "ネス", "フォス"],
    dynastySuffix: ["家", "族", "血統"],
    maleGiven: ["ハラルド", "スヴェン", "エイリーク", "ビョルン", "オラフ", "クヌート"],
    femaleGiven: ["アストリッド", "フレイヤ", "シグリッド", "イングリッド", "ヘルガ"],
    surname: ["ウルフソン", "ビョルンダル", "ラグナルセン", "ソルヴァルド"],
    title: { king: "王", heir: "王子", general: "戦将", merchant: "商団長", scholar: "賢人" }
  },
  {
    id: "desert",
    label: "砂漠",
    nationPrefix: ["アル=", "カシュ", "ザハラ", "バシール", "ヌール", "ミス"],
    nationSuffix: ["ラシード", "ダール", "シャム", "ハディア", "カリファ"],
    cityPrefix: ["マディナ", "カル", "サマル", "ジャ", "アイン"],
    citySuffix: ["カンド", "バード", "ラー", "ミール", "ワース"],
    dynastySuffix: ["朝", "家", "血族"],
    maleGiven: ["ヤシル", "ハキム", "オマール", "タリク", "ラシード", "ジャミル"],
    femaleGiven: ["ライラ", "ナディア", "ヤスミン", "アミラ", "サフィヤ"],
    surname: ["イブン=ハリド", "アル=ファーリス", "ベン=ラシード", "アル=ハキム"],
    title: { king: "スルタン", heir: "王太子", general: "将軍", merchant: "隊商主", scholar: "学匠" }
  },
  {
    id: "forest",
    label: "森林",
    nationPrefix: ["シルヴァ", "エルウィ", "フェア", "ミルラ", "オーク", "ティル"],
    nationSuffix: ["フォレスト", "グレイド", "ウッド", "デイル", "マーチ"],
    cityPrefix: ["エル", "リヴ", "モス", "ソーン", "ウィロー"],
    citySuffix: ["ブルック", "ホロウ", "シェイド", "ロア", "グレン"],
    dynastySuffix: ["家", "の一族", "の血脈"],
    maleGiven: ["エルロン", "シルヴァン", "ケイン", "アーヴィン", "ローワン"],
    femaleGiven: ["リアンナ", "エスメ", "セレネ", "フィオナ", "ブライア"],
    surname: ["リーフウォーカー", "グリーンウッド", "フェアハート", "モスバーン"],
    title: { king: "森王", heir: "若枝", general: "守護将", merchant: "行商頭", scholar: "森の賢者" }
  },
  {
    id: "imperial",
    label: "帝国",
    nationPrefix: ["アウレ", "セント", "ロマ", "ヴェリ", "コルネ", "オクタ"],
    nationSuffix: ["リア", "ウム", "ニア", "ティア", "リス"],
    cityPrefix: ["ノヴァ", "アウグス", "ポル", "カステ", "アクア"],
    citySuffix: ["ポリス", "トゥム", "キア", "ヌム", "ブルグ"],
    dynastySuffix: ["家", "朝", "門"],
    maleGiven: ["マルクス", "アウグスト", "セルギウス", "クラウディウス", "ティトゥス"],
    femaleGiven: ["リヴィア", "オクタヴィア", "コルネリア", "ユリア", "アウレリア"],
    surname: ["ヴァレリウス", "コルネリウス", "アントニヌス", "セウェルス"],
    title: { king: "皇帝", heir: "皇太子", general: "軍団長", merchant: "元老商", scholar: "碩学" }
  },
  {
    id: "eastern",
    label: "東方",
    nationPrefix: ["天", "翠", "紅", "蒼", "白銀", "玄"],
    nationSuffix: ["洲国", "王朝", "邦", "国", "都"],
    cityPrefix: ["長", "洛", "臨", "建", "涼"],
    citySuffix: ["安", "陽", "京", "州", "関"],
    dynastySuffix: ["朝", "氏", "家"],
    maleGiven: ["景", "泰然", "遼", "武文", "玄", "伯陽"],
    femaleGiven: ["麗華", "静姫", "美凰", "雪蓮", "琳"],
    surname: ["高", "李", "王", "趙", "陳", "楊"],
    title: { king: "皇", heir: "太子", general: "大将軍", merchant: "豪商", scholar: "宰相" }
  }
];

export const CULTURE_IDS = CULTURES.map((c) => c.id);

export function cultureById(id: string): Culture {
  return CULTURES.find((c) => c.id === id) ?? CULTURES[0];
}

export function cultureLabel(id: string): string {
  return cultureById(id).label;
}

export class NameGenerator {
  constructor(private rng: Rng) {}

  pickCultureId(): string {
    return this.rng.pick(CULTURES).id;
  }

  nationName(cultureId: string): string {
    const c = cultureById(cultureId);
    return `${this.rng.pick(c.nationPrefix)}${this.rng.pick(c.nationSuffix)}`;
  }

  cityName(cultureId: string): string {
    const c = cultureById(cultureId);
    return `${this.rng.pick(c.cityPrefix)}${this.rng.pick(c.citySuffix)}`;
  }

  /** 王朝名。姓 + 文化圏ごとの接尾辞 (例: ヴァレリウス家 / 李朝) */
  dynastyName(cultureId: string): string {
    const c = cultureById(cultureId);
    return `${this.rng.pick(c.surname)}${this.rng.pick(c.dynastySuffix)}`;
  }

  personName(cultureId: string, gender: Gender, surname?: string): string {
    const c = cultureById(cultureId);
    const given = gender === "m" ? this.rng.pick(c.maleGiven) : this.rng.pick(c.femaleGiven);
    const family = surname ?? this.rng.pick(c.surname);
    // 東方文化は「姓+名」、それ以外は「名・姓」
    return c.id === "eastern" ? `${family}${given}` : `${given}・${family}`;
  }

  /** 王朝名から姓部分だけを取り出す (王朝: "李朝" -> "李") */
  surnameOfDynasty(cultureId: string, dynasty: string): string {
    const c = cultureById(cultureId);
    for (const suffix of c.dynastySuffix) {
      if (dynasty.endsWith(suffix)) return dynasty.slice(0, dynasty.length - suffix.length);
    }
    return dynasty;
  }

  titleFor(cultureId: string, role: PersonRole): string {
    return cultureById(cultureId).title[role];
  }
}