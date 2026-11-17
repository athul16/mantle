import "server-only";

import type { Rng } from "../server/rng";
import { defineScenario } from "../server/scenario";
import { DOCUMENT_REVIEW } from "../step-types/document_review/public";
import { MULTIPLE_CHOICE } from "../step-types/multiple_choice/public";
import { RAPID_ROUND } from "../step-types/rapid_round/public";
import { SPREADSHEET } from "../step-types/spreadsheet/public";
import {
  LAW_FIRMS,
  addDays,
  computeDeadline,
  courtDaysAfter,
  daysBetween,
  distinctPeople,
  formatDate,
  holidaysBetween,
  isCourtDay,
  isWeekend,
  nextCourtDay,
  pickDistinct,
  previousCourtDay,
  type IsoDate,
  type PersonName,
} from "./legal";

/**
 * Corporate paralegal at a law firm: entity work for Halyard Robotics, Inc., a
 * (fictional) Delaware startup closing its Series A. Six timed sections, 50
 * minutes, 100 points, all scored automatically:
 *
 *   rapid round A, ownership and filing deadlines (10) → cap table update
 *   after the round (20) → rapid round B, governance terms (10) → board actions
 *   vs. the bylaws (20) → rapid round C, contract terms (10) → deal desk, one
 *   screen at a time: NDA vs. the playbook (12), closing checklist (10), then
 *   two inbox calls (4 + 4).
 *
 * Seeded per candidate: every name, fund, share count, date and playbook limit;
 * which board action, clause and checklist item carries which trap; and where
 * the right option sits. Filing deadlines use the shared date helpers
 * (./legal/dates.ts) over the real federal holiday calendar.
 *
 * Rapid rounds: 15 items × 20 s. Items 3, 6, 9, 12, 15 are the harder kinds,
 * worth 1; the other ten are worth ½, so each round is exactly 10.
 *
 * Draft v1: team self-review pending (docs/paralegal/corporate-halyard-robotics.md).
 */

const COMPANY = "Halyard Robotics, Inc.";
const LETTERS = ["a", "b", "c", "d"] as const;
/** Fictional venture funds. */
const FUNDS = [
  "Kelpie Point Ventures I, L.P.",
  "Larchmont Harbor Capital, L.P.",
  "Brindle Peak Ventures II, L.P.",
  "Ottermere Growth Fund, L.P.",
  "Saltmarsh Seed Partners, L.P.",
  "Copperwick Capital Partners III, L.P.",
  "Gannet Ridge Ventures, L.P.",
];
/** Fictional counterparties for the NDA. */
const COUNTERPARTIES = ["Tessellate Motion Systems, Inc.", "Brightkeel Automation Corp.", "Quillfeather Logistics, Inc.", "Marrowstone Industrial, LLC", "Corvane Warehouse Systems, Inc."];
const OTHER_STATES = ["New York", "California", "Texas", "Washington", "Massachusetts", "Illinois"];

type Values = Record<string, string>;
type ChoiceKey = Record<string, { choice: string }>;

const fmt = (n: number) => n.toLocaleString("en-US");
const pctLabel = (a: number, b: number) => `${((100 * a) / b).toFixed(2)}%`;
const pctValue = (a: number, b: number) => Number(((100 * a) / b).toFixed(2));
/** A whole number of `step` between lo and hi. */
const mult = (rng: Rng, lo: number, hi: number, step: number) => rng.int(Math.ceil(lo / step), Math.floor(hi / step)) * step;

// ---- Rapid round plumbing ----

const RAPID_ITEMS = 15;
/** Items 3, 6, 9, 12 and 15 are worth 1; the rest ½. 10 points a round. */
const isHardSlot = (i: number) => i % 3 === 2;
const slotNo = (i: number) => String(i + 1).padStart(2, "0");

function fillSlots<T>(easy: T[], hard: T[]): T[] {
  const e = [...easy];
  const h = [...hard];
  const out = Array.from({ length: RAPID_ITEMS }, (_, i) => (isHardSlot(i) ? h.shift() : e.shift()));
  if (out.some((x) => x === undefined) || e.length || h.length) throw new Error("corporate-halyard-robotics: rapid slots don't fill");
  return out as T[];
}

function rapidItems(prefix: string, item: (n: string, i: number) => object) {
  return Array.from({ length: RAPID_ITEMS }, (_, i) => ({ id: `${prefix}-${slotNo(i)}`, ...item(slotNo(i), i), points: isHardSlot(i) ? 1 : 0.5 }));
}

const letterOptions = (name: string) => LETTERS.map((l) => ({ id: l, label: `{{${name}_${l}}}` }));
const answerField = (name: string) => [{ id: "answer", label: "Answer", kind: "choice", options: letterOptions(name) }];

/** Puts `right` among `wrong` in a random place; returns the labels by letter and the right letter. */
function placeOptions(rng: Rng, right: string, wrong: string[]): { labels: string[]; letter: string } {
  if (wrong.length !== 3 || new Set([right, ...wrong]).size !== 4) throw new Error(`corporate-halyard-robotics: options must be 4 different labels (${right})`);
  const labels = rng.shuffle([right, ...wrong]);
  return { labels, letter: LETTERS[labels.indexOf(right)] };
}

/** The first three distinct candidates that aren't the right answer, or null when there aren't three. */
function threeWrong(right: string, candidates: string[]): string[] | null {
  const wrong = [...new Set(candidates)].filter((c) => c !== right).slice(0, 3);
  return wrong.length === 3 ? wrong : null;
}

// ---- Rapid round A: ownership percentages and filing deadlines ----

interface FilingRule {
  event: string;
  client: string;
  rule: string;
  days: number;
  business: boolean;
}

const NEXT_BUSINESS = "if that day is a weekend or federal holiday, the next business day";
const FILING_RULES: FilingRule[] = [
  {
    event: "First sale of Series A Preferred Stock in a Regulation D offering",
    client: `${COMPANY} (private company)`,
    rule: `Form D is due within 15 calendar days after the first sale; ${NEXT_BUSINESS} (Regulation D, Rule 503)`,
    days: 15,
    business: false,
  },
  {
    event: "A founder buys restricted stock subject to vesting",
    client: `${COMPANY} (private company)`,
    rule: `The 83(b) election must be filed with the IRS within 30 calendar days after the shares are transferred; ${NEXT_BUSINESS} (IRC §83(b), §7503)`,
    days: 30,
    business: false,
  },
  {
    event: "A new director joins the board",
    client: "A public company client",
    rule: `Form 3 is due within 10 calendar days after becoming a director or officer; ${NEXT_BUSINESS} (Exchange Act §16(a))`,
    days: 10,
    business: false,
  },
  {
    event: "A director buys shares in the open market",
    client: "A public company client",
    rule: "Form 4 is due within 2 business days after the transaction (Exchange Act §16(a)). Business days skip weekends and federal holidays",
    days: 2,
    business: true,
  },
  {
    event: "The company signs a material definitive agreement",
    client: "A public company client",
    rule: "Form 8-K is due within 4 business days after the event (Form 8-K, General Instruction B.1). Business days skip weekends and federal holidays",
    days: 4,
    business: true,
  },
  {
    event: "A fund's holdings cross 5% of a public company's common stock",
    client: "A fund client",
    rule: "Schedule 13D is due within 5 business days after crossing 5% (Exchange Act Rule 13d-1(a)). Business days skip weekends and federal holidays",
    days: 5,
    business: true,
  },
];

/** n weekdays after `from`, ignoring holidays: the "forgot the holiday" miscount. */
function weekdaysAfter(from: IsoDate, n: number): IsoDate {
  let d = from;
  for (let left = n; left > 0; ) {
    d = addDays(d, 1);
    if (!isWeekend(d)) left--;
  }
  return d;
}

type OwnKind = "basic" | "calendar" | "fd" | "post" | "business";
const OWN_EASY: OwnKind[] = ["basic", "basic", "basic", "basic", "basic", "calendar", "calendar", "calendar", "calendar", "calendar"];
const OWN_HARD: OwnKind[] = ["fd", "post", "business", "business", "business"];
const DL_FIRST = "2026-09-01";
const DL_SPAN_DAYS = 780;

