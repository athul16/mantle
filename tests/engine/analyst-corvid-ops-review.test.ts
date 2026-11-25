import { describe, expect, it, vi } from "vitest";
import type { RapidChoiceField, RapidItem } from "@/lib/engine/step-types/rapid_round/public";
import type { PublicCell, SpreadsheetPublicConfig } from "@/lib/engine/step-types/spreadsheet/public";

vi.mock("server-only", () => ({}));

const { analystCorvidOpsReview } = await import("@/lib/engine/scenarios/analyst-corvid-ops-review");
const { getScenario, listScenarios } = await import("@/lib/engine/scenarios");
const { renderAttemptForCandidate, renderFlowForCandidate } = await import("@/lib/engine/server/render");
const { scoreAttempt } = await import("@/lib/engine/server/score");
const { resolveFlow, visibleMessageIds, validateSections } = await import("@/lib/engine/server/flow");
const { rapidRoundServer } = await import("@/lib/engine/step-types/rapid_round/server");
const { fillTemplate, templateValues } = await import("@/lib/engine/server/template");

/**
 * Business / operations analyst: Corvid Lane cost review. Three rapid rounds
 * (numbers, evidence, sense checks) and three work sections (site benchmark
 * spreadsheet, steering deck check, steering pack desk with five values
 * calls), 50 minutes, 100 points. Every task is solved here from what the
 * candidate sees, with an independent reading of the rules, then compared
 * with the server key.
 */

const scenario = analystCorvidOpsReview;
const SLUG = "analyst-corvid-ops-review";
const SEEDS = Array.from({ length: 200 }, (_, i) => `attempt-${i.toString(16).padStart(4, "0")}`);
const END = scenario.timeLimitMinutes;
const MAX = 100;
const RAPID_STEPS = ["rapid-numbers", "rapid-evidence", "rapid-sense"] as const;
type RapidStepId = (typeof RAPID_STEPS)[number];
const VALUES_STEPS = ["values-integrity", "values-candor", "values-client-care", "values-in-lane", "values-teamwork"] as const;
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
type Ord = { prompt: string; items: { id: string; label: string; detail?: string }[] };
type Num = { prompt: string; unit?: string; decimals: number };
type ReviewKey = { findings: Record<string, { targets: string[]; reasons: string[]; note?: string }>; decision?: string[] };
type McKey = { correct: string[] };
type NumKey = { value: number; tolerance: number; partialTolerance?: number };
type OrdKey = { order: string[] };
type SheetKey = { tolerance?: number; cells: Record<string, { value: number; tolerance?: number }> };
type Flag = { target: string; reason: string; note: string };

// ---- Formats, written independently of the scenario ----

const fmt = (n: number) => n.toLocaleString("en-US");
const num = (s: string) => {
  expect(s, `number "${s}"`).toMatch(/^\d{1,3}(,\d{3})*$/);
  return Number(s.replace(/,/g, ""));
};
const dollars = (s: string) => {
  expect(s, `money "${s}"`).toMatch(/^\$\d{1,3}(,\d{3})*(\.\d+)?$/);
  return Number(s.replace(/[$,]/g, ""));
};
const round2 = (x: number) => Number(x.toFixed(2));
const pct1 = (x: number) => `${x.toFixed(1)}%`;
const signed1 = (x: number) => `${x >= 0 ? "+" : "-"}${Math.abs(x).toFixed(1)}%`;
const usd2 = (x: number) => `$${x.toFixed(2)}`;
/** Two significant figures, the way the sense-check round labels them. */
const sig2 = (x: number) => Number(x.toPrecision(2));
const short = (x: number) => String(Number(x.toPrecision(2)));
function aboutMoney(x: number) {
  const r = sig2(x);
  if (r >= 1e9) return `About $${short(r / 1e9)}B`;
  if (r >= 1e6) return `About $${short(r / 1e6)}M`;
  if (r >= 1e3) return `About $${short(r / 1e3)}K`;
  return `About $${short(r)}`;
}
function aboutCount(x: number) {
  const r = sig2(x);
  if (r >= 1e6) return `About ${short(r / 1e6)}M`;
  return `About ${r >= 1 ? fmt(r) : short(r)}`;
}
const aboutPct = (x: number) => `About ${short(x)}%`;

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
    sheet: () => step("site-analysis").config as SpreadsheetPublicConfig,
    deck: () => step("deck-check").config as Doc,
    ord: () => step("summary-order").config as Ord,
    num: (id: "payback" | "net-saving") => step(id).config as Num,
    mc: (id: ValuesStepId) => step(id).config as Mc,
  };
}
type Screen = ReturnType<typeof screen>;

const match = (s: string, re: RegExp, what = String(re)) => {
  const m = s.match(re);
  expect(m, `${what} in "${s.slice(0, 200)}"`).not.toBeNull();
  return m!;
};

// ---- Site analysis ----

const text = (c: PublicCell) => (c.kind === "text" ? c.text : "");
const inputId = (c: PublicCell) => (c.kind === "input" ? c.id : null);

