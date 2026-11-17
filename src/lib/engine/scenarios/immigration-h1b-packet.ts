import "server-only";

import type { Rng } from "../server/rng";
import { defineScenario } from "../server/scenario";
import { DOCUMENT_REVIEW } from "../step-types/document_review/public";
import { MULTIPLE_CHOICE } from "../step-types/multiple_choice/public";
import { RAPID_ROUND } from "../step-types/rapid_round/public";
import {
  FIRST_NAMES,
  LAST_NAMES,
  LAW_FIRMS,
  addDays,
  courtDaysAfter,
  daysBetween,
  distinctPeople,
  formatDate,
  holidaysBetween,
  isCourtDay,
  isWeekend,
  nextCourtDay,
  pickDistinct,
  previousCourtDay,
  type IsoDate,
  type PersonName,
} from "./legal";

/**
 * Immigration paralegal at a law firm: an H-1B extension of stay for a
 * worker at a (fictional) employer. Six timed sections, 50 minutes, 100
 * points, all scored automatically:
 *
 *   rapid round A, status and date math (10) → forms cross-check: petition vs
 *   passport, job letter and wage attestation (20) → rapid round B, document
 *   and process terms (10) → filing packet checklist (20) → rapid round C,
 *   deadlines (10) → inbox, one screen at a time: organizing an RFE response
 *   (12), an employer asking for a backdated letter (10), the beneficiary
 *   asking for advice (8).
 *
 * The agency, its forms (Form P-129, Form WA-9035, Form A-28, the AR-94
 * arrival record, N-797 notices) and the rules stated in the exhibits are
 * fictional, modelled on the real process. Seeded per candidate: every name,
 * employer, date, wage and fee tier; which detail or tab carries which trap;
 * and where the right option sits. Business days use the shared federal
 * holiday calendar (./legal/dates.ts).
 *
 * Rapid rounds: 15 items × 20 s. Items 3, 6, 9, 12, 15 are the harder kinds,
 * worth 1; the other ten are worth ½, so each round is exactly 10.
 *
 * Draft v1: team self-review pending (docs/paralegal/immigration-h1b-packet.md).
 */

const LETTERS = ["a", "b", "c", "d"] as const;
const EMPLOYERS = [
  "Brackenridge Analytics, Inc.",
  "Fernhollow Medical Devices, LLC",
  "Quaystone Software, Inc.",
  "Larkmoor Engineering Group, Inc.",
  "Tidemark Bioinformatics, Inc.",
  "Coldharbour Robotics, LLC",
  "Westvale Energy Systems, Inc.",
];
const EVALUATORS = ["Meridian Credential Review", "Northlake Academic Evaluations", "Brightpath Degree Services"];
/** Country of citizenship and the language its documents are in. */
const COUNTRIES: [string, string][] = [
  ["Brazil", "Portuguese"],
  ["Mexico", "Spanish"],
  ["France", "French"],
  ["Germany", "German"],
  ["Japan", "Japanese"],
  ["Vietnam", "Vietnamese"],
  ["Turkey", "Turkish"],
  ["Italy", "Italian"],
];
const JOB_TITLES = [
  "Software Engineer",
  "Data Analyst",
  "Mechanical Engineer",
  "Financial Analyst",
  "Biostatistician",
  "Systems Architect",
  "Industrial Designer",
  "Market Research Analyst",
];
const LEVELS = ["Level I", "Level II", "Level III", "Level IV"];
const CITIES = ["Ashcombe", "New Harlow", "Kingsferry", "Port Ellery", "Dunmore Falls", "Carrow Bay", "Millhaven", "Westbrook Junction"];
const STREETS = ["Linden Row", "Harbor Street", "Quarry Lane", "Foundry Avenue", "Mill Road", "Bellwether Drive", "Granite Way", "Orchard Court"];
const HOURS = "Full-time, 40 hours a week";

type Values = Record<string, string>;
type ChoiceKey = Record<string, { choice: string } | { value: number; tolerance: number }>;

// ---- Rapid round plumbing ----

const RAPID_ITEMS = 15;
/** Items 3, 6, 9, 12 and 15 are worth 1; the rest ½. 10 points a round. */
const isHardSlot = (i: number) => i % 3 === 2;
const slotNo = (i: number) => String(i + 1).padStart(2, "0");

function fillSlots<T>(easy: T[], hard: T[]): T[] {
  const e = [...easy];
  const h = [...hard];
  const out = Array.from({ length: RAPID_ITEMS }, (_, i) => (isHardSlot(i) ? h.shift() : e.shift()));
  if (out.some((x) => x === undefined) || e.length || h.length) throw new Error("immigration-h1b-packet: rapid slots don't fill");
  return out as T[];
}

function rapidItems(prefix: string, item: (n: string, i: number) => object) {
  return Array.from({ length: RAPID_ITEMS }, (_, i) => ({ id: `${prefix}-${slotNo(i)}`, ...item(slotNo(i), i), points: isHardSlot(i) ? 1 : 0.5 }));
}

const letterOptions = (name: string) => LETTERS.map((l) => ({ id: l, label: `{{${name}_${l}}}` }));

/** Puts `right` among `wrong` in a random place; returns the labels by letter and the right letter. */
function placeOptions(rng: Rng, right: string, wrong: string[]): { labels: string[]; letter: string } {
  if (wrong.length !== 3 || new Set([right, ...wrong]).size !== 4) throw new Error(`immigration-h1b-packet: options must be 4 different labels (${right})`);
  const labels = rng.shuffle([right, ...wrong]);
  return { labels, letter: LETTERS[labels.indexOf(right)] };
}

/** Four date options: the right one and the three most tempting different wrong ones. */
function dateOptions(rng: Rng, right: IsoDate, tempting: IsoDate[]) {
  const wrong = [...new Set(tempting)].filter((d) => d !== right);
  for (let k = 1; wrong.length < 3; k++) for (const d of [addDays(right, 7 * k), addDays(right, -7 * k)]) if (!wrong.includes(d)) wrong.push(d);
  return placeOptions(
    rng,
    formatDate(right),
    wrong.slice(0, 3).map((d) => formatDate(d)),
  );
}

// ---- Dates ----

const dateBetween = (rng: Rng, from: IsoDate, to: IsoDate) => addDays(from, rng.int(0, daysBetween(from, to)));
/** A date on day 1–28 of its month, so month arithmetic is unambiguous. */
function date28(rng: Rng, from: IsoDate, to: IsoDate): IsoDate {
  for (;;) {
    const d = dateBetween(rng, from, to);
    if (Number(d.slice(8)) <= 28) return d;
  }
}
function courtDayBetween(rng: Rng, from: IsoDate, to: IsoDate): IsoDate {
  for (;;) {
    const d = dateBetween(rng, from, to);
    if (isCourtDay(d)) return d;
  }
}
/** Same day of the month, `n` months later (negative for earlier). Days 1–28 only. */
function addMonths(date: IsoDate, n: number): IsoDate {
  const [y, m, d] = date.split("-").map(Number);
  if (d > 28) throw new Error(`immigration-h1b-packet: month math on day ${d}`);
  return new Date(Date.UTC(y, m - 1 + n, d)).toISOString().slice(0, 10);
}
function courtDaysBefore(date: IsoDate, n: number): IsoDate {
  let d = date;
  for (let left = n; left > 0; ) {
    d = addDays(d, -1);
    if (isCourtDay(d)) left--;
  }
  return d;
}
const MON = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
/** "03/07/1994": the petition form's style, month first. */
const usDate = (d: IsoDate) => `${d.slice(5, 7)}/${d.slice(8)}/${d.slice(0, 4)}`;
/** "07 MAR 1994": the passport's style, day first. */
const passportDate = (d: IsoDate) => `${d.slice(8)} ${MON[Number(d.slice(5, 7)) - 1]} ${d.slice(0, 4)}`;
/** The same date with day and month swapped when that's another real date, else a year off. */
function misreadDate(rng: Rng, d: IsoDate): IsoDate {
  const [y, m, day] = d.split("-").map(Number);
  if (day <= 12 && day !== m) return `${y}-${String(day).padStart(2, "0")}-${String(m).padStart(2, "0")}`;
  return `${y + rng.pick([-1, 1])}-${d.slice(5)}`;
}
const money = (n: number) => `$${n.toLocaleString("en-US")}`;

