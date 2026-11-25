import "server-only";

import type { Rng } from "../server/rng";
import { defineScenario } from "../server/scenario";
import { DOCUMENT_REVIEW } from "../step-types/document_review/public";
import { MULTIPLE_CHOICE } from "../step-types/multiple_choice/public";
import { RAPID_ROUND } from "../step-types/rapid_round/public";
import { SPREADSHEET } from "../step-types/spreadsheet/public";
import { addDays, daysBetween, distinctPeople, formatDate, isLegalHoliday, pickDistinct, weekdayOf, type IsoDate, type PersonName } from "./legal";

/**
 * Bank analyst programme, commercial credit: the annual renewal and line
 * increase for an operating company at Stonebridge Community Bank (fictional).
 * Six timed sections, 50 minutes, 100 points, all scored automatically:
 *
 *   ratio flash (10) → the spread: FY2, FY3, interim, pro forma and leverage
 *   (20) → covenant calls (10) → the draft credit memo against the file (20)
 *   → borrowing base rapid round (10) → desk, one screen at a time: borrowing
 *   base certificate (10), risk rating (5), lead risk (5), five values calls (2
 *   each).
 *
 * Seeded per candidate: the borrower (four industries), every person and
 * company, every figure and date, the bank's policy limits, which period holds
 * the one-time gain, whether the interim is annualised, which memo row carries
 * which problem, the borrower's certificate errors, and where every right
 * option sits. Statements tie on every seed (assets = liabilities + equity;
 * net income less distributions flows to members' equity).
 *
 * Rapid rounds: 15 items × 20 s; items 3, 6, 9, 12 and 15 are the harder kinds,
 * worth 1; the other ten are worth ½.
 *
 * Draft v1: practitioner review pending (docs/banking/banking-stonebridge-renewal.md).
 */

const LETTERS = ["a", "b", "c", "d"] as const;
const BANK = "Stonebridge Community Bank";

type Values = Record<string, string>;
type ChoiceKey = Record<string, { choice: string }>;

const fmt = (n: number) => n.toLocaleString("en-US");
const usd = (n: number) => `$${fmt(n)}`;
const r2 = (x: number) => Number(x.toFixed(2));
const xLabel = (x: number) => `${x.toFixed(2)}x`;
const pct1 = (a: number, b: number) => `${((100 * a) / b).toFixed(1)}%`;
const days = (a: number, b: number) => `${Math.round((365 * a) / b)} days`;
/** A whole number of `step` between lo and hi. */
const mult = (rng: Rng, lo: number, hi: number, step: number) => rng.int(Math.ceil(lo / step), Math.floor(hi / step)) * step;
/** A fraction drawn in thousandths between lo and hi. */
const frac = (rng: Rng, lo: number, hi: number) => rng.int(Math.round(lo * 1000), Math.round(hi * 1000)) / 1000;

// ---- Dates ----

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const iso = (y: number, m: number, d: number): IsoDate => new Date(Date.UTC(y, m - 1, d)).toISOString().slice(0, 10);
/** Last day of month m (1-12) of year y. */
const monthEnd = (y: number, m: number): IsoDate => new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
/** "Jun 30, 2027": a period end, written as it is on statements. */
const periodLabel = (d: IsoDate) => `${MONTHS[Number(d.slice(5, 7)) - 1]} ${Number(d.slice(8, 10))}, ${d.slice(0, 4)}`;
function addMonths(d: IsoDate, n: number): IsoDate {
  const y = Number(d.slice(0, 4));
  const m = Number(d.slice(5, 7)) - 1 + n;
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m, Math.min(Number(d.slice(8, 10)), last))).toISOString().slice(0, 10);
}
function nextWeekday(d: IsoDate, weekday: number): IsoDate {
  let x = d;
  while (weekdayOf(x) !== weekday || isLegalHoliday(x)) x = addDays(x, 1);
  return x;
}
function businessDayNear(d: IsoDate): IsoDate {
  let x = d;
  while (weekdayOf(x) === 0 || weekdayOf(x) === 6 || isLegalHoliday(x)) x = addDays(x, 1);
  return x;
}

// ---- Pools (all fictional) ----

interface Industry {
  what: string;
  borrowers: [string, string][];
  revenue: [number, number];
  gm: [number, number];
  inventory: [number, number];
  gainAssets: string[];
  realEstate: string;
  equipment: string;
  revision: string;
  orderItem: string;
}

const INDUSTRIES: Industry[] = [
  {
    what: "an HVAC contractor",
    borrowers: [
      ["Ridgeline Comfort Systems", "Ridgeline Air"],
      ["Bellwether Mechanical Services", "Bellwether Heating & Cooling"],
      ["Copperline Mechanical", "Copperline Heating & Air"],
    ],
    revenue: [9_000, 22_000],
    gm: [0.26, 0.33],
    inventory: [0.04, 0.08],
    gainAssets: ["a service van", "a used mini excavator", "two older service trucks"],
    realEstate: "shop and office building",
    equipment: "service vehicles and tools",
    revision: "the technicians' bonus accrual",
    orderItem: "six new service vans",
  },
  {
    what: "a food manufacturer",
    borrowers: [
      ["Hollis Creek Foods", "Hollis Creek Kitchen"],
      ["Marrow Lane Provisions", "Marrow Lane Pies"],
      ["Tidewell Baking Company", "Tidewell Bread"],
    ],
    revenue: [12_000, 30_000],
    gm: [0.22, 0.3],
    inventory: [0.08, 0.14],
    gainAssets: ["an old packaging line", "a refrigerated trailer", "a spare oven line"],
    realEstate: "production plant",
    equipment: "packaging and baking lines",
    revision: "a freight invoice for the period",
    orderItem: "a second packaging line",
  },
  {
    what: "a regional distributor",
    borrowers: [
      ["Granite Bay Supply", "Granite Bay Industrial"],
      ["Northfork Distribution", "Northfork Supply"],
      ["Kestrel Point Wholesale", "Kestrel Point Supply"],
    ],
    revenue: [15_000, 40_000],
    gm: [0.17, 0.23],
    inventory: [0.1, 0.16],
    gainAssets: ["a forklift fleet it replaced", "a delivery truck", "a vacant lot next to the warehouse"],
    realEstate: "main distribution center",
    equipment: "forklifts, racking and delivery trucks",
    revision: "a volume rebate owed to a customer",
    orderItem: "new racking and four forklifts",
  },
  {
    what: "a dental group",
    borrowers: [
      ["Brightwater Dental Partners", "Brightwater Dental"],
      ["Juniper Family Dental", "Juniper Smiles"],
      ["Larkspur Dental Associates", "Larkspur Dental"],
    ],
    revenue: [6_000, 16_000],
    gm: [0.36, 0.45],
    inventory: [0.01, 0.02],
    gainAssets: ["a panoramic X-ray unit", "a closed office's chairs and equipment", "a practice vehicle"],
    realEstate: "Main Street clinic building",
    equipment: "dental chairs, imaging and clinic equipment",
    revision: "unpaid lab fees for crowns",
    orderItem: "imaging equipment for a new office",
  },
];

/** Other commercial borrowers, for the rapid rounds and the borrowing base certificate. */
const PORTFOLIO = [
  "Alder Ridge Plumbing",
  "Bramblewood Cabinets",
  "Cinder Hill Logistics",
  "Dunmore Electric",
  "Eastcliff Printing",
  "Foxglove Landscape Supply",
  "Greyhaven Tool & Die",
  "Hartwell Veterinary Group",
  "Ivory Gate Signs",
  "Juniper Ridge Auto Parts",
  "Kingsbury Roofing",
  "Linden Mill Textiles",
  "Moorland Coffee Roasters",
  "Nettlefield Packaging",
  "Oakhurst Pet Supply",
];
const CUSTOMERS = [
  "Arbor Point Hospital",
  "Beacon Ridge Schools",
  "Calloway Builders",
  "Delmont Grocers",
  "Easton County",
  "Fairlane Property Mgmt",
  "Glenview Senior Living",
  "Harrow & Finch Hotels",
  "Ironbridge Contractors",
  "Jasper Creek Markets",
  "Kellerman Foods",
  "Lakeshore Clinics",
];
const LENDERS = ["Meridian Equipment Finance", "Blue Harbor Leasing", "Crestline Capital Funding", "Northgate Commercial Credit", "Pinecrest Business Capital"];
const APPRAISERS = ["Halvorsen Valuation Group", "Bright & Okafor Appraisal", "Westover Asset Advisors", "Kittredge Valuation Services"];
const CPAS = ["Lindqvist & Moore, CPAs", "Ashby Rowe CPA Group", "Fenner Partners LLP", "Okonkwo & Platt, CPAs"];

// ---- Rapid round plumbing ----

const RAPID_ITEMS = 15;
/** Items 3, 6, 9, 12 and 15 are worth 1; the rest ½. 10 points a round. */
const isHardSlot = (i: number) => i % 3 === 2;
const slotNo = (i: number) => String(i + 1).padStart(2, "0");

function fillSlots<T>(easy: T[], hard: T[]): T[] {
  const e = [...easy];
  const h = [...hard];
  const out = Array.from({ length: RAPID_ITEMS }, (_, i) => (isHardSlot(i) ? h.shift() : e.shift()));
  if (out.some((x) => x === undefined) || e.length || h.length) throw new Error("banking-stonebridge-renewal: rapid slots don't fill");
  return out as T[];
}

function rapidItems(prefix: string, item: (n: string) => object) {
  return Array.from({ length: RAPID_ITEMS }, (_, i) => ({ id: `${prefix}-${slotNo(i)}`, ...item(slotNo(i)), points: isHardSlot(i) ? 1 : 0.5 }));
}

const letterOptions = (name: string) => LETTERS.map((l) => ({ id: l, label: `{{${name}_${l}}}` }));
const answerField = (name: string) => [{ id: "answer", label: "Answer", kind: "choice", options: letterOptions(name) }];

/** Puts `right` among `wrong` in a random place; returns the labels by letter and the right letter. */
function placeOptions(rng: Rng, right: string, wrong: string[]): { labels: string[]; letter: string } {
  if (wrong.length !== 3 || new Set([right, ...wrong]).size !== 4) throw new Error(`banking-stonebridge-renewal: options must be 4 different labels (${right})`);
  const labels = rng.shuffle([right, ...wrong]);
  return { labels, letter: LETTERS[labels.indexOf(right)] };
}

/** The first three distinct candidates that aren't the right answer, or null when there aren't three. */
function threeWrong(right: string, candidates: string[]): string[] | null {
  const wrong = [...new Set(candidates)].filter((c) => c !== right).slice(0, 3);
  return wrong.length === 3 ? wrong : null;
}

interface RapidBuilt {
  title: string;
  prompt: string;
  rows: [string, string][];
  table?: string[][];
  right: string;
  wrong: string[];
}

