import "server-only";

import type { Rng } from "../server/rng";
import { defineScenario } from "../server/scenario";
import { formatCents } from "../server/template";
import { DOCUMENT_REVIEW } from "../step-types/document_review/public";
import { MULTIPLE_CHOICE } from "../step-types/multiple_choice/public";
import { RAPID_ROUND } from "../step-types/rapid_round/public";
import { SPREADSHEET } from "../step-types/spreadsheet/public";
import { LAST_NAMES, LAW_FIRMS, addDays, daysBetween, distinctPeople, formatDate, isLegalHoliday, isWeekend, pickDistinct, type IsoDate } from "./legal";

/**
 * Real estate paralegal at the settlement attorney's office: the sale of 418
 * Alder Lane, a duplex in the (fictional) State of Wexford whose seller lives
 * in one unit and rents the other. Six timed sections, 50 minutes, 100
 * points, all scored automatically:
 *
 *   rapid round A, prorations (10) → settlement statement (20) → rapid round
 *   B, title terms (10) → title commitment review (20) → rapid round C, deed
 *   and recording checks (10) → deed review (15), then two inbox calls (8 + 7),
 *   one screen at a time.
 *
 * Seeded per candidate: every name, amount, rate and date; the proration
 * convention (who owns the closing day) and whether the year's taxes are paid;
 * which title item and deed line carries which trap; the lender's change and
 * where the right option sits. The key is computed from the same values the
 * candidate sees, so the statement always ties.
 *
 * Rapid rounds: 15 items × 20 s. Items 3, 6, 9, 12, 15 are the harder kinds,
 * worth 1; the other ten are worth ½, so each round is exactly 10.
 *
 * Draft v1: team self-review pending (docs/paralegal/realestate-alder-closing.md).
 */

const SLUG = "realestate-alder-closing";
const LETTERS = ["a", "b", "c", "d"] as const;
const YEAR = 2027;
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const CITIES = ["Port Ellery", "Ashcombe", "New Harlow", "Kingsferry", "Dunmore Falls", "Westbrook Junction", "Carrow Bay", "Millhaven"];
const COUNTIES = ["Calloway County", "Brennan County", "Harwick County", "Ossory County"];
const SUBDIVISIONS = ["Alder Ridge", "Larkmoor Heights", "Fenwick Commons", "Birchwood Glen", "Quarry Hill Estates", "Tamsworth Park"];
const STREETS = ["Quarry Road", "Beacon Street", "Millrace Lane", "Orchard Way", "Kiln Avenue", "Hatter's Row"];
const LENDERS = ["Larchmont Savings Bank", "Copperline Mortgage Co.", "Bayview Federal Credit Union", "Kestrel Home Lending", "Oakhurst Bank & Trust", "Pinefield Mortgage Corp."];
const CONTRACTORS = ["Summit Roofing & Gutter Co.", "Brightline Electric, LLC", "Keystone Plumbing Co.", "Northwall Masonry, Inc."];
const CREDITORS = ["Westmark Collections, Inc.", "Ridgefield Medical Group", "Granite Auto Finance", "Harborview Furniture Co.", "Coldspring Credit Services"];
const UTILITIES = ["Wexford Power & Light", "Tri-County Gas Co.", "Wexford Water Authority"];
const INITIALS = [..."ABCDEFGHJKLMNPRSTVW"];

type Values = Record<string, string | number>;
type ChoiceKey = Record<string, { choice: string }>;

const usd = formatCents;

// ---- Dates ----

const ymd = (d: IsoDate) => ({ y: Number(d.slice(0, 4)), m: Number(d.slice(5, 7)) - 1, d: Number(d.slice(8, 10)) });
const iso = (y: number, m: number, d: number) => new Date(Date.UTC(y, m, d)).toISOString().slice(0, 10);
const daysInMonth = (d: IsoDate) => new Date(Date.UTC(ymd(d).y, ymd(d).m + 1, 0)).getUTCDate();
const dayOfYear = (d: IsoDate) => daysBetween(iso(ymd(d).y, 0, 1), d) + 1;
/** The last day of the month before `d`'s month, `back` months back. */
const monthEndBefore = (d: IsoDate, back = 1) => iso(ymd(d).y, ymd(d).m - back + 1, 0);

/** A business day between two dates, not within two days of a month's ends (so every proration has days on both sides). */
function closingDay(rng: Rng, from: IsoDate, to: IsoDate): IsoDate {
  for (;;) {
    const d = addDays(from, rng.int(0, daysBetween(from, to)));
    if (isWeekend(d) || isLegalHoliday(d)) continue;
    if (ymd(d).d < 3 || ymd(d).d > daysInMonth(d) - 2) continue;
    return d;
  }
}

// ---- Proration arithmetic (cents; round once at the end) ----

type Owner = "buyer" | "seller";

/** Days of a period up to closing that are the seller's. */
const sellerDays = (dayNo: number, owner: Owner) => dayNo - (owner === "buyer" ? 1 : 0);
const share = (amount: number, days: number, basis: number) => Math.round((amount * days) / basis);
/** Interest in cents: principal × rate ÷ basis per day. `rateMilli` is the rate in thousandths of a percent. */
const interest = (principal: number, rateMilli: number, days: number, basis = 365) => Math.round((principal * rateMilli * days) / (100_000 * basis));
const ratePct = (rateMilli: number) => (rateMilli / 1000).toFixed(3);

const conventionText = (owner: Owner) =>
  `365-day year for taxes and interest; rent and HOA dues by the actual days in the month; rent is prorated only if the seller collected it; the ${owner} owns the day of closing; round once, to the cent, at the end`;

// ---- Rapid round plumbing ----

const RAPID_ITEMS = 15;
/** Items 3, 6, 9, 12 and 15 are worth 1; the rest ½. 10 points a round. */
const isHardSlot = (i: number) => i % 3 === 2;
const slotNo = (i: number) => String(i + 1).padStart(2, "0");

function fillSlots<T>(easy: T[], hard: T[]): T[] {
  const e = [...easy];
  const h = [...hard];
  const out = Array.from({ length: RAPID_ITEMS }, (_, i) => (isHardSlot(i) ? h.shift() : e.shift()));
  if (out.some((x) => x === undefined) || e.length || h.length) throw new Error(`${SLUG}: rapid slots don't fill`);
  return out as T[];
}

function rapidItems(prefix: string, item: (n: string, i: number) => object) {
  return Array.from({ length: RAPID_ITEMS }, (_, i) => ({ id: `${prefix}-${slotNo(i)}`, ...item(slotNo(i), i), points: isHardSlot(i) ? 1 : 0.5 }));
}

const letterOptions = (name: string) => LETTERS.map((l) => ({ id: l, label: `{{${name}_${l}}}` }));

/** Puts `right` among the first three different `tempting` labels, in a random place. */
function placeOptions(rng: Rng, right: string, tempting: string[]): { labels: string[]; letter: string } {
  const wrong = [...new Set(tempting)].filter((t) => t !== right).slice(0, 3);
  if (wrong.length !== 3) throw new Error(`${SLUG}: not enough different options for ${right}`);
  const labels = rng.shuffle([right, ...wrong]);
  return { labels, letter: LETTERS[labels.indexOf(right)] };
}

function setOptions(v: Values, name: string, labels: string[]) {
  LETTERS.forEach((l, j) => (v[`${name}_${l}`] = labels[j]));
}

// ---- Rapid round A: prorations ----

type ProKind = "tax_arrears" | "tax_advance" | "rent" | "hoa" | "prepaid" | "fiscal" | "payoff" | "rent_unpaid" | "rent_deposit";
const PRO_EASY: ProKind[] = ["tax_arrears", "tax_arrears", "tax_advance", "tax_advance", "rent", "rent", "hoa", "hoa", "prepaid", "prepaid"];
const PRO_HARD: ProKind[] = ["payoff", "payoff", "fiscal", "rent_unpaid", "rent_deposit"];

