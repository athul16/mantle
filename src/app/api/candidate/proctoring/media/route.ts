import type { NextRequest } from "next/server";
import { json, readFields, sessionFromRequest, unauthorized } from "@/lib/candidate/http";
import { confirmMedia } from "@/lib/proctoring/server";

/**
 * { path, reason? } after an upload: records the snapshot or audio clip once
 * the file is in the attempt's folder. The source comes from the path; a
 * reason outside CAPTURE_REASONS is recorded as none.
 */
export async function POST(req: NextRequest) {
  const session = await sessionFromRequest(req);
  if (!session) return unauthorized();
  const { path, reason } = await readFields(req);
  const result = await confirmMedia(session, { path, reason });
  if (!result.ok) return json(result, result.error === "bad_path" ? 400 : 409);
  return json({ ok: true });
}
