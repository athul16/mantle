import type { NextRequest } from "next/server";
import { json, readFields, sessionFromRequest, unauthorized } from "@/lib/candidate/http";
import { isCaptureReason } from "@/lib/proctoring/config";
import { createMediaUpload } from "@/lib/proctoring/server";

/**
 * { source: "camera" | "screen" | "audio", reason?, contentType? } → a signed
 * upload URL token and the path to upload to. The browser then uploads the
 * JPEG or audio clip straight to storage; the bytes never pass through here.
 * Audio needs the assessment's microphone setting and one of AUDIO_MIME_TYPES.
 */
export async function POST(req: NextRequest) {
  const session = await sessionFromRequest(req);
  if (!session) return unauthorized();
  const { source, reason, contentType } = await readFields(req);
  if (source !== "camera" && source !== "screen" && source !== "audio") return json({ ok: false, error: "bad_source" }, 400);
  const result = await createMediaUpload(session, {
    source,
    reason: isCaptureReason(reason) ? reason : undefined,
    contentType: contentType ?? null,
  });
  if (!result.ok) return json(result, result.error === "too_many" ? 429 : result.error === "bad_type" ? 400 : 409);
  return json({ ok: true, path: result.path, token: result.token });
}
