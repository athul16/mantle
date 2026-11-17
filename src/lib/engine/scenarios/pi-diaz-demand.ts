import "server-only";

import type { Rng } from "../server/rng";
import { defineScenario } from "../server/scenario";
import { DOCUMENT_REVIEW } from "../step-types/document_review/public";
import { MULTIPLE_CHOICE } from "../step-types/multiple_choice/public";
import { ORDERING } from "../step-types/ordering/public";
import { RAPID_ROUND } from "../step-types/rapid_round/public";
import { SPREADSHEET } from "../step-types/spreadsheet/public";
import {
  FIRST_NAMES,
  LAW_FIRMS,
  addDays,
  daysBetween,
  distinctPeople,
  formatDate,
  holidaysBetween,
  isWeekend,
  nextCourtDay,
  pickDistinct,
  previousCourtDay,
  type IsoDate,
} from "./legal";

/**
 * Personal injury paralegal at a plaintiff's firm: the Diaz file, from intake
 * to the demand letter, in the (fictional) State of Calloway. Six timed
 * sections, 50 minutes, 100 points, all scored automatically:
 *
 *   rapid round A, limitations dates and damages math (10) → medical
 *   chronology (ordering, 10) then treatment gaps (10), one screen at a time
 *   → rapid round B, medical billing terms (10) → medical specials worksheet
 *   (20) → rapid round C, intake and ethics (10) → demand letter review (18),
 *   then two inbox calls (6 + 6), one screen at a time.
 *
 * Seeded per candidate: every name, provider, date and amount; the order of
 * treatment and which record sits where in the list; where the treatment gaps,
 * the duplicate bill and the letter-of-protection providers fall; which
 * provider the demand letter leaves out; and where the right option sits.
 * Limitations dates use the shared court-day helpers (./legal/dates.ts) with
 * the federal holidays as Calloway's court holidays.
 *
 * Rapid rounds: 15 items × 20 s. Items 3, 6, 9, 12, 15 are the harder kinds,
 * worth 1; the other ten are worth ½, so each round is exactly 10.
 *
 * Draft v1: team self-review pending (docs/paralegal/pi-diaz-demand.md).
 */

const LETTERS = ["a", "b", "c", "d"] as const;
type Values = Record<string, string | number>;
type ItemKey = Record<string, { choice: string } | { value: number; tolerance: number }>;

