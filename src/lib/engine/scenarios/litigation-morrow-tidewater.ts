import "server-only";

import type { Rng } from "../server/rng";
import { defineScenario } from "../server/scenario";
import { DOCUMENT_REVIEW } from "../step-types/document_review/public";
import { MULTIPLE_CHOICE } from "../step-types/multiple_choice/public";
import { RAPID_ROUND } from "../step-types/rapid_round/public";
import {
  CASE_COMPANIES,
  CLIENT_COMPANIES,
  COURTS,
  LAST_NAMES,
  LAW_FIRMS,
  addDays,
  companyDomain,
  computeDeadline,
  courtDaysAfter,
  daysBetween,
  distinctPeople,
  emailFor,
  formatCaseCitation,
  formatDate,
  holidaysBetween,
  isLegalHoliday,
  isWeekend,
  nextCourtDay,
  pickDistinct,
  previousCourtDay,
  type CaseCite,
  type CourtId,
  type IsoDate,
  type PersonName,
} from "./legal";

/**
 * Litigation paralegal at a plaintiff's firm: Morrow Provisions, LLC v.
 * Tidewater Freight Lines, Inc., a cargo-damage case in the (fictional) U.S.
 * District Court for the District of Wexford. Six timed sections, 52 minutes,
 * 100 points, all scored automatically:
 *
 *   rapid round A, deadlines (10) → privilege review of a production volume (20)
 *   → rapid round B, citation format (10) → cite-check of a brief's table of
 *   authorities (20) → rapid round C, procedure (10) → trial prep, one screen
 *   at a time: exhibit list vs. binder (15), then three inbox calls (7 + 4 + 4).
 *
 * Seeded per candidate: every name, firm, date, Bates number, citation, page
 * and holding; which documents and authorities carry which trap; the deadline
 * dates, periods and service methods; which filing steps the local rule needs;
 * and where the right option sits. Deadlines come from the shared FRCP 6 helper
 * (./legal/dates.ts) over the real federal holiday calendar; the citation guide
 * is the firm's own (./legal/citations.ts) with fictional courts and reporters.
 *
 * Rapid rounds: 15 items × 20 s. Items 3, 6, 9, 12, 15 are the harder kinds,
 * worth 1; the other ten are worth ½, so each round is exactly 10.
 *
 * Draft v1: team self-review pending (docs/paralegal/litigation-morrow-tidewater.md).
 */

const CLIENT = "Morrow Provisions, LLC";
const CLIENT_DOMAIN = "morrowprovisions.example";
const DEFENDANT = "Tidewater Freight Lines, Inc.";
const TW_DOMAIN = "tidewaterfreight.example";
const LETTERS = ["a", "b", "c", "d"] as const;
const CITIES = ["Port Ellery", "Ashcombe", "New Harlow", "Kingsferry", "Dunmore Falls", "Westbrook Junction", "Carrow Bay", "Millhaven"];

type Values = Record<string, string | number>;
type ChoiceKey = Record<string, { choice: string } | { value: number; tolerance: number }>;

// ---- Rapid round plumbing ----

const RAPID_ITEMS = 15;
/** Items 3, 6, 9, 12 and 15 are worth 1; the rest ½. 10 points a round. */
const isHardSlot = (i: number) => i % 3 === 2;
const slotNo = (i: number) => String(i + 1).padStart(2, "0");

function fillSlots<T>(easy: T[], hard: T[]): T[] {
  const e = [...easy];
  const h = [...hard];
  const out = Array.from({ length: RAPID_ITEMS }, (_, i) => (isHardSlot(i) ? h.shift() : e.shift()));
  if (out.some((x) => x === undefined) || e.length || h.length) throw new Error("litigation-morrow-tidewater: rapid slots don't fill");
  return out as T[];
}

function rapidItems(prefix: string, item: (n: string, i: number) => object) {
  return Array.from({ length: RAPID_ITEMS }, (_, i) => ({ id: `${prefix}-${slotNo(i)}`, ...item(slotNo(i), i), points: isHardSlot(i) ? 1 : 0.5 }));
}

const letterOptions = (name: string) => LETTERS.map((l) => ({ id: l, label: `{{${name}_${l}}}` }));

/** Puts `right` among `wrong` in a random place; returns the labels by letter and the right letter. */
function placeOptions(rng: Rng, right: string, wrong: string[]): { labels: string[]; letter: string } {
  if (wrong.length !== 3 || new Set([right, ...wrong]).size !== 4) throw new Error(`litigation-morrow-tidewater: options must be 4 different labels (${right})`);
  const labels = rng.shuffle([right, ...wrong]);
  return { labels, letter: LETTERS[labels.indexOf(right)] };
}

// ---- Rapid round A: deadlines (FRCP 6) ----

interface DeadlineRule {
  event: string;
  rule: string;
  days: number;
  /** The period runs from service, so the service method matters (FRCP 6(d)). */
  served: boolean;
}

const DEADLINE_RULES: DeadlineRule[] = [
  { event: "Complaint and summons served on Tidewater", rule: "Answer due 21 days after service (FRCP 12(a)(1)(A)(i))", days: 21, served: true },
  { event: "Tidewater's counterclaim served on Morrow", rule: "Answer to the counterclaim due 21 days after service (FRCP 12(a)(1)(B))", days: 21, served: true },
  { event: "Tidewater's answer served on Morrow", rule: "Amended complaint as of course due 21 days after service of the answer (FRCP 15(a)(1)(B))", days: 21, served: true },
  { event: "Tidewater's interrogatories served on Morrow", rule: "Answers and objections due 30 days after service (FRCP 33(b)(2))", days: 30, served: true },
  { event: "Tidewater's requests for production served on Morrow", rule: "Written response due 30 days after service (FRCP 34(b)(2)(A))", days: 30, served: true },
  { event: "Tidewater's requests for admission served on Morrow", rule: "Answers due 30 days after service (FRCP 36(a)(3))", days: 30, served: true },
  { event: "Tidewater's motion to dismiss served on Morrow", rule: "Opposition due 14 days after service (D. Wex. L.R. 7.1(b))", days: 14, served: true },
  { event: "Morrow's opposition served on Tidewater", rule: "Tidewater's reply due 7 days after service (D. Wex. L.R. 7.1(c))", days: 7, served: true },
  { event: "Magistrate judge's report and recommendation served", rule: "Objections due 14 days after service (FRCP 72(b)(2))", days: 14, served: true },
  { event: "Judgment entered on the docket", rule: "Motion for a new trial due 28 days after entry of judgment (FRCP 59(b))", days: 28, served: false },
  { event: "Judgment entered on the docket", rule: "Notice of appeal due 30 days after entry of judgment (FRAP 4(a)(1)(A))", days: 30, served: false },
  { event: "Rule 26(f) conference held", rule: "Initial disclosures due 14 days after the conference (FRCP 26(a)(1)(C))", days: 14, served: false },
  {
    event: "Request to waive service sent to Tidewater",
    rule: "Answer due 60 days after the request was sent, if service is waived (FRCP 12(a)(1)(A)(ii))",
    days: 60,
    served: false,
  },
];

const SERVICE_TEXT = {
  hand: "Served by hand delivery (FRCP 5(b)(2)(A))",
  efile: "Served through the court's e-filing system (FRCP 5(b)(2)(E))",
  mail: "Served by U.S. mail (FRCP 5(b)(2)(C))",
  none: "Not a service date: the period runs from the event itself",
} as const;

type DeadlineKind = "plain" | "weekend" | "holiday" | "mail";
const DL_EASY: DeadlineKind[] = ["plain", "plain", "plain", "plain", "plain", "plain", "weekend", "weekend", "weekend", "weekend"];
const DL_HARD: DeadlineKind[] = ["holiday", "holiday", "holiday", "mail", "mail"];
/** Docket entries fall between these dates, so every period stays inside the verified holiday years. */
const DL_FIRST = "2026-09-01";
const DL_SPAN_DAYS = 780;

