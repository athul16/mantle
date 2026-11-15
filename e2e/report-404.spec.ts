/**
 * The candidate report answers a real HTTP 404 for an invite that isn't this
 * company's (another company's, unknown, or malformed), decided in the proxy
 * before the page starts streaming, the same as job pages.
 */
import { signInViaUi } from "./fixtures";
import { expect, test } from "./support/test";

test.describe("candidate report URLs", () => {
  // These visits show a 404 on purpose.
  test.use({ allowHttp: [/\/app\//] });

  test("another company's invite, an unknown id and a malformed one answer 404", async ({ page, hiring, data }) => {
    const other = await data.hiringSetup();
    const { company } = hiring;
    await signInViaUi(page, company.users.recruiter, `/app/${company.slug}/jobs`);

    // Own invite: the report loads.
    const own = await page.goto(`/app/${company.slug}/candidates/${hiring.invite.inviteId}`);
    expect(own?.status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1, name: hiring.invite.email })).toBeVisible();

    for (const inviteId of [other.invite.inviteId, "00000000-0000-4000-8000-000000000000", "not-a-uuid"]) {
      const path = `/app/${company.slug}/candidates/${inviteId}`;
      const res = await page.goto(path);
      expect(res?.status(), path).toBe(404);
      await expect(page.getByText("This page could not be found.")).toBeVisible();
      await expect(page.getByText(other.invite.email)).toHaveCount(0);
    }
  });
});
