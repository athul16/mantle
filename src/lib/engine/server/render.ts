import "server-only";

import type { PublicMessage, PublicStep, Variant } from "../types";
import { getServerStepType } from "./registry";
import type { ServerScenario } from "./scenario";
import { fillTemplate, templateValues, type CandidateContext } from "./template";

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

function toPublicStep(scenario: ServerScenario, stepId: string, variant: Variant, candidate: CandidateContext): PublicStep {
  const step = findStep(scenario, stepId);
  const stepType = getServerStepType(step.type);
  const config = stepType.configSchema.parse(step.config);
  const values = templateValues(variant.values, candidate);
  const fill = (template: string) => fillTemplate(template, values);
  return { id: step.id, type: step.type, title: fill(step.title), config: stepType.toPublic(config, { variant, fill }) };
}

/** One step's public config with this candidate's variant values filled in. No answer key. */
export function renderStepForCandidate(
  scenario: ServerScenario,
  stepId: string,
  seed: string,
  candidate: CandidateContext = {},
): PublicStep {
  return toPublicStep(scenario, stepId, scenario.generate(seed), candidate);
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
 * `candidate` fills `{{first_name}}`; without a name it reads "there".
 */
export function renderAttemptForCandidate(
  scenario: ServerScenario,
  seed: string,
  elapsedMinutes: number,
  candidate: CandidateContext = {},
): { intro: string; messages: PublicMessage[]; steps: PublicStep[] } {
  const variant = scenario.generate(seed);
  const values = templateValues(variant.values, candidate);
  const fill = (template: string) => fillTemplate(template, values);

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
    .map((s) => toPublicStep(scenario, s.id, variant, candidate));

  return { intro: fill(scenario.definition.intro), messages, steps };
}

/** Item position of a sequence step (rapid_round) for the candidate: the open item, or every item over. */
export type SequencePosition = { index: number; count: number; endsAt: string } | { done: true };

/** Item count and seconds per item when the step is a timed sequence (step type with a `sequence` hook), else null. */
export function stepSequenceInfo(scenario: ServerScenario, stepId: string): { count: number; secondsPerItem: number } | null {
  const step = findStep(scenario, stepId);
  const stepType = getServerStepType(step.type);
  if (!stepType.sequence) return null;
  const config = stepType.configSchema.parse(step.config);
  return { count: stepType.sequence.count(config), secondsPerItem: stepType.sequence.secondsPerItem(config) };
}

/**
 * The candidate's view in a timed flow: exactly the steps and messages the
 * caller decided are open (src/lib/engine/server/flow.ts), newest message
 * first. `arriveAtMinute` here is the actual arrival, minutes after the
 * attempt start. A sequence step gets its open item injected as
 * `config.current` (one item, filled, no key), or `config.done`.
 */
export function renderFlowForCandidate(
  scenario: ServerScenario,
  seed: string,
  {
    stepIds,
    messages: arrived,
    sequences = {},
  }: { stepIds: string[]; messages: { id: string; arriveAtMinute: number }[]; sequences?: Record<string, SequencePosition> },
  candidate: CandidateContext = {},
): { intro: string; messages: PublicMessage[]; steps: PublicStep[] } {
  const variant = scenario.generate(seed);
  const values = templateValues(variant.values, candidate);
  const fill = (template: string) => fillTemplate(template, values);
  const at = new Map(arrived.map((m) => [m.id, m.arriveAtMinute]));

  const messages = scenario.definition.messages
    .filter((m) => at.has(m.id))
    .map((m) => ({
      id: m.id,
      from: m.from,
      subject: fill(m.subject),
      body: fill(m.body),
      arriveAtMinute: at.get(m.id)!,
      stepId: m.stepId,
    }))
    .sort((a, b) => b.arriveAtMinute - a.arriveAtMinute);

  const open = new Set(stepIds);
  const steps = scenario.definition.steps
    .filter((s) => open.has(s.id))
    .map((s) => {
      const pub = toPublicStep(scenario, s.id, variant, candidate);
      const position = sequences[s.id];
      const sequence = getServerStepType(s.type).sequence;
      if (!position || !sequence) return pub;
      if ("done" in position) return { ...pub, config: { ...(pub.config as object), done: true } };
      const config = getServerStepType(s.type).configSchema.parse(s.config);
      const item = sequence.renderItem(config, { variant, fill }, position.index);
      return { ...pub, config: { ...(pub.config as object), current: { ...position, item } } };
    });

  return { intro: fill(scenario.definition.intro), messages, steps };
}
