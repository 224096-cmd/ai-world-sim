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
//   - 地図には絶対に重ねない。すべてパネル内のスクロール領域に置く
//   - スマホは横長バナー(320x50)、PC/横画面は長方形(300x250)を主体に
//   - リストの途中に挟むものは小さいサイズ(234x60)にして邪魔しない
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
  placeholder: true,
  /** 「広告」ラベルを出すか(ステマ規制対応。true のままを推奨) */
  showLabel: true
};

/**
 * サイズごとの広告タグ置き場。
 * 空文字のままだとプレースホルダーが出ます。
 */
export const AD_SLOTS: Record<AdSize, string[]> = {
  // PC/横画面のメイン枠。各タブの末尾に出ます
  "300x250": [
    ``, // 例) お肉・精肉店
    ``, // 例) 明太子・海鮮
    ``, // 例) スイーツ・お取り寄せ
    ``  // 例) コーヒー
  ],

  // スマホのメイン枠。各タブの末尾とリスト途中に出ます
  "320x50": [
    ``, // 例) お肉
    ``, // 例) カニ・海鮮
    ``, // 例) 冷凍弁当
    ``  // 例) フルーツ
  ],

  // リストの途中に挟む小さい枠 (PC/横画面)
  "234x60": [
    ``, // 例) えびせんべい
    ``, // 例) はちみつ
    ``  // 例) コーヒー
  ],

  // 予備。横に広い枠が使えるレイアウトにしたくなったら
  "728x90": [``],

  // 予備。縦長サイドバーを作りたくなったら
  "160x600": [``]
};

export type AdPlacement =
  | "panel-bottom" // 各タブの一番下
  | "detail-end" // 詳細画面の末尾
  | "list-inline" // 一覧の途中
  | "compact"; // 小さい枠を明示的に使いたいとき

/** 横画面/PC レイアウトかどうか (ui-extra.css のブレークポイントと合わせる) */
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
      return isWideLayout() ? "234x60" : "320x50";
    case "compact":
      return "234x60";
  }
}

// ---- 同じ画面に同じ広告が並ばないよう順番に配る ----
const cursor: Partial<Record<AdSize, number>> = {};

/** 画面を描き直す前に呼ぶと、配り直しの先頭に戻る */
export function resetAdRotation(): void {
  for (const key of Object.keys(cursor) as AdSize[]) cursor[key] = 0;
}

function nextTag(size: AdSize): string {
  const filled = (AD_SLOTS[size] ?? []).filter((h) => h.trim());
  if (filled.length === 0) return "";
  const i = cursor[size] ?? 0;
  cursor[size] = i + 1;
  return filled[i % filled.length];
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
    box.innerHTML = html;
  } else {
    box.classList.add("ad-slot--empty");
    box.textContent = `${w}×${h}`;
  }

  wrap.appendChild(box);
  return wrap;
}

/** 指定の場所に広告を1枠追加する */
export function renderAd(container: HTMLElement, placement: AdPlacement = "panel-bottom"): void {
  if (!AD_CONFIG.enabled) return;
  const slot = buildSlot(sizeFor(placement));
  if (slot) container.appendChild(slot);
}

/**
 * 一覧の途中に広告を差し込む。
 * afterIndex 番目の要素の手前に入る。
 * リストが短いときは入れない(スカスカに見えるのを防ぐ)。
 */
export function insertInlineAd(container: HTMLElement, afterIndex: number): void {
  if (!AD_CONFIG.enabled) return;
  const anchor = container.children[afterIndex];
  if (!anchor) return;
  // 差し込み位置より後ろに最低3件残っていなければ入れない
  if (container.children.length - afterIndex < 3) return;
  const slot = buildSlot(sizeFor("list-inline"));
  if (slot) container.insertBefore(slot, anchor);
}

// ---- v0.3 との互換用エイリアス ----
export function renderSidebarAd(container: HTMLElement): void {
  renderAd(container, "panel-bottom");
}
export function renderMobileAd(container: HTMLElement): void {
  renderAd(container, "panel-bottom");
}