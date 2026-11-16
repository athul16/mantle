import type { NextRequest } from "next/server";
import { advanceFlow } from "@/lib/candidate/attempt";
import { json, sessionFromRequest, unauthorized } from "@/lib/candidate/http";

/**
 * "Finish section" / "Next screen". Body: { kind: "section" | "screen", id }.
 * The attempt always comes from the cookie, never the body; only the current
 * section or screen can be advanced.
 */
export async function POST(req: NextRequest) {
  const session = await sessionFromRequest(req);
  if (!session) return unauthorized();

  let body: { kind?: unknown; id?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return json({ ok: false, error: "invalid_request" }, 400);
  }
  if ((body?.kind !== "section" && body?.kind !== "screen") || typeof body.id !== "string") {
    return json({ ok: false, error: "invalid_request" }, 400);
  }

  const result = await advanceFlow(session, { kind: body.kind, id: body.id });
  return json(result, result.ok ? 200 : 409);
}
