/**
 * The a11y harness itself: after axe has run, the page must still answer role
 * locators by accessible name. In Playwright's Firefox, axe reading
 * `section.ariaLabelledByElements` from the page and Playwright then reading it
 * from its own script world crashes the content process ("Page crashed").
 */
import { axeSerious, expect, test } from "./support/test";

test("role locators by name still work after axe on a section labelled by its heading", async ({ page }, testInfo) => {
  let crashed = false;
  page.on("crash", () => (crashed = true));
  await page.setContent(
    `<!doctype html><html lang="en"><head><title>Report</title></head><body><main>
      <section aria-labelledby="rapid-heading"><h2 id="rapid-heading">Rapid checks</h2><p>Four items.</p></section>
      <div role="group" aria-labelledby="quick"><span id="quick">Answered quickly</span><span>1 answer</span></div>
    </main></body></html>`,
  );
  await axeSerious(page, testInfo);
  await expect(page.getByRole("region", { name: "Rapid checks" })).toContainText("Four items.");
  await expect(page.getByRole("group", { name: "Answered quickly" })).toContainText("1 answer");
  expect(crashed, "page crashed").toBe(false);
});

test("axe still resolves aria-labelledby for names", async ({ page }, testInfo) => {
  const withButton = (labelledBy: string) =>
    `<!doctype html><html lang="en"><head><title>Report</title></head><body><main>
      <span id="hire-label">Hire</span><button aria-labelledby="${labelledBy}"></button>
    </main></body></html>`;
  await page.setContent(withButton("hire-label"));
  await axeSerious(page, testInfo);
  await page.setContent(withButton("missing-label"));
  await expect(axeSerious(page, testInfo)).rejects.toThrow(/button-name/);
});
