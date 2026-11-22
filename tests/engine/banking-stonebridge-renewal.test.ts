import { describe, expect, it, vi } from "vitest";
import type { RapidChoiceField, RapidItem } from "@/lib/engine/step-types/rapid_round/public";
import type { PublicCell, SpreadsheetPublicConfig } from "@/lib/engine/step-types/spreadsheet/public";

vi.mock("server-only", () => ({}));

const { bankingStonebridgeRenewal } = await import("@/lib/engine/scenarios/banking-stonebridge-renewal");
const { getScenario, listScenarios } = await import("@/lib/engine/scenarios");
const { renderAttemptForCandidate, renderFlowForCandidate } = await import("@/lib/engine/server/render");
const { scoreAttempt } = await import("@/lib/engine/server/score");
const { resolveFlow, visibleMessageIds, validateSections } = await import("@/lib/engine/server/flow");
const { rapidRoundServer } = await import("@/lib/engine/step-types/rapid_round/server");
const { fillTemplate, templateValues } = await import("@/lib/engine/server/template");

/**
 * Bank analyst programme, commercial credit: the Stonebridge renewal. Three
 * rapid rounds (ratio flash, covenant calls, borrowing base), the spread, the
 * draft credit memo against the file, and a one-screen-at-a-time desk
 * (borrowing base certificate, risk rating, lead risk, five values calls).
 * 50 minutes, 100 points. Every task is solved here from what the candidate
 * sees, with this test's own reading of the bank's rules, then compared with
 * the server key.
 */

const scenario = bankingStonebridgeRenewal;
const SEEDS = Array.from({ length: 200 }, (_, i) => `attempt-${i.toString(16).padStart(4, "0")}`);
const END = scenario.timeLimitMinutes;
const MAX = 100;
const LONG = 180_000;
const RAPID_STEPS = ["rapid-ratios", "rapid-covenants", "rapid-base"] as const;
type RapidStepId = (typeof RAPID_STEPS)[number];
const VALUES_STEPS = ["values-integrity", "values-candor", "values-in-lane", "values-client-care", "values-quality"] as const;
type ValuesStepId = (typeof VALUES_STEPS)[number];
const DESK_STEPS = ["base-certificate", "risk-rating", "lead-risk", ...VALUES_STEPS] as const;

type Field = { id: string; label: string; value: string };
type Doc = {
  prompt: string;
  document: { title: string; fields: Field[]; columns: string[]; rows: { id: string; cells: string[] }[]; totals: Field[] };
  reasons: { id: string; label: string }[];
  decision?: { prompt: string; options: { id: string; label: string }[] };
};
type Mc = { prompt: string; options: { id: string; label: string }[]; select: "single" | "multi" };
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
  const sheet = (id: "spread" | "base-certificate") => step(id).config as SpreadsheetPublicConfig;
  const doc = () => step("package-review").config as Doc;
  const mc = (id: string) => step(id).config as Mc;
  return { view, step, msg, sheet, doc, mc };
}
type Screen = ReturnType<typeof screen>;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
/** "Mon, Mar 2, 2026" → epoch day; checks the printed weekday. */
function day(label: string): number {
  const m = label.trim().match(/^(\w{3}), (\w{3}) (\d{1,2}), (\d{4})$/);
  expect(m, `date "${label}"`).not.toBeNull();
  const t = Date.UTC(Number(m![4]), MONTHS.indexOf(m![2]), Number(m![3]));
  expect(WEEKDAYS[new Date(t).getUTCDay()], `weekday of ${label}`).toBe(m![1]);
  return t / 86_400_000;
}
/** Epoch day n months before/after `d`, same day of month (clamped). */
function addMonths(d: number, n: number): number {
  const t = new Date(d * 86_400_000);
  const y = t.getUTCFullYear();
  const m = t.getUTCMonth() + n;
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return Date.UTC(y, m, Math.min(t.getUTCDate(), last)) / 86_400_000;
}
/** "1,234" → 1234; "(4,000)" → -4000; "—" → 0. Dollar signs allowed. */
const num = (s: string) => {
  const t = s.trim().replace(/^\$/, "").replace(/^\(\$?(.+)\)$/, "-$1");
  if (t === "—") return 0;
  expect(t, `number "${s}"`).toMatch(/^-?\d{1,3}(,\d{3})*$/);
  return Number(t.replace(/,/g, ""));
};
const r2 = (x: number) => Number(x.toFixed(2));
const xLabel = (x: number) => `${x.toFixed(2)}x`;

function oneOption(cfg: { options: { id: string; label: string }[] }, re: RegExp | string) {
  const o = cfg.options.filter((x) => (typeof re === "string" ? x.label === re : re.test(x.label)));
  expect(o.length, `one option like ${re}: ${cfg.options.map((x) => x.label).join(" | ")}`).toBe(1);
  return o[0].id;
}

// ---- The spread ----

const text = (c: PublicCell) => (c.kind === "text" ? c.text : "");
const inputId = (c: PublicCell) => (c.kind === "input" ? c.id : null);

const SPREAD_INPUTS = ["e_fy2", "e_fy3", "e_int", "a_fy2", "a_fy3", "a_int", "c_fy2", "c_fy3", "c_int", "d_fy2", "d_fy3", "d_int", "pf", "lev"];

type SpreadFlaws = Partial<Record<"keepGain" | "keepDistributions" | "skipCosDepreciation" | "skipNewDebtService" | "wrongBasis" | "ignoreRevision", boolean>>;

