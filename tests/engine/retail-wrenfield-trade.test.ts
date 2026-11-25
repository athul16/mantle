import { describe, expect, it, vi } from "vitest";
import type { RapidChoiceField, RapidItem } from "@/lib/engine/step-types/rapid_round/public";
import type { PublicCell, SpreadsheetPublicConfig } from "@/lib/engine/step-types/spreadsheet/public";

vi.mock("server-only", () => ({}));

const { retailWrenfieldTrade } = await import("@/lib/engine/scenarios/retail-wrenfield-trade");
const { getScenario, listScenarios } = await import("@/lib/engine/scenarios");
const { renderAttemptForCandidate, renderFlowForCandidate } = await import("@/lib/engine/server/render");
const { scoreAttempt } = await import("@/lib/engine/server/score");
const { resolveFlow, visibleMessageIds, validateSections } = await import("@/lib/engine/server/flow");
const { rapidRoundServer } = await import("@/lib/engine/step-types/rapid_round/server");
const { fillTemplate, templateValues } = await import("@/lib/engine/server/template");

/**
 * Assistant buyer at Wrenfield & Co.: three rapid rounds (retail maths, line
 * actions, pricing), a trade report, a PO confirmation check and a desk
 * (open-to-buy, critical path, five values calls), 50 minutes, 100 points.
 * Every task is solved here from what the candidate sees, with an independent
 * reading of Wrenfield's cards, then compared with the server key.
 */

const scenario = retailWrenfieldTrade;
const SEEDS = Array.from({ length: 200 }, (_, i) => `attempt-${i.toString(16).padStart(4, "0")}`);
const END = scenario.timeLimitMinutes;
const MAX = 100;
const RAPID_STEPS = ["rapid-retail-math", "rapid-actions", "rapid-pricing"] as const;
type RapidStepId = (typeof RAPID_STEPS)[number];
const VALUES_STEPS = ["values-integrity", "values-candor", "values-client-care", "values-in-lane", "values-quality"] as const;
type ValuesStepId = (typeof VALUES_STEPS)[number];
const LONG = 180_000;

type Field = { id: string; label: string; value: string };
type Doc = {
  prompt: string;
  document: { title: string; fields: Field[]; columns: string[]; rows: { id: string; cells: string[] }[]; totals: Field[]; footnote?: string };
  reasons: { id: string; label: string }[];
  decision?: { prompt: string; options: { id: string; label: string }[] };
};
type Mc = { prompt: string; options: { id: string; label: string }[]; select: "single" | "multi" };
type Ord = { prompt: string; items: { id: string; label: string }[] };
type ReviewKey = { findings: Record<string, { targets: string[]; reasons: string[]; note?: string }>; decision?: string[] };
type McKey = { correct: string[] };
type SheetKey = { tolerance?: number; cells: Record<string, { value: number; tolerance?: number }> };
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
  return {
    view,
    step,
    msg,
    doc: () => step("po-check").config as Doc,
    mc: (id: ValuesStepId) => step(id).config as Mc,
    sheet: (id: "trade-report" | "open-to-buy") => step(id).config as SpreadsheetPublicConfig,
    ord: () => step("critical-path").config as Ord,
  };
}
type Screen = ReturnType<typeof screen>;

const text = (c: PublicCell) => (c.kind === "text" ? c.text : "");
const inputId = (c: PublicCell) => (c.kind === "input" ? c.id : null);
/** "1,234" → 1234 */
const int = (s: string) => {
  expect(s, `count "${s}"`).toMatch(/^\d{1,3}(,\d{3})*$/);
  return Number(s.replace(/,/g, ""));
};
/** "$1,234.56" → cents */
const cents = (s: string) => {
  const m = s.match(/^\$(\d{1,3}(?:,\d{3})*)\.(\d{2})/);
  expect(m, `money "${s}"`).not.toBeNull();
  return Number(m![1].replace(/,/g, "")) * 100 + Number(m![2]);
};
/** "$48,300" or "-$4,800" → dollars */
const wholeDollars = (s: string) => {
  const m = s.match(/^(-?)\$(\d{1,3}(?:,\d{3})*)$/);
  expect(m, `dollars "${s}"`).not.toBeNull();
  return (m![1] ? -1 : 1) * Number(m![2].replace(/,/g, ""));
};
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
/** "Mon, Mar 2, 2026" → epoch day; also checks the weekday printed matches the date. */
function day(label: string): number {
  const m = label.trim().match(/^(\w{3}), (\w{3}) (\d{1,2}), (\d{4})$/);
  expect(m, `date "${label}"`).not.toBeNull();
  const t = Date.UTC(Number(m![4]), MONTHS.indexOf(m![2]), Number(m![3]));
  expect(WEEKDAYS[new Date(t).getUTCDay()], `weekday of ${label}`).toBe(m![1]);
  return t / 86_400_000;
}
function oneOption(cfg: { options: { id: string; label: string }[] }, re: RegExp) {
  const o = cfg.options.filter((x) => re.test(x.label));
  expect(o.length, `one option like ${re}`).toBe(1);
  return o[0].id;
}

// ---- Trade report ----

const TR_COLUMNS = ["Line", "On sale from", "Received", "Units sold", "Customer returns", "On hand", "Cost", "Price", "Sell-through %", "Weeks of cover"];

