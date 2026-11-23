import "server-only";

import type { Rng } from "../server/rng";
import { defineScenario } from "../server/scenario";
import { formatCents } from "../server/template";
import { DOCUMENT_REVIEW } from "../step-types/document_review/public";
import { INBOX_REPLY } from "../step-types/inbox_reply/public";
import { NUMERIC } from "../step-types/numeric/public";
import { RAPID_ROUND } from "../step-types/rapid_round/public";
import { SPREADSHEET } from "../step-types/spreadsheet/public";

/**
 * docs/07 Example 7: tax intern at Hollis Tax & Accounting, one client's
 * Schedule C, in six timed sections (52 minutes, 100 points): rapid round A,
 * form to field (10) → organize the client's documents, one screen at a time
 * (25) → rapid round B, deductible? (10) → inbox, one screen at a time (15) →
 * rapid round C, quick calcs (10) → Schedule C input sheet and a note to
 * Elena (30).
 *
 * The tax year and every rate are fixed here (`TAX_YEAR`, `RATES`) and listed
 * in docs/07 for the accountant reviewer. Every number answer is whole
 * dollars, rounded the way the IRS forms are: cents are added first and only
 * the result is rounded, 50 cents and up to the next dollar (`wholeOf`).
 *
 * Seeded per candidate: the client's name, every payer, employer, bank, fund
 * and lender, every amount, mileage, square footage and date, which document
 * sits on which organize screen, which payer's 1099-NEC is missing (it arrives
 * late by email and must go into gross receipts), and which rapid item comes
 * when. The keys are built from the same values as the material.
 *
 * Shaped by the current step types (draft: needs accountant review):
 * - Organize is `document_review`: every document is a finding and the
 *   categories are the reasons, so a wrong category earns half.
 * - All three written replies need a reviewer, so a perfect attempt shows 79
 *   automatic points until they are marked.
 */

export const TAX_YEAR = 2025;

/** Every rate and limit the key uses, for tax year 2025 (docs/07 "Tax year and rules"). */
export const RATES = {
  mileageCentsPerMile: 70,
  homeOfficeDollarsPerSqFt: 5,
  homeOfficeMaxSqFt: 300,
  seEarningsShare: 0.9235,
  socialSecurityRate: 0.124,
  medicareRate: 0.029,
  socialSecurityWageBase: 176_100,
  mealsShare: 0.5,
  deMinimisDollars: 2_500,
  nec1099ThresholdDollars: 600,
  priorYearSafeHarborHighIncome: 1.1,
};

/** num / den rounded to the nearest whole number, halves up (non-negative integers, no float noise). */
const wholeOf = (num: number, den: number) => Math.floor((2 * num + den) / (2 * den));
/** Cents to whole dollars, the IRS way. */
const dollarsOf = (cents: number) => wholeOf(cents, 100);

/**
 * Whole numbers that appear on their own in the material (years, form numbers,
 * the NAICS code). A derived answer never lands on one, so the leak tests can
 * tell a leaked answer from ordinary text.
 */
const RESERVED = new Set([1040, 1098, 1099, TAX_YEAR - 1, TAX_YEAR, TAX_YEAR + 1, 541430]);
const clear = (...xs: number[]) => xs.every((x) => !RESERVED.has(x));

const CLIENTS = [
  "Maya Lindgren",
  "Jonah Abernathy",
  "Talia Moreno",
  "Devon Okoye",
  "Iris Kowalski",
  "Rafael Santos",
  "Nadia Brennan",
  "Owen Takahashi",
  "Leah Fischer",
  "Marcus Bell",
  "Sofia Andersen",
  "Theo Ramirez",
];

/** The client's own clients: small businesses that buy design work. */
const PAYERS = [
  "Brightline Coffee Co.",
  "Juniper Dental Group",
  "Harbor & Pine Realty",
  "Cobalt Fitness",
  "Northgate Brewing",
  "Meadowlark Bakery",
  "Summit Ridge Credit Union",
  "Verde Landscaping",
  "Atlas Bike Shop",
  "Lumen Yoga Studio",
  "Fairview Animal Clinic",
  "Copperline Books",
];

const TOWNS = ["Maple Falls", "Westbrook", "Cedar Point", "Lakemont", "Riverton", "Ashby"];
const PLACES = ["Orlando", "Maui", "Cancun", "Lake Tahoe", "Yellowstone", "San Diego", "the Outer Banks", "Banff"];
const MONTHS = ["June", "July", "August"];
const HELPERS = ["Chris L.", "Sam P.", "Jordan K.", "Alex R.", "Taylor M."];

// Rapid A: other Hollis clients' forms.
const PEOPLE = ["Ana Delgado", "Ben Whitaker", "Carla Nguyen", "Derek Osei", "Ellie Park", "Frank Morales", "Gina Russo", "Hassan Ali", "Ivy Chen", "Jake Sorensen"];
const EMPLOYERS = ["Riverbend Medical Group", "Tallgrass Logistics", "Sunfield School District", "Ashford Hardware", "Bluepoint Software", "Cedar Hollow Foods"];
const BANKS = ["First Harbor Bank", "Prairie Federal Savings", "Lakeview Community Bank", "Summit National Bank"];
const FUNDS = ["Evergreen Index Funds", "Northlake Investments", "Bridgeport Brokerage"];
const LENDERS = ["Homestead Mortgage Co.", "Pioneer Home Loans", "Keystone Lending"];

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const date2025 = (rng: Rng) => `${MONTH_NAMES[rng.int(0, 11)]} ${rng.int(1, 28)}, ${TAX_YEAR}`;
const money = formatCents;
const ELENA = "Elena Vasquez, Tax Manager, Hollis Tax & Accounting";
const CLIENT_FROM = "Client portal message";

// ---- Organize: the client's documents ----

type Category = "income" | "expense" | "asset" | "personal" | "info";

const CATEGORIES: { id: Category; label: string }[] = [
  { id: "income", label: "Income" },
  { id: "expense", label: "Deductible business expense" },
  { id: "asset", label: "Business asset (capitalize)" },
  { id: "personal", label: "Personal: not deductible" },
  { id: "info", label: "Need more info from the client" },
];

/** One document in the client's folder: [document, from, details, amount range in dollars]. */
type DocSpec = { doc: string; from: string; details: string; range: [number, number]; ask?: string };

