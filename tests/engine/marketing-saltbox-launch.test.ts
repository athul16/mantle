import { describe, expect, it, vi } from "vitest";
import type { RapidChoiceField, RapidItem } from "@/lib/engine/step-types/rapid_round/public";
import type { PublicCell, SpreadsheetPublicConfig } from "@/lib/engine/step-types/spreadsheet/public";

vi.mock("server-only", () => ({}));

const { marketingSaltboxLaunch } = await import("@/lib/engine/scenarios/marketing-saltbox-launch");
const { getScenario, listScenarios } = await import("@/lib/engine/scenarios");
const { renderAttemptForCandidate, renderFlowForCandidate } = await import("@/lib/engine/server/render");
const { scoreAttempt } = await import("@/lib/engine/server/score");
const { resolveFlow, visibleMessageIds, validateSections } = await import("@/lib/engine/server/flow");
const { rapidRoundServer } = await import("@/lib/engine/step-types/rapid_round/server");
const { fillTemplate, templateValues } = await import("@/lib/engine/server/template");

/**
 * Marketing coordinator: launch week at Saltbox. Three rapid rounds (campaign
 * metrics, copy check, budget), two long tasks (channel report, launch QA) and
 * a desk of one-at-a-time screens (agency invoice, A/B readout and lift, five
 * values calls), 50 minutes, 100 points. Every task is solved here from what
 * the candidate sees, with an independent reading of Saltbox's rules, then
 * compared with the server key.
 */

const scenario = marketingSaltboxLaunch;
const SEEDS = Array.from({ length: 200 }, (_, i) => `attempt-${i.toString(16).padStart(4, "0")}`);
const END = scenario.timeLimitMinutes;
const MAX = 100;
const RAPID_STEPS = ["rapid-metrics", "rapid-copy", "rapid-budget"] as const;
type RapidStepId = (typeof RAPID_STEPS)[number];
const REVIEW_STEPS = ["launch-qa", "invoice-check"] as const;
type ReviewStepId = (typeof REVIEW_STEPS)[number];
const VALUES_STEPS = ["values-integrity", "values-candor", "values-client-care", "values-in-lane", "values-quality"] as const;
type ValuesStepId = (typeof VALUES_STEPS)[number];
const DESK = ["invoice-check", "ab-readout", "ab-lift", ...VALUES_STEPS];
const LONG = 180_000;

type Field = { id: string; label: string; value: string };
type Doc = {
  prompt: string;
  document: { title: string; fields: Field[]; columns: string[]; rows: { id: string; cells: string[] }[]; totals: Field[]; footnote?: string };
  reasons: { id: string; label: string }[];
  decision?: { prompt: string; options: { id: string; label: string }[] };
};
type Mc = { prompt: string; options: { id: string; label: string }[]; select: "single" | "multi" };
type ReviewKey = { findings: Record<string, { targets: string[]; reasons: string[]; note?: string }>; decision?: string[] };
type McKey = { correct: string[] };
type SheetKey = { tolerance?: number; cells: Record<string, { value: number; tolerance?: number }> };
type NumKey = { value: number; tolerance: number; partialTolerance?: number };
type Flag = { target: string; reason: string; note: string };

// ---- Reading the screen ----

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
  const doc = (id: ReviewStepId) => step(id).config as Doc;
  const mc = (id: string) => step(id).config as Mc;
  const sheet = () => step("campaign-report").config as SpreadsheetPublicConfig;
  return { view, step, msg, doc, mc, sheet };
}
type Screen = ReturnType<typeof screen>;

