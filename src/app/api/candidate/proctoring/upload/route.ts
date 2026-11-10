import type { NextRequest } from "next/server";
import { json, readFields, sessionFromRequest, unauthorized } from "@/lib/candidate/http";
import { createSnapshotUpload } from "@/lib/proctoring/server";

/**
 * { source: "camera" | "screen" } → a signed upload URL token and the path to
 * upload to. The browser then uploads the JPEG straight to storage.
 */
export async function POST(req: NextRequest) {
  const session = await sessionFromRequest(req);
  if (!session) return unauthorized();
  const { source } = await readFields(req);
  if (source !== "camera" && source !== "screen") return json({ ok: false, error: "bad_source" }, 400);
  const result = await createSnapshotUpload(session, source);
  if (!result.ok) return json(result, result.error === "too_many" ? 429 : 409);
  return json({ ok: true, path: result.path, token: result.token });
}
