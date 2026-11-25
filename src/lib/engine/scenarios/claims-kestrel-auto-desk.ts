import "server-only";

import type { Rng } from "../server/rng";
import { defineScenario } from "../server/scenario";
import { formatCents } from "../server/template";
import { DOCUMENT_REVIEW } from "../step-types/document_review/public";
import { MULTIPLE_CHOICE } from "../step-types/multiple_choice/public";
import { ORDERING } from "../step-types/ordering/public";
import { RAPID_ROUND } from "../step-types/rapid_round/public";
import { SPREADSHEET } from "../step-types/spreadsheet/public";
import {
  BODY_SHOPS,
  LANDMARKS,
  RENTAL_AGENCIES,
  ROADS,
  VEHICLES,
  addMonths,
  claimNumber,
  distinctDraws,
  formatClock,
  formatClock24,
  policyNumber,
  vehicleLabel,
  wholeDollars,
  type VehicleModel,
} from "./insurance";
import {
  FIRST_NAMES,
  LAST_NAMES,
  LAW_FIRMS,
  addDays,
  computeDeadline,
  courtDaysAfter,
  daysBetween,
  distinctPeople,
  federalHolidays,
  formatDate,
  holidaysBetween,
  isCourtDay,
  isWeekend,
  nextCourtDay,
  personName,
  pickDistinct,
  previousCourtDay,
  weekdayOf,
  type IsoDate,
  type PersonName,
} from "./legal";

/**
 * Insurance claims representative trainee on Kestrel Mutual's personal auto
 * desk (fictional carrier). Six timed sections, 50 minutes, 100 points, all
 * scored automatically:
 *
 *   rapid round A, coverage math (10) → coverage check of twelve new claims
 *   (20) → rapid round B, claim deadlines (10) → body shop estimate vs. the
 *   claims card (20) → rapid round C, statements (10) → claims desk, one screen
 *   at a time: total-loss valuation (8), first-day order (6), payment authority
 *   (6) and five values calls (2 each).
 *
 * Seeded per candidate: every name, vehicle, number and date; the card's
 * limits, rates and deadlines; which claim, estimate line and item carries
 * which trap; row and option order. Deadlines use the shared business-day
 * helpers (./legal/dates.ts) over the federal holidays, kept in 2026 to 2028.
 *
 * Rapid rounds: 15 items × 20 s. Items 3, 6, 9, 12, 15 are the harder kinds,
 * worth 1; the other ten are worth ½, so each round is exactly 10.
 *
 * Draft v1: practitioner review pending (docs/insurance/claims-kestrel-auto-desk.md).
 */

const SLUG = "claims-kestrel-auto-desk";
const LETTERS = ["a", "b", "c", "d"] as const;

type Values = Record<string, string | number>;
type ChoiceKey = Record<string, { choice: string }>;
type Built = { prompt: string; title: string; rows: [string, string][]; right: string; wrong: string[] };

const money = formatCents;
const fail = (msg: string): never => {
  throw new Error(`${SLUG}: ${msg}`);
};

// ---- Rapid round plumbing ----

const RAPID_ITEMS = 15;
/** Items 3, 6, 9, 12 and 15 are worth 1; the rest ½. 10 points a round. */
const isHardSlot = (i: number) => i % 3 === 2;
const slotNo = (i: number) => String(i + 1).padStart(2, "0");

function fillSlots<T>(easy: T[], hard: T[]): T[] {
  const e = [...easy];
  const h = [...hard];
  const out = Array.from({ length: RAPID_ITEMS }, () => undefined as T | undefined).map((_, i) => (isHardSlot(i) ? h.shift() : e.shift()));
  if (out.some((x) => x === undefined) || e.length || h.length) fail("rapid slots don't fill");
  return out as T[];
}

const letterOptions = (name: string) => LETTERS.map((l) => ({ id: l, label: `{{${name}_${l}}}` }));
const answerField = (name: string) => [{ id: "answer", label: "Answer", kind: "choice", options: letterOptions(name) }];

/** Puts `right` among `wrong` in a random place; returns the labels by letter and the right letter. */
function placeOptions(rng: Rng, right: string, wrong: string[]): { labels: string[]; letter: string } {
  if (wrong.length !== 3 || new Set([right, ...wrong]).size !== 4) fail(`options must be 4 different labels (${right} / ${wrong.join(" / ")})`);
  const labels = rng.shuffle([right, ...wrong]);
  return { labels, letter: LETTERS[labels.indexOf(right)] };
}

/** The first three distinct candidates that aren't the right answer, or null when there aren't three. */
function threeWrong(right: string, candidates: string[]): string[] | null {
  const wrong = [...new Set(candidates)].filter((c) => c !== right).slice(0, 3);
  return wrong.length === 3 ? wrong : null;
}

/** Money options from cents; drops non-positive amounts. */
function moneyOptions(right: number, candidates: number[]): { right: string; wrong: string[] } | null {
  if (right <= 0) return null;
  const wrong = threeWrong(
    money(right),
    candidates.filter((c) => c > 0 && Number.isInteger(c)).map(money),
  );
  return wrong ? { right: money(right), wrong } : null;
}

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
            rows: [1, 2, 3, 4, 5].map((r) => ({ label: `{{${prefix}_${n}_l${r}}}`, value: `{{${prefix}_${n}_v${r}}}` })),
          },
          fields: answerField(`${prefix}_${n}`),
          points: isHardSlot(i) ? 1 : 0.5,
        };
      }),
    },
  };
}

/** Writes one rapid item (prompt, exhibit with exactly five rows, options) into the values; returns its key. */
function setRapid(rng: Rng, v: Values, prefix: string, i: number, b: Built): [string, ChoiceKey] {
  const n = slotNo(i);
  if (b.rows.length !== 5) fail(`${prefix}-${n} needs five exhibit rows`);
  const { labels, letter } = placeOptions(rng, b.right, b.wrong);
  v[`${prefix}_${n}`] = b.prompt;
  v[`${prefix}_${n}_title`] = b.title;
  b.rows.forEach(([l, val], r) => {
    v[`${prefix}_${n}_l${r + 1}`] = l;
    v[`${prefix}_${n}_v${r + 1}`] = val;
  });
  LETTERS.forEach((l, j) => (v[`${prefix}_${n}_${l}`] = labels[j]));
  return [`${prefix}-${n}`, { answer: { choice: letter } }];
}

/** Fills an exhibit to five rows with file details a real claim screen shows. */
const pad = (rows: [string, string][], filler: [string, string][]): [string, string][] => {
  const out = [...rows];
  for (const f of filler) if (out.length < 5) out.push(f);
  if (out.length !== 5) fail("exhibit filler too short");
  return out;
};
const FILE_FILLER: [string, string][] = [
  ["Coverage check", "Done: the coverage applies"],
  ["Line of business", "Personal auto"],
  ["Desk", "Kestrel Mutual, personal auto claims"],
];

// ---- Rapid round A: coverage math ----

const rapidCoverageMathStep = rapidStep(
  "rapid-coverage-math",
  "Rapid round: coverage math",
  [
    "Coverage math: 15 items, 20 seconds each. Pick what Kestrel pays.",
    "The deductible comes off the policyholder's own physical damage loss (collision or comprehensive); liability has none. A payment never goes above the limit. Actual cash value is the replacement cost less depreciation. Rental pays the lower of the daily rate and the daily cover, for no more than the maximum days. Each exhibit gives any other rule you need.",
  ].join("\n"),
  "cm",
);

const dollars = (rng: Rng, lo: number, hi: number) => rng.int(lo, hi) * 100;

function rentalDraw(rng: Rng) {
  const cap = rng.pick([30, 35, 40, 45, 50]) * 100;
  const max = rng.pick([14, 21, 30]);
  if (rng.int(0, 1)) {
    const n = rng.int(3, max - 1);
    const r = cap + dollars(rng, 4, 25);
    return { cap, max, n, r, owed: n * cap, wrong: [n * r, max * cap, max * r] };
  }
  const n = max + rng.int(2, 9);
  const r = cap - dollars(rng, 1, 8);
  return { cap, max, n, r, owed: max * r, wrong: [n * r, max * cap, n * cap] };
}
const rentalRows = (x: ReturnType<typeof rentalDraw>): [string, string][] => [
  ["Rental cover", `${money(x.cap)} a day, up to ${x.max} days`],
  ["Rental invoice", `${x.n} days at ${money(x.r)} a day`],
];

type MathKind = "deductible" | "limit" | "acv" | "rental" | "limit_ded" | "threshold" | "two_cov";
const MATH_EASY: MathKind[] = ["deductible", "deductible", "deductible", "limit", "limit", "acv", "acv", "acv", "rental", "rental"];
const MATH_HARD: MathKind[] = ["threshold", "threshold", "limit_ded", "limit_ded", "two_cov"];
const DEDUCTIBLES = [250, 500, 1000].map((d) => d * 100);