/** The spread as shown, the controller's revision applied, and the bank's definitions applied by hand. */
function solveSpread(sc: Screen, flaws: SpreadFlaws = {}) {
  const sheet = sc.sheet("spread");
  expect(sheet.columns[0]).toBe("$000s");
  expect(sheet.columns[1]).toMatch(/^FY \d{4}$/);
  expect(sheet.columns[5]).toBe("Pro forma");
  const months = Number(sheet.columns[4].match(/^(\d+) mo\. to \w{3} \d{1,2}, \d{4}$/)![1]);
  expect([3, 6, 9]).toContain(months);
  const fyLabels = sheet.columns.slice(1, 4);
  const row = (label: string) => {
    const r = sheet.rows.find((x) => text(x[0]) === label);
    expect(r, `spread row ${label}`).toBeDefined();
    return r!;
  };
  const line = (label: string) => row(label).slice(1, 5).map((c) => num(text(c)));
  const [rev, cos, gp, sga, da, opinc, interest, other, ni] = [
    "Revenue",
    "Cost of sales",
    "Gross profit",
    "Selling, general and administrative",
    "Depreciation and amortization",
    "Operating income",
    "Interest expense",
    "Other income",
    "Net income",
  ].map(line);
  const cdep = line("Depreciation inside cost of sales (note 1)");
  const dist = line("Distributions to members");
  const prin = line("Scheduled principal paid");
  // The statements tie: gross profit, operating income and net income add up in every column.
  for (let i = 0; i < 4; i++) {
    expect(gp[i]).toBe(rev[i] - cos[i]);
    expect(opinc[i]).toBe(gp[i] - sga[i] - da[i]);
    expect(ni[i]).toBe(opinc[i] - interest[i] + other[i]);
  }
  // Balance sheets tie, and net income less distributions flows to equity.
  const bs = (label: string) => row(label).slice(1, 4).map((c) => num(text(c)));
  const [cash, ar, inv, pre, tca, nfa, ta, loc, cpltd, ap, acc, tcl, ltd, tl, eq, tle] = [
    "Cash",
    "Accounts receivable",
    "Inventory",
    "Prepaids and other",
    "Total current assets",
    "Property and equipment, net",
    "Total assets",
    "Line of credit",
    "Current portion of long-term debt",
    "Accounts payable",
    "Accrued expenses",
    "Total current liabilities",
    "Long-term debt, less current portion",
    "Total liabilities",
    "Members' equity",
    "Total liabilities and equity",
  ].map(bs);
  for (let i = 0; i < 3; i++) {
    expect(tca[i]).toBe(cash[i] + ar[i] + inv[i] + pre[i]);
    expect(ta[i]).toBe(tca[i] + nfa[i]);
    expect(tcl[i]).toBe(loc[i] + cpltd[i] + ap[i] + acc[i]);
    expect(tl[i]).toBe(tcl[i] + ltd[i]);
    expect(tle[i]).toBe(tl[i] + eq[i]);
    expect(ta[i]).toBe(tle[i]);
    if (i > 0) expect(eq[i]).toBe(eq[i - 1] + ni[i] - dist[i]);
  }
  // Last year's current portion is this year's scheduled principal.
  expect(prin[1]).toBe(cpltd[0]);
  expect(prin[2]).toBe(cpltd[1]);

  // The one-time gain, from the note.
  const notes = sheet.rows.map((r) => text(r[0])).filter((t) => t.startsWith("Note"));
  const gainNote = notes.find((t) => /one-time gain/.test(t));
  expect(gainNote, "gain note").toBeDefined();
  const g = gainNote!.match(/^Note 2: other income for (FY \d{4}|the interim period) includes a one-time gain of ([\d,]+) on the sale of .+\.$/)!;
  expect(g, gainNote).not.toBeNull();
  const gainCol = g[1] === "the interim period" ? 3 : fyLabels.indexOf(g[1]);
  expect(gainCol).toBeGreaterThanOrEqual(1); // FY2, FY3 or interim
  const gain = [0, 0, 0, 0];
  gain[gainCol] = num(g[2]);
  expect(other[gainCol]).toBeGreaterThan(gain[gainCol]);

  // The controller's revision to the interim period.
  const m3 = sc.msg("m3").body;
  const rv = m3.match(/selling, general and administrative is ([\d,]+), not ([\d,]+) \(\$000s\)/)!;
  expect(rv, "revision").not.toBeNull();
  expect(num(rv[2])).toBe(sga[3]);
  const niRev = num(m3.match(/Net income for the period becomes ([\d,]+)\./)![1]);
  expect(niRev).toBe(ni[3] - (num(rv[1]) - num(rv[2])));
  const niUsed = [...ni];
  if (!flaws.ignoreRevision) niUsed[3] = niRev;

  // Policy basis for pro forma and the new money's debt service.
  const threshold = Number(sc.sheet("spread").prompt.match(/covers at least (\d+) months/)![1]);
  const newDs = num(sc.msg("m2").body.match(/Annual debt service on the increase[^:]*: ([\d,]+) \(\$000s\)/)![1]);

  const ebitda = [0, 1, 2, 3].map((i) => niUsed[i] + interest[i] + da[i] + (flaws.skipCosDepreciation ? 0 : cdep[i]));
  const adj = ebitda.map((e, i) => e - (flaws.keepGain ? 0 : gain[i]));
  const cads = adj.map((a, i) => a - (flaws.keepDistributions ? 0 : dist[i]));
  const ds = [0, 1, 2, 3].map((i) => prin[i] + interest[i]);
  const dscr = cads.map((c, i) => r2(c / ds[i]));
  const annualise = months >= threshold;
  const basis = annualise !== !!flaws.wrongBasis ? (cads[3] * 12) / months : cads[2];
  const pf = r2(basis / (ds[2] + (flaws.skipNewDebtService ? 0 : newDs)));
  const lev = r2((loc[2] + cpltd[2] + ltd[2]) / adj[2]);
  const cells: Record<string, number> = { pf, lev };
  (["fy2", "fy3", "int"] as const).forEach((p, j) => {
    const i = j + 1;
    Object.assign(cells, { [`e_${p}`]: ebitda[i], [`a_${p}`]: adj[i], [`c_${p}`]: cads[i], [`d_${p}`]: dscr[i] });
  });
  // Every input the sheet shows is one this test solves.
  const shown = sheet.rows.flatMap((r) => r.map(inputId)).filter((x): x is string => !!x);
  expect(shown.sort()).toEqual([...SPREAD_INPUTS].sort());
  return { cells, months, threshold, annualise, gainCol };
}

// ---- The draft memo against the file ----

type MemoIssue = "stale" | "unsigned" | "misstated" | "prior_lien" | "name" | null;

function readMemo(doc: Doc) {
  const f = (id: string) => {
    const x = doc.document.fields.find((y) => y.id === id);
    expect(x, `field ${id}`).toBeDefined();
    return x!.value;
  };
  const committee = day(f("committee"));
  const fsDays = Number(f("pol_fs").match(/no more than (\d+) days old/)![1]);
  const appMonths = Number(f("pol_app").match(/no more than (\d+) months old/)![1]);
  const cov = f("covenants");
  const minDscr = Number(cov.match(/debt service coverage not less than (\d\.\d\d)x/)![1]);
  const maxLev = Number(cov.match(/funded debt to EBITDA not more than (\d\.\d\d)x/)![1]);
  expect(doc.document.columns).toEqual(["Item", "Draft memo says", "File shows"]);
  const rows = doc.document.rows.map((r) => {
    const [item, memo, file] = r.cells;
    let issue: MemoIssue = null;
    let kind = "";
    if (item === "Interim financial statements") {
      kind = "interim";
      const through = day(file.match(/^Statements through (.+?), received/)![1]);
      if (committee - through > fsDays) issue = "stale";
    } else if (item === "Annual financial statements") {
      kind = "annual";
      expect(file).toMatch(/^FY \d{4} statements reviewed by .+, report dated /);
    } else if (item.startsWith("Appraisal: ")) {
      kind = "appraisal";
      const dated = day(file.match(/^Dated (.+?) by /)![1]);
      if (dated < addMonths(committee, -appMonths)) issue = "stale";
    } else if (item.startsWith("Personal financial statement: ")) {
      kind = "pfs";
      if (/signature line blank/.test(file)) issue = "unsigned";
    } else if (item.startsWith("Guaranty: ")) {
      kind = "guaranty";
      expect(file).toMatch(/^Signed /);
    } else if (item === "Covenant: debt service coverage" || item === "Covenant: funded debt to EBITDA") {
      kind = "covenant";
      expect(memo).toMatch(/^In compliance at FY \d{4}/);
      const x = Number(file.match(/^Compliance certificate, FY \d{4}: (\d+\.\d\d)x$/)![1]);
      const ok = item.endsWith("coverage") ? x >= minDscr : x <= maxLev;
      if (!ok) issue = "misstated";
    } else if (item.startsWith("UCC search: ")) {
      kind = "ucc";
      if (/Status: active/.test(file)) issue = "prior_lien";
      else expect(file).toMatch(/UCC-3 termination filed/);
    } else if (item === "Borrower's legal name") {
      kind = "name";
      const legal = file.match(/^Articles of organization: (.+)$/)![1];
      if (legal !== memo) issue = "name";
    } else if (item === "Trade name") {
      kind = "dba";
      const a = memo.match(/^Doing business as (.+)$/)![1];
      const b = file.match(/^Assumed name certificate for (.+), filed /)![1];
      expect(a).toBe(b);
    } else throw new Error(`unknown memo row ${item}`);
    return { id: r.id, item, kind, issue };
  });
  return { rows, committee };
}

