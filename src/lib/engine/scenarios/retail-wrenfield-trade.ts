import "server-only";

import type { Rng } from "../server/rng";
import { defineScenario } from "../server/scenario";
import { DOCUMENT_REVIEW } from "../step-types/document_review/public";
import { MULTIPLE_CHOICE } from "../step-types/multiple_choice/public";
import { ORDERING } from "../step-types/ordering/public";
import { RAPID_ROUND } from "../step-types/rapid_round/public";
import { SPREADSHEET } from "../step-types/spreadsheet/public";
import { addDays, distinctPeople, formatDate, isWeekend, pickDistinct, type IsoDate, type PersonName } from "./legal";

/**
 * Assistant buyer on a retailer's trainee scheme: a Monday at Wrenfield & Co.
 * (fictional), trade meeting at 11, autumn range on the water. Six timed
 * sections, 50 minutes, 100 points, all scored automatically:
 *
 *   rapid round A, retail maths (10) → trade report (20) → rapid round B,
 *   line actions against the card (10) → purchase orders vs. supplier
 *   confirmations (20) → rapid round C, pricing and promotions (10) → desk,
 *   one screen at a time: open-to-buy (12), critical path (8), five values
 *   calls (2 each).
 *
 * Seeded per candidate: the department and its lines, every name, number,
 * price, date and card threshold; which line or PO carries which trap; row
 * and option order. Prices are tax-exclusive throughout.
 *
 * Rapid rounds: 15 items x 20 s. Items 3, 6, 9, 12, 15 are the harder kinds,
 * worth 1; the other ten are worth 1/2, so each round is exactly 10.
 *
 * Draft v1: practitioner review pending (docs/retail/retail-wrenfield-trade.md).
 */

const TAG = "retail-wrenfield-trade";
const LETTERS = ["a", "b", "c", "d"] as const;

type Values = Record<string, string>;
type ChoiceKey = Record<string, { choice: string }>;

// ---- Formatting ----

const fmt = (n: number) => n.toLocaleString("en-US");
/** Cents → "$1,234.56". */
const money = (c: number) => `$${(c / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
/** Whole dollars → "$48,300" (or "-$4,800"). */
const dollars = (d: number) => `${d < 0 ? "-" : ""}$${fmt(Math.abs(d))}`;
const pct1 = (x: number) => `${x.toFixed(1)}%`;
const weeks1 = (x: number) => `${x.toFixed(1)} weeks`;
const units = (n: number) => `${fmt(n)} units`;
const r1 = (x: number) => Math.round(x * 10) / 10;
const r2 = (x: number) => Math.round(x * 100) / 100;
/** A whole number of `step` between lo and hi. */
const mult = (rng: Rng, lo: number, hi: number, step: number) => rng.int(Math.ceil(lo / step), Math.floor(hi / step)) * step;
/** A price in cents ending in .99, at least `minCents`. */
const ninetyNine = (minCents: number) => Math.ceil((minCents + 1) / 100) * 100 - 1;
const dateLabel = (d: IsoDate) => formatDate(d, "short");
/** Weekday on or before `d`. */
const weekdayBack = (d: IsoDate): IsoDate => (isWeekend(d) ? weekdayBack(addDays(d, -1)) : d);
const weekdayFwd = (d: IsoDate): IsoDate => (isWeekend(d) ? weekdayFwd(addDays(d, 1)) : d);

// ---- Rapid round plumbing ----

const RAPID_ITEMS = 15;
/** Items 3, 6, 9, 12 and 15 are worth 1; the rest 1/2. 10 points a round. */
const isHardSlot = (i: number) => i % 3 === 2;
const slotNo = (i: number) => String(i + 1).padStart(2, "0");

function fillSlots<T>(easy: T[], hard: T[]): T[] {
  const e = [...easy];
  const h = [...hard];
  const out = Array.from({ length: RAPID_ITEMS }, (_, i) => (isHardSlot(i) ? h.shift() : e.shift()));
  if (out.some((x) => x === undefined) || e.length || h.length) throw new Error(`${TAG}: rapid slots don't fill`);
  return out as T[];
}

const letterOptions = (name: string) => LETTERS.map((l) => ({ id: l, label: `{{${name}_${l}}}` }));

/** A rapid round with a fixed number of exhibit rows; everything on screen is a template. */
function rapidStep(id: string, title: string, intro: string, prefix: string, exhibitRows: number) {
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
            rows: Array.from({ length: exhibitRows }, (_, r) => ({ label: `{{${prefix}_${n}_l${r + 1}}}`, value: `{{${prefix}_${n}_v${r + 1}}}` })),
          },
          fields: [{ id: "answer", label: "Answer", kind: "choice", options: letterOptions(`${prefix}_${n}`) }],
          points: isHardSlot(i) ? 1 : 0.5,
        };
      }),
    },
  };
}

/** Puts `right` among `wrong` in a random place; returns the labels by letter and the right letter. */
function placeOptions(rng: Rng, right: string, wrong: string[]): { labels: string[]; letter: string } {
  if (wrong.length !== 3 || new Set([right, ...wrong]).size !== 4) throw new Error(`${TAG}: options must be 4 different labels (${right})`);
  const labels = rng.shuffle([right, ...wrong]);
  return { labels, letter: LETTERS[labels.indexOf(right)] };
}

/**
 * Three wrong numeric options, each at least `gap` from the right one and from
 * each other, positive, with distinct labels; null when the draw can't give three.
 */
function numericWrong(right: number, candidates: number[], gap: number, label: (n: number) => string): string[] | null {
  const out: number[] = [];
  for (const c of candidates) {
    if (!Number.isFinite(c) || c <= 0) continue;
    if (Math.abs(c - right) < gap || out.some((o) => Math.abs(o - c) < gap)) continue;
    out.push(c);
    if (out.length === 3) break;
  }
  if (out.length < 3) return null;
  const labels = out.map(label);
  return new Set([label(right), ...labels]).size === 4 ? labels : null;
}

interface RapidItemDraft {
  title: string;
  prompt: string;
  rows: [string, string][];
  right: string;
  wrong: string[];
}

/** Writes one item's values and returns its key. */
function writeItem(rng: Rng, v: Values, prefix: string, i: number, d: RapidItemDraft, rowsExpected: number): [string, ChoiceKey] {
  if (d.rows.length !== rowsExpected) throw new Error(`${TAG}: ${prefix} item needs ${rowsExpected} rows`);
  const n = slotNo(i);
  const { labels, letter } = placeOptions(rng, d.right, d.wrong);
  v[`${prefix}_${n}`] = d.prompt;
  v[`${prefix}_${n}_title`] = d.title;
  d.rows.forEach(([l, val], r) => {
    v[`${prefix}_${n}_l${r + 1}`] = l;
    v[`${prefix}_${n}_v${r + 1}`] = val;
  });
  LETTERS.forEach((l, j) => (v[`${prefix}_${n}_${l}`] = labels[j]));
  return [`${prefix}-${n}`, { answer: { choice: letter } }];
}

/** Retries a drawing function until it returns an item. */
function draw<T>(what: string, f: () => T | null): T {
  for (let tries = 0; tries < 5_000; tries++) {
    const x = f();
    if (x) return x;
  }
  throw new Error(`${TAG}: no ${what}`);
}

// ---- Departments (fictional lines; product types and tests per Wrenfield's compliance card) ----

interface ProductType {
  name: string;
  /** The test the compliance card requires before shipping; null when none is required. */
  test: string | null;
}
interface Dept {
  name: string;
  types: ProductType[];
  /** [noun, type index, price low $, price high $] */
  items: [string, number, number, number][];
}

