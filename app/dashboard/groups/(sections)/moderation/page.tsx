import { Moderation } from "@/components/groups/moderation";
import { requireGroupsStaff } from "@/lib/groups/staff/context";
import * as moderation from "@/lib/messaging/moderation";
import { pageFeatureBlocked } from "@/lib/features/page-gate";

export const dynamic = "force-dynamic";

export default async function GroupSafetyPage() {
  if (await pageFeatureBlocked("groups")) return null;

  const ctx = await requireGroupsStaff();
  const [reports, suspensions, log] = await Promise.all([
    moderation.listReports(ctx, { status: "all" }),
    moderation.listSuspensions(ctx),
    moderation.moderationLog(ctx),
  ]);
  return <Moderation reports={reports} suspensions={suspensions} log={log} />;
}