const rapidDeadlineStep = {
  id: "rapid-deadlines",
  type: RAPID_ROUND,
  title: "Rapid round: deadlines",
  config: {
    intro: [
      "Deadlines: 15 docket entries, 20 seconds each. Pick the date you calendar as the deadline.",
      "FRCP 6(a): don't count the day of the event; count every day after it, weekends and holidays included; if the last day is a Saturday, Sunday or court holiday, the deadline moves to the next court day. Service by U.S. mail adds 3 days after that (FRCP 6(d)); e-service adds none. Wexford has no court holidays beyond the federal ones.",
    ].join("\n"),
    secondsPerItem: 20,
    items: rapidItems("dl", (n) => ({
      prompt: "Which date do you calendar as the deadline?",
      exhibit: {
        title: "Docket entry",
        rows: [
          { label: "Event", value: `{{dl_${n}_event}}` },
          { label: "Date of the event", value: `{{dl_${n}_date}}` },
          { label: "Rule", value: `{{dl_${n}_rule}}` },
          { label: "Service", value: `{{dl_${n}_service}}` },
          { label: "Court holidays in the window", value: `{{dl_${n}_hols}}` },
        ],
      },
      fields: [{ id: "due", label: "Deadline", kind: "choice", options: letterOptions(`dl_${n}`) }],
    })),
  },
};

function buildDeadlines(rng: Rng, v: Values): Record<string, ChoiceKey> {
  const kinds = fillSlots(rng.shuffle(DL_EASY), rng.shuffle(DL_HARD));
  return Object.fromEntries(
    kinds.map((kind, i) => {
      const n = slotNo(i);
      for (let tries = 0; ; tries++) {
        if (tries > 5_000) throw new Error(`litigation-morrow-tidewater: no ${kind} deadline`);
        const rule = rng.pick(kind === "mail" ? DEADLINE_RULES.filter((r) => r.served) : DEADLINE_RULES);
        const from = addDays(DL_FIRST, rng.int(0, DL_SPAN_DAYS));
        if (isWeekend(from) || isLegalHoliday(from)) continue;
        const method = kind === "mail" ? "mail" : rule.served ? rng.pick(["hand", "efile"] as const) : "none";
        const mail = method === "mail";
        const dl = computeDeadline({ from, days: rule.days, mailService: mail });
        const holidayRoll = holidaysBetween(dl.periodEnds, dl.due).length > 0;
        const fits = {
          plain: dl.due === dl.periodEnds,
          weekend: isWeekend(dl.periodEnds) && !holidayRoll,
          holiday: holidayRoll,
          mail,
        }[kind];
        if (!fits) continue;

        // Wrong dates a hurried docketing clerk might pick, most tempting first.
        const extra = mail ? 3 : 0;
        const unrolled = addDays(from, rule.days + extra);
        const tempting = [
          unrolled, // didn't move off the weekend or holiday
          previousCourtDay(unrolled), // moved backward instead of forward
          nextCourtDay(addDays(from, rule.days - 1 + extra)), // counted the day of the event
          mail ? dl.lastDay : nextCourtDay(addDays(dl.due, 3)), // forgot the mail days, or added them for e-service
          courtDaysAfter(from, rule.days), // counted court days only
          nextCourtDay(addDays(dl.due, 1)),
          previousCourtDay(addDays(dl.due, -1)),
          addDays(dl.due, 7),
        ];
        const wrong = [...new Set(tempting)].filter((d) => d !== dl.due).slice(0, 3);
        const { labels, letter } = placeOptions(rng, formatDate(dl.due), wrong.map((d) => formatDate(d)));
        const window = holidaysBetween(from, addDays(from, rule.days + 13));
        Object.assign(v, {
          [`dl_${n}_event`]: rule.event,
          [`dl_${n}_date`]: formatDate(from),
          [`dl_${n}_rule`]: rule.rule,
          [`dl_${n}_service`]: SERVICE_TEXT[method],
          [`dl_${n}_hols`]: window.length ? window.map((h) => `${formatDate(h.date)} (${h.name})`).join("; ") : "None",
          ...Object.fromEntries(LETTERS.map((l, j) => [`dl_${n}_${l}`, labels[j]])),
        });
        return [`dl-${n}`, { due: { choice: letter } }];
      }
    }),
  );
}

// ---- Case names and holdings (cite-check and rapid round B) ----

/** A unique fictional case name: "Surname v. Company", "Company v. Company" or "Surname v. Surname". */
function caseName(rng: Rng, used: Set<string>): string {
  for (;;) {
    const form = rng.int(0, 9);
    const name =
      form < 6
        ? `${rng.pick(LAST_NAMES)} v. ${rng.pick(CASE_COMPANIES)}`
        : form < 8
          ? `${rng.pick(CASE_COMPANIES)} v. ${rng.pick(CASE_COMPANIES)}`
          : `${rng.pick(LAST_NAMES)} v. ${rng.pick(LAST_NAMES)}`;
    const [a, b] = name.split(" v. ");
    if (a === b || used.has(name) || [...used].some((u) => u.split(" v. ")[0] === a)) continue;
    used.add(name);
    return name;
  }
}

/** A reported decision with its page range and the page its holding is on. */
interface Report extends CaseCite {
  lastPage: number;
  pin: number;
}

function report(rng: Rng, name: string, court: CourtId, years: [number, number] = [1996, 2024]): Report {
  const reporter = rng.pick(COURTS[court].reporters);
  const firstPage = rng.int(40, 1_400);
  const lastPage = firstPage + rng.int(8, 32);
  return { name, court, reporter, volume: rng.int(6, 420), firstPage, lastPage, pin: rng.int(firstPage + 2, lastPage), year: rng.int(years[0], years[1]) };
}

/** [what the court held, a misquote that changes its meaning]. Fictional holdings about cargo claims and discovery. */
const HOLDINGS: [string, string][] = [
  [
    "a carrier that accepts goods in good condition and delivers them damaged must show it was not negligent",
    "a shipper that delivers goods in good condition must show the carrier was negligent",
  ],
  [
    "a limit on liability in a bill of lading binds the shipper only if it had a fair chance to choose more coverage",
    "a limit on liability in a bill of lading binds the shipper whether or not it had a chance to choose more coverage",
  ],
  ["temperature logs kept in the ordinary course of business are business records", "temperature logs prepared for litigation are business records"],
  [
    "a party must preserve electronically stored information once litigation is reasonably anticipated",
    "a party must preserve electronically stored information once a complaint is filed",
  ],
  [
    "lost profits from spoiled perishable cargo are recoverable when the carrier knew the goods were perishable",
    "lost profits from spoiled perishable cargo are never recoverable from the carrier",
  ],
  ["a written claim filed within nine months of delivery satisfies the bill of lading", "a written claim must be filed within ninety days of delivery"],
  ["a refrigeration unit failure is not an act of God", "a refrigeration unit failure is an act of God"],
  ["the economic loss rule bars tort claims that only restate a breach of contract", "the economic loss rule never bars tort claims against a carrier"],
  [
    "a company's designated deponent must be prepared on information reasonably available to the company",
    "a company's designated deponent need testify only from personal knowledge",
  ],
  [
    "an adverse inference for lost electronic data requires a finding of intent to deprive",
    "an adverse inference for lost electronic data requires only a finding of negligence",
  ],
  ["a broker that never takes possession of the cargo is not a carrier", "a broker that arranges transport is always a carrier"],
  ["prejudgment interest on a cargo claim runs from the date of delivery", "prejudgment interest on a cargo claim runs from the date of judgment"],
  ["a consignee that bore the risk of loss may sue the carrier", "only the shipper may sue the carrier for cargo loss"],
];

// ---- Rapid round B: citation format ----

const CITE_OPTIONS = [
  { id: "ok", label: "Correct as written" },
  { id: "name", label: "Case name" },
  { id: "reporter", label: "Volume or reporter" },
  { id: "pages", label: "First page or pin cite" },
  { id: "paren", label: "Court or year (the parenthetical)" },
];

const GUIDE_LINE = [
  "Name v. Name, volume reporter first page, pin (court year).",
  `Courts: ${COURTS["14th-cir"].name} = ${COURTS["14th-cir"].abbr}; ${COURTS["d-wex"].name} = ${COURTS["d-wex"].abbr}; ${COURTS["wex-sup"].name} = year only: its reporters (${COURTS["wex-sup"].reporters.join(", ")}) name the court.`,
].join(" ");

type CiteKind = "ok" | "name" | "reporter" | "year" | "first_page" | "pin" | "wex_court" | "wex_ok" | "wrong_court";
const CITE_EASY: CiteKind[] = ["ok", "ok", "ok", "name", "name", "reporter", "reporter", "year", "year", "first_page"];
const CITE_HARD: CiteKind[] = ["pin", "pin", "wex_court", "wex_ok", "wrong_court"];
const CITE_PART: Record<CiteKind, string> = {
  ok: "ok",
  wex_ok: "ok",
  name: "name",
  reporter: "reporter",
  year: "paren",
  wex_court: "paren",
  wrong_court: "paren",
  first_page: "pages",
  pin: "pages",
};

