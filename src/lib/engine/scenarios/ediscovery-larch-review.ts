import "server-only";

import type { Rng } from "../server/rng";
import { defineScenario } from "../server/scenario";
import { DOCUMENT_REVIEW } from "../step-types/document_review/public";
import { MULTIPLE_CHOICE } from "../step-types/multiple_choice/public";
import { RAPID_ROUND } from "../step-types/rapid_round/public";
import { SPREADSHEET } from "../step-types/spreadsheet/public";

/**
 * Project Larch: a contract document reviewer at Hale & Corwin LLP on the
 * Larchmont Polymers defence, in six timed sections (50 minutes, 100 points):
 * QC of a teammate's coding (18) → coding round 1 (15) → search terms, review
 * estimate and privilege log, one screen at a time (23) → coding round 2 (15)
 * → review inbox, one screen at a time (14) → coding round 3 (15).
 *
 * The review protocol is the first inbox message and drives every answer. It
 * is seeded per candidate: the review period, the lawyers, the four issue tags
 * (resin quality always, three of five others), the custodians, the review
 * manager and the foreign-language queue. Every document, name, date, number,
 * which row holds which miscode and which option is right are seeded too.
 *
 * Coding rounds: 15 documents × 20 s, each coded Responsive, Privileged and
 * an issue tag (a third of the item each). Items 3, 6, 9, 12 and 15 are the
 * traps, worth 1.5: dated just outside the period, dated on its first or last
 * day, a third party copied on a request for legal advice, a lawyer only
 * copied on a business email, and work product with no lawyer on it. The
 * other ten are worth 0.75, so each round is exactly 15.
 *
 * Every helper (names, dates, documents) lives in this file on purpose: the
 * shared legal helpers were being written at the same time.
 *
 * All people, companies, the court and the case are fictional.
 */

const DAY = 86_400_000;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
/** A UTC day number as "Mar 4, 2024". */
function fmtDay(d: number): string {
  const x = new Date(d * DAY);
  return `${MONTHS[x.getUTCMonth()]} ${x.getUTCDate()}, ${x.getUTCFullYear()}`;
}

// ---- People ----

const FIRST = ["Dana", "Marco", "Priya", "Luis", "Hannah", "Tomas", "Grace", "Omar", "Elena", "Victor", "Nora", "Felix", "Ingrid", "Samir", "Julia", "Ravi", "Clara", "Mateo", "Wendy", "Desmond"];
const LAST = ["Whitfield", "Reyes", "Okafor", "Ortega", "Berg", "Albright", "Lindqvist", "Haddad", "Marsh", "Tanaka", "Delgado", "Fenwick", "Kowalski", "Abara", "Castell", "Pratt", "Novak", "Sorensen", "Quint", "Ballard", "Ferris", "Iyer"];
const TITLES = ["VP of Sales", "Plant Manager", "Quality Director", "Supply Chain Manager", "Account Manager", "Controller", "Logistics Coordinator", "Customer Service Lead"];
const THIRD_ORGS = ["Meridian PR Group", "Arden Quality Consultants", "Keystone Logistics", "Pillar Risk Advisors", "Northgate Polymer Supply"];
const QUEUES = ["Foreign Language Review", "FL Translation", "Multilingual Review", "Language Desk"];

const OUTSIDE = "Hale & Corwin LLP";
const IN_HOUSE = "Larchmont Legal";
const CLIENT = "Larchmont";

type Person = { name: string; org: string; lawyer: boolean; third: boolean };
const show = (p: Person) => `${p.name} (${p.org})`;
const list = (ps: Person[]) => (ps.length ? ps.map(show).join("; ") : "—");
const firstName = (p: Person) => p.name.split(" ")[0];
/** "Ruth Abara" → "R. Abara* (Hale & Corwin LLP)" for the privilege log; * marks a lawyer. */
const logName = (p: Person) => {
  const [f, ...rest] = p.name.split(" ");
  return `${f[0]}. ${rest.join(" ")}${p.lawyer ? "*" : ""} (${p.org})`;
};
const logList = (ps: Person[]) => (ps.length ? ps.map(logName).join("; ") : "—");

// ---- Issues ----

type TopicId = "quality" | "pricing" | "termination" | "delivery" | "inspection" | "insurance";
/** Seeded bits a snippet can use. */
type P = { batch: number; num: number; pct: number; pct2: number; when: string; month: string; q: number; section: number; year: number; L: string; lawyer: string };
type Snip = (x: P) => [subject: string, text: string];

interface Topic {
  id: TopicId;
  label: string;
  desc: string;
  /** For privilege log descriptions: "regarding …". */
  phrase: string;
  /** What a log description that gives the advice away would say. */
  reveal: string;
  business: Snip[];
  request: Snip[];
  advice: Snip[];
  workProduct: (x: P) => string;
  search: { a: string; b: string; ctx: string; broad: string };
}

