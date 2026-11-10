import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { harborLaneBankRec } = await import("@/lib/engine/scenarios/harbor-lane-bank-rec");
const { getScenario, listScenarios } = await import("@/lib/engine/scenarios");
const { renderAttemptForCandidate } = await import("@/lib/engine/server/render");
const { scoreAttempt } = await import("@/lib/engine/server/score");

/**
 * docs/07 Example 4: Harbor Lane Coffee Co., October bank rec with a voided
 * check announced at minute 12. These tests solve the rec from what the
 * candidate sees (the rendered workbook and emails), then compare that with
 * the server key, so the material and the key can't drift apart.
 */

const scenario = harborLaneBankRec;
const SEEDS = Array.from({ length: 200 }, (_, i) => `attempt-${i.toString(16).padStart(4, "0")}`);
const UPDATE_MINUTE = 12;

type Cell = { kind: "text"; text: string } | { kind: "input"; id: string } | { kind: "empty" };
type Grid = { prompt: string; columns: string[]; rows: Cell[][] };
type KeyLine = { accounts: string[]; side: "debit" | "credit"; amount: number };
type JeKey = { entries: Record<string, { lines: KeyLine[] }> };
type SheetKey = { cells: Record<string, { value: number }> };
type ReplyKey = { notes: Record<string, string> };

const text = (c: Cell | undefined) => (c && c.kind === "text" ? c.text : "");
const cents = (s: string) => {
  const t = s.trim();
  if (t === "") return 0;
  const neg = /^\(.*\)$/.test(t) || t.startsWith("-");
  const n = Math.round(Number(t.replace(/[()$,\s-]/g, "")) * 100);
  return neg ? -n : n;
};
const dollars = (c: number) => c / 100;

/** What the candidate sees after the whole attempt, parsed into ledgers. */
function screen(seed: string) {
  const view = renderAttemptForCandidate(scenario, seed, scenario.timeLimitMinutes);
  const sheet = view.steps.find((s) => s.id === "bank-rec")!.config as Grid;
  const section = (title: RegExp) => {
    const start = sheet.rows.findIndex((r) => title.test(text(r[0])));
    expect(start, `section ${title}`).toBeGreaterThanOrEqual(0);
    const out: { date: string; ref: string; desc: string; debit: number; credit: number; balance: number }[] = [];
    for (const r of sheet.rows.slice(start + 1)) {
      if (!/^\d\d\/\d\d$/.test(text(r[0]))) {
        if (out.length) break;
        continue;
      }
      out.push({
        date: text(r[0]),
        ref: text(r[1]),
        desc: text(r[2]),
        debit: cents(text(r[3])),
        credit: cents(text(r[4])),
        balance: cents(text(r[5])),
      });
    }
    return out;
  };
  const bank = section(/^Bank statement/i);
  const gl = section(/^General ledger/i);
  const labelled = (label: RegExp) => {
    const row = sheet.rows.find((r) => label.test(text(r[0])));
    expect(row, `row ${label}`).toBeDefined();
    return row!;
  };
  const update = view.messages.find((m) => m.arriveAtMinute === UPDATE_MINUTE)!;
  return { view, sheet, bank, gl, labelled, update };
}

