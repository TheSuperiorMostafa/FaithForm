import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui/page-header";
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
import { CreateGroupButton, GroupForm, GroupPhotoEditor } from "@/components/groups/group-form";
import { Invitations, Members, Requests } from "@/components/groups/people";
import { Gatherings, Schedules } from "@/components/groups/gatherings";
import { GroupChat, Messages } from "@/components/groups/chat";
import { Insights } from "@/components/groups/insights";
import { Settings } from "@/components/groups/settings";
import { Moderation } from "@/components/groups/moderation";
import { GROUPS_SECTIONS, type GroupsSection } from "@/components/groups/sections";
import { groupAppReach, groupsNavCounts } from "../queries";

export const dynamic = "force-dynamic";

/** A top-level Groups page: its name, one plain sentence, the section links, then its content. */
function SectionPage({ section, action, counts, children }: { section: GroupsSection; action?: ReactNode; counts: { requests: number; reports: number }; children: ReactNode }) {
  const copy = GROUPS_SECTIONS[section];
  return <div className="flex w-full flex-col gap-8">
    <PageHeader title={copy.title} description={copy.description} action={action} />
    <GroupsNav requests={counts.requests} reports={counts.reports} />
    {children}
  </div>;
}

export default async function GroupsPage({ params }: { params: Promise<{ path?: string[] }> }) {
  const { path = [] } = await params;
  const ctx = await requireGroupsStaff();
  const section = path[0] ?? "";
  if (path.length > 2 || (path.length === 2 && !isUuid(section))) notFound();

  if (isUuid(section)) {
    let detail;
    try { detail = await groups.getStaffGroup(ctx, section); } catch (error) { if (error instanceof VisitorError && error.code === "group_not_found") notFound(); throw error; }
    // A group opens on its people: the list most visits are about.
    const tab = path[1] ?? "members";
    const archived = detail.group.status !== "active";
    let panel;
    if (tab === "overview") {
      const invitations = await people.listStaffInvitations(ctx, section);
      panel = <GroupOverview detail={detail}><Invitations groupId={section} groupName={detail.group.name} invitations={invitations} archived={archived} /></GroupOverview>;
    } else if (tab === "chat") {
      const reach = await groupAppReach(ctx, detail.group.id);
      panel = <GroupChat groupId={section} cid={detail.chatCid} state={detail.chatState} reach={reach} />;
    } else if (tab === "members") {
      const [roster, bans] = await Promise.all([people.listStaffMembers(ctx, section), people.listStaffBans(ctx, section)]);
      panel = <Members groupId={section} groupName={detail.group.name} capacity={detail.group.capacity} memberCount={detail.group.member_count} members={roster.items} bans={bans} archived={archived} />;
    } else if (tab === "requests") panel = <Requests embedded requests={await people.listStaffRequests(ctx, section)} />;
    else if (tab === "gatherings") {
      const [upcoming, past] = await Promise.all([events.listStaffGatherings(ctx, section, "upcoming"), events.listStaffGatherings(ctx, section, "past")]);
      panel = <div className="flex flex-col gap-8"><Gatherings detail={detail} upcoming={upcoming} past={past} timezone={ctx.church.timezone} />{!archived && <Schedules detail={detail} timezone={ctx.church.timezone} />}</div>;
    } else if (tab === "settings") {
      const [types, campuses] = await Promise.all([groups.listStaffGroupTypes(ctx), groups.listStaffCampuses(ctx)]);
      panel = <div className="flex flex-col gap-8">{!archived && <><GroupPhotoEditor detail={detail} /><GroupForm detail={detail} types={types} campuses={campuses} /></>}<GroupLifecycle detail={detail} /></div>;
    } else notFound();
    return <GroupDetailShell detail={detail} tab={tab}>{panel}</GroupDetailShell>;
  }

  const counts = await groupsNavCounts(ctx);
  if (!section) {
    const [active, archived, summary, types, campuses] = await Promise.all([groups.listStaffGroups(ctx), groups.listStaffGroups(ctx, { status: "archived" }), insights.churchGroupSummary(ctx), groups.listStaffGroupTypes(ctx), groups.listStaffCampuses(ctx)]);
    return <SectionPage section="list" counts={counts} action={<CreateGroupButton types={types} campuses={campuses} />}><GroupList groups={[...active, ...archived]} summary={summary} types={types} campuses={campuses} /></SectionPage>;
  }
  if (section === "messages") {
    const [active, archived] = await Promise.all([groups.listStaffGroups(ctx), groups.listStaffGroups(ctx, { status: "archived" })]);
    return <SectionPage section="messages" counts={counts}><Messages groups={[...active, ...archived]} /></SectionPage>;
  }
  if (section === "requests") {
    return <SectionPage section="requests" counts={counts}><Requests requests={await people.listStaffRequests(ctx, null)} /></SectionPage>;
  }
  if (section === "insights") {
    const [summary, trend, health] = await Promise.all([insights.churchGroupSummary(ctx), insights.weeklyTrend(ctx, null), insights.groupHealth(ctx)]);
    return <SectionPage section="insights" counts={counts}><Insights summary={summary} trend={trend} health={health} /></SectionPage>;
  }
  if (section === "settings") {
    const [settings, types, health] = await Promise.all([getChurchMessagingSettings(ctx.admin, ctx.churchId), groups.listStaffGroupTypes(ctx), moderation.syncHealth(ctx)]);
    return <SectionPage section="settings" counts={counts}><Settings settings={settings} types={types} health={health} isAdmin={ctx.isAdmin} /></SectionPage>;
  }
  if (section === "moderation") {
    const [reports, suspensions, log] = await Promise.all([moderation.listReports(ctx, { status: "all" }), moderation.listSuspensions(ctx), moderation.moderationLog(ctx)]);
    return <SectionPage section="moderation" counts={counts}><Moderation reports={reports} suspensions={suspensions} log={log} /></SectionPage>;
  }
  notFound();
}
