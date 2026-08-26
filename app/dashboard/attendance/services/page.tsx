import { redirect } from "next/navigation";

import { ServiceOccurrencesBoard } from "@/components/attendance/service-occurrences-board";
import { getOccurrences } from "@/app/dashboard/attendance/services/actions";
import { getChurchAuth } from "@/lib/auth/church";

export const dynamic = "force-dynamic";

export default async function ServicesPage() {
  const auth = await getChurchAuth();
  if (!auth) redirect("/login");

  const occurrences = await getOccurrences();

  return (
    <ServiceOccurrencesBoard occurrences={occurrences} isAdmin={auth.isAdmin} />
  );
}