/** The reconciliation a careful accountant gets from the screen, in cents. */
function solve(seed: string) {
  const { bank, gl, update } = screen(seed);
  const checkNo = (desc: string) => desc.match(/#(\d+)/)?.[1];
  const voidedNo = update.body.match(/#(\d+)/)![1];
  const bankChecks = new Map(bank.filter((r) => checkNo(r.desc)).map((r) => [checkNo(r.desc)!, r.debit]));
  const glChecks = gl.filter((r) => /^\d+$/.test(r.ref));
  const glDeposits = gl.filter((r) => r.debit > 0);
  const bankDeposits = bank.filter((r) => /^Deposit/i.test(r.desc));

  const voided = glChecks.find((r) => r.ref === voidedNo)!;
  const outstanding = glChecks.filter((r) => !bankChecks.has(r.ref) && r.ref !== voidedNo);
  const miscoded = glChecks.find((r) => bankChecks.has(r.ref) && bankChecks.get(r.ref) !== r.credit)!;
  const dit = glDeposits.filter((d) => !bankDeposits.some((b) => b.credit === d.debit && b.date === d.date));
  const fee = bank.find((r) => /service fee/i.test(r.desc))!.debit;
  const interest = bank.find((r) => /interest/i.test(r.desc))!.credit;
  const nsf = bank.find((r) => /NSF/.test(r.desc))!.debit;

  const bankEnd = bank.at(-1)!.balance;
  const bookEnd = gl.at(-1)!.balance;
  const ditTotal = dit.reduce((s, r) => s + r.debit, 0);
  const ocTotal = outstanding.reduce((s, r) => s + r.credit, 0);
  const bookError = miscoded.credit - bankChecks.get(miscoded.ref)!; // + means books overstated the payment
  const adjBank = bankEnd + ditTotal - ocTotal;
  const adjBook = bookEnd + interest + voided.credit - fee - nsf + bookError;

  return {
    bankEnd,
    bookEnd,
    dit: ditTotal,
    ditCount: dit.length,
    outstanding,
    oc: ocTotal,
    voided,
    miscoded,
    bookError,
    fee,
    interest,
    nsf,
    adjBank,
    adjBook,
    trap: adjBank - voided.credit,
  };
}

const entry = (dr: string, cr: string, amount: number, memo = "") => ({
  memo,
  lines: [
    { account: dr, debit: amount, credit: null },
    { account: cr, debit: null, credit: amount },
  ],
});

/** A strong candidate's answers, built only from the screen. */
function perfectAnswers(seed: string) {
  const s = solve(seed);
  const fix = Math.abs(s.bookError);
  return {
    "bank-rec": {
      cells: {
        dit: dollars(s.dit),
        oc: dollars(s.oc),
        bank_err: null,
        adj_bank: dollars(s.adjBank),
        interest: dollars(s.interest),
        voided: dollars(s.voided.credit),
        fee: dollars(s.fee),
        nsf: dollars(s.nsf),
        book_err: dollars(s.bookError),
        adj_book: dollars(s.adjBook),
        diff: 0,
      },
    },
    "rec-entries": {
      entries: [
        entry("6200", "1010", dollars(s.fee), "October service fee"),
        entry("1200", "1010", dollars(s.nsf), "Maple St. Bakery NSF check"),
        entry("1010", "7100", dollars(s.interest), "October interest"),
        s.bookError < 0 ? entry("5100", "1010", dollars(fix), "Check entry error") : entry("1010", "5100", dollars(fix), "Check entry error"),
        entry("1010", "6100", dollars(s.voided.credit), "Void check"),
      ],
    },
    "dana-reply": {
      body: `Hi Dana,\n\nOctober is reconciled. Adjusted cash is ${dollars(s.adjBank)} on both sides.\n\nThanks`,
    },
  };
}

type Answers = ReturnType<typeof perfectAnswers>;
const clone = (a: Answers): Answers => JSON.parse(JSON.stringify(a));
const AUTO_STEPS = ["bank-rec", "rec-entries"] as const;

describe("harbor-lane-bank-rec: setup", () => {
  it("is registered, 30 minutes, accounting, and uses only built step types", () => {
    expect(getScenario("harbor-lane-bank-rec", 1)).toBe(scenario);
    expect(listScenarios()).toContain(scenario);
    expect(scenario.timeLimitMinutes).toBe(30);
    expect(scenario.roleFamily).toBe("accounting");
    expect(scenario.definition.steps.map((s) => [s.id, s.type])).toEqual([
      ["bank-rec", "spreadsheet"],
      ["rec-entries", "journal_entry"],
      ["dana-reply", "inbox_reply"],
    ]);
    expect(scenario.definition.intro).toMatch(/Oakline CPA Group/);
    expect(scenario.definition.intro).toMatch(/Harbor Lane Coffee/);
    expect(scenario.definition.intro).toMatch(/Dana Ruiz/);
  });

  it("renders for 200 seeds at every point in the timeline", () => {
    for (const seed of SEEDS) {
      for (const minute of [0, UPDATE_MINUTE - 1, UPDATE_MINUTE, scenario.timeLimitMinutes]) {
        const view = renderAttemptForCandidate(scenario, seed, minute);
        expect(view.steps.length).toBe(3);
        expect(JSON.stringify(view)).not.toContain("{{");
      }
    }
  });

  it("is deterministic per seed and gives every seed different numbers", () => {
    for (const seed of SEEDS.slice(0, 20)) expect(scenario.generate(seed)).toEqual(scenario.generate(seed));
    expect(new Set(SEEDS.map((s) => JSON.stringify(scenario.generate(s).values))).size).toBe(SEEDS.length);
    expect(new Set(SEEDS.map((s) => solve(s).adjBank)).size).toBeGreaterThan(190);
  });
});

describe("harbor-lane-bank-rec: every variant is internally consistent", () => {
  it("both ledgers run correctly and open at the same balance (September was clean)", () => {
    for (const seed of SEEDS) {
      const { bank, gl, labelled } = screen(seed);
      // Bank statement: debit = money out of the account. GL cash: debit = money in.
      const runs = [
        [bank, (r: (typeof bank)[number]) => r.credit - r.debit],
        [gl, (r: (typeof gl)[number]) => r.debit - r.credit],
      ] as const;
      for (const [ledger, change] of runs) {
        expect(/opening|beginning/i.test(ledger[0].desc), seed).toBe(true);
        for (let i = 1; i < ledger.length; i++) {
          expect(ledger[i].balance, `${seed} row ${i}`).toBe(ledger[i - 1].balance + change(ledger[i]));
          expect(ledger[i].balance, `${seed} row ${i} stays positive`).toBeGreaterThan(0);
        }
      }
      expect(bank[0].balance).toBe(gl[0].balance);

      expect(cents(text(labelled(/^Balance per bank/i)[5]))).toBe(bank.at(-1)!.balance);
      expect(cents(text(labelled(/^Balance per books/i)[5]))).toBe(gl.at(-1)!.balance);
    }
  });

  it("plants exactly the docs/07 items", () => {
    for (const seed of SEEDS) {
      const s = solve(seed);
      expect(s.ditCount, seed).toBe(1);
      expect(s.outstanding.length, seed).toBe(1);
      expect(s.outstanding[0].date).toBe("10/30");
      expect(s.voided.date).toBe("10/26");
      expect(s.fee).toBeGreaterThan(0);
      expect(s.interest).toBeGreaterThan(0);
      expect(s.nsf).toBeGreaterThan(0);
      // A transposition: same digits, different order, the gap a multiple of $90 (9 × a whole-dollar step of ten).
      const bankAmt = s.miscoded.credit - s.bookError;
      expect([...String(bankAmt)].sort().join("")).toBe([...String(s.miscoded.credit)].sort().join(""));
      expect(s.bookError).not.toBe(0);
      expect(Math.abs(s.bookError) % 9000).toBe(0);
    }
  });

  it("the reconciliation ties, and the missed-update trap also ties at a different number", () => {
    for (const seed of SEEDS) {
      const s = solve(seed);
      expect(s.adjBank, seed).toBe(s.adjBook);
      expect(s.adjBank).toBeGreaterThan(0);
      // docs/07: ignoring the minute-12 email lists the voided check as outstanding; both sides tie at adj − voided.
      const trapBank = s.bankEnd + s.dit - s.oc - s.voided.credit;
      const trapBook = s.adjBook - s.voided.credit;
      expect(trapBank).toBe(trapBook);
      expect(trapBank).toBe(s.trap);
      expect(s.trap).not.toBe(s.adjBank);
    }
  });

  it("the key matches the solution from the screen", () => {
    for (const seed of SEEDS) {
      const s = solve(seed);
      const key = (scenario.generate(seed).keys["bank-rec"] as SheetKey).cells;
      const k = (id: string) => Math.round(key[id].value * 100);
      expect(k("dit")).toBe(s.dit);
      expect(k("oc")).toBe(s.oc);
      expect(k("interest")).toBe(s.interest);
      expect(k("voided")).toBe(s.voided.credit);
      expect(k("fee")).toBe(s.fee);
      expect(k("nsf")).toBe(s.nsf);
      expect(k("book_err")).toBe(s.bookError);
      expect(k("adj_bank")).toBe(s.adjBank);
      expect(k("adj_book")).toBe(s.adjBook);
    }
  });

  it("every key entry balances and together they move cash from the book balance to the adjusted balance", () => {
    for (const seed of SEEDS) {
      const s = solve(seed);
      const je = scenario.generate(seed).keys["rec-entries"] as JeKey;
      expect(Object.keys(je.entries).sort()).toEqual(["fee", "interest", "nsf", "transposition", "voided"]);
      let cashChange = 0;
      for (const [id, e] of Object.entries(je.entries)) {
        const dr = e.lines.filter((l) => l.side === "debit").reduce((t, l) => t + Math.round(l.amount * 100), 0);
        const cr = e.lines.filter((l) => l.side === "credit").reduce((t, l) => t + Math.round(l.amount * 100), 0);
        expect(dr, `${seed} ${id} balances`).toBe(cr);
        for (const l of e.lines.filter((l) => l.accounts.includes("1010"))) {
          cashChange += (l.side === "debit" ? 1 : -1) * Math.round(l.amount * 100);
        }
      }
      expect(cashChange, seed).toBe(s.adjBook - s.bookEnd);
    }
  });
});

describe("harbor-lane-bank-rec: scoring", () => {
  it("is out of 100: rec 45, entries 15, reply 40 (docs/07)", () => {
    const blank = scoreAttempt(scenario, "abc", {});
    expect(blank.points).toBe(0);
    expect(blank.maxPoints).toBe(100);
    expect(blank.steps["bank-rec"].maxPoints).toBe(45);
    expect(blank.steps["rec-entries"].maxPoints).toBe(15);
    expect(blank.steps["dana-reply"].maxPoints).toBe(40);
  });

  it("a perfect answer earns every automatic point, and the reply goes to review", () => {
    for (const seed of SEEDS.slice(0, 100)) {
      const s = scoreAttempt(scenario, seed, perfectAnswers(seed));
      for (const id of AUTO_STEPS) expect(s.steps[id].points, `${seed} ${id}`).toBe(s.steps[id].maxPoints);
      expect(s.steps["dana-reply"].needsReview).toBe(true);
    }
  });

  it("a perfect answer is 100% once the reviewer gives the reply full marks", () => {
    const s = scoreAttempt(scenario, "abc", perfectAnswers("abc"));
    const reviewed = s.points - s.steps["dana-reply"].points + s.steps["dana-reply"].maxPoints;
    expect(reviewed / s.maxPoints).toBe(1);
  });

  it("another seed's perfect answer doesn't score well (answers can't be shared)", () => {
    const s = scoreAttempt(scenario, "attempt-0001", perfectAnswers("attempt-0000"));
    // Account choices are the same for everyone, so entries keep half-credit for accounts; amounts are all wrong.
    expect(s.steps["bank-rec"].points).toBeLessThan(10);
    expect(s.steps["bank-rec"].points + s.steps["rec-entries"].points).toBeLessThan(20);
  });

  describe("typical mistakes get partial credit", () => {
    const seed = "attempt-002a";

    it("missed the minute-12 update: voided check left outstanding, both sides tie at the trap number", () => {
      const s = solve(seed);
      const a = clone(perfectAnswers(seed));
      a["bank-rec"].cells.oc = dollars(s.oc + s.voided.credit);
      a["bank-rec"].cells.voided = null as unknown as number;
      a["bank-rec"].cells.adj_bank = dollars(s.trap);
      a["bank-rec"].cells.adj_book = dollars(s.trap);
      a["rec-entries"].entries.pop();

      const r = scoreAttempt(scenario, seed, a);
      const rec = r.steps["bank-rec"];
      // Keeps the five other planted items (25). Loses the update (10), the outstanding-checks
      // total (5, since the voided check is in it) and the final balance (5).
      expect(rec.points).toBe(25);
      const item = (id: string) => rec.items.find((i) => i.id === id)!;
      expect(item("voided").earned).toBe(0);
      expect(item("oc").earned).toBe(0);
      expect(item("adj_bank").earned).toBe(0);
      expect(item("adj_book").earned).toBe(0);
      // The report shows the reviewer the trap number next to the right one.
      expect(item("adj_book").note).toContain(dollars(s.trap).toLocaleString("en-US", { minimumFractionDigits: 2 }));
      expect(r.steps["rec-entries"].points).toBe(12);
    });

    it("transposition error entered with the wrong sign costs that item and the adjusted book balance", () => {
      const s = solve(seed);
      const a = clone(perfectAnswers(seed));
      a["bank-rec"].cells.book_err = dollars(-s.bookError);
      a["bank-rec"].cells.adj_book = dollars(s.adjBook - 2 * s.bookError);
      expect(scoreAttempt(scenario, seed, a).steps["bank-rec"].points).toBe(45 - 5 - 2.5);
    });

    it("forgot the deposit in transit: loses that item and the adjusted bank balance only", () => {
      const s = solve(seed);
      const a = clone(perfectAnswers(seed));
      a["bank-rec"].cells.dit = null as unknown as number;
      a["bank-rec"].cells.adj_bank = dollars(s.adjBank - s.dit);
      expect(scoreAttempt(scenario, seed, a).steps["bank-rec"].points).toBe(45 - 5 - 2.5);
    });

    it("booked the full check amount instead of the $ difference: right accounts, wrong amount, half credit", () => {
      const s = solve(seed);
      const a = clone(perfectAnswers(seed));
      const fix = a["rec-entries"].entries[3];
      const wrong = dollars(s.miscoded.credit);
      for (const l of fix.lines) {
        if (l.debit !== null) l.debit = wrong;
        if (l.credit !== null) l.credit = wrong;
      }
      const je = scoreAttempt(scenario, seed, a).steps["rec-entries"];
      expect(je.points).toBe(15 - 1.5);
    });

    it("accepts Accounts payable instead of COGS for the check error (docs/07)", () => {
      const s = solve(seed);
      const a = clone(perfectAnswers(seed));
      const fix = a["rec-entries"].entries[3];
      const cogsLine = fix.lines.find((l) => l.account === "5100")!;
      cogsLine.account = "2000";
      expect(s.bookError).not.toBe(0);
      expect(scoreAttempt(scenario, seed, a).steps["rec-entries"].points).toBe(15);
    });

    it("NSF booked to an expense instead of receivables: some credit for the cash side, not full", () => {
      const a = clone(perfectAnswers(seed));
      a["rec-entries"].entries[1].lines[0].account = "6200";
      const pts = scoreAttempt(scenario, seed, a).steps["rec-entries"].points;
      expect(pts).toBeGreaterThan(12);
      expect(pts).toBeLessThan(15);
    });

    it("an unbalanced entry earns at most half its points", () => {
      const a = clone(perfectAnswers(seed));
      a["rec-entries"].entries[0].lines[1].credit = 1;
      expect(scoreAttempt(scenario, seed, a).steps["rec-entries"].points).toBeLessThanOrEqual(15 - 1.5);
    });

    it("a blank reply is final at 0 and isn't sent to review", () => {
      const a = clone(perfectAnswers(seed));
      a["dana-reply"].body = "  ";
      const r = scoreAttempt(scenario, seed, a).steps["dana-reply"];
      expect(r.points).toBe(0);
      expect(r.needsReview).toBe(false);
    });
  });

  it("gives the reviewer the docs/07 rubric with this variant's numbers", () => {
    const s = solve("abc");
    const r = scoreAttempt(scenario, "abc", perfectAnswers("abc")).steps["dana-reply"];
    expect(r.items.map((i) => [i.id, i.max])).toEqual([
      ["answer", 10],
      ["client-issues", 10],
      ["update", 5],
      ["clarity", 10],
      ["tone", 5],
    ]);
    const money = (c: number) => `$${dollars(c).toLocaleString("en-US", { minimumFractionDigits: 2 })}`;
    const notes = (scenario.generate("abc").keys["dana-reply"] as ReplyKey).notes;
    expect(notes.answer).toContain(money(s.adjBank));
    expect(notes.answer).toContain(money(s.trap));
    expect(notes["client-issues"]).toContain(money(s.nsf));
    expect(notes["client-issues"]).toContain(money(Math.abs(s.bookError)));
    expect(notes.update).toContain(`#${s.voided.ref}`);
  });
});

describe("harbor-lane-bank-rec: nothing derived reaches the candidate", () => {
  const forms = (c: number) => {
    const d = dollars(Math.abs(c));
    return [d.toFixed(2), d.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }), String(Math.abs(c))];
  };
  const contains = (payload: string, form: string) => new RegExp(`(?<![\\d.,])${form.replace(/[.$]/g, "\\$&")}(?![\\d.]\\d)`).test(payload);

  it("no adjusted balance, trap balance, check-error amount or reviewer note in any payload", () => {
    for (const seed of SEEDS) {
      const s = solve(seed);
      const variant = scenario.generate(seed);
      const notes = Object.values((variant.keys["dana-reply"] as ReplyKey).notes);
      for (const minute of [0, UPDATE_MINUTE, scenario.timeLimitMinutes]) {
        const payload = JSON.stringify(renderAttemptForCandidate(scenario, seed, minute));
        expect(payload).not.toMatch(/"keys"|tolerance|"criteria"|"guidance"|"notes"|"points"|"expected"/);
        for (const c of [s.adjBank, s.trap, s.bookError]) {
          for (const f of forms(c)) expect(contains(payload, f), `${seed} m${minute}: ${f}`).toBe(false);
        }
        for (const n of notes) expect(payload).not.toContain(n);
      }
    }
  });

  it("the leak check would catch a planted adjusted balance", () => {
    const s = solve("abc");
    const planted = JSON.stringify({ body: `Adjusted: $${dollars(s.adjBank).toLocaleString("en-US", { minimumFractionDigits: 2 })}` });
    expect(forms(s.adjBank).some((f) => contains(planted, f))).toBe(true);
  });

  it("the public config has no expected-entry list, rubric or key cells", () => {
    const view = renderAttemptForCandidate(scenario, "abc", scenario.timeLimitMinutes);
    for (const step of view.steps) {
      const cfg = step.config as Record<string, unknown>;
      expect(cfg).not.toHaveProperty("expected");
      expect(cfg).not.toHaveProperty("criteria");
    }
  });
});