const rapidCiteStep = {
  id: "rapid-citations",
  type: RAPID_ROUND,
  title: "Rapid round: citation format",
  config: {
    intro:
      "Citation format: 15 citations from a brief, 20 seconds each. Compare each one with the research file and the firm's citation guide, and pick the part that's wrong, or \"Correct as written\".",
    secondsPerItem: 20,
    items: rapidItems("cf", (n) => ({
      prompt: "Does the citation follow the firm's guide and match the research file? If not, which part is wrong?",
      exhibit: {
        title: "Cite check",
        rows: [
          { label: "Research file", value: `{{cf_${n}_file}}` },
          { label: "As written in the brief", value: `{{cf_${n}_cite}}` },
          { label: "Firm citation guide", value: GUIDE_LINE },
        ],
      },
      fields: [{ id: "part", label: "What's wrong?", kind: "choice", options: CITE_OPTIONS }],
    })),
  },
};

const NON_WEX: CourtId[] = ["14th-cir", "d-wex"];

function buildCitations(rng: Rng, v: Values): Record<string, ChoiceKey> {
  const kinds = fillSlots(rng.shuffle(CITE_EASY), rng.shuffle(CITE_HARD));
  const used = new Set<string>();
  return Object.fromEntries(
    kinds.map((kind, i) => {
      const n = slotNo(i);
      const court: CourtId =
        kind === "wex_court" || kind === "wex_ok" ? "wex-sup" : kind === "ok" || kind === "wrong_court" ? rng.pick(NON_WEX) : rng.pick(Object.keys(COURTS) as CourtId[]);
      const c = report(rng, caseName(rng, used), court);
      let { name, volume, reporter, firstPage, pin, year } = c;
      let paren = court === "wex-sup" ? `(${year})` : `(${COURTS[court].abbr} ${year})`;
      switch (kind) {
        case "name":
          name = c.name.replace(" v. ", rng.pick([" vs. ", " v "]));
          break;
        case "reporter": {
          const other = COURTS[court].reporters.find((r) => r !== c.reporter);
          if (other && rng.int(0, 1)) reporter = other;
          else volume = c.volume + rng.pick([-1, 1]) * rng.int(1, 5);
          break;
        }
        case "year":
          year = c.year + rng.pick([-1, 1]) * rng.int(1, 3);
          paren = court === "wex-sup" ? `(${year})` : `(${COURTS[court].abbr} ${year})`;
          break;
        case "first_page":
          firstPage = c.firstPage + rng.pick([-1, 1]) * rng.int(1, 9);
          break;
        case "pin": {
          // Transposed digits when that gives another page, else a nearby page.
          const swapped = Number(String(c.pin).replace(/(\d)(\d)$/, "$2$1"));
          pin = swapped !== c.pin && swapped >= 1 ? swapped : c.pin + rng.pick([-1, 1]) * rng.int(1, 6);
          break;
        }
        case "wex_court":
          paren = `(Wex. ${year})`;
          break;
        case "wrong_court":
          paren = `(${COURTS[NON_WEX.find((x) => x !== court)!].abbr} ${year})`;
          break;
      }
      const cite = kind === "ok" || kind === "wex_ok" ? formatCaseCitation(c, c.pin) : `${name}, ${volume} ${reporter} ${firstPage}, ${pin} ${paren}`;
      Object.assign(v, {
        [`cf_${n}_file`]: `${c.name} · ${COURTS[court].name} · decided ${c.year} · ${c.volume} ${c.reporter}, pages ${c.firstPage}–${c.lastPage} · the point is at page ${c.pin}`,
        [`cf_${n}_cite`]: cite,
      });
      return [`cf-${n}`, { part: { choice: CITE_PART[kind] } }];
    }),
  );
}

// ---- Rapid round C: procedure ----
// The two number answers stay in single digits: the leak tests read key numbers as
// cents too, and a two-digit answer's cents form (e.g. 1200) could match a page number.

interface People {
  partner: PersonName;
  associate: PersonName;
  gm: PersonName;
  ops: PersonName;
  controller: PersonName;
  dispatcher: PersonName;
  claims: PersonName;
  vendorRep: PersonName;
  oppPara: PersonName;
  expert: PersonName;
  assistant: PersonName;
  deponents: PersonName[];
}

interface ProcedureQuestion {
  prompt: (p: People, opp: string, vendor: string) => string;
  right: string;
  wrong: [string, string, string];
}

const PROC_EASY: ProcedureQuestion[] = [
  {
    prompt: (p) => `${p.associate.full} wrote a memo analyzing Morrow's trial strategy. What mainly protects it from discovery?`,
    right: "The work-product doctrine",
    wrong: ["Nothing: internal memos are always discoverable", "The common-interest doctrine", "FRCP 11"],
  },
  {
    prompt: () => "Which step starts a civil case in federal court (FRCP 3)?",
    right: "Filing a complaint with the court",
    wrong: ["Serving a summons", "Filing an answer", "Filing a notice of appearance"],
  },
  {
    prompt: () => "Tidewater served interrogatories on Morrow through the court's e-filing system. How many days do you add for the service method?",
    right: "None: e-service adds no days",
    wrong: ["3 days", "5 days", "7 days"],
  },
  {
    prompt: (_, opp) => `Tidewater is represented by ${opp}. Who must Morrow serve its discovery responses on?`,
    right: "Tidewater's counsel of record",
    wrong: ["Tidewater's CEO directly", "The clerk of court", "The judge's chambers"],
  },
  {
    prompt: () => "Should Morrow's interrogatory answers be filed with the court?",
    right: "No: serve them, and file only when used in the case",
    wrong: ["Yes, within 7 days of service", "Yes, under seal", "Only with a certificate of service"],
  },
  {
    prompt: (p) => `${p.ops.full} realizes a privileged email went out in a production by mistake. What is the process to get it back called?`,
    right: "Clawback",
    wrong: ["Spoliation", "Remittitur", "Impleader"],
  },
  {
    prompt: () => "What does a subpoena duces tecum require?",
    right: "Producing documents or things",
    wrong: ["Appearing to testify only", "Admitting facts", "Paying the other side's costs"],
  },
  {
    prompt: () => "What is a Bates number?",
    right: "A unique number stamped on each produced page",
    wrong: ["The court's docket number", "The trial exhibit number", "The judge's courtroom number"],
  },
  {
    prompt: (p) => `${p.deponents[1].full}, a former Tidewater dispatcher, isn't a party. How does Morrow get their documents?`,
    right: "A subpoena under FRCP 45",
    wrong: ["Requests for production under FRCP 34", "Interrogatories under FRCP 33", "Requests for admission under FRCP 36"],
  },
  {
    prompt: () => "What does a certificate of service show?",
    right: "When, how and on whom a paper was served",
    wrong: ["That the clerk accepted the filing", "That the client approved the paper", "That the filing fee was paid"],
  },
  {
    prompt: () => "Which of these is a dispositive motion?",
    right: "Motion for summary judgment",
    wrong: ["Motion to compel discovery", "Motion for an extension of time", "Motion to appear pro hac vice"],
  },
  {
    prompt: () => "A litigation hold notice tells Morrow's staff to…",
    right: "Keep every document and file that may be relevant",
    wrong: ["Stop sending business emails", "Delete drafts and duplicates", "Send their files to Tidewater's counsel"],
  },
  {
    prompt: () => "Who signs Morrow's pleadings under FRCP 11?",
    right: "An attorney of record",
    wrong: ["The paralegal who drafted them", "Any employee of the firm", "The clerk of court"],
  },
];

