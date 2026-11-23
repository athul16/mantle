import { describe, expect, it, vi } from "vitest";
import type { RapidChoiceField, RapidItem, RapidNumberField } from "@/lib/engine/step-types/rapid_round/public";

vi.mock("server-only", () => ({}));

const { forensicMarlowExpenses } = await import("@/lib/engine/scenarios/forensic-marlow-expenses");
const { getScenario, listScenarios } = await import("@/lib/engine/scenarios");
const { renderAttemptForCandidate, renderFlowForCandidate } = await import("@/lib/engine/server/render");
const { scoreAttempt } = await import("@/lib/engine/server/score");
const { resolveFlow, resolveItems, visibleMessageIds, validateSections } = await import("@/lib/engine/server/flow");
const { rapidRoundServer } = await import("@/lib/engine/step-types/rapid_round/server");
const { fillTemplate, templateValues } = await import("@/lib/engine/server/template");

/**
 * docs/07 Example 9: Marlow Forensic, forensic intern on a nonprofit's vendor
 * and expense review, in six timed sections. Like the Ridgeway tests, these
 * solve every task from what the candidate sees (vendor tables, the payroll
 * address list, the payment extract, the rapid items) and compare that with
 * the server key, so the material and the key can't drift apart.
 */

const scenario = forensicMarlowExpenses;
const SEEDS = Array.from({ length: 200 }, (_, i) => `attempt-${i.toString(16).padStart(4, "0")}`);
const END = scenario.timeLimitMinutes;
const VENDOR_STEPS = ["vendors-1", "vendors-2", "vendors-3", "vendors-4"] as const;
const RAPID_STEPS = ["rapid-redflag", "rapid-duplicate", "rapid-analytics"] as const;
type RapidStepId = (typeof RAPID_STEPS)[number];
const RUBRIC_STEPS = ["suspect-reply", "board-reply", "findings-memo"] as const;
const AUTO_STEPS = [...RAPID_STEPS, ...VENDOR_STEPS, "vendor-list", "flagged-total", "findings-sheet"] as const;
const MAX = 100;
const RUBRIC_MAX = 25;
const SLOW = 120_000;

type Field = { id: string; label: string; value: string };
type Doc = {
  prompt: string;
  document: { title: string; fields: Field[]; columns: string[]; rows: { id: string; cells: string[] }[]; totals: Field[]; footnote?: string };
  reasons: { id: string; label: string }[];
  decision?: { prompt: string; options: { id: string; label: string }[] };
  confirmClean?: { label: string };
};
type Choice = { prompt: string; options: { id: string; label: string }[]; select: "single" | "multi" };
type Cell = { kind: "text"; text: string } | { kind: "input"; id: string } | { kind: "empty" };
type Grid = { prompt: string; columns: string[]; rows: Cell[][] };
type ReviewKey = { findings: Record<string, { targets: string[]; reasons: string[]; note?: string }>; decision?: string[]; clean?: boolean };
type ReplyKey = { notes: Record<string, string> };
type SheetKey = { cells: Record<string, { value: number }> };
type Indicator = "po_box" | "no_tax_id" | "employee_address" | "same_day";
const INDICATORS: Indicator[] = ["po_box", "no_tax_id", "employee_address", "same_day"];

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
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "Mar 3, 2026" or "Sat, Mar 3, 2026" to a day number (UTC days since 1970). */
const dayOf = (s: string) => {
  const m = s.match(/([A-Z][a-z]{2}) (\d{1,2}), (\d{4})$/);
  expect(m, `date ${s}`).not.toBeNull();
  return Date.UTC(Number(m![3]), MONTHS.indexOf(m![1]), Number(m![2])) / 86_400_000;
};
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
/** The weekday a date string says, checked against the calendar. */
const weekday = (s: string) => {
  const shown = s.match(/^([A-Z][a-z]{2}), /)?.[1];
  const actual = WEEKDAYS[new Date(dayOf(s) * 86_400_000).getUTCDay()];
  if (shown) expect(shown, `weekday of ${s}`).toBe(actual);
  return actual;
};
const isWeekend = (s: string) => ["Sat", "Sun"].includes(weekday(s));
/** Approval limit as the material states it ("$5,000.00 or more"). */
const limitIn = (s: string) => {
  const m = s.match(/(\$[\d,]+\.\d\d) or more/);
  expect(m, `limit in "${s}"`).not.toBeNull();
  return cents(m![1]);
};
const isRound = (c: number) => c % 2_500 === 0;
/** A round amount at most $200 under the limit. */
const justUnder = (c: number, limit: number) => isRound(c) && c < limit && limit - c <= 20_000;

/** Everything the candidate sees after the whole attempt. */
function screen(seed: string) {
  const view = renderAttemptForCandidate(scenario, seed, END);
  const step = (id: string) => {
    const s = view.steps.find((x) => x.id === id);
    expect(s, `step ${id}`).toBeDefined();
    return s!;
  };
  const msg = (id: string) => {
    const m = view.messages.find((x) => x.id === id);
    expect(m, `message ${id}`).toBeDefined();
    return m!;
  };
  return { view, step, msg };
}

type VendorRow = { stepId: string; rowId: string; name: string; address: string; taxId: string; created: string; firstPaid: string; indicators: Indicator[] };

/** The four vendor master screens, read the way a forensic reviewer would. */
function readVendors(seed: string) {
  const { step } = screen(seed);
  const docs = VENDOR_STEPS.map((id) => step(id).config as Doc);
  const employees = new Map<string, string>();
  const footnotes = new Set(docs.map((d) => d.document.footnote));
  expect(footnotes.size, `${seed} same employee list on every screen`).toBe(1);
  for (const line of (docs[0].document.footnote ?? "").split("\n").slice(1)) {
    const m = line.match(/^(.+?): (.+)$/);
    expect(m, `${seed} employee line "${line}"`).not.toBeNull();
    employees.set(m![1], m![2]);
  }
  expect(employees.size, seed).toBe(6);
  const addresses = new Set(employees.values());
  const rows: VendorRow[] = docs.flatMap((d, i) => {
    expect(d.document.columns).toEqual(["Vendor", "Address", "Tax ID (EIN)", "Created", "First payment"]);
    return d.document.rows.map((r) => {
      const [name, address, taxId, created, firstPaid] = r.cells;
      const indicators: Indicator[] = [];
      if (/^P\.?\s?O\.? Box/i.test(address)) indicators.push("po_box");
      if (!/^\d{2}-\d{7}$/.test(taxId)) indicators.push("no_tax_id");
      if (addresses.has(address)) indicators.push("employee_address");
      if (dayOf(created) === dayOf(firstPaid)) indicators.push("same_day");
      return { stepId: VENDOR_STEPS[i], rowId: r.id, name, address, taxId, created, firstPaid, indicators };
    });
  });
  const suspicious = rows.filter((r) => r.indicators.length > 0);
  const flagged = rows.find((r) => r.indicators.includes("employee_address"))!;
  const suspect = [...employees].find(([, a]) => a === flagged?.address)?.[0];
  return { docs, employees, rows, suspicious, flagged, suspect };
}

type Payment = { date: string; vendor: string; invoice: string; amount: number };

/** Sam's payment extract (message m3), one "• date · vendor · Invoice n · $x" line per payment. */
function extractFromEmail(seed: string): Payment[] {
  const body = screen(seed).msg("m3").body;
  return body
    .split("\n")
    .filter((l) => l.startsWith("• "))
    .map((l) => {
      const parts = l.slice(2).split(" · ");
      expect(parts.length, l).toBe(4);
      return { date: parts[0], vendor: parts[1], invoice: parts[2].replace(/^Invoice /, ""), amount: cents(parts[3]) };
    });
}

