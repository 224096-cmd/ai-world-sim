// ============================================================
// 広告スロット (A8.net のアフィリエイトタグ用)
//
// 使い方:
//   1. A8.net で提携 → 「広告リンク」から欲しいサイズを選ぶ
//   2. 表示された HTML をコピー
//   3. 下の AD_SLOTS の対応するサイズの配列に、
//      バッククォート ` ` の中へそのまま貼り付ける
//
//   同じサイズに複数入れておくと、ページ内の各枠に
//   順番に振り分けられます(同じ広告が並ばない)。
//
// 配置の方針:
//   - 地図には絶対に重ねない。すべて左メニュー(ドロワー)の
//     スクロール領域の中だけに置く。ゲーム画面は広告ゼロ。
//   - スマホは横長バナー(320x50)、PC/横画面は長方形(300x250)を主体に
//   - 一覧の途中に挟むものは横長バナーにして流れを切らない
//
// 消したいとき: enabled を false に。
// 枠線だけ出るのが嫌なとき: placeholder を false に。
// ============================================================

export type AdSize = "300x250" | "320x50" | "234x60" | "728x90" | "160x600";

const SIZE_PX: Record<AdSize, [number, number]> = {
  "300x250": [300, 250],
  "320x50": [320, 50],
  "234x60": [234, 60],
  "728x90": [728, 90],
  "160x600": [160, 600]
};

export const AD_CONFIG = {
  /** 広告全体のON/OFF */
  enabled: true,
  /** タグ未設定のとき、点線の枠を表示するか(本番では false 推奨) */
  placeholder: false,
  /** 「広告」ラベルを出すか(ステマ規制対応。true のままを推奨) */
  showLabel: true
};

/**
 * サイズごとの広告タグ置き場。
 * 空文字のままだとプレースホルダーが出ます。
 */
