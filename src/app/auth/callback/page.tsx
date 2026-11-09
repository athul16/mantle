"use client";

import { useEffect, useState } from "react";
import { AuthCard } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";

const EXPIRED = "This link is invalid or has expired. Ask your admin to invite you again.";

// Invite links from auth.admin.inviteUserByEmail use the implicit flow: the
// session arrives in the URL fragment (#access_token=...), which only the
// browser can read. This page stores that session in cookies and continues to
// /auth/set-password. (If the Invite email template is switched to token_hash
// links, /auth/confirm handles invites server-side instead.)
async function completeSignIn(): Promise<string | null> {
  const hash = new URLSearchParams(window.location.hash.slice(1));
  const hashError = hash.get("error_description");
  if (hashError) return hashError;

  const accessToken = hash.get("access_token");
  const refreshToken = hash.get("refresh_token");
  if (!accessToken || !refreshToken) return EXPIRED;

  const { error } = await createClient().auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
  if (error) return EXPIRED;

  const type = hash.get("type");
  window.location.replace(type === "invite" || type === "recovery" ? "/auth/set-password" : "/app");
  return null;
}

export default function AuthCallbackPage() {
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void completeSignIn().then(setError);
  }, []);

  return (
    <AuthCard title={error ? "Link problem" : "Signing you in…"}>
      {error ? <p className="text-sm text-red-700">{error}</p> : <p className="text-sm text-neutral-600">One moment.</p>}
    </AuthCard>
  );
}
