import "server-only";

import type { Rng } from "../server/rng";
import { defineScenario } from "../server/scenario";
import { DOCUMENT_REVIEW } from "../step-types/document_review/public";
import { MULTIPLE_CHOICE } from "../step-types/multiple_choice/public";
import { NUMERIC } from "../step-types/numeric/public";
import { ORDERING } from "../step-types/ordering/public";
import { RAPID_ROUND } from "../step-types/rapid_round/public";
import { SPREADSHEET } from "../step-types/spreadsheet/public";

/**
 * Business / operations analyst at a consulting firm: a first-year analyst at
 * Corvid Lane Advisory (fictional) on a cost review for a regional
 * distributor, on the day of the steering committee. Six timed sections, 50
 * minutes, 100 points, all scored automatically:
 *
 *   rapid round A, numbers (10) → site benchmark spreadsheet (20) → rapid
 *   round B, does the data say that? (10) → steering deck check (20) → rapid
 *   round C, sense checks (10) → steering pack desk, one screen at a time:
 *   executive summary order (8), payback (6), three-year net saving (6) and
 *   five values calls (2 each).
 *
 * Seeded per candidate: the client and its industry, region, every person,
 * site, number and date; which site carries which data trap and which slide
 * carries which deck issue; row and slide order; and where the right option
 * sits. The benchmark, saving, payback and net-saving rules are on the
 * engagement brief the candidate gets; slide standards and confidentiality are
 * Corvid Lane's own written policy.
 *
 * Rapid rounds: 15 items × 20 s. Items 3, 6, 9, 12, 15 are the harder kinds,
 * worth 1; the other ten are worth ½, so each round is exactly 10.
 *
 * Draft v1: practitioner review pending (docs/consulting/analyst-corvid-ops-review.md).
 */

const SLUG = "analyst-corvid-ops-review";
const Y = 2026;
const LETTERS = ["a", "b", "c", "d"] as const;

type Values = Record<string, string>;
type ChoiceKey = Record<string, { choice: string }>;

const fmt = (n: number) => n.toLocaleString("en-US");
const usd = (n: number) => `$${fmt(n)}`;
const usd2 = (x: number) => `$${x.toFixed(2)}`;
const pct1 = (x: number) => `${x.toFixed(1)}%`;
const signed1 = (x: number) => `${x >= 0 ? "+" : "-"}${Math.abs(x).toFixed(1)}%`;
/** A whole number of `step` between lo and hi. */
const mult = (rng: Rng, lo: number, hi: number, step: number) => rng.int(Math.ceil(lo / step), Math.floor(hi / step)) * step;
/** True when x isn't close to a rounding tie at `dp` decimals, so every reader rounds it the same way. */
const clear = (x: number, dp: number) => Math.abs(((Math.abs(x) * 10 ** dp) % 1) - 0.5) > 0.02;
/** The same at two significant figures. */
function clearSig(x: number) {
  const f = x / 10 ** (Math.floor(Math.log10(x)) - 1);
  return Math.abs((f % 1) - 0.5) > 0.02;
}

// ---- Pools (all fictional) ----

const FIRST = ["Maya", "Daniel", "Priya", "Owen", "Grace", "Tomás", "Hannah", "Marcus", "Leila", "Connor", "Aisha", "Ben", "Chloe", "Diego", "Erin", "Felix", "Imani", "Jonah", "Keiko", "Liam", "Nadia", "Oscar", "Ruth", "Samir", "Tessa", "Victor", "Wen", "Yusuf", "Zoe", "Elena", "Hugo", "Iris", "Jamal", "Lucia", "Nikhil", "Paige", "Quinn", "Rosa", "Theo", "Uma"];
const LAST = ["Abara", "Brennan", "Castillo", "Dunmore", "Eklund", "Farrow", "Gallagher", "Hale", "Ishikawa", "Jessop", "Kowalski", "Lindqvist", "Mbeki", "Nakamura", "Okafor", "Pemberton", "Quayle", "Rasmussen", "Sandoval", "Thorne", "Underhill", "Varga", "Whitlock", "Yardley", "Zielinski", "Ashworth", "Bellamy", "Cardenas", "Draper", "Ellison", "Fenwick", "Garza", "Holloway", "Iverson", "Kessler", "Lombardi", "Marchetti", "Novak", "Osei", "Prescott"];
const TOWNS = ["Ashby", "Brookhaven", "Cold Spring", "Danforth", "Elmridge", "Fairhope", "Glenwood", "Harrow", "Ironton", "Juniper Hill", "Kingsford", "Lakemont", "Millbrook", "Northgate", "Oakdale", "Pine Bluff", "Quarry Bay", "Riverton", "Stonefield", "Thornbury", "Upton", "Valley Forge", "Westbrook", "Yarrow Point", "Alder Creek", "Bramley", "Carver", "Dunmore Park"];
const REGIONS = ["Midwest", "Southeast", "Mountain West", "Mid-Atlantic", "Gulf Coast", "Pacific Northwest"];
const INDUSTRIES = [
  { industry: "grocery wholesale", unit: "case", clients: ["Harlow Foodservice Supply", "Pennbrook Grocery Distributors", "Marlow Fresh Wholesale"] },
  { industry: "auto parts", unit: "carton", clients: ["Calloway Parts Supply", "Brightline Auto Parts", "Ostrander Parts Distribution"] },
  { industry: "medical supplies", unit: "carton", clients: ["Larkfield Medical Supply", "Bellmont Health Distribution", "Quarry Lane Medical"] },
  { industry: "building materials", unit: "unit", clients: ["Stonecrop Building Supply", "Hartwell Builders Depot", "Granger Materials Group"] },
];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
/** Client fiscal years ending in these months; FY2026 ends in 2026. */
const FY_ENDS = [
  { def: `FY${Y} runs Feb 1, ${Y - 1} to Jan 31, ${Y}`, start: 1 },
  { def: `FY${Y} runs Apr 1, ${Y - 1} to Mar 31, ${Y}`, start: 3 },
  { def: `FY${Y} runs Jul 1, ${Y - 1} to Jun 30, ${Y}`, start: 6 },
  { def: `FY${Y} runs Oct 1, ${Y - 1} to Sep 30, ${Y}`, start: 9 },
];

interface Person {
  first: string;
  full: string;
}
function people(rng: Rng, n: number): Person[] {
  const f = rng.shuffle(FIRST);
  const l = rng.shuffle(LAST);
  return Array.from({ length: n }, (_, i) => ({ first: f[i], full: `${f[i]} ${l[i]}` }));
}

// ---- Rapid round plumbing ----

const RAPID_ITEMS = 15;
/** Items 3, 6, 9, 12 and 15 are worth 1; the rest ½. 10 points a round. */
const isHardSlot = (i: number) => i % 3 === 2;
const slotNo = (i: number) => String(i + 1).padStart(2, "0");

function fillSlots<T>(easy: T[], hard: T[]): T[] {
  const e = [...easy];
  const h = [...hard];
  const out = Array.from({ length: RAPID_ITEMS }, (_, i) => (isHardSlot(i) ? h.shift() : e.shift()));
  if (out.some((x) => x === undefined) || e.length || h.length) throw new Error(`${SLUG}: rapid slots don't fill`);
  return out as T[];
}

function rapidStep(id: string, title: string, intro: string, prefix: string, options: number) {
  return {
    id,
    type: RAPID_ROUND,
    title,
    config: {
      intro,
      secondsPerItem: 20,
      items: Array.from({ length: RAPID_ITEMS }, (_, i) => {
        const n = slotNo(i);
        return {
          id: `${prefix}-${n}`,
          prompt: `{{${prefix}_${n}}}`,
          exhibit: {
            title: `{{${prefix}_${n}_title}}`,
            rows: [1, 2, 3, 4].map((r) => ({ label: `{{${prefix}_${n}_l${r}}}`, value: `{{${prefix}_${n}_v${r}}}` })),
          },
          fields: [{ id: "answer", label: "Answer", kind: "choice", options: LETTERS.slice(0, options).map((l) => ({ id: l, label: `{{${prefix}_${n}_${l}}}` })) }],
          points: isHardSlot(i) ? 1 : 0.5,
        };
      }),
    },
  };
}

/** One rapid item as drawn: exhibit title, four rows, the right option and the wrong ones. */
interface Item {
  title: string;
  prompt: string;
  rows: [string, string][];
  right: string;
  wrong: string[];
}
interface Ctx {
  unit: string;
  units: string;
  Units: string;
  towns: string[];
}
type Kind = (rng: Rng, c: Ctx) => Item | null;

/** Draws until the kind gives an item whose options are all different, then writes it into the values. */
function buildRound(rng: Rng, c: Ctx, v: Values, prefix: string, easy: Kind[], hard: Kind[], options: number): Record<string, ChoiceKey> {
  return Object.fromEntries(
    fillSlots(easy, hard).map((kind, i) => {
      const n = slotNo(i);
      return [`${prefix}-${n}`, { answer: { choice: drawItem(rng, c, v, `${prefix}_${n}`, kind, options) } }];
    }),
  );
}
function drawItem(rng: Rng, c: Ctx, v: Values, name: string, kind: Kind, options: number): string {
  for (let tries = 0; tries < 5_000; tries++) {
    const item = kind(rng, c);
    if (!item || item.wrong.length !== options - 1 || new Set([item.right, ...item.wrong]).size !== options || item.rows.length !== 4) continue;
    const labels = rng.shuffle([item.right, ...item.wrong]);
    v[name] = item.prompt;
    v[`${name}_title`] = item.title;
    item.rows.forEach(([l, val], r) => {
      v[`${name}_l${r + 1}`] = l;
      v[`${name}_v${r + 1}`] = val;
    });
    LETTERS.slice(0, options).forEach((l, j) => (v[`${name}_${l}`] = labels[j]));
    return LETTERS[labels.indexOf(item.right)];
  }
  throw new Error(`${SLUG}: no rapid item for ${name}`);
}
const towns = (rng: Rng, c: Ctx, n: number) => rng.shuffle(c.towns).slice(0, n);

