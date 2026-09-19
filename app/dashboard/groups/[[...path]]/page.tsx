import { notFound } from "next/navigation";
import { requireGroupsStaff } from "@/lib/groups/staff/context";
import { isUuid } from "@/lib/groups/context";
import { VisitorError } from "@/lib/faithform/errors";
import * as groups from "@/lib/groups/staff/groups";
import * as people from "@/lib/groups/staff/people";
import * as events from "@/lib/groups/staff/gatherings";
import * as insights from "@/lib/groups/staff/insights";
import * as moderation from "@/lib/messaging/moderation";
import { getChurchMessagingSettings } from "@/lib/messaging/settings";
import { GroupsNav } from "@/components/groups/shared";
import { GroupList } from "@/components/groups/group-list";
import { GroupDetailShell, GroupOverview, GroupLifecycle } from "@/components/groups/group-detail";
import { CoverEditor, GroupForm } from "@/components/groups/group-form";
import { Invitations, Members, Requests } from "@/components/groups/people";
import { Gatherings, Schedules } from "@/components/groups/gatherings";
import { GroupChat, Messages } from "@/components/groups/chat";
import { Insights } from "@/components/groups/insights";
import { Settings } from "@/components/groups/settings";
import { Moderation } from "@/components/groups/moderation";

export const dynamic = "force-dynamic";
export default async function GroupsPage({ params }: { params: Promise<{ path?: string[] }> }) {
  const { path = [] } = await params;
  const ctx = await requireGroupsStaff();
  const section = path[0] ?? "";
  if (path.length > 2 || (path.length === 2 && !isUuid(section))) notFound();
  let content;
  if (!section) {
    const [active, archived, summary, types, campuses] = await Promise.all([groups.listStaffGroups(ctx), groups.listStaffGroups(ctx, { status: "archived" }), insights.churchGroupSummary(ctx), groups.listStaffGroupTypes(ctx), groups.listStaffCampuses(ctx)]);
    content = <GroupList groups={[...active, ...archived]} summary={summary} types={types} campuses={campuses} />;
  } else if (section === "messages") {
    const [active, archived] = await Promise.all([groups.listStaffGroups(ctx), groups.listStaffGroups(ctx, { status: "archived" })]);
    content = <Messages groups={[...active, ...archived]} />;
  } else if (section === "requests") {
    content = <Requests requests={await people.listStaffRequests(ctx, null)} />;
  } else if (section === "insights") {
    const [summary, trend, health] = await Promise.all([insights.churchGroupSummary(ctx), insights.weeklyTrend(ctx, null), insights.groupHealth(ctx)]);
    content = <Insights summary={summary} trend={trend} health={health} />;
  } else if (section === "settings") {
    const [settings, types, health] = await Promise.all([getChurchMessagingSettings(ctx.admin, ctx.churchId), groups.listStaffGroupTypes(ctx), moderation.syncHealth(ctx)]);
    content = <Settings settings={settings} types={types} health={health} isAdmin={ctx.isAdmin} />;
  } else if (section === "moderation") {
    const [reports, suspensions, log] = await Promise.all([moderation.listReports(ctx, { status: "all" }), moderation.listSuspensions(ctx), moderation.moderationLog(ctx)]);
    content = <Moderation reports={reports} suspensions={suspensions} log={log} />;
  } else if (isUuid(section)) {
    let detail;
    try { detail = await groups.getStaffGroup(ctx, section); } catch (error) { if (error instanceof VisitorError && error.code === "group_not_found") notFound(); throw error; }
    const tab = path[1] ?? "overview";
    const [types, campuses] = await Promise.all([groups.listStaffGroupTypes(ctx), groups.listStaffCampuses(ctx)]);
    let panel;
    if (tab === "overview") {
      const invitations = await people.listStaffInvitations(ctx, section);
      panel = <GroupOverview detail={detail}><Invitations groupId={section} invitations={invitations} archived={detail.group.status !== "active"} /></GroupOverview>;
    } else if (tab === "chat") panel = <GroupChat groupId={section} cid={detail.chatCid} state={detail.chatState} />;
    else if (tab === "members") {
      const [roster, bans] = await Promise.all([people.listStaffMembers(ctx, section), people.listStaffBans(ctx, section)]);
      panel = <Members groupId={section} members={roster.items} bans={bans} archived={detail.group.status !== "active"} />;
    } else if (tab === "requests") panel = <Requests embedded requests={await people.listStaffRequests(ctx, section)} />;
    else if (tab === "gatherings") {
      const [upcoming, past] = await Promise.all([events.listStaffGatherings(ctx, section, "upcoming"), events.listStaffGatherings(ctx, section, "past")]);
      panel = <><Gatherings detail={detail} upcoming={upcoming} past={past} timezone={ctx.church.timezone} />{detail.group.status === "active" && <div className="mt-6"><Schedules detail={detail} timezone={ctx.church.timezone} /></div>}</>;
    } else if (tab === "settings") panel = <div className="space-y-6">{detail.group.status === "active" && <><div className="g-panel"><GroupForm detail={detail} types={types} campuses={campuses} /></div><CoverEditor detail={detail} /></>}<GroupLifecycle detail={detail} /></div>;
    else notFound();
    content = <GroupDetailShell detail={detail} tab={tab} types={types} campuses={campuses}>{panel}</GroupDetailShell>;
  } else notFound();
  return <><GroupsNav />{content}</>;
}
