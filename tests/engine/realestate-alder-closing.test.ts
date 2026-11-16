import { describe, expect, it, vi } from "vitest";
import type { RapidChoiceField, RapidItem } from "@/lib/engine/step-types/rapid_round/public";
import type { PublicCell } from "@/lib/engine/step-types/spreadsheet/public";

vi.mock("server-only", () => ({}));

const { realestateAlderClosing } = await import("@/lib/engine/scenarios/realestate-alder-closing");
const { getScenario, listScenarios } = await import("@/lib/engine/scenarios");
const { renderAttemptForCandidate, renderFlowForCandidate } = await import("@/lib/engine/server/render");
const { scoreAttempt } = await import("@/lib/engine/server/score");
const { resolveFlow, visibleMessageIds, validateSections } = await import("@/lib/engine/server/flow");
const { rapidRoundServer } = await import("@/lib/engine/step-types/rapid_round/server");
const { fillTemplate, templateValues } = await import("@/lib/engine/server/template");

/**
 * Real estate paralegal: closing on 418 Alder Lane. Three rapid rounds
 * (prorations, title terms, deed and recording checks) and three work sections
 * (settlement statement, title commitment review, deed review and inbox), 50
 * minutes, 100 points. These tests solve every task from what the candidate
 * sees, with their own reading of the closing conventions, then compare with
 * the server key, so the material and the key can't drift apart.
 */

const scenario = realestateAlderClosing;
const SEEDS = Array.from({ length: 200 }, (_, i) => `attempt-${i.toString(16).padStart(4, "0")}`);
const END = scenario.timeLimitMinutes;
const MAX = 100;
const RAPID_STEPS = ["rapid-prorations", "rapid-title-terms", "rapid-recording"] as const;
type RapidStepId = (typeof RAPID_STEPS)[number];
const REVIEW_STEPS = ["title-review", "deed-review"] as const;
const MC_STEPS = ["inbox-lender", "inbox-buyer"] as const;

type Field = { id: string; label: string; value: string };
type Doc = {
  prompt: string;
  document: { title: string; fields: Field[]; columns: string[]; rows: { id: string; cells: string[] }[]; totals: Field[]; footnote?: string };
  reasons: { id: string; label: string }[];
  decision?: { prompt: string; options: { id: string; label: string }[] };
};
type Mc = { prompt: string; options: { id: string; label: string }[]; select: "single" | "multi" };
type Sheet = { prompt: string; columns: string[]; rows: PublicCell[][] };
type ReviewKey = { findings: Record<string, { targets: string[]; reasons: string[]; note?: string }>; decision?: string[] };
type McKey = { correct: string[] };
type SheetKey = { tolerance: number; cells: Record<string, { value: number }> };
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
  const sheet = () => step("settlement").config as Sheet;
  return { view, step, msg, doc, mc, sheet };
}

