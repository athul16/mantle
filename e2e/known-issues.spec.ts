/**
 * Accessibility checks for app issues found by these tests. A `test.fixme`
 * holds the behaviour we want until the app is fixed: change it to `test` then.
 */
import { signInViaUi } from "./fixtures";
import { axeSerious, expect, test } from "./support/test";

test.describe("colour contrast", () => {
  // Every company page, with no excluded nodes: muted text must be 4.5:1 or better.
  test("company pages pass axe, including colour contrast", async ({ page, hiring }, testInfo) => {
    const { company, jobId } = hiring;
    await signInViaUi(page, company.users.admin, `/app/${company.slug}`);
    for (const path of [
      `/app/${company.slug}`,
      `/app/${company.slug}/jobs`,
      `/app/${company.slug}/jobs/assessments`,
      `/app/${company.slug}/jobs/${jobId}`,
      `/app/${company.slug}/candidates?job=${jobId}`,
      `/app/${company.slug}/team`,
    ]) {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await axeSerious(page, testInfo);
    }
  });

  // Candidate pages are fixed separately ("Coming soon" on the system check, "At start" / "5 min in" in the inbox).
  test.fixme("candidate pages meet colour contrast (system check, inbox times)", async ({ page, hiring, candidate }, testInfo) => {
    await candidate.verify(hiring.invite);
    await axeSerious(page, testInfo);
  });
});
