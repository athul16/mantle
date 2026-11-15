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
  await land(/\/verify\?sent=1$/, "Confirm it's you");
  const mail = await outbox.latestEmail(invite.email);
  // The code email names the job; its body is branded with the company.
  expect(mail?.subject).toMatch(/^\d{6} is your code for the Audit intern assessment$/);
  expect(mail?.html).toContain(company.name);

  await candidate.submitCode(code);
  await land(/\/check$/, "Check your setup", KNOWN_FAINT_TEXT);
  // Browser, screen and connection pass; the demo uses no camera or screen share.
  await expect(page.getByRole("img", { name: "Passed" })).toHaveCount(3);

  await page.getByRole("link", { name: "Continue", exact: true }).click();
  await land(/\/instructions$/, "Before you start");
  await expect(page.getByText("Practice · untimed · not scored")).toBeVisible();

  const start = page.getByRole("button", { name: "Start the 15-minute simulation" });
  await start.click();
  await expect(page).toHaveURL(/\/workspace$/);
  await expect(page.getByText("Demo: petty cash count")).toBeVisible();
  await expect(page.getByRole("timer")).toHaveText(/^1[45]:\d\d$/);
  await expect(candidate.inboxButton()).toHaveAccessibleName("Inbox 1 unread");
  // The first task is open, with the email that asked for it in the brief column.
  await expect(page.getByRole("heading", { level: 1, name: "Expected cash in the box" })).toBeVisible();
  await a11y(KNOWN_FAINT_TEXT);

  await candidate.openInbox();
  await candidate.message(/Petty cash check for Hartwell/).click();
  await expect(page.getByRole("heading", { level: 3, name: "Petty cash check for Hartwell" })).toBeVisible();
  await expect(candidate.inboxButton()).toHaveAccessibleName("Inbox");
  await page.getByRole("button", { name: "Close inbox" }).click();
  await page.getByLabel(/how much cash should be in the petty cash box/).fill("123.45");
  await expect(page.getByText("Saving…")).toBeVisible();
  await candidate.saved();
  await a11y(KNOWN_FAINT_TEXT);

  // The second message is scheduled for minute 5; pretend 6 minutes have passed.
  await backdateAttempt(invite.inviteId, 6, { keepDeadline: true });
  await page.reload();
  await candidate.task(/Cash shortage/).click();
  await page.getByLabel(/By how much is the box short/).fill("7.5");
  await candidate.saved();

  await page.getByRole("link", { name: "Submit", exact: true }).click();
  await land(/\/review$/, "Review before you submit");
  await expect(page.getByText("Answered", { exact: true })).toHaveCount(2);
  await expect(page.getByText(/Every task has an answer\./)).toBeVisible();

  await page.getByRole("checkbox", { name: "I understand I can't make changes after submitting." }).check();
  await page.getByRole("button", { name: "Submit final answers" }).click();
  await land(/\/done$/, `Submitted. Thanks, ${CANDIDATE_NAME.split(" ")[0]}.`);
  await expect(page.getByText(`Your work went to ${company.name}. You can close this window.`)).toBeVisible();

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