const CPC = "and a Children's Product Certificate";
const DEPARTMENTS: Dept[] = [
  {
    name: "toys",
    types: [
      { name: "Plush toy", test: `ASTM F963 toy safety test at a CPSC-accepted lab ${CPC}` },
      { name: "Wooden toy", test: `ASTM F963 toy safety test at a CPSC-accepted lab ${CPC}` },
      { name: "Ride-on toy", test: `ASTM F963 toy safety test at a CPSC-accepted lab ${CPC}` },
      { name: "Adult jigsaw (14+)", test: null },
    ],
    items: [
      ["plush fox", 0, 14, 30],
      ["plush otter", 0, 12, 28],
      ["plush hare", 0, 10, 24],
      ["wooden train set", 1, 25, 60],
      ["stacking rings", 1, 12, 22],
      ["wooden play kitchen", 1, 80, 160],
      ["balance bike", 2, 60, 120],
      ["ride-on tractor", 2, 45, 90],
      ["1000-piece jigsaw", 3, 16, 30],
      ["500-piece jigsaw", 3, 12, 22],
    ],
  },
  {
    name: "small electricals",
    types: [
      { name: "Kettle", test: "Safety listing by a nationally recognized testing laboratory (UL or ETL)" },
      { name: "Toaster", test: "Safety listing by a nationally recognized testing laboratory (UL or ETL)" },
      { name: "Bluetooth speaker", test: "FCC Part 15 test report for a radio device" },
      { name: "USB cable", test: null },
    ],
    items: [
      ["glass kettle", 0, 30, 70],
      ["dome kettle", 0, 25, 60],
      ["2-slice toaster", 1, 25, 55],
      ["4-slice toaster", 1, 40, 90],
      ["mini speaker", 2, 20, 45],
      ["party speaker", 2, 60, 140],
      ["braided USB-C cable", 3, 8, 18],
      ["3-pack USB cables", 3, 10, 22],
      ["travel kettle", 0, 20, 40],
      ["long-slot toaster", 1, 45, 95],
    ],
  },
  {
    name: "homeware",
    types: [
      { name: "Stoneware dinnerware", test: "Lead and cadmium leach test (FDA ceramicware guidance)" },
      { name: "Stoneware mug", test: "Lead and cadmium leach test (FDA ceramicware guidance)" },
      { name: "Glazed serveware", test: "Lead and cadmium leach test (FDA ceramicware guidance)" },
      { name: "Cotton cushion", test: null },
    ],
    items: [
      ["dinner plate set", 0, 30, 70],
      ["pasta bowl set", 0, 25, 55],
      ["glazed mug", 1, 8, 16],
      ["espresso cup pair", 1, 10, 20],
      ["serving platter", 2, 25, 50],
      ["salad bowl", 2, 20, 45],
      ["cotton cushion", 3, 18, 40],
      ["linen-look cushion", 3, 22, 45],
      ["side plate set", 0, 20, 40],
      ["stacking mug set", 1, 18, 36],
    ],
  },
  {
    name: "outdoor clothing",
    types: [
      { name: "Kids' jacket", test: `CPSIA lead test and drawstring check (16 CFR 1120) ${CPC}` },
      { name: "Fleece", test: "Flammability test to 16 CFR 1610" },
      { name: "Rain jacket", test: "Flammability test to 16 CFR 1610" },
      { name: "Hiking socks", test: null },
    ],
    items: [
      ["kids' padded jacket", 0, 35, 70],
      ["kids' rain jacket", 0, 25, 50],
      ["half-zip fleece", 1, 25, 55],
      ["full-zip fleece", 1, 35, 70],
      ["packable rain jacket", 2, 40, 90],
      ["3-layer shell jacket", 2, 90, 200],
      ["merino hiking socks", 3, 14, 26],
      ["2-pack trail socks", 3, 10, 20],
      ["kids' fleece-lined jacket", 0, 40, 75],
      ["women's rain jacket", 2, 45, 95],
    ],
  },
  {
    name: "stationery",
    types: [
      { name: "Kids' art set", test: `ASTM D4236 art-material labeling review (LHAMA) ${CPC}` },
      { name: "Kids' pencil case", test: `CPSIA lead content and lead-in-paint test ${CPC}` },
      { name: "Kids' crayon pack", test: `ASTM D4236 art-material labeling review (LHAMA) ${CPC}` },
      { name: "Notebook", test: null },
    ],
    items: [
      ["kids' watercolor set", 0, 12, 28],
      ["kids' sketch kit", 0, 15, 35],
      ["zip pencil case", 1, 8, 16],
      ["double pencil case", 1, 10, 20],
      ["24-crayon pack", 2, 5, 12],
      ["jumbo crayon pack", 2, 6, 14],
      ["A5 dotted notebook", 3, 8, 18],
      ["linen hardback notebook", 3, 14, 28],
      ["kids' paint-by-numbers kit", 0, 14, 30],
      ["glitter pencil case", 1, 9, 18],
    ],
  },
];
const COLLECTIONS = ["Juniper", "Harbor", "Fernlea", "Alder", "Brookside", "Marlow", "Thistle", "Larkspur", "Bramble", "Saltash", "Wickham", "Cobble", "Hollin", "Mosswood"];
const SUPPLIERS = [
  "Tanglewood Trading Co.",
  "Bayside Sourcing Ltd.",
  "Northgate Manufacturing",
  "Silverbirch Imports",
  "Kestrel Bay Goods",
  "Pinecrest Products",
  "Larkhill Industries",
  "Copperleaf Supply Co.",
];
const STORES = ["Riverside", "Elm Street", "Northfield", "Harbor Point", "Westgate", "Old Mill", "Kingsbridge"];
const EVENTS = ["the baseball playoffs", "the season-opening football game", "a sold-out concert at the arena", "the tennis final", "the jazz festival's VIP night"];

interface LineDef {
  name: string;
  type: ProductType;
  lo: number;
  hi: number;
}
/** `n` distinct line names (collection + item) for a department. */
function drawLines(rng: Rng, dept: Dept, n: number): LineDef[] {
  const combos = dept.items.flatMap(([noun, t, lo, hi]) => COLLECTIONS.map((c) => ({ name: `${c} ${noun}`, type: dept.types[t], lo, hi })));
  const picked: LineDef[] = [];
  const usedCollections = new Map<string, number>();
  for (const c of rng.shuffle(combos)) {
    const coll = c.name.split(" ")[0];
    if ((usedCollections.get(coll) ?? 0) >= 3 || picked.some((p) => p.name === c.name)) continue;
    usedCollections.set(coll, (usedCollections.get(coll) ?? 0) + 1);
    picked.push(c);
    if (picked.length === n) return picked;
  }
  throw new Error(`${TAG}: not enough line names`);
}

// ---- Rapid round A: retail maths ----

type MathKind = "margin" | "markup" | "target" | "sellthrough" | "cover" | "promo" | "trend" | "markdown";
const MATH_EASY: MathKind[] = ["margin", "margin", "markup", "markup", "target", "target", "sellthrough", "sellthrough", "cover", "cover"];
const MATH_HARD_BASE: MathKind[] = ["promo", "trend", "markdown"];

const rapidMathStep = rapidStep(
  "rapid-retail-math",
  "Rapid round: retail maths",
  [
    "Retail maths: 15 items, 20 seconds each. Each exhibit shows the line's numbers and the rule from Wrenfield's trading card.",
    "Prices are tax-exclusive. Percentages to one decimal place.",
  ].join("\n"),
  "rm",
  5,
);

function buildMath(rng: Rng, v: Values, lines: LineDef[], avgWeeks: number): Record<string, ChoiceKey> {
  const hard = rng.shuffle([...MATH_HARD_BASE, ...pickDistinct(rng, MATH_HARD_BASE, 2)]);
  const kinds = fillSlots(rng.shuffle(MATH_EASY), hard);
  const coverCard = "Weeks of cover = on hand ÷ average weekly units";
  const avgCard = `Average of the last ${avgWeeks} weeks`;
  return Object.fromEntries(
    kinds.map((kind, i) => {
      const line = rng.pick(lines);
      const d = draw<RapidItemDraft>(kind, () => {
        const priceAround = () => ninetyNine(rng.int(line.lo * 100, line.hi * 100));
        if (kind === "margin" || kind === "markup") {
          const p = priceAround();
          const c = Math.round(p * (rng.int(30, 58) / 100)) + rng.int(-9, 9);
          const margin = (100 * (p - c)) / p;
          const markup = (100 * (p - c)) / c;
          const isMargin = kind === "margin";
          const right = isMargin ? margin : markup;
          const wrong = isMargin
            ? numericWrong(right, [markup, (100 * c) / p, right + 4, right - 4], 0.3, pct1)
            : numericWrong(right, [margin, (100 * p) / c, right + 10, right - 10], 0.3, pct1);
          if (!wrong) return null;
          return {
            title: "Line card",
            prompt: isMargin ? "What is the margin % on this line?" : "What is the markup % on this line?",
            rows: [
              ["Line", line.name],
              ["Cost price", money(c)],
              ["Selling price", money(p)],
              ["Prices", "Per unit, tax-exclusive"],
              ["Card", isMargin ? "Margin % = (selling price − cost) ÷ selling price" : "Markup % = (selling price − cost) ÷ cost"],
            ],
            right: pct1(right),
            wrong,
          };
        }
        if (kind === "target") {
          const c = rng.int(Math.round(line.lo * 30), Math.round(line.hi * 50));
          const m = rng.int(45, 66);
          const p = Math.round(c / (1 - m / 100));
          const wrong = numericWrong(p, [c * (1 + m / 100), c / (m / 100), p + 100, p - 100], 10, (x) => money(Math.round(x)));
          if (!wrong) return null;
          return {
            title: "New line pricing",
            prompt: "What selling price gives the target margin?",
            rows: [
              ["Line", line.name],
              ["Cost price", money(c)],
              ["Target margin", `${m}%`],
              ["Rounding", "To the cent, tax-exclusive"],
              ["Card", "Selling price = cost ÷ (1 − target margin)"],
            ],
            right: money(p),
            wrong,
          };
        }
        if (kind === "sellthrough") {
          const r = mult(rng, 240, 2400, 12);
          const s = Math.round(r * (rng.int(25, 80) / 100));
          const t = mult(rng, 24, Math.max(24, Math.floor((r - s) / 3)), 6);
          const oh = r - s - t;
          if (oh <= 0) return null;
          const right = (100 * s) / (s + oh);
          const wrong = numericWrong(right, [(100 * s) / r, (100 * s) / oh, (100 * oh) / (s + oh)], 0.3, pct1);
          if (!wrong) return null;
          return {
            title: `Season to date · ${line.name}`,
            prompt: "What is this line's sell-through %?",
            rows: [
              ["Units received", fmt(r)],
              ["Units sold (net of returns)", fmt(s)],
              ["Sent to the outlet store", fmt(t)],
              ["Units on hand", fmt(oh)],
              ["Card", "Sell-through % = units sold ÷ (units sold + units on hand)"],
            ],
            right: pct1(right),
            wrong,
          };
        }
        if (kind === "cover") {
          const total = rng.int(20, 400) * avgWeeks;
          const avg = total / avgWeeks;
          const oh = Math.round(avg * (rng.int(15, 140) / 10)) + rng.int(0, 9);
          const right = oh / avg;
          const wrong = numericWrong(right, [avg / oh, oh / total, right + 1, right - 1], 0.3, weeks1);
          if (!wrong || right < 1) return null;
          return {
            title: `Stock position · ${line.name}`,
            prompt: "How many weeks of cover does this line have?",
            rows: [
              ["Units on hand", fmt(oh)],
              [`Units sold, last ${avgWeeks} weeks`, fmt(total)],
              ["Card: average weekly units", avgCard],
              ["Card: cover", coverCard],
              ["Line", line.name],
            ],
            right: weeks1(right),
            wrong,
          };
        }
        if (kind === "trend") {
          const start = rng.int(40, 400);
          const step = Math.max(4, Math.round(start * (rng.int(6, 18) / 100))) * (rng.next() < 0.5 ? 1 : -1);
          const wk = Array.from({ length: 6 }, (_, j) => start + j * step);
          if (wk.some((x) => x < 10)) return null;
          const lastN = wk.slice(6 - avgWeeks);
          const avg = lastN.reduce((a, b) => a + b, 0) / avgWeeks;
          const oh = Math.round(avg * (rng.int(20, 120) / 10));
          const right = oh / avg;
          const avgAll = wk.reduce((a, b) => a + b, 0) / 6;
          const firstN = wk.slice(0, avgWeeks).reduce((a, b) => a + b, 0) / avgWeeks;
          const wrong = numericWrong(right, [oh / avgAll, oh / wk[5], oh / firstN, oh / wk[0]], 0.3, weeks1);
          if (!wrong) return null;
          return {
            title: `Stock position · ${line.name}`,
            prompt: "How many weeks of cover does this line have, on the card's average?",
            rows: [
              ["Units on hand", fmt(oh)],
              ["Weekly units, wk 3 to wk 8", wk.map(fmt).join(" · ")],
              ["Card: average weekly units", avgCard],
              ["Card: cover", coverCard],
              ["Line", line.name],
            ],
            right: weeks1(right),
            wrong,
          };
        }
        if (kind === "promo") {
          const p = priceAround();
          const off = rng.pick([20, 25, 30, 40]);
          const pp = Math.round(p * (1 - off / 100));
          const c = Math.round(pp * (rng.int(30, 60) / 100));
          const f = Math.round(((p - pp) * rng.int(20, 60)) / 100);
          if (f < 10) return null;
          const right = (100 * (pp - (c - f))) / pp;
          const wrong = numericWrong(right, [(100 * (pp - c)) / pp, (100 * (p - c + f)) / p, (100 * (pp + f - c)) / (pp + f), (100 * (p - c)) / p], 0.3, pct1);
          if (!wrong) return null;
          return {
            title: `Promotion · ${line.name}`,
            prompt: "What is Wrenfield's margin % on a unit sold at the promotional price?",
            rows: [
              ["Regular price", money(p)],
              ["Promotional price", `${money(pp)} (${off}% off)`],
              ["Cost price", money(c)],
              ["Supplier funding", `${money(f)} per unit sold on promotion`],
              ["Card", "Margin % = (price charged − net cost) ÷ price charged; supplier funding reduces net cost"],
            ],
            right: pct1(right),
            wrong,
          };
        }
        // markdown to a price point
        const o = priceAround();
        const d1 = rng.pick([20, 25, 30]);
        const cur = Math.round(o * (1 - d1 / 100));
        const t = ninetyNine(Math.round(cur * (rng.int(55, 85) / 100))) - 100;
        if (t <= 100 || t >= cur) return null;
        const right = (100 * (cur - t)) / cur;
        const fromOriginal = (100 * (o - t)) / o;
        const wrong = numericWrong(right, [fromOriginal, (100 * (cur - t)) / t, fromOriginal - d1, right + d1], 0.3, pct1);
        if (!wrong) return null;
        return {
          title: `Markdown · ${line.name}`,
          prompt: "What further markdown, as a % off the current ticket, takes the line to the target price point?",
          rows: [
            ["Original price", money(o)],
            ["Current ticket", `${money(cur)} (${d1}% off original)`],
            ["Target price point", money(t)],
            ["Line", line.name],
            ["Card", "Markdown % = (current ticket − new price) ÷ current ticket"],
          ],
          right: pct1(right),
          wrong,
        };
      });
      return writeItem(rng, v, "rm", i, d, 5);
    }),
  );
}

