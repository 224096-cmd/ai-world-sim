import { Rng } from "../core/rng";
import { Nation, Person, PersonRole } from "../core/types";

// ============================================================
// 会話文テンプレート
//
// 外部AIを使わずに「それらしい」返答を組み立てる。
// プレイヤーの発言に含まれる語を拾って話題を判定するので、
// ランダムな独り言ではなく、噛み合った会話に見える。
// ============================================================

type Topic =
  | "war"
  | "tax"
  | "people"
  | "money"
  | "tech"
  | "faith"
  | "self"
  | "greeting"
  | "praise"
  | "threat"
  | "idle";

const TOPIC_KEYWORDS: [Topic, string[]][] = [
  ["war", ["戦", "軍", "兵", "攻", "敵", "侵", "剣", "武"]],
  ["tax", ["税", "年貢", "徴収"]],
  ["people", ["民", "人々", "国民", "百姓", "暮らし", "生活"]],
  ["money", ["金", "銭", "財", "国庫", "商", "交易", "貿易"]],
  ["tech", ["技術", "学", "知", "書", "研究", "発明"]],
  ["faith", ["神", "祈", "信仰", "天", "運命"]],
  ["self", ["君", "あなた", "汝", "お前", "名前", "誰", "何者"]],
  ["greeting", ["こんにちは", "はじめまして", "やあ", "おはよう", "こんばんは", "どうも"]],
  ["praise", ["すごい", "偉い", "立派", "ありがとう", "感謝", "見事"]],
  ["threat", ["滅", "殺", "潰", "呪", "許さ", "怒"]]
];

function detectTopic(message: string): Topic {
  for (const [topic, words] of TOPIC_KEYWORDS) {
    if (words.some((w) => message.includes(w))) return topic;
  }
  return "idle";
}

interface Ctx {
  nation: Nation;
  person: Person;
  atWar: boolean;
  stable: boolean;
  rich: boolean;
}

/** 話題 x 役職の返答表。{n}=国名 {p}=本人の名 */
const REPLIES: Record<Topic, Partial<Record<PersonRole, string[]>> & { default: string[] }> = {
  war: {
    king: [
      "戦は望まぬ。だが{n}の民を守るためなら、私は剣を取る。",
      "剣を抜けば血が流れる。それでも退けぬ時があるのだ。"
    ],
    general: [
      "兵はいつでも動かせます。あとは号令ひとつです。",
      "国境の守りは固めております。攻めるも守るも、ご命令のままに。"
    ],
    spy: ["戦の前に、相手の懐を探るのが私の役目です。剣より先に耳を。"],
    priest: ["剣を執る前に、まず祈りを。血は土を痩せさせます。"],
    diplomat: ["戦は最後の手段です。まだ言葉で解ける結び目があるはずです。"],
    default: ["戦のことは私には分かりかねます。ただ、恐ろしいことです。"]
  },
  tax: {
    king: [
      "税は重ければ民が離れ、軽ければ国が痩せる。難しいものだ。",
      "今の税で民が飢えぬなら、それでよい。"
    ],
    merchant: ["税が上がれば商いは冷えます。ほどほどが一番でございます。"],
    scholar: ["税とは国の血脈です。滞れば国そのものが病みます。"],
    default: ["税のことは、上の方々がお決めになることですので。"]
  },
  people: {
    king: [
      "民あっての国だ。玉座は民の肩の上にあると心得ている。",
      "民の声は届きにくい。だから耳を澄ませねばならぬ。"
    ],
    priest: ["民の心は祭りと祈りで繋ぎ止められます。パンだけでは足りません。"],
    spy: ["民の噂話ほど正直な報せはありません。市井にこそ真実が転がっています。"],
    default: ["民の暮らしが穏やかであれば、それに勝るものはありません。"]
  },
  money: {
    merchant: [
      "交易路さえ確保できれば、{n}はもっと富みます。道こそが金です。",
      "商いは水物ですが、今年は悪くない流れです。"
    ],
    king: ["国庫は民の汗の集まりだ。無駄に使うわけにはいかぬ。"],
    default: ["金の話は商人にお尋ねください。私にはとんと。"]
  },
  tech: {
    scholar: [
      "書物を紐解けば、この世にはまだ知られぬ理が多くあります。",
      "星の運行と国の興亡には、どこか通じるものがあるように思えてなりません。"
    ],
    king: ["学者を厚遇するのは道楽ではない。知は最も安く手に入る力だ。"],
    default: ["学問のことは学者殿の領分です。私にはさっぱりで。"]
  },
  faith: {
    priest: [
      "神は沈黙をもって答えることもあります。あなたのように。",
      "祈りは届いております。形になるまで時がかかるだけです。"
    ],
    king: ["天の意志があるとして、それに逆らわぬ王でありたい。"],
    default: ["神の御業でしょうか。……こうして声が届くこと自体が。"]
  },
  self: {
    default: ["{p}と申します。{n}に仕える身です。"],
    king: ["私が{n}を統べる者、{p}だ。この名を憶えておいてもらおう。"],
    spy: ["名乗るほどの者ではありません。影と呼んでいただければ。"]
  },
  greeting: {
    king: ["よくぞ参られた。{n}に何用か。"],
    default: ["これはこれは。見えざる御方に声をかけていただけるとは。"]
  },
  praise: {
    king: ["世辞は嬉しいが、褒められて緩む玉座では困る。"],
    default: ["もったいないお言葉です。励みになります。"]
  },
  threat: {
    king: ["脅しか。……天が相手では、抗いようもないな。"],
    general: ["御意のままに。ただ、兵は最後まで戦いますぞ。"],
    default: ["ど、どうか御慈悲を。私どもは何も……。"]
  },
  idle: {
    king: ["さて、何から話そうか。玉座は退屈でな。"],
    general: ["兵の訓練を怠るわけにはいきません。いつ戦端が開くか分かりませんから。"],
    merchant: ["商いの話でしたら、いくらでも。"],
    scholar: ["問いがあれば何なりと。答えられぬ問いこそ面白い。"],
    spy: ["……お呼びで。人目のないところで願います。"],
    priest: ["今日も国の安寧を祈っておりました。"],
    diplomat: ["近隣諸国の風向きなら、いつでもお伝えできます。"],
    heir: ["まだ学びの身です。父上のようにはいきません。"],
    default: ["さて、何からお話ししましょうか。"]
  }
};

