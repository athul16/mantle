import "server-only";

import { defineScenario } from "../server/scenario";
import { formatCents } from "../server/template";
import { INBOX_REPLY } from "../step-types/inbox_reply/public";
import { NUMERIC } from "../step-types/numeric/public";
import { SPREADSHEET } from "../step-types/spreadsheet/public";

/**
 * Demo of the three built step types: a tiny bank reconciliation (spreadsheet),
 * a quick "what's the number" interruption (numeric) and a client email
 * (inbox_reply). Not real test content; see docs/07 Example 4 for the real one.
 *
 * Only the material's inputs are template values; derived figures (outstanding
 * checks total, adjusted balance) exist only in the keys.
 */
export const demoMiniClose = defineScenario({
  slug: "demo-mini-close",
  version: 1,
  title: "Demo: mini month-end close",
  roleFamily: "accounting",
  timeLimitMinutes: 20,
  definition: {
    intro:
      "You're a new staff accountant at Oakline CPA Group. Your senior, Dana Ruiz, needs the October bank reconciliation for the client Harbor Lane Coffee Co.",
    steps: [
      {
        id: "bank-rec",
        type: SPREADSHEET,
        title: "October bank reconciliation",
        config: {
          prompt:
            "Complete the reconciliation using Dana's email. Enter amounts as positive numbers; the row labels say whether they're added or subtracted.",
          columns: ["Item", "Amount ($)"],
          rows: [
            [{ text: "Bank side", bold: true }, null],
            ["Balance per bank statement, Oct 31", { text: "{{bank|money}}", align: "right" }],
            ["Add: deposits in transit", { input: "dit", label: "Deposits in transit" }],
            ["Less: outstanding checks", { input: "oc_total", label: "Outstanding checks", points: 2 }],
            [{ text: "Adjusted bank balance", bold: true }, { input: "adj_bank", label: "Adjusted bank balance", points: 2 }],
            [{ text: "Book side", bold: true }, null],
            ["Balance per books (GL 1010), Oct 31", { text: "{{book|money}}", align: "right" }],
            ["Less: bank service fee", { input: "fee", label: "Bank service fee" }],
            [{ text: "Adjusted book balance", bold: true }, { input: "adj_book", label: "Adjusted book balance", points: 2 }],
          ],
        },
      },
      {
        id: "adjusted-balance",
        type: NUMERIC,
        title: "Quick question from Dana",
        config: {
          prompt: "What is Harbor Lane's reconciled (adjusted) cash balance at October 31?",
          unit: "$",
          decimals: 2,
          points: 2,
        },
      },
      {
        id: "client-reply",
        type: INBOX_REPLY,
        title: "Reply to Marcus",
        config: {
          prompt: "Reply to Marcus. Explain the difference in plain language.",
          to: "Marcus Lee, Owner, Harbor Lane Coffee Co.",
          subject: "Re: Which balance is right?",
          maxChars: 4_000,
          criteria: [
            {
              id: "timing",
              label: "Explains timing differences",
              maxPoints: 3,
              guidance:
                "Explains that the deposit in transit and the uncashed checks are timing differences that will clear the bank soon, not missing money.",
            },
            {
              id: "fee",
              label: "Mentions the bank fee",
              maxPoints: 2,
              guidance: "Mentions the {{fee|money}} bank service fee and that it will be recorded in the books.",
            },
            {
              id: "balance",
              label: "States the correct balance",
              maxPoints: 2,
              guidance: "Gives the adjusted cash balance (or clearly says neither raw figure is the true balance).",
            },
            {
              id: "tone",
              label: "Plain, professional tone",
              maxPoints: 2,
              guidance: "Plain language a business owner understands; polite; makes no promises the firm can't keep.",
            },
          ],
        },
      },
    ],
    messages: [
      {
        id: "m1",
        from: "Dana Ruiz, Senior Associate",
        subject: "Harbor Lane: October bank rec",
        body: [
          "Hi! Can you reconcile Harbor Lane's operating account (checking ending 4471) for October?",
          "",
          "Bank statement balance at Oct 31: {{bank|money}}",
          "GL cash (1010) balance at Oct 31: {{book|money}}",
          "",
          "Checks written in October per the GL:",
          "• #{{chk1_no}} {{chk1_payee}}: {{chk1|money}}",
          "• #{{chk2_no}} {{chk2_payee}}: {{chk2|money}}",
          "• #{{chk3_no}} {{chk3_payee}}: {{chk3|money}}",
          "• #{{chk4_no}} {{chk4_payee}}: {{chk4|money}}",
          "",
          "Checks that cleared the bank in October: {{cleared_list}}.",
          "",
          "The GL shows a deposit of {{dit|money}} on Oct 31; it isn't on the bank statement yet.",
          "The statement also shows a {{fee|money}} monthly service fee that nobody has booked.",
          "",
          "September's rec was clean, so nothing carries over. Thanks!",
        ].join("\n"),
        arriveAtMinute: 0,
        stepId: "bank-rec",
      },
      {
        id: "m2",
        from: "Dana Ruiz, Senior Associate",
        subject: "Quick one before my call",
        body: "Client call in 10 minutes. What's the reconciled cash balance at Oct 31? Just the number.",
        arriveAtMinute: 5,
        stepId: "adjusted-balance",
      },
      {
        id: "m3",
        from: "Marcus Lee, Owner, Harbor Lane Coffee Co.",
        subject: "Which balance is right?",
        body: "My bank app says {{bank|money}} but the books say {{book|money}}. Which one is right? Did we lose money somewhere?",
        arriveAtMinute: 10,
        stepId: "client-reply",
      },
    ],
  },

  // Displayed numbers and keys come from the same values, so both sides always tie.
  build(rng) {
    const bank = rng.cents(18_000, 32_000);
    const firstCheck = rng.int(1040, 1180);
    const payees = rng.shuffle(["Coastal Roasters", "Piedmont Dairy", "Triangle Property Mgmt", "Bull City Equipment", "Duke Energy"]);
    const checks = [rng.cents(800, 4_500), rng.cents(400, 2_500), rng.cents(300, 3_000), rng.cents(150, 1_800)].map(
      (amount, i) => ({ no: firstCheck + i, payee: payees[i], amount }),
    );
    // Two of the four checks are still outstanding at month end.
    const order = rng.shuffle([0, 1, 2, 3]);
    const outstanding = order.slice(0, 2).sort((a, b) => a - b);
    const cleared = order.slice(2).sort((a, b) => a - b);
    const dit = rng.cents(900, 6_000);
    const fee = rng.cents(12, 45);

    const outstandingTotal = outstanding.reduce((sum, i) => sum + checks[i].amount, 0);
    const adjusted = bank + dit - outstandingTotal;
    const book = adjusted + fee;
    const dollars = (cents: number) => cents / 100;

    return {
      values: {
        bank,
        book,
        dit,
        fee,
        ...Object.fromEntries(
          checks.flatMap((c, i) => [
            [`chk${i + 1}_no`, c.no],
            [`chk${i + 1}_payee`, c.payee],
            [`chk${i + 1}`, c.amount],
          ]),
        ),
        cleared_list: cleared.map((i) => `#${checks[i].no}`).join(" and "),
      },
      keys: {
        "bank-rec": {
          tolerance: 0.005,
          cells: {
            dit: { value: dollars(dit) },
            oc_total: { value: dollars(outstandingTotal) },
            adj_bank: { value: dollars(adjusted) },
            fee: { value: dollars(fee) },
            adj_book: { value: dollars(adjusted) },
          },
        },
        // Exact to the cent; half credit within a dollar.
        "adjusted-balance": { value: dollars(adjusted), tolerance: 0.005, partialTolerance: 1 },
        "client-reply": {
          notes: {
            timing: `Deposit in transit ${formatCents(dit)}; outstanding checks ${outstanding
              .map((i) => `#${checks[i].no}`)
              .join(" and ")} totalling ${formatCents(outstandingTotal)}.`,
            balance: `Adjusted cash balance is ${formatCents(adjusted)}.`,
          },
        },
      },
    };
  },
});
