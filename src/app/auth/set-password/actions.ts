"use server";

import { redirect } from "next/navigation";
import * as z from "zod";
import type { FormState } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";

const schema = z
  .object({
    password: z.string().min(8, { error: "Use at least 8 characters." }),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, { error: "Passwords don't match.", path: ["confirm"] });

export async function setPassword(_state: FormState, formData: FormData): Promise<FormState> {
  const parsed = schema.safeParse({ password: formData.get("password"), confirm: formData.get("confirm") });
  if (!parsed.success) return { fieldErrors: z.flattenError(parsed.error).fieldErrors };

  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return { error: "Your invite session expired. Open the invite link again." };

  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) return { error: error.code === "same_password" ? "Choose a different password." : "Could not save your password. Try again." };
  redirect("/app");
}