/** Draws each slot's item, retrying a kind until its four options differ; records values and the key. */
function buildRound<K extends string>(rng: Rng, v: Values, prefix: string, kinds: K[], make: (kind: K) => RapidBuilt | null, labels?: string[]): Record<string, ChoiceKey> {
  return Object.fromEntries(
    kinds.map((kind, i) => {
      const n = slotNo(i);
      for (let tries = 0; ; tries++) {
        if (tries > 5_000) throw new Error(`banking-stonebridge-renewal: no ${kind} item for ${prefix}`);
        const b = make(kind);
        if (!b) continue;
        const wrong = threeWrong(b.right, b.wrong);
        if (!wrong) continue;
        const { labels: opts, letter } = placeOptions(rng, b.right, wrong);
        v[`${prefix}_${n}`] = b.prompt;
        v[`${prefix}_${n}_title`] = b.title;
        b.rows.forEach(([l, val], r) => {
          if (labels) {
            if (labels[r] !== l) throw new Error(`banking-stonebridge-renewal: ${prefix} row ${r} is ${l}, expected ${labels[r]}`);
          } else v[`${prefix}_${n}_l${r + 1}`] = l;
          v[`${prefix}_${n}_v${r + 1}`] = val;
        });
        b.table?.forEach((row, r) => row.forEach((cell, c) => (v[`${prefix}_${n}_t${r + 1}_${c + 1}`] = cell)));
        LETTERS.forEach((l, j) => (v[`${prefix}_${n}_${l}`] = opts[j]));
        return [`${prefix}-${n}`, { answer: { choice: letter } }] as [string, ChoiceKey];
      }
    }),
  );
}

// ---- Rapid round A: ratio flash ----

const rapidRatiosStep = {
  id: "rapid-ratios",
  type: RAPID_ROUND,
  title: "Ratio flash",
  config: {
    intro: [
      "Ratio flash: 15 statement snippets, 20 seconds each. Pick the right figure. Stonebridge's definitions:",
      "Current ratio = current assets ÷ current liabilities.",
      "Debt to tangible net worth = total liabilities ÷ (net worth − intangible assets).",
      "Days sales outstanding = accounts receivable ÷ revenue × 365, to the nearest day.",
      "Loan to value = loan amount ÷ appraised value.",
      "Gross margin = (revenue − cost of sales) ÷ revenue.",
      "Debt service coverage = (net income + interest + depreciation and amortization) ÷ (current portion of long-term debt at the prior year end + interest).",
      "Funded debt to EBITDA = funded debt ÷ (EBITDA + one-time expenses added back).",
      "An average balance = (start of year + end of year) ÷ 2.",
      "Ratios to two decimals, percentages to one.",
    ].join("\n"),
    secondsPerItem: 20,
    items: rapidItems("ra", (n) => ({
      prompt: `{{ra_${n}}}`,
      exhibit: {
        title: `{{ra_${n}_title}}`,
        rows: [1, 2, 3, 4].map((r) => ({ label: `{{ra_${n}_l${r}}}`, value: `{{ra_${n}_v${r}}}` })),
      },
      fields: answerField(`ra_${n}`),
    })),
  },
};

type RatioKind = "current" | "dtnw" | "dso" | "ltv" | "gm" | "dscr" | "lev" | "avg";
const RATIO_EASY: RatioKind[] = ["current", "current", "dtnw", "dtnw", "dso", "dso", "ltv", "ltv", "gm", "gm"];
const RATIO_HARD: RatioKind[] = ["dscr", "lev", "avg"];

function makeRatio(rng: Rng, kind: RatioKind, fy: number): RapidBuilt {
  const co = rng.pick(PORTFOLIO);
  const title = `${co} · FY ${fy}`;
  const $ = (lo: number, hi: number, step = 1_000) => mult(rng, lo, hi, step);
  switch (kind) {
    case "current": {
      const ca = $(800_000, 6_000_000);
      const cl = Math.round(ca / frac(rng, 1.05, 2.6) / 1_000) * 1_000;
      const inv = Math.round((ca * frac(rng, 0.2, 0.5)) / 1_000) * 1_000;
      const tl = cl + $(300_000, 3_000_000);
      return {
        title,
        prompt: "What is the current ratio?",
        rows: [["Current assets", usd(ca)], ["Current liabilities", usd(cl)], ["Inventory (in current assets)", usd(inv)], ["Total liabilities", usd(tl)]],
        right: xLabel(ca / cl),
        wrong: [xLabel(cl / ca), xLabel((ca - inv) / cl), xLabel(ca / tl), xLabel(ca / cl + 0.1)],
      };
    }
    case "dtnw": {
      const nw = $(1_500_000, 8_000_000);
      const int = Math.round((nw * frac(rng, 0.1, 0.4)) / 1_000) * 1_000;
      const tl = Math.round((nw * frac(rng, 0.6, 3)) / 1_000) * 1_000;
      const fd = Math.round((tl * frac(rng, 0.4, 0.7)) / 1_000) * 1_000;
      return {
        title,
        prompt: "What is debt to tangible net worth?",
        rows: [["Total liabilities", usd(tl)], ["Net worth", usd(nw)], ["Intangible assets", usd(int)], ["Funded debt", usd(fd)]],
        right: xLabel(tl / (nw - int)),
        wrong: [xLabel(tl / nw), xLabel(fd / (nw - int)), xLabel(tl / (nw + int)), xLabel(nw / tl)],
      };
    }
    case "dso": {
      const rev = $(5_000_000, 40_000_000, 10_000);
      const ar = Math.round((rev * rng.int(25, 75)) / 365 / 1_000) * 1_000;
      const cos = Math.round((rev * frac(rng, 0.6, 0.8)) / 1_000) * 1_000;
      const ap = Math.round((cos * rng.int(25, 50)) / 365 / 1_000) * 1_000;
      return {
        title,
        prompt: "What is days sales outstanding?",
        rows: [["Revenue, 12 months", usd(rev)], ["Accounts receivable", usd(ar)], ["Cost of sales", usd(cos)], ["Accounts payable", usd(ap)]],
        right: days(ar, rev),
        wrong: [days(ar, cos), days(ap, cos), `${Math.round((360 * ar) / rev)} days`, days(ar + ap, rev)],
      };
    }
    case "ltv": {
      const appraised = $(800_000, 6_000_000, 10_000);
      const loan = Math.round((appraised * frac(rng, 0.55, 0.85)) / 5_000) * 5_000;
      const price = Math.round((appraised * frac(rng, 0.6, 0.9)) / 10_000) * 10_000;
      const assessed = Math.round((appraised * frac(rng, 0.5, 0.8)) / 10_000) * 10_000;
      return {
        title: `${co} · real estate loan`,
        prompt: "What is the loan to value?",
        rows: [["Loan amount", usd(loan)], ["Appraised value", usd(appraised)], ["Original purchase price", usd(price)], ["Assessed value (property tax)", usd(assessed)]],
        right: pct1(loan, appraised),
        wrong: [pct1(loan, price), pct1(loan, assessed), pct1(appraised - loan, appraised), pct1(appraised, loan)],
      };
    }
    case "gm": {
      const rev = $(3_000_000, 30_000_000, 10_000);
      const cos = Math.round((rev * frac(rng, 0.55, 0.82)) / 1_000) * 1_000;
      const sga = Math.round((rev * frac(rng, 0.1, 0.25)) / 1_000) * 1_000;
      const da = Math.round((rev * frac(rng, 0.01, 0.03)) / 1_000) * 1_000;
      return {
        title,
        prompt: "What is the gross margin?",
        rows: [["Revenue", usd(rev)], ["Cost of sales", usd(cos)], ["Selling, general and administrative", usd(sga)], ["Depreciation and amortization", usd(da)]],
        right: pct1(rev - cos, rev),
        wrong: [pct1(rev - cos, cos), pct1(cos, rev), pct1(rev - cos - sga, rev), pct1(rev - cos - da, rev)],
      };
    }
    case "dscr": {
      const ni = $(200_000, 1_500_000);
      const i = $(50_000, 400_000);
      const da = $(100_000, 800_000);
      const cp = $(150_000, 1_200_000);
      return {
        title,
        prompt: "What is debt service coverage?",
        rows: [["Net income", usd(ni)], ["Interest expense", usd(i)], ["Depreciation and amortization", usd(da)], ["Current portion of LTD, prior year end", usd(cp)]],
        right: xLabel((ni + i + da) / (cp + i)),
        wrong: [xLabel((ni + i + da) / cp), xLabel((ni + da) / cp), xLabel((ni + i + da) / i), xLabel((ni + da) / (cp + i))],
      };
    }
    case "lev": {
      const e = $(800_000, 5_000_000);
      const a = Math.round((e * frac(rng, 0.06, 0.2)) / 1_000) * 1_000;
      const fd = Math.round((e * frac(rng, 1.5, 4.5)) / 1_000) * 1_000;
      const ap = $(200_000, 2_000_000);
      return {
        title,
        prompt: "What is funded debt to EBITDA?",
        rows: [["Funded debt", usd(fd)], ["EBITDA as reported", usd(e)], ["One-time expense: lawsuit settlement", usd(a)], ["Accounts payable", usd(ap)]],
        right: xLabel(fd / (e + a)),
        wrong: [xLabel(fd / e), xLabel((fd + ap) / (e + a)), xLabel(fd / (e - a)), xLabel((fd + ap) / e)],
      };
    }
    case "avg": {
      const rev = $(5_000_000, 40_000_000, 10_000);
      const start = Math.round((rev * rng.int(25, 70)) / 365 / 1_000) * 1_000;
      const end = Math.round((start * frac(rng, 1.15, 1.5)) / 1_000) * 1_000;
      const cos = Math.round((rev * frac(rng, 0.6, 0.8)) / 1_000) * 1_000;
      const avg = (start + end) / 2;
      return {
        title,
        prompt: "What is days sales outstanding on average receivables?",
        rows: [["Revenue, 12 months", usd(rev)], ["Receivables, start of year", usd(start)], ["Receivables, end of year", usd(end)], ["Cost of sales", usd(cos)]],
        right: days(avg, rev),
        wrong: [days(end, rev), days(start, rev), days(avg, cos), `${Math.round((360 * avg) / rev)} days`],
      };
    }
  }
}

// ---- Rapid round B: covenant calls ----

const COV_OK = "In compliance";
const COV_EOD = "Breach: event of default now";
const COV_CURE = "Breach: still within the cure period";
const COV_NT = "Not tested this period";
const COV_LABELS = ["Covenant", "Tested", "Period", "Figures", "Cure"];

const rapidCovenantsStep = {
  id: "rapid-covenants",
  type: RAPID_ROUND,
  title: "Covenant calls",
  config: {
    intro: [
      "Covenant calls: 15 compliance certificates from the portfolio, 20 seconds each.",
      "For each covenant, call it: in compliance; in breach and an event of default now; in breach but still within a cure period the agreement gives; or not tested this period.",
      "The loan agreement's own words and definitions decide, not the bank's credit policy. Read the comparison exactly as written.",
    ].join("\n"),
    secondsPerItem: 20,
    items: rapidItems("cv", (n) => ({
      prompt: `{{cv_${n}}}`,
      exhibit: { title: `{{cv_${n}_title}}`, rows: COV_LABELS.map((label, r) => ({ label, value: `{{cv_${n}_v${r + 1}}}` })) },
      fields: answerField(`cv_${n}`),
    })),
  },
};

type CovKind = "met" | "breach" | "nt" | "threshold" | "cure" | "definition";
const COV_EASY: CovKind[] = ["met", "met", "met", "met", "breach", "breach", "breach", "nt", "nt", "nt"];
const COV_HARD: CovKind[] = ["threshold", "threshold", "cure", "cure", "definition"];

