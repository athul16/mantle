import * as z from "zod";

// Form input for the candidate report's actions. Shared by the server actions
// and their tests.

export const NOTE_MAX_CHARS = 5_000;
export const VOTES = ["hire", "no_hire", "unsure"] as const;
export const VOTE_LABELS: Record<(typeof VOTES)[number], string> = { hire: "Hire", no_hire: "No hire", unsure: "Unsure" };

export const addNoteSchema = z
  .object({
    orgId: z.uuid(),
    attemptId: z.uuid(),
    body: z.string().trim().max(NOTE_MAX_CHARS, `Keep notes under ${NOTE_MAX_CHARS} characters.`).default(""),
    vote: z
      .enum(["", ...VOTES])
      .default("")
      .transform((v) => (v === "" ? null : v)),
  })
  .refine((n) => n.body !== "" || n.vote !== null, { message: "Write a note or pick a vote.", path: ["body"] });

export const deleteNoteSchema = z.object({ orgId: z.uuid(), noteId: z.uuid() });

const pointsField = z
  .string()
  .trim()
  .min(1, "Enter points.")
  .transform(Number)
  .refine((n) => Number.isFinite(n), "Enter a number.");

/**
 * Rubric scores arrive as `score:<criterionId>` fields. Range checks per
 * criterion happen in the database function, which knows each maximum.
 */
export function parseRubricForm(formData: FormData) {
  const head = z
    .object({ orgId: z.uuid(), attemptId: z.uuid(), stepId: z.string().regex(/^[A-Za-z0-9_-]{1,100}$/) })
    .safeParse({ orgId: formData.get("orgId"), attemptId: formData.get("attemptId"), stepId: formData.get("stepId") });
  if (!head.success) return { ok: false as const, error: "Missing form fields." };

  const scores: Record<string, number> = {};
  const fieldErrors: Record<string, string[]> = {};
  for (const [name, value] of formData) {
    if (!name.startsWith("score:") || typeof value !== "string") continue;
    const id = name.slice("score:".length);
    const parsed = pointsField.safeParse(value);
    if (parsed.success) scores[id] = parsed.data;
    else fieldErrors[name] = parsed.error.issues.map((i) => i.message);
  }
  if (Object.keys(fieldErrors).length) return { ok: false as const, fieldErrors };
  if (!Object.keys(scores).length) return { ok: false as const, error: "No scores entered." };
  return { ok: true as const, ...head.data, scores };
}
