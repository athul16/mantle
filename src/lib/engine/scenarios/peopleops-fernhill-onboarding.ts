import "server-only";

import type { Rng } from "../server/rng";
import { defineScenario } from "../server/scenario";
import { DOCUMENT_REVIEW } from "../step-types/document_review/public";
import { MULTIPLE_CHOICE } from "../step-types/multiple_choice/public";
import { RAPID_ROUND } from "../step-types/rapid_round/public";
import { SPREADSHEET } from "../step-types/spreadsheet/public";
import { hrPeople, type HrPerson } from "./hr/names";
import {
  addDays,
  courtDaysAfter,
  daysBetween,
  federalHolidays,
  formatDate,
  holidaysBetween,
  isCourtDay,
  isWeekend,
  weekdayOf,
  type IsoDate,
} from "./legal/dates";

/**
 * HR / people operations coordinator at Fernhill Outdoor Co. (fictional, about
 * 600 employees, one U.S. state that follows the federal overtime rule). A
 * dozen people started in the last three weeks and payroll closes tomorrow.
 * Six timed sections, 50 minutes, 100 points, all scored automatically:
 *
 *   rapid round A, onboarding dates (10) → onboarding file audit (20) → rapid
 *   round B, policy calls (10) → pay changes for the period (20) → rapid round
 *   C, applicant screening (10) → desk, one screen at a time: offer letter
 *   check (12), hiring metrics (8) and five judgment calls (2 each).
 *
 * Seeded per candidate: every name, date, rate, salary and count; which hire,
 * pay line and offer term carries which trap; the pay calendar's holiday rule;
 * and where the right option sits. Business days are Monday to Friday except
 * the federal holidays (Fernhill's HR office closes on them), using the shared
 * date helpers in ./legal/dates.ts; every date stays in 2026 to 2028.
 *
 * Rapid rounds: 15 items × 20 s. Items 3, 6, 9, 12, 15 are the harder kinds,
 * worth 1; the other ten are worth ½, so each round is exactly 10.
 *
 * Draft v1: practitioner review pending (docs/hr/peopleops-fernhill-onboarding.md).
 */

const SLUG = "peopleops-fernhill-onboarding";
const LETTERS = ["a", "b", "c", "d"] as const;
const STORES = [
  "Ridgeline",
  "Cedar Flats",
  "Millbrook",
  "Stonefield",
  "Harbor Point",
  "Juniper Hill",
  "Alder Creek",
  "Granite Pass",
];
const POSITIONS = [
  "Sales associate",
  "Stockroom associate",
  "Cashier",
  "Bike technician",
  "Rental desk associate",
  "Distribution center picker",
  "Visual merchandiser",
  "Customer service associate",
];

type Values = Record<string, string>;
type ChoiceKey = Record<string, { choice: string }>;

const F = (d: IsoDate) => formatDate(d);
const fmt = (n: number) => n.toLocaleString("en-US");
const money = (c: number) =>
  `$${(c / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const dateBetween = (rng: Rng, from: IsoDate, to: IsoDate) =>
  addDays(from, rng.int(0, daysBetween(from, to)));
const firstOfNextMonth = (d: IsoDate): IsoDate => {
  const y = Number(d.slice(0, 4));
  const m = Number(d.slice(5, 7));
  return m === 12
    ? `${y + 1}-01-01`
    : `${y}-${String(m + 1).padStart(2, "0")}-01`;
};
const lastOfMonth = (d: IsoDate) => addDays(firstOfNextMonth(d), -1);
const dayName = (d: IsoDate) => formatDate(d).slice(0, 3);
const hoursLabel = (n: number) => (n === 1 ? "1 hour" : `${n} hours`);
const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0);
/** Business days in [from, to]: weekdays the HR office is open. */
function businessDays(from: IsoDate, to: IsoDate): IsoDate[] {
  const out: IsoDate[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) if (isCourtDay(d)) out.push(d);
  return out;
}
/** n weekdays after `from`, ignoring holidays: the "forgot the holiday" miscount. */
function weekdaysAfter(from: IsoDate, n: number): IsoDate {
  let d = from;
  for (let left = n; left > 0;) {
    d = addDays(d, 1);
    if (!isWeekend(d)) left--;
  }
  return d;
}
const closures = (from: IsoDate, to: IsoDate, none: string) => {
  const list = holidaysBetween(from, to);
  return list.length
    ? list.map((h) => `${F(h.date)} (${h.name})`).join("; ")
    : none;
};
/** `n` whole numbers in [lo, hi] that add up to `total`, or null when they can't. */
function spread(
  rng: Rng,
  n: number,
  total: number,
  lo: number,
  hi: number,
): number[] | null {
  if (total < n * lo || total > n * hi) return null;
  const out = Array.from({ length: n }, () => lo);
  for (let left = total - n * lo; left > 0; left--) {
    const open = out.map((h, i) => (h < hi ? i : -1)).filter((i) => i >= 0);
    out[rng.pick(open)]++;
  }
  return out;
}
const dailyText = (days: IsoDate[], hours: number[], sep: string) =>
  days.length
    ? days.map((d, i) => `${dayName(d)} ${hours[i]}`).join(sep)
    : "no hours";
const dailyExcess = (hours: number[]) =>
  sum(hours.map((h) => Math.max(0, h - 8)));

// ---- Rapid round plumbing ----

const RAPID_ITEMS = 15;
/** Items 3, 6, 9, 12 and 15 are worth 1; the rest ½. 10 points a round. */
const isHardSlot = (i: number) => i % 3 === 2;
const slotNo = (i: number) => String(i + 1).padStart(2, "0");

function fillSlots<T>(easy: T[], hard: T[]): T[] {
  const e = [...easy];
  const h = [...hard];
  const out = Array.from({ length: RAPID_ITEMS }, (_, i) =>
    isHardSlot(i) ? h.shift() : e.shift(),
  );
  if (out.some((x) => x === undefined) || e.length || h.length)
    throw new Error(`${SLUG}: rapid slots don't fill`);
  return out as T[];
}

const letterOptions = (name: string) =>
  LETTERS.map((l) => ({ id: l, label: `{{${name}_${l}}}` }));

function rapidStep(
  id: string,
  title: string,
  intro: string,
  prefix: string,
  rows: number,
) {
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
            rows: Array.from({ length: rows }, (_, r) => ({
              label: `{{${prefix}_${n}_l${r + 1}}}`,
              value: `{{${prefix}_${n}_v${r + 1}}}`,
            })),
          },
          fields: [
            {
              id: "answer",
              label: "Answer",
              kind: "choice",
              options: letterOptions(`${prefix}_${n}`),
            },
          ],
          points: isHardSlot(i) ? 1 : 0.5,
        };
      }),
    },
  };
}

/** Puts `right` among `wrong` in a random place; returns the labels by letter and the right letter. */
function placeOptions(
  rng: Rng,
  right: string,
  wrong: string[],
): { labels: string[]; letter: string } {
  if (wrong.length !== 3 || new Set([right, ...wrong]).size !== 4)
    throw new Error(`${SLUG}: options must be 4 different labels (${right})`);
  const labels = rng.shuffle([right, ...wrong]);
  return { labels, letter: LETTERS[labels.indexOf(right)] };
}

/** The first three distinct candidates that aren't the right answer, or null when there aren't three. */
function threeWrong(right: string, candidates: string[]): string[] | null {
  const wrong = [...new Set(candidates)].filter((c) => c !== right).slice(0, 3);
  return wrong.length === 3 ? wrong : null;
}

interface Built {
  title: string;
  prompt: string;
  rows: [string, string][];
  right: string;
  wrong: string[];
}
type Maker = () => Built | null;

function buildRound(
  rng: Rng,
  v: Values,
  prefix: string,
  rowCount: number,
  easy: Maker[],
  hard: Maker[],
): Record<string, ChoiceKey> {
  const slots = fillSlots(rng.shuffle(easy), rng.shuffle(hard));
  return Object.fromEntries(
    slots.map((make, i) => {
      const n = slotNo(i);
      let q: Built | null = null;
      for (let tries = 0; !q; tries++) {
        if (tries > 5_000)
          throw new Error(`${SLUG}: no item for ${prefix}-${n}`);
        q = make();
      }
      if (q.rows.length !== rowCount)
        throw new Error(
          `${SLUG}: ${prefix} items need ${rowCount} exhibit rows`,
        );
      const { labels, letter } = placeOptions(rng, q.right, q.wrong);
      v[`${prefix}_${n}`] = q.prompt;
      v[`${prefix}_${n}_title`] = q.title;
      q.rows.forEach(([l, val], r) => {
        v[`${prefix}_${n}_l${r + 1}`] = l;
        v[`${prefix}_${n}_v${r + 1}`] = val;
      });
      LETTERS.forEach((l, j) => (v[`${prefix}_${n}_${l}`] = labels[j]));
      return [`${prefix}-${n}`, { answer: { choice: letter } }];
    }),
  );
}

// ---- Rapid round A: onboarding dates ----

const RD_FIRST = "2026-09-01";
const RD_LAST = "2028-08-31";
const S2_RULE =
  "Section 2 is due within 3 business days of the first day of work (first day Monday, due Thursday). Business days are Monday to Friday when the HR office is open.";
const BENEFITS_RULE =
  "Benefits start on the 1st of the month after the employee completes 30 days of employment. The first day of work is day 1.";

interface RapidCtx {
  rng: Rng;
  pool: HrPerson[];
  ackDays: number;
  ptoRate: string;
}
const someone = (c: RapidCtx) => c.rng.pick(c.pool);

function s2Item(c: RapidCtx, hard: boolean): Built | null {
  const { rng } = c;
  const start = dateBetween(rng, RD_FIRST, RD_LAST);
  if (!isCourtDay(start)) return null;
  const due = courtDaysAfter(start, 3);
  if (holidaysBetween(addDays(start, 1), due).length > 0 !== hard) return null;
  const wrong = threeWrong(
    F(due),
    [
      weekdaysAfter(start, 3),
      addDays(start, 3),
      courtDaysAfter(start, 2),
      courtDaysAfter(start, 4),
      addDays(due, 7),
    ].map(F),
  );
  if (!wrong) return null;
  const p = someone(c);
  return {
    title: "Form I-9 tracker",
    prompt: `By what date must Section 2 of ${p.full}'s Form I-9 be completed?`,
    rows: [
      ["New hire", `${p.full} · ${rng.pick(POSITIONS)}`],
      ["First day of work", F(start)],
      ["Rule", S2_RULE],
      [
        "HR office closed",
        closures(start, addDays(start, 14), "No closures in these two weeks"),
      ],
      ["Section 1", `Signed ${F(start)}`],
    ],
    right: F(due),
    wrong,
  };
}

