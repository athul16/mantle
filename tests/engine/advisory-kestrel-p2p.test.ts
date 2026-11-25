import { describe, expect, it, vi } from "vitest";
import type { RapidChoiceField, RapidItem } from "@/lib/engine/step-types/rapid_round/public";

vi.mock("server-only", () => ({}));

const { advisoryKestrelP2p } = await import("@/lib/engine/scenarios/advisory-kestrel-p2p");
const { getScenario, listScenarios } = await import("@/lib/engine/scenarios");
const { renderAttemptForCandidate, renderFlowForCandidate } = await import("@/lib/engine/server/render");
const { scoreAttempt } = await import("@/lib/engine/server/score");
const { resolveFlow, resolveItems, visibleMessageIds, validateSections } = await import("@/lib/engine/server/flow");
const { rapidRoundServer } = await import("@/lib/engine/step-types/rapid_round/server");
const { fillTemplate, templateValues } = await import("@/lib/engine/server/template");

/**
 * docs/07 Example 8: Kestrel Advisory, SOX intern testing Arbor Health
 * Supply's procure-to-pay controls, in six timed sections. These tests solve
 * every task from what the candidate sees (the sample screens, the emails,
 * IT's user list, the walkthrough cards and every rapid item), then compare
 * that with the server key, so the material and the key can't drift apart.
 */

const scenario = advisoryKestrelP2p;
const SEEDS = Array.from({ length: 200 }, (_, i) => `attempt-${i.toString(16).padStart(4, "0")}`);
const END = scenario.timeLimitMinutes;
const SAMPLE_STEPS = ["test-1", "test-2", "test-3", "test-4"] as const;
const RAPID_STEPS = ["rapid-controls", "rapid-sod", "rapid-findings"] as const;
type RapidStepId = (typeof RAPID_STEPS)[number];
const MAX = 100;
/** Kestrel's testing guidance for the sample of 8: 0 or 1 exception is effective, 2 or more a deficiency. */
const THRESHOLD = 1;
const HEAVY = 60_000;