// ---- Section 1: trade report ----

const TR_LINES = 12;
const TR_WEEKS = 8;
/** Rows (0-based) whose sell-through and cover the candidate enters; fixed for the version. */
const TR_INPUT_ROWS = [0, 1, 3, 4, 6, 7, 9, 10];
const trId = (row: number) => `l${String(row + 1).padStart(2, "0")}`;
const ST_TOL = 0.011;
const COVER_TOL = 0.06;

const TRADING_CARD = [
  "Wrenfield trading card:",
  "• Units sold are net of customer returns. Returned units go back into stock and are already in on hand.",
  "• Sell-through % = units sold ÷ (units sold + units on hand).",
  "• Weeks on sale count the week the line went on sale: a line on sale from wk 6 has 3 weeks on sale by the end of wk 8.",
  "• Average weekly units = units sold ÷ weeks on sale. Weeks of cover = units on hand ÷ average weekly units.",
  "• Margin % = (sales − cost of sales) ÷ sales, at the prices actually charged; cost of sales = units sold × cost.",
  "• Sell-through and margin to two decimals (for example 62.37); weeks of cover to one decimal (for example 4.3).",
].join("\n");

const tradeReportStep = {
  id: "trade-report",
  type: SPREADSHEET,
  title: "Trade report: season to date",
  config: {
    prompt: [
      "Season to date, weeks 1 to 8, {{dept}}. Enter sell-through % and weeks of cover for the eight lines with boxes, then the department's margin % and sell-through % over all twelve lines.",
      "{{tr_note}}",
      "",
      TRADING_CARD,
    ].join("\n"),
    columns: ["Line", "On sale from", "Received", "Units sold", "Customer returns", "On hand", "Cost", "Price", "Sell-through %", "Weeks of cover"],
    rows: [
      ...Array.from({ length: TR_LINES }, (_, row) => {
        const n = row + 1;
        const input = TR_INPUT_ROWS.includes(row);
        const right = (k: string) => ({ text: `{{tr_${n}_${k}}}`, align: "right" });
        return [
          `{{tr_${n}_line}}`,
          `{{tr_${n}_from}}`,
          right("rec"),
          right("sold"),
          right("ret"),
          right("oh"),
          right("cost"),
          right("price"),
          input ? { input: `${trId(row)}_st`, label: `Row ${n}: sell-through %`, format: "number", points: 1 } : null,
          input ? { input: `${trId(row)}_cov`, label: `Row ${n}: weeks of cover`, format: "number", points: 1 } : null,
        ];
      }),
      [{ text: "Department margin % (all twelve lines)", bold: true }, null, null, null, null, null, null, null, { input: "dept_margin", label: "Department margin %", format: "number", points: 2 }, null],
      [{ text: "Department sell-through % (all twelve lines)", bold: true }, null, null, null, null, null, null, null, { input: "dept_st", label: "Department sell-through %", format: "number", points: 2 }, null],
    ],
  },
};

interface TrLine {
  def: LineDef;
  from: number;
  weeks: number;
  rec: number;
  net: number;
  ret: number;
  oh: number;
  cost: number;
  price: number;
}

function buildTradeReport(rng: Rng, v: Values, lines: LineDef[], store: string) {
  return draw("trade report", () => {
    const rows: TrLine[] = lines.map((def) => {
      const price = ninetyNine(rng.int(def.lo * 100, def.hi * 100));
      const cost = Math.round(price * (rng.int(32, 55) / 100));
      const rec = mult(rng, 240, 1800, 12);
      const net = Math.round(rec * (rng.int(18, 82) / 100));
      return { def, from: 1, weeks: TR_WEEKS, rec, net, ret: 0, oh: rec - net, cost, price };
    });
    // Mid-period launches: one row with boxes, and sometimes one without.
    const inputRows = rng.shuffle(TR_INPUT_ROWS);
    const lateRow = inputRows[0];
    const adjustRow = inputRows[1];
    const lateRows = [lateRow];
    if (rng.next() < 0.5) lateRows.push(rng.pick([2, 5, 8, 11]));
    for (const r of lateRows) {
      rows[r].from = rng.int(4, 6);
      rows[r].weeks = TR_WEEKS - rows[r].from + 1;
    }
    // Customer returns on three to five rows with boxes and some without.
    const returnRows = [...inputRows.slice(2, 2 + rng.int(3, 5)), ...[2, 5, 8, 11].filter(() => rng.next() < 0.5)];
    for (const r of returnRows) rows[r].ret = Math.max(3, Math.round(rows[r].net * (rng.int(4, 12) / 100)));
    // The promotion note.
    const promoRow = rng.int(0, TR_LINES - 1);
    const pr = rows[promoRow];
    const off = rng.pick([20, 25, 30]);
    const promoPrice = Math.round(pr.price * (1 - off / 100));
    const promoUnits = Math.round(pr.net * (rng.int(20, 50) / 100));
    const promoFrom = rng.int(pr.from, TR_WEEKS - 1);
    // The store count adjustment (arrives at minute 4).
    const adj = Math.max(6, Math.round(rows[adjustRow].oh * (rng.int(8, 25) / 100)));
    if (rows[adjustRow].oh - adj < 12) return null;

    const ohAfter = (r: number) => rows[r].oh - (r === adjustRow ? adj : 0);
    const st = (net: number, oh: number) => (100 * net) / (net + oh);
    const cover = (oh: number, net: number, weeks: number) => oh / (net / weeks);

    const cells: Record<string, { value: number; tolerance: number }> = {};
    const traps: boolean[] = [];
    for (const r of TR_INPUT_ROWS) {
      const x = rows[r];
      const oh = ohAfter(r);
      const s = st(x.net, oh);
      const c = cover(oh, x.net, x.weeks);
      if (c < 0.5 || c > 60) return null;
      cells[`${trId(r)}_st`] = { value: r2(s), tolerance: ST_TOL };
      cells[`${trId(r)}_cov`] = { value: r2(c), tolerance: COVER_TOL };
      // Each trap must move the answer by more than the tolerance.
      const gross = x.net + x.ret;
      if (x.ret) traps.push(Math.abs(st(gross, oh) - s) > 0.05, Math.abs(cover(oh, gross, x.weeks) - c) > 0.15);
      if (x.weeks !== TR_WEEKS) traps.push(Math.abs(cover(oh, x.net, TR_WEEKS) - c) > 0.15);
      if (r === adjustRow) traps.push(Math.abs(st(x.net, x.oh) - s) > 0.05, Math.abs(cover(x.oh, x.net, x.weeks) - c) > 0.15);
    }
    const sumNet = rows.reduce((t, x) => t + x.net, 0);
    const sumOh = rows.reduce((t, _, r) => t + ohAfter(r), 0);
    const deptSt = (100 * sumNet) / (sumNet + sumOh);
    const sales = rows.reduce((t, x, r) => t + (r === promoRow ? (x.net - promoUnits) * x.price + promoUnits * promoPrice : x.net * x.price), 0);
    const cos = rows.reduce((t, x) => t + x.net * x.cost, 0);
    const deptMargin = (100 * (sales - cos)) / sales;
    const salesNoPromo = rows.reduce((t, x) => t + x.net * x.price, 0);
    traps.push(
      Math.abs((100 * (salesNoPromo - cos)) / salesNoPromo - deptMargin) > 0.05,
      Math.abs((100 * sumNet) / (sumNet + sumOh + adj) - deptSt) > 0.03,
    );
    if (traps.some((ok) => !ok)) return null;
    cells.dept_margin = { value: r2(deptMargin), tolerance: ST_TOL };
    cells.dept_st = { value: r2(deptSt), tolerance: ST_TOL };

    rows.forEach((x, r) => {
      const n = r + 1;
      v[`tr_${n}_line`] = x.def.name;
      v[`tr_${n}_from`] = `Wk ${x.from}`;
      v[`tr_${n}_rec`] = fmt(x.rec);
      v[`tr_${n}_sold`] = fmt(x.net + x.ret);
      v[`tr_${n}_ret`] = fmt(x.ret);
      v[`tr_${n}_oh`] = fmt(x.oh);
      v[`tr_${n}_cost`] = money(x.cost);
      v[`tr_${n}_price`] = money(x.price);
    });
    v.tr_note = `Note: ${pr.def.name} was on promotion at ${money(promoPrice)} (${off}% off) from wk ${promoFrom}; ${fmt(promoUnits)} of its units sold were at the promotional price, the rest at the full price shown.`;
    v.adj_line = rows[adjustRow].def.name;
    v.adj_units = fmt(adj);
    v.adj_store = store;
    return { cells, adjustRow, lateRow };
  });
}

