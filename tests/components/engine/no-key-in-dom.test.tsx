/**
 * What a candidate's browser actually renders for every scenario and many
 * seeds contains no answer-key value, key note or rubric text. Complements
 * tests/engine/mini-close.test.ts (which checks the JSON payload) by checking
 * the DOM the step views produce from it, attributes included.
 */
import { cleanup, render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StepView } from "@/lib/engine/client/StepView";
import { listScenarios } from "@/lib/engine/scenarios";
import { renderAttemptForCandidate } from "@/lib/engine/server/render";
import { keyVariantScenario } from "../../engine/key-variants";

const SEEDS = Array.from({ length: 100 }, (_, i) => `dom-seed-${i.toString(16).padStart(3, "0")}`);

/** Every textual form an amount could take: 120.1, 120.10, 1,120.10, 12010 (cents). */
function leakPatterns(value: number): RegExp[] {
  const forms = [
    JSON.stringify(value),
    value.toFixed(2),
    String(Math.round(value * 100)),
    value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
  ];
  return [...new Set(forms)]
    .filter((f) => !/^\d{1,3}$/.test(f))
    .map((s) => new RegExp(`(?<![\\d.,])${s.replace(/[.$]/g, "\\$&")}(?![\\d.]\\d)`));
}

/**
 * Expected amounts (any `value` or `amount` field) and text notes inside a key, whatever its shape. Ids the
 * material lists on purpose (account codes, flaggable items, reasons, decision options, debit/credit side)
 * are skipped: they're in every candidate's choices, so they reveal nothing.
 */
const PUBLIC_ID_FIELDS = new Set(["accounts", "side", "targets", "reasons", "decision", "choice", "correct", "order"]);
/** Only id-shaped strings are skipped under those fields; a note or sentence there is still checked. */
const ID_LIKE = /^[A-Za-z0-9_.-]{1,64}$/;
function keyLeaves(
  key: unknown,
  out: { numbers: number[]; strings: string[] } = { numbers: [], strings: [] },
  field = "",
  publicIds = false,
): { numbers: number[]; strings: string[] } {
  const ids = publicIds || PUBLIC_ID_FIELDS.has(field);
  if (typeof key === "number" && (field === "value" || field === "amount")) out.numbers.push(key);
  else if (typeof key === "string") {
    if (!(ids && ID_LIKE.test(key))) out.strings.push(key);
  } else if (Array.isArray(key)) for (const v of key) keyLeaves(v, out, field, ids);
  else if (key && typeof key === "object") for (const [k, v] of Object.entries(key)) keyLeaves(v, out, k, ids);
  return out;
}

/** The candidate's whole screen for one attempt: intro, every message, every step view. */
function renderCandidateDom(view: ReturnType<typeof renderAttemptForCandidate>) {
  const { container } = render(
    <div>
      <p>{view.intro}</p>
      {view.messages.map((m) => (
        <article key={m.id}>
          <h3>{m.subject}</h3>
          <p>{m.from}</p>
          <p>{m.body}</p>
        </article>
      ))}
      {view.steps.map((s) => (
        <section key={s.id}>
          <h4>{s.title}</h4>
          <StepView step={s} onChange={() => {}} />
        </section>
      ))}
    </div>,
  );
  const html = container.innerHTML;
  cleanup();
  return html;
}

describe("rendered candidate DOM never contains the answer key", () => {
  for (const scenario of listScenarios()) {
    it(`${scenario.slug}@v${scenario.version} across ${SEEDS.length} seeds`, () => {
      const rubricText = scenario.definition.steps.flatMap((s) => {
        const cfg = s.config as { criteria?: { label: string; guidance: string }[] };
        return (cfg.criteria ?? []).flatMap((c) => [c.label, c.guidance]);
      });
      let derivedChecked = 0;

      for (const seed of SEEDS) {
        const variant = scenario.generate(seed);
        const view = renderAttemptForCandidate(scenario, seed, 24 * 60);
        expect(view.steps.length, "every step is rendered").toBe(scenario.definition.steps.length);
        const html = renderCandidateDom(view);
        expect(html).not.toContain("{{");
        for (const text of rubricText) expect(html).not.toContain(text);

        // Amounts the material shows on purpose are fine; anything derived must not appear.
        const shown = new Set(
          Object.values(variant.values)
            .filter((x): x is number => typeof x === "number")
            .map((cents) => cents / 100),
        );
        for (const [stepId, key] of Object.entries(variant.keys)) {
          const { numbers, strings } = keyLeaves(key);
          for (const n of numbers.filter((x) => x >= 1 && !shown.has(x))) {
            derivedChecked++;
            for (const p of leakPatterns(n)) expect(html, `${seed} ${stepId}: key ${n} in DOM as ${p}`).not.toMatch(p);
          }
          for (const s of strings) expect(html, `${seed} ${stepId}: key note in DOM`).not.toContain(s);
        }
      }
      expect(derivedChecked).toBeGreaterThan(SEEDS.length);
    }, 30_000);
  }

  it("the check fires when a key value is planted in the DOM", () => {
    const scenario = listScenarios().find((s) => s.slug.includes("mini-close"))!;
    const key = scenario.generate("abc").keys["adjusted-balance"] as { value: number };
    const { container } = render(<p>Adjusted: ${key.value.toLocaleString("en-US", { minimumFractionDigits: 2 })}</p>);
    expect(leakPatterns(key.value).some((p) => p.test(container.innerHTML))).toBe(true);
  });

  it("multiple_choice and a clean document_review: the DOM is the same whatever the key says", () => {
    const doms = new Set<string>();
    const keys = new Set<string>();
    for (const seed of SEEDS.slice(0, 40)) {
      keys.add(JSON.stringify(keyVariantScenario.generate(seed).keys));
      // React's useId differs per render; the ids aren't content.
      doms.add(renderCandidateDom(renderAttemptForCandidate(keyVariantScenario, seed, 60)).replace(/(?:[«:]r[0-9a-z]+[»:]|_r_[0-9a-z]+_)/g, "id"));
    }
    expect(keys.size).toBeGreaterThan(10);
    expect(doms.size).toBe(1);
    const [html] = doms;
    expect(html).toContain('type="radio"');
    expect(html).toContain('type="checkbox"');
    expect(html).toContain("Nothing wrong with this invoice");
    expect(html).not.toMatch(/correct|Paid on Oct 3/i);
  });

  it("correct option ids are skipped as public ids, but text under an id field is still checked", () => {
    expect(keyLeaves({ correct: ["ar", "cash"] }).strings).toEqual([]);
    expect(keyLeaves({ correct: ["Paid on Oct 3."] }).strings).toEqual(["Paid on Oct 3."]);
    expect(keyLeaves({ findings: { dup: { targets: ["invoice_no"], reasons: ["dup"], note: "Paid on Oct 3." } } }).strings).toEqual(["Paid on Oct 3."]);
  });

  it("journal_entry amounts in a key are checked too, and the check fires when one is planted", () => {
    const scenario = listScenarios().find((s) => s.slug === "demo-entries-review")!;
    const key = scenario.generate("abc").keys["rec-entries"];
    const fix = (key as { entries: { transposition: { lines: { amount: number }[] } } }).entries.transposition.lines[0].amount;
    expect(keyLeaves(key).numbers).toContain(fix);
    expect(keyLeaves(key).strings).toEqual([]); // account codes and sides are public choices, not secrets
    const { container } = render(<p>Correction: {fix.toLocaleString("en-US", { minimumFractionDigits: 2 })}</p>);
    expect(leakPatterns(fix).some((p) => p.test(container.innerHTML))).toBe(true);
  });
});