// ---- Rapid round A: status and date math ----

const SD_RULES = {
  filing: "A petition may be filed no earlier than 6 months before the requested start date (same day of the month).",
  admit: "The arrival record runs to 10 days after the approved end date, but never past the passport's expiry date.",
  grace: "After the last day of employment, status continues for 60 days or until the arrival record ends, whichever comes first.",
  ext: "Firm practice: file an extension no later than 45 days before the arrival record ends.",
  max: "The six-year limit ends 6 years after the first H-1B start date (same day of the month), plus one day for each full day spent outside the country.",
  years: "Extensions are approved in whole years, up to 3 years at a time, and never past the six-year limit.",
  recapture: "Recapture counts full days outside the country: neither the departure day nor the return day counts.",
};

type StatusKind = "filing" | "admit" | "grace" | "ext" | "admit_passport" | "grace_capped" | "max" | "years" | "recapture";
const SD_EASY: StatusKind[] = ["filing", "filing", "filing", "admit", "admit", "admit", "grace", "grace", "ext", "ext"];
const SD_HARD: StatusKind[] = ["admit_passport", "grace_capped", "max"];
/** Slots 6 and 12 ask for a number; the other hard slots are date choices. */
const SD_NUMBER_SLOTS = new Set([5, 11]);

const rapidStatusStep = {
  id: "rapid-status",
  type: RAPID_ROUND,
  title: "Rapid round: status and date math",
  config: {
    intro: [
      "Status and date math: 15 items, 20 seconds each. Each item states the rule to apply; pick the date, or type the number.",
      "The rules are the firm's working rules for this exercise, modelled on the real process.",
    ].join("\n"),
    secondsPerItem: 20,
    items: rapidItems("sd", (n, i) => ({
      prompt: `{{sd_${n}}}`,
      exhibit: {
        title: "Case facts",
        rows: [
          { label: "Rule", value: `{{sd_${n}_rule}}` },
          { label: `{{sd_${n}_l1}}`, value: `{{sd_${n}_v1}}` },
          { label: `{{sd_${n}_l2}}`, value: `{{sd_${n}_v2}}` },
        ],
      },
      fields: SD_NUMBER_SLOTS.has(i)
        ? [{ id: "answer", label: "Answer", kind: "number", decimals: 0 }]
        : [{ id: "answer", label: "Answer", kind: "choice", options: letterOptions(`sd_${n}`) }],
    })),
  },
};

function buildStatus(rng: Rng, v: Values): Record<string, ChoiceKey> {
  const kinds = fillSlots(rng.shuffle(SD_EASY), [...rng.shuffle(SD_HARD), ...rng.shuffle<StatusKind>(["years", "recapture"])]);
  // fillSlots hands the hard list out in slot order (2, 5, 8, 11, 14); put the numbers at 5 and 11.
  const hardChoice = kinds.filter((k, i) => isHardSlot(i) && k !== "years" && k !== "recapture");
  const numbers = kinds.filter((k) => k === "years" || k === "recapture");
  const ordered = kinds.map((k, i) => (!isHardSlot(i) ? k : SD_NUMBER_SLOTS.has(i) ? numbers.shift()! : hardChoice.shift()!));
  return Object.fromEntries(
    ordered.map((kind, i) => {
      const n = slotNo(i);
      const set = (prompt: string, rule: string, l1: string, v1: string, l2: string, v2: string) =>
        Object.assign(v, { [`sd_${n}`]: prompt, [`sd_${n}_rule`]: rule, [`sd_${n}_l1`]: l1, [`sd_${n}_v1`]: v1, [`sd_${n}_l2`]: l2, [`sd_${n}_v2`]: v2 });
      const choose = (right: IsoDate, tempting: IsoDate[]) => {
        const { labels, letter } = dateOptions(rng, right, tempting);
        LETTERS.forEach((l, j) => (v[`sd_${n}_${l}`] = labels[j]));
        return [`sd-${n}`, { answer: { choice: letter } }] as const;
      };
      switch (kind) {
        case "filing": {
          const start = date28(rng, "2026-03-01", "2031-12-28");
          const right = addMonths(start, -6);
          set("What is the earliest date the petition can be filed?", SD_RULES.filing, "Requested start date", formatDate(start), "Packet ready", formatDate(addDays(right, -rng.int(10, 60))));
          return choose(right, [addDays(start, -180), addMonths(start, -3), addDays(right, -1), addMonths(start, -5)]);
        }
        case "admit":
        case "admit_passport": {
          const end = dateBetween(rng, "2026-06-01", "2031-12-31");
          const passport = kind === "admit" ? addDays(end, rng.int(120, 2000)) : addDays(end, rng.int(-200, 9));
          const right = kind === "admit" ? addDays(end, 10) : passport;
          set("Until what date does the arrival record run?", SD_RULES.admit, "Approved end date", formatDate(end), "Passport expires", formatDate(passport));
          return choose(right, kind === "admit" ? [end, addDays(end, 60), passport, addDays(end, 30)] : [addDays(end, 10), end, addDays(passport, 10), addDays(passport, -10)]);
        }
        case "grace":
        case "grace_capped": {
          const last = dateBetween(rng, "2026-03-01", "2031-12-31");
          const record = kind === "grace" ? addDays(last, rng.int(75, 700)) : addDays(last, rng.int(5, 55));
          const right = kind === "grace" ? addDays(last, 60) : record;
          set("What is the last day of the grace period?", SD_RULES.grace, "Last day of employment", formatDate(last), "Arrival record ends", formatDate(record));
          return choose(right, kind === "grace" ? [addDays(last, 59), addDays(last, 30), record, addDays(last, 90)] : [addDays(last, 60), addDays(record, 60), last, addDays(record, -10)]);
        }
        case "ext": {
          const record = dateBetween(rng, "2026-06-01", "2031-12-31");
          const right = addDays(record, -45);
          set("What is the last day the firm files the extension?", SD_RULES.ext, "Arrival record ends", formatDate(record), "Approved end date", formatDate(addDays(record, -10)));
          return choose(right, [addDays(record, -55), addDays(record, -30), record, addDays(record, -60)]);
        }
        case "max": {
          const first = date28(rng, "2020-01-01", "2024-12-28");
          const outside = rng.int(5, 95);
          const base = addMonths(first, 72);
          const right = addDays(base, outside);
          set("When does the six-year limit end?", SD_RULES.max, "First H-1B start date", formatDate(first), "Full days outside the country", `${outside} days`);
          return choose(right, [base, addDays(base, -outside), addDays(addMonths(first, 36), outside), addDays(right, 1)]);
        }
        case "years": {
          const start = date28(rng, "2026-03-01", "2029-12-28");
          const whole = rng.int(1, 4);
          const limit = addDays(addMonths(start, 12 * whole), rng.int(10, 300));
          set("How many whole years can the extension cover?", SD_RULES.years, "Six-year limit ends", formatDate(limit), "Extension starts", formatDate(start));
          return [`sd-${n}`, { answer: { value: Math.min(3, whole), tolerance: 0 } }] as const;
        }
        case "recapture": {
          const dep1 = dateBetween(rng, "2025-01-01", "2027-06-30");
          const a1 = rng.int(2, 4);
          const dep2 = addDays(dep1, a1 + rng.int(30, 200));
          const a2 = rng.int(2, 4);
          const trip = (d: IsoDate, a: number) => `Left ${formatDate(d)}, returned ${formatDate(addDays(d, a))}`;
          set("How many days are recaptured?", SD_RULES.recapture, "Trip 1", trip(dep1, a1), "Trip 2", trip(dep2, a2));
          return [`sd-${n}`, { answer: { value: a1 + a2 - 2, tolerance: 0 } }] as const;
        }
      }
    }),
  );
}