function coverageMathItem(rng: Rng, kind: MathKind): Built {
  const prompt = "What does Kestrel pay?";
  for (;;) {
    let title = "";
    let rows: [string, string][] = [];
    let opts: { right: string; wrong: string[] } | null = null;
    const ded = rng.pick(DEDUCTIBLES);
    if (kind === "deductible") {
      const x = ded + rng.cents(400, 5500);
      title = "Collision repair";
      rows = [
        ["Agreed repair cost", money(x)],
        ["Collision deductible", money(ded)],
      ];
      opts = moneyOptions(x - ded, [x, x + ded, x - 2 * ded, ded]);
    } else if (kind === "limit") {
      const lim = rng.pick([10_000, 15_000, 25_000, 50_000]) * 100;
      const x = lim + rng.cents(500, 9000);
      title = "Property damage liability";
      rows = [
        ["Damage to the other car", money(x)],
        ["Property damage limit", money(lim)],
        ["Deductible", "None on liability"],
      ];
      opts = moneyOptions(lim, [x, x - lim, Math.round((x + lim) / 2)]);
    } else if (kind === "acv") {
      const r = dollars(rng, 400, 2400);
      const p = rng.int(15, 60);
      title = "Theft: actual cash value";
      rows = [
        ["Stolen", rng.pick(["Four tires and alloy rims", "Aftermarket stereo and speakers", "Catalytic converter", "Roof rack and cargo box"])],
        ["Replacement cost (new)", money(r)],
        ["Depreciation", `${p}%`],
      ];
      opts = moneyOptions(Math.round((r * (100 - p)) / 100), [r, Math.round((r * p) / 100), r - p * 100]);
    } else if (kind === "rental") {
      const x = rentalDraw(rng);
      title = "Rental";
      rows = rentalRows(x);
      opts = moneyOptions(x.owed, x.wrong);
    } else if (kind === "limit_ded") {
      const lim = rng.pick([1500, 2500, 3000, 5000]) * 100;
      let x: number;
      let right: number;
      if (rng.int(0, 1)) {
        x = lim + ded + dollars(rng, 100, 2000);
        right = lim;
      } else {
        x = lim + rng.int(1, ded / 100 - 1) * 100 + rng.int(0, 99);
        right = x - ded;
      }
      title = "Custom equipment";
      rows = [
        ["Loss to custom equipment", money(x)],
        ["Custom equipment limit", money(lim)],
        ["Deductible", money(ded)],
        ["Card rule", "Take the deductible off the loss first, then apply the limit"],
      ];
      opts = moneyOptions(right, [lim - ded, x - ded, lim, x]);
    } else if (kind === "threshold") {
      const acv = dollars(rng, 6000, 22000);
      const t = rng.pick([70, 75, 80]);
      const line = (acv * t) / 100;
      const total = rng.int(0, 1) === 1;
      const est = Math.round(total ? line + acv * (rng.int(3, 25) / 100) : line - acv * (rng.int(3, 30) / 100)) + rng.int(0, 99);
      const right = (total ? acv : est) - ded;
      title = "Repair or total loss";
      rows = [
        ["Actual cash value", money(acv)],
        ["Repair estimate", money(est)],
        ["Total-loss threshold", `${t}% of actual cash value`],
        ["Deductible", money(ded)],
        ["Card rule", "At or above the threshold it's a total loss: pay actual cash value less the deductible"],
      ];
      opts = moneyOptions(right, [(total ? est : acv) - ded, acv, est]);
    } else {
      const x = rng.cents(1500, 7000);
      const r = rentalDraw(rng);
      title = "Hail and rental";
      rows = [["Hail damage (agreed)", money(x)], ["Comprehensive deductible", money(ded)], ...rentalRows(r)];
      opts = moneyOptions(x - ded + r.owed, [x - ded + r.n * r.r, x + r.owed, x - ded]);
    }
    if (opts) return { prompt, title, rows: pad(rows, FILE_FILLER), right: opts.right, wrong: opts.wrong };
  }
}

// ---- Rapid round B: claim deadlines ----

const rapidDeadlinesStep = rapidStep(
  "rapid-deadlines",
  "Rapid round: claim deadlines",
  [
    "Claim deadlines: 15 items, 20 seconds each. Pick the date the task is due under Kestrel's card.",
    "Don't count the day notice came in. Business days are Monday to Friday, except Kestrel holidays (the federal holidays, listed in each item). A calendar-day deadline that lands on a weekend or holiday moves to the next business day.",
  ].join("\n"),
  "dl",
);

/** n weekdays after `from`, ignoring holidays: the "forgot the holiday" miscount. */
function weekdaysAfter(from: IsoDate, n: number): IsoDate {
  let d = from;
  for (let left = n; left > 0; ) {
    d = addDays(d, 1);
    if (!isWeekend(d)) left--;
  }
  return d;
}

const DL_FIRST: IsoDate = "2026-09-01";
const DL_LAST: IsoDate = "2028-10-31";
type DeadlineKind = "business" | "calendar" | "friday" | "holiday";

function businessDayBetween(rng: Rng, from: IsoDate, to: IsoDate): IsoDate {
  for (;;) {
    const d = addDays(from, rng.int(0, daysBetween(from, to)));
    if (isCourtDay(d)) return d;
  }
}

function deadlineItem(rng: Rng, kind: DeadlineKind, card: { ack: number; contact: number; status: number }, claim: string): Built {
  for (let tries = 0; ; tries++) {
    if (tries > 5000) fail(`no ${kind} deadline item`);
    let from: IsoDate;
    if (kind === "holiday") {
      const year = rng.int(2026, 2028);
      const hols = federalHolidays(year).filter((h) => h.date > "2026-09-08" && h.date < "2028-10-25");
      if (!hols.length) continue;
      from = addDays(rng.pick(hols).date, -rng.int(1, 4));
      if (!isCourtDay(from)) continue;
    } else from = businessDayBetween(rng, DL_FIRST, DL_LAST);
    const friday = weekdayOf(from) === 5;
    let task: string;
    let rule: string;
    let due: IsoDate;
    let candidates: IsoDate[];
    let n: number;
    if (kind === "calendar") {
      n = card.status;
      task = "status letter";
      rule = `Send a status letter ${n} calendar days after notice; if that day isn't a business day, the next business day`;
      due = computeDeadline({ from, days: n }).due;
      const unrolled = addDays(from, n);
      candidates = [unrolled, previousCourtDay(unrolled), nextCourtDay(addDays(from, n - 1)), courtDaysAfter(from, n), courtDaysAfter(due, 1), addDays(due, 7)];
    } else {
      const ack = rng.int(0, 1) === 1;
      n = ack ? card.ack : card.contact;
      task = ack ? "acknowledgement letter" : "first contact with the policyholder";
      rule = ack
        ? `Acknowledge the claim in writing within ${n} business days after notice`
        : `Make first contact with the policyholder within ${n} business ${n === 1 ? "day" : "days"} after notice`;
      due = courtDaysAfter(from, n);
      const crosses = holidaysBetween(addDays(from, 1), due).length > 0;
      if (kind === "business" && (friday || crosses)) continue;
      if (kind === "friday" && !friday) continue;
      if (kind === "holiday" && !crosses) continue;
      candidates = [weekdaysAfter(from, n), nextCourtDay(addDays(from, n)), n > 1 ? courtDaysAfter(from, n - 1) : from, courtDaysAfter(due, 1), addDays(due, 7)];
    }
    const wrong = threeWrong(
      formatDate(due),
      candidates.map((d) => formatDate(d)),
    );
    if (!wrong) continue;
    const window = holidaysBetween(from, addDays(from, n + 14));
    return {
      prompt: `When is the ${task} due?`,
      title: `Claim ${claim}`,
      rows: [
        ["Notice received", formatDate(from)],
        ["Task", task[0].toUpperCase() + task.slice(1)],
        ["Kestrel card", rule],
        ["Business days", "Monday to Friday, except Kestrel holidays (the federal holidays)"],
        ["Kestrel holidays in the window", window.length ? window.map((h) => `${formatDate(h.date)} (${h.name})`).join("; ") : "None"],
      ],
      right: formatDate(due),
      wrong,
    };
  }
}

// ---- Rapid round C: statements ----

const rapidStatementsStep = rapidStep(
  "rapid-statements",
  "Rapid round: statements",
  [
    "Statements: 15 items, 20 seconds each. Do the policyholder's account, the other account and the file fact hang together?",
    "Times agree when they're within 30 minutes on the same clock: convert UTC to local time with the offset given. Places agree when they're on the same road, past the same landmark, within half a mile (1 mile = 1.609 km). If all three agree on date, time and place, the account is consistent. If any two disagree, it's inconsistent: note it and refer the file to the supervisor. That is a reason to look closer, never a reason to deny. If the policyholder leaves out the time or the place, you need that fact before you decide.",
  ].join("\n"),
  "st",
);

type StKind = "plain-consistent" | "plain-inconsistent" | "need-time" | "need-place" | "converted";
const ST_EASY: StKind[] = ["plain-consistent", "plain-consistent", "plain-consistent", "plain-inconsistent", "plain-inconsistent", "plain-inconsistent", "need-time", "need-time", "need-place", "need-place"];
const ST_HARD: StKind[] = ["converted", "converted", "converted", "converted", "converted"];
const FILE_SOURCES = ["Police report", "Tow log", "911 call record"];
const ST_FIRST: IsoDate = "2027-01-04";

interface Spot {
  road: string;
  landmark: string;
  miles: number;
}
const distText = (m: number) => (m === 1 ? "1 mile" : `${m} miles`);
const placeText = (p: Spot, km = false) => `${p.road}, ${km ? `${(p.miles * 1.609).toFixed(1)} km` : distText(p.miles)} past the ${p.landmark}`;