// ---- Rapid round A: numbers ----

const pctChange: Kind = (rng, c) => {
  const o = mult(rng, 400_000, 2_400_000, 1000);
  const n = Math.round((o * (1 + rng.int(-150, 200) / 1000)) / 1000) * 1000;
  const r = (100 * (n - o)) / o;
  if (Math.abs(r) < 2 || !clear(r, 1)) return null;
  return {
    title: "Year on year",
    prompt: "What is the percent change from last year to this year?",
    rows: [["Measure", `${c.Units} shipped, ${towns(rng, c, 1)[0]}`], ["Last year", fmt(o)], ["This year", fmt(n)], ["Rounding", "One decimal place"]],
    right: signed1(r),
    wrong: [signed1((100 * (n - o)) / n), signed1(-r), signed1((100 * n) / o)],
  };
};

const margin: Kind = (rng) => {
  const r = mult(rng, 8_000_000, 60_000_000, 1000);
  const cogs = Math.round((r * rng.int(700, 880)) / 1000 / 1000) * 1000;
  const opex = Math.round((r * rng.int(60, 140)) / 1000 / 1000) * 1000;
  const g = (100 * (r - cogs)) / r;
  if (r - cogs - opex <= 0 || !clear(g, 1)) return null;
  return {
    title: "Income statement extract",
    prompt: "What is the gross margin?",
    rows: [["Revenue", usd(r)], ["Cost of goods sold", usd(cogs)], ["Operating expenses", usd(opex)], ["Rounding", "One decimal place"]],
    right: pct1(g),
    wrong: [pct1((100 * (r - cogs)) / cogs), pct1((100 * (r - cogs - opex)) / r), pct1((100 * cogs) / r)],
  };
};

const share: Kind = (rng, c) => {
  const s = towns(rng, c, 3);
  const a = [0, 1, 2].map(() => mult(rng, 1_200_000, 9_000_000, 1000));
  const t = a[0] + a[1] + a[2];
  const x = rng.int(0, 2);
  const y = (x + rng.int(1, 2)) % 3;
  const others = a.filter((_, i) => i !== x);
  const right = (100 * a[x]) / t;
  if (!clear(right, 1)) return null;
  return {
    title: "Operating cost by site",
    prompt: `What share of the total is ${s[x]}?`,
    rows: [[s[0], usd(a[0])], [s[1], usd(a[1])], [s[2], usd(a[2])], ["Total", usd(t)]],
    right: pct1(right),
    wrong: [pct1((100 * a[x]) / (t - a[x])), pct1((100 * a[y]) / t), pct1((100 * a[x]) / Math.max(...others))],
  };
};

const unitCost: Kind = (rng, c) => {
  const vol = mult(rng, 80_000, 400_000, 100);
  const fixedC = rng.int(40, 260);
  const varC = rng.int(30, 180);
  const fixed = (fixedC * vol) / 100;
  const slip = (varC + fixedC / 12) / 100;
  if (!clear(slip, 2)) return null;
  return {
    title: "Cost build-up",
    prompt: `What is the total cost per ${c.unit}?`,
    rows: [["Fixed cost", `${usd(fixed)} a month`], ["Variable cost", `${usd2(varC / 100)} per ${c.unit}`], ["Volume", `${fmt(vol)} ${c.units} a month`], ["Rounding", "Nearest cent"]],
    right: usd2((fixedC + varC) / 100),
    wrong: [usd2(fixedC / 100), usd2(varC / 100), usd2(slip)],
  };
};

const breakEven: Kind = (rng, c) => {
  const runC = rng.int(3, 30);
  const netC = rng.int(8, 60);
  const saveC = netC + runC;
  const n = mult(rng, 50_000, 900_000, 100);
  const f = (netC * n) / 100;
  const count = (x: number) => `${fmt(Math.round(x))} ${c.units}`;
  if (![f / (saveC / 100), f / (runC / 100), f / ((saveC + runC) / 100)].every((x) => clear(x, 0))) return null;
  return {
    title: "Business case",
    prompt: `How many ${c.units} must go through it to break even?`,
    rows: [["One-time cost", usd(f)], ["Saving", `${usd2(saveC / 100)} per ${c.unit}`], ["Running cost", `${usd2(runC / 100)} per ${c.unit}`], ["Rounding", `Nearest whole ${c.unit}`]],
    right: count(n),
    wrong: [count(f / (saveC / 100)), count(f / (runC / 100)), count(f / ((saveC + runC) / 100))],
  };
};

const pctOfPct: Kind = (rng) => {
  const a10 = rng.int(40, 120);
  const b = rng.int(10, 40);
  if ((a10 * b) % 10 === 5 || (a10 * (100 - b)) % 10 === 5) return null;
  const p2 = (hundredths: number) => `${(hundredths / 100).toFixed(2)}%`;
  return {
    title: "Returns",
    prompt: "What share of all orders came back damaged in transit?",
    rows: [["Orders shipped", fmt(mult(rng, 40_000, 400_000, 100))], ["Returned", `${(a10 / 10).toFixed(1)}% of orders`], ["Damaged in transit", `${b}% of returns`], ["Rounding", "Two decimal places"]],
    right: p2(Math.round((a10 * b) / 10)),
    wrong: [`${b.toFixed(2)}%`, p2(Math.round((a10 * (100 - b)) / 10)), p2(Math.round((a10 * b) / 100))],
  };
};

const weighted: Kind = (rng, c) => {
  const [s1, s2] = towns(rng, c, 2);
  const x = rng.int(250, 650);
  const y = rng.int(250, 650);
  const v1 = mult(rng, 200_000, 2_400_000, 10_000);
  const v2 = mult(rng, 200_000, 2_400_000, 10_000);
  if (Math.abs(x - y) < 60 || Math.max(v1, v2) < 1.5 * Math.min(v1, v2) || (x + y) % 2) return null;
  const w = (x * v1 + y * v2) / (v1 + v2);
  const sw = (x * v2 + y * v1) / (v1 + v2);
  if (!clear(w, 0) || !clear(sw, 0)) return null;
  return {
    title: "Two sites, one network",
    prompt: `What is the combined cost per ${c.unit} across the two sites?`,
    rows: [
      [s1, `${usd2(x / 100)} per ${c.unit} on ${fmt(v1)} ${c.units}`],
      [s2, `${usd2(y / 100)} per ${c.unit} on ${fmt(v2)} ${c.units}`],
      ["Measure", `Combined cost per ${c.unit}`],
      ["Rounding", "Nearest cent"],
    ],
    right: usd2(Math.round(w) / 100),
    wrong: [usd2((x + y) / 200), usd2(Math.round(sw) / 100), usd2((v1 > v2 ? x : y) / 100)],
  };
};

const mix: Kind = (rng) => {
  const a1 = rng.int(40, 70);
  const a2 = a1 - rng.int(10, 25);
  const b1 = rng.int(10, 25);
  const b2 = b1 + rng.int(15, 35);
  const m1 = rng.int(28, 36);
  const m1b = m1 + rng.int(1, 2);
  const m2 = rng.int(8, 15);
  const m2b = m2 + rng.int(1, 2);
  const ty = (a2 * m1b + b2 * m2b) / (a2 + b2);
  const ly = (a1 * m1 + b1 * m2) / (a1 + b1);
  const oldMix = (a1 * m1b + b1 * m2b) / (a1 + b1);
  if (ty > ly - 0.5 || ![ty, ly, oldMix, (m1b + m2b) / 2].every((x) => clear(x, 1))) return null;
  return {
    title: "Gross margin by customer type",
    prompt: "Both margins went up. What is the combined gross margin this year?",
    rows: [
      ["Contract customers", `Revenue $${a1}M → $${a2}M · margin ${m1}% → ${m1b}%`],
      ["Spot customers", `Revenue $${b1}M → $${b2}M · margin ${m2}% → ${m2b}%`],
      ["Columns", "Last year → this year"],
      ["Rounding", "One decimal place"],
    ],
    right: pct1(ty),
    wrong: [pct1(ly), pct1((m1b + m2b) / 2), pct1(oldMix)],
  };
};

const compound: Kind = (rng, c) => {
  const v0 = mult(rng, 300_000, 3_000_000, 10_000);
  const g = rng.int(3, 9);
  const at = (k: number) => v0 * (1 + g / 100) ** k;
  const simple = v0 * (1 + (3 * g) / 100);
  if (![at(3), at(2), at(4), simple].every((x) => clear(x / 1000, 0))) return null;
  const k = (x: number) => `${fmt(Math.round(x / 1000) * 1000)} ${c.units}`;
  return {
    title: "Volume outlook",
    prompt: "What volume does that give in three years?",
    rows: [["Volume this year", `${fmt(v0)} ${c.units}`], ["Growth", `${g}% a year, compounded`], ["Horizon", "Three years"], ["Rounding", `Nearest thousand ${c.units}`]],
    right: k(at(3)),
    wrong: [k(simple), k(at(2)), k(at(4))],
  };
};

const NUMBERS_EASY: Kind[] = [pctChange, margin, share, unitCost, breakEven];
const NUMBERS_HARD: Kind[] = [pctOfPct, weighted, mix, compound];

