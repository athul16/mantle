import { redirect } from "next/navigation";
import { getOpenedMessageIds, getWorkspaceView } from "@/lib/candidate/attempt";
import { pageForStatus, requireSessionPage } from "@/lib/candidate/pages";
import { getProctoringSettings } from "@/lib/proctoring/server";
import { Workspace } from "./workspace";

// Candidate pages read the link token, the session cookie and the database on
// every request, so they wait on the server rather than show a prefetched shell.
export const instant = false;

export const metadata = { title: "Simulation" };

/**
 * The timed workspace. Messages and steps come from the server clock
 * (elapsed since attempts.started_at); the countdown in the browser is
 * display only. `?task=<stepId>` opens on that task (links from the review page).
 */
export default async function WorkspacePage({ params, searchParams }: PageProps<"/a/[token]/workspace">) {
  const { token } = await params;
  const { task } = await searchParams;
  const { session, attempt } = await requireSessionPage(token, ["in_progress"]);
  const [view, openedIds, proctoring] = await Promise.all([
    getWorkspaceView(session),
    getOpenedMessageIds(attempt),
    getProctoringSettings(session),
  ]);
  if (!view) redirect(pageForStatus(token, attempt));
  return (
    <Workspace
      token={token}
      initial={view}
      openedIds={openedIds}
      proctoring={proctoring}
      companyName={session.invite.companyName}
      startedAt={attempt.started_at}
      initialTaskId={typeof task === "string" ? task : undefined}
      autoFullscreen={!proctoring.fullscreenWaived}
    />
  );
}
