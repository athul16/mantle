/**
 * Test environment: where the throwaway Supabase lives and the guard that keeps
 * tests off the real (cloud) database.
 *
 * `pnpm db:test:env` writes `.env.test` from `supabase status -o env`. Every
 * test runner (Vitest setup, Playwright config, scripts) calls `loadTestEnv()`
 * first, which copies `.env.test` into process.env (overriding the shell and
 * anything from .env.local), then `assertLocalSupabase()` refuses to go on if
 * the URL is not a local one. Set ALLOW_CLOUD_TESTS=1 to bypass on purpose.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { parseEnv } from "node:util";

export const ENV_TEST_FILE = ".env.test";
const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);

/** Copies `.env.test` (if present) into process.env, overriding existing values. Returns whether it was found. */
export function loadTestEnv(root = process.cwd()): boolean {
  const file = path.join(root, ENV_TEST_FILE);
  if (!existsSync(file)) return false;
  const parsed = parseEnv(readFileSync(file, "utf8"));
  for (const [key, value] of Object.entries(parsed)) process.env[key] = value;
  return true;
}

export function isLocalUrl(url: string): boolean {
  try {
    return LOCAL_HOSTS.has(new URL(url).hostname);
  } catch {
    return false;
  }
}

/** Throws unless `url` points at a local Supabase (or ALLOW_CLOUD_TESTS=1). */
export function assertLocalSupabase(url: string | undefined = process.env.NEXT_PUBLIC_SUPABASE_URL): void {
  if (!url) return;
  if (isLocalUrl(url)) return;
  if (process.env.ALLOW_CLOUD_TESTS === "1") {
    console.warn(`[tests] ALLOW_CLOUD_TESTS=1: running against ${new URL(url).host}`);
    return;
  }
  throw new Error(
    `Refusing to run tests against ${safeHost(url)}. Tests use the local throwaway Supabase: ` +
      "run `pnpm db:test:start` (writes .env.test). Set ALLOW_CLOUD_TESTS=1 only if you really mean the cloud project.",
  );
}

export type DbEnv = { url: string; publishableKey: string; secretKey: string };

/** URL and keys for database tests. Loads `.env.test`, applies the guard, throws a helpful error if missing. */
export function requireDbEnv(): DbEnv {
  loadTestEnv();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  if (!url || !publishableKey || !secretKey) {
    throw new Error("No test database configured. Run `pnpm db:test:start` (starts local Supabase and writes .env.test).");
  }
  assertLocalSupabase(url);
  return { url, publishableKey, secretKey };
}

function safeHost(url: string) {
  try {
    return new URL(url).host;
  } catch {
    return "an invalid URL";
  }
}
