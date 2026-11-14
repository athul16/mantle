/** Signing company users in through the real login form, and reusable storage state. */
import { expect, type Browser, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import type { TestUser } from "../../tests/helpers/factories";
import { totpCode, totpSecretFor } from "../../tests/helpers/totp";

type SignInUser = Pick<TestUser, "email" | "password"> & { totpSecret?: string };

/**
 * Fills and submits /login, then waits until the app has redirected away from it.
 * A user with an authenticator factor (company admins from the factories) also
 * enters the sign-in code, unless `{ mfa: false }` leaves them on the code page.
 */
export async function signInViaUi(page: Page, user: SignInUser, next?: string, { mfa = true }: { mfa?: boolean } = {}) {
  await page.goto(next ? `/login?next=${encodeURIComponent(next)}` : "/login");
  await page.getByLabel("Work email").fill(user.email);
  await page.getByLabel("Password").fill(user.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).not.toHaveURL(/\/login(\?|$)/);
  if (mfa) await completeMfaIfAsked(page, user);
}

/** On the sign-in code page (/app/account/verify), enter the current code and wait to leave it. */
export async function completeMfaIfAsked(page: Page, user: SignInUser) {
  const secret = user.totpSecret ?? totpSecretFor(user.email);
  if (!secret) return;
  // Company admins are sent to the code page by the server; give the redirect a moment to land.
  const onVerify = await page
    .waitForURL(/\/app\/account\/verify/, { timeout: 5_000 })
    .then(() => true)
    .catch(() => false);
  if (!onVerify) return;
  await enterCode(page, secret);
  await expect(page).not.toHaveURL(/\/app\/account\/verify/);
}

/** Types the current authenticator code into the form on the page and submits it. */
export async function enterCode(page: Page, secret: string, button: string | RegExp = /^(Verify|Turn on two-factor)/) {
  // "Code" on the sign-in code page, "Enter the 6-digit code the app shows." when setting up.
  await page.getByRole("textbox", { name: /code/i }).fill(totpCode(secret));
  await page.getByRole("button", { name: button }).click();
}

/**
 * Signs `user` in once in a throwaway context and saves the cookies to a file,
 * for `browser.newContext({ storageState })` or `test.use({ storageState })`.
 */
export async function storageStateFor(browser: Browser, user: SignInUser): Promise<string> {
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