/** The findings workbook: the extract at the top, the summary rows below. */
function readSheet(seed: string) {
  const sheet = screen(seed).step("findings-sheet").config as Grid;
  const limit = limitIn(sheet.prompt);
  const payments: Payment[] = sheet.rows
    .filter((r) => /^[A-Z][a-z]{2}, [A-Z][a-z]{2} \d{1,2}, \d{4}$/.test(text(r[0])))
    .map((r) => ({ date: text(r[0]), vendor: text(r[1]), invoice: text(r[2]), amount: cents(text(r[3])) }));
  const summary = sheet.rows
    .filter((r) => r[1]?.kind === "input" && /^n_/.test(r[1].id))
    .map((r) => ({ vendor: text(r[0]), ids: r.slice(1, 4).map((c) => (c.kind === "input" ? c.id : "")) }));
  const grand = sheet.rows.flatMap((r) => r).find((c) => c.kind === "input" && c.id === "t_all");
  expect(grand, `${seed} grand total cell`).toBeDefined();
  const solve = (vendor: string) => {
    const mine = payments.filter((p) => p.vendor === vendor);
    return {
      count: mine.length,
      total: mine.reduce((t, p) => t + p.amount, 0),
      redFlags: mine.filter((p) => isWeekend(p.date) || justUnder(p.amount, limit)).length,
    };
  };
  return { sheet, limit, payments, summary, solve };
}

// ---- Rapid rounds, rendered one item at a time exactly as the attempt flow does ----

const rapidConfig = (stepId: RapidStepId) => rapidRoundServer.configSchema.parse(scenario.definition.steps.find((s) => s.id === stepId)!.config);

function rapidItems(seed: string, stepId: RapidStepId): RapidItem[] {
  const variant = scenario.generate(seed);
  const values = templateValues(variant.values);
  const fill = (t: string) => fillTemplate(t, values);
  const config = rapidConfig(stepId);
  const seq = rapidRoundServer.sequence!;
  return Array.from({ length: seq.count(config) }, (_, i) => seq.renderItem(config, { variant, fill }, i) as RapidItem);
}

type RapidKey = { items: Record<string, Record<string, { choice?: string; value?: number; tolerance?: number }>> };
type Solved = { values: Record<string, string | number>; kind: string };

const choiceField = (item: RapidItem, id: string) => {
  const f = item.fields.find((x) => x.id === id) as RapidChoiceField | undefined;
  expect(f, `${item.id} field ${id}`).toBeDefined();
  expect(f!.options.length).toBeGreaterThanOrEqual(2);
  return f!;
};
const optionId = (item: RapidItem, fieldId: string, label: RegExp | string) => {
  const opts = choiceField(item, fieldId).options.filter((o) => (typeof label === "string" ? o.label === label : label.test(o.label)));
  expect(opts.length, `${item.id} ${fieldId}: one option like ${label}`).toBe(1);
  return opts[0].id;
};
const exRow = (item: RapidItem, label: string) => {
  const r = item.exhibit?.rows?.find((x) => x.label === label);
  expect(r, `${item.id} row ${label}`).toBeDefined();
  return r!.value;
};

/** Rapid A: the one red flag on an expense line or vendor record, or none. */
function solveRedFlag(item: RapidItem, limit: number): Solved {
  const issues: string[] = [];
  let kind: string;
  if (item.exhibit?.title === "Expense line") {
    const date = exRow(item, "Date");
    const amount = cents(exRow(item, "Amount"));
    exRow(item, "Paid to");
    exRow(item, "Approved by");
    const desc = exRow(item, "Description");
    if (isWeekend(date)) issues.push("weekend");
    if (isRound(amount) && amount < limit && limit - amount <= 15_000) issues.push("under_limit");
    expect(amount, `${item.id} under the limit`).toBeLessThan(limit);
    kind = issues[0] ?? (isRound(amount) ? "near-miss-lease" : "normal-expense");
    if (kind === "near-miss-lease") {
      expect(desc).toMatch(/lease/i);
      expect(amount).toBeLessThanOrEqual(limit / 2);
    }
    if (kind === "normal-expense") expect(amount).toBeLessThanOrEqual(limit * 0.6);
  } else {
    expect(item.exhibit?.title).toBe("Vendor record");
    exRow(item, "Vendor");
    const address = exRow(item, "Address");
    const acct = exRow(item, "Bank account").match(/acct ending (\d{4})$/)![1];
    const invoices = exRow(item, "Recent invoices").split(", ").map(Number);
    const employee = exRow(item, "Employee on payroll").match(/^(.+?), (.+)$/)!;
    const other = exRow(item, "Another vendor on file").match(/^(.+), acct ending (\d{4})$/)!;
    expect(invoices.length).toBe(3);
    if (employee[2] === address) issues.push("employee_address");
    if (other[2] === acct) issues.push("shared_bank");
    if (invoices[1] === invoices[0] + 1 && invoices[2] === invoices[1] + 1) issues.push("sequential");
    const street = (a: string) => a.replace(/^\d+ /, "");
    kind = issues[0] ?? (street(employee[2]) === street(address) ? "near-miss-street" : "normal-vendor");
  }
  expect(issues.length, `${item.id}: at most one problem (${issues})`).toBeLessThanOrEqual(1);
  const why: Record<string, RegExp> = {
    ok: /^Nothing unusual/,
    under_limit: /just under the approval limit/,
    weekend: /^Weekend date/,
    employee_address: /matches an employee/,
    shared_bank: /Same bank account/,
    sequential: /Sequential invoice numbers/,
  };
  return {
    kind,
    values: { call: optionId(item, "call", issues.length ? "Red flag" : "Normal"), why: optionId(item, "why", why[issues[0] ?? "ok"]) },
  };
}

const digits = (inv: string) => inv.replace(/\D/g, "").replace(/^0+/, "");

/** Rapid B: the pair that is one invoice paid twice, and the row of the second payment. */
function solveDuplicate(item: RapidItem): Solved & { pair: [number, number]; change: "format" | "day"; decoy: boolean } {
  const table = item.exhibit?.table;
  expect(table?.columns).toEqual(["Row", "Vendor", "Invoice no.", "Invoice date", "Amount"]);
  const rows = table!.rows.map((r) => ({ row: Number(r[0]), vendor: r[1], inv: r[2], day: dayOf(r[3]), amount: cents(r[4]) }));
  expect(rows.map((r) => r.row)).toEqual([1, 2, 3, 4, 5, 6]);
  const pairs: { i: number; j: number; change: "format" | "day" }[] = [];
  let decoy = false;
  for (let i = 0; i < 6; i++) {
    for (let j = i + 1; j < 6; j++) {
      const [a, b] = [rows[i], rows[j]];
      if (a.vendor !== b.vendor || a.amount !== b.amount) continue;
      if (digits(a.inv) === digits(b.inv) && a.inv !== b.inv && a.day === b.day) pairs.push({ i, j, change: "format" });
      else if (a.inv === b.inv && Math.abs(a.day - b.day) === 1) pairs.push({ i, j, change: "day" });
      else {
        // Same vendor and amount, but a different invoice a month or so apart: a recurring charge.
        expect(digits(a.inv), `${item.id} decoy has its own number`).not.toBe(digits(b.inv));
        expect(Math.abs(a.day - b.day)).toBeGreaterThanOrEqual(25);
        decoy = true;
      }
    }
  }
  expect(pairs.length, `${item.id}: exactly one invoice paid twice`).toBe(1);
  const { i, j, change } = pairs[0];
  // No other row shares an invoice number with anything else.
  const nos = rows.map((r) => `${r.vendor}|${digits(r.inv)}`);
  expect(new Set(nos).size, `${item.id} only the twins share a number`).toBe(5);
  return {
    kind: decoy ? `${change}-decoy` : change,
    pair: [i, j],
    change,
    decoy,
    values: { row: optionId(item, "row", `Row ${j + 1}`) },
  };
}

