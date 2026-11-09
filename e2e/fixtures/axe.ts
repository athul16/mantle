/** Accessibility check with axe-core: WCAG 2.1 A/AA rules, results attached to the test report. */
import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, type TestInfo } from "@playwright/test";

export type AxeOptions = {
  /** Only check inside this selector. */
  include?: string;
  /** Skip these selectors (e.g. third-party widgets). */
  exclude?: string[];
  /** Rule ids to turn off, each with a reason in the calling test. */
  disableRules?: string[];
};

export async function expectNoAxeViolations(page: Page, testInfo: TestInfo, options: AxeOptions = {}) {
  let builder = new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]);
  if (options.include) builder = builder.include(options.include);
  for (const sel of options.exclude ?? []) builder = builder.exclude(sel);
  if (options.disableRules?.length) builder = builder.disableRules(options.disableRules);

  const results = await builder.analyze();
  await testInfo.attach("axe-results", { body: JSON.stringify(results.violations, null, 2), contentType: "application/json" });

  const summary = results.violations.map(
    (v) => `${v.id} (${v.impact}): ${v.help}\n  ${v.nodes.map((n) => n.target.join(" ")).join("\n  ")}`,
  );
  expect(summary, `axe found accessibility violations on ${page.url()}`).toEqual([]);
}