const TOPICS: Topic[] = [
  {
    id: "quality",
    label: "Resin quality and off-spec batches",
    desc: "test results, off-spec or contaminated batches, quality holds and returns",
    phrase: "off-spec resin batches",
    reveal: "Larchmont must disclose the batch test results to Brightwater",
    business: [
      (x) => [`Batch ${x.batch} test results`, `Lab results for batch ${x.batch} came back with viscosity outside the spec range. Holding the batch until QA signs off.`],
      (x) => [`Batch ${x.batch} complaint`, `Brightwater says batch ${x.batch} showed contamination on their line. Can someone pull the retain sample?`],
      (x) => [`Off-spec rework`, `We reworked ${x.num} drums of off-spec resin from batch ${x.batch} and re-tested them on ${x.when}.`],
    ],
    request: [
      (x) => [`Batch ${x.batch}: question for counsel`, `${x.L}, could you advise whether we have to tell Brightwater about the batch ${x.batch} test results before the next order?`],
      (x) => [`Need your advice: off-spec returns`, `${x.L}, we need your advice on whether taking back off-spec batch ${x.batch} admits fault.`],
    ],
    advice: [(x) => [`RE: Batch ${x.batch}`, `My advice: don't change the batch ${x.batch} certificates. Keep the originals and send me the lab file.`]],
    workProduct: (x) => `summary of the batch ${x.batch} test history`,
    search: { a: "contaminat*", b: '"off-spec"', ctx: "resin", broad: "batch*" },
  },
  {
    id: "pricing",
    label: "Pricing and the raw-material surcharge",
    desc: "price changes, the raw-material surcharge, discounts and rebates",
    phrase: "the raw-material surcharge",
    reveal: "the surcharge likely breaches the supply agreement",
    business: [
      (x) => [`Q${x.q} surcharge`, `The raw-material surcharge goes to ${x.pct}% for Brightwater on ${x.when}. Please update the quotes.`],
      (x) => [`Brightwater price list`, `Attached is the new price list for Brightwater. The rebate drops from ${x.pct}% to ${x.pct2}%.`],
      (x) => [`Surcharge pushback`, `Brightwater's buyer called again about the surcharge. They want it waived on the ${x.month} orders.`],
    ],
    request: [
      (x) => [`Surcharge: question for counsel`, `${x.L}, can you advise whether the supply agreement lets us add the surcharge mid-term?`],
      (x) => [`Need your advice on the rebate`, `${x.L}, please advise whether we can claw back the ${x.pct}% rebate Brightwater already took.`],
    ],
    advice: [() => [`RE: Surcharge`, `My advice is to give Brightwater written notice before the surcharge applies. I'll draft it.`]],
    workProduct: (x) => `timeline of surcharge changes since ${x.year}`,
    search: { a: "surcharg*", b: '"price increase"', ctx: "Brightwater", broad: "pric*" },
  },
  {
    id: "termination",
    label: "Supply agreement termination",
    desc: "ending, renewing or giving notice under the Brightwater supply agreement",
    phrase: "termination of the Brightwater supply agreement",
    reveal: "Larchmont cannot terminate without first giving a cure period",
    business: [
      (x) => [`Supply agreement renewal`, `The Brightwater supply agreement comes up for renewal on ${x.when}. Sales wants to talk options.`],
      (x) => [`Termination timeline`, `If we terminate the Brightwater agreement, the plant needs ${x.num} weeks to wind down their line.`],
      (x) => [`Non-renewal draft`, `Sales drafted a notice of non-renewal for Brightwater. It goes out on ${x.when} if we decide to go ahead.`],
    ],
    request: [
      (x) => [`Termination: question for counsel`, `${x.L}, could you advise how much notice we need to terminate the Brightwater agreement?`],
      (x) => [`Advice needed before non-renewal`, `${x.L}, we need your advice before we send Brightwater a notice of non-renewal.`],
    ],
    advice: [(x) => [`RE: Termination`, `My advice: don't terminate yet. Section ${x.section} gives us a cure period to use first.`]],
    workProduct: () => "chronology of the termination and renewal talks",
    search: { a: "terminat*", b: '"non-renewal"', ctx: '"supply agreement"', broad: "agreement*" },
  },
  {
    id: "delivery",
    label: "Late deliveries and freight",
    desc: "shipping dates, late or missed deliveries, carriers and freight",
    phrase: "late deliveries to Brightwater",
    reveal: "the late deliveries are probably a breach by Larchmont",
    business: [
      () => [`Late deliveries`, `Three Brightwater deliveries were late this month because the carrier lost a truck.`],
      (x) => [`Freight update`, `Freight for the ${x.when} shipment to Brightwater is booked. It will arrive ${x.num} days late.`],
      (x) => [`Carrier switch`, `We're moving Brightwater's loads to a new carrier from ${x.when} to stop the late arrivals.`],
    ],
    request: [(x) => [`Delivery delays: question for counsel`, `${x.L}, please advise whether the late deliveries count as a breach on our side.`]],
    advice: [() => [`RE: Delivery delays`, `My advice is to log every late delivery and the carrier's reason, and send me the list each week.`]],
    workProduct: () => "list of late deliveries and the carrier's reasons",
    search: { a: "deliver*", b: '"late shipment"', ctx: "Brightwater", broad: "ship*" },
  },
  {
    id: "inspection",
    label: "Plant inspection",
    desc: "the state inspection of the Larchmont plant and its findings",
    phrase: "the state inspection of the plant",
    reveal: "the inspection report must be shared with Brightwater",
    business: [
      (x) => [`Inspection visit`, `The state inspectors will be at the plant on ${x.when}. Please make sure the tank area is clean.`],
      (x) => [`Inspection findings`, `The inspection report lists ${x.num} findings at the plant. The corrective plan is due in 30 days.`],
    ],
    request: [(x) => [`Inspection: question for counsel`, `${x.L}, could you advise whether we must share the inspection report with Brightwater?`]],
    advice: [() => [`RE: Inspection report`, `My advice: answer the inspection findings in writing and copy me on the response.`]],
    workProduct: () => "summary of the plant inspection findings",
    search: { a: "inspect*", b: '"corrective plan"', ctx: "plant", broad: "plant*" },
  },
  {
    id: "insurance",
    label: "Insurance coverage",
    desc: "notice to insurers and coverage for the Brightwater claim",
    phrase: "insurance coverage for the Brightwater claim",
    reveal: "the Brightwater claim is likely not covered",
    business: [
      (x) => [`Insurer call`, `Our broker says the underwriter wants the Brightwater claim details by ${x.when}.`],
      (x) => [`Coverage limits`, `The new policy raises our coverage limit to $${x.num} million from ${x.when}.`],
    ],
    request: [(x) => [`Coverage: question for counsel`, `${x.L}, can you advise whether our liability insurance covers the Brightwater claim?`]],
    advice: [() => [`RE: Coverage`, `My advice is to give the insurer written notice of the Brightwater claim this week.`]],
    workProduct: () => "list of insurance notices sent so far",
    search: { a: "insur*", b: '"coverage"', ctx: "Brightwater", broad: "polic*" },
  },
];
const topic = (id: TopicId) => TOPICS.find((t) => t.id === id)!;

/** Office chatter: about no issue at all. */
const CHATTER: Snip[] = [
  () => ["Parking", "The north lot will be repaved on Saturday. Please use the side entrance."],
  () => ["Benefits enrollment", "Benefits enrollment closes Friday. Dental plan changes take effect next month."],
  () => ["Laptop updates", "IT will update all laptops tonight. Save your work before 6 PM."],
  () => ["Team lunch", "Team lunch Thursday at noon in the large conference room. Reply by Wednesday."],
  () => ["Holiday party", "The holiday party is on the 12th. Guests are welcome."],
  () => ["Expense reports", "Expense reports for last month are due by the 5th."],
  () => ["Fire drill", "Fire drill at 10 AM tomorrow. Meet at the east gate."],
  () => ["New badges", "Pick up your new building badge from reception this week."],
];

/** Hot documents (protocol section 5). All about resin quality, which is always an issue. */
const HOT: Snip[] = [
  (x) => ["Before legal collects", `Before the lawyers start collecting, delete the old batch ${x.batch} test sheets from the shared drive.`],
  (x) => [`Batch ${x.batch}`, `We knew batch ${x.batch} was off-spec before it shipped to Brightwater. Let's keep that off email.`],
  (x) => ["Retain samples", `Throw out the batch ${x.batch} retain samples and delete the lab log. We won't need them if Brightwater sues.`],
];

