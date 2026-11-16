import { describe, expect, it, vi } from "vitest";
import type { RapidChoiceField, RapidItem } from "@/lib/engine/step-types/rapid_round/public";

vi.mock("server-only", () => ({}));

const { corporateApRidgeway } = await import("@/lib/engine/scenarios/corporate-ap-ridgeway");
const { getScenario, listScenarios } = await import("@/lib/engine/scenarios");
const { renderAttemptForCandidate } = await import("@/lib/engine/server/render");
const { scoreAttempt } = await import("@/lib/engine/server/score");
const { renderFlowForCandidate } = await import("@/lib/engine/server/render");
const { resolveFlow, visibleMessageIds, validateSections } = await import("@/lib/engine/server/flow");
const { rapidRoundServer } = await import("@/lib/engine/step-types/rapid_round/server");
const { fillTemplate, templateValues } = await import("@/lib/engine/server/template");

/**
 * docs/07 Example 6: Ridgeway Outdoor Supply, corporate AP intern: three
 * rapid rounds and the phase A work, in six timed sections. These tests solve
 * every task from what the candidate sees (the rendered documents, workbook,
 * emails and rapid items), then compare that with the server key, so the
 * material and the key can't drift apart.
 */

const scenario = corporateApRidgeway;
const SEEDS = Array.from({ length: 200 }, (_, i) => `attempt-${i.toString(16).padStart(4, "0")}`);
const END = scenario.timeLimitMinutes;
const MATCH_STEPS = ["match-1", "match-2", "match-3", "match-4"] as const;
const RAPID_STEPS = ["rapid-je", "rapid-pay", "rapid-cash"] as const;
type RapidStepId = (typeof RAPID_STEPS)[number];
const PHASE_A_MAX = 70;
const MAX = 100;

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

// ---- Rapid rounds: rendered one item at a time, exactly as the attempt flow does ----

/** The rapid step's config, parsed as the server parses it. */
const rapidConfig = (stepId: RapidStepId) => rapidRoundServer.configSchema.parse(scenario.definition.steps.find((s) => s.id === stepId)!.config);

/** Every item of a rapid step for this seed, each rendered by the step type's `sequence.renderItem`. */
function rapidItems(seed: string, stepId: RapidStepId): RapidItem[] {
  const variant = scenario.generate(seed);
  const values = templateValues(variant.values);
  const fill = (t: string) => fillTemplate(t, values);
  const config = rapidConfig(stepId);
  const seq = rapidRoundServer.sequence!;
  return Array.from({ length: seq.count(config) }, (_, i) => seq.renderItem(config, { variant, fill }, i) as RapidItem);
}

type RapidKey = { items: Record<string, Record<string, { choice?: string; value?: number }>> };
type Solved = { values: Record<string, string>; kind: string };

const choiceField = (item: RapidItem, id: string) => {
  const f = item.fields.find((x) => x.id === id) as RapidChoiceField | undefined;
  expect(f, `${item.id} field ${id}`).toBeDefined();
  expect(f!.options.length).toBeGreaterThanOrEqual(2);
  return f!;
};
/** The one option whose label matches; fails unless exactly one does. */
const optionId = (item: RapidItem, fieldId: string, label: RegExp | string) => {
  const opts = choiceField(item, fieldId).options.filter((o) => (typeof label === "string" ? o.label === label : label.test(o.label)));
  expect(opts.length, `${item.id} ${fieldId}: one option like ${label}`).toBe(1);
  return opts[0].id;
};
const row = (item: RapidItem, label: string) => {
  const r = item.exhibit?.rows?.find((x) => x.label === label);
  expect(r, `${item.id} row ${label}`).toBeDefined();
  return r!.value;
};

