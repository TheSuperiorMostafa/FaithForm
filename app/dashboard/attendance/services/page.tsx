import { redirect } from "next/navigation";

import { ServiceOccurrencesBoard } from "@/components/attendance/service-occurrences-board";
import { getServicesBoard } from "@/app/dashboard/attendance/services/actions";
import { getChurchAuth } from "@/lib/auth/church";

export const dynamic = "force-dynamic";

export default async function ServicesPage() {
  const auth = await getChurchAuth();
  if (!auth) redirect("/login");

  const board = await getServicesBoard();

  return (
    <ServiceOccurrencesBoard
      upcoming={board.upcoming}
      recent={board.recent}
      counts={board.counts}
      isAdmin={auth.isAdmin}
    />
  );
}
