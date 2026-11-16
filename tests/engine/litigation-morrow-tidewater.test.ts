import { describe, expect, it, vi } from "vitest";
import type { RapidChoiceField, RapidItem } from "@/lib/engine/step-types/rapid_round/public";

vi.mock("server-only", () => ({}));

const { litigationMorrowTidewater } = await import("@/lib/engine/scenarios/litigation-morrow-tidewater");
const { getScenario, listScenarios } = await import("@/lib/engine/scenarios");
const { renderAttemptForCandidate, renderFlowForCandidate } = await import("@/lib/engine/server/render");
const { scoreAttempt } = await import("@/lib/engine/server/score");
const { resolveFlow, visibleMessageIds, validateSections } = await import("@/lib/engine/server/flow");
const { rapidRoundServer } = await import("@/lib/engine/step-types/rapid_round/server");
const { fillTemplate, templateValues } = await import("@/lib/engine/server/template");
const { computeDeadline } = await import("@/lib/engine/scenarios/legal");

/**
 * Litigation paralegal: Morrow v. Tidewater Freight. Three rapid rounds
 * (deadlines, citation format, procedure) and three work sections (privilege
 * review, cite-check, exhibit list and inbox), 52 minutes, 100 points. These
 * tests solve every task from what the candidate sees (rendered documents,
 * messages and rapid items) with their own reading of the rules, then compare
 * with the server key, so the material and the key can't drift apart.
 */

const scenario = litigationMorrowTidewater;
const SEEDS = Array.from({ length: 200 }, (_, i) => `attempt-${i.toString(16).padStart(4, "0")}`);
const END = scenario.timeLimitMinutes;
const MAX = 100;
const RAPID_STEPS = ["rapid-deadlines", "rapid-citations", "rapid-procedure"] as const;
type RapidStepId = (typeof RAPID_STEPS)[number];
const REVIEW_STEPS = ["privilege-review", "cite-check", "exhibit-list"] as const;
const MC_STEPS = ["inbox-filing", "inbox-opposing", "inbox-client"] as const;

type Field = { id: string; label: string; value: string };
type Doc = {
  prompt: string;
  document: { title: string; fields: Field[]; columns: string[]; rows: { id: string; cells: string[] }[]; totals: Field[]; footnote?: string };
  reasons: { id: string; label: string }[];
  decision?: { prompt: string; options: { id: string; label: string }[] };
  confirmClean?: { label: string };
};
type Mc = { prompt: string; options: { id: string; label: string }[]; select: "single" | "multi" };
type ReviewKey = { findings: Record<string, { targets: string[]; reasons: string[]; note?: string }>; decision?: string[]; clean?: boolean };
type McKey = { correct: string[] };
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
  const doc = (id: (typeof REVIEW_STEPS)[number]) => step(id).config as Doc;
  const mc = (id: (typeof MC_STEPS)[number]) => step(id).config as Mc;
  return { view, step, msg, doc, mc };
}

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

// ---- Privilege review ----

/** The production index read the way a privilege reviewer would. */
function readProduction(doc: Doc) {
  const firm = field(doc, "firm").match(/@([a-z0-9.-]+)/)![1];
  const client = field(doc, "client").match(/@([a-z0-9.-]+)/)![1];
  const [cBates, cType, cFrom, cTo, cTreat] = [col(doc, /^Bates/), col(doc, /^Type/), col(doc, /^From/), col(doc, /^To/), col(doc, /^Proposed treatment/)];
  const rows = doc.document.rows.map((r) => {
    const [startTxt, endTxt] = r.cells[cBates].split("–");
    const num = (s: string) => {
      expect(s, `${r.id} bates`).toMatch(/^MOR\d{6}$/);
      return Number(s.slice(3));
    };
    const start = num(startTxt);
    const end = endTxt ? num(endTxt) : start;
    const emails = [...`${r.cells[cFrom]} ${r.cells[cTo]}`.matchAll(/<[^@>]+@([a-z0-9.-]+)>/g)].map((m) => m[1]);
    const type = r.cells[cType];
    const firmInvolved = emails.includes(firm);
    const thirdParty = emails.some((d) => d !== firm && d !== client);
    const privileged =
      (type === "Email" && firmInvolved) || ((type === "Memo" || type === "Notes") && r.cells[cFrom].includes(`@${firm}>`) && r.cells[cTo] === "File");
    const withheld = /^Withhold/.test(r.cells[cTreat]);
    let issue: "privileged" | "waived" | null = null;
    if (privileged && !thirdParty && !withheld) issue = "privileged";
    if (withheld && (thirdParty || !privileged)) issue = "waived";
    return { id: r.id, start, end, type, privileged, thirdParty, withheld, issue };
  });
  const bates = rows.slice(1).flatMap((r, i) => {
    const prev = rows[i];
    if (r.start > prev.end + 1) return [{ kind: "bates_gap" as const, id: r.id, prev: prev.id }];
    if (r.start <= prev.end) return [{ kind: "bates_dup" as const, id: r.id, prev: prev.id }];
    return [];
  });
  return { firm, client, rows, bates };
}

// ---- Cite-check ----

type Authority = { name: string; volume: number; reporter: string; first: number; paren: string; year: number };
const yearOf = (paren: string) => Number(paren.match(/(\d{4})$/)![1]);

/** The verified research file from the attorney's message. */
function researchFile(body: string) {
  const entries = body
    .split("\n")
    .filter((l) => l.startsWith("• "))
    .map((l) => {
      const m = l.match(/^• (.+), (\d+) (.+?) (\d+) \(([^()]*)\)\. Pages (\d+)–(\d+)\. Holding, at (\d+): "(.+)\." Status: (.+)\.$/);
      expect(m, `research entry: ${l}`).not.toBeNull();
      return {
        name: m![1],
        volume: Number(m![2]),
        reporter: m![3],
        first: Number(m![4]),
        paren: m![5],
        year: yearOf(m![5]),
        last: Number(m![7]),
        pin: Number(m![8]),
        holding: m![9],
        status: m![10],
      };
    });
  return entries;
}

