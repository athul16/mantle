/**
 * Jobs, assessments and candidate invites, end to end against the local test
 * database. The server actions run for real; only the Next.js request context
 * is swapped out: `createClient()` from `@/lib/supabase/server` returns a
 * supabase-js client signed in as whichever test user is "acting", so
 * requireMembership and RLS both see that user.
 *
 * Creates throwaway users and two companies, and deletes everything (users,
 * companies with their rows, and the test emails in .dev-outbox) afterward.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";
import { readFile, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { requireDbEnv } from "../helpers/env";
import { enrollTotp } from "../helpers/totp";
import type { Database } from "@/lib/database.types";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => acting.client }));

// Emails must land in .dev-outbox, never go out through Resend.
delete process.env.RESEND_API_KEY;

// Local throwaway Supabase only (.env.test); see tests/helpers/env.ts.
const { url: URL, publishableKey: PUBLISHABLE, secretKey: SECRET } = requireDbEnv();

const { hashToken } = await import("@/lib/tokens");
const actions = await import("@/app/app/[orgSlug]/jobs/actions");

const noSession = { auth: { persistSession: false, autoRefreshToken: false } };
const service = createClient<Database>(URL, SECRET, noSession);
const OUTBOX = path.join(process.cwd(), ".dev-outbox");

type User = { id: string; client: SupabaseClient<Database> };
const run = randomBytes(4).toString("hex");
const createdUserIds: string[] = [];
const orgIds: string[] = [];
let acting: User;
let recruiter: User;
let viewer: User;
let outsider: User;
let orgA = "";
let orgB = "";
let scenarioId = "";
let jobId = "";

const candidate = (label: string) => `jobs-${run}-${label}@example.test`;

async function makeUser(label: string): Promise<User> {
  const email = `jobs-${run}-${label}@example.test`;
  const password = randomBytes(18).toString("base64url");
  const { data, error } = await service.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;
  createdUserIds.push(data.user.id);
  const client = createClient<Database>(URL, PUBLISHABLE, noSession);
  const signIn = await client.auth.signInWithPassword({ email, password });
  if (signIn.error) throw signIn.error;
  return { id: data.user.id, client };
}

function form(values: Record<string, string | boolean | number | File>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(values)) {
    if (v === false) continue;
    fd.append(k, v === true ? "on" : v instanceof File ? v : String(v));
  }
  return fd;
}

/** Outbox emails sent to this address, oldest first. */
async function outboxFor(email: string): Promise<{ file: string; text: string; to: string }[]> {
  let files: string[] = [];
  try {
    files = (await readdir(OUTBOX)).sort();
  } catch {
    return [];
  }
  const out = [];
  for (const file of files) {
    if (!file.includes(run)) continue;
    const msg = JSON.parse(await readFile(path.join(OUTBOX, file), "utf8"));
    if (msg.to === email) out.push({ file, text: msg.text, to: msg.to });
  }
  return out;
}

async function latestToken(email: string): Promise<string> {
  const mails = await outboxFor(email);
  const match = mails.at(-1)?.text.match(/\/a\/([A-Za-z0-9_-]{20,})/);
  if (!match) throw new Error(`no invite link emailed to ${email}`);
  return match[1];
}

async function inviteRow(email: string) {
  const { data, error } = await service.from("invites").select("*").eq("job_id", jobId).eq("email", email).single();
  if (error) throw error;
  return data;
}

async function secretFor(inviteId: string) {
  const { data, error } = await service.from("invite_secrets").select("*").eq("invite_id", inviteId).single();
  if (error) throw error;
  return data;
}

beforeAll(async () => {
  const owner = await makeUser("owner");
  recruiter = await makeUser("recruiter");
  viewer = await makeUser("viewer");
  outsider = await makeUser("outsider");

  const a = await owner.client.rpc("create_organization", { org_name: `Jobs test A ${run}` });
  if (a.error) throw a.error;
  orgA = a.data as string;
  orgIds.push(orgA);
  const b = await outsider.client.rpc("create_organization", { org_name: `Jobs test B ${run}` });
  if (b.error) throw b.error;
  orgB = b.data as string;
  orgIds.push(orgB);
  // The outsider is org B's admin, so their actions need two-factor (aal2).
  await enrollTotp(outsider.client);
  // Recruiters must use two-factor too.
  await enrollTotp(recruiter.client);

  const m = await service.from("memberships").insert([
    { org_id: orgA, user_id: recruiter.id, role: "recruiter" },
    { org_id: orgA, user_id: viewer.id, role: "viewer" },
  ]);
  if (m.error) throw m.error;

  const lib = await service
    .from("scenarios")
    .select("id")
    .is("org_id", null)
    .not("published_at", "is", null)
    .limit(1)
    .single();
  if (lib.error) throw new Error("No published library scenario. Run pnpm scenarios:publish first.");
  scenarioId = lib.data.id;
});