const MEMO_FINDINGS: Record<string, Exclude<MemoIssue, null>> = {
  interim_stale: "stale",
  appraisal_stale: "stale",
  pfs_unsigned: "unsigned",
  covenant_misstated: "misstated",
  prior_lien: "prior_lien",
  name_mismatch: "name",
};

// ---- Borrowing base certificate ----

function solveCertificate(sc: Screen) {
  const body = sc.msg("m7").body;
  const m = (re: RegExp) => {
    const x = body.match(re);
    expect(x, `m7 ${re}`).not.toBeNull();
    return x!;
  };
  const [, total, o90] = m(/Aging total \$([\d,]+); over 90 days \$([\d,]+)\./);
  const [, aff] = m(/\(affiliate, same owners\) owes \$([\d,]+), all under 90 days\./);
  const [, raw, fg, wip, transit] = m(/raw materials \$([\d,]+); finished goods \$([\d,]+); work in process \$([\d,]+); in transit \$([\d,]+)\./);
  const [, arRate] = m(/Receivables advance at (\d+)%/);
  const [, invRate, invCap] = m(/inventory at (\d+)% of raw materials and finished goods only, capped at \$([\d,]+)/);
  const [, line] = m(/The line commitment is \$([\d,]+)\./);
  const [, out] = m(/outstanding on the line is \$([\d,]+)\./);
  const eligAr = num(total) - num(o90) - num(aff);
  const eligInv = num(raw) + num(fg);
  const base = (eligAr * Number(arRate)) / 100 + Math.min((eligInv * Number(invRate)) / 100, num(invCap));
  const avail = Math.min(base, num(line));
  return { elig_ar: eligAr, elig_inv: eligInv, avail, excess: avail - num(out), wip: num(wip), transit: num(transit) };
}

// ---- Risk rating and lead risk ----

const GRADES: Record<number, RegExp> = { 3: /^3 · /, 4: /^4 · /, 5: /^5 · /, 6: /^6 · /, 7: /^7 · / };

function solveRating(sc: Screen) {
  const body = sc.msg("m8").body;
  const dscr = Number(body.match(/debt service coverage (\d\.\d\d)x; funded debt to EBITDA (\d\.\d\d)x/)![1]);
  const lev = Number(body.match(/debt service coverage (\d\.\d\d)x; funded debt to EBITDA (\d\.\d\d)x/)![2]);
  const g = body.match(/Coverage grade: at least (\d\.\d\d)x = 3; at least (\d\.\d\d)x = 4; at least (\d\.\d\d)x = 5; below that = 6\./)!;
  const l = body.match(/Leverage grade: up to (\d\.\d\d)x = 3; up to (\d\.\d\d)x = 4; up to (\d\.\d\d)x = 5; above that = 6\./)!;
  expect(g, "coverage grid").not.toBeNull();
  expect(l, "leverage grid").not.toBeNull();
  const dg = dscr >= Number(g[1]) ? 3 : dscr >= Number(g[2]) ? 4 : dscr >= Number(g[3]) ? 5 : 6;
  const lg = lev <= Number(l[1]) ? 3 : lev <= Number(l[2]) ? 4 : lev <= Number(l[3]) ? 5 : 6;
  expect(body).toMatch(/is in breach and not waived/);
  const grade = Math.max(dg, lg) + 1;
  return { grade, dg, lg, option: oneOption(sc.mc("risk-rating"), GRADES[grade]) };
}

const RISKS = ["Debt service coverage", "Leverage", "Customer concentration", "Collateral: loan to value"];

function solveLeadRisk(sc: Screen) {
  const body = sc.msg("m9").body;
  const pair = (re: RegExp) => {
    const x = body.match(re);
    expect(x, `m9 ${re}`).not.toBeNull();
    return [Number(x![1]), Number(x![2])];
  };
  const [dscr, minDscr] = pair(/Debt service coverage: (\d\.\d\d)x; policy minimum (\d\.\d\d)x/);
  const [lev, maxLev] = pair(/Funded debt to EBITDA: (\d\.\d\d)x; policy maximum (\d\.\d\d)x/);
  const [conc, cap] = pair(/Largest customer: (\d+\.\d)% of receivables; policy maximum (\d+)%/);
  const [ltv, maxLtv] = pair(/Loan to value on the real estate: (\d+\.\d)%; policy maximum (\d+)%/);
  const head = [(dscr - minDscr) / minDscr, (maxLev - lev) / maxLev, (cap - conc) / cap, (maxLtv - ltv) / maxLtv];
  const sorted = [...head].sort((a, b) => a - b);
  const lead = head.indexOf(sorted[0]);
  return { lead, gap: sorted[1] - sorted[0], option: oneOption(sc.mc("lead-risk"), RISKS[lead]), dscr, lev };
}

// ---- Values calls ----

const VALUES_RIGHT: Record<ValuesStepId, RegExp> = {
  "values-integrity": /^Keep the breach in the memo/,
  "values-candor": /^Tell .+ today: send the corrected spread/,
  "values-in-lane": /^Tell .+ it isn't approved until/,
  "values-client-care": /^Decline politely: you can't discuss another customer/,
  "values-quality": /^Hold the booking until the insurance certificate/,
};
const VALUES_TEMPTING: Record<ValuesStepId, RegExp> = {
  "values-integrity": /^Leave it out this once/,
  "values-candor": /^Fix the file quietly/,
  "values-in-lane": /^Say yes:/,
  "values-client-care": /^Share a general picture/,
  "values-quality": /^Book it now and chase the certificate/,
};
const solveValues = (sc: Screen, id: ValuesStepId) => oneOption(sc.mc(id), VALUES_RIGHT[id]);

// ---- Rapid rounds, rendered one item at a time as the attempt flow does ----

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
type Solved = { item: RapidItem; kind: string; answer: string };

const choiceField = (item: RapidItem) => {
  const f = item.fields.find((x) => x.id === "answer") as RapidChoiceField | undefined;
  expect(f, `${item.id} answer field`).toBeDefined();
  expect(f!.options.map((o) => o.id)).toEqual(["a", "b", "c", "d"]);
  return f!;
};
const pick = (item: RapidItem, label: string) => oneOption(choiceField(item), label);
const exRow = (item: RapidItem, label: string) => {
  const v = item.exhibit?.rows?.find((x) => x.label === label)?.value;
  expect(v, `${item.id} row ${label}`).toBeDefined();
  return v!;
};
const usd = (item: RapidItem, label: string) => num(exRow(item, label));
const pct1 = (a: number, b: number) => `${((100 * a) / b).toFixed(1)}%`;
const days = (a: number, b: number) => `${Math.round((365 * a) / b)} days`;

