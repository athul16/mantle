import { describe, expect, it } from "vitest";
import { createRng } from "@/lib/engine/server/rng";
import {
  COURTS,
  CITATION_GUIDE,
  CLIENT_COMPANIES,
  CASE_COMPANIES,
  FIRST_NAMES,
  LAST_NAMES,
  LAW_FIRMS,
  addDays,
  citationGuideText,
  citationParenthetical,
  computeDeadline,
  courtDaysAfter,
  daysBetween,
  federalHolidays,
  formatCaseCitation,
  formatDate,
  holidaysBetween,
  isCourtDay,
  isIsoDate,
  isLegalHoliday,
  isWeekend,
  legalHoliday,
  nextCourtDay,
  personName,
  pickDistinct,
  previousCourtDay,
  shortCaseCitation,
  weekdayOf,
  type CaseCite,
} from "@/lib/engine/scenarios/legal";

/**
 * Shared legal helpers (src/lib/engine/scenarios/legal): FRCP 6 time
 * computation with weekends and federal holidays, the firm's own citation
 * guide, and fictional name pools. The expected dates below are written out
 * by hand from a calendar, not computed, so the helpers can't agree with
 * themselves by accident.
 */

describe("legal dates: calendar basics", () => {
  it("validates ISO dates", () => {
    expect(isIsoDate("2026-03-02")).toBe(true);
    expect(isIsoDate("2028-02-29")).toBe(true);
    expect(isIsoDate("2027-02-29")).toBe(false);
    expect(isIsoDate("2026-13-01")).toBe(false);
    expect(isIsoDate("3/2/2026")).toBe(false);
    expect(() => addDays("2026-02-30", 1)).toThrow();
  });

  it("adds days across months, years and leap days", () => {
    expect(addDays("2026-03-02", 21)).toBe("2026-03-23");
    expect(addDays("2026-12-20", 14)).toBe("2027-01-03");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDays("2027-02-28", 1)).toBe("2027-03-01");
    expect(addDays("2026-03-23", -21)).toBe("2026-03-02");
    expect(daysBetween("2026-03-02", "2026-03-23")).toBe(21);
    expect(daysBetween("2026-12-20", "2027-01-03")).toBe(14);
  });

  it("knows the weekday", () => {
    expect(weekdayOf("2026-03-02")).toBe(1); // Monday
    expect(weekdayOf("2026-07-04")).toBe(6); // Saturday
    expect(weekdayOf("2027-07-04")).toBe(0); // Sunday
    expect(isWeekend("2026-07-04")).toBe(true);
    expect(isWeekend("2026-07-03")).toBe(false);
  });

  it("formats dates three ways", () => {
    expect(formatDate("2026-03-02")).toBe("Mon, Mar 2, 2026");
    expect(formatDate("2026-03-02", "long")).toBe("Monday, March 2, 2026");
    expect(formatDate("2027-12-31", "numeric")).toBe("12/31/2027");
  });
});