// ---- Rapid round B: line actions ----

type ActionKind = "reorder" | "markdown" | "hold" | "cancel" | "lead" | "edge_st" | "edge_weeks" | "water_hold" | "water_markdown";
const ACTION_EASY: ActionKind[] = ["reorder", "reorder", "reorder", "markdown", "markdown", "markdown", "hold", "hold", "cancel", "cancel"];
const ACTION_HARD: ActionKind[] = ["lead", "edge_st", "edge_weeks", "water_hold", "water_markdown"];
const ACTIONS = { reorder: "Reorder", markdown: "Mark down", hold: "Hold", cancel: "Cancel the open order" } as const;

const rapidActionsStep = rapidStep(
  "rapid-actions",
  "Rapid round: line actions",
  [
    "Line actions: 15 lines, 20 seconds each. Pick the action Wrenfield's action card calls for; the card is on every exhibit.",
    "Check the card in order: markdown first (or cancel the open order instead, if it hasn't shipped), then reorder, otherwise hold.",
  ].join("\n"),
  "ra",
  6,
);

interface ActionCard {
  mdWeeks: number;
  mdSt: number;
  safety: number;
}
/** The card's decision, written independently of how the item was drawn. */
function actionFor(card: ActionCard, x: { weeks: number; st: number; cover: number; order: "none" | "water" | "unshipped"; orderWeeks: number; lead: number }) {
  if (x.weeks >= card.mdWeeks && x.st < card.mdSt) return x.order === "unshipped" ? "cancel" : "markdown";
  if (x.cover + x.orderWeeks < x.lead + card.safety) return "reorder";
  return "hold";
}

function buildActions(rng: Rng, v: Values, lines: LineDef[], card: ActionCard): Record<string, ChoiceKey> {
  const kinds = fillSlots(rng.shuffle(ACTION_EASY), rng.shuffle(ACTION_HARD));
  const cardText = `Mark down: on sale ${card.mdWeeks}+ weeks and sell-through below ${card.mdSt}% (cancel the open order instead if it hasn't shipped). Reorder: cover including stock on order below lead time + ${card.safety} weeks. Otherwise hold.`;
  const expected: Record<ActionKind, keyof typeof ACTIONS> = {
    reorder: "reorder",
    markdown: "markdown",
    hold: "hold",
    cancel: "cancel",
    lead: "reorder",
    edge_st: "hold",
    edge_weeks: "hold",
    water_hold: "hold",
    water_markdown: "markdown",
  };
  return Object.fromEntries(
    kinds.map((kind, i) => {
      const line = rng.pick(lines);
      const x = draw(kind, () => {
        const lead = rng.int(6, 14);
        const low = card.mdSt - rng.int(4, 18) - rng.int(0, 9) / 10;
        const high = card.mdSt + rng.int(4, 30) + rng.int(0, 9) / 10;
        let weeks = rng.int(card.mdWeeks + 1, card.mdWeeks + 8);
        let st = high;
        let cover = 0;
        let order: "none" | "water" | "unshipped" = "none";
        let orderWeeks = 0;
        const healthy = () => r1(lead + card.safety + rng.int(10, 60) / 10);
        const short = () => r1(Math.max(0.5, lead + card.safety - rng.int(15, 60) / 10));
        // Easy reorders are plainly short (under 4 weeks); the lead-time items look healthy on cover alone.
        if (kind === "reorder") cover = r1(rng.int(5, 35) / 10);
        else if (kind === "markdown") [st, cover] = [low, healthy()];
        else if (kind === "hold") {
          cover = healthy();
          if (rng.next() < 0.4) [order, orderWeeks] = ["water", r1(rng.int(10, 40) / 10)];
        } else if (kind === "cancel") [st, cover, order, orderWeeks] = [low, healthy(), "unshipped", r1(rng.int(20, 60) / 10)];
        else if (kind === "lead") cover = r1(rng.int(Math.max(4, lead - 5), lead - 1) + rng.int(0, 9) / 10);
        else if (kind === "edge_st") [st, cover] = [card.mdSt, healthy()];
        else if (kind === "edge_weeks") [weeks, st, cover] = [card.mdWeeks - 1, low, healthy()];
        else if (kind === "water_hold") {
          cover = short();
          orderWeeks = r1(lead + card.safety - cover + rng.int(5, 40) / 10);
          order = "water";
        } else [st, cover, order, orderWeeks] = [low, healthy(), "water", r1(rng.int(20, 60) / 10)];
        if (st <= 2 || st >= 98 || cover <= 0) return null;
        const item = { weeks, st, cover, order, orderWeeks, lead };
        const got = actionFor(card, item);
        if (got !== expected[kind]) return null;
        // Lead-time items must look healthy on cover alone; edge and water items sit near a line.
        if (kind === "lead" && cover < 4) return null;
        return item;
      });
      const onOrder =
        x.order === "none"
          ? "None"
          : `${weeks1(x.orderWeeks)} of stock, ${x.order === "water" ? "shipped (on the water)" : "not yet shipped"}`;
      const right = ACTIONS[expected[kind]];
      const d: RapidItemDraft = {
        title: line.name,
        prompt: "What does the action card say to do with this line?",
        rows: [
          ["Weeks on sale", String(x.weeks)],
          ["Sell-through", `${x.st.toFixed(1)}%`],
          ["Cover on hand", weeks1(x.cover)],
          ["On order", onOrder],
          ["Supplier lead time", `${x.lead} weeks`],
          ["Action card", cardText],
        ],
        right,
        wrong: Object.values(ACTIONS).filter((a) => a !== right),
      };
      return writeItem(rng, v, "ra", i, d, 6);
    }),
  );
}
// ---- Section 2: purchase orders vs. supplier confirmations ----

type PoRole = "dup1" | "dup2" | "cost" | "qty" | "late" | "carton" | "cert" | "ok_ondate" | "ok_rounding" | "ok_notreq" | "ok_certarrived" | "ok_split";
const PO_ROLES: PoRole[] = ["dup1", "dup2", "cost", "qty", "late", "carton", "cert", "ok_ondate", "ok_rounding", "ok_notreq", "ok_certarrived", "ok_split"];
const PO_ROWS = PO_ROLES.length;
const PO_COLS = ["po", "sup", "line", "type", "ord", "conf", "carton", "agreed", "confcost", "dc", "cert"] as const;

const poStep = {
  id: "po-check",
  type: DOCUMENT_REVIEW,
  title: "Autumn POs vs. supplier confirmations",
  config: {
    prompt: [
      "Check each autumn purchase order against the supplier's confirmation, the critical path, the supplier terms and the compliance card (all in the header).",
      "Flag each problem with its reason, then decide what you'll do before the trade meeting.",
    ].join("\n"),
    document: {
      title: "Autumn range · PO confirmation check · {{dept}}",
      fields: [
        { id: "launch", label: "Range launch", value: "In stores {{launch}}" },
        { id: "latest", label: "Critical path", value: "Latest delivery to the distribution centre (DC): {{latest_dc}}. Delivery on that date is on time." },
        { id: "terms_cost", label: "Supplier terms §4", value: "Confirmed cost must equal the agreed cost. A difference of up to $0.01 a unit from currency rounding is accepted." },
        { id: "terms_qty", label: "Supplier terms §5", value: "Confirmed quantity must equal the ordered quantity. Orders are placed in whole cartons (carton size per line)." },
        { id: "compliance", label: "Compliance card", value: "{{compliance_card}}. No shipment of a product type that needs a test until its certificate is on file." },
      ],
      columns: ["PO", "Supplier", "Line", "Product type", "Ordered", "Confirmed", "Carton", "Agreed cost", "Confirmed cost", "Delivery to DC", "Test certificate"],
      rows: Array.from({ length: PO_ROWS }, (_, i) => ({
        id: `po${i + 1}`,
        cells: PO_COLS.map((c) => `{{po_${i + 1}_${c}}}`),
      })),
      totals: [],
    },
    reasons: [
      { id: "cost", label: "Confirmed cost isn't the agreed cost" },
      { id: "qty", label: "Confirmed quantity isn't the ordered quantity" },
      { id: "late", label: "Delivery after the latest DC date" },
      { id: "carton", label: "Quantity isn't whole cartons" },
      { id: "cert", label: "Test certificate missing for a product type that needs one" },
      { id: "duplicate", label: "Same order raised twice" },
      { id: "other", label: "Other" },
    ],
    findings: [
      { id: "cost_diff", label: "Confirmed cost differs from the agreed cost", points: 3 },
      { id: "qty_diff", label: "Confirmed quantity differs from the order", points: 3 },
      { id: "late_delivery", label: "Delivery after the latest DC date", points: 3 },
      { id: "not_carton", label: "Order quantity not a whole number of cartons", points: 3 },
      { id: "no_certificate", label: "Test certificate missing for a product type that needs one", points: 3 },
      { id: "duplicate", label: "The same order raised twice", points: 3 },
    ],
    falseFlagPenalty: 1,
    decision: { prompt: "The trade meeting is at 11. What do you do with these confirmations?", options: letterOptions("po_dec"), points: 2 },
  },
};

