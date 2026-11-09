import Link from "next/link";
import { notFound } from "next/navigation";
import { demoPettyCash } from "@/lib/engine/scenarios/demo-petty-cash";
import { renderAttemptForCandidate } from "@/lib/engine/server/render";
import { DevWorkspace } from "./workspace";

/**
 * Dev-only preview of the engine: /dev/engine?seed=abc&minute=5
 * `minute` simulates time since the attempt started, to show scheduled
 * messages. In the real attempt flow both come from the server, never the URL.
 */
export default async function DevEnginePage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  if (process.env.NODE_ENV === "production") notFound();

  const params = await searchParams;
  const seed = (typeof params.seed === "string" && params.seed.slice(0, 100)) || "demo";
  const minuteParam = typeof params.minute === "string" ? Number(params.minute) : 0;
  const minute = Number.isFinite(minuteParam) && minuteParam >= 0 ? minuteParam : 0;

  const view = renderAttemptForCandidate(demoPettyCash, seed, minute);

  return (
    <main className="mx-auto max-w-5xl space-y-4 px-4 py-8">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h1 className="text-lg font-semibold">{demoPettyCash.title}</h1>
          <p className="text-sm text-neutral-500">
            Engine preview · seed <span className="font-mono">{seed}</span> · minute {minute}
          </p>
        </div>
        <nav className="flex gap-3 text-sm underline">
          <Link href={{ query: { seed, minute: 0 } }}>Minute 0</Link>
          <Link href={{ query: { seed, minute: 5 } }}>Minute 5</Link>
          <Link href={{ query: { seed: "abc", minute } }}>Seed abc</Link>
          <Link href={{ query: { seed: "xyz", minute } }}>Seed xyz</Link>
        </nav>
      </header>
      <p className="text-sm text-neutral-600 dark:text-neutral-400">{view.intro}</p>
      <DevWorkspace key={`${seed}:${minute}`} seed={seed} messages={view.messages} steps={view.steps} />
    </main>
  );
}