function statementItem(rng: Rng, kind: StKind, sup: string, claim: string): Built {
  const date = addDays(ST_FIRST, rng.int(0, 600));
  const t = rng.int(7 * 12, 15 * 12 + 6) * 5; // 7:00 a.m. to 3:30 p.m.
  const spot: Spot = { road: rng.pick(ROADS), landmark: rng.pick(LANDMARKS), miles: rng.int(1, 12) / 2 };
  const ph = personName(rng);
  const other = personName(rng);
  const otherRole = rng.pick(["Other driver", "Witness"]);
  const near = () => rng.int(-2, 2) * 5; // within 10 minutes of the policyholder
  let phText = `It happened at about ${formatClock(t)} on ${formatDate(date)}, on ${placeText(spot)}.`;
  let oDate = date;
  let oTime = t + near();
  let oSpot = { ...spot };
  let fDate = date;
  let fTime = t + near();
  let fSpot = { ...spot };
  let fUtc: number | null = null;
  let fKm = false;
  let right = "Consistent: carry on with the claim";
  if (kind === "need-time") {
    phText = `It happened on ${formatDate(date)}, on ${placeText(spot)}. I didn't check the time.`;
    right = "Need one more fact: the time of the loss from the policyholder";
  } else if (kind === "need-place") {
    phText = `It happened at about ${formatClock(t)} on ${formatDate(date)}, somewhere on ${spot.road}. I'm not sure exactly where.`;
    right = "Need one more fact: the place of the loss from the policyholder";
  } else if (kind === "plain-inconsistent") {
    right = `Inconsistent: note it and refer the file to ${sup}`;
    const onFact = rng.int(0, 1) === 1;
    const what = rng.pick(["time", "date", "place"] as const);
    if (what === "time") {
      const shift = rng.pick([-1, 1]) * rng.int(12, 30) * 5;
      if (onFact) fTime = t + shift;
      else oTime = t + shift;
    } else if (what === "date") {
      const d = addDays(date, rng.pick([-1, 1]));
      if (onFact) fDate = d;
      else oDate = d;
    } else {
      const moved: Spot =
        rng.int(0, 1) === 1
          ? { ...spot, landmark: rng.pick(LANDMARKS.filter((l) => l !== spot.landmark)) }
          : { ...spot, miles: spot.miles + (spot.miles > 3 ? -1 : 1) * rng.int(3, 5) / 2 };
      if (onFact) fSpot = moved;
      else oSpot = moved;
    }
  } else if (kind === "converted") {
    const consistent = rng.int(0, 1) === 1;
    if (!consistent) right = `Inconsistent: note it and refer the file to ${sup}`;
    if (rng.int(0, 1) === 1) {
      const off = rng.int(5, 8);
      // The UTC clock reads like the local time when it's inconsistent; converted, it's hours off.
      fUtc = consistent ? fTime + off * 60 : t + rng.int(0, 2) * 5;
      fTime = fUtc - off * 60;
      fSpot = { ...spot };
      const utcText = `${formatClock24(fUtc)} UTC on ${formatDate(fDate)} (local time is UTC-${off})`;
      return finish(utcText);
    }
    fKm = true;
    if (!consistent) {
      const m = rng.int(3, 6);
      spot.miles = m;
      oSpot = { ...spot };
      phText = `It happened at about ${formatClock(t)} on ${formatDate(date)}, on ${placeText(spot)}.`;
      // "m km" printed against "m miles": the same digits, over a mile apart.
      fSpot = { ...spot, miles: m / 1.609 };
      const kmText = `${m} km`;
      return finish(null, `${spot.road}, ${kmText} past the ${spot.landmark}`);
    }
  }
  return finish(null);

  function finish(utcText: string | null, placeOverride?: string): Built {
    const oText = `It was at around ${formatClock(oTime)} on ${formatDate(oDate)}, on ${placeText(oSpot)}.`;
    const where = placeOverride ?? placeText(fSpot, fKm);
    const fText = utcText
      ? `Phone GPS log: ${utcText}, ${where}.`
      : `${rng.pick(FILE_SOURCES)}: logged at ${formatClock(fTime)} on ${formatDate(fDate)}, ${where}.`;
    const all = [
      "Consistent: carry on with the claim",
      `Inconsistent: note it and refer the file to ${sup}`,
      "Need one more fact: the time of the loss from the policyholder",
      "Need one more fact: the place of the loss from the policyholder",
    ];
    return {
      prompt: "Do these accounts hang together?",
      title: `Claim ${claim}`,
      rows: pad(
        [
          [`Policyholder (${ph.full})`, phText],
          [`${otherRole} (${other.full})`, oText],
          ["File fact", fText],
        ],
        [
          ["Statements", "Recorded by phone this week"],
          ["Line of business", "Personal auto"],
        ],
      ),
      right,
      wrong: all.filter((x) => x !== right),
    };
  }
}

// ---- Section 2: coverage check ----

const COV_ROWS = 12;
const covId = (i: number) => `c${String(i + 1).padStart(2, "0")}`;
const COV_COLS = ["claim", "loss", "driver", "vehicle", "kind", "period", "drivers", "vehicles", "coverages", "status", "prior"] as const;

const coverageStep = {
  id: "coverage-check",
  type: DOCUMENT_REVIEW,
  title: "Coverage check: new claims",
  config: {
    prompt: [
      "Check each new claim against its policy, using the policy excerpt and claims card in the header.",
      "Flag every claim with a coverage problem, with the reason, then decide what happens to the flagged files.",
    ].join("\n"),
    document: {
      title: "New personal auto claims · pending list for {{today}}",
      fields: [
        { id: "period", label: "Policy period", value: "Coverage starts at 12:01 a.m. standard time on the effective date and ends at 12:01 a.m. standard time on the expiration date, at the policyholder's address." },
        {
          id: "drivers",
          label: "Drivers",
          value: "Anyone driving a covered vehicle with the policyholder's permission is covered, listed or not, unless the policy names them as an excluded driver. Nothing is covered while an excluded driver is driving.",
        },
        {
          id: "nav",
          label: "Newly acquired vehicle",
          value: "A vehicle the policyholder becomes the owner of during the policy period is covered automatically for {{nav_days}} days after they become the owner. After that it is covered only once it's added to the policy.",
        },
        {
          id: "coverages",
          label: "Coverages",
          value: "Collision pays for damage from hitting another vehicle or an object, or from rolling over. Comprehensive pays for other physical damage: theft, fire, hail, flood, falling objects, glass breakage, and hitting a bird or animal. Liability pays for damage the driver causes to others, not for the policyholder's own vehicle.",
        },
        {
          id: "lapse",
          label: "Lapse",
          value: "A policy cancelled for non-payment and reinstated later covers nothing between the cancellation and the reinstatement, unless it was reinstated with no lapse in coverage.",
        },
        { id: "prior", label: "Prior claims", value: "One loss is paid once. Check the prior claims on the policy before setting up a payment." },
        { id: "refer", label: "Claims card", value: "Coverage questions go to the claims supervisor before anyone discusses payment with the policyholder." },
      ],
      columns: [
        "Claim",
        "Date and time of loss",
        "Driver",
        "Vehicle",
        "Loss",
        "Policy and period",
        "Drivers on the policy",
        "Vehicles on the policy",
        "Coverages",
        "Policy status",
        "Prior claims",
      ],
      rows: Array.from({ length: COV_ROWS }, (_, i) => ({ id: covId(i), cells: COV_COLS.map((c) => `{{cv_${i + 1}_${c}}}`) })),
      totals: [],
      footnote: "Statuses come from billing as of this morning; underwriting sends corrections by message.",
    },
    reasons: [
      { id: "outside_period", label: "Loss outside the policy period" },
      { id: "excluded_driver", label: "Excluded driver was driving" },
      { id: "unlisted_vehicle", label: "Vehicle not on the policy and outside the newly acquired window" },
      { id: "no_coverage", label: "Coverage for this loss wasn't bought" },
      { id: "lapse", label: "Loss during a lapse before reinstatement" },
      { id: "duplicate", label: "Loss already paid under another claim" },
      { id: "other", label: "Other" },
    ],
    findings: [
      { id: "period", label: "Loss outside the policy period", points: 3 },
      { id: "excluded", label: "Excluded driver", points: 3 },
      { id: "vehicle", label: "Vehicle outside the newly acquired window", points: 3 },
      { id: "coverage", label: "Coverage not bought", points: 3 },
      { id: "lapse", label: "Loss during a lapse", points: 3 },
      { id: "duplicate", label: "Loss already paid", points: 3 },
    ],
    falseFlagPenalty: 1,
    decision: {
      prompt: "Payments go out this afternoon. What happens to the claims you flagged?",
      options: letterOptions("cov_dec"),
      points: 2,
    },
  },
};

type CovKind = "period" | "excluded" | "vehicle" | "coverage" | "lapse" | "duplicate" | "ok_1230" | "ok_nav" | "ok_permissive" | "ok_reinstated" | "ok_prior" | "ok_plain";
const COV_KINDS: CovKind[] = ["period", "excluded", "vehicle", "coverage", "lapse", "duplicate", "ok_1230", "ok_nav", "ok_permissive", "ok_reinstated", "ok_prior", "ok_plain"];
const REASON_OF: Partial<Record<CovKind, string>> = {
  period: "outside_period",
  excluded: "excluded_driver",
  vehicle: "unlisted_vehicle",
  coverage: "no_coverage",
  lapse: "lapse",
  duplicate: "duplicate",
};

const COLLISIONS = ["hit a light pole", "backed into a concrete post", "slid into a guardrail", "sideswiped a parked truck", "rear-ended at a stop light", "rolled into a drainage ditch"];
const COMPREHENSIVE = ["hail", "hit a deer", "windshield cracked by a rock", "tree limb fell on the roof", "catalytic converter stolen", "flood water in the cabin"];
const LIABILITY_LIMITS = ["25/50/25", "50/100/50", "100/300/100"];
/** Household relationships, gender-neutral since first names are drawn from a mixed pool. */
const HOUSEHOLD = ["spouse", "partner", "adult child", "sibling", "household member"];

interface CovRow {
  kind: CovKind;
  claim: string;
  policy: string;
  family: string;
  holder: string;
  lossDate: IsoDate;
  lossTime: number;
  driver: string;
  relation: string;
  vehicle: string;
  bought?: IsoDate;
  lossKind: "Collision" | "Comprehensive";
  lossText: string;
  eff: IsoDate;
  exp: IsoDate;
  listed: string[];
  excluded: string[];
  vehicles: string[];
  liability: string;
  collision: number | null;
  comprehensive: number | null;
  rental: { cap: number; max: number } | null;
  status: string;
  prior: string;
  note: string;
}

// ---- Section 4: estimate review ----

const EST_LINES = 10;
const estId = (i: number) => `l${String(i + 1).padStart(2, "0")}`;
type EstKind = "part_am" | "part_oem_trap" | "part_oem_ok" | "lab_body" | "lab_paint" | "lab_mech" | "prior" | "dup" | "sublet" | "materials";
const EST_KINDS: EstKind[] = ["part_am", "part_oem_trap", "part_oem_ok", "lab_body", "lab_paint", "lab_mech", "prior", "dup", "sublet", "materials"];
const PARTS = ["Front bumper cover", "Grille assembly", "RT headlamp assembly", "LT headlamp assembly", "Fog lamp assembly", "Radiator support", "A/C condenser", "Side mirror assembly"];
const PANELS = ["LT rear quarter panel", "RT rear quarter panel", "LT front door", "RT front door", "Decklid", "LT front fender", "RT front fender"];
const MECH_JOBS = ["R&I radiator and recharge A/C", "Replace and bleed brake caliper", "R&I front suspension crossmember", "Diagnose and reset airbag module"];
const LABOR_TYPE = { lab_body: "Body labor", lab_paint: "Refinish labor", lab_mech: "Mechanical labor" } as const;