function benefitsItem(c: RapidCtx, hard: boolean): Built | null {
  const { rng } = c;
  const d = dateBetween(rng, RD_FIRST, "2028-08-15");
  const dom = Number(d.slice(8));
  if (!hard && (dom < 2 || dom > 27)) return null;
  const start = hard ? lastOfMonth(d) : d;
  const day30 = addDays(start, 29);
  const due = firstOfNextMonth(day30);
  const wrong = threeWrong(
    F(due),
    [
      firstOfNextMonth(start),
      day30,
      `${day30.slice(0, 8)}01`,
      addDays(start, 30),
      firstOfNextMonth(addDays(start, 59)),
    ].map(F),
  );
  if (!wrong) return null;
  const p = someone(c);
  return {
    title: "Benefits enrollment",
    prompt: `On what date do ${p.full}'s benefits start?`,
    rows: [
      ["New hire", `${p.full} · ${rng.pick(POSITIONS)}`],
      ["First day of work", F(start)],
      ["Rule", BENEFITS_RULE],
      ["Example", "First day Mar 8 → day 30 is Apr 6 → benefits start May 1"],
      ["Plans", "Medical, dental and vision"],
    ],
    right: F(due),
    wrong,
  };
}

function ackItem(c: RapidCtx): Built | null {
  const { rng } = c;
  const start = dateBetween(rng, RD_FIRST, RD_LAST);
  if (!isCourtDay(start)) return null;
  const n = c.ackDays;
  const due = addDays(start, n);
  const wrong = threeWrong(
    F(due),
    [
      addDays(due, -1),
      addDays(due, 1),
      courtDaysAfter(start, n),
      addDays(due, 7),
    ].map(F),
  );
  if (!wrong) return null;
  const p = someone(c);
  return {
    title: "Handbook acknowledgement",
    prompt: `By what date is ${p.full}'s signed handbook acknowledgement due?`,
    rows: [
      ["New hire", `${p.full} · ${rng.pick(POSITIONS)}`],
      ["First day of work", F(start)],
      [
        "Rule",
        `The signed acknowledgement is due ${n} calendar days after the first day of work (the first day is day 0), even when that day falls on a weekend.`,
      ],
      ["Received", "Not yet"],
      ["Reminder sent", F(addDays(start, rng.int(1, 3)))],
    ],
    right: F(due),
    wrong,
  };
}

function ptoItem(c: RapidCtx): Built | null {
  const { rng } = c;
  const rate = Math.round(Number(c.ptoRate) * 100);
  const periods = rng.int(3, 14);
  const used = rng.pick([0, 8, 16, 24]);
  const balance = rate * periods - used * 100;
  if (balance < 100) return null;
  const label = (h: number) => `${(h / 100).toFixed(2)} hours`;
  const wrong = threeWrong(
    label(balance),
    [
      balance - rate,
      balance + rate,
      rate * periods + used * 100,
      rate * periods,
      Math.round((rate * periods) / 2) - used * 100,
    ]
      .filter((h) => h > 0)
      .map(label),
  );
  if (!wrong) return null;
  const p = someone(c);
  return {
    title: "PTO balance",
    prompt: `What is ${p.full}'s PTO balance today?`,
    rows: [
      ["Employee", `${p.full} · full-time`],
      ["Accrual", `${c.ptoRate} hours per biweekly pay period`],
      ["Pay periods completed since hire", String(periods)],
      ["PTO used so far", `${used} hours`],
      ["Carryover", "None (first year of employment)"],
    ],
    right: label(balance),
    wrong,
  };
}

const FMLA_OPTIONS = {
  none: "Eligible",
  service: "Not eligible: under 12 months of service",
  hours: "Not eligible: under 1,250 hours",
  nearby: "Not eligible: under 50 employees within 75 miles",
} as const;

function fmlaItem(c: RapidCtx): Built | null {
  const { rng } = c;
  const fail = rng.pick([
    "none",
    "none",
    "service",
    "hours",
    "nearby",
  ] as const);
  const leave = dateBetween(rng, "2027-06-01", RD_LAST);
  const hired =
    fail === "service"
      ? addDays(leave, -(365 - rng.int(10, 90)))
      : addDays(leave, -(365 + rng.int(10, 120)));
  const hours =
    fail === "hours" ? 1250 - rng.int(6, 120) : 1250 + rng.int(6, 600);
  const nearby = fail === "nearby" ? rng.int(18, 47) : 50 + rng.int(3, 400);
  const p = someone(c);
  return {
    title: "FMLA eligibility",
    prompt: `Is ${p.full} eligible for FMLA leave? The rule: at least 12 months of service, at least 1,250 hours worked in the 12 months before the leave, and at least 50 employees within 75 miles of the worksite.`,
    rows: [
      ["Employee", `${p.full} · ${rng.pick(STORES)} store`],
      ["Hired", F(hired)],
      ["Leave starts", F(leave)],
      ["Hours worked, last 12 months", fmt(hours)],
      ["Employees within 75 miles of the worksite", fmt(nearby)],
    ],
    right: FMLA_OPTIONS[fail],
    wrong: Object.values(FMLA_OPTIONS).filter((o) => o !== FMLA_OPTIONS[fail]),
  };
}

// ---- Rapid round B: policy calls ----

const OT_RULE =
  "Non-exempt staff get 1.5× pay for hours worked over 40 in the workweek; this state follows the federal rule, so there's no daily overtime. Holiday and PTO hours are paid but are not hours worked.";
const WORKWEEK_RULE =
  "Non-exempt staff get 1.5× pay for hours worked over 40 in a workweek (Sunday to Saturday); this state follows the federal rule, so there's no daily overtime.";

function weekDays(sunday: IsoDate, saturday: boolean): IsoDate[] {
  return [1, 2, 3, 4, 5, ...(saturday ? [6] : [])].map((i) =>
    addDays(sunday, i),
  );
}

function timecard(
  c: RapidCtx,
  employee: string,
  sunday: IsoDate,
  days: IsoDate[],
  hours: number[],
  paid: string,
  right: number,
  cands: number[],
): Built | null {
  const wrong = threeWrong(
    hoursLabel(right),
    cands.filter((x) => x >= 0).map(hoursLabel),
  );
  if (!wrong) return null;
  return {
    title: "Timecard",
    prompt: `How many overtime hours is ${employee.split(" ")[0]} owed for this workweek?`,
    rows: [
      ["Employee", employee],
      ["Workweek", `${F(sunday)} – ${F(addDays(sunday, 6))}`],
      ["Hours worked", dailyText(days, hours, " · ")],
      ["Paid time off this week", paid],
      ["Rule", OT_RULE],
    ],
    right: hoursLabel(right),
    wrong,
  };
}

const randomSunday = (rng: Rng) => {
  const d = dateBetween(rng, RD_FIRST, "2028-08-20");
  return addDays(d, -weekdayOf(d));
};

function otItem(c: RapidCtx): Built | null {
  const { rng } = c;
  const sunday = randomSunday(rng);
  if (holidaysBetween(sunday, addDays(sunday, 6)).length) return null;
  const days = weekDays(sunday, rng.int(0, 3) === 0);
  const total = rng.int(34, 46);
  const hours = spread(rng, days.length, total, 5, 11);
  if (!hours || !hours.some((h) => h > 8)) return null;
  const ot = Math.max(0, total - 40);
  const daily = dailyExcess(hours);
  if (daily === ot) return null;
  const p = someone(c);
  return timecard(
    c,
    `${p.full} · non-exempt, hourly`,
    sunday,
    days,
    hours,
    "None",
    ot,
    [daily, daily + ot, ot + 1, ot + 2, total - 32],
  );
}

function holidayWeekItem(c: RapidCtx): Built | null {
  const { rng } = c;
  const hol = rng.pick(
    federalHolidays(rng.pick([2026, 2027, 2028])).filter(
      (h) => !isWeekend(h.date) && h.date >= RD_FIRST && h.date <= "2028-08-20",
    ),
  );
  if (!hol) return null;
  const sunday = addDays(hol.date, -weekdayOf(hol.date));
  const days = weekDays(sunday, rng.int(0, 1) === 0).filter(
    (d) => d !== hol.date,
  );
  const total = rng.int(33, 44);
  const hours = spread(rng, days.length, total, 6, 11);
  if (!hours) return null;
  const ot = Math.max(0, total - 40);
  const p = someone(c);
  return timecard(
    c,
    `${p.full} · non-exempt, hourly`,
    sunday,
    days,
    hours,
    `${F(hol.date)}: company holiday (${hol.name}), 8 hours of holiday pay`,
    ot,
    [
      total + 8 - 40,
      dailyExcess(hours),
      dailyExcess(hours) + ot,
      ot + 1,
      ot + 4,
    ],
  );
}

function exemptItem(c: RapidCtx): Built | null {
  const { rng } = c;
  const sunday = randomSunday(rng);
  if (holidaysBetween(sunday, addDays(sunday, 6)).length) return null;
  const days = weekDays(sunday, rng.int(0, 1) === 0);
  const total = rng.int(46, 56);
  const hours = spread(rng, days.length, total, 8, 12);
  if (!hours) return null;
  const p = someone(c);
  const title = rng.pick([
    "Assistant Store Manager",
    "Distribution Center Supervisor",
    "Store Manager",
  ]);
  return timecard(
    c,
    `${p.full} · exempt, salaried (${title})`,
    sunday,
    days,
    hours,
    "None",
    0,
    [total - 40, dailyExcess(hours), total - 40 + 2, 8],
  );
}

function workweekItem(c: RapidCtx): Built | null {
  const { rng } = c;
  const sunday = randomSunday(rng);
  if (holidaysBetween(sunday, addDays(sunday, 13)).length) return null;
  const w1 = rng.int(42, 47);
  const w2 = rng.int(30, Math.min(40, 80 - w1));
  const d1 = weekDays(sunday, false);
  const d2 = weekDays(addDays(sunday, 7), false);
  const h1 = spread(rng, 5, w1, 6, 11);
  const h2 = spread(rng, 5, w2, 5, 10);
  if (!h1 || !h2) return null;
  const right = w1 - 40;
  const wrong = threeWrong(
    hoursLabel(right),
    [0, dailyExcess([...h1, ...h2]), right + 2, right + 1].map(hoursLabel),
  );
  if (!wrong) return null;
  const p = someone(c);
  return {
    title: "Timecard: two-week pay period",
    prompt: `How many overtime hours is ${p.first} owed for the pay period starting ${F(sunday)}?`,
    rows: [
      ["Employee", `${p.full} · non-exempt, hourly`],
      ["Week 1 hours worked", dailyText(d1, h1, " · ")],
      ["Week 2 hours worked", dailyText(d2, h2, " · ")],
      ["Paid time off", "None"],
      ["Rule", WORKWEEK_RULE],
    ],
    right: hoursLabel(right),
    wrong,
  };
}

const APPROVERS = [
  "Direct manager",
  "Store manager",
  "HR manager",
  "Direct manager and the HR manager",
];

