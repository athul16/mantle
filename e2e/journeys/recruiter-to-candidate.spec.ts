/**
 * Across both sides (all three browsers): a recruiter sets up an assessment
 * and a job and invites a candidate; the candidate takes the test from the
 * invite email; the recruiter sees it completed and the assessment locked.
 */
import { expect as baseExpect } from "@playwright/test";
import { candidateHelpers } from "../support/candidate";
import { expect, outbox, relaxSecureCookies, test } from "../support/test";

test("a recruiter invites, the candidate completes, the recruiter sees it", async ({ page, browser, browserName, company, data, signInAs, land }) => {
  test.slow();
  const email = data.email("journey");

  // Recruiter: assessment → job → invite.
  await signInAs("recruiter", `/app/${company.slug}/jobs/assessments`);
  await land(/\/assessments$/, "Assessments");
  const form = page.locator("form").filter({ has: page.getByRole("heading", { name: "New assessment" }) });
  await form.getByLabel("Simulation").selectOption({ label: "Demo: petty cash count (v1)" });
  await form.getByLabel("Title").fill("Petty cash round");
  // Proctoring has its own journeys (e2e/proctoring); firefox and webkit can't fake a camera or screen share.
  await form.getByLabel("Camera snapshots").uncheck();
  await form.getByLabel("Screen share").uncheck();
  await form.getByRole("button", { name: "Create assessment" }).click();
  await expect(page.getByText('Created "Petty cash round".')).toBeVisible();

  await page.getByRole("link", { name: "← Jobs" }).click();
  await land(/\/jobs$/, "Jobs");
  await page.getByLabel("Job title").fill("Staff accountant");
  await page.getByRole("button", { name: "Create job" }).click();
  await page.getByRole("link", { name: "Staff accountant" }).click();
  await land(/\/jobs\/[0-9a-f-]{36}$/, "Staff accountant");
  await page.getByLabel("Paste emails").fill(email);
  await page.getByRole("button", { name: "Send invites" }).click();
  await expect(page.getByText("Invited 1 candidate.")).toBeVisible();
  const row = page.getByRole("row").filter({ hasText: email });
  await expect(row.getByText("invited", { exact: true })).toBeVisible();

  // Candidate, in their own browser, from the email.
  const token = outbox.inviteTokenFrom(await outbox.waitForEmail(email));
  const context = await browser.newContext();
  await relaxSecureCookies(context, browserName);
  const cpage = await context.newPage();
  const errors: string[] = [];
  cpage.on("pageerror", (e) => {
    if (!(browserName === "webkit" && /#418/.test(e.message))) errors.push(e.message);
  });
  const candidate = candidateHelpers(cpage);
  const invite = { inviteId: "", email, link: `/a/${token}` };
  await candidate.startTest(invite);

  // Once a candidate has verified, the assessment's settings lock.
  await page.goto(`/app/${company.slug}/jobs/assessments`);
  await expect(page.getByText(/^Petty cash round\s*locked$/)).toBeVisible();
  await page.goBack();
  await expect(page.getByRole("row").filter({ hasText: email }).getByText("started", { exact: true })).toBeVisible();

  await candidate.message(/At start/).click();
  await cpage.getByLabel(/how much cash should be in the petty cash box/).fill("100");
  await candidate.saved();
  await cpage.getByRole("link", { name: "Review and submit" }).click();
  await cpage.getByRole("button", { name: "Submit my answers" }).click();
  await baseExpect(cpage.getByRole("heading", { level: 1, name: "Thanks, you're done" })).toBeVisible();
  await context.close();
  expect(errors).toEqual([]);

  // Recruiter: the invite list and the jobs table show the result.
  await page.reload();
  const done = page.getByRole("row").filter({ hasText: email });
  await expect(done.getByText("completed", { exact: true })).toBeVisible();
  await expect(done.getByText("Jamie Rivera")).toBeVisible();
  await expect(done.getByRole("button", { name: /Resend|Revoke/ })).toHaveCount(0);
  await page.getByRole("link", { name: "← Jobs" }).click();
  const jobRow = page.getByRole("row").filter({ hasText: "Staff accountant" });
  // Counts are by current status, not a cumulative funnel: the one invite is now only "completed".
  await expect(jobRow.getByRole("cell")).toHaveText(["Staff accountant", "Petty cash round", /.+/, "0", "0", "1"]);
});
