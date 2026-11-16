import "server-only";

import { stretch, type SequenceState } from "../sequence";
import type { ScenarioDefinition } from "../types";

/**
 * Timed sections, one-at-a-time screens and rapid items (docs/06, "Timed
 * sections and rapid rounds"). Everything is computed from the attempt's
 * server start time and server-written action events, so the state can't be
 * changed from the browser and needs no extra columns. The overall attempt
 * deadline is separate and never pauses (D4).
 */

const MINUTE = 60_000;

export type FlowEvent =
  | { kind: "advanced_section"; sectionId: string; at: number }
  | { kind: "advanced_screen"; stepId: string; at: number };

export interface FlowState {
  /** Every section is over (the attempt itself runs until its deadline or submit). */
  done: boolean;
  section?: { id: string; title: string; index: number; count: number; startedAt: number; endsAt: number };
  screen?: { stepId: string; index: number; count: number; startedAt: number; endsAt: number };
  /** Steps the candidate can see and answer now. */
  visibleStepIds: string[];
  /** Sections that have started (current and finished), in order. */
  startedSectionIds: string[];
  /** Start time of every started section. */
  sectionStartedAt: Record<string, number>;
}

/** The earliest advance stamped inside [start, end), or undefined. */
function advanceIn(times: number[] | undefined, start: number, end: number): number | undefined {
  const inside = (times ?? []).filter((t) => t >= start && t < end);
  return inside.length ? Math.min(...inside) : undefined;
}

function group(events: FlowEvent[]) {
  const sections = new Map<string, number[]>();
  const screens = new Map<string, number[]>();
  for (const e of events) {
    const [map, id] = e.kind === "advanced_section" ? [sections, e.sectionId] : [screens, e.stepId];
    map.set(id, [...(map.get(id) ?? []), e.at]);
  }
  return { sections, screens };
}

/**
 * Where the attempt stands at `now`. Sections run back to back; each gets its
 * own minutes (stretched by extra time) and ends early when finished. A
 * one-at-a-time section shows one screen at a time, each with its own seconds,
 * cut at the section's end; the section ends when its last screen ends, so
 * nobody waits on an empty section. Without `sections` every step is visible
 * for the whole attempt.
 */
export function resolveFlow(
  definition: ScenarioDefinition,
  { startedAt, now, extraTimePercent, events }: { startedAt: number; now: number; extraTimePercent: number; events: FlowEvent[] },
): FlowState {
  const sections = definition.sections;
  if (!sections?.length) {
    return { done: false, visibleStepIds: definition.steps.map((s) => s.id), startedSectionIds: [], sectionStartedAt: {} };
  }
  const seconds = new Map(definition.steps.map((s) => [s.id, s.seconds ?? 0]));
  const advances = group(events);
  const startedSectionIds: string[] = [];
  const sectionStartedAt: Record<string, number> = {};

  let start = startedAt;
  for (let i = 0; i < sections.length; i++) {
    const sec = sections[i];
    if (now < start) break;
    startedSectionIds.push(sec.id);
    sectionStartedAt[sec.id] = start;
    const limitEnd = start + stretch(sec.minutes * MINUTE, extraTimePercent);

    // Screens: back to back from the section start, each cut at the section's end.
    const screens: { stepId: string; startedAt: number; endsAt: number; until: number }[] = [];
    let naturalEnd = limitEnd;
    if (sec.oneAtATime) {
      let screenStart = start;
      for (const stepId of sec.stepIds) {
        if (screenStart >= limitEnd) break;
        const full = Math.min(screenStart + stretch((seconds.get(stepId) ?? 0) * 1000, extraTimePercent), limitEnd);
        const until = advanceIn(advances.screens.get(stepId), screenStart, full) ?? full;
        screens.push({ stepId, startedAt: screenStart, endsAt: full, until });
        screenStart = until;
      }
      naturalEnd = Math.min(limitEnd, screenStart);
    }
    const end = advanceIn(advances.sections.get(sec.id), start, naturalEnd) ?? naturalEnd;

    if (now < end) {
      const section = { id: sec.id, title: sec.title, index: i, count: sections.length, startedAt: start, endsAt: limitEnd };
      if (!sec.oneAtATime) return { done: false, section, visibleStepIds: [...sec.stepIds], startedSectionIds, sectionStartedAt };
      const j = screens.findIndex((s) => now >= s.startedAt && now < s.until);
      const cur = screens[j];
      return {
        done: false,
        section,
        screen: { stepId: cur.stepId, index: j, count: sec.stepIds.length, startedAt: cur.startedAt, endsAt: cur.endsAt },
        visibleStepIds: [cur.stepId],
        startedSectionIds,
        sectionStartedAt,
      };
    }
    start = end;
  }
  const done = startedSectionIds.length === sections.length;
  return { done, visibleStepIds: [], startedSectionIds, sectionStartedAt };
}

