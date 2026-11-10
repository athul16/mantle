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

  test.fixme("dates hydrate without a mismatch in Safari (React #418)", async ({ page, hiring, browserName }) => {
    // LocalTime/LocalDate format their server text with the browser's Intl; WebKit adds " at ".
    test.skip(browserName !== "webkit", "WebKit-only bug");
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(hiring.invite.link);
    await expect(page.getByRole("button", { name: "Continue" })).toBeVisible();
    expect(errors).toEqual([]);
  });

  test.fixme("candidate primary buttons show a pending state while the form posts", async ({ page, hiring }) => {
    // Continue, Verify and continue, Start, Submit are plain form posts: no disabled or "…" state,
    // so a slow server invites double clicks.
    await page.route("**/api/candidate/code", async (route) => {
      await new Promise((r) => setTimeout(r, 2_000));
      await route.continue();
    });
    await page.goto(hiring.invite.link);
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByRole("button", { name: /Continue|Sending/ })).toBeDisabled();
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