const rapidProrationStep = {
  id: "rapid-prorations",
  type: RAPID_ROUND,
  title: "Rapid round: prorations",
  config: {
    intro: [
      "Prorations: 15 closing items, 20 seconds each. Pick who gets the credit and how much, or the amount asked for.",
      "Each item states the contract's proration convention: who owns the day of closing, a 365-day year for taxes and interest, and the actual days in the month for rent and HOA dues. Round once, to the cent, at the end.",
    ].join("\n"),
    secondsPerItem: 20,
    items: rapidItems("pr", (n) => ({
      prompt: `{{pr_${n}_q}}`,
      exhibit: {
        title: "Closing item",
        rows: [
          { label: "Closing date", value: `{{pr_${n}_date}}` },
          { label: "Convention", value: "{{convention}}" },
          { label: "Facts", value: `{{pr_${n}_facts}}` },
        ],
      },
      fields: [{ id: "answer", label: "Answer", kind: "choice", options: letterOptions(`pr_${n}`) }],
    })),
  },
};

const buyerGets = (c: number) => `Credit the buyer ${usd(c)}`;
const sellerGets = (c: number) => `Credit the seller ${usd(c)}`;

function buildProrations(rng: Rng, v: Values, owner: Owner): Record<string, ChoiceKey> {
  const flip: Owner = owner === "buyer" ? "seller" : "buyer";
  const kinds = fillSlots(rng.shuffle(PRO_EASY), rng.shuffle(PRO_HARD));
  return Object.fromEntries(
    kinds.map((kind, i) => {
      const n = slotNo(i);
      const closing = kind === "fiscal" ? closingDay(rng, `${YEAR}-01-04`, `${YEAR}-06-25`) : closingDay(rng, `${YEAR}-01-04`, `${YEAR}-12-20`);
      const { d: dom, m } = ymd(closing);
      const dim = daysInMonth(closing);
      const month = MONTHS[m];
      const doy = dayOfYear(closing);
      const sYear = (o: Owner) => sellerDays(doy, o);
      const bMonth = (o: Owner) => dim - sellerDays(dom, o);
      let q = "Who gets the credit, and how much?";
      let facts: string;
      let right: string;
      let tempting: string[];
      switch (kind) {
        case "tax_arrears":
        case "tax_advance": {
          const tax = rng.int(240_000, 980_000);
          const sellerPart = (o: Owner) => share(tax, sYear(o), 365);
          const buyerPart = (o: Owner) => share(tax, 365 - sYear(o), 365);
          if (kind === "tax_arrears") {
            facts = `${YEAR} property tax ${usd(tax)} for the calendar year, not yet paid: the buyer pays the whole bill when it comes due`;
            right = buyerGets(sellerPart(owner));
            tempting = [buyerGets(sellerPart(flip)), sellerGets(sellerPart(owner)), buyerGets(buyerPart(owner)), buyerGets(share(tax, sYear(owner), 360))];
          } else {
            facts = `${YEAR} property tax ${usd(tax)} for the calendar year, already paid in full by the seller`;
            right = sellerGets(buyerPart(owner));
            tempting = [sellerGets(buyerPart(flip)), buyerGets(buyerPart(owner)), sellerGets(sellerPart(owner)), sellerGets(share(tax, 365 - sYear(owner), 360))];
          }
          break;
        }
        case "fiscal": {
          const tax = rng.int(240_000, 980_000);
          const buyerDays = (o: Owner) => daysBetween(closing, `${YEAR}-06-30`) + (o === "buyer" ? 1 : 0);
          facts = `Property tax ${usd(tax)} for the fiscal year July 1, ${YEAR - 1} to June 30, ${YEAR}, already paid in full by the seller`;
          right = sellerGets(share(tax, buyerDays(owner), 365));
          tempting = [
            sellerGets(share(tax, buyerDays(flip), 365)),
            buyerGets(share(tax, buyerDays(owner), 365)),
            sellerGets(share(tax, 365 - sYear(owner), 365)), // treated it as a calendar year
            sellerGets(share(tax, 365 - buyerDays(owner), 365)),
          ];
          break;
        }
        case "rent":
        case "rent_deposit":
        case "rent_unpaid": {
          const rent = rng.int(95, 260) * 1_000;
          const part = (o: Owner) => share(rent, bMonth(o), dim);
          if (kind === "rent") {
            facts = `Unit B rent ${usd(rent)} for ${month}, collected by the seller`;
            right = buyerGets(part(owner));
            tempting = [buyerGets(part(flip)), sellerGets(part(owner)), buyerGets(rent - part(owner)), buyerGets(share(rent, bMonth(owner), 30)), buyerGets(rent)];
          } else if (kind === "rent_deposit") {
            const deposit = rng.int(9, 30) * 10_000;
            q = "Who gets the credit for the rent and the deposit together, and how much?";
            facts = `Unit B rent ${usd(rent)} for ${month}, collected by the seller; the seller also holds the tenant's ${usd(deposit)} security deposit`;
            right = buyerGets(part(owner) + deposit);
            tempting = [buyerGets(part(owner)), buyerGets(part(flip) + deposit), buyerGets(deposit), sellerGets(part(owner) + deposit)];
          } else {
            q = "What goes on the statement for the rent?";
            facts = `Unit B rent ${usd(rent)} for ${month}: the tenant hasn't paid it yet, so the seller collected nothing`;
            right = "No rent credit: the seller collected nothing";
            tempting = [buyerGets(part(owner)), sellerGets(rent - part(owner)), buyerGets(rent)];
          }
          break;
        }
        case "hoa": {
          const hoa = rng.int(120, 650) * 100;
          const part = (o: Owner) => share(hoa, bMonth(o), dim);
          facts = `HOA dues ${usd(hoa)} for ${month}, already paid by the seller`;
          right = sellerGets(part(owner));
          tempting = [sellerGets(part(flip)), buyerGets(part(owner)), sellerGets(hoa - part(owner)), sellerGets(share(hoa, bMonth(owner), 30)), sellerGets(hoa)];
          break;
        }
        case "prepaid": {
          const loan = rng.int(180, 620) * 100_000;
          const rate = rng.int(40, 60) * 125;
          const days = dim - dom + 1;
          q = "How much prepaid interest does the buyer pay at closing?";
          facts = `Buyer's new loan ${usd(loan)} at ${ratePct(rate)}%; prepaid interest runs from the closing date through the last day of the month, both included; per diem = loan × rate ÷ 365`;
          right = usd(interest(loan, rate, days));
          tempting = [interest(loan, rate, days - 1), interest(loan, rate, days + 1), interest(loan, rate, days, 360), interest(loan, rate, 30 - dom + 1), interest(loan, rate, days, 366)].map(usd);
          break;
        }
        case "payoff": {
          const principal = rng.int(9_000_000, 48_000_000);
          const rate = rng.int(22, 52) * 125;
          const paidThrough = monthEndBefore(closing, rng.pick([1, 1, 2]));
          const days = daysBetween(paidThrough, closing);
          q = "How much interest goes on top of the principal in the payoff?";
          facts = `Seller's loan: principal ${usd(principal)} at ${ratePct(rate)}%; interest paid through ${formatDate(paidThrough)}. Per diem = principal × rate ÷ 365, from the day after the paid-through date through the closing date`;
          right = usd(interest(principal, rate, days));
          tempting = [interest(principal, rate, days - 1), interest(principal, rate, days + 1), interest(principal, rate, days, 360), interest(principal, rate, dom - 1), interest(principal, rate, days, 366)].map(usd);
          break;
        }
      }
      const { labels, letter } = placeOptions(rng, right, tempting);
      Object.assign(v, { [`pr_${n}_q`]: q, [`pr_${n}_date`]: formatDate(closing), [`pr_${n}_facts`]: facts });
      setOptions(v, `pr_${n}`, labels);
      return [`pr-${n}`, { answer: { choice: letter } }];
    }),
  );
}