const estimateStep = {
  id: "estimate-review",
  type: SPREADSHEET,
  title: "Estimate review",
  config: {
    prompt: [
      "{{shop}}'s estimate for claim {{est_claim}} ({{est_vehicle}}; loss in {{loss_year}}). Enter what Kestrel allows on each line, the repair payment and the rental, under the claims card:",
      "Labor: approved rates are body {{rate_body|money}} an hour, refinish {{rate_paint|money}} an hour, mechanical {{rate_mech|money}} an hour. Pay the hours at the shop's rate or the approved rate, whichever is lower.",
      "Parts: on a vehicle more than {{parts_age}} model years old, when the shop prices an OEM part, allow the aftermarket (A/M) price from the parts quote; if no A/M part is made, allow the OEM price.",
      "Each operation is paid once: if a line repeats an earlier line, allow 0 on the repeat. Prior damage isn't part of this loss: allow 0.",
      "Photos: the {{photo_prior}} shows prior damage (an old dent with rust at the edges), not from this loss; the {{photo_ok}} shows fresh damage from this loss.",
      "Repair payment: the allowed lines plus any supplement the shop sends, less the collision deductible. Collision deductible: {{est_ded|money}} (from the declarations)",
      "Rental is paid to the rental agency separately, with no deductible. Rental cover: {{rent_cap|money}} a day, up to {{rent_max}} days",
    ].join("\n"),
    columns: ["Line", "Oper.", "Description", "Part type", "Qty / hours", "Price or rate", "Shop amount", "Allowable"],
    rows: [
      ...Array.from({ length: EST_LINES }, (_, i) => [
        String(i + 1),
        `{{es_${i + 1}_op}}`,
        `{{es_${i + 1}_desc}}`,
        `{{es_${i + 1}_type}}`,
        { text: `{{es_${i + 1}_qty}}`, align: "right" },
        { text: `{{es_${i + 1}_price}}`, align: "right" },
        { text: `{{es_${i + 1}_amt|money}}`, align: "right" },
        { input: estId(i), label: `Line ${i + 1}: allowable`, format: "money", points: 1.5 },
      ]),
      ["", "", { text: "Estimate total", bold: true }, "", "", "", { text: "{{est_total|money}}", align: "right", bold: true }, null],
      ["", "", { text: "Repair payment: allowed lines plus any supplement, less the deductible", bold: true }, "", "", "", "", { input: "payable", label: "Repair payment after the deductible", format: "money", points: 3 }],
      [
        "",
        "",
        "Rental: {{rent_agency}} invoice",
        "",
        { text: "{{rent_days}} days", align: "right" },
        { text: "{{rent_rate|money}} a day", align: "right" },
        { text: "{{rent_amt|money}}", align: "right" },
        { input: "rental", label: "Rental owed to the agency", format: "money", points: 2 },
      ],
    ],
  },
};

// ---- Section 6: claims desk ----

const GRADES = ["Excellent", "Good", "Fair", "Poor"] as const;

const totalLossStep = {
  id: "total-loss",
  type: SPREADSHEET,
  seconds: 180,
  title: "Total-loss settlement",
  config: {
    prompt: [
      "Claim {{tl_claim}} is a total loss. Value it from the three comparable vehicles under the card, to the cent.",
      "Loss vehicle: {{tl_vehicle}}, {{tl_miles}} miles, {{tl_cond}} condition.",
      "Mileage: {{tl_rate|money}} per 1,000 miles of difference; add it when a comparable has more miles than the loss vehicle, subtract it when it has fewer.",
      "Condition: {{tl_step|money}} per grade (Excellent, Good, Fair, Poor); subtract it for each grade a comparable is better than the loss vehicle, add it for each grade worse.",
      "Settlement value: the average of the three adjusted values. Payment: the settlement value less the collision deductible. Collision deductible: {{tl_ded|money}} (tax, title and fees are paid separately)",
    ].join("\n"),
    columns: ["Comparable", "Price", "Miles", "Condition", "Adjusted value"],
    rows: [
      ...[1, 2, 3].map((k) => [
        `{{tl_c${k}_desc}}`,
        { text: `{{tl_c${k}_price|money}}`, align: "right" },
        { text: `{{tl_c${k}_miles}}`, align: "right" },
        `{{tl_c${k}_cond}}`,
        { input: `adj${k}`, label: `Comparable ${k}: adjusted value`, format: "money", points: 1.5 },
      ]),
      [{ text: "Settlement value (average of the three)", bold: true }, "", "", "", { input: "avg", label: "Settlement value", format: "money", points: 1.5 }],
      [{ text: "Payment after the deductible", bold: true }, "", "", "", { input: "pay", label: "Payment after the deductible", format: "money", points: 2 }],
    ],
  },
};

const FIRST_DAY_ACTIONS = ["open", "verify", "contact", "inspect", "estimate", "pay"] as const;
const firstDayStep = {
  id: "first-day",
  type: ORDERING,
  seconds: 120,
  title: "First day on a new claim",
  config: {
    prompt:
      "Kestrel's first-day rules for a new claim: open the file and search prior claims before anything else; verify the policy and coverage before you call anyone; acknowledge the claim and take the statement before you book the inspection; inspect before you review an estimate; talk about payment only after the estimate is reviewed. Put the six actions in that order.",
    items: [1, 2, 3, 4, 5, 6].map((k) => ({ id: `i${k}`, label: `{{fd_i${k}}}` })),
    positionPoints: 2,
    pairwisePoints: 4,
  },
};

const authorityStep = {
  id: "authority",
  type: MULTIPLE_CHOICE,
  seconds: 90,
  title: "Payment authority",
  config: { prompt: "Claim {{au_claim}}: what do you do with the payment request?", options: letterOptions("au"), select: "single", points: 6 },
};

const valuesStep = (tag: string, name: string, prompt: string, prefix: string) => ({
  id: `values-${tag}`,
  type: MULTIPLE_CHOICE,
  seconds: 66,
  title: `Judgment: ${name}`,
  config: { prompt, options: letterOptions(prefix), select: "single", points: 2 },
});

const VALUES = [
  valuesStep("integrity", "the shop's offer", "{{est_first}} at {{vi_shop}} wants two more labor hours and offers you a fee. What do you do?", "vi"),
  valuesStep("in-lane", "a represented claimant calls", "{{vl_first}} has a lawyer and is now on the phone asking what Kestrel will offer. What do you do?", "vl"),
  valuesStep("candor", "yesterday's deductible", "{{trainee_first}} says you quoted {{vc_first}} the wrong deductible. What do you do?", "vc"),
  valuesStep("client-care", "am I covered?", "{{vcc_first}} asks whether they're covered. You haven't verified the policy yet. What do you say?", "vcc"),
  valuesStep("quality", "month-end push", "Files missing their required photos, and month end is close. What do you do?", "vq"),
];

// ---- Definition ----

const SUP = "Your claims supervisor";
const EST = "Body shop estimator";
const PH = "Policyholder";
const LAWYER = "Claimant's attorney";
const TRAINEE = "Fellow trainee";

