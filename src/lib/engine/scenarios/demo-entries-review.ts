import "server-only";

import { defineScenario } from "../server/scenario";
import { formatCents } from "../server/template";
import { DOCUMENT_REVIEW } from "../step-types/document_review/public";
import { JOURNAL_ENTRY } from "../step-types/journal_entry/public";

/** Chart of accounts from docs/07 Example 4. */
const ACCOUNTS = [
  { code: "1010", name: "Cash" },
  { code: "1200", name: "Accounts Receivable" },
  { code: "2000", name: "Accounts Payable" },
  { code: "5100", name: "Cost of Goods Sold" },
  { code: "6100", name: "Office Supplies Expense" },
  { code: "6200", name: "Bank Service Charges" },
  { code: "6300", name: "Rent Expense" },
  { code: "6400", name: "Utilities Expense" },
  { code: "6500", name: "Repairs Expense" },
  { code: "7100", name: "Interest Income" },
];

/** Invoice lines; one per variant is billed for more units than shipped. */
const INVOICE_LINES = [
  { id: "mulch", desc: "Hardwood mulch, 2 cu ft bag", qty: [30, 60], price: [4, 9] },
  { id: "straw", desc: "Pine straw, bale", qty: [20, 50], price: [5, 12] },
  { id: "rock", desc: "River rock, ton", qty: [3, 9], price: [45, 90] },
] as const;

/**
 * Demo of `journal_entry` and `document_review`: book the adjustments from a
 * finished bank rec (docs/07 Example 4's entries, minus the voided check), then
 * review a vendor invoice with a billing error that is also a duplicate
 * (docs/07 Example 1, task 4). Not real test content.
 */