describe("legal dates: federal holidays (5 U.S.C. 6103), with observed dates", () => {
  const list = (year: number) => federalHolidays(year).map((h) => [h.date, h.name]);

  it("2026: Independence Day on a Saturday is observed Friday, July 3", () => {
    expect(list(2026)).toEqual([
      ["2026-01-01", "New Year's Day"],
      ["2026-01-19", "Birthday of Martin Luther King, Jr."],
      ["2026-02-16", "Washington's Birthday"],
      ["2026-05-25", "Memorial Day"],
      ["2026-06-19", "Juneteenth National Independence Day"],
      ["2026-07-03", "Independence Day"],
      ["2026-09-07", "Labor Day"],
      ["2026-10-12", "Columbus Day"],
      ["2026-11-11", "Veterans Day"],
      ["2026-11-26", "Thanksgiving Day"],
      ["2026-12-25", "Christmas Day"],
    ]);
    const july = federalHolidays(2026).find((h) => h.name === "Independence Day")!;
    expect(july).toMatchObject({ actual: "2026-07-04", observed: true });
  });

  it("2027: Juneteenth (Sat) on June 18, Independence Day (Sun) on July 5, Christmas (Sat) on December 24", () => {
    expect(list(2027)).toEqual([
      ["2027-01-01", "New Year's Day"],
      ["2027-01-18", "Birthday of Martin Luther King, Jr."],
      ["2027-02-15", "Washington's Birthday"],
      ["2027-05-31", "Memorial Day"],
      ["2027-06-18", "Juneteenth National Independence Day"],
      ["2027-07-05", "Independence Day"],
      ["2027-09-06", "Labor Day"],
      ["2027-10-11", "Columbus Day"],
      ["2027-11-11", "Veterans Day"],
      ["2027-11-25", "Thanksgiving Day"],
      ["2027-12-24", "Christmas Day"],
    ]);
  });

  it("2028: New Year's Day (Sat) is observed Friday, December 31, 2027; Veterans Day (Sat) on November 10", () => {
    expect(list(2028)).toEqual([
      ["2027-12-31", "New Year's Day"],
      ["2028-01-17", "Birthday of Martin Luther King, Jr."],
      ["2028-02-21", "Washington's Birthday"],
      ["2028-05-29", "Memorial Day"],
      ["2028-06-19", "Juneteenth National Independence Day"],
      ["2028-07-04", "Independence Day"],
      ["2028-09-04", "Labor Day"],
      ["2028-10-09", "Columbus Day"],
      ["2028-11-10", "Veterans Day"],
      ["2028-11-23", "Thanksgiving Day"],
      ["2028-12-25", "Christmas Day"],
    ]);
  });

  it("looks a date up by its observed day, across the year boundary", () => {
    expect(legalHoliday("2027-12-31")?.name).toBe("New Year's Day");
    expect(legalHoliday("2027-12-31")?.actual).toBe("2028-01-01");
    expect(isLegalHoliday("2026-07-03")).toBe(true);
    expect(isLegalHoliday("2026-11-27")).toBe(false); // the day after Thanksgiving is not a federal holiday
    expect(isLegalHoliday("2026-12-24")).toBe(false);
    expect(isCourtDay("2026-07-03")).toBe(false);
    expect(isCourtDay("2026-07-04")).toBe(false); // Saturday
    expect(isCourtDay("2026-07-06")).toBe(true);
  });

  it("lists holidays in a window, inclusive", () => {
    expect(holidaysBetween("2026-11-01", "2026-12-31").map((h) => h.date)).toEqual(["2026-11-11", "2026-11-26", "2026-12-25"]);
    expect(holidaysBetween("2027-12-20", "2028-01-20").map((h) => h.date)).toEqual(["2027-12-24", "2027-12-31", "2028-01-17"]);
    expect(holidaysBetween("2026-03-01", "2026-03-31")).toEqual([]);
  });

  it("every year 2026-2028 has eleven holidays, all on weekdays", () => {
    for (const year of [2026, 2027, 2028]) {
      const hs = federalHolidays(year);
      expect(hs.length).toBe(11);
      for (const h of hs) expect(isWeekend(h.date), `${h.date} ${h.name}`).toBe(false);
    }
  });
});

describe("legal dates: rolling to a court day", () => {
  it("rolls forward over weekends and holidays, never backward", () => {
    expect(nextCourtDay("2026-03-23")).toBe("2026-03-23");
    expect(nextCourtDay("2026-04-04")).toBe("2026-04-06"); // Sat -> Mon
    expect(nextCourtDay("2026-09-05")).toBe("2026-09-08"); // Sat, Sun, Labor Day -> Tue
    expect(nextCourtDay("2026-07-03")).toBe("2026-07-06"); // observed holiday, then the weekend
    expect(nextCourtDay("2027-12-24")).toBe("2027-12-27");
    expect(nextCourtDay("2027-12-31")).toBe("2028-01-03");
    expect(previousCourtDay("2026-04-04")).toBe("2026-04-03");
    expect(previousCourtDay("2026-09-07")).toBe("2026-09-04");
  });

  it("counts court days for the business-day mistake", () => {
    expect(courtDaysAfter("2026-03-02", 5)).toBe("2026-03-09");
    expect(courtDaysAfter("2026-08-31", 5)).toBe("2026-09-08"); // skips Labor Day
  });
});

