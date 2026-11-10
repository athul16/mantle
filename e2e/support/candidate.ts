/** Walks a candidate through the invite flow in the browser. */
import { expect, type Page } from "@playwright/test";
import { codeFrom, waitForEmail } from "../../tests/helpers/outbox";

export type InviteRef = { inviteId: string; email: string; link: string };

export const CANDIDATE_NAME = "Jamie Rivera";

export function candidateHelpers(page: Page) {
  /** Landing → Continue → the verify page with a fresh code in the outbox. Returns the code. */
  async function requestCode(invite: InviteRef): Promise<string> {
    const before = new Date().toISOString();
    await page.goto(invite.link);
    const button = page.getByRole("button", { name: "Continue" });
    await button.click();
    await expect(page).toHaveURL(/\/verify\?sent=1/);
    await expect(page.getByText(/We sent a 6-digit code to/)).toBeVisible();
    return codeFrom(await waitForEmail(invite.email, { after: before }));
  }

  /** Fills the verify form and submits it. */
  async function submitCode(code: string, { name = CANDIDATE_NAME, consent = true } = {}) {
    await page.getByLabel("Your full name").fill(name);
    await page.getByLabel("6-digit code").fill(code);
    if (consent) await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: "Verify and continue" }).click();
  }

  /** From the invite link to the system check page. */
  async function verify(invite: InviteRef, name = CANDIDATE_NAME) {
    const code = await requestCode(invite);
    await submitCode(code, { name });
    await expect(page).toHaveURL(/\/check$/);
    await expect(page.getByRole("heading", { level: 1, name: "System check" })).toBeVisible();
  }

  /** From the invite link into the running workspace. */
  async function startTest(invite: InviteRef) {
    await verify(invite);
    await page.getByRole("link", { name: "Continue to instructions" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Before you start" })).toBeVisible();
    await page.getByRole("button", { name: /^Start the \d+-minute timer$/ }).click();
    await expect(page).toHaveURL(/\/workspace$/);
    await expect(page.getByRole("timer")).toBeVisible();
  }

  /** The inbox button for a message, by subject. */
  const message = (subject: string | RegExp) =>
    page.getByRole("complementary").getByRole("button", { name: subject });

  /** Waits for the autosave indicator to settle on saved. */
  async function saved() {
    await expect(page.getByText("All changes saved")).toBeVisible({ timeout: 15_000 });
  }

  /** Seconds left on the workspace timer. */
  async function secondsLeft(): Promise<number> {
    const text = (await page.getByRole("timer").textContent()) ?? "";
    const parts = text.trim().split(":").map(Number);
    return parts.reduce((acc, n) => acc * 60 + n, 0);
  }

  return { requestCode, submitCode, verify, startTest, message, saved, secondsLeft };
}

export type CandidateHelpers = ReturnType<typeof candidateHelpers>;
