/**
 * Core candidate happy path (all three browsers): invite link → email code →
 * consent → system check → instructions → workspace → review → submit → done.
 */
import { attemptFor, backdateAttempt, inviteRow } from "../support/db";
import { CANDIDATE_NAME } from "../support/candidate";
import { expect, KNOWN_FAINT_TEXT, test } from "../support/test";

test("a candidate takes the petty cash demo from link to done", async ({ page, hiring, candidate, land, a11y, outbox }) => {
  const { invite, company } = hiring;

  await page.goto(invite.link);
  await land(/\/a\/[\w-]+$/, `${company.name} invited you to an assessment`);
  await expect(page.getByText("15 minutes, in one sitting")).toBeVisible();

  const code = await candidate.requestCode(invite);
  await land(/\/verify\?sent=1$/, "Check your email");
  const mail = await outbox.latestEmail(invite.email);
  expect(mail?.subject).toContain(company.name);

  await candidate.submitCode(code);
  await land(/\/check$/, "System check", KNOWN_FAINT_TEXT);
  await expect(page.getByText("OK")).toHaveCount(2);

  await page.getByRole("link", { name: "Continue to instructions" }).click();
  await land(/\/instructions$/, "Before you start");
  await expect(page.getByRole("heading", { name: "Demo: petty cash count" })).toBeVisible();

  const start = page.getByRole("button", { name: "Start the 15-minute timer" });
  await start.click();
  await expect(page).toHaveURL(/\/workspace$/);
  await expect(page.getByRole("heading", { level: 1, name: "Demo: petty cash count" })).toBeVisible();
  await expect(page.getByRole("timer")).toHaveText(/^1[45]:\d\d$/);
  await expect(page.getByText("Inbox · 1 unread")).toBeVisible();
  await expect(page.getByText("Open a message in the inbox to start.")).toBeVisible();
  await a11y(KNOWN_FAINT_TEXT);

  await candidate.message(/At start/).click();
  await expect(page.getByRole("heading", { name: "Petty cash check for Hartwell" })).toBeVisible();
  await expect(page.getByText("Inbox · 0 unread")).toBeVisible();
  await page.getByLabel(/how much cash should be in the petty cash box/).fill("123.45");
  await expect(page.getByText("Saving…")).toBeVisible();
  await candidate.saved();
  await a11y(KNOWN_FAINT_TEXT);

  // The second message is scheduled for minute 5; pretend 6 minutes have passed.
  await backdateAttempt(invite.inviteId, 6, { keepDeadline: true });
  await page.reload();
  await candidate.message(/5 min in/).click();
  await page.getByLabel(/By how much is the box short/).fill("7.5");
  await candidate.saved();

  await page.getByRole("link", { name: "Review and submit" }).click();
  await land(/\/review$/, "Review and submit");
  await expect(page.getByText("Answered")).toHaveCount(2);
  await expect(page.getByText("All tasks so far have an answer.")).toBeVisible();

  await page.getByRole("button", { name: "Submit my answers" }).click();
  await land(/\/done$/, "Thanks, you're done");
  await expect(page.getByText("Your answers were submitted.")).toBeVisible();

  const attempt = await attemptFor(invite.inviteId);
  expect(attempt?.status).toBe("scored");
  expect(attempt?.submit_reason).toBe("candidate");
  const row = await inviteRow(invite.inviteId);
  expect(row.status).toBe("completed");
  expect(row.candidate_name).toBe(CANDIDATE_NAME);

  // The link now shows the finished state, not the flow.
  await page.goto(invite.link);
  await expect(page).toHaveURL(/\/done$/);
});
