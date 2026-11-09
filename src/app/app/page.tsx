import { redirect } from "next/navigation";
import { resolveDefaultMembership } from "@/lib/auth";

// Plain /app opens the company the user last used (or their first one).
// Links in emails and redirects after login point here.
export default async function AppIndex() {
  const { orgSlug } = await resolveDefaultMembership();
  redirect(`/app/${orgSlug}`);
}