export const AD_SLOTS: Record<AdSize, string[]> = {
  // ------------------------------------------------------------
  // 300x250 : PC・横画面の各タブ末尾に出る主力枠
  //   配列の先頭ほど露出が多い。成績の良い素材を上に置くこと。
  //   同じ広告主が連続しないよう、意図的に交互に並べている。
  // ------------------------------------------------------------
  "300x250": [
    // moku 素材017 (CTR5%以上 / EPC50以上) — 最有力
    `<a href="https://px.a8.net/svt/ejp?a8mat=4B8DGP+M13PE+4VPU+61Z81" rel="nofollow"><img border="0" width="300" height="250" alt="" src="https://www25.a8.net/svt/bgt?aid=260731177037&wid=003&eno=01&mid=s00000022773001017000&mc=1"></a><img border="0" width="1" height="1" src="https://www13.a8.net/0.gif?a8mat=4B8DGP+M13PE+4VPU+61Z81" alt="">`,
    // アイサポ iPhone修理 素材026 (CTR5%以上 / EPC50以上)
    `<a href="https://px.a8.net/svt/ejp?a8mat=4B8DGP+5E3DJ6+36GA+63WO1" rel="nofollow"><img border="0" width="300" height="250" alt="" src="https://www29.a8.net/svt/bgt?aid=260731177326&wid=003&eno=01&mid=s00000014833001026000&mc=1"></a><img border="0" width="1" height="1" src="https://www17.a8.net/0.gif?a8mat=4B8DGP+5E3DJ6+36GA+63WO1" alt="">`,
    // やまなか家 素材006 (CTR5%以上 / EPC47.11)
    `<a href="https://px.a8.net/svt/ejp?a8mat=4B8DGP+58QH36+5MTE+5ZMCH" rel="nofollow"><img border="0" width="300" height="250" alt="" src="https://www27.a8.net/svt/bgt?aid=260731177317&wid=003&eno=01&mid=s00000026285001006000&mc=1"></a><img border="0" width="1" height="1" src="https://www18.a8.net/0.gif?a8mat=4B8DGP+58QH36+5MTE+5ZMCH" alt="">`,
    // COVERARY スマホケース 素材006 (CTR5%以上 / EPC6.98)
    `<a href="https://px.a8.net/svt/ejp?a8mat=4B8DGP+5EOT4Y+5V8G+5ZMCH" rel="nofollow"><img border="0" width="300" height="250" alt="" src="https://www26.a8.net/svt/bgt?aid=260731177327&wid=003&eno=01&mid=s00000027376001006000&mc=1"></a><img border="0" width="1" height="1" src="https://www11.a8.net/0.gif?a8mat=4B8DGP+5EOT4Y+5V8G+5ZMCH" alt="">`,
    // Pixio ゲーミングモニター 素材017 (CTR1.81%)
    `<a href="https://px.a8.net/svt/ejp?a8mat=4B8DGP+HV2GY+XTI+15RZIP" rel="nofollow"><img border="0" width="300" height="250" alt="" src="https://www24.a8.net/svt/bgt?aid=260731177030&wid=003&eno=01&mid=s00000004383007017000&mc=1"></a><img border="0" width="1" height="1" src="https://www10.a8.net/0.gif?a8mat=4B8DGP+HV2GY+XTI+15RZIP" alt="">`,
    // アイサポ 素材003 (CTR2.54%)
    `<a href="https://px.a8.net/svt/ejp?a8mat=4B8DGP+5E3DJ6+36GA+5YZ75" rel="nofollow"><img border="0" width="300" height="250" alt="" src="https://www20.a8.net/svt/bgt?aid=260731177326&wid=003&eno=01&mid=s00000014833001003000&mc=1"></a><img border="0" width="1" height="1" src="https://www15.a8.net/0.gif?a8mat=4B8DGP+5E3DJ6+36GA+5YZ75" alt="">`,
    // やまなか家 素材011 (CTR3.25%)
    `<a href="https://px.a8.net/svt/ejp?a8mat=4B8DGP+58QH36+5MTE+60OXD" rel="nofollow"><img border="0" width="300" height="250" alt="" src="https://www22.a8.net/svt/bgt?aid=260731177317&wid=003&eno=01&mid=s00000026285001011000&mc=1"></a><img border="0" width="1" height="1" src="https://www12.a8.net/0.gif?a8mat=4B8DGP+58QH36+5MTE+60OXD" alt="">`,
    // moku 素材018
    `<a href="https://px.a8.net/svt/ejp?a8mat=4B8DGP+M13PE+4VPU+626XT" rel="nofollow"><img border="0" width="300" height="250" alt="" src="https://www23.a8.net/svt/bgt?aid=260731177037&wid=003&eno=01&mid=s00000022773001018000&mc=1"></a><img border="0" width="1" height="1" src="https://www16.a8.net/0.gif?a8mat=4B8DGP+M13PE+4VPU+626XT" alt="">`,
    // COVERARY 素材010 (CTR1.62%)
    `<a href="https://px.a8.net/svt/ejp?a8mat=4B8DGP+5EOT4Y+5V8G+60H7L" rel="nofollow"><img border="0" width="300" height="250" alt="" src="https://www28.a8.net/svt/bgt?aid=260731177327&wid=003&eno=01&mid=s00000027376001010000&mc=1"></a><img border="0" width="1" height="1" src="https://www10.a8.net/0.gif?a8mat=4B8DGP+5EOT4Y+5V8G+60H7L" alt="">`,
    // Pixio 素材016 (CTR0.67%)
    `<a href="https://px.a8.net/svt/ejp?a8mat=4B8DGP+HV2GY+XTI+15RRSX" rel="nofollow"><img border="0" width="300" height="250" alt="" src="https://www23.a8.net/svt/bgt?aid=260731177030&wid=003&eno=01&mid=s00000004383007016000&mc=1"></a><img border="0" width="1" height="1" src="https://www18.a8.net/0.gif?a8mat=4B8DGP+HV2GY+XTI+15RRSX" alt="">`,
    // moku 素材019
    `<a href="https://px.a8.net/svt/ejp?a8mat=4B8DGP+M13PE+4VPU+62ENL" rel="nofollow"><img border="0" width="300" height="250" alt="" src="https://www26.a8.net/svt/bgt?aid=260731177037&wid=003&eno=01&mid=s00000022773001019000&mc=1"></a><img border="0" width="1" height="1" src="https://www18.a8.net/0.gif?a8mat=4B8DGP+M13PE+4VPU+62ENL" alt="">`,
    // COVERARY 素材014
    `<a href="https://px.a8.net/svt/ejp?a8mat=4B8DGP+5EOT4Y+5V8G+61C2P" rel="nofollow"><img border="0" width="300" height="250" alt="" src="https://www25.a8.net/svt/bgt?aid=260731177327&wid=003&eno=01&mid=s00000027376001014000&mc=1"></a><img border="0" width="1" height="1" src="https://www14.a8.net/0.gif?a8mat=4B8DGP+5EOT4Y+5V8G+61C2P" alt="">`,
    // Pixio 素材035 (CTR0.44%)
    `<a href="https://px.a8.net/svt/ejp?a8mat=4B8DGP+HV2GY+XTI+15VUEP" rel="nofollow"><img border="0" width="300" height="250" alt="" src="https://www24.a8.net/svt/bgt?aid=260731177030&wid=003&eno=01&mid=s00000004383007035000&mc=1"></a><img border="0" width="1" height="1" src="https://www18.a8.net/0.gif?a8mat=4B8DGP+HV2GY+XTI+15VUEP" alt="">`,
    // moku 素材020
    `<a href="https://px.a8.net/svt/ejp?a8mat=4B8DGP+M13PE+4VPU+62MDD" rel="nofollow"><img border="0" width="300" height="250" alt="" src="https://www21.a8.net/svt/bgt?aid=260731177037&wid=003&eno=01&mid=s00000022773001020000&mc=1"></a><img border="0" width="1" height="1" src="https://www13.a8.net/0.gif?a8mat=4B8DGP+M13PE+4VPU+62MDD" alt="">`,
    // moku 素材021
    `<a href="https://px.a8.net/svt/ejp?a8mat=4B8DGP+M13PE+4VPU+62U35" rel="nofollow"><img border="0" width="300" height="250" alt="" src="https://www27.a8.net/svt/bgt?aid=260731177037&wid=003&eno=01&mid=s00000022773001021000&mc=1"></a><img border="0" width="1" height="1" src="https://www19.a8.net/0.gif?a8mat=4B8DGP+M13PE+4VPU+62U35" alt="">`
  ],

  // ------------------------------------------------------------
  // 320x50 : スマホの主力枠 + PC/横画面のリスト途中
  // ------------------------------------------------------------
  "320x50": [
    // Pixio ゲーミングモニター 素材018 — 来訪者層と相性が良い
    `<a href="https://px.a8.net/svt/ejp?a8mat=4B8DGP+HV2GY+XTI+15S78H" rel="nofollow"><img border="0" width="320" height="50" alt="" src="https://www21.a8.net/svt/bgt?aid=260731177030&wid=003&eno=01&mid=s00000004383007018000&mc=1"></a><img border="0" width="1" height="1" src="https://www16.a8.net/0.gif?a8mat=4B8DGP+HV2GY+XTI+15S78H" alt="">`,
    // moku 革小物 素材012
    `<a href="https://px.a8.net/svt/ejp?a8mat=4B8DGP+M13PE+4VPU+60WN5" rel="nofollow"><img border="0" width="320" height="50" alt="" src="https://www26.a8.net/svt/bgt?aid=260731177037&wid=003&eno=01&mid=s00000022773001012000&mc=1"></a><img border="0" width="1" height="1" src="https://www16.a8.net/0.gif?a8mat=4B8DGP+M13PE+4VPU+60WN5" alt="">`,
    // 廣岡精肉店 素材005 (購入15%)
    `<a href="https://px.a8.net/svt/ejp?a8mat=4B8DGP+EVWG2+4WJK+5ZEMP" rel="nofollow"><img border="0" width="320" height="50" alt="" src="https://www24.a8.net/svt/bgt?aid=260731177025&wid=003&eno=01&mid=s00000022880001005000&mc=1"></a><img border="0" width="1" height="1" src="https://www11.a8.net/0.gif?a8mat=4B8DGP+EVWG2+4WJK+5ZEMP" alt="">`,
    // アイサポ iPhone修理 素材020
    `<a href="https://px.a8.net/svt/ejp?a8mat=4B8DGP+5E3DJ6+36GA+62MDD" rel="nofollow"><img border="0" width="320" height="50" alt="" src="https://www26.a8.net/svt/bgt?aid=260731177326&wid=003&eno=01&mid=s00000014833001020000&mc=1"></a><img border="0" width="1" height="1" src="https://www19.a8.net/0.gif?a8mat=4B8DGP+5E3DJ6+36GA+62MDD" alt="">`,
    // Pixio 素材019
    `<a href="https://px.a8.net/svt/ejp?a8mat=4B8DGP+HV2GY+XTI+15SEY9" rel="nofollow"><img border="0" width="320" height="50" alt="" src="https://www24.a8.net/svt/bgt?aid=260731177030&wid=003&eno=01&mid=s00000004383007019000&mc=1"></a><img border="0" width="1" height="1" src="https://www19.a8.net/0.gif?a8mat=4B8DGP+HV2GY+XTI+15SEY9" alt="">`,
    // moku 素材013
    `<a href="https://px.a8.net/svt/ejp?a8mat=4B8DGP+M13PE+4VPU+614CX" rel="nofollow"><img border="0" width="320" height="50" alt="" src="https://www26.a8.net/svt/bgt?aid=260731177037&wid=003&eno=01&mid=s00000022773001013000&mc=1"></a><img border="0" width="1" height="1" src="https://www11.a8.net/0.gif?a8mat=4B8DGP+M13PE+4VPU+614CX" alt="">`,
    // 廣岡精肉店 素材014
    `<a href="https://px.a8.net/svt/ejp?a8mat=4B8DGP+EVWG2+4WJK+61C2P" rel="nofollow"><img border="0" width="320" height="50" alt="" src="https://www20.a8.net/svt/bgt?aid=260731177025&wid=003&eno=01&mid=s00000022880001014000&mc=1"></a><img border="0" width="1" height="1" src="https://www14.a8.net/0.gif?a8mat=4B8DGP+EVWG2+4WJK+61C2P" alt="">`,
    // アイサポ 素材019
    `<a href="https://px.a8.net/svt/ejp?a8mat=4B8DGP+5E3DJ6+36GA+62ENL" rel="nofollow"><img border="0" width="320" height="50" alt="" src="https://www26.a8.net/svt/bgt?aid=260731177326&wid=003&eno=01&mid=s00000014833001019000&mc=1"></a><img border="0" width="1" height="1" src="https://www12.a8.net/0.gif?a8mat=4B8DGP+5E3DJ6+36GA+62ENL" alt="">`,
    // moku 素材014
    `<a href="https://px.a8.net/svt/ejp?a8mat=4B8DGP+M13PE+4VPU+61C2P" rel="nofollow"><img border="0" width="320" height="50" alt="" src="https://www29.a8.net/svt/bgt?aid=260731177037&wid=003&eno=01&mid=s00000022773001014000&mc=1"></a><img border="0" width="1" height="1" src="https://www14.a8.net/0.gif?a8mat=4B8DGP+M13PE+4VPU+61C2P" alt="">`,
    // 廣岡精肉店 素材015
    `<a href="https://px.a8.net/svt/ejp?a8mat=4B8DGP+EVWG2+4WJK+61JSH" rel="nofollow"><img border="0" width="320" height="50" alt="" src="https://www20.a8.net/svt/bgt?aid=260731177025&wid=003&eno=01&mid=s00000022880001015000&mc=1"></a><img border="0" width="1" height="1" src="https://www16.a8.net/0.gif?a8mat=4B8DGP+EVWG2+4WJK+61JSH" alt="">`,
    // Kagg.jp オフィス家具 素材005
    `<a href="https://px.a8.net/svt/ejp?a8mat=4B8DGP+59XCAQ+486W+5ZEMP" rel="nofollow"><img border="0" width="320" height="50" alt="" src="https://www26.a8.net/svt/bgt?aid=260731177319&wid=003&eno=01&mid=s00000019724001005000&mc=1"></a><img border="0" width="1" height="1" src="https://www16.a8.net/0.gif?a8mat=4B8DGP+59XCAQ+486W+5ZEMP" alt="">`,
    // moku 素材015
    `<a href="https://px.a8.net/svt/ejp?a8mat=4B8DGP+M13PE+4VPU+61JSH" rel="nofollow"><img border="0" width="320" height="50" alt="" src="https://www26.a8.net/svt/bgt?aid=260731177037&wid=003&eno=01&mid=s00000022773001015000&mc=1"></a><img border="0" width="1" height="1" src="https://www11.a8.net/0.gif?a8mat=4B8DGP+M13PE+4VPU+61JSH" alt="">`,
    // 廣岡精肉店 素材019
    `<a href="https://px.a8.net/svt/ejp?a8mat=4B8DGP+EVWG2+4WJK+62ENL" rel="nofollow"><img border="0" width="320" height="50" alt="" src="https://www24.a8.net/svt/bgt?aid=260731177025&wid=003&eno=01&mid=s00000022880001019000&mc=1"></a><img border="0" width="1" height="1" src="https://www16.a8.net/0.gif?a8mat=4B8DGP+EVWG2+4WJK+62ENL" alt="">`,
    // moku 素材016
    `<a href="https://px.a8.net/svt/ejp?a8mat=4B8DGP+M13PE+4VPU+61RI9" rel="nofollow"><img border="0" width="320" height="50" alt="" src="https://www23.a8.net/svt/bgt?aid=260731177037&wid=003&eno=01&mid=s00000022773001016000&mc=1"></a><img border="0" width="1" height="1" src="https://www14.a8.net/0.gif?a8mat=4B8DGP+M13PE+4VPU+61RI9" alt="">`,
    // 廣岡精肉店 素材037
    `<a href="https://px.a8.net/svt/ejp?a8mat=4B8DGP+EVWG2+4WJK+669JL" rel="nofollow"><img border="0" width="320" height="50" alt="" src="https://www27.a8.net/svt/bgt?aid=260731177025&wid=003&eno=01&mid=s00000022880001037000&mc=1"></a><img border="0" width="1" height="1" src="https://www11.a8.net/0.gif?a8mat=4B8DGP+EVWG2+4WJK+669JL" alt="">`
  ],

  // 未使用。234x60 の素材を入手したらここに入れて sizeFor() を戻す
  "234x60": [],

  // 予備。横に広い枠が使えるレイアウトにしたくなったら
  "728x90": [],

  // 予備。縦長サイドバーを作りたくなったら
  "160x600": []
};

