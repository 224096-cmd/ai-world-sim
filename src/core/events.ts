import { Rng } from "./rng";
import { EventCategory, WorldEvent } from "./types";

let eventCounter = 0;
function nextEventId(): string {
  eventCounter += 1;
  return `event-${eventCounter}`;
}

/**
 * テンプレート文の {slot} をコンテキストの値で置換する。
 * AIを使わず、通常のイベントはすべてここで日本語の文章になる。
 */
function fill(template: string, ctx: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, key) => String(ctx[key] ?? `{${key}}`));
}

const TEMPLATES: Record<string, string[]> = {
  founding: [
    "{year}年、{king}を初代の王として{nation}が建国された。",
    "{year}年、{nation}が{capital}を都と定めて興った。"
  ],
  warDeclared: [
    "{year}年、{nation}が{enemy}に宣戦布告した。国境地帯は緊張に包まれている。",
    "{year}年、長年の対立の末、{nation}と{enemy}が戦端を開いた。"
  ],
  warVictory: [
    "{year}年、{nation}は{enemy}との戦いに勝利し、国境の領土を併合した。",
    "{year}年、{general}将軍率いる{nation}軍が{enemy}を打ち破った。"
  ],
  warDefeatPeace: [
    "{year}年、{nation}と{enemy}は多大な犠牲の末に和平を結んだ。",
    "{year}年、疲弊した{nation}と{enemy}の間で停戦が成立した。"
  ],
  allianceFormed: [
    "{year}年、{nation}と{enemy}が同盟を締結した。",
    "{year}年、{nation}は{enemy}との間に友好同盟を結んだ。"
  ],
  relationWorsen: [
    "{year}年、{nation}と{enemy}の関係が急速に悪化している。",
    "{year}年、{nation}の使節が{enemy}から追放され、両国は不穏な空気に包まれた。"
  ],
  succession: [
    "{year}年、{nation}の王{oldKing}が崩御し、{newKing}が新たな王として即位した。",
    "{year}年、{nation}では王位継承が行われ、{newKing}が玉座についた。"
  ],
  plague: [
    "{year}年、{nation}で疫病が流行し、人口が大きく減少した。",
    "{year}年、{nation}の各地で疫病が猛威を振るっている。"
  ],
  goodHarvest: [
    "{year}年、{nation}は豊作に恵まれ、国庫が潤った。",
    "{year}年、{nation}の穀倉地帯で記録的な豊作が報告された。"
  ],
  famine: [
    "{year}年、{nation}は深刻な飢饉に見舞われた。",
    "{year}年、干ばつにより{nation}の農地は大きな被害を受けた。"
  ],
  techBreakthrough: [
    "{year}年、{nation}の{scholar}が新たな技術を確立し、国力の向上に貢献した。",
    "{year}年、{nation}で学問が発展し、技術水準が向上した。"
  ],
  discoveryResource: [
    "{year}年、{nation}の領内で{resource}の鉱脈が発見された。",
    "{year}年、{nation}の商団が新たな{resource}の交易路を開拓した。"
  ],
  nationFall: [
    "{year}年、{nation}は他国に併呑され、その歴史に幕を閉じた。",
    "{year}年、{nation}は内乱と戦乱の末に滅亡した。"
  ],
  rebellion: [
    "{year}年、{nation}で内乱が発生し、国内が混乱に陥った。",
    "{year}年、{nation}の統治への不満から各地で反乱が起きた。"
  ],
  godDisaster: [
    "{year}年、{nation}を天変地異が襲った。人々はこれを神の怒りと恐れた。"
  ],
  godBlessing: [
    "{year}年、{nation}に不思議な恵みがもたらされたと語り継がれている。"
  ],
  godLaw: [
    "{year}年、{nation}に新たな詔(みことのり)が下された。"
  ]
};

export function generateTemplateEvent(
  key: keyof typeof TEMPLATES,
  category: EventCategory,
  year: number,
  ctx: Record<string, string | number>,
  rng: Rng,
  nationIds: string[] = [],
  personIds: string[] = []
): WorldEvent {
  const pool = TEMPLATES[key];
  const template = rng.pick(pool);
  const text = fill(template, { year, ...ctx });
  return {
    id: nextEventId(),
    year,
    category,
    text,
    nationIds,
    personIds
  };
}

export function makeAiEvent(
  year: number,
  category: EventCategory,
  text: string,
  nationIds: string[] = [],
  personIds: string[] = []
): WorldEvent {
  return { id: nextEventId(), year, category, text, nationIds, personIds };
}
