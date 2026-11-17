/**
 * Every primary button shows that it's working while its request is in flight
 * (label change and disabled), then lands on the right result. The server
 * action is held with page.route so the pending state is seen every time.
 * Sign in, Send invite (team), Create assessment, Send invites and Resend are
 * covered in their journeys; the rest are here. The candidate's buttons are
 * plain form posts to /api/candidate/*; see expectCandidatePending.
 */
import type { Locator, Page } from "@playwright/test";
import { signInViaUi } from "../fixtures";
import { hold, isServerAction } from "../support/hold";
import { memberIds, orgIdForSlug } from "../support/db";
import { chromiumOnly, expect, test } from "../support/test";

chromiumOnly();

async function expectPending(page: Page, click: () => Promise<void>, pendingName: string) {
  const held = await hold(page, isServerAction);
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
  // The new company's admin is asked to turn on two-factor before opening it.
  await expect(page).toHaveURL(/\/app\/account\/security\?next=%2Fapp%2F[a-z0-9-]+%2Fjobs$/);
  const slug = decodeURIComponent(new URL(page.url()).searchParams.get("next")!).split("/")[2];
  const orgId = await orgIdForSlug(slug);
  data.trackOrg(orgId);
  expect((await memberIds(orgId)).map((m) => m.role)).toEqual(["admin"]);
});

test("Create job, Save, Clone and Revoke each show a pending state", async ({ page, hiring }) => {
  const { company, jobId, invite } = hiring;
  await signInViaUi(page, company.users.recruiter, `/app/${company.slug}/jobs`);
  await page.getByRole("button", { name: "Create job" }).click();
  await page.getByLabel("Role name").fill("Feedback job");
  // Create job stays on "Creating…" until the invite page opens, so its end state is that page.
  const held = await hold(page, isServerAction);
  await page.getByRole("button", { name: "Create and invite candidates" }).click();
  await held.arrived;
  await expect(page.getByRole("button", { name: "Creating…" })).toBeDisabled();
  await held.release();
  await expect(page).toHaveURL(/\/jobs\/[0-9a-f-]{36}\/invite$/);
  await expect(page.getByRole("link", { name: "Feedback job" })).toBeVisible();

  await page.goto(`/app/${company.slug}/jobs/assessments?tab=yours`);
  await page.getByRole("link", { name: /^Edit settings/ }).click();
  await expectPending(page, () => page.getByRole("button", { name: "Save" }).click(), "Saving…");
  await expect(page.getByText("Saved.")).toBeVisible();
  await expectPending(page, () => page.getByRole("button", { name: "Clone" }).click(), "Cloning…");
  await expect(page.getByText('Created "Petty cash (copy)". Edit it before linking it to a job.')).toBeVisible();

  await page.goto(`/app/${company.slug}/jobs/${jobId}`);
  page.once("dialog", (d) => void d.accept());
  await expectPending(
    page,
    () => page.getByRole("row").filter({ hasText: invite.email }).getByRole("button", { name: "Revoke" }).click(),
    "Revoking…",
  );
  await expect(page.getByRole("row").filter({ hasText: invite.email }).getByText("Revoked", { exact: true })).toBeVisible();
});

/**
 * A form post is a navigation, and Playwright can't read the page while a held
 * navigation is pending. So the first post is answered with 204 (the browser
 * stays on the page), the pending state is checked, and the page is reloaded
 * for the real click.
 */
async function expectCandidatePending(page: Page, button: Locator, pendingName: string) {
  await page.route(/\/api\/candidate\/(code|verify|start|submit)$/, (route) => route.fulfill({ status: 204 }), { times: 1 });
  await button.click();
  await expect(page.getByRole("button", { name: pendingName })).toBeDisabled();
  await page.reload();
}

test("the candidate's Continue, Verify, Start and Submit each show a pending state", async ({ page, hiring, candidate }) => {
  const { invite } = hiring;
  await page.goto(invite.link);
  await expectCandidatePending(page, page.getByRole("button", { name: "Continue" }), "Sending code…");
  const code = await candidate.requestCode(invite);

  await page.getByLabel("Full name").fill("Jamie Rivera");
  await page.getByLabel("Code from your email").fill(code);
  await page.getByRole("checkbox").check();
  await expectCandidatePending(page, page.getByRole("button", { name: "Continue", exact: true }), "Verifying…");
  await candidate.submitCode(code);
  await expect(page).toHaveURL(/\/check$/);

  await page.getByRole("link", { name: "Continue", exact: true }).click();
  // Start uses fetch (so full screen carries over), not a form post: hold that request instead.
  const held = await hold(page, (req) => req.method() === "POST" && new URL(req.url()).pathname === "/api/candidate/start");
  await page.getByRole("button", { name: /^Start the \d+-minute test$/ }).click();
  await expect(page.getByRole("button", { name: "Starting…" })).toBeDisabled();
  await held.release();
  await expect(page).toHaveURL(/\/workspace$/);

  await page.getByRole("link", { name: "Submit", exact: true }).click();
  await expect(page).toHaveURL(/\/review$/);
  await page.getByRole("checkbox", { name: "I understand I can't make changes after submitting." }).check();
  const submit = page.getByRole("button", { name: "Submit final answers" });
  await expectCandidatePending(page, submit, "Submitting…");
  // The helper reloads the page, which clears the tick.
  await page.getByRole("checkbox", { name: "I understand I can't make changes after submitting." }).check();
  await submit.click();
  await expect(page).toHaveURL(/\/done$/);
});