function solveRatio(item: RapidItem): Solved {
  const p = item.prompt;
  const s = (kind: string, label: string) => ({ item, kind, answer: pick(item, label) });
  if (p === "What is the current ratio?") return s("current", xLabel(usd(item, "Current assets") / usd(item, "Current liabilities")));
  if (p === "What is debt to tangible net worth?") {
    return s("dtnw", xLabel(usd(item, "Total liabilities") / (usd(item, "Net worth") - usd(item, "Intangible assets"))));
  }
  if (p === "What is days sales outstanding?") return s("dso", days(usd(item, "Accounts receivable"), usd(item, "Revenue, 12 months")));
  if (p === "What is the loan to value?") return s("ltv", pct1(usd(item, "Loan amount"), usd(item, "Appraised value")));
  if (p === "What is the gross margin?") {
    const rev = usd(item, "Revenue");
    return s("gm", pct1(rev - usd(item, "Cost of sales"), rev));
  }
  if (p === "What is debt service coverage?") {
    const i = usd(item, "Interest expense");
    return s("dscr", xLabel((usd(item, "Net income") + i + usd(item, "Depreciation and amortization")) / (usd(item, "Current portion of LTD, prior year end") + i)));
  }
  if (p === "What is funded debt to EBITDA?") {
    return s("lev-addback", xLabel(usd(item, "Funded debt") / (usd(item, "EBITDA as reported") + usd(item, "One-time expense: lawsuit settlement"))));
  }
  if (p === "What is days sales outstanding on average receivables?") {
    const avg = (usd(item, "Receivables, start of year") + usd(item, "Receivables, end of year")) / 2;
    return s("dso-average", days(avg, usd(item, "Revenue, 12 months")));
  }
  throw new Error(`unknown ratio item: ${p}`);
}

const COV = { ok: "In compliance", eod: "Breach: event of default now", cure: "Breach: still within the cure period", nt: "Not tested this period" };

function solveCovenant(item: RapidItem): Solved {
  const covenant = exRow(item, "Covenant");
  const tested = exRow(item, "Tested");
  const period = exRow(item, "Period");
  const figures = exRow(item, "Figures");
  const cure = exRow(item, "Cure");
  const s = (kind: string, label: string) => ({ item, kind, answer: pick(item, label) });
  const c = covenant.match(/^(Debt service coverage|Funded debt to EBITDA|Current ratio|Tangible net worth) (not less than|not more than|greater than|less than) (\$[\d,]+|\d+\.\d\dx)(.*)$/)!;
  expect(c, covenant).not.toBeNull();
  const limit = c[3].startsWith("$") ? num(c[3]) : Number(c[3].slice(0, -1));
  let actual: number;
  let kind: string;
  const def = c[4].match(/^; coverage = (EBITDA|\(EBITDA − distributions\)) ÷ debt service$/);
  if (def) {
    const f = figures.match(/^EBITDA \$([\d,]+) · distributions \$([\d,]+) · debt service \$([\d,]+)$/)!;
    expect(f, figures).not.toBeNull();
    actual = r2((num(f[1]) - (def[1] === "EBITDA" ? 0 : num(f[2]))) / num(f[3]));
    kind = "definition";
  } else {
    expect(c[4]).toBe("");
    const r = figures.match(/^Reported: (\$[\d,]+|\d+\.\d\dx)$/)!;
    expect(r, figures).not.toBeNull();
    actual = r[1].startsWith("$") ? num(r[1]) : Number(r[1].slice(0, -1));
    kind = "plain";
  }
  if (/^Annually/.test(tested) && /^Quarter ended/.test(period)) return s("not-tested", COV.nt);
  const op = c[2];
  const met = op === "not less than" ? actual >= limit : op === "not more than" ? actual <= limit : op === "greater than" ? actual > limit : actual < limit;
  if (actual === limit) kind = "threshold";
  if (met) return s(kind === "plain" ? "met" : kind, COV.ok);
  if (cure === "None in the agreement") return s(kind === "plain" ? "breach" : kind, COV.eod);
  const k = cure.match(/^May cure within (\d+) days after the compliance certificate is delivered · delivered (.+) · today (.+)$/)!;
  expect(k, cure).not.toBeNull();
  const inside = day(k[3]) - day(k[2]) <= Number(k[1]);
  return s(kind === "plain" ? "cure" : kind, inside ? COV.cure : COV.eod);
}

function solveBase(item: RapidItem): Solved {
  const t = item.exhibit?.table;
  expect(t, `${item.id} aging`).toBeDefined();
  expect(t!.columns).toEqual(["Customer", "0–30 days", "31–90 days", "Over 90 days"]);
  const rate = Number(exRow(item, "Advance rate").match(/^(\d+)%$/)![1]);
  const cap = Number(exRow(item, "Concentration cap").match(/^(\d+)% of eligible receivables$/)![1]);
  let affiliate = false;
  let credit = false;
  const elig = t!.rows.map(([name, a, b, over]) => {
    const bal = num(a) + num(b);
    if (/\(affiliate\)$/.test(name)) {
      affiliate = true;
      return 0;
    }
    if (bal + num(over) < 0) {
      credit = true;
      return 0;
    }
    return bal;
  });
  const total = elig.reduce((s, x) => s + x, 0);
  const limit = (cap * total) / 100;
  const excess = elig.reduce((s, x) => s + Math.max(0, x - limit), 0);
  const eligible = total - excess;
  const kind = excess > 0 ? "concentration" : affiliate ? "affiliate" : credit ? "credit" : "over-90";
  const dollars = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
  if (item.prompt === "What are eligible receivables?") return { item, kind: kind === "over-90" ? "over-90-eligible" : kind, answer: pick(item, dollars(eligible)) };
  expect(item.prompt).toBe("What is availability on receivables?");
  return { item, kind: kind === "over-90" ? "over-90-availability" : kind, answer: pick(item, dollars((eligible * rate) / 100)) };
}

const SOLVERS: Record<RapidStepId, (item: RapidItem) => Solved> = { "rapid-ratios": solveRatio, "rapid-covenants": solveCovenant, "rapid-base": solveBase };
const solveRapid = (seed: string, id: RapidStepId) => rapidItems(seed, id).map(SOLVERS[id]);
const HARD_KINDS: Record<RapidStepId, string[]> = {
  "rapid-ratios": ["dscr", "lev-addback", "dso-average"],
  "rapid-covenants": ["threshold", "cure", "definition"],
  "rapid-base": ["concentration", "affiliate", "credit"],
};

// ---- A strong candidate's answers, built only from the screen ----

