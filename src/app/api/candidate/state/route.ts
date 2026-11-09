import type { NextRequest } from "next/server";
import { getWorkspaceView, settleAttempt } from "@/lib/candidate/attempt";
import { json, sessionFromRequest, unauthorized } from "@/lib/candidate/http";

/**
 * The workspace polls this for newly arrived messages and the server's
 * deadline. A request after the deadline submits the attempt as a timeout.
 */
export async function GET(req: NextRequest) {
  const session = await sessionFromRequest(req);
  if (!session) return unauthorized();

  const view = await getWorkspaceView(session);
  if (view) return json({ ok: true, status: "in_progress", view });
  const attempt = await settleAttempt(session);
  return json({ ok: true, status: attempt.status, submitReason: attempt.submit_reason });
}