/** Rapid C: month that breaks the pattern, the split payments, or a vendor total. */
function solveAnalytics(item: RapidItem, limit: number): Solved {
  const table = item.exhibit?.table;
  expect(table, item.id).toBeDefined();
  if (item.fields[0].id === "month") {
    expect(table!.columns).toEqual(["Month", "Total"]);
    const amounts = table!.rows.map((r) => cents(r[1]));
    expect(amounts.length).toBe(6);
    const top = Math.max(...amounts);
    const at = amounts.indexOf(top);
    const rest = amounts.filter((_, i) => i !== at);
    expect(top, `${item.id} the odd month stands out`).toBeGreaterThanOrEqual(Math.max(...rest) * 1.6);
    expect(Math.max(...rest) / Math.min(...rest), `${item.id} the others are steady`).toBeLessThanOrEqual(1.2);
    const month = table!.rows[at][0].split(" ")[0];
    return { kind: "month", values: { month: optionId(item, "month", month) } };
  }
  expect(table!.columns).toEqual(["Date", "Vendor", "Amount"]);
  const rows = table!.rows.map((r) => ({ day: dayOf(r[0]), vendor: r[1], amount: cents(r[2]) }));
  for (let i = 1; i < rows.length; i++) expect(rows[i].day).toBeGreaterThanOrEqual(rows[i - 1].day);
  if (item.fields[0].id === "vendor") {
    expect(limitIn(item.prompt.replace("approval limit", "or more"))).toBe(limit);
    const split = new Set<string>();
    for (let i = 0; i < rows.length; i++) {
      for (let j = i + 1; j < rows.length; j++) {
        const [a, b] = [rows[i], rows[j]];
        if (a.vendor === b.vendor && Math.abs(a.day - b.day) <= 2 && a.amount < limit && b.amount < limit && a.amount + b.amount >= limit) split.add(a.vendor);
      }
    }
    expect(split.size, `${item.id} one vendor split a payment`).toBe(1);
    return { kind: "split", values: { vendor: optionId(item, "vendor", [...split][0]) } };
  }
  const f = item.fields[0] as RapidNumberField;
  expect(f.kind).toBe("number");
  const vendor = item.prompt.match(/^What did we pay (.+) in total\?$/)![1];
  const mine = rows.filter((r) => r.vendor === vendor);
  expect(mine.length).toBeGreaterThanOrEqual(2);
  return { kind: "total", values: { total: dollars(mine.reduce((t, r) => t + r.amount, 0)) } };
}

function limitFor(seed: string) {
  const intro = (screen(seed).step("rapid-redflag").config as { intro: string }).intro;
  return limitIn(intro);
}

function solveRapid(seed: string, stepId: RapidStepId) {
  const limit = limitFor(seed);
  return rapidItems(seed, stepId).map((item) => {
    const s = stepId === "rapid-redflag" ? solveRedFlag(item, limit) : stepId === "rapid-duplicate" ? solveDuplicate(item) : solveAnalytics(item, limit);
    return { item, ...s };
  });
}

function rapidAnswers(seed: string) {
  return Object.fromEntries(
    RAPID_STEPS.map((id) => [id, { items: Object.fromEntries(solveRapid(seed, id).map((s) => [s.item.id, { values: s.values, ms: 6_000 }])) }]),
  ) as Record<RapidStepId, { items: Record<string, { values: Record<string, string | number>; ms: number }> }>;
}

const REASON_FOR: Record<Indicator, string> = { po_box: "po_box", no_tax_id: "no_tax_id", employee_address: "employee_address", same_day: "same_day" };

/** A strong candidate's answers, built only from the screen. */
function perfectAnswers(seed: string) {
  const { suspicious, flagged } = readVendors(seed);
  const vendorAnswers = Object.fromEntries(
    VENDOR_STEPS.map((stepId) => [
      stepId,
      { flags: suspicious.filter((r) => r.stepId === stepId).map((r) => ({ target: r.rowId, reason: REASON_FOR[r.indicators[0]], note: "" })) },
    ]),
  );
  const list = screen(seed).step("vendor-list").config as Choice;
  const extract = extractFromEmail(seed);
  const flaggedTotal = extract.filter((p) => p.vendor === flagged.name).reduce((t, p) => t + p.amount, 0);
  const sheet = readSheet(seed);
  const cells: Record<string, number> = {};
  let all = 0;
  for (const s of sheet.summary) {
    const r = sheet.solve(s.vendor);
    cells[s.ids[0]] = r.count;
    cells[s.ids[1]] = dollars(r.total);
    cells[s.ids[2]] = r.redFlags;
    all += r.total;
  }
  cells.t_all = dollars(all);
  return {
    ...rapidAnswers(seed),
    ...vendorAnswers,
    "vendor-list": { selected: list.options.filter((o) => suspicious.some((r) => r.name === o.label)).map((o) => o.id) },
    "suspect-reply": { body: "Hi, thanks for offering. Sam is leading this work, so please send any questions to him." },
    "flagged-total": { value: dollars(flaggedTotal) },
    "board-reply": { body: "Thanks for asking. We report what the records show; whether it is fraud is for the board and counsel. Sam will brief you." },
    "findings-sheet": { cells },
    "findings-memo": { body: `Sam, ${flagged.name} received ${money(flaggedTotal)}. Next steps: preserve records, interviews, bank records.` },
  };
}

type Answers = ReturnType<typeof perfectAnswers>;
const clone = (a: Answers): Answers & Record<string, unknown> => JSON.parse(JSON.stringify(a));
const autoPoints = (seed: string, a: unknown) => scoreAttempt(scenario, seed, a as Record<string, unknown>).points;

