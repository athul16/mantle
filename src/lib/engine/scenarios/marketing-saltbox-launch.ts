import "server-only";

import type { Rng } from "../server/rng";
import { defineScenario } from "../server/scenario";
import { DOCUMENT_REVIEW } from "../step-types/document_review/public";
import { MULTIPLE_CHOICE } from "../step-types/multiple_choice/public";
import { NUMERIC } from "../step-types/numeric/public";
import { RAPID_ROUND } from "../step-types/rapid_round/public";
import { SPREADSHEET } from "../step-types/spreadsheet/public";
import { addDays, distinctPeople, formatDate, pickDistinct, weekdayOf, type IsoDate } from "./legal";

/**
 * Marketing coordinator at Saltbox Provisions, a (fictional) direct-to-consumer
 * brand, in launch week for a new product. Six timed sections, 50 minutes, 100
 * points, all scored automatically:
 *
 *   rapid round A, campaign metrics (10) → launch-week channel report (20) →
 *   rapid round B, copy vs. the launch sheet (10) → launch QA of twelve assets
 *   (20) → rapid round C, budget maths (10) → desk, one screen at a time: agency
 *   invoice vs. the statement of work (12), A/B readout (4), A/B lift (4) and
 *   five values calls (2 each).
 *
 * Seeded per candidate: the product line and product, every person, the
 * agency, prices, codes, tags, dates and numbers; which campaign is doubled,
 * revised or has no orders; which asset, copy and invoice line carries which
 * trap; and where the right option sits. Formulas, the test plan and the
 * suppression rules are Saltbox policy, handed over on the cards in the inbox.
 *
 * Rapid rounds: 15 items × 20 s. Items 3, 6, 9, 12, 15 are the harder kinds,
 * worth 1; the other ten are worth ½, so each round is exactly 10.
 *
 * Draft v1: practitioner review pending (docs/marketing/marketing-saltbox-launch.md).
 */

const LETTERS = ["a", "b", "c", "d"] as const;
type Values = Record<string, string>;
type ChoiceKey = Record<string, { choice: string }>;