export type AdPlacement =
  | "panel-bottom" // 各タブの一番下
  | "detail-end" // 詳細画面の末尾
  | "list-inline" // 一覧の途中
  | "compact"; // 小さい枠を明示的に使いたいとき

/** 横画面/PC レイアウトかどうか (style.css のブレークポイントと合わせる) */
function isWideLayout(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia(
    "(min-width: 860px), (orientation: landscape) and (min-width: 620px)"
  ).matches;
}

function sizeFor(placement: AdPlacement): AdSize {
  switch (placement) {
    case "panel-bottom":
    case "detail-end":
      return isWideLayout() ? "300x250" : "320x50";
    case "list-inline":
    case "compact":
      // 234x60 の素材を持っていないため、手持ちのある 320x50 を使う
      return "320x50";
  }
}

// ------------------------------------------------------------
// ローテーション
//
// 以前は画面を描くたびに 0 に戻していたため、
// どのタブを開いても必ず先頭の広告から始まっていた。
// ここではページ(タブ)ごとに開始位置をずらし、さらに
// セッションごとにも変えることで、同じ広告の重複を避ける。
// 同じタブを開き直したときは同じ広告が出る(チラつかない)。
// ------------------------------------------------------------
const cursor: Partial<Record<AdSize, number>> = {};

