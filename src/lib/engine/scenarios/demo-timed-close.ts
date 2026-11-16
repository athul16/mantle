import "server-only";

import { defineScenario } from "../server/scenario";
import { formatCents } from "../server/template";
import { INBOX_REPLY } from "../step-types/inbox_reply/public";
import { NUMERIC } from "../step-types/numeric/public";
import { RAPID_ROUND } from "../step-types/rapid_round/public";

/**
 * Demo of timed sections: a rapid round of quick checks (2 minutes), two
 * one-at-a-time work screens (90 seconds each) and a short reply. Not real
 * test content. Amounts are seeded per candidate; derived figures (the
 * allowance, monthly insurance, monthly depreciation) exist only in the keys.
 */

const DEBIT_CREDIT_OPTIONS = [
  { id: "cash", label: "Cash" },
  { id: "rent_expense", label: "Rent expense" },
  { id: "supplies", label: "Supplies" },
  { id: "accounts_payable", label: "Accounts payable" },
];

export const demoTimedClose = defineScenario({
  slug: "demo-timed-close",
  version: 1,
  title: "Demo: timed close checks",
  roleFamily: "accounting",
  timeLimitMinutes: 12,
  definition: {
    intro:
      "You're covering month end at Birch & Pine Outfitters. The work comes in three timed sections. A finished section can't be reopened.",
    steps: [
      {
        id: "quick",
        type: RAPID_ROUND,
        title: "Rapid checks",
        config: {
          intro: "Quick journal entries and an invoice decision. Answer each item before its timer runs out.",
          secondsPerItem: 20,
          items: [
            {
              id: "jef-rent",
              prompt: "Paid this month's store rent of {{rent|money}} by check.",
              fields: [
                { id: "debit", label: "Debit", kind: "choice", options: DEBIT_CREDIT_OPTIONS },
                { id: "credit", label: "Credit", kind: "choice", options: DEBIT_CREDIT_OPTIONS },
              ],
            },
            {
              id: "jef-supplies",
              prompt: "Bought {{supplies|money}} of shop supplies on account.",
              fields: [
                { id: "debit", label: "Debit", kind: "choice", options: DEBIT_CREDIT_OPTIONS },
                { id: "credit", label: "Credit", kind: "choice", options: DEBIT_CREDIT_OPTIONS },
              ],
            },
            {
              id: "ap-check",
              prompt: "This invoice is due today. Pay it or hold it?",
              exhibit: {
                title: "Invoice {{inv_no}} from {{vendor}}",
                rows: [
                  { label: "Invoice amount", value: "{{inv_amount|money}}" },
                  { label: "Purchase order amount", value: "{{po_amount|money}}" },
                  { label: "Goods received", value: "{{received}}" },
                ],
              },
              fields: [
                {
                  id: "decision",
                  label: "Decision",
                  kind: "choice",
                  options: [
                    { id: "pay", label: "Pay" },
                    { id: "hold", label: "Hold" },
                  ],
                },
                {
                  id: "reason",
                  label: "Reason",
                  kind: "choice",
                  options: [
                    { id: "all_match", label: "Invoice, PO and receipt agree" },
                    { id: "over_po", label: "Billed more than the PO" },
                    { id: "not_received", label: "Goods not received" },
                  ],
                },
              ],
            },
            {
              id: "dep-calc",
              prompt:
                "Equipment cost {{equip|money}}, no salvage value, {{life}}-year life, straight line. What is one month's depreciation?",
              fields: [{ id: "amount", label: "Monthly depreciation", kind: "number", unit: "$", decimals: 2 }],
            },
          ],
        },
      },
      {
        id: "screen-1",
        type: NUMERIC,
        title: "Allowance for doubtful accounts",
        seconds: 90,
        config: {
          prompt:
            "Accounts receivable at month end are {{ar|money}}. Policy: the allowance for doubtful accounts is {{allow_pct}}% of receivables. What should the allowance balance be?",
          unit: "$",
          decimals: 2,
        },
      },
      {
        id: "screen-2",
        type: NUMERIC,
        title: "Insurance expense for the month",
        seconds: 90,
        config: {
          prompt: "On the 1st the company paid {{premium|money}} for a 12-month insurance policy. What is the insurance expense for this month?",
          unit: "$",
          decimals: 2,
        },
      },
      {
        id: "reply",
        type: INBOX_REPLY,
        title: "Reply to Priya",
        config: {
          prompt: "Reply to Priya. Explain why only part of the insurance payment is an expense this month.",
          to: "Priya Nair, Owner, Birch & Pine Outfitters",
          subject: "Re: Insurance on the P&L",
          maxChars: 3_000,
          criteria: [
            {
              id: "prepaid",
              label: "Explains prepaid insurance",
              maxPoints: 2,
              guidance: "Explains that the payment covers 12 months, so it is recorded as prepaid insurance and expensed a month at a time.",
            },
            {
              id: "amount",
              label: "Gives the monthly amount",
              maxPoints: 1,
              guidance: "States the monthly expense (one twelfth of {{premium|money}}).",
            },
            {
              id: "tone",
              label: "Plain, friendly tone",
              maxPoints: 1,
              guidance: "Plain language an owner understands; no jargon left unexplained.",
            },
          ],
        },
      },
    ],
    messages: [
      {
        id: "m-intro",
        from: "Leah Park, Controller",
        subject: "Month end, three quick parts",
        body: [
          "Hi {{first_name}}, thanks for covering today.",
          "",
          "1. Quick checks: a few entries and an invoice, one at a time.",
          "2. Two work screens with their own timers.",
          "3. A reply to Priya, who has a question about insurance.",
          "",
          "Each part has its own time. Once you finish a part you can't go back to it.",
        ].join("\n"),
      },
      {
        id: "m-reply",
        from: "Priya Nair, Owner, Birch & Pine Outfitters",
        subject: "Insurance on the P&L",
        body: "We paid {{premium|money}} for insurance this month, but the P&L shows much less than that as insurance expense. Is something missing?",
        arriveAtMinute: 0,
        stepId: "reply",
      },
    ],
    sections: [
      { id: "s-quick", title: "Quick checks", minutes: 2, stepIds: ["quick"] },
      { id: "s-screens", title: "Work screens", minutes: 3, stepIds: ["screen-1", "screen-2"], oneAtATime: true },
      { id: "s-reply", title: "Reply", minutes: 4, stepIds: ["reply"] },
    ],
  },

  build(rng) {
    const rent = rng.cents(1_800, 4_200);
    const supplies = rng.cents(120, 900);
    const po = rng.cents(600, 3_500);
    const invoiceCase = rng.pick(["all_match", "over_po", "not_received"] as const);
    const invAmount = invoiceCase === "over_po" ? po + rng.cents(40, 400) : po;
    const equip = rng.cents(6_000, 24_000);
    const life = rng.int(3, 7);
    const ar = rng.cents(40_000, 90_000);
    const allowPct = rng.int(2, 6);
    const premium = rng.cents(3_600, 9_600);

    const allowance = Math.round((ar * allowPct) / 100);
    const monthlyInsurance = Math.round(premium / 12);
    const monthlyDepreciation = Math.round(equip / (life * 12));
    const dollars = (cents: number) => cents / 100;

    return {
      values: {
        rent,
        supplies,
        inv_no: `INV-${rng.int(4100, 9800)}`,
        vendor: rng.pick(["Summit Packaging", "Cascade Freight", "Northwind Displays"]),
        inv_amount: invAmount,
        po_amount: po,
        received: invoiceCase === "not_received" ? "No" : "Yes",
        equip,
        life,
        ar,
        allow_pct: allowPct,
        premium,
      },
      keys: {
        quick: {
          items: {
            "jef-rent": { debit: { choice: "rent_expense" }, credit: { choice: "cash" } },
            "jef-supplies": { debit: { choice: "supplies" }, credit: { choice: "accounts_payable" } },
            "ap-check": { decision: { choice: invoiceCase === "all_match" ? "pay" : "hold" }, reason: { choice: invoiceCase } },
            "dep-calc": { amount: { value: dollars(monthlyDepreciation), tolerance: 0.01 } },
          },
        },
        "screen-1": { value: dollars(allowance), tolerance: 0.005, partialTolerance: 1 },
        "screen-2": { value: dollars(monthlyInsurance), tolerance: 0.01, partialTolerance: 1 },
        reply: {
          notes: {
            amount: `Monthly insurance expense is ${formatCents(monthlyInsurance)}.`,
          },
        },
      },
    };
  },
});
