import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { corporateApRidgeway } = await import("@/lib/engine/scenarios/corporate-ap-ridgeway");
const { getScenario, listScenarios } = await import("@/lib/engine/scenarios");
const { renderAttemptForCandidate } = await import("@/lib/engine/server/render");
const { scoreAttempt } = await import("@/lib/engine/server/score");

/**
 * docs/07 Example 5: Ridgeway Outdoor Supply, corporate AP intern, phase A
 * (no rapid rounds). These tests solve every task from what the candidate sees
 * (the rendered documents, workbook and emails), then compare that with the
 * server key, so the material and the key can't drift apart.
 */

const scenario = corporateApRidgeway;
const SEEDS = Array.from({ length: 200 }, (_, i) => `attempt-${i.toString(16).padStart(4, "0")}`);
const END = scenario.timeLimitMinutes;
const MATCH_STEPS = ["match-1", "match-2", "match-3", "match-4"] as const;
const PHASE_A_MAX = 70;

type Field = { id: string; label: string; value: string };
type Doc = {
  prompt: string;
  document: { title: string; fields: Field[]; columns: string[]; rows: { id: string; cells: string[] }[]; totals: Field[] };
  reasons: { id: string; label: string }[];
  decision?: { prompt: string; options: { id: string; label: string }[] };
};
type Cell = { kind: "text"; text: string } | { kind: "input"; id: string } | { kind: "empty" };
type Grid = { prompt: string; columns: string[]; rows: Cell[][] };
type KeyLine = { accounts: string[]; side: "debit" | "credit"; amount: number };
type JeKey = { entries: Record<string, { lines: KeyLine[] }> };
type SheetKey = { cells: Record<string, { value: number }> };
type ReviewKey = { findings: Record<string, { targets: string[]; reasons: string[]; note?: string }>; decision?: string[] };
type ReplyKey = { notes: Record<string, string> };
type Trap = "short" | "price" | "duplicate" | "clean";

