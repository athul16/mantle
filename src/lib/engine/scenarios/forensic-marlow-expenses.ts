import "server-only";

import type { Rng } from "../server/rng";
import { defineScenario } from "../server/scenario";
import { formatCents } from "../server/template";
import { DOCUMENT_REVIEW } from "../step-types/document_review/public";
import { INBOX_REPLY } from "../step-types/inbox_reply/public";
import { MULTIPLE_CHOICE } from "../step-types/multiple_choice/public";
import { NUMERIC } from "../step-types/numeric/public";
import { RAPID_ROUND } from "../step-types/rapid_round/public";
import { SPREADSHEET } from "../step-types/spreadsheet/public";

/**
 * docs/07 Example 9: forensic intern at Marlow Forensic, engaged by a
 * nonprofit's board after a tip about expense and vendor fraud. Six timed
 * sections (49 minutes, 100 points): rapid round A, red flag or normal (10)
 * → vendor master review, one screen at a time, plus the follow-up list (25)
 * → rapid round B, duplicate hunt (10) → inbox, one screen at a time (15) →
 * rapid round C, quick analytics (10) → findings sheet and memo (30).
 *
 * Seeded per candidate: the nonprofit, its staff and their home addresses,
 * the board member, the approval limit, every vendor, address, tax ID, date,
 * invoice number and amount, which vendor carries which shell-vendor sign
 * and on which screen, and every rapid item. All names are invented.
 *
 * One employee (the suspect) has a home address that matches a vendor's:
 * that vendor is "the flagged vendor" in Sam's email and the findings. The
 * keys are built from the same values as the material, so the flagged total
 * is always the sum of that vendor's payments in the extract.
 *
 * Shaped by the current step types (draft: needs accountant review):
 * - `document_review` takes one flag per item, so each suspicious vendor
 *   shows exactly one sign and each screen holds exactly one.
 * - Spreadsheet cells take numbers, so "red flags" in the findings sheet are
 *   counted (payments on a weekend or just under the limit).
 * - Rapid round C runs a fixed rotation (month, split, total) because each
 *   kind has its own fields; the content of every item is seeded.
 */

const SAM = "Sam Whitlock, Lead Investigator, Marlow Forensic";
const DAY = 86_400_000;
const Q1 = Date.UTC(2026, 0, 1) / DAY;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const NONPROFITS = [
  "Thistlebrook Youth Alliance",
  "Fernhollow Community Pantry",
  "Larkmoor Literacy Project",
  "Quillfield Family Shelter",
  "Brindlewood Arts Collective",
  "Ashcombe Vale Senior Services",
  "Marrowind Animal Rescue",
  "Kelderby Housing Fund",
];
const TOWNS = ["Larkmoor, OH 43122", "Fennick, OH 43140", "Ashby Falls, OH 43155", "Corrin Mill, OH 43168", "Wexley, OH 43177"];
const STREETS = [
  "Birch Lane",
  "Maple Avenue",
  "Harbor Street",
  "Linden Court",
  "Orchard Road",
  "Willow Drive",
  "Chestnut Street",
  "Quarry Road",
  "Elm Terrace",
  "Juniper Way",
  "Foxglove Lane",
  "Mill Pond Road",
  "Station Street",
  "Hawthorn Avenue",
  "Kestrel Drive",
  "Sycamore Place",
  "Ridge Road",
  "Clover Court",
  "Granary Lane",
  "Beacon Street",
];
const FIRST = ["Dana", "Morgan", "Priya", "Elliot", "Renata", "Caleb", "Wen", "Joanna", "Marcus", "Tessa", "Ian", "Leila", "Owen", "Sofia", "Graham", "Nadia"];
const LAST = ["Kirby", "Halvorsen", "Okonkwo", "Bramwell", "Castellanos", "Lindgren", "Adeyemi", "Whitcombe", "Ferreira", "Nakamura", "Duquesne", "Albright", "Vasquez", "Holloway", "Strand", "Obi"];
const SUSPECT_TITLES = ["Operations Manager", "Finance Manager", "Facilities Coordinator", "Office Manager"];
/** Invented business names: a made-up place word and a trade. */
const STEMS = [
  "Ardley",
  "Brevick",
  "Corvane",
  "Dellmore",
  "Ebbrook",
  "Farrowgate",
  "Glenvarra",
  "Halvorn",
  "Iverlane",
  "Jessamy",
  "Kestwick",
  "Lorrimer",
  "Norvale",
  "Oxbury",
  "Penhallow",
  "Quenby",
  "Rosswick",
  "Stalbridge",
  "Tarrant Hill",
  "Ulverby",
  "Wendmoor",
  "Yarrowfield",
];
const TRADES = [
  "Print & Copy",
  "Office Supply",
  "Janitorial",
  "IT Services",
  "Catering",
  "Courier",
  "Consulting",
  "Staffing",
  "Facility Services",
  "Event Rentals",
  "Security",
  "Landscaping",
  "Plumbing",
  "Electrical",
  "Translation",
  "Payroll Services",
];
const LIMITS = [250_000, 500_000, 750_000, 1_000_000];

type Indicator = "po_box" | "no_tax_id" | "employee_address" | "same_day";
const INDICATORS: Indicator[] = ["po_box", "no_tax_id", "employee_address", "same_day"];

// ---- Small helpers ----

const pad = (n: number) => String(n).padStart(2, "0");
const toDate = (day: number) => new Date(day * DAY);
const dateText = (day: number) => {
  const d = toDate(day);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
};
const dayText = (day: number) => `${WEEKDAYS[toDate(day).getUTCDay()]}, ${dateText(day)}`;
const isWeekend = (day: number) => [0, 6].includes(toDate(day).getUTCDay());

/** A day in Q1 2026 (offsets from Jan 1) that is, or isn't, on a weekend. */
function q1Day(rng: Rng, lo: number, hi: number, weekend: boolean): number {
  for (let i = 0; i < 200; i++) {
    const d = Q1 + rng.int(lo, hi);
    if (isWeekend(d) === weekend) return d;
  }
  throw new Error("forensic-marlow-expenses: no day found");
}

