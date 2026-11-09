import type { NextRequest } from "next/server";
import { requestCode } from "@/lib/candidate/code";
import { json, readFields, redirectToPage, wantsJson } from "@/lib/candidate/http";

/** "Continue" on the invite landing page: email a 6-digit code. The GET of the link never gets here. */
export async function POST(req: NextRequest) {
  const { token = "" } = await readFields(req);
  const result = await requestCode(token);

  if (wantsJson(req)) return json(result, result.ok ? 200 : 400);
  if (result.ok) return redirectToPage(req, token, "verify", { sent: "1" });
  if (result.error === "too_soon") return redirectToPage(req, token, "verify", { error: "too_soon" });
  return redirectToPage(req, token, "", { error: result.error });
}