const cents = (s: string) => {
  const t = s.trim();
  if (t === "") return 0;
  const neg = /^\(.*\)$/.test(t) || t.startsWith("-");
  const n = Math.round(Number(t.replace(/[()$,\s-]/g, "")) * 100);
  return neg ? -n : n;
};
const dollars = (c: number) => c / 100;
const money = (c: number) => `$${dollars(c).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const text = (c: Cell | undefined) => (c && c.kind === "text" ? c.text : "");
const field = (doc: Doc, id: string) => {
  const f = [...doc.document.fields, ...doc.document.totals].find((x) => x.id === id);
  expect(f, `field ${id}`).toBeDefined();
  return f!.value;
};
const domainOf = (s: string) => s.match(/@([a-z0-9.-]+)/i)![1].toLowerCase();

/** One three-way match document, read the way an AP clerk would. */
function readMatch(doc: Doc) {
  const cols = doc.document.columns;
  const col = (name: RegExp) => {
    const i = cols.findIndex((c) => name.test(c));
    expect(i, `column ${name}`).toBeGreaterThanOrEqual(0);
    return i;
  };
  const [cItem, cPoQty, cPoPrice, cRecv, cInvQty, cInvPrice, cAmt] = [
    col(/^Item/),
    col(/^PO qty/),
    col(/^PO unit price/),
    col(/^Received qty/),
    col(/^Invoiced qty/),
    col(/^Invoice unit price/),
    col(/^Invoice amount/),
  ];
  const lines = doc.document.rows.map((r) => ({
    id: r.id,
    item: r.cells[cItem],
    poQty: Number(r.cells[cPoQty]),
    poPrice: cents(r.cells[cPoPrice]),
    recv: Number(r.cells[cRecv]),
    invQty: Number(r.cells[cInvQty]),
    invPrice: cents(r.cells[cInvPrice]),
    amount: cents(r.cells[cAmt]),
    storeUse: /store use/i.test(r.cells[cItem]),
  }));
  const invoiceNo = field(doc, "invoice_no");
  const prior = field(doc, "prior");
  const priorNo = prior.match(/Invoice (\S+)/)![1];
  const total = cents(field(doc, "total"));
  const vendor = field(doc, "vendor");

  const short = lines.filter((l) => l.recv < l.invQty);
  const price = lines.filter((l) => l.invPrice > l.poPrice);
  const duplicate = invoiceNo === priorNo;
  const issues = [short.length > 0, price.length > 0, duplicate].filter(Boolean).length;
  const trap: Trap = short.length ? "short" : price.length ? "price" : duplicate ? "duplicate" : "clean";
  return { lines, invoiceNo, prior, priorNo, total, vendor, short, price, duplicate, issues, trap };
}

/** Everything the candidate sees after the whole attempt. */
function screen(seed: string) {
  const view = renderAttemptForCandidate(scenario, seed, END);
  const step = (id: string) => {
    const s = view.steps.find((x) => x.id === id);
    expect(s, `step ${id}`).toBeDefined();
    return s!;
  };
  const docs = MATCH_STEPS.map((id) => step(id).config as Doc);
  const matches = docs.map(readMatch);
  const byTrap = (t: Trap) => {
    const i = matches.findIndex((m) => m.trap === t);
    return { ...matches[i], stepId: MATCH_STEPS[i], index: i };
  };
  const msg = (id: string) => {
    const m = view.messages.find((x) => x.id === id);
    expect(m, `message ${id}`).toBeDefined();
    return m!;
  };
  return { view, step, docs, matches, byTrap, msg };
}

/** Bills Priya already approved, from her kickoff email ("• Vendor: $1,234.56"). */
function preApproved(seed: string) {
  const { msg } = screen(seed);
  return msg("m1")
    .body.split("\n")
    .filter((l) => l.startsWith("• ") && l.includes("$"))
    .map((l) => cents(l.match(/\$[\d,]+\.\d\d/)![0]));
}

type LedgerRow = { date: string; ref: string; desc: string; up: number; down: number; balance: number };

/** The vendor statement and the AP subledger from the workbook, plus the rec solved from them (cents). */
function solveStatement(seed: string) {
  const { step } = screen(seed);
  const sheet = step("statement-rec").config as Grid;
  const section = (title: RegExp): LedgerRow[] => {
    const start = sheet.rows.findIndex((r) => title.test(text(r[0])));
    expect(start, `section ${title}`).toBeGreaterThanOrEqual(0);
    const out: LedgerRow[] = [];
    for (const r of sheet.rows.slice(start + 1)) {
      if (!/^\d\d\/\d\d$/.test(text(r[0]))) {
        if (out.length) break;
        continue;
      }
      out.push({ date: text(r[0]), ref: text(r[1]), desc: text(r[2]), up: cents(text(r[3])), down: cents(text(r[4])), balance: cents(text(r[5])) });
    }
    return out;
  };
  const statement = section(/^Vendor statement/i);
  const ledger = section(/^AP subledger/i);
  const labelled = (label: RegExp) => {
    const row = sheet.rows.find((r) => label.test(text(r[0])));
    expect(row, `row ${label}`).toBeDefined();
    return row!;
  };

  const isInvoice = (r: LedgerRow) => /^Invoice/i.test(r.desc);
  const isPayment = (r: LedgerRow) => /payment/i.test(r.desc);
  const isCredit = (r: LedgerRow) => /credit memo/i.test(r.desc);

  const stmtInvoices = statement.filter(isInvoice);
  const apInvoices = ledger.filter(isInvoice);
  const unrecorded = stmtInvoices.filter((s) => !apInvoices.some((a) => a.ref === s.ref));
  const miskeyed = stmtInvoices.filter((s) => apInvoices.some((a) => a.ref === s.ref && a.up !== s.up));
  const keying = miskeyed.reduce((t, s) => t + s.up - apInvoices.find((a) => a.ref === s.ref)!.up, 0);
  const stmtPayments = statement.filter(isPayment);
  const inTransit = ledger.filter(isPayment).filter((a) => !stmtPayments.some((s) => s.down === a.down));
  const credits = statement.filter(isCredit).filter((s) => !ledger.some((a) => a.ref === s.ref));

  const stmtEnd = statement.at(-1)!.balance;
  const apEnd = ledger.at(-1)!.balance;
  const sum = (rows: LedgerRow[], k: "up" | "down") => rows.reduce((t, r) => t + r[k], 0);
  const adjVendor = stmtEnd - sum(inTransit, "down");
  const adjAp = apEnd + sum(unrecorded, "up") - sum(credits, "down") + keying;
  return {
    statement,
    ledger,
    labelled,
    unrecorded,
    miskeyed,
    keying,
    inTransit,
    credits,
    stmtEnd,
    apEnd,
    adjVendor,
    adjAp,
    totals: { inTransit: sum(inTransit, "down"), unrecorded: sum(unrecorded, "up"), credits: sum(credits, "down") },
  };
}

const entry = (lines: [string, number | null, number | null][], memo = "") => ({
  memo,
  lines: lines.map(([account, debit, credit]) => ({ account, debit, credit })),
});

/** A strong candidate's answers, built only from the screen. */
function perfectAnswers(seed: string) {
  const { matches, byTrap, docs } = screen(seed);
  const reasonFor: Record<Trap, string> = { short: "qty", price: "price", duplicate: "duplicate", clean: "agrees" };
  const matchAnswers = Object.fromEntries(
    matches.map((m, i) => {
      const target = m.trap === "short" ? m.short[0].id : m.trap === "price" ? m.price[0].id : m.trap === "duplicate" ? "invoice_no" : "match";
      return [
        MATCH_STEPS[i],
        { flags: [{ target, reason: reasonFor[m.trap], note: "" }], decision: m.trap === "clean" ? "pay" : "hold" },
      ];
    }),
  );
  expect(docs.length).toBe(4);
  const clean = byTrap("clean");
  const merch = clean.lines.filter((l) => !l.storeUse).reduce((t, l) => t + l.amount, 0);
  const supplies = clean.lines.filter((l) => l.storeUse).reduce((t, l) => t + l.amount, 0);
  const runTotal = preApproved(seed).reduce((t, c) => t + c, 0) + clean.total;
  const st = solveStatement(seed);

  return {
    ...matchAnswers,
    "post-bills": {
      entries: [entry([["1300", dollars(merch), null], ["6100", dollars(supplies), null], ["2000", null, dollars(clean.total)]], "Approved invoice")],
    },
    "vendor-reply": { body: "Hi, the invoice is on hold: we received fewer units than billed. Please send a corrected invoice or credit memo." },
    "run-total": { value: dollars(runTotal) },
    "bank-change": {
      flags: [
        { target: "from", reason: "domain", note: "" },
        { target: "b2", reason: "bank", note: "" },
        { target: "b4", reason: "contact", note: "" },
      ],
      decision: "verify",
    },
    "statement-rec": {
      cells: {
        in_transit: dollars(st.totals.inTransit),
        adj_vendor: dollars(st.adjVendor),
        unrecorded: dollars(st.totals.unrecorded),
        credit_memo: dollars(st.totals.credits),
        keying: dollars(st.keying),
        adj_ap: dollars(st.adjAp),
        diff: 0,
      },
    },
    "statement-reply": { body: `Hi Priya, we owe ${money(st.adjAp)}. Please see the workbook.` },
  };
}

type Answers = ReturnType<typeof perfectAnswers>;
const clone = (a: Answers): Answers & Record<string, unknown> => JSON.parse(JSON.stringify(a));
const RUBRIC_STEPS = ["vendor-reply", "statement-reply"] as const;
const AUTO_STEPS = [...MATCH_STEPS, "post-bills", "run-total", "bank-change", "statement-rec"] as const;

describe("corporate-ap-ridgeway: setup", () => {
  it("is registered, 50 minutes, accounting, phase A only (no sections), and uses only built step types", () => {
    expect(getScenario("corporate-ap-ridgeway", 1)).toBe(scenario);
    expect(listScenarios()).toContain(scenario);
    expect(scenario.version).toBe(1);
    expect(scenario.timeLimitMinutes).toBe(50);
    expect(scenario.roleFamily).toBe("accounting");
    expect(scenario.definition).not.toHaveProperty("sections");
    expect(scenario.definition.steps.map((s) => [s.id, s.type])).toEqual([
      ["match-1", "document_review"],
      ["match-2", "document_review"],
      ["match-3", "document_review"],
      ["match-4", "document_review"],
      ["post-bills", "journal_entry"],
      ["vendor-reply", "inbox_reply"],
      ["run-total", "numeric"],
      ["bank-change", "document_review"],
      ["statement-rec", "spreadsheet"],
      ["statement-reply", "inbox_reply"],
    ]);
    expect(scenario.definition.intro).toMatch(/Ridgeway Outdoor Supply/);
    expect(scenario.definition.intro).toMatch(/Priya/);
    expect(scenario.definition.intro).toMatch(/payment run/i);
  });

  it("renders for 200 seeds at every point in the timeline", () => {
    for (const seed of SEEDS) {
      for (const minute of [0, 14, 15, 22, 28, 32, 33, END]) {
        const view = renderAttemptForCandidate(scenario, seed, minute);
        expect(view.steps.length).toBeGreaterThanOrEqual(5);
        expect(JSON.stringify(view)).not.toContain("{{");
      }
    }
  });

  it("is deterministic per seed", () => {
    for (const seed of SEEDS.slice(0, 20)) {
      expect(scenario.generate(seed)).toEqual(scenario.generate(seed));
      expect(renderAttemptForCandidate(scenario, seed, END)).toEqual(renderAttemptForCandidate(scenario, seed, END));
    }
  });

  it("different seeds change amounts, vendor names, invoice numbers, dates and which vendor holds which trap", () => {
    expect(new Set(SEEDS.map((s) => JSON.stringify(scenario.generate(s).values))).size).toBe(SEEDS.length);
    const screens = SEEDS.slice(0, 60).map(screen);
    expect(new Set(screens.map((s) => s.matches[0].total)).size).toBeGreaterThan(55);
    expect(new Set(screens.map((s) => s.matches[0].vendor)).size).toBeGreaterThan(5);
    expect(new Set(screens.map((s) => s.matches[0].invoiceNo)).size).toBeGreaterThan(55);
    expect(new Set(screens.map((s) => field(s.docs[0], "invoice_date"))).size).toBeGreaterThan(3);
    expect(new Set(screens.map((s) => s.byTrap("duplicate").index)).size).toBe(4);
    expect(new Set(screens.map((s) => s.byTrap("clean").index)).size).toBe(4);
    expect(new Set(SEEDS.slice(0, 60).map((s) => solveStatement(s).adjAp)).size).toBeGreaterThan(55);
  });
});

describe("corporate-ap-ridgeway: every variant is internally consistent", () => {
  it("each match document's arithmetic is right, and the four vendors are different", () => {
    for (const seed of SEEDS) {
      const { matches } = screen(seed);
      expect(new Set(matches.map((m) => m.vendor)).size, seed).toBe(4);
      for (const m of matches) {
        expect(m.lines.length).toBe(3);
        expect(m.lines.filter((l) => l.storeUse).length, `${seed} one store-use line`).toBe(1);
        for (const l of m.lines) {
          expect(l.amount, `${seed} ${m.vendor} ${l.item}`).toBe(l.invQty * l.invPrice);
          expect(l.poQty).toBeGreaterThan(0);
          expect(l.recv).toBeLessThanOrEqual(l.poQty);
          expect(l.invQty).toBe(l.poQty);
        }
        expect(m.total).toBe(m.lines.reduce((t, l) => t + l.amount, 0));
      }
    }
  });

  it("plants exactly one of each: short shipment, price above PO, invoice already paid, clean match", () => {
    for (const seed of SEEDS) {
      const { matches, byTrap } = screen(seed);
      expect(matches.map((m) => m.trap).sort(), seed).toEqual(["clean", "duplicate", "price", "short"]);
      for (const m of matches) expect(m.issues, `${seed} ${m.vendor} has one issue at most`).toBeLessThanOrEqual(1);
      expect(byTrap("short").short.length).toBe(1);
      expect(byTrap("price").price.length).toBe(1);
      // The duplicate shows last month's payment of the same invoice number for the same amount.
      const dup = byTrap("duplicate");
      expect(dup.prior).toContain(money(dup.total));
      expect(dup.prior).toMatch(/paid/i);
      // The others show a prior payment too (different invoice), so the field alone gives nothing away.
      for (const m of matches.filter((x) => x.trap !== "duplicate")) {
        expect(m.priorNo).not.toBe(m.invoiceNo);
        expect(m.prior).toMatch(/paid/i);
      }
    }
  });

  it("the match keys agree with the documents: hold the three exceptions, pay the clean one", () => {
    for (const seed of SEEDS) {
      const { matches } = screen(seed);
      const keys = scenario.generate(seed).keys;
      matches.forEach((m, i) => {
        const k = keys[MATCH_STEPS[i]] as ReviewKey;
        expect(Object.keys(k.findings)).toEqual(["result"]);
        const f = k.findings.result;
        expect(k.decision, `${seed} ${m.trap}`).toEqual([m.trap === "clean" ? "pay" : "hold"]);
        if (m.trap === "short") expect([f.targets, f.reasons]).toEqual([[m.short[0].id, "total"], ["qty"]]);
        if (m.trap === "price") expect([f.targets, f.reasons]).toEqual([[m.price[0].id, "total"], ["price"]]);
        if (m.trap === "duplicate") expect([f.targets, f.reasons]).toEqual([["invoice_no", "prior"], ["duplicate"]]);
        if (m.trap === "clean") expect([f.targets, f.reasons]).toEqual([["match"], ["agrees"]]);
      });
    }
  });

  it("the posting key is the clean invoice only, balanced, merchandise to inventory and store-use to supplies", () => {
    for (const seed of SEEDS) {
      const clean = screen(seed).byTrap("clean");
      const je = scenario.generate(seed).keys["post-bills"] as JeKey;
      expect(Object.keys(je.entries)).toEqual(["approved"]);
      const lines = je.entries.approved.lines;
      const c = (l: KeyLine) => Math.round(l.amount * 100);
      const dr = lines.filter((l) => l.side === "debit").reduce((t, l) => t + c(l), 0);
      const cr = lines.filter((l) => l.side === "credit").reduce((t, l) => t + c(l), 0);
      expect(dr, `${seed} balances`).toBe(cr);
      expect(cr).toBe(clean.total);
      const by = (acct: string) => lines.filter((l) => l.accounts.includes(acct)).map(c);
      expect(by("1300")).toEqual([clean.lines.filter((l) => !l.storeUse).reduce((t, l) => t + l.amount, 0)]);
      expect(by("6100")).toEqual([clean.lines.find((l) => l.storeUse)!.amount]);
      expect(lines.find((l) => l.side === "credit")!.accounts).toEqual(["2000"]);
    }
  });

  it("the run total is Priya's two pre-approved bills plus the clean invoice", () => {
    for (const seed of SEEDS) {
      const pre = preApproved(seed);
      expect(pre.length, seed).toBe(2);
      const key = scenario.generate(seed).keys["run-total"] as { value: number };
      expect(Math.round(key.value * 100)).toBe(pre[0] + pre[1] + screen(seed).byTrap("clean").total);
    }
  });

  it("the bank-change email comes from a lookalike of the clean vendor's domain and offers a new phone number", () => {
    for (const seed of SEEDS) {
      const { step, byTrap } = screen(seed);
      const doc = step("bank-change").config as Doc;
      const clean = byTrap("clean");
      const from = field(doc, "from");
      const onFile = field(doc, "on_file_email");
      expect(from).toContain(clean.vendor);
      const [fake, real] = [domainOf(from), domainOf(onFile)];
      expect(fake, seed).not.toBe(real);
      // A lookalike: shares the real domain's name before the TLD.
      expect(fake.startsWith(real.split(".")[0].slice(0, 6)), `${seed} ${fake} vs ${real}`).toBe(true);
      const phoneOnFile = field(doc, "on_file_phone");
      const body = doc.document.rows.map((r) => r.cells.join(" ")).join("\n");
      expect(body).toContain(clean.invoiceNo);
      expect(body).not.toContain(phoneOnFile);
      expect(doc.document.rows.find((r) => r.id === "b4")!.cells[0]).toMatch(/\(\d{3}\) \d{3}-\d{4}/);
      const k = scenario.generate(seed).keys["bank-change"] as ReviewKey;
      expect(k.decision).toEqual(["verify"]);
      expect(k.findings.domain.targets).toEqual(["from"]);
      expect(k.findings.bank.targets).toEqual(["b2"]);
    }
  });

  it("both statement ledgers run correctly and open at the same balance (October was reconciled)", () => {
    for (const seed of SEEDS) {
      const st = solveStatement(seed);
      for (const ledger of [st.statement, st.ledger]) {
        expect(/opening|beginning|balance forward/i.test(ledger[0].desc), seed).toBe(true);
        for (let i = 1; i < ledger.length; i++) {
          expect(ledger[i].balance, `${seed} row ${i}`).toBe(ledger[i - 1].balance + ledger[i].up - ledger[i].down);
          expect(ledger[i].balance).toBeGreaterThan(0);
        }
        const dates = ledger.slice(1).map((r) => r.date);
        expect(dates, seed).toEqual([...dates].sort());
      }
      expect(st.statement[0].balance).toBe(st.ledger[0].balance);
      expect(cents(text(st.labelled(/^Balance per vendor statement/i)[5]))).toBe(st.stmtEnd);
      expect(cents(text(st.labelled(/^Balance per AP subledger/i)[5]))).toBe(st.apEnd);
    }
  });

  it("plants exactly one of each statement item: unreceived invoice, payment in transit, unbooked credit memo, keying error", () => {
    for (const seed of SEEDS) {
      const st = solveStatement(seed);
      expect(st.unrecorded.length, seed).toBe(1);
      expect(st.inTransit.length, seed).toBe(1);
      expect(st.credits.length, seed).toBe(1);
      expect(st.miskeyed.length, seed).toBe(1);
      // A transposition: same digits, different order; the gap a multiple of $9.
      const stmtAmt = st.miskeyed[0].up;
      const apAmt = stmtAmt - st.keying;
      expect([...String(stmtAmt)].sort().join("")).toBe([...String(apAmt)].sort().join(""));
      expect(st.keying).not.toBe(0);
      expect(Math.abs(st.keying) % 900).toBe(0);
      // The payment in transit went out after the statement date.
      expect(st.inTransit[0].date > st.statement.at(-1)!.date).toBe(true);
    }
  });

  it("the statement rec ties and the key matches the solution from the screen", () => {
    for (const seed of SEEDS) {
      const st = solveStatement(seed);
      expect(st.adjVendor, seed).toBe(st.adjAp);
      expect(st.adjAp).toBeGreaterThan(0);
      const key = (scenario.generate(seed).keys["statement-rec"] as SheetKey).cells;
      const k = (id: string) => Math.round(key[id].value * 100);
      expect(Object.keys(key).sort()).toEqual(["adj_ap", "adj_vendor", "credit_memo", "in_transit", "keying", "unrecorded"]);
      expect(k("in_transit")).toBe(st.totals.inTransit);
      expect(k("unrecorded")).toBe(st.totals.unrecorded);
      expect(k("credit_memo")).toBe(st.totals.credits);
      expect(k("keying")).toBe(st.keying);
      expect(k("adj_vendor")).toBe(st.adjVendor);
      expect(k("adj_ap")).toBe(st.adjAp);
    }
  });

  it("gives reviewers this variant's facts for both replies", () => {
    for (const seed of SEEDS.slice(0, 50)) {
      const { byTrap } = screen(seed);
      const st = solveStatement(seed);
      const keys = scenario.generate(seed).keys;
      const vendor = (keys["vendor-reply"] as ReplyKey).notes;
      const short = byTrap("short");
      expect(vendor.facts).toContain(short.invoiceNo);
      expect(vendor.facts).toContain(`${short.short[0].recv}`);
      const priya = (keys["statement-reply"] as ReplyKey).notes;
      expect(priya.balance).toContain(money(st.adjAp));
      expect(priya.request).toContain(st.unrecorded[0].ref);
      expect(priya.request).toContain(st.credits[0].ref);
      expect(priya.entries).toContain(st.miskeyed[0].ref);
    }
  });
});

describe("corporate-ap-ridgeway: scoring", () => {
  it("phase A is out of 70: three-way match 25, inbox 15, statement 30", () => {
    const blank = scoreAttempt(scenario, "abc", {});
    expect(blank.points).toBe(0);
    expect(blank.maxPoints).toBe(PHASE_A_MAX);
    const max = (id: string) => blank.steps[id].maxPoints;
    expect(MATCH_STEPS.map(max)).toEqual([5, 5, 5, 5]);
    expect(max("post-bills")).toBe(5);
    expect(max("vendor-reply") + max("run-total") + max("bank-change")).toBe(15);
    expect([max("vendor-reply"), max("run-total"), max("bank-change")]).toEqual([5, 4, 6]);
    expect(max("statement-rec") + max("statement-reply")).toBe(30);
    expect([max("statement-rec"), max("statement-reply")]).toEqual([20, 10]);
  });

  it("blank scores 0 for every seed, with nothing sent to review", () => {
    for (const seed of SEEDS.slice(0, 50)) {
      const s = scoreAttempt(scenario, seed, {});
      expect(s.points).toBe(0);
      for (const id of RUBRIC_STEPS) expect(s.steps[id].needsReview).toBeFalsy();
    }
  });

  it("a perfect answer earns every automatic point and both replies go to review", () => {
    for (const seed of SEEDS) {
      const s = scoreAttempt(scenario, seed, perfectAnswers(seed));
      for (const id of AUTO_STEPS) expect(s.steps[id].points, `${seed} ${id}`).toBe(s.steps[id].maxPoints);
      for (const id of RUBRIC_STEPS) expect(s.steps[id].needsReview, `${seed} ${id}`).toBe(true);
      expect(s.points).toBe(PHASE_A_MAX - 15);
    }
  });

  it("a perfect answer is the full phase-A max once the reviewer gives both replies full marks", () => {
    const s = scoreAttempt(scenario, "abc", perfectAnswers("abc"));
    const reviewed = s.points + RUBRIC_STEPS.reduce((t, id) => t + s.steps[id].maxPoints - s.steps[id].points, 0);
    expect(reviewed).toBe(PHASE_A_MAX);
  });

  it("another seed's perfect answer doesn't score well (answers can't be shared)", () => {
    let shared = 0;
    for (let i = 0; i < 20; i++) {
      const s = scoreAttempt(scenario, SEEDS[i + 1], perfectAnswers(SEEDS[i]));
      shared += s.points;
    }
    // Trap positions, amounts and the statement change per seed; the phishing answer is the same for everyone (6 points).
    expect(shared / 20).toBeLessThan(25);
  });

  describe("each trap answered wrongly costs exactly its points", () => {
    const seeds = SEEDS.slice(0, 40);
    const lost = (seed: string, mutate: (a: Answers & Record<string, unknown>, sc: ReturnType<typeof screen>) => void) => {
      const a = clone(perfectAnswers(seed));
      mutate(a, screen(seed));
      return scoreAttempt(scenario, seed, perfectAnswers(seed)).points - scoreAttempt(scenario, seed, a).points;
    };
    const payIt = (stepId: string) => (a: Record<string, unknown>) => {
      a[stepId] = { flags: [], decision: "pay" };
    };

    it("duplicate invoice paid again (no flag, Pay): loses that document's 5 points", () => {
      for (const seed of seeds) expect(lost(seed, (a, sc) => payIt(sc.byTrap("duplicate").stepId)(a)), seed).toBe(5);
    });

    it("duplicate spotted but held for the wrong reason: half the finding (1.5)", () => {
      for (const seed of seeds) {
        expect(
          lost(seed, (a, sc) => {
            (a as Record<string, unknown>)[sc.byTrap("duplicate").stepId] = {
              flags: [{ target: "invoice_no", reason: "math", note: "" }],
              decision: "hold",
            };
          }),
        ).toBe(1.5);
      }
    });

    it("short shipment paid: loses 5", () => {
      for (const seed of seeds) expect(lost(seed, (a, sc) => payIt(sc.byTrap("short").stepId)(a))).toBe(5);
    });

    it("price above PO paid: loses 5", () => {
      for (const seed of seeds) expect(lost(seed, (a, sc) => payIt(sc.byTrap("price").stepId)(a))).toBe(5);
    });

    it("clean match held with an invented problem: loses 5 and never goes below 0", () => {
      for (const seed of seeds) {
        const pts = (a: Answers & Record<string, unknown>) => scoreAttempt(scenario, seed, a);
        const a = clone(perfectAnswers(seed));
        const clean = screen(seed).byTrap("clean");
        (a as Record<string, unknown>)[clean.stepId] = { flags: [{ target: "l1", reason: "price", note: "" }], decision: "hold" };
        expect(pts(perfectAnswers(seed)).points - pts(a).points).toBe(5);
        expect(pts(a).steps[clean.stepId].points).toBe(0);
      }
    });

    it("bank-change phishing: updating the bank details with no flags loses all 6", () => {
      for (const seed of seeds) {
        expect(
          lost(seed, (a) => {
            a["bank-change"] = { flags: [], decision: "update" };
          }),
        ).toBe(6);
      }
    });

    it("bank-change phishing: spotting every flag but calling the number in the email loses the 2 decision points", () => {
      for (const seed of seeds) {
        expect(
          lost(seed, (a) => {
            a["bank-change"].decision = "call_new";
          }),
        ).toBe(2);
        expect(
          lost(seed, (a) => {
            a["bank-change"].decision = "reply";
          }),
        ).toBe(2);
      }
    });

    it("bank-change phishing: right decision, no flags keeps only the decision (2 of 6)", () => {
      const s = scoreAttempt(scenario, "abc", { "bank-change": { flags: [], decision: "verify" } });
      expect(s.steps["bank-change"].points).toBe(2);
    });

    it("run total that includes the duplicate invoice: loses the 4 numeric points", () => {
      for (const seed of seeds) {
        expect(
          lost(seed, (a, sc) => {
            a["run-total"].value = dollars(Math.round(a["run-total"].value * 100) + sc.byTrap("duplicate").total);
          }),
        ).toBe(4);
      }
    });

    it("posting a held invoice as well isn't penalised by the journal step (it's listed for the reviewer)", () => {
      const seed = "abc";
      const dup = screen(seed).byTrap("duplicate");
      const a = clone(perfectAnswers(seed));
      a["post-bills"].entries.push(entry([["1300", dollars(dup.total), null], ["2000", null, dollars(dup.total)]]));
      const je = scoreAttempt(scenario, seed, a).steps["post-bills"];
      expect(je.points).toBe(5);
      expect(je.items.some((i) => /not in the key/i.test(i.label))).toBe(true);
    });

    it("statement rec: each planted item missed costs its 4 points and the adjusted AP balance (2)", () => {
      for (const seed of seeds.slice(0, 10)) {
        const st = solveStatement(seed);
        for (const [cell, amount] of [
          ["unrecorded", st.totals.unrecorded],
          ["credit_memo", -st.totals.credits],
          ["keying", st.keying],
        ] as const) {
          expect(
            lost(seed, (a) => {
              (a["statement-rec"].cells as Record<string, number | null>)[cell] = null;
              a["statement-rec"].cells.adj_ap = dollars(st.adjAp - amount);
            }),
            `${seed} ${cell}`,
          ).toBe(6);
        }
        expect(
          lost(seed, (a) => {
            (a["statement-rec"].cells as Record<string, number | null>).in_transit = null;
            a["statement-rec"].cells.adj_vendor = dollars(st.stmtEnd);
          }),
        ).toBe(6);
      }
    });

    it("statement rec: keying error with the wrong sign costs that item and the adjusted AP balance", () => {
      const st = solveStatement("abc");
      expect(
        lost("abc", (a) => {
          a["statement-rec"].cells.keying = dollars(-st.keying);
          a["statement-rec"].cells.adj_ap = dollars(st.adjAp - 2 * st.keying);
        }),
      ).toBe(6);
    });

    it("posting: whole invoice to inventory gets partial credit, not full", () => {
      const clean = screen("abc").byTrap("clean");
      const a = clone(perfectAnswers("abc"));
      a["post-bills"].entries = [entry([["1300", dollars(clean.total), null], ["2000", null, dollars(clean.total)]])];
      const pts = scoreAttempt(scenario, "abc", a).steps["post-bills"].points;
      expect(pts).toBeGreaterThan(0);
      expect(pts).toBeLessThan(5);
    });
  });

  it("gives the reviewer the rubric for both replies", () => {
    const r = scoreAttempt(scenario, "abc", perfectAnswers("abc"));
    expect(r.steps["vendor-reply"].items.map((i) => [i.id, i.max])).toEqual([
      ["facts", 2],
      ["next", 2],
      ["tone", 1],
    ]);
    expect(r.steps["statement-reply"].items.map((i) => [i.id, i.max])).toEqual([
      ["balance", 3],
      ["request", 3],
      ["entries", 2],
      ["brevity", 2],
    ]);
  });
});

describe("corporate-ap-ridgeway: nothing derived reaches the candidate", () => {
  const forms = (c: number) => {
    const d = dollars(Math.abs(c));
    return [d.toFixed(2), d.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })];
  };
  const contains = (payload: string, form: string) => new RegExp(`(?<![\\d.,])${form.replace(/[.$]/g, "\\$&")}(?![\\d.]\\d)`).test(payload);

  it("no run total, adjusted AP balance, keying difference or reviewer note in any payload", () => {
    for (const seed of SEEDS) {
      const st = solveStatement(seed);
      const variant = scenario.generate(seed);
      const runTotal = Math.round((variant.keys["run-total"] as { value: number }).value * 100);
      const notes = [
        ...Object.values((variant.keys["vendor-reply"] as ReplyKey).notes),
        ...Object.values((variant.keys["statement-reply"] as ReplyKey).notes),
      ];
      for (const minute of [0, 28, END]) {
        const payload = JSON.stringify(renderAttemptForCandidate(scenario, seed, minute));
        expect(payload).not.toMatch(/"keys"|tolerance|"criteria"|"guidance"|"notes"|"points"|"expected"|"findings"/);
        for (const c of [runTotal, st.adjAp, st.keying]) {
          for (const f of forms(c)) expect(contains(payload, f), `${seed} m${minute}: ${f}`).toBe(false);
        }
        for (const n of notes) expect(payload).not.toContain(n);
      }
    }
  });
});

describe("corporate-ap-ridgeway: timeline of messages", () => {
  const msgs = scenario.definition.messages;

  it("messages arrive over the 50 minutes and deliver their tasks", () => {
    expect(msgs.map((m) => [m.id, m.arriveAtMinute ?? 0, m.stepId])).toEqual([
      ["m1", 0, "match-1"],
      ["m2", 15, "vendor-reply"],
      ["m3", 22, "bank-change"],
      ["m4", 28, "run-total"],
      ["m5", 32, "statement-rec"],
      ["m6", 33, "statement-reply"],
    ]);
    for (const m of msgs) expect(m.arriveAtMinute ?? 0).toBeLessThan(END);
  });

  it("the match queue and the posting are there from the start; the rest is withheld until it arrives", () => {
    const ids = (minute: number) => renderAttemptForCandidate(scenario, "abc", minute).steps.map((s) => s.id);
    expect(ids(0)).toEqual(["match-1", "match-2", "match-3", "match-4", "post-bills"]);
    expect(ids(14)).not.toContain("vendor-reply");
    expect(ids(15)).toContain("vendor-reply");
    expect(ids(21)).not.toContain("bank-change");
    expect(ids(22)).toContain("bank-change");
    expect(ids(27)).not.toContain("run-total");
    expect(ids(31)).not.toContain("statement-rec");
    expect(ids(END)).toEqual(scenario.definition.steps.map((s) => s.id));
    const before = JSON.stringify(renderAttemptForCandidate(scenario, "abc", 21));
    expect(before).not.toMatch(/remittance|bank details/i);
  });

  it("Priya greets the candidate by first name and lists today's pre-approved bills", () => {
    const body = (name?: string | null) => renderAttemptForCandidate(scenario, "abc", 0, { name }).messages[0].body;
    expect(body("Sam Lee").split("\n")[0]).toBe("Hi Sam,");
    expect(body(null).split("\n")[0]).toBe("Hi there,");
    expect(body(null)).toMatch(/policy/i);
    expect(preApproved("abc").length).toBe(2);
  });

  it("the vendor chasing payment is the short-shipped vendor, about the held invoice", () => {
    for (const seed of SEEDS.slice(0, 50)) {
      const { msg, byTrap } = screen(seed);
      const short = byTrap("short");
      const m2 = msg("m2");
      expect(`${m2.subject}\n${m2.body}`).toContain(short.invoiceNo);
      expect(m2.body).toContain(short.vendor);
      expect(m2.body).toContain(money(short.total));
    }
  });

  it("Priya asks for the run total as a number only, and the statement comes from a fifth vendor", () => {
    for (const seed of SEEDS.slice(0, 50)) {
      const { msg, matches } = screen(seed);
      expect(msg("m4").body).toMatch(/number only/i);
      const m5 = msg("m5").body;
      for (const m of matches) expect(m5).not.toContain(m.vendor);
      expect(msg("m6").body).toMatch(/120 words/);
    }
  });
});