/** サイズ同士が同じ周期にならないようにするためのずらし値 */
const SIZE_SALT: Record<AdSize, number> = {
  "300x250": 0,
  "320x50": 5,
  "234x60": 9,
  "728x90": 13,
  "160x600": 17
};

/** ページを開くたびではなく、セッション単位で変わる基準位置 */
const sessionOffset = Math.floor(Math.random() * 977);

function hashKey(key: string): number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) % 89;
}

/**
 * 画面を描き直す前に呼ぶ。
 * pageKey にタブ名などを渡すと、ページごとに違う広告から始まる。
 */
export function resetAdRotation(pageKey = ""): void {
  const base = sessionOffset + hashKey(pageKey);
  for (const key of Object.keys(SIZE_SALT) as AdSize[]) cursor[key] = base + SIZE_SALT[key];
}

function nextTag(size: AdSize): string {
  const filled = (AD_SLOTS[size] ?? []).filter((h) => h.trim());
  if (filled.length === 0) return "";
  const i = cursor[size] ?? 0;
  cursor[size] = i + 1;
  return filled[i % filled.length];
}

/**
 * 広告タグを埋め込む。
 * innerHTML で挿入した <script> はブラウザが実行してくれないため、
 * 同じ内容の script 要素を作り直して差し替える。
 * (A8.net の案件には稀に script 形式のタグがある)
 */