describe("legal dates: FRCP 6(a) and 6(d) deadlines", () => {
  it("excludes the day of the event and counts every day after it", () => {
    expect(computeDeadline({ from: "2026-03-02", days: 21 })).toEqual({
      from: "2026-03-02",
      days: 21,
      periodEnds: "2026-03-23",
      lastDay: "2026-03-23",
      mailDaysAdded: 0,
      due: "2026-03-23",
      rolled: false,
    });
  });

  it("counts intermediate weekends and holidays (Thanksgiving inside a 14-day period)", () => {
    expect(computeDeadline({ from: "2026-11-20", days: 14 }).due).toBe("2026-12-04");
  });

  it("rolls a period ending on a weekend to Monday", () => {
    const d = computeDeadline({ from: "2026-03-05", days: 30 });
    expect(d.periodEnds).toBe("2026-04-04");
    expect(d.due).toBe("2026-04-06");
    expect(d.rolled).toBe(true);
  });

  it("rolls a period ending on a holiday, or on a weekend before a Monday holiday", () => {
    expect(computeDeadline({ from: "2026-08-24", days: 14 }).due).toBe("2026-09-08"); // Labor Day
    expect(computeDeadline({ from: "2026-08-15", days: 21 }).due).toBe("2026-09-08"); // Sat before Labor Day
    expect(computeDeadline({ from: "2026-06-19", days: 14 }).due).toBe("2026-07-06"); // observed July 3
    expect(computeDeadline({ from: "2026-10-27", days: 30 }).due).toBe("2026-11-27"); // Thanksgiving -> Friday
    expect(computeDeadline({ from: "2027-11-24", days: 30 }).due).toBe("2027-12-27"); // observed Christmas
    expect(computeDeadline({ from: "2027-12-01", days: 30 }).due).toBe("2028-01-03"); // observed New Year's Day 2028
  });

  it("mail service adds 3 days after the period would otherwise end, then rolls again", () => {
    const plain = computeDeadline({ from: "2026-03-02", days: 30, mailService: true });
    expect(plain).toMatchObject({ periodEnds: "2026-04-01", lastDay: "2026-04-01", mailDaysAdded: 3, due: "2026-04-06", rolled: true });
    // The period first rolls from Saturday to Monday, then 3 days are added: Thursday, not Tuesday.
    const rolledFirst = computeDeadline({ from: "2026-03-05", days: 30, mailService: true });
    expect(rolledFirst).toMatchObject({ periodEnds: "2026-04-04", lastDay: "2026-04-06", due: "2026-04-09" });
  });

  it("rejects bad input", () => {
    expect(() => computeDeadline({ from: "2026-03-02", days: 0 })).toThrow();
    expect(() => computeDeadline({ from: "2026-03-02", days: 2.5 })).toThrow();
    expect(() => computeDeadline({ from: "March 2", days: 14 })).toThrow();
  });

  it("agrees with a brute-force reading of the rule for every start date in 2026-2028", () => {
    const holidays = new Set([2026, 2027, 2028, 2029].flatMap((y) => federalHolidays(y).map((h) => h.date)));
    const open = (iso: string) => {
      const day = new Date(`${iso}T00:00:00Z`).getUTCDay();
      return day !== 0 && day !== 6 && !holidays.has(iso);
    };
    const roll = (iso: string) => {
      let d = iso;
      while (!open(d)) d = addDays(d, 1);
      return d;
    };
    for (let from = "2026-01-01"; from <= "2028-10-31"; from = addDays(from, 1)) {
      for (const days of [7, 14, 21, 28, 30, 60]) {
        const due = roll(addDays(from, days));
        expect(computeDeadline({ from, days }).due, `${from} + ${days}`).toBe(due);
        expect(computeDeadline({ from, days, mailService: true }).due, `${from} + ${days} by mail`).toBe(roll(addDays(due, 3)));
      }
    }
  });
});

