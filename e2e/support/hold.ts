/**
 * Holds requests until released, so a test can see a button's pending state
 * deterministically instead of racing a fast server.
 *
 *   const held = await hold(page, isServerAction);
 *   await button.click();
 *   await expect(page.getByRole("button", { name: "Saving…" })).toBeDisabled();
 *   await held.release();
 */
import type { Page, Request } from "@playwright/test";

export const isServerAction = (req: Request) => req.method() === "POST" && "next-action" in req.headers();

export async function hold(page: Page, match: (req: Request) => boolean) {
  let open!: () => void;
  const gate = new Promise<void>((resolve) => (open = resolve));
  let seen!: () => void;
  const arrived = new Promise<void>((resolve) => (seen = resolve));
  const handler = async (route: import("@playwright/test").Route) => {
    if (match(route.request())) {
      seen();
      await gate;
    }
    await route.fallback();
  };
  await page.route("**/*", handler);
  return {
    /** Resolves once a matching request has been caught. */
    arrived,
    async release() {
      open();
      await page.unroute("**/*", handler);
    },
  };
}
