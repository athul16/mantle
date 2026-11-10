/**
 * Server-side enforcement of admin two-factor in src/lib/auth.ts, against the
 * local test database. `createClient()` returns a supabase-js client signed in
 * as the acting user, so the assurance level is the real one from Supabase Auth.
 *
 * - requireMembership (every server action): an admin below aal2 is refused.
 * - requireOrgMembership (every company page): an admin below aal2 is
 *   redirected to enrol or verify.
 * - Recruiters and viewers are not forced.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createTestData, type TestCompany } from "../helpers/factories";
import { signedInClient, type Db } from "../helpers/supabase";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => acting }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT ${url}`);
  },
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
}));

const auth = await import("@/lib/auth");

const data = createTestData("mfa");
let acting: Db;
let co: TestCompany;
let noFactor: TestCompany;

beforeAll(async () => {
  co = await data.company();
  noFactor = await data.company({ adminMfa: false });
});

afterAll(() => data.cleanup());

describe("requireMembership (server actions)", () => {
  it("refuses an admin with no factor", async () => {
    acting = await signedInClient(noFactor.users.admin.email, noFactor.users.admin.password);
    await expect(auth.requireMembership(noFactor.orgId)).rejects.toThrow(/two-factor/i);
    await expect(auth.requireMembership(noFactor.orgId, ["admin"])).rejects.toBeInstanceOf(auth.AuthorizationError);
  });

  it("refuses an admin with a factor who has only entered a password (aal1)", async () => {
    acting = await signedInClient(co.users.admin.email, co.users.admin.password, { aal: "aal1" });
    await expect(auth.requireMembership(co.orgId, ["admin"])).rejects.toThrow(/two-factor/i);
  });

  it("lets an admin at aal2 through", async () => {
    acting = await signedInClient(co.users.admin.email, co.users.admin.password);
    await expect(auth.requireMembership(co.orgId, ["admin"])).resolves.toMatchObject({ orgId: co.orgId, role: "admin" });
  });

  it.each(["recruiter", "viewer"] as const)("does not force a %s", async (role) => {
    acting = await signedInClient(co.users[role].email, co.users[role].password);
    await expect(auth.requireMembership(co.orgId)).resolves.toMatchObject({ role });
  });
});

describe("requireOrgMembership (company pages)", () => {
  it("redirects an admin with no factor to enrol", async () => {
    acting = await signedInClient(noFactor.users.admin.email, noFactor.users.admin.password);
    await expect(auth.requireOrgMembership(noFactor.slug)).rejects.toThrow(
      `REDIRECT /app/account/security?next=${encodeURIComponent(`/app/${noFactor.slug}`)}`,
    );
  });

  it("redirects an admin at aal1 with a factor to verify", async () => {
    acting = await signedInClient(co.users.admin.email, co.users.admin.password, { aal: "aal1" });
    await expect(auth.requireOrgMembership(co.slug)).rejects.toThrow(`REDIRECT /app/account/verify?next=${encodeURIComponent(`/app/${co.slug}`)}`);
  });

  it("lets an admin at aal2 and a recruiter at aal1 through", async () => {
    acting = await signedInClient(co.users.admin.email, co.users.admin.password);
    await expect(auth.requireOrgMembership(co.slug)).resolves.toMatchObject({ role: "admin" });
    acting = await signedInClient(co.users.recruiter.email, co.users.recruiter.password);
    await expect(auth.requireOrgMembership(co.slug)).resolves.toMatchObject({ role: "recruiter" });
  });
});