/** 状況に応じて一言添える */
function situationLine(ctx: Ctx, rng: Rng): string | null {
  if (ctx.atWar && rng.bool(0.5)) {
    return rng.pick([
      "……今は戦の最中です。落ち着いて話せる時ではありませんが。",
      "戦時ゆえ、慌ただしくしております。ご容赦を。"
    ]);
  }
  if (!ctx.stable && rng.bool(0.45)) {
    return rng.pick([
      "正直に申せば、国内は落ち着きません。頭が痛い限りです。",
      "民の不満が溜まっております。長くは持ちますまい。"
    ]);
  }
  if (ctx.rich && ctx.stable && rng.bool(0.3)) {
    return rng.pick(["幸い、今は良い時代です。長く続けばよいのですが。"]);
  }
  return null;
}

function fill(text: string, ctx: Ctx): string {
  return text.replace(/\{n\}/g, ctx.nation.name).replace(/\{p\}/g, ctx.person.name);
}

/**
 * 会話の返答を作る。
 * message にはプレイヤーの発言を渡す(空でも動く)。
 */
export function fallbackChatReply(
  person: Person,
  nation: Nation,
  rng: Rng,
  message = ""
): string {
  const ctx: Ctx = {
    person,
    nation,
    atWar: Object.values(nation.relations).some((r) => r.status === "war"),
    stable: nation.stability >= 50,
    rich: nation.treasury >= 500
  };

  const topic = detectTopic(message);
  const table = REPLIES[topic];
  const pool = table[person.role] ?? table.default;
  let reply = fill(rng.pick(pool), ctx);

  const extra = situationLine(ctx, rng);
  if (extra && topic !== "self" && topic !== "greeting") reply += ` ${extra}`;

  return reply;
}

const HISTORY_INTROS = [
  "かつてこの地には、幾つもの国が興り、そして消えていった。",
  "世界の記録者は語る。すべての国家には、始まりと終わりがあると。",
  "星霜を経て、この大陸の歴史は幾重にも織り重ねられてきた。"
];

export function fallbackHistoryIntro(rng: Rng): string {
  return rng.pick(HISTORY_INTROS);
}

const WAR_REASONS = [
  "国境沿いの資源を巡る対立が、ついに戦火となった。",
  "外交交渉の決裂と積年の遺恨が、両国を戦争へと導いた。",
  "民の困窮を他国の所為とする声が高まり、開戦に至った。"
];

export function fallbackWarReason(rng: Rng): string {
  return rng.pick(WAR_REASONS);
}