const FOREIGN: { lang: string; text: (b: number) => string }[] = [
  { lang: "Spanish", text: (b) => `Adjunto los resultados del lote ${b}. Por favor, revísalos antes del viernes.` },
  { lang: "German", text: (b) => `Anbei die Prüfergebnisse für Charge ${b}. Bitte bis Freitag prüfen.` },
  { lang: "French", text: (b) => `Ci-joint les résultats du lot ${b}. Merci de les vérifier avant vendredi.` },
  { lang: "Portuguese", text: (b) => `Segue em anexo o resultado do lote ${b}. Por favor, verifique até sexta-feira.` },
];

// ---- Documents ----

type Kind = "responsive" | "not_responsive" | "other_topic" | "privileged" | "out_of_range" | "waived" | "cc_lawyer" | "boundary" | "work_product" | "hot";

interface Doc {
  id: string;
  kind: Kind;
  type: "Email" | "Memo";
  date: number;
  from: Person[];
  to: Person[];
  cc: Person[];
  subject: string;
  text: string;
  /** The issue the document is about (null for chatter), whether or not it's a tag this time. */
  about: TopicId | null;
  responsive: boolean;
  privileged: boolean;
  hot: boolean;
}

interface Ctx {
  rng: Rng;
  start: number;
  end: number;
  tags: TopicId[];
  others: TopicId[];
  custodians: Person[];
  lawyers: Person[];
  thirds: Person[];
  opp: Person;
  ids: Set<string>;
}

function docId(c: Ctx): string {
  for (;;) {
    const id = `LARCH-${String(c.rng.int(100_000, 9_999_999)).padStart(7, "0")}`;
    if (!c.ids.has(id)) {
      c.ids.add(id);
      return id;
    }
  }
}

const inPeriod = (c: Ctx) => c.rng.int(c.start + 3, c.end - 3);
const outside = (c: Ctx) => (c.rng.int(0, 1) ? c.start - c.rng.int(2, 25) : c.end + c.rng.int(2, 25));

function params(c: Ctx, lawyer: Person): P {
  const pct = c.rng.int(5, 12);
  return {
    batch: c.rng.int(4100, 9899),
    num: c.rng.int(3, 14),
    pct,
    pct2: pct - c.rng.int(2, 4),
    when: fmtDay(inPeriod(c)),
    month: MONTH_NAMES[c.rng.int(0, 11)],
    q: c.rng.int(1, 4),
    section: c.rng.int(8, 19),
    year: new Date(c.start * DAY).getUTCFullYear(),
    L: firstName(lawyer),
    lawyer: lawyer.name,
  };
}

/** One document of the given kind, coded under the protocol. */
function makeDoc(c: Ctx, kind: Kind, hotSnip?: Snip): Doc {
  const { rng } = c;
  const [a, b] = rng.shuffle(c.custodians);
  const lawyer = rng.pick(c.lawyers);
  const x = params(c, lawyer);
  const issue = kind === "hot" ? "quality" : rng.pick(c.tags);
  const t = topic(issue);
  const base = { id: docId(c), kind, type: "Email" as const, cc: [] as Person[], hot: false };
  const maybeCc = () => (rng.int(0, 2) === 0 ? [rng.pick(c.custodians.filter((p) => p !== a && p !== b))] : []);
  switch (kind) {
    case "responsive":
    case "boundary": {
      const [subject, text] = rng.pick(t.business)(x);
      const date = kind === "boundary" ? rng.pick([c.start, c.end]) : inPeriod(c);
      return { ...base, date, from: [a], to: [rng.int(0, 3) ? b : c.opp], cc: maybeCc(), subject, text, about: issue, responsive: true, privileged: false };
    }
    case "not_responsive":
    case "other_topic": {
      const chatter = kind === "not_responsive" && rng.int(0, 1) === 0;
      const about = chatter ? null : rng.pick(c.others);
      const [subject, text] = chatter ? rng.pick(CHATTER)(x) : rng.pick(topic(about!).business)(x);
      return { ...base, date: inPeriod(c), from: [a], to: [b], cc: maybeCc(), subject, text, about, responsive: false, privileged: false };
    }
    case "out_of_range": {
      const [subject, text] = rng.pick(t.business)(x);
      return { ...base, date: outside(c), from: [a], to: [b], cc: maybeCc(), subject, text, about: issue, responsive: false, privileged: false };
    }
    case "privileged": {
      const giving = rng.int(0, 2) === 0;
      const [subject, text] = rng.pick(giving ? t.advice : t.request)(x);
      return { ...base, date: inPeriod(c), from: [giving ? lawyer : a], to: [giving ? a : lawyer], cc: maybeCc(), subject, text, about: issue, responsive: true, privileged: true };
    }
    case "waived": {
      const [subject, text] = rng.pick(t.request)(x);
      return { ...base, date: inPeriod(c), from: [a], to: [lawyer], cc: [rng.pick(c.thirds)], subject, text, about: issue, responsive: true, privileged: false };
    }
    case "cc_lawyer": {
      const [subject, text] = rng.pick(t.business)(x);
      return { ...base, date: inPeriod(c), from: [a], to: [b], cc: [lawyer], subject, text, about: issue, responsive: true, privileged: false };
    }
    case "work_product": {
      const outsideCounsel = c.lawyers.filter((p) => p.org === OUTSIDE);
      const text = `Prepared at the request of ${rng.pick(outsideCounsel).name} for the Brightwater litigation: ${t.workProduct(x)}.`;
      return { ...base, type: "Memo", date: inPeriod(c), from: [a], to: [], subject: `Memo: ${t.phrase}`, text, about: issue, responsive: true, privileged: true };
    }
    case "hot": {
      const [subject, text] = (hotSnip ?? rng.pick(HOT))(x);
      return { ...base, date: inPeriod(c), from: [a], to: [b], subject, text, about: "quality", responsive: true, privileged: false, hot: true };
    }
  }
}

// ---- Rapid rounds ----

const RAPID_ITEMS = 15;
const isHardSlot = (i: number) => i % 3 === 2;
const slotNo = (i: number) => String(i + 1).padStart(2, "0");
const EASY: Kind[] = ["responsive", "responsive", "responsive", "responsive", "not_responsive", "not_responsive", "not_responsive", "privileged", "privileged", "privileged"];
const HARD: Kind[] = ["out_of_range", "boundary", "waived", "cc_lawyer", "work_product"];

function fillSlots<T>(easy: T[], hard: T[]): T[] {
  const e = [...easy];
  const h = [...hard];
  const out = Array.from({ length: RAPID_ITEMS }, (_, i) => (isHardSlot(i) ? h.shift() : e.shift()));
  if (out.some((x) => x === undefined) || e.length || h.length) throw new Error("ediscovery-larch-review: rapid slots don't fill");
  return out as T[];
}