const rapidOwnershipStep = {
  id: "rapid-ownership",
  type: RAPID_ROUND,
  title: "Rapid round: ownership and filing deadlines",
  config: {
    intro: [
      "Ownership and filing deadlines: 15 items, 20 seconds each. Pick the right percentage or date.",
      "Percentages are rounded to two decimal places. Fully diluted counts every issued share (preferred as converted, one for one), every option outstanding and every share still available in the option pool. Calendar-day periods don't count the day of the event; when the last day is a weekend or federal holiday, the filing is due the next business day. Business-day periods count only weekdays that aren't federal holidays.",
    ].join("\n"),
    secondsPerItem: 20,
    items: rapidItems("ow", (n) => ({
      prompt: `{{ow_${n}}}`,
      exhibit: {
        title: `{{ow_${n}_title}}`,
        rows: [1, 2, 3, 4, 5].map((r) => ({ label: `{{ow_${n}_l${r}}}`, value: `{{ow_${n}_v${r}}}` })),
      },
      fields: answerField(`ow_${n}`),
    })),
  },
};

function buildOwnership(rng: Rng, v: Values, people: PersonName[], funds: string[]): Record<string, ChoiceKey> {
  const kinds = fillSlots(rng.shuffle(OWN_EASY), rng.shuffle(OWN_HARD));
  return Object.fromEntries(
    kinds.map((kind, i) => {
      const n = slotNo(i);
      const set = (title: string, prompt: string, rows: [string, string][], right: string, wrong: string[]) => {
        const { labels, letter } = placeOptions(rng, right, wrong);
        v[`ow_${n}`] = prompt;
        v[`ow_${n}_title`] = title;
        rows.forEach(([l, val], r) => {
          v[`ow_${n}_l${r + 1}`] = l;
          v[`ow_${n}_v${r + 1}`] = val;
        });
        LETTERS.forEach((l, j) => (v[`ow_${n}_${l}`] = labels[j]));
        return [`ow-${n}`, { answer: { choice: letter } }] as [string, ChoiceKey];
      };
      for (let tries = 0; ; tries++) {
        if (tries > 5_000) throw new Error(`corporate-halyard-robotics: no ${kind} ownership item`);
        const who = rng.pick(people);
        if (kind === "basic") {
          const x = mult(rng, 150_000, 2_500_000, 5_000);
          const t = mult(rng, 6_000_000, 16_000_000, 10_000);
          const right = pctLabel(x, t);
          const wrong = threeWrong(right, [pctLabel(x, t + x), pctLabel(x, t - x), pctLabel(x + 100_000, t), `${(Number(right.slice(0, -1)) + 1).toFixed(2)}%`]);
          if (!wrong) continue;
          return set(
            "Stock ledger",
            `What percentage of Halyard's outstanding shares does ${who.full} hold?`,
            [
              ["Holder", `${who.full} holds ${fmt(x)} shares of Common Stock`],
              ["Shares outstanding", `${fmt(t)} (common and preferred, as converted; ${who.first}'s included)`],
              ["Measure", "Percentage of outstanding shares (not fully diluted)"],
              ["Rounding", "Two decimal places"],
              ["Source", `Halyard's stock ledger, as of ${formatDate(addDays("2026-03-02", rng.int(0, 200)))}`],
            ],
            right,
            wrong,
          );
        }
        if (kind === "fd") {
          const x = mult(rng, 200_000, 1_500_000, 5_000);
          const y = mult(rng, 20_000, 200_000, 5_000);
          const t = mult(rng, 7_000_000, 14_000_000, 10_000);
          const o = y + mult(rng, 200_000, 900_000, 5_000);
          const p = mult(rng, 150_000, 800_000, 5_000);
          const fd = t + o + p;
          const right = pctLabel(x + y, fd);
          const wrong = threeWrong(right, [pctLabel(x, fd), pctLabel(x + y, t), pctLabel(x, t), pctLabel(x + y, t + o)]);
          if (!wrong) continue;
          return set(
            "Cap table extract",
            `What is ${who.full}'s fully diluted percentage of Halyard?`,
            [
              ["Holder", `${who.full} · ${fmt(x)} shares of Common Stock and options over ${fmt(y)} shares`],
              ["Shares outstanding", `${fmt(t)} shares (common and preferred, as converted)`],
              ["Options and pool", `${fmt(o)} options outstanding (${who.first}'s included) · ${fmt(p)} shares available in the pool`],
              ["Measure", "Fully diluted: outstanding shares + options outstanding + shares available in the pool"],
              ["Rounding", "Two decimal places"],
            ],
            right,
            wrong,
          );
        }
        if (kind === "post") {
          const s = mult(rng, 8_000_000, 15_000_000, 10_000);
          const nn = mult(rng, 1_500_000, 4_000_000, 5_000);
          const fund = rng.pick(funds);
          const right = pctLabel(nn, s + nn);
          const wrong = threeWrong(right, [pctLabel(nn, s), pctLabel(nn, s + 2 * nn), pctLabel(nn, s - nn), pctLabel(nn + 100_000, s + nn)]);
          if (!wrong) continue;
          return set(
            "Series A term sheet",
            `What is ${fund}'s fully diluted percentage right after the closing?`,
            [
              ["Before the round", `${fmt(s)} shares, fully diluted`],
              ["New money", `${fund} buys ${fmt(nn)} new shares of Series A Preferred Stock`],
              ["Class", "Series A Preferred converts to Common one for one"],
              ["Measure", "The fund's fully diluted percentage right after closing"],
              ["Rounding", "Two decimal places"],
            ],
            right,
            wrong,
          );
        }
        // Filing deadlines.
        const rule = rng.pick(FILING_RULES.filter((r) => r.business === (kind === "business")));
        const from = addDays(DL_FIRST, rng.int(0, DL_SPAN_DAYS));
        if (!isCourtDay(from)) continue;
        let due: IsoDate;
        let candidates: IsoDate[];
        if (rule.business) {
          due = courtDaysAfter(from, rule.days);
          if (!holidaysBetween(addDays(from, 1), due).length) continue; // the hard ones always cross a holiday
          candidates = [
            weekdaysAfter(from, rule.days), // forgot the holiday
            nextCourtDay(addDays(from, rule.days)), // counted calendar days
            rule.days > 1 ? courtDaysAfter(from, rule.days - 1) : from, // counted the day of the event
            courtDaysAfter(due, 1),
            addDays(due, 7),
          ];
        } else {
          due = computeDeadline({ from, days: rule.days }).due;
          const unrolled = addDays(from, rule.days);
          candidates = [
            unrolled, // didn't move off the weekend or holiday
            previousCourtDay(unrolled), // moved backward
            nextCourtDay(addDays(from, rule.days - 1)), // counted the day of the event
            courtDaysAfter(from, rule.days), // counted business days
            nextCourtDay(addDays(due, 1)),
            addDays(due, 7),
          ];
        }
        const wrong = threeWrong(formatDate(due), candidates.map((d) => formatDate(d)));
        if (!wrong) continue;
        const window = holidaysBetween(from, addDays(from, rule.days + 14));
        return set(
          "Filing calendar",
          "Which date do you calendar as the filing deadline?",
          [
            ["Client", rule.client],
            ["Event", rule.event],
            ["Date of the event", formatDate(from)],
            ["Rule", rule.rule],
            ["Federal holidays in the window", window.length ? window.map((h) => `${formatDate(h.date)} (${h.name})`).join("; ") : "None"],
          ],
          formatDate(due),
          wrong,
        );
      }
    }),
  );
}

// ---- Rapid rounds B and C: banks of questions ----

interface BankQuestion {
  prompt: (c: Ctx) => string;
  right: string;
  wrong: [string, string, string];
}
interface Ctx {
  ceo: PersonName;
  director: PersonName;
  cp: string;
}