/** The report as shown, the store's adjustment and the promotion note, applied by the card. */
function readTradeReport(sc: Screen) {
  const sheet = sc.sheet("trade-report");
  expect(sheet.columns).toEqual(TR_COLUMNS);
  expect(sheet.rows.length).toBe(14);
  const lines = sheet.rows.slice(0, 12).map((r) => {
    const from = text(r[1]).match(/^Wk (\d)$/);
    expect(from, text(r[1])).not.toBeNull();
    return {
      name: text(r[0]),
      weeks: 8 - Number(from![1]) + 1,
      rec: int(text(r[2])),
      sold: int(text(r[3])),
      ret: int(text(r[4])),
      oh: int(text(r[5])),
      cost: cents(text(r[6])),
      price: cents(text(r[7])),
      st: inputId(r[8]),
      cov: inputId(r[9]),
    };
  });
  expect(new Set(lines.map((l) => l.name)).size).toBe(12);
  for (const l of lines) expect(l.oh, l.name).toBe(l.rec - l.sold + l.ret);
  expect(lines.filter((l) => l.st).length).toBe(8);
  expect(inputId(sheet.rows[12][8])).toBe("dept_margin");
  expect(inputId(sheet.rows[13][8])).toBe("dept_st");

  const note = sheet.prompt.match(/Note: (.+) was on promotion at (\$[\d,.]+) \((\d+)% off\) from wk (\d); ([\d,]+) of its units sold were at the promotional price/);
  expect(note, "promotion note").not.toBeNull();
  const promo = { line: note![1], price: cents(note![2]), units: int(note![5]) };
  expect(lines.some((l) => l.name === promo.line)).toBe(true);
  const adj = sc.msg("m-adjust").body.match(/: ([\d,]+) units of (.+) were damaged in the stockroom and have been written off/);
  expect(adj, "adjustment").not.toBeNull();
  const adjust = { units: int(adj![1]), line: adj![2] };
  const adjRow = lines.find((l) => l.name === adjust.line);
  expect(adjRow?.st, "the adjusted line has boxes").toBeTruthy();
  return { lines, promo, adjust };
}
type TradeReport = ReturnType<typeof readTradeReport>;

interface TrOptions {
  ignoreAdjust?: boolean;
  ignoreLaunch?: boolean;
  grossOnLines?: boolean;
  ignorePromo?: boolean;
}
/** The candidate's entries: % to two decimals, cover to one, as the card asks. */
function solveTradeReport(tr: TradeReport, o: TrOptions = {}) {
  const cells: Record<string, number> = {};
  let sumNet = 0;
  let sumOh = 0;
  let sales = 0;
  let cos = 0;
  for (const l of tr.lines) {
    const net = l.sold - l.ret;
    const oh = l.oh - (!o.ignoreAdjust && l.name === tr.adjust.line ? tr.adjust.units : 0);
    sumNet += net;
    sumOh += oh;
    const promoUnits = !o.ignorePromo && l.name === tr.promo.line ? tr.promo.units : 0;
    sales += (net - promoUnits) * l.price + promoUnits * tr.promo.price;
    cos += net * l.cost;
    if (!l.st) continue;
    const sold = o.grossOnLines ? l.sold : net;
    const weeks = o.ignoreLaunch ? 8 : l.weeks;
    cells[l.st] = Number(((100 * sold) / (sold + oh)).toFixed(2));
    cells[l.cov!] = Number((oh / (sold / weeks)).toFixed(1));
  }
  cells.dept_margin = Number(((100 * (sales - cos)) / sales).toFixed(2));
  cells.dept_st = Number(((100 * sumNet) / (sumNet + sumOh)).toFixed(2));
  return cells;
}

// ---- Open-to-buy ----

function readOtb(sc: Screen) {
  const sheet = sc.sheet("open-to-buy");
  expect(sheet.columns).toEqual(["", "Sep", "Oct", "Nov", "Quarter"]);
  const row = (label: string) => {
    const r = sheet.rows.find((x) => text(x[0]) === label);
    expect(r, label).toBeDefined();
    return [1, 2, 3].map((i) => wholeDollars(text(r![i])));
  };
  const [sales, md, close, open, oo] = ["Planned sales", "Planned markdowns", "Planned closing stock", "Opening stock", "On order"].map(row);
  expect(open[1]).toBe(close[0]);
  expect(open[2]).toBe(close[1]);
  const otbRow = sheet.rows[sheet.rows.length - 1];
  expect(otbRow.slice(1).map(inputId)).toEqual(["otb_sep", "otb_oct", "otb_nov", "otb_quarter"]);
  const m = sc.msg("m-otb").body.match(/the (Sep|Oct|Nov) on-order figure still includes the (\$[\d,]+) order we cancelled/);
  expect(m, "cancelled order").not.toBeNull();
  return { sales, md, close, open, oo, cancelMonth: ["Sep", "Oct", "Nov"].indexOf(m![1]), cancelled: wholeDollars(m![2]) };
}
function solveOtb(o: ReturnType<typeof readOtb>, keepCancelled = false) {
  const month = [0, 1, 2].map((i) => o.sales[i] + o.md[i] + o.close[i] - o.open[i] - (o.oo[i] - (!keepCancelled && i === o.cancelMonth ? o.cancelled : 0)));
  return { otb_sep: month[0], otb_oct: month[1], otb_nov: month[2], otb_quarter: month[0] + month[1] + month[2] };
}

// ---- PO check ----

function readPo(sc: Screen) {
  const doc = sc.doc();
  expect(doc.document.columns).toEqual(["PO", "Supplier", "Line", "Product type", "Ordered", "Confirmed", "Carton", "Agreed cost", "Confirmed cost", "Delivery to DC", "Test certificate"]);
  const field = (id: string) => doc.document.fields.find((f) => f.id === id)!.value;
  const latest = day(field("latest").match(/\(DC\): (.+?)\. Delivery/)![1]);
  const card = field("compliance").replace(/\. No shipment.*$/, "");
  const needs = new Map(card.split("; ").map((e) => [e.slice(0, e.indexOf(": ")), e.slice(e.indexOf(": ") + 2) !== "no test required"]));
  const arrived = sc.msg("m-cert").body.match(/certificate for PO (\d+)/)![1];
  const seen: string[] = [];
  const rows = doc.document.rows.map((r) => {
    const [po, , , type, ord, conf, carton, agreed, confcost, dc, cert] = r.cells;
    expect(needs.has(type), type).toBe(true);
    const issues: string[] = [];
    if (Math.abs(cents(confcost) - cents(agreed)) > 1) issues.push("cost");
    if (int(conf) !== int(ord)) issues.push("qty");
    if (day(dc) > latest) issues.push("late");
    if (int(ord) % Number(carton) !== 0) issues.push("carton");
    if (needs.get(type) && cert !== "On file" && po !== arrived) issues.push("cert");
    const sig = r.cells.slice(1).join("|");
    if (seen.includes(sig)) issues.push("duplicate");
    seen.push(sig);
    return { id: r.id, po, issues, onDate: day(dc) === latest, rounding: Math.abs(cents(confcost) - cents(agreed)) === 1, type, cert };
  });
  return { rows, needs, arrived };
}