function approverItem(c: RapidCtx): Built | null {
  const { rng } = c;
  const k = rng.pick([3, 5]);
  const roles = rng.shuffle(APPROVERS);
  const table: [string, string][] = [
    [`PTO, up to ${k} days`, roles[0]],
    [`PTO, more than ${k} days`, roles[1]],
    ["Overtime, before it's worked", roles[2]],
    ["Unpaid personal leave", roles[3]],
  ];
  const p = someone(c);
  const ask = rng.pick([
    "pto-in",
    "pto-edge",
    "pto-over",
    "ot",
    "unpaid",
  ] as const);
  let prompt: string;
  let right: string;
  if (ask === "ot") {
    prompt = `${p.full}'s shift lead wants ${p.first} to work 6 extra hours on Saturday, which will take them over 40. Who has to approve the overtime?`;
    right = roles[2];
  } else if (ask === "unpaid") {
    prompt = `${p.full} asks for three weeks of unpaid personal leave to travel. Who approves it?`;
    right = roles[3];
  } else {
    const d =
      ask === "pto-in" ? k - 1 : ask === "pto-edge" ? k : k + rng.int(1, 3);
    prompt = `${p.full} asks for ${d} days of PTO next month. Who approves it?`;
    right = d <= k ? roles[0] : roles[1];
  }
  return {
    title: "Approvals (handbook §4.2)",
    prompt,
    rows: [
      ...rng.shuffle(table),
      ["Employee", `${p.full} · ${rng.pick(POSITIONS)}`],
    ],
    right,
    wrong: APPROVERS.filter((r) => r !== right),
  };
}

const LEAVE_OPTIONS = [
  "Bereavement leave",
  "Jury duty leave",
  "FMLA leave",
  "PTO",
];

function leaveItem(c: RapidCtx): Built | null {
  const { rng } = c;
  const b = rng.pick([3, 5]);
  const j = rng.pick([5, 10]);
  const withGrand = rng.int(0, 1) === 1;
  const withInLaw = rng.int(0, 1) === 1;
  const family = [
    "spouse or domestic partner",
    "child",
    "parent",
    "sibling",
    ...(withGrand ? ["grandparent"] : []),
    ...(withInLaw ? ["parent-in-law"] : []),
  ];
  const p = someone(c);
  const kind = rng.pick([
    "bereave-in",
    "bereave-out",
    "jury",
    "fmla",
    "pto",
  ] as const);
  let prompt: string;
  let right: string;
  let eligible = rng.int(0, 1) === 1;
  if (kind === "bereave-in") {
    const rel = rng.pick([
      "parent",
      "sibling",
      "child",
      ...(withGrand ? ["grandparent", "grandparent"] : []),
      ...(withInLaw ? ["parent-in-law", "parent-in-law"] : []),
    ]);
    prompt = `${p.full} asks for time off for the death of their ${rel}. Which leave applies?`;
    right = "Bereavement leave";
  } else if (kind === "bereave-out") {
    const rel = rng.pick([
      "cousin",
      "aunt",
      "close friend",
      ...(withGrand ? [] : ["grandparent", "grandparent"]),
      ...(withInLaw ? [] : ["parent-in-law", "parent-in-law"]),
    ]);
    prompt = `${p.full} asks for time off for the death of their ${rel}. Which leave applies?`;
    right = "PTO";
  } else if (kind === "jury") {
    prompt = `${p.full} has a jury summons for ${F(dateBetween(rng, RD_FIRST, RD_LAST))} and asks for the day off. Which leave applies?`;
    right = "Jury duty leave";
  } else if (kind === "fmla") {
    eligible = true;
    prompt = `${p.full} ${rng.pick(["needs six weeks off to recover from knee surgery", "needs time off to care for their mother after heart surgery", "asks for leave after the birth of their child"])}. Which leave applies?`;
    right = "FMLA leave";
  } else {
    prompt = `${p.full} asks for ${rng.pick(["three days off for a friend's wedding", "a long weekend to go camping", "two days off to move house"])}. Which leave applies?`;
    right = "PTO";
  }
  return {
    title: "Leave types (handbook §5)",
    prompt,
    rows: [
      [
        "Bereavement leave",
        `Up to ${b} paid days for the death of an immediate family member: ${family.join(", ")}`,
      ],
      ["Jury duty leave", `Paid, up to ${j} days, with a copy of the summons`],
      [
        "FMLA leave",
        "Up to 12 weeks, unpaid and job-protected, for an eligible employee's own serious health condition, a family member's, or a new child",
      ],
      [
        "PTO",
        "Anything else: vacation, personal days and short illnesses, from the employee's balance",
      ],
      ["Employee", `${p.full} · FMLA-eligible: ${eligible ? "yes" : "no"}`],
    ],
    right,
    wrong: LEAVE_OPTIONS.filter((o) => o !== right),
  };
}

// ---- Rapid round C: applicant screening ----

type QualId =
  "exp" | "weekends" | "forklift" | "license" | "diploma" | "register";
const REQUISITIONS: { title: string; quals: QualId[] }[] = [
  { title: "Seasonal sales associate", quals: ["exp", "weekends", "register"] },
  { title: "Stockroom associate", quals: ["forklift", "weekends", "diploma"] },
  { title: "Delivery driver", quals: ["license", "diploma", "weekends"] },
  { title: "Cashier", quals: ["register", "weekends", "diploma"] },
  {
    title: "Distribution center picker",
    quals: ["forklift", "diploma", "exp"],
  },
  { title: "Rental desk associate", quals: ["exp", "license", "register"] },
];
const MEETS = "Meets the minimum qualifications";
const FAILS = "Does not meet the minimum qualifications";
const MORE = "Need more information";
type Outcome = "meets" | "fails" | "more";

function screeningItem(
  c: RapidCtx,
  outcome: Outcome,
  hard: boolean,
): Built | null {
  const { rng } = c;
  const req = rng.pick(REQUISITIONS);
  const asOf = dateBetween(rng, "2026-12-01", "2027-12-31");
  const years = rng.pick([1, 2]);
  const quals = rng.shuffle(req.quals);
  const bad = rng.pick(quals);
  const status = (q: QualId): "met" | "failed" | "missing" =>
    q !== bad || outcome === "meets"
      ? "met"
      : outcome === "fails"
        ? "failed"
        : "missing";
  const qualText: Record<QualId, string> = {
    exp: `At least ${years} year${years === 1 ? "" : "s"} of retail or customer-service experience`,
    weekends: "Available to work weekends",
    forklift: "Current forklift operator certification",
    license: "Valid driver's license",
    diploma: "High school diploma or GED",
    register: "At least 6 months of cash-register experience",
  };
  const fact = (q: QualId, ok: boolean): string => {
    switch (q) {
      case "exp":
        return `Work history: ${ok ? 12 * years + rng.int(0, 30) : rng.int(3, 12 * years - 1)} months of retail and customer-service experience in total`;
      case "weekends":
        return `Weekend availability: ${ok ? "yes" : "no"}`;
      case "forklift":
        return ok
          ? `Forklift certification: valid through ${F(addDays(asOf, rng.int(20, 400)))}`
          : `Forklift certification: expired ${F(addDays(asOf, -rng.int(5, 300)))}`;
      case "license":
        return ok
          ? "Driver's license: valid"
          : `Driver's license: suspended until ${F(addDays(asOf, rng.int(30, 200)))}`;
      case "diploma":
        return ok
          ? rng.pick(["Education: high school diploma", "Education: GED"])
          : "Education: did not finish high school; no GED";
      case "register": {
        const m = ok ? rng.int(6, 36) : rng.int(1, 5);
        return `Cash register: ${m} month${m === 1 ? "" : "s"}`;
      }
    }
  };
  const facts = quals
    .filter((q) => status(q) !== "missing")
    .map((q) => fact(q, status(q) === "met"));
  let driver: { note: string; option: string };
  if (hard) {
    driver = rng.pick([
      {
        note: "Interview note: said they plan to start a family next year",
        option: "Does not meet: likely to need family leave soon",
      },
      {
        note: `Interview note: mentioned they are ${rng.int(58, 66)}`,
        option: "Does not meet: close to retirement age",
      },
      {
        note: `Résumé: eight-month gap in ${rng.pick([2024, 2025])} for medical leave`,
        option: "Does not meet: the medical-leave gap is a risk",
      },
    ]);
  } else {
    const miles = rng.int(22, 45);
    const college = {
      note: "College: no degree",
      option: "Does not meet: no college degree",
    };
    const commute = {
      note: `Commute: ${miles} miles to the store`,
      option: `Does not meet: lives too far away (${miles} miles)`,
    };
    driver =
      outcome === "more" && bad === "diploma"
        ? commute
        : rng.pick([college, commute]);
  }
  facts.push(driver.note);
  if (facts.length < 4)
    facts.push(
      rng.pick([
        "Referred by a current employee",
        "Shift preference: mornings",
        "Applied through the careers page",
      ]),
    );
  if (facts.length !== 4) return null;
  const right =
    outcome === "meets" ? MEETS : outcome === "fails" ? FAILS : MORE;
  return {
    title: "Screening",
    prompt:
      "Screen this applicant against the requisition's minimum qualifications.",
    rows: [
      [
        "Requisition",
        `${req.title} · ${rng.pick(STORES)} store · screened ${F(asOf)}`,
      ],
      ["Minimum qualifications", quals.map((q) => qualText[q]).join("; ")],
      ...rng
        .shuffle(facts)
        .map((f, i) => [`Note ${i + 1}`, f] as [string, string]),
    ],
    right,
    wrong: [MEETS, FAILS, MORE, driver.option].filter((o) => o !== right),
  };
}

// ---- Steps ----

const rapidDatesStep = rapidStep(
  "rapid-dates",
  "Rapid round: onboarding dates",
  "Onboarding dates: 15 items, 20 seconds each. Each item shows the rule from Fernhill's desk card; pick the right date or answer.",
  "rd",
  5,
);
const rapidPolicyStep = rapidStep(
  "rapid-policy",
  "Rapid round: policy calls",
  "Policy calls: 15 items, 20 seconds each. Answer from the timecard or the handbook excerpt on each item.",
  "rp",
  5,
);
const rapidScreeningStep = rapidStep(
  "rapid-screening",
  "Rapid round: applicant screening",
  "Applicant screening: 15 applicants, 20 seconds each. Compare each applicant with the requisition's minimum qualifications and decide only on what the job requires.",
  "rs",
  6,
);

