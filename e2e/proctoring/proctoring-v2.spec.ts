/**
 * Proctoring v2 in the browser: pasting the emailed code, an assessment with
 * full screen and a microphone (system check rows, the full-screen cover, away
 * captures with their reason), and the recruiter report's label reasons,
 * Copies counter and filmstrip. Chromium only: it has the fake camera, screen
 * and microphone (launch flags below) and a Fullscreen API that works headless.
 */
import { signInViaUi } from "../fixtures";
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
  permissions: ["camera", "microphone"],
});

// An 8×8 JPEG.
const JPEG = Buffer.from(
  "/9j/4AAQSkZJRgABAQAASABIAAD/4QCARXhpZgAATU0AKgAAAAgABAEaAAUAAAABAAAAPgEbAAUAAAABAAAARgEoAAMAAAABAAIAAIdpAAQAAAABAAAATgAAAAAAAABIAAAAAQAAAEgAAAABAAOgAQADAAAAAQABAACgAgAEAAAAAQAAAAigAwAEAAAAAQAAAAgAAAAA/+0AOFBob3Rvc2hvcCAzLjAAOEJJTQQEAAAAAAAAOEJJTQQlAAAAAAAQ1B2M2Y8AsgTpgAmY7PhCfv/AABEIAAgACAMBIgACEQEDEQH/xAAfAAABBQEBAQEBAQAAAAAAAAAAAQIDBAUGBwgJCgv/xAC1EAACAQMDAgQDBQUEBAAAAX0BAgMABBEFEiExQQYTUWEHInEUMoGRoQgjQrHBFVLR8CQzYnKCCQoWFxgZGiUmJygpKjQ1Njc4OTpDREVGR0hJSlNUVVZXWFlaY2RlZmdoaWpzdHV2d3h5eoOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4eLj5OXm5+jp6vHy8/T19vf4+fr/xAAfAQADAQEBAQEBAQEBAAAAAAAAAQIDBAUGBwgJCgv/xAC1EQACAQIEBAMEBwUEBAABAncAAQIDEQQFITEGEkFRB2FxEyIygQgUQpGhscEJIzNS8BVictEKFiQ04SXxFxgZGiYnKCkqNTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqCg4SFhoeIiYqSk5SVlpeYmZqio6Slpqeoqaqys7S1tre4ubrCw8TFxsfIycrS09TV1tfY2dri4+Tl5ufo6ery8/T19vf4+fr/2wBDAAICAgICAgMCAgMFAwMDBQYFBQUFBggGBgYGBggKCAgICAgICgoKCgoKCgoMDAwMDAwODg4ODg8PDw8PDw8PDw//2wBDAQICAgQEBAcEBAcQCwkLEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBD/3QAEAAH/2gAMAwEAAhEDEQA/API6KKK/tQ/kc//Z",
  "base64",
);

async function v2Invite(data: TestData, proctoring: Record<string, boolean>) {
  const co = await data.company();
  const { assessmentId, scenarioId } = await data.assessment({ orgId: co.orgId });
  must(await db().from("assessments").update({ proctoring }).eq("id", assessmentId));
  const { jobId } = await data.job({ orgId: co.orgId, assessmentId });
  const invite = await data.invite({ orgId: co.orgId, jobId });
  return { co, invite, assessmentId, scenarioId, jobId };
}

test("pasting the code as it appears in the email ('123 456') fills all six digits", async ({ page, data, candidate }) => {
  const { invite } = await v2Invite(data, {});
  const code = await candidate.requestCode(invite);
  const field = page.getByLabel("Code from your email");

  const paste = (text: string) =>
    field.evaluate((el: HTMLInputElement, t: string) => {
      el.focus();
      const dt = new DataTransfer();
      dt.setData("text/plain", t);
      el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
    }, text);

  await paste("123 456");
  await expect(field).toHaveValue("123456");

  // The real code, pasted the way the email shows it, signs the candidate in.
  await paste(`${code.slice(0, 3)} ${code.slice(3)}`);
  await expect(field).toHaveValue(code);
  await page.getByLabel("Full name").fill("Jamie Rivera");
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page).toHaveURL(/\/check$/);
});