const usd = (cents: number) =>
  `${cents < 0 ? "-" : ""}$${(Math.abs(cents) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// ---- Rapid round plumbing ----

const RAPID_ITEMS = 15;
/** Items 3, 6, 9, 12 and 15 are worth 1; the rest ½. 10 points a round. */
const isHardSlot = (i: number) => i % 3 === 2;
const slotNo = (i: number) => String(i + 1).padStart(2, "0");

function rapidItems(prefix: string, item: (n: string, i: number) => object) {
  return Array.from({ length: RAPID_ITEMS }, (_, i) => ({ id: `${prefix}-${slotNo(i)}`, ...item(slotNo(i), i), points: isHardSlot(i) ? 1 : 0.5 }));
}

const letterOptions = (name: string) => LETTERS.map((l) => ({ id: l, label: `{{${name}_${l}}}` }));

/** Puts `right` among `wrong` in a random place; returns the labels by letter and the right letter. */
function placeOptions(rng: Rng, right: string, wrong: string[]): { labels: string[]; letter: string } {
  if (wrong.length !== 3 || new Set([right, ...wrong]).size !== 4) throw new Error(`pi-diaz-demand: options must be 4 different labels (${right})`);
  const labels = rng.shuffle([right, ...wrong]);
  return { labels, letter: LETTERS[labels.indexOf(right)] };
}

/** The same month and day `n` years later. Generators never draw February 29. */
const plusYears = (d: IsoDate, n: number): IsoDate => `${Number(d.slice(0, 4)) + n}${d.slice(4)}`;
/** A date between two ISO dates, inclusive, never February 29. */
function dateBetween(rng: Rng, from: IsoDate, to: IsoDate): IsoDate {
  for (;;) {
    const d = addDays(from, rng.int(0, daysBetween(from, to)));
    if (!d.endsWith("-02-29")) return d;
  }
}
/** Next weekday, ignoring holidays: the "forgot the holiday" roll. */
function nextWeekday(d: IsoDate): IsoDate {
  let x = d;
  while (isWeekend(x)) x = addDays(x, 1);
  return x;
}

// ---- Rapid round A: limitations and damages ----

const RULES = {
  pi: "Personal injury: 2 years from the date of injury",
  property: "Injury to property: 3 years from the date of injury",
  public: "Claim against a public entity: 180 days from the date of injury to present the claim",
} as const;

const LIMITATIONS_INTRO = [
  "Limitations and damages: 15 items, 20 seconds each. Pick the last day to file (or to present the claim), or work out the amount to the cent.",
  "Calloway rules (a fictional state), from the firm's calendaring memo: personal injury, 2 years from the date of injury; injury to property, 3 years; a claim against a public entity (the state, a county, a city or a transit district) must be presented within 180 days of the injury.",
  "A period in years ends on the same month and day; a period in days is counted from the day after the injury. If the injured person was under 18 on the date of injury, a period in years starts on their 18th birthday instead. If the last day is a Saturday, Sunday or court holiday, it moves to the next court day; Calloway's court holidays are the federal holidays.",
  "Calloway uses modified comparative fault: a client 51% or more at fault recovers nothing; otherwise the damages are reduced by the client's share.",
].join("\n");

/** Fixed per slot, so a field's kind never hints at anything: date items in some slots, amounts in others. */
const DATE_SLOTS = new Set([0, 2, 3, 5, 6, 9, 11, 12]);
type DateKind = "pi" | "property" | "weekend" | "holiday" | "minor" | "public";
type MoneyKind = "wages" | "mileage" | "sum" | "fault" | "net";
const DATE_EASY: DateKind[] = ["pi", "pi", "property", "weekend", "weekend"];
const DATE_HARD: DateKind[] = ["minor", "public", "holiday"];
const MONEY_EASY: MoneyKind[] = ["wages", "wages", "mileage", "sum", "sum"];
const MONEY_HARD: MoneyKind[] = ["fault", "net"];

const CLAIMS: Record<DateKind, string[]> = {
  pi: ["Personal injury: rear-ended at a stoplight", "Personal injury: hit by a car turning left", "Personal injury: slipped on a wet grocery store floor", "Personal injury: bitten by a neighbor's dog"],
  weekend: ["Personal injury: rear-ended at a stoplight", "Personal injury: hit by a car turning left", "Personal injury: fell on a broken apartment stair"],
  holiday: ["Personal injury: side-swiped on the highway", "Personal injury: hit in a crosswalk", "Personal injury: fell through a rotten deck board"],
  minor: ["Personal injury: riding a bicycle, struck by a delivery van", "Personal injury: passenger in a friend's car that ran a red light", "Personal injury: hurt on a trampoline at a party"],
  property: ["Property damage: the client's parked car was hit", "Property damage: a truck backed into the client's fence", "Property damage: the client's car was totaled in a crash"],
  public: ["Personal injury: hurt when a county bus braked hard (Calloway County Transit)", "Personal injury: tripped on a broken city sidewalk (City of Port Ellery)", "Personal injury: hit by a state highway department truck"],
};

const limitationsStep = {
  id: "rapid-limitations",
  type: RAPID_ROUND,
  title: "Rapid round: limitations and damages",
  config: {
    intro: LIMITATIONS_INTRO,
    secondsPerItem: 20,
    items: rapidItems("sl", (n, i) =>
      DATE_SLOTS.has(i)
        ? {
            prompt: "Which date do you calendar as the last day?",
            exhibit: {
              title: "Intake note",
              rows: [
                { label: "Claim", value: `{{sl_${n}_claim}}` },
                { label: "Date of injury", value: `{{sl_${n}_injury}}` },
                { label: "Client's date of birth", value: `{{sl_${n}_born}}` },
                { label: "Limitations rule", value: `{{sl_${n}_rule}}` },
                { label: "Court holidays near the options", value: `{{sl_${n}_hols}}` },
              ],
            },
            fields: [{ id: "answer", label: "Last day", kind: "choice", options: letterOptions(`sl_${n}`) }],
          }
        : { prompt: `{{sl_${n}_q}}`, fields: [{ id: "answer", label: "Amount", kind: "number", unit: "$", decimals: 2 }] },
    ),
  },
};

function buildLimitations(rng: Rng, v: Values, clientFirst: string): Record<string, ItemKey> {
  const dateEasy = rng.shuffle(DATE_EASY);
  const dateHard = rng.shuffle(DATE_HARD);
  const moneyEasy = rng.shuffle(MONEY_EASY);
  const moneyHard = rng.shuffle(MONEY_HARD);
  const out: Record<string, ItemKey> = {};
  for (let i = 0; i < RAPID_ITEMS; i++) {
    const n = slotNo(i);
    const hard = isHardSlot(i);
    if (DATE_SLOTS.has(i)) {
      const kind = (hard ? dateHard : dateEasy).shift()!;
      out[`sl-${n}`] = { answer: { choice: dateItem(rng, v, n, kind) } };
    } else {
      const kind = (hard ? moneyHard : moneyEasy).shift()!;
      out[`sl-${n}`] = { answer: { value: moneyItem(rng, v, n, kind, clientFirst) / 100, tolerance: 0 } };
    }
  }
  if (dateEasy.length || dateHard.length || moneyEasy.length || moneyHard.length) throw new Error("pi-diaz-demand: limitation slots don't fill");
  return out;
}

/** One limitations item; returns the right letter. Every date stays inside the verified holiday years (2026–2028). */
function dateItem(rng: Rng, v: Values, n: string, kind: DateKind): string {
  for (let tries = 0; ; tries++) {
    if (tries > 5_000) throw new Error(`pi-diaz-demand: no ${kind} limitations item`);
    let injury: IsoDate;
    let born: IsoDate;
    let end: IsoDate;
    let wrongs: IsoDate[];
    if (kind === "minor") {
      const eighteen = dateBetween(rng, "2025-03-01", "2026-10-31");
      born = plusYears(eighteen, -18);
      injury = dateBetween(rng, addDays(eighteen, -6 * 365), addDays(eighteen, -30));
      if (injury < "2020-01-01") continue;
      end = plusYears(eighteen, 2);
      wrongs = [nextCourtDay(plusYears(injury, 2)), nextCourtDay(eighteen), nextCourtDay(plusYears(eighteen, 3)), end, nextCourtDay(addDays(end, 7))];
    } else {
      const [from, to] = kind === "property" ? ["2024-03-01", "2025-10-31"] : kind === "public" ? ["2026-01-05", "2028-04-30"] : ["2025-03-01", "2026-10-31"];
      injury = dateBetween(rng, from, to);
      born = dateBetween(rng, "1958-01-01", "2002-12-31");
      if (kind === "public") {
        end = addDays(injury, 180);
        wrongs = [nextCourtDay(plusYears(injury, 2)), nextCourtDay(addDays(injury, 90)), end, nextCourtDay(addDays(injury, 179)), previousCourtDay(end), nextCourtDay(addDays(end, 30))];
      } else if (kind === "property") {
        end = plusYears(injury, 3);
        wrongs = [nextCourtDay(plusYears(injury, 2)), end, previousCourtDay(end), nextCourtDay(plusYears(injury, 4)), nextCourtDay(addDays(end, -1))];
      } else {
        end = plusYears(injury, 2);
        wrongs = [end, nextWeekday(end), previousCourtDay(end), nextCourtDay(plusYears(injury, 3)), nextCourtDay(addDays(end, -1)), nextCourtDay(plusYears(injury, 1))];
      }
    }
    const due = nextCourtDay(end);
    const holidayRoll = holidaysBetween(end, due).length > 0;
    const fits = {
      pi: due === end,
      property: due === end,
      weekend: isWeekend(end) && !holidayRoll,
      holiday: holidayRoll,
      minor: true,
      public: true,
    }[kind];
    if (!fits) continue;
    const wrong = [...new Set(wrongs)].filter((d) => d !== due).slice(0, 3);
    if (wrong.length < 3) continue;
    const { labels, letter } = placeOptions(rng, formatDate(due), wrong.map((d) => formatDate(d)));
    const optionDates = [due, ...wrong].sort();
    const hols = holidaysBetween(addDays(optionDates[0], -10), addDays(optionDates[3], 10)).filter((h) =>
      optionDates.some((d) => Math.abs(daysBetween(d, h.date)) <= 10),
    );
    Object.assign(v, {
      [`sl_${n}_claim`]: rng.pick(CLAIMS[kind]),
      [`sl_${n}_injury`]: formatDate(injury),
      [`sl_${n}_born`]: formatDate(born),
      [`sl_${n}_rule`]: kind === "public" ? RULES.public : kind === "property" ? RULES.property : RULES.pi,
      [`sl_${n}_hols`]: hols.length ? hols.map((h) => `${formatDate(h.date)} (${h.name})`).join("; ") : "None",
      ...Object.fromEntries(LETTERS.map((l, j) => [`sl_${n}_${l}`, labels[j]])),
    });
    return letter;
  }
}

/** One damages item; returns the answer in cents. Amounts shown as text, so the leak tests treat the answer as derived. */
function moneyItem(rng: Rng, v: Values, n: string, kind: MoneyKind, clientFirst: string): number {
  let q: string;
  let answer: number;
  switch (kind) {
    case "wages": {
      const rate = rng.int(64, 192) * 25; // $16.00 to $48.00 in quarters
      const hours = rng.int(16, 40);
      const weeks = rng.int(2, 12);
      answer = rate * hours * weeks;
      q = `Lost wages: ${usd(rate)} an hour, ${hours} hours a week, ${weeks} weeks off work. How much does the demand claim?`;
      break;
    }
    case "mileage": {
      const trips = rng.int(4, 30);
      const miles = rng.int(6, 60);
      const rate = rng.int(18, 72);
      answer = trips * miles * rate;
      q = `Medical mileage: ${trips} round trips of ${miles} miles at ${usd(rate)} a mile. How much does the demand claim?`;
      break;
    }
    case "sum": {
      const bills = [rng.cents(85, 4_800), rng.cents(85, 4_800), rng.cents(85, 4_800)];
      answer = bills[0] + bills[1] + bills[2];
      q = `Three bills: ${usd(bills[0])}, ${usd(bills[1])} and ${usd(bills[2])}. What is their total?`;
      break;
    }
    case "fault": {
      const gross = rng.int(800, 12_000) * 2_500; // $20,000 to $300,000 in $25 steps
      const pct = rng.int(0, 4) === 0 ? rng.pick([55, 60, 65]) : rng.int(2, 9) * 5;
      answer = pct >= 51 ? 0 : (gross * (100 - pct)) / 100;
      q = `The jury finds damages of ${usd(gross)} and finds the client ${pct}% at fault. Under Calloway's rule, what does ${clientFirst}'s side recover?`;
      break;
    }
    case "net": {
      for (;;) {
        const settlement = rng.int(40, 600) * 50_000; // $20,000 to $300,000
        const fee = rng.pick([30, 35, 40]);
        const costs = rng.cents(300, 4_000);
        const lien = rng.cents(1_000, 20_000);
        answer = settlement - (settlement * fee) / 100 - costs - lien;
        if (answer < 100_000) continue;
        q = `Settlement ${usd(settlement)}. Fee ${fee}% of the settlement, case costs ${usd(costs)}, health plan lien ${usd(lien)}. What is the net to the client?`;
        break;
      }
      break;
    }
  }
  v[`sl_${n}_q`] = q!;
  return answer;
}

// ---- Rapid rounds B and C: choice questions ----

interface ChoiceQuestion {
  prompt: (rng: Rng, ctx: Ctx) => { prompt: string; right: string; wrong: [string, string, string] } | string;
  right?: string;
  wrong?: [string, string, string];
}
interface Ctx {
  client: string;
  clientFirst: string;
  insurer: string;
}

const q = (prompt: string | ((ctx: Ctx) => string), right: string, wrong: [string, string, string]): ChoiceQuestion => ({
  prompt: (_, ctx) => (typeof prompt === "string" ? prompt : prompt(ctx)),
  right,
  wrong,
});

const BILLING_EASY: ChoiceQuestion[] = [
  q('On a provider\'s bill, what are "billed charges"?', "The full price the provider lists, before any discount or payment", [
    "What the health plan paid",
    "What the patient still owes",
    "The amount the insurer offered",
  ]),
  q('A "contractual adjustment" on a ledger is…', "The amount written off under the provider's contract with the health plan", [
    "A late fee added to the account",
    "A payment the patient made",
    "A charge for copying records",
  ]),
  q("What is an EOB?", "An explanation of benefits: the health plan's statement of what it allowed and paid", [
    "An estimate of bills from the provider",
    "A court order about benefits",
    "The firm's settlement statement",
  ]),
  q((c) => `The health plan that paid ${c.clientFirst}'s accident bills wants to be repaid from the settlement. That right is called…`, "Subrogation (reimbursement)", [
    "Contribution",
    "Indemnity",
    "Remittitur",
  ]),
  q("A letter of protection tells a provider…", "It will be paid from the settlement, so it waits to collect", [
    "Its records are privileged",
    "It must stop treating the client",
    "It has been named in the lawsuit",
  ]),
  q("Which record shows every charge, payment and adjustment on an account, by date?", "An itemized ledger (account statement)", [
    "A HIPAA authorization",
    "A discharge summary",
    "The police report",
  ]),
  q("What does a HIPAA authorization signed by the client let the firm do?", "Request the client's medical records and bills from providers", [
    "Settle the claim for the client",
    "Talk to the defendant's doctors",
    "Waive the providers' liens",
  ]),
  q('"Date of service" on a bill means…', "The day the treatment was given", ["The day the bill was printed", "The day the bill was paid", "The day the records arrived"]),
  q('"Medical specials" in a demand are…', "The medical bills: economic damages for treatment", ["Pain and suffering", "Punitive damages", "The firm's fee"]),
  q('"Balance billing" means…', "Billing the patient for what's left after the plan paid", [
    "Splitting one bill between two plans",
    "Sending the bill to the court",
    "Billing the firm's trust account",
  ]),
  q("Med-pay coverage on the client's own auto policy pays…", "The client's accident medical bills whatever the fault, up to its limit", [
    "Only if the client wasn't at fault",
    "The other driver's medical bills",
    "Property damage only",
  ]),
  q("What is a records custodian's affidavit used for?", "Show the records are authentic business records", [
    "Prove the bills are reasonable",
    "Waive the doctor-patient privilege",
    "Calculate the health plan's lien",
  ]),
  q("Which form do hospitals usually bill their facility charges on?", "UB-04", ["W-2", "1099-MISC", "I-9"]),
];

