/**
 * A candidate takes a proctored test: consent, camera check with a start
 * photo, entire-screen share, the monitored workspace, snapshots in private
 * storage, browser signals turning into a flag, and sharing stopping and
 * restarting. Chromium only: it is the browser with fake camera and screen
 * capture (Playwright launch flags below).
 */
import type { Page } from "@playwright/test";
import { db } from "../support/db";
import { chromiumOnly, expect, test } from "../support/test";
import type { TestData } from "../../tests/helpers/factories";
import { must } from "../../tests/helpers/supabase";

chromiumOnly();

test.use({
  launchOptions: {
    args: [
      "--use-fake-ui-for-media-stream",
      "--use-fake-device-for-media-stream",
      "--auto-select-desktop-capture-source=Entire screen",
    ],
  },
  permissions: ["camera"],
});

/** Keeps a handle on the shared-screen stream so a test can end it like the browser's "Stop sharing" bar. */
async function captureScreenStream(page: Page) {
  await page.addInitScript(() => {
    const md = navigator.mediaDevices;
    const original = md.getDisplayMedia.bind(md);
    md.getDisplayMedia = async (options?: DisplayMediaStreamOptions) => {
      const stream = await original(options);
      (window as unknown as { __screen: MediaStream }).__screen = stream;
      return stream;
    };
  });
}

async function endScreenShare(page: Page) {
  await page.evaluate(() => {
    const track = (window as unknown as { __screen: MediaStream }).__screen.getVideoTracks()[0];
    track.stop();
    track.dispatchEvent(new Event("ended"));
  });
}

async function proctoredInvite(data: TestData) {
  const co = await data.company();
  const { assessmentId } = await data.assessment({ orgId: co.orgId, proctoring: { camera: true, screen: true } });
  const { jobId } = await data.job({ orgId: co.orgId, assessmentId });
  const invite = await data.invite({ orgId: co.orgId, jobId });
  return { co, invite };
}

const mediaFor = async (attemptId: string) =>
  must(await db().from("media").select("source, storage_path").eq("attempt_id", attemptId));

