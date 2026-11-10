import type { NextRequest } from "next/server";
import { json, sessionFromRequest, unauthorized } from "@/lib/candidate/http";
import { recordSignals } from "@/lib/proctoring/server";

/** Browser signals, batched: { signals: [{ kind, at, awayMs?, chars?, surface? }] }. See src/lib/proctoring/rules.ts. */
export async function POST(req: NextRequest) {
  const session = await sessionFromRequest(req);
  if (!session) return unauthorized();
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false }, 400);
  }
  const result = await recordSignals(session, body);
  return json(result, result.ok ? 200 : 409);
}
