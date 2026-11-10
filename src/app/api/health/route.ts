import { NextResponse, connection } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { REQUIRED_SERVER_ENV, emailConfigured, isDeployedEnv, missingEnv } from "@/lib/env";

/**
 * Uptime / smoke check. Booleans only: never values, error messages or
 * hostnames. `ok` needs the database and the proctoring bucket, plus real
 * email on a deployment (locally the .dev-outbox stands in for email).
 */
const TIMEOUT_MS = 5_000;

export async function GET() {
  await connection();

  const envReady = missingEnv(REQUIRED_SERVER_ENV.filter((n) => n !== "NEXT_PUBLIC_APP_URL")).length === 0;
  const [db, storage] = envReady ? await Promise.all([check(dbReachable), check(bucketExists)]) : [false, false];
  const email = emailConfigured();
  const ok = db && storage && (email || !isDeployedEnv());

  return NextResponse.json(
    { ok, db, storage, email },
    { status: ok ? 200 : 503, headers: { "Cache-Control": "no-store, max-age=0" } },
  );
}

async function dbReachable() {
  const { error } = await createServiceClient().from("organizations").select("id", { head: true }).limit(1);
  return !error;
}

async function bucketExists() {
  const { data, error } = await createServiceClient().storage.getBucket("proctoring");
  return !error && data?.id === "proctoring";
}

/** Runs a probe with a timeout; any throw or timeout is `false`. */
async function check(probe: () => Promise<boolean>): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => resolve(false), TIMEOUT_MS);
  });
  try {
    return await Promise.race([probe().catch(() => false), timeout]);
  } finally {
    clearTimeout(timer);
  }
}
