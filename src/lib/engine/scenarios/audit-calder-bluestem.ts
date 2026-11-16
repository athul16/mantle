import "server-only";

import type { VariantValue } from "../types";
import { defineScenario } from "../server/scenario";
import { formatCents } from "../server/template";
import { DOCUMENT_REVIEW } from "../step-types/document_review/public";
import { INBOX_REPLY } from "../step-types/inbox_reply/public";
import { JOURNAL_ENTRY } from "../step-types/journal_entry/public";
import { NUMERIC } from "../step-types/numeric/public";
import { RAPID_ROUND } from "../step-types/rapid_round/public";
import { SPREADSHEET } from "../step-types/spreadsheet/public";
import type { Rng } from "../server/rng";

/**
 * docs/07 Example 5: audit intern at Calder & Finch LLP on the December 31,
 * 2025 audit of Bluestem Manufacturing, 100 points in six timed sections
 * (52 minutes): rapid round A (tick and tie), vouching (one pair per screen),
 * rapid round B (cutoff), inbox (one screen each), rapid round C (sample
 * selection), then the summary, adjusting entries and email to Marcus.
 *
 * 0. Rapid rounds (3 × 10): 15 items × 20 s each, every exhibit seeded; the
 *    first five items of a round are worth 0.5, the other ten 0.75.
 * 1. Expense vouching (25): 8 sampled GL entries in four pairs, one planted
 *    exception per pair (amount above the invoice, a January 3 invoice booked
 *    in December, a personal expense booked as client entertainment, an
 *    accrual with no support), then a conclusion on the sample.
 * 2. Inbox under pressure (15): the controller asks to skip the unsupported
 *    item; Marcus wants the exception count and total; a bank confirmation
 *    doesn't agree to the cash lead schedule.
 * 3. Proposed adjustment (30): summary of misstatements, pass or propose
 *    against the clearly trivial threshold, adjusting entries, summary email.
 *
 * Every amount, payee, officer, date and document number is seeded per
 * candidate, and so is which item in which pair holds which trap. The key is
 * built from the same numbers, so the misstatement always equals the sum of
 * the planted errors. Sender names (Marcus Avery, Renee Okafor) are fixed:
 * message `from` lines aren't templated. Draft: needs accountant review.
 */

const YEAR = 2025;

const ACCOUNTS = [
  { code: "1010", name: "Cash" },
  { code: "1250", name: "Due from officer" },
  { code: "2000", name: "Accounts payable" },
  { code: "2100", name: "Accrued liabilities" },
  { code: "6100", name: "Repairs & maintenance" },
  { code: "6200", name: "Professional fees" },
  { code: "6300", name: "Meals & entertainment" },
  { code: "6400", name: "Shop supplies" },
  { code: "6500", name: "Utilities" },
  { code: "6600", name: "Travel" },
  { code: "6700", name: "Office expense" },
];
const accountText = (code: string) => `${code} ${ACCOUNTS.find((a) => a.code === code)!.name}`;

/** Ordinary expenses for clean items and the amount-mismatch trap. */
const KINDS = [
  { code: "6400", desc: "Shop consumables: abrasives and cutting fluid", payees: ["Harlow Industrial Supply", "Midland Fastener Co.", "Prairie Tool & Die"], range: [600, 4_800] },
  { code: "6500", desc: "Electricity, plant 1, Nov 5 – Dec 4 billing period", payees: ["Cedar Valley Power & Light", "Plains Electric Cooperative", "Big Sioux Energy"], range: [2_500, 9_500] },
  { code: "6600", desc: "Airfare, sales trip to customer site", payees: ["Skyline Air", "Prairie Wings Airlines", "Northstar Travel Agency"], range: [450, 2_400] },
  { code: "6700", desc: "Toner, copy paper and binders", payees: ["OfficeWorks Direct", "Paperline Supply", "Summit Office Products"], range: [300, 1_900] },
  { code: "6100", desc: "Hydraulic press repair, parts and labor", payees: ["Ridgeway Mechanical", "Tri-County Hydraulics", "Bridger Machine Repair"], range: [1_200, 7_500] },
] as const;
/** A real client dinner, so "booked to entertainment" alone isn't the tell. */
const DINNER = { payees: ["Prairie Oak Steakhouse", "The Granary Grill", "Riverside Chophouse"], range: [350, 1_600] } as const;
const CUSTOMERS = ["Fenwick Tractor", "Ostrander Ag Equipment", "Dakota Rail Parts", "Holloway Grain Systems"];
const OFFICERS = ["Dale Whitford", "Gary Lindqvist", "Tom Brandt", "Craig Halvorsen", "Neil Sorensen"];
const OFFICER_TITLES = ["CEO", "President"];
const CUTOFF_PAYEES = ["Apex Industrial Services", "Keystone Machine Service", "Northfield Automation"];
const PERSONAL = [
  { payee: "Northwind Ski Lodge", desc: "Lodging, 3 nights, family suite (2 adults, 2 children); lift tickets x4" },
  { payee: "Crescent Jewelers", desc: "Diamond stud earrings, gift wrapped" },
  { payee: "Lakeshore Pet Resort", desc: "Dog boarding, 10 nights, plus grooming" },
  { payee: "Bayview Marina", desc: "Winter storage and shrink-wrap, private boat" },
];
const CONSULTANTS = ["Larkspur Advisory Group", "Meridian Consulting Partners", "Oakridge Strategy LLC"];
const BANKS = ["First Prairie Bank", "Heartland Trust Bank", "Cedar Valley Bank"];

type Trap = "amount" | "cutoff" | "personal" | "support";
const TRAPS: Trap[] = ["amount", "cutoff", "personal", "support"];

/** One sampled item: the GL line and the support the client gave (null amount = none). */
interface Item {
  trap: Trap | null;
  ref: string;
  date: string;
  payee: string;
  desc: string;
  code: string;
  amount: number;
  doc: { source: string; ref: string; date: string; payee: string; desc: string; amount: number | null };
  /** Overstatement of expense in cents (0 for clean items). */
  misstatement: number;
}

const decDate = (day: number) => `12/${String(day).padStart(2, "0")}/${YEAR}`;
const NONE = "—";

const VOUCH_REASONS = [
  { id: "amount", label: "Amount doesn't agree to support" },
  { id: "cutoff", label: "Wrong period (cutoff)" },
  { id: "personal", label: "Not a business expense" },
  { id: "support", label: "No support" },
  { id: "approval", label: "Missing approval" },
  { id: "payee", label: "Payee doesn't match" },
  { id: "other", label: "Other" },
];

