import { Rng } from "../core/rng";
import { Nation, Person } from "../core/types";

// ============================================================
// ローカルAIモデルが無効/未ダウンロードのときに使う、
// 「それらしい」物語文章のテンプレート集。
// これがあることで、AIモデルを一切使わなくてもゲームは完全に遊べる。
// ============================================================

const KING_GREETINGS = [
  "よくぞ参った。我が{nation}に何用か。",
  "神よ、我らが{nation}を見守りたまえ。何用でお呼びか。",
  "此度はどのような御用向きでしょうか、見えざる御方。"
];

const KING_STATUS_GOOD = [
  "我が国は今、繁栄の只中にある。民の暮らしも豊かだ。",
  "国庫は満ち、民草も穏やかに暮らしております。"
];

const KING_STATUS_BAD = [
  "正直に申し上げれば、国内は不安定だ。頭を悩ませている。",
  "苦しい時勢でございます。神のご加護が必要かもしれません。"
];

const KING_WAR_TALK = [
  "隣国との争いは避けられぬだろう。我らは剣を取る覚悟がある。",
  "戦は望まぬが、民を守るためならば退かぬ。"
];

const SCHOLAR_LINES = [
  "書物を紐解けば、この世界にはまだ知られぬ理が多くあります。",
  "星々の運行と国家の興亡には、何か通じるものがあるように思えます。"
];

const MERCHANT_LINES = [
  "商いは正直、水物です。今年は運が良い方でしょうか。",
  "交易路さえ確保できれば、我が国はもっと富むはずです。"
];

const GENERAL_LINES = [
  "兵の訓練を怠るわけにはいきません。いつ戦端が開くか分かりませんから。",
  "国境の守りは万全にしております。ご安心を。"
];

function linesFor(person: Person, rng: Rng): string[] {
  switch (person.role) {
    case "king":
    case "heir":
      return [
        rng.pick(KING_GREETINGS),
        rng.pick(person.traits.wisdom > 60 ? KING_STATUS_GOOD : KING_STATUS_BAD),
        rng.pick(KING_WAR_TALK)
      ];
    case "scholar":
      return SCHOLAR_LINES;
    case "merchant":
      return MERCHANT_LINES;
    case "general":
      return GENERAL_LINES;
    default:
      return ["さて、何からお話ししましょうか。"];
  }
}

/** ローカルAI無効時の会話フォールバック。プレイヤーの発言はそのまま反映はしないが、それらしい返答を返す */
export function fallbackChatReply(person: Person, nation: Nation, rng: Rng): string {
  const lines = linesFor(person, rng).map((l) => l.replace("{nation}", nation.name));
  return rng.pick(lines);
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