const AUDIT_ROWS = 12;
const AUDIT_COLS = [
  "name",
  "position",
  "offer",
  "start",
  "s1",
  "s2",
  "docs",
  "bg",
  "ack",
  "notes",
];
const auditStep = {
  id: "onboarding-audit",
  type: DOCUMENT_REVIEW,
  title: "Onboarding file audit",
  config: {
    prompt: [
      "Check the onboarding tracker for everyone who started in the last three weeks against the rules in the header.",
      "Flag each problem with its reason, then decide how you'll handle the files before next week's I-9 self-audit.",
    ].join("\n"),
    document: {
      title: "Onboarding tracker · new hires since {{audit_since}}",
      fields: [
        { id: "today", label: "Today", value: "{{today}}" },
        {
          id: "i9",
          label: "Form I-9 (USCIS)",
          value:
            "Section 1: by the end of the first day of work (it may be signed any time after the job offer is accepted). Section 2: within 3 business days of the first day of work.",
        },
        {
          id: "closed",
          label: "Business days",
          value:
            "Monday to Friday when the HR office is open. Closed: {{audit_closed}}",
        },
        {
          id: "docs",
          label: "Acceptable documents",
          value:
            "One from List A, or one from List B plus one from List C. List A: U.S. passport, Permanent Resident Card, Employment Authorization Document. List B: driver's license, state ID card, school ID card with photo, voter registration card. List C: Social Security card, U.S. birth certificate (certified copy).",
        },
        {
          id: "choice",
          label: "Document choice",
          value:
            "The employee chooses which acceptable documents to present. Fernhill staff may share the full list but must not ask for or suggest specific documents.",
        },
        {
          id: "bg",
          label: "Background check (handbook §2.3)",
          value:
            "Must clear on or before the start date. Nobody starts work before it clears.",
        },
        {
          id: "ack",
          label: "Handbook acknowledgement (§2.5)",
          value: "Due within {{ack_days}} calendar days after the start date.",
        },
      ],
      columns: [
        "Employee",
        "Position",
        "Offer signed",
        "Start date",
        "Section 1 signed",
        "Section 2 completed",
        "Documents examined",
        "Background check cleared",
        "Handbook ack.",
        "Notes",
      ],
      rows: Array.from({ length: AUDIT_ROWS }, (_, i) => ({
        id: `a${i + 1}`,
        cells: AUDIT_COLS.map((c) => `{{au_${i + 1}_${c}}}`),
      })),
      totals: [],
    },
    reasons: [
      { id: "s1_late", label: "Section 1 signed after the first day of work" },
      { id: "s2_late", label: "Section 2 later than 3 business days" },
      { id: "docs", label: "Not an acceptable document combination" },
      { id: "bg", label: "Started before the background check cleared" },
      { id: "ack", label: "Handbook acknowledgement overdue" },
      { id: "specified", label: "Hire was told which documents to bring" },
      { id: "other", label: "Other" },
    ],
    findings: [
      {
        id: "s1_late",
        label: "Section 1 signed after the first day of work",
        points: 3,
      },
      {
        id: "s2_late",
        label: "Section 2 completed after the third business day",
        points: 3,
      },
      { id: "docs", label: "Two List B documents and no List C", points: 3 },
      {
        id: "bg",
        label: "Started before the background check cleared",
        points: 3,
      },
      { id: "ack", label: "Handbook acknowledgement overdue", points: 3 },
      {
        id: "specified",
        label: "Recruiter told a hire which documents to bring",
        points: 3,
      },
    ],
    falseFlagPenalty: 1,
    decision: {
      prompt:
        "The I-9 self-audit is next week. What do you do with these files?",
      options: [
        {
          id: "report",
          label:
            "Send {{hr_first}} the list today and correct going forward: finish anything missing now, and add a signed, dated note to each form that explains the late or corrected entry",
        },
        {
          id: "redate",
          label:
            "Redate the late entries to the dates they should have had, so the files are clean for the audit",
        },
        {
          id: "ask_docs",
          label:
            "Email the hires whose documents were wrong and ask each of them to bring a U.S. passport tomorrow",
        },
        {
          id: "leave",
          label:
            "Leave the files as they are: everyone has already started, so it's too late to change anything",
        },
      ],
      points: 2,
    },
  },
};

const PAY_ROWS = 8;
const payStep = {
  id: "pay-changes",
  type: SPREADSHEET,
  title: "Pay changes for the period",
  config: {
    prompt: [
      "Enter each employee's gross pay for the pay period {{pp_start}} – {{pp_end}}, in dollars and cents.",
      "Pay calendar: two workweeks, Sunday to Saturday, paid {{pp_paid}}. Company holiday: {{pp_holiday}}. {{pp_rule}}",
      "Salaried staff are paid 1/26 of the annual salary each period. Prorate by working days: per-period salary × days paid ÷ working days in the period.",
      "Hourly staff: hours × rate. Holiday pay (8 hours, for anyone employed on the holiday) is paid at the regular rate but isn't hours worked. Hours worked over 40 in a workweek are paid at 1.5× the rate; there is no daily overtime.",
      "Round only the final amount to the cent.",
    ].join("\n"),
    columns: [
      "Employee",
      "Pay",
      "Change this period",
      "Time this period",
      "Gross pay ($)",
    ],
    rows: Array.from({ length: PAY_ROWS }, (_, i) => [
      `{{pc_${i + 1}_name}}`,
      `{{pc_${i + 1}_pay}}`,
      `{{pc_${i + 1}_change}}`,
      `{{pc_${i + 1}_time}}`,
      {
        input: `p${i + 1}`,
        label: `Line ${i + 1}: gross pay`,
        format: "money",
        points: 2.5,
      },
    ]),
  },
};

const OFFER_ROWS = 9;
const offerStep = {
  id: "offer-check",
  type: DOCUMENT_REVIEW,
  seconds: 240,
  title: "Offer letter vs. the approved requisition",
  config: {
    prompt:
      "Check {{oc_first}}'s draft offer letter against the approved requisition, the pay band and the handbook. Flag every term that's wrong, with the reason, then decide what happens to the letter.",
    document: {
      title: "Offer letter check · {{oc}} · {{oc_title}}",
      fields: [
        {
          id: "req",
          label: "Requisition",
          value: "{{oc_req}} · approved {{oc_appr}} by {{hm}}",
        },
        {
          id: "band",
          label: "Pay band",
          value: "{{oc_grade}}: {{oc_band_lo}}–{{oc_band_hi}} a year",
        },
        {
          id: "check",
          label: "Background check",
          value:
            "Background check ordered {{oc_ordered}}; the vendor needs up to {{oc_bg_days}} business days to clear it. HR office closed: {{oc_closed}}",
        },
        {
          id: "handbook",
          label: "Handbook",
          value:
            "PTO accrues {{pto_rate}} hours per pay period; benefits start on the 1st of the month after 30 days of employment",
        },
      ],
      columns: ["Term", "Offer letter (draft)", "Approved requisition"],
      rows: Array.from({ length: OFFER_ROWS }, (_, i) => ({
        id: `o${i + 1}`,
        cells: ["term", "offer", "appr"].map((c) => `{{of_${i + 1}_${c}}}`),
      })),
      totals: [],
    },
    reasons: [
      { id: "mismatch", label: "Doesn't match the approved requisition" },
      {
        id: "too_early",
        label: "Starts before the background check can clear",
      },
      { id: "out_of_band", label: "Outside the pay band" },
      { id: "other", label: "Other" },
    ],
    findings: [
      { id: "salary", label: "Salary differs from the approval", points: 2.5 },
      { id: "flsa", label: "Wrong FLSA status for the role", points: 2.5 },
      {
        id: "start",
        label: "Start date before the background check can clear",
        points: 2.5,
      },
      { id: "bonus", label: "Bonus not approved", points: 2.5 },
    ],
    falseFlagPenalty: 1,
    decision: {
      prompt: "{{hm_first}} wants the letter out today. What do you do?",
      options: [
        {
          id: "send",
          label:
            "Send it today as it is: {{hm_first}} is in a hurry and the differences are small",
        },
        {
          id: "fix",
          label:
            "Fix the salary, status, start date and bonus yourself and send it today",
        },
        {
          id: "hold",
          label:
            "Hold the letter and return it to {{rec_first}} with the corrections; it goes out once they're fixed and approved",
        },
        {
          id: "later",
          label:
            "Let it go out today and fix the terms in a follow-up letter once it's accepted",
        },
      ],
      points: 2,
    },
  },
};

const REQ_ROWS = 6;
const COST_ROWS = 5;
const metricsStep = {
  id: "hiring-metrics",
  type: SPREADSHEET,
  seconds: 150,
  title: "Hiring metrics for last quarter",
  config: {
    prompt: [
      "Work out last quarter's four hiring metrics from the data below, using Fernhill's definitions.",
      "Turnover rate = separations ÷ average headcount ((start + end) ÷ 2) × 100, to one decimal.",
      "Average days to fill = the mean of calendar days from opened to filled, filled requisitions only, to one decimal.",
      "Offer acceptance rate = offers accepted ÷ offers extended × 100, to one decimal.",
      "Cost per hire = recruiting costs ÷ hires, to the cent. Recruiting costs are advertising, agency fees, background checks and recruiter time; orientation after the start date isn't a recruiting cost.",
    ].join("\n"),
    columns: ["Item", "Figure", "Your answer"],
    rows: [
      ["Headcount on {{hm_q0}}", { text: "{{hm_h0}}", align: "right" }, null],
      ["Headcount on {{hm_q1}}", { text: "{{hm_h1}}", align: "right" }, null],
      [
        "Separations in the quarter (voluntary and involuntary)",
        { text: "{{hm_seps}}", align: "right" },
        null,
      ],
      ...Array.from({ length: REQ_ROWS }, (_, i) => [
        `{{hm_req_${i + 1}}}`,
        `{{hm_req_${i + 1}_dates}}`,
        null,
      ]),
      [
        "Offers extended in the quarter",
        { text: "{{hm_ext}}", align: "right" },
        null,
      ],
      ["Offers accepted", { text: "{{hm_acc}}", align: "right" }, null],
      ["Hires in the quarter", { text: "{{hm_hires}}", align: "right" }, null],
      ...Array.from({ length: COST_ROWS }, (_, i) => [
        `{{hm_cost_${i + 1}}}`,
        { text: `{{hm_cost_${i + 1}_amt}}`, align: "right" },
        null,
      ]),
      [
        { text: "Turnover rate (%)", bold: true },
        "",
        {
          input: "turnover",
          label: "Turnover rate (%)",
          format: "number",
          points: 2,
        },
      ],
      [
        { text: "Average days to fill", bold: true },
        "",
        {
          input: "days_to_fill",
          label: "Average days to fill",
          format: "number",
          points: 2,
        },
      ],
      [
        { text: "Offer acceptance rate (%)", bold: true },
        "",
        {
          input: "acceptance",
          label: "Offer acceptance rate (%)",
          format: "number",
          points: 2,
        },
      ],
      [
        { text: "Cost per hire ($)", bold: true },
        "",
        {
          input: "cost_per_hire",
          label: "Cost per hire ($)",
          format: "money",
          points: 2,
        },
      ],
    ],
  },
};

const valuesStep = (
  id: string,
  title: string,
  prompt: string,
  prefix: string,
) => ({
  id,
  type: MULTIPLE_CHOICE,
  seconds: 66,
  title,
  config: {
    prompt,
    options: letterOptions(prefix),
    select: "single",
    points: 2,
  },
});
const clientCareStep = valuesStep(
  "values-client-care",
  "Judgment: a manager asks about a leave",
  "{{hm_first}} wants to know why {{lv_first}} is out. What do you do?",
  "vcc",
);
const integrityStep = valuesStep(
  "values-integrity",
  "Judgment: a date on a Form I-9",
  "{{hm_first}} wants {{ig_first}}'s Section 2 dated earlier. What do you do?",
  "vig",
);
const candorStep = valuesStep(
  "values-candor",
  "Judgment: the offer you sent",
  "{{rec_first}} found the wrong salary in the offer you sent {{cd_first}}. What do you do?",
  "vcd",
);
const inLaneStep = valuesStep(
  "values-in-lane",
  "Judgment: a report made in confidence",
  "{{nh_first}} asks you to keep a harassment report secret. What do you do?",
  "vil",
);
const qualityStep = valuesStep(
  "values-quality",
  "Judgment: a start before the check clears",
  "{{hm_first}} wants {{qh_first}} to start Monday. What do you do?",
  "vql",
);