const PROC_HARD: ProcedureQuestion[] = [
  {
    prompt: (p, _, vendor) =>
      `Morrow's general manager forwarded ${p.partner.full}'s advice email to ${p.vendorRep.full} at ${vendor}. Is the email still privileged?`,
    right: "Probably not: sharing it with an outsider can waive privilege",
    wrong: ["Yes: forwarding never waives privilege", "Yes, if the subject line says confidential", "Only the attachments lose privilege"],
  },
  {
    prompt: (p) => `How much notice does FRCP 30(b)(1) require for the deposition of ${p.deponents[0].full}?`,
    right: "Reasonable written notice to every party",
    wrong: ["Exactly 14 days", "30 days", "None if a subpoena is served"],
  },
  {
    prompt: () => "Morrow misses the 30-day deadline to answer Tidewater's requests for admission. What happens?",
    right: "The matters are deemed admitted unless the court allows otherwise",
    wrong: ["They are deemed denied", "Nothing until Tidewater moves to compel", "The deadline extends automatically"],
  },
  {
    prompt: () => "No rule or order sets a different time. Until when can a paper be e-filed on its last day (FRCP 6(a)(4))?",
    right: "Midnight in the court's time zone",
    wrong: ["5:00 p.m.", "When the clerk's office closes", "Midnight Eastern time"],
  },
  {
    prompt: (p) => `${p.expert.full}, Morrow's testifying expert, sends a draft report to ${p.partner.full}. Under FRCP 26(b)(4)(B), the draft is…`,
    right: "Protected from discovery",
    wrong: ["Discoverable like the final report", "Filed with the court", "Privileged only if the expert is a lawyer"],
  },
  {
    prompt: () => "Who may serve the summons and complaint on Tidewater (FRCP 4(c)(2))?",
    right: "Any adult who isn't a party",
    wrong: ["Only a U.S. marshal", "Only Morrow's general manager", "Only a lawyer"],
  },
];

/** Slots 6 and 12 ask for a number; the other hard slots are choice questions. */
const NUMBER_SLOTS = new Set([5, 11]);

const rapidProcedureStep = {
  id: "rapid-procedure",
  type: RAPID_ROUND,
  title: "Rapid round: procedure",
  config: {
    intro: "Procedure: 15 quick questions about litigation practice, 20 seconds each. Two of them ask for a number.",
    secondsPerItem: 20,
    items: rapidItems("lp", (n, i) => ({
      prompt: `{{lp_${n}}}`,
      fields: NUMBER_SLOTS.has(i)
        ? [{ id: "answer", label: "Answer", kind: "number", decimals: 0 }]
        : [{ id: "answer", label: "Answer", kind: "choice", options: letterOptions(`lp_${n}`) }],
    })),
  },
};

function buildProcedure(rng: Rng, v: Values, people: People, opp: string, vendor: string): Record<string, ChoiceKey> {
  const easy = rng.shuffle(PROC_EASY).slice(0, 10);
  const hard = rng.shuffle(PROC_HARD).slice(0, 3);
  const numbers = rng.shuffle(["interrogatories", "depositions"] as const);
  return Object.fromEntries(
    Array.from({ length: RAPID_ITEMS }, (_, i) => {
      const n = slotNo(i);
      if (NUMBER_SLOTS.has(i)) {
        const which = numbers.shift()!;
        if (which === "interrogatories") {
          const served = rng.int(16, 23);
          v[`lp_${n}`] =
            `Morrow served ${served} interrogatories (counting discrete subparts) in its first set. How many more may it serve without a stipulation or leave of court (FRCP 33(a)(1))?`;
          return [`lp-${n}`, { answer: { value: 25 - served, tolerance: 0 } }];
        }
        const taken = rng.int(2, 9);
        v[`lp_${n}`] =
          `Morrow has taken ${taken} depositions so far and Tidewater won't agree to more. How many more may Morrow take without leave of court (FRCP 30(a)(2)(A)(i))?`;
        return [`lp-${n}`, { answer: { value: 10 - taken, tolerance: 0 } }];
      }
      const q = isHardSlot(i) ? hard.shift()! : easy.shift()!;
      const { labels, letter } = placeOptions(rng, q.right, q.wrong);
      v[`lp_${n}`] = q.prompt(people, opp, vendor);
      LETTERS.forEach((l, j) => (v[`lp_${n}_${l}`] = labels[j]));
      return [`lp-${n}`, { answer: { choice: letter } }];
    }),
  );
}

// ---- Section A: privilege review of a production volume ----

type ProdKind =
  | "ac_produce"
  | "wp_produce"
  | "waived"
  | "ac_withheld"
  | "wp_withheld"
  | "claim_notice"
  | "bol"
  | "temp_log"
  | "delay_email"
  | "claim_ack"
  | "freight_inv"
  | "writeoff"
  | "photos"
  | "service_report"
  | "contract";

const PROD_KINDS: ProdKind[] = [
  "ac_produce",
  "wp_produce",
  "waived",
  "ac_withheld",
  "wp_withheld",
  "claim_notice",
  "bol",
  "temp_log",
  "delay_email",
  "claim_ack",
  "freight_inv",
  "writeoff",
  "photos",
  "service_report",
  "contract",
];
/** Ordinary produced business records: the only rows a Bates problem is planted next to. */
const PLAIN_KINDS = new Set<ProdKind>(["bol", "temp_log", "delay_email", "claim_ack", "freight_inv", "writeoff", "photos", "service_report", "contract"]);
const PROD_COLUMNS = ["Bates", "Date", "Type", "From / author", "To / CC", "Subject or description", "Proposed treatment"];
const PROD_CELLS = ["bates", "date", "type", "from", "to", "subject", "treatment"];
const PROD_ROWS = PROD_KINDS.length;

const prodRowId = (i: number) => `d${String(i + 1).padStart(2, "0")}`;
const bates = (prefix: string, n: number) => `${prefix}${String(n).padStart(6, "0")}`;
const batesRange = (prefix: string, start: number, end: number) => (end > start ? `${bates(prefix, start)}–${bates(prefix, end)}` : bates(prefix, start));

const privilegeStep = {
  id: "privilege-review",
  type: DOCUMENT_REVIEW,
  title: "Privilege review: production volume {{vol}}",
  config: {
    prompt: [
      "Review the index before volume {{vol}} goes to Tidewater's counsel.",
      "Flag each document whose proposed treatment is wrong, and each Bates numbering problem, with the reason.",
      "Then decide what to do with the volume.",
    ].join("\n"),
    document: {
      title: "Production index · volume {{vol}} · {{vol_count}} documents",
      fields: [
        { id: "matter", label: "Matter", value: `${CLIENT} v. ${DEFENDANT}, No. {{case_no}} (D. Wex.)` },
        { id: "firm", label: "Our firm", value: "{{firm}} · email @{{firm_domain}}" },
        { id: "client", label: "Client", value: `${CLIENT} · email @${CLIENT_DOMAIN}` },
        { id: "bates_rule", label: "Bates numbering", value: "One run starting at {{bates_start}}: no numbers skipped, none used twice" },
      ],
      columns: PROD_COLUMNS,
      rows: Array.from({ length: PROD_ROWS }, (_, i) => ({ id: prodRowId(i), cells: PROD_CELLS.map((c) => `{{pv_${i + 1}_${c}}}`) })),
      totals: [],
    },
    reasons: [
      { id: "privileged", label: "Privileged: withhold it and log it" },
      { id: "waived", label: "Privilege likely waived: someone outside Morrow and the firm" },
      { id: "wrong_basis", label: "Wrong privilege type" },
      { id: "bates_gap", label: "Bates gap: numbers skipped" },
      { id: "bates_dup", label: "Bates repeat: numbers used twice" },
      { id: "other", label: "Other" },
    ],
    findings: [
      { id: "priv_ac", label: "Attorney-client email set to be produced", points: 4 },
      { id: "priv_wp", label: "Work-product memo set to be produced", points: 4 },
      { id: "waived", label: "Withheld email copied to an outsider", points: 4 },
      { id: "bates_gap", label: "Bates gap", points: 3 },
      { id: "bates_dup", label: "Bates numbers used twice", points: 3 },
    ],
    falseFlagPenalty: 1,
    decision: {
      prompt: "The volume is due today. What do you do?",
      options: [
        { id: "serve", label: "Serve the volume today as indexed" },
        { id: "fix_serve", label: "Change the treatments and renumber it myself, then serve it today" },
        { id: "hold", label: "Hold the volume: send the flagged documents to {{partner}} for the privilege calls, get the Bates numbers fixed, and serve once {{partner_first}} signs off" },
        { id: "clawback", label: "Serve it as indexed; anything privileged can be clawed back later" },
      ],
      points: 2,
    },
  },
};

// ---- Section B: cite-check ----

const CC_ROWS = 9;
type CiteRole = "fabricated" | "bad_law" | "misquote" | "pin" | "year" | "ok";
const CITE_ROLES: CiteRole[] = ["fabricated", "bad_law", "misquote", "pin", "year", "ok", "ok", "ok", "ok"];