interface PoRow {
  role: PoRole;
  po: number;
  sup: string;
  line: LineDef;
  ord: number;
  conf: number;
  carton: number;
  agreed: number;
  confcost: number;
  dc: IsoDate;
  cert: string;
}

function buildPo(rng: Rng, v: Values, dept: Dept, lines: LineDef[], suppliers: string[], latest: IsoDate) {
  const needing = lines.filter((l) => l.type.test);
  const notNeeding = lines.filter((l) => !l.type.test);
  if (needing.length < 9 || notNeeding.length < 1) return null;
  const pool = [...rng.shuffle(needing)];
  const take = () => pool.shift()!;
  const lineFor: Partial<Record<PoRole, LineDef>> = {};
  lineFor.cert = take();
  lineFor.ok_certarrived = take();
  lineFor.ok_notreq = rng.pick(notNeeding);
  const rest = rng.shuffle([...pool, ...notNeeding.filter((l) => l !== lineFor.ok_notreq)]);
  for (const role of ["dup1", "cost", "qty", "late", "carton", "ok_ondate", "ok_rounding"] as PoRole[]) lineFor[role] = rest.shift()!;
  lineFor.dup2 = lineFor.dup1;
  lineFor.ok_split = lineFor.ok_ondate;

  const base = (role: PoRole): PoRow => {
    const line = lineFor[role]!;
    const carton = rng.pick([6, 8, 12, 24, 36, 48]);
    const ord = carton * rng.int(Math.ceil(120 / carton), Math.floor(3000 / carton));
    const agreed = Math.round(rng.int(line.lo * 100, line.hi * 100) * (rng.int(30, 50) / 100));
    const dc = weekdayBack(addDays(latest, -rng.int(3, 24)));
    return { role, po: 0, sup: rng.pick(suppliers), line, ord, conf: ord, carton, agreed, confcost: agreed, dc, cert: line.type.test ? "On file" : "—" };
  };
  const rows = new Map<PoRole, PoRow>();
  for (const role of PO_ROLES) {
    if (role === "dup2" || role === "ok_split") continue;
    const r = base(role);
    if (role === "cost") r.confcost = r.agreed + rng.int(6, 75) * (rng.next() < 0.8 ? 1 : -1);
    if (role === "ok_rounding") r.confcost = r.agreed + (rng.next() < 0.5 ? 1 : -1);
    if (role === "qty") r.conf = r.ord - r.carton * rng.int(1, 6);
    if (role === "late") r.dc = weekdayFwd(addDays(latest, rng.int(1, 9)));
    if (role === "ok_ondate") r.dc = latest;
    if (role === "carton") {
      if (r.carton === 6) r.carton = 12;
      r.ord = r.carton * rng.int(Math.ceil(120 / r.carton), Math.floor(3000 / r.carton)) + rng.int(1, r.carton - 1);
      r.conf = r.ord;
    }
    if (role === "cert" || role === "ok_certarrived" || role === "ok_notreq") r.cert = "Not received";
    rows.set(role, r);
  }
  rows.set("dup2", { ...rows.get("dup1")!, role: "dup2" });
  const ondate = rows.get("ok_ondate")!;
  const split = base("ok_split");
  rows.set("ok_split", { ...split, sup: ondate.sup, carton: ondate.carton, agreed: ondate.agreed, confcost: ondate.agreed, ord: ondate.carton * rng.int(10, 60), conf: 0, dc: weekdayBack(addDays(latest, -rng.int(10, 30))) });
  rows.get("ok_split")!.conf = rows.get("ok_split")!.ord;
  if (rows.get("ok_split")!.ord === ondate.ord || rows.get("qty")!.conf <= 0) return null;

  // Rows in PO-number order; which role sits where is seeded.
  const order = rng.shuffle(PO_ROLES);
  let po = rng.int(451_000, 458_000);
  const placed = order.map((role) => {
    po += rng.int(3, 60);
    return { ...rows.get(role)!, po };
  });
  placed.forEach((r, i) => {
    const n = i + 1;
    const set = (k: (typeof PO_COLS)[number], val: string) => (v[`po_${n}_${k}`] = val);
    set("po", String(r.po));
    set("sup", r.sup);
    set("line", r.line.name);
    set("type", r.line.type.name);
    set("ord", fmt(r.ord));
    set("conf", fmt(r.conf));
    set("carton", String(r.carton));
    set("agreed", money(r.agreed));
    set("confcost", money(r.confcost));
    set("dc", dateLabel(r.dc));
    set("cert", r.cert);
  });
  const idOf = (role: PoRole) => `po${placed.findIndex((r) => r.role === role) + 1}`;
  const row = (role: PoRole) => placed.find((r) => r.role === role)!;
  const typesNeeding = dept.types.filter((t) => t.test);
  v.compliance_card = [
    ...typesNeeding.map((t) => `${t.name}: ${t.test}`),
    ...dept.types.filter((t) => !t.test).map((t) => `${t.name}: no test required`),
  ].join("; ");
  v.cert_ok_po = String(row("ok_certarrived").po);
  v.cert_ok_line = row("ok_certarrived").line.name;
  v.cert_po = String(row("cert").po);
  v.cert_line = row("cert").line.name;
  v.cert_type = row("cert").line.type.name;
  v.cert_test = row("cert").line.type.test!;
  v.cert_sup = row("cert").sup;
  const findings = {
    cost_diff: { targets: [idOf("cost")], reasons: ["cost"], note: `PO ${row("cost").po}: confirmed at ${money(row("cost").confcost)} a unit against ${money(row("cost").agreed)} agreed.` },
    qty_diff: { targets: [idOf("qty")], reasons: ["qty"], note: `PO ${row("qty").po}: ${fmt(row("qty").conf)} confirmed against ${fmt(row("qty").ord)} ordered.` },
    late_delivery: { targets: [idOf("late")], reasons: ["late"], note: `PO ${row("late").po}: DC delivery ${dateLabel(row("late").dc)}, after the latest date ${dateLabel(latest)}.` },
    not_carton: { targets: [idOf("carton")], reasons: ["carton"], note: `PO ${row("carton").po}: ${fmt(row("carton").ord)} units isn't a whole number of ${row("carton").carton}-unit cartons.` },
    no_certificate: { targets: [idOf("cert")], reasons: ["cert"], note: `PO ${row("cert").po}: ${row("cert").line.type.name} needs a certificate before shipping and none is on file.` },
    duplicate: { targets: [idOf("dup1"), idOf("dup2")], reasons: ["duplicate"], note: `POs ${row("dup1").po} and ${row("dup2").po} are the same order for ${row("dup1").line.name}.` },
  };
  return { findings, certRow: row("cert") };
}

// ---- Rapid round C: pricing and promotions ----

type PriceKind = "md_margin" | "units_keep" | "multibuy" | "ladder" | "split_margin" | "split_cash" | "split_units";
const PRICE_EASY: PriceKind[] = ["md_margin", "md_margin", "md_margin", "units_keep", "units_keep", "units_keep", "multibuy", "multibuy", "ladder", "ladder"];
const PRICE_HARD_BASE: PriceKind[] = ["split_margin", "split_cash", "split_units"];
const LADDER = [499, 699, 799, 999, 1299, 1499, 1999, 2499, 2999, 3499, 3999, 4999, 5999, 7999, 9999, 12999, 14999];
const FUNDING_SHARES = [25, 30, 40, 60, 70, 75];

const rapidPricingStep = rapidStep(
  "rapid-pricing",
  "Rapid round: pricing and promotions",
  [
    "Pricing and promotions: 15 items, 20 seconds each. Each exhibit has the prices and the card rule you need.",
    "Prices are tax-exclusive. Where supplier funding is a share of the discount, the discount is ticket price less promotional price.",
  ].join("\n"),
  "rp",
  5,
);