describe("forensic-marlow-expenses: setup", () => {
  it("is registered, version 1, accounting, about 45 to 50 minutes, and uses only built step types in section order", () => {
    expect(getScenario("forensic-marlow-expenses", 1)).toBe(scenario);
    expect(listScenarios()).toContain(scenario);
    expect(scenario.version).toBe(1);
    expect(scenario.timeLimitMinutes).toBe(49);
    expect(scenario.roleFamily).toBe("accounting");
    expect(scenario.definition.steps.map((s) => [s.id, s.type])).toEqual([
      ["rapid-redflag", "rapid_round"],
      ["vendors-1", "document_review"],
      ["vendors-2", "document_review"],
      ["vendors-3", "document_review"],
      ["vendors-4", "document_review"],
      ["vendor-list", "multiple_choice"],
      ["rapid-duplicate", "rapid_round"],
      ["suspect-reply", "inbox_reply"],
      ["flagged-total", "numeric"],
      ["board-reply", "inbox_reply"],
      ["rapid-analytics", "rapid_round"],
      ["findings-sheet", "spreadsheet"],
      ["findings-memo", "inbox_reply"],
    ]);
    const intro = renderAttemptForCandidate(scenario, "abc", 0).intro;
    expect(intro).toMatch(/Marlow Forensic/);
    expect(intro).toMatch(/Sam/);
    expect(intro).toMatch(/nonprofit/);
    expect(intro).toMatch(/board/);
  });

  it(
    "renders for 200 seeds with no unfilled template, and every rapid item renders",
    () => {
      for (const seed of SEEDS) {
        for (const minute of [0, END]) {
          const view = renderAttemptForCandidate(scenario, seed, minute);
          expect(JSON.stringify(view)).not.toContain("{{");
        }
        for (const id of RAPID_STEPS) expect(JSON.stringify(rapidItems(seed, id))).not.toContain("{{");
      }
    },
    SLOW,
  );

  it("is deterministic per seed", () => {
    for (const seed of SEEDS.slice(0, 20)) {
      expect(scenario.generate(seed)).toEqual(scenario.generate(seed));
      expect(renderAttemptForCandidate(scenario, seed, END)).toEqual(renderAttemptForCandidate(scenario, seed, END));
      for (const id of RAPID_STEPS) expect(rapidItems(seed, id)).toEqual(rapidItems(seed, id));
    }
  });

  it("different seeds change amounts, names, the nonprofit, dates and which vendor holds which indicator", () => {
    expect(new Set(SEEDS.map((s) => JSON.stringify(scenario.generate(s).values))).size).toBe(SEEDS.length);
    const seeds = SEEDS.slice(0, 60);
    const vendors = seeds.map(readVendors);
    expect(new Set(vendors.map((v) => v.flagged.name)).size).toBeGreaterThan(20);
    expect(new Set(vendors.map((v) => v.flagged.address)).size).toBeGreaterThan(50);
    expect(new Set(vendors.map((v) => v.suspect)).size).toBeGreaterThan(20);
    expect(new Set(vendors.map((v) => v.rows[0].created)).size).toBeGreaterThan(30);
    expect(new Set(vendors.map((v) => `${v.flagged.stepId}/${v.flagged.rowId}`)).size).toBeGreaterThanOrEqual(10);
    for (const ind of INDICATORS) {
      expect(new Set(vendors.map((v) => v.suspicious.find((r) => r.indicators[0] === ind)!.stepId)).size, ind).toBe(4);
    }
    expect(new Set(seeds.map((s) => renderAttemptForCandidate(scenario, s, 0).intro)).size).toBeGreaterThan(5);
    expect(new Set(seeds.map((s) => extractFromEmail(s).reduce((t, p) => t + p.amount, 0))).size).toBe(60);
    expect(new Set(seeds.map(limitFor)).size).toBe(4);
  });
});

describe("forensic-marlow-expenses: every variant is internally consistent", () => {
  it(
    "the vendor master has 12 different vendors, three per screen, and the same six employees on every screen",
    () => {
      for (const seed of SEEDS) {
        const { rows, docs, employees } = readVendors(seed);
        expect(rows.length).toBe(12);
        expect(new Set(rows.map((r) => r.name)).size, seed).toBe(12);
        for (const d of docs) expect(d.document.rows.map((r) => r.id)).toEqual(["v1", "v2", "v3"]);
        expect(new Set(employees.values()).size, `${seed} six different home addresses`).toBe(6);
        for (const r of rows) expect(dayOf(r.firstPaid), `${seed} ${r.name} paid after set-up`).toBeGreaterThanOrEqual(dayOf(r.created));
      }
    },
    SLOW,
  );

  it(
    "the vendor keys agree with the screens: one finding per screen, on the suspicious vendor, with its sign",
    () => {
      for (const seed of SEEDS) {
        const { suspicious } = readVendors(seed);
        const keys = scenario.generate(seed).keys;
        for (const stepId of VENDOR_STEPS) {
          const k = keys[stepId] as ReviewKey;
          const mine = suspicious.filter((r) => r.stepId === stepId);
          expect(mine.length, `${seed} ${stepId}`).toBe(1);
          expect(k.clean).not.toBe(true);
          expect(Object.keys(k.findings)).toEqual(["shell"]);
          expect(k.findings.shell.targets).toEqual([mine[0].rowId]);
          expect(k.findings.shell.reasons).toEqual([REASON_FOR[mine[0].indicators[0]]]);
        }
        const list = keys["vendor-list"] as { correct: string[] };
        const options = (screen(seed).step("vendor-list").config as Choice).options;
        expect(list.correct.map((id) => options.find((o) => o.id === id)!.label).sort()).toEqual(suspicious.map((r) => r.name).sort());
      }
    },
    SLOW,
  );

  it("the follow-up list offers all 12 vendors in screen order, multi-select", () => {
    for (const seed of SEEDS.slice(0, 50)) {
      const list = screen(seed).step("vendor-list").config as Choice;
      expect(list.select).toBe("multi");
      expect(list.options.map((o) => o.label)).toEqual(readVendors(seed).rows.map((r) => r.name));
      expect(list.options.map((o) => o.id)).toEqual(Array.from({ length: 12 }, (_, i) => `v${String(i + 1).padStart(2, "0")}`));
    }
  });

  it(
    "Sam's extract and the findings workbook list the same payments, to the four vendors on the follow-up list",
    () => {
      for (const seed of SEEDS) {
        const { suspicious, flagged } = readVendors(seed);
        const email = extractFromEmail(seed);
        const { payments, summary, limit } = readSheet(seed);
        expect(payments, seed).toEqual(email.map((p) => ({ ...p })));
        expect(new Set(payments.map((p) => p.vendor))).toEqual(new Set(suspicious.map((r) => r.name)));
        expect(summary.map((s) => s.vendor).sort()).toEqual(suspicious.map((r) => r.name).sort());
        for (let i = 1; i < payments.length; i++) expect(dayOf(payments[i].date)).toBeGreaterThanOrEqual(dayOf(payments[i - 1].date));
        for (const p of payments) {
          expect(p.amount, `${seed} under the limit`).toBeLessThan(limit);
          // No payment is both a weekend payment and just under the limit, so the count is the same either way.
          expect(isWeekend(p.date) && justUnder(p.amount, limit), `${seed} ${p.date}`).toBe(false);
          // Every round amount is a red flag; the rest carry cents.
          if (isRound(p.amount)) expect(justUnder(p.amount, limit)).toBe(true);
          else expect(p.amount % 100).not.toBe(0);
        }
        // The flagged vendor: five payments, sequential invoice numbers, three or four red flags.
        const mine = payments.filter((p) => p.vendor === flagged.name);
        expect(mine.length).toBe(5);
        const nos = mine.map((p) => Number(digits(p.invoice))).sort((a, b) => a - b);
        for (let i = 1; i < 5; i++) expect(nos[i]).toBe(nos[i - 1] + 1);
        const flags = mine.filter((p) => isWeekend(p.date) || justUnder(p.amount, limit)).length;
        expect(flags).toBeGreaterThanOrEqual(3);
        expect(flags).toBeLessThanOrEqual(4);
        for (const other of suspicious.filter((r) => r !== flagged)) {
          const theirs = payments.filter((p) => p.vendor === other.name);
          expect(theirs.length).toBeGreaterThanOrEqual(2);
          expect(theirs.length).toBeLessThanOrEqual(3);
        }
      }
    },
    SLOW,
  );

  it(
    "the findings sheet key is the solution from the extract",
    () => {
      for (const seed of SEEDS) {
        const sheet = readSheet(seed);
        const key = (scenario.generate(seed).keys["findings-sheet"] as SheetKey).cells;
        let all = 0;
        for (const s of sheet.summary) {
          const r = sheet.solve(s.vendor);
          expect([key[s.ids[0]].value, Math.round(key[s.ids[1]].value * 100), key[s.ids[2]].value], `${seed} ${s.vendor}`).toEqual([r.count, r.total, r.redFlags]);
          all += r.total;
        }
        expect(Math.round(key.t_all.value * 100)).toBe(all);
        expect(Object.keys(key).length).toBe(13);
      }
    },
    SLOW,
  );

  it("gives reviewers this variant's facts for the three replies", () => {
    for (const seed of SEEDS.slice(0, 50)) {
      const { flagged, suspect } = readVendors(seed);
      const keys = scenario.generate(seed).keys;
      const total = extractFromEmail(seed).filter((p) => p.vendor === flagged.name).reduce((t, p) => t + p.amount, 0);
      const memo = (keys["findings-memo"] as ReplyKey).notes;
      expect(memo.facts).toContain(flagged.name);
      expect(memo.facts).toContain(money(total));
      expect((keys["suspect-reply"] as ReplyKey).notes.scope).toContain(suspect!);
      expect((keys["board-reply"] as ReplyKey).notes.findings).toMatch(/findings/i);
    }
  });
});