function readCiteCheck(doc: Doc, body: string) {
  const file = researchFile(body);
  const [cCite, cParen] = [col(doc, /^Authority/), col(doc, /^Parenthetical/)];
  const rows = doc.document.rows.map((r) => {
    const m = r.cells[cCite].match(/^(.+), (\d+) (.+?) (\d+), (\d+) \(([^()]*)\)$/);
    expect(m, `${r.id} cite: ${r.cells[cCite]}`).not.toBeNull();
    const p = r.cells[cParen].match(/^\(holding that (.+)\)$/);
    expect(p, `${r.id} parenthetical`).not.toBeNull();
    const cite = { name: m![1], volume: Number(m![2]), reporter: m![3], first: Number(m![4]), pin: Number(m![5]), paren: m![6], year: yearOf(m![6]) };
    const src = file.find((f) => f.name === cite.name);
    const issues: string[] = [];
    if (!src) issues.push("not_found");
    else {
      expect([cite.volume, cite.reporter, cite.first], `${r.id} same report as the file`).toEqual([src.volume, src.reporter, src.first]);
      expect(cite.paren.replace(/\s*\d{4}$/, ""), `${r.id} same court`).toBe(src.paren.replace(/\s*\d{4}$/, ""));
      if (cite.year !== src.year) issues.push("year");
      if (cite.pin !== src.pin) issues.push("pin");
      if (p![1] !== src.holding) issues.push("quote");
      if (/^overruled/i.test(src.status)) issues.push("bad_law");
      else expect(src.status).toBe("good law");
    }
    return { id: r.id, cite, holding: p![1], src, issues };
  });
  return { file, rows };
}

// ---- Exhibit list ----

function readExhibits(doc: Doc) {
  const produced = [...field(doc, "produced").matchAll(/([A-Z]{3})(\d{6})–\1(\d{6})/g)].map((m) => ({ prefix: m[1], from: Number(m[2]), to: Number(m[3]) }));
  expect(produced.length).toBe(2);
  const [cNo, cDesc, cDate, cBates, cBinder] = [col(doc, /^Exhibit/), col(doc, /^Description/), col(doc, /^Date/), col(doc, /^Bates/), col(doc, /binder/i)];
  const rows = doc.document.rows.map((r) => {
    const bates = r.cells[cBates];
    const binder = r.cells[cBinder];
    const isDepo = /^Deposition transcript of /.test(r.cells[cDesc]);
    const range = bates.match(/^([A-Z]{3})(\d{6})(?:–\1(\d{6}))?$/);
    if (!isDepo) expect(range, `${r.id} bates ${bates}`).not.toBeNull();
    const inProduction =
      isDepo || produced.some((p) => p.prefix === range![1] && Number(range![2]) >= p.from && Number(range![3] ?? range![2]) <= p.to);
    return { id: r.id, no: r.cells[cNo], desc: r.cells[cDesc], date: r.cells[cDate], bates, binder, isDepo, inProduction };
  });
  const issues = new Map<string, string>();
  const empty = rows.filter((r) => /^Empty/.test(r.binder));
  for (const r of empty) issues.set(r.id, "missing");
  const dups = rows.filter((r, i) => !r.isDepo && rows.findIndex((x) => x.bates === r.bates) < i);
  for (const r of dups) issues.set(r.id, "duplicate");
  for (const r of rows.filter((x) => !x.inProduction)) issues.set(r.id, "not_produced");
  for (const r of rows.filter((x) => x.isDepo)) {
    const taken = r.binder.match(/cover page: taken (.+)$/)![1];
    if (day(taken) !== day(r.date)) issues.set(r.id, "date");
  }
  for (const r of rows.filter((x) => !x.isDepo && !/^Empty/.test(x.binder))) {
    // Every other tab holds the document listed: same date, same Bates.
    expect(r.binder, `${r.id} binder`).toContain(r.date);
    expect(r.binder.endsWith(r.bates), `${r.id} binder bates`).toBe(true);
  }
  const firstOf = (id: string) => rows.find((x) => x.bates === rows.find((y) => y.id === id)!.bates)!.id;
  return { rows, issues, produced, firstOf, empty, dups };
}

// ---- Inbox ----

function solveFiling(sc: ReturnType<typeof screen>) {
  const cfg = sc.mc("inbox-filing");
  const body = sc.msg("m4").body;
  const limit = Number(cfg.prompt.match(/No single file may be larger than (\d+) MB/)![1]);
  const brief = Number(body.match(/brief is one PDF, (\d+) MB on its own/)![1]);
  const largest = Number(body.match(/the largest is (\d+) MB/)![1]);
  expect(largest, "every exhibit fits the limit").toBeLessThanOrEqual(limit);
  const order = /A proposed order is attached/.test(body);
  expect(order || /No proposed order/.test(body)).toBe(true);
  const id = (re: RegExp) => {
    const o = cfg.options.filter((x) => re.test(x.label));
    expect(o.length, `filing option ${re}`).toBe(1);
    return o[0].id;
  };
  const right = [id(/text recognition/), id(/^File each exhibit as its own attachment/)];
  if (brief > limit) right.push(id(/^Split the brief/));
  if (order) right.push(id(/proposed order in Word/));
  return { right: right.sort(), limit, brief, order };
}

