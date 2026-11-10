/** Employer sign up, onboarding, log in and out, company URLs and the org switcher. */
import { hold, isServerAction } from "../support/hold";
import { db, memberIds, orgIdForSlug } from "../support/db";
import { chromiumOnly, expect, test } from "../support/test";

test.describe("core", () => {
  // Sign up → onboarding → dashboard is a core happy path: all three browsers.
  test("a new employer signs up, names the company and lands on its URL", async ({ page, data, land }) => {
    const email = data.email("signup");
    const companyName = `Signup Co ${data.run}`;

    await page.goto("/signup");
    await land(/\/signup$/, "Create a company account");
    await page.getByLabel("Work email").fill(email);
    await page.getByLabel("Password").fill("correct-horse-battery");
    await page.getByRole("button", { name: "Create account" }).click();

    await land(/\/onboarding$/, "Set up your company");
    await page.getByLabel("Company name").fill(companyName);
    await page.getByRole("button", { name: "Create company" }).click();

    await expect(page).toHaveURL(/\/app\/[a-z0-9-]+$/);
    const slug = new URL(page.url()).pathname.split("/")[2];
    const orgId = await orgIdForSlug(slug);
    data.trackOrg(orgId);
    for (const m of await memberIds(orgId)) data.trackUser(m.user_id);

    await land(new RegExp(`/app/${slug}$`), companyName);
    await expect(page.getByText("You're signed in as admin.")).toBeVisible();
    await expect(page.getByRole("navigation").getByRole("link", { name: "Jobs" })).toHaveAttribute("href", `/app/${slug}/jobs`);
  });
});

test.describe("chromium", () => {
  chromiumOnly();

  test("sign in shows a pending state, then signing out returns to login", async ({ page, company, land }) => {
    const admin = company.users.admin;
    await page.goto("/login");
    await page.getByLabel("Work email").fill(admin.email);
    await page.getByLabel("Password").fill(admin.password);

    const held = await hold(page, isServerAction);
    await page.getByRole("button", { name: "Sign in" }).click();
    await held.arrived;
    await expect(page.getByRole("button", { name: "Please wait…" })).toBeDisabled();
    await held.release();

    await land(new RegExp(`/app/${company.slug}$`), company.name);
    await page.getByRole("button", { name: "Sign out" }).click();
    await land(/\/login$/, "Sign in");

    // Signed out, company pages bounce to login and come back after it.
    await page.goto(`/app/${company.slug}/jobs`);
    await expect(page).toHaveURL(new RegExp(`/login\\?next=${encodeURIComponent(`/app/${company.slug}/jobs`)}`));
    await page.getByLabel("Work email").fill(admin.email);
    await page.getByLabel("Password").fill(admin.password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await land(new RegExp(`/app/${company.slug}/jobs$`), "Jobs");
  });

  test("a wrong password shows an error and keeps the user on login", async ({ page, company }) => {
    await page.goto("/login");
    await page.getByLabel("Work email").fill(company.users.admin.email);
    await page.getByLabel("Password").fill("not-the-password");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByText("Email or password is incorrect.")).toBeVisible();
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole("button", { name: "Sign in" })).toBeEnabled();
  });

  test("a signed-in user visiting login is sent to their company", async ({ page, company, signInAs }) => {
    await signInAs("recruiter");
    await page.goto("/login");
    await expect(page).toHaveURL(new RegExp(`/app/${company.slug}$`));
  });

  test("the org switcher moves between companies and /app remembers the last one", async ({ page, company, data, signInAs, land }) => {
    // The admin also joins a second company.
    const second = await data.company({ name: `Second Co ${data.run}` });
    await db().from("memberships").insert({ org_id: second.orgId, user_id: company.users.admin.id, role: "viewer" });

    await signInAs("admin");
    const switcher = page.getByLabel("Company");
    await expect(switcher).toHaveValue(company.orgId);

    await switcher.selectOption({ label: second.name });
    await land(new RegExp(`/app/${second.slug}$`), second.name);
    await expect(page.getByText("You're signed in as viewer.")).toBeVisible();

    await page.goto("/app");
    await expect(page).toHaveURL(new RegExp(`/app/${second.slug}$`));

    // Both companies stay reachable by URL, e.g. in two tabs.
    const other = await page.context().newPage();
    await other.goto(`/app/${company.slug}`);
    await expect(other.getByRole("heading", { level: 1, name: company.name })).toBeVisible();
  });

  test("a user with no company is sent to onboarding", async ({ page, data, land }) => {
    const user = await data.user("lonely");
    await page.goto("/login");
    await page.getByLabel("Work email").fill(user.email);
    await page.getByLabel("Password").fill(user.password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await land(/\/onboarding$/, "Set up your company");
  });
});
