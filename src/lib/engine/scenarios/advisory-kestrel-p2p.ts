import "server-only";

import type { Rng } from "../server/rng";
import { defineScenario } from "../server/scenario";
import { formatCents } from "../server/template";
import { DOCUMENT_REVIEW } from "../step-types/document_review/public";
import { INBOX_REPLY } from "../step-types/inbox_reply/public";
import { MULTIPLE_CHOICE } from "../step-types/multiple_choice/public";
import { NUMERIC } from "../step-types/numeric/public";
import { ORDERING } from "../step-types/ordering/public";
import { RAPID_ROUND } from "../step-types/rapid_round/public";

/**
 * docs/07 Example 8: risk advisory / SOX intern at Kestrel Advisory, testing
 * procure-to-pay controls for a client, Arbor Health Supply, in six timed
 * sections (52 minutes, 100 points): rapid round A, control pass or fail (10)
 * → test of operating effectiveness, one screen at a time (25) → rapid round
 * B, access conflicts (10) → inbox, one screen at a time (15) → rapid round
 * C, design or operating (10) → walkthrough and deficiency write-up (30).
 *
 * Seeded per candidate: every amount, PO number, vendor, person, date and
 * user ID; which sample screen holds the PO with no approval (the verbal
 * one), how many other exceptions there are (0 to 2), their kind and where
 * they sit; which ERP user left but is still active; the order the
 * walkthrough steps are shown in; and every rapid item.
 *
 * Rapid rounds: 15 items × 24 s, which fills the 6-minute section exactly
 * (the handoff's 25 s would need 6¼ minutes). Items 3, 6, 9, 12 and 15 hold
 * the harder kinds and are worth 1 point, the other ten ½, so each round is
 * exactly 10. The order is shuffled per seed within each tier.
 *
 * Shaped by the current step types (draft: needs accountant review):
 * - `document_review` findings are fixed in the config, so each sample screen
 *   holds at most one exception ("Both POs pass" confirms a clean screen).
 * - The conclusion is its own one-minute `multiple_choice` screen.
 * - The write-up needs a reviewer, so a perfect attempt shows 85 automatic
 *   points until it is marked.
 */

const THRESHOLD = 1; // Kestrel's guidance for this sample of 8: 0 or 1 exception is effective.

const FIRST = [
  "Maya", "Ethan", "Priya", "Lucas", "Sofia", "Noah", "Aisha", "Daniel", "Grace", "Omar", "Hannah", "Mateo",
  "Chloe", "Ryan", "Leah", "Marcus", "Elena", "Victor", "Nina", "Caleb", "Rosa", "Tariq", "Julia", "Felix",
];
const LAST = [
  "Patel", "Nguyen", "Garcia", "Kim", "Okafor", "Fischer", "Rossi", "Haddad", "Lindqvist", "Moreno", "Chen", "Brooks",
  "Walsh", "Dubois", "Sato", "Kowalski", "Reyes", "Bennett", "Ahmed", "Novak", "Ortiz", "Hughes", "Larsen", "Mensah",
];

const VENDORS = [
  "Meridian Surgical",
  "Bluepeak Medical",
  "Northgate Gloves",
  "Cardinal Point Diagnostics",
  "Harbor Sterile Supply",
  "Summit Wound Care",
  "Pinewood Pharma Logistics",
  "Clearwater Lab Products",
  "Redstone Orthopedic",
  "Lakeview Respiratory",
  "Silverline Syringes",
  "Oakmont Medical Textiles",
];

const DIRECTOR_TITLES = ["Director of Supply Chain", "Director of Operations", "Finance Director"];
const MANAGER_TITLES = ["Purchasing Manager", "Warehouse Manager", "Senior Buyer"];
const DEPARTMENTS = ["Purchasing", "Accounts Payable", "Warehouse", "Finance", "Sales", "Customer Service", "Pharmacy Services", "Logistics"];
const ERP_ROLES = [
  "Buyer",
  "AP clerk",
  "Warehouse receiving",
  "AP invoice approver",
  "Payment approver",
  "GL accountant",
  "Sales order entry",
  "Reports (read only)",
];
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const MONTHS = MONTH_NAMES.map((m) => m.slice(0, 3));
const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/** Day of the year (1 = Jan 1, 2026) as "Aug 14". */
function day(doy: number): string {
  let d = doy;
  for (let m = 0; m < 12; m++) {
    if (d <= MONTH_DAYS[m]) return `${MONTHS[m]} ${d}`;
    d -= MONTH_DAYS[m];
  }
  throw new Error(`advisory-kestrel-p2p: day ${doy} is past the year`);
}
/** Day of the year of the 1st of month `m` (0-based). */
const monthStart = (m: number) => 1 + MONTH_DAYS.slice(0, m).reduce((t, x) => t + x, 0);

const loginId = (name: string) => {
  const [first, last] = name.split(" ");
  return `${first[0]}${last}`.toLowerCase();
};

// ---- Rapid rounds ----

const RAPID_ITEMS = 15;
const SECONDS_PER_ITEM = 24;
/** Items 3, 6, 9, 12 and 15 hold the harder kinds and are worth 1; the rest ½. 10 points a round. */
const isHardSlot = (i: number) => i % 3 === 2;
const slotNo = (i: number) => String(i + 1).padStart(2, "0");

function fillSlots<T>(easy: T[], hard: T[]): T[] {
  const e = [...easy];
  const h = [...hard];
  const out = Array.from({ length: RAPID_ITEMS }, (_, i) => (isHardSlot(i) ? h.shift() : e.shift()));
  if (out.some((x) => x === undefined) || e.length || h.length) throw new Error("advisory-kestrel-p2p: rapid slots don't fill");
  return out as T[];
}

