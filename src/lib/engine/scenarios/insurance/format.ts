import type { Rng } from "../../server/rng";

/**
 * Formatters for insurance scenarios (claims, underwriting): clock times as a
 * claim file prints them, calendar-month policy terms, whole-dollar limits and
 * deductibles, and policy and claim numbers. Pure and deterministic;
 * randomness only comes in through the scenario's seeded `Rng`.
 */

/** Minutes after midnight → "12:30 a.m.", "6:05 p.m.". */
export function formatClock(minutes: number): string {
  if (!Number.isInteger(minutes) || minutes < 0 || minutes >= 1440) throw new RangeError(`formatClock needs 0..1439 minutes, got ${minutes}`);
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, "0")} ${h < 12 ? "a.m." : "p.m."}`;
}

/** Minutes after midnight → "21:05" (24-hour, as a phone or GPS log prints UTC). */
export function formatClock24(minutes: number): string {
  if (!Number.isInteger(minutes) || minutes < 0 || minutes >= 1440) throw new RangeError(`formatClock24 needs 0..1439 minutes, got ${minutes}`);
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

/**
 * The same day `n` calendar months later ("YYYY-MM-DD"), as a six- or
 * twelve-month policy term runs. A day the later month doesn't have becomes its
 * last day (Jan 31 + 1 month = Feb 28).
 */
export function addMonths(date: string, n: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m || !Number.isInteger(n)) throw new RangeError(`addMonths("${date}", ${n})`);
  const total = Number(m[1]) * 12 + Number(m[2]) - 1 + n;
  const y = Math.floor(total / 12);
  const mo = total % 12;
  const last = new Date(Date.UTC(y, mo + 1, 0)).getUTCDate();
  const d = Math.min(Number(m[3]), last);
  return `${y}-${String(mo + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** Whole dollars from cents, as declarations print limits and deductibles: "$500", "$1,000". */
export function wholeDollars(cents: number): string {
  if (!Number.isInteger(cents) || cents % 100 !== 0) throw new RangeError(`wholeDollars needs whole dollars in cents, got ${cents}`);
  return `$${(cents / 100).toLocaleString("en-US")}`;
}

/** A policy number like "KMA-4821937" (prefix + seven digits). */
export function policyNumber(rng: Rng, prefix: string): string {
  return `${prefix}-${rng.int(1_000_000, 9_999_999)}`;
}

/** A claim number like "AU-27-48213" (line of business, two-digit year, five digits). */
export function claimNumber(rng: Rng, line: string, year: number): string {
  return `${line}-${String(year % 100).padStart(2, "0")}-${rng.int(10_000, 99_999)}`;
}

/** `n` different values from `make`, drawn until distinct. */
export function distinctDraws<T>(rng: Rng, n: number, make: (rng: Rng) => T): T[] {
  const out: T[] = [];
  for (let tries = 0; out.length < n; tries++) {
    if (tries > 10_000) throw new Error("distinctDraws: can't find enough distinct values");
    const x = make(rng);
    if (!out.includes(x)) out.push(x);
  }
  return out;
}