describe("forensic-marlow-expenses: scoring", () => {
  it("out of 100: rapid rounds 10 each, vendor review 25, inbox 15, findings 30", () => {
    const blank = scoreAttempt(scenario, "abc", {});
    expect(blank.points).toBe(0);
    expect(blank.maxPoints).toBe(MAX);
    const max = (id: string) => blank.steps[id].maxPoints;
    expect(RAPID_STEPS.map(max)).toEqual([10, 10, 10]);
    expect(VENDOR_STEPS.map(max)).toEqual([5, 5, 5, 5]);
    expect(max("vendor-list")).toBe(5);
    expect([max("suspect-reply"), max("flagged-total"), max("board-reply")]).toEqual([5, 5, 5]);
    expect([max("findings-sheet"), max("findings-memo")]).toEqual([15, 15]);
    const sections = scenario.definition.sections!.map((s) => s.stepIds.reduce((t, id) => t + max(id), 0));
    expect(sections).toEqual([10, 25, 10, 15, 10, 30]);
  });

  it("blank scores 0 for every seed, with nothing sent to review", () => {
    for (const seed of SEEDS.slice(0, 50)) {
      const s = scoreAttempt(scenario, seed, {});
      expect(s.points).toBe(0);
      for (const id of RUBRIC_STEPS) expect(s.steps[id].needsReview).toBeFalsy();
    }
  });

  it(
    "a perfect answer earns every automatic point and the three replies go to review",
    () => {
      for (const seed of SEEDS) {
        const s = scoreAttempt(scenario, seed, perfectAnswers(seed));
        for (const id of AUTO_STEPS) expect(s.steps[id].points, `${seed} ${id}`).toBe(s.steps[id].maxPoints);
        for (const id of RUBRIC_STEPS) expect(s.steps[id].needsReview, `${seed} ${id}`).toBe(true);
        expect(s.points).toBe(MAX - RUBRIC_MAX);
      }
    },
    SLOW,
  );

  it("a perfect answer is 100 once the reviewer gives the replies full marks", () => {
    for (const seed of SEEDS.slice(0, 50)) {
      const s = scoreAttempt(scenario, seed, perfectAnswers(seed));
      const reviewed = s.points + RUBRIC_STEPS.reduce((t, id) => t + s.steps[id].maxPoints - s.steps[id].points, 0);
      expect(reviewed, seed).toBe(MAX);
    }
  });

  it("another seed's perfect answer doesn't score well (answers can't be shared)", () => {
    let total = 0;
    for (const seed of SEEDS.slice(1, 21)) total += autoPoints(seed, perfectAnswers(SEEDS[0]));
    expect(total / 20).toBeLessThan((MAX - RUBRIC_MAX) * 0.4);
  });

  describe("each trap answered wrongly costs exactly its points", () => {
    const seeds = SEEDS.slice(0, 40);
    const lost = (seed: string, mutate: (a: Answers & Record<string, unknown>, v: ReturnType<typeof readVendors>) => void) => {
      const a = clone(perfectAnswers(seed));
      mutate(a, readVendors(seed));
      return autoPoints(seed, perfectAnswers(seed)) - autoPoints(seed, a);
    };
    const vendorFlags = (a: Record<string, unknown>, stepId: string) => (a[stepId] as { flags: { target: string; reason: string; note: string }[] }).flags;

    for (const ind of INDICATORS) {
      it(`the ${ind} vendor not flagged: loses that screen's 5`, () => {
        for (const seed of seeds) {
          expect(
            lost(seed, (a, v) => {
              const r = v.suspicious.find((x) => x.indicators[0] === ind)!;
              (a as Record<string, unknown>)[r.stepId] = { flags: [] };
            }),
            seed,
          ).toBe(5);
        }
      });

      it(`the ${ind} vendor flagged with another sign: half the finding (2.5)`, () => {
        for (const seed of seeds) {
          expect(
            lost(seed, (a, v) => {
              const r = v.suspicious.find((x) => x.indicators[0] === ind)!;
              vendorFlags(a, r.stepId)[0].reason = "other";
            }),
            seed,
          ).toBe(2.5);
        }
      });
    }

    it("wrong total for the flagged vendor (one payment missed, or another vendor's added): loses the 5", () => {
      for (const seed of seeds) {
        const extract = extractFromEmail(seed);
        const { flagged } = readVendors(seed);
        const mine = extract.filter((p) => p.vendor === flagged.name);
        const other = extract.find((p) => p.vendor !== flagged.name)!;
        expect(lost(seed, (a) => void (a["flagged-total"].value = dollars(Math.round(a["flagged-total"].value * 100) - mine[0].amount)))).toBe(5);
        expect(lost(seed, (a) => void (a["flagged-total"].value = dollars(Math.round(a["flagged-total"].value * 100) + other.amount)))).toBe(5);
      }
    });

    it("follow-up list: each flagged vendor left off costs 1.25, each clean vendor added 0.625 (0.62 after rounding to the cent)", () => {
      for (const seed of seeds) {
        const list = screen(seed).step("vendor-list").config as Choice;
        const perfect = perfectAnswers(seed)["vendor-list"].selected;
        const clean = list.options.filter((o) => !perfect.includes(o.id));
        expect(clean.length).toBe(8);
        expect(lost(seed, (a) => void a["vendor-list"].selected.pop())).toBe(1.25);
        expect(lost(seed, (a) => void a["vendor-list"].selected.push(clean[0].id))).toBeCloseTo(0.62, 6);
        expect(lost(seed, (a) => void (a["vendor-list"].selected = list.options.map((o) => o.id)))).toBe(5);
      }
    });

    it("findings sheet: each vendor's payments 0.5, total 2, red flags 1; the grand total 1", () => {
      for (const seed of seeds.slice(0, 10)) {
        const { summary } = readSheet(seed);
        for (const s of summary) {
          const [n, t, rf] = s.ids;
          expect(lost(seed, (a) => void (a["findings-sheet"].cells[n] += 1))).toBe(0.5);
          expect(lost(seed, (a) => void (a["findings-sheet"].cells[t] += 100))).toBe(2);
          expect(lost(seed, (a) => void (a["findings-sheet"].cells[rf] += 1))).toBe(1);
        }
        expect(lost(seed, (a) => void (a["findings-sheet"].cells.t_all += 1))).toBe(1);
      }
    });

    it("counting every payment to the flagged vendor as a red flag costs that cell's 1 point", () => {
      for (const seed of seeds) {
        const sheet = readSheet(seed);
        const { flagged } = readVendors(seed);
        const row = sheet.summary.find((s) => s.vendor === flagged.name)!;
        expect(sheet.solve(flagged.name).redFlags).toBeLessThan(5);
        expect(lost(seed, (a) => void (a["findings-sheet"].cells[row.ids[2]] = 5))).toBe(1);
      }
    });
  });

  it("gives the reviewer the rubric for the three replies", () => {
    const r = scoreAttempt(scenario, "abc", perfectAnswers("abc"));
    expect(r.steps["suspect-reply"].items.map((i) => [i.id, i.max])).toEqual([
      ["scope", 2],
      ["route", 2],
      ["tone", 1],
    ]);
    expect(r.steps["board-reply"].items.map((i) => [i.id, i.max])).toEqual([
      ["findings", 2],
      ["route", 2],
      ["tone", 1],
    ]);
    expect(r.steps["findings-memo"].items.map((i) => [i.id, i.max])).toEqual([
      ["facts", 5],
      ["neutral", 4],
      ["next_steps", 4],
      ["brevity", 2],
    ]);
  });
});