function rapidItems(prefix: string, item: (n: string) => object) {
  return Array.from({ length: RAPID_ITEMS }, (_, i) => ({ id: `${prefix}-${slotNo(i)}`, ...item(slotNo(i)), points: isHardSlot(i) ? 1 : 0.5 }));
}

type RapidKeyItems = Record<string, Record<string, { choice: string }>>;

// A · control pass or fail

const CT_ROWS = 6;
const CT_REASONS = [
  { id: "none", label: "No issue" },
  { id: "self", label: "Approver is the requester" },
  { id: "after_payment", label: "Approved after payment" },
  { id: "over_limit", label: "Over the approval limit" },
  { id: "signoff", label: "Sign-off missing or late" },
];
type CtCase =
  | "po_ok"
  | "po_self"
  | "po_over"
  | "po_after"
  | "po_near"
  | "vendor_ok"
  | "vendor_self"
  | "vendor_after"
  | "rec_ok"
  | "rec_self"
  | "rec_missing"
  | "rec_late"
  | "rec_near";
const CT_EASY: CtCase[] = ["po_self", "vendor_self", "rec_self", "rec_missing", "rec_missing", "po_over", "po_over", "po_ok", "vendor_ok", "rec_ok"];
const CT_HARD: CtCase[] = ["po_after", "vendor_after", "rec_late", "po_near", "rec_near"];
const CT_REASON: Record<CtCase, string> = {
  po_ok: "none",
  po_near: "none",
  vendor_ok: "none",
  rec_ok: "none",
  rec_near: "none",
  po_self: "self",
  vendor_self: "self",
  rec_self: "self",
  po_over: "over_limit",
  po_after: "after_payment",
  vendor_after: "after_payment",
  rec_missing: "signoff",
  rec_late: "signoff",
};

const rapidControlsStep = {
  id: "rapid-controls",
  type: RAPID_ROUND,
  title: "Rapid round: control pass or fail",
  config: {
    intro: [
      "Control pass or fail: 15 pieces of evidence, 24 seconds each. Each one shows the control it supports.",
      "Decide if the control worked (Effective) or not (Deficiency), and why.",
    ].join("\n"),
    secondsPerItem: SECONDS_PER_ITEM,
    items: rapidItems("ct", (n) => ({
      prompt: `{{ct_${n}_control}}`,
      exhibit: {
        title: `{{ct_${n}_title}}`,
        rows: Array.from({ length: CT_ROWS }, (_, j) => ({ label: `{{ct_${n}_l${j + 1}}}`, value: `{{ct_${n}_v${j + 1}}}` })),
      },
      fields: [
        {
          id: "result",
          label: "Result",
          kind: "choice",
          options: [
            { id: "effective", label: "Effective" },
            { id: "deficiency", label: "Deficiency" },
          ],
        },
        { id: "reason", label: "Reason", kind: "choice", options: CT_REASONS },
      ],
    })),
  },
};

// B · access conflicts (segregation of duties)

type Pair = "vendor_pay" | "je" | "receive_invoice";
const PAIRS: Pair[] = ["vendor_pay", "je", "receive_invoice"];
const SENSITIVE: Record<Pair, [string, string][]> = {
  vendor_pay: [
    ["VENDOR_MAINT", "Create and edit vendors"],
    ["PAYMENT_APPROVE", "Approve payments"],
  ],
  je: [
    ["JE_POST", "Post journal entries"],
    ["JE_APPROVE", "Approve journal entries"],
  ],
  receive_invoice: [
    ["GOODS_RECEIPT", "Receive goods"],
    ["INVOICE_APPROVE", "Approve vendor invoices"],
  ],
};
const HARMLESS: [string, string][] = [
  ["REQ_CREATE", "Create purchase requisitions"],
  ["PO_VIEW", "View purchase orders"],
  ["FIN_RPT_VIEW", "View financial reports"],
  ["TIME_ENTRY", "Enter timesheets"],
  ["AP_AGING_RUN", "Run the AP aging report"],
  ["VENDOR_VIEW", "View the vendor list"],
  ["BUDGET_VIEW", "View budgets"],
  ["EXPENSE_SUBMIT", "Submit own expense claims"],
];
const SD_ROLES = 4;
type SdCase = Pair | `${Pair}_plus` | "none_harmless" | "none_single" | "none_three";
const SD_EASY: SdCase[] = ["vendor_pay", "vendor_pay", "je", "je", "receive_invoice", "receive_invoice", "none_harmless", "none_harmless", "none_single", "none_single"];
const SD_HARD: SdCase[] = ["vendor_pay_plus", "je_plus", "receive_invoice_plus", "none_three", "none_three"];
const SD_OPTIONS = [
  { id: "vendor_pay", label: "Create vendor + approve payment" },
  { id: "je", label: "Post JE + approve JE" },
  { id: "receive_invoice", label: "Receive goods + approve invoice" },
  { id: "none", label: "No conflict" },
];

const rapidSodStep = {
  id: "rapid-sod",
  type: RAPID_ROUND,
  title: "Rapid round: access conflicts",
  config: {
    intro: [
      "Access conflicts: 15 ERP users, 24 seconds each. Each shows the user's four roles.",
      "Pick the segregation of duties conflict the user has, or No conflict. A conflict needs both roles of a pair.",
    ].join("\n"),
    secondsPerItem: SECONDS_PER_ITEM,
    items: rapidItems("sd", (n) => ({
      prompt: "Does this user have a segregation of duties conflict?",
      exhibit: {
        title: `User {{sd_${n}_id}}`,
        rows: [
          { label: "Name", value: `{{sd_${n}_name}}` },
          { label: "Department", value: `{{sd_${n}_dept}}` },
        ],
        table: {
          columns: ["Role", "What it allows"],
          rows: Array.from({ length: SD_ROLES }, (_, j) => [`{{sd_${n}_r${j + 1}}}`, `{{sd_${n}_d${j + 1}}}`]),
        },
      },
      fields: [{ id: "conflict", label: "Conflict", kind: "choice", options: SD_OPTIONS }],
    })),
  },
};

