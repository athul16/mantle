/**
 * Read-only smoke check of the real (cloud) deployment, for the nightly
 * workflow. Writes nothing: checks the Supabase API answers, that an anonymous
 * visitor sees no organizations (RLS on), and optionally that the deployed
 * app's login page loads.
 *
 *   CLOUD_SUPABASE_URL=... CLOUD_SUPABASE_PUBLISHABLE_KEY=... [CLOUD_APP_URL=...] tsx scripts/cloud-smoke.mts
 */
import { createClient } from "@supabase/supabase-js";

const url = process.env.CLOUD_SUPABASE_URL;
const key = process.env.CLOUD_SUPABASE_PUBLISHABLE_KEY;
const appUrl = process.env.CLOUD_APP_URL;
if (!url || !key) {
  console.log("CLOUD_SUPABASE_URL / CLOUD_SUPABASE_PUBLISHABLE_KEY not set; skipping.");
  process.exit(0);
}

const failures: string[] = [];
const check = (ok: boolean, label: string) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${label}`);
  if (!ok) failures.push(label);
};

const health = await fetch(`${url}/auth/v1/health`, { headers: { apikey: key } });
check(health.ok, `auth health responds (${health.status})`);

const anon = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const orgs = await anon.from("organizations").select("id").limit(1);
check(!orgs.error && (orgs.data ?? []).length === 0, "anonymous visitor sees no organizations");

if (appUrl) {
  const login = await fetch(new URL("/login", appUrl));
  check(login.ok && (await login.text()).includes("Sign in"), `app /login loads (${login.status})`);
}

if (failures.length) process.exit(1);
