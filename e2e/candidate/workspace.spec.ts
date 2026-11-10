/**
 * The timed workspace: every step type in both demo scenarios, scheduled
 * messages, autosave and resume, timeout, and a second device taking over.
 * Time passes by moving `started_at` / `deadline_at` back in the database and,
 * for the browser's own timers, with Playwright's clock; nothing sleeps.
 */
import { attemptFor, backdateAttempt, db, expireAttempt } from "../support/db";
import { candidateHelpers } from "../support/candidate";
import { chromiumOnly, expect, KNOWN_FAINT_TEXT, relaxSecureCookies, test } from "../support/test";

chromiumOnly();

test("mini close: spreadsheet, numeric and email reply, saved and submitted", async ({ page, data, candidate, a11y, land }) => {
  const co = await data.company();
  const { assessmentId } = await data.assessment({
    orgId: co.orgId,
    scenarioId: await data.libraryScenario("demo-mini-close"),
    title: "Mini close",
    timeLimitMinutes: 20,
  });
  const { jobId } = await data.job({ orgId: co.orgId, assessmentId });
  const invite = await data.invite({ orgId: co.orgId, jobId });

  await candidate.startTest(invite);
  await expect(page.getByRole("heading", { level: 1, name: "Demo: mini month-end close" })).toBeVisible();
  await expect(page.getByText("Inbox · 1 unread")).toBeVisible();

  await candidate.message(/At start/).click();
  await expect(page.getByRole("heading", { name: "October bank reconciliation" })).toBeVisible();
  const dit = page.getByLabel("Add: deposits in transit, Amount ($)");
  await dit.fill("1200.50");
  // Enter moves down to the next input in the column.
  await dit.press("Enter");
  await expect(page.getByLabel("Less: outstanding checks, Amount ($)")).toBeFocused();
  await page.getByLabel("Less: outstanding checks, Amount ($)").fill("(350)");
  await page.getByLabel("Adjusted bank balance, Amount ($)").fill("20000");
  await candidate.saved();
  await a11y(KNOWN_FAINT_TEXT);

  // Minutes 5 and 10 bring the next two messages.
  await backdateAttempt(invite.inviteId, 11, { keepDeadline: true });
  await page.reload();
  // The opened message stays read after the reload; the two new ones are unread.
  await expect(page.getByText("Inbox · 2 unread")).toBeVisible();
  await candidate.message(/5 min in/).click();
  await page.getByLabel(/reconciled \(adjusted\) cash balance/).fill("19,850.50");
  await candidate.saved();

  await candidate.message(/10 min in/).click();
  await expect(page.getByText("Marcus Lee, Owner, Harbor Lane Coffee Co.").first()).toBeVisible();
  const reply = page.getByRole("textbox", { name: "Reply" });
  const text = "Hi Marcus, neither figure is wrong: a deposit and two checks haven't cleared yet.";
  await reply.fill(text);
  await expect(page.getByText(`${text.split(" ").length} words · ${text.length} / 4,000 characters`)).toBeVisible();
  await candidate.saved();
  await a11y(KNOWN_FAINT_TEXT);

  // Everything typed survives a reload.
  await page.reload();
  await candidate.message(/At start/).click();
  await expect(page.getByLabel("Add: deposits in transit, Amount ($)")).toHaveValue("1200.5");
  await candidate.message(/10 min in/).click();
  await expect(reply).toHaveValue(/neither figure is wrong/);

  await page.getByRole("link", { name: "Review and submit" }).click();
  await land(/\/review$/, "Review and submit");
  await expect(page.getByText("Answered", { exact: true })).toHaveCount(3);
  await page.getByRole("button", { name: "Submit my answers" }).click();
  await land(/\/done$/, "Thanks, you're done");

  const attempt = await attemptFor(invite.inviteId);
  expect(attempt?.status).toBe("scored");
  const { data: responses } = await db().from("step_responses").select("step_id").eq("attempt_id", attempt!.id);
  expect(responses?.map((r) => r.step_id).sort()).toEqual(["adjusted-balance", "bank-rec", "client-reply"]);
});

test("a scheduled message arrives while the candidate watches", async ({ page, hiring, candidate }) => {
  await page.clock.install();
  await candidate.startTest(hiring.invite);
  await expect(page.getByText("Inbox · 1 unread")).toBeVisible();
  await expect(candidate.message(/5 min in/)).toHaveCount(0);

  await backdateAttempt(hiring.invite.inviteId, 6, { keepDeadline: true });
  // The workspace polls every 20 seconds.
  await page.clock.fastForward(21_000);
  await expect(candidate.message(/5 min in/)).toBeVisible();
  await expect(page.getByText("Inbox · 2 unread")).toBeVisible();
});

