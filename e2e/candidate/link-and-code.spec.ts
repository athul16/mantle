/** Invite link and email code: no side effects on load, lockout, expiry, blocked invites. */
import { ageCode, db, expireCode, inviteRow, inviteSecret } from "../support/db";
import { chromiumOnly, expect, outbox, test } from "../support/test";

chromiumOnly();

test("opening the landing page twice uses nothing up", async ({ page, hiring, land }) => {
  const { invite, company } = hiring;
  for (let i = 0; i < 2; i++) {
    await page.goto(invite.link);
    await land(/\/a\/[\w-]+$/, `${company.name} invited you to an assessment`);
  }
  expect(await outbox.emailsTo(invite.email)).toHaveLength(0);
  expect((await inviteSecret(invite.inviteId)).code_hash).toBeNull();
  expect((await inviteRow(invite.inviteId)).status).toBe("invited");
  // The link still works for the real candidate.
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(/\/verify\?sent=1$/);
});

test("five wrong codes lock the code; a new code then works", async ({ page, hiring, candidate, land }) => {
  const { invite } = hiring;
  const code = await candidate.requestCode(invite);
  const wrong = `${(Number(code[0]) + 1) % 10}${code.slice(1)}`;

  for (let left = 4; left >= 1; left--) {
    await candidate.submitCode(wrong);
    await expect(page.getByText(`That code isn't right. ${left} ${left === 1 ? "try" : "tries"} left before you need a new code.`)).toBeVisible();
  }
  await candidate.submitCode(wrong);
  await land(/\/verify\?error=locked/, "Check your email");
  await expect(page.getByText("Too many wrong codes. Ask for a new code.")).toBeVisible();

  // Even the right code is refused now.
  await candidate.submitCode(code);
  await expect(page.getByText("Too many wrong codes. Ask for a new code.")).toBeVisible();

  // Asking again within 30 seconds is throttled.
  await page.getByRole("button", { name: "Send a new code" }).click();
  await expect(page.getByText("We just sent a code. Wait a few seconds before asking for another.")).toBeVisible();

  await ageCode(invite.inviteId, 31);
  const before = new Date().toISOString();
  await page.getByRole("button", { name: "Send a new code" }).click();
  await expect(page.getByText(/We sent a 6-digit code to/)).toBeVisible();
  const fresh = outbox.codeFrom(await outbox.waitForEmail(invite.email, { after: before }));
  await candidate.submitCode(fresh);
  await land(/\/check$/, "System check", { exclude: [".text-neutral-400"] });
});

test("an expired code is refused", async ({ page, hiring, candidate }) => {
  const code = await candidate.requestCode(hiring.invite);
  await expireCode(hiring.invite.inviteId);
  await candidate.submitCode(code);
  await expect(page.getByText("That code has expired. Ask for a new code.")).toBeVisible();
  await expect(page).toHaveURL(/\/verify\?error=code_expired/);
});

test("the verify form needs a name, a 6-digit code and consent", async ({ page, hiring, candidate }) => {
  const code = await candidate.requestCode(hiring.invite);
  // Browser validation stops an unticked consent box before anything is sent.
  await candidate.submitCode(code, { consent: false });
  await expect(page).toHaveURL(/\/verify\?sent=1$/);
  expect(await page.getByRole("checkbox").evaluate((el: HTMLInputElement) => el.validity.valueMissing)).toBe(true);
  // The code is still usable afterwards.
  await candidate.submitCode(code);
  await expect(page).toHaveURL(/\/check$/);
});

test("an unknown link, an expired invite and a revoked invite each explain themselves", async ({ page, data, hiring, land }) => {
  const { company, jobId } = hiring;
  await page.goto(`/a/${"x".repeat(43)}`);
  await land(/\/a\//, "Link not recognised");
  await expect(page.getByText("This link isn't valid.")).toBeVisible();

  const expired = await data.invite({ orgId: company.orgId, jobId, expiresAt: new Date(Date.now() - 60_000) });
  await page.goto(expired.link);
  await land(/\/a\//, "This invitation has expired");
  await expect(page.getByText(`contact ${company.name}`)).toBeVisible();
  await expect(page.getByRole("button", { name: "Continue" })).toHaveCount(0);

  const revoked = await data.invite({ orgId: company.orgId, jobId, status: "revoked" });
  await page.goto(revoked.link);
  await land(/\/a\//, "Invitation withdrawn");
  await expect(page.getByRole("button", { name: "Continue" })).toHaveCount(0);
});

test("a revoked invite can't be verified even with a code already sent", async ({ page, hiring, candidate, land }) => {
  const code = await candidate.requestCode(hiring.invite);
  await db().from("invites").update({ status: "revoked" }).eq("id", hiring.invite.inviteId);
  await candidate.submitCode(code);
  await land(/\/a\/[\w-]+\?error=revoked$/, "Invitation withdrawn");
});
