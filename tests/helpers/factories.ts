/**
 * Fixture factories for database, integration and E2E tests.
 *
 *   const data = createTestData("jobs");
 *   const co = await data.company();                       // org + admin/recruiter/viewer
 *   const { assessmentId } = await data.assessment({ orgId: co.orgId });
 *   const { jobId } = await data.job({ orgId: co.orgId, assessmentId });
 *   const invite = await data.invite({ orgId: co.orgId, jobId }); // has the raw token
 *   afterAll(() => data.cleanup());
 *
 * Everything is arranged with the service role (RLS bypassed) and named with a
 * random run id, so parallel tests never collide. `cleanup()` deletes the
 * companies (cascading to their rows), the auth users and their outbox emails.
 * No Vitest or Playwright imports here, so both runners can use it.
 */
import { createHash, randomBytes } from "node:crypto";
import { clearEmails } from "./outbox";
import { must, serviceClient, signedInClient, type Db } from "./supabase";
import { enrollTotp, rememberTotpSecret } from "./totp";

export type Role = "admin" | "recruiter" | "viewer";
/** `totpSecret` is set when the user has a verified authenticator factor (company admins, by default). */
export type TestUser = { id: string; email: string; password: string; totpSecret?: string };
export type TestCompany = { orgId: string; name: string; slug: string; users: Record<Role, TestUser> };

/** sha256 hex, same as hashToken in src/lib/tokens.ts (which is server-only). */
export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");
export const generateToken = () => randomBytes(32).toString("base64url");

const DAY = 86_400_000;

