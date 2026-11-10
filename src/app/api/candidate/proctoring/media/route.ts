import type { NextRequest } from "next/server";
import { json, readFields, sessionFromRequest, unauthorized } from "@/lib/candidate/http";
import { confirmSnapshot } from "@/lib/proctoring/server";

/** { path } after an upload: records the snapshot once the file is in the attempt's folder. */
export async function POST(req: NextRequest) {
  const session = await sessionFromRequest(req);
  if (!session) return unauthorized();
  const { path } = await readFields(req);
  const result = await confirmSnapshot(session, path);
  if (!result.ok) return json(result, result.error === "bad_path" ? 400 : 409);
  return json({ ok: true });
}
