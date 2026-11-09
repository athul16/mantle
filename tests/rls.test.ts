/**
 * Cross-organization isolation tests (docs/02-security-and-integrity.md:
 * "automated tests that attempt cross-org reads").
 *
 * Creates two throwaway orgs with an admin, recruiter, and viewer each, seeds
 * one row per tenant table through the service role, then signs in as each user
 * and checks what RLS lets them see and change. Everything is deleted afterward.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/lib/database.types";

try {
  process.loadEnvFile(".env.local");
} catch {
  // CI provides env vars directly.
}

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const PUBLISHABLE = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
const SECRET = process.env.SUPABASE_SECRET_KEY!;
if (!URL || !PUBLISHABLE || !SECRET) {
  throw new Error("Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, SUPABASE_SECRET_KEY");
}

const noSession = { auth: { persistSession: false, autoRefreshToken: false } };
const service = createClient<Database>(URL, SECRET, noSession);

type Role = "admin" | "recruiter" | "viewer";
type OrgKey = "A" | "B";
type User = { id: string; client: SupabaseClient<Database> };
type Seed = {
  orgId: string;
  scenarioId: string;
  assessmentId: string;
  jobId: string;
  inviteId: string;
  attemptId: string;
  flagId: string;
  noteId: string;
};

const run = randomBytes(4).toString("hex");
const users = {} as Record<OrgKey, Record<Role, User>>;
const seed = {} as Record<OrgKey, Seed>;
let libraryScenarioId = "";
const createdUserIds: string[] = [];

async function makeUser(label: string): Promise<User> {
  const email = `rls-${run}-${label}@example.test`;
  const password = randomBytes(18).toString("base64url");
  const { data, error } = await service.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;
  createdUserIds.push(data.user.id);
  const client = createClient<Database>(URL, PUBLISHABLE, noSession);
  const signIn = await client.auth.signInWithPassword({ email, password });
  if (signIn.error) throw signIn.error;
  return { id: data.user.id, client };
}

function must<R extends { data: unknown; error: unknown }>(res: R): NonNullable<R["data"]> {
  if (res.error) throw res.error;
  return res.data as NonNullable<R["data"]>;
}

async function seedOrg(key: OrgKey): Promise<Seed> {
  const admin = users[key].admin;
  const orgId = must(await admin.client.rpc("create_organization", { org_name: `RLS test ${key} ${run}` })) as string;

  must(
    await service.from("memberships").insert([
      { org_id: orgId, user_id: users[key].recruiter.id, role: "recruiter" },
      { org_id: orgId, user_id: users[key].viewer.id, role: "viewer" },
    ]),
  );

  const scenario = must(
    await service
      .from("scenarios")
      .insert({ org_id: orgId, slug: `private-${run}-${key}`, title: "Private", role_family: "accounting", definition: { steps: [] } })
      .select("id")
      .single(),
  );
  const assessment = must(
    await service
      .from("assessments")
      .insert({ org_id: orgId, scenario_id: scenario.id, title: "Assessment", time_limit_minutes: 40 })
      .select("id")
      .single(),
  );
  const job = must(
    await service.from("jobs").insert({ org_id: orgId, title: "Intern", assessment_id: assessment.id }).select("id").single(),
  );
  const invite = must(
    await service
      .from("invites")
      .insert({ org_id: orgId, job_id: job.id, email: `cand-${key}@example.test`, expires_at: new Date(Date.now() + 864e5).toISOString() })
      .select("id")
      .single(),
  );
  must(await service.from("invite_secrets").insert({ invite_id: invite.id, org_id: orgId, token_hash: `hash-${randomUUID()}` }));
  const attempt = must(
    await service
      .from("attempts")
      .insert({ org_id: orgId, invite_id: invite.id, scenario_id: scenario.id, status: "in_progress" })
      .select("id")
      .single(),
  );
  must(await service.from("attempt_secrets").insert({ attempt_id: attempt.id, org_id: orgId, seed: "seed" }));
  must(await service.from("step_responses").insert({ attempt_id: attempt.id, org_id: orgId, step_id: "s1", answer: { x: 1 } }));
  must(await service.from("action_events").insert({ attempt_id: attempt.id, org_id: orgId, kind: "opened_message" }));
  must(await service.from("integrity_events").insert({ attempt_id: attempt.id, org_id: orgId, kind: "tab_switch" }));
  must(await service.from("media").insert({ attempt_id: attempt.id, org_id: orgId, source: "camera", storage_path: "x.jpg" }));
  const flag = must(
    await service.from("flags").insert({ attempt_id: attempt.id, org_id: orgId, reason: "tab switch" }).select("id").single(),
  );
  const note = must(
    await service
      .from("notes")
      .insert({ attempt_id: attempt.id, org_id: orgId, author_id: admin.id, body: "note" })
      .select("id")
      .single(),
  );
  must(await service.from("audit_log").insert({ org_id: orgId, actor_id: admin.id, action: "viewed_report" }));

  return {
    orgId,
    scenarioId: scenario.id,
    assessmentId: assessment.id,
    jobId: job.id,
    inviteId: invite.id,
    attemptId: attempt.id,
    flagId: flag.id,
    noteId: note.id,
  };
}

beforeAll(async () => {
  for (const key of ["A", "B"] as const) {
    users[key] = {
      admin: await makeUser(`${key}-admin`),
      recruiter: await makeUser(`${key}-recruiter`),
      viewer: await makeUser(`${key}-viewer`),
    };
  }
  seed.A = await seedOrg("A");
  seed.B = await seedOrg("B");

  const lib = must(
    await service
      .from("scenarios")
      .insert({
        org_id: null,
        slug: `library-${run}`,
        title: "Library",
        role_family: "accounting",
        definition: { steps: [] },
        published_at: new Date().toISOString(),
      })
      .select("id")
      .single(),
  );
  libraryScenarioId = lib.id;
});

afterAll(async () => {
  const orgIds = [seed.A?.orgId, seed.B?.orgId].filter(Boolean) as string[];
  if (orgIds.length) await service.from("organizations").delete().in("id", orgIds);
  if (libraryScenarioId) await service.from("scenarios").delete().eq("id", libraryScenarioId);
  for (const id of createdUserIds) await service.auth.admin.deleteUser(id);
});

const tenantTables = [
  "organizations",
  "memberships",
  "assessments",
  "jobs",
  "invites",
  "attempts",
  "step_responses",
  "action_events",
  "integrity_events",
  "flags",
  "notes",
] as const;

const orgColumn = (table: string) => (table === "organizations" ? "id" : "org_id");

describe("reads stay inside the user's org", () => {
  for (const key of ["A", "B"] as const) {
    for (const role of ["admin", "recruiter", "viewer"] as const) {
      it(`${key} ${role} sees only org ${key} rows in every tenant table`, async () => {
        const other = key === "A" ? seed.B : seed.A;
        for (const table of tenantTables) {
          const rows = must(await users[key][role].client.from(table).select(orgColumn(table))) as unknown as Record<string, string>[];
          expect(rows.length, `${table} should have own rows`).toBeGreaterThan(0);
          for (const row of rows) {
            expect(row[orgColumn(table)], `${table} leaked org ${other.orgId}`).toBe(seed[key].orgId);
          }
        }
      });
    }
  }

  it("asking for another org's rows by id returns nothing", async () => {
    const a = users.A.admin.client;
    expect(must(await a.from("attempts").select("id").eq("id", seed.B.attemptId))).toEqual([]);
    expect(must(await a.from("invites").select("id").eq("id", seed.B.inviteId))).toEqual([]);
    expect(must(await a.from("organizations").select("id").eq("id", seed.B.orgId))).toEqual([]);
    expect(must(await a.from("scenarios").select("id").eq("id", seed.B.scenarioId))).toEqual([]);
  });

  it("audit log is admin-only", async () => {
    expect((must(await users.A.admin.client.from("audit_log").select("id")) as unknown[]).length).toBeGreaterThan(0);
    expect(must(await users.A.recruiter.client.from("audit_log").select("id"))).toEqual([]);
    expect(must(await users.A.viewer.client.from("audit_log").select("id"))).toEqual([]);
  });
});

describe("candidate secrets are server-only", () => {
  for (const table of ["invite_secrets", "attempt_secrets"] as const) {
    it(`no signed-in user can read ${table}`, async () => {
      for (const role of ["admin", "recruiter", "viewer"] as const) {
        const res = await users.A[role].client.from(table).select("*");
        expect(res.data ?? [], `${role} read ${table}`).toEqual([]);
      }
    });
  }
});

describe("writes into another org are blocked", () => {
  it("cannot insert a job into another org", async () => {
    const res = await users.A.admin.client
      .from("jobs")
      .insert({ org_id: seed.B.orgId, title: "Hijack", assessment_id: seed.B.assessmentId });
    expect(res.error).not.toBeNull();
  });

  it("cannot add yourself to another org", async () => {
    const res = await users.A.admin.client
      .from("memberships")
      .insert({ org_id: seed.B.orgId, user_id: users.A.admin.id, role: "admin" });
    expect(res.error).not.toBeNull();
  });

  it("updates and deletes on another org's rows touch nothing", async () => {
    const a = users.A.admin.client;
    expect(must(await a.from("jobs").update({ title: "Changed" }).eq("id", seed.B.jobId).select("id"))).toEqual([]);
    expect(must(await a.from("organizations").update({ name: "Changed" }).eq("id", seed.B.orgId).select("id"))).toEqual([]);
    expect(must(await a.from("invites").delete().eq("id", seed.B.inviteId).select("id"))).toEqual([]);
    expect(must(await a.from("flags").update({ status: "cleared", reviewed_by: users.A.admin.id }).eq("id", seed.B.flagId).select("id"))).toEqual([]);

    const job = must(await service.from("jobs").select("title").eq("id", seed.B.jobId).single());
    expect(job.title).toBe("Intern");
  });

  it("cannot move your own row into another org", async () => {
    const res = await users.A.admin.client.from("jobs").update({ org_id: seed.B.orgId }).eq("id", seed.A.jobId).select("id");
    expect(res.error).not.toBeNull();
  });
});

describe("roles inside an org", () => {
  it("viewer cannot create jobs or invites", async () => {
    const v = users.A.viewer.client;
    expect((await v.from("jobs").insert({ org_id: seed.A.orgId, title: "x", assessment_id: seed.A.assessmentId })).error).not.toBeNull();
    expect(
      (await v.from("invites").insert({ org_id: seed.A.orgId, job_id: seed.A.jobId, email: "x@example.test", expires_at: new Date().toISOString() }))
        .error,
    ).not.toBeNull();
  });

  it("viewer cannot clear flags; recruiter can", async () => {
    const viewerRes = must(
      await users.A.viewer.client.from("flags").update({ status: "cleared", reviewed_by: users.A.viewer.id }).eq("id", seed.A.flagId).select("id"),
    );
    expect(viewerRes).toEqual([]);
    const recruiterRes = must(
      await users.A.recruiter.client
        .from("flags")
        .update({ status: "cleared", reviewed_by: users.A.recruiter.id, reviewed_at: new Date().toISOString() })
        .eq("id", seed.A.flagId)
        .select("id"),
    );
    expect(recruiterRes).toHaveLength(1);
  });

  it("recruiter cannot add teammates; admin can", async () => {
    const extra = await makeUser("A-extra");
    expect(
      (await users.A.recruiter.client.from("memberships").insert({ org_id: seed.A.orgId, user_id: extra.id, role: "viewer" })).error,
    ).not.toBeNull();
    must(await users.A.admin.client.from("memberships").insert({ org_id: seed.A.orgId, user_id: extra.id, role: "viewer" }));
  });

  it("anyone in the org can write their own note but not as someone else", async () => {
    const v = users.A.viewer;
    must(await v.client.from("notes").insert({ attempt_id: seed.A.attemptId, org_id: seed.A.orgId, author_id: v.id, body: "hi", vote: "hire" }));
    const forged = await v.client
      .from("notes")
      .insert({ attempt_id: seed.A.attemptId, org_id: seed.A.orgId, author_id: users.A.admin.id, body: "forged" });
    expect(forged.error).not.toBeNull();
    expect(must(await v.client.from("notes").update({ body: "edited" }).eq("id", seed.A.noteId).select("id"))).toEqual([]);
  });

  it("company users cannot write candidate answers", async () => {
    const res = await users.A.admin.client
      .from("step_responses")
      .insert({ attempt_id: seed.A.attemptId, org_id: seed.A.orgId, step_id: "s2", answer: {} });
    expect(res.error).not.toBeNull();
  });

  it("viewers see proctoring media only when the org allows it", async () => {
    expect((must(await users.A.recruiter.client.from("media").select("id")) as unknown[]).length).toBe(1);
    expect(must(await users.A.viewer.client.from("media").select("id"))).toEqual([]);
    must(await users.A.admin.client.from("organizations").update({ settings: { viewers_see_media: true } }).eq("id", seed.A.orgId).select("id"));
    expect((must(await users.A.viewer.client.from("media").select("id")) as unknown[]).length).toBe(1);
  });
});

describe("scenarios and orgs", () => {
  it("every signed-in user sees published library scenarios", async () => {
    for (const key of ["A", "B"] as const) {
      const rows = must(await users[key].viewer.client.from("scenarios").select("id").eq("id", libraryScenarioId));
      expect(rows).toHaveLength(1);
    }
  });

  it("company users cannot edit library scenarios", async () => {
    const res = must(await users.A.admin.client.from("scenarios").update({ title: "x" }).eq("id", libraryScenarioId).select("id"));
    expect(res).toEqual([]);
  });

  it("anonymous visitors see nothing and cannot create orgs", async () => {
    const anon = createClient<Database>(URL, PUBLISHABLE, noSession);
    for (const table of [...tenantTables, "scenarios", "media", "audit_log"] as const) {
      const res = await anon.from(table).select("*");
      expect(res.data ?? [], `anon read ${table}`).toEqual([]);
    }
    expect((await anon.rpc("create_organization", { org_name: "nope" })).error).not.toBeNull();
  });

  it("role helpers are not callable through the API", async () => {
    // Deliberately calls a function the typed client doesn't know about.
    const untyped = users.A.admin.client as unknown as SupabaseClient;
    const res = await untyped.rpc("is_org_member", { target_org: seed.A.orgId });
    expect(res.error).not.toBeNull();
  });
});