const TAG_IDS = ["t1", "t2", "t3", "t4"] as const;

function rapidStep(round: 1 | 2 | 3, intro: string) {
  return {
    id: `rapid-${round}`,
    type: RAPID_ROUND,
    title: `Coding round ${round}`,
    config: {
      intro,
      secondsPerItem: 20,
      items: Array.from({ length: RAPID_ITEMS }, (_, i) => {
        const p = `c${round}_${slotNo(i)}`;
        return {
          id: `c${round}-${slotNo(i)}`,
          prompt: `{{${p}_text}}`,
          exhibit: {
            title: `{{${p}_doc}} · {{${p}_type}}`,
            rows: [
              { label: "Date", value: `{{${p}_date}}` },
              { label: "From", value: `{{${p}_from}}` },
              { label: "To", value: `{{${p}_to}}` },
              { label: "Cc", value: `{{${p}_cc}}` },
              { label: "Subject", value: `{{${p}_subject}}` },
            ],
          },
          fields: [
            {
              id: "responsive",
              label: "Responsiveness",
              kind: "choice" as const,
              options: [
                { id: "yes", label: "Responsive" },
                { id: "no", label: "Not responsive" },
              ],
            },
            {
              id: "privileged",
              label: "Privilege",
              kind: "choice" as const,
              options: [
                { id: "yes", label: "Privileged" },
                { id: "no", label: "Not privileged" },
              ],
            },
            {
              id: "tag",
              label: "Issue tag",
              kind: "choice" as const,
              options: [...TAG_IDS.map((id, j) => ({ id, label: `{{tag_${j + 1}}}` })), { id: "none", label: "No tag" }],
            },
          ],
          points: isHardSlot(i) ? 1.5 : 0.75,
        };
      }),
    },
  };
}

const ROUND_INTRO =
  "15 documents, 20 seconds each. Code each one under the Project Larch protocol (the first message in your inbox): Responsive or not, Privileged or not, and its issue tag.";

// ---- QC review ----

const QC_COLUMNS = ["Doc ID", "Date", "From", "To", "Cc", "Subject", "Text", "Responsive", "Privileged", "Issue tag", "Hot"];
const QC_ROWS = 20;
type QcPlan = { kind: Kind; miscode?: "outside" | "not_issue" | "waived" | "missed_priv" | "hot" | "tag" };
const QC_PLAN: QcPlan[] = [
  { kind: "out_of_range", miscode: "outside" },
  { kind: "other_topic", miscode: "not_issue" },
  { kind: "waived", miscode: "waived" },
  { kind: "privileged", miscode: "missed_priv" },
  { kind: "hot", miscode: "hot" },
  { kind: "responsive", miscode: "tag" },
  { kind: "boundary" },
  { kind: "out_of_range" },
  { kind: "cc_lawyer" },
  { kind: "work_product" },
  { kind: "hot" },
  { kind: "waived" },
  { kind: "privileged" },
  { kind: "privileged" },
  { kind: "responsive" },
  { kind: "responsive" },
  { kind: "responsive" },
  { kind: "responsive" },
  { kind: "not_responsive" },
  { kind: "not_responsive" },
];
const QC_FINDINGS = [
  { id: "outside", label: "Out-of-period document coded responsive", reason: "outside" },
  { id: "not_issue", label: "Document on no protocol issue coded responsive", reason: "not_issue" },
  { id: "waived", label: "Third party copied, coded privileged", reason: "privilege" },
  { id: "missed_priv", label: "Privileged email coded not privileged", reason: "privilege" },
  { id: "hot", label: "Hot document not coded Hot", reason: "hot" },
  { id: "tag", label: "Wrong issue tag", reason: "tag" },
] as const;

// ---- Privilege log ----

const LOG_COLUMNS = ["Entry", "Doc ID", "Date", "Type", "Author", "Recipients", "Basis", "Description"];
type LogKind = "ok_request" | "ok_advice" | "ok_wp" | "incomplete" | "vague" | "reveals" | "basis" | "waived";
const LOG_KINDS: LogKind[] = ["ok_request", "ok_advice", "ok_wp", "incomplete", "vague", "reveals", "basis", "waived"];
const LOG_FINDINGS = [
  { id: "incomplete", label: "Entry missing its author or recipients" },
  { id: "vague", label: "Description too vague" },
  { id: "reveals", label: "Description reveals the advice" },
  { id: "basis", label: "Attorney-client claimed with no lawyer on it" },
  { id: "waived", label: "Third-party document logged as privileged" },
] as const;
const VAGUE = ["Email.", "Correspondence.", "Document.", "Email re: legal matters."];

// ---- Multiple choice ----

const MC_IDS = ["a", "b", "c", "d"] as const;

/** Assigns four option texts to ids a–d in a seeded order; returns the id of the first (right) one. */
function shuffleOptions(rng: Rng, prefix: string, v: Record<string, string | number>, right: string, wrong: string[]): string {
  const order = rng.shuffle([right, ...wrong]);
  order.forEach((label, i) => {
    v[`${prefix}_opt_${MC_IDS[i]}`] = label;
  });
  return MC_IDS[order.indexOf(right)];
}

const mcOptions = (prefix: string) => MC_IDS.map((id) => ({ id, label: `{{${prefix}_opt_${id}}}` }));

const bold = (text: string) => ({ text, bold: true });
const right = (text: string) => ({ text, align: "right" as const });

