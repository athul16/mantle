import "server-only";

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { connection } from "next/server";
import type { Database } from "@/lib/database.types";

// Server client acting as the signed-in company user (session from cookies).
// RLS applies. Use this for anything a company user reads or writes.
export async function createClient() {
  // Session checks compare token expiry with the current time. With Cache
  // Components + partial prefetching, Next may prerender with cookies but not
  // the clock; connection() forces this to run at request time instead.
  await connection();
  const cookieStore = await cookies();

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Called from a Server Component, where cookies are read-only.
            // The proxy refreshes the session on every request, so this is safe.
          }
        },
      },
    },
  );
}