// ---- Rapid round B: document and process terms ----

interface TermQuestion {
  prompt: (ben: PersonName) => string;
  right: string;
  wrong: [string, string, string];
}

const TERMS_EASY: TermQuestion[] = [
  { prompt: () => "Who is the petitioner on Form P-129?", right: "The employer filing the petition", wrong: ["The foreign worker", "The law firm", "The consulate"] },
  {
    prompt: () => "Who is the beneficiary of an H-1B petition?",
    right: "The foreign worker the petition is for",
    wrong: ["The employer", "The attorney of record", "The agency officer"],
  },
  {
    prompt: () => "What does a receipt notice (Notice N-797C) confirm?",
    right: "The agency received the petition and the fee",
    wrong: ["The petition was approved", "The worker may enter the country", "The wage was certified"],
  },
  { prompt: () => "What does RFE stand for?", right: "Request for Evidence", wrong: ["Record of Final Eligibility", "Renewal of Foreign Employment", "Review of Filing Errors"] },
  {
    prompt: () => "What is a certified translation?",
    right: "A complete English translation with the translator's statement of competence and accuracy",
    wrong: ["A summary of the document in English", "A machine translation with no statement", "A notarized copy of the original"],
  },
  {
    prompt: () => "What does a credential evaluation show?",
    right: "The U.S. equivalent of a foreign degree",
    wrong: ["That the passport is genuine", "The prevailing wage", "The worker's travel history"],
  },
  {
    prompt: () => "What is the prevailing wage?",
    right: "The average wage for the occupation in the area of employment",
    wrong: ["The federal minimum wage", "The employer's average salary", "The salary the worker asks for"],
  },
  {
    prompt: () => "What is Form A-28?",
    right: "The attorney's notice of appearance",
    wrong: ["The wage attestation", "The arrival record", "The passport renewal form"],
  },
  {
    prompt: () => "What does the arrival record (AR-94) show?",
    right: "The date the authorized stay ends",
    wrong: ["The petition's receipt date", "The worker's salary", "The worker's home address"],
  },
  {
    prompt: () => "What is premium processing?",
    right: "An extra fee for a decision within a set number of business days",
    wrong: ["Filing before the annual cap opens", "Priority for higher wage levels", "A free expedite for every employer"],
  },
  {
    prompt: () => "A specialty occupation requires…",
    right: "At least a bachelor's degree in a specific field, or its equivalent",
    wrong: ["Any job paying above the minimum wage", "Ten years of experience", "A professional license in every case"],
  },
  {
    prompt: () => "What does an approval notice (Notice N-797A) show?",
    right: "That the petition was approved, and its validity dates",
    wrong: ["That the filing fee was paid", "That more evidence is needed", "That the petition was withdrawn"],
  },
  {
    prompt: () => "What is consular processing?",
    right: "Getting the visa at a consulate abroad after the petition is approved",
    wrong: ["The employer filing the petition at a consulate", "Changing status without leaving the country", "Appealing a denial"],
  },
];

const TERMS_HARD: TermQuestion[] = [
  {
    prompt: (b) => `${b.first}'s job moves to a city outside the area on the wage attestation. What is usually needed?`,
    right: "A new wage attestation and an amended petition",
    wrong: ["Nothing, if the salary stays the same", "Only a new job letter", "Only a note in the employee's personnel file"],
  },
  {
    prompt: () => "What is the public access file?",
    right: "The employer's wage attestation records, open to public inspection",
    wrong: ["The agency's online case status page", "The beneficiary's immigration history", "The court docket for an appeal"],
  },
  {
    prompt: () => "What does an extension of stay mean?",
    right: "Same status, more time",
    wrong: ["Moving from student status to worker status", "Working for a second employer", "Leaving the country and coming back"],
  },
  {
    prompt: (b) => `${b.first}'s passport expires before the requested end date. What is the risk?`,
    right: "The stay may be limited to the passport's expiry date",
    wrong: ["The petition is denied automatically", "None: the passport date doesn't matter", "The filing fee doubles"],
  },
  {
    prompt: () => "What does it mean that a petition is cap-subject?",
    right: "It counts against the annual numerical limit",
    wrong: ["It is exempt from the filing fee", "Only an attorney may file it", "It can only be approved for one year"],
  },
  {
    prompt: () => "The RFE response arrives late. What usually happens?",
    right: "The agency can decide the case on the record it has",
    wrong: ["The deadline extends automatically", "The case moves to premium processing", "The agency waits for the response"],
  },
];

const rapidTermsStep = {
  id: "rapid-terms",
  type: RAPID_ROUND,
  title: "Rapid round: document and process terms",
  config: {
    intro: "Document and process terms: 15 quick questions about the H-1B process and its paperwork, 20 seconds each. The forms are this exercise's fictional versions.",
    secondsPerItem: 20,
    items: rapidItems("dt", (n) => ({
      prompt: `{{dt_${n}}}`,
      fields: [{ id: "answer", label: "Answer", kind: "choice", options: letterOptions(`dt_${n}`) }],
    })),
  },
};

function buildTerms(rng: Rng, v: Values, ben: PersonName): Record<string, ChoiceKey> {
  const qs = fillSlots(rng.shuffle(TERMS_EASY).slice(0, 10), rng.shuffle(TERMS_HARD).slice(0, 5));
  return Object.fromEntries(
    qs.map((q, i) => {
      const n = slotNo(i);
      const { labels, letter } = placeOptions(rng, q.right, q.wrong);
      v[`dt_${n}`] = q.prompt(ben);
      LETTERS.forEach((l, j) => (v[`dt_${n}_${l}`] = labels[j]));
      return [`dt-${n}`, { answer: { choice: letter } }];
    }),
  );
}

// ---- Rapid round C: deadlines ----