afterAll(async () => {
  for (const id of orgIds) await service.from("organizations").delete().eq("id", id);
  for (const id of createdUserIds) await service.auth.admin.deleteUser(id);
  try {
    for (const file of await readdir(OUTBOX)) if (file.includes(run)) await rm(path.join(OUTBOX, file));
  } catch {
    // No outbox.
  }
});

describe("assessments and jobs", () => {
  it("the server refuses an assessment with no proctoring choice", async () => {
    acting = recruiter;
    const res = await actions.createAssessment(
      undefined,
      form({ orgId: orgA, scenarioId, title: "No choice", timeLimitMinutes: 20, camera: true, screen: true }),
    );
    expect(res?.fieldErrors?.monitoring).toEqual(["Choose whether candidates are monitored."]);
    const { count } = await service.from("assessments").select("id", { count: "exact", head: true }).eq("org_id", orgA);
    expect(count).toBe(0);
  });

  it("recruiter creates an assessment and a job", async () => {
    acting = recruiter;
    const created = await actions.createAssessment(
      undefined,
      form({ orgId: orgA, scenarioId, title: "Petty cash round", timeLimitMinutes: 20, passScore: 70, monitoring: "monitored", camera: true, screen: false }),
    );
    expect(created).toMatchObject({ message: expect.stringContaining("Created") });

    const { data: assessment } = await service.from("assessments").select("*").eq("org_id", orgA).single();
    // The new id comes back so the UI can go on to create a job with it.
    expect(created?.id).toBe(assessment!.id);
    expect(assessment).toMatchObject({ time_limit_minutes: 20, pass_score: 70, proctoring: { camera: true, screen: false } });

    const deadline = new Date(Date.now() + 7 * 864e5).toISOString();
    const job = await actions.createJob(undefined, form({ orgId: orgA, title: "Audit intern", assessmentId: assessment!.id, deadline }));
    expect(job).toMatchObject({ message: expect.stringContaining("Created") });
    const { data: jobRow } = await service.from("jobs").select("id").eq("org_id", orgA).single();
    jobId = jobRow!.id;
    expect(job?.id).toBe(jobId);
  });

  it("viewer can't create assessments or jobs", async () => {
    acting = viewer;
    const res = await actions.createAssessment(
      undefined,
      form({ orgId: orgA, scenarioId, title: "Nope", timeLimitMinutes: 20, monitoring: "not_monitored" }),
    );
    expect(res?.error).toMatch(/permission/);
    const { count } = await service.from("assessments").select("id", { count: "exact", head: true }).eq("org_id", orgA);
    expect(count).toBe(1);
  });

  it("a locked assessment can't change settings", async () => {
    const { data: a } = await service.from("assessments").select("id").eq("org_id", orgA).single();
    await service.from("assessments").update({ locked_at: new Date().toISOString() }).eq("id", a!.id);
    acting = recruiter;
    const res = await actions.updateAssessment(
      undefined,
      form({ orgId: orgA, assessmentId: a!.id, title: "Petty cash round", timeLimitMinutes: 30, monitoring: "not_monitored" }),
    );
    expect(res?.error).toMatch(/locked/);
    await service.from("assessments").update({ locked_at: null }).eq("id", a!.id).select();
  });
});

