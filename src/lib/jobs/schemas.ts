import * as z from "zod";

// Form schemas for the jobs area. Checkboxes arrive as "on" or not at all.

const checkbox = z.preprocess((v) => v === "on" || v === "true" || v === true, z.boolean());

const optionalNumber = z.preprocess((v) => (v === "" || v === undefined || v === null ? undefined : v), z.coerce.number().optional());

export const assessmentSettingsSchema = z.object({
  orgId: z.uuid(),
  title: z.string().trim().min(1, { error: "Give the assessment a title." }).max(200),
  timeLimitMinutes: z.coerce
    .number({ error: "Enter a number of minutes." })
    .int({ error: "Whole minutes only." })
    .min(1, { error: "At least 1 minute." })
    .max(240, { error: "At most 240 minutes." }),
  passScore: optionalNumber.pipe(
    z.number().min(0, { error: "Between 0 and 100." }).max(100, { error: "Between 0 and 100." }).optional(),
  ),
  camera: checkbox,
  screen: checkbox,
});

export const createAssessmentSchema = assessmentSettingsSchema.extend({
  scenarioId: z.uuid({ error: "Pick a scenario." }),
});

export const updateAssessmentSchema = assessmentSettingsSchema.extend({
  assessmentId: z.uuid(),
});

export const cloneAssessmentSchema = z.object({ orgId: z.uuid(), assessmentId: z.uuid() });

export const createJobSchema = z.object({
  orgId: z.uuid(),
  title: z.string().trim().min(1, { error: "Give the job a title." }).max(200),
  assessmentId: z.uuid({ error: "Pick an assessment." }),
  // ISO timestamp computed in the browser from the picked date (end of that
  // day in the recruiter's time zone).
  deadline: z.iso.datetime({ offset: true, error: "Pick an invite deadline." }).refine((d) => new Date(d).getTime() > Date.now(), {
    error: "The deadline must be in the future.",
  }),
});

export const inviteBatchSchema = z.object({
  orgId: z.uuid(),
  jobId: z.uuid(),
  emails: z.string().max(100_000).optional().default(""),
});

export const inviteActionSchema = z.object({ orgId: z.uuid(), inviteId: z.uuid() });

export type Proctoring = { camera: boolean; screen: boolean };

/** Reads the proctoring jsonb column defensively. */
export function readProctoring(value: unknown): Proctoring {
  const v = (value ?? {}) as Record<string, unknown>;
  return { camera: v.camera === true, screen: v.screen === true };
}