const BILLING_HARD: ChoiceQuestion[] = [
  {
    prompt: (rng) => {
      let billed: number, adj: number, patient: number, plan: number;
      do {
        billed = rng.cents(900, 9_000);
        adj = Math.round((billed * rng.int(15, 40)) / 100);
        patient = rng.int(1, 6) * 2_500;
        plan = Math.round(((billed - adj - patient) * rng.int(50, 90)) / 100);
      } while (adj === patient || adj === plan + patient);
      const balance = billed - adj - plan - patient;
      return {
        prompt: `Billed ${usd(billed)}, contractual adjustment ${usd(adj)}, plan paid ${usd(plan)}, patient paid ${usd(patient)}. What is the balance?`,
        right: usd(balance),
        wrong: [usd(billed - plan - patient), usd(billed - adj - plan), usd(billed - adj)],
      };
    },
  },
  {
    prompt: (rng) => {
      let accident: number, checkup: number, billed: number;
      do {
        accident = rng.cents(2_000, 18_000);
        checkup = rng.cents(120, 600);
        billed = accident + rng.cents(1_500, 9_000);
      } while (new Set([accident, accident + checkup, billed, billed - accident]).size < 4);
      return {
        prompt: `The health plan paid ${usd(accident)} on accident bills and ${usd(checkup)} on an unrelated checkup. The accident bills total ${usd(billed)}. How much is the plan's reimbursement claim?`,
        right: usd(accident),
        wrong: [usd(accident + checkup), usd(billed), usd(billed - accident)],
      };
    },
  },
  {
    prompt: (rng) => {
      let billed: number, adj: number, paid: number;
      do {
        billed = rng.cents(1_500, 12_000);
        adj = Math.round((billed * rng.int(20, 45)) / 100);
        paid = billed - adj - rng.int(1, 3) * 2_500;
      } while (new Set([billed, paid, billed - adj, adj]).size < 4);
      return {
        prompt: `Under Calloway's collateral source rule, the demand presents the full amount billed. A bill shows billed ${usd(billed)}, adjustment ${usd(adj)}, plan paid ${usd(paid)}. Which amount goes in the demand?`,
        right: usd(billed),
        wrong: [usd(paid), usd(billed - adj), usd(adj)],
      };
    },
  },
  q('A provider treating on a letter of protection sends a bill marked "reduction requested". Who decides whether to accept a reduction?', "The attorney, with the client's consent", [
    "The paralegal handling the file",
    "The health plan",
    "The adjuster",
  ]),
  q("The worksheet lists the same invoice twice: once from the provider's statement and once from the plan's EOB. How many times does it count in the specials?", "Once", [
    "Twice",
    "Not at all",
    "Once for each payer",
  ]),
  q("A bill has a date of service before the date of loss. In the specials, you…", "Leave it out unless the attorney decides it's related", [
    "Include it: the client was a patient there",
    "Include half of it",
    "Include only the copay",
  ]),
];