const fmt = (n: number) => n.toLocaleString("en-US");
/** Whole cents → "$1,234.56". Fractional cents are rounded. */
const money = (cents: number) => {
  const c = Math.round(cents);
  return `${c < 0 ? "-" : ""}$${(Math.abs(c) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};
const pct2 = (x: number) => `${x.toFixed(2)}%`;
const signed1 = (x: number) => `${x >= 0 ? "+" : "-"}${Math.abs(x).toFixed(1)}%`;
const ratio = (x: number) => `${x.toFixed(2)}x`;
const round2 = (x: number) => Math.round(x * 100) / 100;
const round1 = (x: number) => Math.round(x * 10) / 10;
/** A whole number of `step` between lo and hi. */
const mult = (rng: Rng, lo: number, hi: number, step: number) => rng.int(Math.ceil(lo / step), Math.floor(hi / step)) * step;

const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "Nov 17" */
const monthDay = (d: IsoDate) => `${MONTH_SHORT[Number(d.slice(5, 7)) - 1]} ${Number(d.slice(8, 10))}`;
/** Minutes after midnight → "9:30 AM". */
function clock(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

// ---- Product lines ----

interface ProductLine {
  line: string;
  names: string[];
  price: [number, number];
  allowed: string[];
  notAllowed: string[];
  /** What a creator partner wants to call "clinically proven". */
  proven: string;
}

const PRODUCT_LINES: ProductLine[] = [
  {
    line: "cookware",
    names: ["EmberPan Skillet", "HearthCraft Dutch Oven", "SearLine Carbon Wok"],
    price: [89, 189],
    allowed: ["oven-safe to 500°F", "works on induction", "free returns for 30 days"],
    notAllowed: ["lasts a lifetime", "100% non-toxic", "the last pan you'll ever buy"],
    proven: "cook food more evenly",
  },
  {
    line: "coffee gear",
    names: ["PourCraft Kettle", "BrewLine Burr Grinder", "DripWell Pour-Over Set"],
    price: [49, 149],
    allowed: ["gooseneck spout for a steady pour", "two-year warranty", "free returns for 30 days"],
    notAllowed: ["café-quality coffee every time", "never needs descaling", "baristas' #1 choice"],
    proven: "make coffee taste better",
  },
  {
    line: "pet food",
    names: ["TrueHowl Salmon Kibble", "PawMeadow Turkey Stew", "TailCrest Lamb Bites"],
    price: [39, 89],
    allowed: ["made with real salmon", "no artificial colors", "ships free in two days"],
    notAllowed: ["vet-recommended", "cures itchy skin", "adds years to your dog's life"],
    proven: "improve digestion",
  },
  {
    line: "skincare",
    names: ["DewRoot Barrier Serum", "SaltLeaf Night Cream", "CalmTide Face Oil"],
    price: [28, 78],
    allowed: ["fragrance-free", "vegan formula", "free returns for 30 days"],
    notAllowed: ["heals eczema", "erases wrinkles", "safe for every skin type"],
    proven: "reduce redness",
  },
  {
    line: "luggage",
    names: ["Waypoint Carry-On", "NorthBound Checked Spinner", "TrailKit Weekender"],
    price: [149, 349],
    allowed: ["polycarbonate shell", "10-year warranty", "free returns for 30 days"],
    notAllowed: ["unbreakable", "fits every airline's carry-on limit", "TSA approved"],
    proven: "reduce back strain",
  },
];

const AGENCIES = ["Lanternfish Media", "Kitefield Agency", "Brightwell Collective", "Fathom & Finch", "Northpaw Digital"];
const OLD_CODES = ["WELCOME10", "SALTBOX10", "FALLHAUL12", "TAKE10NOW", "SPRING15"];
const SUPPRESSION_POOL = ["Refund in last 60 days", "Wholesale accounts", "Saltbox employees", "Open chargebacks", "Do-not-market list"];
const EMAIL_UNSUBS = "Email unsubscribes";

// ---- Rapid round plumbing ----

const RAPID_ITEMS = 15;
/** Items 3, 6, 9, 12 and 15 are worth 1; the rest ½. 10 points a round. */
const isHardSlot = (i: number) => i % 3 === 2;
const slotNo = (i: number) => String(i + 1).padStart(2, "0");

function fillSlots<T>(easy: T[], hard: T[]): T[] {
  const e = [...easy];
  const h = [...hard];
  const out = Array.from({ length: RAPID_ITEMS }, (_, i) => (isHardSlot(i) ? h.shift() : e.shift()));
  if (out.some((x) => x === undefined) || e.length || h.length) throw new Error("marketing-saltbox-launch: rapid slots don't fill");
  return out as T[];
}

const letterOptions = (name: string) => LETTERS.map((l) => ({ id: l, label: `{{${name}_${l}}}` }));
const answerField = (name: string) => [{ id: "answer", label: "Answer", kind: "choice", options: letterOptions(name) }];
const EXHIBIT_ROWS = 5;

function rapidStep(id: string, title: string, intro: string, prefix: string) {
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
            rows: Array.from({ length: EXHIBIT_ROWS }, (_, r) => ({ label: `{{${prefix}_${n}_l${r + 1}}}`, value: `{{${prefix}_${n}_v${r + 1}}}` })),
          },
          fields: answerField(`${prefix}_${n}`),
          points: isHardSlot(i) ? 1 : 0.5,
        };
      }),
    },
  };
}

/** Puts `right` among `wrong` in a random place; returns the labels by letter and the right letter. */
function placeOptions(rng: Rng, right: string, wrong: string[]): { labels: string[]; letter: string } {
  if (wrong.length !== 3 || new Set([right, ...wrong]).size !== 4) throw new Error(`marketing-saltbox-launch: options must be 4 different labels (${right})`);
  const labels = rng.shuffle([right, ...wrong]);
  return { labels, letter: LETTERS[labels.indexOf(right)] };
}

/** The first three distinct candidates that aren't the right answer, or null when there aren't three. */
function threeWrong(right: string, candidates: string[]): string[] | null {
  const wrong = [...new Set(candidates)].filter((c) => c !== right).slice(0, 3);
  return wrong.length === 3 ? wrong : null;
}

interface RapidItemDraft {
  prompt: string;
  title: string;
  rows: [string, string][];
  right: string;
  wrong: string[];
}

/** Writes one item's values and returns its key. */
function setItem(rng: Rng, v: Values, prefix: string, i: number, d: RapidItemDraft): [string, ChoiceKey] {
  const n = slotNo(i);
  if (d.rows.length !== EXHIBIT_ROWS) throw new Error(`marketing-saltbox-launch: ${prefix}-${n} needs ${EXHIBIT_ROWS} exhibit rows`);
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

/** Draws until `make` returns an item with four distinct options. */
function draw(make: () => RapidItemDraft | null, what: string): RapidItemDraft {
  for (let tries = 0; tries < 5_000; tries++) {
    const d = make();
    if (d) return d;
  }
  throw new Error(`marketing-saltbox-launch: no ${what} item`);
}

// ---- Channels (shared by the report and rapid round A) ----

type ChannelId = "search" | "social" | "email" | "affiliate" | "display";
const CHANNELS: ChannelId[] = ["search", "social", "email", "affiliate", "display"];
const CHANNEL_NAMES: Record<ChannelId, string> = {
  search: "Paid search",
  social: "Paid social",
  email: "Email",
  affiliate: "Affiliates",
  display: "Display",
};
const CHANNEL_CODES: Record<ChannelId, string> = { search: "SRCH", social: "SOCL", email: "EML", affiliate: "AFF", display: "DSP" };
/** Plausible weekly ranges: spend (dollars), CPC (dollars), CTR and conversion rate (percent). */
const CHANNEL_SHAPE: Record<ChannelId, { spend: [number, number]; cpc: [number, number]; ctr: [number, number]; cvr: [number, number] }> = {
  search: { spend: [2_500, 7_500], cpc: [0.8, 2.6], ctr: [3, 7], cvr: [2, 5] },
  social: { spend: [3_000, 9_000], cpc: [0.6, 1.8], ctr: [0.8, 1.8], cvr: [1, 3] },
  email: { spend: [300, 1_100], cpc: [0.08, 0.25], ctr: [2, 6], cvr: [3, 7] },
  affiliate: { spend: [1_200, 4_500], cpc: [0.9, 2.2], ctr: [1, 3], cvr: [2, 4] },
  display: { spend: [1_500, 5_000], cpc: [0.4, 1.2], ctr: [0.1, 0.4], cvr: [0.5, 1.5] },
};

// ---- Rapid round A: campaign metrics ----

type MetricKind = "ctr" | "cpc" | "cpa" | "cvr" | "cpm" | "blended_cpa" | "blended_roas" | "change" | "pacing";
const MET_EASY: MetricKind[] = ["ctr", "ctr", "cpc", "cpc", "cpa", "cpa", "cvr", "cvr", "cpm", "cpm"];
const MET_HARD: MetricKind[] = ["blended_cpa", "blended_roas", "change", "change", "pacing"];
const MET_PROMPT: Record<"ctr" | "cpc" | "cpa" | "cvr" | "cpm", string> = {
  ctr: "CTR",
  cpc: "CPC",
  cpa: "CPA",
  cvr: "conversion rate",
  cpm: "CPM",
};

const rapidMetricsStep = rapidStep(
  "rapid-metrics",
  "Rapid round: campaign metrics",
  [
    "Campaign metrics: 15 items, 20 seconds each. Each shows one line of last week's numbers; pick the right figure.",
    "Saltbox's reporting rules: CTR = clicks ÷ impressions; CPC = spend ÷ clicks; CPM = spend ÷ impressions × 1,000; conversion rate = orders ÷ clicks; CPA = spend ÷ orders; net revenue = revenue − refunds; ROAS = net revenue ÷ spend. Blended figures come from totals, never the average of channel ratios. Pacing: on pace means the share of budget spent is within 5 (in percent) of the share of the month elapsed.",
  ].join("\n"),
  "mt",
);

function weekLabel(rng: Rng): string {
  const start = addDays("2026-09-07", 7 * rng.int(0, 40));
  return `week of ${monthDay(start)}`;
}

function channelLine(rng: Rng, ch: ChannelId) {
  const s = CHANNEL_SHAPE[ch];
  const spend = rng.cents(s.spend[0], s.spend[1]);
  const cpc = rng.int(Math.round(s.cpc[0] * 100), Math.round(s.cpc[1] * 100));
  const clicks = Math.max(200, Math.round(spend / cpc));
  const ctr = rng.int(Math.round(s.ctr[0] * 100), Math.round(s.ctr[1] * 100)) / 10_000;
  const impressions = Math.round(clicks / ctr);
  const cvr = rng.int(Math.round(s.cvr[0] * 100), Math.round(s.cvr[1] * 100)) / 10_000;
  const orders = Math.max(4, Math.round(clicks * cvr));
  return { spend, clicks, impressions, orders };
}

function buildMetrics(rng: Rng, v: Values): Record<string, ChoiceKey> {
  const kinds = fillSlots(rng.shuffle(MET_EASY), rng.shuffle(MET_HARD));
  return Object.fromEntries(
    kinds.map((kind, i) => {
      const d = draw(() => {
        const ch = rng.pick(CHANNELS);
        const name = CHANNEL_NAMES[ch];
        const week = weekLabel(rng);
        if (kind === "ctr" || kind === "cpc" || kind === "cpa" || kind === "cvr" || kind === "cpm") {
          const { spend, clicks, impressions, orders } = channelLine(rng, ch);
          const rows: [string, string][] = [
            ["Impressions", fmt(impressions)],
            ["Clicks", fmt(clicks)],
            ["Orders", fmt(orders)],
            ["Spend", money(spend)],
            ["Rounding", kind === "ctr" || kind === "cvr" ? "Percent, two decimals" : "To the cent"],
          ];
          const perClick = spend / clicks;
          const perOrder = spend / orders;
          const perMille = (spend / impressions) * 1000;
          let right: string;
          let cands: string[];
          switch (kind) {
            case "ctr":
              right = pct2((100 * clicks) / impressions);
              cands = [pct2((100 * orders) / clicks), `${(clicks / impressions).toFixed(2)}%`, pct2((1000 * clicks) / impressions)];
              break;
            case "cvr":
              right = pct2((100 * orders) / clicks);
              cands = [pct2((100 * orders) / impressions), pct2((100 * clicks) / impressions), `${(orders / clicks).toFixed(2)}%`];
              break;
            case "cpc":
              right = money(perClick);
              cands = [money((100 * clicks) / spend), money(perOrder), money(perMille)];
              break;
            case "cpa":
              right = money(perOrder);
              cands = [money(perClick), money((100 * orders) / spend), money(perMille)];
              break;
            default:
              right = money(perMille);
              cands = [money(spend / impressions), money(perClick), money((spend / impressions) * 100)];
          }
          const wrong = threeWrong(right, cands);
          if (!wrong) return null;
          return { title: `${name} · ${week}`, prompt: `What was ${name.toLowerCase()}'s ${MET_PROMPT[kind]}?`, rows, right, wrong };
        }
        if (kind === "blended_cpa") {
          const [c1, c2] = pickDistinct(rng, CHANNELS, 2);
          const a = channelLine(rng, c1);
          const b = channelLine(rng, c2);
          const cpa1 = a.spend / a.orders;
          const cpa2 = b.spend / b.orders;
          if (Math.abs(cpa1 - cpa2) < 300) return null; // the average of ratios must be a real trap
          const right = money((a.spend + b.spend) / (a.orders + b.orders));
          const wrong = threeWrong(right, [money((cpa1 + cpa2) / 2), money(cpa1 + cpa2), money(a.orders > b.orders ? cpa1 : cpa2)]);
          if (!wrong) return null;
          return {
            title: `Two channels · ${week}`,
            prompt: `What is the blended CPA for ${CHANNEL_NAMES[c1].toLowerCase()} and ${CHANNEL_NAMES[c2].toLowerCase()} together?`,
            rows: [
              [CHANNEL_NAMES[c1], `Spend ${money(a.spend)} · ${fmt(a.orders)} orders`],
              [CHANNEL_NAMES[c2], `Spend ${money(b.spend)} · ${fmt(b.orders)} orders`],
              ["Measure", "Blended CPA"],
              ["Source", "Ads manager export, last 7 days"],
              ["Rounding", "To the cent"],
            ],
            right,
            wrong,
          };
        }
        if (kind === "blended_roas") {
          const [c1, c2] = pickDistinct(rng, CHANNELS, 2);
          const lines = [c1, c2].map((c) => {
            const l = channelLine(rng, c);
            const revenue = l.spend * (rng.int(150, 600) / 100) + rng.int(0, 99);
            const refunds = Math.round((revenue * rng.int(3, 12)) / 100) + rng.int(0, 99);
            return { spend: l.spend, revenue: Math.round(revenue), refunds };
          });
          const spend = lines[0].spend + lines[1].spend;
          const net = lines.reduce((s, l) => s + l.revenue - l.refunds, 0);
          const gross = lines.reduce((s, l) => s + l.revenue, 0);
          const right = ratio(net / spend);
          const avg = lines.reduce((s, l) => s + (l.revenue - l.refunds) / l.spend, 0) / 2;
          const wrong = threeWrong(right, [ratio(gross / spend), ratio(avg), ratio(spend / net)]);
          if (!wrong) return null;
          return {
            title: `Two channels · ${week}`,
            prompt: `What is the blended ROAS for ${CHANNEL_NAMES[c1].toLowerCase()} and ${CHANNEL_NAMES[c2].toLowerCase()} together?`,
            rows: [
              [CHANNEL_NAMES[c1], `Spend ${money(lines[0].spend)} · revenue ${money(lines[0].revenue)} · refunds ${money(lines[0].refunds)}`],
              [CHANNEL_NAMES[c2], `Spend ${money(lines[1].spend)} · revenue ${money(lines[1].revenue)} · refunds ${money(lines[1].refunds)}`],
              ["Measure", "Blended ROAS"],
              ["Source", "Ads manager and Shopify exports, last 7 days"],
              ["Rounding", "Two decimals"],
            ],
            right,
            wrong,
          };
        }
        if (kind === "change") {
          const l = channelLine(rng, ch);
          const metric = rng.pick(["Orders", "Spend", "CPA"] as const);
          const factor = (rng.int(0, 1) ? 1 : -1) * (rng.int(40, 450) / 10);
          let last: number;
          let now: number;
          let show: (x: number) => string;
          if (metric === "Orders") {
            last = l.orders + 40;
            now = Math.round(last * (1 + factor / 100));
            show = fmt;
          } else if (metric === "Spend") {
            last = l.spend;
            now = Math.round(last * (1 + factor / 100));
            show = money;
          } else {
            last = Math.round(l.spend / l.orders);
            now = Math.round(last * (1 + factor / 100));
            show = money;
          }
          if (now === last) return null;
          const change = ((now - last) / last) * 100;
          const right = signed1(change);
          const wrong = threeWrong(right, [signed1(((now - last) / now) * 100), signed1(-change), `${change >= 0 ? "+" : "-"}${Math.abs((now - last) / last).toFixed(2)}%`]);
          if (!wrong || Math.abs(change) < 3) return null;
          return {
            title: `${name} · ${week}`,
            prompt: `By how much did ${name.toLowerCase()}'s ${metric === "CPA" ? "CPA" : metric.toLowerCase()} change vs. the week before?`,
            rows: [
              ["Metric", metric],
              ["Week before", show(last)],
              ["This week", show(now)],
              ["Measure", "Percent change vs. the week before"],
              ["Rounding", "One decimal; + up, - down"],
            ],
            right,
            wrong,
          };
        }
        // pacing
        const budget = mult(rng, 8_000, 60_000, 500) * 100;
        const days = rng.pick([30, 31]);
        const elapsed = rng.int(6, days - 6);
        const dayShare = (100 * elapsed) / days;
        const target = rng.pick([-1, 0, 1]);
        const delta = target === 0 ? rng.int(-30, 30) / 10 : target * (rng.int(80, 220) / 10);
        const spent = Math.round((budget * (dayShare + delta)) / 100) + rng.int(0, 99);
        const spentShare = (100 * spent) / budget;
        const gap = spentShare - dayShare;
        if (Math.abs(Math.abs(gap) - 5) < 1.2 || spentShare >= 100 || spentShare < 3) return null;
        const verdict = gap > 5 ? "Ahead of pace" : gap < -5 ? "Behind pace" : "On pace";
        const sp = Math.round(spentShare);
        const dp = Math.round(dayShare);
        if (dp === 50) return null;
        const label = (v: string, d: number) => `${v}: ${sp}% spent, ${d}% of the month gone`;
        const remGap = spentShare - (100 - dayShare);
        const remVerdict = remGap > 5 ? "Ahead of pace" : remGap < -5 ? "Behind pace" : "On pace";
        const others = ["Ahead of pace", "On pace", "Behind pace"].filter((x) => x !== verdict).map((x) => label(x, dp));
        const wrong = threeWrong(label(verdict, dp), [...others, label(remVerdict, 100 - dp)]);
        if (!wrong || wrong.length !== 3 || !wrong.includes(label(remVerdict, 100 - dp))) return null;
        return {
          title: `${name} · monthly budget`,
          prompt: `Is ${name.toLowerCase()} ahead of, on or behind pace this month?`,
          rows: [
            ["Monthly budget", money(budget)],
            ["Spent to date", money(spent)],
            ["Days elapsed", `${elapsed} of ${days}`],
            ["On-pace rule", "Share spent within ±5% of the share of the month elapsed"],
            ["Shares", "Rounded to whole percents"],
          ],
          right: label(verdict, dp),
          wrong,
        };
      }, kind);
      return setItem(rng, v, "mt", i, d);
    }),
  );
}

