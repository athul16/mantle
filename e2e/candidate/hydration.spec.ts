/**
 * Pages that show dates hydrate cleanly in every browser. LocalTime/LocalDate
 * used to build their server text with Intl, which WebKit formats differently
 * ("Nov 9, 2026 at 10:50 PM"), so Safari threw React #418. The `guard` fixture
 * fails the test on any page error, so these runs are the check.
 */
import { signInViaUi } from "../fixtures";
import { expect, test } from "../support/test";

test("the candidate landing page hydrates without a mismatch", async ({ page, hiring }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(hiring.invite.link);
  await expect(page.getByRole("button", { name: "Continue" })).toBeVisible();
  await expect(page.locator("time").first()).not.toHaveText(/UTC$/);
  expect(errors).toEqual([]);
});

test("the company job page hydrates without a mismatch", async ({ page, hiring }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await signInViaUi(page, hiring.company.users.recruiter, `/app/${hiring.company.slug}/jobs/${hiring.jobId}`);
  await expect(page.getByRole("row").filter({ hasText: hiring.invite.email })).toBeVisible();
  expect(errors).toEqual([]);
});
