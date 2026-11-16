import "server-only";

import type { Rng } from "../server/rng";
import { defineScenario } from "../server/scenario";
import { formatCents } from "../server/template";
import { DOCUMENT_REVIEW } from "../step-types/document_review/public";
import { INBOX_REPLY } from "../step-types/inbox_reply/public";
import { JOURNAL_ENTRY } from "../step-types/journal_entry/public";
import { NUMERIC } from "../step-types/numeric/public";
import { SPREADSHEET } from "../step-types/spreadsheet/public";

/**
 * docs/07 Example 5: corporate AP intern at Ridgeway Outdoor Supply, payment
 * run day. PHASE A: the parts built from existing step types, 70 points:
 * three-way match 25, inbox under pressure 15, vendor statement rec 30. The
 * three rapid rounds (30 points) come in phase B, once the sections engine
 * and the rapid_round step type have merged.
 *
 * Seeded per candidate: every amount, quantity, vendor and contact name,
 * domain, phone number, invoice / PO / receiving number and date, and which of
 * the four match documents holds which trap (short shipment, price above PO,
 * invoice already paid, clean match). The keys are built from the same values
 * as the material, so the statement rec always ties.
 *
 * Shaped by the current step types (draft: needs accountant review):
 * - `document_review` needs at least one finding per document, so the clean
 *   match is answered by flagging its "Three-way match" row with "All three
 *   agree". Pay / Hold is the decision.
 * - Posting a held invoice too isn't penalised by `journal_entry` (extra
 *   entries score 0 and are listed for the reviewer).
 * - Both written replies need a reviewer, so a perfect phase-A attempt shows
 *   55 automatic points until they are marked.
 */

const ACCOUNTS = [
  { code: "1010", name: "Cash" },
  { code: "1300", name: "Merchandise Inventory" },
  { code: "1400", name: "Prepaid Expenses" },
  { code: "2000", name: "Accounts Payable" },
  { code: "2100", name: "Accrued Liabilities" },
  { code: "5000", name: "Cost of Goods Sold" },
  { code: "6100", name: "Store Supplies Expense" },
  { code: "6400", name: "Utilities Expense" },
  { code: "6600", name: "Repairs and Maintenance" },
];

const VENDORS = [
  { name: "Cascade Trail Gear", domain: "cascadetrailgear.com" },
  { name: "Summit Ridge Apparel", domain: "summitridgeapparel.com" },
  { name: "Pinecrest Camp Co.", domain: "pinecrestcamp.com" },
  { name: "Northfork Paddle Works", domain: "northforkpaddle.com" },
  { name: "Bluewater Optics", domain: "bluewateroptics.com" },
  { name: "Granite Peak Footwear", domain: "granitepeakfootwear.com" },
  { name: "Timberline Packs", domain: "timberlinepacks.com" },
  { name: "Redrock Climbing Co.", domain: "redrockclimbing.com" },
  { name: "Lakeshore Lantern Co.", domain: "lakeshorelantern.com" },
  { name: "High Desert Hydration", domain: "highdeserthydration.com" },
];

/** Bills Priya approved yesterday: services, not merchandise. */
const SERVICE_VENDORS = [
  "Columbia Basin Freight",
  "Rose Valley Waste & Recycling",
  "Willamette Electric",
  "Evergreen Facility Services",
  "Pacific Signworks",
  "Northwest Shelving Systems",
];

const CONTACTS = ["Dana Whitfield", "Marco Reyes", "Jen Okafor", "Luis Ortega", "Hannah Berg", "Tom Albright", "Grace Lindqvist", "Omar Haddad"];

/** Merchandise for resale: [description, unit cost range in dollars, PO quantity range]. */
const MERCH: [string, [number, number], [number, number]][] = [
  ["Trail running socks, 3-pack", [8, 14], [24, 72]],
  ["Insulated water bottle, 32 oz", [11, 19], [24, 60]],
  ["Headlamp, 350 lumen", [14, 26], [12, 48]],
  ["Enamel camp mug", [5, 9], [24, 72]],
  ["Rain shell jacket", [38, 64], [6, 24]],
  ["Daypack, 22 L", [26, 44], [8, 30]],
  ["Trekking poles, pair", [22, 39], [8, 30]],
  ["Merino beanie", [9, 16], [24, 60]],
  ["Squeeze water filter", [18, 29], [12, 40]],
  ["Folding camp chair", [21, 35], [8, 30]],
  ["Fleece pullover", [24, 40], [10, 36]],
  ["Dry bag, 20 L", [10, 17], [20, 60]],
];