const EXPENSE_DOCS: DocSpec[] = [
  { doc: "Receipt", from: "Pixel & Grid Software", details: "Design software, annual plan (all apps)", range: [540, 900] },
  { doc: "Invoice", from: "Keystone Mutual Insurance", details: "Business liability insurance, 12 months", range: [420, 1_300] },
  { doc: "Receipt", from: "Northwind Hosting", details: "Portfolio website hosting and domain, 1 year", range: [90, 380] },
  { doc: "Receipt", from: "Openframe Images", details: "Stock photo license for a client brochure", range: [40, 350] },
  { doc: "Receipt", from: "Cafe Lumiere", details: "Lunch with a client about a logo project (2 people)", range: [38, 140] },
];
const PERSONAL_DOCS: DocSpec[] = [
  { doc: "Receipt", from: "FreshWay Market", details: "Groceries for the family", range: [90, 420] },
  { doc: "Invoice", from: "Camp Willow Creek", details: "Kids' summer day camp, 2 weeks", range: [600, 1_400] },
  { doc: "Card statement line", from: "StreamBox", details: "Family streaming plan, 12 months", range: [140, 300] },
  { doc: "Card statement line", from: "Ironwood Gym", details: "Gym membership, 12 months", range: [360, 900] },
];
/** Built per seed (the Venmo payee's name is seeded). `ask` is what Elena still needs. */
const infoDocs = (helper: string): DocSpec[] => [
  {
    doc: "Bank statement line",
    from: "Venmo",
    details: `Payment to "${helper}", memo: "help w/ project"`,
    range: [400, 1_800],
    ask: `who ${helper} is and what the Venmo payment was for (a W-9 if it was a contractor)`,
  },
  {
    doc: "Phone bill",
    from: "Clearwave Wireless",
    details: "Monthly plan, used for business and personal calls",
    range: [70, 160],
    ask: "the business share of the Clearwave Wireless phone bill",
  },
  {
    doc: "Card statement line",
    from: "Online marketplace",
    details: "Order total, no item details",
    range: [60, 450],
    ask: "the item list for the online marketplace order",
  },
];

const SORT_COLUMNS = ["Document", "From", "Date", "Details", "Amount"];

function sortStep(k: number) {
  const p = `s${k}`;
  return {
    id: `sort-${k}`,
    type: DOCUMENT_REVIEW,
    seconds: 180,
    title: `Client documents, batch ${k} of 3`,
    config: {
      prompt: [
        "Three documents from {{client}}'s folder.",
        "Flag each one and pick what it is: income, a deductible business expense, a business asset, personal, or something you need to ask the client about.",
      ].join("\n"),
      document: {
        title: `{{client}} · ${TAX_YEAR} documents, batch ${k} of 3`,
        fields: [],
        columns: SORT_COLUMNS,
        rows: [1, 2, 3].map((j) => {
          const r = `${p}_r${j}`;
          // Numbered, so each row's Flag button has its own name ("Flag 2. Receipt").
          return { id: `r${j}`, cells: [`${j}. {{${r}_doc}}`,`{{${r}_from}}`, `{{${r}_date}}`, `{{${r}_details}}`, `{{${r}_amt|money}}`] };
        }),
        totals: [],
      },
      reasons: CATEGORIES,
      findings: [1, 2, 3].map((j) => ({ id: `doc${j}`, label: `Document ${j}`, points: 2 })),
      falseFlagPenalty: 1,
    },
  };
}

// ---- Rapid rounds ----

const RAPID_ITEMS = 15;
/** Items 3, 6, 9, 12 and 15 hold the harder kinds and are worth 1; the rest ½. 10 points a round. */
const isHardSlot = (i: number) => i % 3 === 2;
const slotNo = (i: number) => String(i + 1).padStart(2, "0");

function fillSlots<T>(easy: T[], hard: T[]): T[] {
  const e = [...easy];
  const h = [...hard];
  const out = Array.from({ length: RAPID_ITEMS }, (_, i) => (isHardSlot(i) ? h.shift() : e.shift()));
  if (out.some((x) => x === undefined) || e.length || h.length) throw new Error("tax-hollis-schedule-c: rapid slots don't fill");
  return out as T[];
}

function rapidItems(prefix: string, item: (n: string, hard: boolean) => object) {
  return Array.from({ length: RAPID_ITEMS }, (_, i) => ({ id: `${prefix}-${slotNo(i)}`, ...item(slotNo(i), isHardSlot(i)), points: isHardSlot(i) ? 1 : 0.5 }));
}

const amountField = { id: "amount", label: "Amount (whole dollars)", kind: "number", unit: "$", decimals: 0 } as const;

type RapidKeyItems = Record<string, Record<string, { choice: string } | { value: number; tolerance: number }>>;

// Rapid A: form to field.
const LINES = [
  { id: "wages", label: "Form 1040, line 1a: wages" },
  { id: "withheld", label: "Form 1040, line 25a: tax withheld (W-2)" },
  { id: "taxable_int", label: "Form 1040, line 2b: taxable interest" },
  { id: "exempt_int", label: "Form 1040, line 2a: tax-exempt interest" },
  { id: "qual_div", label: "Form 1040, line 3a: qualified dividends" },
  { id: "ord_div", label: "Form 1040, line 3b: ordinary dividends" },
  { id: "cap_gain", label: "Schedule D, line 13: capital gain distributions" },
  { id: "sched_c", label: "Schedule C, line 1: gross receipts" },
  { id: "mortgage", label: "Schedule A, line 8a: home mortgage interest" },
] as const;
type LineId = (typeof LINES)[number]["id"];

type FormKind = "w2" | "nec" | "int" | "div" | "m1098";
/** The ten "where does it go" items: form, box asked about, the line it goes to. */
const FORM_PICKS: [FormKind, string, LineId][] = [
  ["w2", "1", "wages"],
  ["w2", "2", "withheld"],
  ["nec", "1", "sched_c"],
  ["int", "1", "taxable_int"],
  ["int", "3", "taxable_int"],
  ["int", "8", "exempt_int"],
  ["div", "1a", "ord_div"],
  ["div", "1b", "qual_div"],
  ["div", "2a", "cap_gain"],
  ["m1098", "1", "mortgage"],
];
type FormAmount = "w2-wages" | "int-total" | "div-ordinary" | "nec-two" | "mortgage-8a";
const FORM_AMOUNTS: FormAmount[] = ["w2-wages", "int-total", "div-ordinary", "nec-two", "mortgage-8a"];

type Form = { title: string; rows: [string, string][]; boxes: Record<string, number> };