const SIGN_HR = "{{hr}}\nHR Manager, Fernhill Outdoor Co.";
const DEFINITION = {
  intro:
    "You're the people operations coordinator at Fernhill Outdoor Co., an outdoor gear retailer with about 600 employees in its stores and distribution center. Fernhill operates in one U.S. state that follows the federal overtime rule (over 40 hours in the workweek, no daily overtime). A dozen people started in the last three weeks and payroll closes tomorrow. The work comes in six timed parts, 50 minutes in all: three rapid rounds (onboarding dates, policy calls, applicant screening), an onboarding file audit, this period's pay changes, and a desk of short tasks shown one at a time. A finished part can't be reopened. The people and the company are fictional; the federal rules cited (Form I-9, the FLSA, the FMLA, the ADA) are real, and Fernhill's own policies are printed on each task.",
  steps: [
    rapidDatesStep,
    auditStep,
    rapidPolicyStep,
    payStep,
    rapidScreeningStep,
    offerStep,
    metricsStep,
    clientCareStep,
    integrityStep,
    candorStep,
    inLaneStep,
    qualityStep,
  ],
  messages: [
    {
      id: "m-welcome",
      from: "HR manager",
      subject: "Welcome to the desk",
      body: [
        "Hi {{first_name}},",
        "",
        "Welcome to the people operations desk. It's a busy week: twelve people started in the last three weeks, payroll for the period that ended Saturday closes tomorrow at noon, and offers are going out.",
        "",
        "The basics: about 600 of us across the stores and the distribution center, all in one state that follows the federal overtime rule. The HR office closes on the federal holidays. Medical and leave details stay in the confidential leave file; managers get dates and work restrictions only. Any harassment or discrimination report comes to me the same day. Each task has the part of the handbook or the desk card it needs.",
        "",
        SIGN_HR,
      ].join("\n"),
      arriveAtMinute: 0,
    },
    {
      id: "m-audit",
      from: "HR manager",
      subject: "Onboarding files before the I-9 self-audit",
      body: [
        "Hi {{first_name}},",
        "",
        "Before next week's I-9 self-audit, please check the onboarding tracker for everyone who started in the last three weeks: Form I-9 timing and documents, background checks and handbook acknowledgements.",
        "",
        "Flag each problem with the reason and tell me how you'll handle the files. Please don't change a date on any signed form.",
        "",
        SIGN_HR,
      ].join("\n"),
      arriveAtMinute: 0,
      stepId: "onboarding-audit",
    },
    {
      id: "m-new-hire",
      from: "New hire",
      subject: "Benefits question",
      body: [
        "Hi {{first_name}},",
        "",
        "I'm {{nh}}, I started on {{nh_start}} at the {{nh_store}} store. Quick question: when do my benefits start? Thanks so much!",
        "",
        "{{nh_first}}",
      ].join("\n"),
      arriveAtMinute: 2,
      stepId: "onboarding-audit",
    },
    {
      id: "m-move",
      from: "Recruiter",
      subject: "Tracker fix: one start date",
      body: [
        "Hi {{first_name}},",
        "{{mv}}'s start moved back a week: the first day was {{mv_new}}, not {{mv_old}}. The tracker still shows the old date. Sorry, I didn't update it.",
        "",
        "{{rec}}",
      ].join("\n"),
      arriveAtMinute: 4,
      stepId: "onboarding-audit",
    },
    {
      id: "m-pay",
      from: "Payroll specialist",
      subject: "Pay changes: payroll closes tomorrow at noon",
      body: [
        "Hi {{first_name}},",
        "",
        "Eight people have a change this period. The sheet has each one's pay, the change and their time. Please work out each gross amount for the period; the calendar and the rules are at the top.",
        "",
        "Start dates on the change list come from the onboarding tracker, so tell me if you know of a change.",
        "",
        "{{pay}}",
      ].join("\n"),
      arriveAtMinute: 0,
      stepId: "pay-changes",
    },
    {
      id: "m-pay-fix",
      from: "Payroll specialist",
      subject: "Correction: one effective date",
      body: [
        "Hi {{first_name}},",
        "",
        "Correction for {{rs}}: the raise is effective {{rs_e2}}, not {{rs_e1}}. {{hm_first}} confirmed it this morning; the change list had a typo.",
        "",
        "{{pay}}",
      ].join("\n"),
      arriveAtMinute: 4,
      stepId: "pay-changes",
    },
    {
      id: "m-offer",
      from: "Recruiter",
      subject: "Offer letter for {{oc}}",
      body: [
        "Hi {{first_name}},",
        "",
        "Could you check {{oc_first}}'s offer letter against the approved requisition before it goes out? {{hm_first}} wants it sent today; they're worried about losing {{oc_first}} to another offer.",
        "",
        "{{rec}}",
      ].join("\n"),
      arriveAtMinute: 0,
      stepId: "offer-check",
    },
    {
      id: "m-metrics",
      from: "HR manager",
      subject: "Hiring numbers for Thursday",
      body: [
        "Hi {{first_name}},",
        "",
        "For Thursday's leadership meeting I need last quarter's four hiring numbers. The data and our definitions are in the sheet.",
        "",
        SIGN_HR,
      ].join("\n"),
      arriveAtMinute: 0,
      stepId: "hiring-metrics",
    },
    {
      id: "m-client-care",
      from: "Hiring manager",
      subject: "{{lv_first}}?",
      body: [
        "Hey {{first_name}},",
        "",
        "{{lv}} on my team has been out for three weeks and I just heard it'll be six in total. What's going on? Is it something serious? I need to know what I'm dealing with.",
        "",
        "{{hm}}",
      ].join("\n"),
      arriveAtMinute: 0,
      stepId: "values-client-care",
    },
    {
      id: "m-integrity",
      from: "Hiring manager",
      subject: "Quick favor on {{ig_first}}'s I-9",
      body: [
        "Hey {{first_name}},",
        "",
        "The Section 2 for {{ig}} was done on {{ig_done}} and the auditors are in next week. Can you just put {{ig_early}} on it instead? Same documents, nobody will know the difference.",
        "",
        "{{hm}}",
      ].join("\n"),
      arriveAtMinute: 0,
      stepId: "values-integrity",
    },
    {
      id: "m-candor",
      from: "Recruiter",
      subject: "{{cd_first}}'s offer",
      body: [
        "Hi {{first_name}},",
        "",
        "I was looking over the offer you sent {{cd}} yesterday: it says {{cd_sent}} a year, but the approved salary is {{cd_appr}}. They haven't signed yet. How do you want to handle it?",
        "",
        "{{rec}}",
      ].join("\n"),
      arriveAtMinute: 0,
      stepId: "values-candor",
    },
    {
      id: "m-in-lane",
      from: "New hire",
      subject: "Can I tell you something?",
      body: [
        "Hi {{first_name}},",
        "",
        "Can I tell you something just between us? One of the shift leads keeps making comments about my body when we close the store together, and it's getting worse. Please don't tell anyone, I don't want any trouble.",
        "",
        "{{nh_first}}",
      ].join("\n"),
      arriveAtMinute: 0,
      stepId: "values-in-lane",
    },
    {
      id: "m-quality",
      from: "Hiring manager",
      subject: "{{qh_first}} on Monday",
      body: [
        "Hey {{first_name}},",
        "",
        "{{qh}} can start Monday, {{qh_monday}}. The background check hasn't cleared yet, but it always does. Let's bring them in so we're covered for the weekend rush. OK?",
        "",
        "{{hm}}",
      ].join("\n"),
      arriveAtMinute: 0,
      stepId: "values-quality",
    },
  ],
  sections: [
    {
      id: "s-rapid-a",
      title: "Rapid round: onboarding dates",
      minutes: 6,
      stepIds: ["rapid-dates"],
    },
    {
      id: "s-work-1",
      title: "Onboarding file audit",
      minutes: 10,
      stepIds: ["onboarding-audit"],
    },
    {
      id: "s-rapid-b",
      title: "Rapid round: policy calls",
      minutes: 6,
      stepIds: ["rapid-policy"],
    },
    {
      id: "s-work-2",
      title: "Pay changes",
      minutes: 10,
      stepIds: ["pay-changes"],
    },
    {
      id: "s-rapid-c",
      title: "Rapid round: applicant screening",
      minutes: 6,
      stepIds: ["rapid-screening"],
    },
    {
      id: "s-desk",
      title: "Desk: offer, metrics and judgment calls",
      minutes: 12,
      stepIds: [
        "offer-check",
        "hiring-metrics",
        "values-client-care",
        "values-integrity",
        "values-candor",
        "values-in-lane",
        "values-quality",
      ],
      oneAtATime: true,
    },
  ],
};

// ---- Leak guard ----

/**
 * The candidate's screen must not show a computed answer in any form (12.34,
 * 1,234.56, 1234 as cents). Pay and metric answers are never printed, but a
 * value can collide with a rate, salary or count by chance, so the generator
 * draws again when it does.
 */
const STATIC_TEXT = JSON.stringify(DEFINITION);
function leakForms(value: number): RegExp[] {
  const forms = [
    JSON.stringify(value),
    value.toFixed(2),
    String(Math.round(value * 100)),
    value.toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }),
  ];
  return [...new Set(forms)]
    .filter((f) => !/^\d{1,3}$/.test(f))
    .map(
      (s) =>
        new RegExp(`(?<![\\d.,])${s.replace(/[.$]/g, "\\$&")}(?![\\d.]\\d)`),
    );
}
function leaks(values: Values, numbers: number[]): boolean {
  const text = `${STATIC_TEXT}\n${Object.values(values).join("\n")}`;
  return numbers.some(
    (n) => n >= 1 && leakForms(n).some((re) => re.test(text)),
  );
}

// ---- Generator ----

interface Period {
  p0: IsoDate;
  pe: IsoDate;
  holiday: IsoDate;
  holidayName: string;
  today: IsoDate;
}

/** A biweekly pay period (Sunday to Saturday) with exactly one weekday federal holiday in it; today is the Wednesday after. */
function pickPeriod(rng: Rng): Period {
  for (;;) {
    const year = rng.pick([2026, 2027, 2028]);
    const hols = federalHolidays(year).filter(
      (h) =>
        !isWeekend(h.date) && h.date >= "2026-10-01" && h.date <= "2028-08-15",
    );
    if (!hols.length) continue;
    const h = rng.pick(hols);
    const sunday = addDays(h.date, -weekdayOf(h.date));
    const p0 = rng.int(0, 1) ? sunday : addDays(sunday, -7);
    const off = daysBetween(p0, h.date);
    if (off < 3 || off > 12) continue;
    const pe = addDays(p0, 13);
    const today = addDays(pe, 4);
    if (holidaysBetween(p0, pe).length !== 1 || !isCourtDay(today)) continue;
    return { p0, pe, holiday: h.date, holidayName: h.name, today };
  }
}