// ---- Rapid round B: title terms ----

interface TermNames {
  seller: string;
  lookalike: string;
}

interface TermQuestion {
  prompt: (p: TermNames) => string;
  right: string;
  wrong: [string, string, string];
}

const TERMS_EASY: TermQuestion[] = [
  {
    prompt: () => "What does Schedule A of a title commitment show?",
    right: "Who holds title now, the proposed insureds and the policy amounts",
    wrong: ["The liens the seller must pay off", "The survey drawing", "The agents' commissions"],
  },
  {
    prompt: () => "What does Schedule B-I (requirements) of a title commitment list?",
    right: "What must happen before the policy can be issued",
    wrong: ["Matters the policy won't insure against", "The legal description", "The premium for each policy"],
  },
  {
    prompt: () => "What does Schedule B-II (exceptions) of a title commitment list?",
    right: "Matters the policy won't insure against",
    wrong: ["Payoffs the seller must make", "Documents the buyer must sign", "The proposed insureds"],
  },
  {
    prompt: () => "An easement is…",
    right: "A right to use someone else's land for a limited purpose",
    wrong: ["A lien securing a debt", "A transfer of ownership", "A tax on recording a deed"],
  },
  {
    prompt: () => "A mechanic's lien is…",
    right: "A lien by an unpaid contractor or supplier who improved the property",
    wrong: ["A lien for unpaid property taxes", "A lien on the owner's car", "An easement for repair crews"],
  },
  {
    prompt: () => "What does a recorded release of mortgage do?",
    right: "Shows in the public record that the loan was paid and the lien is gone",
    wrong: ["Transfers the property to the lender", "Starts a foreclosure", "Lets the lender raise the rate"],
  },
  {
    prompt: () => "A lis pendens tells the world that…",
    right: "A lawsuit affecting title to the property is pending",
    wrong: ["The taxes are paid", "The property is for sale", "The deed has been recorded"],
  },
  {
    prompt: () => "Chain of title means…",
    right: "The series of recorded transfers of the property",
    wrong: ["The list of the seller's lenders", "The HOA's rules", "The survey's boundary lines"],
  },
  {
    prompt: () => "An owner's title policy is usually issued for…",
    right: "The purchase price",
    wrong: ["The loan amount", "The assessed tax value", "The earnest money"],
  },
  {
    prompt: () => "A lender's title policy is usually issued for…",
    right: "The loan amount",
    wrong: ["The purchase price", "The assessed tax value", "The seller's payoff"],
  },
  {
    prompt: () => "Who issues a payoff letter, and what does it state?",
    right: "The seller's lender: the amount to pay the loan off by a date",
    wrong: ["The county: the taxes owed", "The buyer's lender: the loan approval", "The HOA: the monthly dues"],
  },
  {
    prompt: () => "An HOA estoppel certificate states…",
    right: "The dues and assessments owed on the home as of a date",
    wrong: ["The home's tax value", "The seller's mortgage balance", "The lot's boundary lines"],
  },
  {
    prompt: () => "Vesting means…",
    right: "How title is held, and in whose names",
    wrong: ["When the loan funds", "The date of the survey", "The title insurer's name"],
  },
  {
    prompt: () => "Encumbrance means…",
    right: "Any claim or limit on title, such as a lien or an easement",
    wrong: ["The deed's notary block", "The buyer's down payment", "The legal description"],
  },
];

const TERMS_HARD: TermQuestion[] = [
  {
    prompt: (p) => `A judgment against ${p.lookalike} turns up; the seller is ${p.seller}, with a different middle initial and address. How is a judgment against a similar name usually cleared?`,
    right: "A name affidavit from the seller saying it isn't them",
    wrong: ["Pay it from the seller's proceeds", "Leave it on title as an exception", "Record a corrective deed"],
  },
  {
    prompt: () => "Liens recorded between the commitment's effective date and the recording of the deed fall in what, and how is it handled?",
    right: "The gap: cover it with an updated search before closing",
    wrong: ["The survey exception: order a new survey", "The chain of title: nothing to do", "The redemption period: wait it out"],
  },
  {
    prompt: () => "In a race-notice state, who wins when the same lot is sold to two buyers?",
    right: "The first good-faith buyer without notice who records first",
    wrong: ["Whoever signed first", "Whoever paid more", "Whoever moved in first"],
  },
  {
    prompt: () => "How does a general warranty deed differ from a special warranty deed?",
    right: "It warrants against title defects from any time, not just the grantor's ownership",
    wrong: ["It warrants only the grantor's own period of ownership", "It gives no warranty at all", "It warrants title to the lender only"],
  },
  {
    prompt: () => "What does a quitclaim deed convey?",
    right: "Whatever interest the grantor has, with no warranty of title",
    wrong: ["Full title with every warranty", "A release of the seller's mortgage", "An easement only"],
  },
  {
    prompt: () => "The seller's equity lender agrees its mortgage will rank behind the new loan. What is that document?",
    right: "A subordination agreement",
    wrong: ["A satisfaction of mortgage", "An estoppel certificate", "An assignment of rents"],
  },
  {
    prompt: () => "A mortgage was recorded first and a judgment lien later; the sale covers only one of them. Who is paid first?",
    right: "The mortgage holder: it was recorded first",
    wrong: ["The judgment creditor: the newer lien wins", "They share the proceeds equally", "Whoever asks for payment first"],
  },
];

const rapidTermsStep = {
  id: "rapid-title-terms",
  type: RAPID_ROUND,
  title: "Rapid round: title terms",
  config: {
    intro: "Title terms: 15 quick questions about title and closing practice, 20 seconds each.",
    secondsPerItem: 20,
    items: rapidItems("tt", (n) => ({ prompt: `{{tt_${n}}}`, fields: [{ id: "answer", label: "Answer", kind: "choice", options: letterOptions(`tt_${n}`) }] })),
  },
};

function buildTerms(rng: Rng, v: Values, names: TermNames): Record<string, ChoiceKey> {
  const qs = fillSlots(rng.shuffle(TERMS_EASY).slice(0, 10), rng.shuffle(TERMS_HARD).slice(0, 5));
  return Object.fromEntries(
    qs.map((q, i) => {
      const n = slotNo(i);
      const { labels, letter } = placeOptions(rng, q.right, q.wrong);
      v[`tt_${n}`] = q.prompt(names);
      setOptions(v, `tt_${n}`, labels);
      return [`tt-${n}`, { answer: { choice: letter } }];
    }),
  );
}

// ---- Rapid round C: deed and recording checks ----

type RecKind = "ok" | "ok_hard" | "grantor_name" | "grantor_missing" | "grantor_initial" | "legal_lot" | "legal_block" | "legal_page" | "notary_missing" | "notary_expired" | "fee_short";
const REC_EASY: RecKind[] = ["ok", "ok", "ok", "grantor_name", "grantor_name", "grantor_missing", "legal_lot", "legal_block", "notary_missing", "notary_missing"];
const REC_HARD: RecKind[] = ["grantor_initial", "legal_page", "notary_expired", "fee_short", "ok_hard"];
const REC_PART: Record<RecKind, string> = {
  ok: "ok",
  ok_hard: "ok",
  grantor_name: "grantor",
  grantor_missing: "grantor",
  grantor_initial: "grantor",
  legal_lot: "legal",
  legal_block: "legal",
  legal_page: "legal",
  notary_missing: "notary",
  notary_expired: "notary",
  fee_short: "fee",
};

