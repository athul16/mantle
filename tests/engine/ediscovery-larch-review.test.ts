import { describe, expect, it, vi } from "vitest";
import type { RapidChoiceField, RapidItem } from "@/lib/engine/step-types/rapid_round/public";

vi.mock("server-only", () => ({}));

const { ediscoveryLarchReview } = await import("@/lib/engine/scenarios/ediscovery-larch-review");
const { getScenario, listScenarios } = await import("@/lib/engine/scenarios");
const { renderAttemptForCandidate, renderFlowForCandidate } = await import("@/lib/engine/server/render");
const { scoreAttempt } = await import("@/lib/engine/server/score");
const { resolveFlow, visibleMessageIds, validateSections } = await import("@/lib/engine/server/flow");
const { rapidRoundServer } = await import("@/lib/engine/step-types/rapid_round/server");
const { fillTemplate, templateValues } = await import("@/lib/engine/server/template");

/**
 * Project Larch: an eDiscovery document reviewer's day in six timed sections.
 * A per-seed review protocol (the first inbox message) drives every coding
 * answer. These tests read the protocol and the material the way a reviewer
 * would, solve every task from it, and compare with the server key, so the
 * material and the key can't drift apart.
 */

const scenario = ediscoveryLarchReview;
const SEEDS = Array.from({ length: 200 }, (_, i) => `attempt-${i.toString(16).padStart(4, "0")}`);
const END = scenario.timeLimitMinutes;
const RAPID_STEPS = ["rapid-1", "rapid-2", "rapid-3"] as const;
type RapidStepId = (typeof RAPID_STEPS)[number];
const MC_STEPS = ["search-terms", "hot-doc", "foreign-doc", "partial-priv"] as const;
const MAX = 100;

// ---- What a reviewer knows: the issue topics and how to recognise them ----

/** Every possible issue: its tag label in the protocol, and words that show a document is about it. */
const TOPICS: Record<string, { label: string; re: RegExp }> = {
  quality: { label: "Resin quality and off-spec batches", re: /off-spec|batch|contaminat|viscosity/i },
  pricing: { label: "Pricing and the raw-material surcharge", re: /surcharge|\bpric(e|es|ing)\b|rebate/i },
  termination: { label: "Supply agreement termination", re: /terminat|renew/i },
  delivery: { label: "Late deliveries and freight", re: /deliver|freight|shipment|carrier/i },
  inspection: { label: "Plant inspection", re: /inspect/i },
  insurance: { label: "Insurance coverage", re: /insur|coverage|underwriter/i },
};
const ADVICE = /\badvi[cs]e\b/i;
const WORK_PRODUCT = /^Prepared at the request of .+ for the Brightwater litigation/;
const HOT = /\bdelete\b|knew .*off-spec/i;
const LAW_ORGS = ["Hale & Corwin LLP", "Larchmont Legal"];
const OUR_ORGS = ["Larchmont", ...LAW_ORGS];

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "Mar 4, 2024" as a UTC day number. */
const day = (s: string) => {
  const m = s.trim().match(/^([A-Z][a-z]{2}) (\d{1,2}), (\d{4})$/);
  expect(m, `date "${s}"`).not.toBeNull();
  return Date.UTC(Number(m![3]), MONTHS.indexOf(m![1]), Number(m![2])) / 86_400_000;
};

type Person = { name: string; org: string };
/** "Dana Marsh (Larchmont); Ruth Abara (Hale & Corwin LLP)", or "—". */
const people = (s: string): Person[] =>
  s.trim() === "—"
    ? []
    : s.split("; ").map((p) => {
        const m = p.match(/^(.+?)\*? \((.+)\)$/);
        expect(m, `person "${p}"`).not.toBeNull();
        return { name: m![1], org: m![2] };
      });

// ---- The protocol ----

type Protocol = {
  start: number;
  end: number;
  startText: string;
  endText: string;
  lawyers: string[];
  tags: { label: string; topic: string }[];
  manager: string;
  queue: string;
  custodians: string[];
};

