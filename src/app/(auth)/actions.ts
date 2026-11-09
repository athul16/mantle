"use server";

import { redirect } from "next/navigation";
import * as z from "zod";
import type { FormState } from "@/components/ui";
import { safeNext } from "@/lib/safe-redirect";
import { createClient } from "@/lib/supabase/server";

const credentials = z.object({
  email: z.email({ error: "Enter a valid email." }).trim().toLowerCase(),
  password: z.string().min(8, { error: "Use at least 8 characters." }),
});

export async function login(_state: FormState, formData: FormData): Promise<FormState> {
  const parsed = credentials.safeParse({ email: formData.get("email"), password: formData.get("password") });
  if (!parsed.success) return { fieldErrors: z.flattenError(parsed.error).fieldErrors };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) {
    if (error.code === "email_not_confirmed") return { error: "Confirm your email first. Check your inbox for the link." };
    return { error: "Email or password is incorrect." };
  }
  redirect(safeNext(formData.get("next")));
}

export async function signup(_state: FormState, formData: FormData): Promise<FormState> {
  const parsed = credentials.safeParse({ email: formData.get("email"), password: formData.get("password") });
  if (!parsed.success) return { fieldErrors: z.flattenError(parsed.error).fieldErrors };

  const supabase = await createClient();
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const { data, error } = await supabase.auth.signUp({
    ...parsed.data,
    options: { emailRedirectTo: `${appUrl}/auth/confirm?next=/onboarding` },
  });
  if (error) {
    if (error.code === "user_already_exists") return { error: "An account with this email already exists. Sign in instead." };
    if (error.code === "weak_password") return { error: error.message };
    if (error.code === "over_email_send_rate_limit") return { error: "Too many sign-up emails sent. Try again in a few minutes." };
    return { error: "Could not create your account. Try again." };
  }
  // Email confirmation off → we already have a session.
  if (data.session) redirect("/onboarding");
  return { message: "Check your email for a confirmation link to finish signing up." };
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
