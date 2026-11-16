/**
 * Court calendar math for legal scenarios: ISO dates, U.S. federal holidays
 * with their observed days, and deadline computation under the Federal Rules
 * of Civil Procedure:
 *
 * - FRCP 6(a)(1): exclude the day of the event that triggers the period;
 *   count every day, including intermediate Saturdays, Sundays and legal
 *   holidays; include the last day, but if it is a Saturday, Sunday or legal
 *   holiday the period runs until the end of the next day that isn't.
 * - FRCP 6(d): when a party must act within a time after being served and
 *   service is by mail (Rule 5(b)(2)(C)) and some other methods, 3 days are
 *   added after the period would otherwise expire under 6(a). If that third
 *   day isn't a court day, it rolls forward again. E-service gets no extra days.
 * - FRCP 6(a)(6): "legal holiday" means the federal holidays (5 U.S.C. 6103)
 *   plus any day the state where the court sits declares a holiday. Our
 *   scenarios use a fictional state (Wexford) that adds none.
 *
 * Holidays are computed by rule (fixed dates and "nth weekday" rules), with the
 * federal observance shift: a holiday on a Saturday is observed the Friday
 * before, one on a Sunday the Monday after (5 U.S.C. 6103(b), EO 11582). New
 * Year's Day 2028 falls on a Saturday, so it is observed on Friday,
 * December 31, 2027. Verified against the calendar for 2026–2028
 * (tests/engine/legal-helpers.test.ts); Juneteenth exists from 2021.
 *
 * Pure functions on "YYYY-MM-DD" strings in UTC, so results never depend on
 * the machine's time zone. Browser-safe, no answer keys here.
 */

/** A calendar date as "YYYY-MM-DD". */
export type IsoDate = string;

/** Years whose holiday tables are checked against the calendar in tests. */
export const VERIFIED_HOLIDAY_YEARS = [2026, 2027, 2028] as const;

const DAY_MS = 86_400_000;
const ISO_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/** True for a real calendar date written "YYYY-MM-DD". */
export function isIsoDate(value: string): boolean {
  const m = ISO_PATTERN.exec(value);
  if (!m) return false;
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return new Date(t).toISOString().slice(0, 10) === value;
}

function toTime(date: IsoDate): number {
  if (!isIsoDate(date)) throw new RangeError(`not a calendar date: "${date}"`);
  return Date.parse(`${date}T00:00:00Z`);
}

const fromTime = (t: number): IsoDate => new Date(t).toISOString().slice(0, 10);

/** The date `days` later (negative for earlier). */
export function addDays(date: IsoDate, days: number): IsoDate {
  if (!Number.isInteger(days)) throw new RangeError(`addDays needs a whole number of days, got ${days}`);
  return fromTime(toTime(date) + days * DAY_MS);
}

/** Days from `a` to `b` (positive when `b` is later). */
export function daysBetween(a: IsoDate, b: IsoDate): number {
  return Math.round((toTime(b) - toTime(a)) / DAY_MS);
}

/** 0 = Sunday … 6 = Saturday. */
export function weekdayOf(date: IsoDate): number {
  return new Date(toTime(date)).getUTCDay();
}

export function isWeekend(date: IsoDate): boolean {
  const d = weekdayOf(date);
  return d === 0 || d === 6;
}

const iso = (year: number, month: number, day: number): IsoDate => fromTime(Date.UTC(year, month - 1, day));

/** The nth (1-based) given weekday of a month, or the last one when n is -1. */
function nthWeekday(year: number, month: number, weekday: number, n: number): IsoDate {
  if (n === -1) {
    const last = iso(year, month + 1, 0);
    return addDays(last, -((weekdayOf(last) - weekday + 7) % 7));
  }
  const first = iso(year, month, 1);
  return addDays(first, ((weekday - weekdayOf(first) + 7) % 7) + (n - 1) * 7);
}

/** Saturday → Friday before, Sunday → Monday after. */
function observedDay(actual: IsoDate): IsoDate {
  const d = weekdayOf(actual);
  return d === 6 ? addDays(actual, -1) : d === 0 ? addDays(actual, 1) : actual;
}

export interface FederalHoliday {
  /** The day courts and federal offices are closed (the observed day). */
  date: IsoDate;
  /** The holiday's name as in 5 U.S.C. 6103(a). */
  name: string;
  /** The holiday's own date, which may be a weekend day. */
  actual: IsoDate;
  /** True when `date` differs from `actual` because `actual` is on a weekend. */
  observed: boolean;
}

/**
 * The eleven federal holidays whose own date falls in `year`, in date order,
 * each with the day it is observed. That day can fall in the previous year
 * (New Year's Day on a Saturday is observed December 31).
 */
export function federalHolidays(year: number): FederalHoliday[] {
  return holidayTable(year).map((h) => ({ ...h }));
}

const tables = new Map<number, readonly FederalHoliday[]>();
const byObservedDay = new Map<IsoDate, FederalHoliday>();

/** Cached per year: scenario generators look days up thousands of times. */
function holidayTable(year: number): readonly FederalHoliday[] {
  const cached = tables.get(year);
  if (cached) return cached;
  const table = Object.freeze(computeHolidays(year).map((h) => Object.freeze(h)));
  tables.set(year, table);
  for (const h of table) byObservedDay.set(h.date, h);
  return table;
}