/** Items the store uses itself (expense, not inventory). */
const SUPPLIES: [string, [number, number], [number, number]][] = [
  ["Paper shopping bags, case of 250 (store use)", [38, 62], [2, 8]],
  ["Receipt paper rolls, case of 50 (store use)", [41, 58], [2, 6]],
  ["Price tag labels, box (store use)", [18, 29], [3, 10]],
  ["Slatwall hooks, pack of 100 (store use)", [24, 39], [2, 8]],
  ["Clothes hangers, box of 100 (store use)", [22, 35], [2, 8]],
];

const LOOKALIKE_SUFFIXES = ["-billing.com", "-remit.com", ".co", "-payments.com", "-ar.net"];

const MATCH_COLUMNS = ["Item", "PO qty", "PO unit price", "Received qty", "Invoiced qty", "Invoice unit price", "Invoice amount"];

type Trap = "short" | "price" | "duplicate" | "clean";

/** One three-way match step. Identical shape for all four; the key says where the problem is. */
function matchStep(k: number) {
  const p = `d${k}`;
  return {
    id: `match-${k}`,
    type: DOCUMENT_REVIEW,
    title: `Three-way match: {{${p}_vendor}}`,
    config: {
      prompt: [
        "Compare the purchase order, the receiving report and the invoice.",
        "Flag the item that breaks the match and choose the reason. If all three agree and the invoice hasn't been paid before, flag the Three-way match row with \"All three agree\" instead.",
        "Then choose Pay or Hold.",
      ].join("\n"),
      document: {
        title: `{{${p}_vendor}} · PO, receiving report and invoice`,
        fields: [
          { id: "vendor", label: "Vendor", value: `{{${p}_vendor}}` },
          { id: "po", label: "Purchase order", value: `PO {{${p}_po}} · {{${p}_po_date}}` },
          { id: "receiving", label: "Receiving report", value: `RR {{${p}_rr}} · {{${p}_rr_date}} · received at the Ridgeway warehouse` },
          { id: "invoice_no", label: "Invoice #", value: `{{${p}_inv}}` },
          { id: "invoice_date", label: "Invoice date", value: `{{${p}_inv_date}}` },
          { id: "terms", label: "Terms", value: "Net 30" },
          { id: "prior", label: "Last payment to this vendor", value: `Invoice {{${p}_prior_inv}} · {{${p}_prior_amt|money}} · paid Oct 15 by ACH` },
          { id: "match", label: "Three-way match", value: "PO ↔ receiving report ↔ invoice" },
        ],
        columns: MATCH_COLUMNS,
        rows: [1, 2, 3].map((j) => {
          const l = `${p}_l${j}`;
          return {
            id: `l${j}`,
            cells: [`{{${l}_desc}}`, `{{${l}_po_qty}}`, `{{${l}_po_price|money}}`, `{{${l}_recv}}`, `{{${l}_inv_qty}}`, `{{${l}_inv_price|money}}`, `{{${l}_amt|money}}`],
          };
        }),
        totals: [{ id: "total", label: "Invoice total", value: `{{${p}_total|money}}` }],
      },
      reasons: [
        { id: "qty", label: "Billed for more than we received" },
        { id: "price", label: "Price is higher than the PO" },
        { id: "duplicate", label: "Duplicate: already paid" },
        { id: "math", label: "Amount doesn't equal qty × price" },
        { id: "support", label: "Missing PO or receiving report" },
        { id: "agrees", label: "All three agree" },
        { id: "other", label: "Other" },
      ],
      findings: [{ id: "result", label: "Three-way match result", points: 3 }],
      falseFlagPenalty: 1,
      decision: {
        prompt: "Pay this invoice in today's run, or hold it?",
        options: [
          { id: "pay", label: "Pay in today's run" },
          { id: "hold", label: "Hold: don't pay today" },
        ],
        points: 2,
      },
    },
  };
}

const money = (name: string) => ({ text: `{{${name}|money}}`, align: "right" as const });
const bold = (text: string) => ({ text, bold: true });
const blankRow = [null, null, null, null, null, null];
const section = (title: string) => [bold(title), null, null, null, null, null];
const recRow = (label: string | { text: string; bold: boolean }, cell: unknown) => [label, null, null, null, null, cell];
const input = (id: string, label: string, points?: number) => ({ input: id, label, ...(points ? { points } : {}) });

/** A ledger line: `up` raises what we owe, `down` lowers it (cents value names). */
type LedgerRow = { date: string; ref: string; desc: string; up?: string; down?: string };