/**
 * Rapid items inside one step: one at a time, each with `secondsPerItem`
 * (stretched by extra time). An answer moves straight on to the next item;
 * an item never outlives its step.
 */
export function resolveItems({
  stepStartedAt,
  stepEndsAt,
  count,
  secondsPerItem,
  extraTimePercent,
  answeredAt,
  now,
}: {
  stepStartedAt: number;
  stepEndsAt: number;
  count: number;
  secondsPerItem: number;
  extraTimePercent: number;
  answeredAt: Record<number, number | undefined>;
  now: number;
}): SequenceState {
  const per = stretch(secondsPerItem * 1000, extraTimePercent);
  let start = stepStartedAt;
  for (let i = 0; i < count; i++) {
    if (start >= stepEndsAt) return { index: i, startedAt: start, endsAt: start, done: true };
    const end = Math.min(start + per, stepEndsAt);
    const answer = answeredAt[i];
    const until = answer !== undefined && answer >= start && answer < end ? answer : end;
    if (now < until) return { index: i, startedAt: start, endsAt: end, done: false };
    start = until;
  }
  return { index: count, startedAt: start, endsAt: start, done: true };
}

/**
 * Messages that have arrived by `now`. A message linked to a step in a
 * section arrives `arriveAtMinute` after that section starts (never before
 * it starts); every other message is relative to the attempt start.
 */
export function visibleMessageIds(definition: ScenarioDefinition, flow: FlowState, startedAt: number, now: number): string[] {
  return definition.messages
    .filter((m) => {
      const at = messageArrivesAt(definition, flow, m, startedAt);
      return at !== undefined && at <= now;
    })
    .map((m) => m.id);
}

/** When a message arrives (server ms), or undefined while its section hasn't started. */
export function messageArrivesAt(
  definition: ScenarioDefinition,
  flow: FlowState,
  message: { stepId?: string; arriveAtMinute?: number },
  startedAt: number,
): number | undefined {
  const offset = (message.arriveAtMinute ?? 0) * MINUTE;
  const section = message.stepId ? definition.sections?.find((s) => s.stepIds.includes(message.stepId!)) : undefined;
  if (!section) return startedAt + offset;
  const sectionStart = flow.sectionStartedAt[section.id];
  return sectionStart === undefined ? undefined : sectionStart + offset;
}

/** Authoring checks for `sections`; returns readable errors (empty when valid or without sections). */
export function validateSections(definition: ScenarioDefinition, timeLimitMinutes: number): string[] {
  const sections = definition.sections;
  if (!sections) return [];
  const errors: string[] = [];
  const steps = new Map(definition.steps.map((s) => [s.id, s]));
  const seen = new Map<string, number>();
  const sectionIds = new Set<string>();

  if (!sections.length) errors.push("sections is empty; leave it out instead");
  for (const sec of sections) {
    if (sectionIds.has(sec.id)) errors.push(`Section id "${sec.id}" is used twice`);
    sectionIds.add(sec.id);
    if (!(sec.minutes > 0)) errors.push(`Section "${sec.id}" needs minutes above 0`);
    if (!sec.stepIds.length) errors.push(`Section "${sec.id}" has no steps`);
    for (const stepId of sec.stepIds) {
      seen.set(stepId, (seen.get(stepId) ?? 0) + 1);
      const step = steps.get(stepId);
      if (!step) errors.push(`Section "${sec.id}" lists unknown step "${stepId}"`);
      else if (sec.oneAtATime && !(typeof step.seconds === "number" && step.seconds > 0)) {
        errors.push(`Step "${stepId}" needs seconds (its screen time) in one-at-a-time section "${sec.id}"`);
      }
    }
  }
  for (const step of definition.steps) {
    const n = seen.get(step.id) ?? 0;
    if (n === 0) errors.push(`Step "${step.id}" is in no section`);
    if (n > 1) errors.push(`Step "${step.id}" is in more than one section`);
  }
  const total = sections.reduce((sum, s) => sum + s.minutes, 0);
  if (total > timeLimitMinutes) {
    errors.push(`Sections add up to ${total} minutes, longer than the ${timeLimitMinutes} minute limit`);
  }
  return errors;
}