// C · design or operating?

type FdAnswer = "design" | "operating" | "none";
type FdTemplate = [answer: FdAnswer, text: (rng: Rng, ctx: FdContext) => string];
type FdContext = { name: () => string; vendor: () => string; date: () => string; month: () => string };

const FD_EASY: FdTemplate[] = [
  ["design", (rng) => `The control matrix says POs over $10,000 need a director's approval, but the ERP only sends POs over ${formatCents(rng.int(20, 60) * 1_000 * 100)} to a director.`],
  ["design", (_, c) => `${c.name()} in AP updates vendor bank details on request, and nobody reviews the change. There's no control for it in the matrix.`],
  ["design", (_, c) => `The ERP lets ${c.name()} in AP both create vendors and approve payments, and no control looks at what that access is used for.`],
  ["design", (_, c) => `The bank rec review procedure only asks the reviewer to check that ${c.name()} signed the rec, not to look at the reconciling items.`],
  ["operating", (rng, c) => `${rng.int(2, 9)} of 25 POs over $10,000 tested by ${c.name()} were approved by a director after the order date.`],
  ["operating", (rng, c) => `The ${c.month()} bank rec was signed off ${rng.int(8, 25)} days after the review due date.`],
  ["operating", (rng, c) => `${c.name()} left on ${c.date()} and the ERP account was still active ${rng.int(15, 60)} days later. The policy says access is removed within 1 business day.`],
  ["operating", (_, c) => `The payment run on ${c.date()} was released without the controller's approval, which the procedure requires for every run.`],
  ["none", (rng, c) => `A PO for ${formatCents(rng.cents(1_200, 9_800))}, under $10,000, was approved by ${c.name()}, a purchasing manager, not a director.`],
  ["none", (rng, c) => `All ${rng.int(20, 40)} POs over $10,000 tested by ${c.name()} were approved by a director on or before the order date.`],
  ["none", (rng, c) => `${c.name()} reviewed and signed off the ${c.month()} bank rec ${rng.int(1, 6)} days before the review due date.`],
  ["none", (_, c) => `${c.name()} left on ${c.date()}, and IT disabled the ERP account the same day.`],
];
const FD_HARD: FdTemplate[] = [
  ["design", (_, c) => `The user access review checks a list of users that ${c.name()} in IT keeps in a spreadsheet, not a report from the ERP. Nobody checks the list is complete.`],
  ["design", (rng) => `The three-way match lets an invoice through without review if it's within ${rng.int(12, 30)}% of the PO price.`],
  ["operating", (rng, c) => `${c.name()} signed the ${c.month()} bank rec, but a ${formatCents(rng.cents(800, 9_000))} reconciling item over 90 days old wasn't followed up, as the review procedure requires.`],
  ["operating", (_, c) => `A change to ${c.vendor()}'s bank details was entered and approved by ${c.name()}. The procedure requires a second person.`],
  ["none", (_, c) => `The controller was on leave, so ${c.name()}, the CFO, approved the payment run on ${c.date()}, as the delegation of authority allows.`],
  ["none", (rng, c) => `${c.name()}, a director, approved PO ${rng.int(40_000, 49_999)} for ${formatCents(rng.cents(10_500, 80_000))} on ${c.date()}, the same morning it was sent to the vendor.`],
];
const FD_OPTIONS = [
  { id: "design", label: "Design deficiency" },
  { id: "operating", label: "Operating deficiency" },
  { id: "none", label: "Not a deficiency" },
];

const rapidFindingsStep = {
  id: "rapid-findings",
  type: RAPID_ROUND,
  title: "Rapid round: design or operating?",
  config: {
    intro: [
      "Design or operating? 15 findings, 24 seconds each.",
      "Design deficiency: the control is missing, or wouldn't catch the problem even if done right. Operating deficiency: the control is fine on paper but wasn't done as designed. Not a deficiency: the control worked, or it doesn't apply.",
    ].join("\n"),
    secondsPerItem: SECONDS_PER_ITEM,
    items: rapidItems("fd", (n) => ({
      prompt: `{{fd_${n}}}`,
      fields: [{ id: "kind", label: "This finding is a", kind: "choice", options: FD_OPTIONS }],
    })),
  },
};

// ---- Work task: test of operating effectiveness ----

type PoKind = "pass" | "no_approval" | "not_director" | "after_order";
const SAMPLE_SIZE = 8;
const SAMPLE_COLUMNS = ["PO", "Vendor", "Amount", "Requested by", "Order date", "Approved by", "Approver's title", "Approved on"];
const SAMPLE_CELLS = ["po", "vendor", "amt|money", "req", "order", "appr", "title", "appr_on"];

