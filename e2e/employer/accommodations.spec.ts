/**
 * D9 accommodations end to end: a recruiter gives one candidate extra time in
 * the invite drawer on the job page, the candidate sees the company contact on the verify page and
 * gets the longer limit, and the server deadline carries it.
 */
import { candidateHelpers } from "../support/candidate";
import { attemptFor, db } from "../support/db";
import { signInViaUi } from "../fixtures";
import { chromiumOnly, expect, test } from "../support/test";

chromiumOnly();

test("extra time set by a recruiter extends the candidate's server deadline", async ({ page, hiring, land, browser }) => {
  const { company, jobId, invite } = hiring;
  const contact = `careers-${company.slug}@example.test`;
  const set = await db().from("organizations").update({ settings: { contact_email: contact } }).eq("id", company.orgId);
  expect(set.error).toBeNull();

  await signInViaUi(page, company.users.recruiter, `/app/${company.slug}/jobs/${jobId}`);
  await land(/\/jobs\/[0-9a-f-]{36}$/, "Audit intern");
  const row = page.getByRole("row").filter({ hasText: invite.email });
  await row.getByRole("button", { name: invite.email }).click();
  const drawer = page.getByRole("dialog", { name: invite.email });
  await drawer.getByRole("combobox", { name: /Extra time for/ }).selectOption("+50%");
  await drawer.getByRole("button", { name: "Save accommodations" }).click();
  await expect(drawer.getByText(`Saved accommodations for ${invite.email}.`)).toBeVisible();
  await expect(drawer.getByTestId("drawer-accommodations")).toHaveText("+50% time (15 → 23 min)");
  await expect(row.getByTestId("invite-accommodations")).toHaveText("Accommodations: +50% time (15 → 23 min)");

  // The candidate, in a separate browser context.
  const context = await browser.newContext();
  const candidatePage = await context.newPage();
  const candidate = candidateHelpers(candidatePage);
  const code = await candidate.requestCode(invite);
  await expect(candidatePage.getByTestId("accommodation-contact")).toContainText(`Email ${contact} before you start`);
  await expect(candidatePage.getByRole("link", { name: contact })).toHaveAttribute("href", `mailto:${contact}`);
  await candidate.submitCode(code);
  await expect(candidatePage).toHaveURL(/\/check$/);
  await candidatePage.getByRole("link", { name: "Continue", exact: true }).click();
  await expect(candidatePage.getByText("23 minutes (includes 50% extra)")).toBeVisible();
  await candidatePage.getByRole("button", { name: "Start the 23-minute test" }).click();
  await expect(candidatePage).toHaveURL(/\/workspace$/);
  await expect(candidatePage.getByRole("timer")).toBeVisible();
  expect(await candidate.secondsLeft()).toBeGreaterThan(22 * 60);

  const attempt = await attemptFor(invite.inviteId);
  expect(new Date(attempt!.deadline_at!).getTime() - new Date(attempt!.started_at!).getTime()).toBe(23 * 60_000);
  await context.close();

  // Once started, the accommodations can no longer change.
  await page.reload();
  // The candidate gave their name at verify, so the row now shows it. A started candidate has no
  // invite drawer, so the accommodations can't be changed any more.
  const started = page.getByRole("row").filter({ hasText: "Taking it now" });
  await expect(started.getByTestId("invite-accommodations")).toHaveText("Accommodations: +50% time (15 → 23 min)");
  await expect(started.getByRole("button")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Save accommodations" })).toHaveCount(0);
});