test("full screen and microphone: system check rows, the full-screen cover, and away captures", async ({ page, data, candidate, a11y }) => {
  const { invite } = await v2Invite(data, { camera: true, screen: true, fullscreen: true, microphone: true });

  const code = await candidate.requestCode(invite);
  // The notice names the audio clips and full screen too.
  await expect(page.getByRole("list", { name: "What we record" })).toContainText("Short audio clips");
  await expect(page.getByText("The test runs in full screen. Leaving it covers the task.")).toBeVisible();
  await candidate.submitCode(code);
  await expect(page.getByRole("heading", { level: 1, name: "Check your setup" })).toBeVisible();

  const row = (name: string) => page.getByRole("listitem").filter({ hasText: name });
  await expect(row("Microphone").first()).toContainText("Allowed");
  // The sound check row shows once the microphone is open; the fake device may or may not be "heard", both are fine.
  await expect(row("Sound check")).toBeVisible();
  await page.getByRole("button", { name: "Take start photo" }).click();
  await expect(row("Start photo")).toContainText("Taken");
  await page.getByRole("button", { name: "Share entire screen" }).click();
  await expect(row("Screen sharing")).toContainText("Entire screen shared");
  await a11y();

  const attempt = must(await db().from("attempts").select("id").eq("invite_id", invite.inviteId).single());
  await page.getByRole("link", { name: "Continue", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Practice run" })).toBeVisible();
  await page.getByRole("button", { name: /^Start the \d+-minute test$/ }).click();
  await expect(page).toHaveURL(/\/workspace$/);

  // Camera, screen and microphone carried over, but the page is not in full screen: the test is covered, the timer runs.
  const cover = page.getByRole("dialog", { name: "Go full screen to start" });
  await expect(cover).toBeVisible();
  await expect(page.getByRole("timer")).toBeVisible();
  await a11y();
  await cover.getByRole("button", { name: "Go full screen" }).click();
  await expect(cover).toHaveCount(0);
  expect(await page.evaluate(() => !!document.fullscreenElement)).toBe(true);
  const status = page.getByRole("status", { name: "Monitoring" });
  await expect(status).toContainText("Camera on");
  await expect(status).toContainText("Screen shared");
  await expect(page.getByRole("img", { name: "Microphone on" })).toBeVisible();

  // Leaving the window takes camera and screen captures tagged "away" (about 2 s and 6 s in), and one on return.
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  await expect
    .poll(
      async () => {
        const rows = must(await db().from("media").select("source, reason").eq("attempt_id", attempt.id).eq("reason", "away"));
        return new Set(rows.map((r) => r.source));
      },
      { timeout: 20_000 },
    )
    .toEqual(new Set(["camera", "screen"]));
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect
    .poll(async () => must(await db().from("media").select("id").eq("attempt_id", attempt.id).eq("reason", "returned")).length, { timeout: 20_000 })
    .toBeGreaterThan(0);

  // Leaving full screen covers the test again; the timer keeps running.
  await page.evaluate(() => document.exitFullscreen());
  const back = page.getByRole("dialog", { name: "Return to full screen" });
  await expect(back).toBeVisible();
  await back.getByRole("button", { name: "Go full screen" }).click();
  await expect(back).toHaveCount(0);
  await expect
    .poll(async () => must(await db().from("integrity_events").select("kind").eq("attempt_id", attempt.id)).map((r) => r.kind), { timeout: 20_000 })
    .toEqual(expect.arrayContaining(["fullscreen_entered", "fullscreen_exited", "left_window", "returned_to_window"]));
});

test("a recruiter sees why the label is suspicious, the Copies counter and the screenshots while away", async ({ page, data, land, a11y }) => {
  const { co, invite, scenarioId } = await v2Invite(data, { camera: true, screen: true, fullscreen: true, microphone: true });
  const startedAt = new Date(Date.now() - 30 * 60_000);
  const { attemptId } = await data.attempt({ orgId: co.orgId, inviteId: invite.inviteId, scenarioId, status: "submitted", startedAt });
  must(await db().from("attempts").update({ submitted_at: new Date().toISOString(), submit_reason: "candidate", integrity_label: "suspicious" }).eq("id", attemptId));
  const at = (s: number) => new Date(startedAt.getTime() + s * 1000).toISOString();
  const paths: string[] = [];
  try {
    const insert = async (kind: string, when: string, payload: Record<string, number> = {}) =>
      must(await db().from("integrity_events").insert({ attempt_id: attemptId, org_id: co.orgId, kind, at: when, payload }).select("id").single()).id;
    const leftId = await insert("left_window", at(600));
    await insert("returned_to_window", at(615), { awayMs: 15_000 });
    await insert("copied", at(300), { chars: 40 });
    await insert("copied", at(320), { chars: 12 });
    await insert("cut", at(340), { chars: 5 });
    const cameraId = await insert("camera_stopped", at(620));

    const shots: { source: "camera" | "screen"; reason: "away" | "returned"; s: number }[] = [
      { source: "screen", reason: "away", s: 602 },
      { source: "camera", reason: "away", s: 602 },
      { source: "screen", reason: "away", s: 606 },
      { source: "screen", reason: "returned", s: 615 },
    ];
    const mediaIds: number[] = [];
    for (const [n, shot] of shots.entries()) {
      const path = `${co.orgId}/${attemptId}/${shot.source}/${Date.now()}-${n}-v2.jpg`;
      must(await db().storage.from("proctoring").upload(path, JPEG, { contentType: "image/jpeg" }));
      paths.push(path);
      const row = must(
        await db()
          .from("media")
          .insert({ attempt_id: attemptId, org_id: co.orgId, source: shot.source, storage_path: path, at: at(shot.s), reason: shot.reason })
          .select("id")
          .single(),
      );
      mediaIds.push(row.id);
    }
    must(
      await db()
        .from("flags")
        .insert([
          {
            attempt_id: attemptId,
            org_id: co.orgId,
            rule: "left_window",
            reason: "Left the test window 1 time",
            evidence: { events: [{ id: leftId, kind: "left_window", at: at(600), awayMs: 15_000, mediaIds }], mediaIds: [], total: 1 },
          },
          {
            attempt_id: attemptId,
            org_id: co.orgId,
            rule: "camera",
            reason: "Camera turned off 1 time",
            evidence: { events: [{ id: cameraId, kind: "camera_stopped", at: at(620) }], mediaIds: [], total: 1 },
          },
        ]),
    );

    await signInViaUi(page, co.users.recruiter, `/app/${co.slug}/candidates/${invite.inviteId}`);
    await land(new RegExp(`/candidates/${invite.inviteId}$`), invite.email);

    const section = page.getByRole("region", { name: "Integrity" });
    await expect(section.getByTestId("integrity-label")).toHaveText("Suspicious");
    await expect(section.getByRole("list", { name: "Why this label" })).toContainText("Left the test window, and the camera was turned off");
    await expect(section.getByText("Copies", { exact: true }).locator("xpath=following-sibling::dd")).toHaveText("3");

    const strip = section.getByRole("list", { name: "Screenshots while away" });
    await expect(strip.getByRole("img", { name: "Screen 2 s after leaving" })).toBeVisible();
    await expect(strip.getByRole("img", { name: "Camera 2 s after leaving" })).toBeVisible();
    const thumb = strip.getByRole("img", { name: "Screen when back" });
    await expect(thumb).toBeVisible();
    await expect.poll(() => thumb.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
    await a11y();
  } finally {
    if (paths.length) await db().storage.from("proctoring").remove(paths);
  }
});