interface Metric {
  name: string;
  min: boolean;
  limits: number[];
  money?: boolean;
}
const METRICS: Metric[] = [
  { name: "Debt service coverage", min: true, limits: [1.15, 1.2, 1.25, 1.3, 1.35] },
  { name: "Funded debt to EBITDA", min: false, limits: [3, 3.25, 3.5, 3.75, 4] },
  { name: "Current ratio", min: true, limits: [1.1, 1.2, 1.25, 1.5] },
  { name: "Tangible net worth", min: true, limits: [2_000_000, 3_500_000, 5_000_000, 6_250_000, 8_000_000], money: true },
];

function makeCovenant(rng: Rng, kind: CovKind, year: number): RapidBuilt | null {
  const co = rng.pick(PORTFOLIO);
  const metric = kind === "definition" ? METRICS[0] : rng.pick(METRICS);
  const limit = rng.pick(metric.limits);
  const show = (x: number) => (metric.money ? usd(x) : xLabel(x));
  const strict = kind === "threshold" && rng.int(0, 1) === 1;
  const op = metric.min ? (strict ? "greater than" : "not less than") : strict ? "less than" : "not more than";
  /** A figure that meets (good) or misses (bad) the limit by a clear margin. */
  const figure = (good: boolean) => {
    const m = metric.money ? rng.int(4, 25) / 100 : rng.int(4, 60) / 100;
    const up = metric.min === good;
    if (metric.money) return Math.round((limit * (up ? 1 + m : 1 - m)) / 10_000) * 10_000;
    return r2(up ? limit + m : Math.max(0.3, limit - m));
  };
  const annual = "Annually, at fiscal year end (Dec 31)";
  const quarterly = "Quarterly, at each quarter end";
  const yearEnd = `Year ended Dec 31, ${year - 1}`;
  const quarterEnd = `Quarter ended ${periodLabel(monthEnd(year, rng.pick([3, 6, 9])))}`;
  const none = "None in the agreement";
  const cureClause = (n: number, inside: boolean) => {
    const delivered = businessDayNear(iso(year, rng.int(2, 10), rng.int(1, 28)));
    const gap = inside ? rng.int(1, n - 3) : rng.int(n + 3, n + 30);
    return `May cure within ${n} days after the compliance certificate is delivered · delivered ${formatDate(delivered)} · today ${formatDate(addDays(delivered, gap))}`;
  };
  const anyCure = () => (rng.int(0, 1) ? none : cureClause(rng.pick([15, 30, 45]), rng.int(0, 1) === 1));
  const timing = () => (rng.int(0, 1) ? [annual, yearEnd] : [quarterly, rng.int(0, 1) ? yearEnd : quarterEnd]);
  const prompt = `${co}: where does this covenant stand?`;
  const title = `${co} · compliance certificate`;
  const plain = (fig: number, tested: string[], cure: string, right: string): RapidBuilt => ({
    title,
    prompt,
    rows: [
      ["Covenant", `${metric.name} ${op} ${show(limit)}`],
      ["Tested", tested[0]],
      ["Period", tested[1]],
      ["Figures", `Reported: ${show(fig)}`],
      ["Cure", cure],
    ],
    right,
    wrong: [COV_OK, COV_EOD, COV_CURE, COV_NT].filter((x) => x !== right),
  });
  switch (kind) {
    case "met":
      return plain(figure(true), timing(), anyCure(), COV_OK);
    case "breach":
      return plain(figure(false), timing(), none, COV_EOD);
    case "nt":
      return plain(figure(rng.int(0, 3) === 0), [annual, quarterEnd], anyCure(), COV_NT);
    case "threshold":
      return plain(limit, timing(), none, strict ? COV_EOD : COV_OK);
    case "cure": {
      const inside = rng.int(0, 1) === 1;
      return plain(figure(false), timing(), cureClause(rng.pick([15, 30, 45]), inside), inside ? COV_CURE : COV_EOD);
    }
    case "definition": {
      const deducts = rng.int(0, 1) === 1;
      const ds = mult(rng, 400_000, 2_500_000, 1_000);
      const e = Math.round((ds * frac(rng, 1.15, 2.2)) / 1_000) * 1_000;
      const d = Math.round((e * frac(rng, 0.08, 0.3)) / 1_000) * 1_000;
      const gross = r2(e / ds);
      const net = r2((e - d) / ds);
      // The agreement's own ratio decides; the bank's policy reading must land the other way.
      const agreement = deducts ? net : gross;
      const policy = deducts ? gross : net;
      if (Math.abs(agreement - limit) < 0.03 || Math.abs(policy - limit) < 0.03) return null;
      if (agreement >= limit === policy >= limit) return null;
      return {
        title,
        prompt: `${co}: the agreement defines coverage differently from our policy. Where does the covenant stand?`,
        rows: [
          ["Covenant", `Debt service coverage not less than ${xLabel(limit)}; coverage = ${deducts ? "(EBITDA − distributions)" : "EBITDA"} ÷ debt service`],
          ["Tested", annual],
          ["Period", yearEnd],
          ["Figures", `EBITDA ${usd(e)} · distributions ${usd(d)} · debt service ${usd(ds)}`],
          ["Cure", none],
        ],
        right: agreement >= limit ? COV_OK : COV_EOD,
        wrong: [COV_OK, COV_EOD, COV_CURE, COV_NT].filter((x) => x !== (agreement >= limit ? COV_OK : COV_EOD)),
      };
    }
  }
}

// ---- Rapid round C: borrowing base ----

const rapidBaseStep = {
  id: "rapid-base",
  type: RAPID_ROUND,
  title: "Borrowing base",
  config: {
    intro: [
      "Borrowing base: 15 receivables agings, 20 seconds each. Stonebridge's ineligibles:",
      "Any balance over 90 days.",
      "Every balance of an affiliate (a customer with the same owners as the borrower), current ones too.",
      "An account with a credit balance counts as zero; don't net it against other accounts.",
      "Concentration: the part of one customer's eligible balance above the cap (a percentage of total eligible receivables after the other ineligibles) is ineligible.",
      "Availability = eligible receivables × the advance rate.",
    ].join("\n"),
    secondsPerItem: 20,
    items: rapidItems("bb", (n) => ({
      prompt: `{{bb_${n}}}`,
      exhibit: {
        title: `{{bb_${n}_title}}`,
        rows: [
          { label: "Advance rate", value: `{{bb_${n}_v1}}` },
          { label: "Concentration cap", value: `{{bb_${n}_v2}}` },
        ],
        table: {
          columns: ["Customer", "0–30 days", "31–90 days", "Over 90 days"],
          rows: [1, 2, 3, 4].map((r) => [1, 2, 3, 4].map((c) => `{{bb_${n}_t${r}_${c}}}`)),
        },
      },
      fields: answerField(`bb_${n}`),
    })),
  },
};

type BaseKind = "elig" | "avail" | "conc" | "aff" | "credit";
const BASE_EASY: BaseKind[] = ["elig", "elig", "elig", "elig", "elig", "avail", "avail", "avail", "avail", "avail"];
const BASE_HARD: BaseKind[] = ["conc", "conc", "aff", "aff", "credit"];

function makeBase(rng: Rng, kind: BaseKind, year: number): RapidBuilt | null {
  const co = rng.pick(PORTFOLIO);
  const names = pickDistinct(rng, CUSTOMERS, 4);
  const rate = rng.pick([75, 80, 85]);
  const cap = rng.pick([40, 45, 50]);
  const k = (lo: number, hi: number) => rng.int(lo, hi) * 1_000;
  type Row = { name: string; a: number; b: number; o: number };
  const rows: Row[] = names.map((name) => ({ name, a: k(10, 60), b: rng.int(0, 2) ? k(2, 30) : 0, o: 0 }));
  const overs = rng.shuffle([0, 1, 2, 3]).slice(0, kind === "conc" ? 1 : 2);
  for (const i of overs) rows[i].o = k(2, 25);
  const special = rng.int(0, 3);
  if (kind === "conc") {
    rows[special].a = k(150, 300);
    rows[special].o = 0;
  }
  if (kind === "aff") rows[special] = { ...rows[special], name: `${rows[special].name.split(" ")[0]} Holdings (affiliate)`, o: 0 };
  if (kind === "credit") rows[special] = { ...rows[special], a: -k(2, 15), b: 0, o: 0 };
  const isAff = (r: Row) => r.name.endsWith("(affiliate)");
  const elig = rows.map((r) => (isAff(r) || r.a + r.b + r.o < 0 ? 0 : r.a + r.b));
  const total = elig.reduce((s, x) => s + x, 0);
  const limit = (cap * total) / 100;
  const excess = elig.reduce((s, x) => s + Math.max(0, x - limit), 0);
  if ((kind === "conc") !== excess > 0) return null;
  if (kind !== "conc" && Math.max(...elig) > ((cap - 3) * total) / 100) return null;
  if (kind === "conc" && excess < 5_000) return null;
  const eligible = total - excess;
  const gross = rows.reduce((s, r) => s + r.a + r.b + r.o, 0);
  const over90 = rows.reduce((s, r) => s + r.o, 0);
  const dollars = (n: number) => usd(Math.round(n));
  const cell = (x: number) => (x === 0 ? "—" : x < 0 ? `(${fmt(-x)})` : fmt(x));
  const table = rows.map((r) => [r.name, cell(r.a), cell(r.b), cell(r.o)]);
  const base = {
    title: `${co} · aging at ${periodLabel(monthEnd(year, rng.int(1, 9)))}`,
    rows: [
      ["Advance rate", `${rate}%`],
      ["Concentration cap", `${cap}% of eligible receivables`],
    ] as [string, string][],
    table,
  };
  const withOver = rows.filter((r) => r.o > 0).reduce((s, r) => s + r.a + r.b, 0);
  switch (kind) {
    case "elig":
      return { ...base, prompt: "What are eligible receivables?", right: dollars(eligible), wrong: [dollars(eligible + over90), dollars(eligible - withOver), dollars((eligible * rate) / 100), dollars(gross)] };
    case "avail":
      return {
        ...base,
        prompt: "What is availability on receivables?",
        right: dollars((eligible * rate) / 100),
        wrong: [dollars(((eligible + over90) * rate) / 100), dollars(eligible), dollars((eligible * (100 - rate)) / 100), dollars(((eligible - withOver) * rate) / 100)],
      };
    case "conc": {
      const big = Math.max(...elig);
      return {
        ...base,
        prompt: "What are eligible receivables?",
        right: dollars(eligible),
        wrong: [dollars(total), dollars(total - big), dollars(total - Math.max(0, big - (cap * gross) / 100)), dollars((eligible * rate) / 100), dollars(total - over90)],
      };
    }
    case "aff": {
      const aff = rows[special];
      return {
        ...base,
        prompt: "What are eligible receivables?",
        right: dollars(eligible),
        wrong: [dollars(eligible + aff.a + aff.b), dollars(eligible + aff.a), dollars(eligible + aff.b), dollars((eligible * rate) / 100), dollars(eligible + over90)],
      };
    }
    case "credit": {
      const credit = -rows[special].a;
      return {
        ...base,
        prompt: "What are eligible receivables?",
        right: dollars(eligible),
        wrong: [dollars(eligible - credit), dollars(eligible + over90), dollars((eligible * rate) / 100), dollars(eligible + credit)],
      };
    }
  }
}