// ---- Section 2: launch-week channel report ----

const REPORT_COLUMNS = ["Campaign ID", "Channel", "Status", "Spend", "Impressions", "Clicks", "Orders", "Revenue", "Refunds"];
const EXPORT_ROWS = 7;
const blank = () => Array.from({ length: REPORT_COLUMNS.length }, () => null);
const rightCell = (text: string) => ({ text, align: "right" as const });

const campaignReportStep = {
  id: "campaign-report",
  type: SPREADSHEET,
  title: "Launch week: channel report",
  config: {
    prompt: [
      "The ads export for launch week is at the top. Fill in the summary below it: each channel's net revenue, CPA and ROAS, then the totals.",
      "Money to the cent, ROAS to two decimals (for example 3.42). Count each campaign ID once. If a channel has no orders, leave its CPA blank.",
    ].join("\n"),
    columns: REPORT_COLUMNS,
    rows: [
      ...Array.from({ length: EXPORT_ROWS }, (_, i) => [
        `{{ex_${i + 1}_id}}`,
        `{{ex_${i + 1}_ch}}`,
        `{{ex_${i + 1}_status}}`,
        rightCell(`{{ex_${i + 1}_spend}}`),
        rightCell(`{{ex_${i + 1}_impr}}`),
        rightCell(`{{ex_${i + 1}_clicks}}`),
        rightCell(`{{ex_${i + 1}_orders}}`),
        rightCell(`{{ex_${i + 1}_rev}}`),
        rightCell(`{{ex_${i + 1}_ref}}`),
      ]),
      blank(),
      [
        { text: "Summary", bold: true },
        { text: "Channel", bold: true },
        null,
        { text: "Net revenue ($)", bold: true, align: "right" },
        { text: "CPA ($)", bold: true, align: "right" },
        { text: "ROAS", bold: true, align: "right" },
        null,
        null,
        null,
      ],
      ...CHANNELS.map((ch) => [
        null,
        CHANNEL_NAMES[ch],
        null,
        { input: `${ch}_net`, label: `${CHANNEL_NAMES[ch]}: net revenue`, format: "money" },
        { input: `${ch}_cpa`, label: `${CHANNEL_NAMES[ch]}: CPA`, format: "money" },
        { input: `${ch}_roas`, label: `${CHANNEL_NAMES[ch]}: ROAS`, format: "number" },
        null,
        null,
        null,
      ]),
      [
        null,
        { text: "Total / blended", bold: true },
        null,
        { input: "total_net", label: "Total net revenue", format: "money", points: 2 },
        { input: "blended_cpa", label: "Blended CPA", format: "money", points: 2 },
        { input: "blended_roas", label: "Blended ROAS", format: "number", points: 2 },
        null,
        null,
        null,
      ],
    ],
  },
};

interface Campaign {
  id: string;
  ch: ChannelId;
  spend: number;
  impressions: number;
  clicks: number;
  orders: number;
  revenue: number;
  refunds: number;
}

// ---- Rapid round B: copy vs. the launch sheet ----

type CopyIssue = "price" | "code" | "name" | "claim" | "legal";
type CopyKind = "fine" | CopyIssue | "two" | "weekday" | "disclosure";
const COPY_EASY: CopyKind[] = ["fine", "fine", "price", "code", "name", "claim", "legal", "price", "code", "legal"];
const COPY_LABEL: Record<"fine" | CopyIssue | "weekday" | "date" | "disclosure", string> = {
  fine: "Fine to publish",
  price: "Wrong price",
  code: "Wrong promo code",
  name: "Wrong product name",
  claim: "Claim not allowed",
  legal: "Missing legal line",
  weekday: "Wrong day of the week",
  date: "Wrong launch date",
  disclosure: "Missing #ad disclosure",
};
const ISSUE_ORDER: CopyIssue[] = ["price", "code", "name", "claim", "legal"];
const pairLabel = (a: CopyIssue, b: CopyIssue) => {
  const [x, y] = [a, b].sort((p, q) => ISSUE_ORDER.indexOf(p) - ISSUE_ORDER.indexOf(q));
  return `${COPY_LABEL[x]} and ${COPY_LABEL[y].toLowerCase()}`;
};
const COPY_ASSETS = ["Email body", "SMS", "Paid social ad", "Landing page hero", "Paid search ad", "Push notification"];
const OPENERS = ["It's here:", "Launch day:", "New from Saltbox:", "Meet the"];

const rapidCopyStep = rapidStep(
  "rapid-copy",
  "Rapid round: copy check",
  [
    "Copy check: 15 pieces of launch copy, 20 seconds each. Compare each with the launch sheet line shown and pick what's wrong, if anything.",
    "Saltbox's rules: product names exactly as written; promo codes aren't case sensitive; every piece with the offer carries the legal line; only approved claims; paid creator posts open with #ad.",
  ].join("\n"),
  "cp",
);

// ---- Section 4: launch QA ----

interface Asset {
  name: string;
  source: string;
  medium: string;
  audiences: string[];
}
const ASSETS: Asset[] = [
  { name: "Email: launch announcement", source: "email", medium: "crm", audiences: ["All email subscribers", "Engaged last 90 days"] },
  { name: "Email: launch-day reminder", source: "email", medium: "crm", audiences: ["Opened announcement, no purchase", "Engaged last 90 days"] },
  { name: "Email: past buyers", source: "email", medium: "crm", audiences: ["Past buyers", "Past buyers, 2+ orders"] },
  { name: "SMS: launch alert", source: "sms", medium: "crm", audiences: ["SMS subscribers", "SMS subscribers, engaged 60 days"] },
  { name: "Landing page", source: "site", medium: "owned", audiences: ["Public", "Public"] },
  { name: "Paid social: carousel ad", source: "meta", medium: "paid_social", audiences: ["Lookalike 1% of buyers", "Interest: home and kitchen"] },
  { name: "Paid social: video ad", source: "tiktok", medium: "paid_social", audiences: ["Broad, 25–54", "Video viewers 30 days"] },
  { name: "Paid search: brand ad", source: "google", medium: "cpc", audiences: ["Brand keywords", "Brand keywords"] },
  { name: "Paid search: category ad", source: "microsoft", medium: "cpc", audiences: ["Category keywords", "Category keywords"] },
  { name: "Organic social: Instagram post", source: "instagram", medium: "social", audiences: ["Followers", "Followers"] },
  { name: "Affiliate newsletter placement", source: "affiliate", medium: "affiliate", audiences: ["Partner's subscribers", "Partner's subscribers"] },
  { name: "Display: retargeting banner", source: "display", medium: "display", audiences: ["Site visitors 30 days", "Cart abandoners 14 days"] },
];
const QA_ROWS = ASSETS.length;
const QA_COLS = ["asset", "headline", "price", "code", "tag", "time", "audience", "legal"] as const;

const launchQaStep = {
  id: "launch-qa",
  type: DOCUMENT_REVIEW,
  title: "Launch QA: every asset vs. the launch sheet",
  config: {
    prompt: [
      "Check each scheduled asset against the launch sheet (in the header). Flag each one that doesn't match, with the reason.",
      "Then decide what happens to the launch queue.",
    ].join("\n"),
    document: {
      title: "Launch QA · {{product}} · launch {{launch_short}}",
      fields: [
        { id: "sheet_product", label: "Product", value: "{{product}}" },
        { id: "sheet_launch", label: "Launch", value: "{{launch_short}}, {{launch_time}} ET (nothing with the offer before then)" },
        { id: "sheet_price", label: "Price", value: "{{price}}" },
        { id: "sheet_code", label: "Promo code", value: "{{code}}, {{disc}}% off (not case sensitive)" },
        { id: "sheet_tag", label: "Link tag", value: "utm_campaign={{utm}} on every link (parameter order doesn't matter)" },
        { id: "sheet_suppressed", label: "Suppressed segments", value: "{{suppressed}}" },
        { id: "sheet_legal", label: "Legal line", value: "{{legal}}" },
      ],
      columns: ["Asset", "Headline", "Price", "Code", "Link tag", "Send / live time", "Audience", "Legal line"],
      rows: Array.from({ length: QA_ROWS }, (_, i) => ({ id: `q${i + 1}`, cells: QA_COLS.map((c) => `{{qa_${i + 1}_${c}}}`) })),
      totals: [],
      footnote: "Times are Eastern. Audiences list who is included; anything after \"excl.\" is left out.",
    },
    reasons: [
      { id: "code", label: "Promo code doesn't match the launch sheet" },
      { id: "price", label: "Price doesn't match the launch sheet" },
      { id: "tag", label: "Campaign tag wrong or missing" },
      { id: "early", label: "Scheduled before launch" },
      { id: "suppressed", label: "Audience includes a suppressed segment" },
      { id: "legal", label: "Legal line missing" },
      { id: "other", label: "Other" },
    ],
    findings: [
      { id: "wrong_code", label: "Promo code differs from the launch sheet", points: 3 },
      { id: "wrong_price", label: "Price differs from the launch sheet", points: 3 },
      { id: "wrong_tag", label: "Campaign tag wrong or missing", points: 3 },
      { id: "too_early", label: "Scheduled before the launch time", points: 3 },
      { id: "suppressed", label: "Audience includes a suppressed segment", points: 3 },
      { id: "no_legal", label: "Required legal line missing", points: 3 },
    ],
    falseFlagPenalty: 1,
    decision: {
      prompt: "The queue goes live on its own at launch. What do you do?",
      options: [
        { id: "approve", label: "Approve the whole queue so the launch goes out on time" },
        { id: "fix", label: "Fix the flagged assets myself in the live tools and approve, without bothering anyone" },
        { id: "hold", label: "Hold the flagged assets, approve the rest and send {{manager_first}} the list of what's held and why" },
        { id: "cancel", label: "Cancel the launch until every asset has been rebuilt" },
      ],
      points: 2,
    },
  },
};

// ---- Rapid round C: budget ----

type BudgetKind = "remaining" | "daily" | "forecast" | "fee" | "po" | "realloc_orders" | "realloc_share" | "fee_gross";
const BUD_EASY: BudgetKind[] = ["remaining", "remaining", "daily", "daily", "forecast", "forecast", "fee", "fee", "po", "po"];
const BUD_HARD: BudgetKind[] = ["realloc_orders", "realloc_orders", "realloc_share", "fee_gross", "fee_gross"];

const rapidBudgetStep = rapidStep(
  "rapid-budget",
  "Rapid round: budget",
  [
    "Budget: 15 quick items, 20 seconds each, from the launch budget tracker. Pick the right figure.",
    "Days left include today. When budget moves between channels, the total stays the same. The agency fee is a percent of media spend.",
  ].join("\n"),
  "bg",
);