function makeForm(rng: Rng, kind: FormKind, opts: { points?: boolean } = {}): Form {
  const person = rng.pick(PEOPLE);
  const m = money;
  if (kind === "w2") {
    const b1 = rng.cents(32_000, 78_000);
    const b2 = Math.round((b1 * rng.int(8, 14)) / 100);
    const d = rng.cents(1_500, 6_000);
    return {
      title: `Form W-2 (${TAX_YEAR}) · Wage and Tax Statement`,
      rows: [
        ["Employer", rng.pick(EMPLOYERS)],
        ["Employee", person],
        ["Box 1 · Wages, tips, other compensation", m(b1)],
        ["Box 2 · Federal income tax withheld", m(b2)],
        ["Box 3 · Social security wages", m(b1 + d)],
        ["Box 12a · Code D (401(k) deferrals)", m(d)],
      ],
      boxes: { "1": b1, "2": b2 },
    };
  }
  if (kind === "nec") {
    const b1 = rng.cents(1_200, 24_000);
    return {
      title: `Form 1099-NEC (${TAX_YEAR}) · Nonemployee Compensation`,
      rows: [
        ["Payer", rng.pick(PAYERS)],
        ["Recipient", person],
        ["Box 1 · Nonemployee compensation", m(b1)],
        ["Box 4 · Federal income tax withheld", m(0)],
        ["Box 5 · State tax withheld", m(0)],
        ["Box 7 · State income", m(b1)],
      ],
      boxes: { "1": b1 },
    };
  }
  if (kind === "int") {
    const b1 = rng.cents(40, 1_800);
    const b3 = rng.cents(20, 600);
    const b8 = rng.cents(30, 900);
    return {
      title: `Form 1099-INT (${TAX_YEAR}) · Interest Income`,
      rows: [
        ["Payer", rng.pick(BANKS)],
        ["Recipient", person],
        ["Box 1 · Interest income", m(b1)],
        ["Box 3 · Interest on U.S. Savings Bonds and Treasury obligations", m(b3)],
        ["Box 4 · Federal income tax withheld", m(0)],
        ["Box 8 · Tax-exempt interest", m(b8)],
      ],
      boxes: { "1": b1, "3": b3, "8": b8 },
    };
  }
  if (kind === "div") {
    const a = rng.cents(200, 4_000);
    const b = Math.round((a * rng.int(40, 90)) / 100);
    const g = rng.cents(50, 1_500);
    return {
      title: `Form 1099-DIV (${TAX_YEAR}) · Dividends and Distributions`,
      rows: [
        ["Payer", rng.pick(FUNDS)],
        ["Recipient", person],
        ["Box 1a · Total ordinary dividends", m(a)],
        ["Box 1b · Qualified dividends", m(b)],
        ["Box 2a · Total capital gain distributions", m(g)],
        ["Box 4 · Federal income tax withheld", m(0)],
      ],
      boxes: { "1a": a, "1b": b, "2a": g },
    };
  }
  const b1 = rng.cents(4_000, 16_000);
  const b6 = opts.points || rng.int(0, 1) ? rng.cents(600, 3_000) : 0;
  return {
    title: `Form 1098 (${TAX_YEAR}) · Mortgage Interest Statement`,
    rows: [
      ["Lender", rng.pick(LENDERS)],
      ["Borrower", person],
      ["Box 1 · Mortgage interest received", m(b1)],
      ["Box 2 · Outstanding mortgage principal", m(rng.cents(180_000, 420_000))],
      ["Box 6 · Points paid on purchase of principal residence", m(b6)],
      ["Box 10 · Other: real estate taxes", m(rng.cents(2_000, 7_000))],
    ],
    boxes: { "1": b1, "6": b6 },
  };
}

/** A hard "type the amount" form item: the form, the prompt and the exact amount in cents. */
function amountForm(rng: Rng, kind: FormAmount): Form & { prompt: string; exact: number } {
  if (kind === "nec-two") {
    const [p1, p2] = rng.shuffle(PAYERS);
    const a = rng.cents(1_200, 18_000);
    const b = rng.cents(800, 12_000);
    return {
      title: `Two Forms 1099-NEC (${TAX_YEAR})`,
      rows: [
        ["Recipient", rng.pick(PEOPLE)],
        ["Form 1 · Payer", p1],
        ["Form 1 · Box 1 · Nonemployee compensation", money(a)],
        ["Form 2 · Payer", p2],
        ["Form 2 · Box 1 · Nonemployee compensation", money(b)],
        ["Form 2 · Box 4 · Federal income tax withheld", money(0)],
      ],
      boxes: {},
      prompt: "Whole dollars: gross receipts for Schedule C, line 1 from these two forms?",
      exact: a + b,
    };
  }
  if (kind === "w2-wages") {
    const f = makeForm(rng, "w2");
    return { ...f, prompt: "Whole dollars: what goes on Form 1040, line 1a?", exact: f.boxes["1"] };
  }
  if (kind === "int-total") {
    const f = makeForm(rng, "int");
    return { ...f, prompt: "Whole dollars: taxable interest for Form 1040, line 2b?", exact: f.boxes["1"] + f.boxes["3"] };
  }
  if (kind === "div-ordinary") {
    const f = makeForm(rng, "div");
    return { ...f, prompt: "Whole dollars: what goes on Form 1040, line 3b?", exact: f.boxes["1a"] };
  }
  const f = makeForm(rng, "m1098", { points: true });
  return { ...f, prompt: "Whole dollars: what goes on Schedule A, line 8a?", exact: f.boxes["1"] + f.boxes["6"] };
}

const rapidFormsStep = {
  id: "rapid-forms",
  type: RAPID_ROUND,
  title: "Rapid round: form to field",
  config: {
    intro: [
      `Form to field: 15 tax forms from Hollis clients, 20 seconds each. All ${TAX_YEAR} forms.`,
      "Pick where the amount goes on the return, or type the amount in whole dollars.",
    ].join("\n"),
    secondsPerItem: 20,
    items: rapidItems("ff", (n, hard) => ({
      prompt: `{{ff_${n}_prompt}}`,
      exhibit: {
        title: `{{ff_${n}_title}}`,
        rows: [1, 2, 3, 4, 5, 6].map((j) => ({ label: `{{ff_${n}_l${j}}}`, value: `{{ff_${n}_v${j}}}` })),
      },
      fields: hard ? [amountField] : [{ id: "dest", label: "Where it goes", kind: "choice", options: LINES }],
    })),
  },
};

