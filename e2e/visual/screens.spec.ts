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

// A fixed start-by date: "7 days from today" changes length with the date and re-wraps the landing page.
const EXPIRES_AT = new Date("2099-12-30T17:00:00Z");

test("company pages", async ({ page, data }) => {
  const co = await data.company({ name: "Northwind Audit" });
  const { assessmentId } = await data.assessment({ orgId: co.orgId, title: "Petty cash" });
  const { jobId } = await data.job({ orgId: co.orgId, assessmentId, title: "Audit intern" });
  const invite = await data.invite({ orgId: co.orgId, jobId, expiresAt: EXPIRES_AT });

  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await expect(page).toHaveScreenshot("login.png");

  // The company opens on its Jobs list (there is no dashboard).
  await signInViaUi(page, co.users.recruiter);
  await expect(page.getByRole("heading", { level: 1, name: "Jobs" })).toBeVisible();
  await expect(page).toHaveScreenshot("jobs.png", { mask: [...masks(page, co.users.recruiter.email), page.locator("time")] });

  await page.getByRole("link", { name: "Audit intern" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Audit intern" })).toBeVisible();
  await expect(page).toHaveScreenshot("invite-list.png", { mask: masks(page, co.users.recruiter.email, invite.email) });
});

test("candidate pages", async ({ page, data, candidate }) => {
  const co = await data.company({ name: "Harbor Hiring" });
  const { assessmentId } = await data.assessment({ orgId: co.orgId, title: "Petty cash" });
  const { jobId } = await data.job({ orgId: co.orgId, assessmentId, title: "Audit intern" });
  const invite = await data.invite({ orgId: co.orgId, jobId, expiresAt: EXPIRES_AT });

  await page.goto(invite.link);
  await expect(page.getByRole("heading", { level: 1, name: "Harbor Hiring invited you to an assessment" })).toBeVisible();
  // The server renders dates in UTC with a " UTC" suffix and the browser swaps in local time after hydration;
  // the two differ in width, so wait for the browser's version before comparing.
  for (const time of await page.locator("time").all()) await expect(time).not.toHaveText(/UTC$/);
  await expect(page).toHaveScreenshot("candidate-landing.png", { mask: masks(page) });

  const code = await candidate.requestCode(invite);
  await expect(page).toHaveScreenshot("verify.png", { mask: masks(page, "We sent a 6-digit code to") });

  await candidate.submitCode(code);
  await page.getByRole("link", { name: "Continue", exact: true }).click();
  await page.getByRole("button", { name: "Start the 15-minute simulation" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Expected cash in the box" })).toBeVisible();
  // The timer and the email's arrival time (a wall-clock time) change between runs.
  await expect(page).toHaveScreenshot("workspace.png", { mask: [page.getByRole("timer"), page.locator("time")] });

  await page.getByRole("link", { name: "Submit", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Review before you submit" })).toBeVisible();
  await expect(page).toHaveScreenshot("review.png", { mask: [page.getByRole("timer")] });

  await page.getByRole("checkbox", { name: "I understand I can't make changes after submitting." }).check();
  await page.getByRole("button", { name: "Submit final answers" }).click();
  await expect(page.getByRole("heading", { level: 1, name: /^Submitted\. Thanks/ })).toBeVisible();
  await expect(page).toHaveScreenshot("done.png");
});
