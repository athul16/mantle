import Link from "next/link";
import { redirect } from "next/navigation";
import { getReview } from "@/lib/candidate/attempt";
import { pageForStatus, requireSessionPage } from "@/lib/candidate/pages";
import { CandidateCard, Notice, primaryButton, secondaryButton } from "../../ui";
import { SubmitButton } from "../submit-button";

// Candidate pages read the link token, the session cookie and the database on
// every request, so they wait on the server rather than show a prefetched shell.
export const instant = false;

export const metadata = { title: "Review and submit" };

export default async function ReviewPage({ params }: PageProps<"/a/[token]/review">) {
  const { token } = await params;
  const { session, attempt } = await requireSessionPage(token, ["in_progress"]);
  const items = await getReview(session);
  if (!items) redirect(pageForStatus(token, attempt));
  const unanswered = items.filter((i) => !i.answered).length;

  return (
    <CandidateCard title="Review and submit" wide>
      <ul className="divide-y divide-neutral-200 rounded-lg border border-neutral-200 text-sm dark:divide-neutral-800 dark:border-neutral-800">
        {items.map((i) => (
          <li key={i.stepId} className="flex justify-between gap-4 px-4 py-3">
            <span>{i.title}</span>
            <span className={i.answered ? "text-green-700 dark:text-green-400" : "text-amber-700 dark:text-amber-400"}>
              {i.answered ? "Answered" : "Not answered"}
            </span>
          </li>
        ))}
      </ul>
      <Notice tone={unanswered ? "error" : "info"}>
        {unanswered
          ? `${unanswered} ${unanswered === 1 ? "task has" : "tasks have"} no answer. More messages may still arrive before time runs out.`
          : "All tasks so far have an answer. More messages may still arrive before time runs out."}{" "}
        After you submit you can&apos;t change your answers.
      </Notice>
      <div className="flex gap-3">
        <Link href={`/a/${token}/workspace`} className={secondaryButton}>
          Back to the test
        </Link>
        <form action="/api/candidate/submit" method="post">
          <input type="hidden" name="token" value={token} />
          <SubmitButton className={primaryButton} pendingText="Submitting…">
            Submit my answers
          </SubmitButton>
        </form>
      </div>
    </CandidateCard>
  );
}
