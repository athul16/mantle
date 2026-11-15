/** Team page: invite, change role, remove, last-admin guard, read-only for non-admins. */
import { hold, isServerAction } from "../support/hold";
import { memberIds, userIdByEmail } from "../support/db";
import { chromiumOnly, expect, test } from "../support/test";

chromiumOnly();

/** The team table row for an email. */
const inviteForm = (page: import("@playwright/test").Page) =>
  page.locator("form").filter({ has: page.getByRole("heading", { name: "Invite a teammate" }) });
const row = (page: import("@playwright/test").Page, email: string) => page.getByRole("row").filter({ hasText: email });

test("an admin adds an existing user as a viewer", async ({ page, company, data, signInAs, land }) => {
  const existing = await data.user("existing");
  await signInAs("admin", `/app/${company.slug}/team`);
  await land(new RegExp(`/app/${company.slug}/team$`), "Team");

  await inviteForm(page).getByLabel("Email").fill(existing.email);
  await inviteForm(page).getByLabel("Role").selectOption("viewer");
  const held = await hold(page, isServerAction);
  await page.getByRole("button", { name: "Send invite" }).click();
  await held.arrived;
  await expect(page.getByRole("button", { name: "Inviting…" })).toBeDisabled();
  await held.release();

  await expect(page.getByText(`${existing.email} already has an account and was added as viewer.`)).toBeVisible();
  await expect(row(page, existing.email)).toBeVisible();
  await expect(row(page, existing.email).getByRole("combobox", { name: "Role" })).toHaveValue("viewer");

  // Adding them twice is refused.
  await inviteForm(page).getByLabel("Email").fill(existing.email);
  await page.getByRole("button", { name: "Send invite" }).click();
  await expect(page.getByText(`${existing.email} is already on the team.`)).toBeVisible();
});

test("an admin invites a brand-new teammate by email", async ({ page, company, data, signInAs }) => {
  const email = data.email("newhire");
  await signInAs("admin", `/app/${company.slug}/team`);
  await inviteForm(page).getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Send invite" }).click();
  await expect(page.getByText(`Invite sent to ${email}.`)).toBeVisible();
  await expect(row(page, email).getByText("invite pending")).toBeVisible();
  const id = await userIdByEmail(email);
  if (id) data.trackUser(id);
});

test("an admin changes a role and removes a teammate", async ({ page, company, signInAs }) => {
  const { recruiter, viewer } = company.users;
  await signInAs("admin", `/app/${company.slug}/team`);

  const role = row(page, viewer.email).getByRole("combobox", { name: "Role" });
  await role.selectOption("recruiter");
  await expect(role).toHaveValue("recruiter");
  await expect.poll(async () => (await memberIds(company.orgId)).find((m) => m.user_id === viewer.id)?.role).toBe("recruiter");

  page.once("dialog", (d) => d.accept());
  await row(page, recruiter.email).getByRole("button", { name: "Remove" }).click();
  await expect(row(page, recruiter.email)).toHaveCount(0);

  // Dismissing the confirm keeps them.
  page.once("dialog", (d) => d.dismiss());
  await row(page, viewer.email).getByRole("button", { name: "Remove" }).click();
  await expect(row(page, viewer.email)).toBeVisible();
});

test("the last admin can't be demoted or removed", async ({ page, company, signInAs }) => {
  const { admin } = company.users;
  await signInAs("admin", `/app/${company.slug}/team`);
  const me = row(page, admin.email);
  await expect(me.getByText("(you)")).toBeVisible();

  await me.getByRole("combobox", { name: "Role" }).selectOption("viewer");
  await expect(page.getByText("A company needs at least one admin. Make someone else an admin first.")).toBeVisible();
  // The rejected change snaps back to the saved role.
  await expect(row(page, admin.email).getByRole("combobox", { name: "Role" })).toHaveValue("admin");

  page.once("dialog", (d) => d.accept());
  await row(page, admin.email).getByRole("button", { name: "Leave" }).click();
  await expect(page.getByText("You can't remove the last admin. Make someone else an admin first.")).toBeVisible();
  expect((await memberIds(company.orgId)).filter((m) => m.role === "admin")).toHaveLength(1);
});

for (const role of ["recruiter", "viewer"] as const) {
  test(`a ${role} sees the team read-only`, async ({ page, company, signInAs, land }) => {
    await signInAs(role, `/app/${company.slug}/team`);
    await land(new RegExp(`/team$`), "Team");
    await expect(page.getByText(`You're a ${role}, so you can see the team but not change it.`, { exact: false })).toBeVisible();
    await expect(page.getByRole("button", { name: "Send invite" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Remove|Leave/ })).toHaveCount(0);
    await expect(page.getByRole("combobox", { name: "Role" })).toHaveCount(0);
  });
}