function buildPricing(rng: Rng, v: Values, lines: LineDef[]): Record<string, ChoiceKey> {
  const hard = rng.shuffle([...PRICE_HARD_BASE, ...pickDistinct(rng, PRICE_HARD_BASE, 2)]);
  const kinds = fillSlots(rng.shuffle(PRICE_EASY), hard);
  const marginCard = "Margin % = (selling price − cost) ÷ selling price";
  return Object.fromEntries(
    kinds.map((kind, i) => {
      const line = rng.pick(lines);
      const d = draw<RapidItemDraft>(kind, () => {
        const p = ninetyNine(rng.int(Math.max(500, line.lo * 100), line.hi * 100));
        if (kind === "md_margin") {
          const off = rng.pick([20, 25, 30, 40, 50]);
          const np = Math.round(p * (1 - off / 100));
          const c = Math.round(np * (rng.int(30, 75) / 100));
          const right = (100 * (np - c)) / np;
          const wrong = numericWrong(right, [(100 * (p - c)) / p - off, (100 * (np - c)) / p, (100 * (np - c)) / c, (100 * (p - c)) / p], 0.3, pct1);
          if (!wrong) return null;
          return {
            title: `Markdown · ${line.name}`,
            prompt: "What margin % does the line make after the markdown?",
            rows: [
              ["Cost price", money(c)],
              ["Ticket price", money(p)],
              ["Markdown", `${off}% off the ticket`],
              ["Line", line.name],
              ["Card", marginCard],
            ],
            right: pct1(right),
            wrong,
          };
        }
        if (kind === "units_keep") {
          const off = rng.pick([10, 15, 20, 25, 30]);
          const np = Math.round(p * (1 - off / 100));
          const c = Math.round(np * (rng.int(30, 70) / 100));
          const u = rng.int(20, 400);
          const right = Math.ceil((u * (p - c)) / (np - c));
          const wrong = numericWrong(right, [Math.ceil((u * p) / np), Math.ceil(u * (1 + off / 100)), Math.ceil((u * (p - c)) / (p - np)), right + Math.ceil(u / 4)], 2, (x) => units(Math.round(x)));
          if (!wrong) return null;
          return {
            title: `Price cut · ${line.name}`,
            prompt: "How many units a week must it sell at the new price to keep the same weekly cash margin?",
            rows: [
              ["Cost price", money(c)],
              ["Ticket price", money(p)],
              ["New price", `${money(np)} (${off}% off)`],
              ["Units a week at the ticket price", fmt(u)],
              ["Card", "Cash margin = units × (price − cost); round units up"],
            ],
            right: units(right),
            wrong,
          };
        }
        if (kind === "multibuy") {
          const threeForTwo = rng.next() < 0.5;
          const y = threeForTwo ? 2 * p : Math.round(3 * p * (rng.int(60, 85) / 100) / 100) * 100;
          const x = rng.pick([15, 20, 25, 30, 35, 40, 45]);
          const saveA = 3 * p - y;
          const saveB = (3 * p * x) / 100;
          if (Math.abs(saveA - saveB) < 0.03 * 3 * p) return null;
          const options = ["Deal A", "Deal B", "They save the same", "It depends on the cost price"];
          return {
            title: `Promotion choice · ${line.name}`,
            prompt: "Which deal gives a customer buying three the bigger saving?",
            rows: [
              ["Ticket price", `${money(p)} each`],
              ["Deal A", threeForTwo ? "3 for 2" : `3 for ${money(y)}`],
              ["Deal B", `${x}% off each`],
              ["Basket", "A customer buying three"],
              ["Card", "Compare the saving on the three units"],
            ],
            right: saveA > saveB ? options[0] : options[1],
            wrong: saveA > saveB ? [options[1], options[2], options[3]] : [options[0], options[2], options[3]],
          };
        }
        if (kind === "ladder") {
          const idx = rng.int(5, LADDER.length - 1);
          const tp = LADDER[idx];
          const off = rng.pick([20, 25, 30, 40, 50]);
          const np = Math.round(tp * (1 - off / 100));
          const below = LADDER.filter((x) => x <= np);
          if (below.length < 2 || LADDER.includes(np)) return null;
          const right = below[below.length - 1];
          const up = LADDER.find((x) => x > np)!;
          const down = below[below.length - 2];
          const lo = Math.max(0, LADDER.indexOf(down) - 1);
          const shown = LADDER.slice(lo, Math.min(LADDER.length, Math.max(idx + 1, lo + 6)));
          return {
            title: `Price ladder · ${line.name}`,
            prompt: "Which ladder price does the line move to?",
            rows: [
              ["Ticket price", money(tp)],
              ["Markdown", `${off}% off`],
              ["Price ladder", shown.map(money).join(" · ")],
              ["Line", line.name],
              ["Card", "Land on the highest ladder price at or below the marked-down price"],
            ],
            right: money(right),
            wrong: [money(up), money(np), money(down)],
          };
        }
        // Supplier-funded promotions: funding is a share of the discount.
        const off = rng.pick([20, 25, 30, 40]);
        const pp = Math.round(p * (1 - off / 100));
        const c = Math.round(pp * (rng.int(40, 75) / 100));
        const s = rng.pick(FUNDING_SHARES);
        const disc = p - pp;
        const netCost = (share: number) => c - (share * disc) / 100;
        const rows: [string, string][] = [
          ["Ticket price", money(p)],
          ["Promotional price", `${money(pp)} (${off}% off)`],
          ["Cost price", money(c)],
          ["Funding", `Supplier funds ${s}% of the discount; Wrenfield funds the rest`],
        ];
        if (kind === "split_margin") {
          const right = (100 * (pp - netCost(s))) / pp;
          const wrong = numericWrong(right, [(100 * (pp - c)) / pp, (100 * (pp - netCost(100 - s))) / pp, (100 * (pp - netCost(100))) / pp, (100 * (pp - (c - (s * pp) / 100))) / pp], 0.3, pct1);
          if (!wrong) return null;
          return {
            title: `Funded promotion · ${line.name}`,
            prompt: "What is Wrenfield's margin % on a unit sold at the promotional price?",
            rows: [...rows, ["Card", "Net cost = cost − supplier's share of the discount; margin on the price charged"]],
            right: pct1(right),
            wrong,
          };
        }
        if (kind === "split_cash") {
          const cash = (share: number) => Math.round(pp - netCost(share));
          const right = cash(s);
          const wrong = numericWrong(right, [cash(0), cash(100 - s), cash(100), right + Math.round(disc / 2)], 10, (x) => money(Math.round(x)));
          if (!wrong || pp - c <= 0) return null;
          return {
            title: `Funded promotion · ${line.name}`,
            prompt: "What cash margin does Wrenfield make on each unit sold at the promotional price?",
            rows: [...rows, ["Card", "Cash margin per unit = price charged − (cost − supplier's share of the discount)"]],
            right: money(right),
            wrong,
          };
        }
        // split_units
        const u = rng.int(20, 300);
        if (pp - c <= 0) return null;
        // In hundredths of a cent so the share of the discount stays whole.
        const keep = (share: number) => Math.ceil((u * (p - c) * 100) / ((pp - c) * 100 + share * disc));
        const right = keep(s);
        const wrong = numericWrong(right, [keep(0), keep(100 - s), Math.ceil((u * p) / pp), keep(100)], 2, (x) => units(Math.round(x)));
        if (!wrong) return null;
        return {
          title: `Funded promotion · ${line.name}`,
          prompt: `It sells ${fmt(u)} units a week at the ticket price. How many a week must it sell on promotion to keep the same weekly cash margin?`,
          rows: [
            [rows[0][0], `${rows[0][1]} · ${fmt(u)} units a week`],
            rows[1],
            rows[2],
            rows[3],
            ["Card", "Cash margin = units × (price − net cost); net cost = cost − supplier's share of the discount; round units up"],
          ],
          right: units(right),
          wrong,
        };
      });
      return writeItem(rng, v, "rp", i, d, 5);
    }),
  );
}

// ---- Desk: open-to-buy ----

const MONTHS = ["sep", "oct", "nov"] as const;
const MONTH_LABELS = ["Sep", "Oct", "Nov"];
const OTB_ROWS = ["sales", "md", "close", "open", "oo"] as const;
const OTB_ROW_LABELS = ["Planned sales", "Planned markdowns", "Planned closing stock", "Opening stock", "On order"];

const otbStep = {
  id: "open-to-buy",
  type: SPREADSHEET,
  seconds: 240,
  title: "Open-to-buy: autumn quarter",
  config: {
    prompt: [
      "Work out open-to-buy for each month and for the quarter, in dollars at retail value. A negative number means the department is over-bought.",
      "Card: open-to-buy = planned sales + planned markdowns + planned closing stock − opening stock − on order.",
      "Read {{merch_first}}'s email first: one change to on order isn't in the plan yet.",
    ].join("\n"),
    columns: ["", ...MONTH_LABELS, "Quarter"],
    rows: [
      ...OTB_ROWS.map((r, i) => [OTB_ROW_LABELS[i], ...MONTHS.map((m) => ({ text: `{{otb_${m}_${r}}}`, align: "right" })), ""]),
      [
        { text: "Open-to-buy", bold: true },
        ...MONTHS.map((m, i) => ({ input: `otb_${m}`, label: `Open-to-buy: ${MONTH_LABELS[i]}`, format: "money", points: 3 })),
        { input: "otb_quarter", label: "Open-to-buy: quarter", format: "money", points: 3 },
      ],
    ],
  },
};

function buildOtb(rng: Rng, v: Values) {
  return draw("open-to-buy", () => {
    let open = mult(rng, 280_000, 720_000, 100);
    const cancelMonth = rng.int(0, 2);
    const cancelled = mult(rng, 12_000, 60_000, 100);
    const cells: Record<string, { value: number; tolerance: number }> = {};
    let quarter = 0;
    for (let i = 0; i < 3; i++) {
      const sales = mult(rng, 120_000, 340_000, 100);
      const md = Math.round((sales * rng.int(4, 14)) / 100 / 100) * 100;
      const close = mult(rng, open * 0.7, open * 1.3, 100);
      const oo = mult(rng, 40_000, 320_000, 100) + (i === cancelMonth ? cancelled : 0);
      const otb = sales + md + close - open - (oo - (i === cancelMonth ? cancelled : 0));
      const m = MONTHS[i];
      Object.assign(v, {
        [`otb_${m}_sales`]: dollars(sales),
        [`otb_${m}_md`]: dollars(md),
        [`otb_${m}_close`]: dollars(close),
        [`otb_${m}_open`]: dollars(open),
        [`otb_${m}_oo`]: dollars(oo),
      });
      cells[`otb_${m}`] = { value: otb, tolerance: 0.5 };
      quarter += otb;
      open = close;
    }
    cells.otb_quarter = { value: quarter, tolerance: 0.5 };
    if (Object.values(cells).some((c) => c.value === 0)) return null;
    v.otb_cancel_month = MONTH_LABELS[cancelMonth];
    v.otb_cancelled = dollars(cancelled);
    return { cells };
  });
}

// ---- Desk: critical path ----

const CP_IDS = ["cp-a", "cp-b", "cp-c", "cp-d", "cp-e", "cp-f", "cp-g", "cp-h"];
const criticalPathStep = {
  id: "critical-path",
  type: ORDERING,
  seconds: 150,
  title: "Critical path for the buyer's deck",
  config: {
    prompt: "Put the critical path for {{cert_line}} ({{cert_type}}) in order, from sample approval to on shelf.",
    items: CP_IDS.map((id) => ({ id, label: `{{${id.replace("-", "_")}}}` })),
    positionPoints: 3,
    pairwisePoints: 5,
  },
};

