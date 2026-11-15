/** Inviting candidates: paste, CSV, validation, dedupe, the 200 limit, resend and revoke. */
import type { Page } from "@playwright/test";
import { hold, isServerAction } from "../support/hold";
import { invitesForJob } from "../support/db";
import { signInViaUi } from "../fixtures";
import { chromiumOnly, expect, outbox, test } from "../support/test";

chromiumOnly();

const inviteRow = (page: Page, email: string) => page.getByRole("row").filter({ hasText: email });
const emailsBox = (page: Page) => page.getByLabel("Email addresses");
const sendButton = (page: Page) => page.getByRole("button", { name: /^Send( \d+)? invites?$/ });

test("a recruiter invites by paste and CSV; duplicates and existing invites are skipped", async ({ page, hiring, data, land }) => {
  const { company, jobId } = hiring;
  const a = data.email("paste-a");
  const b = data.email("paste-b");
  const c = data.email("csv-c");
  await signInViaUi(page, hiring.company.users.recruiter, `/app/${company.slug}/jobs/${jobId}/invite`);
  await land(/\/jobs\/[0-9a-f-]{36}\/invite$/, "Invite candidates");

  // a three times (once upper-cased, once in the CSV) counts as one duplicate address.
  // a twice (once upper-cased), b, plus the already-invited fixture email; c and a again in the CSV.
  await emailsBox(page).fill(`${a}, ${a.toUpperCase()}\n${b}; ${hiring.invite.email} `);
  await expect(page.getByText("2 ready · 1 already invited, will be skipped")).toBeVisible();
  await page.getByRole("tab", { name: "Upload CSV" }).click();
  await page.getByLabel("CSV file").setInputFiles({
    name: "candidates.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(`name,email\nCasey Lin,${c}\nAgain,${a}\n`),
  });
  await expect(page.getByText("candidates.csv: 1 ready")).toBeVisible();
  const held = await hold(page, isServerAction);
  await page.getByRole("button", { name: "Send 3 invites" }).click();
  await held.arrived;
  await expect(page.getByRole("button", { name: "Sending invites…" })).toBeDisabled();
  await held.release();

  await expect(page.getByText("Invited 3 candidates. Skipped 1 already invited. Removed 1 duplicate.")).toBeVisible();
  await page.getByRole("link", { name: "View candidates" }).click();
  await land(/\/jobs\/[0-9a-f-]{36}$/, "Audit intern");
  for (const email of [a, b]) await expect(inviteRow(page, email).getByText("Invited", { exact: true })).toBeVisible();
  // The CSV gave c a name, and rows show the name when there is one.
  await expect(inviteRow(page, "Casey Lin").getByText("Invited", { exact: true })).toBeVisible();

  // Each new candidate got an email with a working link.
  const mail = await outbox.waitForEmail(c);
  expect(mail.subject).toContain(company.name);
  const token = outbox.inviteTokenFrom(mail);
  const candidate = await page.context().newPage();
  await candidate.goto(`/a/${token}`);
  await expect(candidate.getByRole("heading", { level: 1, name: `${company.name} invited you to an assessment` })).toBeVisible();
  await candidate.close();
});

test("a batch with an invalid entry is rejected whole and keeps the text", async ({ page, hiring, data }) => {
  const good = data.email("good");
  await signInViaUi(page, hiring.company.users.recruiter, `/app/${hiring.company.slug}/jobs/${hiring.jobId}/invite`);
  const pasted = `${good}\nnot-an-email\nalso@bad`;
  await emailsBox(page).fill(pasted);
  // The box flags both before sending.
  await expect(page.getByText("1 ready · 2 to fix")).toBeVisible();
  await sendButton(page).click();
  await expect(page.getByText("Fix these 2 entries and try again. Nothing was sent.")).toBeVisible();
  await expect(page.getByRole("listitem").filter({ hasText: "not-an-email" })).toBeVisible();
  // Everything typed is still there, as chips.
  for (const entry of [good, "not-an-email", "also@bad"]) await expect(page.getByRole("button", { name: `Remove ${entry}` })).toBeVisible();
  expect((await invitesForJob(hiring.jobId)).map((i) => i.email)).not.toContain(good);
  expect(await outbox.emailsTo(good)).toHaveLength(0);

  for (const entry of [good, "not-an-email", "also@bad"]) await page.getByRole("button", { name: `Remove ${entry}` }).click();
  await sendButton(page).click();
  await expect(page.getByText("Paste at least one email or upload a CSV.")).toBeVisible();
});

