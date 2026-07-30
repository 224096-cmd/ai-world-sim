import { Rng } from "./rng";
import { EventCategory, Importance, WorldEvent } from "./types";
import { nextId } from "./ids";

/**
 * テンプレート文の {slot} をコンテキストの値で置換する。
 * AIを使わず、通常のイベントはすべてここで日本語の文章になる。
 */
function fill(template: string, ctx: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, key) => String(ctx[key] ?? `{${key}}`));
}

const TEMPLATES: Record<string, string[]> = {
  armyRaised: [
    "{year}年、{nation}は{army}を編成し、{general}を総司令に任じた。"
  ],
  fieldBattle: [
    "{year}年、{place}で{nation}軍と{enemy}軍が激突し、{nation}が勝利した。",
    "{year}年、{general}率いる{nation}軍が{place}の会戦で{enemy}軍を撃破した。"
  ],
  armyDestroyed: [
    "{year}年、{nation}の{army}は{place}で壊滅した。"
  ],
  siegeStart: [
    "{year}年、{nation}軍が{enemy}の都市{city}を包囲した。"
  ],
  siegeBroken: [
    "{year}年、{city}の包囲は解かれ、{nation}軍は撤退した。"
  ],
  tileTaken: [
    "{year}年、{nation}軍が{enemy}の国境地帯を占領した。"
  ],
  settlers: [
    "{year}年、{nation}の入植者たちが辺境へ移り住んだ。"
  ],
  spySabotage: [
    "{year}年、{nation}の密偵{spy}が{enemy}の国庫に火を放った。"
  ],
  spyStealTech: [
    "{year}年、{nation}の密偵{spy}が{enemy}の技術を持ち帰った。"
  ],
  spyIncite: [
    "{year}年、{enemy}の{city}で扇動者が暗躍し、民衆の不満が高まった。"
  ],
  spyAssassinate: [
    "{year}年、{enemy}の王{victim}が暗殺された。下手人の影は{nation}へ消えたという。"
  ],
  spyCaught: [
    "{year}年、{enemy}で{nation}の密偵{spy}が捕らえられ、両国の関係は険悪になった。"
  ],
  coup: [
    "{year}年、{nation}の{general}が兵を返し、玉座を奪った。{dynasty}の始まりである。"
  ],
  defect: [
    "{year}年、{nation}の{person}が{enemy}へ亡命した。"
  ],
  cityRevolt: [
    "{year}年、{nation}の都市{city}が反旗を翻し、{rebel}として独立した。"
  ],
  pretender: [
    "{year}年、{nation}で王位僭称者{person}が挙兵した。"
  ],
  festival: [
    "{year}年、{nation}で{priest}による大祭が催され、民の心は安らいだ。"
  ],
  treaty: [
    "{year}年、{nation}の{diplomat}の尽力で、{enemy}との緊張が和らいだ。"
  ],
  truce: [
    "{year}年、{nation}と{enemy}は休戦協定を結んだ。"
  ],
  renamed: [
    "{year}年、{old}は{new}と呼ばれるようになった。"
  ],
  founding: [
    "{year}年、{king}を初代の王として{nation}が建国された。",
    "{year}年、{nation}が{capital}を都と定めて興った。"
  ],
  newNation: [
    "{year}年、辺境の入植者たちが集い、{nation}を名乗る新たな国が生まれた。",
    "{year}年、無主の地に{king}が旗を掲げ、{nation}が興った。"
  ],
  warDeclared: [
    "{year}年、{nation}が{enemy}に宣戦布告した。国境地帯は緊張に包まれている。",
    "{year}年、長年の対立の末、{nation}と{enemy}が戦端を開いた。",
    "{year}年、{king}は{enemy}への遠征を宣言し、全軍に動員を命じた。"
  ],
  warBattle: [
    "{year}年、{place}にて{nation}軍と{enemy}軍が激突し、{nation}が優勢に立った。",
    "{year}年、{general}率いる{nation}軍が{enemy}の部隊を撃退した。"
  ],
  warVictory: [
    "{year}年、{nation}は{enemy}との戦いに勝利し、国境の領土を併合した。",
    "{year}年、{general}将軍率いる{nation}軍が{enemy}を打ち破り、領土を奪った。"
  ],
  siegeFailed: [
    "{year}年、{nation}軍は{city}を包囲したが、堅牢な城壁の前に撤退した。"
  ],
  cityCaptured: [
    "{year}年、{nation}軍が{enemy}の都市{city}を陥落させた。城壁は崩れ、街は略奪された。",
    "{year}年、長い包囲の末、{city}は{nation}の手に落ちた。"
  ],
  capitalFallen: [
    "{year}年、{enemy}の王都{city}が{nation}軍によって陥落した。玉座は空となった。"
  ],
  warDefeatPeace: [
    "{year}年、{nation}と{enemy}は多大な犠牲の末に和平を結んだ。",
    "{year}年、疲弊した{nation}と{enemy}の間で停戦が成立した。"
  ],
  vassalized: [
    "{year}年、{enemy}は{nation}に屈し、朝貢を約して従属国となった。",
    "{year}年、{nation}は{enemy}を臣従させ、その王を諸侯の列に加えた。"
  ],
  vassalFreed: [
    "{year}年、{nation}は{enemy}の軛を破り、独立を回復した。",
    "{year}年、{nation}の民は宗主国{enemy}への朝貢を拒み、独立を宣言した。"
  ],
  allianceFormed: [
    "{year}年、{nation}と{enemy}が同盟を締結した。",
    "{year}年、{nation}は{enemy}との間に友好同盟を結んだ。"
  ],
  allianceBroken: [
    "{year}年、{nation}と{enemy}の同盟が破棄された。"
  ],
  relationWorsen: [
    "{year}年、{nation}と{enemy}の関係が急速に悪化している。",
    "{year}年、{nation}の使節が{enemy}から追放され、両国は不穏な空気に包まれた。"
  ],
  royalMarriage: [
    "{year}年、{nation}と{enemy}の王家の間で婚姻が結ばれ、両国の絆は強まった。"
  ],
  succession: [
    "{year}年、{nation}の王{oldKing}が崩御し、その子{newKing}が新たな王として即位した。",
    "{year}年、{nation}では王位継承が行われ、{dynasty}の{newKing}が玉座についた。"
  ],
  regency: [
    "{year}年、幼き{newKing}が{nation}の王位を継ぎ、宮廷は摂政の手に委ねられた。"
  ],
  successionCrisis: [
    "{year}年、{nation}の王{oldKing}は世継ぎを残さず崩御した。継承争いの末、{dynasty}が新たな王朝を開いた。",
    "{year}年、{nation}の王統は絶えた。混乱の中、{newKing}が力ずくで玉座を奪った。"
  ],
  heirBorn: [
    "{year}年、{nation}の王{king}に世継ぎ{heir}が生まれ、国中が祝福に沸いた。"
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
  overpopulation: [
    "{year}年、{nation}では耕地が人口を養いきれず、各地で餓えが広がった。"
  ],
  techBreakthrough: [
    "{year}年、{nation}の{scholar}が新たな技術を確立し、国力の向上に貢献した。",
    "{year}年、{nation}で学問が発展し、技術水準が{tech}に達した。"
  ],
  discoveryResource: [
    "{year}年、{nation}の領内で{resource}の鉱脈が発見された。",
    "{year}年、{nation}の商団が新たな{resource}の交易路を開拓した。"
  ],
  tradeRoute: [
    "{year}年、{nation}と{enemy}を結ぶ交易路が栄え、双方の国庫が潤った。",
    "{year}年、{merchant}の尽力により、{nation}と{enemy}の通商が活発化した。"
  ],
  cityFounded: [
    "{year}年、{nation}は新たな都市{city}を建設した。",
    "{year}年、{nation}の入植者たちが{city}を築いた。"
  ],
  cityBoom: [
    "{year}年、{nation}の{city}は交易で栄え、大陸有数の都市となった。"
  ],
  nationFall: [
    "{year}年、{nation}は他国に併呑され、その歴史に幕を閉じた。",
    "{year}年、{nation}は内乱と戦乱の末に滅亡した。"
  ],
  rebellion: [
    "{year}年、{nation}で内乱が発生し、国内が混乱に陥った。",
    "{year}年、{nation}の統治への不満から各地で反乱が起きた。"
  ],
  secession: [
    "{year}年、{nation}の東部諸州が独立を宣言し、{rebel}が建国された。",
    "{year}年、{nation}の分裂により、{rebel}が新たな国家として名乗りを上げた。"
  ],
  goldenAge: [
    "{year}年、{nation}は繁栄の絶頂を迎えた。詩人たちはこの時代を黄金の世と讃えた。"
  ],
  darkAge: [
    "{year}年、{nation}は長い衰退期に入った。人々は往時の栄華を語り草にするのみとなった。"
  ],
  godDisaster: [
    "{year}年、{nation}を天変地異が襲った。人々はこれを神の怒りと恐れた。"
  ],
  godBlessing: [
    "{year}年、{nation}に不思議な恵みがもたらされたと語り継がれている。"
  ],
  godLaw: [
    "{year}年、{nation}に新たな詔(みことのり)が下された。"
  ],
  godPlague: [
    "{year}年、天より黒い霧が降り、{nation}に疫病が広がった。"
  ],
  godUprising: [
    "{year}年、名もなき声が民を煽り、{nation}各地で蜂起が起きた。"
  ],
  godHero: [
    "{year}年、{nation}に天授の英雄{hero}が現れた。"
  ],
  godCity: [
    "{year}年、一夜にして{nation}の地に都市{city}が現れたと伝えられる。"
  ],
  godPeace: [
    "{year}年、天の意志により{nation}のすべての戦は止み、剣は鞘に納められた。"
  ]
};

export type TemplateKey = keyof typeof TEMPLATES;

export function generateTemplateEvent(
  key: TemplateKey,
  category: EventCategory,
  year: number,
  ctx: Record<string, string | number>,
  rng: Rng,
  nationIds: string[] = [],
  personIds: string[] = [],
  importance: Importance = 0,
  pos?: { x: number; y: number }
): WorldEvent {
  const pool = TEMPLATES[key] ?? [`{year}年、{nation}に何かが起きた。`];
  const template = rng.pick(pool);
  return {
    id: nextId("event"),
    year,
    category,
    text: fill(template, { year, ...ctx }),
    nationIds,
    personIds,
    importance,
    x: pos?.x,
    y: pos?.y
  };
}

export function makeAiEvent(
  year: number,
  category: EventCategory,
  text: string,
  nationIds: string[] = [],
  personIds: string[] = [],
  importance: Importance = 1
): WorldEvent {
  return { id: nextId("event"), year, category, text, nationIds, personIds, importance };
}