const DL_RULES = {
  rfe_mail:
    "The response must arrive within 87 days after the notice date (84 days plus 3 for mailing). A due date on a weekend or federal holiday does not move: the response must arrive by the last business day before it.",
  rfe_online:
    "The response must arrive within 84 days after the notice date. A due date on a weekend or federal holiday does not move: the response must arrive by the last business day before it.",
  appeal: "A motion to reopen is due 33 days after a mailed decision (30 days plus 3 for mailing). A last day on a weekend or federal holiday moves to the next business day.",
  posting: "The notice must stay posted for 10 business days; the day it goes up is business day 1.",
  premium: "The agency acts within 15 business days after the receipt day; the receipt day doesn't count.",
  courier: "Firm practice: the response goes to the courier 2 business days before the due date.",
};

type DeadlineKind = "rfe_plain" | "rfe_weekend" | "rfe_holiday" | "appeal_plain" | "appeal_roll" | "posting_plain" | "posting_holiday" | "premium" | "courier";
const DL_EASY: DeadlineKind[] = ["rfe_plain", "rfe_plain", "rfe_plain", "rfe_plain", "rfe_weekend", "rfe_weekend", "rfe_weekend", "appeal_plain", "appeal_plain", "posting_plain"];
const DL_HARD: DeadlineKind[] = ["rfe_holiday", "appeal_roll", "posting_holiday", "premium", "courier"];
/** Calendar entries fall in this window, so every period stays inside the verified holiday years. */
const DL_FIRST = "2026-09-01";
const DL_SPAN_DAYS = 600;

const rapidDeadlineStep = {
  id: "rapid-deadlines",
  type: RAPID_ROUND,
  title: "Rapid round: deadlines",
  config: {
    intro: [
      "Deadlines: 15 calendar entries, 20 seconds each. Pick the date you calendar.",
      "Each entry states its rule. Business days are Monday to Friday except federal holidays; the holidays in the window are listed on each entry.",
    ].join("\n"),
    secondsPerItem: 20,
    items: rapidItems("dl", (n) => ({
      prompt: `{{dl_${n}}}`,
      exhibit: {
        title: "Calendar entry",
        rows: [
          { label: "Event", value: `{{dl_${n}_event}}` },
          { label: "Date", value: `{{dl_${n}_date}}` },
          { label: "Rule", value: `{{dl_${n}_rule}}` },
          { label: "Federal holidays in the window", value: `{{dl_${n}_hols}}` },
        ],
      },
      fields: [{ id: "due", label: "Date", kind: "choice", options: letterOptions(`dl_${n}`) }],
    })),
  },
};

function buildDeadlines(rng: Rng, v: Values): Record<string, ChoiceKey> {
  const kinds = fillSlots(rng.shuffle(DL_EASY), rng.shuffle(DL_HARD));
  return Object.fromEntries(
    kinds.map((kind, i) => {
      const n = slotNo(i);
      for (let tries = 0; ; tries++) {
        if (tries > 20_000) throw new Error(`immigration-h1b-packet: no ${kind} deadline`);
        const from = addDays(DL_FIRST, rng.int(0, DL_SPAN_DAYS));
        if (!isCourtDay(from)) continue;
        let event: string;
        let rule: string;
        let prompt: string;
        let due: IsoDate;
        let lo = from;
        let hi: IsoDate;
        let tempting: IsoDate[];
        if (kind.startsWith("rfe_")) {
          const mail = rng.int(0, 1) === 1;
          const end = addDays(from, mail ? 87 : 84);
          due = previousCourtDay(end);
          const crossesHoliday = holidaysBetween(due, end).length > 0;
          const fits = kind === "rfe_plain" ? isCourtDay(end) : kind === "rfe_weekend" ? isWeekend(end) && !crossesHoliday : crossesHoliday;
          if (!fits) continue;
          event = mail ? "RFE notice mailed" : "RFE notice delivered to the online account";
          rule = mail ? DL_RULES.rfe_mail : DL_RULES.rfe_online;
          prompt = "By what date must the RFE response arrive?";
          hi = end;
          tempting = [end, nextCourtDay(end), addDays(from, mail ? 84 : 87), nextCourtDay(addDays(end, 1)), previousCourtDay(addDays(due, -1))];
        } else if (kind.startsWith("appeal_")) {
          const end = addDays(from, 33);
          due = nextCourtDay(end);
          if ((kind === "appeal_plain") !== (due === end)) continue;
          event = "Denial decision mailed";
          rule = DL_RULES.appeal;
          prompt = "When is the motion to reopen due?";
          hi = due;
          tempting = [end, previousCourtDay(end), addDays(from, 30), nextCourtDay(addDays(due, 1)), addDays(due, 7)];
        } else if (kind.startsWith("posting_")) {
          due = courtDaysAfter(from, 9);
          const inside = holidaysBetween(addDays(from, 1), addDays(due, -1)).length > 0;
          if ((kind === "posting_holiday") !== inside) continue;
          event = "Notice of filing posted at the worksite";
          rule = DL_RULES.posting;
          prompt = "What is the last day the notice must stay up?";
          hi = due;
          tempting = [courtDaysAfter(from, 10), addDays(from, 9), addDays(from, 10), courtDaysAfter(from, 8), addDays(from, 14)];
        } else if (kind === "premium") {
          due = courtDaysAfter(from, 15);
          if (holidaysBetween(from, due).length === 0) continue;
          event = "Premium processing request received";
          rule = DL_RULES.premium;
          prompt = "By what date should the agency act?";
          hi = due;
          tempting = [addDays(from, 15), courtDaysAfter(from, 14), courtDaysAfter(from, 16), addDays(from, 21)];
        } else {
          due = courtDaysBefore(from, 2);
          if (daysBetween(due, from) === 2) continue; // only entries where a weekend or holiday sits in between
          event = "RFE response due";
          rule = DL_RULES.courier;
          prompt = "On what date does the response go to the courier?";
          lo = due;
          hi = from;
          tempting = [addDays(from, -2), courtDaysBefore(from, 1), courtDaysBefore(from, 3), from];
        }
        const { labels, letter } = dateOptions(rng, due, tempting);
        const window = holidaysBetween(addDays(lo, -3), addDays(hi, 3));
        Object.assign(v, {
          [`dl_${n}`]: prompt,
          [`dl_${n}_event`]: event,
          [`dl_${n}_date`]: formatDate(from),
          [`dl_${n}_rule`]: rule,
          [`dl_${n}_hols`]: window.length ? window.map((h) => `${formatDate(h.date)} (${h.name})`).join("; ") : "None",
          ...Object.fromEntries(LETTERS.map((l, j) => [`dl_${n}_${l}`, labels[j]])),
        });
        return [`dl-${n}`, { due: { choice: letter } }];
      }
    }),
  );
}

// ---- Section A: forms cross-check ----

type FormRow =
  | "family"
  | "given"
  | "dob"
  | "citizenship"
  | "passport_no"
  | "passport_exp"
  | "title"
  | "occ_code"
  | "wage_level"
  | "wage"
  | "start"
  | "end"
  | "worksite"
  | "hours";
const FORM_ROWS: [FormRow, string][] = [
  ["family", "Family name"],
  ["given", "Given names"],
  ["dob", "Date of birth"],
  ["citizenship", "Country of citizenship"],
  ["passport_no", "Passport number"],
  ["passport_exp", "Passport expiry date"],
  ["title", "Job title"],
  ["occ_code", "Occupation code"],
  ["wage_level", "Wage level"],
  ["wage", "Annual wage"],
  ["start", "Employment start"],
  ["end", "Employment end"],
  ["worksite", "Worksite"],
  ["hours", "Hours"],
];

