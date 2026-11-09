import "server-only";

import type { Scenario, Variant } from "../types";
import { createRng, type Rng } from "./rng";

/** A scenario plus its server-side variant generator. */
export interface ServerScenario extends Scenario {
  /** Deterministic for a given seed: same attempt, same numbers and keys. */
  generate(seed: string): Variant;
}

/**
 * Wraps a scenario's generator so it gets an RNG namespaced by slug and
 * version. The same attempt seed then yields independent numbers per scenario,
 * and a new scenario version can change its generator without colliding.
 */
export function defineScenario(scenario: Scenario & { build(rng: Rng): Variant }): ServerScenario {
  const { build, ...rest } = scenario;
  return {
    ...rest,
    generate(seed: string) {
      return build(createRng(`${scenario.slug}@v${scenario.version}:${seed}`));
    },
  };
}
