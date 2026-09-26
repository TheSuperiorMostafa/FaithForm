import { Requests } from "@/components/groups/people";
import { requireGroupsStaff } from "@/lib/groups/staff/context";
import * as people from "@/lib/groups/staff/people";
import { pageFeatureBlocked } from "@/lib/features/page-gate";

export const dynamic = "force-dynamic";

export default async function GroupJoinRequestsPage() {
  if (await pageFeatureBlocked("groups")) return null;

  const ctx = await requireGroupsStaff();
  return <Requests requests={await people.listStaffRequests(ctx, null)} />;
}