type AuditKind =
  | "s2_late"
  | "s1_late"
  | "docs"
  | "bg"
  | "ack"
  | "specified"
  | "ok_s2_holiday"
  | "ok_list_a"
  | "ok_bg_same_day"
  | "ok_ack_pending"
  | "moved"
  | "ok_note_list";
const AUDIT_KINDS: AuditKind[] = [
  "s2_late",
  "s1_late",
  "docs",
  "bg",
  "ack",
  "specified",
  "ok_s2_holiday",
  "ok_list_a",
  "ok_bg_same_day",
  "ok_ack_pending",
  "moved",
  "ok_note_list",
];
const LIST_A = [
  "U.S. passport",
  "Permanent Resident Card",
  "Employment Authorization Document",
];
const LIST_B = [
  "Driver's license",
  "State ID card",
  "School ID card with photo",
  "Voter registration card",
];
const LIST_C = [
  "Social Security card",
  "U.S. birth certificate (certified copy)",
];
const NOISE_NOTES = [
  "Direct deposit form received",
  "Uniform ordered",
  "Parking permit issued",
  "Asked about the tuition benefit",
  "Emergency contact form received",
  "—",
];

interface AuditRow {
  kind: AuditKind;
  person: HrPerson;
  position: string;
  offer: IsoDate;
  start: IsoDate;
  s1: IsoDate;
  s2: IsoDate;
  docs: string;
  bg: IsoDate;
  ack: string;
  note: string;
  keyNote: string;
}

function buildAudit(
  rng: Rng,
  period: Period,
  ackDays: number,
  people: HrPerson[],
  movedNew: IsoDate,
): AuditRow[] | null {
  const T = period.today;
  const window = businessDays(addDays(T, -24), addDays(T, -1));
  const pickStart = (ok: (s: IsoDate) => boolean) => {
    const c = window.filter(ok);
    return c.length ? rng.pick(c) : null;
  };
  const cleanDocs = () =>
    rng.int(0, 2) === 0
      ? `List A: ${rng.pick(LIST_A)}`
      : `List B: ${rng.pick(LIST_B)}; List C: ${rng.pick(LIST_C)}`;
  const rows: AuditRow[] = [];
  const kinds = rng.shuffle(AUDIT_KINDS);
  for (let i = 0; i < kinds.length; i++) {
    const kind = kinds[i];
    const person = people[i];
    const N = ackDays;
    let start: IsoDate | null;
    switch (kind) {
      case "s2_late":
        start = pickStart((s) => courtDaysAfter(s, 6) <= T);
        break;
      case "ack":
        start = pickStart((s) => addDays(s, N + 5) <= T);
        break;
      case "bg":
        start = pickStart(
          (s) => addDays(s, 5) <= T && courtDaysAfter(s, 3) <= T,
        );
        break;
      case "ok_s2_holiday":
        start = pickStart(
          (s) =>
            s < period.holiday &&
            courtDaysAfter(s, 3) >= period.holiday &&
            courtDaysAfter(s, 3) <= T,
        );
        break;
      case "ok_ack_pending":
        start = pickStart((s) => addDays(s, N) >= T);
        break;
      case "moved":
        start = movedNew;
        break;
      default:
        start = pickStart((s) => courtDaysAfter(s, 3) <= T);
    }
    if (!start) return null;
    const due = courtDaysAfter(start, 3);
    // Defaults: everything on time.
    let s2 = rng.pick(businessDays(start, due < T ? due : T));
    let bg = addDays(start, -rng.int(1, 10));
    let offer = addDays(bg, -rng.int(2, 12));
    let s1 = addDays(
      start,
      -rng.int(0, Math.min(4, daysBetween(offer, start) - 1)),
    );
    let docs = cleanDocs();
    let ack = F(addDays(start, rng.int(0, Math.min(N, daysBetween(start, T)))));
    let note = rng.pick(NOISE_NOTES);
    let shownStart = start;
    let keyNote = "";
    const who = person.full;
    switch (kind) {
      case "s2_late":
        s2 = courtDaysAfter(start, rng.int(4, 6));
        keyNote = `${who}'s Section 2 was completed ${F(s2)}; the third business day after the ${F(start)} start was ${F(due)}.`;
        break;
      case "s1_late":
        s1 = courtDaysAfter(start, 1);
        s2 = courtDaysAfter(start, rng.int(2, 3));
        keyNote = `${who} signed Section 1 on ${F(s1)}, after the first day of work (${F(start)}).`;
        break;
      case "docs": {
        const [b1, b2] = rng.shuffle(LIST_B);
        docs = `List B: ${b1}; List C: ${b2}`;
        keyNote = `${who}'s file shows a ${b2.toLowerCase()} in the List C slot: that's a List B document, so there is no List C document.`;
        break;
      }
      case "bg":
        bg = addDays(start, rng.int(1, Math.min(5, daysBetween(start, T))));
        offer = addDays(start, -rng.int(5, 20));
        s1 = addDays(start, -rng.int(0, 3));
        keyNote = `${who} started ${F(start)} but the background check cleared ${F(bg)}.`;
        break;
      case "ack": {
        const lateBy = rng.int(1, 5);
        if (rng.int(0, 1)) {
          ack = F(addDays(start, N + lateBy));
          keyNote = `${who}'s acknowledgement came in ${ack}; it was due ${F(addDays(start, N))}.`;
        } else {
          ack = "Not received";
          keyNote = `${who}'s acknowledgement was due ${F(addDays(start, N))} and still isn't in.`;
        }
        break;
      }
      case "specified": {
        const ask = rng.pick([
          { text: "a U.S. passport", docs: "List A: U.S. passport" },
          {
            text: "a driver's license and a Social Security card",
            docs: "List B: Driver's license; List C: Social Security card",
          },
          {
            text: "a Permanent Resident Card",
            docs: "List A: Permanent Resident Card",
          },
        ]);
        docs = ask.docs;
        note = `Recruiter's welcome email asked ${person.first} to bring ${ask.text} for the I-9`;
        keyNote = `The recruiter told ${who} which documents to bring (${ask.text}); the employee chooses, and asking for specific documents risks document abuse.`;
        break;
      }
      case "ok_s2_holiday":
        s2 = due;
        break;
      case "ok_list_a":
        docs = `List A: ${rng.pick(LIST_A)}`;
        break;
      case "ok_bg_same_day":
        bg = start;
        offer = addDays(start, -rng.int(5, 20));
        break;
      case "ok_ack_pending":
        ack = "Not received";
        break;
      case "ok_note_list":
        note = `Recruiter sent ${person.first} the full list of acceptable documents; ${person.first} chose their own`;
        break;
      case "moved": {
        shownStart = addDays(start, -7);
        s2 = courtDaysAfter(start, rng.int(1, 3));
        if (s2 > T) s2 = courtDaysAfter(start, 1);
        if (s2 > T) return null;
        bg = addDays(shownStart, rng.int(1, 7));
        s1 = addDays(shownStart, -rng.int(0, 3));
        offer = addDays(s1, -rng.int(3, 12));
        ack =
          daysBetween(start, T) >= 0
            ? F(addDays(start, rng.int(0, Math.min(N, daysBetween(start, T)))))
            : "Not received";
        break;
      }
    }
    if (s1 < offer) s1 = offer;
    rows.push({
      kind,
      person,
      position: rng.pick(POSITIONS),
      offer,
      start: shownStart,
      s1,
      s2,
      docs,
      bg,
      ack,
      note,
      keyNote,
    });
  }
  return rows.sort((a, b) => a.start.localeCompare(b.start));
}

type PayKind =
  | "start"
  | "raise"
  | "ot"
  | "unpaid"
  | "payout"
  | "retro"
  | "holiday"
  | "exempt";
const PAY_KINDS: PayKind[] = [
  "start",
  "raise",
  "ot",
  "unpaid",
  "payout",
  "retro",
  "holiday",
  "exempt",
];

