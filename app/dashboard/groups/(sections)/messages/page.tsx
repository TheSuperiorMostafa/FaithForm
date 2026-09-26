import { Messages } from "@/components/groups/chat";
import { requireGroupsStaff } from "@/lib/groups/staff/context";
import * as groups from "@/lib/groups/staff/groups";
import { pageFeatureBlocked } from "@/lib/features/page-gate";

export const dynamic = "force-dynamic";

export default async function GroupMessagesPage() {
  if (await pageFeatureBlocked("groups")) return null;

  const ctx = await requireGroupsStaff();
  const [active, archived] = await Promise.all([
    groups.listStaffGroups(ctx),
    groups.listStaffGroups(ctx, { status: "archived" }),
  ]);
  return <Messages groups={[...active, ...archived]} />;
}