describe("forensic-marlow-expenses: shell-vendor indicators", () => {
  it(
    "every indicator is planted on exactly one vendor and absent from the eight clean ones",
    () => {
      for (const seed of SEEDS) {
        const { rows, suspicious } = readVendors(seed);
        expect(suspicious.length, seed).toBe(4);
        for (const r of suspicious) expect(r.indicators.length, `${seed} ${r.name}: one sign each`).toBe(1);
        expect(suspicious.map((r) => r.indicators[0]).sort()).toEqual([...INDICATORS].sort());
        const clean = rows.filter((r) => r.indicators.length === 0);
        expect(clean.length).toBe(8);
        for (const r of clean) {
          expect(r.address).not.toMatch(/Box/i);
          expect(r.taxId).toMatch(/^\d{2}-\d{7}$/);
          expect(dayOf(r.firstPaid) - dayOf(r.created), `${seed} ${r.name}`).toBeGreaterThanOrEqual(14);
        }
      }
    },
    SLOW,
  );

  it("a clean vendor flagged costs the false-flag penalty (1), any sign", () => {
    for (const seed of SEEDS.slice(0, 40)) {
      const { rows } = readVendors(seed);
      const perfect = perfectAnswers(seed);
      for (const stepId of VENDOR_STEPS) {
        const clean = rows.filter((r) => r.stepId === stepId && r.indicators.length === 0);
        expect(clean.length).toBe(2);
        for (const reason of ["po_box", "other"]) {
          const a = clone(perfect) as unknown as Record<string, { flags: { target: string; reason: string; note: string }[] }>;
          a[stepId].flags.push({ target: clean[0].rowId, reason, note: "" });
          expect(autoPoints(seed, perfect) - autoPoints(seed, a), `${seed} ${stepId} ${reason}`).toBe(1);
        }
        const both = clone(perfect) as unknown as Record<string, { flags: { target: string; reason: string; note: string }[] }>;
        both[stepId].flags.push(...clean.map((c) => ({ target: c.rowId, reason: "other", note: "" })));
        expect(autoPoints(seed, perfect) - autoPoints(seed, both)).toBe(2);
        // With nothing earned on the screen, a false flag can't take it below 0.
        const s = scoreAttempt(scenario, seed, { [stepId]: { flags: [{ target: clean[0].rowId, reason: "other", note: "" }] } });
        expect(s.steps[stepId].points).toBe(0);
      }
    }
  });

  it("the flagged vendor's address is the suspect's home address, and the suspect is the one who emails", () => {
    for (const seed of SEEDS.slice(0, 50)) {
      const { flagged, suspect, employees } = readVendors(seed);
      expect(suspect, seed).toBeDefined();
      expect(employees.get(suspect!)).toBe(flagged.address);
      const { msg } = screen(seed);
      expect(msg("m2").body).toContain(suspect!);
      expect(msg("m4").body).toContain(suspect!.split(" ")[0]);
      expect(msg("m3").body).toContain(flagged.name);
    }
  });
});

describe("forensic-marlow-expenses: duplicate hunt", () => {
  it(
    "each duplicate differs from its twin only by the planned change: invoice-number format or one day",
    () => {
      const changes = new Map<string, number>();
      for (const seed of SEEDS) {
        for (const s of solveRapid(seed, "rapid-duplicate")) {
          changes.set(s.kind, (changes.get(s.kind) ?? 0) + 1);
          const rows = s.item.exhibit!.table!.rows;
          const [a, b] = s.pair.map((i) => rows[i]);
          const differing = [1, 2, 3, 4].filter((c) => a[c] !== b[c]);
          if (s.change === "format") {
            expect(differing, `${seed} ${s.item.id}`).toEqual([2]);
            expect(digits(a[2])).toBe(digits(b[2]));
          } else {
            expect(differing, `${seed} ${s.item.id}`).toEqual([3]);
            expect(Math.abs(dayOf(a[3]) - dayOf(b[3]))).toBe(1);
          }
        }
      }
      expect([...changes.keys()].sort()).toEqual(["day", "day-decoy", "format", "format-decoy"]);
    },
    SLOW,
  );

  it("the five 1-point items carry the recurring-charge decoy; the ten ½-point items don't", () => {
    const points = rapidConfig("rapid-duplicate").items.map((i) => i.points);
    for (const seed of SEEDS.slice(0, 50)) {
      solveRapid(seed, "rapid-duplicate").forEach((s, i) => expect(s.decoy, `${seed} item ${i}`).toBe(points[i] === 1));
    }
  });

  it("invoice-number formats vary across every table, so a format alone isn't the tell", () => {
    for (const seed of SEEDS.slice(0, 50)) {
      for (const item of rapidItems(seed, "rapid-duplicate")) {
        const shape = (inv: string) => inv.replace(/\d+/, "N");
        expect(new Set(item.exhibit!.table!.rows.map((r) => shape(r[2]))).size, `${seed} ${item.id}`).toBeGreaterThanOrEqual(2);
      }
    }
  });
});

describe("forensic-marlow-expenses: the flagged total", () => {
  it("the total in Sam's email key is the sum of the flagged vendor's payments", () => {
    for (const seed of SEEDS) {
      const { flagged } = readVendors(seed);
      const key = scenario.generate(seed).keys["flagged-total"] as { value: number; tolerance: number };
      const sum = extractFromEmail(seed)
        .filter((p) => p.vendor === flagged.name)
        .reduce((t, p) => t + p.amount, 0);
      expect(Math.round(key.value * 100), seed).toBe(sum);
      expect(key.tolerance).toBeLessThan(0.01);
      expect(screen(seed).msg("m3").body).toMatch(/number only/i);
    }
  });

  it("the findings sheet total for the flagged vendor is the same number", () => {
    for (const seed of SEEDS.slice(0, 50)) {
      const { flagged } = readVendors(seed);
      const keys = scenario.generate(seed).keys;
      const row = readSheet(seed).summary.find((s) => s.vendor === flagged.name)!;
      expect((keys["findings-sheet"] as SheetKey).cells[row.ids[1]].value).toBe((keys["flagged-total"] as { value: number }).value);
    }
  });
});