function perfectAnswers(seed: string) {
  const sc = screen(seed);
  const memo = readMemo(sc.doc());
  const cert = solveCertificate(sc);
  const rapid = Object.fromEntries(
    RAPID_STEPS.map((id) => [id, { items: Object.fromEntries(solveRapid(seed, id).map((s) => [s.item.id, { values: { answer: s.answer }, ms: 9_000 }])) }]),
  );
  return {
    ...rapid,
    spread: { cells: { ...solveSpread(sc).cells } as Record<string, number | null> },
    "package-review": {
      flags: memo.rows.filter((r) => r.issue).map((r) => ({ target: r.id, reason: r.issue!, note: "" })),
      decision: oneOption(sc.doc().decision!, /^Return it to .+ with the list/),
    },
    "base-certificate": { cells: { elig_ar: cert.elig_ar, elig_inv: cert.elig_inv, avail: cert.avail, excess: cert.excess } as Record<string, number | null> },
    "risk-rating": { selected: [solveRating(sc).option] },
    "lead-risk": { selected: [solveLeadRisk(sc).option] },
    ...Object.fromEntries(VALUES_STEPS.map((id) => [id, { selected: [solveValues(sc, id)] }])),
  } as Record<string, unknown> & {
    spread: { cells: Record<string, number | null> };
    "package-review": { flags: Flag[]; decision: string };
    "base-certificate": { cells: Record<string, number | null> };
  };
}
type Answers = ReturnType<typeof perfectAnswers>;
const clone = (a: Answers): Answers => JSON.parse(JSON.stringify(a));

// ---- Tests ----

describe("banking-stonebridge-renewal: setup", () => {
  it("is registered, version 1, banking, 50 minutes, built step types only", () => {
    expect(listScenarios()).toContain(scenario);
    expect(getScenario("banking-stonebridge-renewal", 1)).toBe(scenario);
    expect(scenario.version).toBe(1);
    expect(scenario.roleFamily).toBe("banking");
    expect(scenario.title).toBe("Stonebridge Bank: credit analyst");
    expect(scenario.timeLimitMinutes).toBe(50);
    const types = Object.fromEntries(scenario.definition.steps.map((s) => [s.id, s.type]));
    expect(types).toEqual({
      "rapid-ratios": "rapid_round",
      spread: "spreadsheet",
      "rapid-covenants": "rapid_round",
      "package-review": "document_review",
      "rapid-base": "rapid_round",
      "base-certificate": "spreadsheet",
      "risk-rating": "multiple_choice",
      "lead-risk": "multiple_choice",
      "values-integrity": "multiple_choice",
      "values-candor": "multiple_choice",
      "values-in-lane": "multiple_choice",
      "values-client-care": "multiple_choice",
      "values-quality": "multiple_choice",
    });
    expect(JSON.parse(JSON.stringify(scenario.definition))).toEqual(scenario.definition);
  });

  it("is deterministic per seed", () => {
    expect(scenario.generate("abc")).toEqual(scenario.generate("abc"));
    expect(renderAttemptForCandidate(scenario, "abc", END)).toEqual(renderAttemptForCandidate(scenario, "abc", END));
  });

  it("different seeds change names, numbers and which row carries which trap", () => {
    const intros = new Set<string>();
    const traps = new Set<string>();
    for (const seed of SEEDS.slice(0, 40)) {
      const sc = screen(seed);
      intros.add(sc.view.intro);
      traps.add(JSON.stringify(readMemo(sc.doc()).rows.map((r) => r.issue)));
    }
    expect(intros.size).toBeGreaterThan(30);
    expect(traps.size).toBeGreaterThan(30);
  });

  it("names every person and the bank's email domain in the fiction, never a real one", () => {
    for (const seed of SEEDS.slice(0, 20)) {
      const html = JSON.stringify(screen(seed).view);
      for (const email of html.match(/[\w.+-]+@[\w.-]+/g) ?? []) expect(email).toMatch(/\.example$/);
    }
  });
});

describe("banking-stonebridge-renewal: spread", () => {
  it(
    "the key matches the spread solved from the statements, the revision and the policy, on every seed",
    () => {
      const basis = new Set<boolean>();
      const gainCols = new Set<number>();
      for (const seed of SEEDS) {
        const sc = screen(seed);
        const s = solveSpread(sc);
        basis.add(s.annualise);
        gainCols.add(s.gainCol);
        const k = scenario.generate(seed).keys.spread as SheetKey;
        expect(Object.keys(k.cells).sort()).toEqual([...SPREAD_INPUTS].sort());
        for (const [id, v] of Object.entries(s.cells)) expect(k.cells[id].value, `${seed} ${id}`).toBeCloseTo(v, 6);
        for (const id of ["d_fy2", "d_fy3", "d_int", "pf", "lev"]) expect(k.cells[id].tolerance, id).toBe(0.01);
        for (const id of ["e_fy2", "a_fy3", "c_int"]) expect(k.cells[id].tolerance ?? k.tolerance ?? 0, id).toBe(0);
      }
      expect(basis).toEqual(new Set([true, false]));
      expect(gainCols).toEqual(new Set([1, 2, 3]));
    },
    LONG,
  );

  it("inputs: 12 period cells at 1.25, pro forma coverage 3, leverage 2: 20 in all", () => {
    const blank = scoreAttempt(scenario, "abc", {});
    const items = Object.fromEntries(blank.steps.spread.items.map((i) => [i.id, i.max]));
    expect(items.pf).toBe(3);
    expect(items.lev).toBe(2);
    for (const id of SPREAD_INPUTS.filter((x) => x !== "pf" && x !== "lev")) expect(items[id], id).toBe(1.25);
    expect(blank.steps.spread.maxPoints).toBe(20);
  });

  it("each spreading trap changes at least one answer, and costs exactly the cells it changes", () => {
    const flaws: (keyof SpreadFlaws)[] = ["keepGain", "keepDistributions", "skipCosDepreciation", "skipNewDebtService", "wrongBasis", "ignoreRevision"];
    const points = (id: string) => (id === "pf" ? 3 : id === "lev" ? 2 : 1.25);
    for (const seed of SEEDS.slice(0, 60)) {
      const sc = screen(seed);
      const right = solveSpread(sc).cells;
      const full = scoreAttempt(scenario, seed, perfectAnswers(seed)).steps.spread.points;
      expect(full).toBe(20);
      for (const flaw of flaws) {
        const wrong = solveSpread(sc, { [flaw]: true }).cells;
        const changed = Object.keys(right).filter((id) => Math.abs(wrong[id] - right[id]) > (["d_fy2", "d_fy3", "d_int", "pf", "lev"].includes(id) ? 0.01 : 0) + 1e-9);
        expect(changed.length, `${seed} ${flaw}`).toBeGreaterThan(0);
        if (flaw === "skipNewDebtService" || flaw === "wrongBasis") expect(changed, `${seed} ${flaw}`).toEqual(["pf"]);
        const a = clone(perfectAnswers(seed));
        a.spread.cells = { ...wrong };
        const got = scoreAttempt(scenario, seed, a).steps.spread.points;
        expect(full - got, `${seed} ${flaw}`).toBeCloseTo(changed.reduce((t, id) => t + points(id), 0), 6);
      }
    }
  });

  it("the controller's revision arrives four minutes into the spread", () => {
    const m3 = scenario.definition.messages.find((m) => m.id === "m3")!;
    expect(m3.stepId).toBe("spread");
    expect(m3.arriveAtMinute).toBe(4);
  });
});