const field = (doc: Doc, id: string) => {
  const f = [...doc.document.fields, ...doc.document.totals].find((x) => x.id === id);
  expect(f, `field ${id}`).toBeDefined();
  return f!.value;
};
const col = (doc: Doc, name: RegExp) => {
  const i = doc.document.columns.findIndex((c) => name.test(c));
  expect(i, `column ${name}`).toBeGreaterThanOrEqual(0);
  return i;
};
const line = (body: string, re: RegExp) => {
  const m = body.match(re);
  expect(m, `line ${re}`).not.toBeNull();
  return m!;
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const WEEKDAYS_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
/** "Mon, Mar 2, 2026" → epoch day (UTC); also checks the weekday printed matches the date. */
function day(label: string): number {
  const m = label.trim().match(/^(\w{3}), (\w{3}) (\d{1,2}), (\d{4})$/);
  expect(m, `date "${label}"`).not.toBeNull();
  const t = Date.UTC(Number(m![4]), MONTHS.indexOf(m![2]), Number(m![3]));
  expect(WEEKDAYS[new Date(t).getUTCDay()], `weekday of ${label}`).toBe(m![1]);
  return t / 86_400_000;
}
/** "9:30 AM" → minutes after midnight. */
function clockMin(label: string): number {
  const m = label.trim().match(/^(\d{1,2}):(\d{2}) (AM|PM)$/);
  expect(m, `time "${label}"`).not.toBeNull();
  return ((Number(m![1]) % 12) + (m![3] === "PM" ? 12 : 0)) * 60 + Number(m![2]);
}
const num = (s: string) => {
  expect(s, `number "${s}"`).toMatch(/^\d{1,3}(,\d{3})*$/);
  return Number(s.replace(/,/g, ""));
};
/** "$1,234.56" → cents. */
const cents = (s: string) => {
  expect(s, `money "${s}"`).toMatch(/^\$\d{1,3}(,\d{3})*\.\d{2}$/);
  return Math.round(Number(s.replace(/[$,]/g, "")) * 100);
};
const usd = (c: number) => `$${(Math.round(c) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const r2 = (x: number) => Math.round(x * 100) / 100;
const r1 = (x: number) => Math.round(x * 10) / 10;

// ---- Channel report ----

const text = (c: PublicCell | undefined) => (c && c.kind === "text" ? c.text : "");
const inputId = (c: PublicCell | undefined) => (c && c.kind === "input" ? c.id : null);
const CHANNEL_NAMES = ["Paid search", "Paid social", "Email", "Affiliates", "Display"];

interface ExportRow {
  id: string;
  channel: string;
  status: string;
  spend: number;
  orders: number;
  revenue: number;
  refunds: number;
  raw: string;
}

/** The export as shown, the paid lead's correction applied, each campaign ID counted once. */
function readReport(sc: Screen, opts: { dedupe?: boolean; revise?: boolean; net?: boolean } = {}) {
  const { dedupe = true, revise = true, net = true } = opts;
  const sheet = sc.sheet();
  expect(sheet.columns).toEqual(["Campaign ID", "Channel", "Status", "Spend", "Impressions", "Clicks", "Orders", "Revenue", "Refunds"]);
  const exportRows: ExportRow[] = sheet.rows
    .filter((r) => /^SBX-[A-Z]+-\d{4}$/.test(text(r[0])))
    .map((r) => ({
      id: text(r[0]),
      channel: text(r[1]),
      status: text(r[2]),
      spend: cents(text(r[3])),
      orders: num(text(r[6])),
      revenue: cents(text(r[7])),
      refunds: cents(text(r[8])),
      raw: r.map(text).join("|"),
    }));
  expect(exportRows.length).toBe(7);
  const fix = line(sc.msg("m-report-fix").body, /Spend on (SBX-[A-Z]+-\d{4}) \((.+)\) is (\$[\d,.]+), not (\$[\d,.]+)\./);
  const seen = new Map<string, ExportRow>();
  const counted: ExportRow[] = [];
  for (const r of exportRows) {
    const prev = seen.get(r.id);
    if (prev) {
      expect(prev.raw, `duplicate ${r.id} is an exact copy`).toBe(r.raw);
      if (dedupe) continue;
    }
    seen.set(r.id, r);
    counted.push(r);
  }
  const revised = exportRows.find((r) => r.id === fix[1])!;
  expect(revised, "the corrected campaign is in the export").toBeDefined();
  expect(cents(fix[4])).toBe(revised.spend);
  expect(cents(fix[3])).toBeGreaterThan(revised.spend);
  const spendOf = (r: ExportRow) => (revise && r.id === fix[1] ? cents(fix[3]) : r.spend);

  const summary = sheet.rows.filter((r) => CHANNEL_NAMES.includes(text(r[1])) && inputId(r[3]));
  expect(summary.map((r) => text(r[1]))).toEqual(CHANNEL_NAMES);
  const total = sheet.rows.find((r) => text(r[1]) === "Total / blended")!;
  expect(total, "total row").toBeDefined();
  const cells: Record<string, number> = {};
  const scratch: string[] = [];
  let tNet = 0;
  let tSpend = 0;
  let tOrders = 0;
  for (const r of summary) {
    const rows = counted.filter((x) => x.channel === text(r[1]));
    expect(rows.length, text(r[1])).toBeGreaterThan(0);
    const nNet = rows.reduce((s, x) => s + x.revenue - (net ? x.refunds : 0), 0);
    const nSpend = rows.reduce((s, x) => s + spendOf(x), 0);
    const nOrders = rows.reduce((s, x) => s + x.orders, 0);
    tNet += nNet;
    tSpend += nSpend;
    tOrders += nOrders;
    cells[inputId(r[3])!] = nNet / 100;
    if (nOrders > 0) cells[inputId(r[4])!] = r2(nSpend / nOrders / 100);
    else scratch.push(inputId(r[4])!);
    cells[inputId(r[5])!] = r2(nNet / nSpend);
  }
  cells[inputId(total[3])!] = tNet / 100;
  cells[inputId(total[4])!] = r2(tSpend / tOrders / 100);
  cells[inputId(total[5])!] = r2(tNet / tSpend);
  const dupId = exportRows.find((r, i) => exportRows.findIndex((x) => x.id === r.id) !== i)!.id;
  return { cells, scratch, exportRows, dupId, revisedId: fix[1], zero: summary.filter((r) => scratch.includes(inputId(r[4])!)).map((r) => text(r[1])) };
}

// ---- Launch QA ----

function readQa(sc: Screen) {
  const doc = sc.doc("launch-qa");
  const price = field(doc, "sheet_price");
  expect(price).toMatch(/^\$\d+$/);
  const code = field(doc, "sheet_code").match(/^(\S+), \d+% off \(not case sensitive\)$/)![1];
  const tag = field(doc, "sheet_tag").match(/^utm_campaign=(\S+) on every link/)![1];
  const suppressed = field(doc, "sheet_suppressed").split("; ");
  expect(suppressed.length).toBe(3);
  const legal = field(doc, "sheet_legal");
  const [, launchDay, launchTime] = field(doc, "sheet_launch").match(/^(.+, \d{4}), (\d{1,2}:\d{2} [AP]M) ET/)!;
  const moved = line(sc.msg("m-qa-move").body, /launch moves to (\d{1,2}:\d{2} [AP]M) ET on (.+, \d{4})\./);
  expect(day(moved[2])).toBe(day(launchDay));
  const newLaunch = day(launchDay) * 1440 + clockMin(moved[1]);
  const oldLaunch = day(launchDay) * 1440 + clockMin(launchTime);
  expect(newLaunch).toBeGreaterThan(oldLaunch);
  const c = Object.fromEntries((["asset", "headline", "price", "code", "tag", "time", "audience", "legal"] as const).map((k, i) => [k, i])) as Record<string, number>;
  expect(doc.document.columns).toEqual(["Asset", "Headline", "Price", "Code", "Link tag", "Send / live time", "Audience", "Legal line"]);
  const rows = doc.document.rows.map((r) => {
    const cell = (k: string) => r.cells[c[k]];
    const issues: string[] = [];
    if (cell("price") !== price) issues.push("price");
    if (cell("code").toUpperCase() !== code.toUpperCase()) issues.push("code");
    const params = Object.fromEntries(cell("tag").split("&").map((p) => p.split("=")));
    if (params.utm_campaign !== tag) issues.push("tag");
    const [, d, t] = cell("time").match(/^(.+, \d{4}), (\d{1,2}:\d{2} [AP]M)$/)!;
    const when = day(d) * 1440 + clockMin(t);
    expect(when, `${r.id} not before the original launch`).toBeGreaterThanOrEqual(oldLaunch);
    if (when < newLaunch) issues.push("early");
    const included = cell("audience").split(" (excl. ")[0].split(" + ");
    if (included.some((a) => suppressed.includes(a))) issues.push("suppressed");
    if (cell("legal") !== legal) issues.push("legal");
    return { id: r.id, issues, when, code: cell("code"), tag: cell("tag"), audience: cell("audience") };
  });
  return { rows, code, tag, newLaunch, oldLaunch, suppressed };
}

// ---- Invoice ----

const IN_SCOPE = /management|^Launch creative|^Launch copy|^Launch plan|report|status calls/i;

function readInvoice(sc: Screen) {
  const doc = sc.doc("invoice-check");
  const cap = Number(field(doc, "sow_cap").match(/^(\d+) hours$/)![1]);
  const card = new Map(
    field(doc, "sow_rates")
      .split(" · ")
      .map((x) => {
        const m = x.match(/^(.+) \$(\d+)\/h$/)!;
        return [m[1], Number(m[2])] as const;
      }),
  );
  expect(card.size).toBe(5);
  const [cDesc, cRole, cHours, cRate, cAmount, cCo] = [/^Description/, /^Role/, /^Hours/, /^Rate/, /^Amount/, /^Change order/].map((re) => col(doc, re));
  let hours = 0;
  let amount = 0;
  const rows = doc.document.rows.map((r) => {
    const h = Number(r.cells[cHours]);
    const rate = Number(r.cells[cRate].match(/^\$(\d+)\/h$/)![1]);
    const amt = cents(r.cells[cAmount]);
    hours += h;
    amount += amt;
    const issues: string[] = [];
    if (card.get(r.cells[cRole]) !== rate) issues.push("rate");
    if (Math.round(h * rate * 100) !== amt) issues.push("math");
    const inScope = IN_SCOPE.test(r.cells[cDesc]);
    if (!inScope && !/^CO-\d+ signed /.test(r.cells[cCo])) issues.push("scope");
    return { id: r.id, issues, inScope, co: r.cells[cCo], hours: h };
  });
  expect(Number(field(doc, "total_hours"))).toBeCloseTo(hours, 9);
  expect(cents(field(doc, "total_amount"))).toBe(amount);
  return { cap, hours, rows, overCap: hours > cap };
}

// ---- A/B test ----

function readAb(sc: Screen) {
  const card = sc.msg("card-tests").body;
  const min = num(line(card, /Minimum sample: ([\d,]+) visitors in each arm/)[1]);
  const liftMin = Number(line(card, /beats A's by at least (\d+)% relative/)[1]);
  const m = line(sc.mc("ab-readout").prompt, /A had ([\d,]+) visitors and ([\d,]+) orders; B had ([\d,]+) visitors and ([\d,]+) orders/);
  const [va, oa, vb, ob] = m.slice(1, 5).map(num);
  const lift = ((ob / vb) / (oa / va) - 1) * 100;
  const call = va < min || vb < min ? "run" : lift >= liftMin ? "ship" : "keep";
  return { min, liftMin, va, oa, vb, ob, lift, call };
}
const AB_OPTION = { run: /^Keep the test running/, ship: /^Ship B: both arms/, keep: /^Keep A:/ };

function oneOption(cfg: { options: { id: string; label: string }[] }, re: RegExp) {
  const o = cfg.options.filter((x) => re.test(x.label));
  expect(o.length, `one option like ${re}`).toBe(1);
  return o[0].id;
}

const VALUES_RIGHT: Record<ValuesStepId, RegExp> = {
  "values-integrity": /^Keep the slide on net revenue/,
  "values-candor": /^Pause the send, fix the code, and tell .+ it was my mistake/,
  "values-client-care": /^Decline the plain list; share the hashed list/,
  "values-in-lane": /^Don't confirm it: .* send the request to legal/,
  "values-quality": /^Run the link checks before scheduling/,
};

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

const choiceField = (item: RapidItem) => {
  const f = item.fields.find((x) => x.id === "answer") as RapidChoiceField | undefined;
  expect(f, `${item.id} answer field`).toBeDefined();
  expect(f!.options.length).toBe(4);
  expect(new Set(f!.options.map((o) => o.label)).size, `${item.id} four different options`).toBe(4);
  return f!;
};
const pick = (item: RapidItem, label: string) => {
  const opts = choiceField(item).options.filter((o) => o.label === label);
  expect(opts.length, `${item.id}: one option "${label}" in ${JSON.stringify(choiceField(item).options.map((o) => o.label))}`).toBe(1);
  return { answer: opts[0].id };
};
const row = (item: RapidItem, label: string) => {
  const r = item.exhibit?.rows?.find((x) => x.label === label);
  expect(r, `${item.id} row ${label}`).toBeDefined();
  return r!.value;
};
const rowLike = (item: RapidItem, re: RegExp) => {
  const r = item.exhibit?.rows?.find((x) => re.test(x.label));
  expect(r, `${item.id} row ${re}`).toBeDefined();
  return r!.value;
};
const pct2 = (x: number) => `${x.toFixed(2)}%`;
const signed1 = (x: number) => `${x >= 0 ? "+" : "-"}${Math.abs(x).toFixed(1)}%`;

/** Campaign metrics, from the exhibit and the reporting rules. */
function solveMetrics(item: RapidItem): Solved {
  const p = item.prompt;
  if (/blended CPA/.test(p) || /blended ROAS/.test(p)) {
    const lines = (item.exhibit?.rows ?? []).filter((r) => CHANNEL_NAMES.includes(r.label)).map((r) => r.value);
    expect(lines.length).toBe(2);
    if (/blended CPA/.test(p)) {
      const parsed = lines.map((l) => l.match(/^Spend (\$[\d,.]+) · ([\d,]+) orders$/)!);
      const spend = parsed.reduce((s, m) => s + cents(m[1]), 0);
      const orders = parsed.reduce((s, m) => s + num(m[2]), 0);
      return { kind: "blended_cpa", values: pick(item, usd(spend / orders)) };
    }
    const parsed = lines.map((l) => l.match(/^Spend (\$[\d,.]+) · revenue (\$[\d,.]+) · refunds (\$[\d,.]+)$/)!);
    const spend = parsed.reduce((s, m) => s + cents(m[1]), 0);
    const net = parsed.reduce((s, m) => s + cents(m[2]) - cents(m[3]), 0);
    return { kind: "blended_roas", values: pick(item, `${(net / spend).toFixed(2)}x`) };
  }
  if (/change vs\. the week before/.test(p)) {
    const metric = row(item, "Metric");
    const read = metric === "Orders" ? num : cents;
    const last = read(row(item, "Week before"));
    const now = read(row(item, "This week"));
    return { kind: "change", values: pick(item, signed1(((now - last) / last) * 100)) };
  }
  if (/pace this month/.test(p)) {
    const budget = cents(row(item, "Monthly budget"));
    const spent = cents(row(item, "Spent to date"));
    const [, e, d] = row(item, "Days elapsed").match(/^(\d+) of (\d+)$/)!;
    const sp = (100 * spent) / budget;
    const dp = (100 * Number(e)) / Number(d);
    const verdict = sp - dp > 5 ? "Ahead of pace" : sp - dp < -5 ? "Behind pace" : "On pace";
    return { kind: "pacing", values: pick(item, `${verdict}: ${Math.round(sp)}% spent, ${Math.round(dp)}% of the month gone`) };
  }
  const impressions = num(row(item, "Impressions"));
  const clicks = num(row(item, "Clicks"));
  const orders = num(row(item, "Orders"));
  const spend = cents(row(item, "Spend"));
  const kind = p.match(/'s (CTR|CPC|CPA|conversion rate|CPM)\?$/)![1];
  const right: Record<string, string> = {
    CTR: pct2((100 * clicks) / impressions),
    CPC: usd(spend / clicks),
    CPA: usd(spend / orders),
    "conversion rate": pct2((100 * orders) / clicks),
    CPM: usd((spend / impressions) * 1000),
  };
  return { kind: kind.toLowerCase(), values: pick(item, right[kind]) };
}

const ISSUE_LABEL: Record<string, string> = {
  price: "Wrong price",
  code: "Wrong promo code",
  name: "Wrong product name",
  claim: "Claim not allowed",
  legal: "Missing legal line",
};
const ISSUE_ORDER = ["price", "code", "name", "claim", "legal"];

/** Copy check: the copy against the launch sheet line, the legal line, the claims list and the house rules. */
function solveCopy(item: RapidItem): Solved {
  const copy = row(item, "Copy");
  const [, product, price, code, launch] = row(item, "Launch sheet").match(/^(.+) · \$(\d+) · code (\S+) \(\d+% off\) · launches (.+)$/)!;
  const legal = row(item, "Legal line");
  const banned = row(item, "Claims not allowed").split("; ");
  expect(row(item, "House rules")).toMatch(/codes not case sensitive/);
  const partner = item.exhibit?.title === "Creator post (paid partner)";
  if (partner && !copy.startsWith("#ad")) return { kind: "disclosure", values: pick(item, "Missing #ad disclosure") };
  const date = copy.match(/Launches (\w+), (\w{3}) (\d{1,2})\./);
  if (date) {
    const d = day(launch);
    expect(`${MONTHS[new Date(d * 86_400_000).getUTCMonth()]} ${new Date(d * 86_400_000).getUTCDate()}`, `${item.id} launch date`).toBe(`${date[2]} ${date[3]}`);
    if (WEEKDAYS_LONG[new Date(d * 86_400_000).getUTCDay()] !== date[1]) return { kind: "weekday", values: pick(item, "Wrong day of the week") };
  }
  const issues: string[] = [];
  const shownPrice = copy.match(/(?:^|\. )\$(\d+)\./);
  expect(shownPrice, `${item.id} price in "${copy}"`).not.toBeNull();
  if (shownPrice![1] !== price) issues.push("price");
  if (copy.match(/Use code (\S+) for/)![1].toUpperCase() !== code.toUpperCase()) issues.push("code");
  if (!copy.includes(product)) issues.push("name");
  if (banned.some((b) => copy.toLowerCase().includes(b.toLowerCase()))) issues.push("claim");
  if (!copy.includes(legal)) issues.push("legal");
  expect(issues.length, `${item.id}: "${copy}"`).toBeLessThanOrEqual(2);
  if (issues.length === 0) return { kind: "fine", values: pick(item, "Fine to publish") };
  if (issues.length === 1) return { kind: issues[0], values: pick(item, ISSUE_LABEL[issues[0]]) };
  issues.sort((a, b) => ISSUE_ORDER.indexOf(a) - ISSUE_ORDER.indexOf(b));
  return { kind: "two", values: pick(item, `${ISSUE_LABEL[issues[0]]} and ${ISSUE_LABEL[issues[1]].toLowerCase()}`) };
}

/** Budget maths from the tracker exhibit. */
function solveBudget(item: RapidItem): Solved {
  const p = item.prompt;
  if (/monthly budget is left\?$/.test(p)) {
    const left = cents(row(item, "Monthly budget")) - cents(row(item, "Spent before launch week")) - cents(rowLike(item, /^Launch week/));
    return { kind: "remaining", values: pick(item, usd(left)) };
  }
  if (/daily spend lands/.test(p)) {
    const left = cents(row(item, "Budget left"));
    const days = Number(row(item, "Days left").match(/^(\d+) \(including today\)$/)![1]);
    return { kind: "daily", values: pick(item, usd(left / days)) };
  }
  if (/orders should/.test(p)) {
    const n = Math.round(cents(row(item, "Budget")) / cents(row(item, "Forecast CPA (use this)")));
    return { kind: "forecast", values: pick(item, `${n.toLocaleString("en-US")} orders`) };
  }
  if (/fee on this month's media/.test(p)) {
    const pct = Number(row(item, "Agency fee").match(/^(\d+)% of media spend$/)![1]);
    return { kind: "fee", values: pick(item, usd((cents(row(item, "Media spend")) * pct) / 100)) };
  }
  if (/over or under the PO/.test(p)) {
    const diff = cents(row(item, "Invoice: media")) + cents(row(item, "Invoice: agency fee")) - cents(row(item, "PO amount"));
    return { kind: "po", values: pick(item, `${usd(Math.abs(diff))} ${diff > 0 ? "over" : "under"}`) };
  }
  if (/weekly orders change/.test(p)) {
    const rows = (item.exhibit?.rows ?? []).filter((r) => CHANNEL_NAMES.includes(r.label));
    const move = row(item, "Move").match(/^(\$[\d,.]+) a week from (.+) to (.+)$/)!;
    const cpa = (name: string) => cents(rows.find((r) => r.label.toLowerCase() === name)!.value.replace(/^CPA /, ""));
    const m = cents(move[1]);
    const d = Math.round(m / cpa(move[3]) - m / cpa(move[2]));
    return { kind: "realloc_orders", values: pick(item, `${d >= 0 ? "+" : "-"}${Math.abs(d).toLocaleString("en-US")} orders`) };
  }
  if (/How much moves from/.test(p)) {
    const total = cents(row(item, "Total budget (fixed)"));
    const now = Number(rowLike(item, / share now$/).replace("%", ""));
    const after = Number(rowLike(item, / share after$/).replace("%", ""));
    return { kind: "realloc_share", values: pick(item, usd((total * (after - now)) / 100)) };
  }
  expect(p).toMatch(/media can the all-in budget buy/);
  const total = cents(row(item, "All-in budget").replace(/ \(media \+ agency fee\)$/, ""));
  const pct = Number(row(item, "Agency fee").match(/^(\d+)% of media spend$/)![1]);
  return { kind: "fee_gross", values: pick(item, usd(total / (1 + pct / 100))) };
}

const SOLVERS: Record<RapidStepId, (item: RapidItem) => Solved> = {
  "rapid-metrics": solveMetrics,
  "rapid-copy": solveCopy,
  "rapid-budget": solveBudget,
};
const HARD_KINDS: Record<RapidStepId, string[]> = {
  "rapid-metrics": ["blended_cpa", "blended_roas", "change", "pacing"],
  "rapid-copy": ["two", "weekday", "disclosure"],
  "rapid-budget": ["realloc_orders", "realloc_share", "fee_gross"],
};
const solveRapid = (seed: string, stepId: RapidStepId) => rapidItems(seed, stepId).map((item) => ({ item, ...SOLVERS[stepId](item) }));

function rapidAnswers(seed: string) {
  return Object.fromEntries(
    RAPID_STEPS.map((id) => [id, { items: Object.fromEntries(solveRapid(seed, id).map((s) => [s.item.id, { values: s.values, ms: 8_000 }])) }]),
  ) as Record<RapidStepId, { items: Record<string, { values: Record<string, string>; ms: number }> }>;
}

// ---- A strong candidate's answers, built only from the screen ----

function perfectAnswers(seed: string) {
  const sc = screen(seed);
  const report = readReport(sc);
  const qa = readQa(sc);
  const inv = readInvoice(sc);
  const ab = readAb(sc);
  return {
    ...rapidAnswers(seed),
    "campaign-report": { cells: { ...report.cells } as Record<string, number | null> },
    "launch-qa": {
      flags: qa.rows.flatMap((r) => r.issues.map((reason) => ({ target: r.id, reason, note: "" }))),
      decision: oneOption(sc.doc("launch-qa").decision!, /^Hold the flagged assets/),
    },
    "invoice-check": {
      flags: [
        ...(inv.overCap ? [{ target: "total_hours", reason: "cap", note: "" }] : []),
        ...inv.rows.flatMap((r) => r.issues.map((reason) => ({ target: r.id, reason, note: "" }))),
      ],
      decision: oneOption(sc.doc("invoice-check").decision!, /^Return it to/),
    },
    "ab-readout": { selected: [oneOption(sc.mc("ab-readout"), AB_OPTION[ab.call])] },
    "ab-lift": { value: r1(ab.lift) },
    ...(Object.fromEntries(VALUES_STEPS.map((id) => [id, { selected: [oneOption(sc.mc(id), VALUES_RIGHT[id])] }])) as Record<ValuesStepId, { selected: string[] }>),
  };
}

type Answers = ReturnType<typeof perfectAnswers>;
const clone = (a: Answers): Answers & Record<string, unknown> => JSON.parse(JSON.stringify(a));

describe("marketing-saltbox-launch: setup", () => {
  it("is registered, version 1, marketing, 50 minutes, and uses only built step types in section order", () => {
    expect(getScenario("marketing-saltbox-launch", 1)).toBe(scenario);
    expect(listScenarios()).toContain(scenario);
    expect(scenario.version).toBe(1);
    expect(scenario.timeLimitMinutes).toBe(50);
    expect(scenario.roleFamily).toBe("marketing");
    expect(scenario.title).toBe("Launch week at Saltbox: marketing coordinator");
    expect(scenario.definition.steps.map((s) => [s.id, s.type])).toEqual([
      ["rapid-metrics", "rapid_round"],
      ["campaign-report", "spreadsheet"],
      ["rapid-copy", "rapid_round"],
      ["launch-qa", "document_review"],
      ["rapid-budget", "rapid_round"],
      ["invoice-check", "document_review"],
      ["ab-readout", "multiple_choice"],
      ["ab-lift", "numeric"],
      ...VALUES_STEPS.map((id) => [id, "multiple_choice"]),
    ]);
    for (const id of VALUES_STEPS) expect(scenario.definition.steps.find((s) => s.id === id)!.title).toMatch(/^Judgment: /);
    expect(scenario.definition.intro).toMatch(/marketing coordinator at Saltbox Provisions/);
  });

  it(
    "renders for 200 seeds with no unfilled template, and every rapid item renders",
    () => {
      for (const seed of SEEDS) {
        for (const minute of [0, END]) {
          const view = renderAttemptForCandidate(scenario, seed, minute);
          expect(view.steps.length).toBeGreaterThanOrEqual(1);
          expect(JSON.stringify(view)).not.toContain("{{");
        }
        for (const id of RAPID_STEPS) expect(JSON.stringify(rapidItems(seed, id))).not.toContain("{{");
      }
    },
    LONG,
  );

  it("is deterministic per seed", () => {
    for (const seed of SEEDS.slice(0, 20)) {
      expect(scenario.generate(seed)).toEqual(scenario.generate(seed));
      expect(renderAttemptForCandidate(scenario, seed, END)).toEqual(renderAttemptForCandidate(scenario, seed, END));
    }
  });

  it("the cards set the day up: launch sheet, brand guide, reporting rules, test plan and SOW, all in the inbox from the start", () => {
    const sc = screen("abc");
    expect(sc.msg("card-launch").body).toMatch(/Promo code: .+ Codes aren't case sensitive/);
    expect(sc.msg("card-brand").body).toMatch(/opens with #ad/);
    expect(sc.msg("card-reporting").body).toMatch(/ROAS = net revenue ÷ spend/);
    expect(sc.msg("card-tests").body).toMatch(/Minimum sample/);
    expect(sc.msg("card-sow").body).toMatch(/hashed customer lists only/);
    for (const m of scenario.definition.messages) expect(m.body).not.toMatch(/@(?!.*\.example)/);
  });

  it("different seeds change the product, names, numbers and which row carries which trap", () => {
    expect(new Set(SEEDS.map((s) => JSON.stringify(scenario.generate(s).values))).size).toBe(SEEDS.length);
    const screens = SEEDS.slice(0, 60).map(screen);
    expect(new Set(screens.map((s) => field(s.doc("launch-qa"), "sheet_product"))).size).toBeGreaterThan(8);
    const reports = screens.map((s) => readReport(s));
    expect(new Set(reports.map((r) => r.dupId)).size).toBeGreaterThan(50);
    expect(new Set(reports.map((r) => r.zero.join())).size).toBe(3);
    const qas = screens.map(readQa);
    expect(new Set(qas.map((q) => q.rows.findIndex((r) => r.issues.includes("early")))).size).toBeGreaterThan(6);
    const invs = screens.map(readInvoice);
    expect(new Set(invs.map((i) => i.rows.findIndex((r) => r.issues.includes("math")))).size).toBeGreaterThan(5);
    expect(new Set(screens.map((s) => readAb(s).call)).size).toBe(3);
  });
});

describe("marketing-saltbox-launch: channel report", () => {
  it(
    "the key matches the export read by hand (each campaign ID once, refunds netted, spend corrected), for 200 seeds",
    () => {
      for (const seed of SEEDS) {
        const sc = screen(seed);
        const r = readReport(sc);
        const key = scenario.generate(seed).keys["campaign-report"] as SheetKey;
        expect(Object.keys(key.cells).sort(), seed).toEqual(Object.keys(r.cells).sort());
        for (const [id, value] of Object.entries(r.cells)) {
          expect(Math.abs(key.cells[id].value - value), `${seed} ${id}`).toBeLessThan(1e-9);
          expect(key.cells[id].tolerance ?? key.tolerance, `${seed} ${id} tolerance`).toBe(0.01);
        }
        // Exactly one zero-order channel, whose CPA isn't scored; the doubled and corrected campaigns are in channels with orders.
        expect(r.zero.length, seed).toBe(1);
        expect(r.scratch.length, seed).toBe(1);
        expect(r.dupId).not.toBe(r.revisedId);
        // Refunds are on every line with orders, so net revenue never equals a revenue figure on screen.
        for (const row of r.exportRows) expect(row.orders === 0 || row.refunds > 0, `${seed} ${row.id}`).toBe(true);
      }
    },
    LONG,
  );

  it("is worth 20 on every seed: 14 channel cells, then 2 each for total net revenue, blended CPA and blended ROAS", () => {
    for (const seed of SEEDS.slice(0, 50)) {
      const blank = scoreAttempt(scenario, seed, {});
      expect(blank.steps["campaign-report"].maxPoints).toBe(20);
      expect(blank.steps["campaign-report"].items.length).toBe(17);
    }
  });
});

describe("marketing-saltbox-launch: launch QA", () => {
  it(
    "twelve assets: one each of wrong code, wrong price, wrong tag, too early, suppressed audience and missing legal line, plus clean look-alikes",
    () => {
      for (const seed of SEEDS) {
        const sc = screen(seed);
        const q = readQa(sc);
        expect(q.rows.length, seed).toBe(12);
        expect(q.rows.map((r) => r.issues.length).filter((n) => n > 1), seed).toEqual([]);
        expect(q.rows.flatMap((r) => r.issues).sort(), seed).toEqual(["code", "early", "legal", "price", "suppressed", "tag"]);
        const clean = q.rows.filter((r) => !r.issues.length);
        expect(clean.some((r) => r.when === q.newLaunch), `${seed} send exactly at launch`).toBe(true);
        expect(clean.some((r) => r.code !== q.code), `${seed} code in another case`).toBe(true);
        expect(clean.some((r) => !r.tag.startsWith("utm_source")), `${seed} tag in another order`).toBe(true);
        expect(clean.some((r) => q.suppressed.some((s) => r.audience.includes(s))), `${seed} suppressed segment excluded`).toBe(true);
        // Before the launch moved, the early asset looked fine: it's at or after the original time.
        const early = q.rows.find((r) => r.issues.includes("early"))!;
        expect(early.when).toBeGreaterThanOrEqual(q.oldLaunch);
        const k = scenario.generate(seed).keys["launch-qa"] as ReviewKey;
        const findingFor: Record<string, string> = { code: "wrong_code", price: "wrong_price", tag: "wrong_tag", early: "too_early", suppressed: "suppressed", legal: "no_legal" };
        for (const [issue, finding] of Object.entries(findingFor)) {
          expect(k.findings[finding], `${seed} ${issue}`).toMatchObject({ targets: [q.rows.find((r) => r.issues.includes(issue))!.id], reasons: [issue] });
        }
        expect(sc.doc("launch-qa").decision!.options.find((o) => o.id === k.decision![0])!.label).toMatch(/^Hold the flagged assets/);
      }
    },
    LONG,
  );
});

describe("marketing-saltbox-launch: desk", () => {
  it("invoice: hours over the cap, a rate off the card, out-of-scope work with no change order and a line that doesn't multiply", () => {
    for (const seed of SEEDS) {
      const sc = screen(seed);
      const inv = readInvoice(sc);
      expect(inv.rows.length, seed).toBe(8);
      expect(inv.overCap, seed).toBe(true);
      expect(inv.rows.map((r) => r.issues.length).filter((n) => n > 1), seed).toEqual([]);
      expect(inv.rows.flatMap((r) => r.issues).sort(), seed).toEqual(["math", "rate", "scope"]);
      // Look-alikes: out-of-scope work with a signed change order; fractional hours that multiply.
      expect(inv.rows.some((r) => !r.inScope && !r.issues.length), seed).toBe(true);
      expect(inv.rows.some((r) => !Number.isInteger(r.hours) && !r.issues.length), seed).toBe(true);
      const k = scenario.generate(seed).keys["invoice-check"] as ReviewKey;
      const at = (issue: string) => inv.rows.find((r) => r.issues.includes(issue))!.id;
      expect(k.findings.over_cap).toMatchObject({ reasons: ["cap"] });
      expect(k.findings.over_cap.targets).toContain("total_hours");
      expect(k.findings.off_card_rate).toMatchObject({ targets: [at("rate")], reasons: ["rate"] });
      expect(k.findings.no_change_order).toMatchObject({ targets: [at("scope")], reasons: ["scope"] });
      expect(k.findings.bad_extension).toMatchObject({ targets: [at("math")], reasons: ["math"] });
      expect(sc.doc("invoice-check").decision!.options.find((o) => o.id === k.decision![0])!.label).toMatch(/^Return it to .+ copying .+ in finance$/);
    }
  });

  it("A/B: the call follows the test plan, including big lifts on too small a sample, and the lift is keyed to one decimal", () => {
    const calls = new Map<string, number>();
    let bigButShort = 0;
    for (const seed of SEEDS) {
      const sc = screen(seed);
      const ab = readAb(sc);
      calls.set(ab.call, (calls.get(ab.call) ?? 0) + 1);
      if (ab.call === "run" && ab.lift >= ab.liftMin) bigButShort++;
      const keys = scenario.generate(seed).keys;
      expect((keys["ab-readout"] as McKey).correct, seed).toEqual([oneOption(sc.mc("ab-readout"), AB_OPTION[ab.call])]);
      const k = keys["ab-lift"] as NumKey;
      expect(k.value, seed).toBe(r1(ab.lift));
      expect(k.tolerance).toBe(0.05);
      expect(k.partialTolerance).toBe(0.3);
      // No borderline calls: the lift is clear of the plan's minimum.
      if (ab.call !== "run") expect(Math.abs(ab.lift - ab.liftMin), seed).toBeGreaterThan(1);
    }
    expect([...calls.keys()].sort()).toEqual(["keep", "run", "ship"]);
    expect(bigButShort).toBeGreaterThan(40);
  });

  it("values calls: four options, one right, the right one in every position across seeds", () => {
    const places = Object.fromEntries(VALUES_STEPS.map((id) => [id, new Set<string>()]));
    for (const seed of SEEDS) {
      const sc = screen(seed);
      const keys = scenario.generate(seed).keys;
      for (const id of VALUES_STEPS) {
        const mc = sc.mc(id);
        expect(mc.select).toBe("single");
        expect(mc.options.map((o) => o.id)).toEqual(["a", "b", "c", "d"]);
        expect(new Set(mc.options.map((o) => o.label)).size).toBe(4);
        const right = oneOption(mc, VALUES_RIGHT[id]);
        expect((keys[id] as McKey).correct, `${seed} ${id}`).toEqual([right]);
        places[id].add(right);
      }
      // The candor call is about the candidate's own mistake, reported by a colleague, on every seed.
      expect(sc.msg("m-candor").body).toMatch(/you scheduled this morning .* last month's code/);
    }
    for (const id of VALUES_STEPS) expect(places[id].size, id).toBe(4);
  });
});

describe("marketing-saltbox-launch: scoring", () => {
  it("out of 100: rapid rounds 10 each, report 20, QA 20, invoice 12, A/B 4 + 4, values 2 each", () => {
    const blank = scoreAttempt(scenario, "abc", {});
    expect(blank.points).toBe(0);
    expect(blank.maxPoints).toBe(MAX);
    const max = (id: string) => blank.steps[id].maxPoints;
    expect(RAPID_STEPS.map(max)).toEqual([10, 10, 10]);
    expect(max("campaign-report")).toBe(20);
    expect(max("launch-qa")).toBe(20);
    expect(max("invoice-check")).toBe(12);
    expect([max("ab-readout"), max("ab-lift")]).toEqual([4, 4]);
    expect(VALUES_STEPS.map(max)).toEqual([2, 2, 2, 2, 2]);
  });

  it("blank scores 0 and the maximum is 100 for every seed", () => {
    for (const seed of SEEDS) {
      const s = scoreAttempt(scenario, seed, {});
      expect(s.points, seed).toBe(0);
      expect(s.maxPoints, seed).toBe(MAX);
    }
  });

  it(
    "a perfect answer, built only from the screen, scores 100 for every seed with nothing left for review",
    () => {
      for (const seed of SEEDS) {
        const s = scoreAttempt(scenario, seed, perfectAnswers(seed));
        for (const [id, step] of Object.entries(s.steps)) {
          expect(step.points, `${seed} ${id}`).toBe(step.maxPoints);
          expect(step.needsReview, `${seed} ${id}`).toBeFalsy();
        }
        expect(s.points, seed).toBe(MAX);
      }
    },
    LONG,
  );

  it("another seed's perfect answer doesn't score well (answers can't be shared)", () => {
    let shared = 0;
    for (let i = 0; i < 40; i++) shared += scoreAttempt(scenario, SEEDS[i + 1], perfectAnswers(SEEDS[i])).points;
    expect(shared / 40).toBeLessThan(40);
  });

  describe("each trap answered wrongly costs exactly its points", () => {
    const seeds = SEEDS.slice(0, 40);
    const points = (seed: string, a: unknown) => scoreAttempt(scenario, seed, a as Record<string, unknown>).points;
    const lost = (seed: string, mutate: (a: Answers & Record<string, unknown>) => void) => {
      const a = clone(perfectAnswers(seed));
      mutate(a);
      return points(seed, perfectAnswers(seed)) - points(seed, a);
    };
    const dropFlag = (stepId: ReviewStepId, reason: string) => (a: Answers & Record<string, unknown>) => {
      const step = a[stepId] as { flags: Flag[] };
      const target = step.flags.find((f) => f.reason === reason);
      expect(target).toBeDefined();
      step.flags = step.flags.filter((f) => f !== target);
    };
    const reReason = (stepId: ReviewStepId, reason: string, to: string) => (a: Answers & Record<string, unknown>) => {
      (a[stepId] as { flags: Flag[] }).flags.find((x) => x.reason === reason)!.reason = to;
    };

    const cases: [string, ReviewStepId, string, number][] = [
      ["wrong promo code", "launch-qa", "code", 3],
      ["wrong price", "launch-qa", "price", 3],
      ["wrong or missing campaign tag", "launch-qa", "tag", 3],
      ["scheduled before the moved launch", "launch-qa", "early", 3],
      ["suppressed segment in the audience", "launch-qa", "suppressed", 3],
      ["missing legal line", "launch-qa", "legal", 3],
      ["hours over the cap", "invoice-check", "cap", 2.5],
      ["rate off the card", "invoice-check", "rate", 2.5],
      ["out of scope, no change order", "invoice-check", "scope", 2.5],
      ["extension that doesn't multiply", "invoice-check", "math", 2.5],
    ];
    for (const [name, stepId, reason, pts] of cases) {
      it(`${name} missed: loses ${pts}; spotted with the wrong reason: loses half`, () => {
        for (const seed of seeds) {
          expect(lost(seed, dropFlag(stepId, reason)), `${seed} ${name}`).toBe(pts);
          expect(lost(seed, reReason(stepId, reason, "other")), `${seed} ${name} wrong reason`).toBe(pts / 2);
        }
      }, LONG);
    }

    it("the cap is also found when flagged on the SOW's cap instead of the total", () => {
      for (const seed of seeds) {
        expect(
          lost(seed, (a) => {
            (a["invoice-check"] as { flags: Flag[] }).flags.find((f) => f.reason === "cap")!.target = "sow_cap";
          }),
        ).toBe(0);
      }
    }, LONG);

    it("flagging a clean look-alike costs the false-flag penalty", () => {
      for (const seed of seeds) {
        const sc = screen(seed);
        const q = readQa(sc);
        const exact = q.rows.find((r) => !r.issues.length && r.when === q.newLaunch)!;
        const caseCode = q.rows.find((r) => !r.issues.length && r.code !== q.code)!;
        expect(lost(seed, (a) => (a["launch-qa"] as { flags: Flag[] }).flags.push({ target: exact.id, reason: "early", note: "" }))).toBe(1);
        expect(lost(seed, (a) => (a["launch-qa"] as { flags: Flag[] }).flags.push({ target: caseCode.id, reason: "code", note: "" }))).toBe(1);
        const co = readInvoice(sc).rows.find((r) => !r.inScope && !r.issues.length)!;
        expect(lost(seed, (a) => (a["invoice-check"] as { flags: Flag[] }).flags.push({ target: co.id, reason: "scope", note: "" }))).toBe(1);
      }
    }, LONG);

    it("the wrong decision on the queue or the invoice costs 2", () => {
      for (const seed of seeds) {
        const sc = screen(seed);
        const approve = oneOption(sc.doc("launch-qa").decision!, /^Approve the whole queue/);
        const fixLive = oneOption(sc.doc("launch-qa").decision!, /^Fix the flagged assets myself/);
        const pay = oneOption(sc.doc("invoice-check").decision!, /^Approve it as billed/);
        expect(lost(seed, (a) => (a["launch-qa"].decision = approve))).toBe(2);
        expect(lost(seed, (a) => (a["launch-qa"].decision = fixLive))).toBe(2);
        expect(lost(seed, (a) => (a["invoice-check"].decision = pay))).toBe(2);
      }
    }, LONG);

    it("report: double counting, ignoring the correction or using gross revenue costs exactly the cells it changes", () => {
      for (const seed of seeds) {
        const sc = screen(seed);
        const right = readReport(sc).cells;
        const key = scenario.generate(seed).keys["campaign-report"] as SheetKey;
        const weight = (id: string) => (["total_net", "blended_cpa", "blended_roas"].includes(id) ? 2 : 1);
        for (const mistake of [{ dedupe: false }, { revise: false }, { net: false }]) {
          const wrong = readReport(sc, mistake).cells;
          const changed = Object.keys(right).filter((id) => Math.abs(wrong[id] - key.cells[id].value) > 0.01 + 1e-9);
          const cost = changed.reduce((s, id) => s + weight(id), 0);
          expect(changed.length, `${seed} ${JSON.stringify(mistake)}`).toBeGreaterThan(0);
          expect(lost(seed, (a) => (a["campaign-report"].cells = wrong)), `${seed} ${JSON.stringify(mistake)}`).toBe(cost);
        }
        // Counting the relaunch twice always costs its channel's net revenue and the total.
        const doubled = readReport(sc, { dedupe: false }).cells;
        expect(Math.abs(doubled.total_net - right.total_net)).toBeGreaterThan(1);
      }
    }, LONG);

    it("A/B: the wrong call costs 4; a lift off by a rounding slip earns half, further off earns nothing", () => {
      for (const seed of seeds) {
        const sc = screen(seed);
        const ab = readAb(sc);
        const wrongCall = oneOption(sc.mc("ab-readout"), /^Ship B to everyone now/);
        expect(lost(seed, (a) => (a["ab-readout"].selected = [wrongCall]))).toBe(4);
        expect(lost(seed, (a) => (a["ab-lift"].value = r1(ab.lift) + 0.2))).toBe(2);
        expect(lost(seed, (a) => (a["ab-lift"].value = r1(ab.lift) + 1))).toBe(4);
      }
    }, LONG);

    it("values: any of the three tempting options costs the call's 2 points", () => {
      for (const seed of seeds) {
        const sc = screen(seed);
        for (const id of VALUES_STEPS) {
          const right = oneOption(sc.mc(id), VALUES_RIGHT[id]);
          for (const o of sc.mc(id).options.filter((x) => x.id !== right)) {
            expect(lost(seed, (a) => ((a[id] as { selected: string[] }).selected = [o.id])), `${seed} ${id}`).toBe(2);
          }
        }
      }
    }, LONG);
  });
});

describe("marketing-saltbox-launch: nothing from the key reaches the candidate", () => {
  it(
    "no reviewer note, key word, report figure or lift in any payload",
    () => {
      for (const seed of SEEDS) {
        const variant = scenario.generate(seed);
        const notes = REVIEW_STEPS.flatMap((id) => Object.values((variant.keys[id] as ReviewKey).findings).map((f) => f.note!));
        for (const n of notes) expect(n.length).toBeGreaterThan(10);
        const numbers = [...Object.values((variant.keys["campaign-report"] as SheetKey).cells).map((c) => c.value), (variant.keys["ab-lift"] as NumKey).value];
        const payloads = [0, 20, 40, END].map((minute) => JSON.stringify(renderAttemptForCandidate(scenario, seed, minute)));
        payloads.push(JSON.stringify(RAPID_STEPS.map((id) => rapidItems(seed, id))));
        for (const payload of payloads) {
          expect(payload).not.toMatch(/"keys"|tolerance|"criteria"|"guidance"|"notes"|"points"|"expected"|"findings"|"clean":|"correct"/);
          for (const n of notes) expect(payload, seed).not.toContain(n);
          for (const c of numbers.filter((x) => x >= 1)) {
            const forms = [String(c), c.toFixed(2), String(Math.round(c * 100)), c.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })];
            for (const f of forms.filter((x) => !/^\d{1,3}$/.test(x))) {
              expect(payload, `${seed} ${f}`).not.toMatch(new RegExp(`(?<![\\d.,])${f.replace(/[.$]/g, "\\$&")}(?![\\d.]\\d)`));
            }
          }
        }
      }
    },
    LONG,
  );
});

describe("marketing-saltbox-launch: timed sections", () => {
  const def = scenario.definition;
  const MIN = 60_000;
  const t0 = Date.parse("2026-11-16T09:00:00Z");
  const flowAt = (ms: number) => resolveFlow(def, { startedAt: t0, now: t0 + ms, extraTimePercent: 0, events: [] });
  const stepById = (id: string) => def.steps.find((s) => s.id === id)!;

  it("validateSections passes and the sections fill the time limit exactly", () => {
    expect(validateSections(def, scenario.timeLimitMinutes)).toEqual([]);
    expect(def.sections!.reduce((t, s) => t + s.minutes, 0)).toBe(scenario.timeLimitMinutes);
  });

  it("six sections with the shared ids: rapid, report, rapid, QA, rapid, desk", () => {
    expect(def.sections!.map((s) => [s.id, s.minutes, s.stepIds, !!s.oneAtATime])).toEqual([
      ["s-rapid-a", 6, ["rapid-metrics"], false],
      ["s-work-1", 10, ["campaign-report"], false],
      ["s-rapid-b", 6, ["rapid-copy"], false],
      ["s-work-2", 10, ["launch-qa"], false],
      ["s-rapid-c", 6, ["rapid-budget"], false],
      ["s-desk", 12, DESK, true],
    ]);
  });

  it("one-at-a-time screens add up to their section: invoice 270 s, A/B 75 + 75 s, values 60 s each", () => {
    for (const sec of def.sections!.filter((s) => s.oneAtATime)) {
      expect(sec.stepIds.reduce((t, id) => t + stepById(id).seconds!, 0), sec.id).toBe(sec.minutes * 60);
    }
    expect(DESK.map((id) => stepById(id).seconds)).toEqual([270, 75, 75, 60, 60, 60, 60, 60]);
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

  it("runs the sections back to back", () => {
    const at = (min: number) => flowAt(min * MIN);
    expect(at(0).visibleStepIds).toEqual(["rapid-metrics"]);
    expect(at(6).visibleStepIds).toEqual(["campaign-report"]);
    expect(at(16).visibleStepIds).toEqual(["rapid-copy"]);
    expect(at(22).visibleStepIds).toEqual(["launch-qa"]);
    expect(at(32).visibleStepIds).toEqual(["rapid-budget"]);
    expect(at(38).visibleStepIds).toEqual(["invoice-check"]);
    expect(at(END).done).toBe(true);
  });

  it("cards are there from the start; briefs arrive when their section opens; the two mid-task changes four minutes in", () => {
    const ids = new Set(def.steps.map((s) => s.id));
    for (const m of def.messages) if (m.stepId) expect(ids.has(m.stepId), m.id).toBe(true);
    const msgsAt = (min: number) => visibleMessageIds(def, flowAt(min * MIN), t0, t0 + min * MIN);
    const cards = ["card-launch", "card-brand", "card-reporting", "card-tests", "card-sow"];
    expect(msgsAt(0)).toEqual([...cards, "m-metrics"]);
    expect(msgsAt(9)).toEqual([...cards, "m-metrics", "m-report"]);
    expect(msgsAt(10)).toContain("m-report-fix");
    expect(msgsAt(25)).not.toContain("m-qa-move");
    expect(msgsAt(26)).toContain("m-qa-move");
    expect(msgsAt(38).length).toBe(def.messages.length);
  });

  it("the flow renders each rapid item exactly as sequence.renderItem does", () => {
    for (const id of RAPID_STEPS) {
      const items = rapidItems("abc", id);
      for (const index of [0, 5, 14]) {
        const view = renderFlowForCandidate(scenario, "abc", {
          stepIds: [id],
          messages: [],
          sequences: { [id]: { index, count: 15, endsAt: "2026-11-16T09:00:20.000Z" } },
        });
        const cfg = view.steps[0].config as { itemCount: number; current: { item: RapidItem } };
        expect(cfg.current.item).toEqual(items[index]);
        expect(JSON.stringify(cfg)).not.toMatch(/"items"|choice"|tolerance|points/);
      }
    }
  });
});

describe("marketing-saltbox-launch: rapid rounds", () => {
  it(
    "every item over 200 seeds has one right answer, found from the exhibit alone, matching the key",
    () => {
      for (const seed of SEEDS) {
        const keys = scenario.generate(seed).keys;
        for (const id of RAPID_STEPS) {
          const key = keys[id] as RapidKey;
          const solved = solveRapid(seed, id);
          expect(Object.keys(key.items).sort()).toEqual(solved.map((s) => s.item.id).sort());
          for (const s of solved) {
            expect(s.item.fields.map((f) => f.id)).toEqual(["answer"]);
            expect(key.items[s.item.id].answer.choice, `${seed} ${s.item.id} (${s.kind}: ${s.item.prompt})`).toBe(s.values.answer);
          }
        }
      }
    },
    LONG,
  );

  it("ten quick items worth half a point and five harder ones worth one, in every round", () => {
    for (const id of RAPID_STEPS) {
      const pts = rapidConfig(id).items.map((i) => i.points);
      expect(pts.filter((p) => p === 0.5).length, id).toBe(10);
      expect(pts.filter((p) => p === 1).length, id).toBe(5);
      for (const seed of SEEDS.slice(0, 50)) {
        solveRapid(seed, id).forEach((s, i) => {
          expect(HARD_KINDS[id].includes(s.kind), `${seed} ${id} item ${i} ${s.kind}`).toBe(pts[i] === 1);
        });
      }
    }
  });

  it("covers every kind the brief asks for", () => {
    const kinds = Object.fromEntries(RAPID_STEPS.map((id) => [id, new Set<string>()]));
    for (const seed of SEEDS.slice(0, 50)) for (const id of RAPID_STEPS) for (const s of solveRapid(seed, id)) kinds[id].add(s.kind);
    expect([...kinds["rapid-metrics"]].sort()).toEqual(["blended_cpa", "blended_roas", "change", "conversion rate", "cpa", "cpc", "cpm", "ctr", "pacing"]);
    expect([...kinds["rapid-copy"]].sort()).toEqual(["claim", "code", "disclosure", "fine", "legal", "name", "price", "two", "weekday"]);
    expect([...kinds["rapid-budget"]].sort()).toEqual(["daily", "fee", "fee_gross", "forecast", "po", "realloc_orders", "realloc_share", "remaining"]);
  });

  it("the budget round picks up the corrected spend from the channel report", () => {
    for (const seed of SEEDS.slice(0, 50)) {
      const sc = screen(seed);
      const channel = line(sc.msg("m-report-fix").body, /\((.+)\) is/)[1];
      const item = rapidItems(seed, "rapid-budget").find((i) => i.exhibit?.rows?.some((r) => /^Launch week \(revised by /.test(r.label)));
      expect(item, seed).toBeDefined();
      expect(item!.exhibit!.title).toBe(`${channel} · month to date`);
    }
  });

  it("varies per seed: which item comes when and where the right option sits", () => {
    for (const id of RAPID_STEPS) {
      const firsts = SEEDS.slice(0, 60).map((seed) => solveRapid(seed, id)[0]);
      expect(new Set(firsts.map((s) => JSON.stringify(s.item))).size, id).toBeGreaterThan(40);
      expect(new Set(firsts.map((s) => JSON.stringify(s.values))).size, id).toBe(4);
    }
  });

  it("option ids are fixed per item, so an id can't hint at the answer", () => {
    for (const id of RAPID_STEPS) {
      const ids = (seed: string) => rapidItems(seed, id).map((i) => i.fields.map((f) => [f.id, (f as RapidChoiceField).options.map((o) => o.id)]));
      const first = JSON.stringify(ids(SEEDS[0]));
      for (const seed of SEEDS.slice(1, 30)) expect(JSON.stringify(ids(seed)), `${id} ${seed}`).toBe(first);
    }
  });

  it("a wrong item costs its points", () => {
    const seed = "abc";
    const perfect = scoreAttempt(scenario, seed, perfectAnswers(seed));
    for (const id of RAPID_STEPS) {
      const a = clone(perfectAnswers(seed)) as unknown as Record<string, { items: Record<string, unknown> }>;
      const hard = rapidConfig(id).items.findIndex((i) => i.points === 1);
      const easy = rapidConfig(id).items.findIndex((i) => i.points === 0.5);
      delete a[id].items[rapidConfig(id).items[hard].id];
      delete a[id].items[rapidConfig(id).items[easy].id];
      expect(perfect.steps[id].points - scoreAttempt(scenario, seed, a).steps[id].points, id).toBe(1.5);
    }
  });
});