function injectHtml(box: HTMLElement, html: string): void {
  box.innerHTML = html;
  const scripts = Array.from(box.querySelectorAll("script"));
  for (const old of scripts) {
    const fresh = document.createElement("script");
    for (const attr of Array.from(old.attributes)) fresh.setAttribute(attr.name, attr.value);
    fresh.text = old.textContent ?? "";
    old.parentNode?.replaceChild(fresh, old);
  }
}

/**
 * 広告要素を1つ作って返す (DOMには追加しない)。
 * 画面を描き直すたびにタグを挿入し直すと、そのたびに
 * 画像が読み込まれて表示がちらつくため、呼び出し側で
 * 出来上がった要素を使い回せるようにしてある。
 */
export function createAd(placement: AdPlacement = "panel-bottom"): HTMLElement | null {
  if (!AD_CONFIG.enabled) return null;
  return buildSlot(sizeFor(placement));
}

/** いま横長レイアウトかどうか (キャッシュの作り直し判定用) */
export function currentAdLayout(): "wide" | "narrow" {
  return isWideLayout() ? "wide" : "narrow";
}

/**
 * 指定の場所に広告を1枠追加する。
 * 画面を描き直すたびにタグを挿入し直すと、そのたびに画像が
 * 読み込まれて表示がちらつくため、一度作った要素を使い回す。
 * key には「どの枠か」が分かる文字列を渡すこと。
 */
