/**
 * src/lib/env.ts: one place that checks the server env vars. Messages name the
 * missing or invalid variables and never include any value.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

const { EnvError, REQUIRED_SERVER_ENV, emailEnvProblems, isDeployedEnv, missingEnv, requireEnv } = await import("@/lib/env");

const SECRET = "sb_secret_DO_NOT_LEAK_123";
const RESEND = "re_DO_NOT_LEAK_456";

afterEach(() => vi.unstubAllEnvs());

describe("missingEnv / requireEnv", () => {
  it("lists the required server vars from docs/01", () => {
    expect(REQUIRED_SERVER_ENV).toEqual(
      expect.arrayContaining([
        "NEXT_PUBLIC_SUPABASE_URL",
        "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
        "SUPABASE_SECRET_KEY",
        "NEXT_PUBLIC_APP_URL",
      ]),
    );
  });

  it("reports missing and blank names, in order", () => {
    const env = { A: "x", B: "", C: "   " };
    expect(missingEnv(["A", "B", "C", "D"], env)).toEqual(["B", "C", "D"]);
    expect(missingEnv(["A"], env)).toEqual([]);
  });

  it("throws an EnvError naming the missing variables without any value", () => {
    const env = { SUPABASE_SECRET_KEY: SECRET, RESEND_API_KEY: RESEND };
    let caught: unknown;
    try {
      requireEnv(["SUPABASE_SECRET_KEY", "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_APP_URL"], env);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(EnvError);
    const e = caught as InstanceType<typeof EnvError>;
    expect(e.variables).toEqual(["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_APP_URL"]);
    expect(e.message).toContain("NEXT_PUBLIC_SUPABASE_URL");
    expect(e.message).toContain("NEXT_PUBLIC_APP_URL");
    expect(e.message).not.toContain("SUPABASE_SECRET_KEY");
    expect(e.message).not.toContain(SECRET);
    expect(e.message).not.toContain(RESEND);
  });

  it("passes when everything is set", () => {
    expect(() => requireEnv(["A"], { A: "1" })).not.toThrow();
  });

  it("reads process.env by default", () => {
    vi.stubEnv("ENV_TEST_ONLY_VAR", "");
    expect(missingEnv(["ENV_TEST_ONLY_VAR"])).toEqual(["ENV_TEST_ONLY_VAR"]);
  });
});

describe("isDeployedEnv", () => {
  it("is true on Vercel production and preview only", () => {
    expect(isDeployedEnv({ VERCEL_ENV: "production" })).toBe(true);
    expect(isDeployedEnv({ VERCEL_ENV: "preview" })).toBe(true);
    expect(isDeployedEnv({ VERCEL_ENV: "development" })).toBe(false);
    // `next start` locally and in e2e runs with NODE_ENV=production but writes to the outbox.
    expect(isDeployedEnv({ NODE_ENV: "production" })).toBe(false);
    expect(isDeployedEnv({})).toBe(false);
  });
});

describe("emailEnvProblems", () => {
  const good = { RESEND_API_KEY: RESEND, EMAIL_FROM: "Acme Assessments <hiring@acme-assess.com>" };

  it("is empty when the key and a real sender are set", () => {
    expect(emailEnvProblems(good)).toEqual([]);
  });

  it("names a missing key or sender", () => {
    expect(emailEnvProblems({ EMAIL_FROM: good.EMAIL_FROM })).toEqual(["RESEND_API_KEY"]);
    expect(emailEnvProblems({ RESEND_API_KEY: RESEND })).toEqual(["EMAIL_FROM"]);
    expect(emailEnvProblems({})).toEqual(["RESEND_API_KEY", "EMAIL_FROM"]);
  });

  it("rejects the example.com placeholder and senders without an address", () => {
    expect(emailEnvProblems({ ...good, EMAIL_FROM: "Assessment Platform <no-reply@example.com>" })).toEqual(["EMAIL_FROM"]);
    expect(emailEnvProblems({ ...good, EMAIL_FROM: "no-reply@mail.example.com" })).toEqual(["EMAIL_FROM"]);
    expect(emailEnvProblems({ ...good, EMAIL_FROM: "Assessment Platform" })).toEqual(["EMAIL_FROM"]);
  });
});