/** Cents with a non-zero cents part, so it's never a round amount. */
function oddCents(rng: Rng, lo: number, hi: number): number {
  const c = rng.int(Math.round(lo), Math.round(hi));
  return c % 100 === 0 ? c + 37 : c;
}

/** A round amount (whole $25s) $25 to `maxUnder` under the limit. */
const justUnder = (rng: Rng, limit: number, maxSteps: number) => limit - 2_500 * rng.int(1, maxSteps);

/** `n` business names with different place words. */
function businessNames(rng: Rng, n: number): string[] {
  return rng.shuffle(STEMS)
    .slice(0, n)
    .map((stem) => `${stem} ${rng.pick(TRADES)}`);
}

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter((w) => /^[A-Z]/.test(w))
    .map((w) => w[0])
    .join("")
    .slice(0, 3);

const ein = (rng: Rng) => `${rng.int(10, 99)}-${rng.int(1_000_000, 9_999_999)}`;

// ---- Rapid rounds ----

/** Every third item (3, 6, 9, …) holds the harder kinds. */
const isHardSlot = (i: number) => i % 3 === 2;
const slotNo = (i: number) => pad(i + 1);

function fillSlots<T>(count: number, easy: T[], hard: T[]): T[] {
  const e = [...easy];
  const h = [...hard];
  const out = Array.from({ length: count }, (_, i) => (isHardSlot(i) ? h.shift() : e.shift()));
  if (out.some((x) => x === undefined) || e.length || h.length) throw new Error("forensic-marlow-expenses: rapid slots don't fill");
  return out as T[];
}

const RED_FLAG_WHY = [
  { id: "ok", label: "Nothing unusual" },
  { id: "under_limit", label: "Round amount just under the approval limit" },
  { id: "weekend", label: "Weekend date" },
  { id: "employee_address", label: "Address matches an employee's" },
  { id: "shared_bank", label: "Same bank account as another vendor" },
  { id: "sequential", label: "Sequential invoice numbers from one vendor" },
];
type RedFlagCase =
  | "under_limit"
  | "weekend"
  | "sequential"
  | "normal_expense"
  | "normal_vendor"
  | "employee_address"
  | "shared_bank"
  | "near_lease"
  | "near_street";
const RED_EASY: RedFlagCase[] = ["under_limit", "under_limit", "weekend", "weekend", "sequential", "sequential", "normal_expense", "normal_expense", "normal_vendor", "normal_vendor"];

/** [description, category, the payee's trade]. */
const EXPENSES: [string, string, string][] = [
  ["Printer toner and paper", "Office supplies", "Office Supply"],
  ["Volunteer appreciation lunch", "Meals", "Catering"],
  ["Laptop for program staff", "Equipment", "IT Services"],
  ["Courier runs to the county office", "Postage and delivery", "Courier"],
  ["Tent and table rental for the spring fundraiser", "Events", "Event Rentals"],
  ["Quarterly building cleaning", "Repairs and maintenance", "Janitorial"],
  ["Flyers for the spring food drive", "Printing", "Print & Copy"],
  ["Leaking pipe in the pantry kitchen", "Repairs and maintenance", "Plumbing"],
];
/** Bigger tickets for the "just under the limit" lines. */
const LARGE_EXPENSES: [string, string, string][] = [
  ["Strategic plan consulting, phase 2", "Professional fees", "Consulting"],
  ["Office network upgrade", "Equipment", "IT Services"],
  ["Gala catering deposit", "Events", "Catering"],
  ["Temporary staff for the holiday drive", "Contract labor", "Staffing"],
];

const RAPID_ROWS = 6;

const rapidRedFlagStep = {
  id: "rapid-redflag",
  type: RAPID_ROUND,
  title: "Rapid round: red flag or normal",
  config: {
    intro: [
      "Red flag or normal: 15 items, 20 seconds each. Each one is an expense line or a vendor record from {{org}}.",
      "Payments of {{limit|money}} or more need a second approval.",
      "Pick Red flag or Normal, and why.",
    ].join("\n"),
    secondsPerItem: 20,
    items: Array.from({ length: 15 }, (_, i) => {
      const n = slotNo(i);
      return {
        id: `rf-${n}`,
        prompt: "Red flag or normal?",
        exhibit: {
          title: `{{ra_${n}_title}}`,
          rows: Array.from({ length: RAPID_ROWS }, (_, j) => ({ label: `{{ra_${n}_l${j + 1}}}`, value: `{{ra_${n}_v${j + 1}}}` })),
        },
        fields: [
          {
            id: "call",
            label: "Call",
            kind: "choice",
            options: [
              { id: "red_flag", label: "Red flag" },
              { id: "normal", label: "Normal" },
            ],
          },
          { id: "why", label: "Why", kind: "choice", options: RED_FLAG_WHY },
        ],
        points: isHardSlot(i) ? 1 : 0.5,
      };
    }),
  },
};

const rapidDuplicateStep = {
  id: "rapid-duplicate",
  type: RAPID_ROUND,
  title: "Rapid round: duplicate hunt",
  config: {
    intro: [
      "Duplicate hunt: 15 items, 20 seconds each. Each shows six paid invoices, in the order they were paid.",
      "One invoice in each list was paid twice. Pick the row of the second payment.",
    ].join("\n"),
    secondsPerItem: 20,
    items: Array.from({ length: 15 }, (_, i) => {
      const n = slotNo(i);
      return {
        id: `dh-${n}`,
        prompt: "Which row pays the same invoice a second time?",
        exhibit: {
          title: "Paid invoices",
          table: {
            columns: ["Row", "Vendor", "Invoice no.", "Invoice date", "Amount"],
            rows: Array.from({ length: 6 }, (_, j) => {
              const r = `rb_${n}_r${j + 1}`;
              return [String(j + 1), `{{${r}_vendor}}`, `{{${r}_inv}}`, `{{${r}_date}}`, `{{${r}_amt|money}}`];
            }),
          },
        },
        fields: [
          {
            id: "row",
            label: "Second payment",
            kind: "choice",
            options: Array.from({ length: 6 }, (_, j) => ({ id: `r${j + 1}`, label: `Row ${j + 1}` })),
          },
        ],
        points: isHardSlot(i) ? 1 : 0.5,
      };
    }),
  },
};