const RECORDING_OPTIONS = [
  { id: "ok", label: "Ready to record" },
  { id: "grantor", label: "Grantor doesn't match the vested owner" },
  { id: "legal", label: "Legal description doesn't match the survey" },
  { id: "notary", label: "Acknowledgment missing or invalid" },
  { id: "fee", label: "Recording fee is short" },
];

const rapidRecordingStep = {
  id: "rapid-recording",
  type: RAPID_ROUND,
  title: "Rapid round: deed and recording checks",
  config: {
    intro:
      "Deed and recording checks: 15 deeds about to go to the county recorder, 20 seconds each. Each has at most one problem. Pick it, or \"Ready to record\". A notary's acknowledgment counts only if the commission hadn't expired on the day of signing.",
    secondsPerItem: 20,
    items: rapidItems("rc", (n) => ({
      prompt: "Can this deed be recorded as it is? If not, what's wrong?",
      exhibit: {
        title: "Deed check",
        rows: [
          { label: "Vested owner (title commitment)", value: `{{rc_${n}_vested}}` },
          { label: "Grantor on the deed", value: `{{rc_${n}_grantor}}` },
          { label: "Legal description on the survey", value: `{{rc_${n}_survey}}` },
          { label: "Legal description on the deed", value: `{{rc_${n}_legal}}` },
          { label: "Acknowledgment", value: `{{rc_${n}_ack}}` },
          { label: "Recording fee", value: `{{rc_${n}_fee}}` },
        ],
      },
      fields: [{ id: "answer", label: "What's wrong?", kind: "choice", options: RECORDING_OPTIONS }],
    })),
  },
};

interface Legal {
  lot: number;
  block: string;
  sub: string;
  book: number;
  page: number;
}
const legalText = (l: Legal) => `Lot ${l.lot}, Block ${l.block}, ${l.sub}, Plat Book ${l.book}, Page ${l.page}`;

function randomLegal(rng: Rng, sub = rng.pick(SUBDIVISIONS)): Legal {
  const a = rng.int(1, 9);
  let b = rng.int(1, 9);
  while (b === a) b = rng.int(1, 9);
  return { lot: rng.int(1, 48), block: rng.pick([..."ABCDEFGH"]), sub, book: rng.int(12, 96), page: a * 10 + b };
}

/** The same legal description with one part changed. */
function alterLegal(rng: Rng, l: Legal, how: "lot" | "block" | "page"): Legal {
  if (how === "lot") return { ...l, lot: l.lot > 5 && rng.int(0, 1) ? l.lot - rng.int(1, 5) : l.lot + rng.int(1, 5) };
  if (how === "block") return { ...l, block: rng.pick([..."ABCDEFGH"].filter((b) => b !== l.block)) };
  return { ...l, page: (l.page % 10) * 10 + Math.floor(l.page / 10) }; // digits transposed
}

const otherInitial = (rng: Rng, not: string) => rng.pick(INITIALS.filter((x) => x !== not));

/** The surname with one vowel (not the first letter) changed. */
function misspell(rng: Rng, last: string): string {
  const spots = [...last].map((c, i) => (i > 0 && "aeiou".includes(c) ? i : -1)).filter((i) => i > 0);
  const i = rng.pick(spots);
  return last.slice(0, i) + rng.pick([..."aeiou"].filter((x) => x !== last[i])) + last.slice(i + 1);
}

interface Couple {
  a: string;
  ia: string;
  b: string;
  ib: string;
  last: string;
}
const coupleNames = (c: Couple) => [`${c.a} ${c.ia}. ${c.last}`, `${c.b} ${c.ib}. ${c.last}`];
const coupleText = (c: Couple) => coupleNames(c).join(" and ");

function randomCouple(rng: Rng): Couple {
  const [p, q] = distinctPeople(rng, 2);
  return { a: p.first, ia: rng.pick(INITIALS), b: q.first, ib: rng.pick(INITIALS), last: rng.pick(LAST_NAMES) };
}

function buildRecording(rng: Rng, v: Values): Record<string, ChoiceKey> {
  const kinds = fillSlots(rng.shuffle(REC_EASY), rng.shuffle(REC_HARD));
  return Object.fromEntries(
    kinds.map((kind, i) => {
      const n = slotNo(i);
      const owners = randomCouple(rng);
      let grantor = coupleText(owners);
      if (kind === "grantor_name") grantor = coupleText({ ...owners, last: misspell(rng, owners.last) });
      if (kind === "grantor_missing") grantor = coupleNames(owners)[rng.int(0, 1)];
      if (kind === "grantor_initial") grantor = coupleText(rng.int(0, 1) ? { ...owners, ia: otherInitial(rng, owners.ia) } : { ...owners, ib: otherInitial(rng, owners.ib) });
      const survey = randomLegal(rng);
      const legal = kind === "legal_lot" ? alterLegal(rng, survey, "lot") : kind === "legal_block" ? alterLegal(rng, survey, "block") : kind === "legal_page" ? alterLegal(rng, survey, "page") : survey;
      const signed = addDays(`${YEAR}-01-04`, rng.int(0, 300));
      const expires = kind === "notary_expired" ? addDays(signed, -rng.int(5, 200)) : addDays(signed, rng.int(30, 1_400));
      const ack =
        kind === "notary_missing"
          ? "None: the signature page has no notary block"
          : `Signed and acknowledged before a notary on ${formatDate(signed)}; the notary's commission expires ${formatDate(expires)}`;
      const first = rng.int(18, 40) * 100;
      const extra = rng.int(2, 8) * 100;
      const pages = kind === "ok_hard" || kind === "fee_short" ? rng.int(3, 7) : rng.int(1, 6);
      const owed = first + extra * (pages - 1);
      const paid = kind === "fee_short" ? owed - extra * rng.int(1, pages - 1) : owed;
      Object.assign(v, {
        [`rc_${n}_vested`]: coupleText(owners),
        [`rc_${n}_grantor`]: grantor,
        [`rc_${n}_survey`]: legalText(survey),
        [`rc_${n}_legal`]: legalText(legal),
        [`rc_${n}_ack`]: ack,
        [`rc_${n}_fee`]: `County fee: ${usd(first)} for the first page + ${usd(extra)} for each additional page · deed is ${pages} pages · check enclosed ${usd(paid)}`,
      });
      return [`rc-${n}`, { answer: { choice: REC_PART[kind] } }];
    }),
  );
}

// ---- Section A: settlement statement ----

const money = (name: string) => ({ text: `{{${name}|money}}`, align: "right" as const });
const bold = (text: string) => ({ text, bold: true });
const dataRow = (label: string, value: unknown, note: string | null = null) => [label, value, note, null, null];
const input = (id: string, label: string, points: number) => ({ input: id, label, points });

/** Line id, label on the statement, points for each keyed cell. */
const LINES: [string, string, number][] = [
  ["emd", "Deposit (earnest money)", 1],
  ["loan", "Loan proceeds: {{lender}}", 1],
  ["conc", "Seller's credit for the buyer's closing costs", 0.5],
  ["tax", "{{year}} property taxes, prorated", 1],
  ["hoa", "HOA dues, prorated", 0.5],
  ["rent", "Rent for {{month}}, prorated", 0.5],
  ["dep", "Security deposit transferred", 0.5],
  ["payoff", "Payoff of the seller's mortgage (principal and interest)", 1],
  ["comm", "Real estate commission", 1],
  ["xfer", "State transfer tax", 1],
  ["bcost", "Buyer's lender and title charges", 1],
];
const SIDES: [string, string][] = [
  ["bd", "buyer debit"],
  ["bc", "buyer credit"],
  ["sd", "seller debit"],
  ["sc", "seller credit"],
];