const GOV_EASY: BankQuestion[] = [
  {
    prompt: () => "Which document sets the number of shares Halyard is authorized to issue?",
    right: "The certificate of incorporation",
    wrong: ["The bylaws", "The stock ledger", "The board minutes"],
  },
  {
    prompt: () => "What is a quorum?",
    right: "The minimum number of members who must be present for the meeting to act",
    wrong: ["A majority of the votes cast", "The chair's tie-breaking vote", "The written notice of a meeting"],
  },
  { prompt: () => "Who elects Halyard's board of directors?", right: "The stockholders", wrong: ["The officers", "The CEO alone", "The registered agent"] },
  {
    prompt: () => "Who appoints Halyard's officers (CEO, CFO, secretary) under typical bylaws?",
    right: "The board of directors",
    wrong: ["The stockholders at the annual meeting", "The registered agent", "The Delaware Secretary of State"],
  },
  {
    prompt: () => "What does Halyard's registered agent do?",
    right: "Receives service of process and official notices in Delaware",
    wrong: ["Signs contracts for the company", "Votes the company's shares", "Audits the stock ledger"],
  },
  {
    prompt: () => "What is a stock ledger?",
    right: "The company's record of who holds its shares",
    wrong: ["A list of the company's bank accounts", "The board's meeting minutes", "The charter's authorized share count"],
  },
  {
    prompt: () => "What is a good standing certificate?",
    right: "The state's confirmation that the company exists and is current on its filings and taxes",
    wrong: ["A bank's credit reference", "An auditor's opinion on the accounts", "A director's resignation letter"],
  },
  {
    prompt: () => "What does a secretary's certificate usually certify?",
    right: "That the attached charter, bylaws and resolutions are true, complete and in effect",
    wrong: ["The company's financial statements", "The value of the company's shares", "That every company contract is enforceable"],
  },
  {
    prompt: () => "Preferred stock usually has what over common stock?",
    right: "A liquidation preference",
    wrong: ["Unlimited voting power", "No right to convert", "A guaranteed board majority"],
  },
  {
    prompt: () => "A stockholder wants to sell shares to an outsider. What does Halyard's right of first refusal give the company?",
    right: "The right to buy the shares first, on the same terms",
    wrong: ["The right to block any sale forever", "The right to set the price", "The right to keep the sale proceeds"],
  },
  {
    prompt: () => "What does a drag-along provision do?",
    right: "Lets the majority require the other holders to join a sale of the company",
    wrong: ["Lets any holder force the company to buy their shares", "Lets the company repurchase unvested shares", "Lets investors add a director"],
  },
  {
    prompt: () => "What are minutes?",
    right: "The official written record of what a meeting did",
    wrong: ["The agenda sent before the meeting", "A director's personal notes", "The notice of the meeting"],
  },
  {
    prompt: () => "Options under Halyard's stock plan are options to buy…",
    right: "Common Stock at a set exercise price",
    wrong: ["Preferred Stock at a discount", "Any class the holder chooses", "Bonds issued by the company"],
  },
];

const GOV_HARD: BankQuestion[] = [
  {
    prompt: () => "Can Halyard's board act by written consent without a meeting (DGCL §141(f))?",
    right: "Yes, if every director consents in writing",
    wrong: ["Yes, if a majority of directors sign", "No, the board must always meet", "Yes, if the CEO signs"],
  },
  {
    prompt: () => "Can Halyard's stockholders act by written consent (DGCL §228) when the charter doesn't say otherwise?",
    right: "Yes, if holders with the votes needed at a meeting sign, with prompt notice to the others",
    wrong: ["Only if every stockholder signs", "No, stockholders must always meet", "Yes, if the board approves the consent"],
  },
  {
    prompt: () => "Notice of a stockholders' meeting (DGCL §222) must go out…",
    right: "Not less than 10 nor more than 60 days before the meeting",
    wrong: ["At least 2 days before the meeting", "Exactly 30 days before the meeting", "Any time before the meeting"],
  },
  {
    prompt: (c) => `${c.director.full} attends a special meeting without objecting, though the notice was late. Under DGCL §229, ${c.director.first}'s notice defect is…`,
    right: "Waived by attending",
    wrong: ["Still a defect that voids the meeting", "Cured only by a court order", "Cured only by a stockholder vote"],
  },
  {
    prompt: () => "Shares were issued without proper board approval. Which Delaware statute lets the company ratify it?",
    right: "DGCL §204",
    wrong: ["DGCL §102", "DGCL §141(f)", "DGCL §228"],
  },
];

const CON_EASY: BankQuestion[] = [
  {
    prompt: () => 'What does an NDA usually exclude from "Confidential Information"?',
    right: "Information that is already public through no fault of the recipient",
    wrong: ["Anything marked confidential", "Trade secrets", "Financial projections"],
  },
  {
    prompt: () => "What does a governing law clause decide?",
    right: "Which jurisdiction's law interprets the contract",
    wrong: ["Where lawsuits must be filed", "Which party pays legal fees", "When the contract ends"],
  },
  {
    prompt: () => "What does a venue (forum) clause decide?",
    right: "Where disputes must be brought",
    wrong: ["Which law applies", "Who pays the court fees", "How notices are sent"],
  },
  {
    prompt: () => "What is an indemnity?",
    right: "A promise to cover the other party's losses from specified claims",
    wrong: ["A cap on damages", "A promise to keep information confidential", "A right to end the contract early"],
  },
  {
    prompt: () => "What does a limitation of liability clause do?",
    right: "Caps or excludes the damages a party can recover",
    wrong: ["Lists who may sign the contract", "Sets the governing law", "Extends the contract's term"],
  },
  {
    prompt: () => "What does a counterparts clause allow?",
    right: "Signing separate copies that together make one agreement",
    wrong: ["Assigning the contract to an affiliate", "Ending the contract on notice", "Amending the contract by email"],
  },
  {
    prompt: () => "What does an entire agreement (integration) clause do?",
    right: "Makes the written contract the whole deal, replacing earlier discussions",
    wrong: ["Adds every earlier email to the contract", "Lets either party amend it orally", "Joins the contract with the parties' other contracts"],
  },
  {
    prompt: () => "What does a severability clause do?",
    right: "Keeps the rest of the contract in force if one part is invalid",
    wrong: ["Ends the whole contract if one part is invalid", "Lets a party leave the contract at will", "Splits the contract into two"],
  },
  {
    prompt: () => "What is an automatic renewal (evergreen) clause?",
    right: "The term renews on its own unless a party gives notice",
    wrong: ["The contract can never be ended", "The price goes up every year", "The contract ends unless both parties sign again"],
  },
  {
    prompt: () => "A non-solicitation clause in an NDA usually stops a party from…",
    right: "Recruiting the other party's employees for a period",
    wrong: ["Competing in the same market", "Disclosing confidential information", "Suing the other party"],
  },
  {
    prompt: () => "What does an assignment clause control?",
    right: "Whether a party can transfer its rights or obligations to someone else",
    wrong: ["Who owns the intellectual property", "Which court hears disputes", "How the price is paid"],
  },
  {
    prompt: () => "What is a force majeure clause?",
    right: "It excuses performance when events beyond a party's control prevent it",
    wrong: ["It sets the damages for late performance", "It lets the stronger party end the contract", "It requires insurance for every risk"],
  },
  {
    prompt: () => "What does a survival clause do?",
    right: "Keeps named obligations in force after the contract ends",
    wrong: ["Ends every obligation when the contract ends", "Renews the contract automatically", "Lets the contract pass to a successor"],
  },
];

const CON_HARD: BankQuestion[] = [
  {
    prompt: (c) => `${c.cp} asks for a residuals clause in its NDA with Halyard. What is a residuals clause?`,
    right: "It lets the recipient use information kept in unaided memory",
    wrong: ["It requires the recipient to destroy every copy", "It sets the damages for a leak", "It extends the NDA after it ends"],
  },
  {
    prompt: () => "In Halyard's Series A stock purchase agreement, what is a closing condition?",
    right: "Something that must happen, or be waived, before a party has to close",
    wrong: ["A promise that applies only after closing", "A payment due after closing", "A statement of fact about the past"],
  },
  {
    prompt: () => 'What is the "bring-down" at closing?',
    right: "Confirming the representations are still true at closing",
    wrong: ["Lowering the price at closing", "Moving the closing date", "Removing a director at closing"],
  },
  {
    prompt: () => "What does a change-of-control clause typically trigger?",
    right: "Consent or termination rights when ownership of a party changes",
    wrong: ["A new governing law", "An automatic price cut", "A board seat for the other party"],
  },
  {
    prompt: () => "What is the difference between a representation and a covenant?",
    right: "A representation states a fact; a covenant promises future action",
    wrong: ["A representation promises future action; a covenant states a fact", "They mean the same thing", "Only a covenant can be breached"],
  },
  {
    prompt: () => "What does a most-favored-nation (MFN) clause do?",
    right: "Gives a party terms at least as good as any later party gets",
    wrong: ["Gives a party the first offer on any sale", "Lets a party choose the governing law", "Exempts a party from the liability cap"],
  },
];

