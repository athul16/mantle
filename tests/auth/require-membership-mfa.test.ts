/**
 * Server-side enforcement of two-factor in src/lib/auth.ts, against the local
 * test database. `createClient()` returns a supabase-js client signed in as the
 * acting user, so the assurance level is the real one from Supabase Auth.
 *
 * - requireMembership (every server action): an admin or recruiter below aal2
 *   is refused.
 * - requireOrgMembership (every company page): they are redirected to enrol or
 *   verify.
 * - Viewers are forced only when the company turns on viewers_see_media.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createTestData, type TestCompany } from "../helpers/factories";
import { must, serviceClient, signedInClient, type Db } from "../helpers/supabase";

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
let media: TestCompany;

beforeAll(async () => {
  co = await data.company();
  noFactor = await data.company({ mfa: false });
  // A company that shows viewers the proctoring media; its viewer has a factor.
  media = await data.company({ viewerMfa: true });
  must(await serviceClient().from("organizations").update({ settings: { viewers_see_media: true } }).eq("id", media.orgId));
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

  it("refuses a recruiter with no factor, and one at aal1", async () => {
    acting = await signedInClient(noFactor.users.recruiter.email, noFactor.users.recruiter.password);
    await expect(auth.requireMembership(noFactor.orgId)).rejects.toThrow(/two-factor/i);
    acting = await signedInClient(co.users.recruiter.email, co.users.recruiter.password, { aal: "aal1" });
    await expect(auth.requireMembership(co.orgId)).rejects.toThrow(/two-factor/i);
  });

  it("lets a recruiter at aal2 through", async () => {
    acting = await signedInClient(co.users.recruiter.email, co.users.recruiter.password);
    await expect(auth.requireMembership(co.orgId)).resolves.toMatchObject({ role: "recruiter" });
  });

  it("does not force a viewer while the company keeps media from viewers", async () => {
    acting = await signedInClient(co.users.viewer.email, co.users.viewer.password);
    await expect(auth.requireMembership(co.orgId)).resolves.toMatchObject({ role: "viewer", viewersSeeMedia: false });
  });

  it("forces a viewer when the company lets viewers see media", async () => {
    acting = await signedInClient(media.users.viewer.email, media.users.viewer.password, { aal: "aal1" });
    await expect(auth.requireMembership(media.orgId)).rejects.toThrow(/two-factor/i);
    acting = await signedInClient(media.users.viewer.email, media.users.viewer.password);
    await expect(auth.requireMembership(media.orgId)).resolves.toMatchObject({ role: "viewer", viewersSeeMedia: true });
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

  it("redirects a recruiter with no factor to enrol, and one at aal1 to verify", async () => {
    acting = await signedInClient(noFactor.users.recruiter.email, noFactor.users.recruiter.password);
    await expect(auth.requireOrgMembership(noFactor.slug)).rejects.toThrow(
      `REDIRECT /app/account/security?next=${encodeURIComponent(`/app/${noFactor.slug}`)}`,
    );
    acting = await signedInClient(co.users.recruiter.email, co.users.recruiter.password, { aal: "aal1" });
    await expect(auth.requireOrgMembership(co.slug)).rejects.toThrow(`REDIRECT /app/account/verify?next=${encodeURIComponent(`/app/${co.slug}`)}`);
  });

  it("redirects a viewer at aal1 only when the company shows viewers media", async () => {
    acting = await signedInClient(media.users.viewer.email, media.users.viewer.password, { aal: "aal1" });
    await expect(auth.requireOrgMembership(media.slug)).rejects.toThrow(`REDIRECT /app/account/verify?next=${encodeURIComponent(`/app/${media.slug}`)}`);
    acting = await signedInClient(co.users.viewer.email, co.users.viewer.password);
    await expect(auth.requireOrgMembership(co.slug)).resolves.toMatchObject({ role: "viewer" });
  });

  it("lets an admin and a recruiter at aal2 through", async () => {
    acting = await signedInClient(co.users.admin.email, co.users.admin.password);
    await expect(auth.requireOrgMembership(co.slug)).resolves.toMatchObject({ role: "admin" });
    acting = await signedInClient(co.users.recruiter.email, co.users.recruiter.password);
    await expect(auth.requireOrgMembership(co.slug)).resolves.toMatchObject({ role: "recruiter" });
  });
});