function buildBudget(rng: Rng, v: Values, agency: string, revised: { ch: ChannelId; spend: number }, paidFirst: string): Record<string, ChoiceKey> {
  const kinds = fillSlots(rng.shuffle(BUD_EASY), rng.shuffle(BUD_HARD));
  let usedRevised = false;
  return Object.fromEntries(
    kinds.map((kind, i) => {
      const d = draw(() => {
        const ch = rng.pick(CHANNELS);
        const name = CHANNEL_NAMES[ch];
        switch (kind) {
          case "remaining": {
            const useRev = !usedRevised;
            const c = useRev ? revised.ch : ch;
            const week = useRev ? revised.spend : rng.cents(1_000, 9_000);
            const before = rng.cents(5_000, 30_000);
            const budget = mult(rng, (before + week) / 100 + 2_000, (before + week) / 100 + 25_000, 500) * 100;
            const right = money(budget - before - week);
            const wrong = threeWrong(right, [money(budget - before), money(before + week), money(budget - before + week)]);
            if (!wrong) return null;
            usedRevised ||= useRev;
            return {
              title: `${CHANNEL_NAMES[c]} · month to date`,
              prompt: `How much of ${CHANNEL_NAMES[c].toLowerCase()}'s monthly budget is left?`,
              rows: [
                ["Monthly budget", money(budget)],
                ["Spent before launch week", money(before)],
                [useRev ? `Launch week (revised by ${paidFirst})` : "Launch week", money(week)],
                ["Measure", "Budget left"],
                ["Rounding", "To the cent"],
              ],
              right,
              wrong,
            };
          }
          case "daily": {
            const left = rng.cents(2_000, 25_000);
            const days = rng.int(4, 18);
            const right = money(left / days);
            const wrong = threeWrong(right, [money(left / (days - 1)), money(left / (days + 1)), money((left / days) * 7)]);
            if (!wrong) return null;
            return {
              title: `${name} · rest of the month`,
              prompt: `What daily spend lands ${name.toLowerCase()} exactly on budget?`,
              rows: [
                ["Budget left", money(left)],
                ["Days left", `${days} (including today)`],
                ["Measure", "Even daily spend"],
                ["Source", "Budget tracker"],
                ["Rounding", "To the cent"],
              ],
              right,
              wrong,
            };
          }
          case "forecast": {
            const budget = mult(rng, 3_000, 30_000, 250) * 100;
            const cpa = rng.cents(18, 85);
            const last = cpa + rng.pick([-1, 1]) * rng.cents(4, 15);
            const cpc = rng.cents(0.6, 2.4);
            if (last < 500) return null;
            const right = fmt(Math.round(budget / cpa));
            const wrong = threeWrong(right, [fmt(Math.round(budget / last)), fmt(Math.round(budget / cpc)), fmt(Math.round(budget / ((cpa + last) / 2)))]);
            if (!wrong) return null;
            return {
              title: `${name} · next week`,
              prompt: `How many orders should ${name.toLowerCase()}'s budget bring next week?`,
              rows: [
                ["Budget", money(budget)],
                ["Forecast CPA (use this)", money(cpa)],
                ["Last week's CPA", money(last)],
                ["Average CPC", money(cpc)],
                ["Rounding", "Nearest whole order"],
              ],
              right: `${right} orders`,
              wrong: wrong.map((w) => `${w} orders`),
            };
          }
          case "fee": {
            const media = rng.cents(8_000, 60_000);
            const pct = rng.pick([8, 10, 12, 15]);
            const right = money((media * pct) / 100);
            const wrong = threeWrong(right, [money((media * (100 + pct)) / 100), money((media * pct) / 1000), money((media * pct) / (100 + pct))]);
            if (!wrong) return null;
            return {
              title: `${agency} · media fee`,
              prompt: `What is ${agency}'s fee on this month's media?`,
              rows: [
                ["Media spend", money(media)],
                ["Agency fee", `${pct}% of media spend`],
                ["Measure", "Fee only"],
                ["Source", "Statement of work"],
                ["Rounding", "To the cent"],
              ],
              right,
              wrong,
            };
          }
          case "po": {
            const po = mult(rng, 10_000, 60_000, 500) * 100;
            const mediaInv = po + rng.pick([-1, 1]) * rng.cents(300, 4_000);
            const feeInv = rng.cents(800, 6_000);
            const diff = mediaInv + feeInv - po;
            if (diff === 0) return null;
            const word = (x: number) => (x > 0 ? "over" : "under");
            const right = `${money(Math.abs(diff))} ${word(diff)}`;
            const mediaOnly = mediaInv - po;
            const wrong = threeWrong(right, [`${money(Math.abs(diff))} ${word(-diff)}`, `${money(Math.abs(mediaOnly))} ${word(mediaOnly)}`, `${money(feeInv)} ${word(diff)}`]);
            if (!wrong) return null;
            return {
              title: `${agency} · invoice vs. PO`,
              prompt: "By how much is the invoice over or under the PO?",
              rows: [
                ["PO amount", money(po)],
                ["Invoice: media", money(mediaInv)],
                ["Invoice: agency fee", money(feeInv)],
                ["Measure", "Invoice total vs. PO"],
                ["Rounding", "To the cent"],
              ],
              right,
              wrong,
            };
          }
          case "realloc_orders": {
            const [c1, c2] = pickDistinct(rng, CHANNELS, 2);
            const a = rng.cents(30, 90);
            const b = a - rng.cents(6, 25);
            if (b < 1_200) return null;
            const move = mult(rng, 1_000, 8_000, 250) * 100;
            const delta = move / b - move / a;
            if (Math.abs(delta - Math.round(delta)) > 0.4 || Math.round(delta) < 2) return null;
            const sign = (n: number) => `${n >= 0 ? "+" : "-"}${fmt(Math.abs(n))} orders`;
            const right = sign(Math.round(delta));
            const wrong = threeWrong(right, [sign(-Math.round(delta)), sign(Math.round(move / b)), sign(-Math.round(move / a))]);
            if (!wrong) return null;
            return {
              title: "Reallocation, total fixed",
              prompt: `If CPAs hold, how do weekly orders change when you move the money?`,
              rows: [
                [CHANNEL_NAMES[c1], `CPA ${money(a)}`],
                [CHANNEL_NAMES[c2], `CPA ${money(b)}`],
                ["Move", `${money(move)} a week from ${CHANNEL_NAMES[c1].toLowerCase()} to ${CHANNEL_NAMES[c2].toLowerCase()}`],
                ["Total budget", "Unchanged"],
                ["Rounding", "Nearest whole order"],
              ],
              right,
              wrong,
            };
          }
          case "realloc_share": {
            const [c1, c2] = pickDistinct(rng, CHANNELS, 2);
            const total = mult(rng, 20_000, 120_000, 1_000) * 100;
            const now = rng.int(15, 45);
            const target = now + rng.int(5, 20);
            const right = money((total * (target - now)) / 100);
            const wrong = threeWrong(right, [money((total * target) / 100), money((total * now) / 100), money((total * (100 - target)) / 100)]);
            if (!wrong) return null;
            return {
              title: "Reallocation, total fixed",
              prompt: `How much moves from ${CHANNEL_NAMES[c2].toLowerCase()} to ${CHANNEL_NAMES[c1].toLowerCase()}?`,
              rows: [
                ["Total budget (fixed)", money(total)],
                [`${CHANNEL_NAMES[c1]} share now`, `${now}%`],
                [`${CHANNEL_NAMES[c1]} share after`, `${target}%`],
                ["Funded by", CHANNEL_NAMES[c2]],
                ["Rounding", "To the cent"],
              ],
              right,
              wrong,
            };
          }
          default: {
            // fee_gross: the fee comes out of the same all-in budget
            const total = mult(rng, 10_000, 80_000, 500) * 100;
            const pct = rng.pick([8, 10, 12, 15]);
            const right = money(total / (1 + pct / 100));
            const wrong = threeWrong(right, [money(total * (1 - pct / 100)), money(total), money((total * pct) / 100)]);
            if (!wrong) return null;
            return {
              title: `${agency} · all-in budget`,
              prompt: "How much media can the all-in budget buy?",
              rows: [
                ["All-in budget", `${money(total)} (media + agency fee)`],
                ["Agency fee", `${pct}% of media spend`],
                ["Measure", "Media spend"],
                ["Source", "Statement of work"],
                ["Rounding", "To the cent"],
              ],
              right,
              wrong,
            };
          }
        }
      }, kind);
      return setItem(rng, v, "bg", i, d);
    }),
  );
}

// ---- Section 6: desk ----

interface Role {
  role: string;
  lo: number;
  hi: number;
}
const RATE_ROLES: Role[] = [
  { role: "Strategy director", lo: 190, hi: 240 },
  { role: "Media buyer", lo: 130, hi: 170 },
  { role: "Designer", lo: 115, hi: 150 },
  { role: "Copywriter", lo: 100, hi: 140 },
  { role: "Account manager", lo: 95, hi: 125 },
];
const OFF_CARD_ROLES: [string, string][] = [
  ["Senior designer", "Designer"],
  ["Motion designer", "Designer"],
  ["Paid media director", "Media buyer"],
];
const IN_SCOPE: [string, string][] = [
  ["Paid social management: launch week", "Media buyer"],
  ["Paid search management: launch week", "Media buyer"],
  ["Launch creative: static ad set", "Designer"],
  ["Launch creative: email headers", "Designer"],
  ["Launch copy: ads and emails", "Copywriter"],
  ["Monthly performance report", "Account manager"],
  ["Launch plan and channel strategy", "Strategy director"],
  ["Weekly status calls", "Account manager"],
];
const OUT_OF_SCOPE: [string, string][] = [
  ["Influencer gifting coordination", "Account manager"],
  ["Retail endcap display design", "Designer"],
  ["Podcast ad script and booking", "Copywriter"],
  ["Trade show booth graphics", "Designer"],
  ["Packaging redesign concepts", "Designer"],
];
const INVOICE_ROWS = 8;
const INVOICE_COLS = ["line", "desc", "role", "hours", "rate", "amount", "co"] as const;

