import { requireSessionPage } from "@/lib/candidate/pages";
import { CandidateCard } from "../../ui";
import { SystemCheck } from "./system-check";

// Candidate pages read the link token, the session cookie and the database on
// every request, so they wait on the server rather than show a prefetched shell.
export const instant = false;

export const metadata = { title: "System check" };

export default async function CheckPage({ params }: PageProps<"/a/[token]/check">) {
  const { token } = await params;
  await requireSessionPage(token, ["not_started", "in_progress"]);
  return (
    <CandidateCard title="System check" wide>
      <SystemCheck token={token} />
    </CandidateCard>
  );
}
