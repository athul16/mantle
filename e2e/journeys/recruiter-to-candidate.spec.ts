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
  await page.getByRole("link", { name: "Use Demo: petty cash count" }).click();
  await land(/\/assessments\/new\?scenario=/, "Configure assessment");
  await page.getByLabel("Assessment name").fill("Petty cash round");
  // Proctoring has its own journeys (e2e/proctoring); firefox and webkit can't fake a camera or screen share.
  await page.getByRole("switch", { name: "Camera snapshots" }).click();
  await page.getByRole("switch", { name: "Entire-screen sharing" }).click();
  await page.getByRole("button", { name: "Save and attach to a job" }).click();

  // Saving opens Create job with the new assessment; creating opens the invite page.
  const dialog = page.getByRole("dialog", { name: "Create job" });
  await dialog.getByLabel("Role name").fill("Staff accountant");
  await dialog.getByRole("button", { name: "Create and invite candidates" }).click();
  await land(/\/jobs\/[0-9a-f-]{36}\/invite$/, "Invite candidates");
  await page.getByLabel("Email addresses").fill(email);
  await page.getByRole("button", { name: "Send 1 invite" }).click();
  await expect(page.getByText("Invited 1 candidate.")).toBeVisible();
  await page.getByRole("link", { name: "View candidates" }).click();
  await land(/\/jobs\/[0-9a-f-]{36}$/, "Staff accountant");
  const row = page.getByRole("row").filter({ hasText: email });
  await expect(row.getByText("Invited", { exact: true })).toBeVisible();

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
  await page.goto(`/app/${company.slug}/jobs/assessments?tab=yours`);
  await expect(page.getByRole("row").filter({ hasText: "Petty cash round" }).getByText(/^Locked since/)).toBeVisible();
  await page.goBack();
  await expect(page.getByRole("row").filter({ hasText: "Jamie Rivera" }).getByText("In progress", { exact: true })).toBeVisible();

  await cpage.getByLabel(/how much cash should be in the petty cash box/).fill("100");
  await candidate.saved();
  await cpage.getByRole("link", { name: "Submit", exact: true }).click();
  await cpage.getByRole("checkbox", { name: "I understand I can't make changes after submitting." }).check();
  await cpage.getByRole("button", { name: "Submit final answers" }).click();
  await baseExpect(cpage.getByRole("heading", { level: 1, name: /^Submitted\. Thanks/ })).toBeVisible();
  await context.close();
  expect(errors).toEqual([]);

  // Recruiter: the invite list and the jobs table show the result.
  await page.reload();
  // Once verified, rows show the candidate's name instead of their email.
  const done = page.getByRole("row").filter({ hasText: "Jamie Rivera" });
  await expect(done.getByText("Completed", { exact: true })).toBeVisible();
  await expect(done.getByText("Jamie Rivera")).toBeVisible();
  await expect(done.getByRole("button", { name: /Resend|Revoke/ })).toHaveCount(0);
  await page.getByRole("navigation", { name: "Breadcrumb" }).getByRole("link", { name: "Jobs" }).click();
  const jobRow = page.getByRole("row").filter({ hasText: "Staff accountant" });
  // Counts are by current status, not a cumulative funnel: the one invite is now only "completed".
  await expect(jobRow.getByRole("cell")).toHaveText(["Staff accountant", /^Demo: petty cash count · \d+ min$/, "1", /.*/, /.+/]);
  await expect(jobRow.getByRole("img", { name: "1 done, 0 in progress, 0 not started" })).toBeVisible();
});