const INTAKE_EASY: ChoiceQuestion[] = [
  q("A caller asks whether the firm will take the case. Can you say yes?", "No: only an attorney can accept a case", [
    "Yes, if the case looks strong",
    "Yes, once they sign the HIPAA form",
    "Yes, if the other driver was ticketed",
  ]),
  q("Who signs the fee agreement for the firm?", "An attorney", ["The paralegal who did the intake", "The office manager", "Nobody: the client's signature is enough"]),
  q((c) => `${c.clientFirst} asks you to sign the demand letter so it goes out today. Can you?`, "No: the attorney signs it", [
    "Yes, with your title under the signature",
    "Yes, if the attorney is out of the office",
    "Yes, if the client agrees",
  ]),
  q((c) => `The at-fault driver's adjuster at ${c.insurer} asks for a recorded statement from ${c.clientFirst}. You…`, "Decline and refer the adjuster to the attorney", [
    "Set up the call for tomorrow",
    "Give the statement yourself",
    "Send the adjuster the medical records instead",
  ]),
  q("The at-fault driver has a lawyer. Can you call the driver about the crash?", "No: communicate through the driver's lawyer", [
    "Yes, if you're polite",
    "Yes, but only by email",
    "Yes, if the driver called first",
  ]),
  q((c) => `A physical therapy office calls to ask how the case is going so it can decide whether to send ${c.clientFirst}'s bill to collections. You…`, "Don't discuss it without the client's permission; take a message for the attorney", [
    "Tell them the settlement is close",
    "Give them the adjuster's number",
    "Tell them the demand amount",
  ]),
  q("The client brings in screenshots of the other driver's posts about the crash. You…", "Save them with the date and link and give them to the attorney", [
    "Comment on the posts to get more",
    "Send them to the adjuster right away",
    "Delete them: they're not evidence",
  ]),
  q("What should your email signature show?", 'Your name and "Paralegal", so no one takes you for a lawyer', [
    'Your name and "Esq."',
    "Just your name",
    "The attorney's name only",
  ]),
  q("A settlement check arrives, payable to the client and the firm. You…", "Log it and give it to the attorney for the client trust account", [
    "Mail it to the client",
    "Deposit it in the firm's operating account",
    "Hold it until the client calls",
  ]),
  q("A chiropractor offers the firm a fee for each client the firm sends over. You…", "Decline and tell the attorney", [
    "Accept: it helps clients get care",
    "Accept if it's under $100",
    "Ask the client to decide",
  ]),
  q("What do you collect first at intake on a car crash?", "The date of loss, the people and insurers involved, and the injuries, so the conflicts check can run", [
    "The client's opinion of what the case is worth",
    "Only the client's phone number",
    "The medical bills, before anything else",
  ]),
];

const INTAKE_HARD: ChoiceQuestion[] = [
  q("A new caller says they were driving the other car in the same crash as a current client. You…", "Run a conflicts check before talking about the case", [
    "Take the intake: same crash, same lawyers",
    "Tell them about the current client's injuries",
    "Refer them to the current client's adjuster",
  ]),
  q((c) => `${c.clientFirst} asks whether the firm can lend them rent money until the case settles. You…`, "Only an attorney can answer: tell the attorney, and don't promise anything", [
    "Yes: firms often advance living expenses",
    "Lend it yourself and get repaid at settlement",
    "Tell them to ask the adjuster",
  ]),
  q((c) => `${c.clientFirst} says the crash happened on a different day than the police report says. You…`, "Note both dates and tell the attorney", [
    "Use the client's date and ignore the report",
    "Ask the police to change the report",
    "Use the report's date and say nothing",
  ]),
  q((c) => `${c.clientFirst} asks you to leave an old back injury out of the records you send the insurer. You…`, "Refuse: records go out complete; tell the attorney", [
    "Remove those pages before sending",
    "Send them but black out the back injury",
    "Ask the provider to rewrite the records",
  ]),
  q("A tow-truck driver offers to send the firm crash victims from the hospital for a fee. You…", "Refuse and tell the attorney: that's improper solicitation", [
    "Accept: it's just marketing",
    "Accept, but pay in gift cards",
    "Accept if the victims agree",
  ]),
  q("The adjuster offers you a quick settlement on a phone call. You…", "Take a message: only the attorney can negotiate", [
    "Accept if it covers the bills",
    "Make a counteroffer",
    "Accept and tell the client later",
  ]),
];

const choiceRound = (id: string, title: string, intro: string, prefix: string) => ({
  id,
  type: RAPID_ROUND,
  title,
  config: {
    intro,
    secondsPerItem: 20,
    items: rapidItems(prefix, (n) => ({ prompt: `{{${prefix}_${n}}}`, fields: [{ id: "answer", label: "Answer", kind: "choice", options: letterOptions(`${prefix}_${n}`) }] })),
  },
});

const billingStep = choiceRound(
  "rapid-billing",
  "Rapid round: medical billing",
  "Medical billing: 15 quick questions on bills, ledgers and liens, 20 seconds each.",
  "mb",
);
const intakeStep = choiceRound(
  "rapid-intake",
  "Rapid round: intake and ethics",
  "Intake and ethics: 15 quick calls a personal injury paralegal makes, 20 seconds each. Pick what you do.",
  "ie",
);

function buildChoiceRound(rng: Rng, v: Values, prefix: string, easy: ChoiceQuestion[], hard: ChoiceQuestion[], ctx: Ctx): Record<string, ItemKey> {
  const e = rng.shuffle(easy).slice(0, 10);
  const h = rng.shuffle(hard).slice(0, 5);
  return Object.fromEntries(
    Array.from({ length: RAPID_ITEMS }, (_, i) => {
      const n = slotNo(i);
      const question = isHardSlot(i) ? h.shift()! : e.shift()!;
      const made = question.prompt(rng, ctx);
      const { prompt, right, wrong } = typeof made === "string" ? { prompt: made, right: question.right!, wrong: question.wrong! } : made;
      const { labels, letter } = placeOptions(rng, right, wrong);
      v[`${prefix}_${n}`] = prompt;
      LETTERS.forEach((l, j) => (v[`${prefix}_${n}_${l}`] = labels[j]));
      return [`${prefix}-${n}`, { answer: { choice: letter } }];
    }),
  );
}

// ---- Section A: chronology (ordering) and treatment gaps ----

type EventKind = "ed" | "pcp" | "mri" | "ortho" | "ortho_fu" | "pt_eval" | "pt_dc" | "pain" | "neuro";

const PROVIDERS = {
  hospital: ["Harlow Valley Medical Center", "St. Ansel Regional Hospital", "Brookfen General Hospital"],
  radiology: ["Tallis Radiology Associates", "Penrose Imaging Physicians", "Corbel Radiology Group"],
  pcp: ["Juniper Street Family Medicine", "Fernbrook Primary Care", "Alder Row Family Clinic"],
  imaging: ["Northfield Open MRI", "Kestrel Diagnostic Imaging", "Bayline MRI Center"],
  ortho: ["Granite Peak Orthopedics", "Halvorsen Orthopedic Group", "Rook Hill Bone & Joint"],
  pt: ["Stride Forward Physical Therapy", "Cobalt Rehab & PT", "Ember Lane Physical Therapy"],
  pain: ["Quillon Pain & Spine", "Silverbirch Pain Management"],
  neuro: ["Marisett Neurology Associates", "Ostrova Neurology Clinic"],
} as const;
type ProviderRole = keyof typeof PROVIDERS;

const EVENTS: Record<EventKind, { role: ProviderRole; record: string; visit: string }> = {
  ed: { role: "hospital", record: "Emergency department records", visit: "Emergency department visit" },
  pcp: { role: "pcp", record: "Follow-up visit notes", visit: "Follow-up visit" },
  mri: { role: "imaging", record: "MRI report, lumbar spine", visit: "MRI, lumbar spine" },
  ortho: { role: "ortho", record: "Orthopedic consultation", visit: "Orthopedic consult" },
  ortho_fu: { role: "ortho", record: "Orthopedic follow-up notes", visit: "Orthopedic follow-up" },
  pt_eval: { role: "pt", record: "Physical therapy initial evaluation", visit: "Physical therapy evaluation" },
  pt_dc: { role: "pt", record: "Physical therapy discharge summary", visit: "Physical therapy discharge" },
  pain: { role: "pain", record: "Pain management consultation", visit: "Pain management consult" },
  neuro: { role: "neuro", record: "Neurology consultation", visit: "Neurology consult" },
};

