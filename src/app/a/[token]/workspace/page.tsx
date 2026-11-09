import { redirect } from "next/navigation";
import { getWorkspaceView } from "@/lib/candidate/attempt";
import { pageForStatus, requireSessionPage } from "@/lib/candidate/pages";
import { Workspace } from "./workspace";

export const metadata = { title: "Assessment" };

/**
 * The timed workspace. Messages and steps come from the server clock
 * (elapsed since attempts.started_at); the countdown in the browser is
 * display only.
 */
export default async function WorkspacePage({ params }: PageProps<"/a/[token]/workspace">) {
  const { token } = await params;
  const { session, attempt } = await requireSessionPage(token, ["in_progress"]);
  const view = await getWorkspaceView(session);
  if (!view) redirect(pageForStatus(token, attempt));
  return <Workspace token={token} initial={view} />;
}
