/**
 * Team rules from decision D13 against the local test database:
 * - Q4: an org always keeps one admin. The server actions refuse, and the
 *   database trigger refuses even when the app check is skipped.
 * - Q5: teammates' emails and invite state come from public.profiles through
 *   RLS (no service key), and only for people who share a company.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createTestData, type TestCompany } from "../helpers/factories";
import { must, serviceClient, signedInClient, type Db } from "../helpers/supabase";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => acting }));

const actions = await import("@/app/app/[orgSlug]/team/actions");
const { getEmails, getProfiles, isPendingInvite } = await import("@/lib/profiles");

const data = createTestData("team");
let acting: Db;
let co: TestCompany;
let other: TestCompany;

function form(entries: Record<string, string>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(entries)) fd.append(k, v);
  return fd;
}

beforeAll(async () => {
  co = await data.company();
  other = await data.company();
});

afterAll(() => data.cleanup());

describe("last admin (Q4)", () => {
  it("refuses demoting or removing the only admin", async () => {
    acting = await signedInClient(co.users.admin.email, co.users.admin.password);
    const ids = { orgId: co.orgId, userId: co.users.admin.id };
    expect(await actions.changeRole(undefined, form({ ...ids, role: "viewer" }))).toEqual({ error: expect.stringMatching(/at least one admin/) });
    expect(await actions.removeMember(undefined, form(ids))).toEqual({ error: expect.stringMatching(/last admin/) });
    const { role } = must(await serviceClient().from("memberships").select("role").eq("org_id", co.orgId).eq("user_id", co.users.admin.id).single());
    expect(role).toBe("admin");
  });

  it("is enforced by the database, not just the app check", async () => {
    acting = await signedInClient(co.users.admin.email, co.users.admin.password);
    const { error } = await acting.from("memberships").update({ role: "viewer" }).eq("org_id", co.orgId).eq("user_id", co.users.admin.id);
    expect(error?.code).toBe("23514");
    const service = await serviceClient().from("memberships").delete().eq("org_id", co.orgId).eq("user_id", co.users.admin.id);
    expect(service.error?.code).toBe("23514");
  });

  it("lets an admin step down once someone else is admin", async () => {
    acting = await signedInClient(co.users.admin.email, co.users.admin.password);
    expect(await actions.changeRole(undefined, form({ orgId: co.orgId, userId: co.users.recruiter.id, role: "admin" }))).toEqual({ message: "Role updated." });
    expect(await actions.changeRole(undefined, form({ orgId: co.orgId, userId: co.users.admin.id, role: "recruiter" }))).toEqual({ message: "Role updated." });
    // Put things back for the other tests (the former recruiter is now the only admin).
    must(await serviceClient().from("memberships").update({ role: "admin" }).eq("org_id", co.orgId).eq("user_id", co.users.admin.id));
    must(await serviceClient().from("memberships").update({ role: "recruiter" }).eq("org_id", co.orgId).eq("user_id", co.users.recruiter.id));
  });
});

describe("profiles (Q5)", () => {
  it("a member reads their teammates' emails with their own client", async () => {
    const viewer = await signedInClient(co.users.viewer.email, co.users.viewer.password);
    const emails = await getEmails(viewer, [co.users.admin.id, co.users.recruiter.id, co.users.viewer.id]);
    expect(Object.fromEntries(emails)).toEqual({
      [co.users.admin.id]: co.users.admin.email,
      [co.users.recruiter.id]: co.users.recruiter.email,
      [co.users.viewer.id]: co.users.viewer.email,
    });
  });

  it("another company's users are invisible", async () => {
    const viewer = await signedInClient(co.users.viewer.email, co.users.viewer.password);
    expect((await getEmails(viewer, [other.users.admin.id, other.users.viewer.id])).size).toBe(0);
  });

  it("an invited teammate shows as pending until they first sign in", async () => {
    const email = `team-invitee-${Date.now()}@example.test`;
    const { data: invited, error } = await serviceClient().auth.admin.inviteUserByEmail(email);
    if (error) throw error;
    const userId = invited.user.id;
    try {
      must(await serviceClient().from("memberships").insert({ org_id: co.orgId, user_id: userId, role: "viewer" }));
      const admin = await signedInClient(co.users.admin.email, co.users.admin.password);
      const profile = (await getProfiles(admin, [userId])).get(userId);
      expect(profile?.email).toBe(email);
      expect(isPendingInvite(profile)).toBe(true);
      // A teammate who has signed in is not pending.
      expect(isPendingInvite((await getProfiles(admin, [co.users.viewer.id])).get(co.users.viewer.id))).toBe(false);
    } finally {
      await serviceClient().auth.admin.deleteUser(userId);
    }
  });
});
