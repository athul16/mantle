/**
 * Invite sending on a deployment with email misconfigured: the recruiter gets
 * a result they can act on (failed addresses / an InviteError), not a crash,
 * and nothing lands in .dev-outbox.
 */
import { createClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { requireDbEnv } from "../helpers/env";
import { clearEmails, emailsTo } from "../helpers/outbox";
import type { Database } from "@/lib/database.types";

vi.mock("server-only", () => ({}));

const { url, secretKey } = requireDbEnv();
const { publishScenario } = await import("@/lib/scenarios/publish");
const { createInvites, resendInvite, InviteError } = await import("@/lib/jobs/invites");

const service = createClient<Database>(url, secretKey, { auth: { persistSession: false, autoRefreshToken: false } });
const run = randomBytes(4).toString("hex");
const email = `invcfg-${run}@example.test`;
let orgId = "";
let jobId = "";

function must<R extends { data: unknown; error: unknown }>(res: R): NonNullable<R["data"]> {
  if (res.error) throw res.error;
  return res.data as NonNullable<R["data"]>;
}

beforeAll(async () => {
  const scenarioId = await publishScenario("demo-petty-cash", 1);
  orgId = must(await service.from("organizations").insert({ name: `Invite cfg ${run}`, slug: `invcfg-${run}` }).select("id").single()).id;
  const assessmentId = must(
    await service.from("assessments").insert({ org_id: orgId, scenario_id: scenarioId, title: "Petty cash", time_limit_minutes: 15 }).select("id").single(),
  ).id;
  jobId = must(await service.from("jobs").insert({ org_id: orgId, title: "Clerk", assessment_id: assessmentId }).select("id").single()).id;
  vi.stubEnv("VERCEL_ENV", "production");
  vi.stubEnv("RESEND_API_KEY", "");
  vi.stubEnv("EMAIL_FROM", "Acme <hiring@acme-assess.com>");
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterAll(async () => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  if (orgId) must(await service.from("organizations").delete().eq("id", orgId));
  await clearEmails([email]);
});

describe("invites without email configured", () => {
  let inviteId = "";

  it("createInvites reports the address as failed to send", async () => {
    const result = await createInvites({ db: service, orgId, orgName: "Acme", jobId, recipients: [{ email, name: null }], createdBy: null as unknown as string });
    expect(result).toEqual({ invited: [email], alreadyInvited: [], failedToSend: [email] });
    expect(await emailsTo(email)).toHaveLength(0);
    inviteId = must(await service.from("invites").select("id").eq("org_id", orgId).eq("email", email).single()).id;
  });

  it("resendInvite turns it into an InviteError the form can show", async () => {
    await expect(resendInvite({ db: service, orgId, orgName: "Acme", inviteId })).rejects.toBeInstanceOf(InviteError);
    expect(await emailsTo(email)).toHaveLength(0);
  });
});
