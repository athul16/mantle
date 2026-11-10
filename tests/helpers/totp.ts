/**
 * TOTP (authenticator app) helpers for tests: generate codes for a secret, and
 * enrol or step up a supabase-js client to aal2. Admins must be at aal2 to use
 * company pages and actions (docs/02-security-and-integrity.md).
 *
 * Secrets are remembered per email so signedInClient() and the e2e sign-in
 * helper can step a user up without every test passing the secret around.
 */
import { Secret, TOTP } from "otpauth";
import type { SupabaseClient } from "@supabase/supabase-js";

const secrets = new Map<string, string>();

export function rememberTotpSecret(email: string, secret: string) {
  secrets.set(email.toLowerCase(), secret);
}

export function totpSecretFor(email: string): string | undefined {
  return secrets.get(email.toLowerCase());
}

/** The 6-digit code for `secret` at `at` (ms). Codes change every 30 seconds. */
export function totpCode(secret: string, at = Date.now()): string {
  return new TOTP({ secret: Secret.fromBase32(secret), digits: 6, period: 30, algorithm: "SHA1" }).generate({ timestamp: at });
}

type AnyClient = SupabaseClient<any, any, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/** Challenges and verifies the user's verified TOTP factor, so the client's session becomes aal2. */
export async function stepUp(client: AnyClient, secret: string): Promise<void> {
  const { data: factors, error } = await client.auth.mfa.listFactors();
  if (error) throw error;
  const factor = factors.totp.find((f) => f.status === "verified");
  if (!factor) throw new Error("no verified TOTP factor to step up with");
  await verifyWithRetry(client, factor.id, secret);
}

/** Enrols and verifies a TOTP factor for the signed-in client (session ends at aal2). Returns the secret. */
export async function enrollTotp(client: AnyClient, friendlyName = "Test authenticator"): Promise<{ factorId: string; secret: string }> {
  const { data, error } = await client.auth.mfa.enroll({ factorType: "totp", friendlyName });
  if (error) throw error;
  await verifyWithRetry(client, data.id, data.totp.secret);
  return { factorId: data.id, secret: data.totp.secret };
}

// The server accepts the previous, current and next 30-second code. Try the
// current one, then its neighbours, so a test never fails on a window edge.
async function verifyWithRetry(client: AnyClient, factorId: string, secret: string) {
  let last: unknown;
  for (const offset of [0, -30_000, 30_000]) {
    const { error } = await client.auth.mfa.challengeAndVerify({ factorId, code: totpCode(secret, Date.now() + offset) });
    if (!error) return;
    last = error;
  }
  throw last;
}