function sampleStep(k: number) {
  const nums = [2 * k - 1, 2 * k];
  return {
    id: `test-${k}`,
    type: DOCUMENT_REVIEW,
    seconds: 165,
    title: `PO approval test: items ${nums[0]} and ${nums[1]}`,
    config: {
      prompt: [
        "Control P2P-02: POs over $10,000 are approved by a director in the ERP on or before the order date.",
        "Test both POs. Flag a PO that fails, with the reason. If both pass, tick \"Both POs pass\".",
      ].join("\n"),
      document: {
        title: `Q3 sample, items ${nums[0]} and ${nums[1]} of 8 · ERP approval history`,
        fields: [],
        columns: SAMPLE_COLUMNS,
        rows: nums.map((n, j) => ({ id: `p${j + 1}`, cells: SAMPLE_CELLS.map((c) => `{{s${n}_${c}}}`) })),
        totals: [],
      },
      reasons: [
        { id: "no_approval", label: "No approval on record" },
        { id: "not_director", label: "Approver isn't a director" },
        { id: "after_order", label: "Approved after the order date" },
        { id: "under", label: "PO is under $10,000" },
        { id: "other", label: "Other" },
      ],
      findings: [{ id: "exception", label: "Exception on this screen", points: 5 }],
      confirmClean: { label: "Both POs pass", points: 5 },
      falseFlagPenalty: 2,
    },
  };
}

// ---- Walkthrough ----

/** The P2P steps in their true order; three are the key controls from the matrix. */
const WALK_STEPS = [
  "{{walk_requester}} in {{walk_dept}} raises a purchase requisition",
  "Purchasing turns the requisition into a PO in the ERP",
  "Key control P2P-02: a director approves the PO in the ERP (POs over $10,000)",
  "The PO is sent to the vendor and the order is placed",
  "The warehouse receives the goods and records the receipt in the ERP",
  "AP enters the vendor's invoice",
  "Key control P2P-03: the ERP matches the PO, receipt and invoice",
  "AP builds the weekly payment run",
  "Key control P2P-04: {{controller}}, the controller, approves the payment run",
  "The bank releases the payments to vendors",
];
const WALK_IDS = WALK_STEPS.map((_, i) => `w${String(i + 1).padStart(2, "0")}`);