function buildForms(rng: Rng, v: Record<string, string | number>): RapidKeyItems {
  const slots = fillSlots<[FormKind, string, LineId] | FormAmount>(rng.shuffle(FORM_PICKS), rng.shuffle(FORM_AMOUNTS));
  return Object.fromEntries(
    slots.map((slot, i) => {
      const n = slotNo(i);
      let form: Form;
      let prompt: string;
      let key: RapidKeyItems[string];
      if (typeof slot === "string") {
        let f: ReturnType<typeof amountForm>;
        do f = amountForm(rng, slot);
        while (!clear(dollarsOf(f.exact)));
        form = f;
        prompt = f.prompt;
        key = { amount: { value: dollarsOf(f.exact), tolerance: 1 } };
      } else {
        const [kind, box, line] = slot;
        form = makeForm(rng, kind);
        prompt = `Where does Box ${box} go on the return?`;
        key = { dest: { choice: line } };
      }
      v[`ff_${n}_title`] = form.title;
      v[`ff_${n}_prompt`] = prompt;
      form.rows.forEach(([label, value], j) => {
        v[`ff_${n}_l${j + 1}`] = label;
        v[`ff_${n}_v${j + 1}`] = value;
      });
      return [`ff-${n}`, key];
    }),
  );
}

// Rapid B: deductible?
const TREATMENTS = [
  { id: "full", label: "Fully deductible" },
  { id: "half", label: "50% deductible" },
  { id: "none", label: "Not deductible" },
  { id: "capitalize", label: "Capitalize and depreciate (or Section 179)" },
] as const;
type Treatment = (typeof TREATMENTS)[number]["id"];

/** The deductibility rule table (docs/07): id, how the expense reads, amount range in dollars, treatment. */
type DeductRule = [id: string, text: (amount: string, first: string) => string, range: [number, number], treatment: Treatment];

const DEDUCT_EASY: DeductRule[] = [
  ["software", (a) => `Annual design software subscription, ${a}.`, [540, 900], "full"],
  ["insurance", (a) => `Business liability insurance for the year, ${a}.`, [420, 1_300], "full"],
  ["stock", (a) => `Stock photo license bought for a client's brochure, ${a}.`, [40, 350], "full"],
  ["ads", (a) => `Promoted posts on Instagram to find new clients, ${a}.`, [120, 1_500], "full"],
  ["supplies", (a) => `Printer ink and paper for client proofs, ${a}.`, [40, 300], "full"],
  ["hosting", (a, f) => `Hosting and domain for ${f}'s portfolio website, ${a}.`, [90, 380], "full"],
  ["client-meal", (a) => `Lunch with a client to go over a logo project, ${a}.`, [38, 180], "half"],
  ["travel-meal", (a) => `Dinner on an overnight trip to shoot photos for a client, ${a}.`, [25, 120], "half"],
  ["parking-ticket", (a) => `Parking ticket outside a client's office, ${a}.`, [35, 120], "none"],
  ["groceries", (a) => `Groceries for the family, ${a}.`, [80, 420], "none"],
  ["income-tax", (a, f) => `${f}'s federal estimated income tax payment, ${a}.`, [800, 4_000], "none"],
  ["streaming", (a) => `Family streaming subscription for the year, ${a}.`, [140, 300], "none"],
];
const DEDUCT_HARD: DeductRule[] = [
  ["laptop", (a) => `New laptop for design work, ${a} (one item).`, [2_600, 3_900], "capitalize"],
  ["monitor", (a) => `New monitor for design work, ${a} (one item).`, [300, 2_400], "full"],
  ["tickets", (a) => `Tickets to take a client to a basketball game, ${a}.`, [150, 600], "none"],
  ["club", (a, f) => `Country club dues; ${f} meets clients there, ${a}.`, [1_500, 6_000], "none"],
  ["penalty", (a) => `IRS penalty for filing last year's return late, ${a}.`, [50, 900], "none"],
];

const rapidDeductStep = {
  id: "rapid-deduct",
  type: RAPID_ROUND,
  title: "Rapid round: deductible?",
  config: {
    intro: [
      `Deductible? 15 expenses from {{client}}'s ${TAX_YEAR} records, 20 seconds each. {{client_first}} is a sole proprietor and files Schedule C.`,
      "Hollis elects the de minimis safe harbor for every client: equipment of $2,500 or less per item is expensed in full.",
    ].join("\n"),
    secondsPerItem: 20,
    items: rapidItems("dd", (n) => ({
      prompt: `{{dd_${n}}}`,
      fields: [{ id: "treatment", label: "Treatment", kind: "choice", options: TREATMENTS }],
    })),
  },
};

function buildDeduct(rng: Rng, v: Record<string, string | number>, first: string): RapidKeyItems {
  const rules = fillSlots(rng.shuffle(DEDUCT_EASY).slice(0, 10), rng.shuffle(DEDUCT_HARD));
  return Object.fromEntries(
    rules.map(([, text, [lo, hi], treatment], i) => {
      v[`dd_${slotNo(i)}`] = text(money(rng.cents(lo, hi)), first);
      return [`dd-${slotNo(i)}`, { treatment: { choice: treatment } }];
    }),
  );
}

// Rapid C: quick calcs.
type CalcKind = "office" | "miles" | "se-base" | "meals" | "estimate" | "office-cap" | "se-tax" | "half-se" | "safe-harbor" | "miles-plus";
const CALC_EASY: CalcKind[] = ["office", "office", "miles", "miles", "se-base", "se-base", "meals", "meals", "estimate", "estimate"];
const CALC_HARD: CalcKind[] = ["office-cap", "se-tax", "half-se", "safe-harbor", "miles-plus"];
const int = (n: number) => n.toLocaleString("en-US");

/** SE tax the way Schedule SE does it: line 4a in whole dollars, then lines 10 and 11 each rounded. */
function seTax(profitDollars: number) {
  const base = wholeOf(profitDollars * 9_235, 10_000);
  return wholeOf(base * 124, 1_000) + wholeOf(base * 29, 1_000);
}

