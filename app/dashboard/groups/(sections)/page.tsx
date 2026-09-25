import { GroupList } from "@/components/groups/group-list";
import { requireGroupsStaff } from "@/lib/groups/staff/context";
import * as groups from "@/lib/groups/staff/groups";
import * as insights from "@/lib/groups/staff/insights";

export const dynamic = "force-dynamic";

export default async function AllGroupsPage() {
  const ctx = await requireGroupsStaff();
  const [active, archived, summary, types, campuses] = await Promise.all([
    groups.listStaffGroups(ctx),
    groups.listStaffGroups(ctx, { status: "archived" }),
    insights.churchGroupSummary(ctx),
    groups.listStaffGroupTypes(ctx),
    groups.listStaffCampuses(ctx),
  ]);
  return <GroupList groups={[...active, ...archived]} summary={summary} types={types} campuses={campuses} />;
}