test("a candidate consents, passes the camera and screen checks and is monitored in the workspace", async ({ page, data, candidate, a11y }) => {
  await captureScreenStream(page);
  const { co, invite } = await proctoredInvite(data);

  // The verify page shows what is recorded, why and for how long before the one consent box.
  const code = await candidate.requestCode(invite);
  const notice = page.getByRole("list", { name: "What we record" });
  await expect(notice).toContainText("A camera photo every 30 to 60 seconds");
  await expect(notice).toContainText("A screenshot of your entire screen");
  await expect(page.getByText(/Photos and screenshots are deleted after \d+ days, answers and results after \d+ days\./)).toBeVisible();
  await expect(page.getByRole("checkbox", { name: /agree to camera snapshots, screen sharing and activity recording/ })).toBeVisible();
  await a11y();
  await candidate.submitCode(code);
  await expect(page.getByRole("heading", { level: 1, name: "Check your setup" })).toBeVisible();

  // Consent was given on the verify page, so the camera starts by itself; the start photo is explicit.
  await expect(page.getByRole("listitem").filter({ hasText: "Camera" })).toContainText("Allowed");
  await expect(page.getByRole("link", { name: "Continue", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Take start photo" }).click();
  await expect(page.getByRole("listitem").filter({ hasText: "Start photo" })).toContainText("Taken");
  await page.getByRole("button", { name: "Share entire screen" }).click();
  await expect(page.getByRole("listitem").filter({ hasText: "Screen sharing" })).toContainText("Entire screen shared");
  await a11y();

  const attempt = must(await db().from("attempts").select("id").eq("invite_id", invite.inviteId).single());
  // Consent is on record, with what was agreed to.
  const consentRows = must(await db().from("integrity_events").select("payload").eq("attempt_id", attempt.id).eq("kind", "consented_to_monitoring"));
  expect(consentRows).toEqual([{ payload: expect.objectContaining({ camera: true, screen: true }) }]);
  // The start photo is in the attempt's own folder of the private bucket.
  await expect.poll(async () => (await mediaFor(attempt.id)).map((m) => m.source)).toContain("camera");

  await page.getByRole("link", { name: "Continue", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Practice run" })).toBeVisible();
  await expect(page.getByText("Camera and screen sharing", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: /^Start the \d+-minute test$/ }).click();
  await expect(page).toHaveURL(/\/workspace$/);

  // The streams from the system check carry over: no second prompt, no cover.
  const status = page.getByRole("status", { name: "Monitoring" });
  await expect(status).toContainText("Camera on");
  await expect(status).toContainText("Screen shared");
  await expect(page.getByRole("dialog", { name: "Turn on monitoring to continue" })).toHaveCount(0);
  await a11y();

  await expect
    .poll(async () => new Set((await mediaFor(attempt.id)).map((m) => m.source)), { timeout: 20_000 })
    .toEqual(new Set(["camera", "screen"]));
  for (const m of await mediaFor(attempt.id)) expect(m.storage_path.startsWith(`${co.orgId}/${attempt.id}/${m.source}/`)).toBe(true);

  // Leaving the window three times raises a flag with evidence.
  for (let n = 0; n < 3; n++) {
    await page.evaluate(() => window.dispatchEvent(new Event("blur")));
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  }
  await expect
    .poll(async () => must(await db().from("flags").select("rule, status").eq("attempt_id", attempt.id)), { timeout: 20_000 })
    .toEqual([{ rule: "left_window", status: "open" }]);

  // Stopping the share covers the workspace (the timer keeps running) until it is shared again.
  await endScreenShare(page);
  const cover = page.getByRole("dialog", { name: "Screen sharing stopped" });
  await expect(cover).toContainText("Screen sharing stopped. Share your entire screen again to continue.");
  await expect(cover).toContainText("The timer is still running.");
  await a11y();
  await cover.getByRole("button", { name: "Share entire screen" }).click();
  await expect(cover).toHaveCount(0);
  // The gap is recorded for the report (D4), closed when the share came back.
  await expect
    .poll(
      async () =>
        must(await db().from("integrity_events").select("payload").eq("attempt_id", attempt.id).eq("kind", "monitoring_down")).map(
          (r) => (r.payload as { source: string; closedBy: string }).source + ":" + (r.payload as { closedBy: string }).closedBy,
        ),
      { timeout: 20_000 },
    )
    .toEqual(["screen:reconnected"]);
  await expect
    .poll(async () => must(await db().from("flags").select("rule").eq("attempt_id", attempt.id).eq("rule", "screen_share")), { timeout: 20_000 })
    .toHaveLength(1);
});

test("after a reload the workspace asks for the screen again before showing the test", async ({ page, data, candidate }) => {
  const { invite } = await proctoredInvite(data);
  await candidate.verify(invite);
  await page.getByRole("button", { name: "Take start photo" }).click();
  await expect(page.getByRole("listitem").filter({ hasText: "Start photo" })).toContainText("Taken");
  await page.getByRole("button", { name: "Share entire screen" }).click();
  await page.getByRole("link", { name: "Continue", exact: true }).click();
  await page.getByRole("button", { name: /^Start the \d+-minute test$/ }).click();
  await expect(page).toHaveURL(/\/workspace$/);

  await page.reload();
  const cover = page.getByRole("dialog", { name: "Turn on monitoring to continue" });
  await expect(cover).toBeVisible();
  await expect(page.getByRole("timer")).toBeVisible();
  await cover.getByRole("button", { name: "Share entire screen" }).click();
  await expect(cover).toHaveCount(0);
  await expect(page.getByRole("status", { name: "Monitoring" })).toContainText("Screen shared");
});

test("a candidate who cancels the screen share cannot continue and is told why", async ({ page, data, candidate }) => {
  await page.addInitScript(() => {
    navigator.mediaDevices.getDisplayMedia = async () => {
      throw new DOMException("Permission denied", "NotAllowedError");
    };
  });
  const { invite } = await proctoredInvite(data);
  await candidate.verify(invite);
  await page.getByRole("button", { name: "Share entire screen" }).click();
  await expect(page.getByText("Screen sharing was cancelled. You need to share your entire screen to take this test.")).toBeVisible();
  await expect(page.getByRole("listitem").filter({ hasText: "Screen sharing" })).toContainText("Not shared yet");
  await expect(page.getByRole("link", { name: "Continue", exact: true })).toHaveCount(0);
});