describe("harbor-lane-bank-rec: timeline of messages", () => {
  const msgs = scenario.definition.messages;

  it("Dana's assignment arrives at minute 0 and her update at minute 12, inside the 30 minutes", () => {
    expect(msgs.map((m) => [m.id, m.arriveAtMinute ?? 0])).toEqual([
      ["m1", 0],
      ["m2", UPDATE_MINUTE],
    ]);
    for (const m of msgs) {
      expect(m.from).toMatch(/Dana Ruiz/);
      expect(m.arriveAtMinute ?? 0).toBeGreaterThanOrEqual(0);
      expect(m.arriveAtMinute ?? 0).toBeLessThan(scenario.timeLimitMinutes);
      if (m.stepId) expect(scenario.definition.steps.map((s) => s.id)).toContain(m.stepId);
    }
    expect(msgs[1].subject).toMatch(/^RE:/);
  });

  it("all three tasks are available from the start, so the update can change work already done", () => {
    expect(renderAttemptForCandidate(scenario, "abc", 0).steps.map((s) => s.id)).toEqual(["bank-rec", "rec-entries", "dana-reply"]);
  });

  it("withholds the update until minute 12, then shows it newest first", () => {
    for (const seed of SEEDS.slice(0, 50)) {
      const before = renderAttemptForCandidate(scenario, seed, UPDATE_MINUTE - 1);
      expect(before.messages.map((m) => m.id)).toEqual(["m1"]);
      expect(JSON.stringify(before)).not.toMatch(/void/i);
      const after = renderAttemptForCandidate(scenario, seed, UPDATE_MINUTE);
      expect(after.messages.map((m) => m.id)).toEqual(["m2", "m1"]);
      const s = solve(seed);
      expect(after.messages[0].body).toContain(`#${s.voided.ref}`);
      expect(after.messages[0].body).toContain(`$${dollars(s.voided.credit).toLocaleString("en-US", { minimumFractionDigits: 2 })}`);
      expect(after.messages[0].body).toMatch(/Office Supplies Expense/);
    }
  });
});