// ---- Section 2: the spread ----

const STATEMENT_LINES = [
  ["rev", "Revenue"],
  ["cos", "Cost of sales"],
  ["gp", "Gross profit"],
  ["sga", "Selling, general and administrative"],
  ["da", "Depreciation and amortization"],
  ["opinc", "Operating income"],
  ["int", "Interest expense"],
  ["oth", "Other income"],
  ["ni", "Net income"],
] as const;
const OTHER_LINES = [
  ["cdep", "Depreciation inside cost of sales (note 1)"],
  ["dist", "Distributions to members"],
  ["prin", "Scheduled principal paid"],
] as const;
const BALANCE_LINES = [
  ["cash", "Cash"],
  ["ar", "Accounts receivable"],
  ["inv", "Inventory"],
  ["pre", "Prepaids and other"],
  ["tca", "Total current assets"],
  ["nfa", "Property and equipment, net"],
  ["ta", "Total assets"],
  ["loc", "Line of credit"],
  ["cpltd", "Current portion of long-term debt"],
  ["ap", "Accounts payable"],
  ["acc", "Accrued expenses"],
  ["tcl", "Total current liabilities"],
  ["ltd", "Long-term debt, less current portion"],
  ["tl", "Total liabilities"],
  ["eq", "Members' equity"],
  ["tle", "Total liabilities and equity"],
] as const;
const BOLD_LINES = new Set(["gp", "opinc", "ni", "tca", "ta", "tcl", "tl", "tle"]);

const num = (key: string, col: number) => ({ text: `{{s_${key}_${col}}}`, align: "right" as const, ...(BOLD_LINES.has(key) ? { bold: true } : {}) });
const label = (text: string, key?: string) => (key && BOLD_LINES.has(key) ? { text, bold: true } : text);
const heading = (text: string) => [{ text, bold: true }, "", "", "", "", ""];
const input = (id: string, lbl: string, points: number) => ({ input: id, label: lbl, format: "number" as const, points });
const PERIODS = [
  ["fy2", "prior fiscal year"],
  ["fy3", "last fiscal year"],
  ["int", "interim"],
] as const;

const spreadStep = {
  id: "spread",
  type: SPREADSHEET,
  title: "The spread",
  config: {
    prompt: [
      "Spread {{borrower}}: FY {{fy2}}, FY {{fy3}} and the interim period, in $000s. FY {{fy1}} is there for the trend; it was spread last year.",
      "Enter EBITDA, adjusted EBITDA and cash available as whole numbers in $000s, and ratios to two decimals (1.37 for 1.37x).",
      "",
      "Stonebridge credit policy §4, definitions:",
      "EBITDA = net income + interest expense + income taxes + all depreciation and amortization, including depreciation inside cost of sales. (Members pay the tax on an LLC's income, so there is no tax line.)",
      "Adjusted EBITDA = EBITDA − one-time gains + one-time losses.",
      "Cash available for debt service = adjusted EBITDA − distributions to members.",
      "Debt service = scheduled principal paid + interest expense, for the same period.",
      "Debt service coverage = cash available ÷ debt service.",
      "Funded debt = line of credit + current portion of long-term debt + long-term debt.",
      "Leverage = funded debt at the FY {{fy3}} year end ÷ FY {{fy3}} adjusted EBITDA.",
      "Pro forma coverage = basis ÷ (FY {{fy3}} debt service + annual debt service on the increase). The basis is the interim cash available annualised (× 12 ÷ months) when the interim covers at least {{ann_months}} months; otherwise FY {{fy3}} cash available.",
    ].join("\n"),
    columns: ["$000s", "FY {{fy1}}", "FY {{fy2}}", "FY {{fy3}}", "{{int_head}}", "Pro forma"],
    rows: [
      heading("Income statement"),
      ...STATEMENT_LINES.map(([key, text]) => [label(text, key), num(key, 1), num(key, 2), num(key, 3), num(key, 4), ""]),
      heading("Other items"),
      ...OTHER_LINES.map(([key, text]) => [text, num(key, 1), num(key, 2), num(key, 3), num(key, 4), ""]),
      heading("Balance sheet at fiscal year end"),
      ...BALANCE_LINES.map(([key, text]) => [label(text, key), num(key, 1), num(key, 2), num(key, 3), { text: "—", align: "right" as const }, ""]),
      [{ text: "Note 1: cost of sales includes depreciation of production equipment, shown on the line above; the depreciation and amortization line excludes it." }, "", "", "", "", ""],
      [{ text: "{{gain_note}}" }, "", "", "", "", ""],
      heading("Your spread ($000s; ratios to two decimals)"),
      ["EBITDA", "—", ...PERIODS.map(([p, name]) => input(`e_${p}`, `EBITDA: ${name}`, 1.25)), ""],
      ["Adjusted EBITDA", "—", ...PERIODS.map(([p, name]) => input(`a_${p}`, `Adjusted EBITDA: ${name}`, 1.25)), ""],
      ["Cash available for debt service", "—", ...PERIODS.map(([p, name]) => input(`c_${p}`, `Cash available for debt service: ${name}`, 1.25)), ""],
      ["Debt service coverage (x)", "—", ...PERIODS.map(([p, name]) => input(`d_${p}`, `Debt service coverage: ${name}`, 1.25)), input("pf", "Pro forma coverage with the increase", 3)],
      ["Funded debt to adjusted EBITDA (x)", "", "", input("lev", "Leverage: last fiscal year", 2), "", ""],
    ],
  },
};

interface Spread {
  values: Values;
  cells: Record<string, { value: number; tolerance?: number }>;
  months: number;
  intEnd: IsoDate;
  lineOld: number;
  lineNew: number;
  adj3: number;
  lev: number;
}

/** Statements in $000s that tie, plus the key, or null when a draw doesn't make every trap matter. */
function drawSpread(rng: Rng, ind: Industry, year: number): Spread | null {
  const months = rng.pick([3, 6, 9]);
  const threshold = rng.pick([6, 9]);
  const fys = [year - 3, year - 2, year - 1];
  const intEnd = monthEnd(year, months);
  const rev1 = mult(rng, ind.revenue[0], ind.revenue[1], 10);
  const rev2 = Math.round(rev1 * (1 + frac(rng, -0.03, 0.12)));
  const rev3 = Math.round(rev2 * (1 + frac(rng, -0.03, 0.12)));
  const revI = Math.round(((rev3 * months) / 12) * (1 + frac(rng, -0.06, 0.12)));
  const rev = [rev1, rev2, rev3, revI];
  const gainCol = rng.int(1, 3);
  const P = [0, 1, 2, 3].map((i) => {
    const r = rev[i];
    const cos = Math.round(r * (1 - frac(rng, ind.gm[0], ind.gm[1])));
    const gp = r - cos;
    const cdep = Math.max(1, Math.round(r * frac(rng, 0.008, 0.02)));
    const other = Math.max(1, Math.round(r * frac(rng, 0.001, 0.004)));
    const ebitdaX = Math.round(r * frac(rng, 0.07, 0.13));
    const da = Math.round(r * frac(rng, 0.01, 0.025));
    const sga = gp + cdep + other - ebitdaX;
    const gain = i === gainCol ? Math.round(r * frac(rng, 0.012, 0.03)) : 0;
    return { rev: r, cos, gp, cdep, other, ebitdaX, da, sga, gain, oth: other + gain, int: 0, ni: 0, opinc: 0, dist: 0, prin: 0 };
  });
  for (let i = 0; i < 3; i++) P[i].int = Math.round(P[i].ebitdaX * frac(rng, 0.06, 0.12));
  P[3].int = Math.round(((P[2].int * months) / 12) * frac(rng, 0.9, 1.1));
  for (const p of P) {
    if (p.sga < p.rev * 0.05) return null;
    p.opinc = p.gp - p.sga - p.da;
    p.ni = p.opinc - p.int + p.oth;
    p.dist = Math.round(p.ebitdaX * frac(rng, 0.15, 0.35));
    if (p.ni <= 0) return null;
  }
  const cads = P.map((p) => p.ebitdaX - p.dist);
  for (let i = 0; i < 3; i++) {
    P[i].prin = Math.round(cads[i] / frac(rng, 1.15, 2.1)) - P[i].int;
    if (P[i].prin < Math.round(P[i].rev * 0.01)) return null;
  }
  const cp = [P[1].prin, P[2].prin, Math.round(P[2].prin * frac(rng, 0.9, 1.1))];
  P[3].prin = Math.round((cp[2] * months) / 12);

  // The controller's revision to the interim period.
  const rv = Math.max(5, Math.round(revI * frac(rng, 0.01, 0.025)));
  const niRev = P[3].ni - rv;
  if (niRev <= 0) return null;

  // Balance sheets, FY1 to FY3.
  const B = [0, 1, 2].map((i) => {
    const r = rev[i];
    return {
      ar: Math.round((r * rng.int(35, 60)) / 365),
      inv: Math.round(r * frac(rng, ind.inventory[0], ind.inventory[1])),
      pre: Math.round(r * frac(rng, 0.005, 0.015)),
      loc: Math.round(r * frac(rng, 0.02, 0.07)),
      ap: Math.round((P[i].cos * rng.int(25, 45)) / 365),
      acc: Math.round(r * frac(rng, 0.015, 0.035)),
      nfa: 0,
      cash: 0,
      eq: 0,
    };
  });
  B[0].nfa = Math.round(rev1 * frac(rng, 0.15, 0.3));
  for (let i = 1; i < 3; i++) {
    const dep = P[i].da + P[i].cdep;
    B[i].nfa = B[i - 1].nfa + Math.round(dep * frac(rng, 0.8, 1.3)) - dep;
  }
  const term2 = cp[2] * rng.int(3, 6);
  const term = [term2 + P[2].prin + P[1].prin, term2 + P[2].prin, term2];
  const ltd = term.map((t, i) => t - cp[i]);
  const liab = (i: number) => B[i].loc + cp[i] + B[i].ap + B[i].acc + ltd[i];
  const nonCash = (i: number) => B[i].ar + B[i].inv + B[i].pre + B[i].nfa;
  B[0].cash = Math.round(rev1 * frac(rng, 0.02, 0.06));
  B[0].eq = B[0].cash + nonCash(0) - liab(0);
  if (B[0].eq < rev1 * 0.05) return null;
  for (let i = 1; i < 3; i++) {
    B[i].eq = B[i - 1].eq + P[i].ni - P[i].dist;
    B[i].cash = liab(i) + B[i].eq - nonCash(i);
    if (B[i].cash < rev[i] * 0.005) return null;
  }

  // The key.
  const newDsK = (lineDiff: number) => Math.round((lineDiff / 1_000) * frac(rng, 0.13, 0.16));
  const lineOld = mult(rng, Math.max(500_000, rev3 * 1_000 * 0.1), rev3 * 1_000 * 0.2, 250_000);
  const lineNew = lineOld + mult(rng, 250_000, Math.max(250_000, Math.min(1_500_000, lineOld * 0.6)), 250_000);
  const newDs = newDsK(lineNew - lineOld);
  const ebitda = P.map((p, i) => (i === 3 ? niRev : p.ni) + p.int + p.da + p.cdep);
  const adj = ebitda.map((e, i) => e - P[i].gain);
  const cadsK = adj.map((a, i) => a - P[i].dist);
  const ds = P.map((p) => p.prin + p.int);
  const dscr = cadsK.map((c, i) => r2(c / ds[i]));
  const annualise = months >= threshold;
  const basis = (ann: boolean) => (ann ? (cadsK[3] * 12) / months : cadsK[2]);
  const pf = r2(basis(annualise) / (ds[2] + newDs));
  const lev = r2((B[2].loc + term[2]) / adj[2]);

  // Every trap must move a ratio by more than its tolerance, and the figures must look like a bankable credit.
  if (dscr.slice(1).some((d) => d < 0.95 || d > 2.6) || pf < 0.75 || pf > 2.4 || lev < 1.1 || lev > 4.8) return null;
  if (P[gainCol].gain / ds[gainCol] < 0.04) return null;
  if (rv / ds[3] < 0.04) return null;
  if (Math.abs(basis(true) - basis(false)) / (ds[2] + newDs) < 0.04) return null;
  if (annualise && (rv * 12) / months / (ds[2] + newDs) < 0.04) return null;
  if (P.slice(1).some((p) => p.cdep / (p.prin + p.int) < 0.03)) return null;

  const v: Values = {
    fy1: String(fys[0]),
    fy2: String(fys[1]),
    fy3: String(fys[2]),
    int_head: `${months} mo. to ${periodLabel(intEnd)}`,
    ann_months: String(threshold),
  };
  P.forEach((p, i) => {
    const c = i + 1;
    for (const key of ["rev", "cos", "gp", "sga", "da", "opinc", "int", "oth", "ni", "cdep", "dist", "prin"] as const) v[`s_${key}_${c}`] = fmt(p[key]);
  });
  B.forEach((b, i) => {
    const c = i + 1;
    const tca = b.cash + b.ar + b.inv + b.pre;
    const tcl = b.loc + cp[i] + b.ap + b.acc;
    const tl = tcl + ltd[i];
    const lines: Record<string, number> = {
      cash: b.cash,
      ar: b.ar,
      inv: b.inv,
      pre: b.pre,
      tca,
      nfa: b.nfa,
      ta: tca + b.nfa,
      loc: b.loc,
      cpltd: cp[i],
      ap: b.ap,
      acc: b.acc,
      tcl,
      ltd: ltd[i],
      tl,
      eq: b.eq,
      tle: tl + b.eq,
    };
    if (lines.ta !== lines.tle) throw new Error("banking-stonebridge-renewal: balance sheet doesn't tie");
    for (const [key, n] of Object.entries(lines)) v[`s_${key}_${c}`] = fmt(n);
  });
  const gainPeriod = gainCol === 3 ? "the interim period" : `FY ${fys[gainCol]}`;
  v.gain_note = `Note 2: other income for ${gainPeriod} includes a one-time gain of ${fmt(P[gainCol].gain)} on the sale of ${rng.pick(ind.gainAssets)}. The rest of other income is vendor rebates and interest earned, received every year.`;
  Object.assign(v, {
    sga_old: fmt(P[3].sga),
    sga_rev: fmt(P[3].sga + rv),
    ni_rev: fmt(niRev),
    new_ds: fmt(newDs),
    line_old: usd(lineOld),
    line_new: usd(lineNew),
    int_end: periodLabel(intEnd),
    int_months: String(months),
  });
  const cells: Spread["cells"] = { pf: { value: pf, tolerance: 0.01 }, lev: { value: lev, tolerance: 0.01 } };
  PERIODS.forEach(([p], j) => {
    const i = j + 1;
    cells[`e_${p}`] = { value: ebitda[i] };
    cells[`a_${p}`] = { value: adj[i] };
    cells[`c_${p}`] = { value: cadsK[i] };
    cells[`d_${p}`] = { value: dscr[i], tolerance: 0.01 };
  });
  return { values: v, cells, months, intEnd, lineOld, lineNew, adj3: adj[2], lev };
}