const settlementStep = {
  id: "settlement",
  type: SPREADSHEET,
  title: "Settlement statement: 418 Alder Lane",
  config: {
    prompt: [
      "Work the settlement statement from the closing data sheet at the top. For each line, enter the amount in the column(s) where it belongs and leave the others blank.",
      "Enter amounts as positive numbers, to the cent. Then total the four columns (before cash), and enter the cash due from the buyer (in the buyer credit column) and the cash due to the seller (in the seller debit column), so each side balances.",
    ].join("\n"),
    columns: ["A", "B", "C", "D", "E"],
    rows: [
      [bold("Closing data sheet · 418 Alder Lane"), null, null, null, null],
      dataRow("Closing date", "{{closing_date}}"),
      dataRow("Proration convention", "{{convention}}"),
      dataRow("Purchase price", money("price")),
      dataRow("Earnest money (held in our trust account)", money("emd")),
      dataRow("New loan from {{lender}}", money("loan")),
      dataRow("Seller credit toward the buyer's closing costs", money("concession")),
      dataRow("{{year}} property tax (calendar year)", money("tax"), "{{tax_status}}"),
      dataRow("HOA dues (monthly)", money("hoa"), "Paid by the seller for {{month}}"),
      dataRow("Unit B rent (monthly)", money("rent"), "Collected by the seller for {{month}}"),
      dataRow("Tenant's security deposit (held by the seller)", money("deposit")),
      dataRow(
        "Seller's mortgage: principal balance",
        money("principal"),
        "Rate {{rate}}%; interest paid through {{paid_through}}; per diem = principal × rate ÷ 365 from the day after that through the closing date",
      ),
      dataRow("Commission", "{{comm_rate}}% of the price, paid by the seller"),
      dataRow("Transfer tax", "${{xfer_rate}} per $1,000 of the price, paid by the seller"),
      dataRow("Buyer's charge: loan origination", money("ch_orig")),
      dataRow("Buyer's charge: appraisal", money("ch_appr")),
      dataRow("Buyer's charge: lender's title policy", money("ch_title")),
      dataRow("Buyer's charge: recording the deed and mortgage", money("ch_rec")),
      [null, null, null, null, null],
      [bold("Settlement statement"), bold("Buyer debit"), bold("Buyer credit"), bold("Seller debit"), bold("Seller credit")],
      ["Contract sales price", money("price"), null, null, money("price")],
      ...LINES.map(([id, label, points]) => [label, ...SIDES.map(([side, name]) => input(`${id}_${side}`, `${label.replace(/\{\{\w+\}\}/g, "").trim()}: ${name}`, points))]),
      [bold("Totals before cash"), ...SIDES.map(([side, name]) => input(`tot_${side}`, `Total ${name}s`, 1))],
      [bold("Cash due from the buyer / to the seller"), null, input("cash_buyer", "Cash due from the buyer", 2), input("cash_seller", "Cash due to the seller", 2), null],
    ],
  },
};

// ---- Section B: title commitment ----

const PAYOFF = "Pay off from the seller's proceeds and record the release";
const PERMITTED = "Leave on title as a permitted exception";
type TitleKind = "first" | "heloc" | "released" | "mech" | "similar" | "satisfied" | "delinquent" | "current_tax" | "utility" | "driveway" | "plat" | "declaration";
const TITLE_KINDS: TitleKind[] = ["first", "heloc", "released", "mech", "similar", "satisfied", "delinquent", "current_tax", "utility", "driveway", "plat", "declaration"];
const TITLE_COLS = ["no", "type", "recorded", "parties", "status", "handling"];
const titleRowId = (i: number) => `t${String(i + 1).padStart(2, "0")}`;

const titleStep = {
  id: "title-review",
  type: DOCUMENT_REVIEW,
  title: "Title commitment review",
  config: {
    prompt: [
      "Check each item on the title commitment and the handling proposed for closing against the vesting, the sellers' affidavit and the contract's permitted exceptions.",
      "Flag each item whose proposed handling is wrong, with the reason. Then decide what goes to {{attorney_first}}.",
    ].join("\n"),
    document: {
      title: "Title commitment {{commitment_no}} · {{title_co}} · with proposed closing handling",
      fields: [
        { id: "property", label: "Property", value: "418 Alder Lane, {{city}} · {{legal}}" },
        { id: "vested", label: "Vested owner (Schedule A)", value: "{{vested}}" },
        { id: "address", label: "Sellers' address (sellers' affidavit)", value: "418 Alder Lane, {{city}}" },
        { id: "buyer", label: "Proposed insured (owner's policy)", value: "{{buyer}}" },
        {
          id: "permitted",
          label: "Permitted exceptions (contract ¶ 7)",
          value: "Utility easements of record; the recorded plat of {{subdivision}}; the {{subdivision}} HOA declaration; {{year}} taxes not yet due and payable",
        },
        { id: "effective", label: "Commitment effective date", value: "{{effective}}" },
      ],
      columns: ["No.", "Type", "Recorded", "Parties", "Status per title search", "Proposed handling"],
      rows: TITLE_KINDS.map((_, i) => ({ id: titleRowId(i), cells: TITLE_COLS.map((c) => `{{tc_${i + 1}_${c}}}`) })),
      totals: [],
    },
    reasons: [
      { id: "payoff", label: "Open lien: pay it off at closing and record the release" },
      { id: "name_affidavit", label: "Not our seller: clear it with a name affidavit instead of paying" },
      { id: "not_permitted", label: "Not a permitted exception: needs the buyer's approval or removal" },
      { id: "vesting", label: "Vesting doesn't match the sellers" },
      { id: "other", label: "Other" },
    ],
    findings: [
      { id: "heloc", label: "Home equity line left on title", points: 4 },
      { id: "mech_lien", label: "Mechanic's lien left on title", points: 3 },
      { id: "delinquent_tax", label: "Delinquent taxes treated as not yet due", points: 3 },
      { id: "similar_name", label: "Judgment against a similar name set to be paid", points: 4 },
      { id: "easement", label: "Driveway easement isn't a permitted exception", points: 4 },
    ],
    falseFlagPenalty: 1,
    decision: {
      prompt: "Closing is set for {{closing_date}}. What do you do with the commitment?",
      options: [
        { id: "close", label: "Close as scheduled on the commitment as written" },
        { id: "pay_all", label: "Pay every lien and judgment on the commitment from the seller's proceeds, to be safe" },
        {
          id: "memo",
          label: "Send {{attorney_first}} a title memo: what to pay off and release, what to clear by affidavit, and what needs the buyer's approval, before the closing is confirmed",
        },
        { id: "delete", label: "Ask the title company to delete every Schedule B-II exception" },
      ],
      points: 2,
    },
  },
};

// ---- Section C: deed review, then the inbox ----

type DeedItem = "grantor" | "grantee" | "address" | "legal" | "parcel" | "consideration" | "type" | "notary" | "prepared";
const DEED_ITEMS: DeedItem[] = ["grantor", "grantee", "address", "legal", "parcel", "consideration", "type", "notary", "prepared"];
const deedRowId = (i: number) => `d${String(i + 1).padStart(2, "0")}`;

