import "server-only";

import { inboxReplyServer, rubricRequest } from "../step-types/inbox_reply/server";
import type { RubricScoreRequest } from "../step-types/inbox_reply/rubric";
import { INBOX_REPLY } from "../step-types/inbox_reply/public";
import type { ServerScenario } from "./scenario";

/**
 * What an automatic rubric scorer receives for each written reply in an
 * attempt: the task, the reply and the criteria with reference facts, rebuilt
 * from the seed like scoreAttempt does. Blank or invalid replies are left out
 * (they score 0 without review). Server only: the requests hold answer keys.
 */
export function rubricRequestsForAttempt(
  scenario: ServerScenario,
  seed: string,
  answers: Record<string, unknown>,
): { stepId: string; request: RubricScoreRequest }[] {
  const variant = scenario.generate(seed);
  const out: { stepId: string; request: RubricScoreRequest }[] = [];
  for (const step of scenario.definition.steps) {
    if (step.type !== INBOX_REPLY || answers[step.id] === undefined) continue;
    let answer;
    try {
      answer = inboxReplyServer.parseAnswer(answers[step.id]);
    } catch {
      continue;
    }
    if (answer.body.trim() === "") continue;
    const config = inboxReplyServer.configSchema.parse(step.config);
    const key = inboxReplyServer.keySchema.parse(variant.keys[step.id]);
    out.push({ stepId: step.id, request: rubricRequest(config, key, variant.values, answer) });
  }
  return out;
}