describe("forensic-marlow-expenses: nothing derived reaches the candidate", () => {
  const forms = (c: number) => {
    const d = dollars(Math.abs(c));
    return [d.toFixed(2), d.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })];
  };
  const contains = (payload: string, form: string) => new RegExp(`(?<![\\d.,])${form.replace(/[.$]/g, "\\$&")}(?![\\d.]\\d)`).test(payload);

  it(
    "no flagged total, vendor total, grand total or reviewer note in any payload",
    () => {
      for (const seed of SEEDS) {
        const variant = scenario.generate(seed);
        const sheet = (variant.keys["findings-sheet"] as SheetKey).cells;
        const totals = Object.entries(sheet)
          .filter(([id]) => id.startsWith("t_"))
          .map(([, v]) => Math.round(v.value * 100));
        const single = new Set(Object.values(variant.values).filter((x): x is number => typeof x === "number"));
        const notes = RUBRIC_STEPS.flatMap((id) => Object.values((variant.keys[id] as ReplyKey).notes));
        for (const minute of [0, 20, END]) {
          const payload = JSON.stringify(renderAttemptForCandidate(scenario, seed, minute));
          expect(payload).not.toMatch(/"keys"|tolerance|"criteria"|"guidance"|"notes"|"points"|"expected"|"findings"|"correct"/);
          for (const c of totals.filter((t) => !single.has(t))) {
            for (const f of forms(c)) expect(contains(payload, f), `${seed} m${minute}: ${f}`).toBe(false);
          }
          for (const n of notes) expect(payload).not.toContain(n);
        }
      }
    },
    SLOW,
  );

  it("no rendered rapid item holds a key value or key string (50 seeds)", () => {
    let checked = 0;
    for (const seed of SEEDS.slice(0, 50)) {
      const variant = scenario.generate(seed);
      const shown = new Set(Object.values(variant.values).filter((x): x is number => typeof x === "number"));
      for (const id of RAPID_STEPS) {
        const key = variant.keys[id] as RapidKey;
        for (const item of rapidItems(seed, id)) {
          const json = JSON.stringify(item);
          expect(json).not.toMatch(/choice"|tolerance|points|"kind":"choice"/);
          for (const k of Object.keys(item)) expect(["id", "prompt", "exhibit", "fields"]).toContain(k);
          for (const [fieldId, k] of Object.entries(key.items[item.id])) {
            if (k.choice !== undefined) {
              expect(Object.keys(k)).toEqual(["choice"]);
              expect(choiceField(item, fieldId).options.map((o) => o.id)).toContain(k.choice);
            } else {
              const c = Math.round(k.value! * 100);
              if (!shown.has(c)) for (const f of forms(c)) expect(contains(json, f), `${seed} ${item.id}: ${f}`).toBe(false);
            }
          }
          checked++;
        }
      }
    }
    expect(checked).toBe(50 * 42);
  });

  it("option ids are fixed per item, so an id can't hint at the answer", () => {
    for (const id of RAPID_STEPS) {
      const ids = (seed: string) => rapidItems(seed, id).map((i) => i.fields.map((f) => [f.id, "options" in f ? f.options.map((o) => o.id) : f.kind]));
      const first = JSON.stringify(ids(SEEDS[0]));
      for (const seed of SEEDS.slice(1, 30)) expect(JSON.stringify(ids(seed)), `${id} ${seed}`).toBe(first);
    }
  });
});

describe("forensic-marlow-expenses: rapid rounds", () => {
  it(
    "every item over 200 seeds is consistent: one right answer per field, from the material alone",
    () => {
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
              if ("options" in f) {
                expect(f.options.filter((o) => o.id === k[f.id].choice).length, `${seed} ${s.item.id}.${f.id}`).toBe(1);
                expect(k[f.id].choice, `${seed} ${s.item.id}.${f.id} (${s.kind}: ${s.item.prompt})`).toBe(s.values[f.id]);
              } else {
                expect(k[f.id].value, `${seed} ${s.item.id}`).toBe(s.values[f.id]);
              }
            }
          }
        }
      }
    },
    SLOW,
  );

  it("red flag or normal: every kind shows up, with the harder kinds worth 1", () => {
    const kinds = new Map<string, number>();
    const points = rapidConfig("rapid-redflag").items.map((i) => i.points);
    const hard = ["employee_address", "shared_bank", "near-miss-lease", "near-miss-street"];
    for (const seed of SEEDS.slice(0, 50)) {
      solveRapid(seed, "rapid-redflag").forEach((s, i) => {
        kinds.set(s.kind, (kinds.get(s.kind) ?? 0) + 1);
        expect(hard.includes(s.kind), `${seed} item ${i} ${s.kind}`).toBe(points[i] === 1);
      });
    }
    expect([...kinds.keys()].sort()).toEqual(
      ["employee_address", "near-miss-lease", "near-miss-street", "normal-expense", "normal-vendor", "sequential", "shared_bank", "under_limit", "weekend"].sort(),
    );
  });

  it("quick analytics: four of each kind, the totals in slots 3, 6, 9 and 12", () => {
    for (const seed of SEEDS.slice(0, 50)) {
      const kinds = solveRapid(seed, "rapid-analytics").map((s) => s.kind);
      expect(kinds.filter((k) => k === "month").length).toBe(4);
      expect(kinds.filter((k) => k === "split").length).toBe(4);
      kinds.forEach((k, i) => expect(k === "total", `${seed} item ${i}`).toBe(i % 3 === 2));
    }
  });

  it("round sizes and weights: 15 × 20 s, 15 × 20 s and 12 × 25 s, 10 points each", () => {
    const shape = (id: RapidStepId) => {
      const c = rapidConfig(id);
      return [c.items.length, c.secondsPerItem, c.items.reduce((t, i) => t + i.points, 0)];
    };
    expect(RAPID_STEPS.map(shape)).toEqual([
      [15, 20, 10],
      [15, 20, 10],
      [12, 25, 10],
    ]);
    for (const id of ["rapid-redflag", "rapid-duplicate"] as const) {
      const points = rapidConfig(id).items.map((i) => i.points);
      expect(points.filter((p) => p === 0.5).length).toBe(10);
      expect(points.filter((p) => p === 1).length).toBe(5);
    }
    const c = rapidConfig("rapid-analytics").items.map((i) => i.points);
    expect(c).toEqual([0.75, 0.75, 1, 0.75, 0.75, 1, 0.75, 0.75, 1, 0.75, 0.75, 1]);
  });

  it("varies per seed: which item comes when and where the right option sits", () => {
    for (const id of RAPID_STEPS) {
      const firsts = SEEDS.slice(0, 60).map((seed) => solveRapid(seed, id)[0]);
      expect(new Set(firsts.map((s) => JSON.stringify(s.item))).size, id).toBe(60);
      expect(new Set(firsts.map((s) => JSON.stringify(s.values))).size, id).toBeGreaterThanOrEqual(2);
    }
    const rows = new Set(SEEDS.slice(0, 30).flatMap((seed) => solveRapid(seed, "rapid-duplicate").map((s) => s.values.row)));
    expect(rows.size).toBe(5);
  });

  it("a wrong field costs half its item; an unanswered item scores 0 and costs all of it", () => {
    for (const seed of SEEDS.slice(0, 20)) {
      const perfect = scoreAttempt(scenario, seed, perfectAnswers(seed));
      const a = clone(perfectAnswers(seed)) as unknown as Record<string, { items: Record<string, { values: Record<string, string | number> }> }>;
      const red = solveRapid(seed, "rapid-redflag");
      const why = choiceField(red[0].item, "why");
      a["rapid-redflag"].items[red[0].item.id].values.why = why.options.find((o) => o.id !== red[0].values.why)!.id;
      delete a["rapid-redflag"].items[red[2].item.id];
      const s = scoreAttempt(scenario, seed, a);
      expect(perfect.steps["rapid-redflag"].points - s.steps["rapid-redflag"].points, seed).toBe(0.25 + 1);
      const item = s.steps["rapid-redflag"].items.find((i) => i.id === red[2].item.id)!;
      expect(item.earned).toBe(0);
      expect(item.note).toMatch(/No answer/);
    }
  });
});