function bankStep(id: string, title: string, intro: string, prefix: string) {
  return {
    id,
    type: RAPID_ROUND,
    title,
    config: {
      intro,
      secondsPerItem: 20,
      items: rapidItems(prefix, (n) => ({ prompt: `{{${prefix}_${n}}}`, fields: answerField(`${prefix}_${n}`) })),
    },
  };
}

const rapidGovernanceStep = bankStep(
  "rapid-governance",
  "Rapid round: governance terms",
  "Governance: 15 quick questions about Halyard's corporate housekeeping under Delaware law, 20 seconds each.",
  "gv",
);
const rapidContractsStep = bankStep("rapid-contracts", "Rapid round: contract terms", "Contract terms: 15 quick questions, 20 seconds each.", "ct");

type Built = { prompt: string; right: string; wrong: string[] };

function buildBank(rng: Rng, v: Values, prefix: string, easy: (() => Built)[], hard: (() => Built)[]): Record<string, ChoiceKey> {
  const slots = fillSlots(rng.shuffle(easy).slice(0, 10), rng.shuffle(hard).slice(0, 5));
  return Object.fromEntries(
    slots.map((make, i) => {
      const n = slotNo(i);
      const q = make();
      const { labels, letter } = placeOptions(rng, q.right, q.wrong);
      v[`${prefix}_${n}`] = q.prompt;
      LETTERS.forEach((l, j) => (v[`${prefix}_${n}_${l}`] = labels[j]));
      return [`${prefix}-${n}`, { answer: { choice: letter } }];
    }),
  );
}

const fromBank = (ctx: Ctx) => (q: BankQuestion) => () => ({ prompt: q.prompt(ctx), right: q.right, wrong: q.wrong });

function outstandingQuestion(rng: Rng): Built {
  const authorized = mult(rng, 15_000_000, 30_000_000, 1_000_000);
  const issued = mult(rng, 6_000_000, authorized - 2_000_000, 10_000);
  const treasury = mult(rng, 50_000, 600_000, 5_000);
  return {
    prompt: `Halyard's charter authorizes ${fmt(authorized)} shares. It has issued ${fmt(issued)}, and has bought back ${fmt(treasury)} that it holds as treasury stock. How many shares are outstanding?`,
    right: fmt(issued - treasury),
    wrong: [fmt(issued), fmt(authorized - issued), fmt(authorized - issued + treasury)],
  };
}

function quorumQuestion(rng: Rng): Built {
  for (;;) {
    const seats = rng.pick([5, 7, 9]);
    const vacant = rng.int(1, 3);
    const right = Math.floor(seats / 2) + 1;
    const filled = seats - vacant;
    const wrong = [...new Set([Math.floor(filled / 2) + 1, filled, Math.floor(seats / 2), seats])].filter((x) => x !== right);
    if (wrong.length < 3) continue;
    return {
      prompt: `Halyard's board has ${seats} seats, ${vacant} of them vacant. The bylaws make a majority of the whole board a quorum. How many directors must attend for a quorum?`,
      right: String(right),
      wrong: wrong.slice(0, 3).map(String),
    };
  }
}

// ---- Section A: cap table update ----

interface CapRow {
  id: string;
  holder: string;
  cls: string;
  before: number;
  after: number;
}

const CAP_ROWS = 8;
/** Fixed input ids per line (the line order never changes, only the names and numbers). */
const CAP_IDS = ["ceo", "cto", "trust", "emp", "seed", "sera", "opts", "pool"] as const;
const capTableStep = {
  id: "cap-table",
  type: SPREADSHEET,
  title: "Cap table: after the Series A",
  config: {
    prompt: [
      "Update Halyard's cap table for the five transactions in {{partner_first}}'s email.",
      "Enter each line's shares after all five, the new fully diluted total, and each line's fully diluted percentage to two decimals (for example 12.34).",
    ].join("\n"),
    columns: ["Holder", "Class", "Before: shares", "After: shares", "After: fully diluted %"],
    rows: [
      ...Array.from({ length: CAP_ROWS }, (_, i) => [
        `{{cap_${i + 1}_holder}}`,
        `{{cap_${i + 1}_class}}`,
        { text: `{{cap_${i + 1}_before}}`, align: "right" },
        { input: `${CAP_IDS[i]}_sh`, label: `Line ${i + 1}: shares after`, format: "number" },
        { input: `${CAP_IDS[i]}_pct`, label: `Line ${i + 1}: fully diluted %`, format: "number", points: 1.25 },
      ]),
      [{ text: "Total fully diluted", bold: true }, "", { text: "{{cap_total_before}}", align: "right", bold: true }, { input: "total_sh", label: "Total fully diluted shares", format: "number", points: 2 }, { text: "100.00%", align: "right" }],
    ],
  },
};


// ---- Section B: board actions vs. the bylaws ----

type BoardKind = "quorum" | "notice" | "unsigned" | "wrong_class" | "ok_special" | "ok_regular" | "ok_uwc" | "ok_grant" | "ok_issue";
const BOARD_KINDS: BoardKind[] = ["quorum", "notice", "unsigned", "wrong_class", "ok_special", "ok_regular", "ok_uwc", "ok_grant", "ok_issue"];
const BOARD_ROWS = BOARD_KINDS.length;

const boardStep = {
  id: "board-consents",
  type: DOCUMENT_REVIEW,
  title: "Board actions vs. the bylaws",
  config: {
    prompt: [
      "Check each board action since the Series Seed against Halyard's bylaws, charter and stock plan (in the header).",
      "Flag each defective action with the reason, then decide what to do before the minute book goes to the investors' counsel.",
    ].join("\n"),
    document: {
      title: "Minute book check · board actions since {{board_since}}",
      fields: [
        { id: "company", label: "Company", value: `${COMPANY} (Delaware)` },
        { id: "board", label: "Board", value: "Directors: {{board_list}} ({{board_size}} seats, all filled)" },
        { id: "quorum", label: "Bylaws §3.7", value: "A majority of the whole board is a quorum" },
        { id: "notice", label: "Bylaws §3.5", value: "Regular meetings need no notice; special meetings need at least {{notice_days}} days' notice to every director" },
        { id: "consent", label: "Bylaws §3.9", value: "The board may act without a meeting only if every director consents in writing (DGCL §141(f))" },
        { id: "charter", label: "Charter", value: "Authorizes {{auth_common}} shares of Common Stock and {{auth_seed}} shares of Series Seed Preferred Stock; no other class or series" },
        { id: "plan", label: "Stock Plan", value: "Grants options over Common Stock only" },
      ],
      columns: ["Date", "How the board acted", "Notice sent", "Directors present or signing", "Action", "Stock"],
      rows: Array.from({ length: BOARD_ROWS }, (_, i) => ({
        id: `b${i + 1}`,
        cells: ["date", "how", "notice", "who", "action", "stock"].map((c) => `{{bd_${i + 1}_${c}}}`),
      })),
      totals: [],
    },
    reasons: [
      { id: "quorum", label: "No quorum" },
      { id: "notice", label: "Not enough notice of a special meeting" },
      { id: "unsigned", label: "Written consent not signed by every director" },
      { id: "wrong_class", label: "Stock the charter or the plan doesn't allow" },
      { id: "other", label: "Other" },
    ],
    findings: [
      { id: "quorum", label: "Meeting held without a quorum", points: 4.5 },
      { id: "notice", label: "Special meeting on short notice", points: 4.5 },
      { id: "unsigned", label: "Written consent missing a director's signature", points: 4.5 },
      { id: "wrong_class", label: "Shares or options of a class that isn't allowed", points: 4.5 },
    ],
    falseFlagPenalty: 1,
    decision: {
      prompt: "The minute book goes to the Series A investors' counsel tomorrow. What do you do?",
      options: [
        { id: "send", label: "Send the minute book as it is to the investors' counsel" },
        { id: "fix", label: "Fix the records myself: redate the notices, add the missing signature and change the stock class" },
        {
          id: "report",
          label: "Send {{partner_first}} the list of defects first: those actions need an attorney's call, likely ratification under DGCL §204, before the minute book goes out",
        },
        { id: "strip", label: "Take the defective pages out of the minute book and send the rest" },
      ],
      points: 2,
    },
  },
};

