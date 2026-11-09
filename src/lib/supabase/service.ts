import "server-only";

import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

// Service-role client. BYPASSES RLS. Server only.
// Use only where no signed-in company user exists (candidate routes, jobs) or
// for auth admin calls (inviting teammates), and always scope queries by
// org/attempt yourself.
export function createServiceClient() {
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!key) throw new Error("SUPABASE_SECRET_KEY is not set");
  return createClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