// ---- Rapid round B: does the data say that? ----

const SUPPORTED = "Supported";
const NOT_SUPPORTED = "Not supported: the data can't show it";
const CONTRADICTED = "Contradicted: the data shows otherwise";
const VERDICTS = [SUPPORTED, NOT_SUPPORTED, CONTRADICTED];
const verdict = (right: string): Pick<Item, "right" | "wrong"> => ({ right, wrong: VERDICTS.filter((x) => x !== right) });
const claim = (line: string) => `Draft slide line: "${line}" What does the data say?`;

const highest: Kind = (rng, c) => {
  const s = towns(rng, c, 4);
  const costs = s.map(() => rng.int(250, 650));
  if (new Set(costs).size < 4) return null;
  const top = costs.indexOf(Math.max(...costs));
  const ok = rng.int(0, 1) === 1;
  const named = ok ? top : rng.pick([0, 1, 2, 3].filter((i) => i !== top));
  return {
    title: `Cost per ${c.unit} by site`,
    prompt: claim(`${s[named]} has the highest cost per ${c.unit}.`),
    rows: s.map((t, i) => [t, usd2(costs[i] / 100)]),
    ...verdict(ok ? SUPPORTED : CONTRADICTED),
  };
};

const total: Kind = (rng, c) => {
  const s = towns(rng, c, 3);
  const vols = s.map(() => mult(rng, 40_000, 400_000, 100));
  const sum = vols[0] + vols[1] + vols[2];
  const ok = rng.int(0, 1) === 1;
  const shown = ok ? sum : Math.round((sum * (1 + (rng.pick([-1, 1]) * rng.int(6, 15)) / 100)) / 1000) * 1000;
  if (!ok && shown === sum) return null;
  return {
    title: `${c.Units} shipped by site`,
    prompt: claim(`The three sites shipped ${fmt(shown)} ${c.units} last quarter.`),
    rows: [[s[0], fmt(vols[0])], [s[1], fmt(vols[1])], [s[2], fmt(vols[2])], ["Period", "Last quarter"]],
    ...verdict(ok ? SUPPORTED : CONTRADICTED),
  };
};

const change: Kind = (rng, c) => {
  const site = towns(rng, c, 1)[0];
  const o = mult(rng, 200_000, 2_000_000, 1000);
  const n = Math.round((o * (1 + rng.int(3, 25) / 100)) / 1000) * 1000;
  const p = (100 * (n - o)) / o;
  if (!clear(p, 0)) return null;
  const ok = rng.int(0, 1) === 1;
  const said = ok ? Math.round(p) : Math.max(1, Math.round(p) + rng.pick([-1, 1]) * rng.int(4, 9));
  if (!ok && said === Math.round(p)) return null;
  return {
    title: `${c.Units} shipped, ${site}`,
    prompt: claim(`${site}'s volume rose ${said}% on last year.`),
    rows: [["Last year", fmt(o)], ["This year", fmt(n)], ["Site", site], ["Source", "Client data extract"]],
    ...verdict(ok ? SUPPORTED : CONTRADICTED),
  };
};

const notShown: Kind = (rng, c) => {
  const s = towns(rng, c, 4);
  const named = rng.pick(s);
  return {
    title: `${c.Units} shipped by site`,
    prompt: claim(rng.int(0, 1) ? `${named} has the lowest cost per ${c.unit} in the network.` : `${named} will ship more ${c.units} next year than this year.`),
    rows: s.map((t) => [t, fmt(mult(rng, 40_000, 400_000, 100))]),
    ...verdict(NOT_SUPPORTED),
  };
};

const target: Kind = (rng, c) => {
  const s = towns(rng, c, 3);
  const t10 = rng.int(940, 985);
  const ok = rng.int(0, 1) === 1;
  const low = rng.int(0, 2);
  const rates = s.map((_, i) => (!ok && i === low ? t10 - rng.int(5, 30) : Math.min(999, t10 + rng.int(0, 30))));
  return {
    title: "Fill rate vs target",
    prompt: claim(`All three sites met the ${(t10 / 10).toFixed(1)}% fill-rate target.`),
    rows: [["Target", `${(t10 / 10).toFixed(1)}%`], ...s.map((t, i): [string, string] => [t, `${(rates[i] / 10).toFixed(1)}%`])],
    ...verdict(ok ? SUPPORTED : CONTRADICTED),
  };
};

const correlation: Kind = (rng, c) => {
  const s = towns(rng, c, 4);
  const ot = [0, 1, 2, 3].map(() => rng.int(4, 18)).sort((a, b) => a - b);
  const cost = [0, 1, 2, 3].map(() => rng.int(280, 600)).sort((a, b) => a - b);
  if (new Set(ot).size < 4 || new Set(cost).size < 4) return null;
  const rows = rng.shuffle([0, 1, 2, 3]).map((i): [string, string] => [s[i], `Overtime ${ot[i]}% of hours · ${usd2(cost[i] / 100)} per ${c.unit}`]);
  const cause = rng.int(0, 1) === 1;
  return {
    title: "Overtime and cost, 4 sites",
    prompt: claim(cause ? `Overtime drives the higher cost per ${c.unit}.` : `Sites with more overtime had a higher cost per ${c.unit}.`),
    rows,
    ...verdict(cause ? NOT_SUPPORTED : SUPPORTED),
  };
};

const bases: Kind = (rng, c) => {
  const [a, b] = towns(rng, c, 2);
  const n1 = mult(rng, 40_000, 200_000, 1000);
  const n2 = mult(rng, 10_000, 60_000, 1000);
  const r2 = rng.int(20, 60) / 10_000;
  const ok = rng.int(0, 1) === 1;
  const factor = ok ? rng.int(120, 160) / 100 : rng.int(50, 80) / 100;
  const e1 = Math.round(n1 * r2 * factor);
  const e2 = Math.round(n2 * r2);
  const higher = e1 / n1 > e2 / n2;
  if (n1 < 2 * n2 || e1 <= e2 || higher !== ok || Math.abs(e1 / n1 / (e2 / n2) - 1) < 0.1) return null;
  return {
    title: "Picking errors",
    prompt: claim(`${a} has a higher error rate than ${b}.`),
    rows: [[a, `${fmt(n1)} orders · ${fmt(e1)} picking errors`], [b, `${fmt(n2)} orders · ${fmt(e2)} picking errors`], ["Period", "Last quarter"], ["Source", "Client warehouse system"]],
    ...verdict(ok ? SUPPORTED : CONTRADICTED),
  };
};

const twoPoints: Kind = (rng, c) => {
  const site = towns(rng, c, 1)[0];
  const q = rng.int(1, 4);
  const v1 = mult(rng, 200_000, 1_500_000, 1000);
  const v2 = Math.round((v1 * (1 + rng.int(3, 20) / 100)) / 1000) * 1000;
  const p = (100 * (v2 - v1)) / v1;
  if (!clear(p, 0)) return null;
  const trend = rng.int(0, 1) === 1;
  return {
    title: `${c.Units} shipped, ${site}`,
    prompt: claim(trend ? `${site}'s volume is on a rising trend.` : `${site}'s Q${q} volume was up ${Math.round(p)}% on a year earlier.`),
    rows: [[`Q${q} ${Y - 1}`, fmt(v1)], [`Q${q} ${Y}`, fmt(v2)], ["Site", site], ["Source", "Client data extract"]],
    ...verdict(trend ? NOT_SUPPORTED : SUPPORTED),
  };
};

const subgroups: Kind = (rng, c) => {
  const [a, b] = towns(rng, c, 2);
  const nAs = rng.int(800, 1500);
  const nAr = rng.int(80, 200);
  const nBs = rng.int(80, 200);
  const nBr = rng.int(800, 1500);
  const rAs = rng.int(900, 960);
  const rAr = rng.int(600, 750);
  const rBs = rAs + rng.int(10, 30);
  const rBr = rAr + rng.int(10, 50);
  const overall = (n1: number, r1: number, n2: number, r2: number) => (n1 * r1 + n2 * r2) / (n1 + n2);
  if (overall(nAs, rAs, nAr, rAr) - overall(nBs, rBs, nBr, rBr) < 30) return null;
  const line = (n: number, r: number) => `${fmt(n)} orders · ${(r / 10).toFixed(1)}% on time`;
  const variant = rng.int(0, 3);
  const lines = [
    [`${a}'s on-time rate is higher than ${b}'s overall.`, SUPPORTED],
    [`${a} beats ${b} on on-time rate for both order types.`, CONTRADICTED],
    [`${b}'s on-time rate is higher than ${a}'s overall.`, CONTRADICTED],
    [`${b} beats ${a} on on-time rate for both order types.`, SUPPORTED],
  ];
  return {
    title: "On-time rate by order type",
    prompt: claim(lines[variant][0]),
    rows: [[`${a} · standard`, line(nAs, rAs)], [`${a} · rush`, line(nAr, rAr)], [`${b} · standard`, line(nBs, rBs)], [`${b} · rush`, line(nBr, rBr)]],
    ...verdict(lines[variant][1]),
  };
};

const EVIDENCE_EASY: Kind[] = [highest, total, change, notShown, target];
const EVIDENCE_HARD: Kind[] = [correlation, bases, twoPoints, subgroups];

// ---- Rapid round C: sense checks ----