function readSites(sc: Screen) {
  const sheet = sc.sheet();
  const cols = sheet.columns;
  expect(cols.slice(0, 3)).toEqual(["Code", "Site", "Months of data"]);
  expect(cols[3]).toMatch(/^Volume \(.+\)$/);
  expect(cols.slice(4, 6)).toEqual(["Labour hours", "Operating cost"]);
  const unit = match(cols[6], /^Cost per (.+) \(\$\)$/)[1];
  expect(cols[7]).toMatch(/ per labour hour$/i);

  const notes = sheet.prompt;
  const kSite = match(notes, /except (.+?), which reports operating cost in \$000s/)[1];
  const [, pSite, pN, cSite, cMonth, cN] = match(notes, /Months of data: (.+?) opened partway through the year and has (\d+) months; (.+?) closed at the end of (\w+) and has (\d+) months\. Every other site has 12\./);
  const brief = sc.msg("m-brief").body;
  expect(brief).toContain(`${cSite} closed at the end of ${cMonth} and is out of scope`);
  expect(brief).toMatch(/Benchmark: the median cost per .+ across the in-scope sites/);
  expect(brief).toMatch(/Annualise part-year sites: volume × 12 ÷ months of data/);
  const [, corSite, corHours, corWrong] = match(sc.msg("m-correction").body, /extract: (.+?)'s labour hours double-count agency hours\. The right figure is ([\d,]+) for the period, not ([\d,]+)\./);

  const data = sheet.rows.slice(0, 9).map((r, i) => {
    const site = text(r[1]);
    const months = Number(text(r[2]));
    const vol = num(text(r[3]));
    let hours = num(text(r[4]));
    const rawCost = num(text(r[5]));
    if (site === corSite) {
      expect(hours, "the extract shows the hours being corrected").toBe(num(corWrong));
      hours = num(corHours);
    }
    const cost = site === kSite ? rawCost * 1000 : rawCost;
    expect((cost * 100) % vol, `${site} cost per unit is a whole number of cents`).toBe(0);
    expect(months).toBe(site === pSite ? Number(pN) : site === cSite ? Number(cN) : 12);
    return { row: i + 1, code: text(r[0]), site, months, vol, hours, cents: (cost * 100) / vol, cpu: inputId(r[6]), uph: inputId(r[7]) };
  });
  expect(sheet.rows.length).toBe(11);
  expect(inputId(sheet.rows[9][6])).toBe("benchmark");
  expect(inputId(sheet.rows[10][6])).toBe("saving");

  const codes = data.map((d) => d.code);
  const dups = codes.filter((c, i) => codes.indexOf(c) !== i);
  expect(dups.length, "exactly one site appears twice").toBe(1);
  const twice = data.filter((d) => d.code === dups[0]);
  expect(twice[0].site).toBe(twice[1].site);
  expect(twice[0].vol).toBe(twice[1].vol);
  const firsts = data.filter((d, i) => codes.indexOf(d.code) === i);
  expect(firsts.length).toBe(8);
  const inScope = firsts.filter((d) => d.site !== cSite);
  expect(inScope.length).toBe(7);
  const sorted = inScope.map((d) => d.cents).sort((a, b) => a - b);
  const bench = sorted[3];
  const saving = inScope.reduce((s, d) => s + (d.cents > bench ? ((d.cents - bench) * d.vol * 12) / d.months / 100 : 0), 0);
  const cells: Record<string, number> = { benchmark: bench / 100, saving: Math.round(saving) };
  for (const d of inScope) {
    cells[d.cpu!] = d.cents / 100;
    cells[d.uph!] = round2(d.vol / d.hours);
  }
  return { unit, data, inScope, firsts, kSite, pSite, cSite, corSite, dupCode: dups[0], bench, saving: cells.saving, cells, twice };
}

// ---- Deck check ----

const field = (doc: Doc, id: string) => {
  const f = doc.document.fields.find((x) => x.id === id);
  expect(f, `field ${id}`).toBeDefined();
  return f!.value;
};

function readDeck(sc: Screen) {
  const doc = sc.deck();
  expect(doc.document.columns).toEqual(["Slide", "Title", "Figure cited", "Period", "Unit", "Source"]);
  const fy = match(field(doc, "fy"), /^FY(\d{4}) runs /)[1];
  const a1 = Number(match(field(doc, "a1"), /^\$(\d+\.\d\d)M, FY\d{4}$/)[1]);
  const a4 = Number(match(field(doc, "a4"), /^\$(\d+\.\d\d)M a year/)[1]);
  const shares = (id: string) =>
    Object.fromEntries(match(field(doc, id), /^(.+) \(FY\d{4}\)$/)[1].split(", ").map((p) => {
      const m = match(p, /^(.+) (\d+\.\d)%$/);
      return [m[1], Number(m[2])];
    }));
  const a2 = shares("a2");
  const a3 = shares("a3");
  for (const s of [a2, a3]) expect(Math.round(Object.values(s).reduce((t, x) => t + x, 0) * 10)).toBe(1000);
  expect(field(doc, "a5")).toMatch(/ in \$000s, FY/);
  expect(field(doc, "a8")).toMatch(/ in \$000s, FY/);
  expect(field(doc, "rule")).toMatch(/Rounded shares may total 99% to 101%/);
  const withdrawn = match(sc.msg("m-deck-update").body, /I've pulled slide (\d+)/)[1];

  const rows = doc.document.rows.map((r, i) => {
    const [no, title, fig, period, unit, src] = r.cells;
    expect(no).toBe(String(i + 1));
    let issue: string | null = null;
    let lookalike: string | null = null;
    if (no === withdrawn) return { id: r.id, no, title, fig, src, issue, lookalike: "withdrawn" };
    const parts = fig.match(/^(\w[\w ]*? \d+%)(, \w[\w ]*? \d+%)+$/) ? fig.split(", ").map((p) => p.match(/^(.+) (\d+)%$/)!) : null;
    if (src === "—") {
      if (fig !== "—") issue = "source";
      else lookalike = "no-figure";
    } else if (/CY\d{4}/.test(period) && /FY\d{4}/.test(period)) issue = "period";
    else if (src === "A1" || src === "A4") {
      const want = (src === "A1" ? a1 : a4).toFixed(1);
      const got = match(fig, /^\$(\d+\.\d)M$/)[1];
      expect(unit).toBe("$M");
      if (got !== want) issue = "mismatch";
      else lookalike = "rounded";
    } else if (src === "A5" || src === "A8") {
      expect(field(doc, src.toLowerCase())).toContain(`${fig} in $000s`);
      if (unit !== "$000s") issue = "units";
      else lookalike = "thousands";
    } else if (parts) {
      const total = parts.reduce((t, p) => t + Number(p[2]), 0);
      if (total < 99 || total > 101) issue = "shares";
      else {
        const app = src === "A2" ? a2 : a3;
        for (const p of parts) expect(Number(p[2]), `${p[1]} rounds the appendix`).toBe(Math.round(app[p[1]]));
        if (total !== 100) lookalike = "shares-round";
      }
    } else if (src === "A6") {
      if (!/^Sites with more overtime had higher cost/.test(title)) issue = "overclaim";
      else lookalike = "correlation";
    } else if (src === "A7") {
      if (/every year/.test(title)) issue = "overclaim";
    }
    return { id: r.id, no, title, fig, src, issue, lookalike };
  });
  return { rows, withdrawn, fy };
}

// ---- Desk ----

function solveSummary(sc: Screen) {
  const items = sc.ord().items;
  expect(items.length).toBe(7);
  const one = (re: RegExp) => {
    const x = items.filter((i) => re.test(i.label));
    expect(x.length, `one summary line like ${re}`).toBe(1);
    return x[0];
  };
  const answer = one(/^Bringing the sites above the median to it saves about \$\d+\.\dM a year$/);
  const risk = one(/^Risk: /);
  const ask = one(/^Ask: /);
  const next = one(/^Next steps: /);
  const findings = items
    .filter((i) => ![answer, risk, ask, next].includes(i))
    .map((i) => ({ id: i.id, m: Number(match(i.label, /: \$(\d+\.\d)M a year$/)[1]) }));
  expect(findings.length).toBe(3);
  expect(new Set(findings.map((f) => f.m)).size).toBe(3);
  const total = Number(match(answer.label, /about \$(\d+\.\d)M/)[1]);
  expect(Math.round(findings.reduce((t, f) => t + f.m, 0) * 10)).toBe(Math.round(total * 10));
  findings.sort((a, b) => b.m - a.m);
  return [answer.id, ...findings.map((f) => f.id), risk.id, ask.id, next.id];
}

function readCase(sc: Screen) {
  const [, a, b, c] = match(sc.msg("m-brief").body, /site re-layout \$([\d,]+), WMS changes \$([\d,]+), project team \$([\d,]+)/);
  const oneTime = num(a) + num(b) + num(c);
  const s = num(match(sc.msg("m-payback").body, /run-rate saving is \$([\d,]+) a year/)[1]);
  expect(sc.msg("m-net").body).toMatch(/year one at half the run-rate/);
  return { oneTime, s, payback: Number(((oneTime * 12) / s).toFixed(1)), net: 2.5 * s - oneTime };
}

function oneOption(cfg: { options: { id: string; label: string }[] }, re: RegExp) {
  const o = cfg.options.filter((x) => re.test(x.label));
  expect(o.length, `one option like ${re}`).toBe(1);
  return o[0].id;
}
const VALUES_RIGHT: Record<ValuesStepId, RegExp> = {
  "values-integrity": /^Keep \$\d+\.\dM on the title/,
  "values-candor": /^Check it against the source, send .+ a corrected table today/,
  "values-client-care": /^Decline: client information stays inside the engagement/,
  "values-in-lane": /^Say recommendations come from .+ at the steering committee/,
  "values-teamwork": /^Tell .+ now, privately, with the corrected figure/,
};
const solveValues = (sc: Screen, id: ValuesStepId) => oneOption(sc.mc(id), VALUES_RIGHT[id]);

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

const choiceField = (item: RapidItem, n: number) => {
  const f = item.fields.find((x) => x.id === "answer") as RapidChoiceField | undefined;
  expect(f, `${item.id} answer field`).toBeDefined();
  expect(f!.options.length).toBe(n);
  expect(new Set(f!.options.map((o) => o.label)).size, `${item.id} options differ`).toBe(n);
  return f!;
};
const pick = (item: RapidItem, label: string, n = 4) => {
  const opts = choiceField(item, n).options.filter((o) => o.label === label);
  expect(opts.length, `${item.id}: one option "${label}" in ${JSON.stringify(choiceField(item, n).options)}`).toBe(1);
  return { answer: opts[0].id };
};
const row = (item: RapidItem, label: string) => {
  const v = item.exhibit?.rows?.find((x) => x.label === label)?.value;
  expect(v, `${item.id} row ${label}`).toBeDefined();
  return v!;
};
const rowsOf = (item: RapidItem) => item.exhibit!.rows!;

/** Numbers: the right figure from the exhibit. */
function solveNumbers(item: RapidItem): Solved {
  const title = item.exhibit!.title;
  switch (title) {
    case "Year on year": {
      const o = num(row(item, "Last year"));
      const n = num(row(item, "This year"));
      return { kind: "pct-change", values: pick(item, signed1((100 * (n - o)) / o)) };
    }
    case "Income statement extract": {
      const r = dollars(row(item, "Revenue"));
      const c = dollars(row(item, "Cost of goods sold"));
      expect(item.prompt).toMatch(/gross margin/);
      return { kind: "margin", values: pick(item, pct1((100 * (r - c)) / r)) };
    }
    case "Operating cost by site": {
      const site = match(item.prompt, /^What share of the total is (.+)\?$/)[1];
      const total = dollars(row(item, "Total"));
      const parts = rowsOf(item).filter((x) => x.label !== "Total").map((x) => dollars(x.value));
      expect(parts.reduce((t, x) => t + x, 0)).toBe(total);
      return { kind: "share", values: pick(item, pct1((100 * dollars(row(item, site))) / total)) };
    }
    case "Cost build-up": {
      const f = dollars(match(row(item, "Fixed cost"), /^(\$[\d,]+) a month$/)[1]);
      const v = dollars(match(row(item, "Variable cost"), /^(\$[\d.]+) per /)[1]);
      const vol = num(match(row(item, "Volume"), /^([\d,]+) .+ a month$/)[1]);
      return { kind: "unit-cost", values: pick(item, usd2(f / vol + v)) };
    }
    case "Business case": {
      const f = dollars(row(item, "One-time cost"));
      const s = dollars(match(row(item, "Saving"), /^(\$[\d.]+) per /)[1]);
      const r = dollars(match(row(item, "Running cost"), /^(\$[\d.]+) per /)[1]);
      const units = match(row(item, "Rounding"), /^Nearest whole (.+)$/)[1];
      const n = Math.round((f * 100) / Math.round((s - r) * 100));
      expect(n * Math.round((s - r) * 100), "break-even is a whole number").toBe(f * 100);
      return { kind: "break-even", values: pick(item, `${fmt(n)} ${units}s`) };
    }
    case "Returns": {
      const a = Number(match(row(item, "Returned"), /^([\d.]+)% of orders$/)[1]);
      const b = Number(match(row(item, "Damaged in transit"), /^(\d+)% of returns$/)[1]);
      return { kind: "pct-of-pct", values: pick(item, `${((a * b) / 100).toFixed(2)}%`) };
    }
    case "Two sites, one network": {
      const [x, y] = rowsOf(item).slice(0, 2).map((r) => match(r.value, /^\$([\d.]+) per .+ on ([\d,]+) /));
      const w = (Number(x[1]) * num(x[2]) + Number(y[1]) * num(y[2])) / (num(x[2]) + num(y[2]));
      return { kind: "weighted", values: pick(item, usd2(w)) };
    }
    case "Gross margin by customer type": {
      const seg = (label: string) => {
        const m = match(row(item, label), /^Revenue \$(\d+)M → \$(\d+)M · margin (\d+)% → (\d+)%$/);
        return { r1: Number(m[1]), r2: Number(m[2]), m1: Number(m[3]), m2: Number(m[4]) };
      };
      const a = seg("Contract customers");
      const b = seg("Spot customers");
      expect(a.m2).toBeGreaterThan(a.m1);
      expect(b.m2).toBeGreaterThan(b.m1);
      const ty = (a.r2 * a.m2 + b.r2 * b.m2) / (a.r2 + b.r2);
      const ly = (a.r1 * a.m1 + b.r1 * b.m1) / (a.r1 + b.r1);
      expect(ty, "the mix effect: both rise, the total falls").toBeLessThan(ly);
      return { kind: "mix", values: pick(item, pct1(ty)) };
    }
    case "Volume outlook": {
      const [, v0, units] = match(row(item, "Volume this year"), /^([\d,]+) (.+)$/);
      const g = Number(match(row(item, "Growth"), /^(\d+)% a year, compounded$/)[1]);
      expect(row(item, "Horizon")).toBe("Three years");
      const v3 = num(v0) * (1 + g / 100) ** 3;
      return { kind: "compound", values: pick(item, `${fmt(Math.round(v3 / 1000) * 1000)} ${units}`) };
    }
    default:
      throw new Error(`unknown numbers exhibit ${title}`);
  }
}

const SUPPORTED = "Supported";
const NOT_SUPPORTED = "Not supported: the data can't show it";
const CONTRADICTED = "Contradicted: the data shows otherwise";

/** Evidence: does the exhibit support the draft line? */
function solveEvidence(item: RapidItem): Solved {
  const claim = match(item.prompt, /^Draft slide line: "(.+)" What does the data say\?$/)[1];
  const rows = rowsOf(item);
  const verdict = (ok: boolean) => (ok ? SUPPORTED : CONTRADICTED);
  const out = (kind: string, label: string) => ({ kind, values: pick(item, label, 3) });
  let m: RegExpMatchArray | null;
  if ((m = claim.match(/^(.+) has the (highest|lowest) cost per .+?( in the network)?\.$/))) {
    if (!rows.every((r) => r.value.startsWith("$"))) return out("not-shown", NOT_SUPPORTED);
    const costs = rows.map((r) => ({ site: r.label, c: dollars(r.value) }));
    const best = m[2] === "highest" ? Math.max(...costs.map((c) => c.c)) : Math.min(...costs.map((c) => c.c));
    return out("highest", verdict(costs.find((c) => c.site === m![1])!.c === best));
  }
  if ((m = claim.match(/^The three sites shipped ([\d,]+) .+ last quarter\.$/))) {
    const sum = rows.slice(0, 3).reduce((t, r) => t + num(r.value), 0);
    return out("total", verdict(sum === num(m[1])));
  }
  if ((m = claim.match(/^(.+)'s volume rose (\d+)% on last year\.$/))) {
    const o = num(row(item, "Last year"));
    const n = num(row(item, "This year"));
    return out("change", verdict(Math.round((100 * (n - o)) / o) === Number(m[2])));
  }
  if (/will ship more .+ next year than this year\.$/.test(claim)) return out("not-shown", NOT_SUPPORTED);
  if ((m = claim.match(/^All three sites met the ([\d.]+)% fill-rate target\.$/))) {
    expect(row(item, "Target")).toBe(`${m[1]}%`);
    const rates = rows.filter((r) => r.label !== "Target").map((r) => Number(match(r.value, /^([\d.]+)%$/)[1]));
    expect(rates.length).toBe(3);
    return out("target", verdict(rates.every((r) => r >= Number(m![1]))));
  }
  const corr = () =>
    rows.map((r) => {
      const x = match(r.value, /^Overtime (\d+)% of hours · \$([\d.]+) per /);
      return [Number(x[1]), Number(x[2])];
    });
  if (/^Sites with more overtime had a higher cost per /.test(claim)) {
    const pts = corr().sort((a, b) => a[0] - b[0]);
    return out("correlation", verdict(pts.every((p, i) => i === 0 || p[1] > pts[i - 1][1])));
  }
  if (/^Overtime drives the higher cost per /.test(claim)) {
    corr();
    return out("correlation", NOT_SUPPORTED);
  }
  if ((m = claim.match(/^(.+) has a higher error rate than (.+)\.$/))) {
    const rate = (site: string) => {
      const x = match(row(item, site), /^([\d,]+) orders · ([\d,]+) picking errors$/);
      return num(x[2]) / num(x[1]);
    };
    return out("bases", verdict(rate(m[1]) > rate(m[2])));
  }
  if ((m = claim.match(/^(.+)'s Q(\d) volume was up (\d+)% on a year earlier\.$/))) {
    const [a, b] = rows.slice(0, 2).map((r) => num(r.value));
    expect(rows[0].label).toMatch(new RegExp(`^Q${m[2]} \\d{4}$`));
    return out("two-points", verdict(Math.round((100 * (b - a)) / a) === Number(m[3])));
  }
  if (/'s volume is on a rising trend\.$/.test(claim)) {
    expect(rows.filter((r) => /^Q\d \d{4}$/.test(r.label)).length, "two data points").toBe(2);
    return out("two-points", NOT_SUPPORTED);
  }
  const types = () =>
    rows.map((r) => {
      const l = match(r.label, /^(.+) · (standard|rush)$/);
      const v = match(r.value, /^([\d,]+) orders · ([\d.]+)% on time$/);
      return { site: l[1], type: l[2], n: num(v[1]), r: Number(v[2]) };
    });
  if ((m = claim.match(/^(.+)'s on-time rate is higher than (.+)'s overall\.$/))) {
    const t = types();
    const overall = (s: string) => {
      const x = t.filter((y) => y.site === s);
      return x.reduce((a, y) => a + y.n * y.r, 0) / x.reduce((a, y) => a + y.n, 0);
    };
    return out("subgroups", verdict(overall(m[1]) > overall(m[2])));
  }
  if ((m = claim.match(/^(.+) beats (.+) on on-time rate for both order types\.$/))) {
    const t = types();
    const r = (s: string, ty: string) => t.find((y) => y.site === s && y.type === ty)!.r;
    return out("subgroups", verdict(["standard", "rush"].every((ty) => r(m![1], ty) > r(m![2], ty))));
  }
  throw new Error(`unknown evidence claim ${claim}`);
}

/** Sense checks: the rough figure the inputs give. */
function solveSense(item: RapidItem): Solved {
  const title = item.exhibit!.title!;
  const lead = (s: string) => num(match(s, /^([\d,]+)/)[1]);
  const money = (s: string) => dollars(match(s, /^(\$[\d,.]+)/)[1]);
  const go = (kind: string, label: string) => ({ kind, values: pick(item, label) });
  switch (true) {
    case title === "Labour cost":
      return go("fte", aboutMoney(lead(row(item, "Warehouse staff")) * money(row(item, "Loaded cost per FTE"))));
    case title === "Rent":
      return go("rent", aboutMoney(lead(row(item, "Floor area")) * money(row(item, "Rent"))));
    case /^Cost per /.test(title):
      return go("unit-cost", aboutMoney(money(row(item, "Operating cost")) / lead(row(item, "Volume"))));
    case title === "Saving":
      return go("saving", aboutMoney(lead(row(item, "Volume")) * money(row(item, "Saving"))));
    case title === "Damage":
      return go("share", aboutPct((100 * lead(row(item, "Damaged"))) / lead(row(item, "Shipped"))));
    case title === "Daily throughput":
      return go("per-day", aboutCount(lead(row(item, "Volume")) / lead(row(item, "Operating days"))));
    case title === "Fuel":
      return go("per-year", aboutMoney(money(row(item, "Fuel")) * lead(row(item, "Operating days"))));
    case title === "Storage":
      return go("per-pallet", aboutMoney(money(row(item, "Storage")) / lead(row(item, "Pallet"))));
    case title === "Freight by region": {
      expect(row(item, "Units")).toBe("All figures in $000s");
      return go("thousands", aboutMoney(["North", "South", "West"].reduce((t, r) => t + num(row(item, r)), 0) * 1000));
    }
    case title === "Staffing": {
      expect(row(item, "Hours per FTE")).toMatch(/^2,080 a year/);
      return go("fte-hours", aboutCount(lead(row(item, "Labour hours")) / 2080));
    }
    default:
      throw new Error(`unknown sense exhibit ${title}`);
  }
}

const SOLVERS: Record<RapidStepId, (item: RapidItem) => Solved> = {
  "rapid-numbers": solveNumbers,
  "rapid-evidence": solveEvidence,
  "rapid-sense": solveSense,
};
const HARD: Record<RapidStepId, string[]> = {
  "rapid-numbers": ["pct-of-pct", "weighted", "mix", "compound"],
  "rapid-evidence": ["correlation", "bases", "two-points", "subgroups"],
  "rapid-sense": ["per-day", "per-year", "per-pallet", "thousands", "fte-hours"],
};
const solveRapid = (seed: string, stepId: RapidStepId) => rapidItems(seed, stepId).map((item) => ({ item, ...SOLVERS[stepId](item) }));

function rapidAnswers(seed: string) {
  return Object.fromEntries(
    RAPID_STEPS.map((id) => [id, { items: Object.fromEntries(solveRapid(seed, id).map((s) => [s.item.id, { values: s.values, ms: 9_000 }])) }]),
  ) as Record<RapidStepId, { items: Record<string, { values: Record<string, string>; ms: number }> }>;
}

// ---- A strong candidate's answers, built only from the screen ----

function perfectAnswers(seed: string) {
  const sc = screen(seed);
  const sites = readSites(sc);
  const deck = readDeck(sc);
  const c = readCase(sc);
  return {
    ...rapidAnswers(seed),
    "site-analysis": { cells: { ...sites.cells } as Record<string, number | null> },
    "deck-check": {
      flags: deck.rows.filter((r) => r.issue).map((r) => ({ target: r.id, reason: r.issue!, note: "" })) as Flag[],
      decision: oneOption(sc.deck().decision!, /^Send .+ the list of issues before the deck goes anywhere/),
    },
    "summary-order": { order: solveSummary(sc) },
    payback: { value: c.payback },
    "net-saving": { value: c.net },
    ...(Object.fromEntries(VALUES_STEPS.map((id) => [id, { selected: [solveValues(sc, id)] }])) as Record<ValuesStepId, { selected: string[] }>),
  };
}

type Answers = ReturnType<typeof perfectAnswers>;
type Mutable = Answers & Record<string, unknown>;
const clone = (a: Answers): Mutable => JSON.parse(JSON.stringify(a));

describe(`${SLUG}: setup`, () => {
  it("is registered, version 1, consulting, 50 minutes, and uses only built step types in section order", () => {
    expect(getScenario(SLUG, 1)).toBe(scenario);
    expect(listScenarios()).toContain(scenario);
    expect(scenario.version).toBe(1);
    expect(scenario.timeLimitMinutes).toBe(50);
    expect(scenario.roleFamily).toBe("consulting");
    expect(scenario.title).toBe("Corvid Lane: operations review analyst");
    expect(scenario.definition.steps.map((s) => [s.id, s.type])).toEqual([
      ["rapid-numbers", "rapid_round"],
      ["site-analysis", "spreadsheet"],
      ["rapid-evidence", "rapid_round"],
      ["deck-check", "document_review"],
      ["rapid-sense", "rapid_round"],
      ["summary-order", "ordering"],
      ["payback", "numeric"],
      ["net-saving", "numeric"],
      ...VALUES_STEPS.map((id) => [id, "multiple_choice"]),
    ]);
    for (const id of VALUES_STEPS) expect(scenario.definition.steps.find((s) => s.id === id)!.title).toMatch(/^Judgment: /);
    expect(scenario.definition.intro).toMatch(/Corvid Lane Advisory/);
    expect(scenario.definition.intro).toMatch(/steering committee/i);
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
    LONG,
  );

  it("is deterministic per seed", () => {
    for (const seed of SEEDS.slice(0, 20)) {
      expect(scenario.generate(seed)).toEqual(scenario.generate(seed));
      expect(renderAttemptForCandidate(scenario, seed, END)).toEqual(renderAttemptForCandidate(scenario, seed, END));
    }
  });

  it("different seeds change the client, names, numbers and which row carries which trap", () => {
    expect(new Set(SEEDS.map((s) => JSON.stringify(scenario.generate(s).values))).size).toBe(SEEDS.length);
    const screens = SEEDS.slice(0, 60).map(screen);
    const sites = screens.map(readSites);
    expect(new Set(sites.map((s) => s.saving)).size).toBeGreaterThan(55);
    expect(new Set(sites.map((s) => s.unit)).size).toBeGreaterThan(1);
    expect(new Set(sites.map((s) => s.data.findIndex((d) => d.site === s.kSite))).size).toBeGreaterThan(5);
    expect(new Set(sites.map((s) => s.data.findIndex((d) => d.site === s.cSite))).size).toBeGreaterThan(5);
    expect(new Set(sites.map((s) => s.twice[1].row)).size).toBeGreaterThan(4);
    const decks = screens.map(readDeck);
    expect(new Set(decks.map((d) => d.rows.findIndex((r) => r.issue === "mismatch"))).size).toBeGreaterThan(5);
    expect(new Set(decks.map((d) => d.withdrawn)).size).toBeGreaterThan(5);
    expect(new Set(screens.map((s) => s.view.intro)).size).toBeGreaterThan(10);
  });
});

describe(`${SLUG}: site analysis`, () => {
  it(
    "nine rows, eight sites, seven in scope; the key matches the data notes and the brief applied by hand, for 200 seeds",
    () => {
      for (const seed of SEEDS) {
        const sc = screen(seed);
        const s = readSites(sc);
        const key = scenario.generate(seed).keys["site-analysis"] as SheetKey;
        expect(Object.keys(key.cells).sort(), seed).toEqual(Object.keys(s.cells).sort());
        expect(Object.keys(key.cells).length).toBe(16);
        for (const [id, value] of Object.entries(s.cells)) {
          expect(key.cells[id].value, `${seed} ${id}`).toBe(value);
          const tol = key.cells[id].tolerance ?? key.tolerance ?? 0;
          if (id === "saving") expect(tol).toBeLessThanOrEqual(1000);
          else expect(tol, `${seed} ${id}`).toBe(0.01);
        }
        // Each trap sits on a different in-scope site; the closed one is out.
        expect(new Set([s.kSite, s.pSite, s.corSite, s.twice[0].site]).size, seed).toBe(4);
        expect(s.inScope.map((d) => d.site)).not.toContain(s.cSite);
        for (const site of [s.kSite, s.pSite, s.corSite, s.twice[0].site]) expect(s.inScope.map((d) => d.site)).toContain(site);
        // The traps bite: the part-year, thousands and duplicated sites sit above the benchmark.
        for (const site of [s.kSite, s.pSite, s.twice[0].site]) expect(s.inScope.find((d) => d.site === site)!.cents, `${seed} ${site}`).toBeGreaterThan(s.bench);
      }
    },
    LONG,
  );

  it("cells are worth 1 per site figure, 2 for the benchmark and 4 for the saving: 20 in all", () => {
    expect(scoreAttempt(scenario, "abc", {}).steps["site-analysis"].maxPoints).toBe(20);
  });
});

describe(`${SLUG}: deck check`, () => {
  it(
    "twelve slides: one of each of six issues, the withdrawn slide, and clean look-alikes on every seed",
    () => {
      for (const seed of SEEDS) {
        const sc = screen(seed);
        const d = readDeck(sc);
        expect(d.rows.length, seed).toBe(12);
        expect(d.rows.filter((r) => r.issue).map((r) => r.issue).sort(), seed).toEqual(["mismatch", "overclaim", "period", "shares", "source", "units"]);
        const looks = d.rows.map((r) => r.lookalike).filter(Boolean).sort();
        expect(looks, seed).toEqual(["correlation", "no-figure", "rounded", "shares-round", "thousands", "withdrawn"]);
        const w = d.rows.find((r) => r.lookalike === "withdrawn")!;
        expect(w.src, "the withdrawn slide looks like a trap").toBe("—");
        const k = scenario.generate(seed).keys["deck-check"] as ReviewKey;
        for (const issue of ["mismatch", "overclaim", "period", "shares", "source", "units"]) {
          const at = d.rows.find((r) => r.issue === issue)!.id;
          expect(k.findings[issue].targets, `${seed} ${issue}`).toEqual([at]);
          expect(k.findings[issue].reasons[0], `${seed} ${issue}`).toBe(issue);
        }
        expect(k.decision).toEqual(["senior"]);
        expect(sc.deck().decision!.options.find((o) => o.id === "senior")!.label).toMatch(/^Send .+ the list of issues/);
      }
    },
    LONG,
  );
});

describe(`${SLUG}: desk`, () => {
  it("summary order, payback and three-year net saving match the brief and the messages", () => {
    for (const seed of SEEDS) {
      const sc = screen(seed);
      const keys = scenario.generate(seed).keys;
      expect((keys["summary-order"] as OrdKey).order, seed).toEqual(solveSummary(sc));
      expect(sc.ord().prompt).toMatch(/answer first/i);
      const c = readCase(sc);
      const pb = keys.payback as NumKey;
      const net = keys["net-saving"] as NumKey;
      expect(pb.value, seed).toBe(c.payback);
      expect(pb.tolerance).toBeLessThanOrEqual(0.05);
      expect(net.value, seed).toBe(c.net);
      expect(net.tolerance).toBeLessThanOrEqual(1000);
      // The traps in the case are far outside the tolerance.
      expect(Math.abs(3 * c.s - c.oneTime - c.net)).toBeGreaterThan(100 * net.tolerance);
      expect(sc.num("payback").unit).toBe("months");
      expect(sc.num("payback").decimals).toBe(1);
    }
  });

  it("five values calls: four options each, one right, in a different place per seed", () => {
    const places = Object.fromEntries(VALUES_STEPS.map((id) => [id, new Set<string>()]));
    for (const seed of SEEDS) {
      const sc = screen(seed);
      const keys = scenario.generate(seed).keys;
      for (const id of VALUES_STEPS) {
        const mc = sc.mc(id);
        expect(mc.options.length).toBe(4);
        expect(mc.options.map((o) => o.id)).toEqual(["a", "b", "c", "d"]);
        expect(mc.select).toBe("single");
        expect((keys[id] as McKey).correct, `${seed} ${id}`).toEqual([solveValues(sc, id)]);
        places[id].add(solveValues(sc, id));
      }
    }
    for (const id of VALUES_STEPS) expect(places[id].size, id).toBe(4);
  });

  it("the candor call is about the candidate's own table, reported by a colleague", () => {
    for (const seed of SEEDS.slice(0, 30)) {
      const sc = screen(seed);
      expect(sc.msg("m-values-candor").body).toMatch(/table you sent me yesterday/);
      expect(sc.msg("m-values-integrity").body).toMatch(/about \$\d+M a year/);
    }
  });
});

describe(`${SLUG}: scoring`, () => {
  it("out of 100: rapid rounds 10 each, site analysis 20, deck check 20, desk 30", () => {
    const blank = scoreAttempt(scenario, "abc", {});
    expect(blank.points).toBe(0);
    expect(blank.maxPoints).toBe(MAX);
    const max = (id: string) => blank.steps[id].maxPoints;
    expect(RAPID_STEPS.map(max)).toEqual([10, 10, 10]);
    expect(max("site-analysis")).toBe(20);
    expect(max("deck-check")).toBe(20);
    expect(max("summary-order")).toBe(8);
    expect(max("payback")).toBe(6);
    expect(max("net-saving")).toBe(6);
    expect(VALUES_STEPS.map(max)).toEqual([2, 2, 2, 2, 2]);
  });

  it("blank scores 0 and the maximum is 100 for every seed", () => {
    for (const seed of SEEDS.slice(0, 50)) {
      const s = scoreAttempt(scenario, seed, {});
      expect(s.points).toBe(0);
      expect(s.maxPoints).toBe(MAX);
    }
  });

  it(
    "a perfect answer, built only from the screen, scores 100 for every seed with nothing left for review",
    () => {
      for (const seed of SEEDS) {
        const s = scoreAttempt(scenario, seed, perfectAnswers(seed));
        for (const [id, step] of Object.entries(s.steps)) {
          expect(step.points, `${seed} ${id} ${JSON.stringify(step.items.filter((i) => i.earned < i.max))}`).toBe(step.maxPoints);
          expect(step.needsReview, `${seed} ${id}`).toBeFalsy();
        }
        expect(s.points, seed).toBe(MAX);
      }
    },
    LONG,
  );

  it("another seed's perfect answer averages under 40 (answers can't be shared)", () => {
    let shared = 0;
    for (let i = 0; i < 30; i++) shared += scoreAttempt(scenario, SEEDS[i + 1], perfectAnswers(SEEDS[i])).points;
    expect(shared / 30).toBeLessThan(40);
  });

  describe("each trap answered wrongly costs exactly its points", () => {
    const seeds = SEEDS.slice(0, 40);
    const memo = new Map<string, { answers: Answers; points: number }>();
    const base = (seed: string) => {
      if (!memo.has(seed)) {
        const answers = perfectAnswers(seed);
        memo.set(seed, { answers, points: scoreAttempt(scenario, seed, answers).points });
      }
      return memo.get(seed)!;
    };
    const lost = (seed: string, mutate: (a: Mutable) => void) => {
      const a = clone(base(seed).answers);
      mutate(a);
      return base(seed).points - scoreAttempt(scenario, seed, a).points;
    };
    const flags = (a: Mutable) => (a["deck-check"] as { flags: Flag[] }).flags;

    for (const issue of ["mismatch", "overclaim", "period", "shares", "source", "units"]) {
      it(`deck: ${issue} missed loses 3; spotted with the wrong reason loses 1.5`, () => {
        for (const seed of seeds) {
          expect(lost(seed, (a) => ((a["deck-check"] as { flags: Flag[] }).flags = flags(a).filter((f) => f.reason !== issue))), seed).toBe(3);
          expect(lost(seed, (a) => (flags(a).find((f) => f.reason === issue)!.reason = "other")), seed).toBe(1.5);
        }
      }, LONG);
    }

    it("deck: flagging a clean look-alike or the withdrawn slide costs 1; the wrong decision costs 2", () => {
      for (const seed of seeds) {
        const sc = screen(seed);
        const d = readDeck(sc);
        for (const look of ["rounded", "shares-round", "thousands", "withdrawn", "correlation"]) {
          const r = d.rows.find((x) => x.lookalike === look)!;
          expect(lost(seed, (a) => flags(a).push({ target: r.id, reason: "other", note: "" })), `${seed} ${look}`).toBe(1);
        }
        for (const wrong of [/^Fix the numbers in the deck yourself/, /^Send the deck to .+, who asked for a preview/, /^Leave it: .+ reviews the deck/]) {
          const id = oneOption(sc.deck().decision!, wrong);
          expect(lost(seed, (a) => ((a["deck-check"] as { decision: string }).decision = id))).toBe(2);
        }
      }
    }, LONG);

    it("site analysis: ignoring the correction costs 1; not annualising 4; the closed site in 6; the duplicate twice 6; the $000s unscaled 7", () => {
      for (const seed of seeds) {
        const sc = screen(seed);
        const s = readSites(sc);
        const cells = (a: Mutable) => (a["site-analysis"] as { cells: Record<string, number | null> }).cells;
        const cor = s.inScope.find((d) => d.site === s.corSite)!;
        const shownHours = num(text(sc.sheet().rows[cor.row - 1][4]));
        expect(lost(seed, (a) => (cells(a)[cor.uph!] = round2(cor.vol / shownHours))), `${seed} correction`).toBe(1);

        const withSites = (list: typeof s.inScope, annualise = true) => {
          const sorted = list.map((d) => d.cents).sort((a, b) => a - b);
          const mid = sorted.length / 2;
          const bench = sorted.length % 2 ? sorted[Math.floor(mid)] : (sorted[mid - 1] + sorted[mid]) / 2;
          const saving = list.reduce((t, d) => t + (d.cents > bench ? ((d.cents - bench) * d.vol * (annualise ? 12 / d.months : 1)) / 100 : 0), 0);
          return { bench: bench / 100, saving: Math.round(saving) };
        };
        const apply = (alt: { bench: number; saving: number }) => (a: Mutable) => {
          cells(a).benchmark = alt.bench;
          cells(a).saving = alt.saving;
        };
        expect(lost(seed, (a) => (cells(a).saving = withSites(s.inScope, false).saving)), `${seed} annualise`).toBe(4);
        const closed = s.firsts.find((d) => d.site === s.cSite)!;
        expect(lost(seed, apply(withSites([...s.inScope, closed]))), `${seed} closed`).toBe(6);
        expect(lost(seed, apply(withSites([...s.inScope, s.twice[1]]))), `${seed} duplicate`).toBe(6);
        const k = s.inScope.find((d) => d.site === s.kSite)!;
        const unscaled = { ...k, cents: k.cents / 1000 };
        expect(
          lost(seed, (a) => {
            cells(a)[k.cpu!] = round2(unscaled.cents / 100);
            apply(withSites(s.inScope.map((d) => (d === k ? unscaled : d))))(a);
          }),
          `${seed} thousands`,
        ).toBe(7);
      }
    }, LONG);

    it("desk: no ramp-up costs all 6; payback on the annual saving costs all 6; a reversed summary earns nothing", () => {
      for (const seed of seeds) {
        const c = readCase(screen(seed));
        expect(lost(seed, (a) => (a["net-saving"].value = 3 * c.s - c.oneTime))).toBe(6);
        expect(lost(seed, (a) => (a.payback.value = Number((c.oneTime / c.s).toFixed(1))))).toBe(6);
        expect(lost(seed, (a) => (a["summary-order"].order = [...a["summary-order"].order].reverse()))).toBeGreaterThanOrEqual(7.5);
      }
    }, LONG);

    it("values: each tempting wrong option costs the full 2", () => {
      const wrong: Record<ValuesStepId, RegExp> = {
        "values-integrity": /^Put "about \$\d+M" on the title as asked/,
        "values-candor": /^Fix your own copy quietly/,
        "values-client-care": /^Tell .+ only what's already rumoured/,
        "values-in-lane": /^Reassure .+: no layoffs are planned/,
        "values-teamwork": /^Fix the slide in the shared file yourself/,
      };
      for (const seed of seeds) {
        const sc = screen(seed);
        for (const id of VALUES_STEPS) {
          const w = oneOption(sc.mc(id), wrong[id]);
          expect(lost(seed, (a) => (a[id].selected = [w])), `${seed} ${id}`).toBe(2);
        }
      }
    }, LONG);
  });
});

describe(`${SLUG}: nothing from the key reaches the candidate`, () => {
  it(
    "no reviewer note, key word or computed number in any payload",
    () => {
      for (const seed of SEEDS) {
        const variant = scenario.generate(seed);
        const notes = Object.values((variant.keys["deck-check"] as ReviewKey).findings).map((f) => f.note!);
        for (const n of notes) expect(n.length).toBeGreaterThan(10);
        const numbers = [
          ...Object.values((variant.keys["site-analysis"] as SheetKey).cells).map((c) => c.value),
          (variant.keys.payback as NumKey).value,
          (variant.keys["net-saving"] as NumKey).value,
        ];
        const rapid = RAPID_STEPS.map((id) => JSON.stringify(rapidItems(seed, id))).join("\n");
        for (const minute of [0, 6, 16, 22, 32, 38, END]) {
          const payload = JSON.stringify(renderAttemptForCandidate(scenario, seed, minute));
          expect(payload).not.toMatch(/"keys"|tolerance|"criteria"|"guidance"|"notes"|"points"|"expected"|"findings"|"clean":|"correct"/);
          for (const n of notes) expect(payload, seed).not.toContain(n);
          for (const text of [payload, rapid]) {
            for (const c of numbers.filter((x) => x >= 1)) {
              const forms = [JSON.stringify(c), c.toFixed(2), String(Math.round(c * 100)), c.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })];
              for (const f of [...new Set(forms)].filter((x) => !/^\d{1,3}$/.test(x))) {
                expect(text, `${seed} ${f}`).not.toMatch(new RegExp(`(?<![\\d.,])${f.replace(/[.$]/g, "\\$&")}(?![\\d.]\\d)`));
              }
            }
          }
        }
      }
    },
    LONG,
  );
});

describe(`${SLUG}: timed sections`, () => {
  const def = scenario.definition;
  const MIN = 60_000;
  const t0 = Date.parse("2026-11-16T09:00:00Z");
  const flowAt = (ms: number) => resolveFlow(def, { startedAt: t0, now: t0 + ms, extraTimePercent: 0, events: [] });
  const stepById = (id: string) => def.steps.find((s) => s.id === id)!;

  it("validateSections passes and the sections fill the time limit exactly", () => {
    expect(validateSections(def, scenario.timeLimitMinutes)).toEqual([]);
    expect(def.sections!.reduce((t, s) => t + s.minutes, 0)).toBe(scenario.timeLimitMinutes);
  });

  it("six sections with the shared ids", () => {
    expect(def.sections!.map((s) => [s.id, s.minutes, s.stepIds, !!s.oneAtATime])).toEqual([
      ["s-rapid-a", 6, ["rapid-numbers"], false],
      ["s-work-1", 10, ["site-analysis"], false],
      ["s-rapid-b", 6, ["rapid-evidence"], false],
      ["s-work-2", 10, ["deck-check"], false],
      ["s-rapid-c", 6, ["rapid-sense"], false],
      ["s-desk", 12, ["summary-order", "payback", "net-saving", ...VALUES_STEPS], true],
    ]);
  });

  it("one-at-a-time screens add up to their section", () => {
    const desk = def.sections!.find((s) => s.id === "s-desk")!;
    expect(desk.stepIds.map((id) => stepById(id).seconds)).toEqual([150, 90, 90, 78, 78, 78, 78, 78]);
    expect(desk.stepIds.reduce((t, id) => t + stepById(id).seconds!, 0)).toBe(desk.minutes * 60);
  });

  it("each rapid round is 15 items x 20 seconds, items 3, 6, 9, 12, 15 worth 1 and the rest 0.5", () => {
    for (const id of RAPID_STEPS) {
      const config = rapidConfig(id);
      expect(config.items.length, id).toBe(15);
      expect(config.secondsPerItem).toBe(20);
      expect(config.items.map((i) => i.points)).toEqual(Array.from({ length: 15 }, (_, i) => (i % 3 === 2 ? 1 : 0.5)));
    }
  });

  it("runs the sections back to back", () => {
    const at = (min: number) => flowAt(min * MIN);
    expect(at(0).visibleStepIds).toEqual(["rapid-numbers"]);
    expect(at(6).visibleStepIds).toEqual(["site-analysis"]);
    expect(at(16).visibleStepIds).toEqual(["rapid-evidence"]);
    expect(at(22).visibleStepIds).toEqual(["deck-check"]);
    expect(at(32).visibleStepIds).toEqual(["rapid-sense"]);
    expect(at(38).visibleStepIds).toEqual(["summary-order"]);
    expect(at(END).done).toBe(true);
  });

  it("every message points at a real step; briefs arrive when their section opens, updates at minute 4", () => {
    const ids = new Set(def.steps.map((s) => s.id));
    for (const m of def.messages) expect(ids.has(m.stepId!), m.id).toBe(true);
    expect(def.messages.map((m) => [m.id, m.arriveAtMinute ?? 0, m.stepId])).toEqual([
      ["m-brief", 0, "site-analysis"],
      ["m-correction", 4, "site-analysis"],
      ["m-deck", 0, "deck-check"],
      ["m-deck-update", 4, "deck-check"],
      ["m-summary", 0, "summary-order"],
      ["m-payback", 0, "payback"],
      ["m-net", 0, "net-saving"],
      ...VALUES_STEPS.map((id) => [`m-${id}`, 0, id]),
    ]);
    const msgsAt = (min: number) => visibleMessageIds(def, flowAt(min * MIN), t0, t0 + min * MIN);
    expect(msgsAt(5)).toEqual([]);
    expect(msgsAt(6)).toEqual(["m-brief"]);
    expect(msgsAt(10)).toEqual(["m-brief", "m-correction"]);
    expect(msgsAt(22)).toEqual(["m-brief", "m-correction", "m-deck"]);
    expect(msgsAt(26)).toEqual(["m-brief", "m-correction", "m-deck", "m-deck-update"]);
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

describe(`${SLUG}: rapid rounds`, () => {
  it(
    "every item over 200 seeds has one right answer, found from the material alone, matching the key",
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

  it("the harder kinds sit in the 1-point slots, the quick kinds in the 0.5 slots", () => {
    for (const id of RAPID_STEPS) {
      const points = rapidConfig(id).items.map((i) => i.points);
      const kinds = new Set<string>();
      for (const seed of SEEDS.slice(0, 50)) {
        solveRapid(seed, id).forEach((s, i) => {
          kinds.add(s.kind);
          expect(HARD[id].includes(s.kind), `${seed} ${id} item ${i} ${s.kind}`).toBe(points[i] === 1);
        });
      }
      for (const h of HARD[id]) expect(kinds.has(h), `${id} uses ${h}`).toBe(true);
    }
  });

  it("evidence answers are spread across supported, not supported and contradicted", () => {
    const counts = new Map<string, number>();
    for (const seed of SEEDS.slice(0, 50)) {
      for (const s of solveRapid(seed, "rapid-evidence")) {
        const label = (s.item.fields[0] as RapidChoiceField).options.find((o) => o.id === s.values.answer)!.label;
        counts.set(label, (counts.get(label) ?? 0) + 1);
      }
    }
    for (const l of [SUPPORTED, NOT_SUPPORTED, CONTRADICTED]) expect(counts.get(l) ?? 0, l).toBeGreaterThan(100);
  });

  it("varies per seed: which item comes when and where the right option sits", () => {
    for (const id of RAPID_STEPS) {
      const firsts = SEEDS.slice(0, 60).map((seed) => solveRapid(seed, id)[0]);
      expect(new Set(firsts.map((s) => JSON.stringify(s.item))).size, id).toBeGreaterThan(40);
      expect(new Set(firsts.map((s) => s.values.answer)).size, id).toBe(id === "rapid-evidence" ? 3 : 4);
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
      delete a[id].items[items[2].id];
      delete a[id].items[items[0].id];
      expect(perfect.steps[id].points - scoreAttempt(scenario, seed, a).steps[id].points, id).toBe(1.5);
    }
  });
});
