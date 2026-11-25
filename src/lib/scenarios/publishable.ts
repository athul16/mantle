/**
 * Draft gate for `pnpm scenarios:publish`. Only the versions listed here go
 * into the platform library; every other scenario in code is a draft and is
 * skipped. Add a `slug@vN` here once its content review has signed it off (or
 * the team decides to publish it for testing), never from a scenario's own PR.
 *
 * Drafts can still be published into a local test database with
 * `--include-drafts`, which refuses any non-local Supabase URL.
 */
export const PUBLISHABLE: ReadonlySet<string> = new Set([
  "demo-petty-cash@v1",
  // Accounting (docs/07), v1 for testing 2026-11-17
  "harbor-lane-bank-rec@v1",
  "audit-calder-bluestem@v1",
  "corporate-ap-ridgeway@v1",
  // Paralegal (docs/14), v1 for testing 2026-11-17
  "ediscovery-larch-review@v1",
  "litigation-morrow-tidewater@v1",
  "corporate-halyard-robotics@v1",
  "realestate-alder-closing@v1",
  "immigration-h1b-packet@v1",
  "pi-diaz-demand@v1",
]);

interface Versioned {
  slug: string;
  version: number;
}

export function splitPublishable<T extends Versioned>(
  scenarios: readonly T[],
  allowlist: ReadonlySet<string> = PUBLISHABLE,
): { publish: T[]; drafts: T[] } {
  const publish: T[] = [];
  const drafts: T[] = [];
  for (const s of scenarios) (allowlist.has(`${s.slug}@v${s.version}`) ? publish : drafts).push(s);
  return { publish, drafts };
}

const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);

/** Throws unless `url` points at a local Supabase; drafts never reach the cloud. */
export function assertDraftsAllowed(url: string | undefined): void {
  let host = "";
  try {
    host = url ? new URL(url).hostname : "";
  } catch {
    // fall through to the error below
  }
  if (!LOCAL_HOSTS.has(host)) {
    throw new Error("--include-drafts only works against a local Supabase (pnpm db:test:start)");
  }
}