function computeHolidays(year: number): FederalHoliday[] {
  if (!Number.isInteger(year) || year < 1971 || year > 2199) throw new RangeError(`federalHolidays: unsupported year ${year}`);
  const actuals: [string, IsoDate][] = [
    ["New Year's Day", iso(year, 1, 1)],
    ["Birthday of Martin Luther King, Jr.", nthWeekday(year, 1, 1, 3)],
    ["Washington's Birthday", nthWeekday(year, 2, 1, 3)],
    ["Memorial Day", nthWeekday(year, 5, 1, -1)],
    ...(year >= 2021 ? ([["Juneteenth National Independence Day", iso(year, 6, 19)]] as [string, IsoDate][]) : []),
    ["Independence Day", iso(year, 7, 4)],
    ["Labor Day", nthWeekday(year, 9, 1, 1)],
    ["Columbus Day", nthWeekday(year, 10, 1, 2)],
    ["Veterans Day", iso(year, 11, 11)],
    ["Thanksgiving Day", nthWeekday(year, 11, 4, 4)],
    ["Christmas Day", iso(year, 12, 25)],
  ];
  return actuals.map(([name, actual]) => {
    const date = observedDay(actual);
    return { date, name, actual, observed: date !== actual };
  });
}

/** The federal holiday observed on this day, if any. */
export function legalHoliday(date: IsoDate): FederalHoliday | undefined {
  const year = Number(date.slice(0, 4));
  toTime(date); // validates
  // An observed day can belong to next year's holiday (December 31 for New Year's Day).
  holidayTable(year);
  holidayTable(year + 1);
  const h = byObservedDay.get(date);
  return h ? { ...h } : undefined;
}

export function isLegalHoliday(date: IsoDate): boolean {
  return legalHoliday(date) !== undefined;
}

/** Not a Saturday, Sunday or legal holiday. */
export function isCourtDay(date: IsoDate): boolean {
  return !isWeekend(date) && !isLegalHoliday(date);
}

/** `date` itself when it is a court day, else the next court day (FRCP 6(a)(1)(C)). */
export function nextCourtDay(date: IsoDate): IsoDate {
  let d = date;
  while (!isCourtDay(d)) d = addDays(d, 1);
  return d;
}

/** `date` itself when it is a court day, else the court day before. Rolling back is a mistake under FRCP 6; scenarios use it for wrong options. */
export function previousCourtDay(date: IsoDate): IsoDate {
  let d = date;
  while (!isCourtDay(d)) d = addDays(d, -1);
  return d;
}

/** The date `n` court days after `date` (skipping weekends and holidays): the "business days" miscount. */
export function courtDaysAfter(date: IsoDate, n: number): IsoDate {
  if (!Number.isInteger(n) || n < 1) throw new RangeError(`courtDaysAfter needs a positive whole number, got ${n}`);
  let d = date;
  for (let left = n; left > 0; ) {
    d = addDays(d, 1);
    if (isCourtDay(d)) left--;
  }
  return d;
}

/** Federal holidays observed between two dates, inclusive, in date order. */
export function holidaysBetween(from: IsoDate, to: IsoDate): FederalHoliday[] {
  const [y0, y1] = [Number(from.slice(0, 4)), Number(to.slice(0, 4))];
  const all: FederalHoliday[] = [];
  for (let y = y0; y <= y1 + 1; y++) all.push(...holidayTable(y));
  toTime(from);
  toTime(to);
  return all.filter((h) => h.date >= from && h.date <= to).sort((a, b) => a.date.localeCompare(b.date)).map((h) => ({ ...h }));
}

export interface DeadlineInput {
  /** The day of the event that triggers the period (service, entry, filing). Not counted. */
  from: IsoDate;
  /** The period in days, e.g. 21 to answer a complaint (FRCP 12(a)(1)(A)(i)). */
  days: number;
  /** Served by mail (or another FRCP 6(d) method): add 3 days after the period ends. */
  mailService?: boolean;
}

export interface Deadline {
  from: IsoDate;
  days: number;
  /** `from` + `days`, before any roll. */
  periodEnds: IsoDate;
  /** The last day of the 6(a) period: `periodEnds` rolled forward to a court day. */
  lastDay: IsoDate;
  /** 3 when FRCP 6(d) applies, else 0. */
  mailDaysAdded: 0 | 3;
  /** The date to calendar. */
  due: IsoDate;
  /** True when `due` isn't simply `periodEnds` + the mail days, i.e. a weekend or holiday moved it. */
  rolled: boolean;
}

/** FRCP 6(a) time computation in days, plus 6(d) when served by mail. */
export function computeDeadline({ from, days, mailService = false }: DeadlineInput): Deadline {
  if (!Number.isInteger(days) || days < 1) throw new RangeError(`computeDeadline needs a positive whole number of days, got ${days}`);
  const periodEnds = addDays(from, days);
  const lastDay = nextCourtDay(periodEnds);
  const mailDaysAdded = mailService ? 3 : 0;
  const due = mailService ? nextCourtDay(addDays(lastDay, 3)) : lastDay;
  return { from, days, periodEnds, lastDay, mailDaysAdded, due, rolled: due !== addDays(periodEnds, mailDaysAdded) };
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/**
 * "short": "Mon, Mar 2, 2026" (the default; a docket calendar's style),
 * "long": "Monday, March 2, 2026", "numeric": "3/2/2026".
 */
export function formatDate(date: IsoDate, style: "short" | "long" | "numeric" = "short"): string {
  const t = new Date(toTime(date));
  const [y, m, d, wd] = [t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate(), t.getUTCDay()];
  if (style === "numeric") return `${m + 1}/${d}/${y}`;
  if (style === "long") return `${WEEKDAYS[wd]}, ${MONTHS[m]} ${d}, ${y}`;
  return `${WEEKDAYS[wd].slice(0, 3)}, ${MONTHS[m].slice(0, 3)} ${d}, ${y}`;
}