function readProtocol(body: string): Protocol {
  const period = body.match(/Review period: ([A-Z][a-z]{2} \d{1,2}, \d{4}) to ([A-Z][a-z]{2} \d{1,2}, \d{4}), both days included/);
  expect(period, "review period").not.toBeNull();
  const lawyers = body.match(/Larchmont's lawyers: (.+) and (.+) \(Hale & Corwin LLP, outside counsel\) and (.+) \(Associate General Counsel, Larchmont Legal\)/);
  expect(lawyers, "lawyers").not.toBeNull();
  const tags = body
    .split("\n")
    .filter((l) => l.startsWith("• "))
    .map((l) => {
      const label = l.slice(2).split(":")[0];
      const topic = Object.entries(TOPICS).find(([, t]) => t.label === label)?.[0];
      expect(topic, `tag ${label}`).toBeDefined();
      return { label, topic: topic! };
    });
  const manager = body.match(/Code it Hot and email (.+?), the review manager, the doc ID at once/);
  expect(manager, "manager").not.toBeNull();
  const queue = body.match(/route them to the (.+?) queue/);
  expect(queue, "queue").not.toBeNull();
  const cust = body.match(/Key custodians: (.+)\./);
  expect(cust, "custodians").not.toBeNull();
  return {
    start: day(period![1]),
    end: day(period![2]),
    startText: period![1],
    endText: period![2],
    lawyers: [lawyers![1], lawyers![2], lawyers![3]],
    tags,
    manager: manager![1],
    queue: queue![1],
    custodians: cust![1].split(", ").map((c) => c.replace(/ \(.+\)$/, "")),
  };
}

/** One document as a reviewer sees it (rapid item or QC row). */
type Doc = { date: string; from: Person[]; to: Person[]; cc: Person[]; subject: string; text: string };

type Coding = { responsive: boolean; privileged: boolean; topic: string | null; hot: boolean; why: string };

/** The protocol applied to one document. `topic` is the issue tag's topic, null for "No tag". */
function code(doc: Doc, p: Protocol): Coding {
  const words = `${doc.subject}\n${doc.text}`;
  const topics = Object.entries(TOPICS)
    .filter(([, t]) => t.re.test(words))
    .map(([id]) => id);
  expect(topics.length, `one topic at most: "${words}" (${topics})`).toBeLessThanOrEqual(1);
  const topic = topics[0] ?? null;
  const d = day(doc.date);
  const inPeriod = d >= p.start && d <= p.end;
  const isIssue = !!topic && p.tags.some((t) => t.topic === topic);
  const all = [...doc.from, ...doc.to, ...doc.cc];
  const third = all.some((x) => !OUR_ORGS.includes(x.org));
  const lawyerOn = all.some((x) => LAW_ORGS.includes(x.org));
  for (const x of all.filter((y) => LAW_ORGS.includes(y.org))) expect(p.lawyers, `${x.name} is a listed lawyer`).toContain(x.name);
  const wp = WORK_PRODUCT.test(doc.text);
  const privileged = !third && (wp || (lawyerOn && ADVICE.test(words)));
  const responsive = inPeriod && isIssue;
  const why = !inPeriod ? "outside" : !isIssue ? "not_issue" : d === p.start || d === p.end ? "boundary" : "in";
  return { responsive, privileged, topic: responsive ? topic : null, hot: HOT.test(words), why };
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
  const protocol = readProtocol(msg("m1").body);
  return { view, step, msg, protocol };
}

// ---- Rapid rounds ----

const rapidConfig = (stepId: RapidStepId) => rapidRoundServer.configSchema.parse(scenario.definition.steps.find((s) => s.id === stepId)!.config);

function rapidItems(seed: string, stepId: RapidStepId): RapidItem[] {
  const variant = scenario.generate(seed);
  const values = templateValues(variant.values);
  const fill = (t: string) => fillTemplate(t, values);
  const config = rapidConfig(stepId);
  const seq = rapidRoundServer.sequence!;
  return Array.from({ length: seq.count(config) }, (_, i) => seq.renderItem(config, { variant, fill }, i) as RapidItem);
}

const choiceField = (item: RapidItem, id: string) => {
  const f = item.fields.find((x) => x.id === id) as RapidChoiceField | undefined;
  expect(f, `${item.id} field ${id}`).toBeDefined();
  return f!;
};
const optionId = (item: RapidItem, fieldId: string, label: string) => {
  const opts = choiceField(item, fieldId).options.filter((o) => o.label === label);
  expect(opts.length, `${item.id} ${fieldId}: one option "${label}"`).toBe(1);
  return opts[0].id;
};
const row = (item: RapidItem, label: string) => {
  const r = item.exhibit?.rows?.find((x) => x.label === label);
  expect(r, `${item.id} row ${label}`).toBeDefined();
  return r!.value;
};

const itemDoc = (item: RapidItem): Doc => ({
  date: row(item, "Date"),
  from: people(row(item, "From")),
  to: people(row(item, "To")),
  cc: people(row(item, "Cc")),
  subject: row(item, "Subject"),
  text: item.prompt,
});

/** The kind of item, as the reviewer would describe it. Hard kinds are the traps. */
function kindOf(doc: Doc, c: Coding): string {
  const all = [...doc.from, ...doc.to, ...doc.cc];
  const third = all.some((x) => !OUR_ORGS.includes(x.org));
  const lawyerCc = doc.cc.some((x) => LAW_ORGS.includes(x.org));
  if (c.why === "outside") return "out_of_range";
  if (c.why === "boundary") return "boundary";
  if (c.why === "not_issue") return "not_responsive";
  if (WORK_PRODUCT.test(doc.text)) return "work_product";
  if (third && ADVICE.test(`${doc.subject}\n${doc.text}`)) return "waived";
  if (lawyerCc && !c.privileged) return "cc_lawyer";
  return c.privileged ? "privileged" : "responsive";
}
const HARD_KINDS = ["boundary", "cc_lawyer", "out_of_range", "waived", "work_product"];

type Solved = { item: RapidItem; values: Record<string, string>; kind: string; coding: Coding };

function solveRapid(seed: string, stepId: RapidStepId, p = screen(seed).protocol): Solved[] {
  return rapidItems(seed, stepId).map((item) => {
    const doc = itemDoc(item);
    const coding = code(doc, p);
    expect(coding.hot, `${item.id} rapid items are never hot`).toBe(false);
    const tag = coding.topic ? p.tags.find((t) => t.topic === coding.topic)!.label : "No tag";
    return {
      item,
      coding,
      kind: kindOf(doc, coding),
      values: {
        responsive: optionId(item, "responsive", coding.responsive ? "Responsive" : "Not responsive"),
        privileged: optionId(item, "privileged", coding.privileged ? "Privileged" : "Not privileged"),
        tag: optionId(item, "tag", tag),
      },
    };
  });
}

function rapidAnswers(seed: string) {
  const p = screen(seed).protocol;
  return Object.fromEntries(
    RAPID_STEPS.map((id) => [id, { items: Object.fromEntries(solveRapid(seed, id, p).map((s) => [s.item.id, { values: s.values, ms: 9_000 }])) }]),
  ) as Record<RapidStepId, { items: Record<string, { values: Record<string, string>; ms: number }> }>;
}

// ---- Document reviews ----

type ReviewConfig = {
  prompt: string;
  document: { title: string; fields: { id: string; label: string; value: string }[]; columns: string[]; rows: { id: string; cells: string[] }[]; footnote?: string };
  reasons: { id: string; label: string }[];
};
type ReviewKey = { findings: Record<string, { targets: string[]; reasons: string[]; note?: string }> };
type Flag = { target: string; reason: string; note: string };

/** QC: each row recoded under the protocol, and the teammate's miscodes with the reason. */
function solveQc(seed: string) {
  const { step, protocol: p } = screen(seed);
  const cfg = step("qc-review").config as ReviewConfig;
  const cols = cfg.document.columns;
  const col = (name: string) => {
    const i = cols.indexOf(name);
    expect(i, `column ${name}`).toBeGreaterThanOrEqual(0);
    return i;
  };
  const rows = cfg.document.rows.map((r) => {
    const cell = (name: string) => r.cells[col(name)];
    const doc: Doc = { date: cell("Date"), from: people(cell("From")), to: people(cell("To")), cc: people(cell("Cc")), subject: cell("Subject"), text: cell("Text") };
    const right = code(doc, p);
    const given = {
      responsive: cell("Responsive") === "Yes",
      privileged: cell("Privileged") === "Yes",
      tag: cell("Issue tag"),
      hot: cell("Hot") === "Yes",
    };
    for (const name of ["Responsive", "Privileged", "Hot"]) expect(["Yes", "No"]).toContain(cell(name));
    const rightTag = right.topic ? p.tags.find((t) => t.topic === right.topic)!.label : "No tag";
    expect([...p.tags.map((t) => t.label), "No tag"]).toContain(given.tag);
    let reason: string | null = null;
    if (given.responsive !== right.responsive) reason = right.why === "outside" ? "outside" : right.why === "not_issue" ? "not_issue" : "responsive";
    else if (given.privileged !== right.privileged) reason = "privilege";
    else if (given.tag !== rightTag) reason = "tag";
    else if (given.hot !== right.hot) reason = "hot";
    return { id: r.id, doc, right, given, reason, kind: kindOf(doc, right) };
  });
  return { cfg, rows, miscoded: rows.filter((r) => r.reason) };
}

type LogRow = { id: string; author: Person[]; recipients: Person[]; basis: string; description: string; authorText: string; recipientsText: string };

/** Privilege log: each entry checked against the protocol's logging rules. */
function solveLog(seed: string) {
  const { step } = screen(seed);
  const cfg = step("priv-log").config as ReviewConfig;
  const cols = cfg.document.columns;
  const idx = (name: string) => cols.indexOf(name);
  const rows: (LogRow & { issue: string | null })[] = cfg.document.rows.map((r) => {
    const x: LogRow = {
      id: r.id,
      authorText: r.cells[idx("Author")],
      recipientsText: r.cells[idx("Recipients")],
      author: people(r.cells[idx("Author")]),
      recipients: people(r.cells[idx("Recipients")]),
      basis: r.cells[idx("Basis")],
      description: r.cells[idx("Description")],
    };
    expect(["Attorney-client", "Work product"]).toContain(x.basis);
    const all = [...x.author, ...x.recipients];
    const lawyer = `${x.authorText} ${x.recipientsText}`.includes("*");
    const issues: string[] = [];
    if (!x.author.length || !x.recipients.length) issues.push("incomplete");
    if (/^(Email|Correspondence|Document)\.$|legal matters/.test(x.description)) issues.push("vague");
    if (/advising that/.test(x.description)) issues.push("reveals");
    if (all.length && !lawyer && x.basis === "Attorney-client") issues.push("basis");
    if (all.some((p) => !OUR_ORGS.includes(p.org))) issues.push("waived");
    expect(issues.length, `${seed} ${r.id} one issue at most (${issues})`).toBeLessThanOrEqual(1);
    return { ...x, issue: issues[0] ?? null };
  });
  return { cfg, rows, flawed: rows.filter((r) => r.issue) };
}

// ---- Multiple choice and the estimate ----

type McConfig = { prompt: string; options: { id: string; label: string }[]; select: string };
const mc = (seed: string, id: string) => screen(seed).step(id).config as McConfig;
const mcPick = (cfg: McConfig, test: (label: string) => boolean, what: string) => {
  const opts = cfg.options.filter((o) => test(o.label));
  expect(opts.length, what).toBe(1);
  return opts[0].id;
};

function solveSearch(seed: string) {
  const cfg = mc(seed, "search-terms");
  const total = Number(cfg.prompt.match(/; (\d+) of them are relevant/)![1]);
  const opts = cfg.options.map((o) => {
    const m = o.label.match(/: ([\d,]+) hits, (\d+) of (\d+) relevant$/);
    expect(m, o.label).not.toBeNull();
    expect(Number(m![3])).toBe(total);
    return { id: o.id, hits: Number(m![1].replace(/,/g, "")), relevant: Number(m![2]) };
  });
  const full = opts.filter((o) => o.relevant === total);
  expect(full.length, `${seed} two strings find every relevant document`).toBe(2);
  const best = full.reduce((a, b) => (b.hits < a.hits ? b : a));
  expect(Math.min(...opts.map((o) => o.hits)), `${seed} the fewest hits overall miss relevant documents`).toBeLessThan(best.hits);
  return best.id;
}

type Cell = { kind: "text"; text: string } | { kind: "input"; id: string } | { kind: "empty" };
function solveEstimate(seed: string) {
  const sheet = screen(seed).step("review-estimate").config as { prompt: string; rows: Cell[][] };
  const value = (label: RegExp) => {
    const r = sheet.rows.find((x) => x[0]?.kind === "text" && label.test(x[0].text));
    expect(r, `row ${label}`).toBeDefined();
    const c = r![1];
    expect(c.kind).toBe("text");
    return Number((c as { text: string }).text.replace(/,/g, ""));
  };
  const sample = value(/^Validation sample/);
  const hits = value(/^Hits in the sample/);
  const collection = value(/^Full collection/);
  const rate = value(/^Review rate/);
  const docs = Math.round((hits / sample) * collection);
  return { sample, hits, collection, rate, docs, hours: Math.round((docs / rate) * 10) / 10 };
}

function solveHot(seed: string) {
  const { protocol } = screen(seed);
  const cfg = mc(seed, "hot-doc");
  expect(cfg.prompt).toMatch(HOT);
  return mcPick(cfg, (l) => l.startsWith("Code it Hot") && l.includes(protocol.manager), `${seed} hot: escalate to the manager`);
}

function solveForeign(seed: string) {
  const { protocol } = screen(seed);
  const cfg = mc(seed, "foreign-doc");
  return mcPick(cfg, (l) => l.includes(`${protocol.queue} queue`), `${seed} foreign: the protocol's queue`);
}

/** Partial privilege: read the chain, message by message. */
function solvePartial(seed: string) {
  const cfg = mc(seed, "partial-priv");
  const blocks = cfg.prompt.split(/\n(?=Message \d · )/).slice(1);
  expect(blocks.length, seed).toBe(2);
  const msgs = blocks.map((b) => {
    const from = people(b.match(/\nFrom: (.+)/)![1]);
    const to = people(b.match(/\nTo: (.+)/)![1]);
    const text = b.match(/\n"(.+)"/)![1];
    const all = [...from, ...to];
    return { third: all.some((x) => !OUR_ORGS.includes(x.org)), priv: all.some((x) => LAW_ORGS.includes(x.org)) && ADVICE.test(text) && !all.some((x) => !OUR_ORGS.includes(x.org)) };
  });
  const kase = msgs.some((m) => m.third) ? "produce" : msgs.every((m) => m.priv) ? "withhold" : "redact";
  const label = { produce: /^Produce it in full/, withhold: /^Withhold the whole document/, redact: /^Produce it with the privileged message redacted/ }[kase];
  return { kase, id: mcPick(cfg, (l) => label.test(l), `${seed} partial ${kase}`) };
}

/** A strong candidate's answers, built only from the screen. */
function perfectAnswers(seed: string) {
  const qc = solveQc(seed);
  const log = solveLog(seed);
  const est = solveEstimate(seed);
  return {
    ...rapidAnswers(seed),
    "qc-review": { flags: qc.miscoded.map((r) => ({ target: r.id, reason: r.reason!, note: "" })), decision: null },
    "search-terms": { selected: [solveSearch(seed)] },
    "review-estimate": { cells: { est_docs: est.docs, est_hours: est.hours } },
    "priv-log": { flags: log.flawed.map((r) => ({ target: r.id, reason: r.issue!, note: "" })), decision: null },
    "hot-doc": { selected: [solveHot(seed)] },
    "foreign-doc": { selected: [solveForeign(seed)] },
    "partial-priv": { selected: [solvePartial(seed).id] },
  };
}
type Answers = ReturnType<typeof perfectAnswers>;
const clone = (a: Answers): Answers => JSON.parse(JSON.stringify(a));

describe("ediscovery-larch-review: setup", () => {
  it("is registered, version 1, legal, 50 minutes, and uses only built step types in section order", () => {
    expect(getScenario("ediscovery-larch-review", 1)).toBe(scenario);
    expect(listScenarios()).toContain(scenario);
    expect(scenario.version).toBe(1);
    expect(scenario.title).toBe("Project Larch review batch");
    expect(scenario.timeLimitMinutes).toBe(50);
    expect(scenario.roleFamily).toBe("legal");
    expect(scenario.definition.steps.map((s) => [s.id, s.type])).toEqual([
      ["qc-review", "document_review"],
      ["rapid-1", "rapid_round"],
      ["search-terms", "multiple_choice"],
      ["review-estimate", "spreadsheet"],
      ["priv-log", "document_review"],
      ["rapid-2", "rapid_round"],
      ["hot-doc", "multiple_choice"],
      ["foreign-doc", "multiple_choice"],
      ["partial-priv", "multiple_choice"],
      ["rapid-3", "rapid_round"],
    ]);
    expect(scenario.definition.intro).toMatch(/Project Larch/);
    expect(scenario.definition.intro).toMatch(/Hale & Corwin LLP/);
    expect(scenario.definition.intro).toMatch(/District of Wexford/);
  });

  it("renders for 200 seeds with no unfilled template, and every rapid item renders", () => {
    for (const seed of SEEDS) {
      for (const minute of [0, END]) expect(JSON.stringify(renderAttemptForCandidate(scenario, seed, minute))).not.toContain("{{");
      for (const id of RAPID_STEPS) expect(JSON.stringify(rapidItems(seed, id))).not.toContain("{{");
    }
  });

  it("is deterministic per seed", () => {
    for (const seed of SEEDS.slice(0, 20)) {
      expect(scenario.generate(seed)).toEqual(scenario.generate(seed));
      expect(renderAttemptForCandidate(scenario, seed, END)).toEqual(renderAttemptForCandidate(scenario, seed, END));
    }
  });

  it("different seeds change the protocol: period, lawyers, tags, manager, queue and custodians", () => {
    expect(new Set(SEEDS.map((s) => JSON.stringify(scenario.generate(s).values))).size).toBe(SEEDS.length);
    const ps = SEEDS.slice(0, 60).map((s) => screen(s).protocol);
    expect(new Set(ps.map((p) => p.startText)).size).toBeGreaterThan(40);
    expect(new Set(ps.map((p) => p.endText)).size).toBeGreaterThan(40);
    expect(new Set(ps.map((p) => p.lawyers.join())).size).toBeGreaterThan(50);
    expect(new Set(ps.map((p) => p.tags.map((t) => t.topic).sort().join())).size).toBeGreaterThanOrEqual(8);
    expect(new Set(ps.map((p) => p.manager)).size).toBeGreaterThan(5);
    expect(new Set(ps.map((p) => p.queue)).size).toBeGreaterThan(1);
    expect(new Set(ps.map((p) => p.custodians.join())).size).toBeGreaterThan(50);
  });
});

describe("ediscovery-larch-review: the protocol", () => {
  it("is the first message, there from the start, and lists every rule the tasks use", () => {
    for (const seed of SEEDS) {
      const view = renderAttemptForCandidate(scenario, seed, 0);
      expect(view.messages.map((m) => m.id)).toContain("m1");
      const { protocol: p, msg } = screen(seed);
      const body = msg("m1").body;
      expect(p.end - p.start, seed).toBeGreaterThan(300);
      expect(p.tags.length).toBe(4);
      expect(p.tags.map((t) => t.topic)).toContain("quality");
      expect(new Set(p.tags.map((t) => t.topic)).size).toBe(4);
      expect(new Set(p.lawyers).size).toBe(3);
      expect(p.custodians.length).toBe(4);
      for (const rule of [/Not responsive/, /work product/i, /only copy a lawyer/, /No tag/, /Hot/, /Foreign language/, /fewest hits/, /without revealing the advice/, /redacted/])
        expect(body, `${seed} ${rule}`).toMatch(rule);
      expect(body).toMatch(/District of Wexford/);
    }
  });
});

describe("ediscovery-larch-review: rapid coding rounds", () => {
  it("every item over 200 seeds: one right option per field, in its options, solved from the protocol and the item alone", () => {
    for (const seed of SEEDS) {
      const keys = scenario.generate(seed).keys;
      const p = screen(seed).protocol;
      for (const id of RAPID_STEPS) {
        const key = keys[id] as { items: Record<string, Record<string, { choice: string }>> };
        const solved = solveRapid(seed, id, p);
        expect(Object.keys(key.items).sort()).toEqual(solved.map((s) => s.item.id).sort());
        for (const s of solved) {
          const k = key.items[s.item.id];
          expect(Object.keys(k).sort()).toEqual(["privileged", "responsive", "tag"]);
          for (const f of s.item.fields) {
            expect((f as RapidChoiceField).options.filter((o) => o.id === k[f.id].choice).length).toBe(1);
            expect(k[f.id].choice, `${seed} ${s.item.id}.${f.id} (${s.kind}: ${s.item.prompt})`).toBe(s.values[f.id]);
          }
        }
      }
    }
  });

  it("ten quick items worth 0.75 and five traps worth 1.5 in every round: each trap kind once, in the hard slots", () => {
    for (const id of RAPID_STEPS) {
      const points = rapidConfig(id).items.map((i) => i.points);
      expect(points.filter((x) => x === 0.75).length, id).toBe(10);
      expect(points.filter((x) => x === 1.5).length, id).toBe(5);
      expect(points.reduce((t, x) => t + x, 0)).toBe(15);
    }
    for (const seed of SEEDS.slice(0, 60)) {
      const p = screen(seed).protocol;
      for (const id of RAPID_STEPS) {
        const solved = solveRapid(seed, id, p);
        const points = rapidConfig(id).items.map((i) => i.points);
        const hard = solved.filter((_, i) => points[i] === 1.5).map((s) => s.kind);
        expect(hard.sort(), `${seed} ${id}`).toEqual(HARD_KINDS);
        const easy = solved.filter((_, i) => points[i] === 0.75).map((s) => s.kind);
        expect(easy.filter((k) => k === "responsive").length, `${seed} ${id}`).toBe(4);
        expect(easy.filter((k) => k === "not_responsive").length).toBe(3);
        expect(easy.filter((k) => k === "privileged").length).toBe(3);
      }
    }
  });

  it("dates sit where the kind says: traps a few days outside the period or on its first or last day", () => {
    for (const seed of SEEDS.slice(0, 60)) {
      const p = screen(seed).protocol;
      for (const id of RAPID_STEPS) {
        for (const s of solveRapid(seed, id, p)) {
          const d = day(row(s.item, "Date"));
          if (s.kind === "out_of_range") expect(Math.min(Math.abs(d - p.start), Math.abs(d - p.end)), seed).toBeLessThanOrEqual(30);
          if (s.kind === "boundary") expect([p.start, p.end]).toContain(d);
        }
      }
    }
  });

  it("non-responsive items include documents on topics that aren't issues this time, as well as office chatter", () => {
    const seen = new Set<string>();
    for (const seed of SEEDS.slice(0, 40)) {
      const p = screen(seed).protocol;
      for (const id of RAPID_STEPS) {
        for (const s of solveRapid(seed, id, p).filter((x) => x.kind === "not_responsive")) {
          const words = `${row(s.item, "Subject")} ${s.item.prompt}`;
          seen.add(Object.values(TOPICS).some((t) => t.re.test(words)) ? "other-topic" : "chatter");
        }
      }
    }
    expect([...seen].sort()).toEqual(["chatter", "other-topic"]);
  });

  it("option ids are fixed per item, so an id can't hint at the answer; tag labels follow the protocol", () => {
    for (const id of RAPID_STEPS) {
      const ids = (seed: string) => rapidItems(seed, id).map((i) => i.fields.map((f) => [f.id, (f as RapidChoiceField).options.map((o) => o.id)]));
      const first = JSON.stringify(ids(SEEDS[0]));
      for (const seed of SEEDS.slice(1, 30)) expect(JSON.stringify(ids(seed)), `${id} ${seed}`).toBe(first);
    }
    for (const seed of SEEDS.slice(0, 20)) {
      const p = screen(seed).protocol;
      const labels = choiceField(rapidItems(seed, "rapid-1")[0], "tag").options.map((o) => o.label);
      expect(labels).toEqual([...p.tags.map((t) => t.label), "No tag"]);
    }
  });

  it("varies per seed: documents, kinds and answers", () => {
    for (const id of RAPID_STEPS) {
      const firsts = SEEDS.slice(0, 60).map((seed) => solveRapid(seed, id)[0]);
      expect(new Set(firsts.map((s) => JSON.stringify(s.item))).size, id).toBe(60);
      expect(new Set(firsts.map((s) => s.kind)).size, id).toBeGreaterThanOrEqual(2);
      expect(new Set(firsts.map((s) => JSON.stringify(s.values))).size, id).toBeGreaterThanOrEqual(3);
    }
  });

  it("is deterministic per seed, and the flow renders each item exactly as sequence.renderItem does", () => {
    for (const seed of SEEDS.slice(0, 10)) for (const id of RAPID_STEPS) expect(rapidItems(seed, id)).toEqual(rapidItems(seed, id));
    for (const id of RAPID_STEPS) {
      const items = rapidItems("abc", id);
      for (const index of [0, 7, 14]) {
        const view = renderFlowForCandidate(scenario, "abc", { stepIds: [id], messages: [], sequences: { [id]: { index, count: 15, endsAt: "2026-11-16T09:00:20.000Z" } } });
        const cfg = view.steps[0].config as { itemCount: number; current: { item: RapidItem } };
        expect(cfg.itemCount).toBe(15);
        expect(cfg.current.item).toEqual(items[index]);
        expect(JSON.stringify(cfg)).not.toMatch(/"items"|choice"|tolerance|points/);
      }
    }
  });

  it("no rendered rapid item holds a key string, and items carry only id, prompt, exhibit and fields", () => {
    for (const seed of SEEDS.slice(0, 50)) {
      const variant = scenario.generate(seed);
      for (const id of RAPID_STEPS) {
        for (const item of rapidItems(seed, id)) {
          const json = JSON.stringify(item);
          expect(json).not.toMatch(/choice"|tolerance|points/);
          for (const k of Object.keys(item)) expect(["id", "prompt", "exhibit", "fields"]).toContain(k);
          for (const [fieldId, k] of Object.entries((variant.keys[id] as { items: Record<string, Record<string, object>> }).items[item.id])) {
            expect(Object.keys(k)).toEqual(["choice"]);
            expect(choiceField(item, fieldId)).toBeDefined();
          }
        }
      }
    }
  });
});

describe("ediscovery-larch-review: QC review", () => {
  it("20 coded documents with exactly six miscodes, one of each kind; the rest are right, traps included", () => {
    for (const seed of SEEDS) {
      const qc = solveQc(seed);
      expect(qc.rows.length, seed).toBe(20);
      expect(qc.miscoded.map((r) => r.reason).sort(), seed).toEqual(["hot", "not_issue", "outside", "privilege", "privilege", "tag"]);
      // One privilege miscode is a waiver (third party, coded privileged), the other a missed privileged email.
      const priv = qc.miscoded.filter((r) => r.reason === "privilege");
      expect(priv.map((r) => r.given.privileged).sort()).toEqual([false, true]);
      expect(priv.find((r) => r.given.privileged)!.kind).toBe("waived");
      // Correctly coded decoys that look like problems.
      const ok = qc.rows.filter((r) => !r.reason);
      for (const kind of ["boundary", "cc_lawyer", "work_product", "waived", "out_of_range"]) expect(ok.map((r) => r.kind), `${seed} ${kind}`).toContain(kind);
      expect(ok.filter((r) => r.right.hot).length, `${seed} a hot doc coded Hot`).toBe(1);
      expect(qc.rows.filter((r) => r.right.hot).length).toBe(2);
      expect(new Set(qc.rows.map((r) => r.doc.subject + r.doc.text)).size).toBe(20);
    }
  });

  it("the key matches the miscodes found from the screen", () => {
    for (const seed of SEEDS) {
      const qc = solveQc(seed);
      const key = scenario.generate(seed).keys["qc-review"] as ReviewKey;
      const found = Object.values(key.findings).map((f) => [f.targets.join(), f.reasons.join()]);
      expect(found.sort(), seed).toEqual(qc.miscoded.map((r) => [r.id, r.reason!]).sort());
    }
  });

  it("varies which rows hold the miscodes", () => {
    const at = new Set(SEEDS.slice(0, 60).map((s) => solveQc(s).miscoded.find((r) => r.reason === "hot")!.id));
    expect(at.size).toBeGreaterThan(8);
  });
});

describe("ediscovery-larch-review: search terms, estimate and privilege log", () => {
  it("search terms: exactly one string finds every relevant document with the fewest hits; the key agrees", () => {
    const right = new Set<string>();
    for (const seed of SEEDS) {
      const id = solveSearch(seed);
      right.add(id);
      expect((scenario.generate(seed).keys["search-terms"] as { correct: string[] }).correct, seed).toEqual([id]);
    }
    expect(right.size).toBe(4);
  });

  it("review estimate: the key is the sample hit rate projected onto the collection, and hours at the review rate", () => {
    for (const seed of SEEDS) {
      const est = solveEstimate(seed);
      const key = (scenario.generate(seed).keys["review-estimate"] as { cells: Record<string, { value: number; tolerance?: number }> }).cells;
      expect(Object.keys(key).sort()).toEqual(["est_docs", "est_hours"]);
      expect(key.est_docs.value, seed).toBe(est.docs);
      expect(Math.abs(key.est_hours.value - est.hours), seed).toBeLessThanOrEqual(0.05);
      expect(Number.isInteger(est.docs)).toBe(true);
      expect(est.docs).toBeGreaterThan(est.hits);
    }
  });

  it("privilege log: eight entries, five flawed (one of each kind), three right; the key agrees", () => {
    for (const seed of SEEDS) {
      const log = solveLog(seed);
      expect(log.rows.length, seed).toBe(8);
      expect(log.flawed.map((r) => r.issue).sort(), seed).toEqual(["basis", "incomplete", "reveals", "vague", "waived"]);
      const clean = log.rows.filter((r) => !r.issue);
      expect(clean.map((r) => r.basis).sort()).toEqual(["Attorney-client", "Attorney-client", "Work product"]);
      // The work-product entry has no lawyer as author, so "no lawyer" alone isn't a flaw.
      expect(clean.find((r) => r.basis === "Work product")!.authorText).not.toContain("*");
      const key = scenario.generate(seed).keys["priv-log"] as ReviewKey;
      const found = Object.entries(key.findings).map(([, f]) => [f.targets.join(), f.reasons.join()]);
      expect(found.sort()).toEqual(log.flawed.map((r) => [r.id, r.issue!]).sort());
      expect(log.cfg.document.footnote).toMatch(/\* .*lawyer/i);
    }
  });
});

describe("ediscovery-larch-review: review inbox", () => {
  it("hot doc: escalate to the protocol's review manager; foreign language: the protocol's queue; keys agree", () => {
    const hot = new Set<string>();
    for (const seed of SEEDS) {
      const keys = scenario.generate(seed).keys;
      const h = solveHot(seed);
      hot.add(h);
      expect((keys["hot-doc"] as { correct: string[] }).correct, seed).toEqual([h]);
      expect((keys["foreign-doc"] as { correct: string[] }).correct, seed).toEqual([solveForeign(seed)]);
    }
    expect(hot.size).toBe(4);
  });

  it("partial privilege: redact, withhold and produce all come up, and the key follows the chain", () => {
    const cases = new Set<string>();
    for (const seed of SEEDS) {
      const { kase, id } = solvePartial(seed);
      cases.add(kase);
      expect((scenario.generate(seed).keys["partial-priv"] as { correct: string[] }).correct, seed).toEqual([id]);
    }
    expect([...cases].sort()).toEqual(["produce", "redact", "withhold"]);
  });

  it("every multiple choice is single select", () => {
    for (const id of MC_STEPS) expect(mc("abc", id).select, id).toBe("single");
  });
});

describe("ediscovery-larch-review: scoring", () => {
  it("out of 100: three rounds of 15, QC 18, search 4, estimate 4, privilege log 15, inbox 14", () => {
    const blank = scoreAttempt(scenario, "abc", {});
    expect(blank.points).toBe(0);
    expect(blank.maxPoints).toBe(MAX);
    const max = (id: string) => blank.steps[id].maxPoints;
    expect(RAPID_STEPS.map(max)).toEqual([15, 15, 15]);
    expect(max("qc-review")).toBe(18);
    expect([max("search-terms"), max("review-estimate"), max("priv-log")]).toEqual([4, 4, 15]);
    expect([max("hot-doc"), max("foreign-doc"), max("partial-priv")]).toEqual([5, 4, 5]);
  });

  it("blank scores 0 and a perfect answer scores 100, for every seed, with nothing left for a reviewer", () => {
    for (const seed of SEEDS) {
      expect(scoreAttempt(scenario, seed, {}).points).toBe(0);
      const s = scoreAttempt(scenario, seed, perfectAnswers(seed));
      for (const [id, st] of Object.entries(s.steps)) {
        expect(st.points, `${seed} ${id}`).toBe(st.maxPoints);
        expect(st.needsReview).toBeFalsy();
      }
      expect(s.points, seed).toBe(MAX);
    }
  });

  it("another seed's perfect answer doesn't score well (answers can't be shared)", () => {
    let shared = 0;
    for (let i = 0; i < 20; i++) shared += scoreAttempt(scenario, SEEDS[i + 1], perfectAnswers(SEEDS[i])).points;
    expect(shared / 20).toBeLessThan(45);
  });

  describe("each trap answered wrongly costs exactly its points", () => {
    const seeds = SEEDS.slice(0, 40);
    const lost = (seed: string, mutate: (a: Answers) => void) => {
      const a = clone(perfectAnswers(seed));
      mutate(a);
      return scoreAttempt(scenario, seed, perfectAnswers(seed)).points - scoreAttempt(scenario, seed, a).points;
    };

    it("QC: each miscode missed costs its 3 points; the wrong reason costs half", () => {
      for (const seed of seeds) {
        const qc = solveQc(seed);
        for (const r of qc.miscoded) {
          expect(lost(seed, (a) => void (a["qc-review"].flags = a["qc-review"].flags.filter((f) => f.target !== r.id))), `${seed} ${r.reason}`).toBe(3);
          expect(
            lost(seed, (a) => {
              a["qc-review"].flags.find((f) => f.target === r.id)!.reason = "other";
            }),
          ).toBe(1.5);
        }
      }
    });

    it("QC: flagging a correctly coded decoy costs 1 (boundary date, lawyer only copied, work product, coded hot)", () => {
      for (const seed of seeds) {
        const qc = solveQc(seed);
        const ok = qc.rows.filter((r) => !r.reason);
        for (const decoy of [ok.find((r) => r.kind === "boundary")!, ok.find((r) => r.kind === "cc_lawyer")!, ok.find((r) => r.kind === "work_product")!, ok.find((r) => r.right.hot)!]) {
          expect(lost(seed, (a) => void a["qc-review"].flags.push({ target: decoy.id, reason: "privilege", note: "" })), `${seed} ${decoy.kind}`).toBe(1);
        }
      }
    });

    it("privilege log: each flawed entry missed costs 3; flagging a right entry costs 1", () => {
      for (const seed of seeds) {
        const log = solveLog(seed);
        for (const r of log.flawed) expect(lost(seed, (a) => void (a["priv-log"].flags = a["priv-log"].flags.filter((f) => f.target !== r.id))), `${seed} ${r.issue}`).toBe(3);
        for (const r of log.rows.filter((x) => !x.issue)) expect(lost(seed, (a) => void a["priv-log"].flags.push({ target: r.id, reason: "basis", note: "" }))).toBe(1);
      }
    });

    it("rapid traps: the naive coding costs two fields on a date trap and one on a privilege trap", () => {
      const naive: Record<string, (v: Record<string, string>, item: RapidItem, s: Solved) => [number, Record<string, string>]> = {
        // Coded on content alone, ignoring the period.
        out_of_range: (v, item, s) => [1, { ...v, responsive: optionId(item, "responsive", "Responsive"), tag: optionId(item, "tag", TOPICS[topicOf(s)].label) }],
        // Read the period as excluding its last (or first) day.
        boundary: (v, item) => [1, { ...v, responsive: optionId(item, "responsive", "Not responsive"), tag: optionId(item, "tag", "No tag") }],
        // A lawyer on it, so privileged.
        waived: (v, item) => [0.5, { ...v, privileged: optionId(item, "privileged", "Privileged") }],
        cc_lawyer: (v, item) => [0.5, { ...v, privileged: optionId(item, "privileged", "Privileged") }],
        // No lawyer on it, so not privileged.
        work_product: (v, item) => [0.5, { ...v, privileged: optionId(item, "privileged", "Not privileged") }],
      };
      const topicOf = (s: Solved) => Object.entries(TOPICS).find(([, t]) => t.re.test(`${row(s.item, "Subject")} ${s.item.prompt}`))![0];
      for (const seed of seeds.slice(0, 15)) {
        for (const id of RAPID_STEPS) {
          for (const s of solveRapid(seed, id).filter((x) => HARD_KINDS.includes(x.kind))) {
            const [cost, values] = naive[s.kind](s.values, s.item, s);
            expect(lost(seed, (a) => void (a[id].items[s.item.id].values = values)), `${seed} ${s.kind}`).toBe(cost);
          }
        }
      }
    });

    it("multiple choice and the estimate: a wrong pick or a wrong cell costs that step's points", () => {
      for (const seed of seeds) {
        for (const [id, pts] of [["search-terms", 4], ["hot-doc", 5], ["foreign-doc", 4], ["partial-priv", 5]] as const) {
          const other = mc(seed, id).options.find((o) => o.id !== (perfectAnswers(seed)[id] as { selected: string[] }).selected[0])!.id;
          expect(lost(seed, (a) => void ((a[id] as { selected: string[] }).selected = [other])), `${seed} ${id}`).toBe(pts);
        }
        // Hours from the sample hits instead of the projection.
        const est = solveEstimate(seed);
        expect(lost(seed, (a) => void (a["review-estimate"].cells.est_hours = Math.round((est.hits / est.rate) * 10) / 10))).toBe(2);
        expect(lost(seed, (a) => void (a["review-estimate"].cells.est_docs = est.hits))).toBe(2);
      }
    });
  });
});

describe("ediscovery-larch-review: nothing derived reaches the candidate", () => {
  it("no key words, estimate values or reviewer notes in any payload", () => {
    for (const seed of SEEDS) {
      const variant = scenario.generate(seed);
      const est = (variant.keys["review-estimate"] as { cells: Record<string, { value: number }> }).cells;
      const notes = ["qc-review", "priv-log"].flatMap((id) => Object.values((variant.keys[id] as ReviewKey).findings).map((f) => f.note ?? ""));
      for (const minute of [0, 20, END]) {
        const payload = JSON.stringify(renderAttemptForCandidate(scenario, seed, minute));
        expect(payload).not.toMatch(/"keys"|tolerance|"criteria"|"guidance"|"notes"|"points"|"expected"|"findings"|"correct"|"clean":/);
        expect(payload).not.toMatch(new RegExp(`(?<![\\d.,])${est.est_docs.value.toLocaleString("en-US")}(?![\\d.]\\d)`));
        expect(payload).not.toMatch(new RegExp(`(?<![\\d.,])${est.est_docs.value}(?![\\d.]\\d)`));
        for (const n of notes) if (n) expect(payload).not.toContain(n);
      }
    }
  });
});

describe("ediscovery-larch-review: timed sections", () => {
  const def = scenario.definition;
  const MIN = 60_000;
  const t0 = Date.parse("2026-11-16T09:00:00Z");
  const flowAt = (ms: number, events: Parameters<typeof resolveFlow>[1]["events"] = []) => resolveFlow(def, { startedAt: t0, now: t0 + ms, extraTimePercent: 0, events });
  const stepById = (id: string) => def.steps.find((s) => s.id === id)!;

  it("validateSections passes and the sections fill the time limit exactly", () => {
    expect(validateSections(def, scenario.timeLimitMinutes)).toEqual([]);
    expect(def.sections!.reduce((t, s) => t + s.minutes, 0)).toBe(scenario.timeLimitMinutes);
  });

  it("six sections: QC, round 1, search and privilege log, round 2, inbox, round 3", () => {
    expect(def.sections!.map((s) => [s.id, s.minutes, s.stepIds, !!s.oneAtATime])).toEqual([
      ["s-qc", 14, ["qc-review"], false],
      ["s-rapid-1", 6, ["rapid-1"], false],
      ["s-search-log", 10, ["search-terms", "review-estimate", "priv-log"], true],
      ["s-rapid-2", 6, ["rapid-2"], false],
      ["s-inbox", 8, ["hot-doc", "foreign-doc", "partial-priv"], true],
      ["s-rapid-3", 6, ["rapid-3"], false],
    ]);
  });

  it("one-at-a-time screens add up to their section; each rapid round is 15 x 20 s and fits its 6 minutes", () => {
    for (const sec of def.sections!.filter((s) => s.oneAtATime)) expect(sec.stepIds.reduce((t, id) => t + stepById(id).seconds!, 0), sec.id).toBe(sec.minutes * 60);
    for (const id of RAPID_STEPS) {
      const config = rapidConfig(id);
      expect(config.items.length).toBe(15);
      expect(config.secondsPerItem).toBe(20);
      expect(config.items.length * config.secondsPerItem).toBeLessThanOrEqual(6 * 60);
    }
  });

  it("runs the sections back to back", () => {
    const at = (min: number) => flowAt(min * MIN);
    expect(at(0).visibleStepIds).toEqual(["qc-review"]);
    expect(at(14).visibleStepIds).toEqual(["rapid-1"]);
    expect(at(20).visibleStepIds).toEqual(["search-terms"]);
    expect(at(25).visibleStepIds).toEqual(["priv-log"]);
    expect(at(30).visibleStepIds).toEqual(["rapid-2"]);
    expect(at(36).visibleStepIds).toEqual(["hot-doc"]);
    expect(at(44).visibleStepIds).toEqual(["rapid-3"]);
    expect(at(END).done).toBe(true);
  });

  it("the protocol arrives at the start and stays; each task's message arrives with its section", () => {
    const msgsAt = (min: number) => visibleMessageIds(def, flowAt(min * MIN), t0, t0 + min * MIN);
    expect(msgsAt(0)).toEqual(expect.arrayContaining(["m1", "m2"]));
    for (const min of [0, 14, 20, 30, 36, 44, 49]) expect(msgsAt(min), `m${min}`).toContain("m1");
    for (const m of def.messages) expect(def.steps.some((s) => s.id === m.stepId), m.id).toBe(true);
  });
});
