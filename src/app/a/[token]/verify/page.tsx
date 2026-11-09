import { redirect } from "next/navigation";
import { maskEmail } from "@/lib/candidate/code";
import { CONSENT_TEXT } from "@/lib/candidate/config";
import { loadPageState, pageForStatus } from "@/lib/candidate/pages";
import { CandidateCard, ERROR_TEXT, Notice, primaryButton, secondaryButton } from "../../ui";

export const metadata = { title: "Verify your email" };

/** Name, emailed code and consent. Posting the form is what creates (or resumes) the attempt. */
export default async function VerifyPage({ params, searchParams }: PageProps<"/a/[token]/verify">) {
  const { token } = await params;
  const query = await searchParams;
  const state = await loadPageState(token);

  if (state.kind === "session") redirect(pageForStatus(token, state.attempt));
  if (state.kind !== "no_session") redirect(`/a/${token}`);

  const { invite } = state;
  const error = typeof query.error === "string" ? query.error : undefined;
  const left = typeof query.left === "string" ? Number(query.left) : undefined;
  let errorText = error ? ERROR_TEXT[error] : undefined;
  if (error === "wrong_code" && left !== undefined && Number.isFinite(left)) {
    errorText = `${errorText} ${left} ${left === 1 ? "try" : "tries"} left before you need a new code.`;
  }

  return (
    <CandidateCard title="Check your email">
      {query.sent ? (
        <Notice tone="success">
          We sent a 6-digit code to {maskEmail(invite.email)}. It expires in 10 minutes.
        </Notice>
      ) : null}
      {errorText ? <Notice tone="error">{errorText}</Notice> : null}

      <form action="/api/candidate/verify" method="post" className="space-y-4">
        <input type="hidden" name="token" value={token} />
        <label className="block space-y-1">
          <span className="text-sm font-medium">Your full name</span>
          <input
            name="name"
            required
            maxLength={120}
            autoComplete="name"
            defaultValue={invite.candidateName ?? ""}
            className="w-full rounded-md border border-neutral-300 bg-transparent px-3 py-2 text-sm dark:border-neutral-700"
          />
        </label>
        <label className="block space-y-1">
          <span className="text-sm font-medium">6-digit code</span>
          <input
            name="code"
            required
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="\d{6}"
            maxLength={6}
            className="w-40 rounded-md border border-neutral-300 bg-transparent px-3 py-2 font-mono text-lg tracking-widest dark:border-neutral-700"
          />
        </label>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" name="consent" required className="mt-1" />
          <span>{CONSENT_TEXT}</span>
        </label>
        <p className="text-xs text-neutral-500">
          Need extra time or another accommodation? Contact {invite.companyName} before you start.
        </p>
        <button type="submit" className={primaryButton}>
          Verify and continue
        </button>
      </form>

      <form action="/api/candidate/code" method="post">
        <input type="hidden" name="token" value={token} />
        <button type="submit" className={secondaryButton}>
          Send a new code
        </button>
      </form>
    </CandidateCard>
  );
}