const STATEMENT_ROWS: LedgerRow[] = [
  { date: "11/03", ref: "{{st_i1_no}}", desc: "Invoice", up: "st_i1" },
  { date: "11/04", ref: "PMT", desc: "Payment received, thank you", down: "st_p1" },
  { date: "11/05", ref: "{{st_i2_no}}", desc: "Invoice", up: "st_i2" },
  { date: "11/07", ref: "{{st_cm_no}}", desc: "Credit memo: returned goods", down: "st_cm" },
  { date: "11/10", ref: "{{st_i3_no}}", desc: "Invoice", up: "st_i3" },
  { date: "11/11", ref: "{{st_i4_no}}", desc: "Invoice", up: "st_i4" },
];

const SUBLEDGER_ROWS: LedgerRow[] = [
  { date: "11/03", ref: "{{st_i1_no}}", desc: "Invoice", up: "st_i1" },
  { date: "11/03", ref: "ACH", desc: "ACH payment", down: "st_p1" },
  { date: "11/05", ref: "{{st_i2_no}}", desc: "Invoice", up: "st_i2_keyed" },
  { date: "11/10", ref: "{{st_i3_no}}", desc: "Invoice", up: "st_i3" },
  { date: "11/13", ref: "ACH", desc: "ACH payment", down: "st_p2" },
];

function ledgerRows(rows: LedgerRow[], prefix: string) {
  return rows.map((r, i) => [r.date, r.ref, r.desc, r.up ? money(r.up) : null, r.down ? money(r.down) : null, money(`${prefix}_bal_${i + 1}`)]);
}

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter((w) => /^[A-Z]/.test(w))
    .map((w) => w[0])
    .join("")
    .slice(0, 3);

const phone = (rng: Rng, area: number) => `(${area}) 555-01${String(rng.int(0, 99)).padStart(2, "0")}`;