/** Must come before: [earlier, later]. The ED visit is always first. */
const BEFORE: [EventKind, EventKind][] = [
  ["ortho", "ortho_fu"],
  ["pt_eval", "pt_dc"],
  ["ortho", "pt_eval"],
  ["mri", "ortho_fu"],
];

const PT_SESSIONS = 7;
const LOG_ROWS = 16;
const CHRON_ITEMS = 8;

const chronologyStep = {
  id: "chronology",
  type: ORDERING,
  seconds: 330,
  title: "Medical chronology",
  config: {
    prompt:
      "Put {{client}}'s medical records in order of date of service, earliest first. The records arrived in a different order: go by the date the treatment was given, not the date received.",
    items: Array.from({ length: CHRON_ITEMS }, (_, i) => ({ id: `r${i + 1}`, label: `{{ch_${i + 1}_label}}`, detail: `{{ch_${i + 1}_detail}}` })),
    positionPoints: 5,
    pairwisePoints: 5,
  },
};

const gapsStep = {
  id: "treatment-gaps",
  type: DOCUMENT_REVIEW,
  seconds: 270,
  title: "Treatment gaps",
  config: {
    prompt: [
      "The visit log is built from every provider's records. Before the demand goes out, {{partner_first}} wants every gap in treatment flagged, because the adjuster will argue the client got better during a gap.",
      "Flag each gap of more than 30 days between two accident-related visits (on the later visit), and any visit that isn't treatment for the accident, with the reason.",
    ].join("\n"),
    document: {
      title: "Visit log · {{client}}",
      fields: [
        { id: "client", label: "Client", value: "{{client}}" },
        { id: "dol", label: "Date of loss", value: "{{dol_short}}" },
      ],
      columns: ["Date", "Provider", "Visit"],
      rows: Array.from({ length: LOG_ROWS }, (_, i) => ({ id: `v${String(i + 1).padStart(2, "0")}`, cells: ["date", "provider", "visit"].map((c) => `{{lg_${i + 1}_${c}}}`) })),
      totals: [],
    },
    reasons: [
      { id: "gap", label: "Gap in treatment: more than 30 days since the last visit" },
      { id: "pre_loss", label: "Before the date of loss: not accident treatment" },
      { id: "duplicate", label: "Same visit listed twice" },
      { id: "other", label: "Other" },
    ],
    findings: [
      { id: "gap_1", label: "First gap over 30 days", points: 4 },
      { id: "gap_2", label: "Second gap over 30 days", points: 4 },
      { id: "pre_loss", label: "Visit before the date of loss", points: 2 },
    ],
    falseFlagPenalty: 1,
  },
};

// ---- Section B: specials worksheet ----

const INVOICE_ROWS = 10;
const SHEET_COLUMNS = ["Invoice", "Provider", "Date of service", "Description", "Billed", "Adjustment", "Plan paid", "Patient paid", "Source"];
const SHEET_CELLS = ["inv", "provider", "date", "desc", "billed", "adj", "plan", "patient", "source"];
const MONEY_CELLS = new Set(["billed", "adj", "plan", "patient"]);
const summaryRow = (label: string, input: string, points: number) => [
  null,
  { text: label, bold: true },
  null,
  null,
  { input, label, points, format: "money" as const },
  null,
  null,
  null,
  null,
];

const specialsStep = {
  id: "specials",
  type: SPREADSHEET,
  title: "Medical specials",
  config: {
    prompt: [
      "Work out the medical specials and the liens for the demand from the bills in the file.",
      "Calloway's collateral source rule (fictional state): the demand presents the full amount billed for treatment of the accident injuries, whatever the health plan paid or wrote off. Each bill counts once, and treatment that isn't for the accident stays out.",
      "The health plan ({{plan}}) is owed back what it paid on accident bills. Providers treating on a letter of protection are owed their unpaid balance (billed − adjustment − plan paid − patient paid) from the settlement. Out of pocket is what {{client_first}} paid on accident bills.",
    ].join("\n"),
    columns: SHEET_COLUMNS,
    rows: [
      ...Array.from({ length: INVOICE_ROWS }, (_, i) => SHEET_CELLS.map((c) => (MONEY_CELLS.has(c) ? { text: `{{bl_${i + 1}_${c}|money}}`, align: "right" as const } : `{{bl_${i + 1}_${c}}}`))),
      SHEET_COLUMNS.map(() => null),
      summaryRow("Medical specials (billed, accident-related, each bill once)", "specials", 6),
      summaryRow("Health plan lien (what the plan paid on accident bills)", "plan_lien", 4),
      summaryRow("Balances owed to providers on letters of protection", "lop", 4),
      summaryRow("Out of pocket (what the client paid on accident bills)", "oop", 4),
      summaryRow("Total liens (health plan lien + letter-of-protection balances)", "total_liens", 2),
    ],
  },
};

// ---- Section C: demand letter, then the inbox ----

const LETTER_ROWS = 6;

const demandStep = {
  id: "demand-review",
  type: DOCUMENT_REVIEW,
  seconds: 420,
  title: "Demand letter review",
  config: {
    prompt: [
      "{{partner_first}} asked you to check the draft demand to {{insurer}} against the file before it goes for signature. Flag each problem with the reason, then decide what to do with the draft.",
      "",
      "Bills in the file, by provider (accident-related, each bill once):",
      "{{bill_lines}}",
    ].join("\n"),
    document: {
      title: "Draft demand letter · {{client}} · policy limits demand",
      fields: [
        { id: "to", label: "To", value: "{{adjuster}}, Claims Adjuster, {{insurer}}" },
        { id: "claim", label: "Claim number", value: "{{claim_no}}" },
        { id: "insured", label: "Your insured", value: "{{defendant}}" },
        { id: "client", label: "Our client", value: "{{client}}" },
        { id: "dol", label: "Date of loss", value: "{{letter_dol}}" },
        { id: "location", label: "Location", value: "{{location}}" },
        { id: "enclosures", label: "Enclosures", value: "Records and bills from: {{enclosures}}" },
      ],
      columns: ["Provider", "Dates of treatment", "Billed"],
      rows: Array.from({ length: LETTER_ROWS }, (_, i) => ({ id: `p${i + 1}`, cells: [`{{lt_${i + 1}_provider}}`, `{{lt_${i + 1}_dates}}`, `{{lt_${i + 1}_billed|money}}`] })),
      totals: [
        { id: "specials_total", label: "Total medical specials", value: "{{letter_total|money}}" },
        { id: "wages", label: "Lost wages ({{wage_weeks}} weeks at {{weekly|money}} a week)", value: "{{wages|money}}" },
        { id: "demand", label: "Demand: the policy limits", value: "{{limits|money}}" },
      ],
      footnote: "Signature block: {{partner}}, {{firm}}",
    },
    reasons: [
      { id: "wrong_date", label: "Wrong date" },
      { id: "math", label: "Total doesn't match the bills" },
      { id: "missing", label: "Provider or bill missing" },
      { id: "amount", label: "Amount doesn't match the bill" },
      { id: "party", label: "Wrong name or party" },
      { id: "other", label: "Other" },
    ],
    findings: [
      { id: "dol", label: "Wrong date of loss", points: 5 },
      { id: "total", label: "Specials total doesn't add up", points: 5 },
      { id: "missing_provider", label: "Provider left out", points: 5 },
    ],
    falseFlagPenalty: 1,
    decision: {
      prompt: "What do you do with the draft?",
      options: [
        { id: "send", label: "Send it to the adjuster today: the deadline in the policy-limits demand is what matters" },
        { id: "fix_send", label: "Fix the problems myself, sign it for {{partner_first}} and send it" },
        { id: "hold", label: "Hold it: send {{partner_first}} the list of problems and a corrected draft for review and signature" },
        { id: "send_no_bills", label: "Send the letter now and the bills later" },
      ],
      points: 3,
    },
  },
};

