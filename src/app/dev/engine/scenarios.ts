import "server-only";

import { listScenarios } from "@/lib/engine/scenarios";
import type { ServerScenario } from "@/lib/engine/server/scenario";

/** Dev preview helper: the latest version of a scenario by slug, or null. */
export function latestScenario(slug: string): ServerScenario | null {
  const matches = listScenarios().filter((s) => s.slug === slug);
  return matches.length ? matches.reduce((a, b) => (b.version > a.version ? b : a)) : null;
}

/** One entry per slug (latest version), in registry order. */
export function scenarioChoices(): { slug: string; title: string; version: number }[] {
  const slugs = [...new Set(listScenarios().map((s) => s.slug))];
  return slugs.map((slug) => {
    const s = latestScenario(slug)!;
    return { slug, title: s.title, version: s.version };
  });
}
