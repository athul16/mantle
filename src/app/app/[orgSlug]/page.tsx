import { redirect } from "next/navigation";
import { requireOrgMembership } from "@/lib/auth";

export const metadata = { title: "Mantle" };

// The prototype has no dashboard: a company opens on its Jobs list.
export default async function OrgHome({ params }: PageProps<"/app/[orgSlug]">) {
  const { orgSlug } = await params;
  await requireOrgMembership(orgSlug);
  redirect(`/app/${orgSlug}/jobs`);
}
