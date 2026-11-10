"use server";

import { redirect } from "next/navigation";
import * as z from "zod";
import type { FormState } from "@/components/ui";
import { getAssuranceLevels, requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { SECURITY_PATH, safeNext } from "./mfa-gate";

// Two-factor (TOTP) actions with Supabase Auth MFA. They act on the signed-in
// user's own session through the user's client; Supabase Auth itself refuses
// to add or remove a factor at aal1 once a verified factor exists.

const code = z.string().trim().regex(/^\d{6}$/, { error: "Enter the 6-digit code from your authenticator app." });
const WRONG_CODE = "That code didn't work. Check the time on your phone is set automatically, then enter the current code.";

export type Enrollment = { factorId: string; qrCode: string; secret: string } | { error: string };

/** Starts adding an authenticator app: returns the QR code and secret to show once. */
export async function startEnrollment(): Promise<Enrollment> {
  await requireUser();
  const supabase = await createClient();
  const aal = await getAssuranceLevels();
  if (aal.nextLevel === "aal2" && aal.currentLevel !== "aal2") return { error: "Enter your sign-in code first." };

  const { data: factors, error: listError } = await supabase.auth.mfa.listFactors();
  if (listError) return { error: "Could not start setup. Try again." };
  // Drop abandoned setups (a QR code shown but never confirmed).
  for (const f of factors.all) {
    if (f.factor_type === "totp" && f.status === "unverified") await supabase.auth.mfa.unenroll({ factorId: f.id });
  }

  const added = new Date().toISOString().slice(0, 16).replace("T", " ");
  const { data, error } = await supabase.auth.mfa.enroll({
    factorType: "totp",
    friendlyName: `Authenticator app (${added} UTC)`,
    issuer: "Assessment Platform",
  });
  if (error) return { error: "Could not start setup. Try again." };
  return { factorId: data.id, qrCode: data.totp.qr_code, secret: data.totp.secret };
}

/** Confirms a new authenticator app with its first code. The session becomes aal2. */
export async function confirmEnrollment(_state: FormState, formData: FormData): Promise<FormState> {
  await requireUser();
  const parsed = z.object({ factorId: z.uuid(), code }).safeParse({ factorId: formData.get("factorId"), code: formData.get("code") });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? WRONG_CODE };

  const supabase = await createClient();
  const { error } = await supabase.auth.mfa.challengeAndVerify(parsed.data);
  if (error) return { error: WRONG_CODE };
  const next = formData.get("next");
  redirect(next ? safeNext(next) : SECURITY_PATH);
}

/** Signing in: the code from an existing authenticator app. The session becomes aal2. */
export async function verifySignIn(_state: FormState, formData: FormData): Promise<FormState> {
  await requireUser();
  const parsed = code.safeParse(formData.get("code"));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };

  const supabase = await createClient();
  const { data: factors, error: listError } = await supabase.auth.mfa.listFactors();
  if (listError) return { error: "Could not check your code. Try again." };
  const verified = factors.totp.filter((f) => f.status === "verified");
  if (verified.length === 0) redirect(SECURITY_PATH);

  // Any of the user's authenticator apps will do.
  for (const factor of verified) {
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: factor.id, code: parsed.data });
    if (!error) redirect(safeNext(formData.get("next")));
  }
  return { error: WRONG_CODE };
}

/** Removes an authenticator app. Supabase Auth requires aal2 for this. */
export async function removeFactor(formData: FormData) {
  await requireUser();
  const factorId = z.uuid().safeParse(formData.get("factorId"));
  if (!factorId.success) redirect(SECURITY_PATH);

  const supabase = await createClient();
  const { error } = await supabase.auth.mfa.unenroll({ factorId: factorId.data });
  if (error) redirect(`${SECURITY_PATH}?error=remove`);
  // The current access token still says aal2; refresh so the session reflects the removal.
  await supabase.auth.refreshSession();
  redirect(SECURITY_PATH);
}