export function mountAd(container: HTMLElement, key: string, placement: AdPlacement = "panel-bottom"): void {
  if (!AD_CONFIG.enabled) return;
  const node = cachedSlot(key, placement);
  if (node) container.appendChild(node);
}

/**
 * 一覧の途中に広告を挟む。
 * afterIndex 番目の要素の手前に入る。
 * 差し込み位置より後ろに3件以上残っていないときは入れない
 * (末尾にくっついて邪魔に見えるのを防ぐ)。
 */
export function mountInlineAd(container: HTMLElement, key: string, afterIndex: number): void {
  if (!AD_CONFIG.enabled) return;
  const anchor = container.children[afterIndex];
  if (!anchor) return;
  if (container.children.length - afterIndex < 3) return;
  const node = cachedSlot(key, "list-inline");
  if (node) container.insertBefore(node, anchor);
}

/**
 * メニュー下部に固定表示する枠を差し替える。
 * 開いている間は同じ広告のまま(チラチラ変わらない)、
 * タブを移ったときだけ別の広告になる。
 */
export function refreshFooterAd(footer: HTMLElement, key: string): void {
  footer.innerHTML = "";
  if (!AD_CONFIG.enabled) {
    footer.classList.add("is-empty");
    return;
  }
  const node = cachedSlot(`foot:${key}`, "compact");
  if (node) {
    footer.appendChild(node);
    footer.classList.remove("is-empty");
  } else {
    footer.classList.add("is-empty");
  }
}

/** 作った広告要素の保管庫 (同じ枠には同じ要素を返す) */
const slotCache = new Map<string, HTMLElement>();
let cachedLayout: "wide" | "narrow" = isWideLayout() ? "wide" : "narrow";

function cachedSlot(key: string, placement: AdPlacement): HTMLElement | null {
  // 画面の向きや幅が変わって広告サイズが変わるときは作り直す
  const layout = isWideLayout() ? "wide" : "narrow";
  if (layout !== cachedLayout) {
    cachedLayout = layout;
    slotCache.clear();
  }
  let node = slotCache.get(key);
  if (!node) {
    const built = buildSlot(sizeFor(placement));
    if (!built) return null;
    slotCache.set(key, (node = built));
  }
  return node;
}

function buildSlot(size: AdSize): HTMLElement | null {
  const [w, h] = SIZE_PX[size];
  const html = nextTag(size);
  if (!html && !AD_CONFIG.placeholder) return null;

  const wrap = document.createElement("div");
  wrap.className = `ad-area ad-area--${size.replace("x", "-")}`;

  if (AD_CONFIG.showLabel) {
    const label = document.createElement("span");
    label.className = "ad-label";
    label.textContent = "広告";
    wrap.appendChild(label);
  }

  const box = document.createElement("div");
  box.className = "ad-slot";
  box.style.width = `${w}px`;
  box.style.minHeight = `${h}px`;

  if (html) {
    injectHtml(box, html);
  } else {
    box.classList.add("ad-slot--empty");
    box.textContent = `${w}×${h}`;
  }

  wrap.appendChild(box);
  return wrap;
}

// ---- 旧バージョンとの互換用エイリアス ----
export function renderAd(container: HTMLElement, placement: AdPlacement = "panel-bottom"): void {
  mountAd(container, `legacy:${placement}:${container.children.length}`, placement);
}
export function insertInlineAd(container: HTMLElement, afterIndex: number): void {
  mountInlineAd(container, `legacy-inline:${afterIndex}`, afterIndex);
}
export function renderSidebarAd(container: HTMLElement): void {
  renderAd(container, "panel-bottom");
}
export function renderMobileAd(container: HTMLElement): void {
  renderAd(container, "panel-bottom");
}