import { notFound } from "next/navigation";
import * as z from "zod";
import { requireOrgMembership } from "@/lib/auth";
import { getScenario } from "@/lib/engine/scenarios";
import { listAssessments, listLibraryScenarios } from "@/lib/jobs/queries";
import { simulationName } from "../../format";
import { ConfigureAssessmentForm } from "../assessment-forms";
import { ConfigureShell } from "../configure-shell";

export const metadata = { title: "Configure assessment · Mantle" };

/** One of the company's assessments: edit its settings, or view them once locked. */
export default async function AssessmentPage({ params }: PageProps<"/app/[orgSlug]/jobs/assessments/[assessmentId]">) {
  const { orgSlug, assessmentId } = await params;
  if (!z.uuid().safeParse(assessmentId).success) notFound();
  const { orgId, role } = await requireOrgMembership(orgSlug);
  const [assessments, scenarios] = await Promise.all([listAssessments(orgId), listLibraryScenarios()]);
  const assessment = assessments.find((a) => a.id === assessmentId);
  if (!assessment) notFound();
  const base = `/app/${orgSlug}/jobs/assessments`;

  let recommended = assessment.timeLimitMinutes;
  const scenario = scenarios.find((s) => s.id === assessment.scenarioId);
  if (scenario) {
    try {
      recommended = getScenario(scenario.slug, scenario.version).timeLimitMinutes;
    } catch {
      // Unknown to this build: recommend the current length.
    }
  }
  const readOnly = role === "viewer";

  return (
    <ConfigureShell libraryHref={base} simulation={simulationName(assessment.scenarioTitle)} lockedAt={assessment.lockedAt} readOnly={readOnly}>
      <ConfigureAssessmentForm
        // Remount after a save or clone so the fields show what's stored.
        key={`${assessment.id}-${assessment.lockedAt ?? ""}`}
        orgId={orgId}
        mode={{ kind: "edit", assessment, recommendedMinutes: recommended }}
        cancelHref={`${base}?tab=yours`}
        jobsBase={`/app/${orgSlug}/jobs`}
        readOnly={readOnly}
      />
    </ConfigureShell>
  );
}