test("more than 200 candidates in one batch are refused", async ({ page, hiring }) => {
  await signInViaUi(page, hiring.company.users.recruiter, `/app/${hiring.company.slug}/jobs/${hiring.jobId}/invite`);
  const many = Array.from({ length: 201 }, (_, i) => `bulk-${hiring.company.orgId.slice(0, 8)}-${i}@example.test`).join("\n");
  await emailsBox(page).fill(many);
  await sendButton(page).click();
  await expect(page.getByText("That's 201 candidates. Invite at most 200 at a time. Nothing was sent.")).toBeVisible();
  expect(await invitesForJob(hiring.jobId)).toHaveLength(1);
});

test("resend issues a new link and the old one stops working", async ({ page, hiring }) => {
  const { invite, company } = hiring;
  await signInViaUi(page, hiring.company.users.recruiter, `/app/${company.slug}/jobs/${hiring.jobId}`);
  const before = new Date().toISOString();

  page.once("dialog", (d) => {
    expect(d.message()).toContain(`Send ${invite.email} a new link?`);
    void d.accept();
  });
  const held = await hold(page, isServerAction);
  await inviteRow(page, invite.email).getByRole("button", { name: "Resend" }).click();
  await held.arrived;
  await expect(inviteRow(page, invite.email).getByRole("button", { name: "Sending…" })).toBeDisabled();
  await held.release();
  await expect(page.getByText(`New link sent to ${invite.email}.`)).toBeVisible();

  const mail = await outbox.waitForEmail(invite.email, { after: before });
  const fresh = outbox.inviteTokenFrom(mail);
  expect(fresh).not.toBe(invite.token);

  const candidate = await page.context().newPage();
  await candidate.goto(invite.link);
  await expect(candidate.getByRole("heading", { level: 1, name: "Link not recognised" })).toBeVisible();
  await candidate.goto(`/a/${fresh}`);
  await expect(candidate.getByRole("heading", { level: 1, name: `${company.name} invited you to an assessment` })).toBeVisible();
});

test("revoke withdraws the invite and the candidate sees that", async ({ page, hiring }) => {
  const { invite, company } = hiring;
  await signInViaUi(page, hiring.company.users.recruiter, `/app/${company.slug}/jobs/${hiring.jobId}`);

  // Cancelling the confirm does nothing.
  page.once("dialog", (d) => void d.dismiss());
  await inviteRow(page, invite.email).getByRole("button", { name: "Revoke" }).click();
  await expect(inviteRow(page, invite.email).getByText("Invited", { exact: true })).toBeVisible();

  page.once("dialog", (d) => void d.accept());
  await inviteRow(page, invite.email).getByRole("button", { name: "Revoke" }).click();
  await expect(inviteRow(page, invite.email).getByText("Revoked", { exact: true })).toBeVisible();
  await expect(inviteRow(page, invite.email).getByText(`Revoked ${invite.email}'s invite.`)).toBeVisible();
  await expect(inviteRow(page, invite.email).getByRole("button", { name: "Revoke" })).toHaveCount(0);

  const candidate = await page.context().newPage();
  await candidate.goto(invite.link);
  await expect(candidate.getByRole("heading", { level: 1, name: "Invitation withdrawn" })).toBeVisible();
  await expect(candidate.getByText(/withdrew this invitation, so the link no longer works/)).toBeVisible();
});
