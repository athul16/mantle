import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Assessment",
  // Invite links carry a token; keep them out of search engines and referrers.
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default function CandidateLayout({ children }: LayoutProps<"/a">) {
  return <div className="flex flex-1 flex-col">{children}</div>;
}
