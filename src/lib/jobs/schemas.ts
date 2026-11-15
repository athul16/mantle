import * as z from "zod";
import { EXTRA_TIME_PERCENTS } from "@/lib/accommodations";
import { readProctoring as readProctoringSettings, type Proctoring as ProctoringSettings } from "@/lib/proctoring/config";

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
  // Required, nothing preselected in the form: the recruiter decides on purpose.
  monitoring: z.enum(["monitored", "not_monitored"], { error: "Choose whether candidates are monitored." }),
  camera: checkbox,
  screen: checkbox,
  fullscreen: checkbox,
  microphone: checkbox,
  gaze: checkbox,
});

export const MONITORING_NEEDS_SOURCE = "Pick camera snapshots, screen share, microphone or more.";

type ProctoringFields = { monitoring: "monitored" | "not_monitored" } & Proctoring;

/** Monitored needs at least one capture source (camera, screen or microphone); full screen or gaze alone isn't enough. */
function checkProctoring(v: ProctoringFields, ctx: z.RefinementCtx) {
  if (v.monitoring === "monitored" && !v.camera && !v.screen && !v.microphone) {
    ctx.addIssue({ code: "custom", path: ["monitoring"], message: MONITORING_NEEDS_SOURCE });
  }
}

/** Not monitored turns everything off, whatever else was sent. Gaze needs the camera. */
const normalizeProctoring = <T extends ProctoringFields>(v: T): T =>
  v.monitoring === "monitored"
    ? { ...v, gaze: v.gaze && v.camera }
    : { ...v, camera: false, screen: false, fullscreen: false, microphone: false, gaze: false };

export const createAssessmentSchema = assessmentSettingsSchema
  .extend({ scenarioId: z.uuid({ error: "Pick a scenario." }) })
  .superRefine(checkProctoring)
  .transform(normalizeProctoring);

export const updateAssessmentSchema = assessmentSettingsSchema
  .extend({ assessmentId: z.uuid() })
  .superRefine(checkProctoring)
  .transform(normalizeProctoring);

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

/** D9: extra time as a percent of the time limit, and monitoring waivers. */
export const accommodationsSchema = inviteActionSchema.extend({
  extraTimePercent: z.coerce
    .number()
    .refine((n) => (EXTRA_TIME_PERCENTS as readonly number[]).includes(n), { error: "Pick +0%, +25%, +50% or +100%." }),
  waiveCamera: checkbox,
  waiveScreen: checkbox,
  waiveFullscreen: checkbox,
  waiveMicrophone: checkbox,
});

/** assessments.proctoring; the same type as in src/lib/proctoring/config.ts. */
export type Proctoring = ProctoringSettings;

/** Reads the proctoring jsonb column defensively (each setting strictly true; gaze only with the camera). */
export function readProctoring(value: unknown): Proctoring {
  return readProctoringSettings(value);
}
