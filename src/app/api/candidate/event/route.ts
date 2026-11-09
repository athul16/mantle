import type { NextRequest } from "next/server";
import { recordClientEvent } from "@/lib/candidate/attempt";
import { json, sessionFromRequest, unauthorized } from "@/lib/candidate/http";

/** Browser-reported actions: { kind: "opened_message" | "started_step", messageId?, stepId? }. */
export async function POST(req: NextRequest) {
  const session = await sessionFromRequest(req);
  if (!session) return unauthorized();

  let body: { kind?: unknown; messageId?: unknown; stepId?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return json({ ok: false }, 400);
  }
  const recorded = await recordClientEvent(session, String(body?.kind ?? ""), body ?? {});
  return json({ ok: recorded }, recorded ? 200 : 400);
}
