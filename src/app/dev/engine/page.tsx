import Link from "next/link";
import { notFound } from "next/navigation";
import { renderAttemptForCandidate } from "@/lib/engine/server/render";
import { latestScenario, scenarioChoices } from "./scenarios";
import { DevWorkspace } from "./workspace";

/**
 * Dev-only preview of the engine: /dev/engine?scenario=demo-mini-close&seed=abc&minute=5
 * `scenario` is a slug (latest version; defaults to demo-petty-cash). `minute`
 * simulates time since the attempt started, to show scheduled messages. In the
 * real attempt flow seed and minute come from the server, never the URL.
 */
export default async function DevEnginePage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  if (process.env.NODE_ENV === "production") notFound();

  const params = await searchParams;
  const slug = typeof params.scenario === "string" ? params.scenario : "demo-petty-cash";
  const scenario = latestScenario(slug);
  if (!scenario) notFound();
  const seed = (typeof params.seed === "string" && params.seed.slice(0, 100)) || "demo";
  const minuteParam = typeof params.minute === "string" ? Number(params.minute) : 0;
  const minute = Number.isFinite(minuteParam) && minuteParam >= 0 ? minuteParam : 0;

  const view = renderAttemptForCandidate(scenario, seed, minute);
  const minutes = [...new Set([0, ...scenario.definition.messages.map((m) => m.arriveAtMinute ?? 0)])].sort((a, b) => a - b);

  return (
    <main className="mx-auto max-w-5xl space-y-4 px-4 py-8">
      <nav className="flex flex-wrap gap-2 text-sm" aria-label="Scenario">
        {scenarioChoices().map((s) => (
          <Link
            key={s.slug}
            href={{ query: { scenario: s.slug, seed, minute: 0 } }}
            aria-current={s.slug === scenario.slug ? "page" : undefined}
            className={`rounded border px-3 py-1 ${
              s.slug === scenario.slug
                ? "border-neutral-900 bg-neutral-900 text-white dark:border-white dark:bg-white dark:text-neutral-900"
                : "border-neutral-300 dark:border-neutral-700"
            }`}
          >
            {s.title} <span className="font-mono text-xs opacity-70">v{s.version}</span>
          </Link>
        ))}
      </nav>
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h1 className="text-lg font-semibold">{scenario.title}</h1>
          <p className="text-sm text-neutral-500">
            Engine preview · seed <span className="font-mono">{seed}</span> · minute {minute}
          </p>
        </div>
        <nav className="flex flex-wrap gap-3 text-sm underline">
          {minutes.map((m) => (
            <Link key={m} href={{ query: { scenario: scenario.slug, seed, minute: m } }}>
              Minute {m}
            </Link>
          ))}
          <Link href={{ query: { scenario: scenario.slug, seed: "abc", minute } }}>Seed abc</Link>
          <Link href={{ query: { scenario: scenario.slug, seed: "xyz", minute } }}>Seed xyz</Link>
        </nav>
      </header>
      <p className="text-sm text-neutral-600 dark:text-neutral-400">{view.intro}</p>
      <DevWorkspace
        key={`${scenario.slug}:${seed}:${minute}`}
        slug={scenario.slug}
        seed={seed}
        messages={view.messages}
        steps={view.steps}
      />
    </main>
  );
}
