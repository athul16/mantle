import Link from "next/link";
import { signOut } from "@/app/(auth)/actions";

// The signed-in user's own account pages (two-factor setup and sign-in code).
// Not tied to a company, so there is no company nav here.
export default function AccountLayout({ children }: LayoutProps<"/app/account">) {
  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header className="border-b border-neutral-200 dark:border-neutral-800">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-4 px-6 py-3 text-sm">
          <Link href="/app" className="font-semibold">Assessment Platform</Link>
          <form action={signOut}>
            <button type="submit" className="text-neutral-600 underline hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-white">
              Sign out
            </button>
          </form>
        </div>
      </header>
      <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-8">{children}</main>
    </div>
  );
}