const short = (x: number) => String(Number(x.toPrecision(2)));
function aboutMoney(x: number) {
  const r = Number(x.toPrecision(2));
  if (r >= 1e9) return `About $${short(r / 1e9)}B`;
  if (r >= 1e6) return `About $${short(r / 1e6)}M`;
  if (r >= 1e3) return `About $${short(r / 1e3)}K`;
  return `About $${short(r)}`;
}
function aboutCount(x: number) {
  const r = Number(x.toPrecision(2));
  if (r >= 1e6) return `About ${short(r / 1e6)}M`;
  return `About ${r >= 1 ? fmt(r) : short(r)}`;
}
const aboutPct = (x: number) => `About ${short(x)}%`;

/** An easy sense check: the right magnitude among three that are 10 or 100 times off. */
function magnitudes(rng: Rng, x: number, label: (x: number) => string, item: Omit<Item, "right" | "wrong">): Item | null {
  if (!clearSig(x)) return null;
  const r = Number(x.toPrecision(2));
  const ks = rng.shuffle([-2, -1, 1, 2]).slice(0, 3);
  return { ...item, right: label(r), wrong: ks.map((k) => label(r * 10 ** k)) };
}

const fte: Kind = (rng, c) => {
  const n = rng.int(40, 400);
  const cost = mult(rng, 42_000, 78_000, 500);
  return magnitudes(rng, n * cost, aboutMoney, {
    title: "Labour cost",
    prompt: "Roughly what is the site's annual labour cost?",
    rows: [["Warehouse staff", `${n} FTE`], ["Loaded cost per FTE", `${usd(cost)} a year`], ["Site", towns(rng, c, 1)[0]], ["Period", "A full year"]],
  });
};
const rent: Kind = (rng, c) => {
  const a = mult(rng, 80_000, 900_000, 1000);
  const r = rng.int(450, 1400) / 100;
  return magnitudes(rng, a * r, aboutMoney, {
    title: "Rent",
    prompt: "Roughly what is the annual rent?",
    rows: [["Floor area", `${fmt(a)} sq ft`], ["Rent", `${usd2(r)} per sq ft a year`], ["Site", towns(rng, c, 1)[0]], ["Period", "A full year"]],
  });
};
const senseUnitCost: Kind = (rng, c) => {
  const cost = mult(rng, 4_000_000, 40_000_000, 1000);
  const vol = mult(rng, 1_000_000, 12_000_000, 1000);
  return magnitudes(rng, cost / vol, aboutMoney, {
    title: `Cost per ${c.unit}`,
    prompt: `Roughly what is the cost per ${c.unit}?`,
    rows: [["Operating cost", `${usd(cost)} a year`], ["Volume", `${fmt(vol)} ${c.units} a year`], ["Site", towns(rng, c, 1)[0]], ["Period", "A full year"]],
  });
};
const saving: Kind = (rng, c) => {
  const vol = mult(rng, 500_000, 8_000_000, 1000);
  const s = rng.int(5, 90) / 100;
  return magnitudes(rng, vol * s, aboutMoney, {
    title: "Saving",
    prompt: "Roughly what is the annual saving?",
    rows: [["Volume", `${fmt(vol)} ${c.units} a year`], ["Saving", `${usd2(s)} per ${c.unit}`], ["Site", towns(rng, c, 1)[0]], ["Period", "A full year"]],
  });
};
const damage: Kind = (rng, c) => {
  const vol = mult(rng, 200_000, 3_000_000, 1000);
  const d = rng.int(150, 30_000);
  return magnitudes(rng, (100 * d) / vol, aboutPct, {
    title: "Damage",
    prompt: `Roughly what share of ${c.units} shipped were damaged?`,
    rows: [["Damaged", `${fmt(d)} ${c.units}`], ["Shipped", `${fmt(vol)} ${c.units}`], ["Site", towns(rng, c, 1)[0]], ["Period", "Last quarter"]],
  });
};

const DAYS = [250, 255, 260, 300, 310];
/** A hard sense check: the right figure among the specific slips. */
function slips(x: number, wrong: number[], label: (x: number) => string, item: Omit<Item, "right" | "wrong">): Item | null {
  if (!clearSig(x)) return null;
  return { ...item, right: label(x), wrong: wrong.map(label) };
}

const perDay: Kind = (rng, c) => {
  const vol = mult(rng, 1_000_000, 15_000_000, 1000);
  const d = rng.pick(DAYS);
  return slips(vol / d, [vol / 365, vol / 52, vol / 12], aboutCount, {
    title: "Daily throughput",
    prompt: `Roughly how many ${c.units} a day?`,
    rows: [["Volume", `${fmt(vol)} ${c.units} a year`], ["Operating days", `${d} a year`], ["Site", towns(rng, c, 1)[0]], ["Shifts", "Two a day"]],
  });
};
const perYear: Kind = (rng, c) => {
  const fuel = mult(rng, 800, 9000, 10);
  const d = rng.pick(DAYS);
  const k = rng.int(12, 60);
  return slips(fuel * d, [fuel * 365, fuel * d * k, fuel * 52], aboutMoney, {
    title: "Fuel",
    prompt: "Roughly what is the annual fuel cost?",
    rows: [["Fuel", `${usd(fuel)} a day for the fleet`], ["Operating days", `${d} a year`], ["Fleet", `${k} trucks`], ["Site", towns(rng, c, 1)[0]]],
  });
};
const perPallet: Kind = (rng, c) => {
  const p = rng.int(800, 3000) / 100;
  const k = rng.int(20, 90);
  return slips(p / k, [p, p * k, p / k / 12], aboutMoney, {
    title: "Storage",
    prompt: `Roughly what does storage cost per ${c.unit}?`,
    rows: [["Storage", `${usd2(p)} per pallet a month`], ["Pallet", `${k} ${c.units} per pallet`], ["Dwell", "One month on average"], ["Site", towns(rng, c, 1)[0]]],
  });
};
const thousands: Kind = (rng) => {
  const f = [0, 1, 2].map(() => mult(rng, 300, 4000, 10));
  const sum = f[0] + f[1] + f[2];
  return slips(sum * 1000, [sum, sum * 1e6, sum * 100], aboutMoney, {
    title: "Freight by region",
    prompt: "Roughly what is total freight cost?",
    rows: [["North", fmt(f[0])], ["South", fmt(f[1])], ["West", fmt(f[2])], ["Units", "All figures in $000s"]],
  });
};
const fteHours: Kind = (rng, c) => {
  const h = mult(rng, 100_000, 1_200_000, 100);
  return slips(h / 2080, [h / 40, h / 8, h / 365], aboutCount, {
    title: "Staffing",
    prompt: "Roughly how many full-time equivalents is that?",
    rows: [["Labour hours", `${fmt(h)} a year`], ["Hours per FTE", "2,080 a year (40 × 52)"], ["Site", towns(rng, c, 1)[0]], ["Period", "A full year"]],
  });
};

const SENSE_EASY: Kind[] = [fte, rent, senseUnitCost, saving, damage];
const SENSE_HARD: Kind[] = [perDay, perYear, perPallet, thousands, fteHours];

const rapidNumbersStep = rapidStep(
  "rapid-numbers",
  "Rapid round: the numbers",
  "The numbers: 15 items, 20 seconds each. Everything you need is in the exhibit; round as it says. A calculator is fine.",
  "rn",
  4,
);
const rapidEvidenceStep = rapidStep(
  "rapid-evidence",
  "Rapid round: does the data say that?",
  [
    "Does the data say that? 15 draft slide lines, 20 seconds each. Judge each line on the exhibit alone, using Corvid Lane's evidence card:",
    "Supported: the figures shown establish the line. Not supported: the figures shown can't establish it either way (a cause from a correlation, a trend from only two readings, something the exhibit doesn't show). Contradicted: the figures shown establish the opposite. When the bases differ, compare rates, not counts.",
  ].join("\n"),
  "re",
  3,
);
const rapidSenseStep = rapidStep(
  "rapid-sense",
  "Rapid round: sense checks",
  "Sense checks: 15 items, 20 seconds each. Before a figure goes on a slide, check it's the right size: pick the figure the inputs give, to two significant figures.",
  "rs",
  4,
);

// ---- Section 2: site analysis ----

const SITE_ROWS = 9;
const siteStep = {
  id: "site-analysis",
  type: SPREADSHEET,
  title: "Site benchmark",
  config: {
    prompt: [
      "Benchmark {{client}}'s {{region}} sites for the steering pack. For each in-scope site, on its first row only, enter the cost per {{unit}} (to the cent) and {{units}} per labour hour (two decimals). Then enter the benchmark and the annual saving in dollars. Leave rows that don't count blank.",
      "",
      "Data notes from {{fa}}: volume is {{units}} shipped; labour hours are paid hours; operating cost is in dollars, except {{k_site}}, which reports operating cost in $000s. Months of data: {{p_site}} opened partway through the year and has {{p_n}} months; {{c_site}} closed at the end of {{c_month}} and has {{c_n}} months. Every other site has 12.",
    ].join("\n"),
    columns: ["Code", "Site", "Months of data", "Volume ({{units}})", "Labour hours", "Operating cost", "Cost per {{unit}} ($)", "{{units_cap}} per labour hour"],
    rows: [
      ...Array.from({ length: SITE_ROWS }, (_, i) => [
        `{{sa_${i + 1}_code}}`,
        `{{sa_${i + 1}_site}}`,
        { text: `{{sa_${i + 1}_months}}`, align: "right" },
        { text: `{{sa_${i + 1}_vol}}`, align: "right" },
        { text: `{{sa_${i + 1}_hours}}`, align: "right" },
        { text: `{{sa_${i + 1}_cost}}`, align: "right" },
        { input: `r${i + 1}_cpu`, label: `Row ${i + 1}: cost per unit`, format: "money", points: 1 },
        { input: `r${i + 1}_uph`, label: `Row ${i + 1}: units per labour hour`, format: "number", points: 1 },
      ]),
      [{ text: "Benchmark", bold: true }, "Median cost per {{unit}}, in-scope sites", null, null, null, null, { input: "benchmark", label: "Benchmark: median cost per unit", format: "money", points: 2 }, null],
      [{ text: "Saving", bold: true }, "Annual saving if every in-scope site above the benchmark reaches it ($)", null, null, null, null, { input: "saving", label: "Total annual saving", format: "money", points: 4 }, null],
    ],
  },
};

