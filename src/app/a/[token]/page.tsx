import Link from "next/link";
import { redirect } from "next/navigation";
import { loadPageState, pageForStatus } from "@/lib/candidate/pages";
import { LocalTime } from "../local-time";
import { CandidateCard, ERROR_TEXT, Facts, Notice, primaryButton } from "../ui";

// Candidate pages read the link token, the session cookie and the database on
// every request, so they wait on the server rather than show a prefetched shell.
export const instant = false;

export const metadata = { title: "Your assessment" };

/**
 * Invite landing page. Opening it must not use anything up: link scanners
 * (Microsoft Safe Links) open it before the candidate does. Only the
 * Continue button (a POST) sends the email code.
 */
export default async function InviteLandingPage({ params, searchParams }: PageProps<"/a/[token]">) {
  const { token } = await params;
  const error = (await searchParams).error;
  const state = await loadPageState(token);

  if (state.kind === "invalid") {
    return (
      <CandidateCard title="Link not recognised">
        <Notice tone="error">{ERROR_TEXT.invalid}</Notice>
      </CandidateCard>
    );
  }

  if (state.kind === "session") {
    if (state.attempt.status !== "in_progress") redirect(pageForStatus(token, state.attempt));
    return (
      <CandidateCard title="Your assessment is in progress">
        <p className="text-sm text-neutral-600 dark:text-neutral-400">
          Your timer kept running while you were away. Your saved answers are still there.
        </p>
        <Link href={`/a/${token}/workspace`} className={primaryButton}>
          Resume
        </Link>
      </CandidateCard>
    );
  }

  const { invite } = state;
  if (state.kind === "blocked") {
    const title = { completed: "Assessment submitted", expired: "This invitation has expired", revoked: "Invitation withdrawn" }[
      state.reason
    ];
    return (
      <CandidateCard title={title}>
        <Notice tone={state.reason === "completed" ? "success" : "info"}>
          {state.reason === "completed"
            ? `Thanks, your answers for ${invite.jobTitle} at ${invite.companyName} were submitted. ${invite.companyName} will contact you about next steps.`
            : `${ERROR_TEXT[state.reason]} If you think this is a mistake, contact ${invite.companyName}.`}
        </Notice>
      </CandidateCard>
    );
  }

  const resuming = state.attempt?.status === "in_progress";
  const errorText = typeof error === "string" ? ERROR_TEXT[error] : undefined;

  return (
    <CandidateCard title={resuming ? "Continue your assessment" : `${invite.companyName} invited you to an assessment`}>
      <Facts
        items={[
          ["Company", invite.companyName],
          ["Role", invite.jobTitle],
          ["Time needed", `${invite.timeLimitMinutes} minutes, in one sitting`],
          resuming ? ["Status", "Started, timer running"] : ["Start by", <LocalTime key="d" iso={invite.startBy.toISOString()} />],
        ]}
      />
      {errorText ? <Notice tone="error">{errorText}</Notice> : null}
      <p className="text-sm text-neutral-600 dark:text-neutral-400">
        {resuming
          ? "To continue on this device, we'll email you a new 6-digit code."
          : "Use a desktop or laptop computer. When you continue, we'll email a 6-digit code to the address this invitation was sent to. The timer starts only after the instructions page."}
      </p>
      <form action="/api/candidate/code" method="post">
        <input type="hidden" name="token" value={token} />
        <button type="submit" className={primaryButton}>
          Continue
        </button>
      </form>
    </CandidateCard>
  );
}
