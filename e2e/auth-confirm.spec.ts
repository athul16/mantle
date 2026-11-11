/**
 * Supabase email links land on /auth/confirm, a page with a button (decision
 * D13 / Q3). Opening the link, as Microsoft Safe Links does before the person
 * clicks, must not use up the one-time token; only the button does. Tokens come
 * from auth.admin.generateLink, the same hash the email templates put in the link.
 */
import { serviceClient } from "../tests/helpers/supabase";
import { expect, test } from "./support/test";

test("a scanner opening a teammate invite doesn't use it up; Accept does", async ({ page, request, company, data, land }) => {
  const email = data.email("invitee");
  const { data: link, error } = await serviceClient().auth.admin.generateLink({ type: "invite", email });
  if (error) throw error;
  data.trackUser(link.user.id);
  await serviceClient().from("memberships").insert({ org_id: company.orgId, user_id: link.user.id, role: "viewer" }).throwOnError();
  const url = `/auth/confirm?token_hash=${link.properties.hashed_token}&type=invite`;

  // The scanner: plain GETs, twice.
  for (let i = 0; i < 2; i++) expect((await request.get(url)).status()).toBe(200);
  const { data: before } = await serviceClient().auth.admin.getUserById(link.user.id);
  expect(before.user?.last_sign_in_at ?? null).toBeNull();

  // The person: the page waits for the button.
  await page.goto(url);
  await land(/\/auth\/confirm\?/, "Almost there");
  await page.getByRole("button", { name: "Accept invite" }).click();
  await land(/\/auth\/set-password$/, "Set your password");
  await page.getByLabel("Password", { exact: true }).fill("correct-horse-battery");
  await page.getByLabel("Confirm password").fill("correct-horse-battery");
  await page.getByRole("button", { name: "Save and continue" }).click();
  await land(new RegExp(`/app/${company.slug}$`), company.name);

  // The link is now used: clicking it again explains, nothing else happens.
  await page.context().clearCookies();
  await page.goto(url);
  await page.getByRole("button", { name: "Accept invite" }).click();
  await expect(page.getByText(/invalid, expired or already used/)).toBeVisible();
  await expect(page).toHaveURL(/\/auth\/confirm\?/);
});

test("a sign-up confirmation link confirms only on the button, then continues to onboarding", async ({ page, request, data, land }) => {
  const email = data.email("confirm");
  const { data: link, error } = await serviceClient().auth.admin.generateLink({ type: "signup", email, password: "correct-horse-battery" });
  if (error) throw error;
  data.trackUser(link.user.id);
  const url = `/auth/confirm?token_hash=${link.properties.hashed_token}&type=email&next=/onboarding`;

  expect((await request.get(url)).status()).toBe(200);
  const { data: before } = await serviceClient().auth.admin.getUserById(link.user.id);
  expect(before.user?.email_confirmed_at ?? null).toBeNull();

  await page.goto(url);
  await page.getByRole("button", { name: "Confirm email" }).click();
  await land(/\/onboarding$/, "Set up your company");
  const { data: after } = await serviceClient().auth.admin.getUserById(link.user.id);
  expect(after.user?.email_confirmed_at).toBeTruthy();
});

test("a link without a token explains itself", async ({ page }) => {
  await page.goto("/auth/confirm");
  await expect(page.getByText(/invalid, expired or already used/)).toBeVisible();
  await expect(page.getByRole("button", { name: /Accept invite|Confirm email/ })).toHaveCount(0);
});