const FORMS_RULES = [
  "Identity details (names, date of birth, citizenship, passport number and expiry) must match the passport; the passport prints names in capitals and dates day first (07 MAR 1994), the petition month first (03/07/1994).",
  "Job title, occupation code, wage level, wage and worksite on the petition and the job letter must match the certified wage attestation.",
  "The petition's employment period must fall inside the attestation's validity period.",
].join(" ");

const formsStep = {
  id: "forms-consistency",
  type: DOCUMENT_REVIEW,
  title: "Forms cross-check: {{ben}}",
  config: {
    prompt: ["Cross-check the petition against the passport, the job offer letter and the certified wage attestation.", "Flag each detail that doesn't match, with the reason, then decide what to do."].join("\n"),
    document: {
      title: "Cross-check · Form P-129 for {{ben}}",
      fields: [
        { id: "employer", label: "Employer (petitioner)", value: "{{employer}}" },
        { id: "beneficiary", label: "Beneficiary", value: "{{ben}}" },
        { id: "classification", label: "Classification", value: "H-1B, extension of stay with the same employer" },
      ],
      columns: ["Detail", "Form P-129 (petition)", "Passport", "Job offer letter", "Wage attestation WA-9035 (certified)"],
      rows: FORM_ROWS.map(([id, label]) => ({ id, cells: [label, ...["pet", "pass", "letter", "wa"].map((c) => `{{fc_${id}_${c}}}`)] })),
      totals: [],
      footnote: FORMS_RULES,
    },
    reasons: [
      { id: "identity", label: "Doesn't match the passport" },
      { id: "job", label: "Job title or occupation code doesn't match the attestation" },
      { id: "wage", label: "Wage or wage level doesn't match the attestation" },
      { id: "dates", label: "Outside the attestation's validity period" },
      { id: "worksite", label: "Worksite isn't on the attestation" },
      { id: "other", label: "Other" },
    ],
    findings: [
      { id: "identity", label: "Identity detail that doesn't match the passport", points: 4 },
      { id: "job", label: "Job title or occupation code off the attestation", points: 3 },
      { id: "wage", label: "Wage or wage level off the attestation", points: 4 },
      { id: "dates", label: "Employment dates outside the attestation", points: 3 },
      { id: "worksite", label: "Worksite not on the attestation", points: 4 },
    ],
    falseFlagPenalty: 1,
    decision: {
      prompt: "What do you do before filing?",
      options: [
        { id: "file", label: "File the petition today: the differences are small" },
        { id: "fix_file", label: "Correct the petition and the job letter myself so everything matches, then file" },
        {
          id: "hold",
          label: "Hold the filing: send {{attorney}} the list of discrepancies, get corrected documents from the employer through {{attorney_first}}, and file once {{attorney_first}} signs off",
        },
        { id: "passport", label: "Ask {{ben_first}} to have the passport changed to match the petition" },
      ],
      points: 2,
    },
  },
};

// ---- Section B: packet checklist ----

type PacketRow = "a28" | "p129" | "fee" | "wa" | "letter" | "passport" | "ar94" | "degree" | "eval" | "experience" | "paystubs" | "approvals";
const PACKET_ROWS: Record<PacketRow, [item: string, requirement: string]> = {
  a28: ["Form A-28, notice of attorney appearance", "Signed by the attorney and by the employer's authorized signatory"],
  p129: ["Form P-129 petition", "Signed and dated by the employer's authorized signatory"],
  fee: [
    "Filing fees",
    "Base fee $780 + anti-fraud fee $500 + training fee ($750 for 25 or fewer U.S. employees, $1,500 for 26 or more), in one check",
  ],
  wa: ["Wage attestation WA-9035", "Certified copy, valid for the requested employment period"],
  letter: ["Employer support letter", "On company letterhead, signed by the employer's authorized signatory"],
  passport: ["Beneficiary's passport", "Copy of the current passport's biographic page, valid on the filing date"],
  ar94: ["Arrival record AR-94", "Copy of the most recent record"],
  degree: ["Degree", "Copy of the diploma and transcripts; anything not in English needs a certified English translation"],
  eval: ["Credential evaluation", "Report on the U.S. equivalent of the foreign degree"],
  experience: ["Experience letters", "Letters from prior employers; anything not in English needs a certified English translation"],
  paystubs: ["Pay statements", "The last 3 pay statements"],
  approvals: ["Prior approval notices N-797A", "Copies of every prior approval notice"],
};
const PACKET_KINDS = Object.keys(PACKET_ROWS) as PacketRow[];
const packetRowId = (i: number) => `t${String(i + 1).padStart(2, "0")}`;

const packetStep = {
  id: "packet-checklist",
  type: DOCUMENT_REVIEW,
  title: "Filing packet checklist",
  config: {
    prompt: ["Check each tab of the packet against the firm's checklist.", "Flag each tab that isn't ready, with the reason, then decide what to do with the packet."].join("\n"),
    document: {
      title: "Filing packet checklist · Form P-129 for {{ben}}",
      fields: [
        { id: "employer", label: "Employer (petitioner)", value: "{{employer}}" },
        { id: "employees", label: "U.S. employees", value: "{{employees}}" },
        { id: "filing_date", label: "Filing date", value: "{{filing_date}}" },
      ],
      columns: ["Tab", "Item", "Checklist requirement", "What's in the packet"],
      rows: PACKET_KINDS.map((_, i) => ({ id: packetRowId(i), cells: [`${i + 1}`, ...["item", "req", "in"].map((c) => `{{pk_${i + 1}_${c}}}`)] })),
      totals: [],
    },
    reasons: [
      { id: "missing", label: "Missing from the packet" },
      { id: "unsigned", label: "Not signed" },
      { id: "fee", label: "Wrong fee amount" },
      { id: "translation", label: "Needs a certified English translation" },
      { id: "not_valid", label: "Expired, pending or not valid on the filing date" },
      { id: "other", label: "Other" },
    ],
    findings: [
      { id: "missing", label: "Required document missing", points: 4 },
      { id: "unsigned", label: "Form or letter not signed", points: 4 },
      { id: "fee", label: "Wrong filing fee", points: 4 },
      { id: "translation", label: "Foreign-language document without a translation", points: 3 },
      { id: "not_valid", label: "Expired passport copy or attestation not yet certified", points: 3 },
    ],
    falseFlagPenalty: 1,
    decision: {
      prompt: "The packet is due out today. What do you do?",
      options: [
        { id: "file", label: "File today and send the missing items later" },
        { id: "sign", label: "Sign the blank signature lines for the employer to save time, then file" },
        { id: "hold", label: "Hold the packet: send {{attorney}} the list, get the missing and corrected items from the employer, and file once the packet is complete" },
        { id: "translate", label: "Run the foreign-language documents through an online translator and file today" },
      ],
      points: 2,
    },
  },
};

// ---- Section C: inbox ----

const RFE_ITEMS: Record<string, [request: string, document: string]> = {
  duties: [
    "Evidence that the position is a specialty occupation: what the job's duties are and how much time each takes.",
    "A detailed position description with the duties and the share of time on each",
  ],
  control: [
    "Evidence of the employer–employee relationship: who assigns, supervises and reviews the work.",
    "A signed letter from the supervisor on who assigns and reviews the work",
  ],
  eval: ["Evidence that the beneficiary's foreign degree is equivalent to a U.S. bachelor's degree.", "The credential evaluation of the foreign degree"],
  site: ["Evidence that the worksite exists and the work will be done there.", "The worksite lease and photos of the office"],
  status: ["Evidence that the beneficiary kept status: recent pay statements and the latest arrival record.", "Pay statements and the arrival record showing status was kept"],
  pay: ["Evidence of the employer's ability to pay the offered wage.", "The employer's latest annual tax return, showing it can pay the wage"],
};

