/**
 * Test-only scenario for the leak tests (tests/engine/mini-close.test.ts and
 * tests/components/engine/no-key-in-dom.test.tsx): the values are the same for
 * every seed and only the keys change, so whatever the candidate receives must
 * be identical across seeds. Covers keys whose secret is *which* public id is
 * right (multiple_choice) or whether a document is clean (document_review),
 * which a search for key strings can't catch.
 */
import { defineScenario } from "@/lib/engine/server/scenario";

const OPTIONS = [
  { id: "cash", label: "Cash" },
  { id: "ar", label: "Accounts receivable" },
  { id: "ap", label: "Accounts payable" },
  { id: "rev", label: "Revenue" },
];

export const keyVariantScenario = defineScenario({
  slug: "test-key-variants",
  version: 1,
  title: "Test: key-only variants",
  roleFamily: "accounting",
  timeLimitMinutes: 10,
  definition: {
    intro: "Quick checks for {{client}}.",
    messages: [],
    steps: [
      {
        id: "pick-one",
        type: "multiple_choice",
        title: "Pick one",
        config: { prompt: "Which account does {{client}} debit?", options: OPTIONS, select: "single", points: 2 },
      },
      {
        id: "pick-many",
        type: "multiple_choice",
        title: "Pick many",
        config: { prompt: "Which are assets of {{client}}?", options: OPTIONS, select: "multi", points: 3 },
      },
      {
        id: "invoice",
        type: "document_review",
        title: "Invoice",
        config: {
          prompt: "Review the invoice from {{client}}.",
          document: {
            title: "Invoice",
            fields: [{ id: "invoice_no", label: "Invoice #", value: "INV-1" }],
            columns: ["Description", "Amount"],
            rows: [{ id: "line1", cells: ["Mulch", "$500.00"] }],
            totals: [{ id: "total", label: "Total", value: "$500.00" }],
          },
          reasons: [
            { id: "math", label: "Math error" },
            { id: "dup", label: "Duplicate" },
          ],
          findings: [{ id: "dup-inv", label: "Already paid", points: 2 }],
          confirmClean: { label: "Nothing wrong with this invoice" },
        },
      },
    ],
  },
  build(rng) {
    const ids = OPTIONS.map((o) => o.id);
    const many = ids.filter(() => rng.int(0, 1) === 1);
    const clean = rng.int(0, 1) === 1;
    return {
      values: { client: "Harbor Lane" },
      keys: {
        "pick-one": { correct: [rng.pick(ids)] },
        "pick-many": { correct: many.length ? many : [ids[0]] },
        invoice: clean ? { findings: {}, clean: true } : { findings: { "dup-inv": { targets: ["invoice_no"], reasons: ["dup"], note: "Paid on Oct 3." } } },
      },
    };
  },
});