const MONTH_NAMES = ["July", "August", "September", "October", "November", "December"];
const CATEGORIES = ["Office supplies", "Travel reimbursements", "Catering", "Printing", "Fuel cards", "Program supplies", "Phone and internet"];
type AnalyticsKind = "month" | "split" | "total";
const analyticsKind = (i: number): AnalyticsKind => (["month", "split", "total"] as const)[i % 3];

const rapidAnalyticsStep = {
  id: "rapid-analytics",
  type: RAPID_ROUND,
  title: "Rapid round: quick analytics",
  config: {
    intro: [
      "Quick analytics: 12 items, 25 seconds each. Read the table and answer.",
      "Payments of {{limit|money}} or more need a second approval.",
    ].join("\n"),
    secondsPerItem: 25,
    items: Array.from({ length: 12 }, (_, i) => {
      const n = slotNo(i);
      const kind = analyticsKind(i);
      const points = isHardSlot(i) ? 1 : 0.75;
      if (kind === "month") {
        return {
          id: `qa-${n}`,
          prompt: "Which month breaks the pattern?",
          exhibit: {
            title: `Monthly totals: {{rc_${n}_category}}`,
            table: { columns: ["Month", "Total"], rows: MONTH_NAMES.map((m, j) => [`${m} 2025`, `{{rc_${n}_m${j + 1}|money}}`]) },
          },
          fields: [{ id: "month", label: "Month", kind: "choice", options: MONTH_NAMES.map((m, j) => ({ id: `m${j + 1}`, label: m })) }],
          points,
        };
      }
      const rows = kind === "split" ? 7 : 6;
      const table = {
        columns: ["Date", "Vendor", "Amount"],
        rows: Array.from({ length: rows }, (_, j) => [`{{rc_${n}_p${j + 1}_date}}`, `{{rc_${n}_p${j + 1}_vendor}}`, `{{rc_${n}_p${j + 1}_amt|money}}`]),
      };
      if (kind === "split") {
        return {
          id: `qa-${n}`,
          prompt: "Which vendor's payments look split to stay under the {{limit|money}} approval limit?",
          exhibit: { title: "Payments, Q1 2026", table },
          fields: [
            {
              id: "vendor",
              label: "Vendor",
              kind: "choice",
              options: ["a", "b", "c", "d"].map((l) => ({ id: l, label: `{{rc_${n}_opt_${l}}}` })),
            },
          ],
          points,
        };
      }
      return {
        id: `qa-${n}`,
        prompt: "What did we pay {{rc_" + n + "_vendor}} in total?",
        exhibit: { title: "Payments, Q1 2026", table },
        fields: [{ id: "total", label: "Total paid", kind: "number", unit: "USD", decimals: 2 }],
        points,
      };
    }),
  },
};

type RapidKeyItems = Record<string, Record<string, { choice: string } | { value: number; tolerance: number }>>;
type Values = Record<string, string | number>;

/** Rapid A: one expense line or vendor record each, at most one problem. */
function buildRedFlag(rng: Rng, v: Values, ctx: { limit: number; approvers: string[]; town: string }): RapidKeyItems {
  const hard = rng.shuffle<RedFlagCase>(["employee_address", "employee_address", "shared_bank", "shared_bank", rng.pick(["near_lease", "near_street"] as const)]);
  const cases = fillSlots(15, rng.shuffle(RED_EASY), hard);
  const stems = rng.shuffle(STEMS);
  const names = stems.map((s) => `${s} ${rng.pick(TRADES)}`);
  const lasts = rng.shuffle(LAST);
  const people = rng.shuffle(FIRST).map((f, i) => `${f} ${lasts[i]}`);
  const { limit } = ctx;
  return Object.fromEntries(
    cases.map((c, i) => {
      const n = slotNo(i);
      const vendor = names[i % names.length];
      const set = (title: string, rows: [string, string][]) => {
        v[`ra_${n}_title`] = title;
        rows.forEach(([label, value], j) => {
          v[`ra_${n}_l${j + 1}`] = label;
          v[`ra_${n}_v${j + 1}`] = value;
        });
      };
      const expense = ["under_limit", "weekend", "normal_expense", "near_lease"].includes(c);
      if (expense) {
        const [desc, category, trade] =
          c === "near_lease" ? ["Monthly office rent, per lease", "Rent", "Properties"] : rng.pick(c === "under_limit" ? LARGE_EXPENSES : EXPENSES);
        const day = q1Day(rng, 4, 85, c === "weekend");
        const amount =
          c === "under_limit"
            ? justUnder(rng, limit, 6)
            : c === "near_lease"
              ? 2_500 * rng.int(Math.ceil((limit * 0.2) / 2_500), Math.floor((limit * 0.5) / 2_500))
              : oddCents(rng, limit * 0.1, limit * 0.6);
        set("Expense line", [
          ["Date", dayText(day)],
          ["Paid to", `${stems[i % stems.length]} ${trade}`],
          ["Description", desc],
          ["Category", category],
          ["Amount", formatCents(amount)],
          ["Approved by", rng.pick(ctx.approvers)],
        ]);
      } else {
        const [s1, s2] = rng.shuffle(STREETS);
        const num = rng.int(12, 2_900);
        const address = `${num} ${s1}, ${ctx.town}`;
        let otherNum = rng.int(12, 2_900);
        if (otherNum === num) otherNum += 7;
        const employeeAddress =
          c === "employee_address" ? address : c === "near_street" ? `${otherNum} ${s1}, ${ctx.town}` : `${rng.int(12, 2_900)} ${s2}, ${ctx.town}`;
        const acct = rng.int(1_000, 9_999);
        let otherAcct = rng.int(1_000, 9_999);
        if (otherAcct === acct) otherAcct = acct === 9_999 ? 1_000 : acct + 1;
        const first = rng.int(1_000, 8_800);
        const invoices = c === "sequential" ? [first, first + 1, first + 2] : [first, first + rng.int(5, 60), 0];
        if (c !== "sequential") invoices[2] = invoices[1] + rng.int(5, 60);
        set("Vendor record", [
          ["Vendor", vendor],
          ["Address", address],
          ["Bank account", `acct ending ${acct}`],
          ["Recent invoices", invoices.join(", ")],
          ["Employee on payroll", `${people[i % people.length]}, ${employeeAddress}`],
          ["Another vendor on file", `${names[(i + 20) % names.length]}, acct ending ${c === "shared_bank" ? acct : otherAcct}`],
        ]);
      }
      const why = ["under_limit", "weekend", "sequential", "employee_address", "shared_bank"].includes(c) ? c : "ok";
      return [`rf-${n}`, { call: { choice: why === "ok" ? "normal" : "red_flag" }, why: { choice: why } }];
    }),
  );
}