const conflictStep = {
  id: "inbox-conflict",
  type: MULTIPLE_CHOICE,
  seconds: 120,
  title: "Conflicts check",
  config: { prompt: "The conflicts search came back with a hit. What do you do?", options: letterOptions("cf"), select: "single", points: 6 },
};

const valueStep = {
  id: "inbox-value",
  type: MULTIPLE_CHOICE,
  seconds: 120,
  title: "Email from the client",
  config: { prompt: "{{client_first}} asks what the case is worth. What do you do?", options: letterOptions("cv"), select: "single", points: 6 },
};

// ---- The scenario ----

const INSURERS = ["Granite Shore Mutual", "Bluehaven Casualty Co.", "Northwind Indemnity", "Larchmont Auto Insurance Co.", "Tern Harbor Insurance", "Copperline Casualty"];
const PLANS = ["Calloway Valley Health Plan", "Meridel Health Partners", "Stonecrest Health Plan"];
const LOCATIONS = ["Route 9 at Elm Street, Port Ellery", "Harbor Boulevard and 3rd Avenue, Ashcombe", "the I-14 on-ramp at Mill Road, Kingsferry", "Westbrook Drive near Carrow Bay Mall"];

/** A random topological order of the events after the ED visit. */
function treatmentOrder(rng: Rng, events: EventKind[]): EventKind[] {
  const left = new Set<EventKind>(events.filter((e) => e !== "ed"));
  const out: EventKind[] = ["ed"];
  while (left.size) {
    const ready = [...left].filter((e) => !BEFORE.some(([a, b]) => b === e && left.has(a)));
    const next = rng.pick(ready);
    out.push(next);
    left.delete(next);
  }
  return out;
}

interface Visit {
  kind: EventKind | "pt" | "pre";
  date: IsoDate;
}

