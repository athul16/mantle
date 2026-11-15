import { notFound, redirect } from "next/navigation";
import { requireOrgMembership } from "@/lib/auth";
import { getScenario } from "@/lib/engine/scenarios";
import { listLibraryScenarios } from "@/lib/jobs/queries";
import { ConfigureAssessmentForm } from "../assessment-forms";
import { ConfigureShell } from "../configure-shell";

export const metadata = { title: "Configure assessment · Mantle" };

/** "Use" on a library simulation: set it up as one of the company's assessments. */
export default async function NewAssessmentPage({ params, searchParams }: PageProps<"/app/[orgSlug]/jobs/assessments/new">) {
  const { orgSlug } = await params;
  const { scenario: scenarioId } = await searchParams;
  const { orgId, role } = await requireOrgMembership(orgSlug);
  const base = `/app/${orgSlug}/jobs/assessments`;
  if (role === "viewer") redirect(base);
  const scenario = (await listLibraryScenarios()).find((s) => s.id === scenarioId);
  if (!scenario) notFound();

  let recommended = 45;
  try {
    recommended = getScenario(scenario.slug, scenario.version).timeLimitMinutes;
  } catch {
    // Unknown to this build: fall back to 45 minutes.
  }

  return (
    <ConfigureShell libraryHref={base} simulation={scenario.title} lockedAt={null} readOnly={false}>
      <ConfigureAssessmentForm
        orgId={orgId}
        mode={{ kind: "create", scenarioId: scenario.id, recommendedMinutes: recommended, defaultTitle: scenario.title }}
        cancelHref={base}
        jobsBase={`/app/${orgSlug}/jobs`}
      />
    </ConfigureShell>
  );
}
