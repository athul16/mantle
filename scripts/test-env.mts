/**
 * Writes `.env.test` (git-ignored) with the local throwaway Supabase's URL and
 * keys, read from `supabase status -o env`. Tests and the E2E server read it;
 * see docs/11-testing.md.
 *
 *   pnpm db:test:env                 # write .env.test
 *   pnpm db:test:env --github-env    # also append to $GITHUB_ENV (CI)
 *
 * The local keys are the CLI's fixed development keys, not secrets, but this
 * script still never prints them.
 */
import { execFileSync } from "node:child_process";
import { appendFileSync, writeFileSync } from "node:fs";
import { parseEnv } from "node:util";

const E2E_PORT = process.env.E2E_PORT ?? "3210";

const raw = execFileSync("pnpm", ["exec", "supabase", "status", "-o", "env"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const status = parseEnv(raw.split("\n").filter((l) => /^[A-Z_]+=/.test(l)).join("\n"));

const pick = (...names: string[]) => {
  for (const name of names) if (status[name]) return status[name];
  throw new Error(`supabase status has none of ${names.join(", ")}. Is the local stack running (pnpm db:test:start)?`);
};

const url = pick("API_URL");
if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/?$/.test(url)) throw new Error(`supabase status API_URL is not local: ${url}`);

const env: Record<string, string> = {
  NEXT_PUBLIC_SUPABASE_URL: url,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: pick("PUBLISHABLE_KEY", "ANON_KEY"),
  SUPABASE_SECRET_KEY: pick("SECRET_KEY", "SERVICE_ROLE_KEY"),
  SUPABASE_DB_URL: pick("DB_URL"),
  NEXT_PUBLIC_APP_URL: `http://localhost:${E2E_PORT}`,
  // Emails go to .dev-outbox, never through Resend.
  RESEND_API_KEY: "",
};

const body = Object.entries(env)
  .map(([k, v]) => `${k}=${v}`)
  .join("\n");
writeFileSync(".env.test", `# Written by scripts/test-env.mts from \`supabase status\`. Local throwaway database only.\n${body}\n`);
console.log(`wrote .env.test (${Object.keys(env).join(", ")}) for ${url}`);

if (process.argv.includes("--github-env")) {
  const target = process.env.GITHUB_ENV;
  if (!target) throw new Error("--github-env given but GITHUB_ENV is not set");
  appendFileSync(target, `${body}\n`);
  console.log("appended to $GITHUB_ENV");
}
