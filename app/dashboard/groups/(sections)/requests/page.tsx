import { Requests } from "@/components/groups/people";
import { requireGroupsStaff } from "@/lib/groups/staff/context";
import * as people from "@/lib/groups/staff/people";

export const dynamic = "force-dynamic";

export default async function GroupJoinRequestsPage() {
  const ctx = await requireGroupsStaff();
  return <Requests requests={await people.listStaffRequests(ctx, null)} />;
}