// ---- Critical path ----

const CP_ORDER = [/^Approve the design sample/, /^Raise the purchase order/, /^Approve the pre-production sample/, /^Bulk production/, /^Compliance test on production units/, /^Ship from the factory/, /^Delivered to the distribution centre/, /^On shelf in stores/];
function solveCriticalPath(sc: Screen) {
  const items = sc.ord().items;
  return CP_ORDER.map((re) => {
    const hit = items.filter((i) => re.test(i.label));
    expect(hit.length, `${re}`).toBe(1);
    return hit[0].id;
  });
}

// ---- Values calls ----

const VALUES_RIGHT: Record<ValuesStepId, RegExp> = {
  "values-integrity": /^Decline politely, citing the policy/,
  "values-candor": /^Thank .+, tell .+ now, and get the PO amended/,
  "values-client-care": /quotes are confidential/,
  "values-in-lane": /^Don't agree on the call/,
  "values-quality": /^Hold the shipment until the certificate is on file/,
};
const VALUES_SHORTCUT: Record<ValuesStepId, RegExp> = {
  "values-integrity": /^Accept, and pay/,
  "values-candor": /^Amend the PO quietly/,
  "values-client-care": /^Forward/,
  "values-in-lane": /^Agree it on the call/,
  "values-quality": /^Let it ship/,
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

type RapidKey = { items: Record<string, Record<string, { choice?: string }>> };
type Solved = { values: Record<string, string>; kind: string };

const choiceField = (item: RapidItem) => {
  const f = item.fields.find((x) => x.id === "answer") as RapidChoiceField | undefined;
  expect(f, `${item.id} answer`).toBeDefined();
  expect(f!.options.length).toBe(4);
  return f!;
};
const row = (item: RapidItem, label: string | RegExp) => {
  const r = item.exhibit?.rows?.find((x) => (typeof label === "string" ? x.label === label : label.test(x.label)));
  expect(r, `${item.id} row ${label}`).toBeDefined();
  return r!.value;
};
const hasRow = (item: RapidItem, label: string) => !!item.exhibit?.rows?.some((x) => x.label === label);
/** The one option whose number is within `within` of the answer; the others must be well clear. */
function closest(item: RapidItem, value: number, parse: (label: string) => number, within: number) {
  const opts = choiceField(item).options.map((o) => ({ id: o.id, n: parse(o.label) }));
  const hits = opts.filter((o) => Math.abs(o.n - value) <= within);
  expect(hits.length, `${item.id}: one option near ${value} in ${JSON.stringify(opts)}`).toBe(1);
  return hits[0].id;
}
function byLabel(item: RapidItem, label: string) {
  const hits = choiceField(item).options.filter((o) => o.label === label);
  expect(hits.length, `${item.id}: one option "${label}"`).toBe(1);
  return hits[0].id;
}
const pctOf = (s: string) => {
  expect(s).toMatch(/^-?\d+\.\d%$/);
  return Number(s.slice(0, -1));
};
const weeksOf = (s: string) => {
  expect(s).toMatch(/^\d+\.\d weeks$/);
  return Number(s.split(" ")[0]);
};
const unitsOf = (s: string) => int(s.replace(/ units$/, ""));
const pick = (item: RapidItem, kind: string, id: string): Solved => ({ kind, values: { answer: id } });
const lead$ = (s: string) => cents(s.split(" ")[0]);
const offOf = (s: string) => Number(s.match(/(\d+)% off/)![1]);

/** Retail maths, from the exhibit and its card rule alone. */
function solveMath(item: RapidItem): Solved {
  const p = item.prompt;
  if (/^What is the (margin|markup) % on this line\?$/.test(p)) {
    const c = cents(row(item, "Cost price"));
    const s = cents(row(item, "Selling price"));
    const margin = p.includes("margin");
    expect(row(item, "Card")).toMatch(margin ? /^Margin %/ : /^Markup %/);
    return pick(item, margin ? "margin" : "markup", closest(item, (100 * (s - c)) / (margin ? s : c), pctOf, 0.06));
  }
  if (/target margin/.test(p)) {
    const c = cents(row(item, "Cost price"));
    const m = Number(row(item, "Target margin").replace("%", ""));
    return pick(item, "target", closest(item, c / (1 - m / 100), cents, 0.6));
  }
  if (/sell-through %/.test(p)) {
    const s = int(row(item, "Units sold (net of returns)"));
    const oh = int(row(item, "Units on hand"));
    return pick(item, "sellthrough", closest(item, (100 * s) / (s + oh), pctOf, 0.06));
  }
  if (/weeks of cover/.test(p)) {
    const n = Number(row(item, "Card: average weekly units").match(/^Average of the last (\d) weeks$/)![1]);
    const oh = int(row(item, "Units on hand"));
    if (hasRow(item, "Weekly units, wk 3 to wk 8")) {
      const wk = row(item, "Weekly units, wk 3 to wk 8").split(" · ").map(int);
      expect(wk.length).toBe(6);
      const avg = wk.slice(6 - n).reduce((a, b) => a + b, 0) / n;
      return pick(item, "trend", closest(item, oh / avg, weeksOf, 0.06));
    }
    const total = int(row(item, `Units sold, last ${n} weeks`));
    return pick(item, "cover", closest(item, oh / (total / n), weeksOf, 0.06));
  }
  if (/promotional price/.test(p)) {
    const pp = lead$(row(item, "Promotional price"));
    const c = cents(row(item, "Cost price"));
    const f = cents(row(item, "Supplier funding"));
    return pick(item, "promo", closest(item, (100 * (pp - (c - f))) / pp, pctOf, 0.06));
  }
  expect(p).toMatch(/further markdown/);
  const cur = lead$(row(item, "Current ticket"));
  const t = cents(row(item, "Target price point"));
  return pick(item, "markdown", closest(item, (100 * (cur - t)) / cur, pctOf, 0.06));
}

/** Line actions, applying the card printed on the exhibit. */
function solveAction(item: RapidItem): Solved {
  const card = row(item, "Action card").match(/on sale (\d+)\+ weeks and sell-through below (\d+)%.*below lead time \+ (\d+) weeks/);
  expect(card, row(item, "Action card")).not.toBeNull();
  const [mdWeeks, mdSt, safety] = card!.slice(1).map(Number);
  const weeks = Number(row(item, "Weeks on sale"));
  const st = Number(row(item, "Sell-through").replace("%", ""));
  const cover = weeksOf(row(item, "Cover on hand"));
  const lead = Number(row(item, "Supplier lead time").replace(" weeks", ""));
  const oo = row(item, "On order");
  const order = oo === "None" ? "none" : /not yet shipped/.test(oo) ? "unshipped" : "water";
  const ooWeeks = order === "none" ? 0 : weeksOf(oo.split(" of stock")[0]);
  let action: string;
  if (weeks >= mdWeeks && st < mdSt) action = order === "unshipped" ? "Cancel the open order" : "Mark down";
  else if (cover + ooWeeks < lead + safety) action = "Reorder";
  else action = "Hold";
  let kind = action;
  if (action === "Reorder" && cover >= 4) kind = "lead";
  if (st === mdSt) kind = "edge-st";
  if (weeks === mdWeeks - 1 && st < mdSt) kind = "edge-weeks";
  if (order === "water" && action === "Hold" && cover < lead + safety) kind = "water-hold";
  if (order === "water" && action === "Mark down") kind = "water-markdown";
  return pick(item, kind, byLabel(item, action));
}

/** Pricing and promotions. */
function solvePricing(item: RapidItem): Solved {
  const p = item.prompt;
  if (/after the markdown/.test(p)) {
    const c = cents(row(item, "Cost price"));
    const t = cents(row(item, "Ticket price"));
    const np = Math.round(t * (1 - offOf(row(item, "Markdown")) / 100));
    return pick(item, "md-margin", closest(item, (100 * (np - c)) / np, pctOf, 0.06));
  }
  if (/at the new price/.test(p)) {
    const c = cents(row(item, "Cost price"));
    const t = cents(row(item, "Ticket price"));
    const np = lead$(row(item, "New price"));
    const u = int(row(item, "Units a week at the ticket price"));
    return pick(item, "units-keep", closest(item, Math.ceil((u * (t - c)) / (np - c)), unitsOf, 0.5));
  }
  if (/customer buying three/.test(p)) {
    const t = cents(row(item, "Ticket price"));
    const a = row(item, "Deal A");
    const saveA = a === "3 for 2" ? t : 3 * t - cents(a.replace("3 for ", ""));
    const saveB = (3 * t * Number(row(item, "Deal B").match(/^(\d+)% off each$/)![1])) / 100;
    expect(Math.abs(saveA - saveB)).toBeGreaterThan(1);
    return pick(item, "multibuy", byLabel(item, saveA > saveB ? "Deal A" : "Deal B"));
  }
  if (/ladder price/.test(p)) {
    const ladder = row(item, "Price ladder").split(" · ").map(cents);
    const np = cents(row(item, "Ticket price")) * (1 - offOf(row(item, "Markdown")) / 100);
    const right = Math.max(...ladder.filter((x) => x <= np));
    return pick(item, "ladder", closest(item, right, cents, 0.5));
  }
  // Supplier-funded: the supplier pays a share of (ticket − promotional price).
  const t = cents(row(item, /^Ticket price$/).split(" · ")[0]);
  const pp = lead$(row(item, "Promotional price"));
  const c = cents(row(item, "Cost price"));
  const s = Number(row(item, "Funding").match(/^Supplier funds (\d+)% of the discount/)![1]);
  const net = c - (s * (t - pp)) / 100;
  if (/margin %/.test(p)) return pick(item, "split-margin", closest(item, (100 * (pp - net)) / pp, pctOf, 0.06));
  if (/cash margin does Wrenfield make/.test(p)) return pick(item, "split-cash", closest(item, pp - net, cents, 0.6));
  const u = Number(p.match(/^It sells ([\d,]+) units a week/)![1].replace(/,/g, ""));
  return pick(item, "split-units", closest(item, Math.ceil((u * (t - c) * 100) / ((pp - c) * 100 + s * (t - pp))), unitsOf, 0.5));
}

const SOLVERS: Record<RapidStepId, (item: RapidItem) => Solved> = {
  "rapid-retail-math": solveMath,
  "rapid-actions": solveAction,
  "rapid-pricing": solvePricing,
};
const HARD_KINDS: Record<RapidStepId, string[]> = {
  "rapid-retail-math": ["promo", "trend", "markdown"],
  "rapid-actions": ["lead", "edge-st", "edge-weeks", "water-hold", "water-markdown"],
  "rapid-pricing": ["split-margin", "split-cash", "split-units"],
};
const solveRapid = (seed: string, stepId: RapidStepId) => rapidItems(seed, stepId).map((item) => ({ item, ...SOLVERS[stepId](item) }));

function rapidAnswers(seed: string) {
  return Object.fromEntries(
    RAPID_STEPS.map((id) => [id, { items: Object.fromEntries(solveRapid(seed, id).map((s) => [s.item.id, { values: s.values, ms: 7_000 }])) }]),
  ) as Record<RapidStepId, { items: Record<string, { values: Record<string, string>; ms: number }> }>;
}

// ---- A strong candidate's answers, built only from the screen ----

const perfectCache = new Map<string, unknown>();
/** Memoised: the trap tests mutate a deep copy of it many times per seed. */
function perfectAnswers(seed: string): ReturnType<typeof buildPerfect> {
  if (!perfectCache.has(seed)) perfectCache.set(seed, buildPerfect(seed));
  return JSON.parse(JSON.stringify(perfectCache.get(seed)));
}
function buildPerfect(seed: string) {
  const sc = screen(seed);
  const po = readPo(sc);
  return {
    ...rapidAnswers(seed),
    "trade-report": { cells: solveTradeReport(readTradeReport(sc)) as Record<string, number | null> },
    "po-check": {
      flags: po.rows.flatMap((r) => r.issues.map((reason) => ({ target: r.id, reason, note: "" }))),
      decision: oneOption(sc.doc().decision!, /^Query the supplier in writing/),
    },
    "open-to-buy": { cells: solveOtb(readOtb(sc)) as Record<string, number | null> },
    "critical-path": { order: solveCriticalPath(sc) },
    ...(Object.fromEntries(VALUES_STEPS.map((id) => [id, { selected: [oneOption(sc.mc(id), VALUES_RIGHT[id])] }])) as Record<ValuesStepId, { selected: string[] }>),
  };
}
type Answers = ReturnType<typeof perfectAnswers>;
const clone = (a: Answers): Answers => JSON.parse(JSON.stringify(a));

describe("retail-wrenfield-trade: setup", () => {
  it("is registered, version 1, retail, 50 minutes, and uses only built step types in section order", () => {
    expect(getScenario("retail-wrenfield-trade", 1)).toBe(scenario);
    expect(listScenarios()).toContain(scenario);
    expect(scenario.version).toBe(1);
    expect(scenario.timeLimitMinutes).toBe(50);
    expect(scenario.roleFamily).toBe("retail");
    expect(scenario.title).toBe("Wrenfield & Co.: assistant buyer");
    expect(scenario.definition.steps.map((s) => [s.id, s.type])).toEqual([
      ["rapid-retail-math", "rapid_round"],
      ["trade-report", "spreadsheet"],
      ["rapid-actions", "rapid_round"],
      ["po-check", "document_review"],
      ["rapid-pricing", "rapid_round"],
      ["open-to-buy", "spreadsheet"],
      ["critical-path", "ordering"],
      ...VALUES_STEPS.map((id) => [id, "multiple_choice"]),
    ]);
    expect(scenario.definition.intro).toMatch(/assistant buyer/);
    expect(JSON.parse(JSON.stringify(scenario.definition))).toEqual(scenario.definition);
  });

  it(
    "renders for 200 seeds with no unfilled template, and every rapid item renders",
    () => {
      for (const seed of SEEDS) {
        for (const minute of [0, END]) expect(JSON.stringify(renderAttemptForCandidate(scenario, seed, minute))).not.toContain("{{");
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

  it("different seeds change the department, names, numbers and which row carries which trap", () => {
    expect(new Set(SEEDS.map((s) => JSON.stringify(scenario.generate(s).values))).size).toBe(SEEDS.length);
    const screens = SEEDS.slice(0, 60).map(screen);
    expect(new Set(screens.map((s) => s.view.intro.match(/in the (.+) department/)![1])).size).toBe(5);
    const trs = screens.map(readTradeReport);
    expect(new Set(trs.map((t) => t.adjust.line)).size).toBeGreaterThan(40);
    expect(new Set(trs.map((t) => t.lines.findIndex((l) => l.weeks < 8 && l.st))).size).toBeGreaterThan(4);
    const pos = screens.map(readPo);
    expect(new Set(pos.map((p) => p.rows.findIndex((r) => r.issues.includes("cost")))).size).toBeGreaterThan(8);
    expect(new Set(pos.map((p) => p.rows.findIndex((r) => r.issues.includes("duplicate")))).size).toBeGreaterThan(6);
  });
});

describe("retail-wrenfield-trade: trade report", () => {
  it(
    "the key matches the report solved by the card, for 200 seeds",
    () => {
      for (const seed of SEEDS) {
        const key = scenario.generate(seed).keys["trade-report"] as SheetKey;
        const cells = solveTradeReport(readTradeReport(screen(seed)));
        expect(Object.keys(key.cells).sort()).toEqual(Object.keys(cells).sort());
        for (const [id, c] of Object.entries(key.cells)) expect(Math.abs(cells[id] - c.value), `${seed} ${id}`).toBeLessThanOrEqual(c.tolerance ?? 0);
      }
    },
    LONG,
  );

  it("every seed has returns on at least three lines with boxes, a mid-period launch with boxes, a promotion and an adjustment", () => {
    for (const seed of SEEDS.slice(0, 60)) {
      const tr = readTradeReport(screen(seed));
      expect(tr.lines.filter((l) => l.st && l.ret > 0).length, seed).toBeGreaterThanOrEqual(3);
      expect(tr.lines.filter((l) => l.st && l.weeks < 8).length, seed).toBe(1);
      expect(tr.promo.units).toBeGreaterThan(0);
      expect(tr.adjust.units).toBeGreaterThan(0);
    }
  });

  it("cells: 1 per sell-through and cover on eight lines, 2 each for department margin and sell-through: 20 in all", () => {
    const blank = scoreAttempt(scenario, "abc", {});
    expect(blank.steps["trade-report"].maxPoints).toBe(20);
    expect(blank.steps["trade-report"].items.length).toBe(18);
  });
});

describe("retail-wrenfield-trade: PO check", () => {
  it(
    "twelve POs with exactly one of each problem, and the key agrees with the rows, for 200 seeds",
    () => {
      for (const seed of SEEDS) {
        const sc = screen(seed);
        const po = readPo(sc);
        expect(po.rows.length).toBe(12);
        const key = scenario.generate(seed).keys["po-check"] as ReviewKey;
        for (const reason of ["cost", "qty", "late", "carton", "cert", "duplicate"]) {
          const hits = po.rows.filter((r) => r.issues.includes(reason));
          expect(hits.length, `${seed} ${reason}`).toBe(1);
          const finding = Object.values(key.findings).find((f) => f.reasons.includes(reason))!;
          expect(finding.targets, `${seed} ${reason}`).toContain(hits[0].id);
        }
        for (const r of po.rows) expect(r.issues.length, `${seed} ${r.id}`).toBeLessThanOrEqual(1);
        expect(key.decision).toEqual([oneOption(sc.doc().decision!, /^Query the supplier in writing/)]);
      }
    },
    LONG,
  );

  it("clean look-alikes on every seed: delivery on the latest date, a one-cent rounding, a type that needs no test, a certificate that arrived, a split order", () => {
    for (const seed of SEEDS.slice(0, 60)) {
      const po = readPo(screen(seed));
      const clean = po.rows.filter((r) => !r.issues.length);
      expect(clean.some((r) => r.onDate), seed).toBe(true);
      expect(clean.some((r) => r.rounding), seed).toBe(true);
      expect(clean.some((r) => r.cert === "Not received" && !po.needs.get(r.type)), seed).toBe(true);
      expect(clean.some((r) => r.po === po.arrived && r.cert === "Not received" && po.needs.get(r.type)), seed).toBe(true);
    }
  });
});

describe("retail-wrenfield-trade: desk", () => {
  it(
    "open-to-buy and the critical path match the key for 200 seeds",
    () => {
      for (const seed of SEEDS) {
        const sc = screen(seed);
        const keys = scenario.generate(seed).keys;
        const otb = solveOtb(readOtb(sc));
        for (const [id, c] of Object.entries((keys["open-to-buy"] as SheetKey).cells)) expect(otb[id as keyof typeof otb], `${seed} ${id}`).toBe(c.value);
        expect((keys["critical-path"] as { order: string[] }).order).toEqual(solveCriticalPath(sc));
      }
    },
    LONG,
  );

  it("the critical path is shown in an order unrelated to the key, and names the certificate line's test", () => {
    const firsts = new Set<string>();
    for (const seed of SEEDS.slice(0, 60)) {
      const sc = screen(seed);
      const order = solveCriticalPath(sc);
      expect(order).not.toEqual(sc.ord().items.map((i) => i.id));
      firsts.add(order[0]);
      const type = sc.ord().prompt.match(/\((.+)\) in order, from sample approval/)![1];
      const test = sc.doc().document.fields.find((f) => f.id === "compliance")!.value.split("; ").find((e) => e.startsWith(`${type}: `))!;
      expect(sc.ord().items.some((i) => i.label.includes(test.slice(type.length + 2))), seed).toBe(true);
    }
    expect(firsts.size).toBe(8);
  });

  it("each values call has four options, one right, and the right one moves between seeds", () => {
    for (const id of VALUES_STEPS) {
      const places = new Set<string>();
      for (const seed of SEEDS.slice(0, 60)) {
        const sc = screen(seed);
        const mc = sc.mc(id);
        expect(mc.options.map((o) => o.id)).toEqual(["a", "b", "c", "d"]);
        expect(new Set(mc.options.map((o) => o.label)).size).toBe(4);
        const right = oneOption(mc, VALUES_RIGHT[id]);
        expect((scenario.generate(seed).keys[id] as McKey).correct).toEqual([right]);
        places.add(right);
      }
      expect(places.size, id).toBe(4);
      const step = scenario.definition.steps.find((s) => s.id === id)!;
      expect(step.title).toMatch(/^Judgment: /);
    }
  });
});

describe("retail-wrenfield-trade: scoring", () => {
  it("out of 100: rapid rounds 10 each, trade report 20, PO check 20, open-to-buy 12, critical path 8, values 2 each", () => {
    const blank = scoreAttempt(scenario, "abc", {});
    expect(blank.points).toBe(0);
    expect(blank.maxPoints).toBe(MAX);
    const max = (id: string) => blank.steps[id].maxPoints;
    expect(RAPID_STEPS.map(max)).toEqual([10, 10, 10]);
    expect(max("trade-report")).toBe(20);
    expect(max("po-check")).toBe(20);
    expect(max("open-to-buy")).toBe(12);
    expect(max("critical-path")).toBe(8);
    expect(VALUES_STEPS.map(max)).toEqual([2, 2, 2, 2, 2]);
  });

  it("blank scores 0 for every seed", () => {
    for (const seed of SEEDS.slice(0, 50)) expect(scoreAttempt(scenario, seed, {}).points).toBe(0);
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
    for (let i = 0; i < 20; i++) shared += scoreAttempt(scenario, SEEDS[i + 1], perfectAnswers(SEEDS[i])).points;
    expect(shared / 20).toBeLessThan(40);
  });

  describe("each trap answered wrongly costs exactly its points", () => {
    const seeds = SEEDS.slice(0, 40);
    const lost = (seed: string, mutate: (a: Answers) => void) => {
      const a = clone(perfectAnswers(seed));
      mutate(a);
      return MAX - scoreAttempt(scenario, seed, a).points;
    };
    const flagsOf = (a: Answers) => a["po-check"].flags as Flag[];

    for (const [name, reason] of [
      ["cost differs", "cost"],
      ["quantity differs", "qty"],
      ["late delivery", "late"],
      ["not whole cartons", "carton"],
      ["certificate missing", "cert"],
      ["duplicate order", "duplicate"],
    ] as const) {
      it(`PO check: ${name} missed loses 3; spotted with the wrong reason loses 1.5`, () => {
        for (const seed of seeds) {
          expect(lost(seed, (a) => (a["po-check"].flags = flagsOf(a).filter((f) => f.reason !== reason))), `${seed} ${name}`).toBe(3);
          expect(lost(seed, (a) => (flagsOf(a).find((f) => f.reason === reason)!.reason = "other")), `${seed} ${name} wrong reason`).toBe(1.5);
        }
      });
    }

    it("PO check: flagging a look-alike costs 1; flagging both duplicate rows costs nothing; the wrong decision costs 2", () => {
      for (const seed of seeds) {
        const sc = screen(seed);
        const po = readPo(sc);
        const lookAlikes = po.rows.filter((r) => !r.issues.length && (r.onDate || r.rounding || r.po === po.arrived || r.cert === "Not received"));
        expect(lookAlikes.length).toBeGreaterThanOrEqual(4);
        for (const r of lookAlikes) expect(lost(seed, (a) => flagsOf(a).push({ target: r.id, reason: "other", note: "" })), `${seed} ${r.id}`).toBe(1);
        const key = scenario.generate(seed).keys["po-check"] as ReviewKey;
        const both = key.findings.duplicate.targets;
        expect(both.length).toBe(2);
        const other = both.find((t) => !flagsOf(perfectAnswers(seed)).some((f) => f.target === t))!;
        expect(lost(seed, (a) => flagsOf(a).push({ target: other, reason: "duplicate", note: "" }))).toBe(0);
        const approve = oneOption(sc.doc().decision!, /^Approve the POs as they are/);
        const phone = oneOption(sc.doc().decision!, /^Phone the suppliers/);
        expect(lost(seed, (a) => (a["po-check"].decision = approve))).toBe(2);
        expect(lost(seed, (a) => (a["po-check"].decision = phone))).toBe(2);
      }
    }, LONG);

    it("trade report: ignoring the stock adjustment costs 4; the launch week 1; the promotion 2; gross units on the lines 2 per line with returns", () => {
      for (const seed of seeds) {
        const tr = readTradeReport(screen(seed));
        const withCells = (o: TrOptions) => (a: Answers) => (a["trade-report"].cells = solveTradeReport(tr, o));
        expect(lost(seed, withCells({ ignoreAdjust: true })), `${seed} adjust`).toBe(4);
        expect(lost(seed, withCells({ ignoreLaunch: true })), `${seed} launch`).toBe(1);
        expect(lost(seed, withCells({ ignorePromo: true })), `${seed} promo`).toBe(2);
        const returnLines = tr.lines.filter((l) => l.st && l.ret > 0).length;
        expect(lost(seed, withCells({ grossOnLines: true })), `${seed} returns`).toBe(2 * returnLines);
      }
    });

    it("open-to-buy: leaving the cancelled order in costs that month and the quarter (6)", () => {
      for (const seed of seeds) {
        const o = readOtb(screen(seed));
        expect(lost(seed, (a) => (a["open-to-buy"].cells = solveOtb(o, true)))).toBe(6);
      }
    });

    it("critical path: testing after shipping costs part of the 8; the reverse order costs all 8", () => {
      for (const seed of seeds) {
        const swap = lost(seed, (a) => {
          const o = a["critical-path"].order;
          [o[4], o[5]] = [o[5], o[4]];
        });
        expect(swap).toBeGreaterThan(0);
        expect(swap).toBeLessThan(2);
        expect(lost(seed, (a) => a["critical-path"].order.reverse())).toBe(8);
      }
    });

    it("values calls: the helpful shortcut costs all 2", () => {
      for (const seed of seeds) {
        const sc = screen(seed);
        for (const id of VALUES_STEPS) expect(lost(seed, (a) => (a[id].selected = [oneOption(sc.mc(id), VALUES_SHORTCUT[id])])), `${seed} ${id}`).toBe(2);
      }
    }, LONG);
  });
});

describe("retail-wrenfield-trade: nothing from the key reaches the candidate", () => {
  it(
    "no reviewer note, key word or computed spreadsheet number in any payload",
    () => {
      for (const seed of SEEDS) {
        const variant = scenario.generate(seed);
        const notes = Object.values((variant.keys["po-check"] as ReviewKey).findings).map((f) => f.note!);
        for (const n of notes) expect(n.length).toBeGreaterThan(10);
        const cells = ["trade-report", "open-to-buy"].flatMap((id) => Object.values((variant.keys[id] as SheetKey).cells).map((c) => c.value));
        for (const minute of [0, 20, END]) {
          const payload = JSON.stringify(renderAttemptForCandidate(scenario, seed, minute));
          expect(payload).not.toMatch(/"keys"|tolerance|"criteria"|"guidance"|"notes"|"points"|"expected"|"findings"|"clean":|"correct"/);
          for (const n of notes) expect(payload, seed).not.toContain(n);
          for (const c of cells.filter((x) => Math.abs(x) >= 1)) {
            const forms = [JSON.stringify(c), c.toFixed(2), String(Math.round(c * 100)), c.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })];
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

describe("retail-wrenfield-trade: timed sections", () => {
  const def = scenario.definition;
  const MIN = 60_000;
  const t0 = Date.parse("2026-11-16T09:00:00Z");
  const flowAt = (ms: number) => resolveFlow(def, { startedAt: t0, now: t0 + ms, extraTimePercent: 0, events: [] });
  const stepById = (id: string) => def.steps.find((s) => s.id === id)!;

  it("validateSections passes and the sections fill the time limit exactly", () => {
    expect(validateSections(def, scenario.timeLimitMinutes)).toEqual([]);
    expect(def.sections!.reduce((t, s) => t + s.minutes, 0)).toBe(scenario.timeLimitMinutes);
  });

  it("six sections with the shared ids: three rapid rounds between two long tasks, then the desk", () => {
    expect(def.sections!.map((s) => [s.id, s.minutes, s.stepIds, !!s.oneAtATime])).toEqual([
      ["s-rapid-a", 6, ["rapid-retail-math"], false],
      ["s-work-1", 10, ["trade-report"], false],
      ["s-rapid-b", 6, ["rapid-actions"], false],
      ["s-work-2", 10, ["po-check"], false],
      ["s-rapid-c", 6, ["rapid-pricing"], false],
      ["s-desk", 12, ["open-to-buy", "critical-path", ...VALUES_STEPS], true],
    ]);
  });

  it("desk screens: open-to-buy 240 s, critical path 150 s, values 66 s each, adding up to the section", () => {
    expect(["open-to-buy", "critical-path", ...VALUES_STEPS].map((id) => stepById(id).seconds)).toEqual([240, 150, 66, 66, 66, 66, 66]);
    for (const sec of def.sections!.filter((s) => s.oneAtATime)) {
      expect(sec.stepIds.reduce((t, id) => t + stepById(id).seconds!, 0), sec.id).toBe(sec.minutes * 60);
    }
  });

  it("each rapid round is 15 items x 20 seconds and fits its 6-minute section", () => {
    for (const id of RAPID_STEPS) {
      const config = rapidConfig(id);
      expect(config.items.length, id).toBe(15);
      expect(config.secondsPerItem).toBe(20);
      expect(config.items.length * config.secondsPerItem).toBeLessThanOrEqual(6 * 60);
    }
  });

  it("runs the sections back to back", () => {
    const at = (min: number) => flowAt(min * MIN);
    expect(at(0).visibleStepIds).toEqual(["rapid-retail-math"]);
    expect(at(6).visibleStepIds).toEqual(["trade-report"]);
    expect(at(16).visibleStepIds).toEqual(["rapid-actions"]);
    expect(at(22).visibleStepIds).toEqual(["po-check"]);
    expect(at(32).visibleStepIds).toEqual(["rapid-pricing"]);
    expect(at(38).visibleStepIds).toEqual(["open-to-buy"]);
    expect(at(END).done).toBe(true);
  });

  it("every message points at a real step; briefs arrive when their section opens and the two updates at minute 4", () => {
    const ids = new Set(def.steps.map((s) => s.id));
    for (const m of def.messages) expect(ids.has(m.stepId!), m.id).toBe(true);
    expect(def.messages.filter((m) => m.arriveAtMinute).map((m) => [m.id, m.arriveAtMinute, m.stepId])).toEqual([
      ["m-adjust", 4, "trade-report"],
      ["m-cert", 4, "po-check"],
    ]);
    const msgsAt = (min: number) => visibleMessageIds(def, flowAt(min * MIN), t0, t0 + min * MIN);
    expect(msgsAt(0)).toEqual(["m-welcome"]);
    expect(msgsAt(6)).toEqual(["m-welcome", "m-trade"]);
    expect(msgsAt(10)).toEqual(["m-welcome", "m-trade", "m-adjust"]);
    expect(msgsAt(26)).toContain("m-cert");
    expect(msgsAt(38)).toEqual(expect.arrayContaining(["m-otb", "m-cp", "m-integrity", "m-candor", "m-client-care", "m-in-lane", "m-quality"]));
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

describe("retail-wrenfield-trade: rapid rounds", () => {
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
            expect(new Set(choiceField(s.item).options.map((o) => o.label)).size).toBe(4);
            expect(key.items[s.item.id].answer.choice, `${seed} ${s.item.id} (${s.kind}: ${s.item.prompt})`).toBe(s.values.answer);
          }
        }
      }
    },
    LONG,
  );

  it("ten quick items worth half a point and five harder ones worth one, in every round", () => {
    for (const id of RAPID_STEPS) {
      const points = rapidConfig(id).items.map((i) => i.points);
      expect(points.filter((p) => p === 0.5).length, id).toBe(10);
      expect(points.filter((p) => p === 1).length, id).toBe(5);
      expect(points.reduce((a, b) => a + b, 0)).toBe(10);
      expect(points.map((p, i) => (p === 1 ? i + 1 : 0)).filter(Boolean)).toEqual([3, 6, 9, 12, 15]);
      for (const seed of SEEDS.slice(0, 60)) {
        solveRapid(seed, id).forEach((s, i) => {
          expect(HARD_KINDS[id].includes(s.kind), `${seed} ${id} item ${i + 1} ${s.kind}`).toBe(points[i] === 1);
        });
      }
    }
  });

  it("line actions: every hard kind shows up, and each of the four actions is right somewhere", () => {
    const kinds = new Set<string>();
    for (const seed of SEEDS.slice(0, 30)) for (const s of solveRapid(seed, "rapid-actions")) kinds.add(s.kind);
    expect([...kinds].sort()).toEqual(["Cancel the open order", "Hold", "Mark down", "Reorder", "edge-st", "edge-weeks", "lead", "water-hold", "water-markdown"]);
  });

  it("varies per seed: which item comes when and where the right option sits", () => {
    for (const id of RAPID_STEPS) {
      const firsts = SEEDS.slice(0, 60).map((seed) => solveRapid(seed, id)[0]);
      expect(new Set(firsts.map((s) => JSON.stringify(s.item))).size, id).toBeGreaterThan(40);
      expect(new Set(firsts.map((s) => s.values.answer)).size, id).toBe(4);
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
      const items = rapidConfig(id).items;
      delete a[id].items[items.find((i) => i.points === 1)!.id];
      delete a[id].items[items.find((i) => i.points === 0.5)!.id];
      expect(perfect.steps[id].points - scoreAttempt(scenario, seed, a as never).steps[id].points, id).toBe(1.5);
    }
  });
});