function buildOnce(rng: Rng) {
  const v: Values = {};
  const people = hrPeople(rng, 48);
  const [hr, rec, hm, pay, oc, lv, ig, cd, qh, ...rest] = people;
  const auditPeople = rest.slice(0, AUDIT_ROWS);
  const payPeople = rest.slice(AUDIT_ROWS, AUDIT_ROWS + 7);
  const pool = rest.slice(AUDIT_ROWS + 7);
  const store = rng.pick(STORES);
  const ackDays = rng.pick([5, 7, 10, 14]);
  const ptoRate = rng.pick(["3.08", "3.69", "4.62", "6.15"]);
  const period = pickPeriod(rng);
  const T = period.today;
  const holidayCounts = rng.int(0, 1) === 1;
  const W = holidayCounts ? 10 : 9;
  Object.assign(v, {
    hr: hr.full,
    hr_first: hr.first,
    rec: `${rec.full}\nRecruiter, Fernhill Outdoor Co.`,
    rec_first: rec.first,
    hm: `${hm.full}\nStore Manager, ${store}`,
    hm_first: hm.first,
    pay: `${pay.full}\nPayroll Specialist`,
    today: F(T),
    ack_days: String(ackDays),
    pto_rate: ptoRate,
  });

  // ---- Pay period and the new hire whose start moved ----
  const { p0, pe, holiday } = period;
  const working = (d: IsoDate) =>
    !isWeekend(d) && (holidayCounts || d !== holiday);
  const daysPaid = (from: IsoDate, to: IsoDate) => {
    let n = 0;
    for (let d = from; d <= to; d = addDays(d, 1)) if (working(d)) n++;
    return n;
  };
  const weekdaysIn = (from: IsoDate, to: IsoDate) => {
    const out: IsoDate[] = [];
    for (let d = from; d <= to; d = addDays(d, 1))
      if (!isWeekend(d) && d !== holiday) out.push(d);
    return out;
  };
  const movedNew = rng.pick(weekdaysIn(addDays(p0, 2), addDays(holiday, -1)));

  // ---- Onboarding file audit ----
  let audit: AuditRow[] | null = null;
  for (let tries = 0; !audit; tries++) {
    if (tries > 500) throw new Error(`${SLUG}: no onboarding tracker`);
    audit = buildAudit(rng, period, ackDays, auditPeople, movedNew);
  }
  const auditKey: Record<
    string,
    { targets: string[]; reasons: string[]; note: string }
  > = {};
  audit.forEach((r, i) => {
    const k = i + 1;
    Object.assign(v, {
      [`au_${k}_name`]: r.person.full,
      [`au_${k}_position`]: r.position,
      [`au_${k}_offer`]: F(r.offer),
      [`au_${k}_start`]: F(r.start),
      [`au_${k}_s1`]: F(r.s1),
      [`au_${k}_s2`]: F(r.s2),
      [`au_${k}_docs`]: r.docs,
      [`au_${k}_bg`]: F(r.bg),
      [`au_${k}_ack`]: r.ack,
      [`au_${k}_notes`]: r.note,
    });
    if (r.keyNote)
      auditKey[r.kind] = {
        targets: [`a${k}`],
        reasons: [r.kind],
        note: r.keyNote,
      };
  });
  const moved = audit.find((r) => r.kind === "moved")!;
  const newHire = audit.find((r) => r.kind === "ok_list_a")!;
  Object.assign(v, {
    audit_since: F(audit[0].start),
    audit_closed: closures(
      addDays(T, -35),
      addDays(T, 5),
      "no closures in this window",
    ),
    mv: moved.person.full,
    mv_new: F(movedNew),
    mv_old: F(moved.start),
    nh: newHire.person.full,
    nh_first: newHire.person.first,
    nh_start: F(newHire.start),
    nh_store: store,
  });

  // ---- Pay changes ----
  Object.assign(v, {
    pp_start: F(p0),
    pp_end: F(pe),
    pp_paid: F(addDays(pe, 6)),
    pp_holiday: `${F(holiday)} (${period.holidayName})`,
    pp_rule: holidayCounts
      ? "Working days for proration: 10 (Monday to Friday; the holiday counts as a working day)."
      : "Working days for proration: 9 (Monday to Friday, not counting the holiday).",
  });
  const perPeriod = () => 5 * rng.int(320, 640) * 100;
  const rate = () => 5 * rng.int(320, 540);
  const salaried = (per: number) =>
    `Salaried, exempt · ${money(per * 26)} a year`;
  const hourly = (r: number) => `Hourly, non-exempt · ${money(r)} an hour`;
  const wk1 = weekdaysIn(addDays(p0, 1), addDays(p0, 5));
  const wk2 = weekdaysIn(addDays(p0, 8), addDays(p0, 12));
  const holidayWeek = holiday <= addDays(p0, 6) ? 0 : 1;
  const weeks = [wk1, wk2];
  const timeText = (h: number[][], hol: 0 | 8, days: IsoDate[][] = weeks) =>
    `Week 1: ${dailyText(days[0], h[0], ", ")} · Week 2: ${dailyText(days[1], h[1], ", ")} · Holiday pay: ${hol} h`;
  const hourlyPay = (r: number, h: number[][], hol: number) => {
    const worked = h.map(sum);
    return (
      r * (sum(worked) + hol) +
      0.5 * r * sum(worked.map((x) => Math.max(0, x - 40)))
    );
  };
  /** Hours for each weekday worked in the week, in [lo, hi], adding to a total in [tLo, tHi]. */
  const weekHours = (
    days: IsoDate[],
    tLo: number,
    tHi: number,
    lo: number,
    hi: number,
  ) => {
    for (;;) {
      const h = spread(rng, days.length, rng.int(tLo, tHi), lo, hi);
      if (h) return h;
    }
  };

  const payKinds = rng.shuffle(PAY_KINDS);
  const others = [...payPeople];
  const payCells: Record<string, { value: number }> = {};
  let raiseName = "";
  let raiseE1 = p0;
  let raiseE2 = p0;
  payKinds.forEach((kind, i) => {
    const k = i + 1;
    let name = "";
    let payText = "";
    let change = "";
    let time = "Salaried: no timecard";
    let c = 0;
    switch (kind) {
      case "start": {
        const per = perPeriod();
        name = moved.person.full;
        payText = salaried(per);
        change = `New hire: first day ${F(moved.start)} (from the onboarding tracker)`;
        c = (per * daysPaid(movedNew, pe)) / W;
        break;
      }
      case "raise": {
        const per = perPeriod();
        const newPer = per + 5 * rng.int(4, 24) * 100;
        const choices = weekdaysIn(addDays(p0, 2), addDays(p0, 12));
        const [e1, e2] = rng.shuffle(choices);
        const approved = addDays(p0, -rng.int(2, 20));
        name = others.pop()!.full;
        raiseName = name;
        raiseE1 = e1;
        raiseE2 = e2;
        payText = salaried(per);
        change = `Raise to ${money(newPer * 26)} a year: approved ${F(approved)}, effective ${F(e1)}`;
        c =
          (per * daysPaid(p0, addDays(e2, -1)) + newPer * daysPaid(e2, pe)) / W;
        break;
      }
      case "unpaid": {
        const per = perPeriod();
        const u = rng.int(2, 4);
        const off = rng
          .shuffle(weekdaysIn(addDays(p0, 1), addDays(p0, 12)))
          .slice(0, u)
          .sort();
        name = others.pop()!.full;
        payText = salaried(per);
        change = `Unpaid FMLA leave: ${u} full days: ${off.map(F).join("; ")}`;
        c = (per * (W - u)) / W;
        break;
      }
      case "exempt": {
        const per = perPeriod();
        name = others.pop()!.full;
        payText = salaried(per);
        change = `Worked ${rng.int(48, 56)} hours in week ${rng.int(1, 2)} for the inventory count; ${hm.first} asked about overtime`;
        c = per;
        break;
      }
      case "ot": {
        const r = rate();
        let h: number[][];
        for (;;) {
          h = weeks.map((days, w) =>
            w === holidayWeek
              ? weekHours(days, 24, 32, 6, 8)
              : weekHours(days, 41, 46, 6, 11),
          );
          const worked = h.map(sum);
          if (
            dailyExcess(h.flat()) !==
            sum(worked.map((x) => Math.max(0, x - 40)))
          )
            break;
        }
        name = others.pop()!.full;
        payText = hourly(r);
        change = "Extra shifts for the seasonal sale";
        time = timeText(h, 8);
        c = hourlyPay(r, h, 8);
        break;
      }
      case "holiday": {
        const r = rate();
        const h = weeks.map((days, w) =>
          w === holidayWeek
            ? weekHours(days, 33, 44, 6, 11)
            : weekHours(days, 30, 40, 6, 8),
        );
        name = others.pop()!.full;
        payText = hourly(r);
        change = "Extra shifts in the holiday week";
        time = timeText(h, 8);
        c = hourlyPay(r, h, 8);
        break;
      }
      case "retro": {
        const r0 = rate();
        const r1 = r0 + 5 * rng.int(10, 40);
        const h0 = rng.int(64, 80);
        const h = weeks.map((days) =>
          weekHours(days, Math.min(24, 6 * days.length), 8 * days.length, 6, 8),
        );
        name = others.pop()!.full;
        payText = hourly(r1);
        change = `Raise to ${money(r1)} an hour, effective ${F(addDays(p0, -14))}, missed in last period's pay (${h0} hours paid at ${money(r0)})`;
        time = timeText(h, 8);
        c = hourlyPay(r1, h, 8) + (r1 - r0) * h0;
        break;
      }
      case "payout": {
        const r = rate();
        const last = rng.pick(weekdaysIn(addDays(p0, 2), addDays(p0, 11)));
        const days = weeks.map((w) => w.filter((d) => d <= last));
        const h = days.map((d) =>
          d.length ? weekHours(d, 6 * d.length, 8 * d.length, 6, 8) : [],
        );
        const hol = holiday <= last ? 8 : 0;
        const pto = rng.int(8, 60);
        name = others.pop()!.full;
        payText = hourly(r);
        change = `Leaving: last day ${F(last)}; unused PTO to pay out: ${pto} hours`;
        time = timeText(h, hol, days);
        c = hourlyPay(r, h, hol) + r * pto;
        break;
      }
    }
    Object.assign(v, {
      [`pc_${k}_name`]: name,
      [`pc_${k}_pay`]: payText,
      [`pc_${k}_change`]: change,
      [`pc_${k}_time`]: time,
    });
    payCells[`p${k}`] = { value: Math.round(c) / 100 };
  });
  Object.assign(v, { rs: raiseName, rs_e1: F(raiseE1), rs_e2: F(raiseE2) });

  // ---- Offer letter ----
  const roles = [
    { title: "Assistant Store Manager", exempt: true },
    { title: "Distribution Center Supervisor", exempt: true },
    { title: "Store Operations Coordinator", exempt: false },
    { title: "Merchandising Lead", exempt: false },
  ];
  const role = rng.pick(roles);
  const lo = 1000 * rng.int(44, 56);
  const hi = lo + 1000 * rng.int(12, 20);
  const approvedSalary = 250 * rng.int((lo + 2000) / 250, (hi - 4000) / 250);
  let offeredSalary = approvedSalary;
  while (
    offeredSalary === approvedSalary ||
    offeredSalary < lo ||
    offeredSalary > hi
  )
    offeredSalary =
      approvedSalary + 250 * rng.pick([-8, -6, -4, -2, 2, 4, 6, 8]);
  const approvedBonus = rng.pick([0, 5, 8]);
  const offeredBonus = rng.pick(
    [5, 8, 10, 12, 15].filter((p) => p !== approvedBonus),
  );
  const ordered = rng.pick(businessDays(addDays(T, -2), T));
  const bgDays = rng.pick([3, 5, 7]);
  const earliest = courtDaysAfter(ordered, bgDays);
  const startChoices = businessDays(addDays(T, 1), addDays(earliest, -1));
  if (!startChoices.length) return null;
  const offerStart = rng.pick(startChoices);
  const exemptText = "Exempt";
  const nonExemptText = "Non-exempt (overtime-eligible)";
  const bonusText = (p: number) =>
    p ? `Target ${p}% of base salary` : "Not eligible";
  const reportsTo = `${hm.full}, Store Manager`;
  const offerRows: {
    term: string;
    offer: string;
    appr: string;
    finding?: "salary" | "flsa" | "start" | "bonus";
    note?: string;
  }[] = [
    { term: "Position", offer: role.title, appr: role.title },
    { term: "Location", offer: `${store} store`, appr: `${store} store` },
    { term: "Reports to", offer: reportsTo, appr: reportsTo },
    {
      term: "Base salary",
      offer: `$${fmt(offeredSalary)} a year`,
      appr: `$${fmt(approvedSalary)} a year`,
      finding: "salary",
      note: `The letter offers $${fmt(offeredSalary)}; the requisition approved $${fmt(approvedSalary)}. It's inside the band, but the approval is what counts.`,
    },
    {
      term: "FLSA status",
      offer: role.exempt ? nonExemptText : exemptText,
      appr: role.exempt ? exemptText : nonExemptText,
      finding: "flsa",
      note: `The ${role.title} role is approved as ${role.exempt ? "exempt" : "non-exempt"}; the letter says ${role.exempt ? "non-exempt" : "exempt"}.`,
    },
    {
      term: "Start date",
      offer: F(offerStart),
      appr: "On or after the background check clears",
      finding: "start",
      note: `The check was ordered ${F(ordered)} and can take until ${F(earliest)}; a ${F(offerStart)} start comes first.`,
    },
    {
      term: "Annual bonus",
      offer: bonusText(offeredBonus),
      appr: bonusText(approvedBonus),
      finding: "bonus",
      note: `The letter offers a ${offeredBonus}% bonus target; the requisition approved ${approvedBonus ? `${approvedBonus}%` : "no bonus"}.`,
    },
    {
      term: "PTO",
      offer: `${ptoRate} hours of PTO each pay period`,
      appr: `Handbook: ${ptoRate} hours per pay period`,
    },
    {
      term: "Benefits",
      offer:
        "Medical, dental and vision from the 1st of the month after 30 days of employment",
      appr: "Handbook: 1st of the month after 30 days",
    },
  ];
  const offerOrder = rng.shuffle(offerRows);
  const offerKey: Record<
    string,
    { targets: string[]; reasons: string[]; note: string }
  > = {};
  offerOrder.forEach((r, i) => {
    Object.assign(v, {
      [`of_${i + 1}_term`]: r.term,
      [`of_${i + 1}_offer`]: r.offer,
      [`of_${i + 1}_appr`]: r.appr,
    });
    if (r.finding)
      offerKey[r.finding] = {
        targets: [`o${i + 1}`],
        reasons: [r.finding === "start" ? "too_early" : "mismatch"],
        note: r.note!,
      };
  });
  Object.assign(v, {
    oc: oc.full,
    oc_first: oc.first,
    oc_title: role.title,
    oc_req: `R-${rng.int(2100, 2999)}`,
    oc_appr: F(addDays(T, -rng.int(5, 20))),
    oc_grade: `Grade ${rng.pick(["S3", "S4", "S5", "M1", "M2"])}`,
    oc_band_lo: `$${fmt(lo)}`,
    oc_band_hi: `$${fmt(hi)}`,
    oc_ordered: F(ordered),
    oc_bg_days: String(bgDays),
    oc_closed: closures(ordered, addDays(earliest, 7), "none in this window"),
  });

  // ---- Hiring metrics (the calendar quarter before today's) ----
  const ty = Number(T.slice(0, 4));
  const tq = Math.floor((Number(T.slice(5, 7)) - 1) / 3);
  const [qy, qn] = tq === 0 ? [ty - 1, 3] : [ty, tq - 1];
  const q0 = `${qy}-${String(qn * 3 + 1).padStart(2, "0")}-01`;
  const q1 = addDays(
    qn === 3
      ? `${qy + 1}-01-01`
      : `${qy}-${String(qn * 3 + 4).padStart(2, "0")}-01`,
    -1,
  );
  const h0 = rng.int(560, 640);
  const h1 = h0 + rng.int(-25, 25);
  const seps = rng.int(14, 48);
  const reqTitles = rng.shuffle([
    ...POSITIONS,
    "Assistant Store Manager",
    "Store Operations Coordinator",
  ]);
  const openIdx = rng.int(0, REQ_ROWS - 1);
  const fills: number[] = [];
  for (let i = 0; i < REQ_ROWS; i++) {
    const opened = dateBetween(rng, q0, addDays(q1, -50));
    v[`hm_req_${i + 1}`] =
      `Requisition R-${rng.int(1100, 1999)} (${reqTitles[i]})`;
    if (i === openIdx)
      v[`hm_req_${i + 1}_dates`] = `Opened ${F(opened)} · still open`;
    else {
      const d = rng.int(14, 49);
      fills.push(d);
      v[`hm_req_${i + 1}_dates`] =
        `Opened ${F(opened)} · filled ${F(addDays(opened, d))}`;
    }
  }
  const ext = rng.int(28, 60);
  const acc = ext - rng.int(2, 14);
  const hires = rng.int(Math.max(14, acc - 8), acc);
  const costs: [string, number, boolean][] = [
    ["Cost: job board advertising", rng.cents(2_000, 9_000), true],
    ["Cost: staffing agency fees", rng.cents(4_000, 18_000), true],
    ["Cost: background checks", 100 * hires * rng.int(35, 65), true],
    ["Cost: recruiter time (internal)", rng.cents(9_000, 22_000), true],
    [
      "Cost: new-hire orientation (after the start date)",
      rng.cents(1_500, 6_000),
      false,
    ],
  ];
  rng
    .shuffle(costs)
    .forEach(([label, amt], i) =>
      Object.assign(v, {
        [`hm_cost_${i + 1}`]: label,
        [`hm_cost_${i + 1}_amt`]: money(amt),
      }),
    );
  const recruiting = sum(costs.filter((x) => x[2]).map((x) => x[1]));
  Object.assign(v, {
    hm_q0: F(q0),
    hm_q1: F(q1),
    hm_h0: fmt(h0),
    hm_h1: fmt(h1),
    hm_seps: fmt(seps),
    hm_ext: fmt(ext),
    hm_acc: fmt(acc),
    hm_hires: fmt(hires),
  });
  const metricCells = {
    turnover: {
      value: Number(((100 * seps) / ((h0 + h1) / 2)).toFixed(1)),
      tolerance: 0.05,
    },
    days_to_fill: {
      value: Number((sum(fills) / fills.length).toFixed(1)),
      tolerance: 0.05,
    },
    acceptance: {
      value: Number(((100 * acc) / ext).toFixed(1)),
      tolerance: 0.05,
    },
    cost_per_hire: {
      value: Math.round(recruiting / hires) / 100,
      tolerance: 0.01,
    },
  };

  // ---- Judgment calls ----
  const returns = F(addDays(T, rng.int(10, 25)));
  const igDone = rng.pick(businessDays(addDays(T, -10), addDays(T, -2)));
  const sentSalary = 250 * rng.int(180, 260);
  const apprSalary =
    sentSalary + 250 * rng.pick([-12, -8, -6, -4, 4, 6, 8, 12]);
  const monday = addDays(T, 5);
  Object.assign(v, {
    lv: lv.full,
    lv_first: lv.first,
    ig: ig.full,
    ig_first: ig.first,
    ig_done: F(igDone),
    ig_early: F(addDays(igDone, -2)),
    cd: cd.full,
    cd_first: cd.first,
    cd_sent: `$${fmt(sentSalary)}`,
    cd_appr: `$${fmt(apprSalary)}`,
    qh: qh.full,
    qh_first: qh.first,
    qh_monday: F(monday),
  });
  const calls: Record<
    string,
    { prefix: string; right: string; wrong: string[] }
  > = {
    "values-client-care": {
      prefix: "vcc",
      right: `Tell ${hm.first} only that ${lv.first} is on approved leave until ${returns}, and help plan cover; the reason stays in the confidential leave file`,
      wrong: [
        `Tell ${hm.first} the medical details: as ${lv.first}'s manager, they need the full picture`,
        `Hint that it's medical and ask ${hm.first} to keep it quiet`,
        `Refuse to discuss ${lv.first} at all and refer ${hm.first} to the company's outside lawyers`,
      ],
    },
    "values-integrity": {
      prefix: "vig",
      right: `Don't backdate: leave ${F(igDone)} on the form, attach a signed, dated note explaining why Section 2 was late, and tell ${hr.first}`,
      wrong: [
        `Change it to ${F(addDays(igDone, -2))} as asked: the documents were the same, so nothing material changes`,
        "Change it, but keep a private note of the real date in case anyone asks",
        `Report ${hm.first} to the immigration authorities right away`,
      ],
    },
    "values-candor": {
      prefix: "vcd",
      right: `Own it: tell ${hr.first} today that you sent the wrong salary, and work with ${rec.first} on a corrected, approved letter before ${cd.first} signs`,
      wrong: [
        `Wait and see whether ${cd.first} notices before saying anything`,
        `Quietly send ${cd.first} a corrected letter without telling ${hr.first}`,
        `Withdraw ${cd.first}'s offer altogether to be safe`,
      ],
    },
    "values-in-lane": {
      prefix: "vil",
      right: `Explain that you can't keep it secret, that it will be shared only with those who need to know, and take it to ${hr.first} today`,
      wrong: [
        "Promise to keep it between the two of you, as asked",
        "Talk to the shift lead yourself and tell them to stop",
        "Call the police and the company's outside lawyers right away",
      ],
    },
    "values-quality": {
      prefix: "vql",
      right: `Keep the start date until the check clears, not before: tell ${hm.first} that ${qh.first} starts once it clears, and chase the vendor today`,
      wrong: [
        `Agree to Monday: ${hm.first} is the hiring manager, so it's their call`,
        `Let ${qh.first} start Monday on paperwork-only shifts until the check clears`,
        `Cancel the hire and reopen the requisition`,
      ],
    },
  };
  const callKeys: Record<string, { correct: string[] }> = {};
  for (const [id, call] of Object.entries(calls)) {
    const { labels, letter } = placeOptions(rng, call.right, call.wrong);
    LETTERS.forEach((l, j) => (v[`${call.prefix}_${l}`] = labels[j]));
    callKeys[id] = { correct: [letter] };
  }

  // ---- Rapid rounds, drawn last so the rest of the material doesn't shift when they change ----
  const ctx: RapidCtx = { rng, pool, ackDays, ptoRate };
  const easyOutcomes = rng.shuffle<Outcome>([
    "meets",
    "meets",
    "meets",
    "meets",
    "fails",
    "fails",
    "fails",
    "more",
    "more",
    "more",
  ]);
  const hardOutcomes = rng.shuffle<Outcome>([
    "meets",
    "meets",
    "fails",
    "fails",
    "more",
  ]);
  const rapidKeys = {
    "rapid-dates": {
      items: buildRound(
        rng,
        v,
        "rd",
        5,
        [
          ...Array(3).fill(() => s2Item(ctx, false)),
          ...Array(3).fill(() => benefitsItem(ctx, false)),
          () => ackItem(ctx),
          () => ackItem(ctx),
          () => ptoItem(ctx),
          () => ptoItem(ctx),
        ],
        [
          () => s2Item(ctx, true),
          () => s2Item(ctx, true),
          () => benefitsItem(ctx, true),
          () => fmlaItem(ctx),
          () => fmlaItem(ctx),
        ],
      ),
    },
    "rapid-policy": {
      items: buildRound(
        rng,
        v,
        "rp",
        5,
        [
          ...Array(3).fill(() => otItem(ctx)),
          ...Array(3).fill(() => approverItem(ctx)),
          ...Array(4).fill(() => leaveItem(ctx)),
        ],
        [
          () => holidayWeekItem(ctx),
          () => holidayWeekItem(ctx),
          () => exemptItem(ctx),
          () => exemptItem(ctx),
          () => workweekItem(ctx),
        ],
      ),
    },
    "rapid-screening": {
      items: buildRound(
        rng,
        v,
        "rs",
        6,
        easyOutcomes.map((o) => () => screeningItem(ctx, o, false)),
        hardOutcomes.map((o) => () => screeningItem(ctx, o, true)),
      ),
    },
  };

  return {
    values: v,
    numbers: [...Object.values(payCells), ...Object.values(metricCells)].map(
      (c) => c.value,
    ),
    keys: {
      ...rapidKeys,
      "onboarding-audit": { findings: auditKey, decision: ["report"] },
      "pay-changes": { tolerance: 0.02, cells: payCells },
      "offer-check": { findings: offerKey, decision: ["hold"] },
      "hiring-metrics": { tolerance: 0.05, cells: metricCells },
      ...callKeys,
    },
  };
}

export const peopleopsFernhillOnboarding = defineScenario({
  slug: SLUG,
  version: 1,
  title: "Fernhill: people operations coordinator",
  roleFamily: "hr",
  timeLimitMinutes: 50,
  definition: DEFINITION,

  build(rng) {
    for (let tries = 0; tries < 200; tries++) {
      const built = buildOnce(rng);
      if (built && !leaks(built.values, built.numbers))
        return { values: built.values, keys: built.keys };
    }
    throw new Error(`${SLUG}: every draw shows a computed answer`);
  },
});