const DEFINITION = {
  intro:
    "You're a claims representative in training at Kestrel Mutual Insurance Company, on the personal auto desk under {{sup}}, the claims supervisor. New claims came in overnight and payments go out this afternoon. The work comes in six timed parts, 50 minutes in all: three rapid rounds (coverage math, claim deadlines, statements), a coverage check of the new claims, a body shop estimate, and a claims desk of short tasks and judgment calls shown one screen at a time. A finished part can't be reopened. Kestrel, its people, the shops and the policyholders are fictional. The policy terms follow a standard personal auto policy, and every rate, limit and deadline you need is on Kestrel's cards in the material.",
  steps: [rapidCoverageMathStep, coverageStep, rapidDeadlinesStep, estimateStep, rapidStatementsStep, totalLossStep, firstDayStep, authorityStep, ...VALUES],
  messages: [
    {
      id: "m1",
      from: SUP,
      subject: "Welcome to the auto desk",
      body: [
        "Hi {{first_name}},",
        "",
        "Welcome to the desk. Plan for today: a quick warm-up on coverage math, then the coverage check on the new claims. I need that by 11:00 so payments can go out by 3:00. After that an estimate from {{shop}}, and whatever lands in between.",
        "",
        "Rule one on this desk: we don't talk payment on any file until coverage is confirmed. If something looks off, it comes to me.",
        "",
        "{{sup}}",
        "Claims Supervisor, Personal Auto · Kestrel Mutual · {{sup_email}}",
      ].join("\n"),
      arriveAtMinute: 0,
      stepId: "rapid-coverage-math",
    },
    {
      id: "m2",
      from: SUP,
      subject: "Coverage check: new claims",
      body: [
        "Hi {{first_name}},",
        "",
        "Twelve new auto claims are on the pending list. Check each one against its policy before anyone sets up a payment: policy period, drivers, vehicles, coverages, status and prior claims. The policy excerpt and our card are in the header.",
        "",
        "Flag anything that doesn't fit, with the reason, and tell me what happens to those files. Please don't call anyone about payment on a file you flag.",
        "",
        "{{sup}}",
      ].join("\n"),
      arriveAtMinute: 0,
      stepId: "coverage-check",
    },
    {
      id: "m3",
      from: SUP,
      subject: "Correction from underwriting",
      body: [
        "{{first_name}},",
        "",
        "Underwriting just corrected policy {{corr_policy}}: it was reinstated on {{corr_reinstated}} with a lapse in coverage from {{corr_cancelled}}, not back to the cancellation date. The status on your list is out of date for that one.",
        "",
        "{{sup}}",
      ].join("\n"),
      arriveAtMinute: 4,
      stepId: "coverage-check",
    },
    {
      id: "m4",
      from: TRAINEE,
      subject: "Diary dates?",
      body: [
        "Hey {{first_name}},",
        "",
        "{{trainee_first}} here, the other trainee. I'm setting up diary dates for my files and keep second-guessing the card. Could you run through them with me? Each one has the card rule and the holidays.",
        "",
        "Thanks! {{trainee_first}}",
      ].join("\n"),
      arriveAtMinute: 0,
      stepId: "rapid-deadlines",
    },
    {
      id: "m5",
      from: SUP,
      subject: "Estimate from {{shop}}",
      body: [
        "Hi {{first_name}},",
        "",
        "{{shop}} sent the estimate on {{est_claim}}, {{est_holder}}'s {{est_vehicle}} from this morning's list. Coverage is fine on that one. Review it line by line against the card (it's above the estimate), work out the repair payment after the deductible and what we owe the rental agency.",
        "",
        "{{appraiser}} took the photos; the notes are with the card.",
        "",
        "{{sup}}",
      ].join("\n"),
      arriveAtMinute: 0,
      stepId: "estimate-review",
    },
    {
      id: "m6",
      from: EST,
      subject: "Supplement 1, claim {{est_claim}}",
      body: [
        "Hi {{first_name}},",
        "",
        "Supplement 1 for claim {{est_claim}}: teardown found a cracked {{sup_part}} behind the bumper.",
        "Line S1: Repl {{sup_part}}, A/M, {{sup_amt|money}}. No added labor; it's in the bumper R&I.",
        "",
        "Photos of the part are on the portal.",
        "",
        "{{est}}, Estimator, {{shop}}",
      ].join("\n"),
      arriveAtMinute: 4,
      stepId: "estimate-review",
    },
    {
      id: "m7",
      from: SUP,
      subject: "Statements to check",
      body: [
        "Hi {{first_name}},",
        "",
        "Recorded statements came back on a batch of files. For each one, tell me whether the accounts hang together, need one more fact, or should come to me. Mismatches are a reason to look closer, not to deny.",
        "",
        "{{sup}}",
      ].join("\n"),
      arriveAtMinute: 0,
      stepId: "rapid-statements",
    },
    {
      id: "m8",
      from: SUP,
      subject: "Total loss on {{tl_claim}}",
      body: [
        "{{first_name}},",
        "",
        "{{tl_holder}}'s {{tl_vehicle}} on {{tl_claim}} (the loss just after midnight on this morning's list) is a total loss. The valuation has three comparables; adjust them under the card and give me the settlement and the payment.",
        "",
        "{{sup}}",
      ].join("\n"),
      arriveAtMinute: 0,
      stepId: "total-loss",
    },
    {
      id: "m9",
      from: SUP,
      subject: "New claim {{fd_claim}}",
      body: ["{{first_name}},", "", "{{fd_holder}} just reported a new claim, {{fd_claim}}. It's yours. Line up your first day on it per the card.", "", "{{sup}}"].join("\n"),
      arriveAtMinute: 0,
      stepId: "first-day",
    },
    {
      id: "m10",
      from: SUP,
      subject: "Payment request on {{au_claim}}",
      body: [
        "{{first_name}},",
        "",
        "{{au_payee}} wants payment today on {{au_claim}}. Your call. The card: send to the supervisor any payment above your authority, any represented claimant, suspected fraud or a coverage question. Before paying, the file needs photos; if they're missing, ask for them.",
        "",
        "Payment: {{au_amt|money}} to {{au_payee}}",
        "Your payment authority: {{au_limit|money}}",
        "Coverage: {{au_cov}}",
        "Photos: {{au_photos}}",
        "Claimant: {{au_claimant}}",
        "Fraud indicators: {{au_fraud}}",
        "",
        "{{sup}}",
      ].join("\n"),
      arriveAtMinute: 0,
      stepId: "authority",
    },
    {
      id: "m11",
      from: EST,
      subject: "{{vi_claim}}: labor hours",
      body: [
        "Hi {{first_name}},",
        "",
        "On {{vi_claim}} I need two more hours of body labor, {{vi_hours}} instead of {{vi_base}}. The photos don't show it all, trust me.",
        "",
        "Also, between us: we pay {{vi_fee|money}} for every job Kestrel sends our way. I can send yours to your personal account. Nobody needs to know.",
        "",
        "{{est}}, {{vi_shop}}",
      ].join("\n"),
      arriveAtMinute: 0,
      stepId: "values-integrity",
    },
    {
      id: "m12",
      from: LAWYER,
      subject: "Letter of representation: {{vl_claimant}}, claim {{vl_claim}}",
      body: [
        "To Kestrel Mutual Insurance Company:",
        "",
        "This office represents {{vl_claimant}} for vehicle damage and injuries from the loss of {{vl_date}} (claim {{vl_claim}}). Please direct all communication about this claim to this office and do not contact our client directly.",
        "",
        "{{lawyer}}, Attorney at Law, {{law_firm}} · {{lawyer_email}}",
      ].join("\n"),
      arriveAtMinute: 0,
      stepId: "values-in-lane",
    },
    {
      id: "m13",
      from: TRAINEE,
      subject: "About your call yesterday",
      body: [
        "Hey {{first_name}},",
        "",
        "Awkward, sorry. I was next to you yesterday on your call with {{vc_holder}} on {{vc_claim}}. You told them the collision deductible was {{vc_said}}, but the declarations say {{vc_real}}. They're expecting a bigger check. Thought you'd want to know before the payment goes.",
        "",
        "{{trainee_first}}",
      ].join("\n"),
      arriveAtMinute: 0,
      stepId: "values-candor",
    },
    {
      id: "m14",
      from: PH,
      subject: "Please help, policy {{vcc_policy}}",
      body: [
        "Hello,",
        "",
        "This is {{vcc_holder}}. Someone hit my car in the {{vcc_place}} lot about an hour ago and now it won't start. I'm stuck here with my two kids. Am I covered? Please just tell me I'm covered.",
        "",
        "{{vcc_holder}}",
      ].join("\n"),
      arriveAtMinute: 0,
      stepId: "values-client-care",
    },
    {
      id: "m15",
      from: SUP,
      subject: "Month end",
      body: [
        "Team,",
        "",
        "Month end is {{vq_date}}. I need every file that's ready closed today; our closure numbers go to the regional VP tomorrow and we're behind.",
        "",
        "{{sup}}",
      ].join("\n"),
      arriveAtMinute: 0,
      stepId: "values-quality",
    },
    {
      id: "m16",
      from: TRAINEE,
      subject: "Quick way to hit the number",
      body: [
        "{{first_name}},",
        "",
        "{{vq_count}} of your files are only missing the required photos. I'm closing mine now and adding the photos when they come in. Nobody looks until audit. Want to do the same?",
        "",
        "{{trainee_first}}",
      ].join("\n"),
      arriveAtMinute: 0,
      stepId: "values-quality",
    },
  ],
  sections: [
    { id: "s-rapid-a", title: "Rapid round: coverage math", minutes: 6, stepIds: ["rapid-coverage-math"] },
    { id: "s-work-1", title: "Coverage check", minutes: 10, stepIds: ["coverage-check"] },
    { id: "s-rapid-b", title: "Rapid round: claim deadlines", minutes: 6, stepIds: ["rapid-deadlines"] },
    { id: "s-work-2", title: "Estimate review", minutes: 10, stepIds: ["estimate-review"] },
    { id: "s-rapid-c", title: "Rapid round: statements", minutes: 6, stepIds: ["rapid-statements"] },
    {
      id: "s-desk",
      title: "Claims desk",
      minutes: 12,
      stepIds: ["total-loss", "first-day", "authority", ...VALUES.map((s) => s.id)],
      oneAtATime: true,
    },
  ],
};

// ---- Leak guard ----

/**
 * The candidate's screen must not show a computed allowable or settlement in
 * any form (1234.56, 123456 as cents, 1,234.56). Amounts the material shows on
 * purpose are numeric values; a computed amount can collide with a string (a
 * rapid-round option, a prior claim payment) by chance, so the generator draws
 * again when it does.
 */
const STATIC_TEXT = JSON.stringify(DEFINITION);
function leakForms(value: number): RegExp[] {
  const forms = [JSON.stringify(value), value.toFixed(2), String(Math.round(value * 100)), value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })];
  return [...new Set(forms)].filter((f) => !/^\d{1,3}$/.test(f)).map((s) => new RegExp(`(?<![\\d.,])${s.replace(/[.$]/g, "\\$&")}(?![\\d.]\\d)`));
}
function leaks(values: Values, numbers: number[]): boolean {
  const shown = new Set(Object.values(values).filter((x): x is number => typeof x === "number"));
  const text = `${STATIC_TEXT}\n${Object.values(values)
    .filter((x) => typeof x === "string")
    .join("\n")}`;
  return numbers.some((n) => n >= 1 && !shown.has(Math.round(n * 100)) && leakForms(n).some((re) => re.test(text)));
}

// ---- Generator ----

