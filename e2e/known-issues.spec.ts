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

  test.fixme("the revoke confirmation message is shown", async ({ page, hiring }) => {
    // InviteRowActions returns null once the row can't be resent or revoked, unmounting its own message.
    await signInViaUi(page, hiring.company.users.recruiter, `/app/${hiring.company.slug}/jobs/${hiring.jobId}`);
    page.once("dialog", (d) => void d.accept());
    await page.getByRole("button", { name: "Revoke" }).click();
    await expect(page.getByText(`Revoked ${hiring.invite.email}'s invite.`)).toBeVisible();
  });

  test.fixme("opened messages stay read after a reload", async ({ page, hiring, candidate }) => {
    // Read state lives only in React state in the workspace; a reload marks everything unread again.
    await candidate.startTest(hiring.invite);
    await candidate.message(/At start/).click();
    await expect(page.getByText("Inbox · 0 unread")).toBeVisible();
    await page.reload();
    await expect(page.getByText("Inbox · 0 unread")).toBeVisible();
  });

  test.fixme("another company's URL answers HTTP 404, not 200", async ({ page, hiring, data }) => {
    // The page streams inside Suspense, so notFound() renders the 404 page with status 200 (a soft 404).
    const other = await data.company();
    await signInViaUi(page, other.users.admin);
    const res = await page.goto(`/app/${hiring.company.slug}/jobs`);
    expect(res?.status()).toBe(404);
  });
});
