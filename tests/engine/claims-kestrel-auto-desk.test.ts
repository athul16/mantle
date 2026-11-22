import { describe, expect, it, vi } from "vitest";
import type { RapidChoiceField, RapidItem } from "@/lib/engine/step-types/rapid_round/public";
import type { PublicCell, SpreadsheetPublicConfig } from "@/lib/engine/step-types/spreadsheet/public";

vi.mock("server-only", () => ({}));

const { claimsKestrelAutoDesk } = await import("@/lib/engine/scenarios/claims-kestrel-auto-desk");
const { getScenario, listScenarios } = await import("@/lib/engine/scenarios");
const { renderAttemptForCandidate, renderFlowForCandidate } = await import("@/lib/engine/server/render");
const { scoreAttempt } = await import("@/lib/engine/server/score");
const { resolveFlow, visibleMessageIds, validateSections } = await import("@/lib/engine/server/flow");
const { rapidRoundServer } = await import("@/lib/engine/step-types/rapid_round/server");
const { fillTemplate, templateValues } = await import("@/lib/engine/server/template");
const { computeDeadline, courtDaysAfter } = await import("@/lib/engine/scenarios/legal");
const { addMonths, formatClock } = await import("@/lib/engine/scenarios/insurance");

/**
 * Insurance claims representative trainee: Kestrel Mutual's personal auto
 * desk. Three rapid rounds (coverage math, claim deadlines, statements) and
 * three work sections (coverage check of twelve new claims, a body shop
 * estimate against the claims card, and a desk shown one screen at a time:
 * total-loss valuation, first-day order, payment authority and five values
 * calls), 50 minutes, 100 points. Every task is solved here from what the
 * candidate sees, with an independent reading of the cards, then compared with
 * the server key.
 */

