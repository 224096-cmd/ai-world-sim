import { GameWorld } from "../core/simulation";
import { powerScore } from "../core/nations";
import { el } from "./panels";

export type StatMetric = "p" | "m" | "t";

export const METRIC_LABEL: Record<StatMetric, string> = {
  p: "人口",
  m: "軍事力",
  t: "領土"
};

/** 折れ線グラフを描画する (外部ライブラリ不要のCanvas実装) */
function drawChart(canvas: HTMLCanvasElement, world: GameWorld, metric: StatMetric) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = canvas.clientWidth || 300;
  const h = 220;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  canvas.style.height = `${h}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  const nations = world
    .livingNations()
    .filter((n) => n.stats.length > 1)
    .sort((a, b) => powerScore(b) - powerScore(a))
    .slice(0, 8);

  const padL = 44;
  const padR = 8;
  const padT = 10;
  const padB = 22;

  if (nations.length === 0) {
    ctx.fillStyle = "#566178";
    ctx.font = "12px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("記録が集まるまでしばらく年を進めてください", w / 2, h / 2);
    return;
  }

  let minYear = Infinity;
  let maxYear = 0;
  let maxValue = 1;
  for (const n of nations) {
    for (const s of n.stats) {
      minYear = Math.min(minYear, s.y);
      maxYear = Math.max(maxYear, s.y);
      maxValue = Math.max(maxValue, s[metric]);
    }
  }
  if (maxYear === minYear) maxYear = minYear + 1;

  const px = (year: number) => padL + ((year - minYear) / (maxYear - minYear)) * (w - padL - padR);
  const py = (v: number) => h - padB - (v / maxValue) * (h - padT - padB);

  // グリッドと目盛り
  ctx.strokeStyle = "rgba(255,255,255,0.07)";
  ctx.fillStyle = "#566178";
  ctx.font = "10px monospace";
  ctx.textAlign = "right";
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const v = (maxValue / 4) * i;
    const y = py(v);
    ctx.beginPath();
    ctx.moveTo(padL, y);
    ctx.lineTo(w - padR, y);
    ctx.stroke();
    ctx.fillText(formatNumber(v), padL - 5, y + 3);
  }
  ctx.textAlign = "center";
  ctx.fillText(`${minYear}年`, padL + 12, h - 6);
  ctx.fillText(`${maxYear}年`, w - padR - 16, h - 6);

  // 各国の折れ線
  ctx.lineWidth = 1.6;
  for (const nation of nations) {
    ctx.strokeStyle = nation.color;
    ctx.beginPath();
    nation.stats.forEach((s, i) => {
      const x = px(s.y);
      const y = py(s[metric]);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
  }
}

function formatNumber(v: number): string {
  if (v >= 1000000) return `${(v / 1000000).toFixed(1)}M`;
  if (v >= 1000) return `${Math.round(v / 1000)}k`;
  return String(Math.round(v));
}

export function renderStatsTab(
  container: HTMLElement,
  world: GameWorld,
  metric: StatMetric,
  onMetricChange: (m: StatMetric) => void,
  onSelectNation: (id: string) => void
) {
  container.innerHTML = "";

  const chips = el("div", "chip-row");
  (Object.keys(METRIC_LABEL) as StatMetric[]).forEach((m) => {
    const chip = el("button", "chip" + (metric === m ? " chip--active" : ""), METRIC_LABEL[m]);
    chip.addEventListener("click", () => onMetricChange(m));
    chips.appendChild(chip);
  });
  container.appendChild(chips);

  const canvas = document.createElement("canvas");
  canvas.style.width = "100%";
  canvas.style.display = "block";
  container.appendChild(canvas);
  // レイアウト確定後に描画する
  requestAnimationFrame(() => drawChart(canvas, world, metric));

  // --- 勢力ランキング ---
  container.appendChild(el("div", "section-title", "勢力ランキング"));
  const ranked = world.livingNations().sort((a, b) => powerScore(b) - powerScore(a));
  const max = ranked.length > 0 ? powerScore(ranked[0]) : 1;

  ranked.forEach((nation, i) => {
    const row = el("div", "rank-row");
    const left = el("div", "rank-row__name");
    const swatch = el("span", "swatch");
    swatch.style.background = nation.color;
    left.appendChild(el("span", "rank-row__index", `${i + 1}`));
    left.appendChild(swatch);
    left.appendChild(document.createTextNode(nation.name));
    row.appendChild(left);

    const track = el("div", "rank-row__track");
    const fill = el("div", "rank-row__fill");
    fill.style.width = `${(powerScore(nation) / Math.max(1, max)) * 100}%`;
    fill.style.background = nation.color;
    track.appendChild(fill);
    row.appendChild(track);
    row.appendChild(el("span", "rank-row__value", String(powerScore(nation))));
    row.addEventListener("click", () => onSelectNation(nation.id));
    container.appendChild(row);
  });

  // --- 滅んだ国 ---
  const fallen = world.nations.filter((n) => !n.alive).sort((a, b) => (b.fallYear ?? 0) - (a.fallYear ?? 0));
  if (fallen.length > 0) {
    container.appendChild(el("div", "section-title", `滅亡した国家 (${fallen.length})`));
    for (const nation of fallen.slice(0, 20)) {
      container.appendChild(
        el("div", "card__meta", `${nation.name} … ${nation.founded}年 - ${nation.fallYear}年 (${nation.dynasty})`)
      );
    }
  }

  // --- 世界の統計 ---
  const totalPop = world.livingNations().reduce((s, n) => s + n.population, 0);
  container.appendChild(el("div", "section-title", "世界の統計"));
  const grid = el("div", "stat-grid");
  const rows: [string, string][] = [
    ["経過年数", `${world.year}年`],
    ["現存国家", `${world.livingNations().length}`],
    ["総人口", totalPop.toLocaleString()],
    ["都市数", String(world.cities.filter((c) => world.getNation(c.nationId)?.alive).length)],
    ["記録された出来事", String(world.events.length)],
    ["神の介入", String(world.godLog.length)]
  ];
  for (const [label, value] of rows) {
    const d = document.createElement("div");
    d.innerHTML = `${label}: <strong>${value}</strong>`;
    grid.appendChild(d);
  }
  container.appendChild(grid);
}