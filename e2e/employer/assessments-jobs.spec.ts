/** Assessments (create, edit, clone, locked) and jobs (create, invite deadline). */
import type { Page } from "@playwright/test";
import { hold, isServerAction } from "../support/hold";
import { db } from "../support/db";
import { chromiumOnly, expect, test } from "../support/test";

chromiumOnly();

/** A row of the "In use by your jobs" table, by assessment title. */
const yours = (page: Page, title: string) =>
  page.getByRole("row").filter({ has: page.getByText(title, { exact: true }) });

/** "Nov 9" for a date, as the jobs table shows it in the UTC test browser. */
const shortDay = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const isoDay = (d: Date) => d.toISOString().slice(0, 10);

test("a recruiter configures a library simulation, then edits and clones it", async ({ page, company, signInAs, land }) => {
  await signInAs("recruiter", `/app/${company.slug}/jobs`);
  await land(/\/jobs$/, "Jobs");
  await expect(page.getByText(/Create an assessment first/)).toBeVisible();
  await page.getByRole("link", { name: "assessment", exact: true }).click();
  await land(/\/jobs\/assessments$/, "Assessments");
  await expect(page.getByText("Demo: petty cash count", { exact: true })).toBeVisible();
  await expect(page.getByText("Demo: mini month-end close", { exact: true })).toBeVisible();

  await page.getByRole("link", { name: "Use Demo: mini month-end close" }).click();
  await land(/\/jobs\/assessments\/new\?scenario=/, "Configure assessment");
  // The suggested time limit follows the simulation.
  await expect(page.getByLabel("Time limit")).toHaveValue("20");
  await page.getByLabel("Assessment name").fill("Close round A");
  await page.getByLabel("Pass score").fill("70");
  await page.getByRole("switch", { name: "Camera snapshots" }).click();
  const held = await hold(page, isServerAction);
  await page.getByRole("button", { name: "Save and attach to a job" }).click();
  await held.arrived;
  await expect(page.getByRole("button", { name: "Saving…" })).toBeDisabled();
  await held.release();
  // Saving opens Create job with the new assessment picked.
  await expect(page).toHaveURL(/\/jobs\?create=1&assessment=[0-9a-f-]{36}$/);
  const dialog = page.getByRole("dialog", { name: "Create job" });
  await expect(dialog.getByLabel("Assessment")).toHaveValue(/.+/);
  await expect(dialog.getByRole("option", { selected: true })).toHaveText(/^Close round A \(Demo: mini month-end close, 20 min\)$/);
  await dialog.getByRole("button", { name: "Cancel" }).click();

  await page.goto(`/app/${company.slug}/jobs/assessments?tab=yours`);
  const a = yours(page, "Close round A");
  await expect(a.getByRole("cell")).toHaveText(["Close round ADemo: mini month-end close", "20 min", "70", "Camera offScreen on", "0", "Editable", /Edit settings/]);

  await a.getByRole("link", { name: /^Edit settings/ }).click();
  await land(/\/jobs\/assessments\/[0-9a-f-]{36}$/, "Configure assessment");
  await page.getByLabel("Time limit").selectOption("25");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Saved.")).toBeVisible();

  await page.goto(`/app/${company.slug}/jobs/assessments?tab=yours`);
  await expect(yours(page, "Close round A").getByRole("cell").nth(1)).toHaveText("25 min");
  await yours(page, "Close round A").getByRole("button", { name: "Clone" }).click();
  await expect(yours(page, "Close round A (copy)").getByRole("cell").nth(2)).toHaveText("70");
  await expect(yours(page, "Close round A (copy)").getByRole("cell").nth(1)).toHaveText("25 min");
});