const citeCheckStep = {
  id: "cite-check",
  type: DOCUMENT_REVIEW,
  title: "Cite-check: opposition brief",
  config: {
    prompt: [
      "Check each authority in the table against the research file in {{partner_first}}'s email: the case is in the file, the year and pin cite match, the parenthetical matches the holding, and it is still good law.",
      "Flag each problem with a reason, then decide what to tell {{partner_first}}.",
    ].join("\n"),
    document: {
      title: "Table of authorities · Plaintiff's opposition to Tidewater's motion for partial summary judgment",
      fields: [
        { id: "matter", label: "Matter", value: `${CLIENT} v. ${DEFENDANT}, No. {{case_no}} (D. Wex.)` },
        { id: "drafted", label: "Draft", value: "First draft by {{associate}}" },
      ],
      columns: ["Authority as cited", "Parenthetical in the brief", "Cited on brief pages"],
      rows: Array.from({ length: CC_ROWS }, (_, i) => ({ id: `a${i + 1}`, cells: ["cite", "paren", "pages"].map((c) => `{{cc_${i + 1}_${c}}}`) })),
      totals: [],
      footnote: GUIDE_LINE,
    },
    reasons: [
      { id: "not_found", label: "Not in the research file: can't be verified" },
      { id: "bad_law", label: "No longer good law" },
      { id: "quote", label: "Parenthetical doesn't match the holding" },
      { id: "pin", label: "Wrong pin cite" },
      { id: "year", label: "Wrong year" },
      { id: "format", label: "Citation format" },
      { id: "other", label: "Other" },
    ],
    findings: [
      { id: "fabricated", label: "Case that isn't in the research file", points: 5 },
      { id: "bad_law", label: "Overruled case", points: 4 },
      { id: "misquote", label: "Parenthetical misstates the holding", points: 3 },
      { id: "pin", label: "Wrong pin cite", points: 3 },
      { id: "year", label: "Wrong year", points: 3 },
    ],
    falseFlagPenalty: 1,
    decision: {
      prompt: "What do you tell {{partner_first}} before the brief is filed?",
      options: [
        { id: "file", label: "Everything checks out: file it" },
        { id: "fix_file", label: "Correct the citations myself and file it" },
        {
          id: "hold",
          label: "Hold the filing: send {{partner_first}} the list of problems, since a case nobody can find or that is no longer good law needs an attorney to decide what replaces it",
        },
        { id: "delete", label: "Delete every authority with a problem and file the rest" },
      ],
      points: 2,
    },
  },
};

// ---- Section C: exhibit list, then the inbox ----

const EX_ROWS = 12;

const exhibitStep = {
  id: "exhibit-list",
  type: DOCUMENT_REVIEW,
  seconds: 360,
  title: "Exhibit list vs. the binder",
  config: {
    prompt: [
      "Compare Morrow's draft trial exhibit list with what is in each binder tab and with what was produced in discovery.",
      "Flag each problem with a reason.",
    ].join("\n"),
    document: {
      title: "Plaintiff's trial exhibit list (draft) · with binder check",
      fields: [
        { id: "matter", label: "Matter", value: `${CLIENT} v. ${DEFENDANT}, No. {{case_no}} (D. Wex.)` },
        { id: "produced", label: "Produced in discovery", value: "Morrow: MOR000001–{{mor_end}} · Tidewater: TFL000001–{{tfl_end}}" },
        { id: "binder", label: "Binder", value: "Pulled by {{assistant}} this morning, one tab per exhibit" },
      ],
      columns: ["Exhibit", "Description on the list", "Date on the list", "Bates on the list", "What's in the binder tab"],
      rows: Array.from({ length: EX_ROWS }, (_, i) => ({
        id: `x${String(i + 1).padStart(2, "0")}`,
        cells: [`PX-${i + 1}`, ...["desc", "date", "bates", "binder"].map((c) => `{{ex_${i + 1}_${c}}}`)],
      })),
      totals: [],
    },
    reasons: [
      { id: "missing", label: "Not in the binder" },
      { id: "duplicate", label: "Same document listed twice" },
      { id: "date", label: "Date doesn't match the document" },
      { id: "not_produced", label: "Never produced in discovery" },
      { id: "description", label: "Description doesn't match" },
      { id: "other", label: "Other" },
    ],
    findings: [
      { id: "missing", label: "Exhibit missing from the binder", points: 3 },
      { id: "duplicate", label: "Same document under two exhibit numbers", points: 4 },
      { id: "not_produced", label: "Exhibit never produced in discovery", points: 4 },
      { id: "depo_date", label: "Wrong deposition date", points: 4 },
    ],
    falseFlagPenalty: 1,
  },
};

const FILING_OPTIONS = [
  { id: "ocr", label: "Run the scanned exhibits through text recognition so every file is text-searchable" },
  { id: "exhibits", label: "File each exhibit as its own attachment, labelled with its number and a short description" },
  { id: "split", label: "Split the brief into labelled parts so no file is over {{limit_mb}} MB" },
  { id: "order", label: "Email the proposed order in Word format to chambers after filing" },
  { id: "one_pdf", label: "Combine the brief and exhibits into one PDF so nothing gets separated" },
  { id: "email_clerk", label: "Email the PDF to the clerk's office instead of e-filing, to save time" },
  { id: "midnight", label: "Wait until tonight: e-filing stays open until midnight" },
];

const filingStep = {
  id: "inbox-filing",
  type: MULTIPLE_CHOICE,
  seconds: 150,
  title: "Filing by 5 pm",
  config: {
    prompt: [
      "{{partner_first}} wants the opposition on file by 5 pm. Pick every step you take.",
      "",
      "D. Wex. L.R. 5.2 Electronic filing format (excerpt)",
      "(a) File every document as a text-searchable PDF; run scanned pages through text recognition first.",
      "(b) No single file may be larger than {{limit_mb}} MB. A larger document is filed in parts, each labelled \"Part 1 of 2\" and so on.",
      "(c) File each exhibit as its own attachment, labelled with its exhibit number and a short description.",
      "(d) A proposed order is filed as an attachment and also emailed in Word format to the judge's chambers.",
    ].join("\n"),
    options: FILING_OPTIONS,
    select: "multi",
    points: 7,
  },
};

const opposingStep = {
  id: "inbox-opposing",
  type: MULTIPLE_CHOICE,
  seconds: 105,
  title: "Email from opposing counsel's paralegal",
  config: { prompt: "{{opp_para_first}} at {{opp_firm}} wants Morrow's emails. What do you do?", options: letterOptions("opp"), select: "single", points: 4 },
};

const clientStep = {
  id: "inbox-client",
  type: MULTIPLE_CHOICE,
  seconds: 105,
  title: "Email from the client",
  config: { prompt: "{{gm_first}} asks whether Morrow should take Tidewater's offer. What do you do?", options: letterOptions("cl"), select: "single", points: 4 },
};

// ---- Generator helpers ----

const person = (p: PersonName, domain: string) => `${p.full} <${emailFor(p, domain)}>`;

/** A date between two ISO dates, inclusive. */
const dateBetween = (rng: Rng, from: IsoDate, to: IsoDate) => addDays(from, rng.int(0, daysBetween(from, to)));