const invoiceStep = {
  id: "invoice-check",
  type: DOCUMENT_REVIEW,
  seconds: 270,
  title: "Agency invoice vs. the statement of work",
  config: {
    prompt: "Check {{agency}}'s invoice against the statement of work (in the header). Flag each problem with the reason, then decide what to do with the invoice.",
    document: {
      title: "{{agency}} · invoice {{inv_no}} · {{inv_month}}",
      fields: [
        { id: "sow_cap", label: "Monthly hours cap", value: "{{cap}} hours" },
        { id: "sow_rates", label: "Rate card", value: "{{rate_card}}" },
        { id: "sow_scope", label: "In scope", value: "Paid social and paid search management; launch creative and copy; launch plan and strategy; monthly reporting; status calls" },
        { id: "sow_co", label: "Change orders", value: "Work outside the scope needs a change order signed by Saltbox before it starts" },
        { id: "inv_po", label: "PO", value: "{{inv_po}}" },
      ],
      columns: ["Line", "Description", "Role", "Hours", "Rate", "Amount", "Change order"],
      rows: Array.from({ length: INVOICE_ROWS }, (_, i) => ({ id: `l${i + 1}`, cells: INVOICE_COLS.map((c) => `{{iv_${i + 1}_${c}}}`) })),
      totals: [
        { id: "total_hours", label: "Total hours", value: "{{iv_hours}}" },
        { id: "total_amount", label: "Invoice total", value: "{{iv_total}}" },
      ],
    },
    reasons: [
      { id: "cap", label: "Hours over the monthly cap" },
      { id: "rate", label: "Rate not on the rate card" },
      { id: "scope", label: "Out of scope with no change order" },
      { id: "math", label: "Hours × rate doesn't equal the amount" },
      { id: "other", label: "Other" },
    ],
    findings: [
      { id: "over_cap", label: "Hours billed above the monthly cap", points: 2.5 },
      { id: "off_card_rate", label: "Rate that isn't on the rate card", points: 2.5 },
      { id: "no_change_order", label: "Out-of-scope work with no change order", points: 2.5 },
      { id: "bad_extension", label: "Line amount that doesn't multiply", points: 2.5 },
    ],
    falseFlagPenalty: 1,
    decision: {
      prompt: "What do you do with the invoice?",
      options: [
        { id: "approve", label: "Approve it as billed: {{agency}} is a long-term partner and the launch went well" },
        { id: "edit", label: "Correct the amounts on the invoice myself and send it to finance for payment" },
        { id: "return", label: "Return it to {{agency}} with the list of issues, copying {{finance_first}} in finance" },
        { id: "freeze", label: "Stop paying {{agency}} entirely until the account is reviewed" },
      ],
      points: 2,
    },
  },
};

const abReadoutStep = {
  id: "ab-readout",
  type: MULTIPLE_CHOICE,
  seconds: 75,
  title: "A/B test readout",
  config: {
    prompt: "{{ab_test}} test: A had {{ab_va}} visitors and {{ab_oa}} orders; B had {{ab_vb}} visitors and {{ab_ob}} orders. Under the test plan, what do you tell {{paid_first}}?",
    options: letterOptions("ab"),
    select: "single",
    points: 4,
  },
};

const abLiftStep = {
  id: "ab-lift",
  type: NUMERIC,
  seconds: 75,
  title: "A/B test: lift",
  config: {
    prompt: "Same test (A: {{ab_va}} visitors, {{ab_oa}} orders; B: {{ab_vb}} visitors, {{ab_ob}} orders). What is B's relative lift over A in conversion rate, in percent, to one decimal? Negative if B converts worse.",
    unit: "%",
    decimals: 1,
    points: 4,
  },
};

const valuesStep = (id: string, title: string, prompt: string, prefix: string) => ({
  id,
  type: MULTIPLE_CHOICE,
  seconds: 60,
  title,
  config: { prompt, options: letterOptions(prefix), select: "single", points: 2 },
});

const valuesIntegrityStep = valuesStep("values-integrity", "Judgment: the board slide", "{{manager_first}} wants the board slide to show ROAS before refunds. What do you do?", "vi");
const valuesCandorStep = valuesStep("values-candor", "Judgment: last month's code", "{{designer_first}} spotted last month's code in the email you scheduled this morning. What do you do?", "vc");
const valuesClientStep = valuesStep("values-client-care", "Judgment: the customer list", "{{agency}} wants the full customer email list. What do you do?", "vl");
const valuesLaneStep = valuesStep("values-in-lane", "Judgment: \"clinically proven\"", "{{creator_first}} wants you to confirm the \"clinically proven\" line. What do you do?", "vn");
const valuesQualityStep = valuesStep("values-quality", "Judgment: skipping link checks", "{{paid_first}} suggests skipping the link checks to make the send time. What do you do?", "vq");

// ---- Definition ----

const DEFINITION = {
  intro:
    "You're the marketing coordinator at Saltbox Provisions, a direct-to-consumer brand, and it's launch week for the {{product}}. {{manager}}, the marketing manager, needs the launch-week numbers for Friday's report and a clean launch queue before anything goes live. The work comes in six timed parts, 50 minutes in all: three rapid rounds of quick items (campaign metrics, copy checks, budget), the launch-week channel report, the launch QA, and a desk with the agency invoice, an A/B test and your inbox. The cards in your inbox (launch sheet, brand guide, reporting rules, test plan and agency statement of work) stay there all day. A finished part can't be reopened. Saltbox, its agency and everyone here are fictional.",
  steps: [
    rapidMetricsStep,
    campaignReportStep,
    rapidCopyStep,
    launchQaStep,
    rapidBudgetStep,
    invoiceStep,
    abReadoutStep,
    abLiftStep,
    valuesIntegrityStep,
    valuesCandorStep,
    valuesClientStep,
    valuesLaneStep,
    valuesQualityStep,
  ],
  messages: [
    {
      id: "card-launch",
      from: "Marketing manager",
      subject: "Launch sheet: {{product}}",
      body: [
        "Hi {{first_name}},",
        "",
        "The launch sheet. Everything that goes out this week matches it exactly.",
        "",
        "Product: {{product}} (always written exactly like this)",
        "Launch: {{launch_long}}, {{launch_time}} ET. Nothing with the offer goes out before then.",
        "Price: {{price}}",
        "Promo code: {{code}}, {{disc}}% off. Codes aren't case sensitive.",
        "Link tag: utm_campaign={{utm}} on every link. Parameter order doesn't matter.",
        "Suppressed segments (never in any audience): {{suppressed}}",
        "Legal line, on every asset with the offer: \"{{legal}}\"",
        "",
        "{{manager}}",
      ].join("\n"),
    },
    {
      id: "card-brand",
      from: "Designer",
      subject: "Brand and claims guide",
      body: [
        "Hi {{first_name}}, the short version of the brand guide for this launch:",
        "",
        "Approved claims for the {{product}}: {{claims_ok}}.",
        "Not allowed (no substantiation on file): {{claims_no}}.",
        "New or changed claims go to legal before anyone uses them. Marketing doesn't approve claims, and neither do partners.",
        "Paid partners: every paid creator post opens with #ad. Not at the end, not hidden in hashtags.",
        "Naming: product names exactly as on the launch sheet, same spelling and capitals.",
        "",
        "{{designer}}",
      ].join("\n"),
    },
    {
      id: "card-reporting",
      from: "Finance partner",
      subject: "Reporting rules",
      body: [
        "Hi {{first_name}}, the formulas we use, so the Friday report ties to finance:",
        "",
        "CTR = clicks ÷ impressions",
        "CPC = spend ÷ clicks",
        "CPM = spend ÷ impressions × 1,000",
        "Conversion rate = orders ÷ clicks",
        "CPA = spend ÷ orders (no orders: leave it blank)",
        "Net revenue = revenue − refunds",
        "ROAS = net revenue ÷ spend. Never gross revenue.",
        "Blended figures come from totals, never the average of channel ratios.",
        "Pacing: share of budget spent vs. share of the month elapsed; within ±5 (in percent) is on pace.",
        "",
        "{{finance}}",
      ].join("\n"),
    },
    {
      id: "card-tests",
      from: "Paid media lead",
      subject: "Test plan",
      body: [
        "Hi {{first_name}}, how we read A/B tests:",
        "",
        "1. Minimum sample: {{ab_min}} visitors in each arm before we read anything.",
        "2. Either arm under the minimum: keep the test running, whatever the lift looks like.",
        "3. Both arms at the minimum: ship B only if its conversion rate beats A's by at least {{ab_lift_min}}% relative, that is (B − A) ÷ A.",
        "4. Both arms at the minimum and B's lift under {{ab_lift_min}}%: keep A.",
        "",
        "{{paid}}",
      ].join("\n"),
    },
    {
      id: "card-sow",
      from: "Finance partner",
      subject: "Agency statement of work (summary)",
      body: [
        "Hi {{first_name}}, the key terms of our statement of work with {{agency}}:",
        "",
        "Rate card: {{rate_card}}",
        "Monthly hours cap: {{cap}} hours. Hours above the cap aren't billable without our written approval.",
        "In scope: paid social and paid search management; launch creative and copy; launch plan and strategy; monthly reporting; status calls.",
        "Anything else needs a change order signed by Saltbox before the work starts. No change order, no payment.",
        "Customer data: we share hashed customer lists only (SHA-256), through the shared transfer folder. Never plain email addresses.",
        "",
        "{{finance}}",
      ].join("\n"),
    },
    {
      id: "m-metrics",
      from: "Paid media lead",
      subject: "Quick numbers before stand-up",
      body: "Hi {{first_name}}, I need a few numbers off last week's lines before stand-up. They're coming at you one at a time; the reporting rules are in your inbox.\n\n{{paid}}",
      stepId: "rapid-metrics",
    },
    {
      id: "m-report",
      from: "Marketing manager",
      subject: "Launch-week numbers for Friday",
      body: [
        "Hi {{first_name}},",
        "",
        "I need the launch-week numbers by channel for Friday's report: net revenue, CPA and ROAS per channel, then total net revenue, blended CPA and blended ROAS. Follow the reporting rules.",
        "",
        "Two things about the export: it double-counts relaunched campaigns (the same campaign ID shows up twice), so count each campaign ID once; and revenue is gross, so net out the refunds. A channel with no orders gets no CPA.",
        "",
        "{{manager}}",
      ].join("\n"),
      stepId: "campaign-report",
    },
    {
      id: "m-report-fix",
      from: "Paid media lead",
      subject: "Correction: {{rev_id}} spend",
      body: "Hi {{first_name}}, a late invoice from the platform wasn't in the export. Spend on {{rev_id}} ({{rev_ch}}) is {{rev_new}}, not {{rev_old}}. Please use {{rev_new}} in the report.\n\n{{paid}}",
      arriveAtMinute: 4,
      stepId: "campaign-report",
    },
    {
      id: "m-copy",
      from: "Designer",
      subject: "Copy for sign-off",
      body: "Hi {{first_name}}, fifteen bits of launch copy need your sign-off before they go to the scheduler. Each one comes with the launch sheet line it has to match.\n\n{{designer}}",
      stepId: "rapid-copy",
    },
    {
      id: "m-qa",
      from: "Marketing manager",
      subject: "Launch QA before the queue goes live",
      body: [
        "Hi {{first_name}},",
        "",
        "The launch queue goes live on its own. Check every asset against the launch sheet: code, price, link tag, send time, audience and legal line. Flag what's wrong and tell me what you're doing with the queue.",
        "",
        "{{manager}}",
      ].join("\n"),
      stepId: "launch-qa",
    },
    {
      id: "m-qa-move",
      from: "Marketing manager",
      subject: "Launch moved to {{launch_new_time}} ET",
      body: "Heads-up: the warehouse needs more time, so launch moves to {{launch_new_time}} ET on {{launch_short}}. Everything else on the launch sheet stands. Check the send times against the new time.\n\n{{manager}}",
      arriveAtMinute: 4,
      stepId: "launch-qa",
    },
    {
      id: "m-budget",
      from: "Finance partner",
      subject: "Budget tracker questions",
      body: "Hi {{first_name}}, a few quick ones from the budget tracker before I close the month. One at a time, they won't take long.\n\n{{finance}}",
      stepId: "rapid-budget",
    },
    {
      id: "m-invoice",
      from: "Finance partner",
      subject: "{{agency}} invoice {{inv_no}}",
      body: "Hi {{first_name}}, {{agency}}'s invoice for {{inv_month}} is in. Can you check it against the statement of work before I pay it? The terms are on the SOW card in your inbox.\n\n{{finance}}",
      stepId: "invoice-check",
    },
    {
      id: "m-ab",
      from: "Paid media lead",
      subject: "{{ab_test}} test results",
      body: [
        "Hi {{first_name}}, results so far on the {{ab_test}} test:",
        "",
        "A (control): {{ab_va}} visitors, {{ab_oa}} orders",
        "B (variant): {{ab_vb}} visitors, {{ab_ob}} orders",
        "",
        "B looks good to me. What's the call under the test plan, and what's B's lift?",
        "",
        "{{paid}}",
      ].join("\n"),
      stepId: "ab-readout",
    },
    {
      id: "m-integrity",
      from: "Marketing manager",
      subject: "Board slide",
      body: "Hi {{first_name}}, for the board slide, show the quarter's ROAS before refunds. It's {{gross_roas}} instead of {{net_roas}} and it looks cleaner. The board won't dig into it. Can you change it before I send the deck at {{deck_time}}?\n\n{{manager}}",
      stepId: "values-integrity",
    },
    {
      id: "m-candor",
      from: "Designer",
      subject: "Your {{candor_time}} email",
      body: "Hi {{first_name}}, the {{candor_email}} you scheduled this morning for {{candor_time}} still has {{old_code}} in it. That's last month's code. Thought you'd want to know.\n\n{{designer}}",
      stepId: "values-candor",
    },
    {
      id: "m-client",
      from: "Agency account executive",
      subject: "Customer list for lookalikes",
      body: "Hi {{first_name}}, to build lookalike audiences fast we need Saltbox's full customer email list. Could you export it to a spreadsheet and email it to me today? Hashing slows us down.\n\nThanks,\n{{agency_ae}}, {{agency}}",
      stepId: "values-client-care",
    },
    {
      id: "m-inlane",
      from: "Creator partner",
      subject: "Quick claim check for my post",
      body: "Hey {{first_name}}! I'm filming my paid post for the {{product}} tonight. My audience loves science, so I want to say it's \"clinically proven to {{proven}}\". Can you just confirm that's fine so I can post on time?\n\n{{creator}}",
      stepId: "values-in-lane",
    },
    {
      id: "m-quality",
      from: "Paid media lead",
      subject: "{{quality_email}} send",
      body: "Hi {{first_name}}, we're tight for the {{quality_time}} send of the {{quality_email}}. Let's skip the link checks this once; the links were fine in last week's email. Just hit schedule.\n\n{{paid}}",
      stepId: "values-quality",
    },
  ],
  sections: [
    { id: "s-rapid-a", title: "Rapid round: campaign metrics", minutes: 6, stepIds: ["rapid-metrics"] },
    { id: "s-work-1", title: "Launch-week channel report", minutes: 10, stepIds: ["campaign-report"] },
    { id: "s-rapid-b", title: "Rapid round: copy check", minutes: 6, stepIds: ["rapid-copy"] },
    { id: "s-work-2", title: "Launch QA", minutes: 10, stepIds: ["launch-qa"] },
    { id: "s-rapid-c", title: "Rapid round: budget", minutes: 6, stepIds: ["rapid-budget"] },
    {
      id: "s-desk",
      title: "Desk and inbox",
      minutes: 12,
      stepIds: ["invoice-check", "ab-readout", "ab-lift", "values-integrity", "values-candor", "values-client-care", "values-in-lane", "values-quality"],
      oneAtATime: true,
    },
  ],
};

