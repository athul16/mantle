import "server-only";

import { z } from "zod";
import type { ServerStepType } from "../../server/step-type";
import type { StepScoreItem } from "../../types";
import {
  DOCUMENT_REVIEW,
  MAX_FLAGS,
  REVIEW_ID_PATTERN,
  documentReviewAnswerSchema,
  type DocumentReviewAnswer,
  type DocumentReviewPublicConfig,
} from "./public";

const fieldSchema = z.object({ id: z.string().regex(REVIEW_ID_PATTERN), label: z.string().min(1), value: z.string() }).strict();
const optionSchema = z.object({ id: z.string().regex(REVIEW_ID_PATTERN), label: z.string().min(1) }).strict();

/**
 * Authored config. Document text may contain {{templates}}. `findings` names
 * the issues the key will locate (labels and points for the company report);
 * which item each finding sits on can change per variant, so that's in the key.
 */
const configSchema = z
  .object({
    prompt: z.string().min(1),
    document: z
      .object({
        title: z.string().min(1),
        fields: z.array(fieldSchema).default([]),
        columns: z.array(z.string()).min(1).max(12),
        rows: z
          .array(z.object({ id: z.string().regex(REVIEW_ID_PATTERN), cells: z.array(z.string()) }).strict())
          .max(200),
        totals: z.array(fieldSchema).default([]),
        footnote: z.string().optional(),
      })
      .strict(),
    reasons: z.array(optionSchema).min(2).max(20),
    findings: z
      .array(
        z
          .object({
            id: z.string().regex(REVIEW_ID_PATTERN),
            label: z.string().min(1),
            /** Full points for the right item and reason; half for the right item with another reason. */
            points: z.number().positive().default(2),
          })
          .strict(),
      )
      .default([]),
    /**
     * Optional "nothing wrong here" confirm, for documents that may be clean in
     * some variants (the key says which). Confirming a clean document earns
     * `points` (default: the findings' total, so every variant has the same
     * maximum; 2 when there are no findings). Confirming a document with issues
     * costs `falseFlagPenalty`, like a false flag.
     */
    confirmClean: z
      .object({ label: z.string().min(1).default("Nothing wrong with this document"), points: z.number().positive().optional() })
      .strict()
      .optional(),
    /** Points taken off per flag on an item that isn't an issue. Total never drops below 0. */
    falseFlagPenalty: z.number().min(0).default(1),
    maxFlags: z.number().int().positive().max(MAX_FLAGS).default(10),
    decision: z
      .object({ prompt: z.string().min(1), options: z.array(optionSchema).min(2), points: z.number().positive().default(1) })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((c, ctx) => {
    const unique = (ids: string[], what: string) => {
      if (new Set(ids).size !== ids.length) ctx.addIssue({ code: "custom", message: `${what} ids must be unique` });
    };
    unique([...c.document.fields, ...c.document.rows, ...c.document.totals].map((x) => x.id), "document item");
    unique(c.reasons.map((r) => r.id), "reason");
    unique(c.findings.map((f) => f.id), "finding");
    if (c.findings.length === 0 && !c.confirmClean) {
      ctx.addIssue({ code: "custom", message: "a document review needs at least one finding, or confirmClean for a document that is always clean" });
    }
    if (c.decision) unique(c.decision.options.map((o) => o.id), "decision option");
    c.document.rows.forEach((r) => {
      if (r.cells.length !== c.document.columns.length) {
        ctx.addIssue({ code: "custom", message: `row "${r.id}" has ${r.cells.length} cells, expected ${c.document.columns.length}` });
      }
    });
  })
  .transform((c) => {
    if (!c.confirmClean || c.confirmClean.points !== undefined) return c;
    const total = c.findings.reduce((sum, f) => sum + f.points, 0);
    return { ...c, confirmClean: { ...c.confirmClean, points: total > 0 ? total : 2 } };
  });
export type DocumentReviewConfig = z.infer<typeof configSchema>;

/**
 * Per finding: the item(s) it can be flagged on (e.g. the wrong line or the
 * total it inflates), the reason(s) that count, and an optional reviewer note.
 * `decision` lists acceptable decision ids when the config asks for one.
 */
const keySchema = z
  .object({
    findings: z.record(
      z.string().regex(REVIEW_ID_PATTERN),
      z
        .object({
          targets: z.array(z.string().regex(REVIEW_ID_PATTERN)).min(1),
          reasons: z.array(z.string().regex(REVIEW_ID_PATTERN)).min(1),
          note: z.string().optional(),
        })
        .strict(),
    ),
    decision: z.array(z.string().regex(REVIEW_ID_PATTERN)).min(1).optional(),
    /** This variant's document has no issues: `findings` is empty and the "nothing wrong" confirm is the right answer. */
    clean: z.boolean().optional(),
  })
  .strict();
export type DocumentReviewKey = z.infer<typeof keySchema>;

const round2 = (n: number) => Math.round(n * 100) / 100;

export const documentReviewServer: ServerStepType<
  DocumentReviewConfig,
  DocumentReviewPublicConfig,
  DocumentReviewAnswer,
  DocumentReviewKey
> = {
  type: DOCUMENT_REVIEW,
  configSchema,
  keySchema,

  toPublic(config, { fill }) {
    const field = (f: { id: string; label: string; value: string }) => ({ id: f.id, label: fill(f.label), value: fill(f.value) });
    const d = config.document;
    return {
      prompt: fill(config.prompt),
      document: {
        title: fill(d.title),
        fields: d.fields.map(field),
        columns: d.columns.map(fill),
        rows: d.rows.map((r) => ({ id: r.id, cells: r.cells.map(fill) })),
        totals: d.totals.map(field),
        ...(d.footnote ? { footnote: fill(d.footnote) } : {}),
      },
      reasons: config.reasons.map((r) => ({ id: r.id, label: fill(r.label) })),
      ...(config.decision
        ? {
            decision: {
              prompt: fill(config.decision.prompt),
              options: config.decision.options.map((o) => ({ id: o.id, label: fill(o.label) })),
            },
          }
        : {}),
      ...(config.confirmClean ? { confirmClean: { label: fill(config.confirmClean.label) } } : {}),
      maxFlags: config.maxFlags,
    };
  },

  parseAnswer(raw) {
    return documentReviewAnswerSchema.parse(raw);
  },

  /**
   * One item per finding, then the decision (if asked), then false flags as a
   * deduction. Each flag answers at most one finding: right-reason matches are
   * taken first, then right-item-only matches. A flag on an item that belongs
   * to some finding is never a false flag. Flags on ids not in the document
   * are ignored. The deduction is capped so the step total can't go below 0.
   */
  score({ config, key, answer }) {
    const d = config.document;
    const items = new Map([...d.fields, ...d.rows.map((r) => ({ id: r.id, label: r.cells[0] ?? r.id })), ...d.totals].map((x) => [x.id, x]));
    const itemLabel = (id: string) => {
      const x = items.get(id)!;
      return "value" in x ? x.label : `line "${x.label}"`;
    };
    const reasonIds = new Set(config.reasons.map((r) => r.id));
    const reasonLabel = new Map(config.reasons.map((r) => [r.id, r.label]));
    const findingIds = new Set(config.findings.map((f) => f.id));
    const clean = key.clean === true;
    if (clean && !config.confirmClean) throw new Error("document_review key says clean, but the config can't be confirmed clean");
    if (clean && Object.keys(key.findings).length) throw new Error("document_review key: a clean document has no findings");
    if (!clean && config.findings.length === 0) throw new Error("document_review config has no findings, so its key must say clean");
    for (const id of Object.keys(key.findings)) {
      if (!findingIds.has(id)) throw new Error(`document_review key has unknown finding "${id}"`);
    }
    for (const f of clean ? [] : config.findings) {
      const k = key.findings[f.id];
      if (!k) throw new Error(`document_review key is missing finding "${f.id}"`);
      for (const t of k.targets) if (!items.has(t)) throw new Error(`document_review key targets unknown item "${t}"`);
      for (const r of k.reasons) if (!reasonIds.has(r)) throw new Error(`document_review key uses unknown reason "${r}"`);
    }
    if (config.decision) {
      const options = new Set(config.decision.options.map((o) => o.id));
      if (!key.decision?.length) throw new Error("document_review key needs a decision");
      for (const o of key.decision) if (!options.has(o)) throw new Error(`document_review key uses unknown decision "${o}"`);
    }

    const findings = clean ? [] : config.findings;
    const confirmed = !!config.confirmClean && answer?.clean === true;
    const flags = (answer?.flags ?? []).filter((f) => items.has(f.target));
    const used = new Set<number>();
    const credit = new Map<string, { share: number; flag: number }>();
    for (const pass of ["exact", "item"] as const) {
      for (const f of findings) {
        if (credit.has(f.id)) continue;
        const k = key.findings[f.id];
        const j = flags.findIndex(
          (fl, j) => !used.has(j) && k.targets.includes(fl.target) && (pass === "item" || k.reasons.includes(fl.reason)),
        );
        if (j >= 0) {
          used.add(j);
          credit.set(f.id, { share: pass === "exact" ? 1 : 0.5, flag: j });
        }
      }
    }

    const result: StepScoreItem[] = findings.map((f) => {
      const k = key.findings[f.id];
      const base = { id: f.id, label: f.label, max: f.points };
      const expected = `${k.targets.map(itemLabel).join(" or ")}, reason: ${k.reasons.map((r) => reasonLabel.get(r)).join(" or ")}`;
      const ref = k.note ? ` ${k.note}` : "";
      const c = credit.get(f.id);
      if (!c) return { ...base, earned: 0, note: `Not flagged. Expected ${expected}.${ref}` };
      if (c.share === 1) return { ...base, earned: f.points, note: `Flagged ${itemLabel(flags[c.flag].target)} with the right reason.` };
      const given = flags[c.flag].reason ? `"${reasonLabel.get(flags[c.flag].reason) ?? flags[c.flag].reason}"` : "no reason";
      return {
        ...base,
        earned: round2(f.points / 2),
        note: `Flagged ${itemLabel(flags[c.flag].target)} but with ${given}. Expected ${expected}.${ref}`,
      };
    });

    if (clean) {
      const points = config.confirmClean!.points!;
      result.push({
        id: "clean",
        label: "Nothing wrong",
        max: points,
        earned: confirmed ? points : 0,
        note: confirmed ? "Confirmed that nothing is wrong." : "Not confirmed. The document has no issues.",
      });
    }

    if (config.decision) {
      const chosen = answer?.decision ?? null;
      const label = (id: string) => config.decision!.options.find((o) => o.id === id)?.label ?? id;
      const ok = chosen !== null && key.decision!.includes(chosen);
      result.push({
        id: "decision",
        label: "Decision",
        max: config.decision.points,
        earned: ok ? config.decision.points : 0,
        note: ok
          ? `Chose "${label(chosen)}".`
          : `${chosen ? `Chose "${label(chosen)}"` : "No decision"}. Expected ${key.decision!.map((o) => `"${label(o)}"`).join(" or ")}.`,
      });
    }

    const issueItems = new Set(Object.values(key.findings).flatMap((k) => k.targets));
    const falseFlags = flags.filter((f, j) => !used.has(j) && !issueItems.has(f.target));
    // Confirming "nothing wrong" on a document with issues costs like one more false flag.
    const wrongConfirm = confirmed && !clean;
    const count = falseFlags.length + (wrongConfirm ? 1 : 0);
    if (count > 0 && config.falseFlagPenalty > 0) {
      const earnedSoFar = result.reduce((s, i) => s + i.earned, 0);
      const deduction = Math.min(earnedSoFar, count * config.falseFlagPenalty);
      const parts: string[] = [];
      if (falseFlags.length) {
        parts.push(
          `${falseFlags.length} item${falseFlags.length === 1 ? "" : "s"} flagged that ${falseFlags.length === 1 ? "isn't an issue" : "aren't issues"}: ${falseFlags
            .map((f) => itemLabel(f.target))
            .join(", ")}.`,
        );
      }
      if (wrongConfirm) parts.push("Confirmed that nothing is wrong, but the document has issues.");
      if (deduction < count * config.falseFlagPenalty) parts.push("Deduction capped at the points earned.");
      result.push({
        id: "false-flags",
        label: "False flags",
        max: 0,
        earned: 0 - round2(deduction), // 0 - x, not -x: no -0 when nothing was earned
        note: parts.join(" "),
      });
    }

    return {
      points: round2(Math.max(0, result.reduce((sum, i) => sum + i.earned, 0))),
      maxPoints: result.reduce((sum, i) => sum + i.max, 0),
      items: result,
    };
  },
};
