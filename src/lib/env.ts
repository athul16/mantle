/**
 * Server environment checks in one place. Everything here reports variable
 * NAMES only; no function in this file ever puts a value into a message, log
 * or response.
 */

type Env = Record<string, string | undefined>;

/** Needed by every server request (docs/01-architecture-and-hosting.md). */
export const REQUIRED_SERVER_ENV = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_SECRET_KEY",
  "NEXT_PUBLIC_APP_URL",
] as const;

/** Needed on a deployment to send app email (invites, candidate codes). */
export const EMAIL_ENV = ["RESEND_API_KEY", "EMAIL_FROM"] as const;

/** Missing or invalid environment variables. `variables` holds names, never values. */
export class EnvError extends Error {
  readonly variables: string[];
  constructor(variables: string[], hint = "Set them in Vercel → Project → Settings → Environment Variables and redeploy.") {
    super(`Missing or invalid environment variables: ${variables.join(", ")}. ${hint}`);
    this.name = "EnvError";
    this.variables = variables;
  }
}

/** Names from `names` that are unset or blank. */
export function missingEnv(names: readonly string[], env: Env = process.env): string[] {
  return names.filter((name) => !env[name]?.trim());
}

/** Throws an EnvError naming whatever in `names` is unset or blank. */
export function requireEnv(names: readonly string[], env: Env = process.env): void {
  const missing = missingEnv(names, env);
  if (missing.length) throw new EnvError(missing);
}

/**
 * A real deployment that people use: Vercel production or preview. Both have
 * a read-only filesystem, so the .dev-outbox fallback would lose email there.
 * NODE_ENV alone is not used: `next start` runs locally and in the e2e suite
 * with NODE_ENV=production and relies on the outbox.
 */
export function isDeployedEnv(env: Env = process.env): boolean {
  return env.VERCEL_ENV === "production" || env.VERCEL_ENV === "preview";
}

/** example.com / .org / .net and their subdomains are placeholders, not senders. */
const PLACEHOLDER_SENDER = /@([a-z0-9-]+\.)*example\.(com|org|net)>?\s*$/i;
const HAS_ADDRESS = /[^\s<@]+@[^\s>@]+\.[^\s>@]+/;

/** Email variables that are missing or unusable for real sending. Empty means Resend is ready. */
export function emailEnvProblems(env: Env = process.env): string[] {
  const problems = missingEnv(["RESEND_API_KEY"], env);
  const from = env.EMAIL_FROM?.trim() ?? "";
  if (!from || !HAS_ADDRESS.test(from) || PLACEHOLDER_SENDER.test(from)) problems.push("EMAIL_FROM");
  return problems;
}

/** True when app email goes out through Resend from a real sender. */
export function emailConfigured(env: Env = process.env): boolean {
  return emailEnvProblems(env).length === 0;
}