function buildOnce(rng: Rng) {
  const v: Values = {};
  const [pSup, pEst, pTrainee, pAppraiser, pLawyer, pFd, pVl, pVc, pVcc, pAu] = distinctPeople(rng, 10);
  const castLasts = new Set([pSup, pEst, pTrainee, pAppraiser, pLawyer, pFd, pVl, pVc, pVcc, pAu].map((p) => p.last));
  const families = pickDistinct(
    rng,
    LAST_NAMES.filter((l) => !castLasts.has(l)),
    COV_ROWS,
  );
  const [shop, viShop] = pickDistinct(rng, BODY_SHOPS, 2);
  const lawFirm = rng.pick(LAW_FIRMS);
  const today = addDays("2027-02-01", rng.int(0, 240));
  const todayBiz = nextCourtDay(today);
  const year = Number(todayBiz.slice(0, 4));
  const usedClaims = new Set<string>();
  const newClaim = (y = year) => {
    for (;;) {
      const c = claimNumber(rng, "AU", y);
      if (!usedClaims.has(c)) {
        usedClaims.add(c);
        return c;
      }
    }
  };
  const policies = distinctDraws(rng, COV_ROWS + 2, (r) => policyNumber(r, "KMA"));
  Object.assign(v, {
    sup: pSup.full,
    sup_first: pSup.first,
    sup_email: `${pSup.first[0].toLowerCase()}${pSup.last.toLowerCase()}@kestrelmutual.example`,
    est: pEst.full,
    est_first: pEst.first,
    trainee_first: pTrainee.first,
    appraiser: pAppraiser.full,
    lawyer: pLawyer.full,
    law_firm: lawFirm.name,
    lawyer_email: `${pLawyer.first[0].toLowerCase()}${pLawyer.last.toLowerCase()}@${lawFirm.domain}`,
    shop,
    today: formatDate(todayBiz),
  });

  // ---- Card values used across sections ----
  const navDays = rng.pick([14, 30]);
  const partsAge = rng.pick([3, 4, 5]);
  const rentCap = rng.pick([30, 35, 40, 45, 50]) * 100;
  const rentMax = rng.pick([21, 30]);
  v.nav_days = String(navDays);

  // ---- Section 2: coverage check ----
  const kinds = rng.shuffle(COV_KINDS);
  const usedVehicles = new Set<string>();
  const newVehicle = (minYear: number, maxYear: number) => {
    for (;;) {
      const label = vehicleLabel(rng.int(minYear, maxYear), rng.pick(VEHICLES));
      if (!usedVehicles.has(label)) {
        usedVehicles.add(label);
        return label;
      }
    }
  };
  const lossTimeDay = () => rng.int(6 * 12, 22 * 12) * 5;
  const rows: CovRow[] = kinds.map((kind, i) => {
    const family = families[i];
    const firsts = pickDistinct(rng, FIRST_NAMES, 4);
    const holder = `${firsts[0]} ${family}`;
    const member = `${firsts[1]} ${family}`;
    const memberRel = rng.pick(HOUSEHOLD);
    const third = `${firsts[2]} ${family}`;
    const thirdRel = rng.pick(HOUSEHOLD.filter((h) => h !== memberRel && h !== "spouse" && h !== "partner"));
    const listed = rng.int(0, 2) ? [holder, member] : [holder];
    const lossKind: "Collision" | "Comprehensive" = rng.int(0, 2) ? "Collision" : "Comprehensive";
    const lossDate = addDays(todayBiz, -rng.int(1, 12));
    const term = rng.pick([6, 12]);
    const eff = addDays(lossDate, -rng.int(15, 160));
    const ownCar = newVehicle(2012, year - 1);
    const vehicles = rng.int(0, 1) ? [ownCar, newVehicle(2010, year - 1)] : [ownCar];
    const ded = () => rng.pick(DEDUCTIBLES);
    const row: CovRow = {
      kind,
      claim: newClaim(),
      policy: policies[i],
      family,
      holder,
      lossDate,
      lossTime: lossTimeDay(),
      driver: rng.pick(listed),
      relation: "",
      vehicle: ownCar,
      lossKind,
      lossText: rng.pick(lossKind === "Collision" ? COLLISIONS : COMPREHENSIVE),
      eff,
      exp: addMonths(eff, term),
      listed,
      excluded: rng.int(0, 3) === 0 ? [third] : [],
      vehicles,
      liability: rng.pick(LIABILITY_LIMITS),
      collision: ded(),
      comprehensive: ded(),
      rental: rng.int(0, 1) ? { cap: rng.pick([30, 35, 40, 45, 50]) * 100, max: rng.pick([21, 30]) } : null,
      status: "In force",
      prior: "None",
      note: "",
    };
    // Drop the coverage this loss doesn't need now and then, as real declarations vary.
    if (rng.int(0, 3) === 0) {
      if (lossKind === "Collision") row.comprehensive = null;
      else row.collision = null;
    }
    const relOf = (name: string) => (name === holder ? "policyholder" : memberRel);
    const memberOrThird = (name: string) => (name === third ? thirdRel : relOf(name));
    switch (kind) {
      case "period":
        if (rng.int(0, 1)) {
          row.eff = addDays(lossDate, 1);
          row.exp = addMonths(row.eff, term);
          row.lossTime = rng.int(20 * 12, 23 * 12 + 10) * 5;
          row.status = "In force (new policy, first term)";
          row.note = `The loss at ${formatClock(row.lossTime)} on ${formatDate(lossDate)} is before coverage started at 12:01 a.m. on ${formatDate(row.eff)}.`;
        } else {
          // Keep the day of month at 28 or less so the term runs back to the same day.
          if (Number(lossDate.slice(8)) > 28) row.lossDate = addDays(lossDate, -3);
          row.exp = row.lossDate;
          row.eff = addMonths(row.exp, -term);
          if (addMonths(row.eff, term) !== row.exp) return fail("period row term");
          row.lossTime = rng.int(7 * 12, 21 * 12) * 5;
          row.status = `Expired ${formatDate(row.exp)} (renewal not paid)`;
          row.note = `The policy expired at 12:01 a.m. on ${formatDate(row.exp)}; the loss at ${formatClock(row.lossTime)} that day is after it ended.`;
        }
        break;
      case "excluded":
        row.excluded = [third];
        row.driver = third;
        row.note = `${third} was driving and is named as an excluded driver on ${row.policy}.`;
        break;
      case "vehicle": {
        const bought = addDays(lossDate, -rng.int(navDays + 3, navDays + 40));
        row.eff = addDays(bought, -rng.int(10, 60));
        row.exp = addMonths(row.eff, term);
        row.vehicle = newVehicle(2018, year);
        row.bought = bought;
        row.note = `The ${row.vehicle} was bought ${formatDate(bought)}, ${daysBetween(bought, lossDate)} days before the loss, and was never added; the automatic cover lasts ${navDays} days.`;
        break;
      }
      case "ok_nav": {
        const bought = addDays(lossDate, -rng.int(1, navDays - 2));
        row.eff = addDays(bought, -rng.int(10, 90));
        row.exp = addMonths(row.eff, term);
        row.vehicle = newVehicle(2018, year);
        row.bought = bought;
        break;
      }
      case "coverage":
        if (lossKind === "Collision") {
          row.collision = null;
          if (rng.int(0, 1)) row.comprehensive = null;
        } else {
          row.comprehensive = null;
          if (rng.int(0, 1)) row.collision = null;
        }
        row.note = `This is a ${lossKind.toLowerCase()} loss and ${row.policy} has no ${lossKind} coverage.`;
        break;
      case "lapse":
      case "ok_reinstated": {
        row.lossDate = addDays(todayBiz, -rng.int(5, 14));
        const cancelled = addDays(row.lossDate, -rng.int(3, 15));
        const reinstated = addDays(row.lossDate, rng.int(1, Math.min(6, daysBetween(row.lossDate, todayBiz) - 1)));
        row.eff = addDays(cancelled, -rng.int(10, 120));
        row.exp = addMonths(row.eff, term);
        row.status = `Cancelled for non-payment ${formatDate(cancelled)}; reinstated ${formatDate(reinstated)} with no lapse in coverage`;
        if (kind === "lapse") {
          Object.assign(v, { corr_policy: row.policy, corr_reinstated: formatDate(reinstated), corr_cancelled: formatDate(cancelled) });
          row.note = `Underwriting's correction: no coverage from ${formatDate(cancelled)} to ${formatDate(reinstated)}, and the loss on ${formatDate(row.lossDate)} falls in that lapse.`;
        }
        break;
      }
      case "duplicate": {
        const paid = rng.cents(700, 5200);
        row.prior = `${newClaim()} · ${formatDate(lossDate)} · ${lossKind}: ${row.lossText} · ${row.vehicle} · paid ${money(paid)}`;
        row.note = `The same ${lossKind.toLowerCase()} loss to the ${row.vehicle} on ${formatDate(lossDate)} was already paid under another claim number.`;
        break;
      }
      case "ok_prior": {
        const pDate = addDays(lossDate, -rng.int(30, 300));
        const otherKind = lossKind === "Collision" ? "Comprehensive" : "Collision";
        const pText = rng.pick(otherKind === "Collision" ? COLLISIONS : COMPREHENSIVE);
        row.prior = `${newClaim(Number(pDate.slice(0, 4)))} · ${formatDate(pDate)} · ${otherKind}: ${pText} · ${row.vehicle} · paid ${money(rng.cents(400, 4800))}`;
        break;
      }
      case "ok_1230":
        row.lossKind = "Collision";
        row.lossText = rng.pick(COLLISIONS);
        row.collision = ded();
        row.eff = lossDate;
        row.exp = addMonths(row.eff, term);
        row.lossTime = rng.int(1, 11) * 5;
        row.status = "In force (new policy, first term)";
        row.driver = holder;
        break;
      case "ok_permissive": {
        let friend: PersonName;
        do friend = personName(rng);
        while (friend.last === family || friend.full === third);
        row.driver = friend.full;
        row.relation = rng.pick(["friend, borrowed it with permission", "neighbour, borrowed it with permission", "coworker, drove it with permission"]);
        if (!row.excluded.length && rng.int(0, 1)) row.excluded = [third];
        break;
      }
      case "ok_plain":
        row.lossKind = "Collision";
        row.lossText = rng.pick(COLLISIONS);
        row.collision = ded();
        row.vehicle = newVehicle(year - partsAge - 8, year - partsAge - 1);
        row.vehicles = [row.vehicle, ...row.vehicles.slice(1)];
        row.rental = { cap: rentCap, max: rentMax };
        row.driver = holder;
        break;
    }
    if (!row.relation) row.relation = memberOrThird(row.driver);
    if (kind !== "vehicle" && kind !== "ok_nav" && !row.vehicles.includes(row.vehicle)) row.vehicles = [row.vehicle, ...row.vehicles.slice(1)];
    if (kind !== "excluded" && row.excluded.includes(row.driver)) return fail("excluded driver on a clean row");
    return row;
  });

  // Self-check: every row other than its own trap sits inside its policy, with its coverage.
  for (const r of rows) {
    const inPeriod = r.lossDate > r.eff || (r.lossDate === r.eff && r.lossTime >= 1);
    const beforeEnd = r.lossDate < r.exp;
    if (r.kind !== "period" && !(inPeriod && beforeEnd)) fail(`${r.kind} row outside its period`);
    if (r.kind !== "coverage" && (r.lossKind === "Collision" ? r.collision : r.comprehensive) === null) fail(`${r.kind} row lacks its coverage`);
    if (r.bought && r.bought < r.eff) fail(`${r.kind} vehicle bought before the policy`);
    if (r.lossDate >= todayBiz) fail("loss after today");
  }

  rows.forEach((r, i) => {
    const k = i + 1;
    const covs = [
      `Liability ${r.liability}`,
      ...(r.collision !== null ? [`Collision, ${wholeDollars(r.collision)} deductible`] : []),
      ...(r.comprehensive !== null ? [`Comprehensive, ${wholeDollars(r.comprehensive)} deductible`] : []),
      ...(r.rental ? [`Rental, ${wholeDollars(r.rental.cap)} a day up to ${r.rental.max} days`] : []),
    ];
    Object.assign(v, {
      [`cv_${k}_claim`]: r.claim,
      [`cv_${k}_loss`]: `${formatDate(r.lossDate)}, ${formatClock(r.lossTime)}`,
      [`cv_${k}_driver`]: `${r.driver} (${r.relation})`,
      [`cv_${k}_vehicle`]: r.bought ? `${r.vehicle} (bought ${formatDate(r.bought)})` : r.vehicle,
      [`cv_${k}_kind`]: `${r.lossKind}: ${r.lossText}`,
      [`cv_${k}_period`]: `${r.policy} · ${formatDate(r.eff)} to ${formatDate(r.exp)}`,
      [`cv_${k}_drivers`]: `Listed: ${r.listed.join(", ")}. Excluded: ${r.excluded.length ? r.excluded.join(", ") : "none"}`,
      [`cv_${k}_vehicles`]: r.vehicles.join("; "),
      [`cv_${k}_coverages`]: covs.join("; "),
      [`cv_${k}_status`]: r.status,
      [`cv_${k}_prior`]: r.prior,
    });
  });
  const covFindings: Record<string, { targets: string[]; reasons: string[]; note: string }> = {};
  const FINDING_OF: Partial<Record<CovKind, string>> = { period: "period", excluded: "excluded", vehicle: "vehicle", coverage: "coverage", lapse: "lapse", duplicate: "duplicate" };
  rows.forEach((r, i) => {
    const f = FINDING_OF[r.kind];
    if (f) covFindings[f] = { targets: [covId(i)], reasons: [REASON_OF[r.kind]!], note: r.note };
  });
  const covDec = placeOptions(rng, `Send the flagged files to ${pSup.first} before anyone talks to those policyholders about payment`, [
    "Deny the flagged claims myself and send the letters today",
    "Pay the flagged claims now and sort out coverage afterwards",
    "Ask the policyholders whether the loss date was really a day or two different, so it falls inside the policy",
  ]);
  LETTERS.forEach((l, j) => (v[`cov_dec_${l}`] = covDec.labels[j]));

  // ---- Section 4: estimate review ----
  const estRow = rows.find((r) => r.kind === "ok_plain")!;
  const tlRow = rows.find((r) => r.kind === "ok_1230")!;
  const rate = { lab_body: dollars(rng, 52, 68), lab_paint: dollars(rng, 52, 70), lab_mech: dollars(rng, 95, 130) };
  const overType = rng.pick(["lab_body", "lab_paint", "lab_mech"] as const);
  const shopRate = Object.fromEntries(
    (["lab_body", "lab_paint", "lab_mech"] as const).map((t) => [t, t === overType ? rate[t] + dollars(rng, 6, 25) : rate[t] - (rng.int(0, 1) ? 0 : dollars(rng, 1, 4))]),
  ) as Record<keyof typeof rate, number>;
  const [priorPanel, okPanel] = pickDistinct(rng, PANELS, 2);
  const [partAm, partOem, partOk] = pickDistinct(rng, PARTS, 3);
  const supPart = "bumper energy absorber";
  type Line = { kind: EstKind; op: string; desc: string; type: string; qty: string; price: string; amt: number; allow: number };
  const tenths = (lo: number, hi: number) => rng.int(lo * 10, hi * 10);
  const labor = (kind: "lab_body" | "lab_paint" | "lab_mech" | "prior", op: string, desc: string, lo: number, hi: number): Line => {
    const t = kind === "prior" ? "lab_body" : kind;
    const h = tenths(lo, hi);
    const amt = (h * shopRate[t]) / 10;
    return { kind, op, desc, type: LABOR_TYPE[t], qty: `${(h / 10).toFixed(1)} h`, price: `${money(shopRate[t])} an hour`, amt, allow: kind === "prior" ? 0 : (h * Math.min(shopRate[t], rate[t])) / 10 };
  };
  const amPrice = rng.cents(120, 480);
  const oemPrice = rng.cents(350, 1100);
  const amQuote = Math.round(oemPrice * (rng.int(45, 75) / 100));
  const okPrice = rng.cents(180, 900);
  const partLine = (kind: EstKind, desc: string, type: string, amt: number, allow: number): Line => ({ kind, op: "Repl", desc, type, qty: "1", price: money(amt), amt, allow });
  const lineOf: Record<EstKind, Line> = {
    part_am: partLine("part_am", partAm, "A/M", amPrice, amPrice),
    part_oem_trap: partLine("part_oem_trap", partOem, `OEM (A/M quote ${money(amQuote)})`, oemPrice, amQuote),
    part_oem_ok: partLine("part_oem_ok", partOk, "OEM (no A/M part made)", okPrice, okPrice),
    lab_body: labor("lab_body", "Rpr", `Repair ${okPanel}`, 1, 6.5),
    lab_paint: labor("lab_paint", "Refn", `Refinish ${okPanel} and blend adjacent`, 1.5, 5),
    lab_mech: labor("lab_mech", "Mech", rng.pick(MECH_JOBS), 0.8, 3.5),
    prior: labor("prior", "Rpr", `Repair ${priorPanel} dent`, 1.5, 4),
    dup: { ...partLine("part_am", partAm, "A/M", amPrice, 0), kind: "dup" },
    sublet: (() => {
      const a = rng.cents(89, 149);
      return { kind: "sublet" as const, op: "Subl", desc: "Four-wheel alignment", type: "Sublet", qty: "1", price: money(a), amt: a, allow: a };
    })(),
    materials: (() => {
      const a = rng.cents(95, 260);
      return { kind: "materials" as const, op: "Matl", desc: "Paint and materials", type: "Materials", qty: "1", price: money(a), amt: a, allow: a };
    })(),
  };
  const order = rng.shuffle(EST_KINDS);
  const [ia, id] = [order.indexOf("part_am"), order.indexOf("dup")];
  if (id < ia) [order[ia], order[id]] = [order[id], order[ia]];
  const lines = order.map((k) => lineOf[k]);
  const supAmt = rng.cents(60, 190);
  const estDed = estRow.collision!;
  const rentDays = rentMax + rng.int(2, 12);
  const rentRate = rng.int(0, 1) ? rentCap - dollars(rng, 0, 8) : rentCap + dollars(rng, 3, 15);
  const payable = lines.reduce((s, l) => s + l.allow, 0) + supAmt - estDed;
  const rental = Math.min(rentDays, rentMax) * Math.min(rentRate, rentCap);
  const estYear = Number(estRow.vehicle.slice(0, 4));
  if (year - estYear <= partsAge) fail("estimate vehicle too new for the parts policy");
  lines.forEach((l, i) => {
    const k = i + 1;
    Object.assign(v, { [`es_${k}_op`]: l.op, [`es_${k}_desc`]: l.desc, [`es_${k}_type`]: l.type, [`es_${k}_qty`]: l.qty, [`es_${k}_price`]: l.price, [`es_${k}_amt`]: l.amt });
  });
  Object.assign(v, {
    est_claim: estRow.claim,
    est_holder: estRow.holder,
    est_vehicle: estRow.vehicle,
    loss_year: String(year),
    rate_body: rate.lab_body,
    rate_paint: rate.lab_paint,
    rate_mech: rate.lab_mech,
    parts_age: String(partsAge),
    photo_prior: priorPanel,
    photo_ok: okPanel,
    est_ded: estDed,
    rent_cap: rentCap,
    rent_max: String(rentMax),
    rent_agency: rng.pick(RENTAL_AGENCIES),
    rent_days: String(rentDays),
    rent_rate: rentRate,
    rent_amt: rentDays * rentRate,
    est_total: lines.reduce((s, l) => s + l.amt, 0),
    sup_part: supPart,
    sup_amt: supAmt,
    // The A/M quote is printed inside the part-type text; it's shown on purpose.
    am_quote: amQuote,
  });
  const estCells: Record<string, { value: number }> = Object.fromEntries(lines.map((l, i) => [estId(i), { value: l.allow / 100 }]));
  estCells.payable = { value: payable / 100 };
  estCells.rental = { value: rental / 100 };

  // ---- Section 6: total loss ----
  const tlModel = VEHICLES.find((m) => tlRow.vehicle.endsWith(`${m.make} ${m.model}`)) as VehicleModel;
  const tlYear = Number(tlRow.vehicle.slice(0, 4));
  const tlMiles = rng.int(400, 1400) * 100;
  const tlCond = rng.int(1, 2);
  const tlRate = dollars(rng, 40, 90);
  const tlStep = rng.int(10, 24) * 2500;
  const base = rng.int(160, 520) * 5000;
  const comps = [1, 2, 3].map(() => {
    const miles = Math.max(5000, tlMiles + rng.int(-250, 250) * 100);
    const g = Math.min(3, Math.max(0, tlCond + rng.int(-1, 1)));
    const price = base + rng.int(-30, 30) * 5000;
    const adj = price + Math.round(((miles - tlMiles) / 1000) * tlRate) + (g - tlCond) * tlStep;
    return { miles, g, price, adj, where: `${rng.pick(["Dealer", "Private seller", "Dealer"])}, ${rng.int(5, 90)} miles away` };
  });
  const avg = Math.round(comps.reduce((s, c) => s + c.adj, 0) / 3);
  const tlDed = tlRow.collision!;
  comps.forEach((c, i) => {
    const k = i + 1;
    Object.assign(v, {
      [`tl_c${k}_desc`]: `${vehicleLabel(tlYear, tlModel)} · ${c.where}`,
      [`tl_c${k}_price`]: c.price,
      [`tl_c${k}_miles`]: c.miles.toLocaleString("en-US"),
      [`tl_c${k}_cond`]: GRADES[c.g],
    });
  });
  Object.assign(v, {
    tl_claim: tlRow.claim,
    tl_holder: tlRow.holder,
    tl_vehicle: tlRow.vehicle,
    tl_miles: tlMiles.toLocaleString("en-US"),
    tl_cond: GRADES[tlCond],
    tl_rate: tlRate,
    tl_step: tlStep,
    tl_ded: tlDed,
  });
  const tlCells: Record<string, { value: number }> = {
    adj1: { value: comps[0].adj / 100 },
    adj2: { value: comps[1].adj / 100 },
    adj3: { value: comps[2].adj / 100 },
    avg: { value: avg / 100 },
    pay: { value: (avg - tlDed) / 100 },
  };

  // ---- Section 6: first day ----
  const fdClaim = newClaim();
  const fdPolicy = policies[COV_ROWS];
  const fdShop = rng.pick(BODY_SHOPS.filter((s) => s !== shop));
  const fdLabels: Record<(typeof FIRST_DAY_ACTIONS)[number], string> = {
    open: `Set up the file for ${fdClaim} and search prior claims on ${fdPolicy}`,
    verify: `Confirm ${fdPolicy} was in force on ${formatDate(addDays(todayBiz, -rng.int(1, 3)))} and carries ${rng.pick(["Collision", "Comprehensive"])} coverage`,
    contact: `Call ${pFd.first}: acknowledge the claim and take a recorded statement`,
    inspect: `Book the photo inspection at ${fdShop}`,
    estimate: `Review ${fdShop}'s estimate against the claims card`,
    pay: `Discuss the payment with ${pFd.first} and issue it within your authority`,
  };
  let fdSlots: string[];
  do fdSlots = rng.shuffle([...FIRST_DAY_ACTIONS]);
  while (fdSlots.every((a, i) => a === FIRST_DAY_ACTIONS[i]));
  fdSlots.forEach((a, i) => (v[`fd_i${i + 1}`] = fdLabels[a as keyof typeof fdLabels]));
  const fdOrder = FIRST_DAY_ACTIONS.map((a) => `i${fdSlots.indexOf(a) + 1}`);
  Object.assign(v, { fd_claim: fdClaim, fd_holder: pFd.full });

  // ---- Section 6: authority ----
  const auLimit = rng.pick([2500, 5000, 7500]) * 100;
  const auKind = rng.pick(["pay", "over", "refer", "ask"] as const);
  const auAmt = auKind === "over" ? Math.round(auLimit * (rng.int(105, 180) / 100)) + rng.int(0, 99) : Math.round(auLimit * (rng.int(30, 95) / 100)) + rng.int(0, 99);
  const auClaimant = personName(rng);
  let auCov = "verified";
  let auPhotos = "on file";
  let auWho = `${auClaimant.full}, no lawyer`;
  let auFraud = "none";
  if (auKind === "refer") {
    const why = rng.pick(["lawyer", "fraud", "coverage"] as const);
    if (why === "lawyer") auWho = `${auClaimant.full}, represented by ${rng.pick(LAW_FIRMS.filter((f) => f.name !== lawFirm.name)).name}`;
    else if (why === "fraud")
      auFraud = rng.pick(["the same damage was photographed on an earlier claim with another carrier", "the loss was reported two days after the policy was reinstated", "the repair invoice is dated before the reported loss"]);
    else auCov = rng.pick(["question: the driver isn't listed and lives in the household", "question: the vehicle was being used for paid deliveries"]);
  } else if (auKind === "ask") auPhotos = "not received yet";
  const au = placeOptions(rng, auKind === "pay" ? "Pay it: it's within your authority and the file is complete" : auKind === "ask" ? "Ask for the missing photos before paying" : `Send it to ${pSup.first} for approval with a note on why`, [
    ...(auKind === "pay" ? [] : ["Pay it: it's within your authority and the file is complete"]),
    ...(auKind === "ask" ? [] : ["Ask for the missing photos before paying"]),
    ...(auKind === "over" || auKind === "refer" ? [] : [`Send it to ${pSup.first} for approval with a note on why`]),
    "Split it into two payments that each fit within your authority",
  ]);
  LETTERS.forEach((l, j) => (v[`au_${l}`] = au.labels[j]));
  Object.assign(v, {
    au_claim: newClaim(),
    au_payee: rng.pick(BODY_SHOPS.filter((s) => s !== shop)),
    au_amt: auAmt,
    au_limit: auLimit,
    au_cov: auCov,
    au_photos: auPhotos,
    au_claimant: auWho,
    au_fraud: auFraud,
  });

  // ---- Section 6: values calls ----
  const viBase = rng.int(15, 60) / 10;
  const vcReal = rng.pick([500, 1000]) * 100;
  const vcSaid = vcReal === 50000 ? 25000 : rng.pick([25000, 50000]);
  const vlClaim = newClaim();
  Object.assign(v, {
    vi_claim: newClaim(),
    vi_shop: viShop,
    vi_base: `${viBase.toFixed(1)} hours`,
    vi_hours: `${(viBase + 2).toFixed(1)} hours`,
    vi_fee: rng.pick([50, 75, 100, 150]) * 100,
    vl_claimant: pVl.full,
    vl_first: pVl.first,
    vl_claim: vlClaim,
    vl_date: formatDate(addDays(todayBiz, -rng.int(5, 30))),
    vc_holder: pVc.full,
    vc_first: pVc.first,
    vc_claim: newClaim(),
    vc_said: wholeDollars(vcSaid),
    vc_real: wholeDollars(vcReal),
    vcc_holder: pVcc.full,
    vcc_first: pVcc.first,
    vcc_policy: policies[COV_ROWS + 1],
    vcc_place: rng.pick(["Northgate mall", "Fresh Basket grocery", "Riverside medical center", "Pinecrest school"]),
    vq_date: formatDate(addDays(todayBiz, rng.int(1, 3))),
    vq_count: String(rng.int(3, 7)),
  });
  const valueOptions: Record<string, string[]> = {
    vi: [
      `Decline the fee, allow only the hours the photos support, and tell ${pSup.first} about the offer today`,
      "Allow the two extra hours to keep the shop happy, but turn down the fee",
      "Take the fee: referral fees are normal between shops and adjusters",
      `Stop sending any claims to ${viShop} and report the shop to the state fraud bureau yourself`,
    ],
    vl: [
      `Tell ${pVl.first} politely that you'll deal with the claim through their lawyer, note the call in the file and tell ${pSup.first}`,
      `Give ${pVl.first} a figure, since they called you`,
      `Suggest ${pVl.first} could settle faster without the lawyer`,
      "Hang up without a word and send the whole file to Kestrel's legal department",
    ],
    vc: [
      `Call ${pVc.first} today to correct the deductible, apologise, note the file and tell ${pSup.first}`,
      "Leave it: the payment letter will show the right deductible",
      `Pay with the ${wholeDollars(vcSaid)} deductible you quoted, so ${pVc.first} isn't upset`,
      "Send a correction letter to every policyholder you've spoken to this month",
    ],
    vcc: [
      `Tell ${pVcc.first} you'll confirm the coverage today and call back within two hours, and help with a tow and a ride home now`,
      `Tell ${pVcc.first} yes, they're covered, to calm them down`,
      `Tell ${pVcc.first} it probably isn't covered, so they aren't disappointed later`,
      `Tell ${pVcc.first} you can't discuss anything until ${pSup.first} has reviewed the file`,
    ],
    vq: [
      `Close only the files that have the photos; request the missing photos and tell ${pSup.first} which files won't close by month end`,
      "Close them now and add the photos when they come in",
      "Use photos from a similar claim so the files can close",
      "Refuse to close any files this month and complain to the regional VP about the push",
    ],
  };
  const valueKeys: Record<string, { correct: string[] }> = {};
  for (const [prefix, [right, ...wrong]] of Object.entries(valueOptions)) {
    const p = placeOptions(rng, right, wrong);
    LETTERS.forEach((l, j) => (v[`${prefix}_${l}`] = p.labels[j]));
    valueKeys[prefix] = { correct: [p.letter] };
  }

  // ---- Rapid rounds, drawn last so the rest of the material doesn't shift when they change ----
  const mathKinds = fillSlots(rng.shuffle(MATH_EASY), rng.shuffle(MATH_HARD));
  const cmKeys = Object.fromEntries(mathKinds.map((k, i) => setRapid(rng, v, "cm", i, coverageMathItem(rng, k))));
  const dlCard = { ack: rng.pick([3, 5]), contact: rng.pick([1, 2]), status: rng.pick([30, 45]) };
  const dlEasy: DeadlineKind[] = rng.shuffle(["business", "business", "business", "business", "business", "calendar", "calendar", "calendar", "calendar", "calendar"]);
  const dlHard: DeadlineKind[] = rng.shuffle(["friday", "friday", "holiday", "holiday", rng.pick(["friday", "holiday"] as const)]);
  const dlKeys = Object.fromEntries(fillSlots(dlEasy, dlHard).map((k, i) => setRapid(rng, v, "dl", i, deadlineItem(rng, k, dlCard, newClaim(rng.pick([2026, 2027, 2028]))))));
  const stKinds = fillSlots(rng.shuffle(ST_EASY), ST_HARD);
  const stKeys = Object.fromEntries(stKinds.map((k, i) => setRapid(rng, v, "st", i, statementItem(rng, k, pSup.first, newClaim(2027)))));

  return {
    values: v,
    numbers: [...Object.values(estCells), ...Object.values(tlCells)].map((c) => c.value),
    keys: {
      "rapid-coverage-math": { items: cmKeys },
      "coverage-check": { findings: covFindings, decision: [covDec.letter] },
      "rapid-deadlines": { items: dlKeys },
      "estimate-review": { tolerance: 0.01, cells: estCells },
      "rapid-statements": { items: stKeys },
      "total-loss": { tolerance: 0.01, cells: tlCells },
      "first-day": { order: fdOrder },
      authority: { correct: [au.letter] },
      "values-integrity": valueKeys.vi,
      "values-in-lane": valueKeys.vl,
      "values-candor": valueKeys.vc,
      "values-client-care": valueKeys.vcc,
      "values-quality": valueKeys.vq,
    },
  };
}

export const claimsKestrelAutoDesk = defineScenario({
  slug: SLUG,
  version: 1,
  title: "Kestrel Mutual: claims representative",
  roleFamily: "insurance",
  timeLimitMinutes: 50,
  definition: DEFINITION,

  build(rng) {
    for (let tries = 0; tries < 200; tries++) {
      const { values, numbers, keys } = buildOnce(rng);
      if (!leaks(values, numbers)) return { values, keys };
    }
    return fail("every draw shows a computed amount");
  },
});