test("a locked assessment can't be edited but can be cloned", async ({ page, data, company, signInAs }) => {
  const { assessmentId } = await data.assessment({ orgId: company.orgId, title: "Started round" });
  await db().from("assessments").update({ locked_at: new Date().toISOString() }).eq("id", assessmentId);

  await signInAs("admin", `/app/${company.slug}/jobs/assessments?tab=yours`);
  const a = yours(page, "Started round");
  await expect(a.getByText(/^Locked since/)).toBeVisible();
  await expect(a.getByRole("link", { name: /^Edit settings/ })).toHaveCount(0);
  await a.getByRole("link", { name: /^View/ }).click();
  await expect(page.getByText(/because a candidate started\. Clone it to change settings\./)).toBeVisible();
  await expect(page.getByLabel("Assessment name")).toBeDisabled();
  await expect(page.getByRole("button", { name: "Save" })).toHaveCount(0);
  await page.getByRole("button", { name: "Clone" }).click();
  await expect(page.getByText('Created "Started round (copy)". Edit it before linking it to a job.')).toBeVisible();

  await page.goto(`/app/${company.slug}/jobs/assessments?tab=yours`);
  const copy = yours(page, "Started round (copy)");
  await expect(copy.getByRole("link", { name: /^Edit settings/ })).toBeVisible();
  await expect(copy.getByText("Editable")).toBeVisible();
});

test("a recruiter creates a job and its invites expire at the deadline", async ({ page, data, company, signInAs, land }) => {
  await data.assessment({ orgId: company.orgId, title: "Cash round" });
  const deadline = new Date(Date.now() + 30 * 86_400_000);
  await signInAs("recruiter", `/app/${company.slug}/jobs`);

  await page.getByRole("button", { name: "Create job" }).click();
  const dialog = page.getByRole("dialog", { name: "Create job" });
  await dialog.getByLabel("Role name").fill("Audit intern 2027");
  await expect(dialog.getByLabel("Assessment")).toHaveValue(/.+/);
  await dialog.getByLabel("Invites close").fill(isoDay(deadline));
  await dialog.getByRole("button", { name: "Create and invite candidates" }).click();
  // Creating a job goes straight to inviting candidates to it.
  await land(/\/jobs\/[0-9a-f-]{36}\/invite$/, "Invite candidates");
  // The previous page stays in the DOM (hidden) after a client navigation, so look at visible text only.
  await expect(page.getByText(/Invites close/).locator("..").filter({ visible: true })).toContainText(/11:59 PM/);

  const email = data.email("deadline");
  await page.getByLabel("Email addresses").fill(email);
  await page.getByRole("button", { name: "Send 1 invite" }).click();
  await expect(page.getByText("Invited 1 candidate.")).toBeVisible();

  await page.goto(`/app/${company.slug}/jobs`);
  const jobRow = page.getByRole("row").filter({ hasText: "Audit intern 2027" });
  await expect(jobRow.getByRole("cell")).toHaveText(["Audit intern 2027", /^Demo: petty cash count · \d+ min$/, "1", /.*/, shortDay(deadline)]);
  await expect(jobRow.getByRole("img", { name: "0 done, 0 in progress, 1 not started" })).toBeVisible();
});

test("a job whose deadline has passed takes no new invites", async ({ page, data, company, signInAs }) => {
  const { assessmentId } = await data.assessment({ orgId: company.orgId });
  const { jobId } = await data.job({ orgId: company.orgId, assessmentId, title: "Closed round", deadline: new Date(Date.now() - 86_400_000) });
  await data.invite({ orgId: company.orgId, jobId });
  await signInAs("recruiter", `/app/${company.slug}/jobs/${jobId}/invite`);
  await expect(page.getByText("The invite deadline has passed, so no new invites can be sent.")).toBeVisible();
  await expect(page.getByRole("button", { name: /^Send/ })).toHaveCount(0);
  await page.goto(`/app/${company.slug}/jobs/${jobId}`);
  // Resend would issue a link that can't be used; only revoke remains.
  await expect(page.getByRole("button", { name: "Resend" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Revoke" })).toBeVisible();
});