function buildCriticalPath(rng: Rng, v: Values, test: string, latest: IsoDate, launch: IsoDate) {
  const steps = [
    "Approve the design sample",
    "Raise the purchase order at the agreed cost",
    "Approve the pre-production sample",
    "Bulk production",
    `Compliance test on production units: ${test}; certificate on file`,
    "Ship from the factory",
    `Delivered to the distribution centre (latest ${dateLabel(latest)})`,
    `On shelf in stores for launch (${dateLabel(launch)})`,
  ];
  // Which step sits on which id is seeded, and never the key order itself.
  let ids = rng.shuffle(CP_IDS);
  while (ids.every((id, i) => id === CP_IDS[i])) ids = rng.shuffle(CP_IDS);
  ids.forEach((id, i) => (v[id.replace("-", "_")] = steps[i]));
  return { order: ids };
}

// ---- Desk: values calls ----

function valuesStep(tag: string, prefix: string, title: string, prompt: string) {
  return {
    id: `values-${tag}`,
    type: MULTIPLE_CHOICE,
    seconds: 66,
    title: `Judgment: ${title}`,
    config: { prompt, options: letterOptions(prefix), select: "single", points: 2 },
  };
}
const valuesIntegrity = valuesStep("integrity", "vi", "supplier hospitality", "{{am_first}} is offering tickets before the range review. What do you do?");
const valuesCandor = valuesStep("candor", "vc", "your keying error", "{{merch_first}} has found your keying error on PO {{cand_po}}. What do you do?");
const valuesClientCare = valuesStep("client-care", "vk", "a competitor's quote", "{{am2_first}} wants to know what another supplier quoted. What do you do?");
const valuesInLane = valuesStep("in-lane", "vl", "a cost increase by phone", "{{am_first}} wants you to agree a cost increase on a call. What do you do?");
const valuesQuality = valuesStep("quality", "vq", "shipping without a certificate", "{{am_first}} wants to ship PO {{cert_po}} before the certificate is on file. What do you do?");

/** Writes a values call's options in seeded order; returns its key. */
function buildValues(rng: Rng, v: Values, prefix: string, right: string, wrong: [string, string, string]) {
  const { labels, letter } = placeOptions(rng, right, wrong);
  LETTERS.forEach((l, j) => (v[`${prefix}_${l}`] = labels[j]));
  return { correct: [letter] };
}

// ---- Definition ----

const DEFINITION = {
  intro:
    "You're an assistant buyer on Wrenfield & Co.'s trainee scheme, in the {{dept}} department. It's Monday {{today}}: the trade meeting is at 11 and the autumn range is on the water. The work comes in six timed parts, 50 minutes in all: three rapid rounds (retail maths, line actions, pricing), a trade report, a check of purchase orders against supplier confirmations, and a desk with the open-to-buy, the critical path and your inbox. A finished part can't be reopened. Wrenfield, its suppliers and the people are fictional. Prices are tax-exclusive; sales tax is left out throughout.",
  steps: [
    rapidMathStep,
    tradeReportStep,
    rapidActionsStep,
    poStep,
    rapidPricingStep,
    otbStep,
    criticalPathStep,
    valuesIntegrity,
    valuesCandor,
    valuesClientCare,
    valuesInLane,
    valuesQuality,
  ],
  messages: [
    {
      id: "m-welcome",
      from: "Your buyer",
      subject: "Trade meeting at 11",
      body: [
        "Morning {{first_name}},",
        "",
        "Big one today. Trade meeting at 11 with the merchandising director, and the autumn {{dept}} range is on the water, launching {{launch}}. I need you sharp on the numbers: {{merch_first}} has the trade report for you, I've got the autumn POs to check, and there'll be pricing questions for the promotions plan.",
        "",
        "Start with a quick warm-up on the maths. The rule on every card is Wrenfield's; use it even where you learned it differently.",
        "",
        "{{buyer}}",
      ].join("\n"),
      arriveAtMinute: 0,
      stepId: "rapid-retail-math",
    },
    {
      id: "m-trade",
      from: "Merchandiser",
      subject: "Trade report for 11",
      body: [
        "Hi {{first_name}},",
        "",
        "Season-to-date report for {{dept}} is in the sheet. Can you fill in sell-through and cover for the eight lines with boxes, plus department margin and sell-through? {{buyer_first}} will read them out at 11, so please use the card rules exactly: units sold net of returns, weeks on sale from the launch week, and the promo note for margin.",
        "",
        "{{merch}}",
      ].join("\n"),
      arriveAtMinute: 0,
      stepId: "trade-report",
    },
    {
      id: "m-adjust",
      from: "Store operations lead",
      subject: "Stock adjustment: {{adj_line}}",
      body: [
        "Hi {{first_name}},",
        "",
        "Weekend count at {{adj_store}}: {{adj_units}} units of {{adj_line}} were damaged in the stockroom and have been written off. They're still in the on-hand figure on your report, so please take them off before it goes to the meeting.",
        "",
        "Thanks,",
        "{{ops}}",
      ].join("\n"),
      arriveAtMinute: 4,
      stepId: "trade-report",
    },
    {
      id: "m-actions",
      from: "Merchandiser",
      subject: "Line actions before the meeting",
      body: [
        "Hi {{first_name}},",
        "",
        "Quick run through the action list. Our action card this season: mark down a line on sale {{md_weeks}}+ weeks with sell-through below {{md_st}}% (cancel the open order instead if it hasn't shipped); reorder when cover including stock on order is below lead time plus {{safety}} weeks; otherwise hold. It's on every exhibit too.",
        "",
        "{{merch}}",
      ].join("\n"),
      arriveAtMinute: 0,
      stepId: "rapid-actions",
    },
    {
      id: "m-po",
      from: "Your buyer",
      subject: "Autumn POs: check the confirmations",
      body: [
        "{{first_name}},",
        "",
        "The supplier confirmations for the autumn POs are in. Check every line against what we ordered, the supplier terms, the critical path ({{latest_dc}} at the DC at the latest) and the compliance card. Flag anything wrong, and tell me what you'll do before 11. Please don't agree any changes with suppliers yourself.",
        "",
        "{{buyer}}",
      ].join("\n"),
      arriveAtMinute: 0,
      stepId: "po-check",
    },
    {
      id: "m-cert",
      from: "Supplier account manager",
      subject: "Certificate for PO {{cert_ok_po}}",
      body: [
        "Hi {{first_name}},",
        "",
        "Good news: the lab certificate for PO {{cert_ok_po}} ({{cert_ok_line}}) came through this morning and I've uploaded it to your portal, so it's on file now.",
        "",
        "Best,",
        "{{am}}, {{supplier}}",
      ].join("\n"),
      arriveAtMinute: 4,
      stepId: "po-check",
    },
    {
      id: "m-pricing",
      from: "Your buyer",
      subject: "Promotions plan",
      body: [
        "{{first_name}},",
        "",
        "Before 11 I want to sanity-check the promotions plan: markdowns, price ladders, multibuys and the supplier-funded deals. Quick answers, please; the card rule is on each one.",
        "",
        "{{buyer}}",
      ].join("\n"),
      arriveAtMinute: 0,
      stepId: "rapid-pricing",
    },
    {
      id: "m-otb",
      from: "Merchandiser",
      subject: "Open-to-buy for the autumn quarter",
      body: [
        "Hi {{first_name}},",
        "",
        "Can you work out open-to-buy for Sep, Oct and Nov and the quarter? One thing: the {{otb_cancel_month}} on-order figure still includes the {{otb_cancelled}} order we cancelled on Friday, so take it out.",
        "",
        "{{merch}}",
      ].join("\n"),
      arriveAtMinute: 0,
      stepId: "open-to-buy",
    },
    {
      id: "m-cp",
      from: "Your buyer",
      subject: "Critical path slide",
      body: [
        "{{first_name}},",
        "",
        "For the deck: put the critical path for {{cert_line}} in order, sample approval to on shelf. It's the one with the certificate question, so I want the compliance step in the right place.",
        "",
        "{{buyer}}",
      ].join("\n"),
      arriveAtMinute: 0,
      stepId: "critical-path",
    },
    {
      id: "m-integrity",
      from: "Supplier account manager",
      subject: "Tickets for {{event_day}}",
      body: [
        "Hi {{first_name}},",
        "",
        "We've got a box for {{event}} on {{event_day}} and two seats with your name on them: about {{ticket_value}} a ticket, dinner included. {{buyer_first}}'s invited too. With the range review next week, it'd be a great chance to talk through our autumn lines!",
        "",
        "{{am}}, {{supplier}}",
        "",
        "(Wrenfield gifts and hospitality policy: gifts or hospitality up to {{gift_limit}} may be accepted and must be logged; nothing may be accepted from a supplier during a live negotiation or range review.)",
      ].join("\n"),
      arriveAtMinute: 0,
      stepId: "values-integrity",
    },
    {
      id: "m-candor",
      from: "Merchandiser",
      subject: "PO {{cand_po}} quantity",
      body: [
        "Hi {{first_name}},",
        "",
        "Spotted something on PO {{cand_po}} for {{cand_line}}: it went in on Friday for {{cand_wrong}} units, but the buy plan says {{cand_right}}. Looks like a zero too many, and the keying log has your login on it. {{supplier}} haven't confirmed it yet.",
        "",
        "{{merch}}",
      ].join("\n"),
      arriveAtMinute: 0,
      stepId: "values-candor",
    },
    {
      id: "m-client-care",
      from: "Account manager, another supplier",
      subject: "Quote for {{cc_line}}",
      body: [
        "Hi {{first_name}},",
        "",
        "Before we finalise our quote for {{cc_line}}: what did {{supplier}} come in at? If you can share their number, I'm confident we can beat it, and we'd all win.",
        "",
        "{{am2}}, {{supplier2}}",
        "",
        "(Wrenfield supplier terms §9: quotes and cost prices from any supplier are confidential to Wrenfield.)",
      ].join("\n"),
      arriveAtMinute: 0,
      stepId: "values-client-care",
    },
    {
      id: "m-in-lane",
      from: "Supplier account manager",
      subject: "Cost on {{il_line}}",
      body: [
        "Hi {{first_name}},",
        "",
        "Raw material costs have jumped, so we need {{il_inc}} a unit more on {{il_line}} from the next production run. The factory needs a yes today to keep production moving, and {{buyer_first}}'s out all afternoon. Can you just agree it on a quick call? I'll ring you at 2.",
        "",
        "{{am}}, {{supplier}}",
        "",
        "(Supplier terms §4: cost changes are agreed only in writing and approved by the buyer.)",
      ].join("\n"),
      arriveAtMinute: 0,
      stepId: "values-in-lane",
    },
    {
      id: "m-quality",
      from: "Supplier account manager",
      subject: "PO {{cert_po}}: ship Friday?",
      body: [
        "Hi {{first_name}},",
        "",
        "{{cert_line}} (PO {{cert_po}}) is packed and ready. The lab says the certificate ({{cert_test}}) won't be issued until {{cert_ready}}. If we don't load on Friday we miss your DC date of {{latest_dc}}, and {{buyer_first}} told us last week the launch date is non-negotiable. {{buyer_first}}'s on a flight until tomorrow, so can you okay shipping now? We'll send the certificate as soon as it's issued.",
        "",
        "{{am}}, {{supplier}}",
      ].join("\n"),
      arriveAtMinute: 0,
      stepId: "values-quality",
    },
  ],
  sections: [
    { id: "s-rapid-a", title: "Rapid round: retail maths", minutes: 6, stepIds: ["rapid-retail-math"] },
    { id: "s-work-1", title: "Trade report", minutes: 10, stepIds: ["trade-report"] },
    { id: "s-rapid-b", title: "Rapid round: line actions", minutes: 6, stepIds: ["rapid-actions"] },
    { id: "s-work-2", title: "Purchase order check", minutes: 10, stepIds: ["po-check"] },
    { id: "s-rapid-c", title: "Rapid round: pricing and promotions", minutes: 6, stepIds: ["rapid-pricing"] },
    {
      id: "s-desk",
      title: "Desk and inbox",
      minutes: 12,
      stepIds: ["open-to-buy", "critical-path", "values-integrity", "values-candor", "values-client-care", "values-in-lane", "values-quality"],
      oneAtATime: true,
    },
  ],
};