// ---- Section 4: the draft credit memo against the file ----

const memoStep = {
  id: "package-review",
  type: DOCUMENT_REVIEW,
  title: "Draft credit memo against the file",
  config: {
    prompt: [
      "{{rm_first}}'s draft credit memo for {{borrower_short}}, line by line against the credit file and Stonebridge's policy (in the header).",
      "Flag each line where the memo or the file breaks policy, with the reason, then decide what happens to the memo before Friday.",
    ].join("\n"),
    document: {
      title: "Credit memo checklist · {{borrower}} · renewal and increase to {{line_new}}",
      fields: [
        { id: "committee", label: "Committee date", value: "{{committee}}" },
        { id: "pol_fs", label: "Policy §3.1", value: "Interim financial statements no more than {{fs_days}} days old on the committee date, plus the last fiscal year's annual statements" },
        { id: "pol_app", label: "Policy §3.4", value: "Appraisals no more than {{app_months}} months old on the committee date" },
        { id: "pol_pfs", label: "Policy §3.6", value: "Each guarantor's personal financial statement signed and dated" },
        { id: "pol_lien", label: "Policy §5.2", value: "The bank's lien must be first on the collateral the memo names; any earlier lien terminated (UCC-3) before closing" },
        { id: "pol_name", label: "Policy §2.1", value: "The memo uses the borrower's exact legal name from its organisational documents" },
        { id: "covenants", label: "Loan agreement", value: "§6.1: debt service coverage not less than {{cov_dscr}}x; funded debt to EBITDA not more than {{cov_lev}}x; both tested at fiscal year end" },
      ],
      columns: ["Item", "Draft memo says", "File shows"],
      rows: Array.from({ length: 12 }, (_, i) => ({ id: `r${i + 1}`, cells: ["item", "memo", "file"].map((c) => `{{pr_${i + 1}_${c}}}`) })),
      totals: [],
    },
    reasons: [
      { id: "stale", label: "Older than policy allows" },
      { id: "unsigned", label: "Not signed" },
      { id: "misstated", label: "The memo contradicts the file" },
      { id: "prior_lien", label: "An earlier lien ranks ahead of the bank" },
      { id: "name", label: "Not the borrower's legal name" },
      { id: "other", label: "Other" },
    ],
    findings: [
      { id: "interim_stale", label: "Interim statements older than policy", points: 3 },
      { id: "appraisal_stale", label: "Appraisal older than policy", points: 3 },
      { id: "pfs_unsigned", label: "Guarantor's financial statement unsigned", points: 3 },
      { id: "covenant_misstated", label: "Covenant breach described as compliance", points: 3 },
      { id: "prior_lien", label: "Active prior lien on the equipment", points: 3 },
      { id: "name_mismatch", label: "Borrower's name differs from its organisational documents", points: 3 },
    ],
    falseFlagPenalty: 1,
    decision: {
      prompt: "The agenda for Friday closes tomorrow. What happens to the memo?",
      options: [
        { id: "committee", label: "Send it to committee as drafted; the committee can ask about the details" },
        { id: "return", label: "Return it to {{rm_first}} with the list: each item fixed, or carried as an approved policy exception, before it goes to committee" },
        { id: "exception", label: "Send it to committee and list the items as policy exceptions yourself" },
        { id: "fix", label: "Correct the memo yourself: change the covenant to a breach, fix the name and dates, and send it on" },
      ],
      points: 2,
    },
  },
};

// ---- Section 6: desk ----

const certificateStep = {
  id: "base-certificate",
  type: SPREADSHEET,
  seconds: 210,
  title: "Borrowing base certificate",
  config: {
    prompt:
      "Recompute {{borrower_short}}'s borrowing base certificate from the aging, the inventory listing and the policy in {{ops_first}}'s email. Enter dollars; a shortfall is a negative number.",
    columns: ["Borrowing base certificate · {{bc_date}}", "Borrower's figure", "Bank's recompute"],
    rows: [
      ["Accounts receivable per aging", { text: "{{bc_ar}}", align: "right" }, ""],
      ["Less: over 90 days", { text: "{{bc_o90}}", align: "right" }, ""],
      ["Less: affiliate accounts", { text: "{{bc_b_aff}}", align: "right" }, ""],
      [{ text: "Eligible receivables", bold: true }, { text: "{{bc_b_elar}}", align: "right" }, { input: "elig_ar", label: "Eligible receivables", format: "money", points: 2.5 }],
      ["Advance rate on receivables", { text: "{{bc_b_arrate}}", align: "right" }, ""],
      ["Inventory per listing", { text: "{{bc_inv}}", align: "right" }, ""],
      ["Less: work in process", { text: "{{bc_b_wip}}", align: "right" }, ""],
      ["Less: in transit", { text: "{{bc_transit}}", align: "right" }, ""],
      [{ text: "Eligible inventory", bold: true }, { text: "{{bc_b_elinv}}", align: "right" }, { input: "elig_inv", label: "Eligible inventory", format: "money", points: 2.5 }],
      ["Inventory advances (rate and cap applied)", { text: "{{bc_b_invadv}}", align: "right" }, ""],
      ["Borrowing base", { text: "{{bc_b_base}}", align: "right" }, ""],
      [
        { text: "Availability: lesser of the borrowing base and the line", bold: true },
        { text: "{{bc_b_avail}}", align: "right" },
        { input: "avail", label: "Availability", format: "money", points: 2.5 },
      ],
      ["Outstanding on the line", { text: "{{bc_out}}", align: "right" }, ""],
      [{ text: "Excess / (shortfall)", bold: true }, { text: "{{bc_b_excess}}", align: "right" }, { input: "excess", label: "Excess or shortfall", format: "money", points: 2.5 }],
    ],
  },
};

const mcStep = (id: string, title: string, seconds: number, prompt: string, prefix: string, points: number) => ({
  id,
  type: MULTIPLE_CHOICE,
  seconds,
  title,
  config: { prompt, options: letterOptions(prefix), select: "single", points },
});

const ratingStep = mcStep("risk-rating", "Risk rating", 75, "{{cco_first}} needs the risk rating for the memo. Which grade goes in?", "rr", 5);
const leadRiskStep = mcStep("lead-risk", "Lead risk", 75, "Which risk goes first in the memo's risk section?", "lr", 5);
const valuesSteps = [
  mcStep("values-integrity", "Judgment: the covenant breach", 72, "{{rm_first}} wants the covenant breach left out of the memo. What do you do?", "vi", 2),
  mcStep("values-candor", "Judgment: an error in your spread", 72, "{{ops_first}} found an error in the spread you already sent. What do you do?", "vc", 2),
  mcStep("values-in-lane", "Judgment: is it approved?", 72, "{{ctrl_first}} wants to know if the increase is approved. What do you reply?", "vl", 2),
  mcStep("values-client-care", "Judgment: another customer asks", 72, "{{other_first}} asks how {{borrower_short}} is doing. What do you reply?", "vk", 2),
  mcStep("values-quality", "Judgment: booking before the insurance", 72, "{{ops_first}} offers to book the renewal before the insurance certificate arrives. What do you do?", "vq", 2),
];

const GRADE_LABELS: Record<number, string> = {
  3: "3 · Pass",
  4: "4 · Pass: acceptable",
  5: "5 · Pass: watch",
  6: "6 · Special mention",
  7: "7 · Substandard",
};
const RISK_LABELS = ["Debt service coverage", "Leverage", "Customer concentration", "Collateral: loan to value"];