/** One quick calc: the prompt and the answer in whole dollars. */
function calc(rng: Rng, kind: CalcKind): [string, number] {
  const rate = RATES.mileageCentsPerMile;
  switch (kind) {
    case "office":
    case "office-cap": {
      const sqft = kind === "office" ? rng.int(90, RATES.homeOfficeMaxSqFt) : rng.int(320, 450);
      return [`Home office: ${sqft} square feet, used only for business. Simplified method deduction?`, Math.min(sqft, RATES.homeOfficeMaxSqFt) * RATES.homeOfficeDollarsPerSqFt];
    }
    case "miles": {
      const miles = rng.int(1_200, 9_800);
      return [`${int(miles)} business miles in ${TAX_YEAR}. Deduction at the standard mileage rate?`, wholeOf(miles * rate, 100)];
    }
    case "miles-plus": {
      const miles = rng.int(1_200, 7_500);
      const parking = rng.cents(40, 400);
      const tolls = rng.cents(20, 300);
      return [
        `${int(miles)} business miles at the standard rate, plus ${money(parking)} of business parking and ${money(tolls)} of tolls. Total car deduction?`,
        wholeOf(miles * rate + parking + tolls, 100),
      ];
    }
    case "se-base": {
      const profit = rng.int(18_000, 95_000);
      return [`Schedule C net profit is ${money(profit * 100)}. Net earnings from self-employment (the 92.35% figure)?`, wholeOf(profit * 9_235, 10_000)];
    }
    case "se-tax": {
      const profit = rng.int(18_000, 95_000);
      return [`Schedule C net profit is ${money(profit * 100)}. Self-employment tax?`, seTax(profit)];
    }
    case "meals": {
      const meals = rng.cents(300, 3_000);
      return [`Client meals came to ${money(meals)} in receipts. Deductible amount?`, wholeOf(meals, 200)];
    }
    case "estimate": {
      const tax = rng.int(4_000, 24_000);
      return [`${money(tax * 100)} of tax to cover with four equal estimated payments. How much is each payment?`, wholeOf(tax, 4)];
    }
    case "half-se": {
      const se = rng.int(2_000, 14_000);
      return [`Self-employment tax is ${money(se * 100)}. Deduction for half of it on Schedule 1?`, wholeOf(se, 2)];
    }
    case "safe-harbor": {
      const tax = rng.int(8_000, 40_000);
      return [
        `Last year's total tax was ${money(tax * 100)} and AGI was over $150,000. Each quarterly estimate to meet the prior-year safe harbor?`,
        wholeOf(tax * 11, 40),
      ];
    }
  }
}

const rapidCalcsStep = {
  id: "rapid-calcs",
  type: RAPID_ROUND,
  title: "Rapid round: quick calcs",
  config: {
    intro: [
      `Quick calcs: 15 items, 20 seconds each. Tax year ${TAX_YEAR}.`,
      "Standard mileage rate: 70 cents a mile. Simplified home office: $5 a square foot, up to 300 square feet. Self-employment tax: 15.3% of net earnings, which are 92.35% of net profit.",
      "Answer in whole dollars, like the IRS forms: 50 cents and up rounds up. Answers within $1 count.",
    ].join("\n"),
    secondsPerItem: 20,
    items: rapidItems("qc", (n) => ({ prompt: `{{qc_${n}}}`, fields: [amountField] })),
  },
};

function buildCalcs(rng: Rng, v: Record<string, string | number>): RapidKeyItems {
  const kinds = fillSlots(rng.shuffle(CALC_EASY), rng.shuffle(CALC_HARD));
  return Object.fromEntries(
    kinds.map((kind, i) => {
      let prompt: string;
      let answer: number;
      do [prompt, answer] = calc(rng, kind);
      while (!clear(answer));
      v[`qc_${slotNo(i)}`] = prompt;
      return [`qc-${slotNo(i)}`, { amount: { value: answer, tolerance: 1 } }];
    }),
  );
}

// ---- Schedule C input sheet ----

const bold = (text: string) => ({ text, bold: true });
const right = (text: string) => ({ text, align: "right" as const });
const org = (item: string, note: string, amount: string) => [item, note, right(amount)];
const line = (no: string, name: string, id: string, label: string, points: number) => [no, name, { input: id, label, points, format: "number" as const }];

const SCHEDULE_C_ROWS = [
  [bold(`Client organizer · {{client}} · tax year ${TAX_YEAR} (filled in by the client)`), null, null],
  [bold("Item"), bold("Client's note"), bold("Amount")],
  org("1099-NEC: {{payer_a}}", "", "{{nec_a|money}}"),
  org("1099-NEC: {{payer_b}}", "", "{{nec_b|money}}"),
  org("Payments from small clients (no 1099s)", "Invoice log", "{{small|money}}"),
  org("Promoted posts on Instagram", "", "{{org_ads1|money}}"),
  org("Print ad in the {{town}} business directory", "", "{{org_ads2|money}}"),
  org("Business miles driven", "Mileage log kept", "{{miles|number}} miles"),
  org("Gas for the car", "All year", "{{org_gas|money}}"),
  org("Laptop for design work", "Bought {{laptop_date}}, one item", "{{org_laptop|money}}"),
  org("Business liability insurance", "", "{{org_ins|money}}"),
  org("Health insurance premiums", "Just me", "{{org_health|money}}"),
  org("Tax prep fee for last year's Schedule C", "Hollis invoice", "{{org_prep|money}}"),
  org("Printer ink and paper", "", "{{org_sup1|money}}"),
  org("Sketchbooks, markers and mounting board", "", "{{org_sup2|money}}"),
  org("Client meals", "Full amount from receipts", "{{org_meals|money}}"),
  org("Design software subscriptions", "", "{{org_soft|money}}"),
  org("Professional association dues", "", "{{org_dues|money}}"),
  org("Parking ticket outside a client's office", "", "{{org_ticket|money}}"),
  org("Family trip to {{vac_place}}", "I checked work email", "{{vac_cost|money}}"),
  org("Home office", "Used only for business", "{{office_sqft}} sq ft"),
  [null, null, null],
  [bold(`Schedule C input · Profit or Loss From Business · {{client}} · ${TAX_YEAR}`), null, null],
  ["Principal business: graphic design (code 541430) · Cash method · Whole dollars", null, null],
  [bold("Line"), bold("Description"), bold("Amount")],
  [bold("Part I · Income"), null, null],
  line("Line 1", "Gross receipts or sales", "l1", "Line 1 Gross receipts", 3),
  [bold("Part II · Expenses"), null, null],
  line("Line 8", "Advertising", "l8", "Line 8 Advertising", 1.5),
  line("Line 9", "Car and truck expenses", "l9", "Line 9 Car and truck", 1.5),
  line("Line 13", "Depreciation and section 179 expense", "l13", "Line 13 Depreciation and section 179", 1.5),
  line("Line 15", "Insurance (other than health)", "l15", "Line 15 Insurance", 1.5),
  line("Line 17", "Legal and professional services", "l17", "Line 17 Legal and professional", 1.5),
  line("Line 22", "Supplies", "l22", "Line 22 Supplies", 1.5),
  line("Line 24b", "Deductible meals", "l24b", "Line 24b Deductible meals", 1.5),
  line("Line 27a", "Other expenses", "l27a", "Line 27a Other expenses", 1.5),
  line("Line 28", "Total expenses", "l28", "Line 28 Total expenses", 1),
  line("Line 29", "Tentative profit", "l29", "Line 29 Tentative profit", 1),
  line("Line 30", "Business use of home (simplified method)", "l30", "Line 30 Business use of home", 1),
  line("Line 31", "Net profit", "l31", "Line 31 Net profit", 2),
];