export function createTestData(prefix = "t") {
  const run = randomBytes(4).toString("hex");
  const orgIds: string[] = [];
  const userIds: string[] = [];
  const emails: string[] = [];
  let n = 0;
  const db = (): Db => serviceClient();

  const email = (label = `x${++n}`) => {
    const address = `${prefix}-${run}-${label}@example.test`.toLowerCase();
    emails.push(address);
    return address;
  };

  async function user(label?: string): Promise<TestUser> {
    const address = email(label);
    const password = randomBytes(18).toString("base64url");
    const { data, error } = await db().auth.admin.createUser({ email: address, password, email_confirm: true });
    if (error) throw error;
    userIds.push(data.user.id);
    return { id: data.user.id, email: address, password };
  }

  /**
   * A company created by its admin through `create_organization` (so the slug is generated), plus a recruiter and a viewer.
   * Admins must use two-factor authentication, so the admin gets a verified authenticator factor
   * (`users.admin.totpSecret`) unless `adminMfa: false`.
   */
  async function company({ name, adminMfa = true }: { name?: string; adminMfa?: boolean } = {}): Promise<TestCompany> {
    const label = `c${++n}`;
    const orgName = name ?? `Test ${prefix} ${run} ${label}`;
    const admin = await user(`${label}-admin`);
    const recruiter = await user(`${label}-recruiter`);
    const viewer = await user(`${label}-viewer`);
    const adminClient = await signedInClient(admin.email, admin.password);
    const orgId = must(await adminClient.rpc("create_organization", { org_name: orgName })) as string;
    orgIds.push(orgId);
    if (adminMfa) {
      admin.totpSecret = (await enrollTotp(adminClient)).secret;
      rememberTotpSecret(admin.email, admin.totpSecret);
    }
    await adminClient.auth.signOut();
    must(
      await db().from("memberships").insert([
        { org_id: orgId, user_id: recruiter.id, role: "recruiter" },
        { org_id: orgId, user_id: viewer.id, role: "viewer" },
      ]),
    );
    const { slug } = must(await db().from("organizations").select("slug").eq("id", orgId).single());
    return { orgId, name: orgName, slug, users: { admin, recruiter, viewer } };
  }

  /** Id of a published platform-library scenario (org_id null). Run publishDemoScenarios() first. */
  async function libraryScenario(slug = "demo-petty-cash", version = 1): Promise<string> {
    const row = must(
      await db().from("scenarios").select("id").is("org_id", null).eq("slug", slug).eq("version", version).maybeSingle(),
    );
    if (!row) throw new Error(`${slug}@v${version} is not published; the test setup should have published it`);
    return row.id;
  }

  async function assessment(opts: {
    orgId: string;
    scenarioId?: string;
    title?: string;
    timeLimitMinutes?: number;
    passScore?: number | null;
    proctoring?: { camera?: boolean; screen?: boolean };
  }) {
    const scenarioId = opts.scenarioId ?? (await libraryScenario());
    const row = must(
      await db()
        .from("assessments")
        .insert({
          org_id: opts.orgId,
          scenario_id: scenarioId,
          title: opts.title ?? "Petty cash",
          time_limit_minutes: opts.timeLimitMinutes ?? 15,
          pass_score: opts.passScore ?? null,
          proctoring: opts.proctoring ?? {},
        })
        .select("id")
        .single(),
    );
    return { assessmentId: row.id, scenarioId };
  }

  async function job(opts: { orgId: string; assessmentId: string; title?: string; deadline?: Date | null }) {
    const deadline = opts.deadline === undefined ? new Date(Date.now() + 14 * DAY) : opts.deadline;
    const row = must(
      await db()
        .from("jobs")
        .insert({ org_id: opts.orgId, assessment_id: opts.assessmentId, title: opts.title ?? "Audit intern", deadline: deadline?.toISOString() ?? null })
        .select("id")
        .single(),
    );
    return { jobId: row.id };
  }

  /** An invite with its secret row, as the jobs side would create it. Returns the raw link token. */
  async function invite(opts: {
    orgId: string;
    jobId: string;
    email?: string;
    expiresAt?: Date;
    status?: "invited" | "started" | "completed" | "expired" | "revoked";
  }) {
    const address = opts.email ?? email();
    const token = generateToken();
    const row = must(
      await db()
        .from("invites")
        .insert({
          org_id: opts.orgId,
          job_id: opts.jobId,
          email: address,
          expires_at: (opts.expiresAt ?? new Date(Date.now() + 7 * DAY)).toISOString(),
          status: opts.status ?? "invited",
        })
        .select("id")
        .single(),
    );
    must(await db().from("invite_secrets").insert({ invite_id: row.id, org_id: opts.orgId, token_hash: hashToken(token) }));
    return { inviteId: row.id, email: address, token, link: `/a/${token}` };
  }

  /** An attempt row (and its secret) for an invite. Defaults to in progress, started now. */
  async function attempt(opts: {
    orgId: string;
    inviteId: string;
    scenarioId: string;
    status?: "not_started" | "in_progress" | "submitted" | "scored";
    startedAt?: Date | null;
    timeLimitMinutes?: number;
    seed?: string;
  }) {
    const status = opts.status ?? "in_progress";
    const startedAt = opts.startedAt === undefined ? (status === "not_started" ? null : new Date()) : opts.startedAt;
    const deadlineAt = startedAt ? new Date(startedAt.getTime() + (opts.timeLimitMinutes ?? 15) * 60_000) : null;
    const row = must(
      await db()
        .from("attempts")
        .insert({
          org_id: opts.orgId,
          invite_id: opts.inviteId,
          scenario_id: opts.scenarioId,
          status,
          started_at: startedAt?.toISOString() ?? null,
          deadline_at: deadlineAt?.toISOString() ?? null,
        })
        .select("id")
        .single(),
    );
    must(await db().from("attempt_secrets").insert({ attempt_id: row.id, org_id: opts.orgId, seed: opts.seed ?? `seed-${run}` }));
    return { attemptId: row.id };
  }

  /** Company + assessment + job + one invite: the usual starting point. */
  async function hiringSetup(opts: { timeLimitMinutes?: number } = {}) {
    const co = await company();
    const { assessmentId, scenarioId } = await assessment({ orgId: co.orgId, timeLimitMinutes: opts.timeLimitMinutes });
    const { jobId } = await job({ orgId: co.orgId, assessmentId });
    const inv = await invite({ orgId: co.orgId, jobId });
    return { company: co, assessmentId, scenarioId, jobId, invite: inv };
  }

  /** Deletes companies (cascade), auth users and outbox emails made through this instance. Safe to call twice. */
  async function cleanup() {
    const s = db();
    for (const id of orgIds.splice(0)) await s.from("organizations").delete().eq("id", id);
    for (const id of userIds.splice(0)) await s.auth.admin.deleteUser(id);
    await clearEmails(emails.splice(0));
  }

  /** Register a company created some other way (e.g. through the UI) so cleanup() deletes it. */
  const trackOrg = (orgId: string) => void orgIds.push(orgId);
  const trackUser = (userId: string) => void userIds.push(userId);

  return { run, email, user, company, libraryScenario, assessment, job, invite, attempt, hiringSetup, cleanup, trackOrg, trackUser };
}

export type TestData = ReturnType<typeof createTestData>;
