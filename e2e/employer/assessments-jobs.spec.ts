/** Assessments (create, edit, clone, locked) and jobs (create, invite deadline). */
import type { Page } from "@playwright/test";
import { hold, isServerAction } from "../support/hold";
import { db } from "../support/db";
import { chromiumOnly, expect, test } from "../support/test";

chromiumOnly();

const createForm = (page: Page) => page.locator("form").filter({ has: page.getByRole("heading", { name: "New assessment" }) });
const card = (page: Page, title: string) =>
  page.getByRole("listitem").filter({ has: page.getByText(new RegExp(`^${title.replace(/[()]/g, "\\$&")}\\s*(locked)?$`)) });

/** "Nov 9, 2026" for a date, as the app shows it in the UTC test browser. */
const shortDate = (d: Date) => d.toLocaleDateString("en-US", { dateStyle: "medium", timeZone: "UTC" });
const isoDay = (d: Date) => d.toISOString().slice(0, 10);

test("a recruiter creates, edits and clones an assessment", async ({ page, company, signInAs, land }) => {
  await signInAs("recruiter", `/app/${company.slug}/jobs`);
  await land(/\/jobs$/, "Jobs");
  await expect(page.getByText("Create an assessment first")).toBeVisible();
  await page.getByRole("link", { name: "assessment", exact: true }).click();
  await land(/\/jobs\/assessments$/, "Assessments");
  await expect(page.getByText("Demo: petty cash count", { exact: true })).toBeVisible();
  await expect(page.getByText("Demo: mini month-end close", { exact: true })).toBeVisible();

  const form = createForm(page);
  await form.getByLabel("Simulation").selectOption({ label: "Demo: mini month-end close (v1)" });
  // The suggested time limit follows the simulation.
  await expect(form.getByLabel("Time limit (minutes)")).toHaveValue("20");
  await form.getByLabel("Title").fill("Close round A");
  await form.getByLabel("Pass score (%)").fill("70");
  await form.getByLabel("Camera snapshots").uncheck();
  const held = await hold(page, isServerAction);
  await form.getByRole("button", { name: "Create assessment" }).click();
  await held.arrived;
  await expect(form.getByRole("button", { name: "Creating…" })).toBeDisabled();
  await held.release();
  await expect(page.getByText('Created "Close round A".')).toBeVisible();
  const a = card(page, "Close round A");
  await expect(a.getByText(/20 min · pass 70% · camera off · screen on/)).toBeVisible();

  await a.getByRole("button", { name: "Edit settings" }).click();
  await a.getByLabel("Time limit (minutes)").fill("25");
  await a.getByRole("button", { name: "Save" }).click();
  await expect(a.getByText("Saved.")).toBeVisible();
  await expect(a.getByText(/25 min · pass 70%/)).toBeVisible();
  await a.getByRole("button", { name: "Close" }).click();

  await a.getByRole("button", { name: "Clone" }).click();
  await expect(card(page, "Close round A (copy)").getByText(/25 min · pass 70%/)).toBeVisible();
});

test("a locked assessment can't be edited but can be cloned", async ({ page, data, company, signInAs }) => {
  const { assessmentId } = await data.assessment({ orgId: company.orgId, title: "Started round" });
  await db().from("assessments").update({ locked_at: new Date().toISOString() }).eq("id", assessmentId);

  await signInAs("admin", `/app/${company.slug}/jobs/assessments`);
  const a = card(page, "Started round");
  await expect(a.getByText("locked", { exact: true })).toBeVisible();
  await expect(a.getByText(/because a candidate started\. Clone it to change settings\./)).toBeVisible();
  await expect(a.getByRole("button", { name: "Edit settings" })).toHaveCount(0);
  await a.getByRole("button", { name: "Clone" }).click();
  const copy = card(page, "Started round (copy)");
  await expect(copy.getByRole("button", { name: "Edit settings" })).toBeVisible();
  await expect(copy.getByText("locked", { exact: true })).toHaveCount(0);
});

test("a recruiter creates a job and its invites expire at the deadline", async ({ page, data, company, signInAs, land }) => {
  await data.assessment({ orgId: company.orgId, title: "Cash round" });
  const deadline = new Date(Date.now() + 30 * 86_400_000);
  await signInAs("recruiter", `/app/${company.slug}/jobs`);

  const form = page.locator("form").filter({ has: page.getByRole("heading", { name: "New job" }) });
  await form.getByLabel("Job title").fill("Audit intern 2027");
  await expect(form.getByLabel("Assessment")).toHaveValue(/.+/);
  await form.getByLabel("Invite deadline").fill(isoDay(deadline));
  await form.getByRole("button", { name: "Create job" }).click();
  await expect(page.getByText('Created "Audit intern 2027". Open it to invite candidates.')).toBeVisible();

  const jobRow = page.getByRole("row").filter({ hasText: "Audit intern 2027" });
  await expect(jobRow.getByRole("cell").nth(1)).toHaveText("Cash round");
  await expect(jobRow.getByRole("cell").nth(2)).toHaveText(shortDate(deadline));

  await jobRow.getByRole("link", { name: "Audit intern 2027" }).click();
  await land(/\/jobs\/[0-9a-f-]{36}$/, "Audit intern 2027");
  await expect(page.getByText(/Invite deadline .*11:59 PM/)).toBeVisible();

  const email = data.email("deadline");
  await page.getByLabel("Paste emails").fill(email);
  await page.getByRole("button", { name: "Send invites" }).click();
  await expect(page.getByText("Invited 1 candidate.")).toBeVisible();
  const invite = page.getByRole("row").filter({ hasText: email });
  // Columns: email, status, invited, last sent, expires.
  await expect(invite.getByRole("cell").nth(3)).toHaveText(shortDate(new Date()));
  await expect(invite.getByRole("cell").nth(4)).toHaveText(shortDate(deadline));
});

test("a job whose deadline has passed takes no new invites", async ({ page, data, company, signInAs }) => {
  const { assessmentId } = await data.assessment({ orgId: company.orgId });
  const { jobId } = await data.job({ orgId: company.orgId, assessmentId, title: "Closed round", deadline: new Date(Date.now() - 86_400_000) });
  await data.invite({ orgId: company.orgId, jobId });
  await signInAs("recruiter", `/app/${company.slug}/jobs/${jobId}`);
  await expect(page.getByText("The invite deadline has passed, so no new invites can be sent.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Send invites" })).toHaveCount(0);
  // Resend would issue a link that can't be used; only revoke remains.
  await expect(page.getByRole("button", { name: "Resend" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Revoke" })).toBeVisible();
});