function vouchStep(k: number) {
  const a = 2 * k - 1;
  const b = 2 * k;
  const row = (n: number, part: "gl" | "doc") =>
    part === "gl"
      ? { id: `i${n}-gl`, cells: [`#${n}`, "GL detail", `{{e${n}_ref}}`, `{{e${n}_date}}`, `{{e${n}_payee}}`, `{{e${n}_desc}}`, `{{e${n}_account}}`, `{{e${n}_amt|money}}`] }
      : {
          id: `i${n}-doc`,
          cells: [`#${n}`, `{{e${n}_src}}`, `{{e${n}_doc_ref}}`, `{{e${n}_doc_date}}`, `{{e${n}_doc_payee}}`, `{{e${n}_doc_desc}}`, "", `{{e${n}_doc_amt}}`],
        };
  const last = k === 4;
  return {
    id: `vouch-${k}`,
    type: DOCUMENT_REVIEW,
    title: `Expense vouching: items ${a} and ${b}`,
    seconds: 180,
    config: {
      prompt: [
        `Vouch sample items ${a} and ${b}: agree each GL entry to its support (amount, date and period, payee, business purpose and account).`,
        "Flag the GL line of any item with an exception and pick the reason. Leave items that agree unflagged.",
        ...(last ? ["This is the last pair. Then give your conclusion on the whole sample of 8."] : []),
      ].join("\n"),
      document: {
        title: `Bluestem Manufacturing · Operating expenses, year ended December 31, ${YEAR} · Sample items ${a}–${b}`,
        columns: ["Item", "Source", "Ref", "Date", "Payee", "Description", "Account", "Amount"],
        rows: [row(a, "gl"), row(a, "doc"), row(b, "gl"), row(b, "doc")],
        footnote: "Support as provided by the client (PBC). Amounts in US dollars.",
      },
      reasons: VOUCH_REASONS,
      findings: [{ id: "exception", label: `Exception in items ${a}–${b}`, points: 5 }],
      ...(last
        ? {
            decision: {
              prompt: "Your conclusion on the sample of 8:",
              options: [
                { id: "no_exceptions", label: "No exceptions: operating expenses are supported" },
                { id: "propose", label: "Exceptions noted: document them and work out the adjustment" },
                { id: "replace", label: "Exceptions noted: replace those items with new sample items" },
                { id: "client_fix", label: "Exceptions noted: ask the client to fix them; nothing to document" },
              ],
              points: 5,
            },
          }
        : {}),
    },
  };
}

const money = (name: string) => ({ text: `{{${name}|money}}`, align: "right" as const });
const bold = (text: string) => ({ text, bold: true });
const input = (id: string, label: string, points: number, format?: "number") => ({ input: id, label, points, ...(format ? { format } : {}) });

/* ---------- Rapid rounds (phase B): authored once, every exhibit filled from seeded values ---------- */

const RAPID_COUNT = 15;
const RAPID_SECONDS = 20;
const ITEMS = Array.from({ length: RAPID_COUNT }, (_, i) => i + 1);
/** 5 × 0.5 + 10 × 0.75 = 10 exactly (2/3 a point each wouldn't add up to 10 in floating point). */
const itemPoints = (n: number) => (n <= 5 ? 0.5 : 0.75);
const opts = (pairs: [string, string][]) => pairs.map(([id, label]) => ({ id, label }));

/** Lookalike names: the vendor (or bank) exception swaps one for the other. */
const VENDOR_PAIRS: [string, string][] = [
  ["Harlow Industrial Supply", "Harlan Industrial Supply"],
  ["Midland Fastener Co.", "Midway Fastener Co."],
  ["Cascade Steel Service", "Cascade Steel Supply"],
  ["Tri-County Hydraulics", "Tri-State Hydraulics"],
  ["Prairie Tool & Die", "Pioneer Tool & Die"],
  ["Summit Office Products", "Summit Office Supply"],
];
const BANK_PAIRS: [string, string][] = [
  ["First Prairie Bank", "First Prairie Savings Bank"],
  ["Heartland Trust Bank", "Heartland Bank & Trust"],
  ["Cedar Valley Bank", "Cedar Valley Credit Union"],
];
const PURCHASES = ["steel bar stock", "hydraulic cylinders", "bearings and seals", "powder-coat paint", "gearbox castings"];

/** Tick and tie: does the schedule line agree to its source document? */
const TICK_DOCS = {
  invoice: { sched: "AP subledger", doc: "Vendor invoice", refLabel: "Invoice no.", partyLabel: "Vendor", figLabel: "Amount" },
  bank: { sched: "Cash lead schedule", doc: "Bank confirmation", refLabel: "Account", partyLabel: "Bank", figLabel: "Balance" },
  receiving: { sched: "Inventory receipts log", doc: "Receiving report", refLabel: "Receiving report no.", partyLabel: "Vendor", figLabel: "Quantity" },
} as const;
type TickDoc = keyof typeof TICK_DOCS;
type TickCase = "agrees" | "amount" | "cutoff" | "vendor" | "no_support";

const tickItem = (n: number) => {
  const v = (name: string) => `{{tt${n}_${name}}}`;
  return {
    id: `tt-${n}`,
    prompt: "Agree the schedule line to the source document.",
    exhibit: {
      table: {
        columns: ["", v("sched"), v("doc")],
        rows: [
          [v("ref_label"), v("s_ref"), v("d_ref")],
          [v("party_label"), v("s_party"), v("d_party")],
          ["Date", v("s_date"), v("d_date")],
          [v("fig_label"), v("s_fig"), v("d_fig")],
        ],
      },
    },
    fields: [
      { id: "result", label: "Result", kind: "choice" as const, options: opts([["agrees", "Agrees"], ["exception", "Exception"]]) },
      {
        id: "reason",
        label: "Reason",
        kind: "choice" as const,
        options: opts([
          ["amount", "Amount or quantity"],
          ["cutoff", "Date or cutoff"],
          ["vendor", "Vendor or bank name"],
          ["no_support", "No support"],
          ["na", "N/A: agrees"],
        ]),
      },
    ],
    points: itemPoints(n),
  };
};

/** Cutoff: which year does the sale or purchase belong to under its FOB terms, and was it recorded there? */
const cutoffItem = (n: number) => {
  const v = (name: string) => `{{co${n}_${name}}}`;
  return {
    id: `co-${n}`,
    prompt: `Year-end is 12/31/${YEAR}. Which year does this ${v("what")} belong to, and did Bluestem record it in that year?`,
    exhibit: {
      title: v("title"),
      rows: [
        { label: "Transaction", value: v("txn") },
        { label: "Terms", value: v("terms") },
        { label: "Shipped", value: v("shipped") },
        { label: "Delivered", value: v("delivered") },
        { label: "Invoice date", value: v("invoiced") },
        { label: "Recorded in GL", value: v("recorded") },
        { label: "Amount", value: `{{co${n}_amt|money}}` },
      ],
    },
    fields: [
      { id: "year", label: "Belongs to", kind: "choice" as const, options: opts([[`y${YEAR}`, String(YEAR)], [`y${YEAR + 1}`, String(YEAR + 1)]]) },
      { id: "recorded", label: "Recorded in the right year?", kind: "choice" as const, options: opts([["yes", "Yes"], ["no", "No"]]) },
    ],
    points: itemPoints(n),
  };
};

