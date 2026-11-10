/**
 * Code resend cooldown against the local test database. The 30 s gap between
 * code emails must hold even when requests arrive at the same time (double
 * click, script), and a code send on a deployment without email configured
 * fails with a config error instead of writing to .dev-outbox.
 */
import { createClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { requireDbEnv } from "../helpers/env";
import { clearEmails, emailsTo } from "../helpers/outbox";
import type { Database } from "@/lib/database.types";

vi.mock("server-only", () => ({}));

const { url, secretKey } = requireDbEnv();
delete process.env.RESEND_API_KEY;

const { generateToken, hashToken } = await import("@/lib/tokens");
const { publishScenario } = await import("@/lib/scenarios/publish");
const { requestCode } = await import("@/lib/candidate/code");
const { CODE_RESEND_SECONDS } = await import("@/lib/candidate/config");
const { EnvError } = await import("@/lib/env");

const service = createClient<Database>(url, secretKey, { auth: { persistSession: false, autoRefreshToken: false } });
const run = randomBytes(4).toString("hex");
const emails: string[] = [];
let orgId = "";
let jobId = "";
let n = 0;

function must<R extends { data: unknown; error: unknown }>(res: R): NonNullable<R["data"]> {
  if (res.error) throw res.error;
  return res.data as NonNullable<R["data"]>;
}

async function makeInvite() {
  n += 1;
  const email = `cooldown-${run}-${n}@example.test`;
  emails.push(email);
  const token = generateToken();
  const invite = must(
    await service
      .from("invites")
      .insert({ org_id: orgId, job_id: jobId, email, expires_at: new Date(Date.now() + 7 * 86_400_000).toISOString() })
      .select("id")
      .single(),
  );
  must(await service.from("invite_secrets").insert({ invite_id: invite.id, org_id: orgId, token_hash: hashToken(token) }));
  return { token, email, inviteId: invite.id };
}

beforeAll(async () => {
  const scenarioId = await publishScenario("demo-petty-cash", 1);
  orgId = must(await service.from("organizations").insert({ name: `Cooldown ${run}`, slug: `cooldown-${run}` }).select("id").single()).id;
  const assessmentId = must(
    await service.from("assessments").insert({ org_id: orgId, scenario_id: scenarioId, title: "Petty cash", time_limit_minutes: 15 }).select("id").single(),
  ).id;
  jobId = must(await service.from("jobs").insert({ org_id: orgId, title: "Clerk", assessment_id: assessmentId }).select("id").single()).id;
});

afterAll(async () => {
  if (orgId) must(await service.from("organizations").delete().eq("id", orgId));
  await clearEmails(emails);
});

describe("code resend cooldown", () => {
  it("sends one email when several requests arrive at once", async () => {
    const invite = await makeInvite();
    const results = await Promise.all(Array.from({ length: 5 }, () => requestCode(invite.token)));
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok).every((r) => !r.ok && r.error === "too_soon")).toBe(true);
    expect(await emailsTo(invite.email)).toHaveLength(1);
  });

  it("allows a new code once the cooldown has passed", async () => {
    const invite = await makeInvite();
    const t0 = new Date();
    expect(await requestCode(invite.token, t0)).toMatchObject({ ok: true });
    expect(await requestCode(invite.token, new Date(t0.getTime() + (CODE_RESEND_SECONDS - 1) * 1000))).toEqual({ ok: false, error: "too_soon" });
    expect(await requestCode(invite.token, new Date(t0.getTime() + (CODE_RESEND_SECONDS + 1) * 1000))).toMatchObject({ ok: true });
    expect(await emailsTo(invite.email)).toHaveLength(2);
  });
});

describe("code send on a deployment without email", () => {
  it("throws the config error and writes nothing to the outbox", async () => {
    const invite = await makeInvite();
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("EMAIL_FROM", "Acme <hiring@acme-assess.com>");
    try {
      await expect(requestCode(invite.token)).rejects.toBeInstanceOf(EnvError);
    } finally {
      vi.unstubAllEnvs();
    }
    expect(await emailsTo(invite.email)).toHaveLength(0);
  });
});
