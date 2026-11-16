import { describe, expect, it, vi } from "vitest";
import type { RapidChoiceField, RapidItem } from "@/lib/engine/step-types/rapid_round/public";
import type { PublicCell, SpreadsheetPublicConfig } from "@/lib/engine/step-types/spreadsheet/public";

vi.mock("server-only", () => ({}));

const { corporateHalyardRobotics } = await import("@/lib/engine/scenarios/corporate-halyard-robotics");
const { getScenario, listScenarios } = await import("@/lib/engine/scenarios");
const { renderAttemptForCandidate, renderFlowForCandidate } = await import("@/lib/engine/server/render");
const { scoreAttempt } = await import("@/lib/engine/server/score");
const { resolveFlow, visibleMessageIds, validateSections } = await import("@/lib/engine/server/flow");
const { rapidRoundServer } = await import("@/lib/engine/step-types/rapid_round/server");
const { fillTemplate, templateValues } = await import("@/lib/engine/server/template");
const { computeDeadline, courtDaysAfter } = await import("@/lib/engine/scenarios/legal");

/**
 * Corporate paralegal: Halyard Robotics entity work. Three rapid rounds
 * (ownership and filing deadlines, governance terms, contract terms) and three
 * work sections (cap table update, board actions vs. the bylaws, deal desk:
 * NDA vs. playbook, closing checklist and inbox), 50 minutes, 100 points.
 * Every task is solved here from what the candidate sees, with an independent
 * reading of the rules, then compared with the server key.
 */

const scenario = corporateHalyardRobotics;
const SEEDS = Array.from({ length: 200 }, (_, i) => `attempt-${i.toString(16).padStart(4, "0")}`);
const END = scenario.timeLimitMinutes;
const MAX = 100;
const RAPID_STEPS = ["rapid-ownership", "rapid-governance", "rapid-contracts"] as const;
type RapidStepId = (typeof RAPID_STEPS)[number];
const REVIEW_STEPS = ["board-consents", "nda-review", "closing-checklist"] as const;
type ReviewStepId = (typeof REVIEW_STEPS)[number];
const MC_STEPS = ["inbox-founder", "inbox-diligence"] as const;
const LONG = 120_000;

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
  const mc = (id: (typeof MC_STEPS)[number]) => step(id).config as Mc;
  const sheet = () => step("cap-table").config as SpreadsheetPublicConfig;
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
const weekend = (d: number) => [0, 6].includes(new Date(d * 86_400_000).getUTCDay());
const iso = (d: number) => new Date(d * 86_400_000).toISOString().slice(0, 10);
const num = (s: string) => {
  expect(s, `number "${s}"`).toMatch(/^\d{1,3}(,\d{3})*$/);
  return Number(s.replace(/,/g, ""));
};
const pct = (a: number, b: number) => Number(((100 * a) / b).toFixed(2));
const pctLabel = (a: number, b: number) => `${((100 * a) / b).toFixed(2)}%`;
const names = (list: string) => list.split("; ").map((s) => s.trim()).filter(Boolean);

// ---- Cap table ----

const text = (c: PublicCell) => (c.kind === "text" ? c.text : "");
const inputId = (c: PublicCell) => (c.kind === "input" ? c.id : null);

/** The cap table as shown, plus the five transactions from the partner's email, applied by hand. */
function readCapTable(sc: Screen) {
  const sheet = sc.sheet();
  const body = sc.msg("m1").body;
  expect(sheet.columns).toEqual(["Holder", "Class", "Before: shares", "After: shares", "After: fully diluted %"]);
  const rows = sheet.rows.map((r) => ({ holder: text(r[0]), cls: text(r[1]), before: num(text(r[2])), sh: inputId(r[3]), pct: inputId(r[4]) }));
  const total = rows.find((r) => r.holder === "Total fully diluted")!;
  expect(total, "total row").toBeDefined();
  const holders = rows.filter((r) => r !== total);
  expect(holders.length).toBe(8);
  for (const h of holders) {
    expect(h.sh, h.holder).toMatch(/_sh$/);
    expect(h.pct, h.holder).toMatch(/_pct$/);
  }
  expect(total.sh).toBe("total_sh");
  expect(total.before).toBe(holders.reduce((s, h) => s + h.before, 0));

  const m = (re: RegExp) => {
    const x = body.match(re);
    expect(x, `email line ${re}`).not.toBeNull();
    return x!;
  };
  const [, lead, aShares] = m(/Series A financing: (.+) bought ([\d,]+) shares of Series A Preferred Stock\./);
  const [, poolAdd] = m(/added ([\d,]+) shares to the option pool/);
  const [, hire, grant] = m(/New option grant: (.+) was granted options over ([\d,]+) shares of Common Stock/);
  const [, emp, ex] = m(/Option exercise: (.+) exercised options over ([\d,]+) shares of Common Stock/);
  const [, from, tr, to] = m(/Transfer: (.+) transferred ([\d,]+) shares of Common Stock to the (.+)\./);
  const row = (holder: string) => {
    const r = holders.find((h) => h.holder === holder);
    expect(r, `cap table row ${holder}`).toBeDefined();
    return r!;
  };
  expect(holders.some((h) => h.holder === hire), "the new hire's options sit in the options line").toBe(false);
  const after = new Map(holders.map((h) => [h.holder, h.before]));
  const add = (holder: string, n: number) => after.set(row(holder).holder, after.get(holder)! + n);
  add(lead, num(aShares));
  add("Option pool: available for grant", num(poolAdd) - num(grant));
  add("Options outstanding (granted, not exercised)", num(grant) - num(ex));
  add(emp, num(ex));
  add(from, -num(tr));
  add(to, num(tr));
  const totalAfter = [...after.values()].reduce((s, n) => s + n, 0);
  expect(row(lead).before).toBe(0);
  expect(row(to).before).toBe(0);
  expect(row(lead).cls).toBe("Series A Preferred");
  const cells: Record<string, number> = { total_sh: totalAfter };
  for (const h of holders) {
    expect(after.get(h.holder)!, h.holder).toBeGreaterThan(0);
    cells[h.sh!] = after.get(h.holder)!;
    cells[h.pct!] = pct(after.get(h.holder)!, totalAfter);
  }
  return { rows: holders, cells, lead, emp, from, to, hire, totalAfter, totalBefore: total.before, ids: { lead: row(lead), emp: row(emp), from: row(from), to: row(to) } };
}