/** Sample selection: items 1, 4, 7, ... pick the selected line; 2, 5, 8, ... count them; 3, 6, 9, ... find the missing check. */
type SampleKind = "line" | "count" | "missing";
const sampleKind = (n: number): SampleKind => (["line", "count", "missing"] as const)[(n - 1) % 3];
const LINES = ["A", "B", "C", "D", "E"];
const MISSING_OPTIONS = 4;

const sampleItem = (n: number) => {
  const v = (name: string) => `{{ss${n}_${name}}}`;
  const kind = sampleKind(n);
  const base = { id: `ss-${n}`, points: itemPoints(n) };
  if (kind === "missing") {
    return {
      ...base,
      prompt: "Scan the check register for a gap in the check sequence. Which check number is missing?",
      exhibit: {
        title: `Check register, operating account, December ${YEAR}`,
        table: {
          columns: ["Check no.", "Date", "Payee", "Amount"],
          rows: [1, 2, 3, 4, 5, 6].map((r) => [`#${v(`r${r}_no`)}`, v(`r${r}_date`), v(`r${r}_payee`), `{{ss${n}_r${r}_amt|money}}`]),
        },
      },
      fields: [
        {
          id: "missing",
          label: "Missing check",
          kind: "choice" as const,
          options: Array.from({ length: MISSING_OPTIONS }, (_, i) => ({ id: `o${i + 1}`, label: `#${v(`o${i + 1}`)}` })),
        },
      ],
    };
  }
  const rule = `Rule: select every item over {{ss${n}_thr|money}}, plus every ${v("kth")} item number starting at #${v("start")}.`;
  return {
    ...base,
    prompt: kind === "line" ? `${rule} Which line does the rule select?` : `${rule} How many of these five lines does the rule select?`,
    exhibit: {
      title: "Population listing (excerpt)",
      table: {
        columns: ["Line", "Item no.", "Amount"],
        rows: LINES.map((l) => [l, `#${v(`${l.toLowerCase()}_no`)}`, `{{ss${n}_${l.toLowerCase()}_amt|money}}`]),
      },
    },
    fields:
      kind === "line"
        ? [{ id: "line", label: "Selected line", kind: "choice" as const, options: LINES.map((l) => ({ id: l.toLowerCase(), label: `Line ${l}` })) }]
        : [{ id: "count", label: "Lines selected", kind: "choice" as const, options: opts([["c1", "1"], ["c2", "2"], ["c3", "3"], ["c4", "4"]]) }],
  };
};

/** Days after December 31 of the audit year (0 = 12/31, 1 = 01/01 of the next year) as mm/dd/yyyy. */
function dayDate(offset: number): string {
  const d = new Date(Date.UTC(YEAR, 11, 31 + offset));
  return `${String(d.getUTCMonth() + 1).padStart(2, "0")}/${String(d.getUTCDate()).padStart(2, "0")}/${d.getUTCFullYear()}`;
}
const ordinal = (k: number) => `${k}${k === 1 ? "st" : k === 2 ? "nd" : k === 3 ? "rd" : "th"}`;

type RapidKey = { items: Record<string, Record<string, { choice: string }>> };