/** JE flash: what a bookkeeper debits and credits for each kind of transaction, read from the prompt. */
const JE_RULES: [string, RegExp, string, string, "easy" | "hard"][] = [
  ["prepaid", /for 12 months of store insurance/, "Prepaid insurance", "Cash", "easy"],
  ["collect", /from a customer on account/, "Cash", "Accounts receivable", "easy"],
  ["supplies-credit", /of store supplies on credit/, "Supplies", "Accounts payable", "easy"],
  ["pay-ap", /to a supplier for a bill we already recorded/, "Accounts payable", "Cash", "easy"],
  ["wages-paid", /^Paid employees .* of wages for this week/, "Wages expense", "Cash", "easy"],
  ["bill", /^Billed a customer .* due in 30 days/, "Accounts receivable", "Service revenue", "easy"],
  ["cash-service", /in cash for bike repairs done today/, "Cash", "Service revenue", "easy"],
  ["utilities-paid", /^Paid this month's .* electricity bill/, "Utilities expense", "Cash", "easy"],
  ["equipment-cash", /\(equipment\) for .*, paid in cash/, "Equipment", "Cash", "easy"],
  ["utilities-bill", /electricity bill, to be paid next month/, "Utilities expense", "Accounts payable", "easy"],
  ["supplies-cash", /of store supplies, paid in cash/, "Supplies", "Cash", "easy"],
  ["equipment-credit", /\(equipment\) for .* on account/, "Equipment", "Accounts payable", "easy"],
  ["unearned-in", /customer paid .* in advance for a repair/, "Cash", "Unearned revenue", "hard"],
  ["insurance-expired", /prepaid insurance, .*, has now expired/, "Insurance expense", "Prepaid insurance", "hard"],
  ["unearned-earned", /repair work the customer had paid for in advance/, "Unearned revenue", "Service revenue", "hard"],
  ["wages-accrued", /wages this month that we'll pay next month/, "Wages expense", "Wages payable", "hard"],
  ["supplies-used", /store supplies were used up this month/, "Supplies expense", "Supplies", "hard"],
];

function solveJe(item: RapidItem): Solved {
  const rules = JE_RULES.filter(([, re]) => re.test(item.prompt));
  expect(rules.length, `${item.id}: one rule for "${item.prompt}"`).toBe(1);
  const [kind, , debit, credit] = rules[0];
  expect(item.prompt).toMatch(/\$[\d,]+\.\d\d/);
  return { kind, values: { debit: optionId(item, "debit", debit), credit: optionId(item, "credit", credit) } };
}

/** Pay or hold: Ridgeway's policy applied to the invoice and the one fact. */
function solvePay(item: RapidItem): Solved {
  const amount = cents(row(item, "Amount"));
  const date = row(item, "Invoice date");
  const po = row(item, "Purchase order");
  const fact = item.prompt;
  const prior = fact.match(/^Last payment to .*: invoice (\S+) for (\$[\d,]+\.\d\d), dated (\w+ \d+), paid/);
  const issues: string[] = [];
  if (/bank details were changed .* by email/i.test(fact)) issues.push("bank");
  if (/^None/.test(po)) issues.push("no_po");
  if (amount > 500_000) issues.push("over_limit");
  if (prior && cents(prior[2]) === amount && prior[3] === date) issues.push("duplicate");
  expect(issues.length, `${item.id}: at most one problem (${issues})`).toBeLessThanOrEqual(1);
  if (prior) expect(prior[1], `${item.id} the paid invoice has another number`).not.toBe(item.exhibit?.title?.match(/Invoice (\S+)/)?.[1]);
  const reasonLabel: Record<string, RegExp> = {
    ok: /^Nothing wrong/,
    bank: /bank details/i,
    no_po: /^No purchase order/,
    over_limit: /approval limit/,
    duplicate: /already paid/,
  };
  const kind = issues[0] ?? (prior ? "near-miss" : "ok");
  return {
    kind,
    values: {
      decision: optionId(item, "decision", issues.length ? "Hold" : "Pay"),
      reason: optionId(item, "reason", reasonLabel[issues[0] ?? "ok"]),
    },
  };
}

/** Cash application: match the payment to the open invoices, using the remittance when there is one. */
function solveCash(item: RapidItem): Solved {
  const pay = cents(row(item, "Payment received"));
  const memo = row(item, "Remittance advice");
  const table = item.exhibit?.table;
  expect(table?.columns).toEqual(["Open invoice", "Date", "Amount"]);
  const open = new Map(table!.rows.map((r) => [r[0], cents(r[2])]));
  expect(open.size).toBe(3);
  const nos = (s: string) => [...s.matchAll(/[A-Z]{2,4}-\d{4,6}/g)].map((m) => m[0]).sort();
  const sum = (set: string[]) => set.reduce((t, n) => t + open.get(n)!, 0);
  const apply = choiceField(item, "apply");
  const sets = apply.options.filter((o) => !/^None/.test(o.label)).map((o) => ({ id: o.id, set: nos(o.label) }));
  expect(sets.length).toBe(3);
  for (const o of sets) for (const n of o.set) expect(open.has(n), `${item.id} option invoice ${n}`).toBe(true);
  expect(new Set(sets.map((o) => o.set.join())).size, `${item.id} three different options`).toBe(3);
  // Every subset of the open invoices, so "exactly one fits" is checked against all of them, not just the options.
  const all = [1, 2, 3, 4, 5, 6, 7].map((mask) => [...open.keys()].filter((_, i) => mask & (1 << i)).sort());
  const exact = all.filter((set) => sum(set) === pay);
  expect(exact.length, `${item.id} at most one set of invoices adds up to the payment`).toBeLessThanOrEqual(1);

  const named = nos(memo);
  let kind: string;
  let target: string[] | null;
  if (named.length) {
    target = named;
    const short = sum(named) - pay;
    if (short === 0) kind = named.length > 1 ? "pair" : "single-ref";
    else {
      kind = "short";
      expect(short, `${item.id} a short-pay is short`).toBeGreaterThan(0);
      const deduction = memo.match(/less (\$[\d,]+\.\d\d)/);
      expect(deduction, `${item.id} the remittance gives the deduction`).not.toBeNull();
      expect(cents(deduction![1]), `${item.id} deduction = invoice - payment`).toBe(short);
      expect(exact.length, `${item.id} a short-pay matches no set exactly`).toBe(0);
    }
  } else if (exact.length) {
    target = exact[0];
    kind = target.length > 1 ? "pair-noref" : "single-noref";
  } else {
    target = null;
    kind = "unapplied";
    // Not close to anything either, so it can't be read as a short-pay.
    for (const set of all) expect(Math.abs(sum(set) - pay), `${item.id} unapplied is far from ${set}`).toBeGreaterThan(sum(set) * 0.1);
  }
  const fits = target ? sets.filter((o) => o.set.join() === target!.join()) : [];
  expect(fits.length, `${item.id} ${kind}: options that fit`).toBe(target ? 1 : 0);
  const restLabel = { none: /^Nothing/, short: /^Short-pay/, unapplied: /^Unapplied cash/ };
  return {
    kind,
    values: {
      apply: target ? fits[0].id : optionId(item, "apply", /^None of these/),
      rest: optionId(item, "rest", kind === "short" ? restLabel.short : kind === "unapplied" ? restLabel.unapplied : restLabel.none),
    },
  };
}

const SOLVERS: Record<RapidStepId, (item: RapidItem) => Solved> = { "rapid-je": solveJe, "rapid-pay": solvePay, "rapid-cash": solveCash };
const solveRapid = (seed: string, stepId: RapidStepId) => rapidItems(seed, stepId).map((item) => ({ item, ...SOLVERS[stepId](item) }));

function rapidAnswers(seed: string) {
  return Object.fromEntries(
    RAPID_STEPS.map((id) => [id, { items: Object.fromEntries(solveRapid(seed, id).map((s) => [s.item.id, { values: s.values, ms: 6_000 }])) }]),
  ) as Record<RapidStepId, { items: Record<string, { values: Record<string, string>; ms: number }> }>;
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
    ...rapidAnswers(seed),
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
const AUTO_STEPS = [...RAPID_STEPS, ...MATCH_STEPS,"post-bills", "run-total", "bank-change", "statement-rec"] as const;

describe("corporate-ap-ridgeway: setup", () => {
  it("is registered, version 1, accounting, about 50 minutes, and uses only built step types in section order", () => {
    expect(getScenario("corporate-ap-ridgeway", 1)).toBe(scenario);
    expect(listScenarios()).toContain(scenario);
    expect(scenario.version).toBe(1);
    expect(scenario.timeLimitMinutes).toBeGreaterThanOrEqual(48);
    expect(scenario.timeLimitMinutes).toBeLessThanOrEqual(55);
    expect(scenario.roleFamily).toBe("accounting");
    expect(scenario.definition.steps.map((s) => [s.id, s.type])).toEqual([
      ["rapid-je", "rapid_round"],
      ["match-1", "document_review"],
      ["match-2", "document_review"],
      ["match-3", "document_review"],
      ["match-4", "document_review"],
      ["post-bills", "journal_entry"],
      ["rapid-pay", "rapid_round"],
      ["vendor-reply", "inbox_reply"],
      ["run-total", "numeric"],
      ["bank-change", "document_review"],
      ["rapid-cash", "rapid_round"],
      ["statement-rec", "spreadsheet"],
      ["statement-reply", "inbox_reply"],
    ]);
    expect(scenario.definition.intro).toMatch(/Ridgeway Outdoor Supply/);
    expect(scenario.definition.intro).toMatch(/Priya/);
    expect(scenario.definition.intro).toMatch(/payment run/i);
  });

  it("renders for 200 seeds with no unfilled template, and every rapid item renders", () => {
    for (const seed of SEEDS) {
      for (const minute of [0, END]) {
        const view = renderAttemptForCandidate(scenario, seed, minute);
        expect(view.steps.length).toBeGreaterThanOrEqual(5);
        expect(JSON.stringify(view)).not.toContain("{{");
      }
      for (const id of RAPID_STEPS) expect(JSON.stringify(rapidItems(seed, id))).not.toContain("{{");
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
  it("out of 100: three rapid rounds 10 each, three-way match 25, inbox 15, statement 30", () => {
    const blank = scoreAttempt(scenario, "abc", {});
    expect(blank.points).toBe(0);
    expect(blank.maxPoints).toBe(MAX);
    const max = (id: string) => blank.steps[id].maxPoints;
    expect(RAPID_STEPS.map(max)).toEqual([10, 10, 10]);
    expect(MAX - RAPID_STEPS.map(max).reduce((t, x) => t + x, 0)).toBe(PHASE_A_MAX);
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
      expect(s.points).toBe(MAX - 15);
    }
  });

  it("a perfect answer is 100 once the reviewer gives both replies full marks", () => {
    for (const seed of SEEDS.slice(0, 50)) {
      const s = scoreAttempt(scenario, seed, perfectAnswers(seed));
      const reviewed = s.points + RUBRIC_STEPS.reduce((t, id) => t + s.steps[id].maxPoints - s.steps[id].points, 0);
      expect(reviewed, seed).toBe(MAX);
    }
  });

  it("another seed's perfect answer doesn't score well (answers can't be shared)", () => {
    let shared = 0;
    for (let i = 0; i < 20; i++) {
      const s = scoreAttempt(scenario, SEEDS[i + 1], perfectAnswers(SEEDS[i]));
      shared += s.points;
    }
    // Trap positions, amounts, the statement and the rapid items change per seed; the phishing answer is the same
    // for everyone (6 points), and a rapid answer copied from another seed is right only by chance.
    expect(shared / 20).toBeLessThan(35);
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

describe("corporate-ap-ridgeway: timed sections", () => {
  const def = scenario.definition;
  const MIN = 60_000;
  const t0 = Date.parse("2026-11-16T09:00:00Z");
  const flowAt = (ms: number, events: Parameters<typeof resolveFlow>[1]["events"] = []) =>
    resolveFlow(def, { startedAt: t0, now: t0 + ms, extraTimePercent: 0, events });
  const stepById = (id: string) => def.steps.find((s) => s.id === id)!;

  it("validateSections passes and the sections fill the time limit exactly", () => {
    expect(validateSections(def, scenario.timeLimitMinutes)).toEqual([]);
    expect(def.sections!.reduce((t, s) => t + s.minutes, 0)).toBe(scenario.timeLimitMinutes);
  });

  it("six sections: rapid A, three-way match, rapid B, inbox, rapid C, statement", () => {
    expect(def.sections!.map((s) => [s.id, s.minutes, s.stepIds, !!s.oneAtATime])).toEqual([
      ["s-rapid-a", 6, ["rapid-je"], false],
      ["s-match", 12, [...MATCH_STEPS, "post-bills"], true],
      ["s-rapid-b", 6, ["rapid-pay"], false],
      ["s-inbox", 10, ["vendor-reply", "run-total", "bank-change"], true],
      ["s-rapid-c", 6, ["rapid-cash"], false],
      ["s-statement", 12, ["statement-rec", "statement-reply"], false],
    ]);
  });

  it("one-at-a-time screens add up to their section, so no screen is cut short and nobody waits", () => {
    for (const sec of def.sections!.filter((s) => s.oneAtATime)) {
      expect(sec.stepIds.reduce((t, id) => t + stepById(id).seconds!, 0), sec.id).toBe(sec.minutes * 60);
    }
    expect(MATCH_STEPS.map((id) => stepById(id).seconds)).toEqual([150, 150, 150, 150]);
    expect(stepById("post-bills").seconds).toBe(120);
    for (const id of ["vendor-reply", "run-total", "bank-change"]) {
      expect(stepById(id).seconds).toBeGreaterThanOrEqual(150);
      expect(stepById(id).seconds).toBeLessThanOrEqual(240);
    }
  });

  it("each rapid round is 15 items x 20 seconds and fits its 6-minute section", () => {
    for (const id of RAPID_STEPS) {
      const config = rapidConfig(id);
      expect(config.items.length, id).toBe(15);
      expect(config.secondsPerItem).toBe(20);
      const sec = def.sections!.find((s) => s.stepIds.includes(id))!;
      expect(config.items.length * config.secondsPerItem).toBeLessThanOrEqual(sec.minutes * 60);
    }
  });

  it("runs the sections back to back with no early finishes", () => {
    const at = (min: number) => flowAt(min * MIN);
    expect(at(0).visibleStepIds).toEqual(["rapid-je"]);
    expect(at(6).visibleStepIds).toEqual(["match-1"]);
    expect(at(6 + 2.5 * 3 + 0.1).visibleStepIds).toEqual(["match-4"]);
    expect(at(16).visibleStepIds).toEqual(["post-bills"]);
    expect(at(18).visibleStepIds).toEqual(["rapid-pay"]);
    expect(at(24).visibleStepIds).toEqual(["vendor-reply"]);
    expect(at(34).visibleStepIds).toEqual(["rapid-cash"]);
    expect(at(40).visibleStepIds).toEqual(["statement-rec", "statement-reply"]);
    expect(at(END).done).toBe(true);
  });

  it("messages linked to a step arrive relative to their section's start", () => {
    expect(def.messages.map((m) => [m.id, m.arriveAtMinute ?? 0, m.stepId])).toEqual([
      ["m1", 0, "match-1"],
      ["m2", 0, "vendor-reply"],
      ["m3", 0, "bank-change"],
      ["m4", 0, "run-total"],
      ["m5", 0, "statement-rec"],
      ["m6", 1, "statement-reply"],
    ]);
    const msgsAt = (min: number, events: Parameters<typeof resolveFlow>[1]["events"] = []) =>
      visibleMessageIds(def, flowAt(min * MIN, events), t0, t0 + min * MIN);
    expect(msgsAt(5)).toEqual([]);
    expect(msgsAt(6)).toEqual(["m1"]);
    expect(msgsAt(23.9)).toEqual(["m1"]);
    expect(msgsAt(24)).toEqual(["m1", "m2", "m3", "m4"]);
    expect(msgsAt(40)).toEqual(["m1", "m2", "m3", "m4", "m5"]);
    expect(msgsAt(41)).toEqual(["m1", "m2", "m3", "m4", "m5", "m6"]);
    // Finishing rapid A after 2 minutes brings the match queue (and Priya's email) forward.
    const early = [{ kind: "advanced_section" as const, sectionId: "s-rapid-a", at: t0 + 2 * MIN }];
    expect(msgsAt(2.5, early)).toEqual(["m1"]);
  });

  it("later sections don't depend on closed screens: the reply and the run total carry what they need", () => {
    for (const seed of SEEDS.slice(0, 50)) {
      const { step, msg, matches, byTrap } = screen(seed);
      // Run total: Priya lists the four invoices from the match queue; the candidate adds the one they approved.
      const m4 = msg("m4").body;
      for (const m of matches) {
        expect(m4, seed).toContain(m.vendor);
        expect(m4).toContain(m.invoiceNo);
        expect(m4).toContain(money(m.total));
      }
      // Vendor reply: the match record for the held invoice, as the AP system would show it.
      const short = byTrap("short");
      const prompt = (step("vendor-reply").config as { prompt: string }).prompt;
      expect(prompt).toContain(short.invoiceNo);
      expect(prompt).toContain(short.short[0].item);
      expect(prompt).toContain(`received ${short.short[0].recv}`);
      expect(prompt).toContain(`invoiced ${short.short[0].invQty}`);
    }
  });

  it("the flow renders each rapid item exactly as sequence.renderItem does", () => {
    for (const id of RAPID_STEPS) {
      const items = rapidItems("abc", id);
      for (const index of [0, 7, 14]) {
        const view = renderFlowForCandidate(scenario, "abc", {
          stepIds: [id],
          messages: [],
          sequences: { [id]: { index, count: 15, endsAt: "2026-11-16T09:00:20.000Z" } },
        });
        const cfg = view.steps[0].config as { itemCount: number; current: { item: RapidItem } };
        expect(cfg.itemCount).toBe(15);
        expect(cfg.current.item).toEqual(items[index]);
        expect(JSON.stringify(cfg)).not.toMatch(/"items"|choice"|tolerance|points/);
      }
    }
  });
});

describe("corporate-ap-ridgeway: rapid rounds", () => {
  it("every item over 200 seeds is consistent: one right option per field, in its options, from the material alone", () => {
    for (const seed of SEEDS) {
      const keys = scenario.generate(seed).keys;
      for (const id of RAPID_STEPS) {
        const key = keys[id] as RapidKey;
        const solved = solveRapid(seed, id);
        expect(Object.keys(key.items).sort()).toEqual(solved.map((s) => s.item.id).sort());
        for (const s of solved) {
          const k = key.items[s.item.id];
          expect(Object.keys(k).sort(), `${seed} ${s.item.id}`).toEqual(s.item.fields.map((f) => f.id).sort());
          for (const f of s.item.fields) {
            const choice = k[f.id].choice;
            expect((f as RapidChoiceField).options.filter((o) => o.id === choice).length, `${seed} ${s.item.id}.${f.id}`).toBe(1);
            expect(choice, `${seed} ${s.item.id}.${f.id} (${s.kind}: ${s.item.prompt})`).toBe(s.values[f.id]);
          }
        }
      }
    }
  });

  it("JE flash: a debit and a credit from one short chart of accounts, never the same account", () => {
    for (const seed of SEEDS.slice(0, 50)) {
      for (const s of solveRapid(seed, "rapid-je")) {
        expect(s.values.debit).not.toBe(s.values.credit);
        const [dr, cr] = [choiceField(s.item, "debit"), choiceField(s.item, "credit")];
        expect(dr.options).toEqual(cr.options);
        expect(dr.options.length).toBeGreaterThanOrEqual(10);
        expect(dr.options.length).toBeLessThanOrEqual(14);
      }
    }
  });

  it("pay or hold: every kind of problem shows up, and only one per invoice", () => {
    const kinds = new Map<string, number>();
    for (const seed of SEEDS.slice(0, 50)) {
      const solved = solveRapid(seed, "rapid-pay");
      for (const s of solved) kinds.set(s.kind, (kinds.get(s.kind) ?? 0) + 1);
      expect(solved.filter((s) => s.values.decision === optionId(s.item, "decision", "Pay")).length, seed).toBeGreaterThanOrEqual(3);
      expect(solved.filter((s) => s.values.decision === optionId(s.item, "decision", "Hold")).length, seed).toBeGreaterThanOrEqual(8);
    }
    expect([...kinds.keys()].sort()).toEqual(["bank", "duplicate", "near-miss", "no_po", "ok", "over_limit"]);
  });

  it("cash application: exact single and paired invoices, short-pays and unapplied cash all show up", () => {
    const kinds = new Set<string>();
    for (const seed of SEEDS.slice(0, 50)) for (const s of solveRapid(seed, "rapid-cash")) kinds.add(s.kind);
    expect([...kinds].sort()).toEqual(["pair", "short", "single-noref", "single-ref", "unapplied"]);
  });

  it("ten quick items worth half a point and five harder ones worth one, in every round", () => {
    const hardKinds: Record<RapidStepId, string[]> = {
      "rapid-je": JE_RULES.filter((r) => r[4] === "hard").map((r) => r[0]),
      "rapid-pay": ["duplicate", "over_limit", "near-miss"],
      "rapid-cash": ["short", "unapplied"],
    };
    for (const id of RAPID_STEPS) {
      const points = rapidConfig(id).items.map((i) => i.points);
      expect(points.filter((p) => p === 0.5).length, id).toBe(10);
      expect(points.filter((p) => p === 1).length, id).toBe(5);
      for (const seed of SEEDS.slice(0, 50)) {
        solveRapid(seed, id).forEach((s, i) => {
          expect(hardKinds[id].includes(s.kind), `${seed} ${id} item ${i} ${s.kind}`).toBe(points[i] === 1);
        });
      }
    }
  });

  it("is deterministic per seed", () => {
    for (const seed of SEEDS.slice(0, 20)) for (const id of RAPID_STEPS) expect(rapidItems(seed, id)).toEqual(rapidItems(seed, id));
  });

  it("varies per seed: amounts, names, which transaction comes when, and where the right option sits", () => {
    for (const id of RAPID_STEPS) {
      const firsts = SEEDS.slice(0, 60).map((seed) => solveRapid(seed, id)[0]);
      expect(new Set(firsts.map((s) => JSON.stringify(s.item))).size, id).toBe(60);
      expect(new Set(firsts.map((s) => s.kind)).size, id).toBeGreaterThanOrEqual(2);
      expect(new Set(firsts.map((s) => JSON.stringify(s.values))).size, id).toBeGreaterThanOrEqual(2);
    }
    // The cash-application answer isn't always the first option.
    const applyIds = new Set(SEEDS.slice(0, 60).flatMap((seed) => solveRapid(seed, "rapid-cash").map((s) => s.values.apply)));
    expect(applyIds.size).toBe(4);
  });

  it("a wrong field costs half its item; a wrong item costs its points", () => {
    const seed = "abc";
    const perfect = scoreAttempt(scenario, seed, perfectAnswers(seed));
    for (const id of RAPID_STEPS) {
      const a = clone(perfectAnswers(seed)) as unknown as Record<string, { items: Record<string, { values: Record<string, string> }> }>;
      const solved = solveRapid(seed, id);
      const hard = rapidConfig(id).items.findIndex((i) => i.points === 1);
      const easy = rapidConfig(id).items.findIndex((i) => i.points === 0.5);
      delete a[id].items[solved[hard].item.id];
      const firstField = solved[easy].item.fields[0] as RapidChoiceField;
      a[id].items[solved[easy].item.id].values[firstField.id] = firstField.options.find((o) => o.id !== solved[easy].values[firstField.id])!.id;
      const s = scoreAttempt(scenario, seed, a);
      expect(perfect.steps[id].points - s.steps[id].points, id).toBe(1.25);
    }
  });

  it("no rendered rapid item holds a key value or key string (50 seeds)", () => {
    const leaves = (key: unknown, out: { numbers: number[]; strings: string[] } = { numbers: [], strings: [] }, field = ""): typeof out => {
      if (["accounts", "side", "targets", "reasons", "decision", "choice"].includes(field)) return out;
      if (typeof key === "number" && (field === "value" || field === "amount")) out.numbers.push(key);
      else if (typeof key === "string") out.strings.push(key);
      else if (key && typeof key === "object") for (const [k, v] of Object.entries(key)) leaves(v, out, k);
      return out;
    };
    const pattern = (n: number) =>
      [n.toFixed(2), n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })].map(
        (f) => new RegExp(`(?<![\\d.,])${f.replace(/[.$]/g, "\\$&")}(?![\\d.]\\d)`),
      );
    let checked = 0;
    for (const seed of SEEDS.slice(0, 50)) {
      const variant = scenario.generate(seed);
      const shown = new Set(Object.values(variant.values).filter((x): x is number => typeof x === "number").map((c) => c / 100));
      const all = leaves(variant.keys);
      const derived = all.numbers.filter((n) => Math.abs(n) >= 1 && !shown.has(Math.abs(n)));
      for (const id of RAPID_STEPS) {
        const key = variant.keys[id] as RapidKey;
        for (const item of rapidItems(seed, id)) {
          const json = JSON.stringify(item);
          expect(json).not.toMatch(/choice"|tolerance|points|"kind":"choice"/);
          for (const k of Object.keys(item)) expect(["id", "prompt", "exhibit", "fields"]).toContain(k);
          for (const s of all.strings) expect(json, `${seed} ${item.id}: key note`).not.toContain(s);
          for (const n of derived) for (const p of pattern(Math.abs(n))) expect(json, `${seed} ${item.id}: ${n}`).not.toMatch(p);
          // The key for this item says nothing beyond option ids the item already lists.
          for (const [fieldId, k] of Object.entries(key.items[item.id])) {
            expect(Object.keys(k)).toEqual(["choice"]);
            expect(choiceField(item, fieldId).options.map((o) => o.id)).toContain(k.choice);
          }
          checked++;
        }
      }
    }
    expect(checked).toBe(50 * 45);
  });

  it("option ids are fixed per item, so an id can't hint at the answer", () => {
    for (const id of RAPID_STEPS) {
      const ids = (seed: string) => rapidItems(seed, id).map((i) => i.fields.map((f) => [f.id, (f as RapidChoiceField).options.map((o) => o.id)]));
      const first = JSON.stringify(ids(SEEDS[0]));
      for (const seed of SEEDS.slice(1, 30)) expect(JSON.stringify(ids(seed)), `${id} ${seed}`).toBe(first);
    }
  });
});

describe("corporate-ap-ridgeway: messages", () => {
  const msgs = scenario.definition.messages;
  const stepOf = (id?: string) => scenario.definition.steps.find((s) => s.id === id);

  it("every message delivers a task", () => {
    for (const m of msgs) expect(stepOf(m.stepId), m.id).toBeDefined();
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