export const corporateApRidgeway = defineScenario({
  slug: "corporate-ap-ridgeway",
  version: 1,
  title: "Ridgeway Outdoor Supply: AP payment run",
  roleFamily: "accounting",
  timeLimitMinutes: 50,
  definition: {
    intro:
      "You're an accounts payable intern in the in-house finance team at Ridgeway Outdoor Supply, an outdoor gear retailer. Your manager is Priya Desai, the AP lead. Today is the mid-month payment run: invoices, vendor emails and a vendor statement will reach your inbox over the next 50 minutes.",
    steps: [
      matchStep(1),
      matchStep(2),
      matchStep(3),
      matchStep(4),
      {
        id: "post-bills",
        type: JOURNAL_ENTRY,
        title: "Post approved invoices to AP",
        config: {
          prompt: [
            "Post each invoice you approved for payment to accounts payable. Don't post invoices you put on hold.",
            "One entry per invoice, with one debit line per account (total the lines that go to the same account): merchandise for resale goes to inventory, items the store uses itself to store supplies. Credit Accounts Payable.",
          ].join("\n"),
          accounts: ACCOUNTS,
          maxEntries: 6,
          maxLines: 6,
          expected: [{ id: "approved", label: "Approved invoice posted to AP", points: 5 }],
        },
      },
      {
        id: "vendor-reply",
        type: INBOX_REPLY,
        title: "Reply to {{short_vendor}}",
        config: {
          prompt: "Reply to the vendor about their invoice.",
          to: "{{short_contact}}, {{short_vendor}}",
          subject: "RE: Invoice {{short_inv}}: in today's payment run?",
          maxChars: 2_000,
          criteria: [
            {
              id: "facts",
              label: "Explains why the invoice is held, with the facts",
              maxPoints: 2,
              guidance:
                "Says invoice {{short_inv}} is on hold and not in today's run because our receiving report shows fewer {{short_item}} received ({{short_recv}}) than billed ({{short_billed}}).",
            },
            {
              id: "next",
              label: "Asks for what would release the payment",
              maxPoints: 2,
              guidance:
                "Asks for a corrected invoice or a credit memo for the units not received (or for the balance to be shipped and billed then), and says the invoice will be paid once it matches.",
            },
            {
              id: "tone",
              label: "Courteous to the vendor, no promises it can't keep",
              maxPoints: 1,
              guidance: "Polite and short; doesn't promise a payment date before the invoice is fixed; shares nothing internal the vendor doesn't need.",
            },
          ],
        },
      },
      {
        id: "run-total",
        type: NUMERIC,
        title: "Total for today's run",
        config: {
          prompt: "Priya: total approved for today's payment run? Number only.",
          unit: "USD",
          decimals: 2,
          points: 4,
        },
      },
      {
        id: "bank-change",
        type: DOCUMENT_REVIEW,
        title: "Request to change a vendor's bank details",
        config: {
          prompt: [
            "Read this email against the vendor master record.",
            "Flag each warning sign with a reason, then decide what to do.",
          ].join("\n"),
          document: {
            title: "Email to the AP inbox · Updated remittance details",
            fields: [
              { id: "from", label: "From", value: "{{clean_vendor}} Accounts Receivable <ar@{{phish_domain}}>" },
              { id: "sent", label: "Received", value: "Today, 10:52 AM" },
              { id: "subject", label: "Subject", value: "Updated remittance details" },
              { id: "on_file_email", label: "Vendor master: email on file", value: "ar@{{clean_domain}}" },
              { id: "on_file_phone", label: "Vendor master: phone on file", value: "{{clean_phone}}" },
            ],
            columns: ["Email text"],
            rows: [
              { id: "b1", cells: ["Hello Ridgeway Accounts Payable team,"] },
              {
                id: "b2",
                cells: [
                  "We have moved our banking to Harborview National Bank. Please update our remittance details to the new account ending {{phish_acct}} before today's payment run.",
                ],
              },
              {
                id: "b3",
                cells: [
                  "Our old account closes this week, so payment of invoice {{clean_inv}} ({{clean_total|money}}) must go to the new account or it will be returned.",
                ],
              },
              { id: "b4", cells: ["If you have any questions, call our billing line at {{phish_phone}}."] },
              { id: "b5", cells: ["Thank you, {{phish_sender}}, Accounts Receivable, {{clean_vendor}}"] },
            ],
            totals: [],
          },
          reasons: [
            { id: "domain", label: "Sender's domain doesn't match the vendor on file" },
            { id: "bank", label: "Bank details change not verified" },
            { id: "urgency", label: "Pressure to act fast" },
            { id: "contact", label: "Contact details not on file" },
            { id: "other", label: "Other" },
          ],
          findings: [
            { id: "domain", label: "Lookalike sender domain", points: 1.5 },
            { id: "bank", label: "Unverified bank details change", points: 1.5 },
            { id: "pressure", label: "Pressure or new contact details", points: 1 },
          ],
          falseFlagPenalty: 0.5,
          decision: {
            prompt: "What do you do?",
            options: [
              { id: "update", label: "Update the bank details in the vendor master so today's payment goes to the new account" },
              { id: "reply", label: "Reply to the email and ask them to confirm the change in writing" },
              { id: "call_new", label: "Call the billing line in the email to confirm, then update" },
              { id: "verify", label: "Change nothing; call the vendor on the phone number on file to check, and tell Priya" },
            ],
            points: 2,
          },
        },
      },
      {
        id: "statement-rec",
        type: SPREADSHEET,
        title: "{{st_vendor}} statement reconciliation",
        config: {
          prompt: [
            "The vendor's statement and our AP subledger for them are at the top. Reconcile them in the yellow cells at the bottom.",
            "Enter amounts as positive numbers in Add and Less rows. In Add / (less) rows, enter a reduction as a negative, e.g. (125.00).",
            "Leave a row blank if nothing belongs in it.",
          ].join("\n"),
          columns: ["A", "B", "C", "D", "E", "F"],
          rows: [
            section("Vendor statement · {{st_vendor}} · account Ridgeway Outdoor Supply · as of Nov 12"),
            [bold("Date"), bold("Ref"), bold("Description"), bold("Charges"), bold("Payments & credits"), bold("Balance")],
            ["10/31", "", "Balance forward", null, null, money("stmt_bal_0")],
            ...ledgerRows(STATEMENT_ROWS, "stmt"),
            blankRow,
            section("AP subledger · {{st_vendor}} · Ridgeway Outdoor Supply"),
            [bold("Date"), bold("Ref"), bold("Description"), bold("Invoices"), bold("Payments"), bold("Balance")],
            ["10/31", "", "Opening balance", null, null, money("ap_bal_0")],
            ...ledgerRows(SUBLEDGER_ROWS, "ap"),
            blankRow,
            section("Vendor statement reconciliation · {{st_vendor}}"),
            recRow(bold("Vendor side"), null),
            recRow("Balance per vendor statement, Nov 12", money("st_end")),
            recRow("Less: payments we sent that aren't on the statement", input("in_transit", "Payment in transit", 4)),
            recRow(bold("Adjusted vendor balance"), input("adj_vendor", "Adjusted vendor balance", 2)),
            recRow(bold("Our side"), null),
            recRow("Balance per AP subledger, today", money("ap_end")),
            recRow("Add: invoices on the statement not in our books", input("unrecorded", "Invoice we never received", 4)),
            recRow("Less: credits on the statement not in our books", input("credit_memo", "Credit memo not booked", 4)),
            recRow("Add / (less): amounts keyed wrong in our books", input("keying", "Invoice keyed at the wrong amount", 4)),
            recRow(bold("Adjusted AP balance"), input("adj_ap", "Adjusted AP balance", 2)),
            recRow("Difference (should be zero)", input("diff", "Difference")),
          ],
        },
      },
      {
        id: "statement-reply",
        type: INBOX_REPLY,
        title: "Note to Priya: {{st_vendor}} statement",
        config: {
          prompt: "Reply to Priya with the balance we owe, what to ask the vendor for, and the entry we need. Under about 120 words.",
          to: "Priya Desai, AP Lead",
          subject: "RE: {{st_vendor}} statement",
          maxChars: 2_000,
          criteria: [
            {
              id: "balance",
              label: "States the reconciled balance owed",
              maxPoints: 3,
              guidance:
                "Gives the balance we owe {{st_vendor}} once the reconciling items are cleared, and says the difference is explained (the payment sent on 11/13 is in transit).",
            },
            {
              id: "request",
              label: "Says what to request from the vendor",
              maxPoints: 3,
              guidance:
                "Asks {{st_vendor}} for a copy of invoice {{st_i4_no}}, which we never received (and checks the goods arrived before booking it), and a copy of credit memo {{st_cm_no}}.",
            },
            {
              id: "entries",
              label: "Names the entries needed",
              maxPoints: 2,
              guidance:
                "Book credit memo {{st_cm_no}} (Dr Accounts Payable / Cr Merchandise Inventory), correct invoice {{st_i2_no}} keyed at the wrong amount, and record invoice {{st_i4_no}} once received and approved. No entry for the payment in transit.",
            },
            {
              id: "brevity",
              label: "Brief and ready to forward",
              maxPoints: 2,
              guidance: "Under about 120 words, organized, professional; Priya could forward it as is.",
            },
          ],
        },
      },
    ],
    messages: [
      {
        id: "m1",
        from: "Priya Desai, AP Lead, Ridgeway Outdoor Supply",
        subject: "Payment run today: match queue",
        body: [
          "Hi {{first_name}},",
          "",
          "Mid-month payment run is today and it closes at 2 PM. Four invoices are waiting in the three-way match queue:",
          "• {{d1_vendor}}",
          "• {{d2_vendor}}",
          "• {{d3_vendor}}",
          "• {{d4_vendor}}",
          "",
          "Each one shows the purchase order, the receiving report and the invoice side by side. Our policy: we pay an invoice only when all three agree on quantity and price and we haven't paid it before. Any difference, however small, goes on hold with the reason, and I'll follow up with the vendor or the buyer.",
          "",
          "Once you've decided, post the invoices you approved to accounts payable.",
          "",
          "Two bills I approved yesterday are already posted and in today's run:",
          "• {{pre1_vendor}}: {{pre1|money}}",
          "• {{pre2_vendor}}: {{pre2|money}}",
          "",
          "Shout if anything looks odd.",
          "",
          "Priya",
        ].join("\n"),
        arriveAtMinute: 0,
        stepId: "match-1",
      },
      {
        id: "m2",
        from: "Vendor accounts receivable",
        subject: "Invoice {{short_inv}}: in today's payment run?",
        body: [
          "Hi Ridgeway AP,",
          "",
          "Checking on our invoice {{short_inv}} for {{short_total|money}}. Can you confirm it's going out in today's payment run? We have it due this week.",
          "",
          "Thanks,",
          "{{short_contact}}",
          "Accounts Receivable, {{short_vendor}}",
        ].join("\n"),
        arriveAtMinute: 15,
        stepId: "vendor-reply",
      },
      {
        id: "m3",
        from: "Priya Desai, AP Lead, Ridgeway Outdoor Supply",
        subject: "Fwd: Updated remittance details",
        body: [
          "This just landed in the AP inbox and I'm in a meeting. Can you deal with it? The email is attached to this task.",
          "",
          "Priya",
        ].join("\n"),
        arriveAtMinute: 22,
        stepId: "bank-change",
      },
      {
        id: "m4",
        from: "Priya Desai, AP Lead, Ridgeway Outdoor Supply",
        subject: "Run total?",
        body: ["Quick one for the treasury request: total approved for today's run? Number only.", "", "Priya"].join("\n"),
        arriveAtMinute: 28,
        stepId: "run-total",
      },
      {
        id: "m5",
        from: "Priya Desai, AP Lead, Ridgeway Outdoor Supply",
        subject: "{{st_vendor}} statement",
        body: [
          "{{st_vendor}} sent their statement as of Nov 12 and it doesn't agree with our AP subledger. The workbook has both. Can you reconcile them? I need to know what we actually owe them.",
          "",
          "Priya",
        ].join("\n"),
        arriveAtMinute: 32,
        stepId: "statement-rec",
      },
      {
        id: "m6",
        from: "Priya Desai, AP Lead, Ridgeway Outdoor Supply",
        subject: "RE: {{st_vendor}} statement",
        body: [
          "When the rec is done, send me a short note, under 120 words: the balance we owe, what we need to ask {{st_vendor}} for, and the entry we need to book. I'll forward it to the controller.",
          "",
          "Priya",
        ].join("\n"),
        arriveAtMinute: 33,
        stepId: "statement-reply",
      },
    ],
  },

  build(rng) {
    const v: Record<string, string | number> = {};
    const vendors = rng.shuffle(VENDORS).slice(0, 5);
    const contacts = rng.shuffle(CONTACTS);
    const merch = rng.shuffle(MERCH);
    const supplies = rng.shuffle(SUPPLIES);
    const traps = rng.shuffle<Trap>(["short", "price", "duplicate", "clean"]);
    const areas = rng.shuffle([503, 541, 360, 208, 425, 971]);

    // ---- Three-way match documents ----
    type Line = { desc: string; poQty: number; poPrice: number; recv: number; invQty: number; invPrice: number; amt: number; store: boolean };
    const docs = traps.map((trap, i) => {
      const k = i + 1;
      const vendor = vendors[i];
      const pick = (item: [string, [number, number], [number, number]], store: boolean): Line => {
        const qty = rng.int(item[2][0], item[2][1]);
        const price = rng.cents(item[1][0], item[1][1]);
        return { desc: item[0], poQty: qty, poPrice: price, recv: qty, invQty: qty, invPrice: price, amt: qty * price, store };
      };
      const lines = [pick(merch[2 * i], false), pick(merch[2 * i + 1], false), pick(supplies[i], true)];
      const bad = rng.int(0, 1); // the trap sits on one of the merchandise lines
      if (trap === "short") lines[bad].recv = lines[bad].poQty - rng.int(2, Math.min(6, lines[bad].poQty - 1));
      if (trap === "price") {
        const l = lines[bad];
        l.invPrice = Math.round((l.poPrice * (100 + rng.int(6, 15))) / 100);
        l.amt = l.invQty * l.invPrice;
      }
      const total = lines.reduce((s, l) => s + l.amt, 0);
      const invNum = rng.int(20_000, 69_999);
      const inv = `${initials(vendor.name)}-${invNum}`;
      const dup = trap === "duplicate";
      const rrDay = dup ? rng.int(1, 6) : rng.int(3, 7);
      const p = `d${k}`;
      Object.assign(v, {
        [`${p}_vendor`]: vendor.name,
        [`${p}_po`]: String(rng.int(4100, 4899)),
        [`${p}_po_date`]: dup ? `Sep ${rng.int(15, 28)}` : `Oct ${rng.int(14, 28)}`,
        [`${p}_rr`]: String(rng.int(8100, 8999)),
        [`${p}_rr_date`]: `${dup ? "Oct" : "Nov"} ${rrDay}`,
        [`${p}_inv`]: inv,
        [`${p}_inv_date`]: `${dup ? "Oct" : "Nov"} ${rrDay + rng.int(0, 3)}`,
        [`${p}_prior_inv`]: dup ? inv : `${initials(vendor.name)}-${invNum - rng.int(40, 400)}`,
        [`${p}_prior_amt`]: dup ? total : rng.cents(800, 5_000),
        [`${p}_total`]: total,
      });
      lines.forEach((l, j) => {
        const q = `${p}_l${j + 1}`;
        Object.assign(v, {
          [`${q}_desc`]: l.desc,
          [`${q}_po_qty`]: l.poQty,
          [`${q}_po_price`]: l.poPrice,
          [`${q}_recv`]: l.recv,
          [`${q}_inv_qty`]: l.invQty,
          [`${q}_inv_price`]: l.invPrice,
          [`${q}_amt`]: l.amt,
        });
      });
      return { k, trap, vendor, lines, bad, total, inv };
    });
    const byTrap = (t: Trap) => docs.find((d) => d.trap === t)!;
    const short = byTrap("short");
    const clean = byTrap("clean");

    const shortLine = short.lines[short.bad];
    Object.assign(v, {
      short_vendor: short.vendor.name,
      short_inv: short.inv,
      short_total: short.total,
      short_contact: contacts[0],
      short_item: shortLine.desc,
      short_recv: shortLine.recv,
      short_billed: shortLine.invQty,
    });

    // ---- Pre-approved bills and the run total ----
    const [pre1Vendor, pre2Vendor] = rng.shuffle(SERVICE_VENDORS);
    const pre1 = rng.cents(400, 3_500);
    const pre2 = rng.cents(400, 3_500);
    Object.assign(v, { pre1_vendor: pre1Vendor, pre1, pre2_vendor: pre2Vendor, pre2 });
    const runTotal = pre1 + pre2 + clean.total;

    // ---- Bank-change email from a lookalike of the clean vendor's domain ----
    const [stem, tld] = [clean.vendor.domain.replace(/\.com$/, ""), rng.pick(LOOKALIKE_SUFFIXES)];
    Object.assign(v, {
      clean_vendor: clean.vendor.name,
      clean_domain: clean.vendor.domain,
      clean_phone: phone(rng, areas[0]),
      clean_inv: clean.inv,
      clean_total: clean.total,
      phish_domain: `${stem}${tld}`,
      phish_phone: phone(rng, areas[1]),
      phish_acct: String(rng.int(1000, 9999)),
      phish_sender: contacts[1],
    });

    // ---- Vendor statement vs AP subledger (fifth vendor) ----
    const stVendor = vendors[4];
    const prefix = initials(stVendor.name);
    const firstNo = rng.int(30_000, 79_000);
    const open = rng.cents(2_500, 6_000);
    const st: Record<string, number> = {
      st_p1: open, // October's balance, paid Nov 3
      st_i1: rng.cents(1_200, 2_400),
      st_i3: rng.cents(900, 3_000),
      st_i4: rng.cents(600, 2_200),
      st_cm: rng.cents(120, 600),
    };
    st.st_p2 = st.st_i1; // invoice 1 paid Nov 13, after the statement date
    // Invoice 2 keyed with its hundreds and tens digits swapped. Either side can be larger.
    const thousands = rng.int(1, 3);
    const hi = rng.int(1, 9);
    const lo = rng.int(0, hi - 1);
    const unit = rng.int(0, 9);
    const centsPart = rng.int(0, 99);
    const big = (thousands * 1000 + hi * 100 + lo * 10 + unit) * 100 + centsPart;
    const small = (thousands * 1000 + lo * 100 + hi * 10 + unit) * 100 + centsPart;
    const overKeyed = rng.int(0, 1) === 1; // our books show more than the vendor billed
    st.st_i2 = overKeyed ? small : big;
    st.st_i2_keyed = overKeyed ? big : small;
    Object.assign(v, st, {
      st_vendor: stVendor.name,
      st_i1_no: `${prefix}-${firstNo}`,
      st_i2_no: `${prefix}-${firstNo + rng.int(3, 20)}`,
      st_i3_no: `${prefix}-${firstNo + rng.int(25, 60)}`,
      st_i4_no: `${prefix}-${firstNo + rng.int(65, 90)}`,
      st_cm_no: `CM-${rng.int(1100, 1999)}`,
    });
    const run = (rows: LedgerRow[], name: string) => {
      let bal = open;
      v[`${name}_bal_0`] = bal;
      rows.forEach((r, i) => {
        bal += (r.up ? st[r.up] : 0) - (r.down ? st[r.down] : 0);
        v[`${name}_bal_${i + 1}`] = bal;
      });
      return bal;
    };
    const stEnd = run(STATEMENT_ROWS, "stmt");
    const apEnd = run(SUBLEDGER_ROWS, "ap");
    v.st_end = stEnd;
    v.ap_end = apEnd;
    const keying = st.st_i2 - st.st_i2_keyed; // + adds to AP, − reduces it
    const adjVendor = stEnd - st.st_p2;
    const adjAp = apEnd + st.st_i4 - st.st_cm + keying;
    if (adjVendor !== adjAp) throw new Error("corporate-ap-ridgeway: statement reconciliation doesn't tie");

    // ---- Keys ----
    const d = (cents: number) => cents / 100;
    const matchKey = (doc: (typeof docs)[number]) => {
      const line = doc.lines[doc.bad];
      const finding = {
        short: {
          targets: [`l${doc.bad + 1}`, "total"],
          reasons: ["qty"],
          note: `${line.desc}: received ${line.recv} of ${line.poQty}, billed ${line.invQty} (${formatCents((line.invQty - line.recv) * line.invPrice)} not received).`,
        },
        price: {
          targets: [`l${doc.bad + 1}`, "total"],
          reasons: ["price"],
          note: `${line.desc}: billed at ${formatCents(line.invPrice)} a unit, PO price ${formatCents(line.poPrice)} (${formatCents((line.invPrice - line.poPrice) * line.invQty)} over the PO).`,
        },
        duplicate: {
          targets: ["invoice_no", "prior"],
          reasons: ["duplicate"],
          note: `Invoice ${doc.inv} for ${formatCents(doc.total)} was already paid on Oct 15.`,
        },
        clean: {
          targets: ["match"],
          reasons: ["agrees"],
          note: `PO, receiving report and invoice agree on every line; ${formatCents(doc.total)} is payable today.`,
        },
      }[doc.trap];
      return { findings: { result: finding }, decision: [doc.trap === "clean" ? "pay" : "hold"] };
    };
    const merchTotal = clean.lines.filter((l) => !l.store).reduce((s, l) => s + l.amt, 0);
    const suppliesTotal = clean.lines.filter((l) => l.store).reduce((s, l) => s + l.amt, 0);

    return {
      values: v,
      keys: {
        ...Object.fromEntries(docs.map((doc) => [`match-${doc.k}`, matchKey(doc)])),
        "post-bills": {
          entries: {
            approved: {
              lines: [
                { accounts: ["1300"], side: "debit" as const, amount: d(merchTotal) },
                { accounts: ["6100"], side: "debit" as const, amount: d(suppliesTotal) },
                { accounts: ["2000"], side: "credit" as const, amount: d(clean.total) },
              ],
            },
          },
        },
        "vendor-reply": {
          notes: {
            facts: `Invoice ${short.inv} (${formatCents(short.total)}) is on hold: ${shortLine.desc} billed ${shortLine.invQty}, received ${shortLine.recv}.`,
          },
        },
        "run-total": { value: d(runTotal), tolerance: 0.005 },
        "bank-change": {
          findings: {
            domain: { targets: ["from"], reasons: ["domain"], note: `Sent from ${v.phish_domain}; the vendor master has ${clean.vendor.domain}.` },
            bank: { targets: ["b2"], reasons: ["bank"], note: "Bank details change requested by email, unverified." },
            pressure: { targets: ["b3", "b4"], reasons: ["urgency", "contact"], note: `Deadline pressure and a new phone number (${v.phish_phone}) instead of ${v.clean_phone} on file.` },
          },
          decision: ["verify"],
        },
        "statement-rec": {
          tolerance: 0.005,
          cells: {
            in_transit: { value: d(st.st_p2) },
            adj_vendor: { value: d(adjVendor) },
            unrecorded: { value: d(st.st_i4) },
            credit_memo: { value: d(st.st_cm) },
            keying: { value: d(keying) },
            adj_ap: { value: d(adjAp) },
          },
        },
        "statement-reply": {
          notes: {
            balance: `We owe ${stVendor.name} ${formatCents(adjAp)}: statement ${formatCents(stEnd)} less the ${formatCents(st.st_p2)} payment sent 11/13 (in transit).`,
            request: `Ask for a copy of invoice ${v.st_i4_no} (${formatCents(st.st_i4)}, never received) and of credit memo ${v.st_cm_no} (${formatCents(st.st_cm)}).`,
            entries: `Invoice ${v.st_i2_no} was keyed at ${formatCents(st.st_i2_keyed)}; the vendor billed ${formatCents(st.st_i2)} (${keying > 0 ? "Dr Merchandise Inventory / Cr Accounts Payable" : "Dr Accounts Payable / Cr Merchandise Inventory"} ${formatCents(Math.abs(keying))}). Credit memo: Dr Accounts Payable / Cr Merchandise Inventory ${formatCents(st.st_cm)}. Missing invoice: Dr Merchandise Inventory / Cr Accounts Payable ${formatCents(st.st_i4)} once received and approved.`,
          },
        },
      },
    };
  },
});