/** Seeds the three rapid rounds. Runs after phase A's draws, so phase A's numbers don't move. */
function buildRapid(rng: Rng, values: Record<string, VariantValue>) {
  const put = (prefix: string, obj: Record<string, VariantValue>) => {
    for (const [k, x] of Object.entries(obj)) values[`${prefix}_${k}`] = x;
  };
  const tick: RapidKey = { items: {} };
  const cutoff: RapidKey = { items: {} };
  const sample: RapidKey = { items: {} };

  // Tick and tie: 5 agree; 3 amount, 3 cutoff, 2 vendor, 2 no support. Five of each document type.
  const cases = rng.shuffle<TickCase>([
    ...Array<TickCase>(5).fill("agrees"),
    ...Array<TickCase>(3).fill("amount"),
    ...Array<TickCase>(3).fill("cutoff"),
    ...Array<TickCase>(2).fill("vendor"),
    ...Array<TickCase>(2).fill("no_support"),
  ]);
  const docs = rng.shuffle<TickDoc>([...Array<TickDoc>(5).fill("invoice"), ...Array<TickDoc>(5).fill("bank"), ...Array<TickDoc>(5).fill("receiving")]);
  for (const n of ITEMS) {
    const c = cases[n - 1];
    const docType = docs[n - 1];
    const t = TICK_DOCS[docType];
    const pair = rng.pick(docType === "bank" ? BANK_PAIRS : VENDOR_PAIRS);
    const swap = rng.int(0, 1);
    const party = pair[swap];
    const ref =
      docType === "invoice" ? `INV-${rng.int(10_000, 99_999)}` : docType === "bank" ? `Operating, ending ${rng.int(1_000, 9_999)}` : `RR-${rng.int(1_000, 9_999)}`;
    const date = docType === "bank" ? dayDate(0) : dayDate(-rng.int(0, 27));
    let fig: string;
    let otherFig: string;
    if (docType === "receiving") {
      const qty = rng.int(20, 2_400);
      const alt = qty + rng.int(2, 60) * (rng.int(0, 1) === 1 || qty < 80 ? 1 : -1);
      fig = `${qty.toLocaleString("en-US")} units`;
      otherFig = `${alt.toLocaleString("en-US")} units`;
    } else {
      const amt = docType === "bank" ? rng.cents(60_000, 900_000) : rng.cents(400, 24_000);
      const delta = rng.pick([900, 9_000, 10_000, 100_000, 1_800]) * (rng.int(0, 1) === 1 ? 1 : -1);
      fig = formatCents(amt);
      otherFig = formatCents(amt + delta);
    }
    const doc = {
      ref: c === "no_support" ? "Not on file" : ref,
      party: c === "no_support" ? NONE : c === "vendor" ? pair[1 - swap] : party,
      date: c === "no_support" ? NONE : c === "cutoff" ? dayDate(rng.int(2, 9)) : date,
      fig: c === "no_support" ? NONE : c === "amount" ? otherFig : fig,
    };
    put(`tt${n}`, {
      sched: t.sched,
      doc: t.doc,
      ref_label: t.refLabel,
      party_label: t.partyLabel,
      fig_label: t.figLabel,
      s_ref: ref,
      s_party: party,
      s_date: c === "cutoff" && docType !== "bank" ? dayDate(-rng.int(0, 4)) : date,
      s_fig: fig,
      d_ref: doc.ref,
      d_party: doc.party,
      d_date: doc.date,
      d_fig: doc.fig,
    });
    tick.items[`tt-${n}`] = { result: { choice: c === "agrees" ? "agrees" : "exception" }, reason: { choice: c === "agrees" ? "na" : c } };
  }

  // Cutoff: every (year, recorded right) pair occurs; FOB shipping point and destination split 8 / 7.
  const combos = rng.shuffle([
    [YEAR, true],
    [YEAR, false],
    [YEAR + 1, true],
    [YEAR + 1, false],
  ] as const);
  const plan = rng.shuffle(combos.flatMap((combo, i) => Array(i === 3 ? 3 : 4).fill(combo) as (typeof combo)[]));
  const terms = rng.shuffle([...Array<boolean>(8).fill(true), ...Array<boolean>(7).fill(false)]);
  for (const n of ITEMS) {
    const [year, right] = plan[n - 1];
    const shippingPoint = terms[n - 1];
    const sale = rng.int(0, 1) === 1;
    const transfer = year === YEAR ? -rng.int(0, 5) : rng.int(1, 5);
    const transit = rng.int(1, 4);
    const shipped = shippingPoint ? transfer : transfer - transit;
    const delivered = shippingPoint ? transfer + transit : transfer;
    const invoiced = shipped + rng.int(0, 2);
    const inYear = (d: number, y: number) => (d <= 0 ? YEAR : YEAR + 1) === y;
    const recordYear = right ? year : year === YEAR ? YEAR + 1 : YEAR;
    const candidates = [shipped, invoiced, delivered].filter((d) => inYear(d, recordYear));
    const recorded = candidates.length ? rng.pick(candidates) : recordYear === YEAR ? 0 : 2;
    put(`co${n}`, {
      what: sale ? "sale" : "purchase",
      title: `Bill of lading BL-${rng.int(10_000, 99_999)}`,
      txn: sale ? `Sale of finished goods to ${rng.pick(CUSTOMERS)}` : `Purchase of ${rng.pick(PURCHASES)} from ${rng.pick(VENDOR_PAIRS)[0]}`,
      terms: shippingPoint ? "FOB shipping point" : "FOB destination",
      shipped: dayDate(shipped),
      delivered: dayDate(delivered),
      invoiced: dayDate(invoiced),
      recorded: dayDate(recorded),
      amt: rng.cents(3_000, 85_000),
    });
    cutoff.items[`co-${n}`] = { year: { choice: `y${year}` }, recorded: { choice: right ? "yes" : "no" } };
  }

  // Sample selection.
  for (const n of ITEMS) {
    const kind = sampleKind(n);
    if (kind === "missing") {
      const first = rng.int(1_000, 9_000);
      const gap = rng.int(1, 5);
      const nos = Array.from({ length: 7 }, (_, i) => first + i).filter((_, i) => i !== gap);
      let day = rng.int(1, 6);
      nos.forEach((no, r) => {
        day += rng.int(0, 4);
        put(`ss${n}_r${r + 1}`, { no, date: dayDate(-(31 - Math.min(day, 31))), payee: rng.pick(VENDOR_PAIRS)[0], amt: rng.cents(150, 18_000) });
      });
      const missing = first + gap;
      const options = rng.shuffle([missing, ...rng.shuffle(nos).slice(0, MISSING_OPTIONS - 1)]);
      options.forEach((no, i) => (values[`ss${n}_o${i + 1}`] = no));
      sample.items[`ss-${n}`] = { missing: { choice: `o${options.indexOf(missing) + 1}` } };
      continue;
    }

    const thrDollars = rng.pick([5_000, 10_000, 25_000]);
    const thr = thrDollars * 100;
    const below = () => rng.cents(Math.round(thrDollars * 0.08), Math.round(thrDollars * 0.9));
    const above = () => rng.cents(thrDollars + 1, thrDollars * 3);
    const k = rng.pick([3, 4, 5]);
    let nos: number[];
    let start: number;
    let overThreshold: number[];
    let answer: string;
    const hits = (ns: number[], s: number) => ns.map((x, i) => (x >= s && (x - s) % k === 0 ? i : -1)).filter((i) => i >= 0);

    if (kind === "line") {
      // Exactly one line is selected, by amount or by the interval.
      const target = rng.int(0, 4);
      const byAmount = rng.int(0, 1) === 1;
      for (let tries = 0; ; tries++) {
        if (tries > 200) throw new Error("audit-calder-bluestem: no sample line layout");
        let x = rng.int(1_200, 8_800);
        nos = LINES.map(() => (x += rng.int(1, 4)));
        start = byAmount ? nos[0] - rng.int(0, 3 * k) : nos[target] - k * rng.int(0, 3);
        const h = hits(nos, start);
        if (byAmount ? h.length === 0 : h.length === 1 && h[0] === target) break;
      }
      overThreshold = byAmount ? [target] : [];
      answer = LINES[target].toLowerCase();
    } else {
      // Five consecutive item numbers: the interval picks one or two, amounts add 0 to 2 more.
      const first = rng.int(1_200, 8_800);
      nos = LINES.map((_, i) => first + i);
      start = first + rng.int(0, k - 1) - k * rng.int(1, 3);
      const h = hits(nos, start);
      const rest = rng.shuffle([0, 1, 2, 3, 4].filter((i) => !h.includes(i)));
      const total = rng.int(h.length, Math.min(4, h.length + 2));
      overThreshold = rest.slice(0, total - h.length);
      answer = `c${total}`;
    }

    const selected = new Set([...hits(nos, start), ...overThreshold]);
    const unselected = [0, 1, 2, 3, 4].filter((i) => !selected.has(i));
    const nearMiss = unselected.length ? rng.pick(unselected) : -1;
    LINES.forEach((l, i) => {
      const amt = overThreshold.includes(i) ? above() : i === nearMiss ? thr - rng.cents(1, 250) : below();
      put(`ss${n}_${l.toLowerCase()}`, { no: nos[i], amt });
    });
    put(`ss${n}`, { thr, kth: ordinal(k), start });
    sample.items[`ss-${n}`] = kind === "line" ? { line: { choice: answer } } : { count: { choice: answer } };
  }

  return { "rapid-tick": tick, "rapid-cutoff": cutoff, "rapid-sample": sample };
}