const field = (doc: Doc, id: string) => {
  const f = doc.document.fields.find((x) => x.id === id);
  expect(f, `field ${id}`).toBeDefined();
  return f!.value;
};
const col = (doc: Doc, name: RegExp) => {
  const i = doc.document.columns.findIndex((c) => name.test(c));
  expect(i, `column ${name}`).toBeGreaterThanOrEqual(0);
  return i;
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const LONG_MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
/** "Mon, Mar 2, 2026" → epoch day (UTC); also checks the weekday printed matches the date. */
function day(label: string): number {
  const m = label.trim().match(/^(\w{3}), (\w{3}) (\d{1,2}), (\d{4})$/);
  expect(m, `date "${label}"`).not.toBeNull();
  const t = Date.UTC(Number(m![4]), MONTHS.indexOf(m![2]), Number(m![3]));
  expect(WEEKDAYS[new Date(t).getUTCDay()], `weekday of ${label}`).toBe(m![1]);
  return t / 86_400_000;
}
const parts = (d: number) => {
  const t = new Date(d * 86_400_000);
  return { y: t.getUTCFullYear(), m: t.getUTCMonth(), d: t.getUTCDate() };
};
const dayOfYear = (d: number) => d - Date.UTC(parts(d).y, 0, 1) / 86_400_000 + 1;
const daysInMonth = (d: number) => new Date(Date.UTC(parts(d).y, parts(d).m + 1, 0)).getUTCDate();

/** "$1,234.56" → cents. */
function cents(text: string): number {
  const m = text.trim().match(/^\$([\d,]+)\.(\d{2})$/);
  expect(m, `money "${text}"`).not.toBeNull();
  return Number(m![1].replace(/,/g, "")) * 100 + Number(m![2]);
}
const usd = (c: number) => `$${(c / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Days of the period that belong to the seller, given who owns the closing day. */
const sellerShareDays = (dayNo: number, buyerOwnsClosingDay: boolean) => dayNo - (buyerOwnsClosingDay ? 1 : 0);
const conventionOwner = (text: string) => {
  const m = text.match(/the (buyer|seller) owns the day of closing/);
  expect(m, `convention "${text}"`).not.toBeNull();
  return m![1] as "buyer" | "seller";
};
/** Interest in cents: principal × rate ÷ 365 per day, rounded once at the end. */
const interest = (principal: number, ratePct: string, days: number, basis = 365) => Math.round((principal * Math.round(Number(ratePct) * 1000) * days) / (100_000 * basis));

// ---- Settlement statement ----

const cellText = (c: PublicCell) => (c.kind === "text" ? c.text : "");

function readStatement(sheet: Sheet) {
  const rows = sheet.rows;
  const byLabel = (re: RegExp) => {
    const r = rows.filter((x) => re.test(cellText(x[0])));
    expect(r.length, `one row like ${re}`).toBe(1);
    return r[0];
  };
  const val = (re: RegExp, i = 1) => cellText(byLabel(re)[i]);
  const closing = day(val(/^Closing date$/));
  const owner = conventionOwner(val(/^Proration convention$/));
  const buyerOwns = owner === "buyer";
  const price = cents(val(/^Purchase price$/));
  const emd = cents(val(/^Earnest money/));
  const loan = cents(val(/^New loan from /));
  const concession = cents(val(/^Seller credit toward the buyer's closing costs$/));
  const taxRow = byLabel(/^\d{4} property tax \(calendar year\)$/);
  const tax = cents(cellText(taxRow[1]));
  const taxStatus = cellText(taxRow[2]);
  const taxPaid = /^Paid in full by the seller/.test(taxStatus);
  expect(taxPaid || /^Not yet paid/.test(taxStatus), taxStatus).toBe(true);
  const hoaRow = byLabel(/^HOA dues \(monthly\)$/);
  const hoa = cents(cellText(hoaRow[1]));
  expect(cellText(hoaRow[2])).toBe(`Paid by the seller for ${LONG_MONTHS[parts(closing).m]}`);
  const rentRow = byLabel(/^Unit B rent \(monthly\)$/);
  const rent = cents(cellText(rentRow[1]));
  expect(cellText(rentRow[2])).toBe(`Collected by the seller for ${LONG_MONTHS[parts(closing).m]}`);
  const deposit = cents(val(/^Tenant's security deposit/));
  const mortRow = byLabel(/^Seller's mortgage: principal balance$/);
  const principal = cents(cellText(mortRow[1]));
  const mm = cellText(mortRow[2]).match(/^Rate ([\d.]+)%; interest paid through (.+); per diem = principal × rate ÷ 365 from the day after that through the closing date$/);
  expect(mm, cellText(mortRow[2])).not.toBeNull();
  const paidThrough = day(mm![2]);
  const commission = val(/^Commission$/).match(/^([\d.]+)% of the price, paid by the seller$/);
  expect(commission).not.toBeNull();
  const transfer = val(/^Transfer tax$/).match(/^\$([\d.]+) per \$1,000 of the price, paid by the seller$/);
  expect(transfer).not.toBeNull();
  const charges = rows.filter((x) => /^Buyer's charge: /.test(cellText(x[0]))).map((x) => cents(cellText(x[1])));
  expect(charges.length).toBe(4);

  const dim = daysInMonth(closing);
  const sellerYear = sellerShareDays(dayOfYear(closing), buyerOwns);
  const sellerMonth = sellerShareDays(parts(closing).d, buyerOwns);
  const buyerMonth = dim - sellerMonth;
  const taxShare = taxPaid ? Math.round((tax * (365 - sellerYear)) / 365) : Math.round((tax * sellerYear) / 365);
  const hoaShare = Math.round((hoa * buyerMonth) / dim);
  const rentShare = Math.round((rent * buyerMonth) / dim);
  const payoff = principal + interest(principal, mm![1], closing - paidThrough);
  const comm = Math.round((price * Number(commission![1])) / 100);
  const xfer = Math.round((price / 100_000) * Number(transfer![1]) * 100);
  const bcost = charges.reduce((a, b) => a + b, 0);

  const c: Record<string, number> = {
    emd_bc: emd,
    loan_bc: loan,
    conc_bc: concession,
    conc_sd: concession,
    ...(taxPaid ? { tax_bd: taxShare, tax_sc: taxShare } : { tax_bc: taxShare, tax_sd: taxShare }),
    hoa_bd: hoaShare,
    hoa_sc: hoaShare,
    rent_bc: rentShare,
    rent_sd: rentShare,
    dep_bc: deposit,
    dep_sd: deposit,
    payoff_sd: payoff,
    comm_sd: comm,
    xfer_sd: xfer,
    bcost_bd: bcost,
  };
  const sum = (suffix: string) => Object.entries(c).filter(([k]) => k.endsWith(suffix)).reduce((a, [, v]) => a + v, 0);
  c.tot_bd = price + sum("_bd");
  c.tot_bc = sum("_bc");
  c.tot_sd = sum("_sd");
  c.tot_sc = price + sum("_sc");
  c.cash_buyer = c.tot_bd - c.tot_bc;
  c.cash_seller = c.tot_sc - c.tot_sd;
  const inputs = rows.flat().filter((x): x is Extract<PublicCell, { kind: "input" }> => x.kind === "input").map((x) => x.id);
  return { cells: c, taxPaid, owner, inputs, closing };
}

// ---- Title commitment ----

const PAYOFF = "Pay off from the seller's proceeds and record the release";
const PERMITTED = "Leave on title as a permitted exception";

function readTitle(doc: Doc) {
  const vested = field(doc, "vested");
  const owners = vested.split(" and ");
  expect(owners.length).toBe(2);
  const address = field(doc, "address");
  const permitted = field(doc, "permitted");
  const [cType, cParties, cStatus, cHandling] = [col(doc, /^Type/), col(doc, /^Parties/), col(doc, /^Status/), col(doc, /^Proposed handling/)];
  const rows = doc.document.rows.map((r) => {
    const type = r.cells[cType];
    const status = r.cells[cStatus];
    const handling = r.cells[cHandling];
    let issue: string | null = null;
    let kind = type;
    if (/^(Mortgage|Claim of lien)/.test(type)) {
      if (/^Open/.test(status)) {
        kind = /home equity/.test(type) ? "heloc" : /Claim of lien/.test(type) ? "mech" : "first";
        if (handling !== PAYOFF) issue = "payoff";
      } else {
        expect(status).toMatch(/^Released of record/);
        expect(handling).toBe("No action: released of record");
        kind = "released";
      }
    } else if (type === "Property tax") {
      if (/delinquent/.test(status)) {
        kind = "delinquent";
        if (handling !== PAYOFF) issue = "payoff";
      } else {
        expect(status).toMatch(/not yet due and payable/);
        expect(permitted).toMatch(/taxes not yet due and payable/);
        expect(handling).toBe(PERMITTED);
        kind = "current_tax";
      }
    } else if (type === "Judgment") {
      const m = r.cells[cParties].match(/^(.+) v\. (.+), of (.+)$/);
      expect(m, r.cells[cParties]).not.toBeNull();
      const ours = owners.includes(m![2]) && m![3] === address;
      if (/^Satisfied/.test(status)) {
        expect(ours).toBe(true);
        expect(handling).toBe("No action: satisfied of record");
        kind = "satisfied";
      } else {
        expect(status).toBe("Unsatisfied");
        expect(ours, "the open judgment is against someone else").toBe(false);
        // Same surname and first name as a seller, different middle initial and address.
        const [first, , ...last] = m![2].split(" ");
        expect(owners.some((o) => o.startsWith(`${first} `) && o.endsWith(` ${last.join(" ")}`))).toBe(true);
        kind = "similar";
        if (/^Pay/.test(handling)) issue = "name_affidavit";
      }
    } else {
      expect(["Easement", "Plat", "Declaration"]).toContain(type);
      expect(handling).toBe(PERMITTED);
      const ok = type === "Plat" ? /recorded plat/.test(permitted) : type === "Declaration" ? /HOA declaration/.test(permitted) : /utility/i.test(status) && /Utility easements/.test(permitted);
      kind = type === "Easement" ? (ok ? "utility" : "driveway") : type;
      if (!ok) issue = "not_permitted";
    }
    return { id: r.id, type, kind, issue };
  });
  return { rows };
}

// ---- Deed review ----

const DEED_ISSUE: Record<string, string> = { Grantor: "grantor", "Legal description": "legal", "Acknowledgment (notary)": "notary" };

function readDeed(doc: Doc) {
  const [cItem, cDraft, cSource] = [col(doc, /^Deed item/), col(doc, /^Draft deed/), col(doc, /^Source says/)];
  const rows = doc.document.rows.map((r) => {
    const differs = r.cells[cDraft] !== r.cells[cSource];
    const issue = differs ? DEED_ISSUE[r.cells[cItem]] : null;
    if (differs) expect(issue, `${r.cells[cItem]} differs`).toBeDefined();
    return { id: r.id, item: r.cells[cItem], issue, draft: r.cells[cDraft], source: r.cells[cSource] };
  });
  return { rows };
}

// ---- Inbox ----

function oneOption(cfg: { options: { id: string; label: string }[] }, re: RegExp) {
  const o = cfg.options.filter((x) => re.test(x.label));
  expect(o.length, `one option like ${re}`).toBe(1);
  return o[0].id;
}

function solveLender(sc: ReturnType<typeof screen>) {
  const body = sc.msg("m4").body;
  const cfg = sc.mc("inbox-lender");
  const apr = body.match(/APR goes from ([\d.]+)% to ([\d.]+)%/);
  const prepay = /adds a prepayment penalty/.test(body);
  const amount = /loan amount drops from (\$[\d,.]+) to (\$[\d,.]+); the rate and APR don't change/.test(body);
  expect([!!apr, prepay, amount].filter(Boolean).length, body).toBe(1);
  const newWait = prepay || (!!apr && Math.round((Number(apr![2]) - Number(apr![1])) * 1000) > 125);
  const right = [oneOption(cfg, /^Update the settlement statement/), oneOption(cfg, /^Get the lender's revised closing instructions in writing/)];
  right.push(newWait ? oneOption(cfg, /new 3-business-day wait/) : oneOption(cfg, /no new 3-business-day wait/));
  return { right: right.sort(), newWait, kind: prepay ? "prepay" : amount ? "amount" : newWait ? "apr_big" : "apr_small" };
}
const solveBuyer = (sc: ReturnType<typeof screen>) => oneOption(sc.mc("inbox-buyer"), /written amendment signed by the buyer and the seller/);

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
  return f!;
};
const optionId = (item: RapidItem, fieldId: string, label: RegExp | string) => {
  const opts = choiceField(item, fieldId).options.filter((o) => (typeof label === "string" ? o.label === label : label.test(o.label)));
  expect(opts.length, `${item.id} ${fieldId}: one option like ${label} in ${JSON.stringify(choiceField(item, fieldId).options)}`).toBe(1);
  return opts[0].id;
};
const row = (item: RapidItem, label: string) => {
  const r = item.exhibit?.rows?.find((x) => x.label === label);
  expect(r, `${item.id} row ${label}`).toBeDefined();
  return r!.value;
};
const fourDifferent = (item: RapidItem) => {
  const labels = choiceField(item, "answer").options.map((o) => o.label);
  expect(labels.length).toBe(4);
  expect(new Set(labels).size, `${item.id} four different options`).toBe(4);
};

const MONEY = "(\\$[\\d,]+\\.\\d{2})";

/** Prorations: the convention in the exhibit, worked by hand. */
function solveProration(item: RapidItem): Solved {
  fourDifferent(item);
  const closing = day(row(item, "Closing date"));
  const buyerOwns = conventionOwner(row(item, "Convention")) === "buyer";
  const facts = row(item, "Facts");
  const month = LONG_MONTHS[parts(closing).m];
  const dim = daysInMonth(closing);
  const buyerMonth = dim - sellerShareDays(parts(closing).d, buyerOwns);
  const answer = (kind: string, label: string) => ({ kind, values: { answer: optionId(item, "answer", label) } });
  let m: RegExpMatchArray | null;
  if ((m = facts.match(new RegExp(`^(\\d{4}) property tax ${MONEY} for the calendar year, not yet paid: the buyer pays the whole bill when it comes due$`)))) {
    expect(Number(m[1])).toBe(parts(closing).y);
    return answer("tax_arrears", `Credit the buyer ${usd(Math.round((cents(m[2]) * sellerShareDays(dayOfYear(closing), buyerOwns)) / 365))}`);
  }
  if ((m = facts.match(new RegExp(`^(\\d{4}) property tax ${MONEY} for the calendar year, already paid in full by the seller$`)))) {
    const buyerDays = 365 - sellerShareDays(dayOfYear(closing), buyerOwns);
    return answer("tax_advance", `Credit the seller ${usd(Math.round((cents(m[2]) * buyerDays) / 365))}`);
  }
  if ((m = facts.match(new RegExp(`^Property tax ${MONEY} for the fiscal year July 1, (\\d{4}) to June 30, (\\d{4}), already paid in full by the seller$`)))) {
    const end = Date.UTC(Number(m[3]), 5, 30) / 86_400_000;
    expect(end - Date.UTC(Number(m[2]), 6, 1) / 86_400_000 + 1).toBe(365);
    const buyerDays = end - closing + (buyerOwns ? 1 : 0);
    return answer("fiscal", `Credit the seller ${usd(Math.round((cents(m[1]) * buyerDays) / 365))}`);
  }
  if ((m = facts.match(new RegExp(`^Unit B rent ${MONEY} for (\\w+): the tenant hasn't paid it yet, so the seller collected nothing$`)))) {
    expect(m[2]).toBe(month);
    return answer("rent_unpaid", "No rent credit: the seller collected nothing");
  }
  if ((m = facts.match(new RegExp(`^Unit B rent ${MONEY} for (\\w+), collected by the seller; the seller also holds the tenant's ${MONEY} security deposit$`)))) {
    expect(m[2]).toBe(month);
    return answer("rent_deposit", `Credit the buyer ${usd(Math.round((cents(m[1]) * buyerMonth) / dim) + cents(m[3]))}`);
  }
  if ((m = facts.match(new RegExp(`^Unit B rent ${MONEY} for (\\w+), collected by the seller$`)))) {
    expect(m[2]).toBe(month);
    return answer("rent", `Credit the buyer ${usd(Math.round((cents(m[1]) * buyerMonth) / dim))}`);
  }
  if ((m = facts.match(new RegExp(`^HOA dues ${MONEY} for (\\w+), already paid by the seller$`)))) {
    expect(m[2]).toBe(month);
    return answer("hoa", `Credit the seller ${usd(Math.round((cents(m[1]) * buyerMonth) / dim))}`);
  }
  if ((m = facts.match(new RegExp(`^Buyer's new loan ${MONEY} at ([\\d.]+)%; prepaid interest runs from the closing date through the last day of the month, both included; per diem = loan × rate ÷ 365$`)))) {
    return answer("prepaid", usd(interest(cents(m[1]), m[2], dim - parts(closing).d + 1)));
  }
  m = facts.match(new RegExp(`^Seller's loan: principal ${MONEY} at ([\\d.]+)%; interest paid through (.+)\\. Per diem = principal × rate ÷ 365, from the day after the paid-through date through the closing date$`));
  expect(m, `${item.id} facts: ${facts}`).not.toBeNull();
  return answer("payoff", usd(interest(cents(m![1]), m![2], closing - day(m![3]))));
}

