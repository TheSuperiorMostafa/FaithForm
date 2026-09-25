import { Moderation } from "@/components/groups/moderation";
import { requireGroupsStaff } from "@/lib/groups/staff/context";
import * as moderation from "@/lib/messaging/moderation";

export const dynamic = "force-dynamic";

export default async function GroupSafetyPage() {
  const ctx = await requireGroupsStaff();
  const [reports, suspensions, log] = await Promise.all([
    moderation.listReports(ctx, { status: "all" }),
    moderation.listSuspensions(ctx),
    moderation.moderationLog(ctx),
  ]);
  return <Moderation reports={reports} suspensions={suspensions} log={log} />;
}
