/**
 * Integrity flags on the candidate report: the Integrity card's badge and
 * signal rows, evidence with snapshot thumbnails, a recruiter clearing a flag with a note,
 * and a viewer who can read the flags but not review them or see snapshots.
 */
import { signInViaUi } from "../fixtures";
import { db } from "../support/db";
import { expect, test } from "../support/test";
import type { TestData } from "../../tests/helpers/factories";
import { must } from "../../tests/helpers/supabase";

// An 8×8 JPEG.
const JPEG = Buffer.from(
  "/9j/4AAQSkZJRgABAQAASABIAAD/4QCARXhpZgAATU0AKgAAAAgABAEaAAUAAAABAAAAPgEbAAUAAAABAAAARgEoAAMAAAABAAIAAIdpAAQAAAABAAAATgAAAAAAAABIAAAAAQAAAEgAAAABAAOgAQADAAAAAQABAACgAgAEAAAAAQAAAAigAwAEAAAAAQAAAAgAAAAA/+0AOFBob3Rvc2hvcCAzLjAAOEJJTQQEAAAAAAAAOEJJTQQlAAAAAAAQ1B2M2Y8AsgTpgAmY7PhCfv/AABEIAAgACAMBIgACEQEDEQH/xAAfAAABBQEBAQEBAQAAAAAAAAAAAQIDBAUGBwgJCgv/xAC1EAACAQMDAgQDBQUEBAAAAX0BAgMABBEFEiExQQYTUWEHInEUMoGRoQgjQrHBFVLR8CQzYnKCCQoWFxgZGiUmJygpKjQ1Njc4OTpDREVGR0hJSlNUVVZXWFlaY2RlZmdoaWpzdHV2d3h5eoOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4eLj5OXm5+jp6vHy8/T19vf4+fr/xAAfAQADAQEBAQEBAQEBAAAAAAAAAQIDBAUGBwgJCgv/xAC1EQACAQIEBAMEBwUEBAABAncAAQIDEQQFITEGEkFRB2FxEyIygQgUQpGhscEJIzNS8BVictEKFiQ04SXxFxgZGiYnKCkqNTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqCg4SFhoeIiYqSk5SVlpeYmZqio6Slpqeoqaqys7S1tre4ubrCw8TFxsfIycrS09TV1tfY2dri4+Tl5ufo6ery8/T19vf4+fr/2wBDAAICAgICAgMCAgMFAwMDBQYFBQUFBggGBgYGBggKCAgICAgICgoKCgoKCgoMDAwMDAwODg4ODg8PDw8PDw8PDw//2wBDAQICAgQEBAcEBAcQCwkLEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBD/3QAEAAH/2gAMAwEAAhEDEQA/API6KKK/tQ/kc//Z",
  "base64",
);

async function flaggedAttempt(data: TestData) {
  const co = await data.company();
  const { assessmentId, scenarioId } = await data.assessment({ orgId: co.orgId, proctoring: { camera: true, screen: true } });
  const { jobId } = await data.job({ orgId: co.orgId, assessmentId });
  const invite = await data.invite({ orgId: co.orgId, jobId, status: "completed" });
  const startedAt = new Date(Date.now() - 30 * 60_000);
  const { attemptId } = await data.attempt({ orgId: co.orgId, inviteId: invite.inviteId, scenarioId, status: "submitted", startedAt });
  must(await db().from("attempts").update({ submitted_at: new Date().toISOString(), submit_reason: "candidate", integrity_label: "review" }).eq("id", attemptId));

  const stoppedAt = new Date(startedAt.getTime() + (12 * 60 + 30) * 1000).toISOString();
  const path = `${co.orgId}/${attemptId}/screen/${Date.now()}-e2e.jpg`;
  must(await db().storage.from("proctoring").upload(path, JPEG, { contentType: "image/jpeg" }));
  const media = must(
    await db().from("media").insert({ attempt_id: attemptId, org_id: co.orgId, source: "screen", storage_path: path, at: stoppedAt }).select("id").single(),
  );
  const event = must(
    await db().from("integrity_events").insert({ attempt_id: attemptId, org_id: co.orgId, kind: "screen_share_stopped", at: stoppedAt }).select("id").single(),
  );
  must(
    await db().from("flags").insert({
      attempt_id: attemptId,
      org_id: co.orgId,
      rule: "screen_share",
      reason: "Screen sharing stopped 1 time",
      evidence: { events: [{ id: event.id, kind: "screen_share_stopped", at: stoppedAt }], mediaIds: [media.id], total: 1 },
    }),
  );
  return { co, invite, attemptId, path };
}

// Snapshot files are not covered by the company cascade, so each test removes its own in `finally`.

test("a recruiter sees the flag with its evidence and clears it with a note", async ({ page, data, land }) => {
  const { co, invite, attemptId, path } = await flaggedAttempt(data);
  try {
    await signInViaUi(page, co.users.recruiter, `/app/${co.slug}/candidates/${invite.inviteId}`);
    await land(new RegExp(`/candidates/${invite.inviteId}$`), invite.email);

    const section = page.getByRole("region", { name: "Integrity" });
    await expect(section.getByTestId("integrity-badge")).toHaveText("Review · 1 flag");
    await expect(section).toContainText("Entire screen sharedStopped 1×");
    const flag = section.getByRole("article").filter({ hasText: "Screen sharing stopped 1 time" });
    await expect(flag.getByRole("list", { name: "Evidence" })).toContainText("12:30 into the test");
    const thumb = flag.getByRole("img", { name: "Screen snapshot at 12:30" });
    await expect(thumb).toBeVisible();
    // The thumbnail is a short-lived signed URL that actually loads.
    await expect.poll(() => thumb.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);

    const form = section.getByRole("form", { name: "Review flag: Screen sharing stopped 1 time" });
    await form.getByRole("textbox", { name: "Your note (required)" }).fill("Laptop went to sleep; the candidate emailed us at the time.");
    await form.getByRole("button", { name: "Clear flag" }).click();
    // The reviewed flag replaces the form: who decided, and their note.
    await expect(flag).toContainText("Cleared");
    await expect(flag).toContainText(co.users.recruiter.email);
    await expect(flag).toContainText("Laptop went to sleep; the candidate emailed us at the time.");
    await expect(section.getByTestId("integrity-badge")).toHaveText("Reviewed");

    const row = must(await db().from("flags").select("status, review_note, reviewed_by").eq("attempt_id", attemptId).single());
    expect(row).toEqual({ status: "cleared", review_note: "Laptop went to sleep; the candidate emailed us at the time.", reviewed_by: co.users.recruiter.id });
  } finally {
    await db().storage.from("proctoring").remove([path]);
  }
});

test("a viewer reads the flags but cannot review them or see snapshots", async ({ page, data, land }) => {
  const { co, invite, path } = await flaggedAttempt(data);
  try {
    await signInViaUi(page, co.users.viewer, `/app/${co.slug}/candidates/${invite.inviteId}`);
    await land(new RegExp(`/candidates/${invite.inviteId}$`), invite.email);
    const section = page.getByRole("region", { name: "Integrity" });
    await expect(section).toContainText("Screen sharing stopped 1 time");
    await expect(section.getByRole("img")).toHaveCount(0);
    await expect(section.getByText(/Snapshots are visible to admins and recruiters only\./)).toBeVisible();
    await expect(section.getByRole("form")).toHaveCount(0);
    await expect(section.getByRole("button", { name: "Clear flag" })).toHaveCount(0);
  } finally {
    await db().storage.from("proctoring").remove([path]);
  }
});