describe("banking-stonebridge-renewal: draft memo against the file", () => {
  it("twelve rows: exactly the six planted problems, with clean look-alikes on every seed", () => {
    for (const seed of SEEDS) {
      const sc = screen(seed);
      const memo = readMemo(sc.doc());
      expect(memo.rows.length, seed).toBe(12);
      expect(memo.rows.filter((r) => r.issue).map((r) => `${r.kind}:${r.issue}`).sort(), seed).toEqual([
        "appraisal:stale",
        "covenant:misstated",
        "interim:stale",
        "name:name",
        "pfs:unsigned",
        "ucc:prior_lien",
      ]);
      const clean = memo.rows.filter((r) => !r.issue).map((r) => r.kind).sort();
      expect(clean, seed).toEqual(["annual", "appraisal", "covenant", "dba", "guaranty", "ucc"]);
      const k = scenario.generate(seed).keys["package-review"] as ReviewKey;
      const at = (kind: string, issue: MemoIssue) => memo.rows.find((r) => r.kind === kind && r.issue === issue)!.id;
      expect(k.findings.interim_stale).toMatchObject({ targets: [at("interim", "stale")], reasons: ["stale"] });
      expect(k.findings.appraisal_stale).toMatchObject({ targets: [at("appraisal", "stale")], reasons: ["stale"] });
      expect(k.findings.pfs_unsigned).toMatchObject({ targets: [at("pfs", "unsigned")], reasons: ["unsigned"] });
      expect(k.findings.covenant_misstated).toMatchObject({ targets: [at("covenant", "misstated")], reasons: ["misstated"] });
      expect(k.findings.prior_lien).toMatchObject({ targets: [at("ucc", "prior_lien")], reasons: ["prior_lien"] });
      expect(k.findings.name_mismatch).toMatchObject({ targets: [at("name", "name")], reasons: ["name"] });
      expect(sc.doc().decision!.options.find((o) => o.id === k.decision![0])!.label).toMatch(/^Return it to .+ with the list/);
    }
  });

  it("the tight covenant is met by a small margin, and the breached one is the one the relationship manager wants left out", () => {
    for (const seed of SEEDS.slice(0, 60)) {
      const sc = screen(seed);
      const doc = sc.doc();
      const memo = readMemo(doc);
      const breached = memo.rows.find((r) => r.kind === "covenant" && r.issue)!;
      const name = breached.item === "Covenant: debt service coverage" ? "debt service coverage" : "funded debt to EBITDA";
      expect(sc.msg("m10").body, seed).toContain(name);
      expect(sc.msg("m8").body, seed).toContain(`${name} covenant is in breach and not waived`);
    }
  });
});

describe("banking-stonebridge-renewal: desk", () => {
  it("borrowing base certificate: the key is the bank's recompute from the aging, the listing and the policy", () => {
    const errors = new Set<string>();
    for (const seed of SEEDS) {
      const sc = screen(seed);
      const c = solveCertificate(sc);
      const k = scenario.generate(seed).keys["base-certificate"] as SheetKey;
      for (const id of ["elig_ar", "elig_inv", "avail", "excess"] as const) expect(k.cells[id].value, `${seed} ${id}`).toBeCloseTo(c[id], 6);
      // The borrower's own column differs from the bank's on at least two lines.
      const sheet = sc.sheet("base-certificate");
      const theirs = (label: string) => num(text(sheet.rows.find((r) => text(r[0]) === label)![1]));
      const diffs = [
        ["elig_ar", theirs("Eligible receivables")],
        ["elig_inv", theirs("Eligible inventory")],
        ["avail", theirs("Availability: lesser of the borrowing base and the line")],
        ["excess", theirs("Excess / (shortfall)")],
      ].filter(([id, v]) => Math.abs((v as number) - c[id as "elig_ar"]) > 1);
      expect(diffs.length, seed).toBeGreaterThanOrEqual(2);
      if (theirs("Less: affiliate accounts") === 0) errors.add("affiliate");
      if (theirs("Less: work in process") === 0) errors.add("wip");
      errors.add(c.excess < 0 ? "shortfall" : "excess");
    }
    expect(errors).toEqual(new Set(["affiliate", "wip", "shortfall", "excess"]));
  });

  it("risk rating: the worse of the two grades, one worse for the breach; the right grade moves around", () => {
    const places = new Set<string>();
    const grades = new Set<number>();
    for (const seed of SEEDS) {
      const sc = screen(seed);
      const r = solveRating(sc);
      expect(r.dg, seed).not.toBe(r.lg);
      expect((scenario.generate(seed).keys["risk-rating"] as McKey).correct).toEqual([r.option]);
      places.add(r.option);
      grades.add(r.grade);
      const mc = sc.mc("risk-rating");
      expect(mc.options.length).toBe(4);
      oneOption(mc, GRADES[Math.max(r.dg, r.lg)]); // the un-notched grade is a wrong option
    }
    expect(places.size).toBe(4);
    expect(grades.size).toBeGreaterThanOrEqual(3);
  });

  it("lead risk: the least headroom against policy, by a clear margin; every risk leads on some seed", () => {
    const leads = new Set<number>();
    for (const seed of SEEDS) {
      const sc = screen(seed);
      const l = solveLeadRisk(sc);
      expect(l.gap, seed).toBeGreaterThanOrEqual(0.04);
      expect((scenario.generate(seed).keys["lead-risk"] as McKey).correct).toEqual([l.option]);
      leads.add(l.lead);
      expect(sc.mc("lead-risk").options.map((o) => o.label).sort()).toEqual([...RISKS].sort());
      // The same base case as the rating worksheet.
      expect(sc.msg("m8").body).toContain(`debt service coverage ${l.dscr.toFixed(2)}x; funded debt to EBITDA ${l.lev.toFixed(2)}x`);
    }
    expect(leads).toEqual(new Set([0, 1, 2, 3]));
  });

  it("values calls: four options, one right, and the right one's place varies by seed", () => {
    for (const id of VALUES_STEPS) {
      const places = new Set<string>();
      for (const seed of SEEDS) {
        const sc = screen(seed);
        const mc = sc.mc(id);
        expect(mc.select).toBe("single");
        expect(mc.options.map((o) => o.id), id).toEqual(["a", "b", "c", "d"]);
        const right = solveValues(sc, id);
        oneOption(mc, VALUES_TEMPTING[id]);
        expect((scenario.generate(seed).keys[id] as McKey).correct, `${seed} ${id}`).toEqual([right]);
        places.add(right);
      }
      expect(places.size, id).toBe(4);
      expect(scenario.definition.steps.find((s) => s.id === id)!.title).toMatch(/^Judgment: /);
    }
  });

  it("the candor call reports the candidate's own error through a colleague", () => {
    for (const seed of SEEDS.slice(0, 20)) {
      const body = screen(seed).msg("m11").body;
      expect(body).toMatch(/the spread you sent/);
    }
  });
});

