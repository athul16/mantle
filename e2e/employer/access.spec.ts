/** Viewers are read-only (in the UI and on the server); other companies' URLs are unreachable. */
import { signInViaUi } from "../fixtures";
import { invitesForJob, setRole } from "../support/db";
import { chromiumOnly, expect, test } from "../support/test";

chromiumOnly();

test("a viewer sees jobs, assessments and invites read-only", async ({ page, hiring, land }) => {
  const { company, jobId, invite } = hiring;
  await signInViaUi(page, company.users.viewer, `/app/${company.slug}/jobs`);
  await land(/\/jobs$/, "Jobs");
  await expect(page.getByText("You have read-only access.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Create job" })).toHaveCount(0);

  await page.getByRole("link", { name: /Assessments \(1\)/ }).click();
  await land(/\/assessments$/, "Assessments");
  await expect(page.getByRole("button", { name: "Create assessment" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Clone" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Edit settings" })).toHaveCount(0);

  await page.goto(`/app/${company.slug}/jobs/${jobId}`);
  await land(/\/jobs\/[0-9a-f-]{36}$/, "Audit intern");
  await expect(page.getByRole("row").filter({ hasText: invite.email })).toBeVisible();
  await expect(page.getByRole("button", { name: "Send invites" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Resend|Revoke/ })).toHaveCount(0);
});

test("the server rejects an action from someone demoted to viewer mid-session", async ({ page, hiring, data }) => {
  const { company, jobId } = hiring;
  await signInViaUi(page, company.users.recruiter, `/app/${company.slug}/jobs/${jobId}`);
  await expect(page.getByRole("button", { name: "Send invites" })).toBeVisible();

  // The form is still on screen, but the user is now a viewer.
  await setRole(company.orgId, company.users.recruiter.id, "viewer");
  const email = data.email("stale");
  await page.getByLabel("Paste emails").fill(email);
  await page.getByRole("button", { name: "Send invites" }).click();
  await expect(page.getByText("You don't have permission to do that.")).toBeVisible();
  expect((await invitesForJob(jobId)).map((i) => i.email)).not.toContain(email);
});

test.describe("another company's URLs", () => {
  // These visits show a 404 on purpose; some requests may answer 404.
  test.use({ allowHttp: [/\/app\//] });

  test("are not reachable, and look the same as URLs that don't exist", async ({ page, hiring, data, land }) => {
    const other = await data.company();
    await signInViaUi(page, other.users.admin);
    const { slug } = hiring.company;
    for (const path of [`/app/${slug}`, `/app/${slug}/jobs`, `/app/${slug}/jobs/${hiring.jobId}`, `/app/${slug}/team`, `/app/no-such-company-${data.run}`]) {
      // Soft 404 (reported, low): the page streams inside Suspense, so the status is 200; the 404 page is what counts.
      await page.goto(path);
      await expect(page.getByText("This page could not be found.")).toBeVisible();
      await expect(page.getByText(hiring.company.name)).toHaveCount(0);
    }
    // Their job id under my own company is a 404 too.
    await page.goto(`/app/${other.slug}/jobs/${hiring.jobId}`);
    await expect(page.getByText("This page could not be found.")).toBeVisible();
    await page.goto(`/app/${other.slug}`);
    await land(new RegExp(`/app/${other.slug}$`), other.name);
  });
});
