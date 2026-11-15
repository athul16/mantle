"use client";

import { useActionState } from "react";
import { useSearchParams } from "next/navigation";
import { Button, FormMessage } from "@/components/ui";
import { confirmLink } from "./actions";
import { LINK_EXPIRED } from "./messages";

const COPY = {
  invite: { text: "You were invited to a company account. Accept to choose your password.", button: "Accept invite" },
  confirm: { text: "Confirm your email address to finish creating your account.", button: "Confirm email" },
};

/**
 * Reads the link's parameters and posts them back only when the person clicks.
 * Rendering this (a GET) never verifies anything.
 */
export function ConfirmForm() {
  const params = useSearchParams();
  const [state, formAction, pending] = useActionState(confirmLink, undefined);
  const tokenHash = params.get("token_hash") ?? "";
  const type = params.get("type") ?? "";
  const code = params.get("code") ?? "";
  const next = params.get("next") ?? "";

  if (!(tokenHash && type) && !code) return <FormMessage error={LINK_EXPIRED} />;

  const copy = type === "invite" ? COPY.invite : COPY.confirm;
  return (
    <form action={formAction} className="col g16">
      <p className="small ink2">{copy.text}</p>
      {tokenHash ? <input type="hidden" name="token_hash" value={tokenHash} /> : null}
      {type ? <input type="hidden" name="type" value={type} /> : null}
      {code ? <input type="hidden" name="code" value={code} /> : null}
      {next ? <input type="hidden" name="next" value={next} /> : null}
      <FormMessage error={state?.error} />
      <Button type="submit" size="lg" disabled={pending} style={{ width: "100%" }}>
        {pending ? "Please wait…" : copy.button}
      </Button>
    </form>
  );
}
