import { Rng } from "./rng";

// ============================================================
// 文化圏ごとの音節パーツを組み合わせて、それらしい名前を作る。
// AIを呼ばずに毎回違う響きの国名・人名を大量生成できる。
// ============================================================

interface Culture {
  id: string;
  nationPrefix: string[];
  nationSuffix: string[];
  maleGiven: string[];
  femaleGiven: string[];
  surname: string[];
  title: { king: string; general: string; merchant: string; scholar: string };
}

const CULTURES: Culture[] = [
  {
    id: "northern",
    nationPrefix: ["ヴァル", "ノル", "スカ", "エイル", "フィヨル", "ブラン"],
    nationSuffix: ["ヘイム", "ガルド", "フィヨルド", "ラント", "ボルグ"],
    maleGiven: ["ハラルド", "スヴェン", "エイリーク", "ビョルン", "オラフ"],
    femaleGiven: ["アストリッド", "フレイヤ", "シグリッド", "イングリッド"],
    surname: ["ウルフソン", "ビョルンダル", "ラグナルセン"],
    title: { king: "王", general: "戦将", merchant: "商団長", scholar: "賢人" }
  },
  {
    id: "desert",
    nationPrefix: ["アル=", "カシュ", "ザハラ", "バシール", "ヌール"],
    nationSuffix: ["ラシード", "ダール", "シャム", "ハディア"],
    maleGiven: ["ヤシル", "ハキム", "オマール", "タリク", "ラシード"],
    femaleGiven: ["ライラ", "ナディア", "ヤスミン", "アミラ"],
    surname: ["イブン=ハリド", "アル=ファーリス", "ベン=ラシード"],
    title: { king: "スルタン", general: "将軍", merchant: "隊商主", scholar: "学匠" }
  },
  {
    id: "forest",
    nationPrefix: ["シルヴァ", "エルウィ", "フェア", "ミルラ", "オーク"],
    nationSuffix: ["フォレスト", "グレイド", "ウッド", "デイル"],
    maleGiven: ["エルロン", "シルヴァン", "ケイン", "アーヴィン"],
    femaleGiven: ["リアンナ", "エスメ", "セレネ", "フィオナ"],
    surname: ["リーフウォーカー", "グリーンウッド", "フェアハート"],
    title: { king: "森王", general: "守護将", merchant: "行商頭", scholar: "森の賢者" }
  },
  {
    id: "imperial",
    nationPrefix: ["アウレ", "セント", "ロマ", "ヴェリ", "コルネ"],
    nationSuffix: ["リア", "ウム", "ニア", "ティア", "リス"],
    maleGiven: ["マルクス", "アウグスト", "セルギウス", "クラウディウス"],
    femaleGiven: ["リヴィア", "オクタヴィア", "コルネリア", "ユリア"],
    surname: ["ヴァレリウス", "コルネリウス", "アントニヌス"],
    title: { king: "皇帝", general: "軍団長", merchant: "元老商", scholar: "碩学" }
  },
  {
    id: "eastern",
    nationPrefix: ["天", "翠", "紅", "蒼", "白銀"],
    nationSuffix: ["洲国", "王朝", "邦", "国", "都"],
    maleGiven: ["景", "泰然", "遼", "武文", "玄"],
    femaleGiven: ["麗華", "静姫", "美凰", "雪蓮"],
    surname: ["高", "李", "王", "趙", "陳"],
    title: { king: "皇", general: "大将軍", merchant: "豪商", scholar: "宰相" }
  }
];

export class NameGenerator {
  private cultureByNation = new Map<string, Culture>();

  constructor(private rng: Rng) {}

  assignCulture(nationId: string): Culture {
    const c = this.rng.pick(CULTURES);
    this.cultureByNation.set(nationId, c);
    return c;
  }

  cultureOf(nationId: string): Culture {
    return this.cultureByNation.get(nationId) ?? CULTURES[0];
  }

  nationName(nationId: string): string {
    const c = this.assignCulture(nationId);
    return `${this.rng.pick(c.nationPrefix)}${this.rng.pick(c.nationSuffix)}`;
  }

  personName(nationId: string, gender: "m" | "f" = this.rng.bool() ? "m" : "f"): string {
    const c = this.cultureOf(nationId);
    const given = gender === "m" ? this.rng.pick(c.maleGiven) : this.rng.pick(c.femaleGiven);
    return `${given}・${this.rng.pick(c.surname)}`;
  }

  titleFor(nationId: string, role: "king" | "general" | "merchant" | "scholar"): string {
    return this.cultureOf(nationId).title[role];
  }
}