const ORDINARY_ACTIONS = [
  "Approve next year's operating budget",
  "Appoint {cfo} as Chief Financial Officer",
  "Approve a lease for the new robotics lab",
  "Approve a bank credit line for equipment",
  "Adopt an expense and travel policy",
  "Approve the engagement of the company's auditors",
  "Approve the independent valuation of the Common Stock",
  "Approve the form of employee invention assignment agreement",
  "Authorize the officers to open a new bank account",
];

// ---- Section C: NDA vs. playbook, closing checklist, inbox ----

type NdaKind = "term" | "survival" | "cap" | "law" | "venue" | "nonsolicit" | "renewal" | "return";
const NDA_KINDS: NdaKind[] = ["term", "survival", "cap", "law", "venue", "nonsolicit", "renewal", "return"];
const NDA_HEADINGS: Record<NdaKind, string> = {
  term: "Term",
  survival: "Survival",
  cap: "Limitation of liability",
  law: "Governing law",
  venue: "Venue",
  nonsolicit: "Non-solicitation",
  renewal: "Renewal",
  return: "Return of information",
};

const ndaStep = {
  id: "nda-review",
  type: DOCUMENT_REVIEW,
  seconds: 270,
  title: "NDA vs. Halyard's playbook",
  config: {
    prompt: "Check {{cp}}'s draft mutual NDA against Halyard's NDA playbook (in the header). Flag each clause the playbook doesn't allow, with the reason.",
    document: {
      title: "Mutual NDA · {{cp}} draft of {{nda_date}}",
      fields: [
        { id: "parties", label: "Parties", value: `${COMPANY} and {{cp}}` },
        { id: "pb_term", label: "Playbook: term", value: "Term: no more than {{pb_term}} years" },
        { id: "pb_survival", label: "Playbook: confidentiality", value: "Confidentiality: at least {{pb_survival}} years after disclosure" },
        { id: "pb_cap", label: "Playbook: liability", value: "Limitation of liability: no cap, or a cap of at least ${{pb_cap}}" },
        { id: "pb_law", label: "Playbook: governing law", value: "Delaware law only" },
        { id: "pb_venue", label: "Playbook: venue", value: "State or federal courts in Delaware" },
        { id: "pb_nonsolicit", label: "Playbook: non-solicitation", value: "Non-solicitation: none, or no more than {{pb_ns}} months" },
        { id: "pb_renewal", label: "Playbook: renewal", value: "No automatic renewal: a fixed term only" },
        { id: "pb_return", label: "Playbook: return", value: "Return or destroy on request; one archival copy for compliance is fine" },
      ],
      columns: ["Section", "Heading", "Draft text"],
      rows: NDA_KINDS.map((_, i) => ({ id: `n${i + 1}`, cells: [`§${i + 1}`, `{{nda_${i + 1}_head}}`, `{{nda_${i + 1}_text}}`] })),
      totals: [],
    },
    reasons: [
      { id: "below_min", label: "Below the playbook minimum" },
      { id: "above_max", label: "Longer than the playbook allows" },
      { id: "wrong_choice", label: "Not the playbook's required choice" },
      { id: "not_allowed", label: "A term the playbook doesn't allow" },
      { id: "other", label: "Other" },
    ],
    findings: [
      { id: "liability_cap", label: "Liability cap below the playbook minimum", points: 3 },
      { id: "governing_law", label: "Governing law isn't Delaware", points: 3 },
      { id: "non_solicit", label: "Non-solicit longer than the playbook allows", points: 3 },
      { id: "auto_renewal", label: "Automatic renewal", points: 3 },
    ],
    falseFlagPenalty: 1,
  },
};

const CHECK_ROWS = 9;
const checklistStep = {
  id: "closing-checklist",
  type: DOCUMENT_REVIEW,
  seconds: 240,
  title: "Series A closing checklist",
  config: {
    prompt: "Closing is scheduled for today. Check every signature page and closing condition, flag each gap with the reason, then decide what to do.",
    document: {
      title: "Series A closing checklist · {{lead}} (lead) and {{second}}",
      fields: [
        { id: "closing", label: "Closing", value: "Closing date: {{closing}}" },
        { id: "company", label: "Company", value: `${COMPANY}, signing by {{ceo}}, CEO` },
      ],
      columns: ["Item", "Needed for closing", "Received or status"],
      rows: Array.from({ length: CHECK_ROWS }, (_, i) => ({ id: `c${i + 1}`, cells: ["item", "need", "got"].map((c) => `{{ck_${i + 1}_${c}}}`) })),
      totals: [],
    },
    reasons: [
      { id: "missing_sig", label: "Signature page missing" },
      { id: "unmet", label: "Closing condition not met" },
      { id: "other", label: "Other" },
    ],
    findings: [
      { id: "sig_1", label: "Missing signature page", points: 2 },
      { id: "sig_2", label: "Missing signature page (second document)", points: 2 },
      { id: "cond_1", label: "Unmet closing condition", points: 2 },
      { id: "cond_2", label: "Unmet closing condition (second)", points: 2 },
    ],
    falseFlagPenalty: 1,
    decision: {
      prompt: "The investors are ready to wire. What do you do?",
      options: [
        { id: "close", label: "Close today and collect the missing pages afterwards" },
        {
          id: "hold",
          label: "Hold the closing: tell {{partner_first}} what's missing; it closes once the pages are in and each condition is met or waived in writing by the investors",
        },
        { id: "fill", label: "Use signature pages from an earlier draft to fill the gaps" },
        { id: "release", label: "Release the investors' wires to Halyard now so the money isn't late" },
      ],
      points: 2,
    },
  },
};

const founderStep = {
  id: "inbox-founder",
  type: MULTIPLE_CHOICE,
  seconds: 105,
  title: "Email from Halyard's CEO",
  config: { prompt: "{{ceo_first}} wants the option grant consent dated earlier. What do you do?", options: letterOptions("fd"), select: "single", points: 4 },
};

const diligenceStep = {
  id: "inbox-diligence",
  type: MULTIPLE_CHOICE,
  seconds: 105,
  title: "Email from a prospective acquirer",
  config: { prompt: "{{dil_first}} at {{cp}} wants Halyard's cap table. What do you do?", options: letterOptions("dg"), select: "single", points: 4 },
};

