import { Settings } from "@/components/groups/settings";
import { requireGroupsStaff } from "@/lib/groups/staff/context";
import * as groups from "@/lib/groups/staff/groups";
import * as moderation from "@/lib/messaging/moderation";
import { getChurchMessagingSettings } from "@/lib/messaging/settings";

export const dynamic = "force-dynamic";

export default async function GroupsSettingsPage() {
  const ctx = await requireGroupsStaff();
  const [settings, types, health] = await Promise.all([
    getChurchMessagingSettings(ctx.admin, ctx.churchId),
    groups.listStaffGroupTypes(ctx),
    moderation.syncHealth(ctx),
  ]);
  return <Settings settings={settings} types={types} health={health} isAdmin={ctx.isAdmin} />;
}
