import type { NextRequest } from "next/server";
import { saveAnswer } from "@/lib/candidate/attempt";
import { json, sessionFromRequest, unauthorized } from "@/lib/candidate/http";

/** Autosave. Body: { stepId, answer }. The attempt always comes from the cookie, never the body. */
export async function POST(req: NextRequest) {
  const session = await sessionFromRequest(req);
  if (!session) return unauthorized();

  let body: { stepId?: unknown; answer?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return json({ ok: false, error: "invalid_answer" }, 400);
  }
  if (typeof body?.stepId !== "string") return json({ ok: false, error: "unknown_step" }, 400);

  const result = await saveAnswer(session, body.stepId, body.answer);
  if (result.ok) return json(result);
  const status = result.error === "time_up" || result.error === "submitted" ? 409 : 400;
  return json(result, status);
}