const DEFINITION = {
  intro:
    "You're a corporate paralegal at {{firm}}, working for {{partner}}, a partner, on Halyard Robotics, Inc., a Delaware corporation that builds warehouse robots and is closing its Series A. The work comes in six timed parts, 50 minutes in all: three rapid rounds of quick items (ownership and filing deadlines, governance terms, contract terms), a cap table update, a check of board actions against the bylaws, and a deal desk with an NDA, the closing checklist and your inbox. A finished part can't be reopened. The people, companies and funds are fictional; the filing rules and Delaware law cited are real.",
  steps: [rapidOwnershipStep, capTableStep, rapidGovernanceStep, boardStep, rapidContractsStep, ndaStep, checklistStep, founderStep, diligenceStep],
  messages: [
    {
      id: "m1",
      from: "Your supervising partner",
      subject: "Halyard cap table after the Series A",
      body: [
        "Hi {{first_name}},",
        "",
        "The Series A has closed. Please update Halyard's cap table for these, in order:",
        "",
        "1. Series A financing: {{lead}} bought {{a_shares}} shares of Series A Preferred Stock.",
        "2. Option pool increase: the board and stockholders added {{pool_add}} shares to the option pool (available for grant).",
        "3. New option grant: {{hire}} was granted options over {{grant}} shares of Common Stock from the pool.",
        "4. Option exercise: {{emp}} exercised options over {{ex}} shares of Common Stock.",
        "5. Transfer: {{cto}} transferred {{tr}} shares of Common Stock to the {{trust}}.",
        "",
        "Fully diluted means every issued share (preferred counted as converted, one for one), plus options outstanding, plus shares still available in the pool. Percentages to two decimals.",
        "",
        "{{partner}}",
      ].join("\n"),
      arriveAtMinute: 0,
      stepId: "cap-table",
    },
    {
      id: "m2",
      from: "Your supervising partner",
      subject: "Minute book before diligence",
      body: [
        "Hi {{first_name}},",
        "",
        "The Series A investors' counsel will review Halyard's minute book tomorrow. Check every board action since the Series Seed against the bylaws, the charter and the stock plan: quorum, notice, written consents and the stock each action touches.",
        "",
        "Flag anything defective and tell me what you'll do with the minute book. Please don't change any signed record yourself.",
        "",
        "{{partner}}",
      ].join("\n"),
      arriveAtMinute: 0,
      stepId: "board-consents",
    },
    {
      id: "m3",
      from: "Your supervising partner",
      subject: "NDA from {{cp}}",
      body: [
        "Hi {{first_name}},",
        "",
        "{{cp}} sent its draft mutual NDA. Before I mark it up, check it against our NDA playbook for Halyard (it's in the review header) and flag every clause outside it.",
        "",
        "{{partner}}",
      ].join("\n"),
      arriveAtMinute: 0,
      stepId: "nda-review",
    },
    {
      id: "m4",
      from: "Your supervising partner",
      subject: "Series A closing today",
      body: [
        "Hi {{first_name}},",
        "",
        "We're closing the Series A today. Go through the checklist: every signature page from every signatory, and every closing condition. Nothing closes with a gap unless the investors waive it in writing.",
        "",
        "{{partner}}",
      ].join("\n"),
      arriveAtMinute: 0,
      stepId: "closing-checklist",
    },
    {
      id: "m5",
      from: "CEO, Halyard Robotics",
      subject: "Option grant consent: small date fix",
      body: [
        "Hi {{first_name}},",
        "",
        "The board consent for {{hire}}'s option grant is still going around for signatures. Can you date it {{early}} instead? The new valuation came in on {{val_date}} with a higher price, and if the consent is dated before that, {{hire_first}} gets the old exercise price. Just print it with the earlier date and I'll collect the signatures.",
        "",
        "{{ceo}}",
      ].join("\n"),
      arriveAtMinute: 0,
      stepId: "inbox-founder",
    },
    {
      id: "m6",
      from: "Corporate development, prospective acquirer",
      subject: "Halyard cap table",
      body: [
        "Hi {{first_name}},",
        "",
        "We'd like to move quickly on a possible deal with Halyard. Our NDA is still with your team, but could you send Halyard's current cap table now, including the option holders' names? It would help us get ahead on valuation.",
        "",
        "Thanks,",
        "{{dil}}, Corporate Development, {{cp}}",
      ].join("\n"),
      arriveAtMinute: 0,
      stepId: "inbox-diligence",
    },
  ],
  sections: [
    { id: "s-rapid-a", title: "Rapid round: ownership and filing deadlines", minutes: 6, stepIds: ["rapid-ownership"] },
    { id: "s-cap-table", title: "Cap table", minutes: 10, stepIds: ["cap-table"] },
    { id: "s-rapid-b", title: "Rapid round: governance terms", minutes: 6, stepIds: ["rapid-governance"] },
    { id: "s-board", title: "Board actions", minutes: 10, stepIds: ["board-consents"] },
    { id: "s-rapid-c", title: "Rapid round: contract terms", minutes: 6, stepIds: ["rapid-contracts"] },
    { id: "s-deal", title: "Deal desk and inbox", minutes: 12, stepIds: ["nda-review", "closing-checklist", "inbox-founder", "inbox-diligence"], oneAtATime: true },
  ],
};

// ---- Leak guard ----

/**
 * The candidate's screen must not show a computed cap table answer in any form
 * (12.34, 1234 as cents, 1,234,567.00). Share counts are shown with commas and
 * no decimals, so they can't match; a percentage can collide with a year or a
 * rapid-round percentage by chance, so the generator draws again when it does.
 */
const STATIC_TEXT = JSON.stringify(DEFINITION);
function leakForms(value: number): RegExp[] {
  const forms = [JSON.stringify(value), value.toFixed(2), String(Math.round(value * 100)), value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })];
  return [...new Set(forms)].filter((f) => !/^\d{1,3}$/.test(f)).map((s) => new RegExp(`(?<![\\d.,])${s.replace(/[.$]/g, "\\$&")}(?![\\d.]\\d)`));
}
function leaks(values: Values, numbers: number[]): boolean {
  const text = `${STATIC_TEXT}\n${Object.values(values).join("\n")}`;
  return numbers.some((n) => n >= 1 && leakForms(n).some((re) => re.test(text)));
}

// ---- Generator ----

const dateBetween = (rng: Rng, from: IsoDate, to: IsoDate) => addDays(from, rng.int(0, daysBetween(from, to)));
function weekdayBetween(rng: Rng, from: IsoDate, to: IsoDate): IsoDate {
  for (;;) {
    const d = dateBetween(rng, from, to);
    if (isCourtDay(d)) return d;
  }
}