const deedStep = {
  id: "deed-review",
  type: DOCUMENT_REVIEW,
  seconds: 300,
  title: "Deed review before signing",
  config: {
    prompt: [
      "{{assistant}} drafted the deed from the sellers to the buyer. Each line of the draft is shown next to the document it must match.",
      "Flag each line that's wrong, with the reason.",
    ].join("\n"),
    document: {
      title: "Draft general warranty deed · 418 Alder Lane · checked against the file",
      fields: [{ id: "matter", label: "Closing", value: "{{vested}} to {{buyer}} · closing {{closing_date}}" }],
      columns: ["Deed item", "Draft deed", "Checked against", "Source says"],
      rows: DEED_ITEMS.map((_, i) => ({ id: deedRowId(i), cells: ["item", "draft", "source", "says"].map((c) => `{{dd_${i + 1}_${c}}}`) })),
      totals: [],
    },
    reasons: [
      { id: "grantor", label: "Grantor doesn't match the vested owner" },
      { id: "grantee", label: "Grantee doesn't match the contract" },
      { id: "legal", label: "Legal description doesn't match the survey" },
      { id: "consideration", label: "Consideration doesn't match the contract" },
      { id: "notary", label: "No acknowledgment: the county won't record it" },
      { id: "other", label: "Other" },
    ],
    findings: [
      { id: "grantor", label: "Grantor doesn't match the vesting", points: 5 },
      { id: "legal", label: "Legal description doesn't match the survey", points: 5 },
      { id: "notary", label: "Missing notary block", points: 5 },
    ],
    falseFlagPenalty: 1,
  },
};

const LENDER_OPTIONS = [
  { id: "update", label: "Update the settlement statement with the new figures and send the buyer the new cash-to-close amount" },
  { id: "instructions", label: "Get the lender's revised closing instructions in writing" },
  { id: "wait", label: "Tell {{attorney_first}} the change needs a corrected Closing Disclosure and a new 3-business-day wait, so the closing may have to move" },
  { id: "nowait", label: "Tell {{attorney_first}} a corrected Closing Disclosure is needed at or before closing, but no new 3-business-day wait" },
  { id: "old", label: "Close on the old figures: the buyer already signed the first Closing Disclosure" },
  { id: "seller", label: "Ask the seller to cover the difference so the buyer's cash to close stays the same" },
  { id: "edit", label: "Edit the lender's loan documents yourself so they match the old terms" },
];

const lenderStep = {
  id: "inbox-lender",
  type: MULTIPLE_CHOICE,
  seconds: 150,
  title: "Email from the buyer's lender",
  config: {
    prompt: [
      "The lender changed {{buyer_first}}'s loan three days before closing. Pick every step you take.",
      "",
      "Closing Disclosure timing (12 CFR 1026.19(f)(2), summary): a corrected Closing Disclosure is needed whenever the terms change. It also starts a new 3-business-day wait before closing only if the APR rises by more than 1/8 of a percentage point, the loan product changes, or a prepayment penalty is added.",
    ].join("\n"),
    options: LENDER_OPTIONS,
    select: "multi",
    points: 8,
  },
};

const buyerStep = {
  id: "inbox-buyer",
  type: MULTIPLE_CHOICE,
  seconds: 150,
  title: "Email from the buyer",
  config: { prompt: "{{buyer_first}} wants to move the closing. What do you do?", options: letterOptions("bu"), select: "single", points: 7 },
};

// ---- Generator ----