test("opened messages stay read after a reload", async ({ page, hiring, candidate }) => {
  await candidate.startTest(hiring.invite);
  await expect(page.getByText("Inbox · 1 unread")).toBeVisible();
  const logged = page.waitForResponse((r) => r.url().endsWith("/api/candidate/event") && r.request().postData()?.includes("opened_message") === true);
  await candidate.message(/At start/).click();
  await expect(page.getByText("Inbox · 0 unread")).toBeVisible();
  expect((await logged).ok()).toBe(true);
  await page.reload();
  await expect(page.getByRole("timer")).toBeVisible();
  await expect(page.getByText("Inbox · 0 unread")).toBeVisible();
});

test("an unanswered task is flagged on review and the candidate can go back", async ({ page, hiring, candidate, land }) => {
  await candidate.startTest(hiring.invite);
  await page.getByRole("link", { name: "Review and submit" }).click();
  await land(/\/review$/, "Review and submit");
  await expect(page.getByText("Not answered")).toHaveCount(1);
  await expect(page.getByText("1 task has no answer.")).toBeVisible();
  await page.getByRole("link", { name: "Back to the test" }).click();
  await expect(page).toHaveURL(/\/workspace$/);
  await expect(page.getByRole("timer")).toBeVisible();
});

test("closing the tab and reopening the link resumes with the time that's left", async ({ page, hiring, candidate, land }) => {
  const { invite } = hiring;
  await candidate.startTest(invite);
  await candidate.message(/At start/).click();
  await page.getByLabel(/how much cash should be in the petty cash box/).fill("88.20");
  await candidate.saved();

  // Three minutes pass on the server clock.
  await backdateAttempt(invite.inviteId, 3);
  await page.goto(invite.link);
  await land(/\/a\/[\w-]+$/, "Your assessment is in progress");
  await page.getByRole("link", { name: "Resume" }).click();
  await expect(page).toHaveURL(/\/workspace$/);
  await expect.poll(() => candidate.secondsLeft()).toBeLessThanOrEqual(12 * 60);
  expect(await candidate.secondsLeft()).toBeGreaterThan(11 * 60);
  await candidate.message(/At start/).click();
  await expect(page.getByLabel(/how much cash should be in the petty cash box/)).toHaveValue("88.2");
});

test("when time runs out the answers are submitted as a timeout", async ({ page, hiring, candidate, land }) => {
  const { invite } = hiring;
  await page.clock.install();
  await candidate.startTest(invite);
  await candidate.message(/At start/).click();
  await page.getByLabel(/how much cash should be in the petty cash box/).fill("10");
  await candidate.saved();

  await expireAttempt(invite.inviteId);
  // The browser countdown reaches zero, asks the server, and the server settles the attempt.
  await page.clock.fastForward("16:00");
  await land(/\/done$/, "Time's up");
  await expect(page.getByText("The time limit was reached, so we submitted the answers you had saved.")).toBeVisible();

  const attempt = await attemptFor(invite.inviteId);
  expect(attempt?.status).toBe("scored");
  expect(attempt?.submit_reason).toBe("timeout");
});

test("an expired attempt reopened later lands on the time's-up page", async ({ page, hiring, candidate, land }) => {
  await candidate.startTest(hiring.invite);
  await expireAttempt(hiring.invite.inviteId);
  await page.reload();
  await land(/\/done$/, "Time's up");
});

test.describe("second device", () => {
  // The first device's save is refused with 401 on purpose.
  test.use({ allowHttp: [/\/api\/candidate\/(answer|state|event)$/] });

test("verifying on a second device retires the first device's session", async ({ page, hiring, candidate, browser, browserName, land }) => {
  const { invite } = hiring;
  await candidate.startTest(invite);
  await candidate.message(/At start/).click();

  const second = await browser.newContext();
  await relaxSecureCookies(second, browserName);
  const other = await second.newPage();
  const otherCandidate = candidateHelpers(other);
  await other.goto(invite.link);
  await expect(other.getByRole("heading", { level: 1, name: "Continue your assessment" })).toBeVisible();
  await otherCandidate.verify(invite);
  await other.getByRole("link", { name: "Continue to instructions" }).click();
  await other.getByRole("link", { name: "Back to your test" }).click();
  await expect(other.getByRole("timer")).toBeVisible();

  // The first device's next save is refused and it is sent back to the link page.
  await page.getByLabel(/how much cash should be in the petty cash box/).fill("5");
  await land(/\/a\/[\w-]+$/, "Continue your assessment");
  await expect(page.getByText("To continue on this device, we'll email you a new 6-digit code.")).toBeVisible();
  await second.close();
});
});