const FORMATS: ((n: number) => string)[] = [(n) => `INV-${n}`, (n) => `${n}`, (n) => `INV${n}`, (n) => `INV-0${n}`, (n) => `#${n}`];
const shapeOf = (inv: string) => inv.replace(/\d+/, "N");

/** Rapid B: six paid invoices, one of them paid twice (number format or a day apart). */
function buildDuplicate(rng: Rng, v: Values): RapidKeyItems {
  type Change = "format" | "day";
  const easy = rng.shuffle<Change>(["format", "format", "format", "format", "format", "day", "day", "day", "day", "day"]).map((change) => ({ change, decoy: false }));
  const hard = rng.shuffle<Change>(["format", "format", "day", "day", rng.pick(["format", "day"] as const)]).map((change) => ({ change, decoy: true }));
  const cases = fillSlots(15, easy, hard);
  return Object.fromEntries(
    cases.map(({ change, decoy }, i) => {
      const n = slotNo(i);
      for (let tries = 0; tries < 50; tries++) {
        const vendors = businessNames(rng, 5);
        const used = new Set<number>();
        const number = () => {
          for (;;) {
            const x = rng.int(1_000, 99_999);
            if (!used.has(x)) {
              used.add(x);
              return x;
            }
          }
        };
        const amounts = new Set<number>();
        const amount = () => {
          for (;;) {
            const a = oddCents(rng, 15_000, 900_000);
            if (!amounts.has(a)) {
              amounts.add(a);
              return a;
            }
          }
        };
        type Row = { vendor: string; inv: string; day: number; amount: number; twin?: boolean };
        const rows: Row[] = [];
        // The invoice paid twice.
        const tw = { vendor: vendors[0], no: number(), day: Q1 + rng.int(5, 84), amount: amount() };
        if (change === "format") {
          const [fa, fb] = rng.shuffle([0, 1, 2, 3, 4]);
          rows.push({ vendor: tw.vendor, inv: FORMATS[fa](tw.no), day: tw.day, amount: tw.amount, twin: true });
          rows.push({ vendor: tw.vendor, inv: FORMATS[fb](tw.no), day: tw.day, amount: tw.amount, twin: true });
        } else {
          const inv = rng.pick(FORMATS)(tw.no);
          rows.push({ vendor: tw.vendor, inv, day: tw.day, amount: tw.amount, twin: true });
          rows.push({ vendor: tw.vendor, inv, day: tw.day + (rng.int(0, 1) ? 1 : -1), amount: tw.amount, twin: true });
        }
        // A recurring charge: same vendor and amount a month apart, different invoices.
        if (decoy) {
          const a = amount();
          const d1 = Q1 + rng.int(2, 55);
          rows.push({ vendor: vendors[1], inv: rng.pick(FORMATS)(number()), day: d1, amount: a });
          rows.push({ vendor: vendors[1], inv: rng.pick(FORMATS)(number()), day: d1 + rng.int(28, 31), amount: a });
        }
        let k = decoy ? 2 : 1;
        while (rows.length < 6) {
          rows.push({ vendor: vendors[k], inv: rng.pick(FORMATS)(number()), day: Q1 + rng.int(2, 87), amount: amount() });
          k = k === 4 ? 1 : k + 1;
        }
        if (new Set(rows.map((r) => shapeOf(r.inv))).size < 2) continue;
        const order = rng.shuffle(rows);
        order.forEach((r, j) => {
          const p = `rb_${n}_r${j + 1}`;
          Object.assign(v, { [`${p}_vendor`]: r.vendor, [`${p}_inv`]: r.inv, [`${p}_date`]: dateText(r.day), [`${p}_amt`]: r.amount });
        });
        const second = order.length - 1 - [...order].reverse().findIndex((r) => r.twin);
        return [`dh-${n}`, { row: { choice: `r${second + 1}` } }];
      }
      throw new Error("forensic-marlow-expenses: no duplicate-hunt variant");
    }),
  );
}