export const taxHollisScheduleC = defineScenario({
  slug: "tax-hollis-schedule-c",
  version: 1,
  title: "Hollis Tax & Accounting: Schedule C",
  roleFamily: "accounting",
  timeLimitMinutes: 52,
  definition: {
    intro:
      "You're a tax intern at Hollis Tax & Accounting, in the middle of busy season. Your manager is Elena Vasquez. Today you're on one client's return: a graphic designer who works for themselves and files Schedule C. The work comes in six timed parts, 52 minutes in all: three rapid rounds, sorting the client's documents, the inbox and the Schedule C itself. A finished part can't be reopened.",
    steps: [
      rapidFormsStep,
      sortStep(1),
      sortStep(2),
      sortStep(3),
      {
        id: "deposits",
        type: DOCUMENT_REVIEW,
        seconds: 180,
        title: "Bank deposits vs 1099s",
        config: {
          prompt: [
            "Elena pulled {{client}}'s business deposits by payer. Compare them with the 1099-NECs in the folder.",
            "Flag anything that doesn't line up, then decide what to do.",
          ].join("\n"),
          document: {
            title: `{{client}} · business checking · ${TAX_YEAR} deposits by payer`,
            fields: [
              { id: "nec1", label: "1099-NEC in the folder", value: "{{payer_a}} · Box 1 {{nec_a|money}}" },
              { id: "nec2", label: "1099-NEC in the folder (2)", value: "{{payer_b}} · Box 1 {{nec_b|money}}" },
            ],
            columns: ["Payer (from the deposit memo)", "Deposits", "Total deposited"],
            rows: [1, 2, 3, 4].map((j) => ({ id: `p${j}`, cells: [`{{dep_${j}_payer}}`, `{{dep_${j}_count}}`, `{{dep_${j}_total|money}}`] })),
            totals: [],
          },
          reasons: [
            { id: "missing", label: "1099-NEC expected but not in the folder" },
            { id: "mismatch", label: "Doesn't agree with the 1099-NEC" },
            { id: "not_income", label: "Not business income" },
            { id: "other", label: "Other" },
          ],
          findings: [{ id: "missing", label: "Missing 1099-NEC", points: 4 }],
          falseFlagPenalty: 1,
          decision: {
            prompt: "What do you do about it?",
            options: [
              { id: "ask", label: "Ask the client for the missing 1099-NEC, and report the income either way" },
              { id: "wait", label: "Leave the income off until the 1099-NEC arrives" },
              { id: "skip", label: "Leave it off: without a 1099-NEC the IRS won't know about it" },
            ],
            points: 3,
          },
        },
      },
      rapidDeductStep,
      {
        id: "vacation-reply",
        type: INBOX_REPLY,
        seconds: 180,
        title: "Reply to {{client_first}} about the trip",
        config: {
          prompt: "Reply to {{client_first}} in plain language.",
          to: "{{client}}",
          subject: "RE: Quick question about our trip",
          maxChars: 2_000,
          criteria: [
            { id: "answer", label: "Says no, clearly", maxPoints: 2, guidance: "Tells {{client_first}} plainly that the family trip to {{vac_place}} can't be deducted." },
            {
              id: "why",
              label: "Explains why in plain words",
              maxPoints: 2,
              guidance:
                "The trip's main purpose was a family vacation, so it's personal. Checking email or taking one call doesn't make it a business trip. May add that a trip mainly for business, or a specific business cost with receipts, can be different.",
            },
            { id: "tone", label: "Friendly and short, no jargon", maxPoints: 1, guidance: "Warm, a few sentences, no code sections or lecturing." },
          ],
        },
      },
      {
        id: "net-profit",
        type: NUMERIC,
        seconds: 180,
        title: "Net profit for Elena",
        config: {
          prompt: "Elena: net Schedule C profit on her draft numbers? Whole dollars, number only.",
          unit: "USD",
          decimals: 0,
          points: 4,
        },
      },
      {
        id: "late-reply",
        type: INBOX_REPLY,
        seconds: 240,
        title: "Reply to {{client_first}} about the late 1099",
        config: {
          prompt: "Reply to {{client_first}}: acknowledge the 1099-NEC and say what changes.",
          to: "{{client}}",
          subject: "RE: Found another 1099",
          maxChars: 2_000,
          criteria: [
            {
              id: "thanks",
              label: "Thanks the client and says it will be added",
              maxPoints: 1,
              guidance: "Thanks {{client_first}}, confirms the 1099-NEC from {{late_payer}} will go on the return, and may note it matches the deposits from {{late_payer}}.",
            },
            {
              id: "changes",
              label: "Says what changes",
              maxPoints: 3,
              guidance:
                "Gross receipts go up by {{late|money}}, so Schedule C net profit goes up by the same amount, and self-employment tax and income tax go up too.",
            },
            {
              id: "next",
              label: "Calm and clear about next steps",
              maxPoints: 2,
              guidance: "Plain and reassuring; says the return will be updated before filing, or offers to check the estimated payments.",
            },
          ],
        },
      },
      rapidCalcsStep,
      {
        id: "schedule-c",
        type: SPREADSHEET,
        title: "Schedule C input for {{client}}",
        config: {
          prompt: [
            "Fill in the Schedule C input screen from the client's organizer, with everything we know as of today.",
            "Whole dollars, rounded like the IRS forms: add the cents first, then 50 cents and up rounds up. Leave out anything that doesn't belong on Schedule C.",
          ].join("\n"),
          columns: ["A", "B", "C"],
          rows: SCHEDULE_C_ROWS,
        },
      },
      {
        id: "elena-summary",
        type: INBOX_REPLY,
        title: "Note to Elena on {{client_first}}'s Schedule C",
        config: {
          prompt: "Reply to Elena: net profit, open items, and documents we still need. Keep it short.",
          to: "Elena Vasquez, Tax Manager",
          subject: "RE: {{client}} Schedule C",
          maxChars: 2_500,
          criteria: [
            { id: "profit", label: "Gives net profit with the late 1099", maxPoints: 3, guidance: "States Schedule C net profit (line 31), including the 1099-NEC from {{late_payer}}." },
            {
              id: "open",
              label: "Lists what was left off and why",
              maxPoints: 3,
              guidance:
                "The family trip (personal), gas (covered by the standard mileage rate), the parking ticket (a fine), and the health insurance premiums (not Schedule C; Schedule 1 instead).",
            },
            { id: "docs", label: "Names documents still needed", maxPoints: 2, guidance: "Asks for {{info_ask}}, from the document review." },
            { id: "brevity", label: "Short and organized", maxPoints: 2, guidance: "Brief, easy to scan, ready for Elena to act on." },
          ],
        },
      },
    ],
    messages: [
      {
        id: "m1",
        from: ELENA,
        subject: "Warm-up while I pull the file",
        body: [
          "Hi {{first_name}},",
          "",
          "While I pull today's client file, here's a warm-up: 15 forms from other clients, 20 seconds each. For each one, where does it go on the return?",
          "",
          "Elena",
        ].join("\n"),
        arriveAtMinute: 0,
        stepId: "rapid-forms",
      },
      {
        id: "m2",
        from: ELENA,
        subject: "{{client}}: folder is in",
        body: [
          "{{client}}'s folder is in. {{client_first}} is a graphic designer, works for themselves and files Schedule C.",
          "",
          "Sort the documents for me: three batches of three. Then check the bank deposits against the 1099s.",
          "",
          "Reminder: we elect the de minimis safe harbor for everyone, so equipment over $2,500 an item is an asset.",
          "",
          "Elena",
        ].join("\n"),
        arriveAtMinute: 0,
        stepId: "sort-1",
      },
      {
        id: "m3",
        from: ELENA,
        subject: "Deductible or not?",
        body: ["Quick round before the inbox: is each of these deductible for {{client_first}}?", "", "Elena"].join("\n"),
        arriveAtMinute: 0,
        stepId: "rapid-deduct",
      },
      {
        id: "m4",
        from: CLIENT_FROM,
        subject: "Quick question about our trip",
        body: [
          "Hi, it's {{client_first}}.",
          "",
          "We took the family to {{vac_place}} in {{vac_month}}, {{vac_cost|money}} all in. I checked work email every day and took one client call. Can I deduct the trip?",
          "",
          "Thanks,",
          "{{client}}",
        ].join("\n"),
        arriveAtMinute: 0,
        stepId: "vacation-reply",
      },
      {
        id: "m5",
        from: ELENA,
        subject: "Net profit for {{client_first}}?",
        body: [
          "Quick one before my call with {{client_first}}. On my draft numbers: gross receipts {{draft_gross|money}}, total expenses {{draft_exp|money}}, home office {{office_sqft}} square feet (simplified method).",
          "",
          "Net Schedule C profit? Number only.",
          "",
          "Elena",
        ].join("\n"),
        arriveAtMinute: 0,
        stepId: "net-profit",
      },
      {
        id: "m6",
        from: CLIENT_FROM,
        subject: "Found another 1099",
        body: [
          "Hi, it's {{client_first}}. Sorry, I just found this in my email.",
          "",
          "{{late_payer}} sent me a 1099-NEC for {{late|money}}. I forgot I hadn't given it to you. Does it change anything?",
          "",
          "{{client}}",
        ].join("\n"),
        arriveAtMinute: 0,
        stepId: "late-reply",
      },
      {
        id: "m7",
        from: ELENA,
        subject: "Quick calcs",
        body: ["Last warm-up before the Schedule C: some quick math. The rates are in the round's intro.", "", "Elena"].join("\n"),
        arriveAtMinute: 0,
        stepId: "rapid-calcs",
      },
      {
        id: "m8",
        from: ELENA,
        subject: "{{client}}: Schedule C",
        body: [
          "Time to put {{client_first}}'s Schedule C together. The organizer is in the workbook.",
          "",
          "Use the standard mileage rate and the simplified home office method. We're taking Section 179 on the laptop. Make sure it has everything we know about as of today.",
          "",
          "Elena",
        ].join("\n"),
        arriveAtMinute: 0,
        stepId: "schedule-c",
      },
      {
        id: "m9",
        from: ELENA,
        subject: "RE: {{client}}: Schedule C",
        body: ["When the sheet's done, send me a short note: net profit, open items, and any documents we still need from {{client_first}}.", "", "Elena"].join("\n"),
        arriveAtMinute: 1,
        stepId: "elena-summary",
      },
    ],
    sections: [
      { id: "s-rapid-a", title: "Rapid round: form to field", minutes: 6, stepIds: ["rapid-forms"] },
      { id: "s-organize", title: "Organize the documents", minutes: 12, stepIds: ["sort-1", "sort-2", "sort-3", "deposits"], oneAtATime: true },
      { id: "s-rapid-b", title: "Rapid round: deductible?", minutes: 6, stepIds: ["rapid-deduct"] },
      { id: "s-inbox", title: "Inbox", minutes: 10, stepIds: ["vacation-reply", "net-profit", "late-reply"], oneAtATime: true },
      { id: "s-rapid-c", title: "Rapid round: quick calcs", minutes: 6, stepIds: ["rapid-calcs"] },
      { id: "s-final", title: "Schedule C", minutes: 12, stepIds: ["schedule-c", "elena-summary"] },
    ],
  },

  build(rng) {
    const v: Record<string, string | number> = {};
    const client = rng.pick(CLIENTS);
    const first = client.split(" ")[0];
    const [payerA, payerB, payerC] = rng.shuffle(PAYERS);
    const vacPlace = rng.pick(PLACES);
    Object.assign(v, {
      client,
      client_first: first,
      town: rng.pick(TOWNS),
      vac_place: vacPlace,
      vac_month: rng.pick(MONTHS),
      vac_cost: rng.cents(1_800, 6_500),
      payer_a: payerA,
      payer_b: payerB,
      late_payer: payerC,
    });

    // ---- Income: two 1099-NECs in the folder, one that arrives late, and small clients with no 1099s ----
    const necA = rng.int(14_000, 28_000) * 100;
    const necB = rng.int(14_000, 28_000) * 100;
    const late = rng.int(1_800, 7_500) * 100;
    const small = rng.int(2_000, 8_000) * 100;
    Object.assign(v, { nec_a: necA, nec_b: necB, late, small });

    // ---- Organizer and the Schedule C it makes (redrawn if an answer lands on a number the material shows) ----
    const laptopDate = date2025(rng);
    let o: Record<string, number>;
    let miles: number;
    let sqft: number;
    let sc: Record<string, number>;
    for (;;) {
      o = {
        org_ads1: rng.cents(200, 1_500),
        org_ads2: rng.cents(150, 600),
        org_gas: rng.cents(300, 1_600),
        org_laptop: rng.cents(2_600, 3_900),
        org_ins: rng.cents(420, 1_300),
        org_health: rng.cents(2_400, 7_800),
        org_prep: rng.cents(350, 900),
        org_sup1: rng.cents(60, 400),
        org_sup2: rng.cents(40, 300),
        org_meals: rng.cents(300, 2_400),
        org_soft: rng.cents(600, 1_800),
        org_dues: rng.cents(150, 450),
        org_ticket: rng.cents(35, 95),
      };
      miles = rng.int(1_500, 6_000);
      sqft = rng.int(90, RATES.homeOfficeMaxSqFt);
      const lines: Record<string, number> = {
        l1: dollarsOf(necA + necB + late + small),
        l8: dollarsOf(o.org_ads1 + o.org_ads2),
        l9: wholeOf(miles * RATES.mileageCentsPerMile, 100),
        l13: dollarsOf(o.org_laptop),
        l15: dollarsOf(o.org_ins),
        l17: dollarsOf(o.org_prep),
        l22: dollarsOf(o.org_sup1 + o.org_sup2),
        l24b: wholeOf(o.org_meals, 200),
        l27a: dollarsOf(o.org_soft + o.org_dues),
      };
      lines.l28 = ["l8", "l9", "l13", "l15", "l17", "l22", "l24b", "l27a"].reduce((t, k) => t + lines[k], 0);
      lines.l29 = lines.l1 - lines.l28;
      lines.l30 = sqft * RATES.homeOfficeDollarsPerSqFt;
      lines.l31 = lines.l29 - lines.l30;
      sc = lines;
      if (clear(...Object.values(lines), lines.l31 - dollarsOf(late))) break;
    }
    Object.assign(v, o, { miles, office_sqft: sqft, laptop_date: laptopDate });
    const draftGross = necA + necB + small;
    Object.assign(v, { draft_gross: draftGross, draft_exp: sc.l28 * 100 });
    const netDraft = dollarsOf(draftGross) - sc.l28 - sc.l30;

    // ---- Organize: nine documents shuffled over three screens ----
    const helper = rng.pick(HELPERS);
    const necDate = () => `Jan ${rng.int(15, 31)}, ${TAX_YEAR + 1}`;
    type Doc = { doc: string; from: string; date: string; details: string; amount: number; category: Category; ask?: string };
    const spec = (s: DocSpec, category: Category, amount?: number): Doc => ({
      doc: s.doc,
      from: s.from,
      date: date2025(rng),
      details: s.details,
      amount: amount ?? rng.cents(s.range[0], s.range[1]),
      category,
      ask: s.ask,
    });
    const info = spec(rng.pick(infoDocs(helper)), "info");
    const docs: Doc[] = rng.shuffle([
      { doc: "Form 1099-NEC", from: payerA, date: necDate(), details: `Box 1 nonemployee compensation for ${TAX_YEAR}`, amount: necA, category: "income" as const },
      { doc: "Form 1099-NEC", from: payerB, date: necDate(), details: `Box 1 nonemployee compensation for ${TAX_YEAR}`, amount: necB, category: "income" as const },
      ...rng
        .shuffle(EXPENSE_DOCS)
        .slice(0, 3)
        .map((s) => spec(s, "expense")),
      { doc: "Receipt", from: "Bayside Computer Store", date: laptopDate, details: "Laptop, 16-inch, for design work (one item)", amount: o.org_laptop, category: "asset" as const },
      ...rng
        .shuffle(PERSONAL_DOCS)
        .slice(0, 2)
        .map((s) => spec(s, "personal")),
      info,
    ]);
    const sortKeys: Record<string, unknown> = {};
    const label = (c: Category) => CATEGORIES.find((x) => x.id === c)!.label.toLowerCase();
    for (let k = 1; k <= 3; k++) {
      const batch = docs.slice((k - 1) * 3, k * 3);
      const findings: Record<string, { targets: string[]; reasons: string[]; note: string }> = {};
      batch.forEach((d, j) => {
        const r = `s${k}_r${j + 1}`;
        Object.assign(v, { [`${r}_doc`]: d.doc, [`${r}_from`]: d.from, [`${r}_date`]: d.date, [`${r}_details`]: d.details, [`${r}_amt`]: d.amount });
        findings[`doc${j + 1}`] = { targets: [`r${j + 1}`], reasons: [d.category], note: `${d.from}, ${money(d.amount)}: ${label(d.category)}.` };
      });
      sortKeys[`sort-${k}`] = { findings };
    }
    v.info_ask = info.ask!;

    // ---- Deposits by payer: A and B agree with their 1099s, C has none, small clients are under $600 each ----
    const deposits = rng.shuffle([
      { payer: payerA, count: rng.int(3, 12), total: necA },
      { payer: payerB, count: rng.int(3, 12), total: necB },
      { payer: payerC, count: rng.int(2, 6), total: late },
      { payer: `Small clients (${rng.int(5, 9)} payers, each under $600 for the year)`, count: rng.int(8, 20), total: small },
    ]);
    deposits.forEach((d, j) => Object.assign(v, { [`dep_${j + 1}_payer`]: d.payer, [`dep_${j + 1}_count`]: d.count, [`dep_${j + 1}_total`]: d.total }));
    const missingRow = `p${deposits.findIndex((d) => d.payer === payerC) + 1}`;

    // ---- Rapid rounds, drawn last so the rest of the material is unchanged per seed ----
    const rapidKeys = {
      "rapid-forms": { items: buildForms(rng, v) },
      "rapid-deduct": { items: buildDeduct(rng, v, first) },
      "rapid-calcs": { items: buildCalcs(rng, v) },
    };

    const lateWhole = dollarsOf(late);
    const seUp = seTax(sc.l31) - seTax(sc.l31 - lateWhole);
    return {
      values: v,
      keys: {
        ...rapidKeys,
        ...sortKeys,
        deposits: {
          findings: {
            missing: { targets: [missingRow], reasons: ["missing"], note: `No 1099-NEC from ${payerC} in the folder, but ${money(late)} was deposited from them.` },
          },
          decision: ["ask"],
        },
        "vacation-reply": {
          notes: {
            answer: `Not deductible: the ${vacPlace} trip (${money(v.vac_cost as number)}) was a family vacation.`,
            why: "Checking email and one client call don't make a family trip a business trip.",
          },
        },
        "net-profit": { value: netDraft, tolerance: 1 },
        "late-reply": {
          notes: {
            changes: `Gross receipts go up by ${money(late)} to $${int(sc.l1)}; net profit goes up the same to $${int(sc.l31)}. SE tax goes up about $${int(seUp)}.`,
          },
        },
        "schedule-c": {
          tolerance: 1,
          cells: Object.fromEntries(
            Object.entries(sc).map(([id, value]) => [id, ["l28", "l29", "l31"].includes(id) ? { value, tolerance: 3 } : { value }]),
          ),
        },
        "elena-summary": {
          notes: {
            profit: `Net profit $${int(sc.l31)} (line 31), including the ${money(late)} 1099-NEC from ${payerC}.`,
            open: `Left off: the ${vacPlace} trip ${money(v.vac_cost as number)}, gas ${money(o.org_gas)}, the parking ticket ${money(o.org_ticket)}, health insurance ${money(o.org_health)} (Schedule 1).`,
            docs: `${info.from}: still need ${info.ask}.`,
          },
        },
      },
    };
  },
});