const sign = (role: string) => `{{${role}}}`;

const DEFINITION = {
  intro: [
    "You're an analyst in {{bank}}'s commercial banking programme. Today is {{today}}.",
    "You're on the annual renewal for {{borrower}}, {{industry}} owned by {{owner}}, who guarantees the loans. The company also wants its line of credit increased. Loan committee meets on Friday, {{committee}}.",
    "The people you'll hear from: {{rm}}, the relationship manager; {{cco}}, the chief credit officer; {{ops}} in loan operations; and {{ctrl}}, the borrower's controller.",
    "Six timed sections, 50 minutes in all. Each section's brief arrives in your inbox when it opens. Figures marked $000s are in thousands of dollars.",
  ].join("\n\n"),
  steps: [rapidRatiosStep, spreadStep, rapidCovenantsStep, memoStep, rapidBaseStep, certificateStep, ratingStep, leadRiskStep, ...valuesSteps],
  messages: [
    {
      id: "m1",
      from: "Relationship manager",
      subject: "{{borrower_short}} renewal: Friday committee",
      body: [
        "Hi {{first_name}},",
        "",
        "Welcome to the {{borrower_short}} renewal. {{owner_first}}'s company wants to renew its {{line_old}} line and take it to {{line_new}}, and loan committee meets Friday, {{committee}}. I need the spread and a clean memo from you by Thursday noon, so today matters.",
        "",
        "Before we start, {{cco_first}} runs every analyst through the ratio flash: 15 statement snippets, 20 seconds each. Our definitions are in the brief.",
        "",
        sign("rm"),
      ].join("\n"),
      arriveAtMinute: 0,
      stepId: "rapid-ratios",
    },
    {
      id: "m2",
      from: "Chief credit officer",
      subject: "Spread {{borrower_short}}",
      body: [
        "{{first_name}},",
        "",
        "The {{borrower_short}} statements are loaded in the spread: FY {{fy1}} to FY {{fy3}} and the {{int_months}} months to {{int_end}}. Spread FY {{fy2}}, FY {{fy3}} and the interim on our definitions (policy §4, in the brief). Read the notes.",
        "",
        "The request: renew the {{line_old}} line and increase it to {{line_new}}. Annual debt service on the increase, per the policy stress test: {{new_ds}} ($000s). I want pro forma coverage on the policy basis and FY {{fy3}} leverage.",
        "",
        sign("cco"),
      ].join("\n"),
      arriveAtMinute: 0,
      stepId: "spread",
    },
    {
      id: "m3",
      from: "Borrower's controller",
      subject: "Correction to the interim statements",
      body: [
        "Hi {{first_name}},",
        "",
        "Sorry, one correction to the interim we sent. For the {{int_months}} months to {{int_end}}, selling, general and administrative is {{sga_rev}}, not {{sga_old}} ($000s): we hadn't booked {{revision}}. Net income for the period becomes {{ni_rev}}. Nothing else changes.",
        "",
        "{{ctrl}}",
        "Controller, {{borrower}}",
      ].join("\n"),
      arriveAtMinute: 4,
      stepId: "spread",
    },
    {
      id: "m4",
      from: "Chief credit officer",
      subject: "Quarter-end covenant calls",
      body: [
        "{{first_name}},",
        "",
        "Compliance certificates came in across the portfolio. Call each covenant: 15 of them, 20 seconds each. Go by the loan agreement's own wording and definitions, and check the period and any cure right before you call a breach.",
        "",
        sign("cco"),
      ].join("\n"),
      arriveAtMinute: 0,
      stepId: "rapid-covenants",
    },
    {
      id: "m5",
      from: "Chief credit officer",
      subject: "Draft memo: {{borrower_short}}",
      body: [
        "{{first_name}},",
        "",
        "{{rm_first}}'s draft memo for {{borrower_short}} is in. Check every line against the file and policy before it goes on Friday's agenda. Flag what's wrong and tell me what happens to the memo. Don't edit {{rm_first}}'s memo yourself.",
        "",
        sign("cco"),
      ].join("\n"),
      arriveAtMinute: 0,
      stepId: "package-review",
    },
    {
      id: "m6",
      from: "Loan operations",
      subject: "Borrowing base drill",
      body: [
        "Hi {{first_name}},",
        "",
        "Before you look at {{borrower_short}}'s certificate, warm up on these: 15 agings from other lines we monitor, 20 seconds each. Ineligibles and the advance rate are in the brief and on each aging.",
        "",
        sign("ops"),
      ].join("\n"),
      arriveAtMinute: 0,
      stepId: "rapid-base",
    },
    {
      id: "m7",
      from: "Loan operations",
      subject: "{{borrower_short}} borrowing base certificate",
      body: [
        "Hi {{first_name}},",
        "",
        "{{borrower_short}}'s certificate as of {{bc_date}} is on screen. Please recompute it; I don't think it's right. From the backup:",
        "",
        "Aging total {{bc_ar}}; over 90 days {{bc_o90}}. {{bc_aff_name}} (affiliate, same owners) owes {{bc_aff}}, all under 90 days.",
        "Inventory listing: raw materials {{bc_raw}}; finished goods {{bc_fg}}; work in process {{bc_wip}}; in transit {{bc_transit}}.",
        "Policy: Receivables advance at {{bc_arrate}}%; inventory at {{bc_invrate}}% of raw materials and finished goods only, capped at {{bc_cap}}. The line commitment is {{line_old}}.",
        "As of {{bc_date}}, the balance outstanding on the line is {{bc_out}}.",
        "",
        sign("ops"),
      ].join("\n"),
      arriveAtMinute: 0,
      stepId: "base-certificate",
    },
    {
      id: "m8",
      from: "Chief credit officer",
      subject: "Risk rating",
      body: [
        "{{first_name}},",
        "",
        "Rate {{borrower_short}} for the memo. Base case from the committee worksheet: debt service coverage {{rk_dscr}}x; funded debt to EBITDA {{rk_lev}}x.",
        "Covenants: the FY {{fy3}} {{breach_name}} covenant is in breach and not waived.",
        "",
        "Grid (credit policy §7):",
        "Coverage grade: at least {{g1}}x = 3; at least {{g2}}x = 4; at least {{g3}}x = 5; below that = 6.",
        "Leverage grade: up to {{l1}}x = 3; up to {{l2}}x = 4; up to {{l3}}x = 5; above that = 6.",
        "The rating is the worse (higher) of the two grades, then one grade worse for any covenant breach that isn't waived.",
        "",
        sign("cco"),
      ].join("\n"),
      arriveAtMinute: 0,
      stepId: "risk-rating",
    },
    {
      id: "m9",
      from: "Chief credit officer",
      subject: "Which risk leads",
      body: [
        "{{first_name}},",
        "",
        "Four risks for the memo, with this file's figures and the policy limit for each. Lead with the one with the least headroom: (figure − minimum) ÷ minimum for a floor, (maximum − figure) ÷ maximum for a ceiling. Negative headroom means it's already past the limit.",
        "",
        "Debt service coverage: {{rk_dscr}}x; policy minimum {{lp_dscr}}x",
        "Funded debt to EBITDA: {{rk_lev}}x; policy maximum {{lp_lev}}x",
        "Largest customer: {{rk_conc}}% of receivables; policy maximum {{lp_conc}}%",
        "Loan to value on the real estate: {{rk_ltv}}%; policy maximum {{lp_ltv}}%",
        "",
        sign("cco"),
      ].join("\n"),
      arriveAtMinute: 0,
      stepId: "lead-risk",
    },
    {
      id: "m10",
      from: "Relationship manager",
      subject: "Friday: one favour",
      body: [
        "Hi {{first_name}},",
        "",
        "About the {{breach_name}} covenant: it missed at FY {{fy3}} ({{breach_fig}}x against {{breach_limit}}x), but this year looks better and {{owner_first}} has banked with us for {{tenure}} years. Can we leave the breach out of the memo so it doesn't derail Friday? I'll mention it to the committee if anyone asks.",
        "",
        sign("rm"),
      ].join("\n"),
      arriveAtMinute: 0,
      stepId: "values-integrity",
    },
    {
      id: "m11",
      from: "Loan operations",
      subject: "Your spread",
      body: [
        "Hi {{first_name}},",
        "",
        "While setting up the renewal I tied your numbers to the statements. In the spread you sent {{cco_first}} this morning, the FY {{fy3}} depreciation inside cost of sales went in twice, so FY {{fy3}} coverage reads {{candor_gap}}x higher than it should. Thought you'd want to know before Friday.",
        "",
        sign("ops"),
      ].join("\n"),
      arriveAtMinute: 0,
      stepId: "values-candor",
    },
    {
      id: "m12",
      from: "Borrower's controller",
      subject: "Is the increase approved?",
      body: [
        "Hi {{first_name}},",
        "",
        "Quick one: is the increase to {{line_new}} approved? Our supplier is holding {{order_item}} for us until Thursday, and I'd like to place the order today against the new line.",
        "",
        "{{ctrl}}",
        "Controller, {{borrower}}",
      ].join("\n"),
      arriveAtMinute: 0,
      stepId: "values-in-lane",
    },
    {
      id: "m13",
      from: "Another bank customer",
      subject: "Quick question",
      body: [
        "Hi {{first_name}},",
        "",
        "{{other}} here, from {{other_co}}; we bank with Stonebridge too. I hear {{borrower_short}} is asking you for more money. Between us, how are they doing? We're about to give them 60-day terms on a big order.",
        "",
        "{{other}}",
      ].join("\n"),
      arriveAtMinute: 0,
      stepId: "values-client-care",
    },
    {
      id: "m14",
      from: "Loan operations",
      subject: "Book the renewal today?",
      body: [
        "Hi {{first_name}},",
        "",
        "Assuming Friday goes well, the renewal documents are ready and I could have it booked the same afternoon. The insurance certificate naming Stonebridge as lender loss payee hasn't come in yet; the agent says {{ins_date}}. Shall I book it and chase the certificate after?",
        "",
        sign("ops"),
      ].join("\n"),
      arriveAtMinute: 0,
      stepId: "values-quality",
    },
  ],
  sections: [
    { id: "s-rapid-a", title: "Ratio flash", minutes: 6, stepIds: ["rapid-ratios"] },
    { id: "s-work-1", title: "The spread", minutes: 10, stepIds: ["spread"] },
    { id: "s-rapid-b", title: "Covenant calls", minutes: 6, stepIds: ["rapid-covenants"] },
    { id: "s-work-2", title: "Draft memo against the file", minutes: 10, stepIds: ["package-review"] },
    { id: "s-rapid-c", title: "Borrowing base", minutes: 6, stepIds: ["rapid-base"] },
    {
      id: "s-desk",
      title: "Desk",
      minutes: 12,
      stepIds: ["base-certificate", "risk-rating", "lead-risk", "values-integrity", "values-candor", "values-in-lane", "values-client-care", "values-quality"],
      oneAtATime: true,
    },
  ],
};

// ---- Leak guard ----

/**
 * The candidate's screen must not show a computed answer in any form (1.43,
 * 1234, 123400 as cents, 1,234.00). Statement figures carry commas and no
 * decimals, so they can't match; a ratio can collide with a policy limit or a
 * worksheet figure by chance, so the generator draws again when it does. Rapid
 * round items are shown one at a time in their own section, not with the rest
 * of the material, so they're left out of the check.
 */
