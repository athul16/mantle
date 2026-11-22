import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { listScenarios } = await import("@/lib/engine/scenarios");
const { PUBLISHABLE, assertDraftsAllowed, splitPublishable } = await import("@/lib/scenarios/publishable");

/**
 * Draft gate for `pnpm scenarios:publish`: only versions on the allowlist are
 * published; every other scenario in code is a draft and is skipped.
 */
describe("publish draft gate", () => {
  it("every allowlisted version exists in code", () => {
    const inCode = new Set(listScenarios().map((s) => `${s.slug}@v${s.version}`));
    for (const key of PUBLISHABLE) expect(inCode, key).toContain(key);
  });

  it("publishes only allowlisted versions and skips the rest as drafts", () => {
    const scenarios = [
      { slug: "a", version: 1 },
      { slug: "a", version: 2 },
      { slug: "b", version: 1 },
    ];
    const { publish, drafts } = splitPublishable(scenarios, new Set(["a@v1", "b@v1"]));
    expect(publish).toEqual([
      { slug: "a", version: 1 },
      { slug: "b", version: 1 },
    ]);
    expect(drafts).toEqual([{ slug: "a", version: 2 }]);
  });

  it("keeps the unpublished demos out of the library", () => {
    for (const slug of ["demo-mini-close", "demo-entries-review", "demo-timed-close"]) {
      expect(PUBLISHABLE).not.toContain(`${slug}@v1`);
    }
  });

  it("lists the ten versions already in the cloud library", () => {
    expect([...PUBLISHABLE].sort()).toEqual(
      [
        "demo-petty-cash@v1",
        "harbor-lane-bank-rec@v1",
        "audit-calder-bluestem@v1",
        "corporate-ap-ridgeway@v1",
        "ediscovery-larch-review@v1",
        "litigation-morrow-tidewater@v1",
        "corporate-halyard-robotics@v1",
        "realestate-alder-closing@v1",
        "immigration-h1b-packet@v1",
        "pi-diaz-demand@v1",
      ].sort(),
    );
  });

  it("allows drafts only against a local Supabase", () => {
    expect(() => assertDraftsAllowed("http://127.0.0.1:54321")).not.toThrow();
    expect(() => assertDraftsAllowed("http://localhost:54321")).not.toThrow();
    expect(() => assertDraftsAllowed("https://abc.supabase.co")).toThrow(/local Supabase/);
    expect(() => assertDraftsAllowed(undefined)).toThrow(/local Supabase/);
    expect(() => assertDraftsAllowed("not a url")).toThrow(/local Supabase/);
  });
});