/** Rapid C: month that breaks the pattern, split payments, total paid to one vendor. */
function buildAnalytics(rng: Rng, v: Values, limit: number): RapidKeyItems {
  const sortByDay = <T extends { day: number }>(rows: T[]) => [...rows].sort((a, b) => a.day - b.day);
  const setRows = (n: string, rows: { day: number; vendor: string; amount: number }[]) =>
    sortByDay(rows).forEach((r, j) => {
      Object.assign(v, { [`rc_${n}_p${j + 1}_date`]: dateText(r.day), [`rc_${n}_p${j + 1}_vendor`]: r.vendor, [`rc_${n}_p${j + 1}_amt`]: r.amount });
    });
  return Object.fromEntries(
    Array.from({ length: 12 }, (_, i) => {
      const n = slotNo(i);
      const kind = analyticsKind(i);
      if (kind === "month") {
        const base = rng.cents(1_200, 9_000);
        const odd = rng.int(0, 5);
        v[`rc_${n}_category`] = rng.pick(CATEGORIES);
        for (let j = 0; j < 6; j++) {
          const factor = j === odd ? rng.int(190, 280) : rng.int(92, 108);
          v[`rc_${n}_m${j + 1}`] = oddCents(rng, (base * factor) / 100, (base * factor) / 100 + 99);
        }
        return [`qa-${n}`, { month: { choice: `m${odd + 1}` } }];
      }
      if (kind === "split") {
        const [target, apart, small, single] = businessNames(rng, 4);
        const d = Q1 + rng.int(3, 80);
        const d1 = Q1 + rng.int(2, 40);
        const d2 = Q1 + rng.int(2, 85);
        const rows = [
          { day: d, vendor: target, amount: oddCents(rng, limit * 0.55, limit * 0.95 - 1) },
          { day: d + rng.int(0, 2), vendor: target, amount: oddCents(rng, limit * 0.55, limit * 0.95 - 1) },
          { day: d1, vendor: apart, amount: oddCents(rng, limit * 0.5, limit * 0.9) },
          { day: d1 + rng.int(21, 45), vendor: apart, amount: oddCents(rng, limit * 0.5, limit * 0.9) },
          { day: d2, vendor: small, amount: oddCents(rng, limit * 0.1, limit * 0.4) },
          { day: d2, vendor: small, amount: oddCents(rng, limit * 0.1, limit * 0.4) },
          { day: Q1 + rng.int(2, 87), vendor: single, amount: oddCents(rng, limit * 0.3, limit * 0.95 - 1) },
        ];
        setRows(n, rows);
        const options = rng.shuffle([target, apart, small, single]);
        ["a", "b", "c", "d"].forEach((l, j) => (v[`rc_${n}_opt_${l}`] = options[j]));
        return [`qa-${n}`, { vendor: { choice: ["a", "b", "c", "d"][options.indexOf(target)] } }];
      }
      const [target, ...others] = businessNames(rng, 3);
      const mine = rng.int(2, 3);
      const owners = [...Array(mine).fill(target), ...Array.from({ length: 6 - mine }, (_, j) => others[j % 2])];
      const rows = owners.map((vendor) => ({ day: Q1 + rng.int(2, 87), vendor, amount: oddCents(rng, 12_000, 480_000) }));
      setRows(n, rows);
      v[`rc_${n}_vendor`] = target;
      const total = rows.filter((r) => r.vendor === target).reduce((t, r) => t + r.amount, 0);
      return [`qa-${n}`, { total: { value: total / 100, tolerance: 0.005 } }];
    }),
  );
}

// ---- Vendor master screens ----

const VENDOR_REASONS = [
  { id: "po_box", label: "PO box address" },
  { id: "no_tax_id", label: "No tax ID on file" },
  { id: "employee_address", label: "Address matches an employee's" },
  { id: "same_day", label: "Created and paid the same day" },
  { id: "other", label: "Other" },
];

function vendorStep(k: number) {
  return {
    id: `vendors-${k}`,
    type: DOCUMENT_REVIEW,
    seconds: 150,
    title: `Vendor master, screen ${k} of 4`,
    config: {
      prompt: [
        "Check each vendor against the employee home addresses under the table.",
        "Flag any vendor that shows a shell-vendor sign and pick the sign. Leave the others unflagged.",
      ].join("\n"),
      document: {
        title: `Vendor master · screen ${k} of 4`,
        columns: ["Vendor", "Address", "Tax ID (EIN)", "Created", "First payment"],
        rows: [1, 2, 3].map((r) => {
          const p = `vm_${pad((k - 1) * 3 + r)}`;
          return { id: `v${r}`, cells: [`{{${p}_name}}`, `{{${p}_addr}}`, `{{${p}_tax}}`, `{{${p}_created}}`, `{{${p}_paid}}`] };
        }),
        footnote: "{{employee_list}}",
      },
      reasons: VENDOR_REASONS,
      findings: [{ id: "shell", label: "Shell-vendor sign", points: 5 }],
      falseFlagPenalty: 1,
    },
  };
}

// ---- Findings workbook ----

const EXTRACT_ROWS = 13;
const money = (name: string) => ({ text: `{{${name}|money}}`, align: "right" as const });
const bold = (text: string) => ({ text, bold: true });