export const piDiazDemand = defineScenario({
  slug: "pi-diaz-demand",
  version: 1,
  title: "Diaz intake to demand: personal injury paralegal",
  roleFamily: "legal",
  timeLimitMinutes: 50,
  definition: {
    intro:
      "You're a personal injury paralegal at {{firm}}, working for {{partner}}, on the file of {{client}}, who was hurt in a car crash in the State of Calloway. The work comes in six timed parts, 50 minutes in all: three rapid rounds of quick items (limitations and damages, medical billing, intake and ethics), a medical chronology with a check for treatment gaps, the medical specials, and the demand letter with your inbox. A finished part can't be reopened. Calloway, its rules, and every person, provider and company are fictional.",
    steps: [limitationsStep, chronologyStep, gapsStep, billingStep, specialsStep, intakeStep, demandStep, conflictStep, valueStep],
    messages: [
      {
        id: "m1",
        from: "Your supervising attorney",
        subject: "Diaz: intake summary and records",
        body: [
          "Hi {{first_name}},",
          "",
          "Here's the intake summary for our new client. The records have come in, in no particular order; please put them in date-of-service order and check the visit log for gaps.",
          "",
          "Client: {{client}}",
          "Date of loss: {{dol_long}}",
          "Location: {{location}}",
          "At-fault driver: {{defendant}}, insured by {{insurer}} (claim {{claim_no}})",
          "Client's health plan: {{plan}}",
          "Work: missed {{wage_weeks}} weeks at {{weekly|money}} a week",
          "",
          "{{partner}}",
        ].join("\n"),
        arriveAtMinute: 0,
        stepId: "chronology",
      },
      {
        id: "m2",
        from: "Your supervising attorney",
        subject: "Diaz: specials and liens",
        body: [
          "Hi {{first_name}},",
          "",
          "All the bills and the health plan's EOBs are in. Some came in twice, from the provider and from the plan, and one provider sent a bill from before the crash. Please work out the specials and the liens on the worksheet.",
          "",
          "{{partner}}",
        ].join("\n"),
        arriveAtMinute: 0,
        stepId: "specials",
      },
      {
        id: "m3",
        from: "Your supervising attorney",
        subject: "Diaz: draft demand",
        body: [
          "Hi {{first_name}},",
          "",
          "A first draft of the demand to {{insurer}} is ready. Please check it against the file before I sign it.",
          "",
          "{{partner}}",
        ].join("\n"),
        arriveAtMinute: 0,
        stepId: "demand-review",
      },
      {
        id: "m4",
        from: "Conflicts coordinator",
        subject: "Conflicts check: Diaz matter",
        body: [
          "Hi {{first_name}},",
          "",
          "The conflicts search on the Diaz matter came back with one hit. {{insurer}}, which insures {{defendant}} and would pay any settlement, is a current client of the firm: our insurance defense group represents it in other cases.",
          "",
          "{{coordinator}}",
        ].join("\n"),
        arriveAtMinute: 0,
        stepId: "inbox-conflict",
      },
      {
        id: "m5",
        from: "Client",
        subject: "What is my case worth?",
        body: [
          "Hi {{first_name}},",
          "",
          "My cousin got {{cousin|money}} for a crash like mine. What do you think my case is worth? Just a ballpark, I won't hold you to it.",
          "",
          "{{client}}",
        ].join("\n"),
        arriveAtMinute: 0,
        stepId: "inbox-value",
      },
    ],
    sections: [
      { id: "s-rapid-a", title: "Rapid round: limitations and damages", minutes: 6, stepIds: ["rapid-limitations"] },
      { id: "s-chronology", title: "Medical chronology and gaps", minutes: 10, stepIds: ["chronology", "treatment-gaps"], oneAtATime: true },
      { id: "s-rapid-b", title: "Rapid round: medical billing", minutes: 6, stepIds: ["rapid-billing"] },
      { id: "s-specials", title: "Medical specials", minutes: 11, stepIds: ["specials"] },
      { id: "s-rapid-c", title: "Rapid round: intake and ethics", minutes: 6, stepIds: ["rapid-intake"] },
      { id: "s-demand", title: "Demand letter and inbox", minutes: 11, stepIds: ["demand-review", "inbox-conflict", "inbox-value"], oneAtATime: true },
    ],
  },

  build(rng) {
    const v: Values = {};
    const firm = rng.pick(LAW_FIRMS);
    const [pPartner, pDefendant, pAdjuster, pCoordinator] = distinctPeople(rng, 4);
    const clientFirst = rng.pick(FIRST_NAMES.filter((f) => ![pPartner, pDefendant, pAdjuster, pCoordinator].some((p) => p.first === f)));
    const client = `${clientFirst} Diaz`;
    const insurer = rng.pick(INSURERS);
    const plan = rng.pick(PLANS);
    const providers = Object.fromEntries((Object.keys(PROVIDERS) as ProviderRole[]).map((r) => [r, rng.pick(PROVIDERS[r])])) as Record<ProviderRole, string>;
    const dol = dateBetween(rng, "2026-01-12", "2026-05-29");
    const weekly = rng.int(28, 95) * 2_500;
    const wageWeeks = rng.int(3, 14);
    Object.assign(v, {
      firm: firm.name,
      partner: pPartner.full,
      partner_first: pPartner.first,
      client,
      client_first: clientFirst,
      defendant: pDefendant.full,
      adjuster: pAdjuster.full,
      coordinator: pCoordinator.full,
      insurer,
      plan,
      location: rng.pick(LOCATIONS),
      claim_no: `${rng.pick(["GS", "BH", "NW", "LA", "TH", "CC"])}-${rng.int(10, 99)}-${String.fromCharCode(65 + rng.int(0, 25))}${String.fromCharCode(65 + rng.int(0, 25))}${rng.int(100, 999)}`,
      dol_long: formatDate(dol, "long"),
      dol_short: formatDate(dol),
      weekly,
      wage_weeks: String(wageWeeks),
      wages: weekly * wageWeeks,
      limits: rng.pick([25_000, 50_000, 100_000, 250_000]) * 100,
      cousin: rng.int(30, 400) * 250_000,
    });
    const ctx: Ctx = { client, clientFirst, insurer };

    // ---- Section A: the course of treatment ----
    const extra: EventKind = rng.pick(["pain", "neuro"] as const);
    const events: EventKind[] = ["ed", "pcp", "mri", "ortho", "ortho_fu", "pt_eval", "pt_dc", extra];
    let visits: Visit[] = [];
    let gapAt: number[] = [];
    for (let tries = 0; ; tries++) {
      if (tries > 2_000) throw new Error("pi-diaz-demand: no treatment timeline");
      const order = treatmentOrder(rng, events);
      // PT sessions sit between the evaluation and the discharge.
      const evalAt = order.indexOf("pt_eval");
      const merged: Visit["kind"][] = [...order];
      for (let s = 0; s < PT_SESSIONS; s++) {
        const dcAt = merged.indexOf("pt_dc");
        merged.splice(rng.int(evalAt + 1, dcAt), 0, "pt");
      }
      // Spans between consecutive visits: two gaps over 30 days, one near miss (24–30), the rest short.
      const spans = merged.length - 1;
      const picks = rng.shuffle(Array.from({ length: spans }, (_, i) => i)).slice(0, 3);
      const [g1, g2, near] = picks;
      // Neither gap starts at the ED visit, and no two of the three spans share a visit.
      if (g1 === 0 || g2 === 0 || Math.abs(g1 - g2) < 2 || Math.abs(g1 - near) < 2 || Math.abs(g2 - near) < 2) continue;
      const steps = Array.from({ length: spans }, (_, i) => (i === g1 || i === g2 ? rng.int(34, 75) : i === near ? rng.pick([24, 26, 28, 29, 30, 30, 30]) : rng.int(3, 17)));
      let d = dol;
      visits = merged.map((kind, i) => {
        if (i > 0) d = addDays(d, steps[i - 1]);
        return { kind, date: d };
      });
      if (visits[visits.length - 1].date > "2026-12-31") continue;
      gapAt = [g1, g2].sort((a, b) => a - b).map((s) => s + 1); // index (in visits) of the visit after each gap
      break;
    }
    const pre: Visit = { kind: "pre", date: addDays(dol, -rng.int(60, 240)) };
    const log = [pre, ...visits];
    if (log.length !== LOG_ROWS) throw new Error("pi-diaz-demand: visit log size");
    const logId = (i: number) => `v${String(i + 1).padStart(2, "0")}`;
    const visitProvider = (k: Visit["kind"]) => (k === "pt" ? providers.pt : k === "pre" ? providers.pcp : providers[EVENTS[k].role]);
    const visitLabel = (k: Visit["kind"]) => (k === "pt" ? "Physical therapy session" : k === "pre" ? "Annual physical" : EVENTS[k].visit);
    log.forEach((x, i) => {
      Object.assign(v, { [`lg_${i + 1}_date`]: formatDate(x.date), [`lg_${i + 1}_provider`]: visitProvider(x.kind), [`lg_${i + 1}_visit`]: visitLabel(x.kind) });
    });
    const dateOf = (k: EventKind) => visits.find((x) => x.kind === k)!.date;

    // Chronology: the eight record sets, shown in a shuffled order, received in another.
    const lastService = visits[visits.length - 1].date;
    let shown: EventKind[];
    let received: IsoDate[];
    const byService = [...events].sort((a, b) => dateOf(a).localeCompare(dateOf(b)));
    for (;;) {
      shown = rng.shuffle(events);
      const days = pickDistinct(rng, Array.from({ length: 50 }, (_, i) => i + 5), CHRON_ITEMS);
      received = days.map((n) => addDays(lastService, n));
      const receivedOrder = [...shown].map((k, i) => ({ k, r: received[i] })).sort((a, b) => a.r.localeCompare(b.r)).map((x) => x.k);
      if (shown.join() !== byService.join() && receivedOrder.join() !== byService.join()) break;
    }
    shown.forEach((k, i) => {
      const style = rng.pick(["short", "long", "numeric"] as const);
      Object.assign(v, {
        [`ch_${i + 1}_label`]: `${providers[EVENTS[k].role]} · ${EVENTS[k].record}`,
        [`ch_${i + 1}_detail`]: `Received ${formatDate(received[i])} · Date of service ${formatDate(dateOf(k), style)}`,
      });
    });
    const chronologyKey = byService.map((k) => `r${shown.indexOf(k) + 1}`);

    // ---- Section B: invoices ----
    type Invoice = { inv: string; role: ProviderRole; date: IsoDate; desc: string; billed: number; adj: number; plan: number; patient: number; related: boolean };
    const lopRoles = pickDistinct(rng, ["imaging", "ortho", "pt", extra] as ProviderRole[], 2);
    const usedNos = new Set<number>();
    const invNo = (code: string) => {
      let no: number;
      // Never a multiple of 100, so an invoice number can't read like a whole-dollar amount in cents.
      do no = rng.int(1_000, 9_899);
      while (usedNos.has(no) || no % 100 === 0);
      usedNos.add(no);
      return `${code}-${no}`;
    };
    const codeOf = (role: ProviderRole) => role.slice(0, 2).toUpperCase();
    const ptVisits = visits.filter((x) => x.kind === "pt" || x.kind === "pt_eval" || x.kind === "pt_dc").length;
    const specs: { role: ProviderRole; date: IsoDate; desc: string; range: [number, number] }[] = [
      { role: "hospital", date: dol, desc: "Emergency department visit", range: [3_500, 14_000] },
      { role: "radiology", date: dol, desc: "X-ray reading, emergency department", range: [180, 900] },
      { role: "pcp", date: dateOf("pcp"), desc: "Follow-up visit", range: [180, 450] },
      { role: "imaging", date: dateOf("mri"), desc: "MRI, lumbar spine", range: [1_800, 4_500] },
      { role: "ortho", date: dateOf("ortho"), desc: "Orthopedic consultation", range: [350, 900] },
      { role: "ortho", date: dateOf("ortho_fu"), desc: "Orthopedic follow-up", range: [180, 450] },
      { role: "pt", date: dateOf("pt_eval"), desc: `Physical therapy, ${ptVisits} visits (evaluation to discharge)`, range: [2_200, 6_500] },
      { role: extra, date: dateOf(extra), desc: EVENTS[extra].visit, range: [400, 1_200] },
    ];
    const related: Invoice[] = specs.map((s) => {
      const billed = rng.cents(s.range[0], s.range[1]);
      if (lopRoles.includes(s.role)) {
        const patient = rng.int(0, 3) === 0 ? Math.min(rng.int(2, 12) * 2_500, Math.floor(billed / 5_000) * 2_500) : 0;
        return { inv: invNo(codeOf(s.role)), role: s.role, date: s.date, desc: s.desc, billed, adj: 0, plan: 0, patient, related: true };
      }
      const adj = Math.round((billed * rng.int(20, 45)) / 100);
      const patient = rng.pick([0, 2_500, 4_000, 5_000, 7_500]);
      return { inv: invNo(codeOf(s.role)), role: s.role, date: s.date, desc: s.desc, billed, adj, plan: billed - adj - patient, patient, related: true };
    });
    // The duplicate: a plan-paid bill with no copay, listed again from the plan's EOB.
    const dupOf = rng.pick(related.filter((x) => !lopRoles.includes(x.role)));
    dupOf.plan += dupOf.patient;
    dupOf.patient = 0;
    const preBill = rng.cents(220, 480);
    const preInvoice: Invoice = { inv: invNo(codeOf("pcp")), role: "pcp", date: pre.date, desc: "Annual physical", billed: preBill, adj: 0, plan: 0, patient: preBill, related: false };
    const rowsB = [...related.map((x) => ({ x, source: x === dupOf ? "Provider statement" : rng.pick(["Provider statement", "Health plan EOB"]) })), { x: dupOf, source: "Health plan EOB" }, { x: preInvoice, source: "Provider statement" }].sort(
      (a, b) => a.x.date.localeCompare(b.x.date) || a.x.inv.localeCompare(b.x.inv) || a.source.localeCompare(b.source),
    );
    rowsB.forEach(({ x, source }, i) => {
      Object.assign(v, {
        [`bl_${i + 1}_inv`]: x.inv,
        [`bl_${i + 1}_provider`]: providers[x.role],
        [`bl_${i + 1}_date`]: formatDate(x.date),
        [`bl_${i + 1}_desc`]: x.desc,
        [`bl_${i + 1}_billed`]: x.billed,
        [`bl_${i + 1}_adj`]: x.adj,
        [`bl_${i + 1}_plan`]: x.plan,
        [`bl_${i + 1}_patient`]: x.patient,
        [`bl_${i + 1}_source`]: source,
      });
    });
    const sum = (f: (x: Invoice) => number) => related.reduce((t, x) => t + f(x), 0);
    const specials = sum((x) => x.billed);
    const planLien = sum((x) => x.plan);
    const lop = sum((x) => x.billed - x.adj - x.plan - x.patient);
    const oop = sum((x) => x.patient);

    // ---- Section C: the demand letter ----
    const roles: ProviderRole[] = ["hospital", "radiology", "pcp", "imaging", "ortho", "pt", extra];
    const byRole = roles.map((role) => {
      const bills = related.filter((x) => x.role === role);
      const dates = [...new Set(bills.map((x) => x.date))].sort();
      const span =
        role === "pt" ? [dateOf("pt_eval"), dateOf("pt_dc")] : dates.length > 1 ? [dates[0], dates[dates.length - 1]] : [dates[0]];
      return { role, provider: providers[role], billed: bills.reduce((t, x) => t + x.billed, 0), dates: span.map((d) => formatDate(d)).join(" – ") };
    });
    let missing: (typeof byRole)[number];
    do missing = rng.pick(byRole);
    while (missing.billed === dupOf.billed);
    const listed = byRole.filter((r) => r !== missing);
    const listedSum = listed.reduce((t, r) => t + r.billed, 0);
    const letterTotal = listedSum + dupOf.billed; // the duplicate bill counted twice
    let letterDol: IsoDate;
    do letterDol = addDays(dol, rng.pick([-1, 1]) * rng.int(1, 9));
    while (letterDol === dol);
    listed.forEach((r, i) => Object.assign(v, { [`lt_${i + 1}_provider`]: r.provider, [`lt_${i + 1}_dates`]: r.dates, [`lt_${i + 1}_billed`]: r.billed }));
    Object.assign(v, {
      bill_lines: byRole.map((r) => `• ${r.provider}: ${usd(r.billed)}`).join("\n"),
      enclosures: listed.map((r) => r.provider).join("; "),
      letter_dol: formatDate(letterDol, "long"),
      letter_total: letterTotal,
    });

    // ---- Section C: inbox ----
    const cf = placeOptions(rng, `Stop and take the conflict to ${pPartner.full} before any more work on the demand: a lawyer decides whether the firm can act against a current client, and with whose consent`, [
      `Nothing: ${insurer} isn't a named party, so there is no conflict`,
      "Send the demand, and give the insurance defense group a copy so they're in the loop",
      `Call ${insurer}'s claims manager and ask whether it minds`,
    ]);
    const cv = placeOptions(rng, `Tell ${clientFirst} you can't give a value, since that's legal advice only a lawyer can give, and set up a call with ${pPartner.full}`, [
      "Give a ballpark of three times the medical bills, saying it isn't a promise",
      "Say the cousin's amount sounds about right for a crash like this",
      "Say the policy limits are what the case will settle for",
    ]);
    LETTERS.forEach((l, j) => {
      v[`cf_${l}`] = cf.labels[j];
      v[`cv_${l}`] = cv.labels[j];
    });

    // ---- Rapid rounds, drawn last so the rest of the material doesn't shift when they change ----
    const rapidKeys = {
      "rapid-limitations": { items: buildLimitations(rng, v, clientFirst) },
      "rapid-billing": { items: buildChoiceRound(rng, v, "mb", BILLING_EASY, BILLING_HARD, ctx) },
      "rapid-intake": { items: buildChoiceRound(rng, v, "ie", INTAKE_EASY, INTAKE_HARD, ctx) },
    };

    const gapNote = (at: number) => {
      const [a, b] = [log[at], log[at + 1]]; // log is shifted by the pre-loss visit
      return `${daysBetween(a.date, b.date)} days with no treatment between ${formatDate(a.date)} (${visitLabel(a.kind)}) and ${formatDate(b.date)} (${visitLabel(b.kind)}).`;
    };
    const dollars = (c: number) => ({ value: c / 100 });
    return {
      values: v,
      keys: {
        ...rapidKeys,
        chronology: { order: chronologyKey },
        "treatment-gaps": {
          findings: {
            gap_1: { targets: [logId(gapAt[0] + 1), logId(gapAt[0])], reasons: ["gap"], note: gapNote(gapAt[0]) },
            gap_2: { targets: [logId(gapAt[1] + 1), logId(gapAt[1])], reasons: ["gap"], note: gapNote(gapAt[1]) },
            pre_loss: {
              targets: [logId(0)],
              reasons: ["pre_loss"],
              note: `The annual physical on ${formatDate(pre.date)} is before the ${formatDate(dol)} crash, so it isn't accident treatment.`,
            },
          },
        },
        specials: {
          tolerance: 0.005,
          cells: {
            specials: dollars(specials),
            plan_lien: dollars(planLien),
            lop: dollars(lop),
            oop: dollars(oop),
            total_liens: dollars(planLien + lop),
          },
        },
        "demand-review": {
          findings: {
            dol: { targets: ["dol"], reasons: ["wrong_date"], note: `The intake and the records put the crash on ${formatDate(dol, "long")}; the draft says ${formatDate(letterDol, "long")}.` },
            total: {
              targets: ["specials_total"],
              reasons: ["math"],
              note: `The listed bills add up to ${usd(listedSum)}, not ${usd(letterTotal)}: invoice ${dupOf.inv} was counted twice.`,
            },
            missing_provider: {
              targets: ["enclosures"],
              reasons: ["missing"],
              note: `${missing.provider} (${usd(missing.billed)} billed) is left out of the letter and the enclosures.`,
            },
          },
          decision: ["hold"],
        },
        "inbox-conflict": { correct: [cf.letter] },
        "inbox-value": { correct: [cv.letter] },
      },
    };
  },
});
