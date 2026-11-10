/**
 * Admin two-factor authentication (docs/02-security-and-integrity.md): company
 * admins must be at aal2 to use company pages. The server redirects; these
 * tests go through the real pages with codes generated from the secret.
 */
import { signInViaUi } from "./fixtures";
import { enterCode } from "./fixtures/auth";
import { expect, test } from "./support/test";
import { serviceClient } from "../tests/helpers/supabase";

test.describe("admin two-factor", () => {
  test("an admin without a factor is sent to enrol, enrols with a code and reaches the page", async ({ page, data, land }) => {
    const co = await data.company({ adminMfa: false });
    await signInViaUi(page, co.users.admin, `/app/${co.slug}/team`);

    // Every company page sends them to set up two-factor, remembering where they were going.
    await land(/\/app\/account\/security\?next=/, "Two-factor authentication");
    await page.goto(`/app/${co.slug}/jobs`);
    await expect(page).toHaveURL(new RegExp(`/app/account/security\\?next=${encodeURIComponent(`/app/${co.slug}/jobs`)}`));
    await expect(page.getByText(/keep .*authenticator/i).first()).toBeVisible();

    await page.getByRole("button", { name: "Set up an authenticator app" }).click();
    await expect(page.getByRole("img", { name: /QR code/i })).toBeVisible();
    const secret = (await page.getByTestId("totp-secret").textContent())!.replace(/\s/g, "");
    expect(secret).toMatch(/^[A-Z2-7]{16,}$/);

    // A wrong code is refused and nothing changes.
    await page.getByLabel("6-digit code").fill("000000");
    await page.getByRole("button", { name: "Turn on two-factor authentication" }).click();
    await expect(page.getByRole("alert")).toContainText(/code/i);

    await enterCode(page, secret, "Turn on two-factor authentication");
    await land(new RegExp(`/app/${co.slug}/jobs$`), "Jobs");

    // The factor is verified in Supabase Auth.
    const { data: factors } = await serviceClient().auth.admin.mfa.listFactors({ userId: co.users.admin.id });
    expect(factors?.factors.filter((f) => f.status === "verified")).toHaveLength(1);

    // The security page now lists it.
    await page.goto("/app/account/security");
    await expect(page.getByRole("list", { name: "Authenticator apps" }).getByRole("listitem")).toHaveCount(1);
  });

  test("an admin with a factor who signs in with a password is sent to verify, then reaches the page", async ({ page, company, land }) => {
    const admin = company.users.admin;
    await signInViaUi(page, admin, `/app/${company.slug}/team`, { mfa: false });

    await land(/\/app\/account\/verify\?next=/, "Enter your sign-in code");
    // Other company pages bounce to verify too; the security page doesn't let them add a factor at aal1.
    await page.goto(`/app/${company.slug}`);
    await expect(page).toHaveURL(/\/app\/account\/verify\?next=/);
    await page.goto("/app/account/security");
    await expect(page).toHaveURL(/\/app\/account\/verify/);

    await page.goto(`/app/account/verify?next=${encodeURIComponent(`/app/${company.slug}/team`)}`);
    await page.getByLabel("6-digit code").fill("000000");
    await page.getByRole("button", { name: "Verify" }).click();
    await expect(page.getByRole("alert")).toContainText(/code/i);

    await enterCode(page, admin.totpSecret!, "Verify");
    await land(new RegExp(`/app/${company.slug}/team$`), "Team");
  });

  test("a recruiter is not forced to set up two-factor", async ({ page, company, signInAs, land }) => {
    await signInAs("recruiter", `/app/${company.slug}/jobs`);
    await land(new RegExp(`/app/${company.slug}/jobs$`), "Jobs");
    await page.goto(`/app/${company.slug}`);
    await land(new RegExp(`/app/${company.slug}$`), company.name);
    // They can still turn it on from the security page if they want.
    await page.goto("/app/account/security");
    await land(/\/app\/account\/security$/, "Two-factor authentication");
    await expect(page.getByRole("button", { name: "Set up an authenticator app" })).toBeVisible();
  });

  test("an admin at aal2 can remove a factor, and is then asked to enrol again", async ({ page, company, signInAs, land }) => {
    await signInAs("admin", `/app/${company.slug}`);
    await land(new RegExp(`/app/${company.slug}$`), company.name);

    await page.goto("/app/account/security");
    await land(/\/app\/account\/security$/, "Two-factor authentication");
    const factors = page.getByRole("list", { name: "Authenticator apps" }).getByRole("listitem");
    await expect(factors).toHaveCount(1);
    page.once("dialog", (d) => void d.accept());
    await factors.first().getByRole("button", { name: /Remove/ }).click();
    await expect(factors).toHaveCount(0);

    await page.goto(`/app/${company.slug}`);
    await expect(page).toHaveURL(/\/app\/account\/security\?next=/);
  });
});
