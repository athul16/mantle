"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import * as z from "zod";
import type { FormState } from "@/components/ui";
import { requireUser, ACTIVE_ORG_COOKIE } from "@/lib/auth";
import { activeOrgCookieOptions } from "@/lib/active-org-cookie";
import { createClient } from "@/lib/supabase/server";

const schema = z.object({
  name: z.string().trim().min(2, { error: "Enter your company's name." }).max(120, { error: "Keep it under 120 characters." }),
});

export async function createOrganization(_state: FormState, formData: FormData): Promise<FormState> {
  await requireUser();
  const parsed = schema.safeParse({ name: formData.get("name") });
  if (!parsed.success) return { fieldErrors: z.flattenError(parsed.error).fieldErrors };

  // create_organization inserts the org and makes the caller its admin in one
  // transaction (see supabase/migrations/*_initial_schema.sql).
  const supabase = await createClient();
  const { data: orgId, error } = await supabase.rpc("create_organization", { org_name: parsed.data.name });
  if (error || !orgId) return { error: "Could not create the company. Try again." };

  // The database picked the URL slug; read it back to land on the new company.
  const { data: org } = await supabase.from("organizations").select("slug").eq("id", orgId).single();

  (await cookies()).set(ACTIVE_ORG_COOKIE, orgId, activeOrgCookieOptions);
  // Drop any cached /app render from before the org existed (it redirected here).
  revalidatePath("/", "layout");
  redirect(org ? `/app/${org.slug}` : "/app");
}