// ---- Board actions vs. the bylaws ----

function readBoard(doc: Doc) {
  const directors = field(doc, "board").match(/^Directors: (.+) \((\d+) seats, all filled\)$/)!;
  expect(directors, "board field").not.toBeNull();
  const board = directors[1].split(", ");
  expect(board.length).toBe(Number(directors[2]));
  const quorum = Math.floor(board.length / 2) + 1;
  expect(field(doc, "quorum")).toMatch(/majority of the whole board/);
  const notice = Number(field(doc, "notice").match(/at least (\d+) days' notice/)![1]);
  expect(field(doc, "notice")).toMatch(/regular meetings need no notice/i);
  expect(field(doc, "consent")).toMatch(/every director consents in writing/);
  const authorized = [...field(doc, "charter").matchAll(/shares of ([A-Z][A-Za-z ]+? Stock)/g)].map((x) => x[1]);
  expect(authorized.sort()).toEqual(["Common Stock", "Series Seed Preferred Stock"]);
  expect(field(doc, "plan")).toMatch(/options over Common Stock only/);
  const [cDate, cHow, cNotice, cWho, cAction, cStock] = [/^Date/, /^How/, /^Notice/, /^Directors/, /^Action/, /^Stock/].map((re) => col(doc, re));
  const rows = doc.document.rows.map((r) => {
    const how = r.cells[cHow];
    expect(["Special meeting", "Regular meeting", "Unanimous written consent"]).toContain(how);
    const who = r.cells[cWho].match(/^(Present|Signed): (.+)$/)!;
    expect(who, `${r.id} directors`).not.toBeNull();
    const people = who[2].split(", ");
    for (const p of people) expect(board, `${r.id} ${p}`).toContain(p);
    expect(new Set(people).size).toBe(people.length);
    const stock = r.cells[cStock];
    const action = r.cells[cAction];
    const issues: string[] = [];
    if (how === "Unanimous written consent") {
      expect(who[1]).toBe("Signed");
      expect(r.cells[cNotice]).toMatch(/no meeting/);
      if (people.length < board.length) issues.push("unsigned");
    } else {
      expect(who[1]).toBe("Present");
      if (people.length < quorum) issues.push("quorum");
      if (how === "Special meeting") {
        const gap = day(r.cells[cDate]) - day(r.cells[cNotice]);
        expect(gap).toBeGreaterThanOrEqual(0);
        if (gap < notice && people.length < board.length) issues.push("notice");
      } else expect(r.cells[cNotice]).toMatch(/^None needed/);
    }
    if (stock !== "None") {
      if (!authorized.includes(stock)) issues.push("wrong_class");
      else if (/options/i.test(action) && stock !== "Common Stock") issues.push("wrong_class");
    }
    return { id: r.id, date: day(r.cells[cDate]), how, people, stock, action, issues };
  });
  return { board, quorum, notice, rows };
}

// ---- NDA vs. playbook ----

function readNda(doc: Doc) {
  const pb = (id: string) => field(doc, id);
  const maxTerm = Number(pb("pb_term").match(/no more than (\d+) years/)![1]);
  const minSurvival = Number(pb("pb_survival").match(/at least (\d+) years after disclosure/)![1]);
  const minCap = num(pb("pb_cap").match(/at least \$([\d,]+)/)![1]);
  const law = pb("pb_law").match(/^Delaware/) ? "Delaware" : null;
  expect(law).toBe("Delaware");
  expect(pb("pb_venue")).toMatch(/courts in Delaware/);
  const maxNs = Number(pb("pb_nonsolicit").match(/no more than (\d+) months/)![1]);
  expect(pb("pb_renewal")).toMatch(/No automatic renewal/);
  expect(pb("pb_return")).toMatch(/archival copy/);
  const [cHead, cText] = [col(doc, /^Heading/), col(doc, /^Draft text/)];
  const rows = doc.document.rows.map((r) => {
    const t = r.cells[cText];
    const h = r.cells[cHead];
    let issue: string | null = null;
    switch (h) {
      case "Term":
        if (Number(t.match(/lasts (\d+) years?/)![1]) > maxTerm) issue = "above_max";
        break;
      case "Survival":
        if (Number(t.match(/last (\d+) years after each disclosure/)![1]) < minSurvival) issue = "below_min";
        break;
      case "Limitation of liability":
        if (num(t.match(/capped at \$([\d,]+)/)![1]) < minCap) issue = "below_min";
        break;
      case "Governing law":
        if (t.match(/laws of the State of (\w[\w ]*)\./)![1] !== "Delaware") issue = "wrong_choice";
        break;
      case "Venue":
        expect(t).toMatch(/Delaware/);
        break;
      case "Non-solicitation":
        if (Number(t.match(/For (\d+) months/)![1]) > maxNs) issue = "above_max";
        break;
      case "Renewal":
        if (/renews automatically/.test(t)) issue = "not_allowed";
        break;
      case "Return of information":
        expect(t).toMatch(/archival copy/);
        break;
      default:
        throw new Error(`unknown NDA heading ${h}`);
    }
    return { id: r.id, heading: h, issue };
  });
  return { rows, minCap, maxNs };
}

// ---- Closing checklist ----

function readChecklist(doc: Doc, ceo: string) {
  const closing = day(field(doc, "closing").replace(/^Closing date: /, ""));
  const [cItem, cNeed, cGot] = [col(doc, /^Item/), col(doc, /^Needed/), col(doc, /^Received/)];
  const rows = doc.document.rows.map((r) => {
    const need = r.cells[cNeed];
    const got = r.cells[cGot];
    let issue: string | null = null;
    let kind = "signatures";
    const sig = need.match(/^Signature pages: (.+)$/);
    if (sig) {
      const want = names(sig[1]);
      const have = names(got.match(/^Signature pages in: (.+)$/)![1]);
      for (const h of have) expect(want, `${r.id} ${h}`).toContain(h);
      if (want.some((w) => !have.includes(w))) issue = "missing_sig";
    } else if (/Secretary of State before closing/.test(need)) {
      kind = "charter";
      if (!/^Filed /.test(got)) issue = "unmet";
    } else if (/good standing/.test(need)) {
      kind = "good_standing";
      const maxDays = Number(need.match(/no more than (\d+) days before closing/)![1]);
      const dated = day(got.replace(/^Dated /, ""));
      expect(dated).toBeLessThanOrEqual(closing);
      if (closing - dated > maxDays) issue = "unmet";
    } else if (/Compliance certificate signed by the CEO/.test(need)) {
      kind = "compliance";
      expect(need).toContain(ceo);
      if (!got.startsWith(`Signed by ${ceo}, CEO`)) issue = "unmet";
    } else throw new Error(`unknown checklist row ${r.cells[cItem]}`);
    return { id: r.id, item: r.cells[cItem], kind, issue };
  });
  return { closing, rows };
}

// ---- Inbox ----

function oneOption(cfg: { options: { id: string; label: string }[] }, re: RegExp) {
  const o = cfg.options.filter((x) => re.test(x.label));
  expect(o.length, `one option like ${re}`).toBe(1);
  return o[0].id;
}
const solveFounder = (sc: Screen) => oneOption(sc.mc("inbox-founder"), /^Don't backdate/);
const solveDiligence = (sc: Screen) => oneOption(sc.mc("inbox-diligence"), /^Send nothing until the NDA is signed/);
const ceoName = (sc: Screen) => sc.msg("m5").body.trim().split("\n").pop()!.trim();

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
  expect(f!.options.length).toBe(4);
  return f!;
};
const optionId = (item: RapidItem, fieldId: string, label: RegExp | string) => {
  const opts = choiceField(item, fieldId).options.filter((o) => (typeof label === "string" ? o.label === label : label.test(o.label)));
  expect(opts.length, `${item.id} ${fieldId}: one option like ${label}`).toBe(1);
  return opts[0].id;
};
const exRow = (item: RapidItem, label: string) => item.exhibit?.rows?.find((x) => x.label === label)?.value;
const mustRow = (item: RapidItem, label: string) => {
  const v = exRow(item, label);
  expect(v, `${item.id} row ${label}`).toBeDefined();
  return v!;
};

/** Ownership percentages and filing deadlines, from the exhibit alone. */
function solveOwnership(item: RapidItem): Solved {
  const f = choiceField(item, "answer");
  if (exRow(item, "Event") !== undefined) {
    const from = day(mustRow(item, "Date of the event"));
    const rule = mustRow(item, "Rule");
    const m = rule.match(/within (\d+) (calendar|business) days after/);
    expect(m, `${item.id} rule ${rule}`).not.toBeNull();
    const n = Number(m![1]);
    const hols = mustRow(item, "Federal holidays in the window");
    const holidays = hols === "None" ? [] : hols.split("; ").map((h) => day(h.replace(/ \(.+\)$/, "")));
    const open = (d: number) => !weekend(d) && !holidays.includes(d);
    let due: number;
    let kind: string;
    if (m![2] === "calendar") {
      expect(rule).toMatch(/next business day/);
      due = from + n;
      while (!open(due)) due++;
      kind = due === from + n ? "calendar" : "calendar-roll";
      expect(computeDeadline({ from: iso(from), days: n }).due).toBe(iso(due));
    } else {
      due = from;
      for (let left = n; left > 0; ) {
        due++;
        if (open(due)) left--;
      }
      kind = holidays.some((h) => h > from && h <= due) ? "business-holiday" : "business";
      expect(courtDaysAfter(iso(from), n)).toBe(iso(due));
    }
    expect(new Set(f.options.map((o) => day(o.label))).size, `${item.id} four different dates`).toBe(4);
    const right = f.options.filter((o) => day(o.label) === due);
    expect(right.length, `${item.id} one right date ${iso(due)}`).toBe(1);
    return { kind, values: { answer: right[0].id } };
  }
  expect(mustRow(item, "Rounding")).toMatch(/two decimal places/i);
  let right: string;
  let kind: string;
  if (exRow(item, "New money") !== undefined) {
    const pre = num(mustRow(item, "Before the round").match(/^([\d,]+) shares, fully diluted$/)![1]);
    const n = num(mustRow(item, "New money").match(/buys ([\d,]+) new shares/)![1]);
    right = pctLabel(n, pre + n);
    kind = "post-money";
  } else if (exRow(item, "Options and pool") !== undefined) {
    const h = mustRow(item, "Holder").match(/([\d,]+) shares of Common Stock and options over ([\d,]+) shares$/)!;
    const t = num(mustRow(item, "Shares outstanding").match(/^([\d,]+)/)![1]);
    const op = mustRow(item, "Options and pool").match(/^([\d,]+) options outstanding .* ([\d,]+) shares available in the pool$/)!;
    expect(mustRow(item, "Measure")).toMatch(/^Fully diluted/);
    right = pctLabel(num(h[1]) + num(h[2]), t + num(op[1]) + num(op[2]));
    kind = "fully-diluted";
  } else {
    const x = num(mustRow(item, "Holder").match(/([\d,]+) shares of/)![1]);
    const t = num(mustRow(item, "Shares outstanding").match(/^([\d,]+)/)![1]);
    expect(mustRow(item, "Measure")).toMatch(/outstanding shares \(not fully diluted\)/);
    right = pctLabel(x, t);
    kind = "basic";
  }
  for (const o of f.options) expect(o.label).toMatch(/^\d{1,3}\.\d{2}%$/);
  expect(new Set(f.options.map((o) => o.label)).size).toBe(4);
  return { kind, values: { answer: optionId(item, "answer", right) } };
}

/** Governance terms: what a corporate paralegal knows, by question. */
const GOVERNANCE_RULES: [string, RegExp, RegExp, "easy" | "hard"][] = [
  ["charter-authorized", /sets the number of shares Halyard is authorized to issue/, /^The certificate of incorporation$/, "easy"],
  ["quorum-meaning", /^What is a quorum/, /^The minimum number of members who must be present for the meeting to act$/, "easy"],
  ["elects-board", /Who elects Halyard's board/, /^The stockholders$/, "easy"],
  ["appoints-officers", /Who appoints Halyard's officers/, /^The board of directors$/, "easy"],
  ["registered-agent", /What does Halyard's registered agent do/, /^Receives service of process and official notices in Delaware$/, "easy"],
  ["stock-ledger", /What is a stock ledger/, /^The company's record of who holds its shares$/, "easy"],
  ["good-standing", /What is a good standing certificate/, /^The state's confirmation that the company exists and is current on its filings and taxes$/, "easy"],
  ["secretary-cert", /What does a secretary's certificate usually certify/, /^That the attached charter, bylaws and resolutions are true, complete and in effect$/, "easy"],
  ["liq-pref", /Preferred stock usually has what over common stock/, /^A liquidation preference$/, "easy"],
  ["rofr", /right of first refusal/, /^The right to buy the shares first, on the same terms$/, "easy"],
  ["drag-along", /What does a drag-along provision do/, /^Lets the majority require the other holders to join a sale of the company$/, "easy"],
  ["minutes", /What are minutes/, /^The official written record of what a meeting did$/, "easy"],
  ["options-on", /Options under Halyard's stock plan are options to buy/, /^Common Stock at a set exercise price$/, "easy"],
  ["board-consent", /Can Halyard's board act by written consent without a meeting/, /^Yes, if every director consents in writing$/, "hard"],
  ["stockholder-consent", /Can Halyard's stockholders act by written consent/, /^Yes, if holders with the votes needed at a meeting sign, with prompt notice to the others$/, "hard"],
  ["meeting-notice", /Notice of a stockholders' meeting \(DGCL §222\)/, /^Not less than 10 nor more than 60 days before the meeting$/, "hard"],
  ["waiver-attend", /attends a special meeting without objecting/, /^Waived by attending$/, "hard"],
  ["ratify-204", /lets the company ratify it/, /^DGCL §204$/, "hard"],
];

function solveGovernance(item: RapidItem): Solved {
  const out = item.prompt.match(/authorizes ([\d,]+) shares\. It has issued ([\d,]+), and has bought back ([\d,]+) that it holds as treasury stock\. How many shares are outstanding\?$/);
  if (out) return { kind: "outstanding", values: { answer: optionId(item, "answer", (num(out[2]) - num(out[3])).toLocaleString("en-US")) } };
  const q = item.prompt.match(/board has (\d+) seats, (\d+) of them vacant\. The bylaws make a majority of the whole board a quorum\. How many directors must attend/);
  if (q) return { kind: "quorum-count", values: { answer: optionId(item, "answer", String(Math.floor(Number(q[1]) / 2) + 1)) } };
  const rules = GOVERNANCE_RULES.filter(([, re]) => re.test(item.prompt));
  expect(rules.length, `${item.id}: one rule for "${item.prompt}"`).toBe(1);
  return { kind: rules[0][0], values: { answer: optionId(item, "answer", rules[0][2]) } };
}

/** Contract terms. */
const CONTRACT_RULES: [string, RegExp, RegExp, "easy" | "hard"][] = [
  ["ci-exclusion", /usually exclude from "Confidential Information"/, /^Information that is already public through no fault of the recipient$/, "easy"],
  ["governing-law", /What does a governing law clause decide/, /^Which jurisdiction's law interprets the contract$/, "easy"],
  ["venue", /What does a venue \(forum\) clause decide/, /^Where disputes must be brought$/, "easy"],
  ["indemnity", /What is an indemnity/, /^A promise to cover the other party's losses from specified claims$/, "easy"],
  ["lol", /What does a limitation of liability clause do/, /^Caps or excludes the damages a party can recover$/, "easy"],
  ["counterparts", /What does a counterparts clause allow/, /^Signing separate copies that together make one agreement$/, "easy"],
  ["integration", /entire agreement \(integration\) clause/, /^Makes the written contract the whole deal, replacing earlier discussions$/, "easy"],
  ["severability", /What does a severability clause do/, /^Keeps the rest of the contract in force if one part is invalid$/, "easy"],
  ["evergreen", /automatic renewal \(evergreen\) clause/, /^The term renews on its own unless a party gives notice$/, "easy"],
  ["non-solicit", /non-solicitation clause in an NDA usually stops a party from/, /^Recruiting the other party's employees for a period$/, "easy"],
  ["assignment", /What does an assignment clause control/, /^Whether a party can transfer its rights or obligations to someone else$/, "easy"],
  ["force-majeure", /What is a force majeure clause/, /^It excuses performance when events beyond a party's control prevent it$/, "easy"],
  ["survival", /What does a survival clause do/, /^Keeps named obligations in force after the contract ends$/, "easy"],
  ["residuals", /What is a residuals clause/, /^It lets the recipient use information kept in unaided memory$/, "hard"],
  ["closing-condition", /what is a closing condition/, /^Something that must happen, or be waived, before a party has to close$/, "hard"],
  ["bring-down", /What is the "bring-down" at closing/, /^Confirming the representations are still true at closing$/, "hard"],
  ["change-of-control", /What does a change-of-control clause typically trigger/, /^Consent or termination rights when ownership of a party changes$/, "hard"],
  ["rep-vs-covenant", /representation and a covenant/, /^A representation states a fact; a covenant promises future action$/, "hard"],
  ["mfn", /most-favored-nation \(MFN\) clause/, /^Gives a party terms at least as good as any later party gets$/, "hard"],
];

function solveContracts(item: RapidItem): Solved {
  const rules = CONTRACT_RULES.filter(([, re]) => re.test(item.prompt));
  expect(rules.length, `${item.id}: one rule for "${item.prompt}"`).toBe(1);
  return { kind: rules[0][0], values: { answer: optionId(item, "answer", rules[0][2]) } };
}

const SOLVERS: Record<RapidStepId, (item: RapidItem) => Solved> = {
  "rapid-ownership": solveOwnership,
  "rapid-governance": solveGovernance,
  "rapid-contracts": solveContracts,
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
  const cap = readCapTable(sc);
  const board = readBoard(sc.doc("board-consents"));
  const nda = readNda(sc.doc("nda-review"));
  const cl = readChecklist(sc.doc("closing-checklist"), ceoName(sc));
  return {
    ...rapidAnswers(seed),
    "cap-table": { cells: { ...cap.cells } as Record<string, number | null> },
    "board-consents": {
      flags: board.rows.flatMap((r) => r.issues.map((reason) => ({ target: r.id, reason, note: "" }))),
      decision: oneOption(sc.doc("board-consents").decision!, /^Send .* the list/),
    },
    "nda-review": { flags: nda.rows.filter((r) => r.issue).map((r) => ({ target: r.id, reason: r.issue!, note: "" })), decision: null },
    "closing-checklist": {
      flags: cl.rows.filter((r) => r.issue).map((r) => ({ target: r.id, reason: r.issue!, note: "" })),
      decision: oneOption(sc.doc("closing-checklist").decision!, /^Hold the closing/),
    },
    "inbox-founder": { selected: [solveFounder(sc)] },
    "inbox-diligence": { selected: [solveDiligence(sc)] },
  };
}

type Answers = ReturnType<typeof perfectAnswers>;
const clone = (a: Answers): Answers & Record<string, unknown> => JSON.parse(JSON.stringify(a));

describe("corporate-halyard-robotics: setup", () => {
  it("is registered, version 1, legal, 50 minutes, and uses only built step types in section order", () => {
    expect(getScenario("corporate-halyard-robotics", 1)).toBe(scenario);
    expect(listScenarios()).toContain(scenario);
    expect(scenario.version).toBe(1);
    expect(scenario.timeLimitMinutes).toBe(50);
    expect(scenario.roleFamily).toBe("legal");
    expect(scenario.title).toMatch(/Halyard Robotics/);
    expect(scenario.definition.steps.map((s) => [s.id, s.type])).toEqual([
      ["rapid-ownership", "rapid_round"],
      ["cap-table", "spreadsheet"],
      ["rapid-governance", "rapid_round"],
      ["board-consents", "document_review"],
      ["rapid-contracts", "rapid_round"],
      ["nda-review", "document_review"],
      ["closing-checklist", "document_review"],
      ["inbox-founder", "multiple_choice"],
      ["inbox-diligence", "multiple_choice"],
    ]);
    expect(scenario.definition.intro).toMatch(/corporate paralegal/i);
    expect(scenario.definition.intro).toMatch(/Halyard Robotics/);
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

  it("different seeds change names, numbers, dates and which row carries which trap", () => {
    expect(new Set(SEEDS.map((s) => JSON.stringify(scenario.generate(s).values))).size).toBe(SEEDS.length);
    const screens = SEEDS.slice(0, 60).map(screen);
    const caps = screens.map(readCapTable);
    expect(new Set(caps.map((c) => c.totalAfter)).size).toBeGreaterThan(50);
    expect(new Set(caps.map((c) => c.lead)).size).toBeGreaterThan(3);
    const boards = screens.map((s) => readBoard(s.doc("board-consents")));
    expect(new Set(boards.map((b) => b.rows.findIndex((r) => r.issues.includes("quorum")))).size).toBeGreaterThan(4);
    expect(new Set(boards.map((b) => b.notice)).size).toBeGreaterThan(2);
    const ndas = screens.map((s) => readNda(s.doc("nda-review")));
    expect(new Set(ndas.map((n) => n.rows.findIndex((r) => r.issue === "below_min" && r.heading === "Limitation of liability"))).size).toBeGreaterThan(4);
    const cls = screens.map((s) => readChecklist(s.doc("closing-checklist"), ceoName(s)));
    expect(new Set(cls.map((c) => c.rows.filter((r) => r.issue).map((r) => r.id).join())).size).toBeGreaterThan(15);
  });
});

describe("corporate-halyard-robotics: cap table", () => {
  it(
    "eight holder lines and a total; the key matches the five transactions applied by hand, for 200 seeds",
    () => {
      for (const seed of SEEDS) {
        const sc = screen(seed);
        const cap = readCapTable(sc);
        const key = scenario.generate(seed).keys["cap-table"] as SheetKey;
        expect(Object.keys(key.cells).sort(), seed).toEqual(Object.keys(cap.cells).sort());
        for (const [id, value] of Object.entries(cap.cells)) {
          expect(key.cells[id].value, `${seed} ${id}`).toBe(value);
          const tol = key.cells[id].tolerance ?? key.tolerance ?? 0;
          expect(tol, `${seed} ${id} tolerance`).toBe(id.endsWith("_pct") ? 0.01 : 0);
        }
        // Option exercise, transfer and grant don't change the fully diluted total; the round and the pool top-up do.
        const aShares = num(sc.msg("m1").body.match(/bought ([\d,]+) shares/)![1]);
        const poolAdd = num(sc.msg("m1").body.match(/added ([\d,]+) shares/)![1]);
        expect(cap.totalAfter).toBe(cap.totalBefore + aShares + poolAdd);
        const pcts = Object.entries(cap.cells).filter(([id]) => id.endsWith("_pct"));
        expect(Math.abs(pcts.reduce((s, [, v]) => s + v, 0) - 100)).toBeLessThan(0.06);
      }
    },
    LONG,
  );

  it("cells are worth 1 per share count, 2 for the total and 1.25 per percentage: 20 in all", () => {
    const blank = scoreAttempt(scenario, "abc", {});
    expect(blank.steps["cap-table"].maxPoints).toBe(20);
  });
});

describe("corporate-halyard-robotics: board actions", () => {
  it("nine actions with exactly one each of no quorum, short notice, unsigned consent and wrong stock, plus clean look-alikes", () => {
    for (const seed of SEEDS) {
      const b = readBoard(screen(seed).doc("board-consents"));
      expect(b.rows.length, seed).toBe(9);
      expect(b.rows.map((r) => r.issues.length).filter((n) => n > 1), seed).toEqual([]);
      expect(b.rows.flatMap((r) => r.issues).sort(), seed).toEqual(["notice", "quorum", "unsigned", "wrong_class"]);
      // Look-alikes: a clean special meeting with a bare quorum, a fully signed consent, and a clean stock action.
      const clean = b.rows.filter((r) => !r.issues.length);
      expect(clean.some((r) => r.how === "Special meeting" && r.people.length === b.quorum), seed).toBe(true);
      expect(clean.some((r) => r.how === "Unanimous written consent"), seed).toBe(true);
      expect(clean.filter((r) => r.stock !== "None").length, seed).toBeGreaterThanOrEqual(2);
      const dates = b.rows.map((r) => r.date);
      expect(dates, seed).toEqual([...dates].sort((x, y) => x - y));
      expect(new Set(dates).size).toBe(dates.length);
    }
  });

  it("the key agrees with the minute book", () => {
    for (const seed of SEEDS) {
      const sc = screen(seed);
      const b = readBoard(sc.doc("board-consents"));
      const k = scenario.generate(seed).keys["board-consents"] as ReviewKey;
      const at = (issue: string) => b.rows.find((r) => r.issues.includes(issue))!.id;
      for (const issue of ["quorum", "notice", "unsigned", "wrong_class"]) {
        expect(k.findings[issue], `${seed} ${issue}`).toMatchObject({ targets: [at(issue)], reasons: [issue] });
      }
      expect(sc.doc("board-consents").decision!.options.find((o) => o.id === k.decision![0])!.label).toMatch(/^Send .* the list/);
    }
  });
});

describe("corporate-halyard-robotics: NDA vs. playbook", () => {
  it("eight clauses: cap too low, wrong governing law, non-solicit too long, automatic renewal; the rest within the playbook", () => {
    for (const seed of SEEDS) {
      const sc = screen(seed);
      const n = readNda(sc.doc("nda-review"));
      expect(n.rows.length, seed).toBe(8);
      expect(n.rows.filter((r) => r.issue).map((r) => `${r.heading}:${r.issue}`).sort(), seed).toEqual([
        "Governing law:wrong_choice",
        "Limitation of liability:below_min",
        "Non-solicitation:above_max",
        "Renewal:not_allowed",
      ]);
      const k = scenario.generate(seed).keys["nda-review"] as ReviewKey;
      const at = (h: string) => n.rows.find((r) => r.heading === h)!.id;
      expect(k.findings.liability_cap).toMatchObject({ targets: [at("Limitation of liability")], reasons: ["below_min"] });
      expect(k.findings.governing_law).toMatchObject({ targets: [at("Governing law")], reasons: ["wrong_choice"] });
      expect(k.findings.non_solicit).toMatchObject({ targets: [at("Non-solicitation")], reasons: ["above_max"] });
      expect(k.findings.auto_renewal).toMatchObject({ targets: [at("Renewal")], reasons: ["not_allowed"] });
      expect(k.decision).toBeUndefined();
    }
  });
});

describe("corporate-halyard-robotics: closing checklist", () => {
  it("nine items: two missing signature pages and two unmet conditions, with a met condition and complete pages as look-alikes", () => {
    for (const seed of SEEDS) {
      const sc = screen(seed);
      const c = readChecklist(sc.doc("closing-checklist"), ceoName(sc));
      expect(c.rows.length, seed).toBe(9);
      expect(c.rows.filter((r) => r.issue).map((r) => r.issue).sort(), seed).toEqual(["missing_sig", "missing_sig", "unmet", "unmet"]);
      expect(c.rows.filter((r) => r.kind !== "signatures" && !r.issue).length, seed).toBe(1);
      const k = scenario.generate(seed).keys["closing-checklist"] as ReviewKey;
      const sigs = c.rows.filter((r) => r.issue === "missing_sig").map((r) => r.id);
      const conds = c.rows.filter((r) => r.issue === "unmet").map((r) => r.id);
      expect(k.findings.sig_1).toMatchObject({ targets: [sigs[0]], reasons: ["missing_sig"] });
      expect(k.findings.sig_2).toMatchObject({ targets: [sigs[1]], reasons: ["missing_sig"] });
      expect(k.findings.cond_1).toMatchObject({ targets: [conds[0]], reasons: ["unmet"] });
      expect(k.findings.cond_2).toMatchObject({ targets: [conds[1]], reasons: ["unmet"] });
      expect(sc.doc("closing-checklist").decision!.options.find((o) => o.id === k.decision![0])!.label).toMatch(/^Hold the closing/);
    }
  });
});

describe("corporate-halyard-robotics: inbox", () => {
  it("the founder's backdating request and the pre-NDA cap table request: one right answer each, in a different place per seed", () => {
    const places = { founder: new Set<string>(), diligence: new Set<string>() };
    for (const seed of SEEDS) {
      const sc = screen(seed);
      const keys = scenario.generate(seed).keys;
      expect(sc.mc("inbox-founder").select).toBe("single");
      expect(sc.mc("inbox-diligence").select).toBe("single");
      expect((keys["inbox-founder"] as McKey).correct).toEqual([solveFounder(sc)]);
      expect((keys["inbox-diligence"] as McKey).correct).toEqual([solveDiligence(sc)]);
      places.founder.add(solveFounder(sc));
      places.diligence.add(solveDiligence(sc));
      expect(sc.msg("m5").body).toMatch(/date/i);
      expect(sc.msg("m6").body).toMatch(/cap table/i);
    }
    expect(places.founder.size).toBe(4);
    expect(places.diligence.size).toBe(4);
  });
});

describe("corporate-halyard-robotics: scoring", () => {
  it("out of 100: rapid rounds 10 each, cap table 20, board actions 20, NDA 12, checklist 10, inbox 4 + 4", () => {
    const blank = scoreAttempt(scenario, "abc", {});
    expect(blank.points).toBe(0);
    expect(blank.maxPoints).toBe(MAX);
    const max = (id: string) => blank.steps[id].maxPoints;
    expect(RAPID_STEPS.map(max)).toEqual([10, 10, 10]);
    expect(max("cap-table")).toBe(20);
    expect(REVIEW_STEPS.map(max)).toEqual([20, 12, 10]);
    expect(MC_STEPS.map(max)).toEqual([4, 4]);
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
    const lost = (seed: string, mutate: (a: Answers & Record<string, unknown>) => void) => {
      const a = clone(perfectAnswers(seed));
      mutate(a);
      return scoreAttempt(scenario, seed, perfectAnswers(seed)).points - scoreAttempt(scenario, seed, a).points;
    };
    const dropFlag = (stepId: ReviewStepId, reason: string, nth = 0) => (a: Answers & Record<string, unknown>) => {
      const step = a[stepId] as { flags: Flag[] };
      const target = step.flags.filter((f) => f.reason === reason)[nth];
      expect(target).toBeDefined();
      step.flags = step.flags.filter((f) => f !== target);
    };
    const reReason = (stepId: ReviewStepId, reason: string, to: string) => (a: Answers & Record<string, unknown>) => {
      (a[stepId] as { flags: Flag[] }).flags.find((x) => x.reason === reason)!.reason = to;
    };

    const cases: [string, ReviewStepId, string, number][] = [
      ["no quorum", "board-consents", "quorum", 4.5],
      ["short notice", "board-consents", "notice", 4.5],
      ["consent missing a director", "board-consents", "unsigned", 4.5],
      ["stock the charter or plan doesn't allow", "board-consents", "wrong_class", 4.5],
      ["liability cap below the playbook", "nda-review", "below_min", 3],
      ["wrong governing law", "nda-review", "wrong_choice", 3],
      ["non-solicit too long", "nda-review", "above_max", 3],
      ["automatic renewal", "nda-review", "not_allowed", 3],
      ["missing signature page", "closing-checklist", "missing_sig", 2],
      ["unmet closing condition", "closing-checklist", "unmet", 2],
    ];
    for (const [name, stepId, reason, points] of cases) {
      it(`${name} missed: loses ${points}; spotted with the wrong reason: loses half`, () => {
        for (const seed of seeds) {
          expect(lost(seed, dropFlag(stepId, reason)), `${seed} ${name}`).toBe(points);
          expect(lost(seed, reReason(stepId, reason, "other")), `${seed} ${name} wrong reason`).toBe(points / 2);
        }
      });
    }

    it("the second missing signature page and the second unmet condition cost 2 each too", () => {
      for (const seed of seeds) {
        expect(lost(seed, dropFlag("closing-checklist", "missing_sig", 1))).toBe(2);
        expect(lost(seed, dropFlag("closing-checklist", "unmet", 1))).toBe(2);
      }
    });

    it("cap table: leaving out the transfer, the grant or the exercise costs exactly those two lines (4.5); the total is worth 2", () => {
      for (const seed of seeds) {
        const sc = screen(seed);
        const cap = readCapTable(sc);
        const both = (a: Answers & Record<string, unknown>, ids: [string, string], back: [number, number]) => {
          const cells = (a["cap-table"] as { cells: Record<string, number | null> }).cells;
          ids.forEach((id, j) => {
            cells[`${id}_sh`] = cells[`${id}_sh`]! - back[j];
            cells[`${id}_pct`] = pct(cells[`${id}_sh`]!, cap.totalAfter);
          });
        };
        const body = sc.msg("m1").body;
        const tr = num(body.match(/transferred ([\d,]+) shares/)![1]);
        const ex = num(body.match(/exercised options over ([\d,]+) shares/)![1]);
        const grant = num(body.match(/granted options over ([\d,]+) shares/)![1]);
        const id = (r: { sh: string | null }) => r.sh!.replace(/_sh$/, "");
        const opts = id(cap.rows.find((r) => r.holder.startsWith("Options outstanding"))!);
        const pool = id(cap.rows.find((r) => r.holder.startsWith("Option pool"))!);
        expect(lost(seed, (a) => both(a, [id(cap.ids.from), id(cap.ids.to)], [-tr, tr]))).toBe(4.5);
        expect(lost(seed, (a) => both(a, [id(cap.ids.emp), opts], [ex, -ex]))).toBe(4.5);
        expect(lost(seed, (a) => both(a, [opts, pool], [grant, -grant]))).toBe(4.5);
        expect(lost(seed, (a) => ((a["cap-table"] as { cells: Record<string, number | null> }).cells.total_sh = cap.totalBefore))).toBe(2);
      }
    });

    it("board actions and closing: the wrong decision costs 2", () => {
      for (const seed of seeds) {
        const sc = screen(seed);
        const send = oneOption(sc.doc("board-consents").decision!, /^Send the minute book as it is/);
        const close = oneOption(sc.doc("closing-checklist").decision!, /^Close today/);
        expect(lost(seed, (a) => (a["board-consents"].decision = send))).toBe(2);
        expect(lost(seed, (a) => (a["closing-checklist"].decision = close))).toBe(2);
      }
    });

    it("flagging a clean board action or a clause within the playbook costs the false-flag penalty", () => {
      for (const seed of seeds) {
        const sc = screen(seed);
        const b = readBoard(sc.doc("board-consents"));
        const ok = b.rows.find((r) => !r.issues.length)!;
        expect(lost(seed, (a) => (a["board-consents"] as { flags: Flag[] }).flags.push({ target: ok.id, reason: "quorum", note: "" }))).toBe(1);
        const n = readNda(sc.doc("nda-review"));
        const fine = n.rows.find((r) => !r.issue)!;
        expect(lost(seed, (a) => (a["nda-review"] as { flags: Flag[] }).flags.push({ target: fine.id, reason: "other", note: "" }))).toBe(1);
      }
    });

    it("inbox: backdating the consent, or sending the cap table before the NDA, costs all 4", () => {
      for (const seed of seeds) {
        const sc = screen(seed);
        const backdate = oneOption(sc.mc("inbox-founder"), /^Date it as asked: the board agreed/);
        const send = oneOption(sc.mc("inbox-diligence"), /^Send it: a cap table isn't confidential/);
        expect(lost(seed, (a) => (a["inbox-founder"].selected = [backdate]))).toBe(4);
        expect(lost(seed, (a) => (a["inbox-diligence"].selected = [send]))).toBe(4);
      }
    });
  });
});

describe("corporate-halyard-robotics: nothing from the key reaches the candidate", () => {
  it(
    "no reviewer note, key word or computed cap table number in any payload",
    () => {
      for (const seed of SEEDS) {
        const variant = scenario.generate(seed);
        const notes = REVIEW_STEPS.flatMap((id) => Object.values((variant.keys[id] as ReviewKey).findings).map((f) => f.note!));
        for (const n of notes) expect(n.length).toBeGreaterThan(10);
        const cells = Object.values((variant.keys["cap-table"] as SheetKey).cells).map((c) => c.value);
        for (const minute of [0, 20, END]) {
          const payload = JSON.stringify(renderAttemptForCandidate(scenario, seed, minute));
          expect(payload).not.toMatch(/"keys"|tolerance|"criteria"|"guidance"|"notes"|"points"|"expected"|"findings"|"clean":|"correct"/);
          for (const n of notes) expect(payload, seed).not.toContain(n);
          for (const c of cells) {
            const forms = [String(c), c.toFixed(2), c.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })];
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

describe("corporate-halyard-robotics: timed sections", () => {
  const def = scenario.definition;
  const MIN = 60_000;
  const t0 = Date.parse("2026-11-16T09:00:00Z");
  const flowAt = (ms: number) => resolveFlow(def, { startedAt: t0, now: t0 + ms, extraTimePercent: 0, events: [] });
  const stepById = (id: string) => def.steps.find((s) => s.id === id)!;

  it("validateSections passes and the sections fill the time limit exactly", () => {
    expect(validateSections(def, scenario.timeLimitMinutes)).toEqual([]);
    expect(def.sections!.reduce((t, s) => t + s.minutes, 0)).toBe(scenario.timeLimitMinutes);
  });

  it("six sections: ownership and deadlines, cap table, governance, board actions, contracts, deal desk", () => {
    expect(def.sections!.map((s) => [s.id, s.minutes, s.stepIds, !!s.oneAtATime])).toEqual([
      ["s-rapid-a", 6, ["rapid-ownership"], false],
      ["s-cap-table", 10, ["cap-table"], false],
      ["s-rapid-b", 6, ["rapid-governance"], false],
      ["s-board", 10, ["board-consents"], false],
      ["s-rapid-c", 6, ["rapid-contracts"], false],
      ["s-deal", 12, ["nda-review", "closing-checklist", ...MC_STEPS], true],
    ]);
  });

  it("one-at-a-time screens add up to their section", () => {
    for (const sec of def.sections!.filter((s) => s.oneAtATime)) {
      expect(sec.stepIds.reduce((t, id) => t + stepById(id).seconds!, 0), sec.id).toBe(sec.minutes * 60);
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

  it("runs the sections back to back", () => {
    const at = (min: number) => flowAt(min * MIN);
    expect(at(0).visibleStepIds).toEqual(["rapid-ownership"]);
    expect(at(6).visibleStepIds).toEqual(["cap-table"]);
    expect(at(16).visibleStepIds).toEqual(["rapid-governance"]);
    expect(at(22).visibleStepIds).toEqual(["board-consents"]);
    expect(at(32).visibleStepIds).toEqual(["rapid-contracts"]);
    expect(at(38).visibleStepIds).toEqual(["nda-review"]);
    expect(at(END).done).toBe(true);
  });

  it("messages arrive when their section opens", () => {
    expect(def.messages.map((m) => [m.id, m.arriveAtMinute ?? 0, m.stepId])).toEqual([
      ["m1", 0, "cap-table"],
      ["m2", 0, "board-consents"],
      ["m3", 0, "nda-review"],
      ["m4", 0, "closing-checklist"],
      ["m5", 0, "inbox-founder"],
      ["m6", 0, "inbox-diligence"],
    ]);
    const msgsAt = (min: number) => visibleMessageIds(def, flowAt(min * MIN), t0, t0 + min * MIN);
    expect(msgsAt(5)).toEqual([]);
    expect(msgsAt(6)).toEqual(["m1"]);
    expect(msgsAt(22)).toEqual(["m1", "m2"]);
    expect(msgsAt(38)).toEqual(["m1", "m2", "m3", "m4", "m5", "m6"]);
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

describe("corporate-halyard-robotics: rapid rounds", () => {
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

  it("ten quick items worth half a point and five harder ones worth one, in every round", () => {
    const hardKinds: Record<RapidStepId, string[]> = {
      "rapid-ownership": ["fully-diluted", "post-money", "business-holiday"],
      "rapid-governance": [...GOVERNANCE_RULES.filter((r) => r[3] === "hard").map((r) => r[0]), "quorum-count"],
      "rapid-contracts": CONTRACT_RULES.filter((r) => r[3] === "hard").map((r) => r[0]),
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

  it("ownership round: basic, fully diluted and post-money percentages, calendar and business-day deadlines over real holidays", () => {
    const kinds = new Map<string, number>();
    for (const seed of SEEDS.slice(0, 50)) for (const s of solveRapid(seed, "rapid-ownership")) kinds.set(s.kind, (kinds.get(s.kind) ?? 0) + 1);
    expect([...kinds.keys()].sort()).toEqual(["basic", "business-holiday", "calendar", "calendar-roll", "fully-diluted", "post-money"]);
    expect(kinds.get("business-holiday")).toBe(150);
    expect(kinds.get("basic")).toBe(250);
  });

  it("varies per seed: which item comes when and where the right option sits", () => {
    for (const id of RAPID_STEPS) {
      const firsts = SEEDS.slice(0, 60).map((seed) => solveRapid(seed, id)[0]);
      expect(new Set(firsts.map((s) => JSON.stringify(s.item))).size, id).toBeGreaterThan(id === "rapid-ownership" ? 40 : 8);
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