const rfeStep = {
  id: "inbox-rfe",
  type: MULTIPLE_CHOICE,
  seconds: 300,
  title: "RFE response packet",
  config: {
    prompt: "{{attorney_first}} asked you to put together the RFE response for {{rfe_ben}}. Pick every item that goes into the response.",
    options: [
      { id: "cover", label: "A cover letter listing each item the RFE asks for and the tab that answers it" },
      { id: "notice", label: "A copy of the RFE notice, on top of the response" },
      ...Object.entries(RFE_ITEMS).map(([id, [, doc]]) => ({ id, label: doc })),
      { id: "everything", label: "Every document in the client file, so nothing is missed" },
      { id: "bank", label: "The beneficiary's personal bank statements" },
    ],
    select: "multi",
    points: 12,
  },
};

const backdateStep = {
  id: "inbox-backdate",
  type: MULTIPLE_CHOICE,
  seconds: 210,
  title: "Email from the employer's HR manager",
  config: { prompt: "{{hr_first}} wants the job letter redone with an earlier date. What do you do?", options: letterOptions("bd"), select: "single", points: 10 },
};

const beneficiaryStep = {
  id: "inbox-beneficiary",
  type: MULTIPLE_CHOICE,
  seconds: 210,
  title: "Email from the beneficiary",
  config: { prompt: "{{ben_first}} asks whether to travel while the extension is pending. What do you do?", options: letterOptions("bn"), select: "single", points: 8 },
};

// ---- Generator helpers ----

/** Two adjacent letters swapped, inside the word so the capital stays first. */
function swapLetters(rng: Rng, s: string): string {
  const spots = Array.from({ length: s.length - 2 }, (_, k) => k + 1).filter((k) => s[k] !== s[k + 1]);
  const k = rng.pick(spots);
  return s.slice(0, k) + s[k + 1] + s[k] + s.slice(k + 2);
}

