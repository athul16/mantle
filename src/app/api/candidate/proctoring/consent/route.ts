import type { NextRequest } from "next/server";
import { json, readFields, sessionFromRequest, unauthorized } from "@/lib/candidate/http";
import { recordConsent } from "@/lib/proctoring/server";

/** { agree: true } from the system check's monitoring notice. */
export async function POST(req: NextRequest) {
  const session = await sessionFromRequest(req);
  if (!session) return unauthorized();
  const { agree } = await readFields(req);
  if (agree !== "true") return json({ ok: false, error: "no_consent" }, 400);
  const ok = await recordConsent(session);
  return json({ ok }, ok ? 200 : 409);
}