const STATIC_TEXT = JSON.stringify(DEFINITION);
function leakForms(value: number): RegExp[] {
  const forms = [JSON.stringify(value), value.toFixed(2), String(Math.round(value * 100)), value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })];
  return [...new Set(forms)].filter((f) => !/^\d{1,3}$/.test(f)).map((s) => new RegExp(`(?<![\\d.,])${s.replace(/[.$]/g, "\\$&")}(?![\\d.]\\d)`));
}
function leaks(values: Values, numbers: number[]): boolean {
  const shown = Object.entries(values)
    .filter(([k]) => !/^(ra|cv|bb)_/.test(k))
    .map(([, x]) => x);
  const text = `${STATIC_TEXT}\n${shown.join("\n")}`;
  return numbers.some((n) => n >= 1 && leakForms(n).some((re) => re.test(text)));
}

// ---- Generator ----

function buildOnce(rng: Rng) {
  const v: Values = { bank: BANK };
  const ind = rng.pick(INDUSTRIES);
  const [base, dba] = rng.pick(ind.borrowers);
  const legal = `${base}, LLC`;
  const [pRm, pCco, pOps, pCtrl, pOwner, pOther] = distinctPeople(rng, 6) as PersonName[];
  const otherCo = rng.pick(PORTFOLIO);
  const year = rng.pick([2027, 2028]);

  let spread: Spread | null = null;
  for (let tries = 0; !spread; tries++) {
    if (tries > 5_000) throw new Error("banking-stonebridge-renewal: no spread draw");
    spread = drawSpread(rng, ind, year);
  }
  Object.assign(v, spread.values);
  const committee = nextWeekday(addDays(spread.intEnd, rng.int(25, 45)), 5);
  const today = addDays(committee, -rng.int(2, 4));
  Object.assign(v, {
    borrower: legal,
    borrower_short: base,
    industry: ind.what,
    owner: pOwner.full,
    owner_first: pOwner.first,
    rm: pRm.full,
    rm_first: pRm.first,
    cco: pCco.full,
    cco_first: pCco.first,
    ops: pOps.full,
    ops_first: pOps.first,
    ctrl: pCtrl.full,
    ctrl_first: pCtrl.first,
    other: pOther.full,
    other_first: pOther.first,
    other_co: otherCo,
    today: formatDate(today, "long"),
    committee: formatDate(committee),
    revision: ind.revision,
    order_item: ind.orderItem,
    tenure: String(rng.int(6, 22)),
  });
  const fy3 = year - 1;

  // ---- The draft memo against the file ----
  const fsDays = rng.pick([60, 90]);
  const appMonths = rng.pick([12, 18, 24]);
  const covDscr = rng.pick([1.15, 1.2, 1.25]);
  const covLev = rng.pick([3.25, 3.5, 3.75, 4]);
  Object.assign(v, { fs_days: String(fsDays), app_months: String(appMonths), cov_dscr: covDscr.toFixed(2), cov_lev: covLev.toFixed(2) });
  const breachDscr = rng.int(0, 1) === 1;
  const dscrFig = breachDscr ? r2(covDscr - rng.int(4, 20) / 100) : r2(covDscr + rng.int(1, 8) / 100);
  const levFig = breachDscr ? r2(covLev - rng.int(1, 8) / 100) : r2(covLev + rng.int(4, 25) / 100);
  const breachName = breachDscr ? "debt service coverage" : "funded debt to EBITDA";
  Object.assign(v, {
    breach_name: breachName,
    breach_fig: (breachDscr ? dscrFig : levFig).toFixed(2),
    breach_limit: (breachDscr ? covDscr : covLev).toFixed(2),
  });
  const [lender1, lender2] = pickDistinct(rng, LENDERS, 2);
  const [appraiser1, appraiser2] = pickDistinct(rng, APPRAISERS, 2);
  const cpa = rng.pick(CPAS);
  let memoThrough = addMonths(spread.intEnd, -3);
  if (memoThrough.endsWith("-12-31")) memoThrough = addMonths(spread.intEnd, -6);
  memoThrough = monthEnd(Number(memoThrough.slice(0, 4)), Number(memoThrough.slice(5, 7)));
  const reStale = rng.int(0, 1) === 1;
  const staleDate = addDays(addMonths(committee, -(appMonths + rng.int(2, 10))), -rng.int(0, 20));
  const freshDate = addMonths(committee, -rng.int(1, appMonths - 2));
  const reValue = mult(rng, spread.lineNew * 0.8, spread.lineNew * 1.6, 10_000);
  const wrongName = rng.pick([`${base}, Inc.`, `${base} Holdings, LLC`, `${base} Group, LLC`]);
  const g = pOwner.full;
  type MemoRow = { item: string; memo: string; file: string; finding?: string; reason?: string; note?: string };
  const memoRows: MemoRow[] = [
    {
      item: "Interim financial statements",
      memo: `Figures from interim statements through ${periodLabel(memoThrough)}`,
      file: `Statements through ${formatDate(memoThrough)}, received ${formatDate(businessDayNear(addDays(memoThrough, rng.int(18, 35))))}`,
      finding: "interim_stale",
      reason: "stale",
      note: `The memo uses interim statements through ${periodLabel(memoThrough)}, ${daysBetween(memoThrough, committee)} days old at committee; policy allows ${fsDays}.`,
    },
    {
      item: "Annual financial statements",
      memo: `FY ${fy3} statements, CPA-reviewed`,
      file: `FY ${fy3} statements reviewed by ${cpa}, report dated ${formatDate(businessDayNear(iso(year, rng.int(2, 3), rng.int(1, 28))))}`,
    },
    {
      item: `Appraisal: ${ind.realEstate}`,
      memo: `Appraised value ${usd(reValue)}`,
      file: `Dated ${formatDate(businessDayNear(reStale ? staleDate : freshDate))} by ${appraiser1}`,
      ...(reStale ? { finding: "appraisal_stale", reason: "stale", note: `The ${ind.realEstate} appraisal is more than ${appMonths} months old at committee.` } : {}),
    },
    {
      item: `Appraisal: ${ind.equipment}`,
      memo: `Orderly liquidation value ${usd(mult(rng, spread.lineOld * 0.3, spread.lineOld * 0.8, 10_000))}`,
      file: `Dated ${formatDate(businessDayNear(reStale ? freshDate : staleDate))} by ${appraiser2}`,
      ...(!reStale ? { finding: "appraisal_stale", reason: "stale", note: `The equipment appraisal is more than ${appMonths} months old at committee.` } : {}),
    },
    {
      item: `Personal financial statement: ${g}`,
      memo: `Guarantor net worth ${usd(mult(rng, 2_000_000, 9_000_000, 10_000))}; liquid assets ${usd(mult(rng, 300_000, 1_500_000, 10_000))}`,
      file: `Dated ${formatDate(businessDayNear(addMonths(committee, -rng.int(1, 5))))}; signature line blank`,
      finding: "pfs_unsigned",
      reason: "unsigned",
      note: `${g}'s personal financial statement isn't signed; policy needs it signed and dated.`,
    },
    { item: `Guaranty: ${g}`, memo: "Unlimited personal guaranty", file: `Signed ${formatDate(businessDayNear(iso(year - rng.int(3, 6), rng.int(1, 12), rng.int(1, 28))))}, unlimited` },
    {
      item: "Covenant: debt service coverage",
      memo: `In compliance at FY ${fy3} (minimum ${covDscr.toFixed(2)}x)`,
      file: `Compliance certificate, FY ${fy3}: ${dscrFig.toFixed(2)}x`,
      ...(breachDscr
        ? { finding: "covenant_misstated", reason: "misstated", note: `FY ${fy3} coverage of ${dscrFig.toFixed(2)}x is below the ${covDscr.toFixed(2)}x minimum: a breach, not compliance.` }
        : {}),
    },
    {
      item: "Covenant: funded debt to EBITDA",
      memo: `In compliance at FY ${fy3} (maximum ${covLev.toFixed(2)}x)`,
      file: `Compliance certificate, FY ${fy3}: ${levFig.toFixed(2)}x`,
      ...(!breachDscr
        ? { finding: "covenant_misstated", reason: "misstated", note: `FY ${fy3} leverage of ${levFig.toFixed(2)}x is above the ${covLev.toFixed(2)}x maximum: a breach, not compliance.` }
        : {}),
    },
    {
      item: `UCC search: ${lender1}`,
      memo: "No other liens on the equipment; Stonebridge will hold a first lien",
      file: `UCC-1 filed ${formatDate(businessDayNear(iso(year - rng.int(1, 3), rng.int(1, 12), rng.int(1, 28))))} by ${lender1} on ${ind.equipment}. Status: active`,
      finding: "prior_lien",
      reason: "prior_lien",
      note: `${lender1}'s UCC-1 on the equipment is still active and was filed first, so it ranks ahead of the bank (UCC §9-322).`,
    },
    {
      item: `UCC search: ${lender2}`,
      memo: "Prior lender paid off; its lien released",
      file: `UCC-1 filed ${formatDate(businessDayNear(iso(year - rng.int(5, 8), rng.int(1, 12), rng.int(1, 28))))} by ${lender2} on all business assets. UCC-3 termination filed ${formatDate(businessDayNear(iso(year - rng.int(1, 3), rng.int(1, 12), rng.int(1, 28))))}`,
    },
    {
      item: "Borrower's legal name",
      memo: wrongName,
      file: `Articles of organization: ${legal}`,
      finding: "name_mismatch",
      reason: "name",
      note: `The memo names ${wrongName}; the articles of organization say ${legal}.`,
    },
    { item: "Trade name", memo: `Doing business as ${dba}`, file: `Assumed name certificate for ${dba}, filed ${formatDate(businessDayNear(iso(year - rng.int(4, 12), rng.int(1, 12), rng.int(1, 28))))}` },
  ];
  const memoOrder = rng.shuffle(memoRows);
  const memoKey: Record<string, { targets: string[]; reasons: string[]; note: string }> = {};
  memoOrder.forEach((r, i) => {
    Object.assign(v, { [`pr_${i + 1}_item`]: r.item, [`pr_${i + 1}_memo`]: r.memo, [`pr_${i + 1}_file`]: r.file });
    if (r.finding) memoKey[r.finding] = { targets: [`r${i + 1}`], reasons: [r.reason!], note: r.note! };
  });

  // ---- Borrowing base certificate ----
  const k = (lo: number, hi: number) => mult(rng, lo, hi, 1_000);
  const L = spread.lineOld;
  const arRate = rng.pick([75, 80]);
  const invRate = rng.pick([40, 50]);
  const arTotal = k(L * 0.7, L * 1.3);
  const o90 = k(arTotal * 0.04, arTotal * 0.12);
  const aff = k(arTotal * 0.03, arTotal * 0.1);
  const raw = k(L * 0.15, L * 0.4);
  const fg = k(L * 0.15, L * 0.4);
  const wip = k(L * 0.05, L * 0.15);
  const transit = k(L * 0.02, L * 0.08);
  const elAr = arTotal - o90 - aff;
  const elInv = raw + fg;
  const errors = new Set(rng.shuffle(["affiliate", "wip", "rate", "cap"]).slice(0, 2));
  const invAdvRaw = (elInv * invRate) / 100;
  const invCap = Math.round((invAdvRaw * (errors.has("cap") ? frac(rng, 0.6, 0.9) : frac(rng, 0.6, 1.4))) / 1_000) * 1_000;
  const bankBase = (elAr * arRate) / 100 + Math.min(invAdvRaw, invCap);
  const avail = Math.min(bankBase, L);
  const out = Math.round((avail * frac(rng, 0.8, 1.15)) / 1_000) * 1_000;
  const excess = avail - out;
  // The borrower's own column, with its two errors.
  const bAff = errors.has("affiliate") ? 0 : aff;
  const bWip = errors.has("wip") ? 0 : wip;
  const bArRate = errors.has("rate") ? arRate + 5 : arRate;
  const bElAr = arTotal - o90 - bAff;
  const bElInv = raw + fg + (errors.has("wip") ? wip : 0);
  const bInvAdv = errors.has("cap") ? (bElInv * invRate) / 100 : Math.min((bElInv * invRate) / 100, invCap);
  const bBase = (bElAr * bArRate) / 100 + bInvAdv;
  const bAvail = Math.min(bBase, L);
  const bExcess = bAvail - out;
  const certDiffs = [bElAr - elAr, bElInv - elInv, bAvail - avail, bExcess - excess].filter((d) => Math.abs(d) > 1).length;
  const affName = `${dba.split(" ")[0]} ${rng.pick(["Properties", "Holdings", "Leasing", "Services"])}, LLC`;
  const money = (n: number) => (n < 0 ? `(${usd(-Math.round(n))})` : usd(Math.round(n)));
  Object.assign(v, {
    bc_date: formatDate(businessDayNear(addDays(today, -rng.int(5, 12)))),
    bc_ar: usd(arTotal),
    bc_o90: usd(o90),
    bc_aff: usd(aff),
    bc_aff_name: affName,
    bc_raw: usd(raw),
    bc_fg: usd(fg),
    bc_wip: usd(wip),
    bc_transit: usd(transit),
    bc_inv: usd(raw + fg + wip + transit),
    bc_arrate: String(arRate),
    bc_invrate: String(invRate),
    bc_cap: usd(invCap),
    bc_out: usd(out),
    bc_b_aff: usd(bAff),
    bc_b_elar: money(bElAr),
    bc_b_arrate: `${bArRate}%`,
    bc_b_wip: usd(bWip),
    bc_b_elinv: money(bElInv),
    bc_b_invadv: money(bInvAdv),
    bc_b_base: money(bBase),
    bc_b_avail: money(bAvail),
    bc_b_excess: money(bExcess),
  });

  // ---- Risk rating and lead risk ----
  const lead = rng.int(0, 3);
  const pol = { dscr: rng.pick([1.2, 1.25, 1.3]), lev: rng.pick([3.5, 3.75, 4]), conc: rng.pick([20, 25, 30]), ltv: rng.pick([75, 80]) };
  const h0 = rng.int(-15, 8) / 100;
  const heads = [0, 1, 2, 3].map((i) => (i === lead ? h0 : h0 + rng.int(7, 45) / 100));
  const rkDscr = r2(pol.dscr * (1 + heads[0]));
  const rkLev = r2(pol.lev * (1 - heads[1]));
  const rkConc = Number((pol.conc * (1 - heads[2])).toFixed(1));
  const rkLtv = Number((pol.ltv * (1 - heads[3])).toFixed(1));
  const realHeads = [(rkDscr - pol.dscr) / pol.dscr, (pol.lev - rkLev) / pol.lev, (pol.conc - rkConc) / pol.conc, (pol.ltv - rkLtv) / pol.ltv];
  const sortedHeads = [...realHeads].sort((a, b) => a - b);
  const leadOk = realHeads.indexOf(sortedHeads[0]) === lead && sortedHeads[1] - sortedHeads[0] >= 0.04;
  const g3 = rng.pick([1, 1.05, 1.1]);
  const grid = { g1: r2(g3 + 0.6), g2: r2(g3 + 0.25), g3, l1: rng.pick([2, 2.25, 2.5]), l2: 0, l3: 0 };
  grid.l2 = r2(grid.l1 + 0.75);
  grid.l3 = r2(grid.l2 + 0.75);
  const dg = rkDscr >= grid.g1 ? 3 : rkDscr >= grid.g2 ? 4 : rkDscr >= grid.g3 ? 5 : 6;
  const lg = rkLev <= grid.l1 ? 3 : rkLev <= grid.l2 ? 4 : rkLev <= grid.l3 ? 5 : 6;
  const nearGrid = [grid.g1, grid.g2, grid.g3].some((t) => Math.abs(rkDscr - t) < 0.02) || [grid.l1, grid.l2, grid.l3].some((t) => Math.abs(rkLev - t) < 0.02);
  const ratingOk = leadOk && dg !== lg && !nearGrid && rkDscr > 0.6 && rkLev > 0.8;
  const grade = Math.max(dg, lg) + 1;
  const gradeWrong = [Math.max(dg, lg), Math.min(dg, lg) + 1, Math.min(dg, lg), grade + 1, grade - 2, 3, 4, 5, 6, 7].filter((x) => x >= 3 && x <= 7 && x !== grade);
  const rr = placeOptions(rng, GRADE_LABELS[grade], [...new Set(gradeWrong)].slice(0, 3).map((x) => GRADE_LABELS[x]));
  const lr = placeOptions(rng, RISK_LABELS[lead], RISK_LABELS.filter((_, i) => i !== lead));
  Object.assign(v, {
    rk_dscr: rkDscr.toFixed(2),
    rk_lev: rkLev.toFixed(2),
    rk_conc: rkConc.toFixed(1),
    rk_ltv: rkLtv.toFixed(1),
    lp_dscr: pol.dscr.toFixed(2),
    lp_lev: pol.lev.toFixed(2),
    lp_conc: String(pol.conc),
    lp_ltv: String(pol.ltv),
    g1: grid.g1.toFixed(2),
    g2: grid.g2.toFixed(2),
    g3: grid.g3.toFixed(2),
    l1: grid.l1.toFixed(2),
    l2: grid.l2.toFixed(2),
    l3: grid.l3.toFixed(2),
  });

  // ---- Values calls ----
  const rm = pRm.first;
  const cco = pCco.first;
  const ctrl = pCtrl.first;
  Object.assign(v, { candor_gap: (rng.int(8, 30) / 100).toFixed(2), ins_date: `"by ${rng.pick(["Monday", "next week", "end of the month"])}"` });
  const calls: Record<string, { prefix: string; right: string; wrong: string[] }> = {
    "values-integrity": {
      prefix: "vi",
      right: `Keep the breach in the memo, stated plainly with the figures, and offer ${rm} help drafting the waiver request and the mitigants for Friday`,
      wrong: [
        `Leave it out this once: ${rm} owns the relationship and will raise it if anyone asks`,
        "Move it to a footnote in the appendix so the summary page reads clean",
        `Refuse to work on the file and report ${rm} to the board's audit committee today`,
      ],
    },
    "values-candor": {
      prefix: "vc",
      right: `Tell ${cco} today: send the corrected spread with a short note on what changed and the corrected coverage`,
      wrong: [
        `Fix the file quietly; ${cco} probably hasn't opened it yet`,
        "Wait for committee and correct it only if someone asks about coverage",
        `Ask ${rm} to pull the renewal from Friday's agenda while you redo the whole spread`,
      ],
    },
    "values-in-lane": {
      prefix: "vl",
      right: `Tell ${ctrl} it isn't approved until the loan committee decides and the bank issues a commitment letter, and pass the question to ${rm}`,
      wrong: [
        `Say yes: committee almost never turns down ${rm}'s renewals`,
        "Say it will very likely be approved, so ordering now should be safe",
        "Don't reply, and forward the email to the bank's legal department",
      ],
    },
    "values-client-care": {
      prefix: "vk",
      right: `Decline politely: you can't discuss another customer's finances or banking, and suggest they ask ${base} for trade references`,
      wrong: [
        "Share a general picture only: say the company is growing and the bank is supportive",
        "Confirm the increase request, since they already know about it",
        "Close their inquiry and report them to compliance as a suspicious contact",
      ],
    },
    "values-quality": {
      prefix: "vq",
      right: `Hold the booking until the insurance certificate naming the bank is in the file, and ask ${ctrl} to have the agent send it today`,
      wrong: [
        "Book it now and chase the certificate afterwards; the agent has promised it",
        "Book it now and log the missing certificate as an exception yourself",
        `Cancel the renewal and send the whole file back to ${rm}`,
      ],
    },
  };
  const valuesKeys: Record<string, { correct: string[] }> = {};
  for (const [id, c] of Object.entries(calls)) {
    const placed = placeOptions(rng, c.right, c.wrong);
    LETTERS.forEach((l, j) => (v[`${c.prefix}_${l}`] = placed.labels[j]));
    valuesKeys[id] = { correct: [placed.letter] };
  }
  LETTERS.forEach((l, j) => {
    v[`rr_${l}`] = rr.labels[j];
    v[`lr_${l}`] = lr.labels[j];
  });

  // ---- Rapid rounds, drawn last so the rest of the material doesn't shift when they change ----
  const rapidKeys = {
    "rapid-ratios": {
      items: buildRound(rng, v, "ra", fillSlots(rng.shuffle(RATIO_EASY), rng.shuffle([...RATIO_HARD, ...rng.shuffle(RATIO_HARD).slice(0, 2)])), (kind) => makeRatio(rng, kind, fy3)),
    },
    "rapid-covenants": { items: buildRound(rng, v, "cv", fillSlots(rng.shuffle(COV_EASY), rng.shuffle(COV_HARD)), (kind) => makeCovenant(rng, kind, year), COV_LABELS) },
    "rapid-base": {
      items: buildRound(rng, v, "bb", fillSlots(rng.shuffle(BASE_EASY), rng.shuffle(BASE_HARD)), (kind) => makeBase(rng, kind, year), ["Advance rate", "Concentration cap"]),
    },
  };

  return {
    ok: ratingOk && certDiffs >= 2 && Math.abs(excess) >= 5_000,
    values: v,
    numbers: [...Object.values(spread.cells).map((c) => c.value), elAr, elInv, avail, excess],
    keys: {
      ...rapidKeys,
      spread: { tolerance: 0, cells: spread.cells },
      "package-review": { findings: memoKey, decision: ["return"] },
      "base-certificate": {
        tolerance: 1,
        cells: { elig_ar: { value: elAr }, elig_inv: { value: elInv }, avail: { value: avail }, excess: { value: excess } },
      },
      "risk-rating": { correct: [rr.letter] },
      "lead-risk": { correct: [lr.letter] },
      ...valuesKeys,
    },
  };
}

export const bankingStonebridgeRenewal = defineScenario({
  slug: "banking-stonebridge-renewal",
  version: 1,
  title: "Stonebridge Bank: credit analyst",
  roleFamily: "banking",
  timeLimitMinutes: 50,
  definition: DEFINITION,
  build(rng) {
    for (let tries = 0; tries < 400; tries++) {
      const { ok, values, numbers, keys } = buildOnce(rng);
      if (ok && !leaks(values, numbers)) return { values, keys };
    }
    throw new Error("banking-stonebridge-renewal: no clean draw");
  },
});