describe("citation guide (the firm's own short guide, not any published manual)", () => {
  const circuit: CaseCite = { name: "Ashby v. Corliss Marine Supply, Inc.", volume: 41, reporter: "N.F.R. 3d", firstPage: 212, court: "14th-cir", year: 2019 };
  const district: CaseCite = { name: "Pell v. Garrow Cold Storage Co.", volume: 388, reporter: "N.F. Supp. 3d", firstPage: 1104, court: "d-wex", year: 2021 };
  const state: CaseCite = { name: "Quill v. Harrowgate Grain Co.", volume: 217, reporter: "Wex. 2d", firstPage: 55, court: "wex-sup", year: 2016 };

  it("formats full citations: name, volume, reporter, first page, pin, then court and year", () => {
    expect(formatCaseCitation(circuit, 219)).toBe("Ashby v. Corliss Marine Supply, Inc., 41 N.F.R. 3d 212, 219 (14th Cir. 2019)");
    expect(formatCaseCitation(district, 1110)).toBe("Pell v. Garrow Cold Storage Co., 388 N.F. Supp. 3d 1104, 1110 (D. Wex. 2021)");
    expect(formatCaseCitation(circuit)).toBe("Ashby v. Corliss Marine Supply, Inc., 41 N.F.R. 3d 212 (14th Cir. 2019)");
  });

  it("gives only the year when the reporter already names the court (Wexford Supreme Court)", () => {
    expect(formatCaseCitation(state, 61)).toBe("Quill v. Harrowgate Grain Co., 217 Wex. 2d 55, 61 (2016)");
    expect(citationParenthetical("wex-sup", 2016)).toBe("(2016)");
    expect(citationParenthetical("d-wex", 2021)).toBe("(D. Wex. 2021)");
  });

  it("short form: first party's name, volume, reporter, at the pin", () => {
    expect(shortCaseCitation(circuit, 219)).toBe("Ashby, 41 N.F.R. 3d at 219");
    expect(shortCaseCitation(district, 1110)).toBe("Pell, 388 N.F. Supp. 3d at 1110");
  });

  it("rejects a reporter the court doesn't publish in, and a pin before the first page", () => {
    expect(() => formatCaseCitation({ ...state, reporter: "N.F.R. 3d" }, 61)).toThrow();
    expect(() => formatCaseCitation(circuit, 200)).toThrow();
  });

  it("each court has a full name, an abbreviation and reporters; the guide text names every court", () => {
    const text = citationGuideText();
    for (const c of Object.values(COURTS)) {
      expect(c.name.length).toBeGreaterThan(10);
      expect(c.reporters.length).toBeGreaterThan(0);
      expect(text).toContain(c.name);
      if (!c.yearOnly) expect(text).toContain(c.abbr);
    }
    expect(CITATION_GUIDE.length).toBeGreaterThanOrEqual(5);
    expect(text).not.toMatch(/bluebook/i);
  });
});

describe("fictional name pools", () => {
  it("pools have no duplicates and enough names", () => {
    for (const [name, pool] of Object.entries({ FIRST_NAMES, LAST_NAMES, CASE_COMPANIES, CLIENT_COMPANIES })) {
      expect(new Set(pool).size, name).toBe(pool.length);
      expect(pool.length, name).toBeGreaterThanOrEqual(12);
    }
    expect(new Set(LAW_FIRMS.map((f) => f.name)).size).toBe(LAW_FIRMS.length);
    expect(new Set(LAW_FIRMS.map((f) => f.domain)).size).toBe(LAW_FIRMS.length);
    expect(LAW_FIRMS.length).toBeGreaterThanOrEqual(6);
    // Fictional domains only: the reserved .example top-level domain.
    for (const f of LAW_FIRMS) expect(f.domain).toMatch(/^[a-z]+\.example$/);
  });

  it("personName and pickDistinct are deterministic per seed and never repeat within a pick", () => {
    const a = createRng("legal-names");
    const b = createRng("legal-names");
    expect(personName(a)).toEqual(personName(b));
    const picked = pickDistinct(createRng("x"), LAST_NAMES, 10);
    expect(new Set(picked).size).toBe(10);
    expect(() => pickDistinct(createRng("x"), ["a", "b"], 3)).toThrow();
    const p = personName(createRng("y"));
    expect(p.full).toBe(`${p.first} ${p.last}`);
  });
});