export const litigationMorrowTidewater = defineScenario({
  slug: "litigation-morrow-tidewater",
  version: 1,
  title: "Morrow v. Tidewater Freight: litigation paralegal",
  roleFamily: "legal",
  timeLimitMinutes: 52,
  definition: {
    intro:
      "You're a litigation paralegal at {{firm}}, working for {{partner}}, a partner, on Morrow Provisions, LLC v. Tidewater Freight Lines, Inc., a cargo-damage case in the U.S. District Court for the District of Wexford. The work comes in six timed parts, 52 minutes in all: three rapid rounds of quick items (deadlines, citation format, procedure), a privilege review, a cite-check, and trial prep with your inbox. A finished part can't be reopened. The people, firms, courts and cases are fictional; the timing rules are the real Federal Rules of Civil Procedure.",
    steps: [rapidDeadlineStep, privilegeStep, rapidCiteStep, citeCheckStep, rapidProcedureStep, exhibitStep, filingStep, opposingStep, clientStep],
    messages: [
      {
        id: "m1",
        from: "Your supervising partner",
        subject: "Morrow production volume {{vol}}: privilege review",
        body: [
          "Hi {{first_name}},",
          "",
          "Welcome to the Morrow team. Our client Morrow Provisions is suing Tidewater Freight Lines over a refrigerated load of produce that arrived spoiled in {{dest}}.",
          "",
          "Volume {{vol}} of Morrow's documents is due to Tidewater's counsel, {{opp_firm}}, today. Before it goes out, check the index:",
          "• Privileged material (Morrow's confidential communications with our firm about legal advice, and our work product) is withheld and logged, not produced.",
          "• Privilege covers confidential communications only, so look at who was on each one.",
          "• The Bates numbers must run without gaps or repeats.",
          "",
          "Flag every problem with the reason and tell me what you'll do with the volume.",
          "",
          "{{partner}}",
        ].join("\n"),
        arriveAtMinute: 0,
        stepId: "privilege-review",
      },
      {
        id: "m2",
        from: "Your supervising partner",
        subject: "Cite-check the opposition brief",
        body: [
          "Hi {{first_name}},",
          "",
          "{{associate}} drafted our opposition to Tidewater's motion, and part of the first draft came from an AI drafting tool. Before it goes to the judge, cite-check the table of authorities against our research file below. Every case we rely on has been pulled and read and is in the file; a case that isn't in the file can't go in the brief until someone finds and reads it.",
          "",
          "Research file (verified)",
          "",
          "{{cc_file}}",
          "",
          "{{partner}}",
        ].join("\n"),
        arriveAtMinute: 0,
        stepId: "cite-check",
      },
      {
        id: "m3",
        from: "Your supervising partner",
        subject: "Exhibit list for the pretrial order",
        body: [
          "Hi {{first_name}},",
          "",
          "The exhibit list goes to the court with the pretrial order. {{assistant}} pulled the binder this morning; the review screen shows what's actually in each tab next to the list. Check the list against the binder and against what was produced in discovery: an exhibit nobody produced may be kept out at trial.",
          "",
          "{{partner}}",
        ].join("\n"),
        arriveAtMinute: 0,
        stepId: "exhibit-list",
      },
      {
        id: "m4",
        from: "Your supervising partner",
        subject: "Opposition due today",
        body: [
          "Hi {{first_name}},",
          "",
          "The opposition to Tidewater's motion is due today and I want it on file by 5 pm. The final brief is one PDF, {{brief_mb}} MB on its own. The {{n_exhibits}} exhibits are scanned images; the largest is {{max_exhibit_mb}} MB. {{order_line}}",
          "",
          "Can you get it filed? The local rule is in the task.",
          "",
          "{{partner}}",
        ].join("\n"),
        arriveAtMinute: 0,
        stepId: "inbox-filing",
      },
      {
        id: "m5",
        from: "Paralegal at Tidewater's law firm",
        subject: "Quick favor: Morrow emails",
        body: [
          "Hi {{first_name}},",
          "",
          "Rather than waiting on formal requests, could you just send me the emails from Morrow's production, including the ones you're holding back as privileged? It would save everyone a lot of time. Happy to return the favor.",
          "",
          "Thanks,",
          "{{opp_para}}, Paralegal, {{opp_firm}}",
        ].join("\n"),
        arriveAtMinute: 0,
        stepId: "inbox-opposing",
      },
      {
        id: "m6",
        from: "General Manager, Morrow Provisions",
        subject: "Tidewater's offer",
        body: [
          "Hi {{first_name}},",
          "",
          "Tidewater's insurer called me and offered {{offer|money}} to settle. Between us, should we take it? What would you do in our shoes? I'd rather not bother {{partner_first}} with it yet.",
          "",
          "{{gm}}",
        ].join("\n"),
        arriveAtMinute: 0,
        stepId: "inbox-client",
      },
    ],
    sections: [
      { id: "s-rapid-a", title: "Rapid round: deadlines", minutes: 6, stepIds: ["rapid-deadlines"] },
      { id: "s-privilege", title: "Privilege review", minutes: 11, stepIds: ["privilege-review"] },
      { id: "s-rapid-b", title: "Rapid round: citation format", minutes: 6, stepIds: ["rapid-citations"] },
      { id: "s-cite-check", title: "Cite-check", minutes: 11, stepIds: ["cite-check"] },
      { id: "s-rapid-c", title: "Rapid round: procedure", minutes: 6, stepIds: ["rapid-procedure"] },
      { id: "s-trial", title: "Trial prep and inbox", minutes: 12, stepIds: ["exhibit-list", "inbox-filing", "inbox-opposing", "inbox-client"], oneAtATime: true },
    ],
  },

  build(rng) {
    const v: Values = {};
    const [firm, oppFirm] = pickDistinct(rng, LAW_FIRMS, 2);
    const [pPartner, pAssociate, pGm, pOps, pController, pDispatcher, pClaims, pVendorRep, pOppPara, pExpert, pAssistant, ...pDeponents] = distinctPeople(rng, 14);
    const people: People = {
      partner: pPartner,
      associate: pAssociate,
      gm: pGm,
      ops: pOps,
      controller: pController,
      dispatcher: pDispatcher,
      claims: pClaims,
      vendorRep: pVendorRep,
      oppPara: pOppPara,
      expert: pExpert,
      assistant: pAssistant,
      deponents: pDeponents,
    };
    const vendor = rng.pick(CLIENT_COMPANIES.slice(0, 4));
    const vendorDomain = companyDomain(vendor);
    const [origin, dest] = pickDistinct(rng, CITIES, 2);
    const trailer = `R-${rng.int(1000, 9899)}`;
    const bol = `TF-${rng.int(100_000, 899_999)}`;
    const claimNo = `CL-${rng.int(20_000, 79_999)}`;
    Object.assign(v, {
      firm: firm.name,
      firm_domain: firm.domain,
      opp_firm: oppFirm.name,
      partner: pPartner.full,
      partner_first: pPartner.first,
      associate: pAssociate.full,
      assistant: pAssistant.full,
      gm: pGm.full,
      gm_first: pGm.first,
      opp_para: pOppPara.full,
      opp_para_first: pOppPara.first,
      dest,
      case_no: `1:26-cv-0${rng.int(1000, 9999)}`,
    });

    // ---- Section A: production index ----
    let kinds: ProdKind[] = [];
    let gapAt = -1;
    let dupAt = -1;
    for (let tries = 0; ; tries++) {
      if (tries > 500) throw new Error("litigation-morrow-tidewater: no production layout");
      kinds = rng.shuffle(PROD_KINDS);
      const spots = kinds.map((_, k) => k).filter((k) => k > 0 && PLAIN_KINDS.has(kinds[k]) && PLAIN_KINDS.has(kinds[k - 1]));
      if (spots.length < 2) continue;
      [gapAt, dupAt] = rng.shuffle(spots);
      if (Math.abs(gapAt - dupAt) >= 2) break;
    }
    const at = (d: string) => (d === "firm" ? firm.domain : d === "client" ? CLIENT_DOMAIN : d === "tw" ? TW_DOMAIN : vendorDomain);
    const P = {
      gm: person(pGm, at("client")),
      ops: person(pOps, at("client")),
      controller: person(pController, at("client")),
      partner: person(pPartner, at("firm")),
      associate: person(pAssociate, at("firm")),
      dispatcher: person(pDispatcher, at("tw")),
      claims: person(pClaims, at("tw")),
      vendorRep: person(pVendorRep, at("vendor")),
    };
    const W = "Withhold: attorney-client";
    const content: Record<ProdKind, [type: string, from: string, to: string, subject: string, treatment: string, pages: [number, number]]> = {
      ac_produce: ["Email", P.gm, P.associate, "Question for counsel: does Tidewater's liability cap apply to our claim?", "Produce", [1, 3]],
      wp_produce: ["Memo", P.associate, "File", "Analysis of Tidewater's limitation-of-liability defense, prepared for this case", "Produce", [3, 8]],
      waived: ["Email", P.partner, `${P.gm}; CC: ${P.vendorRep}`, "Our advice on responding to Tidewater's claim denial", W, [1, 3]],
      ac_withheld: ["Email", P.gm, P.partner, "Request for advice: Tidewater's claim denial", W, [1, 2]],
      wp_withheld: ["Notes", P.partner, "File", `Outline for the deposition of ${pDispatcher.full}, prepared for this case`, "Withhold: work product", [2, 4]],
      claim_notice: ["Email", P.gm, P.claims, `Claim notice for the ${dest} load; our attorney will follow up`, "Produce", [1, 2]],
      bol: ["Bill of lading", DEFENDANT, CLIENT, `Bill of lading ${bol}: ${origin} to ${dest}`, "Produce", [1, 2]],
      temp_log: ["Spreadsheet", "Morrow warehouse system", "—", `Reefer temperature log, trailer ${trailer}`, "Produce", [2, 6]],
      delay_email: ["Email", P.ops, P.dispatcher, `Delivery delayed: trailer ${trailer}`, "Produce", [1, 2]],
      claim_ack: ["Email", P.claims, P.gm, `Acknowledgment of claim ${claimNo}`, "Produce", [1, 1]],
      freight_inv: ["Invoice", DEFENDANT, CLIENT, `Freight invoice FI-${rng.int(30_000, 89_999)}`, "Produce", [1, 1]],
      writeoff: ["Email", P.gm, P.controller, "Spoiled load: write-off amount", "Produce", [1, 2]],
      photos: ["Photographs", P.ops, "—", `Photos of rejected pallets at ${dest}`, "Produce", [4, 12]],
      service_report: ["Email", P.vendorRep, P.ops, `Service report: reefer unit inspection, trailer ${trailer}`, "Produce", [1, 3]],
      contract: ["Contract", `${CLIENT} and ${DEFENDANT}`, "—", "Transportation services agreement", "Produce", [8, 20]],
    };
    const start = rng.int(1_000, 8_000);
    let cursor = start;
    let prevPages = 0;
    const prodRows = kinds.map((kind, k) => {
      const [type, from, to, subject, treatment, [lo, hi]] = content[kind];
      const pages = rng.int(lo, hi);
      let first = cursor;
      if (k === gapAt) first = cursor + rng.int(2, 6); // numbers skipped
      if (k === dupAt) first = cursor - rng.int(1, Math.min(2, prevPages)); // overlaps only the document before
      const last = first + pages - 1;
      cursor = last + 1;
      prevPages = pages;
      const n = k + 1;
      const date = formatDate(dateBetween(rng, "2026-02-02", "2026-09-30"));
      const range = batesRange("MOR", first, last);
      Object.assign(v, {
        [`pv_${n}_bates`]: range,
        [`pv_${n}_date`]: date,
        [`pv_${n}_type`]: type,
        [`pv_${n}_from`]: from,
        [`pv_${n}_to`]: to,
        [`pv_${n}_subject`]: subject,
        [`pv_${n}_treatment`]: treatment,
      });
      return { id: prodRowId(k), kind, first, last, range };
    });
    Object.assign(v, { vol: `MOR-VOL00${rng.int(2, 9)}`, vol_count: PROD_ROWS, bates_start: bates("MOR", start) });
    const prodOf = (kind: ProdKind) => prodRows.find((r) => r.kind === kind)!;
    const gapRow = prodRows[gapAt];
    const gapPrev = prodRows[gapAt - 1];
    const dupRow = prodRows[dupAt];
    const dupPrev = prodRows[dupAt - 1];

    // ---- Section B: research file and table of authorities ----
    const used = new Set<string>();
    const holdings = rng.shuffle(HOLDINGS);
    const roles = rng.shuffle(CITE_ROLES);
    const cited = roles.map((role, i) => {
      const court: CourtId = role === "bad_law" ? rng.pick(["14th-cir", "wex-sup"] as CourtId[]) : rng.pick(Object.keys(COURTS) as CourtId[]);
      return { role, rep: report(rng, caseName(rng, used), court, role === "bad_law" ? [1996, 2015] : [1996, 2024]), holding: holdings[i] };
    });
    const extras = [9, 10].map((i) => ({ rep: report(rng, caseName(rng, used), rng.pick(Object.keys(COURTS) as CourtId[])), holding: holdings[i] }));
    const overruled = cited.find((c) => c.role === "bad_law")!;
    const overruler = report(rng, caseName(rng, used), overruled.rep.court, [overruled.rep.year + 2, 2025]);
    const fileEntries = [...cited.filter((c) => c.role !== "fabricated"), ...extras]
      .sort((a, b) => a.rep.name.localeCompare(b.rep.name))
      .map(({ rep, holding }) => {
        const status = rep === overruled.rep ? `overruled by ${formatCaseCitation(overruler)}` : "good law";
        return `• ${formatCaseCitation(rep)}. Pages ${rep.firstPage}–${rep.lastPage}. Holding, at ${rep.pin}: "${holding[0]}." Status: ${status}.`;
      });
    v.cc_file = fileEntries.join("\n");
    const rowsSorted = [...cited].sort((a, b) => a.rep.name.localeCompare(b.rep.name));
    const ccNotes: Record<string, { id: string; note: string }> = {};
    rowsSorted.forEach(({ role, rep, holding }, i) => {
      const k = i + 1;
      let pin = rep.pin;
      let year = rep.year;
      if (role === "pin") {
        do pin = rng.int(rep.firstPage + 1, rep.lastPage);
        while (pin === rep.pin);
      }
      if (role === "year") year = rep.year + (rep.year >= 2022 ? -1 : rng.pick([-1, 1])) * rng.int(1, 3);
      const text = role === "misquote" ? holding[1] : holding[0];
      const pages = [...new Set([rng.int(2, 9), rng.int(10, 17), rng.int(18, 24)])].slice(0, rng.int(1, 3)).join(", ");
      Object.assign(v, {
        [`cc_${k}_cite`]: formatCaseCitation({ ...rep, year }, pin),
        [`cc_${k}_paren`]: `(holding that ${text})`,
        [`cc_${k}_pages`]: pages,
      });
      const note: Record<CiteRole, string> = {
        fabricated: `${rep.name} isn't in the research file and nobody has read it, so it can't be cited; it is probably invented by the drafting tool.`,
        bad_law: `${rep.name} was overruled by ${overruler.name} in ${overruler.year}, so it is no longer good law.`,
        misquote: `The brief's parenthetical for ${rep.name} changes the holding; the court actually held that ${holding[0]}.`,
        pin: `The point in ${rep.name} is at page ${rep.pin}; the brief cites page ${pin}.`,
        year: `${rep.name} was decided in ${rep.year}; the brief says ${year}.`,
        ok: "",
      };
      if (role !== "ok") ccNotes[role] = { id: `a${k}`, note: note[role] };
    });

    // ---- Section C: exhibit list against the binder ----
    const morEnd = rng.int(600, 1_400);
    const tflEnd = rng.int(800, 2_000);
    const docs = rng.shuffle([
      { desc: "Transportation services agreement, Morrow and Tidewater", alt: "Morrow–Tidewater transport contract", binder: "Transportation services agreement, signed", prefix: "MOR", pages: [8, 20] },
      { desc: `Bill of lading ${bol}`, alt: `Tidewater bill of lading for the ${dest} load`, binder: `Bill of lading ${bol}`, prefix: "TFL", pages: [1, 2] },
      { desc: `Reefer temperature log, trailer ${trailer}`, alt: `Trailer ${trailer} temperature download`, binder: `Temperature log, trailer ${trailer}`, prefix: "TFL", pages: [2, 6] },
      { desc: `Email, ${pDispatcher.full} to ${pOps.full}: delivery delayed`, alt: `${pDispatcher.full}'s delay email to Morrow`, binder: `Email from ${pDispatcher.full}, delivery delayed`, prefix: "MOR", pages: [1, 2] },
      { desc: "Delivery receipt with rejection notes", alt: "Signed delivery receipt (load rejected)", binder: "Delivery receipt, load rejected", prefix: "MOR", pages: [1, 2] },
      { desc: `Photographs of rejected pallets at ${dest}`, alt: "Pallet photos at the receiving dock", binder: "Photographs of pallets", prefix: "MOR", pages: [4, 12] },
      { desc: "Morrow's claim notice to Tidewater", alt: "Claim letter, Morrow to Tidewater", binder: "Claim notice letter", prefix: "MOR", pages: [1, 3] },
      { desc: `Tidewater's denial of claim ${claimNo}`, alt: `Claim ${claimNo} denial letter`, binder: `Letter denying claim ${claimNo}`, prefix: "TFL", pages: [1, 3] },
      { desc: `Refrigeration unit service report, trailer ${trailer}`, alt: "Service report on the reefer unit", binder: `${vendor} service report`, prefix: "TFL", pages: [1, 4] },
      { desc: "Spoilage write-off schedule", alt: "Morrow write-off schedule for the load", binder: "Write-off schedule", prefix: "MOR", pages: [1, 3] },
      { desc: "Driver's hours log for the trip", alt: "Tidewater driver log", binder: "Driver log", prefix: "TFL", pages: [2, 5] },
    ]).slice(0, 8);
    // Non-overlapping Bates ranges inside each production, plus one range past the end of it.
    const taken: { prefix: string; a: number; b: number }[] = [];
    const placeBates = (prefix: string, pages: number, outside: boolean) => {
      const end = prefix === "MOR" ? morEnd : tflEnd;
      for (;;) {
        const a = outside ? end + rng.int(5, 90) : rng.int(1, end - pages);
        const b = a + pages - 1;
        if (!outside && b > end) continue;
        if (taken.some((t) => t.prefix === prefix && a <= t.b && b >= t.a)) continue;
        taken.push({ prefix, a, b });
        return batesRange(prefix, a, b);
      }
    };
    type Exhibit = { desc: string; date: string; bates: string; binder: string; role: "ok" | "missing" | "dup_first" | "dup_second" | "not_produced" | "depo" | "depo_wrong" };
    const exhibits: Exhibit[] = docs.map((d, i) => {
      const role = i === 0 ? "missing" : i === 1 ? "dup_first" : i === 2 ? "not_produced" : "ok";
      const date = formatDate(dateBetween(rng, "2026-01-05", "2026-08-28"));
      const b = placeBates(d.prefix, rng.int(d.pages[0], d.pages[1]), role === "not_produced");
      return { desc: d.desc, date, bates: b, binder: role === "missing" ? "Empty: nothing in this tab" : `${d.binder} · ${date} · ${b}`, role };
    });
    const dupFirst = exhibits.find((e) => e.role === "dup_first")!;
    exhibits.push({ ...dupFirst, desc: docs[1].alt, role: "dup_second" });
    const depoDates = [0, 1, 2].map(() => dateBetween(rng, "2026-09-14", "2026-11-06"));
    pDeponents.forEach((dep, j) => {
      const listed = formatDate(depoDates[j]);
      const wrong = j === 0;
      const actual = wrong ? formatDate(addDays(depoDates[j], rng.pick([-1, 1]) * rng.int(1, 9))) : listed;
      exhibits.push({ desc: `Deposition transcript of ${dep.full}`, date: listed, bates: "Transcript", binder: `Transcript of ${dep.full} · cover page: taken ${actual}`, role: wrong ? "depo_wrong" : "depo" });
    });
    let order: Exhibit[] = [];
    do order = rng.shuffle(exhibits);
    while (order.findIndex((e) => e.role === "dup_second") < order.findIndex((e) => e.role === "dup_first"));
    order.forEach((e, i) => {
      Object.assign(v, { [`ex_${i + 1}_desc`]: e.desc, [`ex_${i + 1}_date`]: e.date, [`ex_${i + 1}_bates`]: e.bates, [`ex_${i + 1}_binder`]: e.binder });
    });
    Object.assign(v, { mor_end: bates("MOR", morEnd), tfl_end: bates("TFL", tflEnd) });
    const exIdx = (role: Exhibit["role"]) => order.findIndex((e) => e.role === role);
    const exId = (role: Exhibit["role"]) => `x${String(exIdx(role) + 1).padStart(2, "0")}`;
    const pxNo = (role: Exhibit["role"]) => `PX-${exIdx(role) + 1}`;

    // ---- Section C: inbox ----
    const limit = rng.pick([10, 15, 20, 25, 35]);
    const overLimit = rng.int(0, 1) === 1;
    const proposedOrder = rng.int(0, 1) === 1;
    Object.assign(v, {
      limit_mb: limit,
      brief_mb: overLimit ? rng.int(limit + 2, limit + 30) : rng.int(2, limit - 2),
      max_exhibit_mb: rng.int(1, limit - 1),
      n_exhibits: rng.int(4, 12),
      order_line: proposedOrder ? "A proposed order is attached as well." : "No proposed order this time.",
      offer: rng.int(18, 140) * 250_000,
    });
    // Small counts shown as text; only cents-valued amounts stay numbers (the leak tests read numbers as cents).
    for (const k of ["limit_mb", "brief_mb", "max_exhibit_mb", "n_exhibits", "vol_count"]) v[k] = String(v[k]);
    const filingRight = ["ocr", "exhibits", ...(overLimit ? ["split"] : []), ...(proposedOrder ? ["order"] : [])];

    const opp = placeOptions(rng, `Send nothing. Reply politely that document requests go through counsel, and forward the email to ${pPartner.full}`, [
      "Send the produced emails only: Tidewater already has them",
      "Send what they asked for: the rules require the parties to cooperate in discovery",
      "Don't reply or tell anyone: it isn't a formal request",
    ]);
    const cl = placeOptions(rng, `Tell ${pGm.first} you can't give legal advice and that ${pPartner.full} will call today, then pass the offer to ${pPartner.first} right away`, [
      "Give your honest view, as long as you say it isn't legal advice",
      `Tell ${pGm.first} to take it: it's close to the damages in the file`,
      `Wait for ${pPartner.first} to raise it, since ${pGm.first} asked you not to bother them`,
    ]);
    LETTERS.forEach((l, j) => {
      v[`opp_${l}`] = opp.labels[j];
      v[`cl_${l}`] = cl.labels[j];
    });

    // ---- Rapid rounds, drawn last so the rest of the material doesn't shift when they change ----
    const rapidKeys = {
      "rapid-deadlines": { items: buildDeadlines(rng, v) },
      "rapid-citations": { items: buildCitations(rng, v) },
      "rapid-procedure": { items: buildProcedure(rng, v, people, oppFirm.name, vendor) },
    };

    const ac = prodOf("ac_produce");
    const wp = prodOf("wp_produce");
    const waived = prodOf("waived");
    return {
      values: v,
      keys: {
        ...rapidKeys,
        "privilege-review": {
          findings: {
            priv_ac: {
              targets: [ac.id],
              reasons: ["privileged"],
              note: `${ac.range} is ${pGm.full} asking ${pAssociate.full} at our firm for legal advice: attorney-client privileged, so withhold it and log it.`,
            },
            priv_wp: {
              targets: [wp.id],
              reasons: ["privileged"],
              note: `${wp.range} is ${pAssociate.full}'s analysis of a defense, prepared for this case: work product, so withhold it and log it.`,
            },
            waived: {
              targets: [waived.id],
              reasons: ["waived"],
              note: `${waived.range} copies ${pVendorRep.full} of ${vendor}, an outsider, so privilege is likely waived; ${pPartner.full} makes the call, but it can't simply be withheld.`,
            },
            bates_gap: {
              targets: [gapRow.id, gapPrev.id],
              reasons: ["bates_gap"],
              note: `Numbers ${bates("MOR", gapPrev.last + 1)} to ${bates("MOR", gapRow.first - 1)} are skipped between these two documents.`,
            },
            bates_dup: {
              targets: [dupRow.id, dupPrev.id],
              reasons: ["bates_dup"],
              note: `${dupRow.range} reuses numbers already stamped on ${dupPrev.range}; every page needs its own number.`,
            },
          },
          decision: ["hold"],
        },
        "cite-check": {
          findings: {
            fabricated: { targets: [ccNotes.fabricated.id], reasons: ["not_found"], note: ccNotes.fabricated.note },
            bad_law: { targets: [ccNotes.bad_law.id], reasons: ["bad_law"], note: ccNotes.bad_law.note },
            misquote: { targets: [ccNotes.misquote.id], reasons: ["quote"], note: ccNotes.misquote.note },
            pin: { targets: [ccNotes.pin.id], reasons: ["pin"], note: ccNotes.pin.note },
            year: { targets: [ccNotes.year.id], reasons: ["year"], note: ccNotes.year.note },
          },
          decision: ["hold"],
        },
        "exhibit-list": {
          findings: {
            missing: { targets: [exId("missing")], reasons: ["missing"], note: `The tab for ${pxNo("missing")} is empty: find the document or take it off the list.` },
            duplicate: {
              targets: [exId("dup_second"), exId("dup_first")],
              reasons: ["duplicate"],
              note: `${pxNo("dup_second")} is the same document as ${pxNo("dup_first")} (${dupFirst.bates}); list it once.`,
            },
            not_produced: {
              targets: [exId("not_produced")],
              reasons: ["not_produced"],
              note: `${pxNo("not_produced")} carries Bates numbers outside both productions, so it was never produced and may be excluded at trial (FRCP 37(c)(1)).`,
            },
            depo_date: {
              targets: [exId("depo_wrong")],
              reasons: ["date"],
              note: `The transcript cover for ${pxNo("depo_wrong")} gives a different date than the list: ${order[exIdx("depo_wrong")].binder.split("taken ")[1]} on the cover, ${order[exIdx("depo_wrong")].date} on the list.`,
            },
          },
        },
        "inbox-filing": { correct: filingRight },
        "inbox-opposing": { correct: [opp.letter] },
        "inbox-client": { correct: [cl.letter] },
      },
    };
  },
});