// ---- Leak guard ----

/**
 * The candidate's screen must not show a computed answer in any form the leak
 * tests read (3.42, 342 as cents, 1,234.56). A report figure can collide with
 * a rapid-round option or exhibit by chance, so the generator draws the whole
 * variant again (deterministically, from the same seed) when it does.
 */
const STATIC_TEXT = JSON.stringify(DEFINITION);
function leakForms(value: number): RegExp[] {
  const forms = [JSON.stringify(value), value.toFixed(2), String(Math.round(value * 100)), value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })];
  return [...new Set(forms)].filter((f) => !/^\d{1,3}$/.test(f)).map((s) => new RegExp(`(?<![\\d.,])${s.replace(/[.$]/g, "\\$&")}(?![\\d.]\\d)`));
}
function leaks(values: Values, numbers: number[]): boolean {
  const text = `${STATIC_TEXT}\n${Object.values(values).join("\n")}`;
  return numbers.some((n) => n >= 1 && leakForms(n).some((re) => re.test(text)));
}

// ---- Generator ----

function launchDate(rng: Rng): IsoDate {
  for (;;) {
    const d = addDays("2026-09-01", rng.int(0, 420));
    if ([2, 3, 4].includes(weekdayOf(d))) return d;
  }
}

function buildOnce(rng: Rng) {
  const v: Values = {};
  const [pManager, pPaid, pDesigner, pAe, pFinance, pCreator] = distinctPeople(rng, 6);
  const line = rng.pick(PRODUCT_LINES);
  const product = rng.pick(line.names);
  const word = product.split(" ")[0];
  const agency = rng.pick(AGENCIES);
  const price = rng.int(line.price[0], line.price[1]);
  const disc = rng.pick([10, 15, 20]);
  const code = `${word.toUpperCase()}${disc}`;
  const oldCode = rng.pick(OLD_CODES);
  const launch = launchDate(rng);
  const launchMin = rng.pick([8, 9, 10]) * 60;
  const shift = rng.pick([60, 90, 120]);
  const newMin = launchMin + shift;
  const month = MONTH_SHORT[Number(launch.slice(5, 7)) - 1].toLowerCase();
  const prevMonth = MONTH_SHORT[(Number(launch.slice(5, 7)) + 10) % 12].toLowerCase();
  const yy = launch.slice(2, 4);
  const utm = `${word.toLowerCase()}_launch_${month}${yy}`;
  const offerEnds = addDays(launch, rng.int(5, 7));
  const legal = `Offer ends ${monthDay(offerEnds)} at 11:59 PM ET. One use per customer.`;
  const suppressed = [EMAIL_UNSUBS, ...pickDistinct(rng, SUPPRESSION_POOL, 2)];
  const priceLabel = `$${price}`;

  Object.assign(v, {
    product,
    manager: pManager.full,
    manager_first: pManager.first,
    paid: pPaid.full,
    paid_first: pPaid.first,
    designer: pDesigner.full,
    designer_first: pDesigner.first,
    agency,
    agency_ae: pAe.full,
    finance: pFinance.full,
    finance_first: pFinance.first,
    creator: pCreator.full,
    creator_first: pCreator.first,
    price: priceLabel,
    disc: String(disc),
    code,
    utm,
    legal,
    suppressed: suppressed.join("; "),
    launch_long: formatDate(launch, "long"),
    launch_short: formatDate(launch),
    launch_time: clock(launchMin),
    launch_new_time: clock(newMin),
    claims_ok: line.allowed.join("; "),
    claims_no: line.notAllowed.join("; "),
    proven: line.proven,
    old_code: oldCode,
  });

  // ---- Section 2: channel report ----
  const zero = rng.pick<ChannelId>(["social", "affiliate", "display"]);
  const [dup, rev, two] = rng.shuffle(CHANNELS.filter((c) => c !== zero));
  const aov = Math.round(price * (1 - disc / 100) * 100);
  const usedIds = new Set<string>();
  const campaign = (ch: ChannelId, scale = 1): Campaign => {
    const l = channelLine(rng, ch);
    const spend = Math.round(l.spend * scale);
    let id: string;
    do id = `SBX-${CHANNEL_CODES[ch]}-${rng.int(1000, 9999)}`;
    while (usedIds.has(id));
    usedIds.add(id);
    if (ch === zero) return { id, ch, spend, impressions: l.impressions, clicks: Math.round(l.clicks * scale), orders: 0, revenue: 0, refunds: 0 };
    const orders = Math.max(4, Math.round(l.orders * scale));
    const revenue = orders * aov + rng.int(0, 99) * orders;
    const refunds = Math.round((revenue * rng.int(2, 9)) / 100) + rng.int(1, 99);
    return { id, ch, spend, impressions: Math.round(l.impressions * scale), clicks: Math.round(l.clicks * scale), orders, revenue, refunds };
  };
  const campaigns: Campaign[] = CHANNELS.flatMap((ch) => (ch === two ? [campaign(ch, 0.6), campaign(ch, 0.5)] : [campaign(ch)]));
  const dupCampaign = campaigns.find((c) => c.ch === dup)!;
  const revCampaign = campaigns.find((c) => c.ch === rev)!;
  const revOld = revCampaign.spend;
  const revNew = revOld + rng.cents(250, 1_800);
  const exportRows = rng.shuffle([...campaigns, dupCampaign]);
  exportRows.forEach((c, i) => {
    const k = i + 1;
    Object.assign(v, {
      [`ex_${k}_id`]: c.id,
      [`ex_${k}_ch`]: CHANNEL_NAMES[c.ch],
      [`ex_${k}_status`]: c === dupCampaign ? "Relaunched" : rng.pick(["Active", "Active", "Ended"]),
      [`ex_${k}_spend`]: money(c.spend),
      [`ex_${k}_impr`]: fmt(c.impressions),
      [`ex_${k}_clicks`]: fmt(c.clicks),
      [`ex_${k}_orders`]: fmt(c.orders),
      [`ex_${k}_rev`]: money(c.revenue),
      [`ex_${k}_ref`]: money(c.refunds),
    });
  });
  Object.assign(v, { rev_id: revCampaign.id, rev_ch: CHANNEL_NAMES[rev], rev_old: money(revOld), rev_new: money(revNew) });
  const spendOf = (c: Campaign) => (c === revCampaign ? revNew : c.spend);
  const reportCells: Record<string, { value: number; tolerance: number }> = {};
  let totalNet = 0;
  let totalSpend = 0;
  let totalOrders = 0;
  for (const ch of CHANNELS) {
    const cs = campaigns.filter((c) => c.ch === ch);
    const net = cs.reduce((s, c) => s + c.revenue - c.refunds, 0);
    const spend = cs.reduce((s, c) => s + spendOf(c), 0);
    const orders = cs.reduce((s, c) => s + c.orders, 0);
    totalNet += net;
    totalSpend += spend;
    totalOrders += orders;
    reportCells[`${ch}_net`] = { value: net / 100, tolerance: 0.01 };
    if (orders > 0) reportCells[`${ch}_cpa`] = { value: round2(spend / orders / 100), tolerance: 0.01 };
    reportCells[`${ch}_roas`] = { value: round2(net / spend), tolerance: 0.01 };
  }
  reportCells.total_net = { value: totalNet / 100, tolerance: 0.01 };
  reportCells.blended_cpa = { value: round2(totalSpend / totalOrders / 100), tolerance: 0.01 };
  reportCells.blended_roas = { value: round2(totalNet / totalSpend), tolerance: 0.01 };
  // The board slide is the quarter's figure, not this week's report.
  const boardNet = rng.int(180, 420) / 100;
  Object.assign(v, { net_roas: ratio(boardNet), gross_roas: ratio(boardNet * (1 + rng.int(6, 14) / 100)) });

  // ---- Section 4: launch QA ----
  const assets = rng.shuffle(ASSETS);
  type QaKind = "code" | "price" | "tag" | "early" | "suppressed" | "legal" | "ok_exact" | "ok_case" | "ok_order" | "ok" | "ok_excl";
  const qaKinds = rng.shuffle<QaKind>(["code", "price", "tag", "early", "suppressed", "legal", "ok_exact", "ok_case", "ok_order", "ok_excl", "ok", "ok"]);
  const qaKey: Record<string, { targets: string[]; reasons: string[]; note: string }> = {};
  const headlines = [`Meet the ${product}`, `The ${product} is here`, `Say hello to the ${product}`, `New: the ${product}`, `${disc}% off the new ${product}`];
  const at = (day: IsoDate, min: number) => `${formatDate(day)}, ${clock(min)}`;
  const wrongPrice = (p: number) => `$${rng.pick([p + 10, p + 20, p - 10, p + 5])}`;
  const tag = (a: Asset, campaignTag: string | null, order: "std" | "swap") => {
    const parts = [`utm_source=${a.source}`, `utm_medium=${a.medium}`, ...(campaignTag ? [`utm_campaign=${campaignTag}`] : [])];
    return (order === "swap" ? [...parts].reverse() : parts).join("&");
  };
  qaKinds.forEach((kind, i) => {
    const k = i + 1;
    const a = assets[i];
    let cellPrice = priceLabel;
    let cellCode = code;
    let cellTag = tag(a, utm, "std");
    const laterDay = rng.int(0, 2);
    let cellTime = laterDay === 0 ? at(launch, newMin + 30 * rng.int(1, 16)) : at(addDays(launch, laterDay), rng.int(16, 36) * 30);
    let base = rng.pick(a.audiences);
    let cellAudience = base;
    let cellLegal = legal;
    let note = "";
    switch (kind) {
      case "code":
        cellCode = rng.int(0, 1) ? oldCode : code.slice(0, 2) + code.slice(3);
        note = `${a.name} uses the code ${cellCode}; the launch sheet's code is ${code}.`;
        break;
      case "price":
        cellPrice = wrongPrice(price);
        note = `${a.name} shows ${cellPrice}; the launch sheet price is ${priceLabel}.`;
        break;
      case "tag": {
        const missing = rng.int(0, 1) === 1;
        cellTag = tag(a, missing ? null : `${word.toLowerCase()}_launch_${prevMonth}${yy}`, "std");
        note = missing ? `${a.name}'s link has no utm_campaign tag.` : `${a.name}'s link is tagged with last month's campaign instead of ${utm}.`;
        break;
      }
      case "early": {
        const t = launchMin + 30 * rng.int(0, shift / 30 - 1);
        cellTime = at(launch, t);
        note = `${a.name} goes out at ${clock(t)} ET, before the new launch time of ${clock(newMin)} ET.`;
        break;
      }
      case "suppressed": {
        const seg = rng.pick(a.source === "email" ? suppressed : suppressed.slice(1));
        if (base === "Public") base = "Site visitors 30 days";
        cellAudience = `${base} + ${seg}`;
        note = `${a.name}'s audience adds ${seg}, a suppressed segment.`;
        break;
      }
      case "legal":
        cellLegal = "—";
        note = `${a.name} carries the offer without the required legal line.`;
        break;
      case "ok_exact":
        cellTime = at(launch, newMin);
        break;
      case "ok_case":
        cellCode = rng.int(0, 1) ? code.toLowerCase() : word + String(disc);
        break;
      case "ok_order":
        cellTag = tag(a, utm, "swap");
        break;
      case "ok_excl":
        cellAudience = `${base === "Public" ? "Site visitors 30 days" : base} (excl. ${rng.pick(suppressed)})`;
        break;
      default:
        break;
    }
    Object.assign(v, {
      [`qa_${k}_asset`]: a.name,
      [`qa_${k}_headline`]: rng.pick(headlines),
      [`qa_${k}_price`]: cellPrice,
      [`qa_${k}_code`]: cellCode,
      [`qa_${k}_tag`]: cellTag,
      [`qa_${k}_time`]: cellTime,
      [`qa_${k}_audience`]: cellAudience,
      [`qa_${k}_legal`]: cellLegal,
    });
    const finding: Partial<Record<QaKind, string>> = { code: "wrong_code", price: "wrong_price", tag: "wrong_tag", early: "too_early", suppressed: "suppressed", legal: "no_legal" };
    if (finding[kind]) qaKey[finding[kind]!] = { targets: [`q${k}`], reasons: [kind], note };
  });

  // ---- Section 6: invoice ----
  const rates = RATE_ROLES.map((r) => ({ role: r.role, rate: mult(rng, r.lo, r.hi, 5) }));
  const rateOf = (role: string) => rates.find((r) => r.role === role)!.rate;
  v.rate_card = rates.map((r) => `${r.role} $${r.rate}/h`).join(" · ");
  type InvKind = "rate" | "math" | "scope" | "co" | "frac" | "ok";
  const invKinds = rng.shuffle<InvKind>(["rate", "math", "scope", "co", "frac", "ok", "ok", "ok"]);
  const inScope = rng.shuffle(IN_SCOPE);
  const [oosTrap, oosCo] = pickDistinct(rng, OUT_OF_SCOPE, 2);
  const coDate = formatDate(addDays(launch, -rng.int(10, 40)));
  const invKey: Record<string, { targets: string[]; reasons: string[]; note: string }> = {};
  let hoursTotal = 0;
  let amountTotal = 0;
  invKinds.forEach((kind, i) => {
    const k = i + 1;
    let [desc, role] = kind === "scope" ? oosTrap : kind === "co" ? oosCo : inScope.pop()!;
    let rate = rateOf(role);
    const hours = kind === "frac" ? rng.int(5, 24) + rng.pick([0.25, 0.5, 0.75]) : rng.int(6, 28);
    let amount = Math.round(hours * rate * 100);
    let co = "—";
    if (kind === "rate") {
      if (rng.int(0, 1)) {
        const [offRole, base] = rng.pick(OFF_CARD_ROLES);
        role = offRole;
        rate = rateOf(base) + rng.pick([20, 25, 35]);
        desc = inScope.find((s) => s[1] === base)?.[0] ?? desc;
        invKey.off_card_rate = { targets: [`l${k}`], reasons: ["rate"], note: `Line ${k} bills a ${role} at $${rate}/h; there's no ${role} on the rate card.` };
      } else {
        rate = rate + rng.pick([15, 20, 25, 30]);
        invKey.off_card_rate = { targets: [`l${k}`], reasons: ["rate"], note: `Line ${k} bills the ${role} at $${rate}/h; the rate card says $${rateOf(role)}/h.` };
      }
      amount = Math.round(hours * rate * 100);
    }
    if (kind === "math") {
      const right = amount;
      for (;;) {
        amount = right + rng.pick([-1, 1]) * rng.int(2, 30) * 2_500;
        if (amount > 0 && !rates.some((r) => Math.round(hours * r.rate * 100) === amount)) break;
      }
      invKey.bad_extension = { targets: [`l${k}`], reasons: ["math"], note: `Line ${k}: ${hours} h × $${rate} is ${money(right)}, but the line says ${money(amount)}.` };
    }
    if (kind === "scope") invKey.no_change_order = { targets: [`l${k}`], reasons: ["scope"], note: `Line ${k} (${desc}) is outside the statement of work and has no change order.` };
    if (kind === "co") co = `CO-${rng.int(10, 48)} signed ${coDate}`;
    hoursTotal += hours;
    amountTotal += amount;
    Object.assign(v, {
      [`iv_${k}_line`]: String(k),
      [`iv_${k}_desc`]: desc,
      [`iv_${k}_role`]: role,
      [`iv_${k}_hours`]: String(hours),
      [`iv_${k}_rate`]: `$${rate}/h`,
      [`iv_${k}_amount`]: money(amount),
      [`iv_${k}_co`]: co,
    });
  });
  const cap = Math.floor((hoursTotal - rng.int(6, 30)) / 5) * 5;
  invKey.over_cap = { targets: ["total_hours", "sow_cap"], reasons: ["cap"], note: `The invoice bills ${hoursTotal} hours against a cap of ${cap}.` };
  Object.assign(v, {
    cap: String(cap),
    iv_hours: String(hoursTotal),
    iv_total: money(amountTotal),
    inv_no: `${agency.split(" ")[0].replace(/[^A-Za-z]/g, "").slice(0, 3).toUpperCase()}-${rng.int(1000, 9999)}`,
    inv_month: `${MONTH_SHORT[Number(launch.slice(5, 7)) - 1]} ${launch.slice(0, 4)}`,
    inv_po: `PO-${rng.int(40000, 49999)}`,
  });

  // ---- Section 6: A/B test ----
  const abMin = rng.pick([5_000, 8_000, 10_000, 12_000]);
  const abLiftMin = rng.pick([5, 8, 10]);
  const abCase = rng.pick(["run", "run", "ship", "keep", "keep"] as const);
  let va: number, vb: number, oa: number, ob: number, lift: number;
  for (;;) {
    const short = abCase === "run";
    va = short && rng.int(0, 1) ? rng.int(Math.round(abMin * 0.45), abMin - 200) : rng.int(abMin + 200, abMin * 2);
    vb = short && (va >= abMin || rng.int(0, 1)) ? rng.int(Math.round(abMin * 0.45), abMin - 200) : rng.int(abMin + 200, abMin * 2);
    const cra = rng.int(150, 450) / 10_000;
    const wantLift = abCase === "keep" ? rng.int(-60, abLiftMin * 10 - 15) / 10 : rng.int(abLiftMin * 10 + 15, 400) / 10;
    oa = Math.round(va * cra);
    ob = Math.round(vb * cra * (1 + wantLift / 100));
    lift = ((ob / vb) / (oa / va) - 1) * 100;
    const ok = abCase === "keep" ? lift < abLiftMin - 1 : lift > abLiftMin + 1;
    if (ok && Math.abs(lift) >= 0.5 && Math.abs(lift * 10 - Math.round(lift * 10)) < 0.4) break;
  }
  Object.assign(v, {
    ab_min: fmt(abMin),
    ab_lift_min: String(abLiftMin),
    ab_test: rng.pick(["Hero image", "Checkout button", "Product page headline", "Free-shipping banner", "Bundle offer"]),
    ab_va: fmt(va),
    ab_vb: fmt(vb),
    ab_oa: fmt(oa),
    ab_ob: fmt(ob),
  });
  const abRight = { run: "Keep the test running: an arm hasn't reached the minimum sample", ship: "Ship B: both arms have the sample and B clears the minimum lift", keep: "Keep A: both arms have the sample but B's lift is under the minimum" }[abCase];
  const abAll = [
    "Keep the test running: an arm hasn't reached the minimum sample",
    "Ship B: both arms have the sample and B clears the minimum lift",
    "Keep A: both arms have the sample but B's lift is under the minimum",
    "Ship B to everyone now and keep measuring after launch",
  ];
  const ab = placeOptions(rng, abRight, abAll.filter((x) => x !== abRight));

  // ---- Section 6: values calls ----
  Object.assign(v, {
    deck_time: clock(rng.int(26, 34) * 30),
    candor_time: clock(rng.int(26, 36) * 30),
    candor_email: rng.pick(["launch-day reminder", "past-buyers email", "VIP early-access email"]),
    quality_time: clock(rng.int(24, 36) * 30),
    quality_email: rng.pick(["launch-day reminder", "past-buyers email", "weekend recap email"]),
  });
  const vi = placeOptions(rng, `Keep the slide on net revenue, as the reporting rules define ROAS, and offer ${pManager.first} gross revenue as a separate, labelled line`, [
    `Change it to gross: it's ${pManager.first}'s slide and the board won't dig into it`,
    "Show the gross figure labelled \"ROAS\" and put \"before refunds\" in a footnote",
    `Refuse, and report ${pManager.first} to finance for trying to mislead the board`,
  ]);
  const vc = placeOptions(rng, `Pause the send, fix the code, and tell ${pManager.first} it was my mistake and what I've changed`, [
    "Fix the code quietly before it sends; no harm done, so no need to mention it",
    `Ask ${pDesigner.first} to fix it, since they spotted it`,
    `Cancel every email in the launch queue until ${pManager.first} has re-checked them all`,
  ]);
  const vl = placeOptions(rng, `Decline the plain list; share the hashed list through the transfer folder, as the statement of work allows`, [
    `Send the full list: ${agency} works for us under contract`,
    "Send the full list in a password-protected spreadsheet",
    `Report ${agency} to legal for attempting a data breach and cut off their access`,
  ]);
  const vn = placeOptions(rng, `Don't confirm it: ask ${pCreator.first} to use the approved claims only and send the request to legal, who approve claims`, [
    "Confirm it: customers love the product, so it's basically true",
    "Suggest saying \"proven\" without \"clinically\" so it's safer",
    `End the partnership with ${pCreator.first} for suggesting a false claim`,
  ]);
  const vq = placeOptions(rng, `Run the link checks before scheduling and tell ${pPaid.first} now if that moves the send time`, [
    "Skip them this once: the links worked in last week's email",
    `Skip them: ${pPaid.first} is senior and it's their call`,
    "Cancel the send and ask for a full audit of every email template first",
  ]);
  LETTERS.forEach((l, j) => {
    v[`ab_${l}`] = ab.labels[j];
    v[`vi_${l}`] = vi.labels[j];
    v[`vc_${l}`] = vc.labels[j];
    v[`vl_${l}`] = vl.labels[j];
    v[`vn_${l}`] = vn.labels[j];
    v[`vq_${l}`] = vq.labels[j];
  });

  // ---- Rapid rounds, drawn last so the rest of the material doesn't shift when they change ----
  const rapidKeys = {
    "rapid-metrics": { items: buildMetrics(rng, v) },
    "rapid-copy": { items: buildCopy(rng, v, { product, price, code, oldCode, disc, legal, launch, line, word }) },
    "rapid-budget": { items: buildBudget(rng, v, agency, { ch: rev, spend: campaigns.filter((c) => c.ch === rev).reduce((s, c) => s + spendOf(c), 0) }, pPaid.first) },
  };

  return {
    values: v,
    numbers: [...Object.values(reportCells).map((c) => c.value), round1(lift)],
    keys: {
      ...rapidKeys,
      "campaign-report": { tolerance: 0, cells: reportCells },
      "launch-qa": { findings: qaKey, decision: ["hold"] },
      "invoice-check": { findings: invKey, decision: ["return"] },
      "ab-readout": { correct: [ab.letter] },
      "ab-lift": { value: round1(lift), tolerance: 0.05, partialTolerance: 0.3 },
      "values-integrity": { correct: [vi.letter] },
      "values-candor": { correct: [vc.letter] },
      "values-client-care": { correct: [vl.letter] },
      "values-in-lane": { correct: [vn.letter] },
      "values-quality": { correct: [vq.letter] },
    },
  };
}