interface Site {
  code: string;
  name: string;
  months: number;
  monthly: number;
  vol: number;
  cents: number;
  hours: number;
  shownHours: number;
  role: "k" | "p" | "cor" | "dup" | "closed" | "plain";
}

/** Benchmark (cents) and saving (dollars) over a list of sites, optionally without annualising. */
function benchmark(list: { cents: number; vol: number; months: number }[], annualise = true) {
  const s = list.map((d) => d.cents).sort((a, b) => a - b);
  const mid = s.length / 2;
  const bench = s.length % 2 ? s[Math.floor(mid)] : (s[mid - 1] + s[mid]) / 2;
  const saving = list.reduce((t, d) => t + (d.cents > bench ? ((d.cents - bench) * d.vol * (annualise ? 12 / d.months : 1)) / 100 : 0), 0);
  return { bench, saving: Math.round(saving) };
}

const SAVING_TOLERANCE = 500;

function buildSites(rng: Rng, v: Values, names: string[], fyStart: number) {
  for (let tries = 0; tries < 5_000; tries++) {
    const codes = rng.shuffle(Array.from({ length: 39 }, (_, i) => i + 10)).slice(0, 8);
    const roles = rng.shuffle(["k", "p", "cor", "dup", "closed", "plain", "plain", "plain"] as Site["role"][]);
    const cents = roles.map((r) => (r === "k" ? rng.int(28, 62) * 10 : rng.int(280, 620)));
    const sorted = [...cents].sort((a, b) => a - b);
    if (sorted.some((x, i) => i > 0 && x - sorted[i - 1] < 4)) continue;
    const sites: Site[] = roles.map((role, i) => {
      const months = role === "p" ? rng.int(5, 9) : role === "closed" ? rng.int(4, 8) : 12;
      const monthly = role === "k" ? mult(rng, 90_000, 480_000, 2500) : mult(rng, 90_000, 480_000, 100);
      const vol = monthly * months;
      const hours = Math.round(vol / (rng.int(1400, 4200) / 100));
      const shownHours = role === "cor" ? Math.round(hours * (1 + rng.int(8, 20) / 100)) : hours;
      return { code: `DC-${codes[i]}`, name: names[i], months, monthly, vol, cents: cents[i], hours, shownHours, role };
    });
    const inScope = sites.filter((s) => s.role !== "closed");
    const { bench, saving } = benchmark(inScope);
    const above = (role: Site["role"]) => sites.find((s) => s.role === role)!.cents > bench;
    if (!above("k") || !above("p") || !above("dup")) continue;
    const k = sites.find((s) => s.role === "k")!;
    if ((k.cents * k.vol) % 100_000 !== 0) continue;
    const alts = [
      benchmark(inScope, false),
      benchmark(sites),
      benchmark([...inScope, sites.find((s) => s.role === "dup")!]),
      benchmark(inScope.map((s) => (s === k ? { ...s, cents: s.cents / 1000 } : s))),
    ];
    if (Math.abs(alts[0].saving - saving) < 5 * SAVING_TOLERANCE) continue;
    if (alts.slice(1).some((a) => Math.abs(a.bench - bench) < 1.5 || Math.abs(a.saving - saving) < 5 * SAVING_TOLERANCE)) continue;

    // Nine rows: the eight sites and the duplicated one again, in a seeded order.
    const dup = sites.find((s) => s.role === "dup")!;
    const rows = rng.shuffle([...sites, dup]);
    const cells: Record<string, { value: number; tolerance?: number }> = {
      benchmark: { value: bench / 100, tolerance: 0.01 },
      saving: { value: saving, tolerance: SAVING_TOLERANCE },
    };
    rows.forEach((s, i) => {
      const r = i + 1;
      const cost = (s.cents * s.vol) / 100;
      Object.assign(v, {
        [`sa_${r}_code`]: s.code,
        [`sa_${r}_site`]: s.name,
        [`sa_${r}_months`]: String(s.months),
        [`sa_${r}_vol`]: fmt(s.vol),
        [`sa_${r}_hours`]: fmt(s.shownHours),
        [`sa_${r}_cost`]: fmt(s.role === "k" ? cost / 1000 : cost),
      });
      if (s.role !== "closed" && rows.indexOf(s) === i) {
        cells[`r${r}_cpu`] = { value: s.cents / 100, tolerance: 0.01 };
        cells[`r${r}_uph`] = { value: Number((s.vol / s.hours).toFixed(2)), tolerance: 0.01 };
      }
    });
    const by = (role: Site["role"]) => sites.find((s) => s.role === role)!;
    const closed = by("closed");
    Object.assign(v, {
      k_site: by("k").name,
      p_site: by("p").name,
      p_n: String(by("p").months),
      c_site: closed.name,
      c_month: MONTHS[(fyStart + closed.months - 1) % 12],
      c_n: String(closed.months),
      cor_site: by("cor").name,
      cor_hours: fmt(by("cor").hours),
      cor_wrong: fmt(by("cor").shownHours),
    });
    return { cells, sites, closed, inScope };
  }
  throw new Error(`${SLUG}: no site set`);
}

// ---- Section 4: deck check ----

type SlideKind = "agenda" | "cost" | "saving" | "mixCost" | "mixVol" | "period" | "unitsBad" | "unitsOk" | "noSource" | "overclaim" | "correlation" | "withdrawn";
const DECK_ROWS = 12;

const deckStep = {
  id: "deck-check",
  type: DOCUMENT_REVIEW,
  title: "Steering deck check",
  config: {
    prompt: "Check every slide of the draft steering deck against the data appendix and Corvid Lane's standards (in the header). Flag each slide that breaks one, with the reason, then decide what to do with the list.",
    document: {
      title: "{{client}} cost review · steering deck draft v3",
      fields: [
        { id: "fy", label: "Client fiscal year", value: "{{fy_def}}" },
        { id: "a1", label: "A1 · Network operating cost", value: "{{a1}}" },
        { id: "a2", label: "A2 · Cost mix", value: "{{a2}}" },
        { id: "a3", label: "A3 · Volume mix by customer type", value: "{{a3}}" },
        { id: "a4", label: "A4 · Annual saving if sites above the median reach it", value: "{{a4}}" },
        { id: "a5", label: "A5 · Overtime cost", value: "{{a5}}" },
        { id: "a6", label: "A6 · Overtime vs cost per {{unit}}", value: "{{a6}}" },
        { id: "a7", label: "A7 · Cost per {{unit}}", value: "{{a7}}" },
        { id: "a8", label: "A8 · Agency labour cost", value: "{{a8}}" },
        {
          id: "rule",
          label: "Corvid Lane standard",
          value: "Round $M to one decimal. Rounded shares may total 99% to 101%. Every figure cites an appendix line. Titles state only what the data shows. Periods and units on every figure.",
        },
      ],
      columns: ["Slide", "Title", "Figure cited", "Period", "Unit", "Source"],
      rows: Array.from({ length: DECK_ROWS }, (_, i) => ({
        id: `d${i + 1}`,
        cells: [String(i + 1), ...["title", "fig", "period", "unit", "src"].map((c) => `{{dk_${i + 1}_${c}}}`)],
      })),
      totals: [],
    },
    reasons: [
      { id: "mismatch", label: "Figure doesn't match the appendix" },
      { id: "overclaim", label: "Title claims more than the data shows" },
      { id: "shares", label: "Shares don't add to 100" },
      { id: "period", label: "Fiscal and calendar years mixed" },
      { id: "units", label: "Wrong unit" },
      { id: "source", label: "Figure has no source" },
      { id: "other", label: "Other" },
    ],
    findings: [
      { id: "mismatch", label: "Figure doesn't match the appendix", points: 3 },
      { id: "overclaim", label: "Title claims more than the data shows", points: 3 },
      { id: "shares", label: "Shares that don't add to 100", points: 3 },
      { id: "period", label: "Fiscal year mixed with calendar year", points: 3 },
      { id: "units", label: "Thousands labelled as millions", points: 3 },
      { id: "source", label: "Figure with no source", points: 3 },
    ],
    falseFlagPenalty: 1,
    decision: {
      prompt: "The deck goes to {{mgr_first}} next, then to the steering committee at 4. What do you do with your list?",
      options: [
        { id: "senior", label: "Send {{sr_first}} the list of issues before the deck goes anywhere, so the slide owner fixes them" },
        { id: "quiet", label: "Fix the numbers in the deck yourself and say nothing, to save everyone time" },
        { id: "client", label: "Send the deck to {{od_first}}, who asked for a preview, and note the issues alongside" },
        { id: "wait", label: "Leave it: {{mgr_first}} reviews the deck before steering anyway" },
      ],
      points: 2,
    },
  },
};