describe("forensic-marlow-expenses: timed sections", () => {
  const def = scenario.definition;
  const MIN = 60_000;
  const t0 = Date.parse("2026-11-22T09:00:00Z");
  const flowAt = (ms: number, extraTimePercent = 0, events: Parameters<typeof resolveFlow>[1]["events"] = []) =>
    resolveFlow(def, { startedAt: t0, now: t0 + ms, extraTimePercent, events });
  const stepById = (id: string) => def.steps.find((s) => s.id === id)!;

  it("validateSections passes and the sections fill the time limit exactly", () => {
    expect(validateSections(def, scenario.timeLimitMinutes)).toEqual([]);
    expect(def.sections!.reduce((t, s) => t + s.minutes, 0)).toBe(scenario.timeLimitMinutes);
  });

  it("six sections: rapid A, vendor review, rapid B, inbox, rapid C, findings", () => {
    expect(def.sections!.map((s) => [s.id, s.minutes, s.stepIds, !!s.oneAtATime])).toEqual([
      ["s-rapid-a", 6, ["rapid-redflag"], false],
      ["s-vendors", 12, [...VENDOR_STEPS, "vendor-list"], true],
      ["s-rapid-b", 6, ["rapid-duplicate"], false],
      ["s-inbox", 10, ["suspect-reply", "flagged-total", "board-reply"], true],
      ["s-rapid-c", 5, ["rapid-analytics"], false],
      ["s-findings", 10, ["findings-sheet", "findings-memo"], false],
    ]);
  });

  it("one-at-a-time screens add up to their section", () => {
    for (const sec of def.sections!.filter((s) => s.oneAtATime)) {
      expect(sec.stepIds.reduce((t, id) => t + stepById(id).seconds!, 0), sec.id).toBe(sec.minutes * 60);
    }
    expect(VENDOR_STEPS.map((id) => stepById(id).seconds)).toEqual([150, 150, 150, 150]);
    expect(stepById("vendor-list").seconds).toBe(120);
    expect(["suspect-reply", "flagged-total", "board-reply"].map((id) => stepById(id).seconds)).toEqual([200, 200, 200]);
  });

  it("each rapid round fits its section", () => {
    for (const id of RAPID_STEPS) {
      const config = rapidConfig(id);
      const sec = def.sections!.find((s) => s.stepIds.includes(id))!;
      expect(config.items.length * config.secondsPerItem).toBeLessThanOrEqual(sec.minutes * 60);
    }
  });

  it("runs the sections back to back with no early finishes", () => {
    const at = (min: number) => flowAt(min * MIN);
    expect(at(0).visibleStepIds).toEqual(["rapid-redflag"]);
    expect(at(6).visibleStepIds).toEqual(["vendors-1"]);
    expect(at(6 + 2.5 * 3 + 0.1).visibleStepIds).toEqual(["vendors-4"]);
    expect(at(16).visibleStepIds).toEqual(["vendor-list"]);
    expect(at(18).visibleStepIds).toEqual(["rapid-duplicate"]);
    expect(at(24).visibleStepIds).toEqual(["suspect-reply"]);
    expect(at(24 + 200 / 60).visibleStepIds).toEqual(["flagged-total"]);
    expect(at(34).visibleStepIds).toEqual(["rapid-analytics"]);
    expect(at(39).visibleStepIds).toEqual(["findings-sheet", "findings-memo"]);
    expect(at(END).done).toBe(true);
  });

  it("extra time (25, 50, 100%) stretches sections, screens and every rapid item's limit", () => {
    for (const pct of [25, 50, 100]) {
      const f = 1 + pct / 100;
      expect(flowAt(6 * MIN * f - 1, pct).visibleStepIds, `${pct}%`).toEqual(["rapid-redflag"]);
      expect(flowAt(6 * MIN * f + 1, pct).visibleStepIds).toEqual(["vendors-1"]);
      // Past the plain 2.5-minute screen, the stretched one is still open.
      expect(flowAt((6 * f + 2.5) * MIN + 1, pct).visibleStepIds).toEqual(["vendors-1"]);
      expect(flowAt(6 * MIN * f + 150_000 * f + 1, pct).visibleStepIds).toEqual(["vendors-2"]);
      for (const id of RAPID_STEPS) {
        const config = rapidConfig(id);
        const per = rapidRoundServer.sequence!.secondsPerItem(config) * 1000;
        const base = { stepStartedAt: t0, stepEndsAt: t0 + 60 * MIN, count: config.items.length, secondsPerItem: config.secondsPerItem, answeredAt: {} };
        const plain = resolveItems({ ...base, extraTimePercent: 0, now: t0 });
        const stretched = resolveItems({ ...base, extraTimePercent: pct, now: t0 });
        expect(plain.endsAt - t0, id).toBe(per);
        expect(stretched.endsAt - t0, `${id} ${pct}%`).toBe(Math.round(per * f));
        // Past the plain limit but inside the stretched one, the first item is still open.
        expect(resolveItems({ ...base, extraTimePercent: pct, now: t0 + per + 1 }).index).toBe(0);
        expect(resolveItems({ ...base, extraTimePercent: 0, now: t0 + per + 1 }).index).toBe(1);
      }
    }
  });

  it("messages linked to a step arrive relative to their section's start", () => {
    expect(def.messages.map((m) => [m.id, m.arriveAtMinute ?? 0, m.stepId])).toEqual([
      ["m1", 0, "vendors-1"],
      ["m2", 0, "suspect-reply"],
      ["m3", 0, "flagged-total"],
      ["m4", 0, "board-reply"],
      ["m5", 0, "findings-sheet"],
      ["m6", 1, "findings-memo"],
    ]);
    const msgsAt = (min: number, events: Parameters<typeof resolveFlow>[1]["events"] = []) =>
      visibleMessageIds(def, flowAt(min * MIN, 0, events), t0, t0 + min * MIN);
    expect(msgsAt(5)).toEqual([]);
    expect(msgsAt(6)).toEqual(["m1"]);
    expect(msgsAt(24)).toEqual(["m1", "m2", "m3", "m4"]);
    expect(msgsAt(39)).toEqual(["m1", "m2", "m3", "m4", "m5"]);
    expect(msgsAt(40)).toEqual(["m1", "m2", "m3", "m4", "m5", "m6"]);
    const early = [{ kind: "advanced_section" as const, sectionId: "s-rapid-a", at: t0 + 2 * MIN }];
    expect(msgsAt(2.5, early)).toEqual(["m1"]);
  });

  it("the flow renders each rapid item exactly as sequence.renderItem does", () => {
    for (const id of RAPID_STEPS) {
      const items = rapidItems("abc", id);
      for (const index of [0, 7, items.length - 1]) {
        const view = renderFlowForCandidate(scenario, "abc", {
          stepIds: [id],
          messages: [],
          sequences: { [id]: { index, count: items.length, endsAt: "2026-11-22T09:00:20.000Z" } },
        });
        const cfg = view.steps[0].config as { itemCount: number; current: { item: RapidItem } };
        expect(cfg.itemCount).toBe(items.length);
        expect(cfg.current.item).toEqual(items[index]);
        expect(JSON.stringify(cfg)).not.toMatch(/"items"|choice"|tolerance|points/);
      }
    }
  });
});

describe("forensic-marlow-expenses: messages and copy", () => {
  it("every message delivers a task, and Sam greets the candidate by first name", () => {
    for (const m of scenario.definition.messages) expect(scenario.definition.steps.some((s) => s.id === m.stepId), m.id).toBe(true);
    const body = (name?: string | null) => renderAttemptForCandidate(scenario, "abc", END, { name }).messages.find((m) => m.id === "m1")!.body;
    expect(body("Jamie Rivera").split("\n")[0]).toBe("Hi Jamie,");
    expect(body(null).split("\n")[0]).toBe("Hi there,");
  });

  it("the board member asks for a fraud call; Sam asks for a number only and a memo with next steps", () => {
    for (const seed of SEEDS.slice(0, 20)) {
      const { msg } = screen(seed);
      expect(msg("m4").body).toMatch(/confirm it'?s fraud/i);
      expect(msg("m3").body).toMatch(/number only/i);
      expect(msg("m6").body).toMatch(/150 words/);
      expect(msg("m6").body).toMatch(/next steps/i);
    }
  });

  it("candidate-facing text has no em dashes", () => {
    for (const seed of SEEDS.slice(0, 20)) {
      const view = renderAttemptForCandidate(scenario, seed, END);
      expect(JSON.stringify(view)).not.toContain("—");
      for (const id of RAPID_STEPS) expect(JSON.stringify(rapidItems(seed, id))).not.toContain("—");
    }
  });
});
