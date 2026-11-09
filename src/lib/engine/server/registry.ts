import "server-only";

import { numericServer } from "../step-types/numeric/server";
import type { AnyServerStepType } from "./step-type";

/**
 * Server step types, keyed by type id. Adding a new kind of task means adding
 * a plug-in here and in client/registry.ts — never a special case in the
 * attempt flow (CLAUDE.md).
 */
const serverStepTypes: Record<string, AnyServerStepType> = {
  [numericServer.type]: numericServer,
};

export function getServerStepType(type: string): AnyServerStepType {
  const stepType = serverStepTypes[type];
  if (!stepType) throw new Error(`unknown step type "${type}"`);
  return stepType;
}

export function listServerStepTypes(): string[] {
  return Object.keys(serverStepTypes);
}