interface CopyCtx {
  product: string;
  price: number;
  code: string;
  oldCode: string;
  disc: number;
  legal: string;
  launch: IsoDate;
  line: ProductLine;
  word: string;
}

/** A misspelling of the product name: wrong capitals or a split word. */
function wrongName(rng: Rng, product: string, word: string): string {
  const rest = product.slice(word.length);
  const split = word.replace(/([a-z])([A-Z])/, "$1 $2");
  const options = [word[0] + word.slice(1).toLowerCase() + rest, split + rest, word + rest.toLowerCase()].filter((x) => x !== product);
  return rng.pick(options);
}

function buildCopy(rng: Rng, v: Values, c: CopyCtx): Record<string, ChoiceKey> {
  const hard: CopyKind[] = ["two", "two", "weekday", "disclosure", rng.pick<CopyKind>(["weekday", "disclosure"])];
  const kinds = fillSlots(rng.shuffle(COPY_EASY), rng.shuffle(hard));
  const longDay = (d: IsoDate) => WEEKDAY_NAMES[weekdayOf(d)];
  return Object.fromEntries(
    kinds.map((kind, i) => {
      const d = draw(() => {
        const partner = kind === "disclosure" || (kind !== "weekday" && rng.int(0, 4) === 0);
        const asset = partner ? "Creator post (paid partner)" : rng.pick(COPY_ASSETS);
        const issues = new Set<CopyIssue>();
        if (kind === "two") {
          const [a, b] = pickDistinct(rng, ISSUE_ORDER, 2);
          issues.add(a).add(b);
        } else if (kind !== "fine" && kind !== "weekday" && kind !== "disclosure") issues.add(kind);
        const name = issues.has("name") ? wrongName(rng, c.product, c.word) : c.product;
        const shownPrice = issues.has("price") ? rng.pick([c.price + 10, c.price - 5, c.price + 20, c.price + 1]) : c.price;
        const shownCode = issues.has("code") ? (rng.int(0, 1) ? c.oldCode : c.code.slice(0, 3) + c.code.slice(4)) : rng.int(0, 3) === 0 ? c.code.toLowerCase() : c.code;
        const claim = issues.has("claim") ? rng.pick(c.line.notAllowed) : rng.int(0, 1) ? rng.pick(c.line.allowed) : null;
        const withDate = kind === "weekday" || rng.int(0, 1) === 1;
        const wrongDay = addDays(c.launch, rng.pick([-2, -1, 1, 2]));
        const dayName = kind === "weekday" ? longDay(wrongDay) : longDay(c.launch);
        const opener = rng.pick(OPENERS);
        const parts = [
          partner && kind !== "disclosure" ? "#ad" : "",
          `${opener} ${opener === "Meet the" ? "" : "the "}${name}${claim ? `, ${claim}` : ""}.`,
          withDate ? `Launches ${dayName}, ${monthDay(c.launch)}.` : "",
          `$${shownPrice}.`,
          `Use code ${shownCode} for ${c.disc}% off.`,
          issues.has("legal") ? "" : c.legal,
        ];
        const copy = parts.filter(Boolean).join(" ");
        let right: string;
        let wrong: string[] | null;
        const singles = (["fine", ...ISSUE_ORDER] as const).map((k) => COPY_LABEL[k]);
        if (kind === "two") {
          const [a, b] = [...issues];
          right = pairLabel(a, b);
          const other = rng.pick(ISSUE_ORDER.filter((x) => x !== a && x !== b));
          wrong = threeWrong(right, [COPY_LABEL[a], COPY_LABEL[b], pairLabel(rng.int(0, 1) ? a : b, other)]);
        } else if (kind === "weekday") {
          right = COPY_LABEL.weekday;
          wrong = threeWrong(right, [COPY_LABEL.date, COPY_LABEL.fine, rng.pick([COPY_LABEL.legal, COPY_LABEL.price])]);
        } else if (kind === "disclosure") {
          right = COPY_LABEL.disclosure;
          wrong = threeWrong(right, rng.shuffle(singles).slice(0, 3));
        } else {
          right = COPY_LABEL[kind];
          const pool = rng.shuffle(singles.filter((s) => s !== right));
          if (partner && rng.int(0, 1)) pool.unshift(COPY_LABEL.disclosure);
          wrong = threeWrong(right, pool);
        }
        if (!wrong) return null;
        return {
          title: asset,
          prompt: `Is this ${asset.toLowerCase()} ready to publish?`,
          rows: [
            ["Copy", copy],
            ["Launch sheet", `${c.product} · $${c.price} · code ${c.code} (${c.disc}% off) · launches ${formatDate(c.launch)}`],
            ["Legal line", c.legal],
            ["Claims not allowed", c.line.notAllowed.join("; ")],
            ["House rules", "Names exactly as written · codes not case sensitive · paid creator posts open with #ad"],
          ],
          right,
          wrong,
        };
      }, kind);
      return setItem(rng, v, "cp", i, d);
    }),
  );
}

export const marketingSaltboxLaunch = defineScenario({
  slug: "marketing-saltbox-launch",
  version: 1,
  title: "Launch week at Saltbox: marketing coordinator",
  roleFamily: "marketing",
  timeLimitMinutes: 50,
  definition: DEFINITION,

  build(rng) {
    for (let tries = 0; tries < 200; tries++) {
      const { values, numbers, keys } = buildOnce(rng);
      if (!leaks(values, numbers)) return { values, keys };
    }
    throw new Error("marketing-saltbox-launch: every draw shows a computed answer");
  },
});
