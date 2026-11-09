/** Signing company users in through the real login form, and reusable storage state. */
import { expect, type Browser, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import type { TestUser } from "../../tests/helpers/factories";

/** Fills and submits /login, then waits until the app has redirected away from it. */
export async function signInViaUi(page: Page, user: Pick<TestUser, "email" | "password">, next?: string) {
  await page.goto(next ? `/login?next=${encodeURIComponent(next)}` : "/login");
  await page.getByLabel("Work email").fill(user.email);
  await page.getByLabel("Password").fill(user.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).not.toHaveURL(/\/login(\?|$)/);
}

/**
 * Signs `user` in once in a throwaway context and saves the cookies to a file,
 * for `browser.newContext({ storageState })` or `test.use({ storageState })`.
 */
export async function storageStateFor(browser: Browser, user: Pick<TestUser, "email" | "password">): Promise<string> {
  const dir = path.join(process.cwd(), "test-results", ".auth");
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, `${user.email}.json`);
  const context = await browser.newContext();
  try {
    await signInViaUi(await context.newPage(), user);
    await context.storageState({ path: file });
  } finally {
    await context.close();
  }
  return file;
}