export const auditCalderBluestem = defineScenario({
  slug: "audit-calder-bluestem",
  version: 1,
  title: "Calder & Finch: Bluestem Manufacturing year-end audit",
  roleFamily: "accounting",
  timeLimitMinutes: 52,
  definition: {
    intro: `You're an audit intern at Calder & Finch LLP. It's fieldwork week on the December 31, ${YEAR} year-end audit of Bluestem Manufacturing. Your senior, Marcus Avery, will send you work through the session, and the client's team will be in touch too. The session runs in six timed parts, three of them quick-fire rounds; once a part ends you can't go back to it.`,
    steps: [
      {
        id: "rapid-tick",
        type: RAPID_ROUND,
        title: "Rapid round: tick and tie",
        config: {
          intro: "Agree each schedule line to its source document: Agrees or Exception, and why. 15 items, 20 seconds each.",
          secondsPerItem: RAPID_SECONDS,
          items: ITEMS.map(tickItem),
        },
      },
      vouchStep(1),
      vouchStep(2),
      vouchStep(3),
      vouchStep(4),
      {
        id: "rapid-cutoff",
        type: RAPID_ROUND,
        title: "Rapid round: cutoff",
        config: {
          intro: "Shipments either side of December 31: which year each belongs to under its FOB terms, and whether Bluestem recorded it there. 15 items, 20 seconds each.",
          secondsPerItem: RAPID_SECONDS,
          items: ITEMS.map(cutoffItem),
        },
      },
      {
        id: "controller-reply",
        type: INBOX_REPLY,
        title: "Reply to Renee",
        seconds: 240,
        config: {
          prompt: "Reply to Renee about the item she wants to skip.",
          to: "Renee Okafor, Controller, Bluestem Manufacturing",
          subject: "RE: Can we skip this one?",
          maxChars: 3_000,
          criteria: [
            {
              id: "declines",
              label: "Politely declines to drop or swap the sampled item",
              maxPoints: 2,
              guidance: "Says, politely, that the item stays in the sample: a selected item can't be skipped or replaced with another.",
            },
            {
              id: "alternative",
              label: "Asks for other evidence that supports the accrual",
              maxPoints: 2,
              guidance:
                "Asks for alternative support for the {{sup_payee}} accrual, e.g. the contract or engagement letter, emails agreeing the fee, evidence the work was done, or the invoice once received. Doesn't accept the phone call alone.",
            },
            {
              id: "courtesy",
              label: "Courteous with the client and doesn't overpromise",
              maxPoints: 1,
              guidance: "Friendly and professional; makes no promise that the item will be cleared; may say Marcus will be kept informed.",
            },
          ],
        },
      },
      {
        id: "exception-count",
        type: NUMERIC,
        title: "Marcus: number of exceptions",
        seconds: 90,
        config: { prompt: "How many of the 8 sampled items are exceptions?", unit: "items", decimals: 0, points: 2 },
      },
      {
        id: "exception-total",
        type: NUMERIC,
        title: "Marcus: total misstatement",
        seconds: 90,
        config: {
          prompt: "Total misstatement from those exceptions, in dollars: how much operating expenses are overstated, as a positive number.",
          unit: "$",
          decimals: 2,
          points: 3,
        },
      },
      {
        id: "bank-confirm",
        type: DOCUMENT_REVIEW,
        title: "Bank confirmation: {{bank}}",
        seconds: 180,
        config: {
          prompt: "Compare the bank confirmation with the cash lead schedule. Flag anything that doesn't agree, then choose what you do next.",
          document: {
            title: `{{bank}} · Standard confirmation vs cash lead schedule · December 31, ${YEAR}`,
            columns: ["Item", "Amount"],
            rows: [
              { id: "confirm", cells: [`Operating account ending {{acct}}: balance per bank confirmation, 12/31/${YEAR}`, "{{conf_bal|money}}"] },
              { id: "lead", cells: [`Operating account ending {{acct}}: balance per cash lead schedule (GL 1010), 12/31/${YEAR}`, "{{lead_bal|money}}"] },
              { id: "payroll", cells: ["Payroll account ending {{acct2}}: confirmation and lead schedule", "{{payroll_bal|money}}"] },
              { id: "loans", cells: ["Loans and lines of credit per confirmation", "None"] },
            ],
            totals: [{ id: "difference", label: "Operating account: confirmation less lead schedule", value: "{{bank_diff|money}}" }],
            footnote: "Confirmation sent and received directly by Calder & Finch, signed by the bank.",
          },
          reasons: [
            { id: "disagree", label: "Balances don't agree" },
            { id: "account", label: "Wrong account" },
            { id: "date", label: "Wrong date" },
            { id: "unsigned", label: "Not signed by the bank" },
            { id: "other", label: "Other" },
          ],
          findings: [{ id: "difference", label: "Confirmed balance doesn't agree to the lead schedule", points: 2 }],
          decision: {
            prompt: "What do you do next?",
            options: [
              { id: "adjust", label: "Propose an entry to change cash to the confirmed balance" },
              { id: "reconcile", label: "Get the client's December 31 bank reconciliation, agree the confirmed balance to it and vouch the reconciling items" },
              { id: "pass", label: "Note the difference as immaterial and move on" },
              { id: "ask_client", label: "Ask the client to contact the bank and have the confirmation corrected" },
            ],
            points: 3,
          },
        },
      },
      {
        id: "rapid-sample",
        type: RAPID_ROUND,
        title: "Rapid round: sample selection",
        config: {
          intro: "Apply each item's selection rule to the listing, or find the gap in the check register. 15 items, 20 seconds each.",
          secondsPerItem: RAPID_SECONDS,
          items: ITEMS.map(sampleItem),
        },
      },
      {
        id: "misstatement-summary",
        type: SPREADSHEET,
        title: "Summary of misstatements",
        config: {
          prompt: [
            "For each sampled item, enter the misstatement: how much operating expenses are overstated, as a positive amount (0 if none).",
            "Then the total, and the call from Marcus's memo: 1 if we propose the adjustment, 0 if we pass.",
          ].join("\n"),
          columns: ["A", "B", "C", "D", "E"],
          rows: [
            [bold(`Summary of misstatements · Operating expenses · Year ended December 31, ${YEAR}`), null, null, null, null],
            [bold("Item"), bold("Ref"), bold("Payee"), bold("GL amount"), bold("Misstatement")],
            ...[1, 2, 3, 4, 5, 6, 7, 8].map((n) => [`#${n}`, `{{e${n}_ref}}`, `{{e${n}_payee}}`, money(`e${n}_amt`), input(`mis_${n}`, `Item #${n} misstatement`, 2)]),
            [null, null, null, null, null],
            [bold("Total misstatement"), null, null, null, input("total", "Total misstatement", 2)],
            ["Propose (1) or pass (0)", null, null, null, input("propose", "Pass or propose call", 4, "number")],
          ],
        },
      },
      {
        id: "proposed-aje",
        type: JOURNAL_ENTRY,
        title: "Proposed adjusting entries",
        config: {
          prompt: "Draft the adjusting entries for the exceptions in the expense sample, one entry per exception, using only the accounts listed.",
          accounts: ACCOUNTS,
          maxEntries: 8,
          maxLines: 4,
          expected: [
            { id: "amount", label: "Expense booked above the invoice amount", points: 2 },
            { id: "cutoff", label: "January invoice booked in December", points: 2 },
            { id: "personal", label: "Personal expense out of entertainment", points: 2 },
            { id: "support", label: "Unsupported accrual reversed", points: 2 },
          ],
        },
      },
      {
        id: "marcus-summary",
        type: INBOX_REPLY,
        title: "Summary to Marcus",
        config: {
          prompt: "Send Marcus your summary of the expense testing.",
          to: "Marcus Avery, Audit Senior",
          subject: "RE: Bluestem expense testing: summary for partner review",
          maxChars: 4_000,
          criteria: [
            {
              id: "numbers",
              label: "Gives the count, the total and the pass or propose call",
              maxPoints: 3,
              guidance: "States the number of exceptions, the total misstatement, how it compares with the clearly trivial threshold, and whether we pass or propose.",
            },
            {
              id: "exceptions",
              label: "Explains each exception briefly",
              maxPoints: 3,
              guidance: "One line per exception: the invoice amount difference, the January invoice booked in December (cutoff), the personal expense booked as client entertainment, and the accrual with no support.",
            },
            {
              id: "clarity",
              label: "Short, organized and professional",
              maxPoints: 2,
              guidance: "Easy to use in a partner review: organized, around 150 words or fewer, with a greeting and sign-off.",
            },
          ],
        },
      },
    ],
    messages: [
      {
        id: "m-tick",
        from: "Marcus Avery, Audit Senior, Calder & Finch LLP",
        subject: "Warm-up: tick and tie",
        body: "Hi {{first_name}}, while I pull the expense sample, a warm-up: 15 quick tick-and-tie checks. Each shows a line from one of our schedules next to its source document (vendor invoice, bank confirmation or receiving report). Tell me whether they agree and, if not, why. 20 seconds each.\n\nMarcus",
        arriveAtMinute: 0,
        stepId: "rapid-tick",
      },
      {
        id: "m1",
        from: "Marcus Avery, Audit Senior, Calder & Finch LLP",
        subject: "Bluestem: expense vouching",
        body: [
          "Hi {{first_name}},",
          "",
          "Next job: expense vouching.",
          "",
          `I pulled a sample of 8 entries from operating expenses for the year ended December 31, ${YEAR}. They're in four pairs, one screen each (about 3 minutes a pair), each with the GL detail and whatever support the client gave us. For each item, agree the GL entry to its support: amount, date and period, payee, and whether it's a genuine business expense in the right account. Flag anything that's off, with a reason. After the last pair, give me your conclusion on the sample.`,
          "",
          "More will come through as the day goes. Shout if you're stuck.",
          "",
          "Marcus",
        ].join("\n"),
        arriveAtMinute: 0,
        stepId: "vouch-1",
      },
      {
        id: "m-cutoff",
        from: "Marcus Avery, Audit Senior, Calder & Finch LLP",
        subject: "Cutoff testing",
        body: "Cutoff next: 15 shipments either side of December 31. For each, which year does it belong to under its FOB terms, and did Bluestem record it in that year? 20 seconds each.\n\nMarcus",
        arriveAtMinute: 0,
        stepId: "rapid-cutoff",
      },
      {
        id: "m2",
        from: "Renee Okafor, Controller, Bluestem Manufacturing",
        subject: "Can we skip this one?",
        body: [
          "Hi {{first_name}},",
          "",
          "I saw your request for support on item #{{sup_item}}, the {{sup_payee}} accrual ({{sup_amt|money}}). Honestly, that one's an estimate: {{officer}} agreed it with them over the phone and the invoice hasn't come in yet.",
          "",
          "We're slammed with year-end. Can you just skip that one and pick a different entry for your sample? There are plenty of others.",
          "",
          "Thanks,",
          "Renee",
        ].join("\n"),
        arriveAtMinute: 0,
        stepId: "controller-reply",
      },
      {
        id: "m3",
        from: "Marcus Avery, Audit Senior, Calder & Finch LLP",
        subject: "Quick one",
        body: "I'm meeting Renee at 2. How many exceptions did you find in the expense sample of 8?\n\nMarcus",
        arriveAtMinute: 0,
        stepId: "exception-count",
      },
      {
        id: "m4",
        from: "Marcus Avery, Audit Senior, Calder & Finch LLP",
        subject: "RE: Quick one",
        body: "And the total dollar misstatement from them? How much expenses are overstated.\n\nMarcus",
        arriveAtMinute: 0,
        stepId: "exception-total",
      },
      {
        id: "m5",
        from: "Marcus Avery, Audit Senior, Calder & Finch LLP",
        subject: "Bank confirmation is back",
        body: [
          "The {{bank}} confirmation came back. The operating account is {{bank_diff_abs|money}} {{bank_dir}} than our cash lead schedule. The payroll account agrees.",
          "",
          "It's attached to this task. What would you do next?",
          "",
          "Marcus",
        ].join("\n"),
        arriveAtMinute: 0,
        stepId: "bank-confirm",
      },
      {
        id: "m-sample",
        from: "Marcus Avery, Audit Senior, Calder & Finch LLP",
        subject: "Sample selection",
        body: "One more quick round before the wrap-up: sample selection. Apply the rule in each item to the listing, and check the register for a gap in the check sequence. 20 seconds each.\n\nMarcus",
        arriveAtMinute: 0,
        stepId: "rapid-sample",
      },
      {
        id: "m6",
        from: "Marcus Avery, Audit Senior, Calder & Finch LLP",
        subject: "Materiality and the summary of misstatements",
        body: [
          "Here's materiality from the planning memo:",
          "",
          "Overall materiality: {{mat|money}}",
          "Performance materiality: {{pm|money}}",
          "Clearly trivial threshold: {{ct|money}}",
          "",
          "Our rule on this job: add up the known misstatements from your sample (no projection, I'll handle that). If the total is below the clearly trivial threshold, we pass: we note it on the summary of unadjusted differences and don't ask the client for an entry. At or above the threshold, we propose the adjusting entries to the client.",
          "",
          "Please fill in the summary of misstatements and make the call.",
          "",
          "Marcus",
        ].join("\n"),
        arriveAtMinute: 0,
        stepId: "misstatement-summary",
      },
      {
        id: "m7",
        from: "Marcus Avery, Audit Senior, Calder & Finch LLP",
        subject: "Adjusting entries",
        body: "Please draft the adjusting entries for the expense exceptions, one entry per exception. Draft them whether we pass or propose: they go on the summary either way.\n\nMarcus",
        arriveAtMinute: 0,
        stepId: "proposed-aje",
      },
      {
        id: "m8",
        from: "Marcus Avery, Audit Senior, Calder & Finch LLP",
        subject: "Bluestem expense testing: summary for partner review",
        body: "Partner review is at 4. Send me a short email I can use: how many exceptions, the total, a line on each, and whether we pass or propose.\n\nMarcus",
        arriveAtMinute: 0,
        stepId: "marcus-summary",
      },
    ],
    sections: [
      { id: "s-rapid-a", title: "Rapid round A: tick and tie", minutes: 6, stepIds: ["rapid-tick"] },
      { id: "s-vouch", title: "Expense vouching", minutes: 12, stepIds: ["vouch-1", "vouch-2", "vouch-3", "vouch-4"], oneAtATime: true },
      { id: "s-rapid-b", title: "Rapid round B: cutoff", minutes: 6, stepIds: ["rapid-cutoff"] },
      {
        id: "s-inbox",
        title: "Inbox",
        minutes: 10,
        stepIds: ["controller-reply", "exception-count", "exception-total", "bank-confirm"],
        oneAtATime: true,
      },
      { id: "s-rapid-c", title: "Rapid round C: sample selection", minutes: 6, stepIds: ["rapid-sample"] },
      { id: "s-wrap", title: "Summary and adjusting entries", minutes: 12, stepIds: ["misstatement-summary", "proposed-aje", "marcus-summary"] },
    ],
  },

  build(rng) {
    const used = new Set<number>();
    /** A 4-digit document number not used elsewhere in this variant. */
    const docNo = () => {
      let x: number;
      do {
        x = rng.int(1_000, 8_999);
      } while (used.has(x));
      used.add(x);
      return x;
    };
    const day = () => rng.int(1, 27);
    const officer = rng.pick(OFFICERS);
    const officerTitle = rng.pick(OFFICER_TITLES);
    const card = docNo();

    const invoiced = (trap: Trap | null, payee: string, code: string, desc: string, amount: number, d = day()): Item => ({
      trap,
      ref: `AP-${docNo()}`,
      date: decDate(d),
      payee,
      desc,
      code,
      amount,
      doc: { source: "Vendor invoice", ref: `INV-${docNo()}`, date: decDate(Math.max(1, d - rng.int(0, 3))), payee, desc, amount },
      misstatement: 0,
    });

    // Amount mismatch: hundreds and tens digits swapped, the GL above the invoice.
    const kinds = rng.shuffle(KINDS);
    const mk = kinds[0];
    const thousands = rng.int(1, 4);
    const hi = rng.int(1, 9);
    const lo = rng.int(0, hi - 1);
    const unit = rng.int(0, 9);
    const centsPart = rng.int(0, 99);
    const glBig = (thousands * 1000 + hi * 100 + lo * 10 + unit) * 100 + centsPart;
    const invSmall = (thousands * 1000 + lo * 100 + hi * 10 + unit) * 100 + centsPart;
    const amountItem = invoiced("amount", rng.pick(mk.payees), mk.code, mk.desc, glBig);
    amountItem.doc.amount = invSmall;
    amountItem.misstatement = glBig - invSmall;

    // Cutoff: January work, invoice dated January 3, posted in the last days of December.
    const line = rng.int(1, 4);
    const cutoffAmt = rng.cents(2_000, 9_000);
    const cutoffPayee = rng.pick(CUTOFF_PAYEES);
    const cutoffItem: Item = {
      ...invoiced("cutoff", cutoffPayee, "6100", `Preventive maintenance, CNC line ${line}`, cutoffAmt, rng.int(28, 31)),
      misstatement: cutoffAmt,
    };
    cutoffItem.doc = {
      ...cutoffItem.doc,
      date: `01/03/${YEAR + 1}`,
      desc: `Preventive maintenance, CNC line ${line}; work performed January 2–3, ${YEAR + 1}`,
    };

    // Personal: paid on the company card, booked as client entertainment.
    const personal = rng.pick(PERSONAL);
    const personalAmt = rng.cents(1_200, 4_800);
    const personalDay = day();
    const personalItem: Item = {
      trap: "personal",
      ref: `CC-${docNo()}`,
      date: decDate(personalDay),
      payee: personal.payee,
      desc: "Client entertainment",
      code: "6300",
      amount: personalAmt,
      doc: {
        source: "Card receipt",
        ref: `R-${docNo()}`,
        date: decDate(personalDay),
        payee: personal.payee,
        desc: `${personal.desc}. Company Visa ending ${card}, cardholder ${officer} (${officerTitle}). No attendees or business purpose noted.`,
        amount: personalAmt,
      },
      misstatement: personalAmt,
    };

    // Unsupported: a round-number year-end accrual with nothing behind it.
    const consultant = rng.pick(CONSULTANTS);
    const supportAmt = rng.int(30, 120) * 10_000;
    const supportItem: Item = {
      trap: "support",
      ref: `JE-${rng.int(140, 399)}`,
      date: decDate(31),
      payee: consultant,
      desc: "Year-end accrual: Q4 consulting services",
      code: "6200",
      amount: supportAmt,
      doc: {
        source: "No support provided",
        ref: NONE,
        date: NONE,
        payee: NONE,
        desc: `Client: "${officer} agreed this with ${consultant} by phone; the invoice hasn't come in." No invoice, contract or engagement letter on file.`,
        amount: null,
      },
      misstatement: supportAmt,
    };

    // Clean items: four of the remaining ordinary kinds and a real client dinner.
    const dinner = (): Item => {
      const payee = rng.pick(DINNER.payees);
      const amt = rng.cents(DINNER.range[0], DINNER.range[1]);
      const d = day();
      const guests = rng.int(3, 6);
      const customer = rng.pick(CUSTOMERS);
      return {
        trap: null,
        ref: `CC-${docNo()}`,
        date: decDate(d),
        payee,
        desc: "Client entertainment",
        code: "6300",
        amount: amt,
        doc: {
          source: "Card receipt",
          ref: `R-${docNo()}`,
          date: decDate(d),
          payee,
          desc: `Dinner for ${guests + 1}. Attendees: ${officer} and ${guests} from ${customer} purchasing. Business purpose: annual supply contract review. Company Visa ending ${card}.`,
          amount: amt,
        },
        misstatement: 0,
      };
    };
    const cleanChoices = rng.shuffle([...kinds.slice(1).map((k) => () => invoiced(null, rng.pick(k.payees), k.code, k.desc, rng.cents(k.range[0], k.range[1]))), dinner]).slice(0, 4);
    const clean = cleanChoices.map((make) => make());

    // One trap per pair, in a seeded pair and position.
    const trapItems: Record<Trap, Item> = { amount: amountItem, cutoff: cutoffItem, personal: personalItem, support: supportItem };
    const pairTraps = rng.shuffle(TRAPS);
    const items: Item[] = [];
    pairTraps.forEach((t, p) => {
      const pair = [trapItems[t], clean[p]];
      items.push(...(rng.int(0, 1) === 1 ? pair.reverse() : pair));
    });
    const numberOf = (t: Trap) => items.findIndex((i) => i.trap === t) + 1;

    const total = TRAPS.reduce((s, t) => s + trapItems[t].misstatement, 0);

    // Materiality: the clearly trivial threshold falls on either side of the total.
    const propose = rng.int(0, 1) === 1;
    const step = 50_000; // $500
    const ct = propose
      ? Math.max(step, Math.floor((total * rng.int(40, 85)) / 100 / step) * step)
      : Math.ceil((total * rng.int(120, 180)) / 100 / step) * step;
    if (propose ? ct >= total : ct <= total) throw new Error("audit-calder-bluestem: threshold on the wrong side");
    const mat = ct * 20;
    const pm = (mat * 3) / 4;

    // Bank confirmation: the operating account differs from the lead schedule.
    const lead = rng.cents(180_000, 650_000);
    const bankDiff = rng.cents(1_200, 9_800) * (rng.int(0, 1) === 1 ? 1 : -1);

    const values: Record<string, VariantValue> = {
      officer,
      sup_item: numberOf("support"),
      sup_payee: consultant,
      sup_amt: supportAmt,
      bank: rng.pick(BANKS),
      acct: docNo(),
      acct2: docNo(),
      lead_bal: lead,
      conf_bal: lead + bankDiff,
      payroll_bal: rng.cents(20_000, 90_000),
      bank_diff: bankDiff,
      bank_diff_abs: Math.abs(bankDiff),
      bank_dir: bankDiff > 0 ? "higher" : "lower",
      mat,
      pm,
      ct,
    };
    items.forEach((it, i) => {
      const n = i + 1;
      Object.assign(values, {
        [`e${n}_ref`]: it.ref,
        [`e${n}_date`]: it.date,
        [`e${n}_payee`]: it.payee,
        [`e${n}_desc`]: it.desc,
        [`e${n}_account`]: accountText(it.code),
        [`e${n}_amt`]: it.amount,
        [`e${n}_src`]: it.doc.source,
        [`e${n}_doc_ref`]: it.doc.ref,
        [`e${n}_doc_date`]: it.doc.date,
        [`e${n}_doc_payee`]: it.doc.payee,
        [`e${n}_doc_desc`]: it.doc.desc,
        [`e${n}_doc_amt`]: it.doc.amount === null ? NONE : formatCents(it.doc.amount),
      });
    });

    const rapidKeys = buildRapid(rng, values);

    const d = (c: number) => c / 100;
    const entry = (dr: string[], cr: string[], amount: number) => ({
      lines: [
        { accounts: dr, side: "debit" as const, amount: d(amount) },
        { accounts: cr, side: "credit" as const, amount: d(amount) },
      ],
    });
    const n = numberOf;
    const fc = formatCents;
    const describe: Record<Trap, string> = {
      amount: `#${n("amount")} ${amountItem.payee}: booked ${fc(glBig)}, invoice ${amountItem.doc.ref} is ${fc(invSmall)}; expense overstated by ${fc(amountItem.misstatement)}.`,
      cutoff: `#${n("cutoff")} ${cutoffPayee}: invoice ${cutoffItem.doc.ref} dated 01/03/${YEAR + 1} for January work, booked ${cutoffItem.date}; ${fc(cutoffAmt)} belongs in ${YEAR + 1} (cutoff).`,
      personal: `#${n("personal")} ${personal.payee}: ${fc(personalAmt)} personal purchase on ${officer}'s company card, booked as client entertainment; reclass to due from officer.`,
      support: `#${n("support")} ${consultant}: ${fc(supportAmt)} year-end accrual with no invoice, contract or engagement letter; reverse unless support arrives.`,
    };
    const findingKey = (t: Trap) => ({
      findings: {
        exception: { targets: [`i${n(t)}-gl`, `i${n(t)}-doc`], reasons: [t], note: `Planted ${t} exception. ${describe[t]}` },
      },
    });
    const vouchKeys = Object.fromEntries(
      pairTraps.map((t, p) => [`vouch-${p + 1}`, p === 3 ? { ...findingKey(t), decision: ["propose"] } : findingKey(t)]),
    );

    const call = propose
      ? `at or above the clearly trivial threshold of ${fc(ct)}: propose the adjusting entries`
      : `below the clearly trivial threshold of ${fc(ct)}: pass, noted on the summary of unadjusted differences`;

    return {
      values,
      keys: {
        ...rapidKeys,
        ...vouchKeys,
        "controller-reply": {
          notes: {
            declines: `Item #${n("support")}, the ${fc(supportAmt)} ${consultant} accrual, stays in the sample: a selected item isn't skipped or swapped for an easier one.`,
            alternative: `Good alternatives: the engagement letter or contract with ${consultant}, emails agreeing the fee, evidence the Q4 work was done, or the invoice when it arrives (checking its date and period). Without support the full ${fc(supportAmt)} is a misstatement.`,
          },
        },
        "exception-count": { value: 4, tolerance: 0 },
        "exception-total": { value: d(total), tolerance: 0.005 },
        "bank-confirm": {
          findings: {
            difference: {
              targets: ["confirm", "lead", "difference"],
              reasons: ["disagree"],
              note: `Confirmation ${fc(lead + bankDiff)} vs lead schedule ${fc(lead)}: likely reconciling items (outstanding checks, deposits in transit) to agree to the December 31 bank reconciliation.`,
            },
          },
          decision: ["reconcile"],
        },
        "misstatement-summary": {
          tolerance: 0.005,
          cells: {
            ...Object.fromEntries(TRAPS.map((t) => [`mis_${n(t)}`, { value: d(trapItems[t].misstatement) }])),
            total: { value: d(total) },
            propose: { value: propose ? 1 : 0, tolerance: 0 },
          },
        },
        "proposed-aje": {
          entries: {
            // Booked through payables; accept Cash if the candidate treats it as paid.
            amount: entry(["2000", "1010"], [mk.code], amountItem.misstatement),
            cutoff: entry(["2000", "2100"], ["6100"], cutoffAmt),
            personal: entry(["1250"], ["6300"], personalAmt),
            support: entry(["2100"], ["6200"], supportAmt),
          },
        },
        "marcus-summary": {
          notes: {
            numbers: `4 exceptions; total misstatement ${fc(total)}, ${call}. Overall materiality ${fc(mat)}, performance materiality ${fc(pm)}.`,
            exceptions: TRAPS.map((t) => describe[t]).join(" "),
          },
        },
      },
    };
  },
});