// ---- Leak guard ----

/**
 * The candidate's screen must not show a computed spreadsheet answer in any
 * form the leak tests read (62.37, 6237 as cents, 1,234.56). Units and dollars
 * on screen carry commas and no decimals, so most can't match; a percentage or
 * cover can collide with a price by chance, so the generator draws again.
 */
const STATIC_TEXT = JSON.stringify(DEFINITION);
function leakForms(value: number): RegExp[] {
  const forms = [JSON.stringify(value), value.toFixed(2), String(Math.round(value * 100)), value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })];
  return [...new Set(forms)].filter((f) => !/^\d{1,3}$/.test(f)).map((s) => new RegExp(`(?<![\\d.,])${s.replace(/[.$]/g, "\\$&")}(?![\\d.]\\d)`));
}
function leaks(values: Values, numbers: number[]): boolean {
  const text = `${STATIC_TEXT}\n${Object.values(values).join("\n")}`;
  return numbers.some((n) => Math.abs(n) >= 1 && leakForms(n).some((re) => re.test(text)));
}

// ---- Generator ----

function buildOnce(rng: Rng) {
  const v: Values = {};
  const dept = rng.pick(DEPARTMENTS);
  const [pBuyer, pMerch, pOps, pAm, pAm2] = distinctPeople(rng, 5);
  const [supplier, supplier2, supplier3] = pickDistinct(rng, SUPPLIERS, 3);
  const store = rng.pick(STORES);
  // A Monday in spring or early summer 2027; launch 9 to 12 weeks out.
  const today = addDays("2027-03-01", 7 * rng.int(0, 16));
  const launch = addDays(today, 7 * rng.int(9, 12) + rng.int(0, 3));
  const latest = weekdayBack(addDays(launch, -rng.int(14, 24)));
  const name = (k: string, p: PersonName) => Object.assign(v, { [k]: p.full, [`${k}_first`]: p.first });
  name("buyer", pBuyer);
  name("merch", pMerch);
  name("ops", pOps);
  name("am", pAm);
  name("am2", pAm2);
  Object.assign(v, {
    dept: dept.name,
    supplier,
    supplier2,
    today: dateLabel(today),
    launch: dateLabel(launch),
    latest_dc: dateLabel(latest),
  });

  // PO lines need ten different lines: nine whose type needs a test and one whose type doesn't.
  const allLines = draw("lines", () => {
    const l = drawLines(rng, dept, 30);
    const po = l.slice(TR_LINES);
    return po.filter((x) => x.type.test).length >= 9 && po.some((x) => !x.type.test) ? l : null;
  });
  const trLines = allLines.slice(0, TR_LINES);
  const otherLines = allLines.slice(TR_LINES);
  const avgWeeks = rng.pick([3, 4]);
  const card: ActionCard = { mdWeeks: rng.int(4, 6), mdSt: rng.pick([35, 40, 45, 50]), safety: rng.int(1, 3) };
  Object.assign(v, { md_weeks: String(card.mdWeeks), md_st: String(card.mdSt), safety: String(card.safety) });

  const math = buildMath(rng, v, allLines, avgWeeks);
  const tr = buildTradeReport(rng, v, trLines, store);
  const actions = buildActions(rng, v, allLines, card);
  const po = draw("PO check", () => buildPo(rng, v, dept, otherLines, [supplier, supplier3], latest));
  const pricing = buildPricing(rng, v, allLines);
  const otb = buildOtb(rng, v);
  const cp = buildCriticalPath(rng, v, po.certRow.line.type.test!, latest, launch);

  // Values calls: surrounding facts are seeded; the right option sits anywhere.
  const giftLimit = rng.pick([25, 50, 75, 100]);
  const ticketValue = giftLimit + mult(rng, 75, 400, 5);
  Object.assign(v, {
    event: rng.pick(EVENTS),
    event_day: dateLabel(addDays(today, rng.int(3, 5))),
    ticket_value: dollars(ticketValue),
    gift_limit: dollars(giftLimit),
  });
  const candLine = rng.pick(otherLines);
  const candRight = mult(rng, 120, 960, 12);
  Object.assign(v, {
    cand_po: String(rng.int(459_000, 462_000)),
    cand_line: candLine.name,
    cand_right: fmt(candRight),
    cand_wrong: fmt(candRight * 10),
    cc_line: rng.pick(otherLines).name,
    il_line: rng.pick(otherLines).name,
    il_inc: money(rng.int(8, 95)),
    cert_ready: dateLabel(addDays(latest, rng.int(2, 9))),
  });

  const keys = {
    "rapid-retail-math": { items: math },
    "trade-report": { tolerance: 0, cells: tr.cells },
    "rapid-actions": { items: actions },
    "po-check": {
      findings: po.findings,
      decision: [
        buildValues(rng, v, "po_dec", `Query the supplier in writing on every flagged PO and send ${pBuyer.first} the lines that put the launch at risk`, [
          "Approve the POs as they are and sort out the differences when the goods reach the DC",
          "Cancel every PO with a problem so nothing wrong arrives",
          "Phone the suppliers and agree new costs, quantities and dates on the call to save time",
        ]).correct[0],
      ],
    },
    "rapid-pricing": { items: pricing },
    "open-to-buy": { tolerance: 0, cells: otb.cells },
    "critical-path": cp,
    "values-integrity": buildValues(
      rng,
      v,
      "vi",
      `Decline politely, citing the policy (the range review is live and the tickets are over ${dollars(giftLimit)}), and log the offer`,
      [
        `Accept, and pay ${supplier} back the amount above ${dollars(giftLimit)} so it stays inside the limit`,
        `Accept: ${pBuyer.first} is invited too, so the business is clearly fine with it`,
        `Report ${pAm.first} to compliance for attempted bribery and stop replying to ${supplier}`,
      ],
    ),
    "values-candor": buildValues(
      rng,
      v,
      "vc",
      `Thank ${pMerch.first}, tell ${pBuyer.first} now, and get the PO amended to ${fmt(candRight)} units in writing before ${supplier} confirms it`,
      [
        "Amend the PO quietly before anyone else notices; there's no need to mention it",
        `Tell ${pMerch.first} the system must have added the zero and ask IT to look into it`,
        `Cancel the whole ${candLine.name} buy until the buy plan has been approved again`,
      ],
    ),
    "values-client-care": buildValues(rng, v, "vk", `Tell ${pAm2.first} other suppliers' quotes are confidential, and ask for ${supplier2}'s best price on its own merits`, [
      `Give a rough figure without naming ${supplier}: it gets Wrenfield a better price`,
      `Forward ${supplier}'s quote so ${pAm2.first} knows exactly what to beat`,
      `Remove ${supplier2} from the tender for asking`,
    ]),
    "values-in-lane": buildValues(rng, v, "vl", `Don't agree on the call: ask ${pAm.first} to put the increase in writing and pass it to ${pBuyer.first}, who approves cost changes`, [
      "Agree it on the call: it's a small increase and production has to keep moving",
      `Say yes now, since ${pBuyer.first} would surely agree, and confirm it by email afterwards`,
      `Refuse any increase and tell ${pAm.first} the order will be cancelled if it's raised again`,
    ]),
    "values-quality": buildValues(
      rng,
      v,
      "vq",
      `Hold the shipment until the certificate is on file; tell ${pAm.first} in writing, and tell ${pBuyer.first} today that the delivery is at risk for launch`,
      [
        "Let it ship and chase the certificate before the goods reach the DC",
        `Ask ${pAm.first} for last season's certificate from a similar product so the file isn't empty`,
        `Cancel PO ${po.certRow.po} so the launch plan stays clean`,
      ],
    ),
  };

  const numbers = [...Object.values(tr.cells), ...Object.values(otb.cells)].map((c) => c.value);
  return { values: v, keys, numbers };
}

export const retailWrenfieldTrade = defineScenario({
  slug: TAG,
  version: 1,
  title: "Wrenfield & Co.: assistant buyer",
  roleFamily: "retail",
  timeLimitMinutes: 50,
  definition: DEFINITION,

  build(rng) {
    for (let tries = 0; tries < 200; tries++) {
      const { values, numbers, keys } = buildOnce(rng);
      if (!leaks(values, numbers)) return { values, keys };
    }
    throw new Error(`${TAG}: every draw shows a spreadsheet answer`);
  },
});
