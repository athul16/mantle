/**
 * App bugs these tests found. Each is `test.fixme` with the behaviour we
 * want, so it shows as a known issue in the report and starts running (and
 * passing) once the app is fixed: change `fixme` to `test` then.
 */
import { signInViaUi } from "./fixtures";
import { axeSerious, expect, test } from "./support/test";

test.describe("known app issues", () => {
  test.fixme("light grey labels meet colour contrast (system check, inbox times)", async ({ page, hiring, candidate }, testInfo) => {
    // `text-neutral-400` on white is about 2.5:1; WCAG AA needs 4.5:1 for this size.
    await candidate.verify(hiring.invite);
    await axeSerious(page, testInfo);
  });

  test.fixme("another company's URL answers HTTP 404, not 200", async ({ page, hiring, data }) => {
    // The page streams inside Suspense, so notFound() renders the 404 page with status 200 (a soft 404).
    const other = await data.company();
    await signInViaUi(page, other.users.admin);
    const res = await page.goto(`/app/${hiring.company.slug}/jobs`);
    expect(res?.status()).toBe(404);
  });
});
