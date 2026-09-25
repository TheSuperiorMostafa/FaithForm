import { notFound } from "next/navigation";
import { GroupLifecycle, GroupOverview } from "@/components/groups/group-detail";
import { GroupForm, GroupPhotoEditor } from "@/components/groups/group-form";
import { Gatherings, Schedules } from "@/components/groups/gatherings";
import { GroupChat } from "@/components/groups/chat";
import { Invitations, Members, Requests } from "@/components/groups/people";
import * as events from "@/lib/groups/staff/gatherings";
import * as groups from "@/lib/groups/staff/groups";
import * as people from "@/lib/groups/staff/people";
import { groupAppReach } from "../queries";
import { loadGroup } from "./load";

/** The content of one group tab. A group opens on its people. */
export async function GroupPanel({ id, tab }: { id: string; tab: string }) {
  const { ctx, detail } = await loadGroup(id);
  const archived = detail.group.status !== "active";

  switch (tab) {
    case "members": {
      const [roster, bans] = await Promise.all([people.listStaffMembers(ctx, id), people.listStaffBans(ctx, id)]);
      return (
        <Members
          groupId={id}
          groupName={detail.group.name}
          capacity={detail.group.capacity}
          memberCount={detail.group.member_count}
          members={roster.items}
          bans={bans}
          archived={archived}
        />
      );
    }
    case "chat": {
      const reach = await groupAppReach(ctx, detail.group.id);
      return <GroupChat groupId={id} cid={detail.chatCid} state={detail.chatState} reach={reach} />;
    }
    case "gatherings": {
      const [upcoming, past] = await Promise.all([
        events.listStaffGatherings(ctx, id, "upcoming"),
        events.listStaffGatherings(ctx, id, "past"),
      ]);
      return (
        <div className="flex flex-col gap-8">
          <Gatherings detail={detail} upcoming={upcoming} past={past} timezone={ctx.church.timezone} />
          {!archived && <Schedules detail={detail} timezone={ctx.church.timezone} />}
        </div>
      );
    }
    case "overview": {
      const invitations = await people.listStaffInvitations(ctx, id);
      return (
        <GroupOverview detail={detail}>
          <Invitations groupId={id} groupName={detail.group.name} invitations={invitations} archived={archived} />
        </GroupOverview>
      );
    }
    case "requests":
      return <Requests embedded requests={await people.listStaffRequests(ctx, id)} />;
    case "settings": {
      const [types, campuses] = await Promise.all([groups.listStaffGroupTypes(ctx), groups.listStaffCampuses(ctx)]);
      return (
        <div className="flex flex-col gap-8">
          {!archived && (
            <>
              <GroupPhotoEditor detail={detail} />
              <GroupForm detail={detail} types={types} campuses={campuses} />
            </>
          )}
          <GroupLifecycle detail={detail} />
        </div>
      );
    }
    default:
      notFound();
  }
}