describe("banking-stonebridge-renewal: rapid rounds", () => {
  it(
    "every item over 200 seeds has exactly one right option, found from the exhibit alone, matching the key",
    () => {
      for (const seed of SEEDS) {
        const keys = scenario.generate(seed).keys;
        for (const id of RAPID_STEPS) {
          const key = keys[id] as RapidKey;
          const solved = solveRapid(seed, id);
          expect(Object.keys(key.items).sort()).toEqual(solved.map((s) => s.item.id).sort());
          for (const s of solved) expect(key.items[s.item.id].answer.choice, `${seed} ${s.item.id} (${s.kind}: ${s.item.prompt})`).toBe(s.answer);
        }
      }
    },
    LONG,
  );

  it("ten quick items worth half a point and five harder kinds worth one; each round totals 10", () => {
    const blank = scoreAttempt(scenario, "abc", {});
    for (const id of RAPID_STEPS) {
      const points = rapidConfig(id).items.map((i) => i.points);
      expect(points.filter((p) => p === 0.5).length, id).toBe(10);
      expect(points.filter((p) => p === 1).length, id).toBe(5);
      expect(points.map((p, i) => (p === 1 ? i : -1)).filter((i) => i >= 0)).toEqual([2, 5, 8, 11, 14]);
      expect(blank.steps[id].maxPoints).toBe(10);
      for (const seed of SEEDS.slice(0, 50)) {
        solveRapid(seed, id).forEach((s, i) => expect(HARD_KINDS[id].includes(s.kind), `${seed} ${id} item ${i} ${s.kind}`).toBe(points[i] === 1));
      }
    }
  });

  it("covers every kind across seeds, both sides of the threshold, cure and definition calls", () => {
    const kinds: Record<RapidStepId, Set<string>> = { "rapid-ratios": new Set(), "rapid-covenants": new Set(), "rapid-base": new Set() };
    const answers = new Set<string>();
    for (const seed of SEEDS.slice(0, 50)) {
      for (const id of RAPID_STEPS) {
        for (const s of solveRapid(seed, id)) {
          kinds[id].add(s.kind);
          if (id === "rapid-covenants" && s.kind !== "met" && s.kind !== "breach" && s.kind !== "not-tested") {
            answers.add(`${s.kind}:${choiceField(s.item).options.find((o) => o.id === s.answer)!.label}`);
          }
        }
      }
    }
    expect([...kinds["rapid-ratios"]].sort()).toEqual(["current", "dscr", "dso", "dso-average", "dtnw", "gm", "lev-addback", "ltv"]);
    expect([...kinds["rapid-covenants"]].sort()).toEqual(["breach", "cure", "definition", "met", "not-tested", "threshold"]);
    expect([...kinds["rapid-base"]].sort()).toEqual(["affiliate", "concentration", "credit", "over-90-availability", "over-90-eligible"]);
    for (const a of [
      `threshold:${COV.ok}`,
      `threshold:${COV.eod}`,
      `cure:${COV.cure}`,
      `cure:${COV.eod}`,
      `definition:${COV.ok}`,
      `definition:${COV.eod}`,
    ]) {
      expect(answers, a).toContain(a);
    }
  });

  it("varies per seed: which item comes first and where the right option sits; option ids are fixed", () => {
    for (const id of RAPID_STEPS) {
      const firsts = SEEDS.slice(0, 60).map((seed) => solveRapid(seed, id)[0]);
      expect(new Set(firsts.map((s) => JSON.stringify(s.item))).size, id).toBeGreaterThan(40);
      expect(new Set(firsts.map((s) => s.answer)).size, id).toBe(4);
    }
  });

  it("the flow renders each rapid item exactly as sequence.renderItem does, with no key", () => {
    for (const id of RAPID_STEPS) {
      const items = rapidItems("abc", id);
      for (const index of [0, 7, 14]) {
        const view = renderFlowForCandidate(scenario, "abc", {
          stepIds: [id],
          messages: [],
          sequences: { [id]: { index, count: 15, endsAt: "2026-11-16T09:00:20.000Z" } },
        });
        const cfg = view.steps[0].config as { current: { item: RapidItem } };
        expect(cfg.current.item).toEqual(items[index]);
        expect(JSON.stringify(cfg)).not.toMatch(/"items"|choice"|tolerance|points/);
      }
    }
  });
});

describe("banking-stonebridge-renewal: scoring", () => {
  it("out of 100: rapid rounds 10 each, spread 20, memo 20, desk 10 + 5 + 5 + 5 × 2", () => {
    const blank = scoreAttempt(scenario, "abc", {});
    expect(blank.points).toBe(0);
    expect(blank.maxPoints).toBe(MAX);
    const max = (id: string) => blank.steps[id].maxPoints;
    expect(RAPID_STEPS.map(max)).toEqual([10, 10, 10]);
    expect(max("spread")).toBe(20);
    expect(max("package-review")).toBe(20);
    expect(max("base-certificate")).toBe(10);
    expect(max("risk-rating")).toBe(5);
    expect(max("lead-risk")).toBe(5);
    for (const id of VALUES_STEPS) expect(max(id), id).toBe(2);
  });

  it("blank scores 0 and the maximum is 100 on every seed", () => {
    for (const seed of SEEDS.slice(0, 50)) {
      const s = scoreAttempt(scenario, seed, {});
      expect(s.points).toBe(0);
      expect(s.maxPoints).toBe(MAX);
    }
  });

  it(
    "a perfect answer, built only from the screen, scores 100 on every seed",
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

  it("another seed's perfect answers average under 40", () => {
    let shared = 0;
    for (let i = 0; i < 40; i++) shared += scoreAttempt(scenario, SEEDS[i + 1], perfectAnswers(SEEDS[i])).points;
    expect(shared / 40).toBeLessThan(40);
  });

  describe("each trap answered wrongly costs exactly its points", () => {
    const seeds = SEEDS.slice(0, 40);
    const lost = (seed: string, mutate: (a: Answers) => void) => {
      const a = clone(perfectAnswers(seed));
      mutate(a);
      return MAX - scoreAttempt(scenario, seed, a).points;
    };

    for (const [finding, reason] of Object.entries(MEMO_FINDINGS)) {
      it(`memo: ${finding} missed loses 3; spotted with the wrong reason loses 1.5`, () => {
        for (const seed of seeds) {
          const k = scenario.generate(seed).keys["package-review"] as ReviewKey;
          const target = k.findings[finding].targets[0];
          expect(lost(seed, (a) => (a["package-review"].flags = a["package-review"].flags.filter((f) => f.target !== target))), seed).toBe(3);
          expect(lost(seed, (a) => (a["package-review"].flags.find((f) => f.target === target)!.reason = reason === "name" ? "other" : "name")), seed).toBe(1.5);
        }
      });
    }

    it("memo: sending it to committee as drafted costs the decision's 2; flagging a clean look-alike costs 1", () => {
      for (const seed of seeds) {
        const sc = screen(seed);
        const send = oneOption(sc.doc().decision!, /^Send it to committee as drafted/);
        expect(lost(seed, (a) => (a["package-review"].decision = send))).toBe(2);
        for (const kind of ["covenant", "ucc", "appraisal", "dba"]) {
          const clean = readMemo(sc.doc()).rows.find((r) => r.kind === kind && !r.issue)!;
          expect(lost(seed, (a) => a["package-review"].flags.push({ target: clean.id, reason: "misstated", note: "" })), `${seed} ${kind}`).toBe(1);
        }
      }
    });

    it("certificate: copying the borrower's figures costs 2.5 per line that's wrong", () => {
      for (const seed of seeds) {
        const sc = screen(seed);
        const sheet = sc.sheet("base-certificate");
        const theirs = (label: string) => num(text(sheet.rows.find((r) => text(r[0]) === label)![1]));
        const borrower = {
          elig_ar: theirs("Eligible receivables"),
          elig_inv: theirs("Eligible inventory"),
          avail: theirs("Availability: lesser of the borrowing base and the line"),
          excess: theirs("Excess / (shortfall)"),
        };
        const right = solveCertificate(sc);
        const wrongLines = (Object.keys(borrower) as (keyof typeof borrower)[]).filter((id) => Math.abs(borrower[id] - right[id]) > 1).length;
        expect(lost(seed, (a) => (a["base-certificate"].cells = { ...borrower })), seed).toBe(2.5 * wrongLines);
      }
    });

    it("rating without the breach notch, a wrong lead risk, and each values call's tempting option cost all their points", () => {
      for (const seed of seeds) {
        const sc = screen(seed);
        const r = solveRating(sc);
        const unNotched = oneOption(sc.mc("risk-rating"), GRADES[Math.max(r.dg, r.lg)]);
        expect(lost(seed, (a) => ((a["risk-rating"] as { selected: string[] }).selected = [unNotched]))).toBe(5);
        const l = solveLeadRisk(sc);
        const other = sc.mc("lead-risk").options.find((o) => o.id !== l.option)!.id;
        expect(lost(seed, (a) => ((a["lead-risk"] as { selected: string[] }).selected = [other]))).toBe(5);
        for (const id of VALUES_STEPS) {
          const tempting = oneOption(sc.mc(id), VALUES_TEMPTING[id]);
          expect(lost(seed, (a) => ((a[id] as { selected: string[] }).selected = [tempting])), `${seed} ${id}`).toBe(2);
        }
      }
    });

    it("rapid rounds: a wrong hard item costs 1, a wrong quick item ½", () => {
      for (const seed of seeds.slice(0, 10)) {
        for (const id of RAPID_STEPS) {
          const items = rapidConfig(id).items;
          const hard = items.find((i) => i.points === 1)!.id;
          const easy = items.find((i) => i.points === 0.5)!.id;
          expect(lost(seed, (a) => delete (a[id] as { items: Record<string, unknown> }).items[hard])).toBe(1);
          expect(lost(seed, (a) => delete (a[id] as { items: Record<string, unknown> }).items[easy])).toBe(0.5);
        }
      }
    });
  });
});

describe("banking-stonebridge-renewal: nothing from the key reaches the candidate", () => {
  it(
    "no reviewer note, key word or computed answer in any payload",
    () => {
      for (const seed of SEEDS) {
        const variant = scenario.generate(seed);
        const notes = Object.values((variant.keys["package-review"] as ReviewKey).findings).map((f) => f.note!);
        for (const n of notes) expect(n.length).toBeGreaterThan(10);
        const numbers = ["spread", "base-certificate"].flatMap((id) => Object.values((variant.keys[id] as SheetKey).cells).map((c) => c.value));
        for (const minute of [0, 20, END]) {
          const payload = JSON.stringify(renderAttemptForCandidate(scenario, seed, minute));
          expect(payload).not.toMatch(/"keys"|tolerance|"criteria"|"guidance"|"notes"|"points"|"expected"|"findings"|"clean":|"correct"/);
          for (const n of notes) expect(payload, seed).not.toContain(n);
          for (const c of numbers.filter((x) => x >= 1)) {
            const forms = [JSON.stringify(c), c.toFixed(2), String(Math.round(c * 100)), c.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })];
            for (const f of [...new Set(forms)].filter((x) => !/^\d{1,3}$/.test(x))) {
              expect(payload, `${seed} ${f}`).not.toMatch(new RegExp(`(?<![\\d.,])${f.replace(/[.$]/g, "\\$&")}(?![\\d.]\\d)`));
            }
          }
        }
      }
    },
    LONG,
  );
});

