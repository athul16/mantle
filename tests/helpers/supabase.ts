/** Supabase clients for tests: the service role (bypasses RLS) and signed-in users (RLS applies). */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../src/lib/database.types";
import { requireDbEnv } from "./env";
import { stepUp, totpSecretFor } from "./totp";

export type Db = SupabaseClient<Database>;

const noSession = { auth: { persistSession: false, autoRefreshToken: false } };

let cachedService: Db | undefined;

/** Service-role client. Bypasses RLS: use it to arrange data and to check results, never as the actor under test. */
export function serviceClient(): Db {
  if (!cachedService) {
    const env = requireDbEnv();
    cachedService = createClient<Database>(env.url, env.secretKey, noSession);
  }
  return cachedService;
}

/** A fresh, signed-out client with the publishable key (an anonymous visitor). */
export function anonClient(): Db {
  const env = requireDbEnv();
  return createClient<Database>(env.url, env.publishableKey, noSession);
}

/**
 * Signs in with email + password and returns a client acting as that user.
 * A user with an authenticator factor made by the factories is stepped up to
 * aal2 (as after the sign-in code), unless `{ aal: "aal1" }`.
 */
export async function signedInClient(email: string, password: string, { aal = "aal2" }: { aal?: "aal1" | "aal2" } = {}): Promise<Db> {
  const client = anonClient();
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`sign-in as ${email} failed: ${error.message}`);
  const secret = totpSecretFor(email);
  if (secret && aal === "aal2") await stepUp(client, secret);
  return client;
}

/** Unwraps a supabase-js result, throwing its error. */
export function must<R extends { data: unknown; error: unknown }>(res: R): NonNullable<R["data"]> {
  if (res.error) throw res.error;
  return res.data as NonNullable<R["data"]>;
}