/** Shares in tenths of a percent that total 1,000, with no tie when rounded to whole percent. */
function drawShares(rng: Rng, names: string[], ranges: [number, number][], needOff: boolean): number[] | null {
  const head = ranges.map(([lo, hi]) => rng.int(lo, hi));
  const last = 1000 - head.reduce((t, x) => t + x, 0);
  const all = [...head, last];
  if (last < 40 || all.some((x) => x % 10 === 5) || all.slice(1).some((x) => x >= all[0])) return null;
  const roundedSum = all.reduce((t, x) => t + Math.round(x / 10), 0);
  if (needOff && roundedSum === 100) return null;
  if (names.length !== all.length) throw new Error(`${SLUG}: share names`);
  return all;
}
const shareList = (names: string[], tenths: number[]) => names.map((n, i) => `${n} ${(tenths[i] / 10).toFixed(1)}%`).join(", ");
const roundedList = (names: string[], whole: number[]) => names.map((n, i) => `${n} ${whole[i]}%`).join(", ");

function buildDeck(rng: Rng, v: Values, unit: string, units: string, closed: { name: string; cents: number }) {
  for (let tries = 0; tries < 5_000; tries++) {
    const a1c = rng.int(3000, 9000);
    const a4c = rng.int(250, 790);
    if (a1c % 10 === 5 || a4c % 10 === 5) continue;
    const COST = ["Labour", "Transport", "Facilities", "Other"];
    const VOL = ["Retail", "Wholesale", "Online"];
    const badMix = rng.pick(["mixCost", "mixVol"] as const);
    const a2 = drawShares(rng, COST, [[480, 600], [180, 260], [90, 160]], badMix !== "mixCost");
    const a3 = drawShares(rng, VOL, [[400, 480], [300, 380]], badMix !== "mixVol");
    if (!a2 || !a3) continue;
    const ot = mult(rng, 900, 4800, 10);
    const agency = mult(rng, 400, 2500, 10);
    const r = (rng.int(52, 78) / 100).toFixed(2);
    const c1 = rng.int(300, 520);
    const c0 = c1 + rng.int(8, 40);
    const dmg = (rng.int(3, 9) / 10).toFixed(1);
    const bad = rng.pick(["cost", "saving"] as const);
    const shown = (c: number, isBad: boolean) => {
      const right = Number((c / 100).toFixed(1));
      return isBad ? Math.max(0.5, right + rng.pick([-1, 1]) * (rng.int(3, 9) / 10)) : right;
    };
    const costShown = shown(a1c, bad === "cost").toFixed(1);
    const savingShown = shown(a4c, bad === "saving").toFixed(1);
    if (costShown === (a1c / 100).toFixed(1) && bad === "cost") continue;
    if (savingShown === (a4c / 100).toFixed(1) && bad === "saving") continue;

    // Shares as the slide shows them: rounded from the appendix, one altered on the bad slide.
    const slideShares = (tenths: number[], isBad: boolean) => {
      const whole = tenths.map((x) => Math.round(x / 10));
      if (isBad) {
        const i = rng.int(1, whole.length - 1);
        whole[i] += rng.pick([-1, 1]) * rng.int(6, 9);
        if (whole[i] <= 0 || whole[i] >= whole[0]) return null;
      }
      return whole;
    };
    const costWhole = slideShares(a2, badMix === "mixCost");
    const volWhole = slideShares(a3, badMix === "mixVol");
    if (!costWhole || !volWhole) continue;
    const overclaim = rng.pick(["cause", "every"] as const);
    const fy = `FY${Y}`;
    const perUnit = `$ per ${unit}`;
    const a7fig = `${usd2(c0 / 100)} → ${usd2(c1 / 100)}`;
    const slides: Record<SlideKind, [string, string, string, string, string]> = {
      agenda: ["Agenda", "—", "—", "—", "—"],
      cost: [`Network operating cost was $${costShown}M in ${fy}`, `$${costShown}M`, fy, "$M", "A1"],
      saving: [`Bringing sites above the median to it saves $${savingShown}M a year`, `$${savingShown}M`, "Annual run-rate", "$M", "A4"],
      mixCost: ["Labour is the largest share of cost", roundedList(COST, costWhole), fy, "% of cost", "A2"],
      mixVol: ["Retail is the largest customer type by volume", roundedList(VOL, volWhole), fy, "% of volume", "A3"],
      period: [`Cost per ${unit} fell from ${usd2(c0 / 100)} to ${usd2(c1 / 100)}`, a7fig, `CY${Y - 1} vs ${fy}`, perUnit, "A7"],
      unitsBad: [`Overtime cost was $${fmt(ot)}M in ${fy}`, fmt(ot), fy, "$M", "A5"],
      unitsOk: [`Agency labour cost $${fmt(agency)}K in ${fy}`, fmt(agency), fy, "$000s", "A8"],
      noSource: [`Damaged ${units} cost about $${dmg}M a year`, `$${dmg}M`, fy, "$M", "—"],
      overclaim:
        overclaim === "cause"
          ? [`Overtime drives higher cost per ${unit}`, `r = ${r}`, fy, "Correlation", "A6"]
          : [`Cost per ${unit} falls every year`, a7fig, `FY${Y - 1} vs ${fy}`, perUnit, "A7"],
      correlation: [`Sites with more overtime had higher cost per ${unit}`, `r = ${r}`, fy, "Correlation", "A6"],
      withdrawn: [`${closed.name}: cost per ${unit} was ${usd2(closed.cents / 100)}`, usd2(closed.cents / 100), fy, perUnit, "—"],
    };
    const order: SlideKind[] = ["agenda", ...rng.shuffle((Object.keys(slides) as SlideKind[]).filter((k) => k !== "agenda"))];
    order.forEach((kind, i) => {
      const [title, fig, period, u, src] = slides[kind];
      Object.assign(v, { [`dk_${i + 1}_title`]: title, [`dk_${i + 1}_fig`]: fig, [`dk_${i + 1}_period`]: period, [`dk_${i + 1}_unit`]: u, [`dk_${i + 1}_src`]: src });
    });
    const at = (kind: SlideKind) => `d${order.indexOf(kind) + 1}`;
    const no = (kind: SlideKind) => order.indexOf(kind) + 1;
    const nCorr = rng.int(18, 30);
    Object.assign(v, {
      a1: `$${(a1c / 100).toFixed(2)}M, ${fy}`,
      a2: `${shareList(COST, a2)} (${fy})`,
      a3: `${shareList(VOL, a3)} (${fy})`,
      a4: `$${(a4c / 100).toFixed(2)}M a year (model v3)`,
      a5: `${fmt(ot)} in $000s, ${fy}`,
      a6: `Correlation ${r} across ${nCorr} sites, ${fy}`,
      a7: `${usd2(c0 / 100)} in FY${Y - 1}, ${usd2(c1 / 100)} in ${fy}`,
      a8: `${fmt(agency)} in $000s, ${fy}`,
      wd_no: String(no("withdrawn")),
    });
    const mixKind = badMix;
    const mixNote =
      mixKind === "mixCost"
        ? `Slide ${no("mixCost")}'s cost shares total ${costWhole.reduce((t, x) => t + x, 0)}%; appendix A2 rounds to ${a2.map((x) => Math.round(x / 10)).join(" / ")}.`
        : `Slide ${no("mixVol")}'s volume shares total ${volWhole.reduce((t, x) => t + x, 0)}%; appendix A3 rounds to ${a3.map((x) => Math.round(x / 10)).join(" / ")}.`;
    const findings = {
      mismatch: {
        targets: [at(bad)],
        reasons: ["mismatch"],
        note:
          bad === "cost"
            ? `Slide ${no("cost")} shows $${costShown}M; appendix A1 gives $${(a1c / 100).toFixed(2)}M, which rounds to $${(a1c / 100).toFixed(1)}M.`
            : `Slide ${no("saving")} shows $${savingShown}M; appendix A4 gives $${(a4c / 100).toFixed(2)}M, which rounds to $${(a4c / 100).toFixed(1)}M.`,
      },
      overclaim: {
        targets: [at("overclaim")],
        reasons: ["overclaim"],
        note:
          overclaim === "cause"
            ? `Slide ${no("overclaim")} claims overtime drives cost; appendix A6 is only a correlation.`
            : `Slide ${no("overclaim")} claims cost falls every year; appendix A7 has two years only.`,
      },
      shares: { targets: [at(mixKind)], reasons: ["shares", "mismatch"], note: mixNote },
      period: { targets: [at("period")], reasons: ["period"], note: `Slide ${no("period")} labels the FY${Y - 1} figure as CY${Y - 1}; appendix A7 is fiscal years only.` },
      units: { targets: [at("unitsBad")], reasons: ["units"], note: `Slide ${no("unitsBad")} labels overtime of ${fmt(ot)} as $M; appendix A5 is in $000s.` },
      source: { targets: [at("noSource")], reasons: ["source"], note: `Slide ${no("noSource")} shows $${dmg}M of damage with no appendix line behind it.` },
    };
    return { findings, a4c };
  }
  throw new Error(`${SLUG}: no deck`);
}

// ---- Section 6: steering pack desk ----

