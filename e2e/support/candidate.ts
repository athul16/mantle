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
    // "Continue" on a fresh link; "Email me a new code" when the test was started on another device.
    const button = page.getByRole("button", { name: /^(Continue|Email me a new code)$/ });
    await button.click();
    await expect(page).toHaveURL(/\/verify\?sent=1/);
    await expect(page.getByText(/We sent a 6-digit code to/)).toBeVisible();
    return codeFrom(await waitForEmail(invite.email, { after: before }));
  }

  /** Fills the verify form and submits it. */
  async function submitCode(code: string, { name = CANDIDATE_NAME, consent = true } = {}) {
    await page.getByLabel("Full name").fill(name);
    await page.getByLabel("Code from your email").fill(code);
    if (consent) await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: "Continue", exact: true }).click();
  }

  /** From the invite link to the system check page. */
  async function verify(invite: InviteRef, name = CANDIDATE_NAME) {
    const code = await requestCode(invite);
    await submitCode(code, { name });
    await expect(page).toHaveURL(/\/check$/);
    await expect(page.getByRole("heading", { level: 1, name: "Check your setup" })).toBeVisible();
  }

  /** From the invite link into the running workspace. */
  async function startTest(invite: InviteRef) {
    await verify(invite);
    await page.getByRole("link", { name: "Continue", exact: true }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Practice run" })).toBeVisible();
    await page.getByRole("button", { name: /^Start the \d+-minute test$/ }).click();
    await expect(page).toHaveURL(/\/workspace$/);
    await expect(page.getByRole("timer")).toBeVisible();
  }

  /** The header's Inbox button; its name carries the unread count ("Inbox 2 unread", or just "Inbox"). */
  const inboxButton = () => page.getByRole("banner").getByRole("button", { name: /^Inbox/ });

  /** Opens the inbox drawer (no-op when it's already open on the message list). */
  async function openInbox() {
    if (await page.getByRole("list", { name: "Messages" }).isVisible()) return;
    const back = page.getByRole("dialog", { name: "Inbox" }).getByRole("button", { name: "Inbox", exact: true });
    if (await back.isVisible()) return back.click();
    await inboxButton().click();
  }

  /** A message row in the inbox drawer, by subject (open the drawer first with openInbox()). */
  const message = (subject: string | RegExp) =>
    page.getByRole("list", { name: "Messages" }).getByRole("button", { name: subject });

  /** A task in the workspace header's task navigation. */
  const task = (name: string | RegExp) => page.getByRole("navigation", { name: "Tasks" }).getByRole("button", { name });

  /** Waits for the autosave indicator to settle on saved (it says "Saving…" while a save is pending). */
  async function saved() {
    await expect(page.getByTestId("save-status")).toHaveText("Saved", { timeout: 15_000 });
  }

  /** Seconds left on the workspace timer. */
  async function secondsLeft(): Promise<number> {
    const text = (await page.getByRole("timer").textContent()) ?? "";
    const parts = text.trim().split(":").map(Number);
    return parts.reduce((acc, n) => acc * 60 + n, 0);
  }

  return { requestCode, submitCode, verify, startTest, inboxButton, openInbox, message, task, saved, secondsLeft };
}

export type CandidateHelpers = ReturnType<typeof candidateHelpers>;
