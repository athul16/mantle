import "server-only";

import { defineScenario } from "../server/scenario";
import { NUMERIC } from "../step-types/numeric/public";

/**
 * Tiny demo scenario that exercises the engine end to end: two numeric steps,
 * one inbox message at the start and one scheduled at minute 5. Not real test
 * content; see docs/07 for the accounting simulations.
 */
export const demoPettyCash = defineScenario({
  slug: "demo-petty-cash",
  version: 1,
  title: "Demo: petty cash count",
  roleFamily: "accounting",
  timeLimitMinutes: 15,
  definition: {
    intro:
      "You're an intern at Mason & Reed CPAs. Your senior, Dana, needs a quick petty cash check for the client Hartwell Landscaping.",
    steps: [
      {
        id: "expected-cash",
        type: NUMERIC,
        title: "Expected cash in the box",
        config: {
          prompt: "Based on Dana's email, how much cash should be in the petty cash box right now?",
          unit: "$",
          decimals: 2,
          points: 2,
        },
      },
      {
        id: "shortage",
        type: NUMERIC,
        title: "Cash shortage",
        config: {
          prompt: "Dana counted {{counted|money}}. By how much is the box short? Enter a positive amount.",
          unit: "$",
          decimals: 2,
          points: 2,
        },
      },
    ],
    messages: [
      {
        id: "m1",
        from: "Dana Reyes, Senior Associate",
        subject: "Petty cash check for Hartwell",
        body: [
          "Morning! Can you check Hartwell's petty cash before I close October?",
          "",
          "The fund is set at {{fund|money}}. Receipts in the box this month:",
          "• {{r1_vendor}}: {{r1|money}}",
          "• Postage: {{r2|money}}",
          "• Coffee for client meeting: {{r3|money}}",
          "",
          "How much cash should be left in the box?",
        ].join("\n"),
        arriveAtMinute: 0,
        stepId: "expected-cash",
      },
      {
        id: "m2",
        from: "Dana Reyes, Senior Associate",
        subject: "Re: Petty cash check for Hartwell",
        body: "I just counted the box: {{counted|money}}. That doesn't look right. How short are we?",
        arriveAtMinute: 5,
        stepId: "shortage",
      },
    ],
  },

  // Numbers and answer keys come from the same values, so the math always ties.
  build(rng) {
    const fund = rng.pick([200_00, 250_00, 300_00, 500_00]);
    const r1 = rng.cents(8, 60);
    const r2 = rng.cents(3, 25);
    const r3 = rng.cents(10, 45);
    const expected = fund - r1 - r2 - r3;
    const shortage = rng.cents(1, 40);
    const counted = expected - shortage;

    return {
      values: {
        fund,
        r1,
        r2,
        r3,
        counted,
        r1_vendor: rng.pick(["Office supplies (Staples)", "Printer toner (Office Depot)", "Cleaning supplies (Costco)"]),
      },
      keys: {
        // Exact to the cent; half credit if within a dollar (e.g. one receipt mis-keyed by cents).
        "expected-cash": { value: expected / 100, tolerance: 0.005, partialTolerance: 1 },
        shortage: { value: shortage / 100, tolerance: 0.005 },
      },
    };
  },
});