/** Title terms: what a closing paralegal knows, by question. */
const TITLE_RULES: [string, RegExp, RegExp, "easy" | "hard"][] = [
  ["schedule-a", /Schedule A of a title commitment show/, /^Who holds title now, the proposed insureds and the policy amounts$/, "easy"],
  ["schedule-b1", /Schedule B-I \(requirements\)/, /^What must happen before the policy can be issued$/, "easy"],
  ["schedule-b2", /Schedule B-II \(exceptions\)/, /^Matters the policy won't insure against$/, "easy"],
  ["easement", /An easement is/, /^A right to use someone else's land for a limited purpose$/, "easy"],
  ["mechanics", /A mechanic's lien is/, /^A lien by an unpaid contractor or supplier who improved the property$/, "easy"],
  ["release", /recorded release of mortgage do/, /^Shows in the public record that the loan was paid and the lien is gone$/, "easy"],
  ["lis-pendens", /A lis pendens tells the world that/, /^A lawsuit affecting title to the property is pending$/, "easy"],
  ["chain", /Chain of title means/, /^The series of recorded transfers of the property$/, "easy"],
  ["owners-policy", /An owner's title policy is usually issued for/, /^The purchase price$/, "easy"],
  ["lenders-policy", /A lender's title policy is usually issued for/, /^The loan amount$/, "easy"],
  ["payoff-letter", /Who issues a payoff letter/, /^The seller's lender: the amount to pay the loan off by a date$/, "easy"],
  ["estoppel", /An HOA estoppel certificate states/, /^The dues and assessments owed on the home as of a date$/, "easy"],
  ["vesting", /Vesting means/, /^How title is held, and in whose names$/, "easy"],
  ["encumbrance", /Encumbrance means/, /^Any claim or limit on title, such as a lien or an easement$/, "easy"],
  ["similar-name", /How is a judgment against .* usually cleared/, /^A name affidavit from the seller saying it isn't them$/, "hard"],
  ["gap", /Liens recorded between the commitment's effective date and the recording of the deed/, /^The gap: cover it with an updated search before closing$/, "hard"],
  ["race-notice", /In a race-notice state/, /^The first good-faith buyer without notice who records first$/, "hard"],
  ["warranty", /general warranty deed differ from a special warranty deed/, /^It warrants against title defects from any time, not just the grantor's ownership$/, "hard"],
  ["quitclaim", /What does a quitclaim deed convey/, /^Whatever interest the grantor has, with no warranty of title$/, "hard"],
  ["subordination", /agrees its mortgage will rank behind the new loan/, /^A subordination agreement$/, "hard"],
  ["priority", /A mortgage was recorded first and a judgment lien later/, /^The mortgage holder: it was recorded first$/, "hard"],
];

function solveTitleTerm(item: RapidItem): Solved {
  fourDifferent(item);
  const rules = TITLE_RULES.filter(([, re]) => re.test(item.prompt));
  expect(rules.length, `${item.id}: one rule for "${item.prompt}"`).toBe(1);
  return { kind: rules[0][0], values: { answer: optionId(item, "answer", rules[0][2]) } };
}

const RECORDING_LABEL: Record<string, RegExp> = {
  ok: /^Ready to record$/,
  grantor: /^Grantor doesn't match the vested owner$/,
  legal: /^Legal description doesn't match the survey$/,
  notary: /^Acknowledgment missing or invalid$/,
  fee: /^Recording fee is short$/,
};

/** Deed and recording: each row of the exhibit checked by hand. */
function solveRecording(item: RapidItem): Solved {
  const options = choiceField(item, "answer").options;
  expect(options.length).toBe(5);
  const vested = row(item, "Vested owner (title commitment)");
  const grantor = row(item, "Grantor on the deed");
  const survey = row(item, "Legal description on the survey");
  const legal = row(item, "Legal description on the deed");
  for (const l of [survey, legal]) expect(l).toMatch(/^Lot \d+, Block [A-Z], .+, Plat Book \d+, Page \d+$/);
  const ack = row(item, "Acknowledgment");
  const fee = row(item, "Recording fee").match(/^County fee: (\$[\d.,]+) for the first page \+ (\$[\d.,]+) for each additional page · deed is (\d+) pages · check enclosed (\$[\d.,]+)$/);
  expect(fee, row(item, "Recording fee")).not.toBeNull();
  const owed = cents(fee![1]) + cents(fee![2]) * (Number(fee![3]) - 1);
  const wrong: string[] = [];
  const kinds: string[] = [];
  if (grantor !== vested) {
    wrong.push("grantor");
    const v = vested.split(" and ");
    const g = grantor.split(" and ");
    kinds.push(g.length < v.length ? "grantor_missing" : g.every((n, i) => n.replace(/ [A-Z]\. /, " ") === v[i].replace(/ [A-Z]\. /, " ")) ? "grantor_initial" : "grantor_name");
  }
  if (legal !== survey) {
    wrong.push("legal");
    const pg = (s: string) => s.match(/Page (\d+)$/)![1];
    kinds.push(pg(legal) !== pg(survey) ? "legal_page" : "legal_lot_block");
  }
  const a = ack.match(/^Signed and acknowledged before a notary on (.+); the notary's commission expires (.+)$/);
  if (!a) {
    expect(ack).toBe("None: the signature page has no notary block");
    wrong.push("notary");
    kinds.push("notary_missing");
  } else if (day(a[2]) < day(a[1])) {
    wrong.push("notary");
    kinds.push("notary_expired");
  }
  const paid = cents(fee![4]);
  if (paid < owed) {
    wrong.push("fee");
    kinds.push("fee_short");
  } else expect(paid, `${item.id} fee paid exactly`).toBe(owed);
  expect(wrong.length, `${item.id} at most one problem (${wrong})`).toBeLessThanOrEqual(1);
  const part = wrong[0] ?? "ok";
  const kind = kinds[0] ?? "ok";
  return { kind, values: { answer: optionId(item, "answer", RECORDING_LABEL[part]) } };
}

const SOLVERS: Record<RapidStepId, (item: RapidItem) => Solved> = {
  "rapid-prorations": solveProration,
  "rapid-title-terms": solveTitleTerm,
  "rapid-recording": solveRecording,
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
  const st = readStatement(sc.sheet());
  const title = readTitle(sc.doc("title-review"));
  const deed = readDeed(sc.doc("deed-review"));
  return {
    ...rapidAnswers(seed),
    settlement: { cells: Object.fromEntries(Object.entries(st.cells).map(([k, v]) => [k, v / 100])) as Record<string, number | null> },
    "title-review": {
      flags: title.rows.filter((r) => r.issue).map((r) => ({ target: r.id, reason: r.issue!, note: "" })) as Flag[],
      decision: oneOption(sc.doc("title-review").decision!, /^Send .+ a title memo/),
    },
    "deed-review": { flags: deed.rows.filter((r) => r.issue).map((r) => ({ target: r.id, reason: r.issue!, note: "" })) as Flag[], decision: null },
    "inbox-lender": { selected: solveLender(sc).right },
    "inbox-buyer": { selected: [solveBuyer(sc)] },
  };
}

type Answers = ReturnType<typeof perfectAnswers>;
const clone = (a: Answers): Answers => JSON.parse(JSON.stringify(a));

describe("realestate-alder-closing: setup", () => {
  it("is registered, version 1, legal, 50 minutes, and uses only built step types in section order", () => {
    expect(getScenario("realestate-alder-closing", 1)).toBe(scenario);
    expect(listScenarios()).toContain(scenario);
    expect(scenario.version).toBe(1);
    expect(scenario.timeLimitMinutes).toBe(50);
    expect(scenario.roleFamily).toBe("legal");
    expect(scenario.title).toMatch(/418 Alder Lane/);
    expect(scenario.definition.steps.map((s) => [s.id, s.type])).toEqual([
      ["rapid-prorations", "rapid_round"],
      ["settlement", "spreadsheet"],
      ["rapid-title-terms", "rapid_round"],
      ["title-review", "document_review"],
      ["rapid-recording", "rapid_round"],
      ["deed-review", "document_review"],
      ["inbox-lender", "multiple_choice"],
      ["inbox-buyer", "multiple_choice"],
    ]);
    expect(scenario.definition.intro).toMatch(/real estate paralegal/i);
    expect(scenario.definition.intro).toMatch(/418 Alder Lane/);
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
  }, 60_000);

  it("is deterministic per seed", () => {
    for (const seed of SEEDS.slice(0, 20)) {
      expect(scenario.generate(seed)).toEqual(scenario.generate(seed));
      expect(renderAttemptForCandidate(scenario, seed, END)).toEqual(renderAttemptForCandidate(scenario, seed, END));
    }
  });

  it("different seeds change names, amounts, dates, the convention and which row carries which trap", () => {
    expect(new Set(SEEDS.map((s) => JSON.stringify(scenario.generate(s).values))).size).toBe(SEEDS.length);
    const screens = SEEDS.slice(0, 60).map(screen);
    const sts = screens.map((s) => readStatement(s.sheet()));
    expect(new Set(sts.map((s) => s.owner)).size).toBe(2);
    expect(new Set(sts.map((s) => s.taxPaid)).size).toBe(2);
    expect(new Set(sts.map((s) => s.closing)).size).toBeGreaterThan(40);
    expect(new Set(sts.map((s) => s.cells.cash_buyer)).size).toBe(60);
    const titles = screens.map((s) => readTitle(s.doc("title-review")));
    expect(new Set(titles.map((t) => t.rows.findIndex((r) => r.issue === "name_affidavit"))).size).toBeGreaterThan(5);
    const deeds = screens.map((s) => readDeed(s.doc("deed-review")));
    expect(new Set(deeds.map((d) => d.rows.findIndex((r) => r.issue === "notary"))).size).toBeGreaterThan(4);
    expect(new Set(screens.map((s) => solveLender(s).kind)).size).toBe(4);
  });
});

describe("realestate-alder-closing: settlement statement", () => {
  it("the key matches a statement worked by hand from the closing data sheet, for every seed", () => {
    for (const seed of SEEDS) {
      const sc = screen(seed);
      const st = readStatement(sc.sheet());
      const key = scenario.generate(seed).keys.settlement as SheetKey;
      expect(Object.keys(key.cells).sort(), seed).toEqual(Object.keys(st.cells).sort());
      for (const [id, c] of Object.entries(st.cells)) expect(key.cells[id].value, `${seed} ${id}`).toBeCloseTo(c / 100, 6);
      expect(st.cells.cash_buyer, seed).toBeGreaterThan(0);
      expect(st.cells.cash_seller, seed).toBeGreaterThan(0);
      // Every line has four input cells, so the grid doesn't say which side an amount goes on.
      for (const line of ["emd", "loan", "conc", "tax", "hoa", "rent", "dep", "payoff", "comm", "xfer", "bcost"]) {
        for (const side of ["bd", "bc", "sd", "sc"]) expect(st.inputs, `${line}_${side}`).toContain(`${line}_${side}`);
      }
    }
  });

  it("the proration convention is stated on the sheet and in the prorations round", () => {
    const sc = screen("abc");
    expect(sc.sheet().prompt).toMatch(/positive numbers/);
    const conv = readStatement(sc.sheet()).owner;
    const item = rapidItems("abc", "rapid-prorations")[0];
    expect(conventionOwner(row(item, "Convention"))).toBe(conv);
  });
});

describe("realestate-alder-closing: title commitment", () => {
  it("twelve items with exactly three open liens left on title, one look-alike judgment set to be paid and one unpermitted easement", () => {
    for (const seed of SEEDS) {
      const t = readTitle(screen(seed).doc("title-review"));
      expect(t.rows.length, seed).toBe(12);
      expect(t.rows.filter((r) => r.issue).map((r) => `${r.kind}:${r.issue}`).sort(), seed).toEqual([
        "delinquent:payoff",
        "driveway:not_permitted",
        "heloc:payoff",
        "mech:payoff",
        "similar:name_affidavit",
      ]);
      // Look-alikes that are right: the first mortgage is paid off, the old one released, the exact-name judgment satisfied.
      expect(t.rows.filter((r) => !r.issue).map((r) => r.kind).sort()).toEqual(["Declaration", "Plat", "current_tax", "first", "released", "satisfied", "utility"]);
    }
  });

  it("the key agrees with the commitment", () => {
    for (const seed of SEEDS) {
      const sc = screen(seed);
      const t = readTitle(sc.doc("title-review"));
      const k = scenario.generate(seed).keys["title-review"] as ReviewKey;
      const at = (kind: string) => t.rows.find((r) => r.kind === kind)!.id;
      expect(k.findings.heloc).toMatchObject({ targets: [at("heloc")], reasons: ["payoff"] });
      expect(k.findings.mech_lien).toMatchObject({ targets: [at("mech")], reasons: ["payoff"] });
      expect(k.findings.delinquent_tax).toMatchObject({ targets: [at("delinquent")], reasons: ["payoff"] });
      expect(k.findings.similar_name).toMatchObject({ targets: [at("similar")], reasons: ["name_affidavit"] });
      expect(k.findings.easement).toMatchObject({ targets: [at("driveway")], reasons: ["not_permitted"] });
      expect(sc.doc("title-review").decision!.options.find((o) => o.id === k.decision![0])!.label).toMatch(/^Send .+ a title memo/);
    }
  });
});

describe("realestate-alder-closing: deed review", () => {
  it("nine items with exactly one grantor mismatch, one legal description mismatch and the missing notary block", () => {
    const grantorKinds = new Set<string>();
    const legalKinds = new Set<string>();
    for (const seed of SEEDS) {
      const d = readDeed(screen(seed).doc("deed-review"));
      expect(d.rows.length, seed).toBe(9);
      expect(d.rows.filter((r) => r.issue).map((r) => r.issue).sort(), seed).toEqual(["grantor", "legal", "notary"]);
      const g = d.rows.find((r) => r.issue === "grantor")!;
      grantorKinds.add(g.draft.split(" and ").length < g.source.split(" and ").length ? "missing" : "name");
      const l = d.rows.find((r) => r.issue === "legal")!;
      legalKinds.add(l.draft.replace(/\d+/g, "#") === l.source.replace(/\d+/g, "#") ? "number" : "block");
    }
    expect(grantorKinds.size).toBe(2);
    expect(legalKinds.size).toBe(2);
  });

  it("the key agrees with the deed", () => {
    for (const seed of SEEDS) {
      const d = readDeed(screen(seed).doc("deed-review"));
      const k = scenario.generate(seed).keys["deed-review"] as ReviewKey;
      for (const issue of ["grantor", "legal", "notary"]) {
        expect(k.findings[issue]).toMatchObject({ targets: [d.rows.find((r) => r.issue === issue)!.id], reasons: [issue] });
      }
      expect(k.decision).toBeUndefined();
    }
  });
});

describe("realestate-alder-closing: inbox", () => {
  it("lender change: update the statement and get instructions in writing; a new 3-day wait only when the APR rises more than 1/8 point or a prepayment penalty is added", () => {
    let wait = 0;
    for (const seed of SEEDS) {
      const sc = screen(seed);
      const l = solveLender(sc);
      expect(sc.mc("inbox-lender").select).toBe("multi");
      expect((scenario.generate(seed).keys["inbox-lender"] as McKey).correct.slice().sort(), seed).toEqual(l.right);
      if (l.newWait) wait++;
    }
    expect(wait).toBeGreaterThan(50);
    expect(wait).toBeLessThan(150);
  });

  it("buyer wants to move the closing: one right answer, in a different place per seed", () => {
    const places = new Set<string>();
    for (const seed of SEEDS) {
      const sc = screen(seed);
      expect(sc.mc("inbox-buyer").select).toBe("single");
      expect((scenario.generate(seed).keys["inbox-buyer"] as McKey).correct).toEqual([solveBuyer(sc)]);
      places.add(solveBuyer(sc));
    }
    expect(places.size).toBe(4);
  });
});

describe("realestate-alder-closing: scoring", () => {
  it("out of 100: rapid rounds 10 each, settlement 20, title 20, deed 15, inbox 8 + 7", () => {
    const blank = scoreAttempt(scenario, "abc", {});
    expect(blank.points).toBe(0);
    expect(blank.maxPoints).toBe(MAX);
    const max = (id: string) => blank.steps[id].maxPoints;
    expect(RAPID_STEPS.map(max)).toEqual([10, 10, 10]);
    expect(max("settlement")).toBe(20);
    expect(REVIEW_STEPS.map(max)).toEqual([20, 15]);
    expect(MC_STEPS.map(max)).toEqual([8, 7]);
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
  }, 60_000);

  it("another seed's perfect answer doesn't score well (answers can't be shared)", () => {
    let shared = 0;
    for (let i = 0; i < 20; i++) shared += scoreAttempt(scenario, SEEDS[i + 1], perfectAnswers(SEEDS[i])).points;
    expect(shared / 20).toBeLessThan(40);
  });

  describe("each trap answered wrongly costs exactly its points", () => {
    const seeds = SEEDS.slice(0, 40);
    const lost = (seed: string, mutate: (a: Answers) => void) => {
      const a = clone(perfectAnswers(seed));
      mutate(a);
      return scoreAttempt(scenario, seed, perfectAnswers(seed)).points - scoreAttempt(scenario, seed, a).points;
    };

    const cases: [string, "title-review" | "deed-review", string, string, number][] = [
      ["home equity line left on title", "title-review", "heloc", "payoff", 4],
      ["mechanic's lien left on title", "title-review", "mech", "payoff", 3],
      ["delinquent taxes left as an exception", "title-review", "delinquent", "payoff", 3],
      ["look-alike judgment paid", "title-review", "similar", "name_affidavit", 4],
      ["unpermitted easement accepted", "title-review", "driveway", "not_permitted", 4],
      ["grantor doesn't match the vesting", "deed-review", "grantor", "grantor", 5],
      ["legal description doesn't match the survey", "deed-review", "legal", "legal", 5],
      ["missing notary block", "deed-review", "notary", "notary", 5],
    ];
    for (const [name, stepId, kind, reason, points] of cases) {
      it(`${name} missed: loses ${points}; spotted with the wrong reason: loses half`, () => {
        for (const seed of seeds) {
          const sc = screen(seed);
          const rows = stepId === "title-review" ? readTitle(sc.doc(stepId)).rows : readDeed(sc.doc(stepId)).rows.map((r) => ({ ...r, kind: r.issue ?? "" }));
          const id = rows.find((r) => r.kind === kind && r.issue === reason)!.id;
          const step = (a: Answers) => a[stepId] as { flags: Flag[] };
          expect(lost(seed, (a) => (step(a).flags = step(a).flags.filter((f) => f.target !== id))), `${seed} ${name}`).toBe(points);
          expect(lost(seed, (a) => (step(a).flags.find((f) => f.target === id)!.reason = "other")), `${seed} ${name} wrong reason`).toBe(points / 2);
        }
      });
    }

    it("closing on the commitment as written costs the decision's 2", () => {
      for (const seed of seeds) {
        const close = oneOption(screen(seed).doc("title-review").decision!, /^Close as scheduled/);
        expect(lost(seed, (a) => (a["title-review"].decision = close))).toBe(2);
      }
    });

    it("flagging a clean title item or deed line costs the false-flag penalty", () => {
      for (const seed of seeds) {
        const sc = screen(seed);
        const first = readTitle(sc.doc("title-review")).rows.find((r) => r.kind === "first")!;
        expect(lost(seed, (a) => a["title-review"].flags.push({ target: first.id, reason: "payoff", note: "" }))).toBe(1);
        const satisfied = readTitle(sc.doc("title-review")).rows.find((r) => r.kind === "satisfied")!;
        expect(lost(seed, (a) => a["title-review"].flags.push({ target: satisfied.id, reason: "name_affidavit", note: "" }))).toBe(1);
        const clean = readDeed(sc.doc("deed-review")).rows.find((r) => !r.issue)!;
        expect(lost(seed, (a) => a["deed-review"].flags.push({ target: clean.id, reason: "other", note: "" }))).toBe(1);
      }
    });

    it("settlement: property tax on the wrong side costs 2; the deposit left off costs 1; a wrong payoff costs 1", () => {
      for (const seed of seeds) {
        const st = readStatement(screen(seed).sheet());
        const [from, to] = st.taxPaid ? [["tax_bd", "tax_sc"], ["tax_bc", "tax_sd"]] : [["tax_bc", "tax_sd"], ["tax_bd", "tax_sc"]];
        expect(
          lost(seed, (a) => {
            const c = a.settlement.cells;
            to.forEach((k, i) => (c[k] = c[from[i]]));
            from.forEach((k) => delete c[k]);
          }),
          seed,
        ).toBe(2);
        expect(lost(seed, (a) => (delete a.settlement.cells.dep_bc, delete a.settlement.cells.dep_sd))).toBe(1);
        expect(lost(seed, (a) => (a.settlement.cells.payoff_sd = a.settlement.cells.payoff_sd! - 1))).toBe(1);
      }
    });

    it("settlement: giving the closing day to the wrong party moves the prorations and the totals", () => {
      for (const seed of seeds.slice(0, 10)) {
        const sc = screen(seed);
        const st = readStatement(sc.sheet());
        const a = clone(perfectAnswers(seed));
        // A one-day shift changes each proration by at least a cent.
        for (const k of ["hoa_bd", "hoa_sc", "rent_bc", "rent_sd"]) a.settlement.cells[k] = st.cells[k] / 100 + 1;
        expect(scoreAttempt(scenario, seed, perfectAnswers(seed)).steps.settlement.points - scoreAttempt(scenario, seed, a).steps.settlement.points).toBe(2);
      }
    });

    it("inbox: picking the wrong waiting-period call loses its share; telling the buyer the date is moved costs all 7", () => {
      for (const seed of seeds) {
        const sc = screen(seed);
        const l = solveLender(sc);
        const cfg = sc.mc("inbox-lender");
        const waitCall = l.newWait ? oneOption(cfg, /new 3-business-day wait/) : oneOption(cfg, /no new 3-business-day wait/);
        expect(lost(seed, (a) => (a["inbox-lender"].selected = l.right.filter((x) => x !== waitCall)))).toBeCloseTo(8 / 3, 2);
        const move = oneOption(sc.mc("inbox-buyer"), /^Change the date in the closing file/);
        expect(lost(seed, (a) => (a["inbox-buyer"].selected = [move]))).toBe(7);
      }
    });
  });
});

describe("realestate-alder-closing: nothing from the key reaches the candidate", () => {
  it("no reviewer note, key word or computed amount in any payload", () => {
    for (const seed of SEEDS) {
      const variant = scenario.generate(seed);
      const notes = REVIEW_STEPS.flatMap((id) => Object.values((variant.keys[id] as ReviewKey).findings).map((f) => f.note!));
      for (const n of notes) expect(n.length).toBeGreaterThan(10);
      const derived = ["cash_buyer", "cash_seller", "tot_bd", "tot_sc", "payoff_sd", "comm_sd"].map((id) => (variant.keys.settlement as SheetKey).cells[id].value);
      for (const minute of [0, 20, END]) {
        const payload = JSON.stringify(renderAttemptForCandidate(scenario, seed, minute));
        expect(payload).not.toMatch(/"keys"|tolerance|"criteria"|"guidance"|"notes"|"points"|"expected"|"findings"|"clean":|"correct"/);
        for (const n of notes) expect(payload, seed).not.toContain(n);
        for (const v of derived) expect(payload, `${seed} ${v}`).not.toContain(v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
      }
    }
  }, 60_000);
});

describe("realestate-alder-closing: timed sections", () => {
  const def = scenario.definition;
  const MIN = 60_000;
  const t0 = Date.parse("2026-11-16T09:00:00Z");
  const flowAt = (ms: number) => resolveFlow(def, { startedAt: t0, now: t0 + ms, extraTimePercent: 0, events: [] });
  const stepById = (id: string) => def.steps.find((s) => s.id === id)!;

  it("validateSections passes and the sections fill the time limit exactly", () => {
    expect(validateSections(def, scenario.timeLimitMinutes)).toEqual([]);
    expect(def.sections!.reduce((t, s) => t + s.minutes, 0)).toBe(scenario.timeLimitMinutes);
  });

  it("six sections: prorations, settlement statement, title terms, title commitment, recording checks, deed and inbox", () => {
    expect(def.sections!.map((s) => [s.id, s.minutes, s.stepIds, !!s.oneAtATime])).toEqual([
      ["s-rapid-a", 6, ["rapid-prorations"], false],
      ["s-settlement", 11, ["settlement"], false],
      ["s-rapid-b", 6, ["rapid-title-terms"], false],
      ["s-title", 11, ["title-review"], false],
      ["s-rapid-c", 6, ["rapid-recording"], false],
      ["s-deed", 10, ["deed-review", ...MC_STEPS], true],
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
    expect(at(0).visibleStepIds).toEqual(["rapid-prorations"]);
    expect(at(6).visibleStepIds).toEqual(["settlement"]);
    expect(at(17).visibleStepIds).toEqual(["rapid-title-terms"]);
    expect(at(23).visibleStepIds).toEqual(["title-review"]);
    expect(at(34).visibleStepIds).toEqual(["rapid-recording"]);
    expect(at(40).visibleStepIds).toEqual(["deed-review"]);
    expect(at(45.1).visibleStepIds).toEqual(["inbox-lender"]);
    expect(at(47.6).visibleStepIds).toEqual(["inbox-buyer"]);
    expect(at(END).done).toBe(true);
  });

  it("messages arrive when their section opens", () => {
    expect(def.messages.map((m) => [m.id, m.arriveAtMinute ?? 0, m.stepId])).toEqual([
      ["m1", 0, "settlement"],
      ["m2", 0, "title-review"],
      ["m3", 0, "deed-review"],
      ["m4", 0, "inbox-lender"],
      ["m5", 0, "inbox-buyer"],
    ]);
    const msgsAt = (min: number) => visibleMessageIds(def, flowAt(min * MIN), t0, t0 + min * MIN);
    expect(msgsAt(5)).toEqual([]);
    expect(msgsAt(6)).toEqual(["m1"]);
    expect(msgsAt(23)).toEqual(["m1", "m2"]);
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

describe("realestate-alder-closing: rapid rounds", () => {
  it("every item over 200 seeds has one right answer, found from the material alone, matching the key", () => {
    for (const seed of SEEDS) {
      const keys = scenario.generate(seed).keys;
      for (const id of RAPID_STEPS) {
        const key = keys[id] as RapidKey;
        const solved = solveRapid(seed, id);
        expect(Object.keys(key.items).sort()).toEqual(solved.map((s) => s.item.id).sort());
        for (const s of solved) expect(key.items[s.item.id].answer.choice, `${seed} ${s.item.id} (${s.kind}: ${s.item.prompt})`).toBe(s.values.answer);
      }
    }
  }, 60_000);

  it("ten quick items worth half a point and five harder ones worth one, in every round", () => {
    const hardKinds: Record<RapidStepId, string[]> = {
      "rapid-prorations": ["fiscal", "payoff", "rent_unpaid", "rent_deposit"],
      "rapid-title-terms": TITLE_RULES.filter((r) => r[3] === "hard").map((r) => r[0]),
      "rapid-recording": ["grantor_initial", "legal_page", "notary_expired", "fee_short"],
    };
    for (const id of RAPID_STEPS) {
      const points = rapidConfig(id).items.map((i) => i.points);
      expect(points.filter((p) => p === 0.5).length, id).toBe(10);
      expect(points.filter((p) => p === 1).length, id).toBe(5);
      for (const seed of SEEDS.slice(0, 50)) {
        solveRapid(seed, id).forEach((s, i) => {
          // A clean deed reads the same in an easy or a hard slot: the hard one has a fee worked over several pages.
          if (id === "rapid-recording" && s.kind === "ok") return;
          expect(hardKinds[id].includes(s.kind), `${seed} ${id} item ${i} ${s.kind}`).toBe(points[i] === 1);
        });
      }
    }
  });

  it("prorations: every kind shows up, and both closing-day conventions", () => {
    const kinds = new Map<string, number>();
    const owners = new Set<string>();
    for (const seed of SEEDS.slice(0, 50)) {
      for (const s of solveRapid(seed, "rapid-prorations")) {
        kinds.set(s.kind, (kinds.get(s.kind) ?? 0) + 1);
        owners.add(conventionOwner(row(s.item, "Convention")));
      }
    }
    expect([...kinds.keys()].sort()).toEqual(["fiscal", "hoa", "payoff", "prepaid", "rent", "rent_deposit", "rent_unpaid", "tax_advance", "tax_arrears"]);
    expect(kinds.get("payoff")).toBe(100);
    expect(owners.size).toBe(2);
  });

  it("recording checks: every kind of problem and clean deeds show up", () => {
    const kinds = new Set<string>();
    for (const seed of SEEDS.slice(0, 50)) for (const s of solveRapid(seed, "rapid-recording")) kinds.add(s.kind);
    expect([...kinds].sort()).toEqual(["fee_short", "grantor_initial", "grantor_missing", "grantor_name", "legal_lot_block", "legal_page", "notary_expired", "notary_missing", "ok"]);
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
      const ids = (seed: string) => rapidItems(seed, id).map((i) => i.fields.map((f) => [f.id, (f as RapidChoiceField).options?.map((o) => o.id)]));
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
