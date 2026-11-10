/**
 * Every primary button shows that it's working while its request is in flight
 * (label change and disabled), then lands on the right result. The server
 * action is held with page.route so the pending state is seen every time.
 * Sign in, Send invite (team), Create assessment, Send invites and Resend are
 * covered in their journeys; the rest are here. The candidate's buttons are
 * plain form posts to /api/candidate/*, held the same way.
 */
import type { Page, Request } from "@playwright/test";
import { codeFrom, waitForEmail } from "../../tests/helpers/outbox";
import { signInViaUi } from "../fixtures";
import { hold, isServerAction } from "../support/hold";
import { memberIds, orgIdForSlug } from "../support/db";
import { chromiumOnly, expect, test } from "../support/test";

chromiumOnly();

async function expectPending(page: Page, click: () => Promise<void>, pendingName: string, match: (req: Request) => boolean = isServerAction) {
  const held = await hold(page, match);
  await click();
  await held.arrived;
  await expect(page.getByRole("button", { name: pendingName })).toBeDisabled();
  await held.release();
  await expect(page.getByRole("button", { name: pendingName })).toHaveCount(0);
}

test("Create company shows Creating… then opens the company", async ({ page, data }) => {
  const user = await data.user("onboard");
  await signInViaUi(page, user);
  await expect(page).toHaveURL(/\/onboarding$/);
  await page.getByLabel("Company name").fill(`Feedback Co ${data.run}`);
  await expectPending(page, () => page.getByRole("button", { name: "Create company" }).click(), "Creating…");
  await expect(page).toHaveURL(/\/app\/[a-z0-9-]+$/);
  const orgId = await orgIdForSlug(new URL(page.url()).pathname.split("/")[2]);
  data.trackOrg(orgId);
  expect((await memberIds(orgId)).map((m) => m.role)).toEqual(["admin"]);
});

test("Create job, Save, Clone and Revoke each show a pending state", async ({ page, hiring }) => {
  const { company, jobId, invite } = hiring;
  await signInViaUi(page, company.users.recruiter, `/app/${company.slug}/jobs`);
  await page.getByLabel("Job title").fill("Feedback job");
  await expectPending(page, () => page.getByRole("button", { name: "Create job" }).click(), "Creating…");
  await expect(page.getByRole("link", { name: "Feedback job" })).toBeVisible();

  await page.goto(`/app/${company.slug}/jobs/assessments`);
  await page.getByRole("button", { name: "Edit settings" }).click();
  await expectPending(page, () => page.getByRole("button", { name: "Save" }).click(), "Saving…");
  await expect(page.getByText("Saved.")).toBeVisible();
  await expectPending(page, () => page.getByRole("button", { name: "Clone" }).click(), "Cloning…");
  await expect(page.getByText("Petty cash (copy)")).toBeVisible();

  await page.goto(`/app/${company.slug}/jobs/${jobId}`);
  page.once("dialog", (d) => void d.accept());
  await expectPending(
    page,
    () => page.getByRole("row").filter({ hasText: invite.email }).getByRole("button", { name: "Revoke" }).click(),
    "Revoking…",
  );
  await expect(page.getByRole("row").filter({ hasText: invite.email }).getByText("revoked", { exact: true })).toBeVisible();
});

const candidatePost = (req: Request) => req.method() === "POST" && /\/api\/candidate\/(code|verify|start|submit)$/.test(req.url());

test("the candidate's Continue, Verify, Start and Submit each show a pending state", async ({ page, hiring }) => {
  const { invite } = hiring;
  const before = new Date().toISOString();
  await page.goto(invite.link);
  await expectPending(page, () => page.getByRole("button", { name: "Continue" }).click(), "Sending code…", candidatePost);
  await expect(page).toHaveURL(/\/verify\?sent=1$/);

  const code = codeFrom(await waitForEmail(invite.email, { after: before }));
  await page.getByLabel("Your full name").fill("Jamie Rivera");
  await page.getByLabel("6-digit code").fill(code);
  await page.getByRole("checkbox").check();
  await expectPending(page, () => page.getByRole("button", { name: "Verify and continue" }).click(), "Verifying…", candidatePost);
  await expect(page).toHaveURL(/\/check$/);

  await page.getByRole("link", { name: "Continue to instructions" }).click();
  await expectPending(page, () => page.getByRole("button", { name: /^Start the \d+-minute timer$/ }).click(), "Starting…", candidatePost);
  await expect(page).toHaveURL(/\/workspace$/);

  await page.getByRole("link", { name: "Review and submit" }).click();
  await expect(page).toHaveURL(/\/review$/);
  await expectPending(page, () => page.getByRole("button", { name: "Submit my answers" }).click(), "Submitting…", candidatePost);
  await expect(page).toHaveURL(/\/done$/);
});