function oneOption(cfg: Mc, re: RegExp) {
  const o = cfg.options.filter((x) => re.test(x.label));
  expect(o.length, `one option like ${re}`).toBe(1);
  return o[0].id;
}
const solveOpposing = (sc: ReturnType<typeof screen>) => oneOption(sc.mc("inbox-opposing"), /^Send nothing/);
const solveClient = (sc: ReturnType<typeof screen>) => oneOption(sc.mc("inbox-client"), /can't give legal advice/);

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
const row = (item: RapidItem, label: string) => {
  const r = item.exhibit?.rows?.find((x) => x.label === label);
  expect(r, `${item.id} row ${label}`).toBeDefined();
  return r!.value;
};

/** Deadlines: FRCP 6(a) from the docket entry and the holidays it lists. */
function solveDeadline(item: RapidItem): Solved {
  const from = day(row(item, "Date of the event"));
  const rule = row(item, "Rule");
  const days = Number(rule.match(/(\d+) days after/)![1]);
  const service = row(item, "Service");
  const mail = /U\.S\. mail/.test(service);
  const holidayText = row(item, "Court holidays in the window");
  const holidays = holidayText === "None" ? [] : holidayText.split("; ").map((h) => day(h.replace(/ \(.+\)$/, "")));
  const open = (d: number) => !weekend(d) && !holidays.includes(d);
  const roll = (d: number) => {
    while (!open(d)) d++;
    return d;
  };
  const periodEnd = from + days;
  let due = roll(periodEnd);
  if (mail) due = roll(due + 3);
  const holidayRoll = holidays.some((h) => h >= periodEnd && h <= due);
  const kind = mail ? "mail" : holidayRoll ? "holiday" : due !== periodEnd ? "weekend" : "plain";
  const field = choiceField(item, "due");
  expect(field.options.length).toBe(4);
  expect(new Set(field.options.map((o) => day(o.label))).size, `${item.id} four different dates`).toBe(4);
  const right = field.options.filter((o) => day(o.label) === due);
  expect(right.length, `${item.id} one right date (${iso(due)})`).toBe(1);
  // The helper agrees with this independent reading.
  expect(computeDeadline({ from: iso(from), days, mailService: mail }).due).toBe(iso(due));
  return { kind, values: { due: right[0].id } };
}

/** Citation format: the research file vs the cite as written, under the firm's guide. */
function solveCitation(item: RapidItem): Solved {
  const guide = row(item, "Firm citation guide");
  const courts = new Map(
    guide
      .split("Courts: ")[1]
      .replace(/\.$/, "")
      .split("; ")
      .map((p) => p.split(" = ") as [string, string]),
  );
  expect(courts.size).toBe(3);
  const file = row(item, "Research file").match(/^(.+) · (.+) · decided (\d{4}) · (\d+) (.+), pages (\d+)–(\d+) · the point is at page (\d+)$/);
  expect(file, `${item.id} research file`).not.toBeNull();
  const [, name, court, year, volume, reporter, first, , pin] = file!;
  const abbr = courts.get(court);
  expect(abbr, `${item.id} court ${court} in the guide`).toBeDefined();
  const expectedParen = /^year only/.test(abbr!) ? year : `${abbr} ${year}`;
  const written = row(item, "As written in the brief").match(/^(.+), (\d+) (.+?) (\d+), (\d+) \(([^()]*)\)$/);
  expect(written, `${item.id} written cite`).not.toBeNull();
  const wrong: string[] = [];
  if (written![1] !== name) wrong.push("name");
  if (written![2] !== volume || written![3] !== reporter) wrong.push("reporter");
  if (written![4] !== first || written![5] !== pin) wrong.push("pages");
  if (written![6] !== expectedParen) wrong.push("paren");
  expect(wrong.length, `${item.id} at most one wrong part (${wrong})`).toBeLessThanOrEqual(1);
  const part = wrong[0] ?? "ok";
  const label: Record<string, RegExp> = { ok: /^Correct/, name: /^Case name/, reporter: /^Volume or reporter/, pages: /^First page or pin/, paren: /^Court or year/ };
  const yearOnly = /^year only/.test(abbr!);
  const writtenCourt = written![6].replace(/ ?\d{4}$/, "");
  const kinds: Record<string, () => string> = {
    ok: () => (yearOnly ? "wex-ok" : "ok"),
    name: () => "name",
    reporter: () => "reporter",
    pages: () => (written![4] !== first ? "first-page" : "pin"),
    paren: () => (writtenCourt === (yearOnly ? "" : abbr) ? "year" : yearOnly ? "wex-court" : "wrong-court"),
  };
  return { kind: kinds[part](), values: { part: optionId(item, "part", label[part]) } };
}

/** Procedure: what a litigation paralegal knows, by question. */
const PROCEDURE_RULES: [string, RegExp, RegExp, "easy" | "hard"][] = [
  ["wp-memo", /wrote a memo analyzing Morrow's trial strategy/, /^The work-product doctrine$/, "easy"],
  ["starts-case", /starts a civil case in federal court/, /^Filing a complaint with the court$/, "easy"],
  ["e-service", /through the court's e-filing system\. How many days do you add/, /^None: e-service adds no days$/, "easy"],
  ["serve-counsel", /Who must Morrow serve its discovery responses on/, /^Tidewater's counsel of record$/, "easy"],
  ["not-filed", /interrogatory answers be filed with the court/, /^No: serve them, and file only when used in the case$/, "easy"],
  ["clawback", /privileged email went out in a production by mistake/, /^Clawback$/, "easy"],
  ["duces-tecum", /subpoena duces tecum require/, /^Producing documents or things$/, "easy"],
  ["bates", /What is a Bates number/, /^A unique number stamped on each produced page$/, "easy"],
  ["nonparty", /isn't a party\. How does Morrow get their documents/, /^A subpoena under FRCP 45$/, "easy"],
  ["cert-service", /What does a certificate of service show/, /^When, how and on whom a paper was served$/, "easy"],
  ["dispositive", /Which of these is a dispositive motion/, /^Motion for summary judgment$/, "easy"],
  ["lit-hold", /litigation hold notice tells Morrow's staff to/, /^Keep every document and file that may be relevant$/, "easy"],
  ["rule-11", /Who signs Morrow's pleadings under FRCP 11/, /^An attorney of record$/, "easy"],
  ["waiver", /forwarded .*'s advice email to .* Is the email still privileged/, /^Probably not: sharing it with an outsider can waive privilege$/, "hard"],
  ["depo-notice", /How much notice does FRCP 30\(b\)\(1\) require/, /^Reasonable written notice to every party$/, "hard"],
  ["rfa-missed", /misses the 30-day deadline to answer Tidewater's requests for admission/, /^The matters are deemed admitted unless the court allows otherwise$/, "hard"],
  ["efile-time", /Until when can a paper be e-filed on its last day/, /^Midnight in the court's time zone$/, "hard"],
  ["expert-draft", /sends a draft report to .* the draft is/, /^Protected from discovery$/, "hard"],
  ["summons", /Who may serve the summons and complaint on Tidewater/, /^Any adult who isn't a party$/, "hard"],
];

function solveProcedure(item: RapidItem): Solved {
  const f = item.fields[0];
  expect(item.fields.length).toBe(1);
  if (f.kind === "number") {
    const rogs = item.prompt.match(/^Morrow served (\d+) interrogatories .* How many more may it serve/);
    if (rogs) return { kind: "interrogatories", values: { answer: 25 - Number(rogs[1]) } };
    const depo = item.prompt.match(/has run (\d+) hours (\d+) minutes on the record\. .*how many minutes are left/);
    expect(depo, `${item.id} number item: ${item.prompt}`).not.toBeNull();
    return { kind: "depo-time", values: { answer: 7 * 60 - (Number(depo![1]) * 60 + Number(depo![2])) } };
  }
  const rules = PROCEDURE_RULES.filter(([, re]) => re.test(item.prompt));
  expect(rules.length, `${item.id}: one rule for "${item.prompt}"`).toBe(1);
  expect((f as RapidChoiceField).options.length).toBe(4);
  return { kind: rules[0][0], values: { answer: optionId(item, "answer", rules[0][2]) } };
}

const SOLVERS: Record<RapidStepId, (item: RapidItem) => Solved> = {
  "rapid-deadlines": solveDeadline,
  "rapid-citations": solveCitation,
  "rapid-procedure": solveProcedure,
};
const solveRapid = (seed: string, stepId: RapidStepId) => rapidItems(seed, stepId).map((item) => ({ item, ...SOLVERS[stepId](item) }));

function rapidAnswers(seed: string) {
  return Object.fromEntries(
    RAPID_STEPS.map((id) => [id, { items: Object.fromEntries(solveRapid(seed, id).map((s) => [s.item.id, { values: s.values, ms: 7_000 }])) }]),
  ) as Record<RapidStepId, { items: Record<string, { values: Record<string, string | number>; ms: number }> }>;
}

// ---- A strong candidate's answers, built only from the screen ----

function perfectAnswers(seed: string) {
  const sc = screen(seed);
  const prod = readProduction(sc.doc("privilege-review"));
  const cc = readCiteCheck(sc.doc("cite-check"), sc.msg("m2").body);
  const ex = readExhibits(sc.doc("exhibit-list"));
  const privFlags: Flag[] = [
    ...prod.rows.filter((r) => r.issue).map((r) => ({ target: r.id, reason: r.issue!, note: "" })),
    ...prod.bates.map((b) => ({ target: b.id, reason: b.kind, note: "" })),
  ];
  return {
    ...rapidAnswers(seed),
    "privilege-review": { flags: privFlags, decision: oneOption({ options: sc.doc("privilege-review").decision!.options } as Mc, /^Hold the volume/), clean: false },
    "cite-check": {
      flags: cc.rows.filter((r) => r.issues.length).map((r) => ({ target: r.id, reason: r.issues[0], note: "" })),
      decision: oneOption({ options: sc.doc("cite-check").decision!.options } as Mc, /^Hold the filing/),
    },
    "exhibit-list": { flags: [...ex.issues].map(([target, reason]) => ({ target, reason, note: "" })), decision: null },
    "inbox-filing": { selected: solveFiling(sc).right },
    "inbox-opposing": { selected: [solveOpposing(sc)] },
    "inbox-client": { selected: [solveClient(sc)] },
  };
}

type Answers = ReturnType<typeof perfectAnswers>;
const clone = (a: Answers): Answers & Record<string, unknown> => JSON.parse(JSON.stringify(a));

describe("litigation-morrow-tidewater: setup", () => {
  it("is registered, version 1, legal, about 52 minutes, and uses only built step types in section order", () => {
    expect(getScenario("litigation-morrow-tidewater", 1)).toBe(scenario);
    expect(listScenarios()).toContain(scenario);
    expect(scenario.version).toBe(1);
    expect(scenario.timeLimitMinutes).toBe(52);
    expect(scenario.roleFamily).toBe("legal");
    expect(scenario.title).toMatch(/Morrow v\. Tidewater Freight/);
    expect(scenario.definition.steps.map((s) => [s.id, s.type])).toEqual([
      ["rapid-deadlines", "rapid_round"],
      ["privilege-review", "document_review"],
      ["rapid-citations", "rapid_round"],
      ["cite-check", "document_review"],
      ["rapid-procedure", "rapid_round"],
      ["exhibit-list", "document_review"],
      ["inbox-filing", "multiple_choice"],
      ["inbox-opposing", "multiple_choice"],
      ["inbox-client", "multiple_choice"],
    ]);
    expect(scenario.definition.intro).toMatch(/litigation paralegal/i);
    expect(scenario.definition.intro).toMatch(/Morrow/);
    expect(scenario.definition.intro).toMatch(/Tidewater/);
  });

  it("renders for 200 seeds with no unfilled template, and every rapid item renders", () => {
    for (const seed of SEEDS) {
      for (const minute of [0, END]) {
        const view = renderAttemptForCandidate(scenario, seed, minute);
        expect(view.steps.length).toBeGreaterThanOrEqual(1);
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

  it("different seeds change names, numbers, dates and which document carries which trap", () => {
    expect(new Set(SEEDS.map((s) => JSON.stringify(scenario.generate(s).values))).size).toBe(SEEDS.length);
    const screens = SEEDS.slice(0, 60).map(screen);
    const prods = screens.map((s) => readProduction(s.doc("privilege-review")));
    expect(new Set(prods.map((p) => p.firm)).size).toBeGreaterThan(3);
    expect(new Set(prods.map((p) => p.rows[0].start)).size).toBeGreaterThan(50);
    expect(new Set(prods.map((p) => p.rows.findIndex((r) => r.issue === "waived"))).size).toBeGreaterThan(5);
    expect(new Set(prods.map((p) => p.bates.find((b) => b.kind === "bates_gap")!.id)).size).toBeGreaterThan(5);
    const ccs = screens.map((s) => readCiteCheck(s.doc("cite-check"), s.msg("m2").body));
    expect(new Set(ccs.map((c) => c.rows.findIndex((r) => r.issues[0] === "not_found"))).size).toBeGreaterThan(5);
    expect(new Set(ccs.map((c) => c.rows[0].cite.name)).size).toBeGreaterThan(40);
    const exs = screens.map((s) => readExhibits(s.doc("exhibit-list")));
    expect(new Set(exs.map((e) => e.empty[0].id)).size).toBeGreaterThan(5);
    expect(new Set(screens.map((s) => solveFiling(s).right.join())).size).toBe(4);
  });
});

describe("litigation-morrow-tidewater: privilege review", () => {
  it("fifteen documents with exactly one of each trap: privileged email produced, work product produced, waived privilege withheld, Bates gap, Bates repeat", () => {
    for (const seed of SEEDS) {
      const doc = screen(seed).doc("privilege-review");
      const p = readProduction(doc);
      expect(p.rows.length, seed).toBe(15);
      expect(p.firm).not.toBe(p.client);
      const issues = p.rows.filter((r) => r.issue);
      expect(issues.map((r) => `${r.type}:${r.issue}`).sort(), seed).toEqual(["Email:privileged", "Email:waived", "Memo:privileged"]);
      expect(p.bates.map((b) => b.kind).sort(), seed).toEqual(["bates_dup", "bates_gap"]);
      // Look-alikes that are right: a withheld attorney-client email and withheld work product stay withheld.
      expect(p.rows.filter((r) => r.withheld && !r.issue).length, seed).toBe(2);
      // A Bates problem never sits on or next to a privilege problem, and the two Bates problems don't touch.
      const ids = p.rows.map((r) => r.id);
      const near = p.bates.flatMap((b) => [b.id, b.prev]);
      for (const r of issues) expect(near, `${seed} ${r.id}`).not.toContain(r.id);
      // ...and only plain produced business records sit around a Bates problem.
      for (const id of near) expect(p.rows.find((r) => r.id === id)!.withheld, `${seed} ${id}`).toBe(false);
      expect(new Set(near).size).toBe(4);
      expect(ids).toEqual([...ids].sort());
    }
  });

  it("the key agrees with the index", () => {
    for (const seed of SEEDS) {
      const sc = screen(seed);
      const p = readProduction(sc.doc("privilege-review"));
      const k = scenario.generate(seed).keys["privilege-review"] as ReviewKey;
      const byIssue = (type: string, issue: string) => p.rows.find((r) => r.type === type && r.issue === issue)!.id;
      expect(k.findings.priv_ac).toMatchObject({ targets: [byIssue("Email", "privileged")], reasons: ["privileged"] });
      expect(k.findings.priv_wp).toMatchObject({ targets: [byIssue("Memo", "privileged")], reasons: ["privileged"] });
      expect(k.findings.waived).toMatchObject({ targets: [byIssue("Email", "waived")], reasons: ["waived"] });
      const gap = p.bates.find((b) => b.kind === "bates_gap")!;
      const dup = p.bates.find((b) => b.kind === "bates_dup")!;
      expect(k.findings.bates_gap).toMatchObject({ targets: [gap.id, gap.prev], reasons: ["bates_gap"] });
      expect(k.findings.bates_dup).toMatchObject({ targets: [dup.id, dup.prev], reasons: ["bates_dup"] });
      const decision = sc.doc("privilege-review").decision!.options.find((o) => o.id === k.decision![0])!;
      expect(decision.label).toMatch(/^Hold the volume/);
    }
  });
});

describe("litigation-morrow-tidewater: cite-check", () => {
  it("nine authorities: one not in the research file, one overruled, one misquoted, one wrong pin cite, one wrong year, four right", () => {
    for (const seed of SEEDS) {
      const sc = screen(seed);
      const cc = readCiteCheck(sc.doc("cite-check"), sc.msg("m2").body);
      expect(cc.rows.length, seed).toBe(9);
      expect(cc.rows.map((r) => r.issues.length).filter((n) => n > 1), `${seed} one issue per authority`).toEqual([]);
      expect(cc.rows.flatMap((r) => r.issues).sort(), seed).toEqual(["bad_law", "not_found", "pin", "quote", "year"]);
      // The file holds every real case cited plus cases not cited, so a count gives nothing away.
      expect(cc.file.length).toBeGreaterThan(cc.rows.filter((r) => r.src).length);
      // Alphabetical, like a table of authorities.
      const names = cc.rows.map((r) => r.cite.name);
      expect(names, seed).toEqual([...names].sort((a, b) => a.localeCompare(b)));
      // The misquote changes the holding's words, not just punctuation.
      const misquote = cc.rows.find((r) => r.issues[0] === "quote")!;
      expect(misquote.holding.toLowerCase()).not.toBe(misquote.src!.holding.toLowerCase());
    }
  });

  it("the key agrees with the research file", () => {
    for (const seed of SEEDS) {
      const sc = screen(seed);
      const cc = readCiteCheck(sc.doc("cite-check"), sc.msg("m2").body);
      const k = scenario.generate(seed).keys["cite-check"] as ReviewKey;
      const at = (issue: string) => cc.rows.find((r) => r.issues[0] === issue)!.id;
      expect(k.findings.fabricated).toMatchObject({ targets: [at("not_found")], reasons: ["not_found"] });
      expect(k.findings.bad_law).toMatchObject({ targets: [at("bad_law")], reasons: ["bad_law"] });
      expect(k.findings.misquote).toMatchObject({ targets: [at("quote")], reasons: ["quote"] });
      expect(k.findings.pin).toMatchObject({ targets: [at("pin")], reasons: ["pin"] });
      expect(k.findings.year).toMatchObject({ targets: [at("year")], reasons: ["year"] });
      expect(sc.doc("cite-check").decision!.options.find((o) => o.id === k.decision![0])!.label).toMatch(/^Hold the filing/);
    }
  });

  it("the firm's citation guide is in the brief's footnote and the attorney's message", () => {
    const sc = screen("abc");
    expect(sc.doc("cite-check").document.footnote).toMatch(/14th Cir\./);
    expect(sc.msg("m2").body).toMatch(/AI drafting tool/);
    expect(sc.msg("m2").body).toMatch(/Research file/);
  });
});

describe("litigation-morrow-tidewater: exhibit list", () => {
  it("twelve exhibits with exactly one empty tab, one document listed twice, one never produced and one deposition date wrong", () => {
    for (const seed of SEEDS) {
      const ex = readExhibits(screen(seed).doc("exhibit-list"));
      expect(ex.rows.length, seed).toBe(12);
      expect(ex.rows.map((r) => r.no)).toEqual(Array.from({ length: 12 }, (_, i) => `PX-${i + 1}`));
      expect([...ex.issues.values()].sort(), seed).toEqual(["date", "duplicate", "missing", "not_produced"]);
      expect(ex.rows.filter((r) => r.isDepo).length, seed).toBeGreaterThanOrEqual(2);
      // The duplicate is the same document under two numbers with different wording.
      const dup = ex.dups[0];
      const first = ex.rows.find((r) => r.id === ex.firstOf(dup.id))!;
      expect(first.id).not.toBe(dup.id);
      expect(first.desc).not.toBe(dup.desc);
      expect(first.date).toBe(dup.date);
    }
  });

  it("the key agrees with the binder", () => {
    for (const seed of SEEDS) {
      const ex = readExhibits(screen(seed).doc("exhibit-list"));
      const k = scenario.generate(seed).keys["exhibit-list"] as ReviewKey;
      const at = (issue: string) => [...ex.issues].find(([, i]) => i === issue)![0];
      expect(k.findings.missing).toMatchObject({ targets: [at("missing")], reasons: ["missing"] });
      expect(k.findings.duplicate).toMatchObject({ targets: [at("duplicate"), ex.firstOf(at("duplicate"))], reasons: ["duplicate"] });
      expect(k.findings.not_produced).toMatchObject({ targets: [at("not_produced")], reasons: ["not_produced"] });
      expect(k.findings.depo_date).toMatchObject({ targets: [at("date")], reasons: ["date"] });
      expect(k.decision).toBeUndefined();
    }
  });
});

describe("litigation-morrow-tidewater: inbox", () => {
  it("the filing key follows the local rule: text-searchable, exhibits separate, split when over the limit, Word proposed order when there is one", () => {
    let over = 0;
    let order = 0;
    for (const seed of SEEDS) {
      const sc = screen(seed);
      const f = solveFiling(sc);
      expect(sc.mc("inbox-filing").select).toBe("multi");
      expect((scenario.generate(seed).keys["inbox-filing"] as McKey).correct.slice().sort(), seed).toEqual(f.right);
      if (f.brief > f.limit) over++;
      if (f.order) order++;
    }
    expect(over).toBeGreaterThan(40);
    expect(over).toBeLessThan(160);
    expect(order).toBeGreaterThan(40);
    expect(order).toBeLessThan(160);
  });

  it("opposing counsel's paralegal and the client: one right answer each, in a different place per seed", () => {
    const places = { opp: new Set<string>(), client: new Set<string>() };
    for (const seed of SEEDS) {
      const sc = screen(seed);
      const keys = scenario.generate(seed).keys;
      expect(sc.mc("inbox-opposing").select).toBe("single");
      expect(sc.mc("inbox-client").select).toBe("single");
      expect((keys["inbox-opposing"] as McKey).correct).toEqual([solveOpposing(sc)]);
      expect((keys["inbox-client"] as McKey).correct).toEqual([solveClient(sc)]);
      places.opp.add(solveOpposing(sc));
      places.client.add(solveClient(sc));
      expect(sc.msg("m5").from).toMatch(/paralegal/i);
      expect(sc.msg("m6").body).toMatch(/\$[\d,]+/);
    }
    expect(places.opp.size).toBe(4);
    expect(places.client.size).toBe(4);
  });
});

describe("litigation-morrow-tidewater: scoring", () => {
  it("out of 100: rapid rounds 10 each, privilege review 20, cite-check 20, exhibit list 15, inbox 15", () => {
    const blank = scoreAttempt(scenario, "abc", {});
    expect(blank.points).toBe(0);
    expect(blank.maxPoints).toBe(MAX);
    const max = (id: string) => blank.steps[id].maxPoints;
    expect(RAPID_STEPS.map(max)).toEqual([10, 10, 10]);
    expect(REVIEW_STEPS.map(max)).toEqual([20, 20, 15]);
    expect(MC_STEPS.map(max)).toEqual([7, 4, 4]);
  });

  it("blank scores 0 for every seed", () => {
    for (const seed of SEEDS.slice(0, 50)) expect(scoreAttempt(scenario, seed, {}).points).toBe(0);
  });

  it("a perfect answer, built only from the screen, scores 100 for every seed with nothing left for review", () => {
    for (const seed of SEEDS) {
      const s = scoreAttempt(scenario, seed, perfectAnswers(seed));
      for (const [id, step] of Object.entries(s.steps)) {
        expect(step.points, `${seed} ${id}`).toBe(step.maxPoints);
        expect(step.needsReview, `${seed} ${id}`).toBeFalsy();
      }
      expect(s.points, seed).toBe(MAX);
    }
  });

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
    const dropFlag = (stepId: "privilege-review" | "cite-check" | "exhibit-list", reason: string) => (a: Answers & Record<string, unknown>) => {
      const step = a[stepId] as { flags: Flag[] };
      const before = step.flags.length;
      step.flags = step.flags.filter((f) => f.reason !== reason);
      expect(step.flags.length).toBe(before - 1);
    };
    const reReason = (stepId: "privilege-review" | "cite-check" | "exhibit-list", reason: string, to: string) => (a: Answers & Record<string, unknown>) => {
      const f = (a[stepId] as { flags: Flag[] }).flags.find((x) => x.reason === reason)!;
      f.reason = to;
    };

    const cases: [string, "privilege-review" | "cite-check" | "exhibit-list", string, number][] = [
      ["privileged email produced", "privilege-review", "privileged", 4],
      ["waived privilege still withheld", "privilege-review", "waived", 4],
      ["Bates gap", "privilege-review", "bates_gap", 3],
      ["Bates repeat", "privilege-review", "bates_dup", 3],
      ["fabricated case (not in the research file)", "cite-check", "not_found", 5],
      ["overruled case", "cite-check", "bad_law", 4],
      ["misquoted parenthetical", "cite-check", "quote", 3],
      ["wrong pin cite", "cite-check", "pin", 3],
      ["wrong year", "cite-check", "year", 3],
      ["empty binder tab", "exhibit-list", "missing", 3],
      ["exhibit listed twice", "exhibit-list", "duplicate", 4],
      ["exhibit never produced", "exhibit-list", "not_produced", 4],
      ["wrong deposition date", "exhibit-list", "date", 4],
    ];
    for (const [name, stepId, reason, points] of cases) {
      if (reason === "privileged") continue;
      it(`${name} missed: loses ${points}; spotted with the wrong reason: loses half`, () => {
        for (const seed of seeds) {
          expect(lost(seed, dropFlag(stepId, reason)), `${seed} ${name}`).toBe(points);
          expect(lost(seed, reReason(stepId, reason, "other")), `${seed} ${name} wrong reason`).toBe(points / 2);
        }
      });
    }

    it("privileged email and work-product memo produced: each costs 4", () => {
      for (const seed of seeds) {
        const p = readProduction(screen(seed).doc("privilege-review"));
        for (const type of ["Email", "Memo"]) {
          const id = p.rows.find((r) => r.type === type && r.issue === "privileged")!.id;
          expect(
            lost(seed, (a) => {
              const step = a["privilege-review"] as { flags: Flag[] };
              step.flags = step.flags.filter((f) => f.target !== id);
            }),
            `${seed} ${type}`,
          ).toBe(4);
        }
      }
    });

    it("serving the production as is, or filing the brief as is: each decision costs 2", () => {
      for (const seed of seeds) {
        const sc = screen(seed);
        const serve = oneOption({ options: sc.doc("privilege-review").decision!.options } as Mc, /^Serve the volume today as indexed/);
        const file = oneOption({ options: sc.doc("cite-check").decision!.options } as Mc, /^Everything checks out/);
        expect(lost(seed, (a) => (a["privilege-review"].decision = serve))).toBe(2);
        expect(lost(seed, (a) => (a["cite-check"].decision = file))).toBe(2);
      }
    });

    it("flagging a correctly withheld document or a right authority costs the false-flag penalty", () => {
      for (const seed of seeds) {
        const sc = screen(seed);
        const p = readProduction(sc.doc("privilege-review"));
        const okWithheld = p.rows.find((r) => r.withheld && !r.issue)!;
        expect(lost(seed, (a) => (a["privilege-review"] as { flags: Flag[] }).flags.push({ target: okWithheld.id, reason: "waived", note: "" }))).toBe(1);
        const cc = readCiteCheck(sc.doc("cite-check"), sc.msg("m2").body);
        const good = cc.rows.find((r) => !r.issues.length)!;
        expect(lost(seed, (a) => (a["cite-check"] as { flags: Flag[] }).flags.push({ target: good.id, reason: "not_found", note: "" }))).toBe(1);
      }
    });

    it("inbox: sending opposing counsel's paralegal the emails, or advising the client, costs all 4", () => {
      for (const seed of seeds) {
        const sc = screen(seed);
        const send = oneOption(sc.mc("inbox-opposing"), /^Send what they asked for/);
        const advise = oneOption(sc.mc("inbox-client"), /^Give your honest view/);
        expect(lost(seed, (a) => (a["inbox-opposing"].selected = [send]))).toBe(4);
        expect(lost(seed, (a) => (a["inbox-client"].selected = [advise]))).toBe(4);
      }
    });

    it("filing: one PDF by email to the clerk earns nothing; missing one required step loses its share", () => {
      for (const seed of seeds) {
        const sc = screen(seed);
        const cfg = sc.mc("inbox-filing");
        const right = solveFiling(sc).right;
        expect(lost(seed, (a) => (a["inbox-filing"].selected = [oneOption(cfg, /^Combine/), oneOption(cfg, /^Email the PDF/)]))).toBe(7);
        expect(lost(seed, (a) => (a["inbox-filing"].selected = right.slice(1)))).toBeCloseTo(7 / right.length, 2);
      }
    });
  });
});

describe("litigation-morrow-tidewater: nothing from the key reaches the candidate", () => {
  it("no reviewer note, key word or option-revealing field in any payload", () => {
    for (const seed of SEEDS) {
      const variant = scenario.generate(seed);
      const notes = REVIEW_STEPS.flatMap((id) => Object.values((variant.keys[id] as ReviewKey).findings).map((f) => f.note!));
      for (const n of notes) expect(n.length).toBeGreaterThan(10);
      for (const minute of [0, 20, END]) {
        const payload = JSON.stringify(renderAttemptForCandidate(scenario, seed, minute));
        expect(payload).not.toMatch(/"keys"|tolerance|"criteria"|"guidance"|"notes"|"points"|"expected"|"findings"|"clean":|"correct"/);
        for (const n of notes) expect(payload, seed).not.toContain(n);
      }
    }
  });
});

describe("litigation-morrow-tidewater: timed sections", () => {
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

  it("six sections: deadlines, privilege review, citation format, cite-check, procedure, trial prep and inbox", () => {
    expect(def.sections!.map((s) => [s.id, s.minutes, s.stepIds, !!s.oneAtATime])).toEqual([
      ["s-rapid-a", 6, ["rapid-deadlines"], false],
      ["s-privilege", 11, ["privilege-review"], false],
      ["s-rapid-b", 6, ["rapid-citations"], false],
      ["s-cite-check", 11, ["cite-check"], false],
      ["s-rapid-c", 6, ["rapid-procedure"], false],
      ["s-trial", 12, ["exhibit-list", ...MC_STEPS], true],
    ]);
  });

  it("one-at-a-time screens add up to their section", () => {
    for (const sec of def.sections!.filter((s) => s.oneAtATime)) {
      expect(sec.stepIds.reduce((t, id) => t + stepById(id).seconds!, 0), sec.id).toBe(sec.minutes * 60);
    }
    expect(stepById("exhibit-list").seconds).toBe(360);
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
    expect(at(0).visibleStepIds).toEqual(["rapid-deadlines"]);
    expect(at(6).visibleStepIds).toEqual(["privilege-review"]);
    expect(at(17).visibleStepIds).toEqual(["rapid-citations"]);
    expect(at(23).visibleStepIds).toEqual(["cite-check"]);
    expect(at(34).visibleStepIds).toEqual(["rapid-procedure"]);
    expect(at(40).visibleStepIds).toEqual(["exhibit-list"]);
    expect(at(46.1).visibleStepIds).toEqual(["inbox-filing"]);
    expect(at(END).done).toBe(true);
  });

  it("messages arrive when their section opens", () => {
    expect(def.messages.map((m) => [m.id, m.arriveAtMinute ?? 0, m.stepId])).toEqual([
      ["m1", 0, "privilege-review"],
      ["m2", 0, "cite-check"],
      ["m3", 0, "exhibit-list"],
      ["m4", 0, "inbox-filing"],
      ["m5", 0, "inbox-opposing"],
      ["m6", 0, "inbox-client"],
    ]);
    const msgsAt = (min: number) => visibleMessageIds(def, flowAt(min * MIN), t0, t0 + min * MIN);
    expect(msgsAt(5)).toEqual([]);
    expect(msgsAt(6)).toEqual(["m1"]);
    expect(msgsAt(23)).toEqual(["m1", "m2"]);
    expect(msgsAt(40)).toEqual(["m1", "m2", "m3", "m4", "m5", "m6"]);
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

describe("litigation-morrow-tidewater: rapid rounds", () => {
  it("every item over 200 seeds has one right answer per field, found from the material alone, matching the key", () => {
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
            if (f.kind === "number") expect(k[f.id].value, `${seed} ${s.item.id}`).toBe(s.values[f.id]);
            else expect(k[f.id].choice, `${seed} ${s.item.id} (${s.kind}: ${s.item.prompt})`).toBe(s.values[f.id]);
          }
        }
      }
    }
  });

  it("ten quick items worth half a point and five harder ones worth one, in every round", () => {
    const hardKinds: Record<RapidStepId, string[]> = {
      "rapid-deadlines": ["holiday", "mail"],
      "rapid-citations": ["pin", "wex-court", "wex-ok", "wrong-court"],
      "rapid-procedure": [...PROCEDURE_RULES.filter((r) => r[3] === "hard").map((r) => r[0]), "interrogatories", "depo-time"],
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

  it("deadlines: plain, weekend, holiday and mail-service items all show up, with real holidays", () => {
    const kinds = new Map<string, number>();
    for (const seed of SEEDS.slice(0, 50)) for (const s of solveRapid(seed, "rapid-deadlines")) kinds.set(s.kind, (kinds.get(s.kind) ?? 0) + 1);
    expect([...kinds.keys()].sort()).toEqual(["holiday", "mail", "plain", "weekend"]);
    expect(kinds.get("holiday")).toBe(150);
    expect(kinds.get("mail")).toBe(100);
  });

  it("citation format: every kind of error and correct cites show up", () => {
    const kinds = new Set<string>();
    for (const seed of SEEDS.slice(0, 50)) for (const s of solveRapid(seed, "rapid-citations")) kinds.add(s.kind);
    expect([...kinds].sort()).toEqual(["first-page", "name", "ok", "pin", "reporter", "wex-court", "wex-ok", "wrong-court", "year"]);
  });

  it("procedure: two number items (interrogatory limit, deposition time) in fixed slots every seed", () => {
    for (const seed of SEEDS.slice(0, 50)) {
      const solved = solveRapid(seed, "rapid-procedure");
      expect(solved.filter((s) => typeof s.values.answer === "number").map((s) => s.item.id)).toEqual(["lp-06", "lp-12"]);
      for (const s of solved) if (typeof s.values.answer === "number") expect(s.values.answer).toBeGreaterThanOrEqual(1);
    }
  });

  it("varies per seed: which item comes when and where the right option sits", () => {
    for (const id of RAPID_STEPS) {
      const firsts = SEEDS.slice(0, 60).map((seed) => solveRapid(seed, id)[0]);
      expect(new Set(firsts.map((s) => JSON.stringify(s.item))).size, id).toBeGreaterThan(40);
      expect(new Set(firsts.map((s) => JSON.stringify(s.values))).size, id).toBeGreaterThanOrEqual(3);
    }
  });

  it("option ids are fixed per item, so an id can't hint at the answer", () => {
    for (const id of RAPID_STEPS) {
      const ids = (seed: string) => rapidItems(seed, id).map((i) => i.fields.map((f) => [f.id, f.kind ?? "choice", (f as RapidChoiceField).options?.map((o) => o.id)]));
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