describe("banking-stonebridge-renewal: timed sections", () => {
  const def = scenario.definition;
  const MIN = 60_000;
  const t0 = Date.parse("2026-11-16T09:00:00Z");
  const flowAt = (ms: number) => resolveFlow(def, { startedAt: t0, now: t0 + ms, extraTimePercent: 0, events: [] });
  const stepById = (id: string) => def.steps.find((s) => s.id === id)!;

  it("validateSections passes and the six fixed sections fill 50 minutes", () => {
    expect(validateSections(def, scenario.timeLimitMinutes)).toEqual([]);
    expect(def.sections!.map((s) => [s.id, s.minutes, s.stepIds, !!s.oneAtATime])).toEqual([
      ["s-rapid-a", 6, ["rapid-ratios"], false],
      ["s-work-1", 10, ["spread"], false],
      ["s-rapid-b", 6, ["rapid-covenants"], false],
      ["s-work-2", 10, ["package-review"], false],
      ["s-rapid-c", 6, ["rapid-base"], false],
      ["s-desk", 12, [...DESK_STEPS], true],
    ]);
  });

  it("desk screens: certificate 210 s, rating and lead risk 75 s, values 72 s each; 720 s in all", () => {
    expect(DESK_STEPS.map((id) => stepById(id).seconds)).toEqual([210, 75, 75, 72, 72, 72, 72, 72]);
    expect(DESK_STEPS.reduce((t, id) => t + stepById(id).seconds!, 0)).toBe(720);
  });

  it("each rapid round is 15 items x 20 seconds", () => {
    for (const id of RAPID_STEPS) {
      const config = rapidConfig(id);
      expect(config.items.length, id).toBe(15);
      expect(config.secondsPerItem).toBe(20);
    }
  });

  it("runs the sections back to back", () => {
    const at = (min: number) => flowAt(min * MIN);
    expect(at(0).visibleStepIds).toEqual(["rapid-ratios"]);
    expect(at(6).visibleStepIds).toEqual(["spread"]);
    expect(at(16).visibleStepIds).toEqual(["rapid-covenants"]);
    expect(at(22).visibleStepIds).toEqual(["package-review"]);
    expect(at(32).visibleStepIds).toEqual(["rapid-base"]);
    expect(at(38).visibleStepIds).toEqual(["base-certificate"]);
    expect(at(END).done).toBe(true);
  });

  it("every message points at a real step and arrives with its section; the revision comes at minute 10", () => {
    const ids = new Set(def.steps.map((s) => s.id));
    for (const m of def.messages) expect(ids.has(m.stepId!), m.id).toBe(true);
    for (const step of def.steps) expect(def.messages.some((m) => m.stepId === step.id), `brief for ${step.id}`).toBe(true);
    const msgsAt = (min: number) => visibleMessageIds(def, flowAt(min * MIN), t0, t0 + min * MIN);
    expect(msgsAt(0)).toEqual(["m1"]);
    expect(msgsAt(6)).toEqual(["m1", "m2"]);
    expect(msgsAt(10)).toEqual(["m1", "m2", "m3"]);
    expect(msgsAt(38).length).toBe(def.messages.length);
  });

  it("messages come from a recurring cast with fixed role lines", () => {
    expect([...new Set(def.messages.map((m) => m.from))].sort()).toEqual([
      "Another bank customer",
      "Borrower's controller",
      "Chief credit officer",
      "Loan operations",
      "Relationship manager",
    ]);
  });
});