export const demoEntriesReview = defineScenario({
  slug: "demo-entries-review",
  version: 1,
  title: "Demo: adjusting entries and invoice review",
  roleFamily: "accounting",
  timeLimitMinutes: 20,
  definition: {
    intro:
      "You're a staff accountant at Oakline CPA Group. Dana Ruiz has finished the October bank reconciliation for Harbor Lane Coffee Co. and needs the entries booked; then accounts payable needs an invoice checked.",
    steps: [
      {
        id: "rec-entries",
        type: JOURNAL_ENTRY,
        title: "Book the bank rec adjustments",
        config: {
          prompt:
            "Draft the journal entries Harbor Lane needs from Dana's email. Use one entry per item, and use only the accounts listed.",
          accounts: ACCOUNTS,
          maxEntries: 8,
          maxLines: 4,
          expected: [
            { id: "fee", label: "Bank service charge" },
            { id: "nsf", label: "NSF customer check" },
            { id: "interest", label: "Interest earned" },
            { id: "transposition", label: "Check recorded at the wrong amount" },
          ],
        },
      },
      {
        id: "invoice-review",
        type: DOCUMENT_REVIEW,
        title: "Review the Greenway invoice",
        config: {
          prompt:
            "Check this invoice before it's paid. Flag each problem you find with a reason, then say what accounts payable should do.",
          document: {
            title: "Greenway Mulch & Stone · Invoice",
            fields: [
              { id: "vendor", label: "Vendor", value: "Greenway Mulch & Stone, Apex NC" },
              { id: "invoice_no", label: "Invoice #", value: "{{inv_no}}" },
              { id: "invoice_date", label: "Invoice date", value: "October 24" },
              { id: "po", label: "PO #", value: "PO-{{po_no}}" },
              { id: "terms", label: "Terms", value: "Net 30" },
            ],
            columns: ["Description", "Qty", "Unit price", "Amount"],
            rows: INVOICE_LINES.map((l) => ({
              id: l.id,
              cells: [l.desc, `{{${l.id}_qty}}`, `{{${l.id}_price|money}}`, `{{${l.id}_amount|money}}`],
            })),
            totals: [{ id: "total", label: "Amount due", value: "{{total|money}}" }],
            footnote: "Delivered to Harbor Lane Coffee Co., 214 Harbor Lane. Thank you for your business!",
          },
          reasons: [
            { id: "math", label: "Amount doesn't match quantity × price" },
            { id: "duplicate", label: "Duplicate or already paid" },
            { id: "price", label: "Price differs from what was agreed" },
            { id: "period", label: "Wrong date or period" },
            { id: "support", label: "Missing approval or support" },
            { id: "other", label: "Other" },
          ],
          findings: [
            { id: "line-math", label: "Line billed for more units than shipped" },
            { id: "duplicate", label: "Invoice already paid in September" },
          ],
          decision: {
            prompt: "What should accounts payable do with this invoice?",
            options: [
              { id: "approve", label: "Approve for payment" },
              { id: "reject", label: "Reject: don't pay" },
              { id: "ask_vendor", label: "Hold and ask the vendor" },
            ],
          },
        },
      },
    ],
    messages: [
      {
        id: "m1",
        from: "Dana Ruiz, Senior Associate",
        subject: "Harbor Lane: October entries",
        body: [
          "Hi! October's bank rec for Harbor Lane is done. These items still need entries in their books:",
          "",
          "• Monthly bank service fee: {{fee|money}}",
          "• Maple St. Bakery's check for {{nsf|money}} came back NSF (it was booked as a customer payment).",
          "• Interest the bank paid on the account: {{interest|money}}",
          "• Check #{{chk_no}} to Coastal Roasters (coffee beans, cost of goods sold) cleared the bank at {{chk_cleared|money}} but was booked at {{chk_booked|money}}.",
          "",
          "Can you draft the entries? Thanks!",
        ].join("\n"),
        arriveAtMinute: 0,
        stepId: "rec-entries",
      },
      {
        id: "m2",
        from: "Priya Shah, Accounts Payable",
        subject: "Greenway invoice OK to pay?",
        body: [
          "Greenway Mulch & Stone sent the invoice attached to this task for the patio planters. Can you check it before I schedule payment?",
          "",
          "For reference, we paid Greenway invoices #{{paid_1}} and #{{paid_2}} in September. The PO was for the quantities shown.",
        ].join("\n"),
        arriveAtMinute: 8,
        stepId: "invoice-review",
      },
    ],
  },

  build(rng) {
    const fee = rng.cents(12, 45);
    const nsf = rng.cents(200, 900);
    const interest = rng.cents(3, 25);

    // Transposed hundreds and tens digits: cleared > booked, and the gap is a multiple of $90.
    const thousands = rng.int(1, 4);
    const hi = rng.int(2, 9);
    const lo = rng.int(0, hi - 1);
    const units = rng.int(0, 9);
    const centsPart = rng.int(0, 99);
    const chkCleared = (thousands * 1000 + hi * 100 + lo * 10 + units) * 100 + centsPart;
    const chkBooked = (thousands * 1000 + lo * 100 + hi * 10 + units) * 100 + centsPart;
    const diff = (chkCleared - chkBooked) / 100;

    // Invoice: one line billed for a few extra units; the invoice number repeats a September one.
    const lines = INVOICE_LINES.map((l) => {
      const qty = rng.int(l.qty[0], l.qty[1]);
      const price = rng.cents(l.price[0], l.price[1]);
      return { ...l, qtyN: qty, priceC: price, amountC: qty * price };
    });
    const wrong = rng.int(0, lines.length - 1);
    const extraUnits = rng.int(2, 6);
    const correctC = lines[wrong].amountC;
    lines[wrong].amountC = (lines[wrong].qtyN + extraUnits) * lines[wrong].priceC;
    const total = lines.reduce((s, l) => s + l.amountC, 0);
    const invNo = `GM-${rng.int(4100, 4899)}`;
    const otherNo = `GM-${rng.int(3600, 4099)}`;
    const [paid1, paid2] = rng.shuffle([invNo, otherNo]);

    const dollars = (cents: number) => cents / 100;
    const entry = (dr: string[], cr: string[], amount: number) => ({
      lines: [
        { accounts: dr, side: "debit" as const, amount },
        { accounts: cr, side: "credit" as const, amount },
      ],
    });

    return {
      values: {
        fee,
        nsf,
        interest,
        chk_no: rng.int(1040, 1180),
        chk_cleared: chkCleared,
        chk_booked: chkBooked,
        inv_no: invNo,
        po_no: rng.int(2200, 2899),
        paid_1: paid1,
        paid_2: paid2,
        total,
        ...Object.fromEntries(
          lines.flatMap((l) => [
            [`${l.id}_qty`, l.qtyN],
            [`${l.id}_price`, l.priceC],
            [`${l.id}_amount`, l.amountC],
          ]),
        ),
      },
      keys: {
        "rec-entries": {
          entries: {
            fee: entry(["6200"], ["1010"], dollars(fee)),
            nsf: entry(["1200"], ["1010"], dollars(nsf)),
            interest: entry(["1010"], ["7100"], dollars(interest)),
            // docs/07: accept Accounts payable if the check paid a booked invoice.
            transposition: entry(["5100", "2000"], ["1010"], diff),
          },
        },
        "invoice-review": {
          findings: {
            "line-math": {
              targets: [lines[wrong].id, "total"],
              reasons: ["math"],
              note: `${lines[wrong].desc}: ${lines[wrong].qtyN} × ${formatCents(lines[wrong].priceC)} = ${formatCents(correctC)}, billed ${formatCents(lines[wrong].amountC)}.`,
            },
            duplicate: {
              targets: ["invoice_no"],
              reasons: ["duplicate"],
              note: `Invoice ${invNo} is in the September payment list.`,
            },
          },
          decision: ["reject", "ask_vendor"],
        },
      },
    };
  },
});
