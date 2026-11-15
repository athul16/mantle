"use server";

import type { EmailOtpType } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import * as z from "zod";
import type { FormState } from "@/components/ui";
import { safeNext } from "@/lib/safe-redirect";
import { createClient } from "@/lib/supabase/server";
import { LINK_EXPIRED } from "./messages";

// Supabase email links (teammate invites and sign-up confirmation) land on
// /auth/confirm, which only shows a button. Using up the one-time token
// happens here, on the button's POST, so a link scanner (Microsoft Safe
// Links) that opens the page first can't spend it (decision D13 / Q3).

const TYPES = ["invite", "email", "signup"] as const satisfies readonly EmailOtpType[];

const schema = z.union([
  z.object({ token_hash: z.string().min(1).max(512), type: z.enum(TYPES), next: z.string().optional() }),
  // PKCE sign-up links from Supabase's own /verify redirect (default email template).
  z.object({ code: z.string().min(1).max(512), next: z.string().optional() }),
]);

export async function confirmLink(_state: FormState, formData: FormData): Promise<FormState> {
  const parsed = schema.safeParse({
    token_hash: formData.get("token_hash") || undefined,
    type: formData.get("type") || undefined,
    code: formData.get("code") || undefined,
    next: formData.get("next") || undefined,
  });
  if (!parsed.success) return { error: LINK_EXPIRED };

  const supabase = await createClient();
  const input = parsed.data;
  if ("token_hash" in input) {
    const { error } = await supabase.auth.verifyOtp({ type: input.type, token_hash: input.token_hash });
    if (error) return { error: LINK_EXPIRED };
    redirect(input.type === "invite" ? "/auth/set-password" : safeNext(input.next, "/app"));
  }
  const { error } = await supabase.auth.exchangeCodeForSession(input.code);
  if (error) return { error: LINK_EXPIRED };
  redirect(safeNext(input.next, "/app"));
}
