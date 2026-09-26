import { redirect } from "next/navigation";
import { pageFeatureBlocked } from "@/lib/features/page-gate";

/** Households moved under People. Old links and bookmarks still land. */
export default async function CheckinHouseholdMoved({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  if (await pageFeatureBlocked("checkin")) return null;

  const { id } = await params;
  redirect(`/dashboard/people/households/${encodeURIComponent(id)}`);
}