export const realestateAlderClosing = defineScenario({
  slug: SLUG,
  version: 1,
  title: "Closing on 418 Alder Lane: real estate paralegal",
  roleFamily: "legal",
  timeLimitMinutes: 50,
  definition: {
    intro:
      "You're a real estate paralegal at {{firm}}, working for {{attorney}}, the settlement attorney for the sale of 418 Alder Lane, {{city}}: a duplex where the sellers live in unit A and rent out unit B. The work comes in six timed parts, 50 minutes in all: three rapid rounds of quick items (prorations, title terms, deed and recording checks), the settlement statement, the title commitment, and a deed review with your inbox. A finished part can't be reopened. The people, firms, lenders and property are fictional; the State of Wexford's recording rules are invented for the exercise.",
    steps: [rapidProrationStep, settlementStep, rapidTermsStep, titleStep, rapidRecordingStep, deedStep, lenderStep, buyerStep],
    messages: [
      {
        id: "m1",
        from: "Your supervising attorney",
        subject: "Alder Lane: settlement statement",
        body: [
          "Hi {{first_name}},",
          "",
          "We close the sale of 418 Alder Lane on {{closing_date}}. The closing data sheet is at the top of the statement: contract figures, the lender's numbers, the payoff information and the buyer's charges.",
          "",
          "Please work the statement: every credit and debit on the right side, prorated under the contract's convention, then the totals and the cash each side brings or takes home. The tenant in unit B stays, so the buyer takes over the lease and the deposit.",
          "",
          "{{attorney}}",
        ].join("\n"),
        arriveAtMinute: 0,
        stepId: "settlement",
      },
      {
        id: "m2",
        from: "Your supervising attorney",
        subject: "Alder Lane: title commitment is in",
        body: [
          "Hi {{first_name}},",
          "",
          "{{title_co}} sent the commitment. {{assistant}} filled in how each item would be handled at closing. Check every item against the vesting, the sellers' affidavit and the permitted exceptions in the contract before I confirm the closing. The buyer only takes title subject to what the contract permits.",
          "",
          "{{attorney}}",
        ].join("\n"),
        arriveAtMinute: 0,
        stepId: "title-review",
      },
      {
        id: "m3",
        from: "Your supervising attorney",
        subject: "Alder Lane: deed",
        body: [
          "Hi {{first_name}},",
          "",
          "{{assistant}} drafted the deed. Check it against the commitment, the survey and the contract before the sellers sign. A deed the county won't record, or that doesn't match the vesting, will hold up the buyer's title policy.",
          "",
          "{{attorney}}",
        ].join("\n"),
        arriveAtMinute: 0,
        stepId: "deed-review",
      },
      {
        id: "m4",
        from: "Buyer's lender, closing department",
        subject: "Revised terms: {{buyer}} loan",
        body: ["Hello,", "", "{{lender_change}}", "", "Please update your figures for the {{closing_date}} closing.", "", "{{lender_rep}}, Closing Coordinator, {{lender}}"].join("\n"),
        arriveAtMinute: 0,
        stepId: "inbox-lender",
      },
      {
        id: "m5",
        from: "The buyer",
        subject: "Can we move the closing?",
        body: [
          "Hi {{first_name}},",
          "",
          "My movers fell through. Can we push the closing from {{closing_date}} to {{new_date}}? Just change it on your end; no need to bother the sellers about it.",
          "",
          "Thanks,",
          "{{buyer}}",
        ].join("\n"),
        arriveAtMinute: 0,
        stepId: "inbox-buyer",
      },
    ],
    sections: [
      { id: "s-rapid-a", title: "Rapid round: prorations", minutes: 6, stepIds: ["rapid-prorations"] },
      { id: "s-settlement", title: "Settlement statement", minutes: 11, stepIds: ["settlement"] },
      { id: "s-rapid-b", title: "Rapid round: title terms", minutes: 6, stepIds: ["rapid-title-terms"] },
      { id: "s-title", title: "Title commitment", minutes: 11, stepIds: ["title-review"] },
      { id: "s-rapid-c", title: "Rapid round: deed and recording checks", minutes: 6, stepIds: ["rapid-recording"] },
      { id: "s-deed", title: "Deed review and inbox", minutes: 10, stepIds: ["deed-review", "inbox-lender", "inbox-buyer"], oneAtATime: true },
    ],
  },

  build(rng) {
    const v: Values = {};
    const [firm] = pickDistinct(rng, LAW_FIRMS, 1);
    const [pAttorney, pAssistant, pSellerA, pSellerB, pBuyer, pSurveyor, pPredecessor, pLenderRep] = distinctPeople(rng, 8);
    const [lender, lenderA, lenderB, lenderC] = pickDistinct(rng, LENDERS, 4);
    const [city, otherCity] = pickDistinct(rng, CITIES, 2);
    const county = rng.pick(COUNTIES);
    const owner: Owner = rng.pick(["buyer", "seller"] as const);
    const sellers: Couple = { a: pSellerA.first, ia: rng.pick(INITIALS), b: pSellerB.first, ib: rng.pick(INITIALS), last: pSellerA.last };
    const [sellerA, sellerB] = coupleNames(sellers);
    const vested = coupleText(sellers);
    const buyer = `${pBuyer.first} ${rng.pick(INITIALS)}. ${pBuyer.last}`;
    const legal = randomLegal(rng, rng.pick(SUBDIVISIONS));
    const closing = closingDay(rng, `${YEAR}-02-01`, `${YEAR}-11-30`);
    const month = MONTHS[ymd(closing).m];
    Object.assign(v, {
      firm: firm.name,
      attorney: pAttorney.full,
      attorney_first: pAttorney.first,
      assistant: pAssistant.full,
      buyer,
      buyer_first: pBuyer.first,
      vested,
      city,
      lender,
      lender_rep: pLenderRep.full,
      subdivision: legal.sub,
      legal: legalText(legal),
      year: String(YEAR),
      month,
      closing_date: formatDate(closing),
      convention: conventionText(owner),
      title_co: rng.pick(["Wexford Land Title Co.", "Keystone Abstract & Title", "Harbor Title Guaranty"]),
      commitment_no: `WX-${rng.pick(["A", "C", "K", "R"])}${rng.int(100, 999)}`,
    });

    // ---- Section A: settlement statement ----
    let s: Record<string, number>;
    for (let tries = 0; ; tries++) {
      if (tries > 200) throw new Error(`${SLUG}: no settlement figures`);
      const price = rng.int(285, 690) * 100_000;
      s = {
        price,
        emd: rng.int(4, 16) * 50_000,
        loan: (price * rng.pick([80, 85, 90])) / 100,
        concession: rng.int(10, 40) * 10_000,
        tax: rng.int(320_000, 1_150_000),
        hoa: rng.int(14, 58) * 1_000,
        rent: rng.int(95, 240) * 1_000,
        deposit: rng.int(9, 30) * 10_000,
        principal: rng.int(Math.round(price * 0.2), Math.round(price * 0.55)),
        ch_orig: rng.int(80_000, 350_000),
        ch_appr: rng.int(45_000, 80_000),
        ch_title: rng.int(60_000, 180_000),
        ch_rec: rng.int(15_000, 40_000),
      };
      if (s.price - s.loan > s.emd + s.concession + s.deposit + s.rent + s.tax + 500_000) break;
    }
    const rateMilli = rng.int(22, 52) * 125;
    const commRate = rng.pick(["5", "5.5", "6"]);
    const xferRate = rng.pick(["1.00", "1.50", "2.00", "2.50", "3.00"]);
    const taxPaid = rng.int(0, 1) === 1;
    const paidThrough = monthEndBefore(closing);
    Object.assign(v, s, {
      rate: ratePct(rateMilli),
      paid_through: formatDate(paidThrough),
      comm_rate: commRate,
      xfer_rate: xferRate,
      tax_status: taxPaid
        ? `Paid in full by the seller on ${formatDate(closingDay(rng, `${YEAR}-01-05`, `${YEAR}-01-29`))}`
        : "Not yet paid: the buyer pays the whole bill when it comes due",
    });
    const dim = daysInMonth(closing);
    const sellerYear = sellerDays(dayOfYear(closing), owner);
    const buyerMonth = dim - sellerDays(ymd(closing).d, owner);
    const taxShare = taxPaid ? share(s.tax, 365 - sellerYear, 365) : share(s.tax, sellerYear, 365);
    const hoaShare = share(s.hoa, buyerMonth, dim);
    const rentShare = share(s.rent, buyerMonth, dim);
    const payInterest = interest(s.principal, rateMilli, daysBetween(paidThrough, closing));
    const cells: Record<string, number> = {
      emd_bc: s.emd,
      loan_bc: s.loan,
      conc_bc: s.concession,
      conc_sd: s.concession,
      ...(taxPaid ? { tax_bd: taxShare, tax_sc: taxShare } : { tax_bc: taxShare, tax_sd: taxShare }),
      hoa_bd: hoaShare,
      hoa_sc: hoaShare,
      rent_bc: rentShare,
      rent_sd: rentShare,
      dep_bc: s.deposit,
      dep_sd: s.deposit,
      payoff_sd: s.principal + payInterest,
      comm_sd: Math.round((s.price * Number(commRate)) / 100),
      xfer_sd: Math.round((s.price / 100_000) * Number(xferRate) * 100),
      bcost_bd: s.ch_orig + s.ch_appr + s.ch_title + s.ch_rec,
    };
    const sum = (suffix: string) => Object.entries(cells).filter(([k]) => k.endsWith(suffix)).reduce((a, [, x]) => a + x, 0);
    const totals = { tot_bd: s.price + sum("_bd"), tot_bc: sum("_bc"), tot_sd: sum("_sd"), tot_sc: s.price + sum("_sc") };
    Object.assign(cells, totals, { cash_buyer: totals.tot_bd - totals.tot_bc, cash_seller: totals.tot_sc - totals.tot_sd });
    if (cells.cash_buyer <= 0 || cells.cash_seller <= 0) throw new Error(`${SLUG}: cash to close must be positive`);

    // ---- Section B: title commitment ----
    const order = rng.shuffle(TITLE_KINDS);
    const [creditorA, creditorB] = pickDistinct(rng, CREDITORS, 2);
    const contractor = rng.pick(CONTRACTORS);
    const recorded = (from: number, to: number) => formatDate(addDays(`${from}-01-02`, rng.int(0, (to - from) * 365)));
    const lookalike = `${sellers.a} ${otherInitial(rng, sellers.ia)}. ${sellers.last}`;
    const lookalikeAddress = `${rng.int(12, 980)} ${rng.pick(STREETS)}, ${otherCity}`;
    const neighborLot = legal.lot + 1;
    const content: Record<TitleKind, [type: string, recorded: string, parties: string, status: string, handling: string]> = {
      first: ["Mortgage", recorded(2016, 2021), `${vested} to ${lenderA}`, "Open: no release of record", PAYOFF],
      heloc: ["Mortgage (home equity line of credit)", recorded(2021, 2025), `${vested} to ${lenderB}`, "Open: no release of record; the credit line is still open", PERMITTED],
      released: ["Mortgage", recorded(2005, 2012), `${vested} to ${lenderC}`, `Released of record on ${recorded(2013, 2016)}`, "No action: released of record"],
      mech: ["Claim of lien", recorded(2025, 2026), `${contractor} against ${vested}`, `Open: no release of record; claims ${usd(rng.int(180, 1_400) * 1_000)} for work on the house`, PERMITTED],
      similar: ["Judgment", recorded(2019, 2026), `${creditorA} v. ${lookalike}, of ${lookalikeAddress}`, "Unsatisfied", "Pay from the seller's proceeds"],
      satisfied: ["Judgment", recorded(2012, 2018), `${creditorB} v. ${sellerB}, of 418 Alder Lane, ${city}`, `Satisfied of record on ${recorded(2019, 2021)}`, "No action: satisfied of record"],
      delinquent: ["Property tax", "—", `${county} Treasurer`, `${YEAR - 1} taxes unpaid: delinquent since ${formatDate(`${YEAR}-01-01`)}`, PERMITTED],
      current_tax: ["Property tax", "—", `${county} Treasurer`, `${YEAR} taxes: a lien, not yet due and payable`, PERMITTED],
      utility: ["Easement", recorded(1994, 2004), `${pPredecessor.full} to ${rng.pick(UTILITIES)}`, "10-foot utility easement along the rear lot line", PERMITTED],
      driveway: ["Easement", recorded(2006, 2015), `${pPredecessor.full} to the owner of Lot ${neighborLot}`, `Shared driveway easement for the owner of Lot ${neighborLot} across the north side of Lot ${legal.lot}`, PERMITTED],
      plat: ["Plat", recorded(1990, 1999), `${legal.sub}`, "Recorded plat: setback lines and drainage easements", PERMITTED],
      declaration: ["Declaration", recorded(1990, 1999), `${legal.sub} Homeowners Association`, "Covenants, conditions and restrictions", PERMITTED],
    };
    order.forEach((kind, i) => {
      const [type, rec, parties, status, handling] = content[kind];
      Object.assign(v, {
        [`tc_${i + 1}_no`]: String(i + 1),
        [`tc_${i + 1}_type`]: type,
        [`tc_${i + 1}_recorded`]: rec,
        [`tc_${i + 1}_parties`]: parties,
        [`tc_${i + 1}_status`]: status,
        [`tc_${i + 1}_handling`]: handling,
      });
    });
    v.effective = formatDate(addDays(closing, -rng.int(18, 40)));
    const tId = (kind: TitleKind) => titleRowId(order.indexOf(kind));

    // ---- Section C: deed ----
    const grantorHow = rng.pick(["missing", "spelling", "initial"] as const);
    const draftGrantor =
      grantorHow === "missing"
        ? sellerA
        : grantorHow === "spelling"
          ? coupleText({ ...sellers, last: misspell(rng, sellers.last) })
          : coupleText({ ...sellers, ib: otherInitial(rng, sellers.ib) });
    const legalHow = rng.pick(["lot", "block", "page"] as const);
    const draftLegal = legalText(alterLegal(rng, legal, legalHow));
    const parcel = `${rng.int(10, 99)}-${rng.int(1_000_000, 9_999_999)}`;
    const surveyDate = formatDate(addDays(closing, -rng.int(10, 45)));
    const deedOrder = rng.shuffle(DEED_ITEMS);
    const deedRows: Record<DeedItem, [item: string, draft: string, source: string, says: string]> = {
      grantor: ["Grantor", draftGrantor, "Title commitment, Schedule A (vesting)", vested],
      grantee: ["Grantee", buyer, "Purchase contract", buyer],
      address: ["Property address", `418 Alder Lane, ${city}`, `Survey by ${pSurveyor.full}, ${surveyDate}`, `418 Alder Lane, ${city}`],
      legal: ["Legal description", draftLegal, `Survey by ${pSurveyor.full}, ${surveyDate}`, legalText(legal)],
      parcel: ["Tax parcel number", parcel, `${county} tax record`, parcel],
      consideration: ["Consideration", usd(s.price), "Purchase contract", usd(s.price)],
      type: ["Deed type", "General warranty deed", "Purchase contract ¶ 6", "General warranty deed"],
      notary: ["Acknowledgment (notary)", "None: the signature page ends with the grantors' signature lines", "Wexford recording act", "Each grantor's signature acknowledged before a notary"],
      prepared: ["Prepared by / return to", `${pAttorney.full}, ${firm.name}`, "County recording requirements", `${pAttorney.full}, ${firm.name}`],
    };
    deedOrder.forEach((item, i) => {
      const [label, draft, source, says] = deedRows[item];
      Object.assign(v, { [`dd_${i + 1}_item`]: label, [`dd_${i + 1}_draft`]: draft, [`dd_${i + 1}_source`]: source, [`dd_${i + 1}_says`]: says });
    });
    const dId = (item: DeedItem) => deedRowId(deedOrder.indexOf(item));

    // ---- Section C: inbox ----
    const change = rng.pick(["apr_big", "apr_small", "prepay", "amount"] as const);
    const oldApr = rng.int(5_800, 7_400);
    const newWait = change === "apr_big" || change === "prepay";
    v.lender_change = {
      apr_big: `The rate lock on ${pBuyer.first}'s loan expired and was extended at a higher rate: the APR goes from ${ratePct(oldApr)}% to ${ratePct(oldApr + rng.int(130, 480))}%. The loan amount doesn't change.`,
      apr_small: `We corrected a fee in ${pBuyer.first}'s loan: the APR goes from ${ratePct(oldApr)}% to ${ratePct(oldApr + rng.int(10, 120))}%. The loan amount doesn't change.`,
      prepay: `The investor buying ${pBuyer.first}'s loan adds a prepayment penalty: 2% of the balance if the loan is paid off in the first two years. Nothing else changes.`,
      amount: `The appraisal came in low, so the loan amount drops from ${usd(s.loan)} to ${usd(s.loan - rng.int(5, 30) * 100_000)}; the rate and APR don't change.`,
    }[change];
    let newDate = addDays(closing, rng.int(5, 15));
    while (isWeekend(newDate) || isLegalHoliday(newDate)) newDate = addDays(newDate, 1);
    v.new_date = formatDate(newDate);
    const bu = placeOptions(
      rng,
      `Tell ${pBuyer.first} that ${pAttorney.full} will handle it: a new date needs a written amendment signed by the buyer and the seller, and then the prorations, the payoff and the rate lock are updated for it`,
      [
        `Change the date in the closing file and let everyone know: the buyer asked for it`,
        `Tell ${pBuyer.first} the date can never change once the contract is signed`,
        `Agree to the new date and keep the figures as they are: a few days don't change anything`,
      ],
    );
    setOptions(v, "bu", bu.labels);

    // ---- Rapid rounds, drawn last so the rest of the material doesn't shift when they change ----
    const rapidKeys = {
      "rapid-prorations": { items: buildProrations(rng, v, owner) },
      "rapid-title-terms": { items: buildTerms(rng, v, { seller: sellerA, lookalike }) },
      "rapid-recording": { items: buildRecording(rng, v) },
    };

    const d = (c: number) => c / 100;
    return {
      values: v,
      keys: {
        ...rapidKeys,
        settlement: { tolerance: 0.01, cells: Object.fromEntries(Object.entries(cells).map(([k, c]) => [k, { value: d(c) }])) },
        "title-review": {
          findings: {
            heloc: {
              targets: [tId("heloc")],
              reasons: ["payoff"],
              note: `The home equity line to ${lenderB} is still open: order a payoff, have the line frozen and closed, and record its release.`,
            },
            mech_lien: { targets: [tId("mech")], reasons: ["payoff"], note: `${contractor}'s claim of lien is open: it must be paid (or bonded off) and released at closing.` },
            delinquent_tax: {
              targets: [tId("delinquent")],
              reasons: ["payoff"],
              note: `${YEAR - 1} taxes are delinquent, not "not yet due": pay them from the seller's proceeds at closing.`,
            },
            similar_name: {
              targets: [tId("similar")],
              reasons: ["name_affidavit"],
              note: `The judgment is against ${lookalike} of ${lookalikeAddress}, not ${sellerA} of 418 Alder Lane: clear it with a name affidavit, don't pay it.`,
            },
            easement: {
              targets: [tId("driveway")],
              reasons: ["not_permitted"],
              note: `The driveway easement for Lot ${neighborLot} isn't among the contract's permitted exceptions: the buyer must approve it or the title company must remove it.`,
            },
          },
          decision: ["memo"],
        },
        "deed-review": {
          findings: {
            grantor: { targets: [dId("grantor")], reasons: ["grantor"], note: `The draft's grantor (${draftGrantor}) must match the vesting exactly: ${vested}.` },
            legal: { targets: [dId("legal")], reasons: ["legal"], note: `The draft's legal description doesn't match the survey; it should read ${legalText(legal)}.` },
            notary: { targets: [dId("notary")], reasons: ["notary"], note: "The draft has no notary acknowledgment, so the county won't record it: add one for each grantor." },
          },
        },
        "inbox-lender": { correct: ["update", "instructions", newWait ? "wait" : "nowait"] },
        "inbox-buyer": { correct: [bu.letter] },
      },
    };
  },
});
