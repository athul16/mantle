/**
 * Page changes: loading states appear and resolve, back and forward work, and
 * nothing shifts the layout. Console errors and failed requests are checked
 * on every test by the guard fixture (support/test.ts).
 */
import { signInViaUi } from "../fixtures";
import { hold } from "../support/hold";
import { chromiumOnly, expect, test } from "../support/test";

chromiumOnly();

// Layout-shift budget per document, the same as Lighthouse's "good" CLS.
const CLS_BUDGET = 0.1;

test("company navigation: back and forward land on the right pages without layout shift", async ({ page, hiring, cls, land }) => {
  const { company, jobId } = hiring;
  await signInViaUi(page, company.users.recruiter);
  // The company opens on its Jobs list (there is no dashboard).
  await land(new RegExp(`/app/${company.slug}/jobs$`), "Jobs");

  const nav = page.getByRole("navigation", { name: "Main" });
  await page.getByRole("link", { name: "Audit intern" }).click();
  await land(/\/jobs\/[0-9a-f-]{36}$/, "Audit intern");
  // Team lives in the account menu (the avatar button in the header).
  await page.getByRole("button", { name: new RegExp(company.name) }).click();
  await page.getByRole("menuitem", { name: "Team" }).click();
  await land(/\/team$/, "Team");
  await nav.getByRole("link", { name: "Candidates" }).click();
  await expect(page).toHaveURL(/\/candidates(\?.*)?$/);
  await nav.getByRole("link", { name: "Jobs" }).click();
  await land(/\/jobs$/, "Jobs");

  // All of that was client-side navigation in one document.
  expect(await cls(), "cumulative layout shift across company navigation").toBeLessThan(CLS_BUDGET);

  await page.goBack();
  await expect(page).toHaveURL(/\/candidates(\?.*)?$/);
  await page.goBack();
  await land(/\/team$/, "Team");
  await page.goBack();
  await land(new RegExp(`/jobs/${jobId}$`), "Audit intern");
  await page.goForward();
  await land(/\/team$/, "Team");
  expect(await cls()).toBeLessThan(CLS_BUDGET);
});

test("a slow company page shows its loading state, then the page", async ({ page, hiring }) => {
  const { company } = hiring;
  // The loading fallback comes from the prefetched route; wait for that prefetch so the click can use it.
  const prefetched = page.waitForResponse(
    (res) => new URL(res.url()).pathname.endsWith("/jobs") && "next-router-prefetch" in res.request().headers(),
  );
  // Start on another page, so clicking Jobs is a real navigation.
  await signInViaUi(page, company.users.recruiter, `/app/${company.slug}/team`);
  await expect(page.getByRole("heading", { level: 1, name: "Team" })).toBeVisible();
  await prefetched;

  // Hold the server render of the jobs page (an RSC request, not a prefetch).
  const held = await hold(
    page,
    (req) => new URL(req.url()).pathname.endsWith("/jobs") && "rsc" in req.headers() && !("next-router-prefetch" in req.headers()),
  );
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Jobs" }).click();
  await held.arrived;
  await expect(page.getByRole("main").getByText("Loading…")).toBeVisible();
  await held.release();
  await expect(page.getByRole("heading", { level: 1, name: "Jobs" })).toBeVisible();
  await expect(page.getByRole("main").getByText("Loading…")).toHaveCount(0);
});

test("candidate pages load without layout shift and back returns to the right step", async ({ page, hiring, candidate, cls, land }) => {
  const { invite, company } = hiring;
  await page.goto(invite.link);
  await land(/\/a\/[\w-]+$/, `${company.name} invited you to an assessment`);
  expect(await cls(), "landing CLS").toBeLessThan(CLS_BUDGET);

  await candidate.verify(invite);
  expect(await cls(), "system check CLS").toBeLessThan(CLS_BUDGET);
  await page.getByRole("link", { name: "Continue", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Before you start" })).toBeVisible();
  expect(await cls(), "instructions CLS").toBeLessThan(CLS_BUDGET);

  await page.goBack();
  await expect(page.getByRole("heading", { level: 1, name: "Check your setup" })).toBeVisible();
  await page.goForward();
  await expect(page.getByRole("heading", { level: 1, name: "Before you start" })).toBeVisible();

  await page.getByRole("button", { name: "Start the 15-minute simulation" }).click();
  await expect(page.getByRole("timer")).toBeVisible();
  expect(await cls(), "workspace CLS").toBeLessThan(CLS_BUDGET);

  // Back from the workspace can't restart the timer: instructions now offer "Back to your test".
  await page.goBack();
  await expect(page.getByRole("link", { name: "Back to your test" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Start the/ })).toHaveCount(0);
});
