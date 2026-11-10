/**
 * The admin two-factor rule (docs/02-security-and-integrity.md): a company
 * admin must be at aal2. No factor → enrol; a factor but aal1 → verify.
 * Recruiters and viewers are never forced. Pure logic, no database.
 */
import { describe, expect, it } from "vitest";
import { mfaGate, mfaRedirectPath, safeNext } from "@/app/app/account/mfa-gate";

const noFactor = { currentLevel: "aal1", nextLevel: "aal1" } as const;
const factorAtAal1 = { currentLevel: "aal1", nextLevel: "aal2" } as const;
const atAal2 = { currentLevel: "aal2", nextLevel: "aal2" } as const;

describe("mfaGate", () => {
  it("sends an admin with no factor to enrol", () => {
    expect(mfaGate("admin", noFactor)).toBe("enroll");
  });

  it("sends an admin with a factor who signed in with a password only to verify", () => {
    expect(mfaGate("admin", factorAtAal1)).toBe("verify");
  });

  it("lets an admin at aal2 through", () => {
    expect(mfaGate("admin", atAal2)).toBe("ok");
  });

  it("treats unknown assurance levels as no factor (enrol), never as passed", () => {
    expect(mfaGate("admin", { currentLevel: null, nextLevel: null })).toBe("enroll");
    expect(mfaGate("admin", { currentLevel: null, nextLevel: "aal2" })).toBe("verify");
  });

  it.each(["recruiter", "viewer"] as const)("never forces a %s", (role) => {
    for (const aal of [noFactor, factorAtAal1, atAal2]) expect(mfaGate(role, aal)).toBe("ok");
  });

  it("has nothing to say about someone who isn't a member", () => {
    expect(mfaGate(null, noFactor)).toBe("ok");
  });
});

describe("mfaRedirectPath", () => {
  it("sends enrol to the security page and verify to the code page, keeping where the admin was going", () => {
    expect(mfaRedirectPath("enroll", "/app/acme/jobs?x=1")).toBe(`/app/account/security?next=${encodeURIComponent("/app/acme/jobs?x=1")}`);
    expect(mfaRedirectPath("verify", "/app/acme")).toBe(`/app/account/verify?next=${encodeURIComponent("/app/acme")}`);
  });
});

describe("safeNext", () => {
  it("keeps same-site paths", () => {
    expect(safeNext("/app/acme/team")).toBe("/app/acme/team");
    expect(safeNext("/app/acme/candidates?job=1")).toBe("/app/acme/candidates?job=1");
  });

  it.each([null, undefined, "", "https://evil.example", "//evil.example", "/\\evil.example", "javascript:alert(1)", "app"])(
    "falls back to /app for %s",
    (next) => {
      expect(safeNext(next)).toBe("/app");
    },
  );

  it("never loops back to the MFA pages themselves", () => {
    expect(safeNext("/app/account/verify?next=/app")).toBe("/app");
  });
});
