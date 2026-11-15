/**
 * D9 company side, against the local test database: recruiters set per-invite
 * accommodations (audited, refused once the candidate starts), the invite list
 * and report query read them back through RLS, and admins set the contact
 * email candidates see. The server actions run for real with the acting
 * user's own client (same setup as invites.test.ts).
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { requireDbEnv } from "../helpers/env";
import { enrollTotp } from "../helpers/totp";
import type { Database } from "@/lib/database.types";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => acting.client }));

delete process.env.RESEND_API_KEY;

const { url: URL, publishableKey: PUBLISHABLE, secretKey: SECRET } = requireDbEnv();

const jobsActions = await import("@/app/app/[orgSlug]/jobs/actions");
const settingsActions = await import("@/app/app/[orgSlug]/settings/actions");
const { listInvites, getInviteAccommodations } = await import("@/lib/jobs/queries");

const noSession = { auth: { persistSession: false, autoRefreshToken: false } };
const service = createClient<Database>(URL, SECRET, noSession);

type User = { id: string; client: SupabaseClient<Database> };
const run = randomBytes(4).toString("hex");
const createdUserIds: string[] = [];
const orgIds: string[] = [];
let acting: User;
let owner: User;
let recruiter: User;
let viewer: User;
let outsider: User;
let orgA = "";
let orgB = "";
let jobId = "";

async function makeUser(label: string): Promise<User> {
  const email = `accom-${run}-${label}@example.test`;
  const password = randomBytes(18).toString("base64url");
  const { data, error } = await service.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;
  createdUserIds.push(data.user.id);
  const client = createClient<Database>(URL, PUBLISHABLE, noSession);
  const signIn = await client.auth.signInWithPassword({ email, password });
  if (signIn.error) throw signIn.error;
  return { id: data.user.id, client };
}

function form(values: Record<string, string | boolean | number>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(values)) {
    if (v === false) continue;
    fd.append(k, v === true ? "on" : String(v));
  }
  return fd;
}

async function makeInvite(email: string) {
  const { data, error } = await service
    .from("invites")
    .insert({ org_id: orgA, job_id: jobId, email, expires_at: new Date(Date.now() + 7 * 864e5).toISOString() })
    .select("id")
    .single();
  if (error) throw error;
  return data.id;
}

beforeAll(async () => {
  owner = await makeUser("owner");
  recruiter = await makeUser("recruiter");
  viewer = await makeUser("viewer");
  outsider = await makeUser("outsider");

  const a = await owner.client.rpc("create_organization", { org_name: `Accommodations A ${run}` });
  if (a.error) throw a.error;
  orgA = a.data as string;
  orgIds.push(orgA);
  const b = await outsider.client.rpc("create_organization", { org_name: `Accommodations B ${run}` });
  if (b.error) throw b.error;
  orgB = b.data as string;
  orgIds.push(orgB);
  // Admins' and recruiters' actions need two-factor (aal2, decision D1).
  await enrollTotp(owner.client);
  await enrollTotp(outsider.client);
  await enrollTotp(recruiter.client);

  const m = await service.from("memberships").insert([
    { org_id: orgA, user_id: recruiter.id, role: "recruiter" },
    { org_id: orgA, user_id: viewer.id, role: "viewer" },
  ]);
  if (m.error) throw m.error;

  const lib = await service.from("scenarios").select("id").is("org_id", null).not("published_at", "is", null).limit(1).single();
  if (lib.error) throw lib.error;
  const asm = await service
    .from("assessments")
    .insert({ org_id: orgA, scenario_id: lib.data.id, title: "Monitored", time_limit_minutes: 30, proctoring: { camera: true, screen: true, fullscreen: false, microphone: false, gaze: false} })
    .select("id")
    .single();
  if (asm.error) throw asm.error;
  const job = await service.from("jobs").insert({ org_id: orgA, title: "Audit intern", assessment_id: asm.data.id }).select("id").single();
  if (job.error) throw job.error;
  jobId = job.data.id;
});

afterAll(async () => {
  for (const id of orgIds) await service.from("organizations").delete().eq("id", id);
  for (const id of createdUserIds) await service.auth.admin.deleteUser(id);
});

describe("invite accommodations", () => {
  it("a recruiter sets extra time and a camera waiver; it is audited and listed", async () => {
    const inviteId = await makeInvite(`accom-${run}-c1@example.test`);
    acting = recruiter;
    const res = await jobsActions.setAccommodationsAction(
      undefined,
      form({ orgId: orgA, inviteId, extraTimePercent: 50, waiveCamera: true, waiveScreen: false, waiveFullscreen: false, waiveMicrophone: false }),
    );
    expect(res).toMatchObject({ message: expect.stringContaining("Saved accommodations") });

    const row = await service.from("invite_accommodations").select("*").eq("invite_id", inviteId).single();
    expect(row.data).toMatchObject({ org_id: orgA, extra_time_percent: 50, waive_camera: true, waive_screen: false, set_by: recruiter.id });

    const audit = await service.from("audit_log").select("actor_id, target").eq("org_id", orgA).eq("action", "set_accommodations");
    expect(audit.data).toEqual([
      { actor_id: recruiter.id, target: `invite:${inviteId} extra_time=+50% waive_camera=true waive_screen=false` },
    ]);

    const listed = (await listInvites(orgA, jobId)).find((i) => i.id === inviteId);
    expect(listed).toMatchObject({ started: false, accommodations: { extraTimePercent: 50, waiveCamera: true, waiveScreen: false, waiveFullscreen: false, waiveMicrophone: false } });

    // Viewers read it on the report; they can't change it.
    acting = viewer;
    expect(await getInviteAccommodations(orgA, inviteId)).toEqual({ extraTimePercent: 50, waiveCamera: true, waiveScreen: false, waiveFullscreen: false, waiveMicrophone: false });
    const denied = await jobsActions.setAccommodationsAction(undefined, form({ orgId: orgA, inviteId, extraTimePercent: 0 }));
    expect(denied?.error).toMatch(/permission/);
    const direct = await viewer.client.rpc("set_invite_accommodations", {
      p_invite_id: inviteId,
      p_extra_time_percent: 0,
      p_waive_camera: false,
      p_waive_screen: false,
    });
    expect(direct.error?.code).toBe("42501");
  });

  it("only +0, +25, +50 or +100 percent is accepted", async () => {
    const inviteId = await makeInvite(`accom-${run}-c2@example.test`);
    acting = recruiter;
    const res = await jobsActions.setAccommodationsAction(undefined, form({ orgId: orgA, inviteId, extraTimePercent: 33 }));
    expect(res?.error).toBe("Invalid request.");
    const { count } = await service.from("invite_accommodations").select("invite_id", { count: "exact", head: true }).eq("invite_id", inviteId);
    expect(count).toBe(0);
  });

  it("can't change once the candidate has started", async () => {
    const inviteId = await makeInvite(`accom-${run}-c3@example.test`);
    const lib = await service.from("jobs").select("assessments(scenario_id)").eq("id", jobId).single();
    const att = await service.from("attempts").insert({
      org_id: orgA,
      invite_id: inviteId,
      scenario_id: lib.data!.assessments!.scenario_id,
      status: "in_progress",
      started_at: new Date().toISOString(),
      deadline_at: new Date(Date.now() + 30 * 60_000).toISOString(),
    });
    if (att.error) throw att.error;

    acting = recruiter;
    const res = await jobsActions.setAccommodationsAction(undefined, form({ orgId: orgA, inviteId, extraTimePercent: 100 }));
    expect(res?.error).toMatch(/has started/);
    expect((await listInvites(orgA, jobId)).find((i) => i.id === inviteId)?.started).toBe(true);
  });

  it("another company can't read or set them", async () => {
    const inviteId = await makeInvite(`accom-${run}-c4@example.test`);
    acting = recruiter;
    await jobsActions.setAccommodationsAction(undefined, form({ orgId: orgA, inviteId, extraTimePercent: 25 }));

    acting = outsider;
    const read = await outsider.client.from("invite_accommodations").select("invite_id").eq("invite_id", inviteId);
    expect(read.data).toEqual([]);
    const asA = await jobsActions.setAccommodationsAction(undefined, form({ orgId: orgA, inviteId, extraTimePercent: 100 }));
    expect(asA?.error).toMatch(/permission/);
    const asB = await jobsActions.setAccommodationsAction(undefined, form({ orgId: orgB, inviteId, extraTimePercent: 100 }));
    expect(asB?.error).toMatch(/doesn't exist/);
    const direct = await outsider.client.rpc("set_invite_accommodations", {
      p_invite_id: inviteId,
      p_extra_time_percent: 100,
      p_waive_camera: true,
      p_waive_screen: true,
    });
    expect(direct.error?.code).toBe("42501");
    const row = await service.from("invite_accommodations").select("extra_time_percent").eq("invite_id", inviteId).single();
    expect(row.data?.extra_time_percent).toBe(25);

    // A recruiter can't write the table directly either (it would skip the audit log).
    const raw = await recruiter.client.from("invite_accommodations").update({ waive_screen: true }).eq("invite_id", inviteId).select();
    expect(raw.error ?? raw.data?.length === 0).toBeTruthy();
  });
});

describe("contact email", () => {
  it("an admin sets and clears it; recruiters can't", async () => {
    acting = recruiter;
    const denied = await settingsActions.updateContactEmail(undefined, form({ orgId: orgA, contactEmail: "r@example.test" }));
    expect(denied?.error).toMatch(/permission/);

    acting = owner;
    const bad = await settingsActions.updateContactEmail(undefined, form({ orgId: orgA, contactEmail: "nope" }));
    expect(bad?.fieldErrors?.contactEmail?.[0]).toMatch(/valid email/);

    const ok = await settingsActions.updateContactEmail(undefined, form({ orgId: orgA, contactEmail: " Careers@Example.TEST " }));
    expect(ok?.message).toMatch(/careers@example.test/);
    const org = await service.from("organizations").select("settings").eq("id", orgA).single();
    expect(org.data?.settings).toMatchObject({ contact_email: "careers@example.test" });
    const audit = await service.from("audit_log").select("actor_id, target").eq("org_id", orgA).eq("action", "changed_contact_email");
    expect(audit.data).toEqual([{ actor_id: owner.id, target: "careers@example.test" }]);

    const cleared = await settingsActions.updateContactEmail(undefined, form({ orgId: orgA, contactEmail: "" }));
    expect(cleared?.message).toMatch(/Removed/);
    const after = await service.from("organizations").select("settings").eq("id", orgA).single();
    expect(after.data?.settings).not.toHaveProperty("contact_email");
  });
});
