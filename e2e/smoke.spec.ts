/** Smoke tests: the app boots against the local database and the shared fixtures work. */
import { expect, test } from "./fixtures";

test("login page loads and passes axe", async ({ page, axe }) => {
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await expect(page.getByLabel("Work email")).toBeVisible();
  await expect(page.getByLabel("Password")).toBeVisible();
  await axe();
});

test("a company admin signs in through the UI", async ({ page, company, signInAs }) => {
  await signInAs("admin");
  await expect(page).toHaveURL(new RegExp(`/app/${company.slug}`));
});

test("a fixture invite opens the candidate landing page", async ({ page, hiring }) => {
  await page.goto(hiring.invite.link);
  await expect(page.getByRole("heading", { name: `${hiring.company.name} invited you to an assessment` })).toBeVisible();
});
