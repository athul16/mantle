/**
 * GET /api/health against the local test database: booleans only, no-store,
 * no secrets in the body, and a missing key degrades to false rather than a
 * crash.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { requireDbEnv } from "../helpers/env";

vi.mock("server-only", () => ({}));
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), connection: async () => {} }));

const { secretKey } = requireDbEnv();
const { GET } = await import("@/app/api/health/route");

const KEY = "re_DO_NOT_LEAK_health";
const call = () => GET();

afterEach(() => vi.unstubAllEnvs());

describe("GET /api/health", () => {
  it("returns exactly { ok, db, storage, email } as booleans with no-store", async () => {
    vi.stubEnv("RESEND_API_KEY", "");
    vi.stubEnv("VERCEL_ENV", "");
    const res = await call();
    expect(res.headers.get("cache-control")).toContain("no-store");
    const body = await res.json();
    expect(Object.keys(body).sort()).toEqual(["db", "email", "ok", "storage"]);
    for (const v of Object.values(body)) expect(typeof v).toBe("boolean");
    // Local test database: reachable, and the proctoring bucket comes from the migrations.
    expect(body).toMatchObject({ db: true, storage: true, email: false });
    // Locally the outbox stands in for email, so the app is still healthy.
    expect(body.ok).toBe(true);
    expect(res.status).toBe(200);
  });

  it("reports email true when Resend is configured, and never echoes values", async () => {
    vi.stubEnv("RESEND_API_KEY", KEY);
    vi.stubEnv("EMAIL_FROM", "Acme Assessments <hiring@acme-assess.com>");
    const res = await call();
    const text = await res.text();
    expect(JSON.parse(text)).toMatchObject({ ok: true, db: true, storage: true, email: true });
    for (const secret of [KEY, secretKey, "acme-assess.com", "supabase"]) expect(text).not.toContain(secret);
  });

  it("is not ok on a deployment without email", async () => {
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("RESEND_API_KEY", "");
    const res = await call();
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ ok: false, db: true, storage: true, email: false });
  });

  it("degrades to false without the service key instead of throwing", async () => {
    vi.stubEnv("SUPABASE_SECRET_KEY", "");
    const res = await call();
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body).toMatchObject({ ok: false, db: false, storage: false });
  });
});
