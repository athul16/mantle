/**
 * Screenshots of the key pages (chromium). Baselines are Linux-only and come
 * from the e2e-snapshots workflow (docs/11-testing.md); elsewhere these skip.
 * Data is created with fixed names; times, emails and the timer are masked.
 */
import type { Page } from "@playwright/test";
import { signInViaUi } from "../fixtures";
import { chromiumOnly, expect, test } from "../support/test";

chromiumOnly();
// E2E_LOCAL_SCREENSHOTS=1 runs them elsewhere to check the flow; never commit non-Linux baselines.
test.skip(process.platform !== "linux" && !process.env.E2E_LOCAL_SCREENSHOTS, "screenshot baselines exist for Linux only (CI)");

const masks = (page: Page, ...extra: string[]) => [page.locator("time"), ...extra.map((t) => page.getByText(t, { exact: false }))];

test("company pages", async ({ page, data }) => {
  const co = await data.company({ name: "Northwind Audit" });
  const { assessmentId } = await data.assessment({ orgId: co.orgId, title: "Petty cash" });
  const { jobId } = await data.job({ orgId: co.orgId, assessmentId, title: "Audit intern" });
  const invite = await data.invite({ orgId: co.orgId, jobId });

  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await expect(page).toHaveScreenshot("login.png");

  await signInViaUi(page, co.users.recruiter);
  await expect(page.getByRole("heading", { level: 1, name: "Northwind Audit" })).toBeVisible();
  await expect(page).toHaveScreenshot("dashboard.png", { mask: masks(page, co.users.recruiter.email) });

  await page.getByRole("navigation").getByRole("link", { name: "Jobs" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Jobs" })).toBeVisible();
  await expect(page).toHaveScreenshot("jobs.png", { mask: [...masks(page, co.users.recruiter.email), page.getByLabel("Invite deadline")] });

  await page.getByRole("link", { name: "Audit intern" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Audit intern" })).toBeVisible();
  await expect(page).toHaveScreenshot("invite-list.png", { mask: masks(page, co.users.recruiter.email, invite.email) });
});

test("candidate pages", async ({ page, data, candidate }) => {
  const co = await data.company({ name: "Harbor Hiring" });
  const { assessmentId } = await data.assessment({ orgId: co.orgId, title: "Petty cash" });
  const { jobId } = await data.job({ orgId: co.orgId, assessmentId, title: "Audit intern" });
  const invite = await data.invite({ orgId: co.orgId, jobId });

  await page.goto(invite.link);
  await expect(page.getByRole("heading", { level: 1, name: "Harbor Hiring invited you to an assessment" })).toBeVisible();
  await expect(page).toHaveScreenshot("candidate-landing.png", { mask: masks(page) });

  const code = await candidate.requestCode(invite);
  await expect(page).toHaveScreenshot("verify.png", { mask: masks(page, "We sent a 6-digit code to") });

  await candidate.submitCode(code);
  await page.getByRole("link", { name: "Continue to instructions" }).click();
  await page.getByRole("button", { name: "Start the 15-minute timer" }).click();
  await expect(page.getByText("Open a message in the inbox to start.")).toBeVisible();
  await expect(page).toHaveScreenshot("workspace.png", { mask: [page.getByRole("timer")] });

  await page.getByRole("link", { name: "Review and submit" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Review and submit" })).toBeVisible();
  await expect(page).toHaveScreenshot("review.png");

  await page.getByRole("button", { name: "Submit my answers" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Thanks, you're done" })).toBeVisible();
  await expect(page).toHaveScreenshot("done.png");
});