type Field = { id: string; label: string; value: string };
type Doc = {
  prompt: string;
  document: { title: string; fields: Field[]; columns: string[]; rows: { id: string; cells: string[] }[]; totals: Field[] };
  reasons: { id: string; label: string }[];
  decision?: { prompt: string; options: { id: string; label: string }[] };
  confirmClean?: { label: string };
};
type Choice = { prompt: string; options: { id: string; label: string }[]; select?: string };
type Ordering = { prompt: string; items: { id: string; label: string }[] };
type ReviewKey = { findings: Record<string, { targets: string[]; reasons: string[]; note?: string }>; decision?: string[]; clean?: boolean };
type ReplyKey = { notes: Record<string, string> };
type PoKind = "pass" | "no_approval" | "not_director" | "after_order";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "Aug 14" → a number that sorts by date (all dates are in 2026). */
const date = (s: string) => {
  const m = s.trim().match(/^([A-Z][a-z]{2}) (\d{1,2})$/);
  expect(m, `a date: "${s}"`).not.toBeNull();
  const month = MONTHS.indexOf(m![1]);
  expect(month).toBeGreaterThanOrEqual(0);
  return month * 100 + Number(m![2]);
};
const cents = (s: string) => Math.round(Number(s.replace(/[$,\s]/g, "")) * 100);
const dollars = (c: number) => c / 100;
const money = (c: number) => `$${dollars(c).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** One sample screen, read the way a tester would: each PO against P2P-02. */
function readSample(doc: Doc) {
  const col = (name: string) => {
    const i = doc.document.columns.indexOf(name);
    expect(i, `column ${name}`).toBeGreaterThanOrEqual(0);
    return i;
  };
  const [cPo, cVendor, cAmt, cReq, cOrder, cAppr, cTitle, cOn] = [
    "PO",
    "Vendor",
    "Amount",
    "Requested by",
    "Order date",
    "Approved by",
    "Approver's title",
    "Approved on",
  ].map(col);
  return doc.document.rows.map((r) => {
    const c = r.cells;
    const problems: PoKind[] = [];
    if (/^None/.test(c[cAppr])) problems.push("no_approval");
    else {
      if (!/Director/.test(c[cTitle])) problems.push("not_director");
      if (date(c[cOn]) > date(c[cOrder])) problems.push("after_order");
    }
    expect(problems.length, `PO ${c[cPo]} fails one way at most`).toBeLessThanOrEqual(1);
    return {
      id: r.id,
      po: c[cPo],
      vendor: c[cVendor],
      amount: cents(c[cAmt]),
      requester: c[cReq],
      order: c[cOrder],
      approver: c[cAppr],
      title: c[cTitle],
      approvedOn: c[cOn],
      kind: (problems[0] ?? "pass") as PoKind,
      sameDay: problems.length === 0 && c[cOn] === c[cOrder],
    };
  });
}

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
  const docs = SAMPLE_STEPS.map((id) => step(id).config as Doc);
  const screens = docs.map(readSample);
  const pos = screens.flatMap((rows, s) => rows.map((r) => ({ ...r, screen: s, stepId: SAMPLE_STEPS[s] })));
  const exceptions = pos.filter((p) => p.kind !== "pass");
  return { view, step, msg, docs, screens, pos, exceptions };
}

/** IT's user list against HR's leavers. */
function readUsers(seed: string) {
  const { step } = screen(seed);
  const doc = step("user-list").config as Doc;
  const leaversField = doc.document.fields.find((f) => f.id === "leavers");
  expect(leaversField).toBeDefined();
  const leavers = leaversField!.value.split("; ").map((s) => {
    const m = s.match(/^(.+) \(left ([A-Z][a-z]{2} \d{1,2})\)$/);
    expect(m, `leaver "${s}"`).not.toBeNull();
    return { name: m![1], left: m![2] };
  });
  const cols = doc.document.columns;
  const at = (name: string) => cols.indexOf(name);
  const users = doc.document.rows.map((r) => ({
    id: r.id,
    userId: r.cells[at("User ID")],
    name: r.cells[at("Name")],
    dept: r.cells[at("Department")],
    role: r.cells[at("ERP role")],
    status: r.cells[at("Status")],
    login: r.cells[at("Last login")],
  }));
  const stillActive = users.filter((u) => u.status === "Active" && leavers.some((l) => l.name === u.name));
  return { doc, leavers, users, stillActive };
}

// ---- Rapid rounds: rendered one item at a time, exactly as the attempt flow does ----

const rapidConfig = (stepId: RapidStepId) => rapidRoundServer.configSchema.parse(scenario.definition.steps.find((s) => s.id === stepId)!.config);

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

/** Control pass or fail: the evidence against the control it supports. One thing at most is wrong. */
function solveControl(item: RapidItem): Solved {
  const title = item.exhibit?.title ?? "";
  const issues: string[] = [];
  let kind: string;
  if (/^PO approval/.test(title)) {
    const approved = row(item, "Approved by").match(/^(.+) \(limit (\$[\d,]+\.\d\d)\)$/);
    expect(approved, `${item.id} approver and limit`).not.toBeNull();
    const amount = cents(row(item, "Amount"));
    const limit = cents(approved![2]);
    if (approved![1] === row(item, "Requested by")) issues.push("self");
    if (amount > limit) issues.push("over_limit");
    if (date(row(item, "Approved on")) > date(row(item, "Paid on"))) issues.push("after_payment");
    kind = issues[0] ?? (limit - amount <= 150_000 ? "po_near" : "po_ok");
    expect(item.prompt).toMatch(/requester.*limit.*before payment/);
  } else if (/^Vendor change/.test(title)) {
    if (row(item, "Entered by") === row(item, "Approved by")) issues.push("self");
    if (date(row(item, "Approved on")) > date(row(item, "First payment to the new account"))) issues.push("after_payment");
    kind = issues[0] ? `vendor_${issues[0]}` : "vendor_ok";
    expect(item.prompt).toMatch(/second person before the next payment/);
  } else {
    expect(title).toMatch(/^Bank rec sign-off/);
    const reviewer = row(item, "Reviewed by");
    if (/^Not signed/.test(reviewer)) issues.push("signoff");
    else {
      if (reviewer === row(item, "Prepared by")) issues.push("self");
      if (date(row(item, "Reviewed on")) > date(row(item, "Review due"))) issues.push("signoff");
    }
    const late = issues[0] === "signoff" && !/^Not signed/.test(reviewer);
    kind = issues[0] ? (late ? "rec_late" : `rec_${issues[0]}`) : row(item, "Reviewed on") === row(item, "Review due") ? "rec_near" : "rec_ok";
    expect(item.prompt).toMatch(/someone other than the preparer by the review due date/);
  }
  expect(issues.length, `${item.id}: one problem at most (${issues})`).toBeLessThanOrEqual(1);
  if (/^PO/.test(title) && issues[0]) kind = `po_${issues[0]}`;
  const reasonLabel: Record<string, RegExp> = {
    none: /^No issue/,
    self: /^Approver is the requester/,
    after_payment: /^Approved after payment/,
    over_limit: /^Over the approval limit/,
    signoff: /^Sign-off missing or late/,
  };
  return {
    kind,
    values: {
      result: optionId(item, "result", issues.length ? "Deficiency" : "Effective"),
      reason: optionId(item, "reason", reasonLabel[issues[0] ?? "none"]),
    },
  };
}

/** The three segregation of duties rules: both roles of a pair make a conflict; one alone never does. */
const SOD_RULES: [pair: string, label: RegExp, roles: [string, string]][] = [
  ["vendor_pay", /^Create vendor \+ approve payment$/, ["Create and edit vendors", "Approve payments"]],
  ["je", /^Post JE \+ approve JE$/, ["Post journal entries", "Approve journal entries"]],
  ["receive_invoice", /^Receive goods \+ approve invoice$/, ["Receive goods", "Approve vendor invoices"]],
];
const SENSITIVE = new Set(SOD_RULES.flatMap((r) => r[2]));

function solveSod(item: RapidItem): Solved & { roles: string[]; fired: string[]; singles: string[] } {
  const table = item.exhibit?.table;
  expect(table?.columns).toEqual(["Role", "What it allows"]);
  const roles = table!.rows.map((r) => r[1]);
  expect(roles.length).toBe(4);
  expect(new Set(roles).size, `${item.id} four different roles`).toBe(4);
  const fired = SOD_RULES.filter(([, , [a, b]]) => roles.includes(a) && roles.includes(b)).map((r) => r[0]);
  expect(fired.length, `${item.id} at most one conflict`).toBeLessThanOrEqual(1);
  const singles = roles.filter((r) => SENSITIVE.has(r) && !SOD_RULES.some(([p, , pair]) => fired.includes(p) && pair.includes(r)));
  const sensitive = roles.filter((r) => SENSITIVE.has(r)).length;
  const kind = fired.length ? (singles.length ? `${fired[0]}_plus` : fired[0]) : sensitive === 0 ? "none_harmless" : sensitive === 1 ? "none_single" : "none_three";
  if (kind === "none_three") expect(sensitive).toBe(3);
  const label = fired.length ? SOD_RULES.find((r) => r[0] === fired[0])![1] : /^No conflict$/;
  return { kind, roles, fired, singles, values: { conflict: optionId(item, "conflict", label) } };
}

/** Design or operating? Each finding read from its wording. */
const FD_RULES: [kind: string, re: RegExp, answer: "design" | "operating" | "none", tier: "easy" | "hard"][] = [
  ["route", /^The control matrix says POs over \$10,000 need a director's approval, but the ERP only sends POs over \$[\d,]+\.\d\d to a director\.$/, "design", "easy"],
  ["no-bank-control", /in AP updates vendor bank details on request, and nobody reviews the change\. There's no control for it in the matrix\.$/, "design", "easy"],
  ["access", /^The ERP lets .+ in AP both create vendors and approve payments, and no control looks at what that access is used for\.$/, "design", "easy"],
  ["signature", /^The bank rec review procedure only asks the reviewer to check that .+ signed the rec, not to look at the reconciling items\.$/, "design", "easy"],
  ["late-po", /^\d of 25 POs over \$10,000 tested by .+ were approved by a director after the order date\.$/, "operating", "easy"],
  ["late-rec", /^The \w+ bank rec was signed off \d+ days after the review due date\.$/, "operating", "easy"],
  ["leaver-active", /left on [A-Z][a-z]{2} \d+ and the ERP account was still active \d+ days later\. The policy says access is removed within 1 business day\.$/, "operating", "easy"],
  ["run-unapproved", /^The payment run on [A-Z][a-z]{2} \d+ was released without the controller's approval, which the procedure requires for every run\.$/, "operating", "easy"],
  ["small-po", /^A PO for \$[\d,]+\.\d\d, under \$10,000, was approved by .+, a purchasing manager, not a director\.$/, "none", "easy"],
  ["all-pass", /^All \d+ POs over \$10,000 tested by .+ were approved by a director on or before the order date\.$/, "none", "easy"],
  ["early-rec", /reviewed and signed off the \w+ bank rec \d days before the review due date\.$/, "none", "easy"],
  ["leaver-removed", /left on [A-Z][a-z]{2} \d+, and IT disabled the ERP account the same day\.$/, "none", "easy"],
  ["spreadsheet-list", /^The user access review checks a list of users that .+ in IT keeps in a spreadsheet, not a report from the ERP\. Nobody checks the list is complete\.$/, "design", "hard"],
  ["tolerance", /^The three-way match lets an invoice through without review if it's within \d+% of the PO price\.$/, "design", "hard"],
  ["follow-up", /signed the \w+ bank rec, but a \$[\d,]+\.\d\d reconciling item over 90 days old wasn't followed up, as the review procedure requires\.$/, "operating", "hard"],
  ["self-bank", /^A change to .+'s bank details was entered and approved by .+\. The procedure requires a second person\.$/, "operating", "hard"],
  ["cfo", /^The controller was on leave, so .+, the CFO, approved the payment run on [A-Z][a-z]{2} \d+, as the delegation of authority allows\.$/, "none", "hard"],
  ["same-day", /, a director, approved PO \d+ for \$[\d,]+\.\d\d on [A-Z][a-z]{2} \d+, the same morning it was sent to the vendor\.$/, "none", "hard"],
];
const FD_LABEL = { design: /^Design deficiency$/, operating: /^Operating deficiency$/, none: /^Not a deficiency$/ };

function solveFinding(item: RapidItem): Solved {
  const rules = FD_RULES.filter(([, re]) => re.test(item.prompt));
  expect(rules.length, `${item.id}: one rule for "${item.prompt}"`).toBe(1);
  const [kind, , answer] = rules[0];
  return { kind, values: { kind: optionId(item, "kind", FD_LABEL[answer]) } };
}

const SOLVERS: Record<RapidStepId, (item: RapidItem) => Solved> = {
  "rapid-controls": solveControl,
  "rapid-sod": solveSod,
  "rapid-findings": solveFinding,
};
const solveRapid = (seed: string, stepId: RapidStepId) => rapidItems(seed, stepId).map((item) => ({ item, ...SOLVERS[stepId](item) }));

function rapidAnswers(seed: string) {
  return Object.fromEntries(
    RAPID_STEPS.map((id) => [id, { items: Object.fromEntries(solveRapid(seed, id).map((s) => [s.item.id, { values: s.values, ms: 6_000 }])) }]),
  ) as Record<RapidStepId, { items: Record<string, { values: Record<string, string>; ms: number }> }>;
}

/** The P2P process from Jordan's walkthrough, first to last, read from each card's wording. */
const WALK_RULES: RegExp[] = [
  /raises a purchase requisition$/,
  /^Purchasing turns the requisition into a PO in the ERP$/,
  /^Key control P2P-02: a director approves the PO in the ERP \(POs over \$10,000\)$/,
  /^The PO is sent to the vendor and the order is placed$/,
  /^The warehouse receives the goods and records the receipt in the ERP$/,
  /^AP enters the vendor's invoice$/,
  /^Key control P2P-03: the ERP matches the PO, receipt and invoice$/,
  /^AP builds the weekly payment run$/,
  /^Key control P2P-04: .+, the controller, approves the payment run$/,
  /^The bank releases the payments to vendors$/,
];

function solveWalkthrough(seed: string) {
  const cfg = screen(seed).step("walkthrough").config as Ordering;
  expect(cfg.items.length).toBe(WALK_RULES.length);
  return WALK_RULES.map((re) => {
    const hits = cfg.items.filter((i) => re.test(i.label));
    expect(hits.length, `${seed}: one card like ${re}`).toBe(1);
    return hits[0].id;
  });
}

/** A strong candidate's answers, built only from the screen. */
function perfectAnswers(seed: string) {
  const { screens, exceptions } = screen(seed);
  const users = readUsers(seed);
  const sampleAnswers = Object.fromEntries(
    screens.map((rows, s) => {
      const bad = rows.find((r) => r.kind !== "pass");
      if (!bad) return [SAMPLE_STEPS[s], { flags: [] as { target: string; reason: string; note: string }[], decision: null, clean: true }];
      return [SAMPLE_STEPS[s], { flags: [{ target: bad.id, reason: bad.kind, note: "" }], decision: null, clean: false }];
    }),
  );
  return {
    ...rapidAnswers(seed),
    ...sampleAnswers,
    conclusion: { selected: [exceptions.length <= THRESHOLD ? "effective" : "deficiency"] },
    verbal: { selected: ["exception"] },
    "exception-count": { value: exceptions.length },
    "exception-value": { value: dollars(exceptions.reduce((t, p) => t + p.amount, 0)) },
    "user-list": { flags: [{ target: users.stillActive[0].id, reason: "terminated", note: "" }], decision: "disable" },
    walkthrough: { order: solveWalkthrough(seed) },
    writeup: { body: "Condition: a leaver is still active in the ERP. Criteria: ITGC-03. Risk: unauthorized approvals. Recommendation: disable it now." },
  };
}

type Answers = ReturnType<typeof perfectAnswers>;
const clone = (a: Answers): Answers & Record<string, unknown> => JSON.parse(JSON.stringify(a));
const AUTO_STEPS = [...RAPID_STEPS, ...SAMPLE_STEPS, "conclusion", "verbal", "exception-count", "exception-value", "user-list", "walkthrough"] as const;

describe("advisory-kestrel-p2p: setup", () => {
  it("is registered, version 1, accounting, about 50 minutes, and uses only built step types in section order", () => {
    expect(getScenario("advisory-kestrel-p2p", 1)).toBe(scenario);
    expect(listScenarios()).toContain(scenario);
    expect(scenario.version).toBe(1);
    expect(scenario.timeLimitMinutes).toBe(52);
    expect(scenario.roleFamily).toBe("accounting");
    expect(scenario.definition.steps.map((s) => [s.id, s.type])).toEqual([
      ["rapid-controls", "rapid_round"],
      ["test-1", "document_review"],
      ["test-2", "document_review"],
      ["test-3", "document_review"],
      ["test-4", "document_review"],
      ["conclusion", "multiple_choice"],
      ["rapid-sod", "rapid_round"],
      ["verbal", "multiple_choice"],
      ["exception-count", "numeric"],
      ["exception-value", "numeric"],
      ["user-list", "document_review"],
      ["rapid-findings", "rapid_round"],
      ["walkthrough", "ordering"],
      ["writeup", "inbox_reply"],
    ]);
    expect(scenario.definition.intro).toMatch(/Kestrel Advisory/);
    expect(scenario.definition.intro).toMatch(/Arbor Health Supply/);
    expect(scenario.definition.intro).toMatch(/Jordan/);
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
    HEAVY,
  );

  it("candidate-facing copy has no em dashes", () => {
    for (const seed of SEEDS.slice(0, 20)) {
      expect(JSON.stringify(renderAttemptForCandidate(scenario, seed, END))).not.toMatch(/—/);
      for (const id of RAPID_STEPS) expect(JSON.stringify(rapidItems(seed, id))).not.toMatch(/—/);
    }
  });

  it("is deterministic per seed", () => {
    for (const seed of SEEDS.slice(0, 20)) {
      expect(scenario.generate(seed)).toEqual(scenario.generate(seed));
      expect(renderAttemptForCandidate(scenario, seed, END)).toEqual(renderAttemptForCandidate(scenario, seed, END));
    }
  });

  it("different seeds change every amount, name, PO number and date, and where the exceptions sit", () => {
    expect(new Set(SEEDS.map((s) => JSON.stringify(scenario.generate(s).values))).size).toBe(SEEDS.length);
    const screens = SEEDS.slice(0, 60).map(screen);
    const first = screens.map((s) => s.pos[0]);
    expect(new Set(first.map((p) => p.amount)).size).toBeGreaterThan(55);
    expect(new Set(first.map((p) => p.po)).size).toBeGreaterThan(55);
    expect(new Set(first.map((p) => p.vendor)).size).toBeGreaterThan(5);
    expect(new Set(first.map((p) => p.requester)).size).toBeGreaterThan(10);
    expect(new Set(first.map((p) => p.order)).size).toBeGreaterThan(20);
    const verbalAt = screens.map((s) => s.pos.findIndex((p) => p.kind === "no_approval"));
    expect(new Set(verbalAt).size).toBe(8);
    expect(new Set(screens.map((s) => s.exceptions.length))).toEqual(new Set([1, 2, 3]));
    const users = SEEDS.slice(0, 60).map(readUsers);
    expect(new Set(users.map((u) => u.stillActive[0].name)).size).toBeGreaterThan(20);
    expect(new Set(users.map((u) => u.stillActive[0].id)).size).toBe(8);
    expect(new Set(SEEDS.slice(0, 60).map((s) => solveWalkthrough(s).join())).size).toBe(60);
  });
});

describe("advisory-kestrel-p2p: every variant is internally consistent", () => {
  it(
    "the sample is 8 different POs over $10,000, each from its own vendor, with one exception per screen at most",
    () => {
      for (const seed of SEEDS) {
        const { screens, pos } = screen(seed);
        expect(pos.length, seed).toBe(8);
        expect(new Set(pos.map((p) => p.po)).size).toBe(8);
        expect(new Set(pos.map((p) => p.vendor)).size).toBe(8);
        for (const p of pos) {
          expect(p.amount, `${seed} PO ${p.po}`).toBeGreaterThan(1_000_000);
          expect(p.approver).not.toBe(p.requester);
        }
        for (const rows of screens) {
          expect(rows.length).toBe(2);
          expect(rows.filter((r) => r.kind !== "pass").length, seed).toBeLessThanOrEqual(1);
        }
      }
    },
    HEAVY,
  );

  it(
    "plants the PO with no approval on every seed, plus 0 to 2 manager or late approvals; every kind shows up",
    () => {
      const kinds = new Set<string>();
      let sameDay = 0;
      for (const seed of SEEDS) {
        const { exceptions, pos } = screen(seed);
        expect(exceptions.filter((p) => p.kind === "no_approval").length, seed).toBe(1);
        expect(exceptions.length).toBeGreaterThanOrEqual(1);
        expect(exceptions.length).toBeLessThanOrEqual(3);
        for (const p of exceptions) kinds.add(p.kind);
        sameDay += pos.filter((p) => p.sameDay).length;
      }
      expect([...kinds].sort()).toEqual(["after_order", "no_approval", "not_director"]);
      // The near miss: some passing POs were approved on the order date itself.
      expect(sameDay).toBeGreaterThan(20);
    },
    HEAVY,
  );

  it(
    "the sample keys agree with the screens: the failing PO with its reason, or \"Both POs pass\"",
    () => {
      for (const seed of SEEDS) {
        const { screens, docs } = screen(seed);
        const keys = scenario.generate(seed).keys;
        screens.forEach((rows, s) => {
          const k = keys[SAMPLE_STEPS[s]] as ReviewKey;
          const bad = rows.find((r) => r.kind !== "pass");
          if (!bad) {
            expect(k.clean, `${seed} screen ${s + 1}`).toBe(true);
            expect(k.findings).toEqual({});
            return;
          }
          expect(k.clean, `${seed} screen ${s + 1}`).not.toBe(true);
          expect(k.findings.exception.targets).toEqual([bad.id]);
          expect(k.findings.exception.reasons).toEqual([bad.kind]);
        });
        // Every screen looks the same apart from its POs, so nothing gives the answer away.
        const shape = (d: Doc) => JSON.stringify([d.prompt, d.reasons, d.decision, d.confirmClean, d.document.columns, d.document.fields]);
        expect(new Set(docs.map(shape)).size, seed).toBe(1);
        expect(docs[0].confirmClean).toEqual({ label: "Both POs pass" });
      }
    },
    HEAVY,
  );

  it("the testing guidance gives the threshold in Jordan's email and on the conclusion screen", () => {
    const { msg, step } = screen("abc");
    expect(msg("m1").body).toMatch(/0 or 1 exception, the control is effective\. 2 or more, it's a deficiency/);
    expect(msg("m1").body).toMatch(/on or before the order date/);
    expect((step("conclusion").config as Choice).prompt).toMatch(/0 or 1 exception[\s\S]*effective[\s\S]*2 or more[\s\S]*deficiency/);
  });

  it(
    "the exception count and value are the sample's exceptions, the verbal one included",
    () => {
      for (const seed of SEEDS) {
        const { exceptions } = screen(seed);
        const keys = scenario.generate(seed).keys;
        expect((keys["exception-count"] as { value: number }).value, seed).toBe(exceptions.length);
        const value = (keys["exception-value"] as { value: number }).value;
        expect(Math.round(value * 100)).toBe(exceptions.reduce((t, p) => t + p.amount, 0));
      }
    },
    HEAVY,
  );

  it("Jordan's exceptions email lists all 8 POs with vendor and amount, but not which failed", () => {
    for (const seed of SEEDS.slice(0, 50)) {
      const { msg, pos } = screen(seed);
      const body = msg("m3").body;
      for (const p of pos) expect(body, seed).toContain(`PO ${p.po} · ${p.vendor} · ${money(p.amount)}`);
      expect(body).not.toMatch(/exception:|None recorded|Director/);
    }
  });

  it("the control owner's email is about the sampled PO with no approval on record", () => {
    for (const seed of SEEDS.slice(0, 50)) {
      const { msg, pos, step } = screen(seed);
      const verbal = pos.find((p) => p.kind === "no_approval")!;
      const m2 = msg("m2");
      expect(m2.subject).toContain(verbal.po);
      expect(m2.body).toContain(money(verbal.amount));
      expect(m2.body).toMatch(/That approval was verbal, can you pass it\?/);
      expect((step("verbal").config as Choice).prompt).toContain(verbal.po);
    }
  });

  it(
    "the walkthrough is shown out of order, and the key is the P2P process with each key control in its place",
    () => {
      for (const seed of SEEDS) {
        const cfg = screen(seed).step("walkthrough").config as Ordering;
        const order = solveWalkthrough(seed);
        expect((scenario.generate(seed).keys.walkthrough as { order: string[] }).order, seed).toEqual(order);
        expect(order).not.toEqual(cfg.items.map((i) => i.id));
        const controls = order.map((id, i) => [i, cfg.items.find((x) => x.id === id)!.label] as const).filter(([, l]) => /^Key control/.test(l));
        expect(controls.map(([i]) => i)).toEqual([2, 6, 8]);
      }
    },
    HEAVY,
  );

  it("gives the reviewer this variant's facts for the write-up", () => {
    for (const seed of SEEDS.slice(0, 50)) {
      const { stillActive, leavers } = readUsers(seed);
      const notes = (scenario.generate(seed).keys.writeup as ReplyKey).notes;
      const term = stillActive[0];
      expect(notes.condition).toContain(term.name);
      expect(notes.condition).toContain(term.userId);
      expect(notes.condition).toContain(leavers.find((l) => l.name === term.name)!.left);
      expect(notes.recommendation).toContain(term.userId);
    }
  });
});

describe("advisory-kestrel-p2p: the sample's exceptions against the threshold give the conclusion", () => {
  it(
    "for every seed: 0 or 1 exception is effective, 2 or more is a deficiency, and both outcomes occur",
    () => {
      const outcomes = new Map<string, number>();
      for (const seed of SEEDS) {
        const { exceptions, step } = screen(seed);
        const cfg = step("conclusion").config as Choice;
        const expected = exceptions.length <= THRESHOLD ? /^Effective$/ : /^Deficiency$/;
        const right = cfg.options.filter((o) => expected.test(o.label)).map((o) => o.id);
        expect(right.length).toBe(1);
        expect((scenario.generate(seed).keys.conclusion as { correct: string[] }).correct, `${seed}: ${exceptions.length} exceptions`).toEqual(right);
        outcomes.set(right[0], (outcomes.get(right[0]) ?? 0) + 1);
      }
      expect(outcomes.get("effective")).toBeGreaterThan(40);
      expect(outcomes.get("deficiency")).toBeGreaterThan(80);
    },
    HEAVY,
  );

  it("the conclusion screen is the same for every candidate", () => {
    const shapes = new Set(SEEDS.slice(0, 30).map((s) => JSON.stringify(screen(s).step("conclusion"))));
    expect(shapes.size).toBe(1);
  });
});

describe("advisory-kestrel-p2p: segregation of duties rules", () => {
  it(
    "each rule fires on its conflicting role pair, and never on a single role (200 seeds)",
    () => {
      const firedOn = new Map<string, number>();
      const singleRole = new Map<string, number>();
      for (const seed of SEEDS) {
        const key = (scenario.generate(seed).keys["rapid-sod"] as RapidKey).items;
        for (const item of rapidItems(seed, "rapid-sod")) {
          const sod = { item, ...solveSod(item) };
          const answer = key[sod.item.id].conflict.choice!;
          for (const [pair, label, [a, b]] of SOD_RULES) {
            const id = optionId(sod.item, "conflict", label);
            const both = sod.roles.includes(a) && sod.roles.includes(b);
            if (both) {
              expect(answer, `${seed} ${sod.item.id} holds both ${a} and ${b}`).toBe(id);
              firedOn.set(pair, (firedOn.get(pair) ?? 0) + 1);
            } else expect(answer, `${seed} ${sod.item.id}: ${pair} fired without both roles`).not.toBe(id);
            for (const r of [a, b]) {
              if (sod.roles.includes(r) && !both) singleRole.set(r, (singleRole.get(r) ?? 0) + 1);
            }
          }
          if (!sod.fired.length) expect(answer).toBe(optionId(sod.item, "conflict", /^No conflict$/));
        }
      }
      expect([...firedOn.keys()].sort()).toEqual(["je", "receive_invoice", "vendor_pay"]);
      // Every sensitive role shows up alone, without its partner, and never triggers its rule.
      expect([...singleRole.keys()].sort()).toEqual([...SENSITIVE].sort());
      for (const n of singleRole.values()) expect(n).toBeGreaterThan(20);
    },
    HEAVY,
  );

  it("each round has every kind: the three pairs, a pair plus another role, harmless roles, one role, one of each pair", () => {
    const kinds = new Set<string>();
    for (const seed of SEEDS.slice(0, 30)) for (const s of solveRapid(seed, "rapid-sod")) kinds.add(s.kind);
    expect([...kinds].sort()).toEqual(
      ["je", "je_plus", "none_harmless", "none_single", "none_three", "receive_invoice", "receive_invoice_plus", "vendor_pay", "vendor_pay_plus"].sort(),
    );
  });
});

describe("advisory-kestrel-p2p: the leaver still active in the ERP", () => {
  it(
    "is always on IT's list, active, logged in after leaving, and always the one exception (200 seeds)",
    () => {
      for (const seed of SEEDS) {
        const { users, leavers, stillActive, doc } = readUsers(seed);
        expect(users.length).toBe(8);
        expect(leavers.length).toBe(2);
        expect(stillActive.length, seed).toBe(1);
        const term = stillActive[0];
        const left = leavers.find((l) => l.name === term.name)!.left;
        expect(date(term.login), `${seed} logged in after leaving`).toBeGreaterThan(date(left));
        const k = scenario.generate(seed).keys["user-list"] as ReviewKey;
        expect(Object.keys(k.findings)).toEqual(["terminated"]);
        expect(k.findings.terminated.targets).toEqual([term.id]);
        expect(k.findings.terminated.reasons).toEqual(["terminated"]);
        expect(k.decision).toEqual(["disable"]);
        // The other leaver was removed; someone else on the list shares their last name.
        const gone = leavers.find((l) => l.name !== term.name)!;
        expect(users.some((u) => u.name === gone.name)).toBe(false);
        const lookalike = users.filter((u) => u.name.split(" ")[1] === gone.name.split(" ")[1]);
        expect(lookalike.length, seed).toBe(1);
        expect(lookalike[0].userId).not.toBe(gone.name[0].toLowerCase() + gone.name.split(" ")[1].toLowerCase());
        expect(new Set(users.map((u) => u.userId)).size).toBe(8);
        expect(users.every((u) => u.status === "Active")).toBe(true);
        expect(doc.decision?.options.length).toBe(4);
      }
    },
    HEAVY,
  );

  it("Jordan's write-up email gives the same leaver's facts", () => {
    for (const seed of SEEDS.slice(0, 50)) {
      const { stillActive, leavers } = readUsers(seed);
      const body = screen(seed).msg("m6").body;
      const term = stillActive[0];
      expect(body).toContain(term.name);
      expect(body).toContain(term.userId);
      expect(body).toContain(leavers.find((l) => l.name === term.name)!.left);
      expect(body).toContain(term.login);
      expect(body).toMatch(/under 150 words/);
    }
  });
});

describe("advisory-kestrel-p2p: scoring", () => {
  it("out of 100: three rapid rounds 10 each, sample test 25, inbox 15, walkthrough and write-up 30", () => {
    const blank = scoreAttempt(scenario, "abc", {});
    expect(blank.points).toBe(0);
    expect(blank.maxPoints).toBe(MAX);
    const max = (id: string) => blank.steps[id].maxPoints;
    expect(RAPID_STEPS.map(max)).toEqual([10, 10, 10]);
    expect(SAMPLE_STEPS.map(max)).toEqual([5, 5, 5, 5]);
    expect(max("conclusion")).toBe(5);
    expect([max("verbal"), max("exception-count"), max("exception-value"), max("user-list")]).toEqual([5, 2, 2, 6]);
    expect([max("walkthrough"), max("writeup")]).toEqual([15, 15]);
    const sections = scenario.definition.sections!.map((s) => s.stepIds.reduce((t, id) => t + max(id), 0));
    expect(sections).toEqual([10, 25, 10, 15, 10, 30]);
    expect(sections.reduce((t, x) => t + x, 0)).toBe(MAX);
  });

  it("blank scores 0 for every seed, with nothing sent to review", () => {
    for (const seed of SEEDS.slice(0, 50)) {
      const s = scoreAttempt(scenario, seed, {});
      expect(s.points).toBe(0);
      expect(s.steps.writeup.needsReview).toBeFalsy();
    }
  });

  it(
    "a perfect answer earns every automatic point and the write-up goes to review",
    () => {
      for (const seed of SEEDS) {
        const s = scoreAttempt(scenario, seed, perfectAnswers(seed));
        for (const id of AUTO_STEPS) expect(s.steps[id].points, `${seed} ${id}`).toBe(s.steps[id].maxPoints);
        expect(s.steps.writeup.needsReview, seed).toBe(true);
        expect(s.points).toBe(MAX - 15);
      }
    },
    HEAVY,
  );

  it("a perfect answer is 100 once the reviewer gives the write-up full marks", () => {
    for (const seed of SEEDS.slice(0, 50)) {
      const s = scoreAttempt(scenario, seed, perfectAnswers(seed));
      expect(s.points + s.steps.writeup.maxPoints - s.steps.writeup.points, seed).toBe(MAX);
    }
  });

  it("another seed's perfect answer doesn't score well (answers can't be shared)", () => {
    let shared = 0;
    for (let i = 0; i < 20; i++) shared += scoreAttempt(scenario, SEEDS[i + 1], perfectAnswers(SEEDS[i])).points;
    // The verbal reply (5) and the user list decision (2) are the same for everyone; the rest moves per seed.
    expect(shared / 20).toBeLessThan(45);
  });

  describe("each trap answered wrongly costs exactly its points", () => {
    const seeds = SEEDS.slice(0, 40);
    const lost = (seed: string, mutate: (a: Answers & Record<string, unknown>, sc: ReturnType<typeof screen>) => void) => {
      const a = clone(perfectAnswers(seed));
      mutate(a, screen(seed));
      return scoreAttempt(scenario, seed, perfectAnswers(seed)).points - scoreAttempt(scenario, seed, a).points;
    };
    const passScreen = (stepId: string) => (a: Record<string, unknown>) => {
      a[stepId] = { flags: [], decision: null, clean: true };
    };

    it("the verbal PO passed (\"Both POs pass\" on its screen): loses that screen's 5", () => {
      for (const seed of seeds) expect(lost(seed, (a, sc) => passScreen(sc.pos.find((p) => p.kind === "no_approval")!.stepId)(a)), seed).toBe(5);
    });

    it("a manager's approval or a late approval passed: loses 5", () => {
      let checked = 0;
      for (const seed of SEEDS) {
        const sc = screen(seed);
        for (const p of sc.exceptions.filter((x) => x.kind !== "no_approval")) {
          expect(lost(seed, (a) => passScreen(p.stepId)(a)), `${seed} ${p.kind}`).toBe(5);
          checked++;
        }
        if (checked > 30) break;
      }
      expect(checked).toBeGreaterThan(30);
    });

    it("the failing PO spotted with the wrong reason: half the screen (2.5)", () => {
      for (const seed of seeds) {
        expect(
          lost(seed, (a, sc) => {
            const p = sc.exceptions[0];
            a[p.stepId] = { flags: [{ target: p.id, reason: "other", note: "" }], decision: null, clean: false };
          }),
        ).toBe(2.5);
      }
    });

    it("a passing PO flagged on a clean screen (e.g. the same-day approval as late): loses 5, never below 0", () => {
      let checked = 0;
      for (const seed of seeds) {
        const sc = screen(seed);
        const clean = sc.screens.findIndex((rows) => rows.every((r) => r.kind === "pass"));
        if (clean < 0) continue;
        const target = sc.screens[clean].find((r) => r.sameDay) ?? sc.screens[clean][0];
        expect(
          lost(seed, (a) => {
            a[SAMPLE_STEPS[clean]] = { flags: [{ target: target.id, reason: "after_order", note: "" }], decision: null, clean: false };
          }),
        ).toBe(5);
        checked++;
      }
      expect(checked).toBeGreaterThan(20);
    });

    it("the passing PO flagged as well on a screen with an exception: costs the 2-point false flag", () => {
      for (const seed of seeds) {
        expect(
          lost(seed, (a, sc) => {
            const p = sc.exceptions[0];
            const other = sc.screens[p.screen].find((r) => r.id !== p.id)!;
            a[p.stepId] = {
              flags: [
                { target: p.id, reason: p.kind, note: "" },
                { target: other.id, reason: "not_director", note: "" },
              ],
              decision: null,
              clean: false,
            };
          }),
        ).toBe(2);
      }
    });

    it("the wrong conclusion: loses 5", () => {
      for (const seed of seeds) {
        expect(
          lost(seed, (a) => {
            a.conclusion = { selected: [a.conclusion.selected[0] === "effective" ? "deficiency" : "effective"] };
          }),
        ).toBe(5);
      }
    });

    for (const wrong of ["pass", "sign_now", "replace"]) {
      it(`verbal approval answered "${wrong}": loses 5`, () => {
        for (const seed of seeds.slice(0, 10)) {
          expect(
            lost(seed, (a) => {
              a.verbal = { selected: [wrong] };
            }),
          ).toBe(5);
        }
      });
    }

    it("the verbal PO left out of the count and the value: loses 4", () => {
      for (const seed of seeds) {
        expect(
          lost(seed, (a, sc) => {
            const verbal = sc.pos.find((p) => p.kind === "no_approval")!;
            a["exception-count"].value -= 1;
            a["exception-value"].value = dollars(Math.round(a["exception-value"].value * 100) - verbal.amount);
          }),
        ).toBe(4);
      }
    });

    it("the leaver missed: loses the 4-point flag; a wrong request loses the 2 decision points", () => {
      for (const seed of seeds) {
        expect(
          lost(seed, (a) => {
            a["user-list"].flags = [];
          }),
        ).toBe(4);
        for (const d of ["hr_confirm", "next_review", "resend"]) {
          expect(
            lost(seed, (a) => {
              a["user-list"].decision = d;
            }),
          ).toBe(2);
        }
      }
    });

    it("flagging the active user who shares the other leaver's last name: costs 1", () => {
      for (const seed of seeds) {
        const { users, leavers, stillActive } = readUsers(seed);
        const gone = leavers.find((l) => l.name !== stillActive[0].name)!;
        const lookalike = users.find((u) => u.name.split(" ")[1] === gone.name.split(" ")[1])!;
        expect(
          lost(seed, (a) => {
            a["user-list"].flags.push({ target: lookalike.id, reason: "terminated", note: "" });
          }),
        ).toBe(1);
      }
    });

    it("the walkthrough with two neighbours swapped keeps most of the 15; the reverse order earns almost nothing", () => {
      const seed = "abc";
      const right = solveWalkthrough(seed);
      const swapped = [...right];
      [swapped[2], swapped[3]] = [swapped[3], swapped[2]];
      const pts = (order: string[]) => scoreAttempt(scenario, seed, { walkthrough: { order } }).steps.walkthrough.points;
      expect(pts(right)).toBe(15);
      expect(pts(swapped)).toBeCloseTo(15 - 1 - 10 / 45, 1);
      expect(pts([...right].reverse())).toBeLessThan(1);
    });
  });

  it("gives the reviewer the write-up rubric", () => {
    const r = scoreAttempt(scenario, "abc", perfectAnswers("abc"));
    expect(r.steps.writeup.items.map((i) => [i.id, i.max])).toEqual([
      ["condition", 4],
      ["criteria", 3],
      ["risk", 3],
      ["recommendation", 3],
      ["brevity", 2],
    ]);
  });
});

describe("advisory-kestrel-p2p: nothing derived reaches the candidate", () => {
  const forms = (c: number) => {
    const d = dollars(Math.abs(c));
    return [d.toFixed(2), d.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })];
  };
  const contains = (payload: string, form: string) => new RegExp(`(?<![\\d.,])${form.replace(/[.$]/g, "\\$&")}(?![\\d.]\\d)`).test(payload);

  it(
    "no exception value, key note or reviewer note in any payload",
    () => {
      for (const seed of SEEDS) {
        const variant = scenario.generate(seed);
        const { exceptions } = screen(seed);
        const value = exceptions.reduce((t, p) => t + p.amount, 0);
        const notes = [
          ...Object.values((variant.keys.writeup as ReplyKey).notes),
          ...SAMPLE_STEPS.flatMap((id) => Object.values((variant.keys[id] as ReviewKey).findings).map((f) => f.note!)),
          (variant.keys["user-list"] as ReviewKey).findings.terminated.note!,
        ];
        for (const minute of [0, 20, END]) {
          const payload = JSON.stringify(renderAttemptForCandidate(scenario, seed, minute));
          expect(payload).not.toMatch(/"keys"|tolerance|"criteria"|"guidance"|"notes"|"points"|"correct"|"findings"|"clean":|"order":/);
          if (exceptions.length > 1) for (const f of forms(value)) expect(contains(payload, f), `${seed} m${minute}: ${f}`).toBe(false);
          for (const n of notes) expect(payload).not.toContain(n);
        }
      }
    },
    HEAVY,
  );

  it("the screens never say which PO failed or which user left: the same words for every seed", () => {
    for (const seed of SEEDS.slice(0, 30)) {
      const { docs, step } = screen(seed);
      for (const d of docs) expect(JSON.stringify(d.document)).not.toMatch(/exception|fail|verbal/i);
      expect(JSON.stringify((step("user-list").config as Doc).document.rows)).not.toMatch(/terminated|leaver|left/i);
    }
  });
});

describe("advisory-kestrel-p2p: timed sections", () => {
  const def = scenario.definition;
  const MIN = 60_000;
  const t0 = Date.parse("2026-11-16T09:00:00Z");
  const flowAt = (ms: number, events: Parameters<typeof resolveFlow>[1]["events"] = [], extraTimePercent = 0) =>
    resolveFlow(def, { startedAt: t0, now: t0 + ms, extraTimePercent, events });
  const stepById = (id: string) => def.steps.find((s) => s.id === id)!;

  it("validateSections passes and the sections fill the time limit exactly", () => {
    expect(validateSections(def, scenario.timeLimitMinutes)).toEqual([]);
    expect(def.sections!.reduce((t, s) => t + s.minutes, 0)).toBe(scenario.timeLimitMinutes);
  });

  it("six sections: rapid A, sample test, rapid B, inbox, rapid C, walkthrough and write-up", () => {
    expect(def.sections!.map((s) => [s.id, s.minutes, s.stepIds, !!s.oneAtATime])).toEqual([
      ["s-rapid-a", 6, ["rapid-controls"], false],
      ["s-test", 12, [...SAMPLE_STEPS, "conclusion"], true],
      ["s-rapid-b", 6, ["rapid-sod"], false],
      ["s-inbox", 10, ["verbal", "exception-count", "exception-value", "user-list"], true],
      ["s-rapid-c", 6, ["rapid-findings"], false],
      ["s-final", 12, ["walkthrough", "writeup"], false],
    ]);
  });

  it("one-at-a-time screens add up to their section, so no screen is cut short and nobody waits", () => {
    for (const sec of def.sections!.filter((s) => s.oneAtATime)) {
      expect(sec.stepIds.reduce((t, id) => t + stepById(id).seconds!, 0), sec.id).toBe(sec.minutes * 60);
    }
    expect(SAMPLE_STEPS.map((id) => stepById(id).seconds)).toEqual([165, 165, 165, 165]);
    expect(stepById("conclusion").seconds).toBe(60);
    expect(["verbal", "exception-count", "exception-value", "user-list"].map((id) => stepById(id).seconds)).toEqual([180, 90, 90, 240]);
  });

  it("each rapid round is 15 items x 24 seconds, which fills its 6-minute section exactly", () => {
    for (const id of RAPID_STEPS) {
      const config = rapidConfig(id);
      expect(config.items.length, id).toBe(15);
      expect(config.secondsPerItem).toBe(24);
      const sec = def.sections!.find((s) => s.stepIds.includes(id))!;
      expect(config.items.length * config.secondsPerItem).toBe(sec.minutes * 60);
    }
  });

  it("runs the sections back to back with no early finishes", () => {
    const at = (min: number) => flowAt(min * MIN);
    expect(at(0).visibleStepIds).toEqual(["rapid-controls"]);
    expect(at(6).visibleStepIds).toEqual(["test-1"]);
    expect(at(6 + 2.75 * 3 + 0.1).visibleStepIds).toEqual(["test-4"]);
    expect(at(17.1).visibleStepIds).toEqual(["conclusion"]);
    expect(at(18).visibleStepIds).toEqual(["rapid-sod"]);
    expect(at(24).visibleStepIds).toEqual(["verbal"]);
    expect(at(27).visibleStepIds).toEqual(["exception-count"]);
    expect(at(28.5).visibleStepIds).toEqual(["exception-value"]);
    expect(at(30).visibleStepIds).toEqual(["user-list"]);
    expect(at(34).visibleStepIds).toEqual(["rapid-findings"]);
    expect(at(40).visibleStepIds).toEqual(["walkthrough", "writeup"]);
    expect(at(END).done).toBe(true);
  });

  it("messages linked to a step arrive when their section starts; the matrix is there from the start", () => {
    expect(def.messages.map((m) => [m.id, m.arriveAtMinute ?? 0, m.stepId])).toEqual([
      ["m0", 0, undefined],
      ["m1", 0, "test-1"],
      ["m2", 0, "verbal"],
      ["m3", 0, "exception-count"],
      ["m4", 0, "user-list"],
      ["m5", 0, "walkthrough"],
      ["m6", 0, "writeup"],
    ]);
    const msgsAt = (min: number, events: Parameters<typeof resolveFlow>[1]["events"] = []) =>
      visibleMessageIds(def, flowAt(min * MIN, events), t0, t0 + min * MIN);
    expect(msgsAt(0)).toEqual(["m0"]);
    expect(msgsAt(6)).toEqual(["m0", "m1"]);
    expect(msgsAt(24)).toEqual(["m0", "m1", "m2", "m3", "m4"]);
    expect(msgsAt(40)).toEqual(["m0", "m1", "m2", "m3", "m4", "m5", "m6"]);
    const early = [{ kind: "advanced_section" as const, sectionId: "s-rapid-a", at: t0 + 2 * MIN }];
    expect(msgsAt(2.5, early)).toEqual(["m0", "m1"]);
    const matrix = screen("abc").msg("m0").body;
    for (const ref of ["P2P-01", "P2P-02", "P2P-03", "P2P-04", "P2P-05", "ITGC-03"]) expect(matrix).toContain(ref);
  });

  it("the flow renders each rapid item exactly as sequence.renderItem does, and nothing from the key", () => {
    for (const id of RAPID_STEPS) {
      const items = rapidItems("abc", id);
      for (const index of [0, 7, 14]) {
        const view = renderFlowForCandidate(scenario, "abc", {
          stepIds: [id],
          messages: [],
          sequences: { [id]: { index, count: 15, endsAt: "2026-11-16T09:00:24.000Z" } },
        });
        const cfg = view.steps[0].config as { itemCount: number; current: { item: RapidItem } };
        expect(cfg.itemCount).toBe(15);
        expect(cfg.current.item).toEqual(items[index]);
        expect(JSON.stringify(cfg)).not.toMatch(/"items"|choice"|tolerance|points/);
      }
    }
  });
});

describe("advisory-kestrel-p2p: rapid item timing", () => {
  const def = scenario.definition;
  const t0 = Date.parse("2026-11-16T09:00:00Z");

  it("an unanswered rapid item scores 0, with a note, and the round's timing line counts it", () => {
    const seed = "abc";
    for (const id of RAPID_STEPS) {
      const a = clone(perfectAnswers(seed)) as unknown as Record<string, { items: Record<string, unknown> }>;
      const first = `${rapidConfig(id).items[0].id}`;
      delete a[id].items[first];
      const s = scoreAttempt(scenario, seed, a).steps[id];
      const item = s.items.find((i) => i.id === first)!;
      expect(item.earned, id).toBe(0);
      expect(item.note).toMatch(/No answer/);
      expect(s.points).toBe(10 - 0.5);
      expect(s.items.find((i) => i.id === "timing")!.note).toMatch(/1 with no answer/);
    }
  });

  it("extra time (25/50/100%) stretches each item's 24 seconds, and the round still fits its stretched section", () => {
    for (const pct of [0, 25, 50, 100]) {
      const flow = resolveFlow(def, { startedAt: t0, now: t0, extraTimePercent: pct, events: [] });
      expect(flow.visibleStepIds).toEqual(["rapid-controls"]);
      const sectionEnd = flow.section!.endsAt;
      expect(sectionEnd - t0).toBe(6 * 60_000 * (1 + pct / 100));
      const per = 24_000 * (1 + pct / 100);
      const first = resolveItems({ stepStartedAt: t0, stepEndsAt: sectionEnd, count: 15, secondsPerItem: 24, extraTimePercent: pct, answeredAt: {}, now: t0 });
      expect(first.endsAt - t0, `${pct}%`).toBe(per);
      // With no answers, item 15 opens at 14 × the stretched limit and ends with the section.
      const last = resolveItems({ stepStartedAt: t0, stepEndsAt: sectionEnd, count: 15, secondsPerItem: 24, extraTimePercent: pct, answeredAt: {}, now: t0 + 14 * per });
      expect(last.index).toBe(14);
      expect(last.endsAt).toBe(sectionEnd);
      expect(resolveItems({ stepStartedAt: t0, stepEndsAt: sectionEnd, count: 15, secondsPerItem: 24, extraTimePercent: pct, answeredAt: {}, now: sectionEnd }).done).toBe(true);
    }
  });
});

describe("advisory-kestrel-p2p: rapid rounds", () => {
  it(
    "every item over 200 seeds has exactly one right option per field, and it's the one the material gives",
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
              const choice = k[f.id].choice;
              expect((f as RapidChoiceField).options.filter((o) => o.id === choice).length, `${seed} ${s.item.id}.${f.id}`).toBe(1);
              expect(choice, `${seed} ${s.item.id}.${f.id} (${s.kind}: ${s.item.prompt})`).toBe(s.values[f.id]);
            }
          }
        }
      }
    },
    HEAVY,
  );

  it("control pass or fail: every evidence type and every reason shows up; result and reason always agree", () => {
    const kinds = new Set<string>();
    for (const seed of SEEDS.slice(0, 30)) {
      for (const s of solveRapid(seed, "rapid-controls")) {
        kinds.add(s.kind);
        const effective = s.values.result === optionId(s.item, "result", "Effective");
        expect(effective).toBe(s.values.reason === optionId(s.item, "reason", /^No issue/));
      }
    }
    expect([...kinds].sort()).toEqual(
      [
        "po_after_payment",
        "po_near",
        "po_ok",
        "po_over_limit",
        "po_self",
        "rec_late",
        "rec_near",
        "rec_ok",
        "rec_self",
        "rec_signoff",
        "vendor_after_payment",
        "vendor_ok",
        "vendor_self",
      ].sort(),
    );
  });

  it("design or operating: all three answers show up in every round", () => {
    for (const seed of SEEDS.slice(0, 30)) {
      const answers = new Set(solveRapid(seed, "rapid-findings").map((s) => FD_RULES.find((r) => r[0] === s.kind)![2]));
      expect(answers.size, seed).toBe(3);
    }
  });

  it("ten quick items worth half a point and five harder ones worth one, in every round", () => {
    const hardKinds: Record<RapidStepId, string[]> = {
      "rapid-controls": ["po_after_payment", "vendor_after_payment", "rec_late", "po_near", "rec_near"],
      "rapid-sod": ["vendor_pay_plus", "je_plus", "receive_invoice_plus", "none_three"],
      "rapid-findings": FD_RULES.filter((r) => r[3] === "hard").map((r) => r[0]),
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

  it("varies per seed: names, amounts, which item comes when, and the right answer", () => {
    for (const id of RAPID_STEPS) {
      const firsts = SEEDS.slice(0, 60).map((seed) => solveRapid(seed, id)[0]);
      expect(new Set(firsts.map((s) => JSON.stringify(s.item))).size, id).toBeGreaterThan(55);
      expect(new Set(firsts.map((s) => s.kind)).size, id).toBeGreaterThanOrEqual(3);
      expect(new Set(firsts.map((s) => JSON.stringify(s.values))).size, id).toBeGreaterThanOrEqual(2);
    }
  });

  it("a wrong field costs half its item; a missing item costs its points", () => {
    const seed = "abc";
    const perfect = scoreAttempt(scenario, seed, perfectAnswers(seed));
    for (const id of RAPID_STEPS) {
      const a = clone(perfectAnswers(seed)) as unknown as Record<string, { items: Record<string, { values: Record<string, string> }> }>;
      const solved = solveRapid(seed, id);
      const hard = rapidConfig(id).items.findIndex((i) => i.points === 1);
      const easy = rapidConfig(id).items.findIndex((i) => i.points === 0.5);
      delete a[id].items[solved[hard].item.id];
      const field = solved[easy].item.fields[0] as RapidChoiceField;
      a[id].items[solved[easy].item.id].values[field.id] = field.options.find((o) => o.id !== solved[easy].values[field.id])!.id;
      const lostPts = perfect.steps[id].points - scoreAttempt(scenario, seed, a).steps[id].points;
      // Control items have two fields (a wrong one costs ¼); the other rounds have one (a wrong one costs the ½).
      expect(lostPts, id).toBe(id === "rapid-controls" ? 1.25 : 1.5);
    }
  });

  it("option ids are fixed per item, so an id can't hint at the answer", () => {
    for (const id of RAPID_STEPS) {
      const ids = (seed: string) => rapidItems(seed, id).map((i) => i.fields.map((f) => [f.id, (f as RapidChoiceField).options.map((o) => o.id)]));
      const first = JSON.stringify(ids(SEEDS[0]));
      for (const seed of SEEDS.slice(1, 30)) expect(JSON.stringify(ids(seed)), `${id} ${seed}`).toBe(first);
    }
  });

  it("no rendered rapid item holds a key string", () => {
    for (const seed of SEEDS.slice(0, 50)) {
      for (const id of RAPID_STEPS) {
        for (const item of rapidItems(seed, id)) {
          const json = JSON.stringify(item);
          expect(json).not.toMatch(/choice"|tolerance|points|"kind":"choice"/);
          for (const k of Object.keys(item)) expect(["id", "prompt", "exhibit", "fields"]).toContain(k);
        }
      }
    }
  });
});