const summaryStep = {
  id: "summary-order",
  type: ORDERING,
  seconds: 150,
  title: "Executive summary order",
  config: {
    prompt: "Order {{mgr_first}}'s executive summary lines. Corvid Lane standard: answer first, then the supporting findings from the largest saving to the smallest, then the risk, the ask and next steps.",
    items: Array.from({ length: 7 }, (_, i) => ({ id: `o${i + 1}`, label: `{{so_${i + 1}}}` })),
    positionPoints: 3,
    pairwisePoints: 5,
  },
};
const paybackStep = {
  id: "payback",
  type: NUMERIC,
  seconds: 90,
  title: "Payback",
  config: { prompt: "Payback on the one-time costs, in months (one decimal).", unit: "months", decimals: 1, points: 6 },
};
const netStep = {
  id: "net-saving",
  type: NUMERIC,
  seconds: 90,
  title: "Three-year net saving",
  config: { prompt: "Three-year net saving after the one-time costs, in dollars.", unit: "$", decimals: 0, points: 6 },
};
function valuesStep(tag: string, prefix: string, title: string, prompt: string) {
  return {
    id: `values-${tag}`,
    type: MULTIPLE_CHOICE,
    seconds: 78,
    title: `Judgment: ${title}`,
    config: { prompt, options: LETTERS.map((l) => ({ id: l, label: `{{${prefix}_${l}}}` })), select: "single", points: 2 },
  };
}
const VALUES = [
  valuesStep("integrity", "vi", "the headline number", "The model says ${{vi_model}}M a year. {{mgr_first}} wants \"about ${{vi_ask}}M\" on the title slide. What do you do?"),
  valuesStep("candor", "vc", "your table", "{{fa_first}} has found an error in the table you sent yesterday. What do you do?"),
  valuesStep("client-care", "vk", "a friend asks", "{{vk_friend_first}} asks which sites {{client}} is closing. What do you do?"),
  valuesStep("in-lane", "vl", "the layoffs question", "{{od_first}} asks you whether the team will recommend layoffs. What do you do?"),
  valuesStep("teamwork", "vt", "the senior's slide", "{{sr_first}} presents in thirty minutes. Their slide on {{vt_site}} uses last year's volume, which overstates the saving by ${{vt_over}}M. What do you do?"),
];

const msg = (id: string, from: string, subject: string, body: string[], stepId: string, arriveAtMinute = 0) => ({ id, from, subject, body: body.join("\n"), arriveAtMinute, stepId });

const DEFINITION = {
  intro: [
    "You're a first-year analyst at Corvid Lane Advisory, on a cost review for {{client}}, a regional {{industry}} distributor. The steering committee meets at 4 today, and {{mgr}}, your engagement manager, wants the pack ready by then.",
    "The work comes in six timed parts, 50 minutes in all: three rapid rounds between a site benchmark, a check of the steering deck, and a final desk where requests arrive one screen at a time. A calculator is fine. Client data stays in the engagement folder.",
  ].join("\n\n"),
  steps: [rapidNumbersStep, siteStep, rapidEvidenceStep, deckStep, rapidSenseStep, summaryStep, paybackStep, netStep, ...VALUES],
  messages: [
    msg(
      "m-brief",
      "Your engagement manager",
      "{{client}}: site benchmark for steering",
      [
        "Hi {{first_name}},",
        "",
        "Steering committee is at 4 today, and I want the {{region}} site benchmark in the pack. The extract is in the sheet, with {{fa_first}}'s data notes. Here's the brief and our standards.",
        "",
        "Engagement brief",
        "- Scope: {{client}}'s {{region}} distribution sites. {{c_site}} closed at the end of {{c_month}} and is out of scope.",
        "- Benchmark: the median cost per {{unit}} across the in-scope sites.",
        "- Saving: for each in-scope site above the benchmark, (its cost per {{unit}} − the benchmark) × its annual volume. Annualise part-year sites: volume × 12 ÷ months of data.",
        "- One-time costs for the business case: site re-layout ${{ot_relayout}}, WMS changes ${{ot_wms}}, project team ${{ot_team}}.",
        "",
        "Corvid Lane standards",
        "- Every number on a slide has a source.",
        "- Titles state only what the data shows.",
        "- Periods and units are labelled.",
        "- Client data stays in the engagement folder.",
        "",
        "{{mgr}}",
      ],
      "site-analysis",
    ),
    msg(
      "m-correction",
      "Client finance analyst",
      "Correction to the site extract",
      [
        "Hi {{first_name}},",
        "",
        "Correction to the extract: {{cor_site}}'s labour hours double-count agency hours. The right figure is {{cor_hours}} for the period, not {{cor_wrong}}. Everything else stands.",
        "",
        "{{fa}}, Finance, {{client}}",
      ],
      "site-analysis",
      4,
    ),
    msg(
      "m-deck",
      "Senior consultant",
      "Steering deck v3: can you check it?",
      [
        "Hi {{first_name}},",
        "",
        "v3 of the steering deck is in the folder; the slides and the data appendix are in front of you. Before it goes to {{mgr_first}}, can you check every slide against the appendix and our standards? Flag anything wrong, with the reason, and tell me what you'll do with the list.",
        "",
        "{{od_first}} at {{client}} has asked for a preview copy too.",
        "",
        "{{sr}}",
      ],
      "deck-check",
    ),
    msg(
      "m-deck-update",
      "Senior consultant",
      "Slide pulled",
      ["Quick one: I've pulled slide {{wd_no}} ({{c_site}}). {{c_site}} closed at the end of {{c_month}} and is out of scope, so ignore that slide.", "", "{{sr}}"],
      "deck-check",
      4,
    ),
    msg(
      "m-summary",
      "Your engagement manager",
      "Exec summary lines",
      [
        "Hi {{first_name}},",
        "",
        "Here are the executive summary lines in the order I jotted them down. Please put them in the order our standard sets for steering packs: the answer first, then the supporting findings from the largest saving to the smallest, then the main risk, the ask, and next steps.",
        "",
        "{{mgr}}",
      ],
      "summary-order",
    ),
    msg(
      "m-payback",
      "Your engagement manager",
      "Payback",
      ["Payback for the business case, please: the one-time costs are in this morning's engagement brief, and the model's run-rate saving is ${{run_rate}} a year. Months, to one decimal.", "", "{{mgr}}"],
      "payback",
    ),
    msg(
      "m-net",
      "Your engagement manager",
      "Three-year net saving",
      [
        "And the three-year net saving for the same case: year one at half the run-rate while the sites ramp up, years two and three at the full run-rate, less the one-time costs. In dollars.",
        "",
        "{{mgr}}",
      ],
      "net-saving",
    ),
    msg(
      "m-values-integrity",
      "Your engagement manager",
      "Title slide",
      ["Hi {{first_name}},", "", "For the title slide, let's say \"about ${{vi_ask}}M a year\". It lands better with the committee, and there's upside in the model anyway.", "", "{{mgr}}"],
      "values-integrity",
    ),
    msg(
      "m-values-candor",
      "Client finance analyst",
      "Your site table",
      [
        "Hi {{first_name}},",
        "",
        "The site table you sent me yesterday has {{vc_site}}'s operating cost at ${{vc_wrong}}. Our ledger gives ${{vc_right}}. Looks like two digits swapped?",
        "",
        "{{fa}}",
      ],
      "values-candor",
    ),
    msg(
      "m-values-client-care",
      "A friend at another firm (personal email)",
      "Quick question",
      ["Hey!", "", "Heard you're on the {{client}} job. Which sites are they closing? A client of ours leases space near {{vk_site}} and would love a heads-up. Drinks on me.", "", "{{vk_friend}}"],
      "values-client-care",
    ),
    msg(
      "m-values-in-lane",
      "Client operations director",
      "Straight question",
      ["Hi {{first_name}},", "", "Straight question: is your team going to recommend layoffs at {{vl_site}}? My shift leads keep asking me.", "", "{{od}}"],
      "values-in-lane",
    ),
    msg(
      "m-values-teamwork",
      "Senior consultant",
      "Presenting the site section",
      ["Hi {{first_name}},", "", "I'm presenting the site section to {{od_first}} at {{vt_time}}. Deck's in the folder if you want a look.", "", "{{sr}}"],
      "values-teamwork",
    ),
  ],
  sections: [
    { id: "s-rapid-a", title: "Rapid round: the numbers", minutes: 6, stepIds: ["rapid-numbers"] },
    { id: "s-work-1", title: "Site benchmark", minutes: 10, stepIds: ["site-analysis"] },
    { id: "s-rapid-b", title: "Rapid round: does the data say that?", minutes: 6, stepIds: ["rapid-evidence"] },
    { id: "s-work-2", title: "Steering deck check", minutes: 10, stepIds: ["deck-check"] },
    { id: "s-rapid-c", title: "Rapid round: sense checks", minutes: 6, stepIds: ["rapid-sense"] },
    {
      id: "s-desk",
      title: "Steering pack desk",
      minutes: 12,
      stepIds: ["summary-order", "payback", "net-saving", ...VALUES.map((s) => s.id)],
      oneAtATime: true,
    },
  ],
};

// ---- Leak guard ----

/**
 * The candidate's screen must not show a computed answer in any form (12.34,
 * 1234 as cents, 1,234.00). A cost per unit or a payback can collide with a
 * figure elsewhere by chance (a rapid-round price, a $M figure on a slide),
 * and the ordering view draws its drag handle at 5.5 and 10.5, so the
 * generator draws again when a key would match any of them.
 */
const STATIC_TEXT = JSON.stringify(DEFINITION);
/** Numbers the step views themselves render on every screen (the ordering drag handle's SVG circles). */
const VIEW_TEXT = 'cx="5.5" cx="10.5"';
function leakForms(value: number): RegExp[] {
  const forms = [JSON.stringify(value), value.toFixed(2), String(Math.round(value * 100)), value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })];
  return [...new Set(forms)].filter((f) => !/^\d{1,3}$/.test(f)).map((s) => new RegExp(`(?<![\\d.,])${s.replace(/[.$]/g, "\\$&")}(?![\\d.]\\d)`));
}
function leaks(values: Values, numbers: number[]): boolean {
  const text = `${STATIC_TEXT}\n${VIEW_TEXT}\n${Object.values(values).join("\n")}`;
  return numbers.some((n) => n >= 1 && leakForms(n).some((re) => re.test(text)));
}