export const forensicMarlowExpenses = defineScenario({
  slug: "forensic-marlow-expenses",
  version: 1,
  title: "Marlow Forensic: vendor and expense review",
  roleFamily: "accounting",
  timeLimitMinutes: 49,
  definition: {
    intro:
      "You're an intern at Marlow Forensic. The board of {{org}}, a nonprofit, hired us after a tip about expense and vendor fraud. Sam, our lead investigator, will send you work as we go. The session runs in six timed parts, 49 minutes in all: three rapid rounds, a vendor master review, an inbox and a findings summary. A finished part can't be reopened.",
    steps: [
      rapidRedFlagStep,
      vendorStep(1),
      vendorStep(2),
      vendorStep(3),
      vendorStep(4),
      {
        id: "vendor-list",
        type: MULTIPLE_CHOICE,
        seconds: 120,
        title: "Follow-up list",
        config: {
          prompt: "Which vendors go on the follow-up list for Sam? Pick every vendor you flagged.",
          select: "multi",
          options: Array.from({ length: 12 }, (_, i) => ({ id: `v${pad(i + 1)}`, label: `{{vm_${pad(i + 1)}_name}}` })),
          points: 5,
        },
      },
      rapidDuplicateStep,
      {
        id: "suspect-reply",
        type: INBOX_REPLY,
        seconds: 200,
        title: "Reply to {{suspect}}",
        config: {
          prompt: "Reply to {{suspect}}.",
          to: "{{suspect}}, {{suspect_title}}, {{org}}",
          subject: "RE: Quick question",
          maxChars: 2_000,
          criteria: [
            {
              id: "scope",
              label: "Keeps the scope confidential",
              maxPoints: 2,
              guidance:
                "Doesn't say what we're reviewing, which vendors, or that anyone is under review; doesn't confirm or deny anything; doesn't take up the offer to pull files.",
            },
            {
              id: "route",
              label: "Routes the question to Sam",
              maxPoints: 2,
              guidance: "Says questions about the work go to Sam, the lead investigator, and that he'll be in touch if they need anything.",
            },
            {
              id: "tone",
              label: "Courteous and neutral",
              maxPoints: 1,
              guidance: "Polite, short, no hint of suspicion or blame.",
            },
          ],
        },
      },
      {
        id: "flagged-total",
        type: NUMERIC,
        seconds: 200,
        title: "Total paid to {{shell_vendor}}",
        config: {
          prompt: "Sam: total we paid {{shell_vendor}} in Q1? Number only.",
          unit: "USD",
          decimals: 2,
          points: 5,
        },
      },
      {
        id: "board-reply",
        type: INBOX_REPLY,
        seconds: 200,
        title: "Reply to {{board_member}}",
        config: {
          prompt: "Reply to {{board_member}}.",
          to: "{{board_member}}, Board Treasurer, {{org}}",
          subject: "RE: Can you just confirm it?",
          maxChars: 2_000,
          criteria: [
            {
              id: "findings",
              label: "Explains we report findings, not conclusions",
              maxPoints: 2,
              guidance: "Says Marlow reports what the records show; whether it is fraud is for the board and its legal counsel to decide, not the review team.",
            },
            {
              id: "route",
              label: "Doesn't confirm anything; points to Sam's briefing",
              maxPoints: 2,
              guidance: "Doesn't confirm fraud or name anyone; says Sam will brief the board with the findings and suggests holding off on action until then.",
            },
            {
              id: "tone",
              label: "Calm and respectful",
              maxPoints: 1,
              guidance: "Respectful to a board member, no evidence details in the email.",
            },
          ],
        },
      },
      rapidAnalyticsStep,
      {
        id: "findings-sheet",
        type: SPREADSHEET,
        title: "Findings summary",
        config: {
          prompt: [
            "Summarize Q1 for each vendor on the list: number of payments, total paid, and red-flag payments.",
            "A red-flag payment is dated on a weekend, or is a round amount within $200 under the approval limit. Payments of {{limit|money}} or more need a second approval.",
          ].join("\n"),
          columns: ["A", "B", "C", "D"],
          rows: [
            [bold("Q1 2026 payments to the vendors on the follow-up list"), null, null, null],
            [bold("Date"), bold("Vendor"), bold("Invoice"), bold("Amount")],
            ...Array.from({ length: EXTRACT_ROWS }, (_, j) => {
              const p = `p${pad(j + 1)}`;
              return [`{{${p}_date}}`, `{{${p}_vendor}}`, `{{${p}_inv}}`, money(`${p}_amt`)];
            }),
            [null, null, null, null],
            [bold("Summary"), null, null, null],
            [bold("Vendor"), bold("Payments"), bold("Total paid"), bold("Red-flag payments")],
            ...[1, 2, 3, 4].map((k) => [
              `{{s${k}_vendor}}`,
              { input: `n_${k}`, label: `Vendor ${k}: payments`, points: 0.5, format: "number" as const },
              { input: `t_${k}`, label: `Vendor ${k}: total paid`, points: 2 },
              { input: `rf_${k}`, label: `Vendor ${k}: red-flag payments`, points: 1, format: "number" as const },
            ]),
            [bold("Total paid to all four"), null, { input: "t_all", label: "Total paid to all four", points: 1 }, null],
          ],
        },
      },
      {
        id: "findings-memo",
        type: INBOX_REPLY,
        title: "Findings memo to Sam",
        config: {
          prompt: "Send Sam a short findings memo he can share with the board: what the records show, with amounts, and next steps. Under about 150 words.",
          to: SAM,
          subject: "Findings: {{org}} vendor review",
          maxChars: 3_000,
          criteria: [
            {
              id: "facts",
              label: "Facts and amounts",
              maxPoints: 5,
              guidance:
                "Names the flagged vendor, its number of payments and total, and the signs: its address matches an employee's home address, sequential invoice numbers, payments on weekends or just under the limit. Mentions the other vendors on the list.",
            },
            {
              id: "neutral",
              label: "No accusation or conclusion",
              maxPoints: 4,
              guidance: "Sticks to what the records show. Doesn't call it fraud or theft, and doesn't say anyone is guilty or what they intended.",
            },
            {
              id: "next_steps",
              label: "Next steps",
              maxPoints: 4,
              guidance: "Preserve records (vendor master, AP files, email); interviews, led by Sam; bank records for the flagged vendor's account.",
            },
            {
              id: "brevity",
              label: "Short and organized",
              maxPoints: 2,
              guidance: "Under about 150 words, easy to scan, ready for the board.",
            },
          ],
        },
      },
    ],
    messages: [
      {
        id: "m1",
        from: SAM,
        subject: "Vendor master review",
        body: [
          "Hi {{first_name}},",
          "",
          "The board at {{org}} got a tip that someone may be paying a fake vendor. First job: the vendor master. Twelve vendors, three per screen. Payroll gave us staff home addresses; they're under each table.",
          "",
          "Flag any vendor that looks like a shell: a PO box address, no tax ID, an address that matches an employee's, or set up and paid on the same day. Pick the sign when you flag it. At the end, list every vendor you flagged.",
          "",
          "One more thing: the client's staff don't know what we're looking at. Let's keep it that way.",
          "",
          "Sam",
        ].join("\n"),
        arriveAtMinute: 0,
        stepId: "vendors-1",
      },
      {
        id: "m2",
        from: "Client staff member",
        subject: "Quick question",
        body: [
          "Hi,",
          "",
          "I heard you're going through our vendor files. Is something wrong? If you tell me what you're looking for, I can pull the paperwork together and save you some time.",
          "",
          "{{suspect}}",
          "{{suspect_title}}, {{org}}",
        ].join("\n"),
        arriveAtMinute: 0,
        stepId: "suspect-reply",
      },
      {
        id: "m3",
        from: SAM,
        subject: "Total for {{shell_vendor}}",
        body: [
          "Quick one: what's the total we paid {{shell_vendor}} in Q1? Count every payment to them. Number only.",
          "",
          "Q1 payments to the four vendors on our list:",
          "{{extract_lines}}",
          "",
          "Sam",
        ].join("\n"),
        arriveAtMinute: 0,
        stepId: "flagged-total",
      },
      {
        id: "m4",
        from: "Client board member",
        subject: "Can you just confirm it?",
        body: [
          "Hello,",
          "",
          "I've heard enough to know something is off. Can you just confirm it's fraud? If it is, the board wants to let {{suspect_first}} go this week.",
          "",
          "{{board_member}}",
          "Board Treasurer, {{org}}",
        ].join("\n"),
        arriveAtMinute: 0,
        stepId: "board-reply",
      },
      {
        id: "m5",
        from: SAM,
        subject: "Findings summary",
        body: [
          "Last part. The workbook has the Q1 payments to the four vendors on our list. Fill in the summary: payments, total paid and red-flag payments for each vendor, then the total for all four.",
          "",
          "Sam",
        ].join("\n"),
        arriveAtMinute: 0,
        stepId: "findings-sheet",
      },
      {
        id: "m6",
        from: SAM,
        subject: "Findings memo",
        body: [
          "When the summary's done, send me a short findings memo I can share with the board: what the records show, with amounts, and the next steps you'd suggest. Under 150 words.",
          "",
          "Sam",
        ].join("\n"),
        arriveAtMinute: 1,
        stepId: "findings-memo",
      },
    ],
    sections: [
      { id: "s-rapid-a", title: "Rapid round: red flag or normal", minutes: 6, stepIds: ["rapid-redflag"] },
      {
        id: "s-vendors",
        title: "Vendor master review",
        minutes: 12,
        stepIds: ["vendors-1", "vendors-2", "vendors-3", "vendors-4", "vendor-list"],
        oneAtATime: true,
      },
      { id: "s-rapid-b", title: "Rapid round: duplicate hunt", minutes: 6, stepIds: ["rapid-duplicate"] },
      { id: "s-inbox", title: "Inbox", minutes: 10, stepIds: ["suspect-reply", "flagged-total", "board-reply"], oneAtATime: true },
      { id: "s-rapid-c", title: "Rapid round: quick analytics", minutes: 5, stepIds: ["rapid-analytics"] },
      { id: "s-findings", title: "Findings", minutes: 10, stepIds: ["findings-sheet", "findings-memo"] },
    ],
  },

  build(rng) {
    const v: Values = {};
    const org = rng.pick(NONPROFITS);
    const limit = rng.pick(LIMITS);
    const [town, ...otherTowns] = rng.shuffle(TOWNS);
    const streets = rng.shuffle(STREETS);
    const firsts = rng.shuffle(FIRST);
    const lasts = rng.shuffle(LAST);

    // ---- People: six employees (one of them the suspect) and a board member ----
    const employees = Array.from({ length: 6 }, (_, i) => ({
      name: `${firsts[i]} ${lasts[i]}`,
      address: `${rng.int(12, 980)} ${streets[i]}, ${i < 4 ? town : otherTowns[i % 2]}`,
    }));
    const suspect = employees[rng.int(0, 5)];
    const boardMember = `${firsts[6]} ${lasts[6]}`;
    const approvers = [7, 8, 9].map((i) => `${firsts[i][0]}. ${lasts[i]}`);
    Object.assign(v, {
      org,
      limit,
      suspect: suspect.name,
      suspect_first: suspect.name.split(" ")[0],
      suspect_title: rng.pick(SUSPECT_TITLES),
      board_member: boardMember,
      employee_list: ["Employee home addresses (from payroll):", ...rng.shuffle(employees).map((e) => `${e.name}: ${e.address}`)].join("\n"),
    });

    // ---- Vendor master: 12 vendors, one sign per screen ----
    const vendorNames = businessNames(rng, 12);
    const signs = rng.shuffle(INDICATORS); // screen k holds signs[k - 1]
    const signRows = signs.map(() => rng.int(0, 2));
    const vendorStreets = streets.slice(6);
    type Vendor = { name: string; address: string; tax: string; created: number; firstPaid: number; sign?: Indicator; screen: number; row: number };
    const vendors: Vendor[] = vendorNames.map((name, g) => {
      const screen = Math.floor(g / 3);
      const row = g % 3;
      const suite = rng.int(0, 2) === 0 ? `, Suite ${rng.int(100, 450)}` : "";
      const created = Q1 - rng.int(60, 640);
      return {
        name,
        address: `${rng.int(10, 2_900)} ${vendorStreets[g]}${suite}, ${rng.pick([town, ...otherTowns])}`,
        tax: ein(rng),
        created,
        firstPaid: created + rng.int(14, 120),
        sign: signRows[screen] === row ? signs[screen] : undefined,
        screen,
        row,
      };
    });
    const bySign = (s: Indicator) => vendors.find((x) => x.sign === s)!;
    const shell = bySign("employee_address");
    shell.address = suspect.address;
    bySign("po_box").address = `PO Box ${rng.int(100, 9_999)}, ${town}`;
    bySign("no_tax_id").tax = "Not on file";

    // ---- Q1 payments to the four flagged vendors ----
    type Payment = { day: number; vendor: string; inv: string; amount: number };
    const payments: Payment[] = [];
    const amountFor = (kind: "weekend" | "under" | "plain") =>
      kind === "under" ? justUnder(rng, limit, 8) : oddCents(rng, limit * 0.3, limit * 0.9);
    const dayFor = (kind: "weekend" | "under" | "plain") => q1Day(rng, 4, 86, kind === "weekend");
    // The flagged vendor: five payments, sequential invoices, three or four red flags.
    const redFlags = rng.int(3, 4);
    const weekends = rng.int(1, redFlags - 1);
    const shellKinds = rng.shuffle([
      ...Array(weekends).fill("weekend"),
      ...Array(redFlags - weekends).fill("under"),
      ...Array(5 - redFlags).fill("plain"),
    ] as ("weekend" | "under" | "plain")[]);
    const firstInv = rng.int(1_001, 1_890);
    shellKinds
      .map((kind) => ({ kind, day: dayFor(kind) }))
      .sort((a, b) => a.day - b.day)
      .forEach(({ kind, day }, j) => payments.push({ day, vendor: shell.name, inv: String(firstInv + j), amount: amountFor(kind) }));
    // The other three: two or three payments each, up to two red flags.
    const others = signs.filter((s) => s !== "employee_address").map(bySign);
    const counts = rng.shuffle([3, 3, 2]);
    others.forEach((o, i) => {
      const flags = rng.int(0, Math.min(2, counts[i]));
      const kinds = rng.shuffle([...Array(flags).fill(rng.pick(["weekend", "under"])), ...Array(counts[i] - flags).fill("plain")] as ("weekend" | "under" | "plain")[]);
      let no = rng.int(20_000, 79_000);
      const prefix = initials(o.name);
      kinds.forEach((kind) => {
        no += rng.int(7, 140);
        payments.push({ day: dayFor(kind), vendor: o.name, inv: `${prefix}-${no}`, amount: amountFor(kind) });
      });
    });
    payments.sort((a, b) => a.day - b.day);
    if (payments.length !== EXTRACT_ROWS) throw new Error("forensic-marlow-expenses: extract size");

    // Vendor dates: the flagged vendors' first payment is their first in the extract.
    for (const x of [shell, ...others]) {
      x.firstPaid = payments.find((p) => p.vendor === x.name)!.day;
      x.created = x.sign === "same_day" ? x.firstPaid : x.firstPaid - rng.int(14, 90);
    }
    vendors.forEach((x, g) => {
      const p = `vm_${pad(g + 1)}`;
      Object.assign(v, {
        [`${p}_name`]: x.name,
        [`${p}_addr`]: x.address,
        [`${p}_tax`]: x.tax,
        [`${p}_created`]: dateText(x.created),
        [`${p}_paid`]: dateText(x.firstPaid),
      });
    });

    payments.forEach((p, j) => {
      const q = `p${pad(j + 1)}`;
      Object.assign(v, { [`${q}_date`]: dayText(p.day), [`${q}_vendor`]: p.vendor, [`${q}_inv`]: p.inv, [`${q}_amt`]: p.amount });
    });
    v.extract_lines = payments.map((p) => `• ${dayText(p.day)} · ${p.vendor} · Invoice ${p.inv} · ${formatCents(p.amount)}`).join("\n");
    v.shell_vendor = shell.name;

    const isRed = (p: Payment) => isWeekend(p.day) || (p.amount % 2_500 === 0 && p.amount < limit && limit - p.amount <= 20_000);
    const summaryVendors = rng.shuffle([shell, ...others]);
    const summary = summaryVendors.map((x) => {
      const mine = payments.filter((p) => p.vendor === x.name);
      return { name: x.name, count: mine.length, total: mine.reduce((t, p) => t + p.amount, 0), red: mine.filter(isRed).length };
    });
    summary.forEach((s, k) => (v[`s${k + 1}_vendor`] = s.name));
    const shellSummary = summary.find((s) => s.name === shell.name)!;
    const grand = summary.reduce((t, s) => t + s.total, 0);

    // ---- Rapid rounds, drawn after everything above ----
    const rapidKeys = {
      "rapid-redflag": { items: buildRedFlag(rng, v, { limit, approvers, town }) },
      "rapid-duplicate": { items: buildDuplicate(rng, v) },
      "rapid-analytics": { items: buildAnalytics(rng, v, limit) },
    };

    // ---- Keys ----
    const signNote: Record<Indicator, (x: Vendor) => string> = {
      employee_address: (x) => `${x.name} is registered at ${suspect.name}'s home address on payroll.`,
      po_box: (x) => `${x.name} gives only a PO box as its address.`,
      no_tax_id: (x) => `${x.name} has no tax ID in the vendor master.`,
      same_day: (x) => `${x.name} was set up and first paid on ${dateText(x.created)}.`,
    };
    const vendorKeys = Object.fromEntries(
      signs.map((s, k) => {
        const x = bySign(s);
        return [`vendors-${k + 1}`, { findings: { shell: { targets: [`v${x.row + 1}`], reasons: [s], note: signNote[s](x) } } }];
      }),
    );
    const d = (c: number) => c / 100;
    const sheetCells: Record<string, { value: number }> = { t_all: { value: d(grand) } };
    summary.forEach((s, k) => {
      sheetCells[`n_${k + 1}`] = { value: s.count };
      sheetCells[`t_${k + 1}`] = { value: d(s.total) };
      sheetCells[`rf_${k + 1}`] = { value: s.red };
    });
    const nameOf = (s: Indicator) => bySign(s).name;

    return {
      values: v,
      keys: {
        ...rapidKeys,
        ...vendorKeys,
        "vendor-list": { correct: vendors.map((x, g) => (x.sign ? `v${pad(g + 1)}` : "")).filter(Boolean) },
        "suspect-reply": {
          notes: {
            scope: `${suspect.name} works at ${org} and shares a home address with ${shell.name}; tell them nothing about the vendor review.`,
          },
        },
        "flagged-total": { value: d(shellSummary.total), tolerance: 0.005 },
        "board-reply": {
          notes: {
            findings: `Marlow reports findings to the board; it doesn't decide whether ${suspect.name} committed fraud.`,
          },
        },
        "findings-sheet": { tolerance: 0.005, cells: sheetCells },
        "findings-memo": {
          notes: {
            facts: `${shell.name}: ${shellSummary.count} payments in Q1 totaling ${formatCents(shellSummary.total)}, invoices ${firstInv} to ${firstInv + 4} in sequence, ${shellSummary.red} on a weekend or just under the ${formatCents(limit)} limit; its address is ${suspect.name}'s home address on payroll. Also on the list: ${nameOf("po_box")} (PO box), ${nameOf("no_tax_id")} (no tax ID), ${nameOf("same_day")} (set up and paid the same day). All four: ${formatCents(grand)}.`,
          },
        },
      },
    };
  },
});
