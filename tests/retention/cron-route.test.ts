import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const runRetentionPurge = vi.fn(async () => ({ checked: 1, purged: 1, failed: 0, objectsRemoved: 3 }));
vi.mock("@/lib/retention/purge", () => ({ runRetentionPurge }));
vi.mock("@/lib/supabase/service", () => ({ createServiceClient: () => ({}) }));

const { GET } = await import("@/app/api/cron/retention/route");
const { isAuthorizedCron } = await import("@/lib/retention/cron-auth");

const SECRET = "test-cron-secret-0123456789abcdef";
const req = (auth?: string) =>
  new Request("http://localhost/api/cron/retention", auth === undefined ? {} : { headers: { authorization: auth } });

describe("isAuthorizedCron", () => {
  it("accepts only the exact bearer secret", () => {
    expect(isAuthorizedCron(`Bearer ${SECRET}`, SECRET)).toBe(true);
    expect(isAuthorizedCron(`Bearer ${SECRET}x`, SECRET)).toBe(false);
    expect(isAuthorizedCron(SECRET, SECRET)).toBe(false);
    expect(isAuthorizedCron(`bearer ${SECRET}`, SECRET)).toBe(false);
    expect(isAuthorizedCron(null, SECRET)).toBe(false);
  });

  it("refuses everything when no secret is configured", () => {
    expect(isAuthorizedCron("Bearer ", "")).toBe(false);
    expect(isAuthorizedCron("Bearer undefined", undefined)).toBe(false);
  });
});

describe("GET /api/cron/retention", () => {
  const saved = process.env.CRON_SECRET;
  beforeEach(() => {
    process.env.CRON_SECRET = SECRET;
    runRetentionPurge.mockClear();
  });
  afterEach(() => {
    process.env.CRON_SECRET = saved;
  });

  it("returns 401 without an Authorization header", async () => {
    const res = await GET(req());
    expect(res.status).toBe(401);
    expect(runRetentionPurge).not.toHaveBeenCalled();
  });

  it("returns 401 with the wrong secret", async () => {
    const res = await GET(req("Bearer wrong"));
    expect(res.status).toBe(401);
    expect(runRetentionPurge).not.toHaveBeenCalled();
  });

  it("returns 401 when CRON_SECRET is not set, even for 'Bearer undefined'", async () => {
    delete process.env.CRON_SECRET;
    const res = await GET(req("Bearer undefined"));
    expect(res.status).toBe(401);
    expect(runRetentionPurge).not.toHaveBeenCalled();
  });

  it("runs the purge with the right secret and returns counts only", async () => {
    const res = await GET(req(`Bearer ${SECRET}`));
    expect(res.status).toBe(200);
    expect(runRetentionPurge).toHaveBeenCalledTimes(1);
    expect(await res.json()).toEqual({ checked: 1, purged: 1, failed: 0, objectsRemoved: 3 });
  });

  it("returns 500 when the purge throws", async () => {
    runRetentionPurge.mockRejectedValueOnce(new Error("db down"));
    const res = await GET(req(`Bearer ${SECRET}`));
    expect(res.status).toBe(500);
  });
});
