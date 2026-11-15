/**
 * Retention (docs/02 Compliance): an admin changes how long photos and results
 * are kept, then deletes one candidate's data from the report. Other roles see the
 * setting read-only and get no delete button.
 */
import { signInViaUi } from "./fixtures";
import { db } from "./support/db";
import { chromiumOnly, expect, test } from "./support/test";
import type { TestData } from "../tests/helpers/factories";
import { must } from "../tests/helpers/supabase";

chromiumOnly();

// An 8×8 JPEG (same bytes as e2e/proctoring/recruiter-flags.spec.ts).
const JPEG = Buffer.from(
  "/9j/4AAQSkZJRgABAQAASABIAAD/4QCARXhpZgAATU0AKgAAAAgABAEaAAUAAAABAAAAPgEbAAUAAAABAAAARgEoAAMAAAABAAIAAIdpAAQAAAABAAAATgAAAAAAAABIAAAAAQAAAEgAAAABAAOgAQADAAAAAQABAACgAgAEAAAAAQAAAAigAwAEAAAAAQAAAAgAAAAA/+0AOFBob3Rvc2hvcCAzLjAAOEJJTQQEAAAAAAAAOEJJTQQlAAAAAAAQ1B2M2Y8AsgTpgAmY7PhCfv/AABEIAAgACAMBIgACEQEDEQH/xAAfAAABBQEBAQEBAQAAAAAAAAAAAQIDBAUGBwgJCgv/xAC1EAACAQMDAgQDBQUEBAAAAX0BAgMABBEFEiExQQYTUWEHInEUMoGRoQgjQrHBFVLR8CQzYnKCCQoWFxgZGiUmJygpKjQ1Njc4OTpDREVGR0hJSlNUVVZXWFlaY2RlZmdoaWpzdHV2d3h5eoOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4eLj5OXm5+jp6vHy8/T19vf4+fr/xAAfAQADAQEBAQEBAQEBAAAAAAAAAQIDBAUGBwgJCgv/xAC1EQACAQIEBAMEBwUEBAABAncAAQIDEQQFITEGEkFRB2FxEyIygQgUQpGhscEJIzNS8BVictEKFiQ04SXxFxgZGiYnKCkqNTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqCg4SFhoeIiYqSk5SVlpeYmZqio6Slpqeoqaqys7S1tre4ubrCw8TFxsfIycrS09TV1tfY2dri4+Tl5ufo6ery8/T19vf4+fr/2wBDAAICAgICAgMCAgMFAwMDBQYFBQUFBggGBgYGBggKCAgICAgICgoKCgoKCgoMDAwMDAwODg4ODg8PDw8PDw8PDw//2wBDAQICAgQEBAcEBAcQCwkLEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBD/3QAEAAH/2gAMAwEAAhEDEQA/API6KKK/tQ/kc//Z",
  "base64",
);

async function candidateWithEvidence(data: TestData) {
  const co = await data.company();
  const { assessmentId, scenarioId } = await data.assessment({ orgId: co.orgId, proctoring: { camera: true } });
  const { jobId } = await data.job({ orgId: co.orgId, assessmentId, title: "Retention clerk" });
  const invite = await data.invite({ orgId: co.orgId, jobId, status: "completed" });
  const { attemptId } = await data.attempt({
    orgId: co.orgId,
    inviteId: invite.inviteId,
    scenarioId,
    status: "submitted",
    startedAt: new Date(Date.now() - 20 * 60_000),
  });
  must(await db().from("attempts").update({ submitted_at: new Date().toISOString(), submit_reason: "candidate" }).eq("id", attemptId));
  const path = `${co.orgId}/${attemptId}/camera/${Date.now()}-e2e.jpg`;
  must(await db().storage.from("proctoring").upload(path, JPEG, { contentType: "image/jpeg" }));
  must(await db().from("media").insert({ attempt_id: attemptId, org_id: co.orgId, source: "camera", storage_path: path }));
  return { co, jobId, invite, attemptId, path };
}