export const ediscoveryLarchReview = defineScenario({
  slug: "ediscovery-larch-review",
  version: 1,
  title: "Project Larch review batch",
  roleFamily: "legal",
  timeLimitMinutes: 50,
  definition: {
    intro:
      "You're a contract document reviewer at Hale & Corwin LLP, which represents Larchmont Polymers, Inc. in Brightwater Mills, Inc. v. Larchmont Polymers, Inc., a case in the U.S. District Court for the District of Wexford. The review is called Project Larch. Your review manager's protocol is the first message in your inbox, and every call today follows it. The work comes in six timed parts, 50 minutes in all: a QC check of a teammate's coding, three rapid coding rounds, search terms and the privilege log, and the review inbox. A finished part can't be reopened. All people, companies and the case are fictional.",
    steps: [
      {
        id: "qc-review",
        type: DOCUMENT_REVIEW,
        title: "QC: {{teammate}}'s coding",
        config: {
          prompt: [
            "Check {{teammate}}'s first-pass coding of these 20 documents against the protocol.",
            "Flag each document that is coded wrong, with the reason. Don't flag documents that are coded right.",
          ].join("\n"),
          document: {
            title: "QC sample · batch {{qc_batch}} · coded by {{teammate}}",
            fields: [],
            columns: QC_COLUMNS,
            rows: Array.from({ length: QC_ROWS }, (_, i) => ({ id: `q${slotNo(i)}`, cells: QC_COLUMNS.map((_, j) => `{{qc_${slotNo(i)}_${j}}}`) })),
            totals: [],
          },
          reasons: [
            { id: "outside", label: "Dated outside the review period" },
            { id: "not_issue", label: "Not about a protocol issue" },
            { id: "privilege", label: "Wrong privilege call" },
            { id: "tag", label: "Wrong issue tag" },
            { id: "hot", label: "Hot document not marked Hot" },
            { id: "other", label: "Other" },
          ],
          findings: QC_FINDINGS.map((f) => ({ id: f.id, label: f.label, points: 3 })),
          falseFlagPenalty: 1,
          maxFlags: 20,
        },
      },
      rapidStep(1, `Coding round 1: ${ROUND_INTRO}`),
      {
        id: "search-terms",
        type: MULTIPLE_CHOICE,
        seconds: 150,
        title: "Search string: {{s_tag}}",
        config: {
          prompt: [
            '{{manager}} needs a search string for the "{{s_tag}}" issue. Each string below was run on the validation sample of {{s_sample|number}} documents, which reviewers coded by hand; {{s_rel}} of them are relevant to this issue.',
            "",
            "Which string should the team use?",
          ].join("\n"),
          options: mcOptions("s"),
          select: "single",
          points: 4,
        },
      },
      {
        id: "review-estimate",
        type: SPREADSHEET,
        seconds: 150,
        title: "Review estimate",
        config: {
          prompt: [
            "{{manager}} needs a quick estimate for the client. The agreed string for the {{est_tag}} issue was run on the validation sample.",
            "Project its hit rate onto the full collection, then work out the reviewer hours at the review rate. Hours to one decimal.",
          ].join("\n"),
          columns: ["Item", "Value"],
          rows: [
            [bold("Review estimate · {{est_tag}}"), null],
            ["Validation sample (documents)", right("{{est_sample|number}}")],
            ["Hits in the sample for the agreed string", right("{{est_hits|number}}")],
            ["Full collection (documents)", right("{{est_collection|number}}")],
            ["Review rate (documents per reviewer hour)", right("{{est_rate}}")],
            ["Projected documents to review in the full collection", { input: "est_docs", label: "Projected documents to review", points: 2, format: "number" as const }],
            ["Reviewer hours", { input: "est_hours", label: "Reviewer hours", points: 2, format: "number" as const }],
          ],
        },
      },
      {
        id: "priv-log",
        type: DOCUMENT_REVIEW,
        seconds: 300,
        title: "Privilege log check",
        config: {
          prompt: [
            "{{manager}} drafted these privilege log entries for production volume {{log_vol}}. Check each against the protocol's logging rules.",
            "Flag each entry that is wrong, with the reason. Don't flag entries that are right.",
          ].join("\n"),
          document: {
            title: "Draft privilege log · Project Larch · volume {{log_vol}}",
            fields: [],
            columns: LOG_COLUMNS,
            rows: Array.from({ length: LOG_KINDS.length }, (_, i) => ({ id: `e${i + 1}`, cells: LOG_COLUMNS.map((_, j) => `{{log_${i + 1}_${j}}}`) })),
            totals: [],
            footnote: "* lawyer (Hale & Corwin LLP or Larchmont Legal)",
          },
          reasons: [
            { id: "incomplete", label: "Author or recipients missing" },
            { id: "vague", label: "Description too vague to support the claim" },
            { id: "reveals", label: "Description reveals the legal advice" },
            { id: "basis", label: "No lawyer on it: the basis doesn't fit" },
            { id: "waived", label: "Third party on it: not privileged, produce it" },
            { id: "other", label: "Other" },
          ],
          findings: LOG_FINDINGS.map((f) => ({ id: f.id, label: f.label, points: 3 })),
          falseFlagPenalty: 1,
        },
      },
      rapidStep(2, `Coding round 2: ${ROUND_INTRO}`),
      {
        id: "hot-doc",
        type: MULTIPLE_CHOICE,
        seconds: 150,
        title: "A document to escalate?",
        config: {
          prompt: [
            "While coding you open {{hd_doc}}.",
            "Date: {{hd_date}}",
            "From: {{hd_from}}",
            "To: {{hd_to}}",
            "Subject: {{hd_subject}}",
            '"{{hd_text}}"',
            "",
            "What do you do?",
          ].join("\n"),
          options: mcOptions("hd"),
          select: "single",
          points: 5,
        },
      },
      {
        id: "foreign-doc",
        type: MULTIPLE_CHOICE,
        seconds: 150,
        title: "A document you can't read",
        config: {
          prompt: ["{{fd_doc}}, from {{fd_custodian}}'s mailbox, is written in {{fd_lang}}:", '"{{fd_text}}"', "", "What do you do with it?"].join("\n"),
          options: mcOptions("fd"),
          select: "single",
          points: 4,
        },
      },
      {
        id: "partial-priv",
        type: MULTIPLE_CHOICE,
        seconds: 180,
        title: "Produce, redact or withhold?",
        config: {
          prompt: [
            "{{pp_doc}} is a responsive email chain, newest message first.",
            "",
            "Message 1 · {{pp_1_date}}",
            "From: {{pp_1_from}}",
            "To: {{pp_1_to}}",
            '"{{pp_1_text}}"',
            "",
            "Message 2 · {{pp_2_date}}",
            "From: {{pp_2_from}}",
            "To: {{pp_2_to}}",
            '"{{pp_2_text}}"',
            "",
            "How should it go out in the production?",
          ].join("\n"),
          options: [
            { id: "produce", label: "Produce it in full" },
            { id: "redact", label: "Produce it with the privileged message redacted, and log the redaction" },
            { id: "withhold", label: "Withhold the whole document and log it" },
            { id: "skip", label: "Leave it uncoded and move on to the next document" },
          ],
          select: "single",
          points: 5,
        },
      },
      rapidStep(3, `Coding round 3: ${ROUND_INTRO}`),
    ],
    messages: [
      {
        id: "m1",
        from: "Review manager, Project Larch, Hale & Corwin LLP",
        subject: "Project Larch: review protocol",
        body: [
          "Hi {{first_name}},",
          "",
          "Welcome to Project Larch. I'm {{manager}}, the review manager. Below is the review protocol; keep it open while you work. Every call today follows it.",
          "",
          "PROJECT LARCH REVIEW PROTOCOL",
          "Brightwater Mills, Inc. v. Larchmont Polymers, Inc., No. {{case_no}}, U.S. District Court for the District of Wexford. Hale & Corwin LLP represents Larchmont.",
          "",
          "1. Review period: {{period_start}} to {{period_end}}, both days included. A document dated outside the period is Not responsive, whatever it says.",
          "2. Responsive: dated in the review period and about one of the issues in section 4. Anything else (HR, IT, facilities, social, other business) is Not responsive.",
          "3. Privileged: (a) a confidential communication between Larchmont people and Larchmont's lawyers asking for or giving legal advice; or (b) work product: a document prepared at the request of counsel for the Brightwater litigation, even with no lawyer on it.",
          "Larchmont's lawyers: {{oc_1}} and {{oc_2}} (Hale & Corwin LLP, outside counsel) and {{ihc}} (Associate General Counsel, Larchmont Legal).",
          "Not privileged: anything sent or copied to someone outside Larchmont and its lawyers (consultants, vendors, Brightwater), and business emails that only copy a lawyer without asking for or giving legal advice. Code privilege on every document.",
          '4. Issue tags. Tag a responsive document with the one issue it is about. Not responsive documents get "No tag".',
          "• {{tag_1}}: {{tag_1_desc}}",
          "• {{tag_2}}: {{tag_2_desc}}",
          "• {{tag_3}}: {{tag_3_desc}}",
          "• {{tag_4}}: {{tag_4_desc}}",
          "5. Hot documents: anything about deleting or not keeping documents, or showing someone at Larchmont knew resin was off-spec before it shipped to Brightwater. Code it Hot and email {{manager}}, the review manager, the doc ID at once. Don't discuss it with anyone else, and never with Larchmont employees.",
          "6. Key custodians: {{cust_1}} ({{cust_1_title}}), {{cust_2}} ({{cust_2_title}}), {{cust_3}} ({{cust_3_title}}), {{cust_4}} ({{cust_4_title}}).",
          "7. Foreign-language documents: don't code them. Tag them Foreign language and route them to the {{fl_queue}} queue.",
          "8. Search strings: use the string that finds every relevant document in the validation sample with the fewest hits.",
          "9. Privilege log: each entry needs the date, the author, every recipient (lawyers marked *), the basis (Attorney-client or Work product) and a description that says what the document is about without revealing the advice. A document with a third party on it isn't privileged: produce it, don't log it.",
          "10. Partial privilege: if only part of a document is privileged, produce it with that part redacted and log the redaction. Withhold in full only when all of it is privileged.",
          "",
          "{{manager}}",
        ].join("\n"),
        arriveAtMinute: 0,
        stepId: "qc-review",
      },
      {
        id: "m2",
        from: "Review manager, Project Larch, Hale & Corwin LLP",
        subject: "QC: {{teammate}}'s batch {{qc_batch}}",
        body: [
          "Before you start coding, please QC a sample of {{teammate}}'s first-pass coding. They're new, and I'd rather catch problems now than at production.",
          "",
          "Flag every document coded wrong, with the reason. Leave the right ones alone: a false alarm costs us re-review time.",
          "",
          "{{manager}}",
        ].join("\n"),
        arriveAtMinute: 0,
        stepId: "qc-review",
      },
      {
        id: "m3",
        from: "Review manager, Project Larch, Hale & Corwin LLP",
        subject: "Coding round 1",
        body: "First coding round: 15 documents from the key custodians' mailboxes, 20 seconds each. Consistency matters more than anything: same facts, same call.\n\n{{manager}}",
        arriveAtMinute: 0,
        stepId: "rapid-1",
      },
      {
        id: "m4",
        from: "Review manager, Project Larch, Hale & Corwin LLP",
        subject: "Search string, estimate and the privilege log",
        body: [
          "Three quick things, one screen each:",
          "• pick the search string for the {{s_tag}} issue from the validation results,",
          "• give me the review estimate for the {{est_tag}} string,",
          "• check my draft privilege log for volume {{log_vol}} before it goes to the other side.",
          "",
          "{{manager}}",
        ].join("\n"),
        arriveAtMinute: 0,
        stepId: "search-terms",
      },
      {
        id: "m5",
        from: "Review manager, Project Larch, Hale & Corwin LLP",
        subject: "Coding round 2",
        body: "Second coding round: another 15 documents, 20 seconds each.\n\n{{manager}}",
        arriveAtMinute: 0,
        stepId: "rapid-2",
      },
      {
        id: "m6",
        from: "Review manager, Project Larch, Hale & Corwin LLP",
        subject: "Three documents that need a decision",
        body: "The coders set aside three documents for you. Each needs a decision under the protocol, one screen each.\n\n{{manager}}",
        arriveAtMinute: 0,
        stepId: "hot-doc",
      },
      {
        id: "m7",
        from: "Review manager, Project Larch, Hale & Corwin LLP",
        subject: "Coding round 3",
        body: "Last coding round: 15 documents, 20 seconds each. Thanks for today.\n\n{{manager}}",
        arriveAtMinute: 0,
        stepId: "rapid-3",
      },
    ],
    sections: [
      { id: "s-qc", title: "Protocol and QC review", minutes: 14, stepIds: ["qc-review"] },
      { id: "s-rapid-1", title: "Coding round 1", minutes: 6, stepIds: ["rapid-1"] },
      { id: "s-search-log", title: "Search terms and privilege log", minutes: 10, stepIds: ["search-terms", "review-estimate", "priv-log"], oneAtATime: true },
      { id: "s-rapid-2", title: "Coding round 2", minutes: 6, stepIds: ["rapid-2"] },
      { id: "s-inbox", title: "Review inbox", minutes: 8, stepIds: ["hot-doc", "foreign-doc", "partial-priv"], oneAtATime: true },
      { id: "s-rapid-3", title: "Coding round 3", minutes: 6, stepIds: ["rapid-3"] },
    ],
  },

  build(rng) {
    const v: Record<string, string | number> = {};

    // ---- People and the protocol ----
    const firsts = rng.shuffle(FIRST);
    const lasts = rng.shuffle(LAST);
    const names = firsts.map((f, i) => `${f} ${lasts[i]}`);
    const person = (name: string, org: string): Person => ({ name, org, lawyer: org === OUTSIDE || org === IN_HOUSE, third: org !== CLIENT && org !== OUTSIDE && org !== IN_HOUSE });
    const [manager, teammate, oc1, oc2, ihc, c1, c2, c3, c4, t1, t2, t3, oppName] = names;
    const lawyers = [person(oc1, OUTSIDE), person(oc2, OUTSIDE), person(ihc, IN_HOUSE)];
    const custodians = [c1, c2, c3, c4].map((n) => person(n, CLIENT));
    const thirdOrgs = rng.shuffle(THIRD_ORGS);
    const thirds = [t1, t2, t3].map((n, i) => person(n, thirdOrgs[i]));
    const opp = person(oppName, "Brightwater Mills");
    const titles = rng.shuffle(TITLES);

    const start = Date.UTC(2023, rng.int(0, 11), rng.int(1, 28)) / DAY;
    const end = start + rng.int(420, 640);
    const tags: TopicId[] = rng.shuffle<TopicId>(["quality", ...rng.shuffle<TopicId>(["pricing", "termination", "delivery", "inspection", "insurance"]).slice(0, 3)]);
    const others = TOPICS.map((t) => t.id).filter((id) => !tags.includes(id));
    const queues = rng.shuffle(QUEUES);
    const tagLabel = (id: TopicId | null) => (id ? topic(id).label : "No tag");
    const tagChoice = (id: TopicId | null) => (id ? TAG_IDS[tags.indexOf(id)] : "none");

    Object.assign(v, {
      manager,
      teammate,
      oc_1: oc1,
      oc_2: oc2,
      ihc,
      case_no: `${rng.int(1, 4)}:${rng.int(23, 25)}-cv-${String(rng.int(100, 2999)).padStart(5, "0")}`,
      period_start: fmtDay(start),
      period_end: fmtDay(end),
      fl_queue: queues[0],
      qc_batch: `LR-${rng.int(100, 999)}`,
      log_vol: `LARCH-PROD-${String(rng.int(2, 9)).padStart(3, "0")}`,
    });
    tags.forEach((id, i) => {
      v[`tag_${i + 1}`] = topic(id).label;
      v[`tag_${i + 1}_desc`] = topic(id).desc;
    });
    custodians.forEach((p, i) => {
      v[`cust_${i + 1}`] = p.name;
      v[`cust_${i + 1}_title`] = titles[i];
    });

    const c: Ctx = { rng, start, end, tags, others, custodians, lawyers, thirds, opp, ids: new Set() };
    const docValues = (p: string, d: Doc) =>
      Object.assign(v, {
        [`${p}_doc`]: d.id,
        [`${p}_type`]: d.type,
        [`${p}_date`]: fmtDay(d.date),
        [`${p}_from`]: list(d.from),
        [`${p}_to`]: list(d.to),
        [`${p}_cc`]: list(d.cc),
        [`${p}_subject`]: d.subject,
        [`${p}_text`]: d.text,
      });
    const tagOf = (d: Doc) => (d.responsive ? d.about : null);

    // ---- QC sample: 20 documents, six miscoded ----
    const hotSnips = rng.shuffle(HOT);
    const seen = new Set<string>();
    const qcDocs = rng.shuffle(QC_PLAN).map((plan) => {
      for (let tries = 0; ; tries++) {
        if (tries > 50) throw new Error("ediscovery-larch-review: no distinct QC document");
        const d = makeDoc(c, plan.kind, plan.kind === "hot" ? hotSnips[plan.miscode ? 0 : 1] : undefined);
        const sig = `${d.subject}\n${d.text}`;
        if (seen.has(sig)) continue;
        seen.add(sig);
        return { plan, d };
      }
    });
    const qcFindings: Record<string, { targets: string[]; reasons: string[]; note: string }> = {};
    qcDocs.forEach(({ plan, d }, i) => {
      const rowId = `q${slotNo(i)}`;
      const coded = { responsive: d.responsive, privileged: d.privileged, tag: tagOf(d), hot: d.hot };
      const m = plan.miscode;
      let note = "";
      if (m === "outside") {
        Object.assign(coded, { responsive: true, tag: d.about });
        note = `${d.id} is dated ${fmtDay(d.date)}, outside the review period: Not responsive, No tag.`;
      } else if (m === "not_issue") {
        Object.assign(coded, { responsive: true, tag: rng.pick(tags) });
        note = `${d.id} is about ${topic(d.about!).label.toLowerCase()}, which isn't an issue tag: Not responsive.`;
      } else if (m === "waived") {
        coded.privileged = true;
        note = `${d.id} copies ${d.cc.map(show).join(", ")}, outside Larchmont and its lawyers: not privileged.`;
      } else if (m === "missed_priv") {
        coded.privileged = false;
        note = `${d.id} is between Larchmont and its lawyer about legal advice, nobody else on it: privileged.`;
      } else if (m === "hot") {
        coded.hot = false;
        note = `${d.id} meets the hot rule (protocol section 5): code it Hot and tell the review manager.`;
      } else if (m === "tag") {
        coded.tag = rng.pick(tags.filter((t) => t !== d.about));
        note = `${d.id} is about ${topic(d.about!).label.toLowerCase()}, not ${topic(coded.tag!).label.toLowerCase()}.`;
      }
      if (m) {
        const f = QC_FINDINGS.find((x) => x.id === m)!;
        qcFindings[f.id] = { targets: [rowId], reasons: [f.reason], note };
      }
      const yn = (b: boolean) => (b ? "Yes" : "No");
      const cells = [d.id, fmtDay(d.date), list(d.from), list(d.to), list(d.cc), d.subject, d.text, yn(coded.responsive), yn(coded.privileged), tagLabel(coded.tag), yn(coded.hot)];
      cells.forEach((cell, j) => {
        v[`qc_${slotNo(i)}_${j}`] = cell;
      });
    });

    // ---- Coding rounds ----
    type RapidKey = Record<string, Record<string, { choice: string }>>;
    const rapidKeys: Record<string, { items: RapidKey }> = {};
    for (const round of [1, 2, 3] as const) {
      const kinds = fillSlots(rng.shuffle(EASY), rng.shuffle(HARD));
      const items: RapidKey = {};
      kinds.forEach((kind, i) => {
        const d = makeDoc(c, kind);
        docValues(`c${round}_${slotNo(i)}`, d);
        items[`c${round}-${slotNo(i)}`] = {
          responsive: { choice: d.responsive ? "yes" : "no" },
          privileged: { choice: d.privileged ? "yes" : "no" },
          tag: { choice: tagChoice(tagOf(d)) },
        };
      });
      rapidKeys[`rapid-${round}`] = { items };
    }

    // ---- Search terms ----
    const [searchTopic, estTopic] = rng.shuffle(tags);
    const st = topic(searchTopic).search;
    const rel = rng.int(40, 90);
    const narrowRel = rel - rng.int(6, 15);
    const strictRel = rel - rng.int(16, 30);
    const label = (q: string, hits: number, r: number) => `${q}: ${hits.toLocaleString("en-US")} hits, ${r} of ${rel} relevant`;
    Object.assign(v, { s_tag: topic(searchTopic).label, s_sample: rng.int(12, 30) * 100, s_rel: rel });
    const searchRight = shuffleOptions(rng, "s", v, label(`(${st.a} OR ${st.b}) w/15 ${st.ctx}`, rel + rng.int(3, 20), rel), [
      label(`${st.a} OR ${st.b} OR ${st.broad}`, rel * rng.int(3, 6) + rng.int(0, 30), rel),
      label(`${st.b} w/15 ${st.ctx}`, narrowRel + rng.int(1, 5), narrowRel),
      label(`${st.a} AND ${st.b}`, strictRel + rng.int(0, 3), strictRel),
    ]);

    // ---- Review estimate ----
    const sample = rng.int(8, 20) * 250;
    const hits = rng.int(Math.round(sample * 0.04), Math.round(sample * 0.15));
    const scale = rng.int(40, 160);
    const rate = rng.pick([40, 45, 50, 55, 60]);
    const estDocs = hits * scale;
    const estHours = Math.round((estDocs / rate) * 10) / 10;
    Object.assign(v, { est_tag: topic(estTopic).label, est_sample: sample, est_hits: hits, est_collection: sample * scale, est_rate: rate });

    // ---- Privilege log ----
    const logFindings: Record<string, { targets: string[]; reasons: string[]; note: string }> = {};
    rng.shuffle(LOG_KINDS).forEach((kind, i) => {
      const t = topic(rng.pick(tags));
      const [a, b] = rng.shuffle(custodians);
      const lawyer = rng.pick(lawyers);
      const outsideCounsel = rng.pick(lawyers.filter((p) => p.org === OUTSIDE));
      let author = [a];
      let recipients = [lawyer];
      let basis = "Attorney-client";
      let type = "Email";
      let description = `Email requesting legal advice regarding ${t.phrase}.`;
      let note = "";
      if (kind === "ok_advice" || kind === "reveals") {
        author = [lawyer];
        recipients = [a];
        description = kind === "reveals" ? `Email from counsel advising that ${t.reveal}.` : `Email providing legal advice regarding ${t.phrase}.`;
        if (kind === "reveals") note = "The description gives away the advice itself; say only what it is about.";
      } else if (kind === "ok_wp") {
        recipients = [outsideCounsel];
        basis = "Work product";
        type = "Memo";
        description = `Memo prepared at the request of counsel for the Brightwater litigation regarding ${t.phrase}.`;
      } else if (kind === "incomplete") {
        if (rng.int(0, 1)) author = [];
        else {
          author = [lawyer];
          recipients = [];
        }
        note = `Entry ${i + 1} has no ${author.length ? "recipients" : "author"}.`;
      } else if (kind === "vague") {
        description = rng.pick(VAGUE);
        note = "The description doesn't say what the document is about.";
      } else if (kind === "basis") {
        recipients = [b];
        description = `Email regarding ${t.phrase}.`;
        note = "No lawyer is the author or a recipient, so attorney-client privilege can't apply.";
      } else if (kind === "waived") {
        recipients = [lawyer, rng.pick(thirds)];
        note = `${recipients[1].name} (${recipients[1].org}) is a third party: produce the document, don't log it.`;
      }
      const cells = [String(i + 1), docId(c), fmtDay(inPeriod(c)), type, logList(author), logList(recipients), basis, description];
      cells.forEach((cell, j) => {
        v[`log_${i + 1}_${j}`] = cell;
      });
      if (!kind.startsWith("ok_")) logFindings[kind] = { targets: [`e${i + 1}`], reasons: [kind], note };
    });

    // ---- Review inbox ----
    const hot = makeDoc(c, "hot", hotSnips[2]);
    Object.assign(v, { hd_doc: hot.id, hd_date: fmtDay(hot.date), hd_from: list(hot.from), hd_to: list(hot.to), hd_subject: hot.subject, hd_text: hot.text });
    const hotRight = shuffleOptions(rng, "hd", v, `Code it Hot and email ${manager} the doc ID right away; don't discuss it with anyone else`, [
      `Email ${hot.from[0].name} at Larchmont to ask what they meant before coding it`,
      "Code it and carry on; hot documents get picked up in the weekly QC report",
      "Forward the document to the whole review team so everyone looks out for similar ones",
    ]);

    const fl = rng.pick(FOREIGN);
    Object.assign(v, { fd_doc: docId(c), fd_custodian: rng.pick(custodians).name, fd_lang: fl.lang, fd_text: fl.text(rng.int(4100, 9899)) });
    const fdRight = shuffleOptions(rng, "fd", v, `Tag it Foreign language and route it to the ${queues[0]} queue without coding it`, [
      `Tag it Foreign language and route it to the ${queues[1]} queue without coding it`,
      "Code it Not responsive: nobody on the team can read it",
      "Paste it into a free online translator and code it from the translation",
    ]);

    const ppCase = rng.pick(["redact", "withhold", "produce"] as const);
    const ppTopic = topic(rng.pick(tags));
    const [ppA, ppB] = rng.shuffle(custodians);
    const ppLawyer = rng.pick(lawyers);
    const ppX = params(c, ppLawyer);
    const d2 = inPeriod(c);
    const ppTo = { redact: ppB, withhold: ppLawyer, produce: rng.pick(thirds) }[ppCase];
    const ppText = {
      redact: `Forwarding ${firstName(ppLawyer)}'s note below. Let's hold firm with Brightwater for now.`,
      withhold: `${firstName(ppLawyer)}, thanks. Could you advise on next steps before Friday?`,
      produce: `Forwarding ${firstName(ppLawyer)}'s note below so you can plan around it.`,
    }[ppCase];
    Object.assign(v, {
      pp_doc: docId(c),
      pp_1_date: fmtDay(d2 + rng.int(1, 6)),
      pp_1_from: show(ppA),
      pp_1_to: show(ppTo),
      pp_1_text: ppText,
      pp_2_date: fmtDay(d2),
      pp_2_from: show(ppLawyer),
      pp_2_to: show(ppA),
      pp_2_text: rng.pick(ppTopic.advice)(ppX)[1],
    });

    const review = (findings: Record<string, { targets: string[]; reasons: string[]; note: string }>) => ({ findings });
    return {
      values: v,
      keys: {
        ...rapidKeys,
        "qc-review": review(qcFindings),
        "search-terms": { correct: [searchRight] },
        "review-estimate": { tolerance: 0, cells: { est_docs: { value: estDocs, tolerance: 0.5 }, est_hours: { value: estHours, tolerance: 0.05 } } },
        "priv-log": review(logFindings),
        "hot-doc": { correct: [hotRight] },
        "foreign-doc": { correct: [fdRight] },
        "partial-priv": { correct: [ppCase] },
      },
    };
  },
});
