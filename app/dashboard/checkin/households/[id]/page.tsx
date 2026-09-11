import { redirect } from "next/navigation";

/** Households moved under People. Old links and bookmarks still land. */
export default async function CheckinHouseholdMoved({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/dashboard/people/households/${encodeURIComponent(id)}`);
}