// ---- Generator ----

function placeOptions(rng: Rng, right: string, wrong: string[]): { labels: string[]; letter: string } {
  if (wrong.length !== 3 || new Set([right, ...wrong]).size !== 4) throw new Error(`${SLUG}: options must be 4 different labels (${right})`);
  const labels = rng.shuffle([right, ...wrong]);
  return { labels, letter: LETTERS[labels.indexOf(right)] };
}

function buildOnce(rng: Rng) {
  const v: Values = {};
  const ind = rng.pick(INDUSTRIES);
  const client = rng.pick(ind.clients);
  const region = rng.pick(REGIONS);
  const fy = rng.pick(FY_ENDS);
  const unit = ind.unit;
  const units = `${unit}s`;
  const units_cap = units[0].toUpperCase() + units.slice(1);
  const [mgr, sr, od, fa, friend] = people(rng, 5);
  const allTowns = rng.shuffle(TOWNS);
  const siteNames = allTowns.slice(0, 8);
  Object.assign(v, {
    client,
    industry: ind.industry,
    region,
    unit,
    units,
    units_cap,
    fy_def: fy.def,
    mgr: mgr.full,
    mgr_first: mgr.first,
    sr: sr.full,
    sr_first: sr.first,
    od: od.full,
    od_first: od.first,
    fa: fa.full,
    fa_first: fa.first,
  });

  // ---- Site benchmark ----
  const sites = buildSites(rng, v, siteNames, fy.start);

  // ---- Deck check ----
  const deck = buildDeck(rng, v, unit, units, sites.closed);

  // ---- Desk: business case ----
  const relayout = mult(rng, 600_000, 1_800_000, 5000);
  const wms = mult(rng, 300_000, 1_200_000, 5000);
  const team = mult(rng, 400_000, 1_500_000, 5000);
  const oneTime = relayout + wms + team;
  const runRate = deck.a4c * 10_000;
  const payback = Number(((oneTime * 12) / runRate).toFixed(1));
  const net = 2.5 * runRate - oneTime;
  Object.assign(v, { ot_relayout: fmt(relayout), ot_wms: fmt(wms), ot_team: fmt(team), run_rate: fmt(runRate) });

  // ---- Desk: executive summary ----
  const t10 = Math.round(deck.a4c / 10);
  let f: number[] = [];
  for (let tries = 0; tries < 1_000 && !f.length; tries++) {
    const f1 = rng.int(5, t10 - 10);
    const f2 = rng.int(5, t10 - 10);
    const f3 = t10 - f1 - f2;
    if (f3 >= 3 && new Set([f1, f2, f3]).size === 3) f = [f1, f2, f3];
  }
  if (!f.length) return null;
  const inScopeNames = sites.inScope.map((s) => s.name);
  const topics = rng.shuffle([
    `Labour scheduling at ${rng.pick(inScopeNames)}`,
    `Transport routing in the ${region}`,
    "Slotting and pick paths",
    "Overtime controls",
    "Packaging and dunnage",
  ]);
  const pilot = rng.pick(inScopeNames);
  const lines = [
    `Bringing the sites above the median to it saves about $${(t10 / 10).toFixed(1)}M a year`,
    ...[...f].sort((a, b) => b - a).map((x, i) => `${topics[i]}: $${(x / 10).toFixed(1)}M a year`),
    `Risk: ${rng.pick(["peak season could delay the site re-layouts", "the WMS change depends on the vendor's release date", "two sites have shift agreements under negotiation"])}`,
    `Ask: approve a ${rng.pick([8, 10, 12])}-week pilot at ${pilot}`,
    `Next steps: pilot plan to ${od.first} by ${rng.pick(["Friday", "next Tuesday", "next Wednesday"])}`,
  ];
  const slot = rng.shuffle([0, 1, 2, 3, 4, 5, 6]);
  lines.forEach((line, i) => (v[`so_${slot[i] + 1}`] = line));
  const summaryOrder = lines.map((_, i) => `o${slot[i] + 1}`);

  // ---- Desk: values calls ----
  const a4 = deck.a4c / 100;
  const model = a4.toFixed(1);
  const ask = Math.floor(a4) + 1 - a4 >= 0.4 ? Math.floor(a4) + 1 : Math.floor(a4) + 2;
  const vcRight = mult(rng, 3_000_000, 12_000_000, 1000);
  const digits = String(vcRight).split("");
  const swapAt = rng.int(1, 3);
  [digits[swapAt], digits[swapAt + 1]] = [digits[swapAt + 1], digits[swapAt]];
  const vcWrong = Number(digits.join(""));
  if (vcWrong === vcRight) return null;
  const vtSite = rng.pick(inScopeNames);
  Object.assign(v, {
    vi_model: model,
    vi_ask: String(ask),
    vc_site: rng.pick(inScopeNames),
    vc_wrong: fmt(vcWrong),
    vc_right: fmt(vcRight),
    vk_site: sites.closed.name,
    vk_friend: friend.full,
    vk_friend_first: friend.first,
    vl_site: rng.pick(inScopeNames),
    vt_site: vtSite,
    vt_over: (rng.int(2, 8) / 10).toFixed(1),
    vt_time: rng.pick(["2:30", "2:45", "3:00"]),
  });
  const calls: [string, string, string[]][] = [
    [
      "vi",
      `Keep $${model}M on the title and offer ${mgr.first} the upside as a separate, labelled case`,
      [
        `Put "about $${ask}M" on the title as asked: it's ${mgr.first}'s call`,
        `Write "up to $${ask}M" so the bigger number is there but hedged`,
        `Go to the engagement partner first and report that ${mgr.first} is inflating the saving`,
      ],
    ],
    [
      "vc",
      `Check it against the source, send ${fa.first} a corrected table today saying what changed, and tell ${mgr.first} in case it reached the deck`,
      [
        `Fix your own copy quietly: ${fa.first} already has the right number`,
        `Reply that the figure came from ${client}'s own extract`,
        `Stop all work and ask ${mgr.first} to re-check every table you have sent`,
      ],
    ],
    [
      "vk",
      `Decline: client information stays inside the engagement, and let ${mgr.first} know someone asked`,
      [`Tell ${friend.first} only what's already rumoured in the market`, "Don't name sites, but say which region to watch", `Forward the message to ${od.first} so ${client} knows who's asking`],
    ],
    [
      "vl",
      `Say recommendations come from ${mgr.first} at the steering committee, and pass the question to ${mgr.first} today`,
      [`Reassure ${od.first}: no layoffs are planned`, `Share what the model shows for headcount so ${od.first} can plan`, `Don't reply, and ask ${mgr.first} to stop ${od.first} contacting you`],
    ],
    [
      "vt",
      `Tell ${sr.first} now, privately, with the corrected figure, so it's fixed before the meeting`,
      ["Fix the slide in the shared file yourself and say nothing", `Leave it: it's ${sr.first}'s section and there's no time`, `Reply-all to the team and ${mgr.first} pointing out the error`],
    ],
  ];
  const valuesKeys = Object.fromEntries(
    calls.map(([prefix, right, wrong], i) => {
      const { labels, letter } = placeOptions(rng, right, wrong);
      LETTERS.forEach((l, j) => (v[`${prefix}_${l}`] = labels[j]));
      return [VALUES[i].id, { correct: [letter] }];
    }),
  );

  // ---- Rapid rounds, drawn last so the rest of the material doesn't shift when they change ----
  const ctx: Ctx = { unit, units, Units: units_cap, towns: allTowns.slice(8) };
  const rapidKeys = {
    "rapid-numbers": { items: buildRound(rng, ctx, v, "rn", rng.shuffle([...NUMBERS_EASY, ...NUMBERS_EASY]), rng.shuffle([...NUMBERS_HARD, rng.pick(NUMBERS_HARD)]), 4) },
    "rapid-evidence": { items: buildRound(rng, ctx, v, "re", rng.shuffle([...EVIDENCE_EASY, ...EVIDENCE_EASY]), rng.shuffle([...EVIDENCE_HARD, rng.pick(EVIDENCE_HARD)]), 3) },
    "rapid-sense": { items: buildRound(rng, ctx, v, "rs", rng.shuffle([...SENSE_EASY, ...SENSE_EASY]), rng.shuffle(SENSE_HARD), 4) },
  };

  return {
    values: v,
    numbers: [...Object.values(sites.cells).map((c) => c.value), payback, net],
    keys: {
      ...rapidKeys,
      "site-analysis": { tolerance: 0, cells: sites.cells },
      "deck-check": { findings: deck.findings, decision: ["senior"] },
      "summary-order": { order: summaryOrder },
      payback: { value: payback, tolerance: 0.05, partialTolerance: 0.3 },
      "net-saving": { value: net, tolerance: 1000 },
      ...valuesKeys,
    },
    clearPayback: clear((oneTime * 12) / runRate, 1),
  };
}

export const analystCorvidOpsReview = defineScenario({
  slug: SLUG,
  version: 1,
  title: "Corvid Lane: operations review analyst",
  roleFamily: "consulting",
  timeLimitMinutes: 50,
  definition: DEFINITION,
  build(rng) {
    for (let tries = 0; tries < 300; tries++) {
      const out = buildOnce(rng);
      if (out && out.clearPayback && !leaks(out.values, out.numbers)) return { values: out.values, keys: out.keys };
    }
    throw new Error(`${SLUG}: every draw shows a computed answer`);
  },
});
