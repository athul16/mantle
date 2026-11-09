import "server-only";

import type { PublicMessage, PublicStep, Variant } from "../types";
import { getServerStepType } from "./registry";
import type { ServerScenario } from "./scenario";
import { fillTemplate } from "./template";

/**
 * Everything the browser gets for a scenario goes through this file, and none
 * of it reads `variant.keys`. Scheduled messages (and the steps they deliver)
 * are withheld until the server clock says they've arrived, so a candidate
 * can't read ahead in the payload.
 */

function findStep(scenario: ServerScenario, stepId: string) {
  const step = scenario.definition.steps.find((s) => s.id === stepId);
  if (!step) throw new Error(`scenario ${scenario.slug} has no step "${stepId}"`);
  return step;
}

function toPublicStep(scenario: ServerScenario, stepId: string, variant: Variant): PublicStep {
  const step = findStep(scenario, stepId);
  const stepType = getServerStepType(step.type);
  const config = stepType.configSchema.parse(step.config);
  const fill = (template: string) => fillTemplate(template, variant.values);
  return { id: step.id, type: step.type, title: fill(step.title), config: stepType.toPublic(config, { variant, fill }) };
}

/** One step's public config with this candidate's variant values filled in. No answer key. */
export function renderStepForCandidate(scenario: ServerScenario, stepId: string, seed: string): PublicStep {
  return toPublicStep(scenario, stepId, scenario.generate(seed));
}

/** Minute at which a step becomes available: when its first linked message arrives (0 if none). */
export function stepAvailableAtMinute(scenario: ServerScenario, stepId: string): number {
  const linked = scenario.definition.messages.filter((m) => m.stepId === stepId);
  if (linked.length === 0) return 0;
  return Math.min(...linked.map((m) => m.arriveAtMinute ?? 0));
}

/**
 * The candidate's view at `elapsedMinutes` into the attempt: arrived messages
 * (newest first) and the steps available so far. `elapsedMinutes` must come
 * from the server (now - attempts.started_at), never from the browser.
 */
export function renderAttemptForCandidate(
  scenario: ServerScenario,
  seed: string,
  elapsedMinutes: number,
): { intro: string; messages: PublicMessage[]; steps: PublicStep[] } {
  const variant = scenario.generate(seed);
  const fill = (template: string) => fillTemplate(template, variant.values);

  const messages = scenario.definition.messages
    .filter((m) => (m.arriveAtMinute ?? 0) <= elapsedMinutes)
    .map((m) => ({
      id: m.id,
      from: m.from,
      subject: fill(m.subject),
      body: fill(m.body),
      arriveAtMinute: m.arriveAtMinute ?? 0,
      stepId: m.stepId,
    }))
    .sort((a, b) => b.arriveAtMinute - a.arriveAtMinute);

  const steps = scenario.definition.steps
    .filter((s) => stepAvailableAtMinute(scenario, s.id) <= elapsedMinutes)
    .map((s) => toPublicStep(scenario, s.id, variant));

  return { intro: fill(scenario.definition.intro), messages, steps };
}