test("an admin changes how long photos and results are kept", async ({ page, company, signInAs, land }) => {
  await signInAs("admin", `/app/${company.slug}`);
  await page.getByRole("link", { name: "Settings" }).click();
  await land(new RegExp(`/app/${company.slug}/settings$`), "Settings");

  const media = page.getByLabel("Keep photos and screenshots for (days)");
  const results = page.getByLabel("Keep results for (days)");
  await expect(media).toHaveValue("90");
  await expect(results).toHaveValue("365");

  await media.fill("10");
  await results.fill("900");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(media).toHaveAccessibleDescription(/Enter a whole number of days from 30 to 365\./);
  await expect(results).toHaveAccessibleDescription(/Enter a whole number of days from 30 to 730\./);

  await media.fill("200");
  await results.fill("100");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Photos and screenshots can't be kept longer than results.")).toBeVisible();

  await media.fill("60");
  await results.fill("200");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Saved. Photos and screenshots are kept for 60 days, results for 200 days.")).toBeVisible();

  const org = must(await db().from("organizations").select("settings").eq("id", company.orgId).single());
  expect(org.settings).toMatchObject({ media_retention_days: 60, results_retention_days: 200 });

  await page.reload();
  await expect(page.getByLabel("Keep photos and screenshots for (days)")).toHaveValue("60");
  await expect(page.getByLabel("Keep results for (days)")).toHaveValue("200");
});

test("a recruiter sees the retention settings read-only", async ({ page, company, signInAs, land }) => {
  await signInAs("recruiter", `/app/${company.slug}/settings`);
  await land(new RegExp(`/app/${company.slug}/settings$`), "Settings");
  await expect(page.getByText("Photos and screenshots are kept for 90 days")).toBeVisible();
  await expect(page.getByText("Results are kept for 365 days")).toBeVisible();
  await expect(page.getByLabel("Keep photos and screenshots for (days)")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Save" })).toHaveCount(0);
});

test.describe("delete", () => {
  // After the delete, the report URL is a 404 when visited again.
  test.use({ allowHttp: [/\/candidates\/[0-9a-f-]{36}(\?|$)/] });

test("an admin deletes a candidate's data from the report", async ({ page, data, land }) => {
  const { co, jobId, invite, attemptId, path } = await candidateWithEvidence(data);
  try {
    await signInViaUi(page, co.users.admin, `/app/${co.slug}/candidates/${invite.inviteId}`);
    await land(new RegExp(`/candidates/${invite.inviteId}$`), invite.email);

    await page.getByRole("button", { name: "Delete candidate data" }).click();
    const confirm = page.getByRole("button", { name: "Delete permanently" });
    await expect(confirm).toBeDisabled();
    await page.getByLabel('Type "delete" to confirm').fill("delet");
    await expect(confirm).toBeDisabled();
    await page.getByLabel('Type "delete" to confirm').fill("delete");
    await expect(confirm).toBeEnabled();
    await confirm.click();

    await land(new RegExp(`/candidates\\?job=${jobId}$`), "Candidates · Retention clerk");
    // Role queries skip hidden elements, so these check what the user sees. Next keeps the previous
    // route's tree hidden in the DOM, and the route announcer can still hold the old heading, so a bare
    // getByText(email) would match those.
    const main = page.getByRole("main");
    await expect(main.getByRole("heading", { level: 1 })).toHaveText("Candidates · Retention clerk");
    await expect(main.getByText("No one invited to this job yet.")).toBeVisible();
    await expect(main.getByRole("heading", { name: invite.email })).toHaveCount(0);

    // Going back must not bring the deleted candidate's report back from the client cache.
    await page.goBack();
    await expect(page).toHaveURL(new RegExp(`/candidates/${invite.inviteId}$`));
    await expect(page.getByText("This page could not be found.")).toBeVisible();
    await expect(page.getByRole("heading", { name: invite.email })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Delete candidate data" })).toHaveCount(0);

    expect(must(await db().from("invites").select("id").eq("id", invite.inviteId))).toHaveLength(0);
    expect(must(await db().from("attempts").select("id").eq("id", attemptId))).toHaveLength(0);
    const folder = path.split("/").slice(0, 3).join("/");
    const listed = must(await db().storage.from("proctoring").list(folder));
    expect(listed).toHaveLength(0);
    const audit = must(await db().from("audit_log").select("action, target").eq("org_id", co.orgId).eq("action", "deleted_candidate_data"));
    expect(audit).toEqual([{ action: "deleted_candidate_data", target: `invite:${invite.inviteId}` }]);
  } finally {
    await db().storage.from("proctoring").remove([path]);
  }
});
});

test("a recruiter has no delete button on the report", async ({ page, data, land }) => {
  const { co, invite, path } = await candidateWithEvidence(data);
  try {
    await signInViaUi(page, co.users.recruiter, `/app/${co.slug}/candidates/${invite.inviteId}`);
    await land(new RegExp(`/candidates/${invite.inviteId}$`), invite.email);
    await expect(page.getByRole("button", { name: "Delete candidate data" })).toHaveCount(0);
  } finally {
    await db().storage.from("proctoring").remove([path]);
  }
});