export const immigrationH1bPacket = defineScenario({
  slug: "immigration-h1b-packet",
  version: 1,
  title: "H-1B petition packet: immigration paralegal",
  roleFamily: "legal",
  timeLimitMinutes: 50,
  definition: {
    intro:
      "You're an immigration paralegal at {{firm}}, working for {{attorney}}, an attorney, on an H-1B extension of stay for {{ben}}, a {{job_title}} at {{employer}}. The work comes in six timed parts, 50 minutes in all: three rapid rounds of quick items (status and date math, document and process terms, deadlines), a cross-check of the petition forms, the filing packet checklist, and your inbox. A finished part can't be reopened. The agency, its forms (Form P-129, Form WA-9035, Form A-28, the AR-94 arrival record, N-797 notices), the rules stated in the exhibits, the people and the employers are fictional. You prepare and check the paperwork; the attorney gives the legal advice.",
    steps: [rapidStatusStep, formsStep, rapidTermsStep, packetStep, rapidDeadlineStep, rfeStep, backdateStep, beneficiaryStep],
    messages: [
      {
        id: "m1",
        from: "Your supervising attorney",
        subject: "{{ben}} extension: cross-check the forms",
        body: [
          "Hi {{first_name}},",
          "",
          "We file {{ben}}'s extension this week. Before it goes out, cross-check the petition (Form P-129) against the passport, the job offer letter and the certified wage attestation:",
          "• Identity details come from the passport.",
          "• The job title, occupation code, wage level, wage and worksite must match the certified attestation.",
          "• The employment period must sit inside the attestation's validity period.",
          "",
          "Flag every discrepancy with the reason and tell me what you'll do. Don't change anything the client or the employer signed.",
          "",
          "{{attorney}}",
        ].join("\n"),
        arriveAtMinute: 0,
        stepId: "forms-consistency",
      },
      {
        id: "m2",
        from: "Your supervising attorney",
        subject: "Filing packet for {{ben}}",
        body: [
          "Hi {{first_name}},",
          "",
          "The filing packet for {{ben}} is assembled and should go out today. Check every tab against our checklist: signatures, the fee, translations, and anything missing or not valid on the filing date. Flag what's wrong and tell me what you'll do with the packet.",
          "",
          "{{attorney}}",
        ].join("\n"),
        arriveAtMinute: 0,
        stepId: "packet-checklist",
      },
      {
        id: "m3",
        from: "Your supervising attorney",
        subject: "RFE on {{rfe_ben}}'s petition",
        body: [
          "Hi {{first_name}},",
          "",
          "The agency sent an RFE on {{rfe_ben}}'s petition for {{rfe_employer}}, dated {{rfe_date}}. It asks for three things:",
          "",
          "{{rfe_items}}",
          "",
          "Please put the response together. Put in only what answers the RFE: one tab per item it asks for, a cover letter that indexes them, and a copy of the notice on top. Don't pad it with documents it doesn't ask for. I'll review it before it goes out.",
          "",
          "{{attorney}}",
        ].join("\n"),
        arriveAtMinute: 0,
        stepId: "inbox-rfe",
      },
      {
        id: "m4",
        from: "HR manager at the employer",
        subject: "Small favor: job letter",
        body: [
          "Hi {{first_name}},",
          "",
          "Could you redo {{ben_first}}'s job offer letter with a date of {{bd_date}} instead of {{bd_real}}? It should look like the offer went out before we filed. {{signatory}} will sign it. Let's keep this between us so it doesn't hold anything up.",
          "",
          "Thanks,",
          "{{hr}}, HR manager, {{employer}}",
        ].join("\n"),
        arriveAtMinute: 0,
        stepId: "inbox-backdate",
      },
      {
        id: "m5",
        from: "The beneficiary",
        subject: "Trip home?",
        body: [
          "Hi {{first_name}},",
          "",
          "My extension is still pending. My sister is getting married in {{home_country}} next month. Can I fly home for a week and come back on my current visa? What would you do in my place? I'd rather not bother {{attorney_first}} with it.",
          "",
          "{{ben}}",
        ].join("\n"),
        arriveAtMinute: 0,
        stepId: "inbox-beneficiary",
      },
    ],
    sections: [
      { id: "s-rapid-a", title: "Rapid round: status and date math", minutes: 6, stepIds: ["rapid-status"] },
      { id: "s-forms", title: "Forms cross-check", minutes: 10, stepIds: ["forms-consistency"] },
      { id: "s-rapid-b", title: "Rapid round: document and process terms", minutes: 6, stepIds: ["rapid-terms"] },
      { id: "s-packet", title: "Packet checklist", minutes: 10, stepIds: ["packet-checklist"] },
      { id: "s-rapid-c", title: "Rapid round: deadlines", minutes: 6, stepIds: ["rapid-deadlines"] },
      { id: "s-inbox", title: "Inbox", minutes: 12, stepIds: ["inbox-rfe", "inbox-backdate", "inbox-beneficiary"], oneAtATime: true },
    ],
  },

  build(rng) {
    const v: Values = {};
    const firm = rng.pick(LAW_FIRMS);
    const [employer, rfeEmployer] = pickDistinct(rng, EMPLOYERS, 2);
    const [pAttorney, pHr, pSignatory, pRfeBen] = distinctPeople(rng, 4);
    // The beneficiary's name comes from the full pools, apart from the staff names.
    let ben: PersonName;
    do {
      const first = rng.pick(FIRST_NAMES);
      const last = rng.pick(LAST_NAMES);
      ben = { first, last, full: `${first} ${last}` };
    } while ([pAttorney, pHr, pSignatory, pRfeBen].some((p) => p.first === ben.first || p.last === ben.last));
    const [country, language] = rng.pick(COUNTRIES);
    const filing = courtDayBetween(rng, "2026-10-01", "2027-06-30");
    Object.assign(v, {
      firm: firm.name,
      attorney: pAttorney.full,
      attorney_first: pAttorney.first,
      hr: pHr.full,
      hr_first: pHr.first,
      signatory: pSignatory.full,
      employer,
      ben: ben.full,
      ben_first: ben.first,
      home_country: country,
      filing_date: formatDate(filing),
    });

    // ---- Section A: the forms grid ----
    const trueTitle = rng.pick(JOB_TITLES);
    const code = `OC-${rng.int(1000, 9899)}`;
    const level = rng.pick(LEVELS);
    const wage = rng.int(144, 290) * 500;
    const dob = date28(rng, "1975-01-01", "1999-12-28");
    const passportNo = `${String.fromCharCode(65 + rng.int(0, 25))}${String.fromCharCode(65 + rng.int(0, 25))}${rng.int(1_000_000, 9_999_999)}`;
    const passportExp = date28(rng, addDays(filing, 1200), addDays(filing, 3000));
    const waFrom = addDays(filing, rng.int(20, 120));
    const waTo = addDays(waFrom, rng.int(1000, 1094));
    const [city, otherCity] = pickDistinct(rng, CITIES, 2);
    const [street, otherStreet] = pickDistinct(rng, STREETS, 2);
    const site = `${rng.int(100, 989)} ${street}, ${city}`;
    const otherSite = `${rng.int(100, 989)} ${otherStreet}, ${otherCity}`;
    v.job_title = trueTitle;

    type Cells = [pet: string, pass: string, letter: string, wa: string];
    const D = "—";
    const grid: Record<FormRow, Cells> = {
      family: [ben.last, ben.last.toUpperCase(), ben.last, D],
      given: [ben.first, ben.first.toUpperCase(), ben.first, D],
      dob: [usDate(dob), passportDate(dob), D, D],
      citizenship: [country, country.toUpperCase(), D, D],
      passport_no: [passportNo, passportNo, D, D],
      passport_exp: [usDate(passportExp), passportDate(passportExp), D, D],
      title: [trueTitle, D, trueTitle, trueTitle],
      occ_code: [code, D, D, code],
      wage_level: [level, D, D, level],
      wage: [`${money(wage)} per year`, D, `${money(wage)} per year`, `${money(wage)} per year`],
      start: [formatDate(addDays(waFrom, rng.int(0, 20))), D, "", `Valid from ${formatDate(waFrom)}`],
      end: [formatDate(addDays(waTo, -rng.int(0, 20))), D, D, `Valid to ${formatDate(waTo)}`],
      worksite: [site, D, site, site],
      hours: [HOURS, D, HOURS, HOURS],
    };
    const notes: Record<string, string> = {};
    // Identity: the petition misstates one passport detail.
    const idRow = rng.pick<FormRow>(["family", "given", "dob", "passport_no", "passport_exp"]);
    if (idRow === "family" || idRow === "given") {
      const right = idRow === "family" ? ben.last : ben.first;
      grid[idRow][0] = swapLetters(rng, right);
      notes.identity = `The petition spells the ${idRow === "family" ? "family name" : "given name"} ${grid[idRow][0]}; the passport says ${right.toUpperCase()}.`;
    } else if (idRow === "passport_no") {
      const digits = passportNo.slice(2);
      grid.passport_no[0] = passportNo.slice(0, 2) + swapLetters(rng, digits);
      notes.identity = `The petition gives passport number ${grid.passport_no[0]}; the passport is ${passportNo}.`;
    } else {
      const right = idRow === "dob" ? dob : passportExp;
      grid[idRow][0] = usDate(misreadDate(rng, right));
      notes.identity = `The petition's ${idRow === "dob" ? "date of birth" : "passport expiry date"} (${grid[idRow][0]}) isn't the passport's ${passportDate(right)}.`;
    }
    // Job: the petition's title or code isn't the certified one.
    const jobRow = rng.pick<FormRow>(["title", "occ_code"]);
    if (jobRow === "title") grid.title[0] = rng.pick(JOB_TITLES.filter((t) => t !== trueTitle));
    else grid.occ_code[0] = `OC-${Number(code.slice(3)) + rng.pick([-1, 1]) * rng.int(1, 9)}`;
    notes.job = `The petition says ${grid[jobRow][0]}; the certified attestation says ${grid[jobRow][3]}.`;
    // Wage: a lower wage on the petition or the letter, or another wage level on the petition.
    const wageKind = rng.pick(["petition", "letter", "level"] as const);
    const wageRow: FormRow = wageKind === "level" ? "wage_level" : "wage";
    if (wageKind === "level") grid.wage_level[0] = rng.pick(LEVELS.filter((l) => l !== level));
    else grid.wage[wageKind === "petition" ? 0 : 2] = `${money(wage - rng.int(3, 18) * 500)} per year`;
    notes.wage =
      wageKind === "level"
        ? `The petition claims ${grid.wage_level[0]}; the attestation was certified at ${level}.`
        : `The ${wageKind === "petition" ? "petition" : "job letter"} offers ${grid.wage[wageKind === "petition" ? 0 : 2]}, less than the attested ${money(wage)}.`;
    // Dates: the petition starts before or ends after the attestation's validity.
    const dateRow = rng.pick<FormRow>(["start", "end"]);
    if (dateRow === "start") grid.start[0] = formatDate(addDays(waFrom, -rng.int(5, 60)));
    else grid.end[0] = formatDate(addDays(waTo, rng.int(5, 90)));
    notes.dates =
      dateRow === "start"
        ? `The petition starts ${grid.start[0]}, before the attestation is valid (${formatDate(waFrom)}).`
        : `The petition runs to ${grid.end[0]}, past the attestation's end (${formatDate(waTo)}).`;
    grid.start[2] = grid.start[0];
    // Worksite: the petition or the letter names an address the attestation doesn't cover.
    const siteCol = rng.pick([0, 2]);
    grid.worksite[siteCol] = otherSite;
    notes.worksite = `The ${siteCol === 0 ? "petition" : "job letter"} puts the job at ${otherSite}; the attestation covers ${site} only.`;
    for (const [id] of FORM_ROWS) ["pet", "pass", "letter", "wa"].forEach((c, j) => (v[`fc_${id}_${c}`] = grid[id][j]));

    // ---- Section B: packet checklist ----
    const small = rng.int(0, 1) === 1;
    const employees = small ? rng.int(6, 25) : rng.int(26, 480);
    const feeRight = 780 + 500 + (small ? 750 : 1500);
    const feeWrong = rng.pick([1280 + (small ? 1500 : 750), feeRight - 500, 1280]);
    v.employees = String(employees);
    const missingRow = rng.pick<PacketRow>(["ar94", "eval", "paystubs", "approvals"]);
    const unsignedRow = rng.pick<PacketRow>(["a28", "p129", "letter"]);
    const translationRow = rng.pick<PacketRow>(["degree", "experience"]);
    const notValidRow = rng.pick<PacketRow>(["wa", "passport"]);
    const docsIn = (row: PacketRow, trap: boolean) => {
      const what = row === "degree" ? "Diploma and transcripts" : "Two letters";
      if (trap) return `${what} in ${language}; no translation`;
      return rng.int(0, 1) ? `${what} in English` : `${what} in ${language}; certified English translation attached`;
    };
    const monthYear = (d: IsoDate) => `${MON[Number(d.slice(5, 7)) - 1].slice(0, 1)}${MON[Number(d.slice(5, 7)) - 1].slice(1).toLowerCase()} ${d.slice(0, 4)}`;
    const inPacket: Record<PacketRow, string> = {
      a28: unsignedRow === "a28" ? `Signed by ${pAttorney.full} (attorney); employer signature line blank` : `Signed by ${pAttorney.full} (attorney) and ${pSignatory.full} (employer)`,
      p129: unsignedRow === "p129" ? "Complete; signature and date lines blank" : `Signed by ${pSignatory.full} on ${formatDate(addDays(filing, -rng.int(1, 6)))}`,
      fee: `One check for ${money(feeWrong)}`,
      wa:
        notValidRow === "wa"
          ? `Submitted on ${formatDate(addDays(filing, -rng.int(3, 20)))}; certification pending`
          : `Certified on ${formatDate(addDays(filing, -rng.int(5, 40)))}; valid ${formatDate(waFrom)} to ${formatDate(waTo)}`,
      letter: unsignedRow === "letter" ? "On letterhead, unsigned" : `On letterhead, signed by ${pSignatory.full}`,
      passport:
        notValidRow === "passport"
          ? `Copy of a previous passport's biographic page; expired ${formatDate(addDays(filing, -rng.int(30, 700)))}`
          : `Copy of the current passport's biographic page; expires ${formatDate(passportExp)}`,
      ar94: `Copy; admitted until ${formatDate(addDays(filing, rng.int(20, 80)))}`,
      degree: docsIn("degree", translationRow === "degree"),
      eval: `Report from ${rng.pick(EVALUATORS)}, dated ${formatDate(addDays(filing, -rng.int(200, 2000)))}`,
      experience: docsIn("experience", translationRow === "experience"),
      paystubs: `3 pay statements, ${monthYear(addDays(filing, -75))} to ${monthYear(addDays(filing, -15))}`,
      approvals: `2 approval notices, for ${Number(filing.slice(0, 4)) - 6 + rng.int(0, 2)} and ${Number(filing.slice(0, 4)) - 3}`,
    };
    inPacket[missingRow] = "Not in the packet";
    const packetOrder = rng.shuffle(PACKET_KINDS);
    packetOrder.forEach((row, i) => {
      v[`pk_${i + 1}_item`] = PACKET_ROWS[row][0];
      v[`pk_${i + 1}_req`] = PACKET_ROWS[row][1];
      v[`pk_${i + 1}_in`] = inPacket[row];
    });
    const tab = (row: PacketRow) => packetRowId(packetOrder.indexOf(row));
    const tabNo = (row: PacketRow) => `Tab ${packetOrder.indexOf(row) + 1}`;

    // ---- Section C: inbox ----
    const asked = rng.shuffle(Object.keys(RFE_ITEMS)).slice(0, 3);
    Object.assign(v, {
      rfe_ben: pRfeBen.full,
      rfe_employer: rfeEmployer,
      rfe_date: formatDate(addDays(filing, -rng.int(10, 40))),
      rfe_items: asked.map((id, k) => `• Item ${k + 1}: ${RFE_ITEMS[id][0]}`).join("\n"),
    });
    const realLetter = addDays(filing, -rng.int(5, 30));
    Object.assign(v, { bd_real: formatDate(realLetter), bd_date: formatDate(addDays(realLetter, -rng.int(60, 200))) });
    const bd = placeOptions(rng, `Don't prepare it. Tell ${pHr.first} you can't put a false date on a document, and forward the request to ${pAttorney.full} right away`, [
      "Prepare it with the earlier date: the employer signs it, so it's their statement",
      "Prepare it, but keep the real date in the file's history",
      `Prepare it and mention it to ${pAttorney.first} only if the agency asks`,
    ]);
    const bn = placeOptions(rng, `Tell ${ben.first} you can't give legal advice and that ${pAttorney.full} will reply, then pass the question to ${pAttorney.first} today`, [
      "Say yes: a pending extension doesn't affect travel",
      "Say no: travelling always cancels the extension",
      "Give your best guess, as long as you say it isn't legal advice",
    ]);
    LETTERS.forEach((l, j) => {
      v[`bd_${l}`] = bd.labels[j];
      v[`bn_${l}`] = bn.labels[j];
    });

    // ---- Rapid rounds, drawn last so the rest of the material doesn't shift when they change ----
    const rapidKeys = {
      "rapid-status": { items: buildStatus(rng, v) },
      "rapid-terms": { items: buildTerms(rng, v, ben) },
      "rapid-deadlines": { items: buildDeadlines(rng, v) },
    };

    return {
      values: v,
      keys: {
        ...rapidKeys,
        "forms-consistency": {
          findings: {
            identity: { targets: [idRow], reasons: ["identity"], note: notes.identity },
            job: { targets: [jobRow], reasons: ["job"], note: notes.job },
            wage: { targets: [wageRow], reasons: ["wage"], note: notes.wage },
            dates: { targets: [dateRow], reasons: ["dates"], note: notes.dates },
            worksite: { targets: ["worksite"], reasons: ["worksite"], note: notes.worksite },
          },
          decision: ["hold"],
        },
        "packet-checklist": {
          findings: {
            missing: { targets: [tab(missingRow)], reasons: ["missing"], note: `${tabNo(missingRow)} (${PACKET_ROWS[missingRow][0]}) is required and isn't in the packet.` },
            unsigned: { targets: [tab(unsignedRow)], reasons: ["unsigned"], note: `${tabNo(unsignedRow)} (${PACKET_ROWS[unsignedRow][0]}) still needs the employer's signature; only the signatory can sign it.` },
            fee: {
              targets: [tab("fee")],
              reasons: ["fee"],
              note: `With ${employees} U.S. employees the fees come to ${money(feeRight)}; the check is for ${money(feeWrong)}.`,
            },
            translation: {
              targets: [tab(translationRow)],
              reasons: ["translation"],
              note: `${tabNo(translationRow)} (${PACKET_ROWS[translationRow][0]}) is in ${language} with no certified English translation.`,
            },
            not_valid: {
              targets: [tab(notValidRow)],
              reasons: ["not_valid"],
              note:
                notValidRow === "wa"
                  ? "The wage attestation in the packet isn't certified yet, so the petition can't rely on it."
                  : "The passport copy is of an expired previous passport; the checklist needs the current one.",
            },
          },
          decision: ["hold"],
        },
        "inbox-rfe": { correct: ["cover", "notice", ...asked] },
        "inbox-backdate": { correct: [bd.letter] },
        "inbox-beneficiary": { correct: [bn.letter] },
      },
    };
  },
});