const scenario = claimsKestrelAutoDesk;
const SLUG = "claims-kestrel-auto-desk";
const SEEDS = Array.from({ length: 200 }, (_, i) => `attempt-${i.toString(16).padStart(4, "0")}`);
const END = scenario.timeLimitMinutes;
const MAX = 100;
const RAPID_STEPS = ["rapid-coverage-math", "rapid-deadlines", "rapid-statements"] as const;
type RapidStepId = (typeof RAPID_STEPS)[number];
const VALUES_STEPS = ["values-integrity", "values-in-lane", "values-candor", "values-client-care", "values-quality"] as const;
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
  const msgsFor = (stepId: string) => view.messages.filter((m) => m.stepId === stepId);
  return {
    view,
    step,
    msg,
    msgsFor,
    doc: () => step("coverage-check").config as Doc,
    sheet: (id: "estimate-review" | "total-loss") => step(id).config as SpreadsheetPublicConfig,
    mc: (id: string) => step(id).config as Mc,
    ord: () => step("first-day").config as Ord,
  };
}
type Screen = ReturnType<typeof screen>;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
/** "Mon, Mar 2, 2026" → epoch day (UTC); also checks the weekday printed matches the date. */
function day(label: string): number {
  const m = label.trim().match(/^(\w{3}), (\w{3}) (\d{1,2}), (\d{4})$/);
  expect(m, `date "${label}"`).not.toBeNull();
  const t = Date.UTC(Number(m![4]), MONTHS.indexOf(m![2]), Number(m![3]));
  expect(WEEKDAYS[new Date(t).getUTCDay()], `weekday of ${label}`).toBe(m![1]);
  return t / 86_400_000;
}
const weekday = (d: number) => new Date(d * 86_400_000).getUTCDay();
const iso = (d: number) => new Date(d * 86_400_000).toISOString().slice(0, 10);
/** "$1,234.56" → cents. */
function cents(s: string): number {
  const m = s.trim().match(/^\$(\d{1,3}(?:,\d{3})*)\.(\d{2})$/);
  expect(m, `money "${s}"`).not.toBeNull();
  return Number(m![1].replace(/,/g, "")) * 100 + Number(m![2]);
}
/** "$1,000" → cents (whole dollars, as the declarations print deductibles). */
function wholeDollars(s: string): number {
  const m = s.trim().match(/^\$(\d{1,3}(?:,\d{3})*)$/);
  expect(m, `whole dollars "${s}"`).not.toBeNull();
  return Number(m![1].replace(/,/g, "")) * 100;
}
const money = (c: number) => `$${(c / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
/** "12:30 a.m." → minutes after midnight. */
function clock(s: string): number {
  const m = s.trim().match(/^(\d{1,2}):(\d{2}) ([ap])\.m\.$/);
  expect(m, `clock "${s}"`).not.toBeNull();
  const h = Number(m![1]) % 12;
  return (m![3] === "p" ? h + 12 : h) * 60 + Number(m![2]);
}
const must = (s: string, re: RegExp, what = String(re)) => {
  const m = s.match(re);
  expect(m, `${what} in "${s}"`).not.toBeNull();
  return m!;
};
const text = (c: PublicCell) => (c.kind === "text" ? c.text : "");
const inputId = (c: PublicCell) => (c.kind === "input" ? c.id : null);
const round2 = (x: number) => Math.round(x * 100) / 100;

// ---- Coverage check: twelve new claims vs. the policy excerpt ----

const COV_COLUMNS = [
  "Claim",
  "Date and time of loss",
  "Driver",
  "Vehicle",
  "Loss",
  "Policy and period",
  "Drivers on the policy",
  "Vehicles on the policy",
  "Coverages",
  "Policy status",
  "Prior claims",
];
const ISSUES = ["outside_period", "excluded_driver", "unlisted_vehicle", "no_coverage", "lapse", "duplicate"] as const;

function readCoverage(sc: Screen) {
  const doc = sc.doc();
  expect(doc.document.columns).toEqual(COV_COLUMNS);
  const field = (id: string) => {
    const f = doc.document.fields.find((x) => x.id === id);
    expect(f, `field ${id}`).toBeDefined();
    return f!.value;
  };
  expect(field("period")).toMatch(/starts at 12:01 a\.m\. standard time on the effective date and ends at 12:01 a\.m\. standard time on the expiration date/);
  expect(field("drivers")).toMatch(/unless the policy names them as an excluded driver/);
  const navDays = Number(must(field("nav"), /covered automatically for (\d+) days after/)[1]);
  expect(field("coverages")).toMatch(/hitting a bird or animal/);
  expect(field("lapse")).toMatch(/covers nothing between the cancellation and the reinstatement/);
  // The supervisor's correction at minute 4.
  const corr = sc.msgsFor("coverage-check").find((m) => /corrected/.test(m.body));
  expect(corr, "reinstatement correction").toBeDefined();
  const [, corrPolicy, corrReinstated, corrCancelled] = must(corr!.body, /policy (KMA-\d{7}): it was reinstated on (.+?) with a lapse in coverage from (.+?), not back/);

  const rows = doc.document.rows.map((r) => {
    const c = (name: string) => r.cells[COV_COLUMNS.indexOf(name)];
    const [, lossDate, lossTime] = must(c("Date and time of loss"), /^(\w{3}, \w{3} \d{1,2}, \d{4}), (\d{1,2}:\d{2} [ap]\.m\.)$/);
    const loss = day(lossDate) * 1440 + clock(lossTime);
    const driver = must(c("Driver"), /^(.+?) \((.+)\)$/);
    const veh = must(c("Vehicle"), /^(\d{4} [^(]+?)(?: \(bought (.+)\))?$/);
    const lossKind = must(c("Loss"), /^(Collision|Comprehensive): .+$/)[1];
    const [, policy, eff, exp] = must(c("Policy and period"), /^(KMA-\d{7}) · (.+) to (.+)$/);
    const [, listed, excluded] = must(c("Drivers on the policy"), /^Listed: (.+)\. Excluded: (.+)$/);
    const vehicles = c("Vehicles on the policy").split("; ");
    const coverages = c("Coverages");
    expect(coverages).toMatch(/^Liability \d+\/\d+\/\d+/);
    const status = c("Policy status");
    const prior = c("Prior claims");

    const issues: string[] = [];
    const start = day(eff) * 1440 + 1;
    const end = day(exp) * 1440 + 1;
    if (loss < start || loss >= end) issues.push("outside_period");
    const excludedNames = excluded === "none" ? [] : excluded.split(", ");
    if (excludedNames.includes(driver[1])) issues.push("excluded_driver");
    if (!vehicles.includes(veh[1])) {
      expect(veh[2], `${r.id}: an unlisted vehicle says when it was bought`).toBeDefined();
      const bought = day(veh[2]);
      expect(bought).toBeGreaterThanOrEqual(day(eff));
      if (Math.floor(loss / 1440) - bought > navDays) issues.push("unlisted_vehicle");
    } else expect(veh[2]).toBeUndefined();
    if (!coverages.includes(`${lossKind}, $`)) issues.push("no_coverage");
    let lapseFrom: number | null = null;
    let lapseTo: number | null = null;
    if (status.startsWith("Cancelled")) {
      const [, cancelled, reinstated] = must(status, /^Cancelled for non-payment (.+); reinstated (.+) with no lapse in coverage$/);
      if (policy === corrPolicy) {
        expect(day(corrReinstated)).toBe(day(reinstated));
        expect(day(corrCancelled)).toBe(day(cancelled));
        lapseFrom = day(cancelled);
        lapseTo = day(reinstated);
      }
    } else expect(status).toMatch(/^(In force|In force \(new policy, first term\)|Expired .+ \(renewal not paid\))$/);
    if (lapseFrom !== null && Math.floor(loss / 1440) > lapseFrom && Math.floor(loss / 1440) < lapseTo!) issues.push("lapse");
    if (prior !== "None") {
      const [, , pDate, pLoss, pVeh, paid] = must(prior, /^(AU-\d{2}-\d{5}) · (.+?) · (.+?) · (\d{4} .+?) · paid (\$[\d,.]+)$/);
      cents(paid);
      if (day(pDate) === Math.floor(loss / 1440) && pVeh === veh[1] && pLoss === c("Loss")) issues.push("duplicate");
    }
    return {
      id: r.id,
      claim: c("Claim"),
      lossDay: Math.floor(loss / 1440),
      lossMinute: loss % 1440,
      effDay: day(eff),
      driver: driver[1],
      relation: driver[2],
      listed: listed.split(", "),
      vehicle: veh[1],
      bought: veh[2],
      lossKind,
      coverages,
      status,
      prior,
      policy,
      issues,
    };
  });
  return { rows, navDays, corrPolicy };
}

const deductibleOf = (coverages: string, kind: "Collision" | "Comprehensive") => wholeDollars(must(coverages, new RegExp(`${kind}, (\\$[\\d,]+) deductible`))[1]);

// ---- Estimate review ----

const EST_COLUMNS = ["Line", "Oper.", "Description", "Part type", "Qty / hours", "Price or rate", "Shop amount", "Allowable"];

function readEstimate(sc: Screen) {
  const sheet = sc.sheet("estimate-review");
  expect(sheet.columns).toEqual(EST_COLUMNS);
  const p = sheet.prompt;
  const [, body, paint, mech] = must(p, /body (\$[\d,.]+) an hour, refinish (\$[\d,.]+) an hour, mechanical (\$[\d,.]+) an hour/);
  const rates: Record<string, number> = { "Body labor": cents(body), "Refinish labor": cents(paint), "Mechanical labor": cents(mech) };
  const ded = cents(must(p, /Collision deductible: (\$[\d,.]+)/)[1]);
  const [, capDay, maxDays] = must(p, /Rental cover: (\$[\d,.]+) a day, up to (\d+) days/);
  const [, priorPanel] = must(p, /Photos: (?:the )?(.+?) shows prior damage/);
  expect(p).toMatch(/shows fresh damage from this loss/);
  const [, ageLimit] = must(p, /more than (\d+) model years old/);
  const [, claim, modelYear, lossYear] = must(p, /claim (AU-\d{2}-\d{5}) \((\d{4}) .+?; loss in (\d{4})\)/);
  expect(Number(lossYear) - Number(modelYear), "the parts policy applies to this vehicle").toBeGreaterThan(Number(ageLimit));
  expect(p).toMatch(/allow 0 on the repeat/);

  const lines = sheet.rows.filter((r) => /^\d+$/.test(text(r[0])));
  expect(lines.length).toBe(10);
  const seen: string[] = [];
  const cells: Record<string, number> = {};
  const parsed = lines.map((r, i) => {
    const [op, desc, type, qty, price] = [1, 2, 3, 4, 5].map((j) => text(r[j]));
    const amt = cents(text(r[6]));
    const id = inputId(r[7])!;
    expect(id).toBe(`l${String(i + 1).padStart(2, "0")}`);
    const sig = [op, desc, type, qty, price, amt].join("|");
    let allow: number;
    let kind: string;
    if (seen.includes(sig)) {
      allow = 0;
      kind = "duplicate";
    } else if (desc.includes(priorPanel)) {
      allow = 0;
      kind = "prior";
    } else if (rates[type] !== undefined) {
      const h = Number(must(qty, /^(\d+\.\d) h$/)[1]);
      const rate = cents(must(price, /^(\$[\d,.]+) an hour$/)[1]);
      expect(Math.round(h * rate)).toBe(amt);
      allow = Math.round(h * Math.min(rate, rates[type]));
      kind = rate > rates[type] ? "over_rate" : "labor";
    } else if (type.startsWith("OEM (A/M quote")) {
      allow = cents(must(type, /^OEM \(A\/M quote (\$[\d,.]+)\)$/)[1]);
      expect(allow).toBeLessThan(amt);
      kind = "oem_trap";
    } else {
      expect(["A/M", "OEM (no A/M part made)", "Sublet", "Materials"]).toContain(type);
      allow = amt;
      kind = type === "OEM (no A/M part made)" ? "oem_ok" : "plain";
    }
    seen.push(sig);
    cells[id] = allow / 100;
    return { id, op, desc, type, amt, allow, kind };
  });
  const total = sheet.rows.find((r) => text(r[2]) === "Estimate total")!;
  expect(cents(text(total[6]))).toBe(parsed.reduce((s, l) => s + l.amt, 0));
  // The supplement from the estimator at minute 4.
  const sup = sc.msgsFor("estimate-review").find((m) => /Supplement 1/.test(m.body));
  expect(sup, "supplement").toBeDefined();
  expect(sup!.body).toContain(claim);
  const supAmt = cents(must(sup!.body, /Line S1: Repl .+?, A\/M, (\$[\d,.]+)\./)[1]);
  const payable = parsed.reduce((s, l) => s + l.allow, 0) + supAmt - ded;
  const rentalRow = sheet.rows.find((r) => inputId(r[7]) === "rental")!;
  expect(rentalRow, "rental row").toBeDefined();
  const days = Number(must(text(rentalRow[4]), /^(\d+) days$/)[1]);
  const rate = cents(must(text(rentalRow[5]), /^(\$[\d,.]+) a day$/)[1]);
  expect(cents(text(rentalRow[6]))).toBe(days * rate);
  expect(days, "the invoice runs past the maximum").toBeGreaterThan(Number(maxDays));
  const rental = Math.min(days, Number(maxDays)) * Math.min(rate, cents(capDay));
  expect(sheet.rows.some((r) => inputId(r[7]) === "payable")).toBe(true);
  cells.payable = payable / 100;
  cells.rental = rental / 100;
  return { lines: parsed, cells, claim, ded, supAmt, rental };
}

// ---- Total loss ----

const GRADES = ["Excellent", "Good", "Fair", "Poor"];

function readTotalLoss(sc: Screen) {
  const sheet = sc.sheet("total-loss");
  expect(sheet.columns).toEqual(["Comparable", "Price", "Miles", "Condition", "Adjusted value"]);
  const p = sheet.prompt;
  const [, claim] = must(p, /Claim (AU-\d{2}-\d{5})/);
  const [, , miles, cond] = must(p, /Loss vehicle: (.+), ([\d,]+) miles, (Excellent|Good|Fair|Poor) condition\./);
  const rate = cents(must(p, /Mileage: (\$[\d,.]+) per 1,000 miles of difference/)[1]);
  const step = cents(must(p, /Condition: (\$[\d,.]+) per grade/)[1]);
  const ded = cents(must(p, /Collision deductible: (\$[\d,.]+)/)[1]);
  expect(p).toMatch(/add it when a comparable has more miles/);
  expect(p).toMatch(/subtract it for each grade a comparable is better/);
  const lossMiles = Number(miles.replace(/,/g, ""));
  const comps = sheet.rows.filter((r) => /^adj\d$/.test(inputId(r[4]) ?? ""));
  expect(comps.length).toBe(3);
  const cells: Record<string, number> = {};
  let sum = 0;
  for (const r of comps) {
    const price = cents(text(r[1]));
    const m = Number(must(text(r[2]), /^([\d,]+)$/)[1].replace(/,/g, ""));
    const g = GRADES.indexOf(text(r[3]));
    expect(g).toBeGreaterThanOrEqual(0);
    const adj = price + Math.round(((m - lossMiles) / 1000) * rate) + (g - GRADES.indexOf(cond)) * step;
    cells[inputId(r[4])!] = adj / 100;
    sum += adj;
  }
  const avg = Math.round(sum / 3);
  cells.avg = avg / 100;
  cells.pay = (avg - ded) / 100;
  return { cells, claim, ded };
}

// ---- Desk: first day, authority, values ----

const FIRST_DAY: [string, RegExp][] = [
  ["open", /^Set up the file/],
  ["verify", /^Confirm .+ was in force/],
  ["contact", /^Call .+: acknowledge the claim/],
  ["inspect", /^Book the photo inspection/],
  ["estimate", /^Review .+ estimate/],
  ["pay", /^Discuss the payment/],
];

function solveFirstDay(sc: Screen) {
  const o = sc.ord();
  expect(o.prompt).toMatch(/verify the policy and coverage before you call anyone/i);
  expect(o.items.length).toBe(6);
  return FIRST_DAY.map(([name, re]) => {
    const hit = o.items.filter((i) => re.test(i.label));
    expect(hit.length, `first-day ${name}`).toBe(1);
    return hit[0].id;
  });
}

function oneOption(cfg: { options: { id: string; label: string }[] }, re: RegExp) {
  const o = cfg.options.filter((x) => re.test(x.label));
  expect(o.length, `one option like ${re}`).toBe(1);
  return o[0].id;
}

function solveAuthority(sc: Screen) {
  const m = sc.msgsFor("authority");
  expect(m.length).toBe(1);
  const b = m[0].body;
  const amt = cents(must(b, /Payment: (\$[\d,.]+) to/)[1]);
  const limit = cents(must(b, /Your payment authority: (\$[\d,.]+)/)[1]);
  const coverage = must(b, /Coverage: (.+)/)[1];
  const photos = must(b, /Photos: (.+)/)[1];
  const claimant = must(b, /Claimant: (.+)/)[1];
  const fraud = must(b, /Fraud indicators: (.+)/)[1];
  expect(b).toMatch(/represented claimant/);
  let kind: "send" | "ask" | "pay";
  if (coverage !== "verified" || /represented by/.test(claimant) || fraud !== "none" || amt > limit) kind = "send";
  else if (photos !== "on file") kind = "ask";
  else kind = "pay";
  const re = { send: /^Send it to .+ for approval/, ask: /^Ask for the missing/, pay: /^Pay it/ }[kind];
  return { kind, id: oneOption(sc.mc("authority"), re) };
}

const VALUES_RIGHT: Record<ValuesStepId, RegExp> = {
  "values-integrity": /^Decline the fee/,
  "values-in-lane": /^Tell .+ that you'll deal with the claim through their lawyer/,
  "values-candor": /^Call .+ today to correct the deductible/,
  "values-client-care": /^Tell .+ you'll confirm the coverage today/,
  "values-quality": /^Close only the files that have the photos/,
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
  expect(item.fields.map((f) => f.id)).toEqual(["answer"]);
  const f = item.fields[0] as RapidChoiceField;
  expect(f.options.length).toBe(4);
  expect(f.options.map((o) => o.id)).toEqual(["a", "b", "c", "d"]);
  return f;
};
const exRow = (item: RapidItem, label: string | RegExp) => item.exhibit?.rows?.find((x) => (typeof label === "string" ? x.label === label : label.test(x.label)))?.value;
const mustRow = (item: RapidItem, label: string | RegExp) => {
  const v = exRow(item, label);
  expect(v, `${item.id} row ${label}`).toBeDefined();
  return v!;
};
const pickMoney = (item: RapidItem, right: number) => {
  const f = choiceField(item);
  const labels = f.options.map((o) => cents(o.label));
  expect(new Set(labels).size, `${item.id} four different amounts`).toBe(4);
  const hit = f.options.filter((o) => cents(o.label) === right);
  expect(hit.length, `${item.id} one option at ${money(right)}`).toBe(1);
  return hit[0].id;
};
/** "$C a day, up to M days" and "n days at $r a day" → what the rental cover pays. */
function rentalOwed(cover: string, invoice: string) {
  const [, cap, max] = must(cover, /^(\$[\d,.]+) a day, up to (\d+) days$/);
  const [, n, r] = must(invoice, /^(\d+) days at (\$[\d,.]+) a day$/);
  return Math.min(Number(n), Number(max)) * Math.min(cents(r), cents(cap));
}

/** Coverage math, from the exhibit alone. */
function solveCoverageMath(item: RapidItem): Solved {
  const title = item.exhibit?.title ?? "";
  const m = (label: string) => cents(mustRow(item, label));
  let right: number;
  let kind: string;
  if (title === "Collision repair") {
    right = m("Agreed repair cost") - m("Collision deductible");
    kind = "deductible";
  } else if (title === "Property damage liability") {
    right = Math.min(m("Damage to the other car"), m("Property damage limit"));
    expect(mustRow(item, "Deductible")).toBe("None on liability");
    kind = "limit";
  } else if (title === "Theft: actual cash value") {
    const pct = Number(must(mustRow(item, "Depreciation"), /^(\d+)%$/)[1]);
    right = Math.round((m("Replacement cost (new)") * (100 - pct)) / 100);
    kind = "acv";
  } else if (title === "Rental") {
    right = rentalOwed(mustRow(item, "Rental cover"), mustRow(item, "Rental invoice"));
    kind = "rental";
  } else if (title === "Custom equipment") {
    expect(mustRow(item, "Card rule")).toMatch(/deductible off the loss first, then apply the limit/);
    right = Math.min(m("Loss to custom equipment") - m("Deductible"), m("Custom equipment limit"));
    expect(m("Loss to custom equipment")).toBeGreaterThan(m("Custom equipment limit"));
    kind = "limit-deductible";
  } else if (title === "Repair or total loss") {
    const acv = m("Actual cash value");
    const est = m("Repair estimate");
    const t = Number(must(mustRow(item, "Total-loss threshold"), /^(\d+)% of actual cash value$/)[1]);
    expect(Math.abs(est - (acv * t) / 100), `${item.id} not on the threshold`).toBeGreaterThan(acv / 100);
    right = (est >= (acv * t) / 100 ? acv : est) - m("Deductible");
    kind = "threshold";
  } else if (title === "Hail and rental") {
    right = m("Hail damage (agreed)") - m("Comprehensive deductible") + rentalOwed(mustRow(item, "Rental cover"), mustRow(item, "Rental invoice"));
    kind = "two-coverages";
  } else throw new Error(`unknown coverage math exhibit "${title}"`);
  return { kind, values: { answer: pickMoney(item, right) } };
}

/** Claim deadlines, from the exhibit alone. */
function solveDeadline(item: RapidItem): Solved {
  const f = choiceField(item);
  const from = day(mustRow(item, "Notice received"));
  expect([0, 6]).not.toContain(weekday(from));
  const rule = mustRow(item, "Kestrel card");
  expect(mustRow(item, "Business days")).toMatch(/Monday to Friday, except Kestrel holidays/);
  const hols = mustRow(item, "Kestrel holidays in the window");
  const holidays = hols === "None" ? [] : hols.split("; ").map((h) => day(h.replace(/ \(.+\)$/, "")));
  expect(holidays).not.toContain(from);
  const open = (d: number) => ![0, 6].includes(weekday(d)) && !holidays.includes(d);
  let due: number;
  let kind: string;
  const biz = rule.match(/within (\d+) business days? after notice/);
  const cal = rule.match(/(\d+) calendar days after notice; if that day isn't a business day, the next business day/);
  if (biz) {
    const n = Number(biz[1]);
    due = from;
    for (let left = n; left > 0; ) {
      due++;
      if (open(due)) left--;
    }
    expect(courtDaysAfter(iso(from), n)).toBe(iso(due));
    kind = holidays.some((h) => h > from && h <= due) || weekday(from) === 5 ? "business-hard" : "business";
  } else {
    expect(cal, `${item.id} rule ${rule}`).not.toBeNull();
    const n = Number(cal![1]);
    due = from + n;
    while (!open(due)) due++;
    expect(computeDeadline({ from: iso(from), days: n }).due).toBe(iso(due));
    kind = "calendar";
  }
  expect(item.prompt).toMatch(/^When is the .+ due\?$/);
  expect(new Set(f.options.map((o) => day(o.label))).size, `${item.id} four different dates`).toBe(4);
  const right = f.options.filter((o) => day(o.label) === due);
  expect(right.length, `${item.id} one right date ${iso(due)}`).toBe(1);
  return { kind, values: { answer: right[0].id } };
}

/** A statement or file fact: date, time (local minutes) and place, each possibly missing. */
function readAccount(s: string) {
  const date = s.match(/on (\w{3}, \w{3} \d{1,2}, \d{4})/);
  let time: number | null = null;
  const local = s.match(/at (?:about |around )?(\d{1,2}:\d{2} [ap]\.m\.)/);
  const utc = s.match(/(\d{2}):(\d{2}) UTC/);
  let converted = false;
  if (local) time = clock(local[1]);
  else if (utc) {
    const off = Number(must(s, /local time is UTC-(\d)\b/)[1]);
    time = Number(utc[1]) * 60 + Number(utc[2]) - off * 60;
    converted = true;
  }
  const place = s.match(/(?:on )?([A-Z][A-Za-z0-9 ]+?), ([\d.]+) (miles?|km) past the ([A-Za-z ]+?)[.,]/);
  let where: { road: string; miles: number; landmark: string } | null = null;
  if (place) {
    const d = Number(place[2]);
    if (place[3] === "km") converted = true;
    where = { road: place[1].replace(/^on /, ""), miles: place[3] === "km" ? d / 1.609 : d, landmark: place[4] };
  }
  return { date: date ? day(date[1]) : null, time, where, converted };
}

function solveStatement(item: RapidItem): Solved {
  const f = choiceField(item);
  const ph = readAccount(mustRow(item, /^Policyholder \(/));
  const other = readAccount(mustRow(item, /^(Other driver|Witness) \(/));
  const fact = readAccount(mustRow(item, "File fact"));
  for (const a of [other, fact]) {
    expect(a.date).not.toBeNull();
    expect(a.time).not.toBeNull();
    expect(a.where).not.toBeNull();
  }
  expect(ph.date).not.toBeNull();
  const label = (re: RegExp) => oneOption(f, re);
  const agree = (a: ReturnType<typeof readAccount>, b: ReturnType<typeof readAccount>) =>
    a.date === b.date &&
    Math.abs(a.time! - b.time!) <= 30 &&
    a.where!.road === b.where!.road &&
    a.where!.landmark === b.where!.landmark &&
    Math.abs(a.where!.miles - b.where!.miles) <= 0.5;
  const hard = [ph, other, fact].some((a) => a.converted);
  if (ph.time === null || ph.where === null) {
    expect(ph.time === null && ph.where === null, `${item.id}: only one fact missing`).toBe(false);
    expect(agree(other, fact), `${item.id}: the others agree`).toBe(true);
    expect(hard).toBe(false);
    return ph.time === null
      ? { kind: "need-time", values: { answer: label(/^Need one more fact: the time of the loss/) } }
      : { kind: "need-place", values: { answer: label(/^Need one more fact: the place of the loss/) } };
  }
  const ok = agree(ph, other) && agree(ph, fact) && agree(other, fact);
  // Near-misses are kept out of the material: a time is either within 30 minutes or at least 45 off.
  for (const [a, b] of [[ph, other], [ph, fact], [other, fact]]) {
    const dt = Math.abs(a.time! - b.time!);
    expect(dt <= 30 || dt >= 45, `${item.id} time gap ${dt}`).toBe(true);
    if (a.where!.road === b.where!.road && a.where!.landmark === b.where!.landmark) {
      const dm = Math.abs(a.where!.miles - b.where!.miles);
      expect(dm <= 0.3 || dm >= 1, `${item.id} distance gap ${dm}`).toBe(true);
    }
  }
  const kind = `${hard ? "converted" : "plain"}-${ok ? "consistent" : "inconsistent"}`;
  return { kind, values: { answer: ok ? label(/^Consistent/) : label(/^Inconsistent: note it and refer the file to/) } };
}

const SOLVERS: Record<RapidStepId, (item: RapidItem) => Solved> = {
  "rapid-coverage-math": solveCoverageMath,
  "rapid-deadlines": solveDeadline,
  "rapid-statements": solveStatement,
};
const HARD_KINDS: Record<RapidStepId, string[]> = {
  "rapid-coverage-math": ["limit-deductible", "threshold", "two-coverages"],
  "rapid-deadlines": ["business-hard"],
  "rapid-statements": ["converted-consistent", "converted-inconsistent"],
};
const solveRapid = (seed: string, stepId: RapidStepId) => rapidItems(seed, stepId).map((item) => ({ item, ...SOLVERS[stepId](item) }));

function rapidAnswers(seed: string) {
  return Object.fromEntries(
    RAPID_STEPS.map((id) => [id, { items: Object.fromEntries(solveRapid(seed, id).map((s) => [s.item.id, { values: s.values, ms: 7_000 }])) }]),
  ) as Record<RapidStepId, { items: Record<string, { values: Record<string, string>; ms: number }> }>;
}

// ---- A strong candidate's answers, built only from the screen ----

function perfectAnswers(seed: string) {
  const sc = screen(seed);
  const cov = readCoverage(sc);
  const est = readEstimate(sc);
  const tl = readTotalLoss(sc);
  return {
    ...rapidAnswers(seed),
    "coverage-check": {
      flags: cov.rows.flatMap((r) => r.issues.map((reason) => ({ target: r.id, reason, note: "" }))),
      decision: oneOption(sc.doc().decision!, /^Send the flagged files to/),
    },
    "estimate-review": { cells: { ...est.cells } as Record<string, number | null> },
    "total-loss": { cells: { ...tl.cells } as Record<string, number | null> },
    "first-day": { order: solveFirstDay(sc) },
    authority: { selected: [solveAuthority(sc).id] },
    ...Object.fromEntries(VALUES_STEPS.map((id) => [id, { selected: [oneOption(sc.mc(id), VALUES_RIGHT[id])] }])),
  } as Record<string, unknown> & {
    "coverage-check": { flags: Flag[]; decision: string };
    "estimate-review": { cells: Record<string, number | null> };
    "total-loss": { cells: Record<string, number | null> };
    "first-day": { order: string[] };
    authority: { selected: string[] };
  };
}
type Answers = ReturnType<typeof perfectAnswers>;
const clone = (a: Answers): Answers => JSON.parse(JSON.stringify(a));

describe(`${SLUG}: setup`, () => {
  it("is registered, version 1, insurance, 50 minutes, and uses only allowed step types in section order", () => {
    expect(getScenario(SLUG, 1)).toBe(scenario);
    expect(listScenarios()).toContain(scenario);
    expect(scenario.slug).toBe(SLUG);
    expect(scenario.version).toBe(1);
    expect(scenario.timeLimitMinutes).toBe(50);
    expect(scenario.roleFamily).toBe("insurance");
    expect(scenario.title).toBe("Kestrel Mutual: claims representative");
    expect(scenario.definition.steps.map((s) => [s.id, s.type])).toEqual([
      ["rapid-coverage-math", "rapid_round"],
      ["coverage-check", "document_review"],
      ["rapid-deadlines", "rapid_round"],
      ["estimate-review", "spreadsheet"],
      ["rapid-statements", "rapid_round"],
      ["total-loss", "spreadsheet"],
      ["first-day", "ordering"],
      ["authority", "multiple_choice"],
      ...VALUES_STEPS.map((id) => [id, "multiple_choice"]),
    ]);
    expect(scenario.definition.intro).toMatch(/Kestrel Mutual/);
    expect(scenario.definition.intro).toMatch(/claims representative/i);
    for (const id of VALUES_STEPS) expect(scenario.definition.steps.find((s) => s.id === id)!.title).toMatch(/^Judgment: /);
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

  it("every email address uses the .example domain", () => {
    for (const seed of SEEDS.slice(0, 40)) {
      const emails = JSON.stringify(renderAttemptForCandidate(scenario, seed, END)).match(/[\w.+-]+@[\w.-]+/g) ?? [];
      for (const e of emails) expect(e).toMatch(/\.example$/);
    }
  });

  it("different seeds change names, numbers, dates and which row carries which trap", () => {
    expect(new Set(SEEDS.map((s) => JSON.stringify(scenario.generate(s).values))).size).toBe(SEEDS.length);
    const screens = SEEDS.slice(0, 60).map(screen);
    const covs = screens.map(readCoverage);
    for (const issue of ISSUES) expect(new Set(covs.map((c) => c.rows.findIndex((r) => r.issues.includes(issue)))).size, issue).toBeGreaterThan(6);
    expect(new Set(covs.map((c) => c.navDays)).size).toBeGreaterThan(1);
    const ests = screens.map(readEstimate);
    for (const kind of ["duplicate", "prior", "over_rate", "oem_trap"]) {
      expect(new Set(ests.map((e) => e.lines.findIndex((l) => l.kind === kind))).size, kind).toBeGreaterThan(4);
    }
    expect(new Set(ests.map((e) => e.cells.payable)).size).toBeGreaterThan(55);
    expect(new Set(screens.map((s) => readTotalLoss(s).cells.avg)).size).toBeGreaterThan(55);
    expect(new Set(screens.map((s) => solveAuthority(s).kind))).toEqual(new Set(["send", "ask", "pay"]));
  });
});

describe(`${SLUG}: coverage check`, () => {
  it(
    "twelve claims: one each of the six coverage problems, the three look-alikes, and nothing else",
    () => {
      for (const seed of SEEDS) {
        const sc = screen(seed);
        const c = readCoverage(sc);
        expect(c.rows.length, seed).toBe(12);
        expect(c.rows.map((r) => r.issues.length).filter((n) => n > 1), seed).toEqual([]);
        expect(c.rows.flatMap((r) => r.issues).sort(), seed).toEqual([...ISSUES].sort());
        const clean = c.rows.filter((r) => !r.issues.length);
        // A loss in the first half hour of the effective date, which the policy covers.
        expect(clean.some((r) => r.lossDay === r.effDay && r.lossMinute > 1 && r.lossMinute <= 59), `${seed} 12:30 a.m.`).toBe(true);
        // A vehicle bought inside the newly acquired window and not yet on the policy.
        expect(clean.some((r) => r.bought !== undefined), `${seed} new vehicle`).toBe(true);
        // A permissive driver: not listed, not excluded.
        expect(clean.some((r) => !r.listed.includes(r.driver) && /permission/.test(r.relation)), `${seed} permissive driver`).toBe(true);
        // A reinstatement with no lapse, and a prior claim on another date, both fine.
        expect(clean.some((r) => r.status.startsWith("Cancelled")), `${seed} reinstated`).toBe(true);
        expect(clean.some((r) => r.prior !== "None"), `${seed} prior claim`).toBe(true);
        // The corrected policy is the lapse; before the correction it reads like the clean reinstatement.
        expect(c.rows.find((r) => r.issues.includes("lapse"))!.policy).toBe(c.corrPolicy);
        expect(new Set(c.rows.map((r) => r.claim)).size).toBe(12);
        expect(new Set(c.rows.map((r) => r.policy)).size).toBe(12);
        const k = scenario.generate(seed).keys["coverage-check"] as ReviewKey;
        const at = (issue: string) => c.rows.find((r) => r.issues.includes(issue))!.id;
        const findingOf: Record<string, string> = {
          outside_period: "period",
          excluded_driver: "excluded",
          unlisted_vehicle: "vehicle",
          no_coverage: "coverage",
          lapse: "lapse",
          duplicate: "duplicate",
        };
        expect(Object.keys(k.findings).sort()).toEqual(Object.values(findingOf).sort());
        for (const issue of ISSUES) expect(k.findings[findingOf[issue]], `${seed} ${issue}`).toMatchObject({ targets: [at(issue)], reasons: [issue] });
        expect(sc.doc().decision!.options.find((o) => o.id === k.decision![0])!.label).toMatch(/^Send the flagged files to/);
      }
    },
    LONG,
  );

  it("the decision's right option moves and its three wrong options are deny, pay later and change the loss date", () => {
    const places = new Set<string>();
    for (const seed of SEEDS.slice(0, 60)) {
      const d = screen(seed).doc().decision!;
      expect(d.options.map((o) => o.id)).toEqual(["a", "b", "c", "d"]);
      places.add(oneOption(d, /^Send the flagged files to/));
      oneOption(d, /^Deny the flagged claims/);
      oneOption(d, /^Pay the flagged claims/);
      oneOption(d, /^Ask the policyholders whether the loss date/);
    }
    expect(places.size).toBe(4);
  });
});

describe(`${SLUG}: estimate review`, () => {
  it(
    "ten lines with one over-rate labor line, one OEM part against the parts policy, one prior-damage line, one repeat, and the look-alikes; the key matches",
    () => {
      for (const seed of SEEDS) {
        const sc = screen(seed);
        const e = readEstimate(sc);
        const kinds = e.lines.map((l) => l.kind);
        for (const k of ["duplicate", "prior", "over_rate", "oem_trap", "oem_ok"]) expect(kinds.filter((x) => x === k).length, `${seed} ${k}`).toBe(1);
        expect(kinds.filter((x) => x === "labor").length, `${seed} labor at the approved rate`).toBeGreaterThanOrEqual(2);
        const key = scenario.generate(seed).keys["estimate-review"] as SheetKey;
        expect(Object.keys(key.cells).sort()).toEqual(Object.keys(e.cells).sort());
        for (const [id, v] of Object.entries(e.cells)) {
          expect(key.cells[id].value, `${seed} ${id}`).toBeCloseTo(v, 6);
          expect(key.cells[id].tolerance ?? key.tolerance ?? 0, `${seed} ${id} tolerance`).toBe(0.01);
        }
        // The estimate is for a claim from the morning's coverage check that has no problem, with the same deductible.
        const row = readCoverage(sc).rows.find((r) => r.claim === e.claim)!;
        expect(row, `${seed} estimate claim on the list`).toBeDefined();
        expect(row.issues).toEqual([]);
        expect(row.lossKind).toBe("Collision");
        expect(deductibleOf(row.coverages, "Collision")).toBe(e.ded);
      }
    },
    LONG,
  );

  it("cells are 1.5 per line, 3 for the repair payment and 2 for the rental: 20 in all", () => {
    const sheet = scenario.definition.steps.find((s) => s.id === "estimate-review")!.config as { rows: unknown[][] };
    const inputs = sheet.rows.flat().filter((c): c is { input: string; points: number; label: string } => !!c && typeof c === "object" && "input" in c);
    expect(inputs.map((c) => [c.input, c.points])).toEqual([
      ...Array.from({ length: 10 }, (_, i) => [`l${String(i + 1).padStart(2, "0")}`, 1.5]),
      ["payable", 3],
      ["rental", 2],
    ]);
    for (const c of inputs) expect(c.label.length).toBeGreaterThan(3);
    expect(scoreAttempt(scenario, "abc", {}).steps["estimate-review"].maxPoints).toBe(20);
  });
});

describe(`${SLUG}: claims desk`, () => {
  it(
    "total loss: three comparables adjusted for miles and condition, the average and the payment match the key; the claim is from the coverage check",
    () => {
      for (const seed of SEEDS) {
        const sc = screen(seed);
        const t = readTotalLoss(sc);
        const key = scenario.generate(seed).keys["total-loss"] as SheetKey;
        expect(Object.keys(key.cells).sort()).toEqual(["adj1", "adj2", "adj3", "avg", "pay"]);
        for (const [id, v] of Object.entries(t.cells)) expect(key.cells[id].value, `${seed} ${id}`).toBeCloseTo(v, 6);
        const row = readCoverage(sc).rows.find((r) => r.claim === t.claim)!;
        expect(row, `${seed} total-loss claim on the list`).toBeDefined();
        expect(row.issues).toEqual([]);
        expect(deductibleOf(row.coverages, row.lossKind as "Collision")).toBe(t.ded);
        expect(t.claim).not.toBe(readEstimate(sc).claim);
      }
    },
    LONG,
  );

  it("first day: six actions in the card's order; the shown order is not the key and varies", () => {
    const shown = new Set<string>();
    for (const seed of SEEDS) {
      const sc = screen(seed);
      const order = solveFirstDay(sc);
      expect((scenario.generate(seed).keys["first-day"] as { order: string[] }).order).toEqual(order);
      const ids = sc.ord().items.map((i) => i.id);
      expect(ids).toEqual(["i1", "i2", "i3", "i4", "i5", "i6"]);
      shown.add(order.join());
    }
    expect(shown.size).toBeGreaterThan(50);
    expect([...shown]).not.toContain("i1,i2,i3,i4,i5,i6");
  });

  it("authority: pay, send to the supervisor or ask for what's missing, solved from the card; the key agrees", () => {
    const kinds = new Map<string, number>();
    for (const seed of SEEDS) {
      const sc = screen(seed);
      const a = solveAuthority(sc);
      kinds.set(a.kind, (kinds.get(a.kind) ?? 0) + 1);
      expect((scenario.generate(seed).keys.authority as McKey).correct, seed).toEqual([a.id]);
      oneOption(sc.mc("authority"), /^Split it into two payments/);
    }
    for (const k of ["send", "ask", "pay"]) expect(kinds.get(k) ?? 0, k).toBeGreaterThan(25);
  });

  it("five values calls: four fixed option ids, one right, its place varies across seeds", () => {
    for (const id of VALUES_STEPS) {
      const places = new Set<string>();
      for (const seed of SEEDS.slice(0, 80)) {
        const sc = screen(seed);
        const cfg = sc.mc(id);
        expect(cfg.select).toBe("single");
        expect(cfg.options.map((o) => o.id)).toEqual(["a", "b", "c", "d"]);
        expect(new Set(cfg.options.map((o) => o.label)).size).toBe(4);
        const right = oneOption(cfg, VALUES_RIGHT[id]);
        expect((scenario.generate(seed).keys[id] as McKey).correct, `${seed} ${id}`).toEqual([right]);
        places.add(right);
        expect(sc.msgsFor(id).length, `${id} arrives as a message`).toBeGreaterThanOrEqual(1);
      }
      expect(places.size, id).toBe(4);
    }
  });

  it("the candor call is about the candidate's own mistake, reported by the fellow trainee", () => {
    for (const seed of SEEDS.slice(0, 40)) {
      const m = screen(seed).msgsFor("values-candor");
      expect(m.some((x) => x.from === "Fellow trainee" && /you told/i.test(x.body) && /deductible/.test(x.body))).toBe(true);
    }
  });
});

describe(`${SLUG}: scoring`, () => {
  it("out of 100: rapid rounds 10 each, coverage check 20, estimate 20, total loss 8, first day 6, authority 6, values 2 each", () => {
    const blank = scoreAttempt(scenario, "abc", {});
    expect(blank.points).toBe(0);
    expect(blank.maxPoints).toBe(MAX);
    const max = (id: string) => blank.steps[id].maxPoints;
    expect(RAPID_STEPS.map(max)).toEqual([10, 10, 10]);
    expect(max("coverage-check")).toBe(20);
    expect(max("estimate-review")).toBe(20);
    expect(max("total-loss")).toBe(8);
    expect(max("first-day")).toBe(6);
    expect(max("authority")).toBe(6);
    expect(VALUES_STEPS.map(max)).toEqual([2, 2, 2, 2, 2]);
  });

  it("blank scores 0 and the maximum is 100 for every seed", () => {
    for (const seed of SEEDS) {
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
          expect(step.points, `${seed} ${id}`).toBe(step.maxPoints);
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
    const lost = (seed: string, mutate: (a: Answers) => void) => {
      const a = clone(perfectAnswers(seed));
      mutate(a);
      return scoreAttempt(scenario, seed, perfectAnswers(seed)).points - scoreAttempt(scenario, seed, a).points;
    };

    for (const issue of ISSUES) {
      it(`coverage: ${issue} missed loses 3; flagged with the wrong reason loses 1.5`, () => {
        for (const seed of seeds) {
          expect(lost(seed, (a) => (a["coverage-check"].flags = a["coverage-check"].flags.filter((f) => f.reason !== issue))), seed).toBe(3);
          expect(lost(seed, (a) => (a["coverage-check"].flags.find((f) => f.reason === issue)!.reason = "other")), seed).toBe(1.5);
        }
      });
    }

    it("coverage: each clean look-alike flagged costs 1; the wrong decision costs 2", () => {
      for (const seed of seeds) {
        const sc = screen(seed);
        const c = readCoverage(sc);
        for (const r of c.rows.filter((x) => !x.issues.length).slice(0, 3)) {
          expect(lost(seed, (a) => a["coverage-check"].flags.push({ target: r.id, reason: "outside_period", note: "" })), `${seed} ${r.id}`).toBe(1);
        }
        for (const re of [/^Deny the flagged claims/, /^Pay the flagged claims/, /^Ask the policyholders whether the loss date/]) {
          expect(lost(seed, (a) => (a["coverage-check"].decision = oneOption(sc.doc().decision!, re))), `${seed} ${re}`).toBe(2);
        }
      }
    });

    it("estimate: paying a trap line as billed costs 1.5; a wrong payment 3; the uncapped rental 2", () => {
      for (const seed of seeds) {
        const e = readEstimate(screen(seed));
        for (const kind of ["duplicate", "prior", "over_rate", "oem_trap"]) {
          const line = e.lines.find((l) => l.kind === kind)!;
          expect(lost(seed, (a) => (a["estimate-review"].cells[line.id] = line.amt / 100)), `${seed} ${kind}`).toBe(1.5);
        }
        expect(lost(seed, (a) => (a["estimate-review"].cells.payable = e.cells.payable - e.supAmt / 100)), `${seed} supplement left out`).toBe(3);
        expect(lost(seed, (a) => (a["estimate-review"].cells.rental = e.cells.rental + 50)), `${seed} rental`).toBe(2);
      }
    });

    it("total loss: an unadjusted comparable costs 1.5; the average without the deductible costs the payment's 2", () => {
      for (const seed of seeds) {
        const t = readTotalLoss(screen(seed));
        expect(lost(seed, (a) => (a["total-loss"].cells.adj1 = round2(t.cells.adj1 + 25)))).toBe(1.5);
        expect(lost(seed, (a) => (a["total-loss"].cells.pay = t.cells.avg))).toBe(2);
      }
    });

    it("first day: the reverse order earns nothing; one swap of neighbours costs a little", () => {
      for (const seed of seeds) {
        expect(lost(seed, (a) => a["first-day"].order.reverse())).toBe(6);
        const swap = lost(seed, (a) => {
          const o = a["first-day"].order;
          [o[1], o[2]] = [o[2], o[1]];
        });
        expect(swap).toBeGreaterThan(0);
        expect(swap).toBeLessThan(1.5);
      }
    });

    it("authority and values: a wrong option costs all its points", () => {
      for (const seed of seeds) {
        const sc = screen(seed);
        expect(lost(seed, (a) => (a.authority.selected = [oneOption(sc.mc("authority"), /^Split it into two payments/)]))).toBe(6);
        for (const id of VALUES_STEPS) {
          const right = oneOption(sc.mc(id), VALUES_RIGHT[id]);
          const wrong = sc.mc(id).options.find((o) => o.id !== right)!.id;
          expect(lost(seed, (a) => (a[id] = { selected: [wrong] })), `${seed} ${id}`).toBe(2);
        }
      }
    });
  });
});

describe(`${SLUG}: nothing from the key reaches the candidate`, () => {
  it(
    "no reviewer note, key word or computed amount in any payload",
    () => {
      for (const seed of SEEDS) {
        const variant = scenario.generate(seed);
        const notes = Object.values((variant.keys["coverage-check"] as ReviewKey).findings).map((f) => f.note!);
        for (const n of notes) expect(n.length).toBeGreaterThan(20);
        const shown = new Set(Object.values(variant.values).filter((x): x is number => typeof x === "number"));
        const derived = (["estimate-review", "total-loss"] as const)
          .flatMap((id) => Object.values((variant.keys[id] as SheetKey).cells).map((c) => c.value))
          .filter((v) => v >= 1 && !shown.has(Math.round(v * 100)));
        expect(derived.length).toBeGreaterThan(5);
        for (const minute of [0, 20, END]) {
          const payload = JSON.stringify(renderAttemptForCandidate(scenario, seed, minute));
          expect(payload).not.toMatch(/"keys"|tolerance|"criteria"|"guidance"|"notes"|"points"|"expected"|"findings"|"clean":|"correct"/);
          for (const n of notes) expect(payload, seed).not.toContain(n);
          for (const c of derived) {
            const forms = [String(c), c.toFixed(2), String(Math.round(c * 100)), c.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })];
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

  it("the six standard sections, in order", () => {
    expect(def.sections!.map((s) => [s.id, s.minutes, s.stepIds, !!s.oneAtATime])).toEqual([
      ["s-rapid-a", 6, ["rapid-coverage-math"], false],
      ["s-work-1", 10, ["coverage-check"], false],
      ["s-rapid-b", 6, ["rapid-deadlines"], false],
      ["s-work-2", 10, ["estimate-review"], false],
      ["s-rapid-c", 6, ["rapid-statements"], false],
      ["s-desk", 12, ["total-loss", "first-day", "authority", ...VALUES_STEPS], true],
    ]);
  });

  it("desk screens: total loss 180 s, first day 120 s, authority 90 s, each values call 66 s; 720 in all", () => {
    expect(["total-loss", "first-day", "authority", ...VALUES_STEPS].map((id) => stepById(id).seconds)).toEqual([180, 120, 90, 66, 66, 66, 66, 66]);
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
    expect(at(0).visibleStepIds).toEqual(["rapid-coverage-math"]);
    expect(at(6).visibleStepIds).toEqual(["coverage-check"]);
    expect(at(16).visibleStepIds).toEqual(["rapid-deadlines"]);
    expect(at(22).visibleStepIds).toEqual(["estimate-review"]);
    expect(at(32).visibleStepIds).toEqual(["rapid-statements"]);
    expect(at(38).visibleStepIds).toEqual(["total-loss"]);
    expect(at(END).done).toBe(true);
  });

  it("every message points at a real step; each long task gets its brief at minute 0 and one update at minute 4", () => {
    const ids = new Set(def.steps.map((s) => s.id));
    for (const m of def.messages) expect(ids.has(m.stepId!), m.id).toBe(true);
    const at = (stepId: string) => def.messages.filter((m) => m.stepId === stepId).map((m) => m.arriveAtMinute ?? 0);
    expect(at("coverage-check")).toEqual([0, 4]);
    expect(at("estimate-review")).toEqual([0, 4]);
    expect(at("rapid-coverage-math")).toEqual([0]);
    const msgsAt = (min: number) => visibleMessageIds(def, flowAt(min * MIN), t0, t0 + min * MIN);
    const first = def.messages.filter((m) => m.stepId === "rapid-coverage-math").map((m) => m.id);
    expect(msgsAt(0)).toEqual(first);
    const cov = def.messages.filter((m) => m.stepId === "coverage-check");
    expect(msgsAt(6)).toContain(cov[0].id);
    expect(msgsAt(9)).not.toContain(cov[1].id);
    expect(msgsAt(10)).toContain(cov[1].id);
    const est = def.messages.filter((m) => m.stepId === "estimate-review");
    expect(msgsAt(25)).not.toContain(est[1].id);
    expect(msgsAt(26)).toContain(est[1].id);
  });

  it("the cast: five fixed role lines, the claimant's lawyer appears once", () => {
    const froms = new Set(def.messages.map((m) => m.from));
    expect([...froms].sort()).toEqual(["Body shop estimator", "Claimant's attorney", "Fellow trainee", "Policyholder", "Your claims supervisor"]);
    expect(def.messages.filter((m) => m.from === "Claimant's attorney").length).toBe(1);
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
          for (const s of solved) expect(key.items[s.item.id].answer.choice, `${seed} ${s.item.id} (${s.kind}: ${s.item.prompt})`).toBe(s.values.answer);
        }
      }
    },
    LONG,
  );

  it("ten quick items worth half a point and five harder ones worth one (items 3, 6, 9, 12, 15), 10 a round", () => {
    for (const id of RAPID_STEPS) {
      const points = rapidConfig(id).items.map((i) => i.points);
      expect(points).toEqual(Array.from({ length: 15 }, (_, i) => (i % 3 === 2 ? 1 : 0.5)));
      for (const seed of SEEDS.slice(0, 50)) {
        solveRapid(seed, id).forEach((s, i) => {
          expect(HARD_KINDS[id].includes(s.kind), `${seed} ${id} item ${i} ${s.kind}`).toBe(points[i] === 1);
        });
      }
    }
  });

  it("each round covers its kinds", () => {
    const kinds = (id: RapidStepId) => new Set(SEEDS.slice(0, 50).flatMap((seed) => solveRapid(seed, id).map((s) => s.kind)));
    expect([...kinds("rapid-coverage-math")].sort()).toEqual(["acv", "deductible", "limit", "limit-deductible", "rental", "threshold", "two-coverages"]);
    expect([...kinds("rapid-deadlines")].sort()).toEqual(["business", "business-hard", "calendar"]);
    expect([...kinds("rapid-statements")].sort()).toEqual([
      "converted-consistent",
      "converted-inconsistent",
      "need-place",
      "need-time",
      "plain-consistent",
      "plain-inconsistent",
    ]);
  });

  it("the deadline round's hard items cross a holiday or start on a Friday", () => {
    let fridays = 0;
    let holidays = 0;
    for (const seed of SEEDS.slice(0, 50)) {
      for (const item of rapidItems(seed, "rapid-deadlines").filter((_, i) => i % 3 === 2)) {
        if (weekday(day(mustRow(item, "Notice received"))) === 5) fridays++;
        if (mustRow(item, "Kestrel holidays in the window") !== "None") holidays++;
      }
    }
    expect(fridays).toBeGreaterThan(30);
    expect(holidays).toBeGreaterThan(30);
  });

  it("varies per seed: which item comes when and where the right option sits", () => {
    for (const id of RAPID_STEPS) {
      const firsts = SEEDS.slice(0, 60).map((seed) => solveRapid(seed, id)[0]);
      expect(new Set(firsts.map((s) => JSON.stringify(s.item))).size, id).toBeGreaterThan(40);
      expect(new Set(firsts.map((s) => s.values.answer)).size, id).toBe(4);
    }
  });

  it("a wrong item costs its points", () => {
    const seed = "abc";
    const perfect = scoreAttempt(scenario, seed, perfectAnswers(seed));
    for (const id of RAPID_STEPS) {
      const a = clone(perfectAnswers(seed)) as unknown as Record<string, { items: Record<string, unknown> }>;
      const cfg = rapidConfig(id);
      delete a[id].items[cfg.items[2].id];
      delete a[id].items[cfg.items[0].id];
      expect(perfect.steps[id].points - scoreAttempt(scenario, seed, a).steps[id].points, id).toBe(1.5);
    }
  });
});

describe(`${SLUG}: insurance helpers`, () => {
  it("formats clock times and adds calendar months", () => {
    expect(formatClock(0)).toBe("12:00 a.m.");
    expect(formatClock(30)).toBe("12:30 a.m.");
    expect(formatClock(12 * 60 + 5)).toBe("12:05 p.m.");
    expect(formatClock(23 * 60 + 59)).toBe("11:59 p.m.");
    expect(addMonths("2027-03-03", 6)).toBe("2027-09-03");
    expect(addMonths("2026-11-15", 12)).toBe("2027-11-15");
    expect(addMonths("2027-01-31", 1)).toBe("2027-02-28");
  });
});