describe("invites", () => {
  it("recruiter invites candidates; duplicates, invalid entries and repeats are handled", async () => {
    acting = recruiter;
    const rejected = await actions.inviteCandidates(undefined, form({ orgId: orgA, jobId, emails: `${candidate("c1")}\nnot-an-email` }));
    expect(rejected?.error).toMatch(/Nothing was sent/);
    expect(rejected?.invalid).toEqual(["not-an-email"]);

    const csv = new File([`name,email\nCand Two,${candidate("c2")}\n`], "c.csv", { type: "text/csv" });
    const res = await actions.inviteCandidates(
      undefined,
      form({ orgId: orgA, jobId, emails: `${candidate("c1")}\n${candidate("C1")}`, csv }),
    );
    expect(res?.error).toBeUndefined();
    expect(res?.invited?.sort()).toEqual([candidate("c1"), candidate("c2")].sort());
    expect(res?.duplicates).toEqual([candidate("c1")]);
    expect((await inviteRow(candidate("c2"))).candidate_name).toBe("Cand Two");

    const again = await actions.inviteCandidates(undefined, form({ orgId: orgA, jobId, emails: candidate("c1") }));
    expect(again?.alreadyInvited).toEqual([candidate("c1")]);
    expect(again?.invited).toEqual([]);

    const { count } = await service.from("invites").select("id", { count: "exact", head: true }).eq("job_id", jobId);
    expect(count).toBe(2);
  });

  it("stores only a hash of the token, and emails the matching link", async () => {
    const row = await inviteRow(candidate("c1"));
    const token = await latestToken(candidate("c1"));
    const mail = (await outboxFor(candidate("c1"))).at(-1)!;
    expect(mail.text).toContain(`/a/${token}`);

    const secret = await secretFor(row.id);
    expect(secret.token_hash).toBe(hashToken(token));
    expect(secret.token_hash).not.toBe(token);
    expect(JSON.stringify(row)).not.toContain(token);
    expect(JSON.stringify(secret)).not.toContain(token);
    expect(row.created_by).toBe(recruiter.id);
    expect(row.status).toBe("invited");
  });

  it("rejects batches over 200", async () => {
    acting = recruiter;
    const emails = Array.from({ length: 201 }, (_, n) => candidate(`bulk${n}`)).join("\n");
    const res = await actions.inviteCandidates(undefined, form({ orgId: orgA, jobId, emails }));
    expect(res?.error).toMatch(/at most 200/);
  });

  it("viewer can't invite, resend or revoke", async () => {
    acting = viewer;
    const res = await actions.inviteCandidates(undefined, form({ orgId: orgA, jobId, emails: candidate("v1") }));
    expect(res?.error).toMatch(/permission/);
    const row = await inviteRow(candidate("c1"));
    expect((await actions.resendInviteAction(undefined, form({ orgId: orgA, inviteId: row.id })))?.error).toMatch(/permission/);
    expect((await actions.revokeInviteAction(undefined, form({ orgId: orgA, inviteId: row.id })))?.error).toMatch(/permission/);

    // RLS also blocks the viewer writing directly.
    const direct = await viewer.client
      .from("invites")
      .insert({ org_id: orgA, job_id: jobId, email: candidate("v2"), expires_at: new Date(Date.now() + 864e5).toISOString() });
    expect(direct.error).not.toBeNull();
    const { count } = await service.from("invites").select("id", { count: "exact", head: true }).eq("job_id", jobId);
    expect(count).toBe(2);

    // Viewers can still read the job's invites.
    const { data } = await viewer.client.from("invites").select("id").eq("job_id", jobId);
    expect(data).toHaveLength(2);
  });

  it("another company can't see or touch these jobs and invites", async () => {
    acting = outsider;
    const jobs = await outsider.client.from("jobs").select("id").eq("id", jobId);
    expect(jobs.data).toEqual([]);
    const invites = await outsider.client.from("invites").select("id").eq("job_id", jobId);
    expect(invites.data).toEqual([]);
    const secrets = await outsider.client.from("invite_secrets").select("invite_id");
    expect(secrets.error).not.toBeNull();

    // Claiming org A in the form fails the membership check.
    const asA = await actions.inviteCandidates(undefined, form({ orgId: orgA, jobId, emails: candidate("x1") }));
    expect(asA?.error).toMatch(/permission/);
    // Using their own org with org A's job finds nothing.
    const asB = await actions.inviteCandidates(undefined, form({ orgId: orgB, jobId, emails: candidate("x1") }));
    expect(asB?.error).toMatch(/doesn't exist/);
    const row = await inviteRow(candidate("c1"));
    expect((await actions.revokeInviteAction(undefined, form({ orgId: orgB, inviteId: row.id })))?.error).toMatch(/doesn't exist/);
    expect((await actions.resendInviteAction(undefined, form({ orgId: orgB, inviteId: row.id })))?.error).toMatch(/doesn't exist/);
    expect((await inviteRow(candidate("c1"))).status).toBe("invited");
  });

  it("resend issues a new link and the old one stops matching", async () => {
    acting = recruiter;
    const row = await inviteRow(candidate("c1"));
    const oldToken = await latestToken(candidate("c1"));
    await service
      .from("invite_secrets")
      .update({ code_hash: "pending-code", code_attempts: 2 })
      .eq("invite_id", row.id);

    expect(row.sent_count).toBe(1);
    expect(row.last_sent_at).toBe(row.created_at);

    const res = await actions.resendInviteAction(undefined, form({ orgId: orgA, inviteId: row.id }));
    expect(res?.message).toMatch(/New link sent/);

    // S1: the list shows when the link was last sent, and how many times.
    const after = await inviteRow(candidate("c1"));
    expect(after.sent_count).toBe(2);
    expect(new Date(after.last_sent_at).getTime()).toBeGreaterThan(new Date(row.created_at).getTime());
    expect(after.created_at).toBe(row.created_at);

    const newToken = await latestToken(candidate("c1"));
    expect(newToken).not.toBe(oldToken);
    const secret = await secretFor(row.id);
    expect(secret.token_hash).toBe(hashToken(newToken));
    expect(secret.code_hash).toBeNull();
    expect(secret.code_attempts).toBe(0);
    const old = await service.from("invite_secrets").select("invite_id").eq("token_hash", hashToken(oldToken));
    expect(old.data).toEqual([]);
  });

  it("revoke marks the invite revoked; it can't then be resent", async () => {
    acting = recruiter;
    const row = await inviteRow(candidate("c2"));
    const res = await actions.revokeInviteAction(undefined, form({ orgId: orgA, inviteId: row.id }));
    expect(res?.message).toMatch(/Revoked/);
    expect((await inviteRow(candidate("c2"))).status).toBe("revoked");

    const resend = await actions.resendInviteAction(undefined, form({ orgId: orgA, inviteId: row.id }));
    expect(resend?.error).toMatch(/revoked/);

    // A revoked email can be invited again with a fresh invite.
    const again = await actions.inviteCandidates(undefined, form({ orgId: orgA, jobId, emails: candidate("c2") }));
    expect(again?.invited).toEqual([candidate("c2")]);
  });

  it("started invites can't be resent or revoked", async () => {
    acting = recruiter;
    const row = await inviteRow(candidate("c1"));
    await service.from("invites").update({ status: "started" }).eq("id", row.id);
    expect((await actions.resendInviteAction(undefined, form({ orgId: orgA, inviteId: row.id })))?.error).toMatch(/started/);
    expect((await actions.revokeInviteAction(undefined, form({ orgId: orgA, inviteId: row.id })))?.error).toMatch(/started/);
  });

  it("concurrent batches can't invite the same email twice (unique index)", async () => {
    acting = recruiter;
    const shared = [candidate("race1"), candidate("race2"), candidate("race3")];
    const batches = Array.from({ length: 5 }, (_, n) => [...shared, candidate(`race-only${n}`)].join("\n"));
    const results = await Promise.all(batches.map((emails) => actions.inviteCandidates(undefined, form({ orgId: orgA, jobId, emails }))));

    for (const r of results) expect(r?.error).toBeUndefined();
    for (const email of shared) {
      const { count } = await service.from("invites").select("id", { count: "exact", head: true }).eq("job_id", jobId).eq("email", email);
      expect(count).toBe(1);
      // Exactly one batch invited it; every other batch reports it as already invited.
      expect(results.filter((r) => r?.invited?.includes(email))).toHaveLength(1);
      expect(results.filter((r) => r?.alreadyInvited?.includes(email))).toHaveLength(batches.length - 1);
      expect(await outboxFor(email)).toHaveLength(1);
    }
    for (let n = 0; n < batches.length; n++) expect(results[n]?.invited).toContain(candidate(`race-only${n}`));
  });

  it("the database refuses a second live invite even when the app check is skipped", async () => {
    const expires_at = new Date(Date.now() + 864e5).toISOString();
    const email = candidate("direct");
    const inserts = await Promise.all(
      Array.from({ length: 8 }, (_, n) =>
        recruiter.client.from("invites").insert({ org_id: orgA, job_id: jobId, email: n % 2 ? email.toUpperCase() : email, expires_at }),
      ),
    );
    expect(inserts.filter((r) => r.error === null)).toHaveLength(1);
    expect(inserts.filter((r) => r.error?.code === "23505")).toHaveLength(7);
  });

  it("an invite past its expiry can be re-invited; the old row is marked expired and can't be revived", async () => {
    acting = recruiter;
    const email = candidate("lapsed");
    expect((await actions.inviteCandidates(undefined, form({ orgId: orgA, jobId, emails: email })))?.invited).toEqual([email]);
    const old = await inviteRow(email);
    await service.from("invites").update({ expires_at: new Date(Date.now() - 60_000).toISOString() }).eq("id", old.id);

    const again = await actions.inviteCandidates(undefined, form({ orgId: orgA, jobId, emails: email }));
    expect(again?.invited).toEqual([email]);
    const { data: rows } = await service.from("invites").select("id, status").eq("job_id", jobId).eq("email", email).order("created_at");
    expect(rows?.map((r) => r.status)).toEqual(["expired", "invited"]);

    const revive = await actions.resendInviteAction(undefined, form({ orgId: orgA, inviteId: old.id }));
    expect(revive?.error).toMatch(/already has a newer invite/);
    expect((await service.from("invites").select("status, sent_count").eq("id", old.id).single()).data).toEqual({ status: "expired", sent_count: 1 });
  });
});
