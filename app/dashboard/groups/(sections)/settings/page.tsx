import { Settings } from "@/components/groups/settings";
import { requireGroupsStaff } from "@/lib/groups/staff/context";
import * as groups from "@/lib/groups/staff/groups";
import { getChurchMessagingSettings } from "@/lib/messaging/settings";

export const dynamic = "force-dynamic";

export default async function GroupsSettingsPage() {
  const ctx = await requireGroupsStaff();
  const [settings, types] = await Promise.all([
    getChurchMessagingSettings(ctx.admin, ctx.churchId),
    groups.listStaffGroupTypes(ctx),
  ]);
  return <Settings settings={settings} types={types} isAdmin={ctx.isAdmin} />;
}
