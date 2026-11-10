import { redirect } from "next/navigation";
import { loadPageState, pageForStatus } from "@/lib/candidate/pages";
import { CandidateCard, Notice } from "../../ui";
import { ReleaseMedia } from "./release-media";

// Candidate pages read the link token, the session cookie and the database on
// every request, so they wait on the server rather than show a prefetched shell.
export const instant = false;

export const metadata = { title: "Submitted" };

/** Thank-you page. Candidates never see scores (decision Q7, option A). */
export default async function DonePage({ params }: PageProps<"/a/[token]/done">) {
  const { token } = await params;
  const state = await loadPageState(token);

  if (state.kind === "session") {
    const { attempt, session } = state;
    if (attempt.status === "not_started" || attempt.status === "in_progress") redirect(pageForStatus(token, attempt));
    const timedOut = attempt.submit_reason === "timeout";
    return (
      <CandidateCard title={timedOut ? "Time's up" : "Thanks, you're done"}>
        <ReleaseMedia />
        <Notice tone="success">
          {timedOut
            ? "The time limit was reached, so we submitted the answers you had saved."
            : "Your answers were submitted."}
        </Notice>
        <p className="text-sm leading-6 text-neutral-600 dark:text-neutral-400">
          {session.invite.companyName} will review your results for the {session.invite.jobTitle} role and contact you about
          next steps. You can close this window.
        </p>
      </CandidateCard>
    );
  }

  if (state.kind === "blocked" && state.reason === "completed") {
    return (
      <CandidateCard title="Thanks, you're done">
        <Notice tone="success">Your answers were submitted. {state.invite.companyName} will contact you about next steps.</Notice>
      </CandidateCard>
    );
  }
  redirect(`/a/${token}`);
}