export const advisoryKestrelP2p = defineScenario({
  slug: "advisory-kestrel-p2p",
  version: 1,
  title: "Kestrel Advisory: P2P controls testing",
  roleFamily: "accounting",
  timeLimitMinutes: 52,
  definition: {
    intro:
      "You're a risk advisory intern at Kestrel Advisory. This week you're on the SOX testing team for a client, Arbor Health Supply, a medical supplies distributor. Your manager is Jordan Ellis. Today you're testing Arbor's procure-to-pay (P2P) controls. The work comes in six timed parts, 52 minutes in all: three rapid rounds, a sample of POs to test, Jordan's inbox and a walkthrough with a short write-up. A finished part can't be reopened.",
    steps: [
      rapidControlsStep,
      sampleStep(1),
      sampleStep(2),
      sampleStep(3),
      sampleStep(4),
      {
        id: "conclusion",
        type: MULTIPLE_CHOICE,
        seconds: 60,
        title: "Conclusion on P2P-02",
        config: {
          prompt: [
            "Your conclusion on P2P-02 for the whole sample of 8.",
            "Testing guidance: 0 or 1 exception, the control is effective. 2 or more exceptions, it's a deficiency.",
          ].join("\n"),
          options: [
            { id: "effective", label: "Effective" },
            { id: "deficiency", label: "Deficiency" },
          ],
          points: 5,
        },
      },
      rapidSodStep,
      {
        id: "verbal",
        type: MULTIPLE_CHOICE,
        seconds: 180,
        title: "Reply to {{po_owner}}",
        config: {
          prompt: "{{po_owner}} wants PO {{verbal_po}} passed on a verbal approval. What do you reply?",
          options: [
            { id: "pass", label: "Yes, I'll pass it. {{verbal_director}} has confirmed the approval." },
            { id: "sign_now", label: "I'll pass it once {{verbal_director}} approves the PO in the ERP today." },
            {
              id: "exception",
              label: "No, I have to record it as an exception. If there's written approval dated on or before the order date, send it and I'll look at it.",
            },
            { id: "replace", label: "I'll take it out of the sample and test another PO instead." },
          ],
          points: 5,
        },
      },
      {
        id: "exception-count",
        type: NUMERIC,
        seconds: 90,
        title: "Exceptions in the sample",
        config: { prompt: "Jordan: how many exceptions out of the sample of 8?", unit: "exceptions", decimals: 0, points: 2 },
      },
      {
        id: "exception-value",
        type: NUMERIC,
        seconds: 90,
        title: "Value of the exceptions",
        config: { prompt: "Jordan: total value of the POs with exceptions?", unit: "USD", decimals: 2, points: 2 },
      },
      {
        id: "user-list",
        type: DOCUMENT_REVIEW,
        seconds: 240,
        title: "ERP user list",
        config: {
          prompt: ["Check IT's active user list against HR's leavers.", "Flag any user who shouldn't be active, with the reason. Then say what you'll ask IT for."].join(
            "\n",
          ),
          document: {
            title: "Arbor ERP · active users · run {{report_date}}",
            fields: [
              { id: "source", label: "Sent by", value: "{{it_name}}, IT Service Desk" },
              { id: "leavers", label: "HR leavers since Jul 1", value: "{{leavers}}" },
            ],
            columns: ["User ID", "Name", "Department", "ERP role", "Status", "Last login"],
            rows: Array.from({ length: 8 }, (_, i) => ({
              id: `u${i + 1}`,
              cells: ["id", "name", "dept", "role", "status", "login"].map((c) => `{{u${i + 1}_${c}}}`),
            })),
            totals: [],
          },
          reasons: [
            { id: "terminated", label: "Left the company but still active" },
            { id: "sod", label: "Conflicting roles" },
            { id: "generic", label: "Shared or generic account" },
            { id: "other", label: "Other" },
          ],
          findings: [{ id: "terminated", label: "Leaver still active", points: 4 }],
          falseFlagPenalty: 1,
          decision: {
            prompt: "What do you ask IT for?",
            options: [
              { id: "disable", label: "Disable the account now, and send its activity since the leaving date and the ticket showing when it was disabled" },
              { id: "hr_confirm", label: "Nothing yet: ask HR to confirm the leaving date first" },
              { id: "next_review", label: "Nothing: it will come off at the next quarterly access review" },
              { id: "resend", label: "Take the name off the list and send a corrected report" },
            ],
            points: 2,
          },
        },
      },
      rapidFindingsStep,
      {
        id: "walkthrough",
        type: ORDERING,
        title: "P2P walkthrough",
        config: {
          prompt:
            "Put Arbor's P2P steps in order, first to last, with each key control where it sits in the process. Use the drag handles or the Up and Down buttons.",
          items: WALK_IDS.map((id) => ({ id, label: `{{wt_${id}}}` })),
          positionPoints: 5,
          pairwisePoints: 10,
        },
      },
      {
        id: "writeup",
        type: INBOX_REPLY,
        title: "Write-up to Jordan",
        config: {
          prompt: "Write up the access finding for the client: condition, criteria, risk and recommendation. Under 150 words.",
          to: "Jordan Ellis, Senior Manager",
          subject: "RE: Write-up: {{term_name}}'s ERP access",
          maxChars: 2_000,
          criteria: [
            {
              id: "condition",
              label: "Condition: what was found",
              maxPoints: 4,
              guidance: "Says {{term_name}} ({{term_id}}) left on {{term_left}} but was still active in the ERP on {{report_date}}, with the {{term_role}} role, and logged in on {{term_login}}, after leaving.",
            },
            {
              id: "criteria",
              label: "Criteria: the control or policy",
              maxPoints: 3,
              guidance: "Names ITGC-03: ERP access is removed within 1 business day of termination.",
            },
            {
              id: "risk",
              label: "Risk",
              maxPoints: 3,
              guidance:
                "Explains the risk: a former employee, or someone using the account, could approve invoices or payments without anyone noticing; the P2P controls depend on only current staff having access.",
            },
            {
              id: "recommendation",
              label: "Recommendation",
              maxPoints: 3,
              guidance:
                "Disable the account now, review everything done with it since {{term_left}}, and fix how HR tells IT about leavers (for example a daily leavers report, or access removed automatically).",
            },
            {
              id: "brevity",
              label: "Clear and under 150 words",
              maxPoints: 2,
              guidance: "Under 150 words, organized under the four headings or close to it, professional enough to go to the client.",
            },
          ],
        },
      },
    ],
    messages: [
      {
        id: "m0",
        from: "Jordan Ellis, Senior Manager, Kestrel Advisory",
        subject: "Arbor P2P testing today",
        body: [
          "Hi {{first_name}},",
          "",
          "Welcome to the Arbor Health Supply team. Today we're testing their procure-to-pay controls for SOX. Here's Arbor's control matrix for P2P, so keep this email handy:",
          "",
          "P2P-01 · Vendor bank detail changes approved by a second person before the next payment · Owner: {{ap_manager}}, AP Manager · Not key",
          "P2P-02 · POs over $10,000 approved by a director in the ERP on or before the order date · Owner: {{po_owner}}, Purchasing Manager · Key",
          "P2P-03 · ERP matches PO, goods receipt and invoice before an invoice can be paid · Owner: {{ap_manager}}, AP Manager · Key",
          "P2P-04 · Controller approves each payment run before release · Owner: {{controller}}, Controller · Key",
          "P2P-05 · Monthly bank rec reviewed and signed off by someone other than the preparer by the due date · Owner: {{controller}}, Controller · Not key",
          "ITGC-03 · ERP access removed within 1 business day of termination · Owner: {{it_manager}}, IT Manager · Key",
          "",
          "We'll start with some quick checks, then the P2P-02 sample. I'll send the details as we go.",
          "",
          "Jordan",
        ].join("\n"),
        arriveAtMinute: 0,
      },
      {
        id: "m1",
        from: "Jordan Ellis, Senior Manager, Kestrel Advisory",
        subject: "P2P-02 sample: 8 POs",
        body: [
          "Here's the sample for P2P-02: 8 POs over $10,000 from Q3, picked at random. They're on the next screens, two at a time, with the approval history from the ERP.",
          "",
          "For each PO, check it was approved by a director, in the ERP, on or before the order date. A same-day approval is fine. Anything else is an exception.",
          "",
          "Testing guidance for this sample: 0 or 1 exception, the control is effective. 2 or more, it's a deficiency. Keep a note of your exceptions, I'll ask about them later.",
          "",
          "Jordan",
        ].join("\n"),
        arriveAtMinute: 0,
        stepId: "test-1",
      },
      {
        id: "m2",
        from: "Purchasing, Arbor Health Supply",
        subject: "PO {{verbal_po}}",
        body: [
          "Hi,",
          "",
          "Your team flagged PO {{verbal_po}} ({{verbal_vendor}}, {{verbal_amt|money}}) as having no approval. {{verbal_director}} did approve it, by phone, before we placed the order. They were traveling that week and couldn't get into the ERP.",
          "",
          "That approval was verbal, can you pass it? I'd rather not have an exception on this one.",
          "",
          "Thanks,",
          "{{po_owner}}",
          "Purchasing Manager, Arbor Health Supply",
        ].join("\n"),
        arriveAtMinute: 0,
        stepId: "verbal",
      },
      {
        id: "m3",
        from: "Jordan Ellis, Senior Manager, Kestrel Advisory",
        subject: "P2P-02 exceptions?",
        body: [
          "Quick one for the status update: how many exceptions out of the 8, and what's the total value of those POs?",
          "",
          "The sample, for reference:",
          "{{sample_list}}",
          "",
          "Jordan",
        ].join("\n"),
        arriveAtMinute: 0,
        stepId: "exception-count",
      },
      {
        id: "m4",
        from: "IT Service Desk, Arbor Health Supply",
        subject: "ERP active user list",
        body: [
          "Hi,",
          "",
          "Attached is the list of active ERP users Jordan asked for, run {{report_date}}. HR's leavers since July 1 are at the top.",
          "",
          "{{it_name}}",
          "IT Service Desk",
        ].join("\n"),
        arriveAtMinute: 0,
        stepId: "user-list",
      },
      {
        id: "m5",
        from: "Jordan Ellis, Senior Manager, Kestrel Advisory",
        subject: "P2P walkthrough",
        body: [
          "My notes from the walkthrough with {{po_owner}} got shuffled. Can you put the steps back in order, with the three key controls where they sit?",
          "",
          "Jordan",
        ].join("\n"),
        arriveAtMinute: 0,
        stepId: "walkthrough",
      },
      {
        id: "m6",
        from: "Jordan Ellis, Senior Manager, Kestrel Advisory",
        subject: "Write-up: {{term_name}}'s ERP access",
        body: [
          "The user list is a finding for the client. Here's what we have: {{term_name}} ({{term_id}}, {{term_dept}}) left on {{term_left}}. The account was still active on IT's list run {{report_date}}, with the {{term_role}} role, and last logged in on {{term_login}}.",
          "",
          "Can you draft the write-up? Condition, criteria, risk and recommendation, under 150 words. I'll review it before it goes to the client.",
          "",
          "Jordan",
        ].join("\n"),
        arriveAtMinute: 0,
        stepId: "writeup",
      },
    ],
    sections: [
      { id: "s-rapid-a", title: "Rapid round: control pass or fail", minutes: 6, stepIds: ["rapid-controls"] },
      { id: "s-test", title: "P2P-02 test of operating effectiveness", minutes: 12, stepIds: ["test-1", "test-2", "test-3", "test-4", "conclusion"], oneAtATime: true },
      { id: "s-rapid-b", title: "Rapid round: access conflicts", minutes: 6, stepIds: ["rapid-sod"] },
      { id: "s-inbox", title: "Inbox", minutes: 10, stepIds: ["verbal", "exception-count", "exception-value", "user-list"], oneAtATime: true },
      { id: "s-rapid-c", title: "Rapid round: design or operating?", minutes: 6, stepIds: ["rapid-findings"] },
      { id: "s-final", title: "Walkthrough and write-up", minutes: 12, stepIds: ["walkthrough", "writeup"] },
    ],
  },

  build(rng) {
    const v: Record<string, string | number> = {};
    // People: distinct first and last names, so a name never repeats by chance.
    const firsts = rng.shuffle(FIRST);
    const lasts = rng.shuffle(LAST);
    const people = firsts.map((f, i) => `${f} ${lasts[i]}`);
    const take = (n: number) => people.splice(0, n);
    const directors = take(3).map((name, i) => ({ name, title: DIRECTOR_TITLES[i] }));
    const managers = take(3).map((name, i) => ({ name, title: MANAGER_TITLES[i] }));
    const buyers = take(3);
    const [controller, apManager, itManager, itName, walkRequester] = take(5);
    const poOwner = managers[0].name; // the Purchasing Manager owns P2P-02
    Object.assign(v, {
      po_owner: poOwner,
      controller,
      ap_manager: apManager,
      it_manager: itManager,
      it_name: itName,
      walk_requester: walkRequester,
      walk_dept: rng.pick(["Pharmacy Services", "Logistics", "Customer Service", "Sales"]),
    });

    // ---- Work task: the sample of 8 ----
    const kinds: PoKind[] = Array(SAMPLE_SIZE).fill("pass");
    const verbalScreen = rng.int(0, 3);
    const extra = rng.pick([0, 0, 1, 1, 2]);
    const others = rng.shuffle([0, 1, 2, 3].filter((s) => s !== verbalScreen)).slice(0, extra);
    const exceptionAt: Record<number, number> = {};
    for (const s of [verbalScreen, ...others]) {
      const n = 2 * s + rng.int(0, 1);
      kinds[n] = s === verbalScreen ? "no_approval" : rng.pick(["not_director", "after_order"] as const);
      exceptionAt[s] = n;
    }
    const vendors = rng.shuffle(VENDORS);
    const poNumbers = new Set<number>();
    while (poNumbers.size < SAMPLE_SIZE) poNumbers.add(rng.int(40_000, 47_999));
    const pos = [...poNumbers];
    const sample = kinds.map((kind, i) => {
      const order = rng.int(184, 270);
      const amount = rng.cents(10_250, 96_000);
      const requester = rng.pick(buyers);
      let approver = "None recorded";
      let title = "None";
      let approvedOn = "None";
      if (kind === "pass" || kind === "after_order") {
        const d = rng.pick(directors);
        [approver, title] = [d.name, d.title];
        approvedOn = day(kind === "pass" ? order - rng.int(0, 5) : order + rng.int(1, 8));
      } else if (kind === "not_director") {
        const m = rng.pick(managers);
        [approver, title] = [m.name, m.title];
        approvedOn = day(order - rng.int(0, 5));
      }
      const n = i + 1;
      Object.assign(v, {
        [`s${n}_po`]: String(pos[i]),
        [`s${n}_vendor`]: vendors[i],
        [`s${n}_amt`]: amount,
        [`s${n}_req`]: requester,
        [`s${n}_order`]: day(order),
        [`s${n}_appr`]: approver,
        [`s${n}_title`]: title,
        [`s${n}_appr_on`]: approvedOn,
      });
      return { n, kind, po: String(pos[i]), vendor: vendors[i], amount, approver, approvedOn, order: day(order) };
    });
    const exceptions = sample.filter((p) => p.kind !== "pass");
    const exceptionValue = exceptions.reduce((t, p) => t + p.amount, 0);
    const verbal = sample.find((p) => p.kind === "no_approval")!;
    const verbalDirector = rng.pick(directors);
    v.sample_list = sample.map((p) => `• PO ${p.po} · ${p.vendor} · ${formatCents(p.amount)}`).join("\n");
    Object.assign(v, { verbal_po: verbal.po, verbal_vendor: verbal.vendor, verbal_amt: verbal.amount, verbal_director: verbalDirector.name });

    // ---- User list: one leaver still active, one properly removed, a lookalike name ----
    const reportDoy = rng.int(272, 280);
    const termLeft = reportDoy - rng.int(14, 40);
    const termLogin = termLeft + rng.int(2, 9);
    const goneLeft = reportDoy - rng.int(10, 60);
    const [termName, goneName] = take(2);
    const listNames = take(6);
    // Shares the removed leaver's last name (and never their initial, so the user IDs differ).
    const [goneFirst, goneLast] = goneName.split(" ");
    const lookalike = `${rng.pick(FIRST.filter((f) => f[0] !== goneFirst[0] && f !== termName.split(" ")[0]))} ${goneLast}`;
    const users = rng.shuffle([termName, lookalike, ...listNames.slice(0, 6)]);
    const roles = rng.shuffle(ERP_ROLES);
    const termRole = rng.pick(["AP invoice approver", "Payment approver", "Buyer"]);
    const userRows = users.map((name, i) => {
      const isTerm = name === termName;
      const role = isTerm ? termRole : roles.filter((r) => r !== termRole)[i % (ERP_ROLES.length - 1)];
      const row = {
        id: loginId(name),
        name,
        dept: isTerm ? (termRole === "Buyer" ? "Purchasing" : "Accounts Payable") : rng.pick(DEPARTMENTS),
        role,
        status: "Active",
        login: day(isTerm ? termLogin : reportDoy - rng.int(0, 6)),
      };
      Object.entries(row).forEach(([k, val]) => (v[`u${i + 1}_${k}`] = val));
      return row;
    });
    const termRow = userRows.findIndex((r) => r.name === termName);
    const leavers = rng.shuffle([
      [termName, termLeft],
      [goneName, goneLeft],
    ] as [string, number][]);
    Object.assign(v, {
      report_date: day(reportDoy),
      leavers: leavers.map(([n, d]) => `${n} (left ${day(d)})`).join("; "),
      term_name: termName,
      term_id: userRows[termRow].id,
      term_dept: userRows[termRow].dept,
      term_role: termRole,
      term_left: day(termLeft),
      term_login: day(termLogin),
    });

    // ---- Walkthrough: shown in a seeded order, never the right one ----
    let perm = rng.shuffle(WALK_STEPS.map((_, i) => i));
    while (perm.every((x, i) => x === i)) perm = rng.shuffle(perm);
    WALK_IDS.forEach((id, slot) => (v[`wt_${id}`] = WALK_STEPS[perm[slot]].replace(/\{\{(\w+)\}\}/g, (_, k: string) => String(v[k]))));
    const walkOrder = WALK_STEPS.map((_, step) => WALK_IDS[perm.indexOf(step)]);

    // ---- Rapid rounds, drawn after everything above so the rest of the material is unchanged per seed ----
    const anyName = () => `${rng.pick(FIRST)} ${rng.pick(LAST)}`;
    const twoNames = () => {
      const a = anyName();
      let b = anyName();
      while (b === a) b = anyName();
      return [a, b];
    };
    const fdContext: FdContext = {
      name: anyName,
      vendor: () => rng.pick(VENDORS),
      date: () => day(rng.int(185, 270)),
      month: () => rng.pick(MONTH_NAMES.slice(6, 9)),
    };

    const ctKey: RapidKeyItems = {};
    fillSlots(rng.shuffle(CT_EASY), rng.shuffle(CT_HARD)).forEach((c, i) => {
      const n = slotNo(i);
      const [a, b] = twoNames();
      const self = c.endsWith("_self");
      let rows: [string, string][];
      let title: string;
      let control: string;
      if (c.startsWith("po_")) {
        title = "PO approval screenshot";
        control = "Control: POs are approved in the ERP by someone other than the requester, within the approver's limit, before payment.";
        const limit = rng.pick([10_000, 25_000, 50_000, 100_000]) * 100;
        const amount =
          c === "po_over"
            ? Math.round((limit * rng.int(130, 250)) / 100) + rng.int(0, 99)
            : c === "po_near"
              ? limit - rng.int(100, 1_499) * 100 - rng.int(1, 99)
              : rng.int(Math.round(limit / 500), Math.round((limit * 0.6) / 100)) * 100 + rng.int(0, 99);
        const approved = rng.int(185, 260);
        const paid = c === "po_after" ? approved - rng.int(2, 10) : approved + rng.int(3, 20);
        rows = [
          ["PO", `${rng.int(40_000, 49_999)} · ${rng.pick(VENDORS)}`],
          ["Amount", formatCents(amount)],
          ["Requested by", a],
          ["Approved by", `${self ? a : b} (limit ${formatCents(limit)})`],
          ["Approved on", day(approved)],
          ["Paid on", day(paid)],
        ];
      } else if (c.startsWith("vendor_")) {
        title = "Vendor change log";
        control = "Control: changes to vendor bank details are approved by a second person before the next payment.";
        const approved = rng.int(185, 260);
        const paid = c === "vendor_after" ? approved - rng.int(2, 10) : approved + rng.int(2, 15);
        rows = [
          ["Vendor", rng.pick(VENDORS)],
          ["Change", `Bank account changed to one ending ${rng.int(1000, 9999)}`],
          ["Entered by", a],
          ["Approved by", self ? a : b],
          ["Approved on", day(approved)],
          ["First payment to the new account", day(paid)],
        ];
      } else {
        title = "Bank rec sign-off";
        control = "Control: each month's bank rec is reviewed and signed off by someone other than the preparer by the review due date.";
        const m = rng.int(6, 8);
        const due = monthStart(m + 1) + rng.int(9, 14);
        const reviewed =
          c === "rec_late" ? due + rng.int(2, 12) : c === "rec_near" ? due : due - rng.int(1, 6);
        const missing = c === "rec_missing";
        rows = [
          ["Account", `Operating account ending ${rng.int(1000, 9999)}`],
          ["Month", MONTH_NAMES[m]],
          ["Prepared by", a],
          ["Reviewed by", missing ? "Not signed" : self ? a : b],
          ["Review due", day(due)],
          ["Reviewed on", missing ? "None" : day(reviewed)],
        ];
      }
      v[`ct_${n}_title`] = title;
      v[`ct_${n}_control`] = control;
      rows.forEach(([l, val], j) => {
        v[`ct_${n}_l${j + 1}`] = l;
        v[`ct_${n}_v${j + 1}`] = val;
      });
      const reason = CT_REASON[c];
      ctKey[`ct-${n}`] = { result: { choice: reason === "none" ? "effective" : "deficiency" }, reason: { choice: reason } };
    });

    const sdKey: RapidKeyItems = {};
    const sdNames = new Set<string>();
    fillSlots(rng.shuffle(SD_EASY), rng.shuffle(SD_HARD)).forEach((c, i) => {
      const n = slotNo(i);
      const one = (p: Pair) => rng.pick(SENSITIVE[p]);
      let sensitive: [string, string][];
      let answer: string;
      if (c === "none_harmless") [sensitive, answer] = [[], "none"];
      else if (c === "none_single") [sensitive, answer] = [[one(rng.pick(PAIRS))], "none"];
      else if (c === "none_three") [sensitive, answer] = [PAIRS.map(one), "none"];
      else {
        const pair = c.replace(/_plus$/, "") as Pair;
        sensitive = [...SENSITIVE[pair]];
        if (c.endsWith("_plus")) sensitive.push(one(rng.pick(PAIRS.filter((p) => p !== pair))));
        answer = pair;
      }
      const roles = rng.shuffle([...sensitive, ...rng.shuffle(HARMLESS).slice(0, SD_ROLES - sensitive.length)]);
      let name = anyName();
      while (sdNames.has(name)) name = anyName();
      sdNames.add(name);
      Object.assign(v, {
        [`sd_${n}_id`]: loginId(name),
        [`sd_${n}_name`]: name,
        [`sd_${n}_dept`]: rng.pick(DEPARTMENTS),
        ...Object.fromEntries(roles.flatMap(([code, what], j) => [[`sd_${n}_r${j + 1}`, code], [`sd_${n}_d${j + 1}`, what]])),
      });
      sdKey[`sd-${n}`] = { conflict: { choice: answer } };
    });

    const fdKey: RapidKeyItems = {};
    fillSlots(rng.shuffle(FD_EASY).slice(0, 10), rng.shuffle(FD_HARD).slice(0, 5)).forEach(([answer, text], i) => {
      const n = slotNo(i);
      v[`fd_${n}`] = text(rng, fdContext);
      fdKey[`fd-${n}`] = { kind: { choice: answer } };
    });

    // ---- Keys ----
    const d = (cents: number) => cents / 100;
    const sampleKey = (s: number) => {
      const n = exceptionAt[s];
      if (n === undefined) return { findings: {}, clean: true };
      const p = sample[n];
      const why = {
        no_approval: "no approval on record in the ERP",
        not_director: `approved by ${p.approver}, who isn't a director`,
        after_order: `approved on ${p.approvedOn}, after the ${p.order} order date`,
      }[p.kind as Exclude<PoKind, "pass">];
      return { findings: { exception: { targets: [`p${(n % 2) + 1}`], reasons: [p.kind], note: `Sample item ${p.n}, PO ${p.po}: ${why}.` } } };
    };

    return {
      values: v,
      keys: {
        "rapid-controls": { items: ctKey },
        "rapid-sod": { items: sdKey },
        "rapid-findings": { items: fdKey },
        ...Object.fromEntries([0, 1, 2, 3].map((s) => [`test-${s + 1}`, sampleKey(s)])),
        conclusion: { correct: [exceptions.length <= THRESHOLD ? "effective" : "deficiency"] },
        verbal: { correct: ["exception"] },
        "exception-count": { value: exceptions.length, tolerance: 0 },
        "exception-value": { value: d(exceptionValue), tolerance: 0.005 },
        "user-list": {
          findings: {
            terminated: {
              targets: [`u${termRow + 1}`],
              reasons: ["terminated"],
              note: `${termName} left on ${day(termLeft)} and logged in on ${day(termLogin)}, still active.`,
            },
          },
          decision: ["disable"],
        },
        walkthrough: { order: walkOrder },
        writeup: {
          notes: {
            condition: `${termName} (${userRows[termRow].id}) left ${day(termLeft)}; still active on ${day(reportDoy)} as ${termRole}; last login ${day(termLogin)}.`,
            recommendation: `Disable ${userRows[termRow].id} and review its activity from ${day(termLeft)} to ${day(reportDoy)}.`,
          },
        },
      },
    };
  },
});