function buildOnce(rng: Rng) {
  const v: Values = {};
  const firm = rng.pick(LAW_FIRMS);
  const [pPartner, pCeo, pCto, pCfo, pEmp, pHire, pSeedDir, pIndep1, pIndep2, pIndep3, pIndep4, pDil, pFormer, ...pOthers] = distinctPeople(rng, 18);
  const [seedFund, lead, second] = pickDistinct(rng, FUNDS, 3);
  const cp = rng.pick(COUNTERPARTIES);
  const trust = `${pCto.last} Family Trust`;
  Object.assign(v, {
    firm: firm.name,
    partner: pPartner.full,
    partner_first: pPartner.first,
    ceo: pCeo.full,
    ceo_first: pCeo.first,
    cto: pCto.full,
    emp: pEmp.full,
    hire: pHire.full,
    hire_first: pHire.first,
    lead,
    second,
    trust,
    cp,
    dil: pDil.full,
    dil_first: pDil.first,
  });

  // ---- Section A: cap table ----
  const ceoShares = mult(rng, 2_500_000, 4_500_000, 5_000);
  const ctoShares = mult(rng, 1_500_000, 3_500_000, 5_000);
  const empBefore = rng.int(0, 1) ? 0 : mult(rng, 10_000, 60_000, 1_000);
  const seedShares = mult(rng, 1_000_000, 2_500_000, 5_000);
  const optsBefore = mult(rng, 400_000, 1_000_000, 5_000);
  const poolBefore = mult(rng, 200_000, 700_000, 5_000);
  const aShares = mult(rng, 1_800_000, 3_500_000, 5_000);
  const poolAdd = mult(rng, 300_000, 900_000, 5_000);
  const grant = mult(rng, 50_000, 200_000, 5_000);
  const ex = mult(rng, 20_000, 150_000, 1_000);
  const tr = mult(rng, 100_000, 600_000, 5_000);
  const cap: CapRow[] = [
    { id: "ceo", holder: pCeo.full, cls: "Common", before: ceoShares, after: ceoShares },
    { id: "cto", holder: pCto.full, cls: "Common", before: ctoShares, after: ctoShares - tr },
    { id: "trust", holder: trust, cls: "Common", before: 0, after: tr },
    { id: "emp", holder: pEmp.full, cls: "Common", before: empBefore, after: empBefore + ex },
    { id: "seed", holder: seedFund, cls: "Series Seed Preferred", before: seedShares, after: seedShares },
    { id: "sera", holder: lead, cls: "Series A Preferred", before: 0, after: aShares },
    { id: "opts", holder: "Options outstanding (granted, not exercised)", cls: "Options over Common", before: optsBefore, after: optsBefore + grant - ex },
    { id: "pool", holder: "Option pool: available for grant", cls: "Reserved Common", before: poolBefore, after: poolBefore + poolAdd - grant },
  ];
  const totalBefore = cap.reduce((s, r) => s + r.before, 0);
  const totalAfter = cap.reduce((s, r) => s + r.after, 0);
  cap.forEach((r, i) => {
    if (r.id !== CAP_IDS[i]) throw new Error("corporate-halyard-robotics: cap table lines out of order");
    Object.assign(v, { [`cap_${i + 1}_holder`]: r.holder, [`cap_${i + 1}_class`]: r.cls, [`cap_${i + 1}_before`]: fmt(r.before) });
  });
  Object.assign(v, { cap_total_before: fmt(totalBefore), a_shares: fmt(aShares), pool_add: fmt(poolAdd), grant: fmt(grant), ex: fmt(ex), tr: fmt(tr) });
  const capCells: Record<string, { value: number; tolerance?: number }> = { total_sh: { value: totalAfter } };
  for (const r of cap) {
    capCells[`${r.id}_sh`] = { value: r.after };
    capCells[`${r.id}_pct`] = { value: pctValue(r.after, totalAfter), tolerance: 0.01 };
  }

  // ---- Section B: board actions ----
  const size = rng.pick([5, 7]);
  const board = [pCeo, pCto, pSeedDir, pIndep1, pIndep2, pIndep3, pIndep4].slice(0, size);
  const quorum = Math.floor(size / 2) + 1;
  const noticeDays = rng.pick([2, 3, 5, 7]);
  const authCommon = mult(rng, 20_000_000, 30_000_000, 1_000_000);
  const authSeed = mult(rng, seedShares + 500_000, seedShares + 2_000_000, 50_000);
  Object.assign(v, {
    board_list: board.map((p) => p.full).join(", "),
    board_size: String(size),
    notice_days: String(noticeDays),
    auth_common: fmt(authCommon),
    auth_seed: fmt(authSeed),
  });
  const boardDates: IsoDate[] = [];
  while (boardDates.length < BOARD_ROWS) {
    const d = weekdayBetween(rng, "2026-01-12", "2026-09-30");
    if (!boardDates.includes(d)) boardDates.push(d);
  }
  boardDates.sort();
  v.board_since = formatDate(addDays(boardDates[0], -rng.int(10, 40)));
  const kinds = rng.shuffle(BOARD_KINDS);
  const ordinary = rng.shuffle(ORDINARY_ACTIONS).map((a) => a.replace("{cfo}", pCfo.full));
  const subset = (n: number) => {
    const chosen = new Set(rng.shuffle(board).slice(0, n));
    return board.filter((p) => chosen.has(p)).map((p) => p.full);
  };
  const boardKey: Record<string, { targets: string[]; reasons: string[]; note: string }> = {};
  kinds.forEach((kind, i) => {
    const k = i + 1;
    const date = boardDates[i];
    let how = "Unanimous written consent";
    let who: string[] = rng.shuffle(board.map((p) => p.full));
    let gap = noticeDays + rng.int(0, 3);
    let action = "";
    let stock = "None";
    const validForm = () => {
      if (rng.int(0, 1)) {
        how = "Regular meeting";
        who = subset(rng.int(quorum, size));
      }
    };
    switch (kind) {
      case "quorum":
        how = rng.pick(["Special meeting", "Regular meeting"]);
        who = subset(rng.int(Math.max(1, quorum - 2), quorum - 1));
        action = ordinary.pop()!;
        break;
      case "notice":
        how = "Special meeting";
        who = subset(rng.int(quorum, size - 1));
        gap = rng.int(1, noticeDays - 1);
        action = ordinary.pop()!;
        break;
      case "unsigned":
        who = rng.shuffle(board.map((p) => p.full)).slice(0, size - 1);
        action = ordinary.pop()!;
        break;
      case "ok_special":
        how = "Special meeting";
        who = subset(quorum);
        action = ordinary.pop()!;
        break;
      case "ok_regular":
        how = "Regular meeting";
        who = subset(rng.int(quorum, size));
        action = ordinary.pop()!;
        break;
      case "ok_uwc":
        action = ordinary.pop()!;
        break;
      case "wrong_class": {
        validForm();
        const bad = rng.int(0, 2);
        if (bad === 0) {
          action = `Grant options over ${fmt(mult(rng, 20_000, 120_000, 5_000))} shares to ${pOthers[0].full} under the Stock Plan`;
          stock = "Series Seed Preferred Stock";
        } else if (bad === 1) {
          action = `Issue ${fmt(mult(rng, 100_000, 400_000, 5_000))} shares to ${pOthers[0].full} for consulting services`;
          stock = "Class B Common Stock";
        } else {
          action = `Issue ${fmt(mult(rng, 300_000, 900_000, 5_000))} shares to ${lead} as an early bridge`;
          stock = "Series A Preferred Stock";
        }
        break;
      }
      case "ok_grant":
        validForm();
        action = `Grant options over ${fmt(mult(rng, 20_000, 120_000, 5_000))} shares to ${pOthers[1].full} under the Stock Plan`;
        stock = "Common Stock";
        break;
      case "ok_issue":
        validForm();
        if (rng.int(0, 1)) {
          action = `Issue ${fmt(mult(rng, 100_000, 400_000, 5_000))} shares to ${seedFund} in a second Series Seed closing`;
          stock = "Series Seed Preferred Stock";
        } else {
          action = `Repurchase ${fmt(mult(rng, 10_000, 80_000, 1_000))} unvested shares from ${pFormer.full}, a former employee`;
          stock = "Common Stock";
        }
        break;
    }
    const meeting = how !== "Unanimous written consent";
    Object.assign(v, {
      [`bd_${k}_date`]: formatDate(date),
      [`bd_${k}_how`]: how,
      [`bd_${k}_notice`]: !meeting ? "— (no meeting)" : how === "Regular meeting" ? "None needed (regular meeting)" : formatDate(addDays(date, -gap)),
      [`bd_${k}_who`]: `${meeting ? "Present" : "Signed"}: ${who.join(", ")}`,
      [`bd_${k}_action`]: action,
      [`bd_${k}_stock`]: stock,
    });
    const missing = board.map((p) => p.full).filter((p) => !who.includes(p));
    const notes: Partial<Record<BoardKind, string>> = {
      quorum: `On ${formatDate(date)} only ${who.length} of ${size} directors attended; a quorum is ${quorum}, so the board couldn't act.`,
      notice: `The special meeting on ${formatDate(date)} had ${gap} days' notice; the bylaws need ${noticeDays}, and ${missing.join(" and ")} didn't attend to waive it.`,
      unsigned: `The written consent of ${formatDate(date)} lacks ${missing.join(", ")}'s signature; a board consent must be signed by every director.`,
      wrong_class: `The action of ${formatDate(date)} uses ${stock}, which ${stock === "Series Seed Preferred Stock" ? "the Stock Plan doesn't allow for options" : "the charter doesn't authorize"}.`,
    };
    if (notes[kind]) boardKey[kind] = { targets: [`b${k}`], reasons: [kind], note: notes[kind]! };
  });

  // ---- Section C: NDA ----
  const pbTerm = rng.pick([2, 3]);
  const pbSurvival = rng.pick([2, 3]);
  const pbCap = rng.pick([1_000_000, 2_000_000, 5_000_000]);
  const pbNs = rng.pick([6, 12]);
  const draftCap = Math.round(pbCap * rng.pick([0.05, 0.1, 0.25, 0.5]));
  const draftNs = pbNs + rng.pick([6, 12, 18]);
  const state = rng.pick(OTHER_STATES);
  const term = rng.int(1, pbTerm);
  const surv = rng.int(pbSurvival, pbSurvival + 2);
  Object.assign(v, { pb_term: String(pbTerm), pb_survival: String(pbSurvival), pb_cap: fmt(pbCap), pb_ns: String(pbNs), nda_date: formatDate(weekdayBetween(rng, "2026-10-01", "2026-11-06")) });
  const ndaText: Record<NdaKind, string> = {
    term: `This Agreement lasts ${term} year${term === 1 ? "" : "s"} from the Effective Date.`,
    survival: `Confidentiality obligations last ${surv} years after each disclosure.`,
    cap: `Each party's total liability under this Agreement is capped at $${fmt(draftCap)}.`,
    law: `This Agreement is governed by the laws of the State of ${state}.`,
    venue: "Disputes go only to the state or federal courts in Wilmington, Delaware.",
    nonsolicit: `For ${draftNs} months after this Agreement ends, neither party will solicit the other's employees.`,
    renewal: "At the end of the term, this Agreement renews automatically for successive one-year terms unless either party gives 30 days' notice.",
    return: "On request, each party will return or destroy the other's information within 30 days, and may keep one archival copy for legal compliance.",
  };
  const ndaOrder = rng.shuffle(NDA_KINDS);
  ndaOrder.forEach((kind, i) => Object.assign(v, { [`nda_${i + 1}_head`]: NDA_HEADINGS[kind], [`nda_${i + 1}_text`]: ndaText[kind] }));
  const ndaId = (kind: NdaKind) => `n${ndaOrder.indexOf(kind) + 1}`;

  // ---- Section C: closing checklist ----
  const closing = weekdayBetween(rng, "2026-11-02", "2027-03-31");
  const gsDays = rng.pick([3, 5]);
  Object.assign(v, { closing: formatDate(closing) });
  const company = `${COMPANY} (by ${pCeo.full})`;
  const sigDocs: [string, string[]][] = [
    ["Series A Preferred Stock Purchase Agreement", [company, lead, second]],
    ["Investors' Rights Agreement", [company, lead, second]],
    ["Voting Agreement", [company, lead, second, pCeo.full, pCto.full]],
    ["Right of First Refusal and Co-Sale Agreement", [company, lead, second, pCeo.full, pCto.full]],
    ["Board consent approving the Series A", board.map((p) => p.full)],
    ["Stockholder consent approving the restated charter", [pCeo.full, pCto.full, seedFund]],
  ];
  const missingDocs = new Set(rng.shuffle(sigDocs.map((_, i) => i)).slice(0, 2));
  const unmetConds = new Set(rng.shuffle(["charter", "good_standing", "compliance"]).slice(0, 2));
  type CheckRow = { item: string; need: string; got: string; issue: "missing_sig" | "unmet" | null; note: string };
  const checkRows: CheckRow[] = sigDocs.map(([item, signers], i) => {
    const gone = missingDocs.has(i) ? rng.pick(signers) : null;
    const got = rng.shuffle(signers.filter((s) => s !== gone));
    return {
      item,
      need: `Signature pages: ${signers.join("; ")}`,
      got: `Signature pages in: ${got.join("; ")}`,
      issue: gone ? "missing_sig" : null,
      note: gone ? `The ${item} has no signature page from ${gone}.` : "",
    };
  });
  const filed = addDays(closing, -rng.int(1, 10));
  checkRows.push({
    item: "Restated certificate of incorporation",
    need: "Filed with the Delaware Secretary of State before closing",
    got: unmetConds.has("charter") ? `Signed ${formatDate(filed)} and sent for filing; no filing confirmation yet` : `Filed ${formatDate(filed)}; certified copy in the closing set`,
    issue: unmetConds.has("charter") ? "unmet" : null,
    note: "The restated charter isn't filed yet, so the Series A Preferred doesn't exist to be issued.",
  });
  const gsDate = addDays(closing, unmetConds.has("good_standing") ? -rng.int(gsDays + 3, gsDays + 20) : -rng.int(0, gsDays));
  checkRows.push({
    item: "Delaware good standing certificate",
    need: `Delaware good standing certificate dated no more than ${gsDays} days before closing`,
    got: `Dated ${formatDate(gsDate)}`,
    issue: unmetConds.has("good_standing") ? "unmet" : null,
    note: `The good standing certificate is dated ${formatDate(gsDate)}, more than ${gsDays} days before closing on ${formatDate(closing)}; order a bring-down.`,
  });
  checkRows.push({
    item: "Compliance certificate",
    need: `Compliance certificate signed by the CEO (${pCeo.full})`,
    got: unmetConds.has("compliance") ? `Signed by ${pCfo.full}, CFO` : `Signed by ${pCeo.full}, CEO`,
    issue: unmetConds.has("compliance") ? "unmet" : null,
    note: `The compliance certificate is signed by ${pCfo.full}, the CFO, but the purchase agreement needs the CEO, ${pCeo.full}.`,
  });
  const checkOrder = rng.shuffle(checkRows);
  checkOrder.forEach((r, i) => Object.assign(v, { [`ck_${i + 1}_item`]: r.item, [`ck_${i + 1}_need`]: r.need, [`ck_${i + 1}_got`]: r.got }));
  const flagged = (issue: CheckRow["issue"]) =>
    checkOrder.map((r, i) => ({ r, id: `c${i + 1}` })).filter((x) => x.r.issue === issue);
  const [sig1, sig2] = flagged("missing_sig");
  const [cond1, cond2] = flagged("unmet");

  // ---- Section C: inbox ----
  const valDate = weekdayBetween(rng, "2026-09-01", "2026-10-15");
  Object.assign(v, { val_date: formatDate(valDate), early: formatDate(addDays(valDate, -rng.int(5, 30))) });
  const fd = placeOptions(rng, `Don't backdate: tell ${pCeo.first} the consent takes effect when the last director signs, and pass the request to ${pPartner.full}`, [
    "Date it as asked: the board agreed to the grant informally back then",
    "Date it as asked, but keep the undated draft in the file as a record",
    `Leave the date blank so ${pCeo.first} can fill it in`,
  ]);
  const dg = placeOptions(rng, `Send nothing until the NDA is signed and ${pPartner.first} approves what goes out; reply that you'll come back to them`, [
    "Send it: a cap table isn't confidential",
    "Send it without the option holders' names",
    "Send it marked confidential, since the NDA is nearly agreed",
  ]);
  LETTERS.forEach((l, j) => {
    v[`fd_${l}`] = fd.labels[j];
    v[`dg_${l}`] = dg.labels[j];
  });

  // ---- Rapid rounds, drawn last so the rest of the material doesn't shift when they change ----
  const ctx: Ctx = { ceo: pCeo, director: rng.pick(board.slice(1)), cp };
  const rapidKeys = {
    "rapid-ownership": { items: buildOwnership(rng, v, pOthers.slice(2), FUNDS.filter((f) => f !== lead && f !== second)) },
    "rapid-governance": { items: buildBank(rng, v, "gv", [...GOV_EASY.map(fromBank(ctx)), () => outstandingQuestion(rng)], [...GOV_HARD.map(fromBank(ctx)), () => quorumQuestion(rng)]) },
    "rapid-contracts": { items: buildBank(rng, v, "ct", CON_EASY.map(fromBank(ctx)), CON_HARD.map(fromBank(ctx))) },
  };

  return {
    values: v,
    numbers: Object.values(capCells).map((c) => c.value),
    keys: {
      ...rapidKeys,
      "cap-table": { tolerance: 0, cells: capCells },
      "board-consents": { findings: boardKey, decision: ["report"] },
      "nda-review": {
        findings: {
          liability_cap: { targets: [ndaId("cap")], reasons: ["below_min"], note: `The draft caps liability at $${fmt(draftCap)}; the playbook's minimum cap is $${fmt(pbCap)}.` },
          governing_law: { targets: [ndaId("law")], reasons: ["wrong_choice"], note: `The draft picks ${state} law; the playbook requires Delaware law.` },
          non_solicit: { targets: [ndaId("nonsolicit")], reasons: ["above_max"], note: `The draft's non-solicit runs ${draftNs} months; the playbook allows ${pbNs} at most.` },
          auto_renewal: { targets: [ndaId("renewal")], reasons: ["not_allowed"], note: "The draft renews itself every year; the playbook allows a fixed term only." },
        },
      },
      "closing-checklist": {
        findings: {
          sig_1: { targets: [sig1.id], reasons: ["missing_sig"], note: sig1.r.note },
          sig_2: { targets: [sig2.id], reasons: ["missing_sig"], note: sig2.r.note },
          cond_1: { targets: [cond1.id], reasons: ["unmet"], note: cond1.r.note },
          cond_2: { targets: [cond2.id], reasons: ["unmet"], note: cond2.r.note },
        },
        decision: ["hold"],
      },
      "inbox-founder": { correct: [fd.letter] },
      "inbox-diligence": { correct: [dg.letter] },
    },
  };
}

export const corporateHalyardRobotics = defineScenario({
  slug: "corporate-halyard-robotics",
  version: 1,
  title: "Halyard Robotics entity work: corporate paralegal",
  roleFamily: "legal",
  timeLimitMinutes: 50,
  definition: DEFINITION,

  build(rng) {
    for (let tries = 0; tries < 200; tries++) {
      const { values, numbers, keys } = buildOnce(rng);
      if (!leaks(values, numbers)) return { values, keys };
    }
    throw new Error("corporate-halyard-robotics: every draw shows a cap table answer");
  },
});
