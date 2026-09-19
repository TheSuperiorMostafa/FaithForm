import { VisitorError } from "@/lib/faithform/errors";
import { loadGroupForMember, type MemberContext } from "@/lib/groups/context";
import { DM_CHANNEL_TYPE, GROUP_CHANNEL_TYPE, groupIdFromChannelId, parseCid } from "@/lib/messaging/ids";

/**
 * Whether the caller may act on a conversation FaithForm made — report in it,
 * resolve a card shared in it — decided from FaithForm's records, never from
 * the chat provider's member list.
 *
 *   group channel   an active member of that group, in this church
 *   direct channel  one of its two people, in this church
 *
 * Everything else, including a well-formed id of another church's channel,
 * is `not_found`.
 */

export type ChannelAccess =
  | { kind: "group"; cid: string; channelId: string; groupId: string; groupName: string }
  | { kind: "direct"; cid: string; channelId: string; dmRowId: string; otherUserId: string };

export async function requireChannelAccess(ctx: MemberContext, cid: string): Promise<ChannelAccess> {
  const parsed = parseCid(cid);
  if (!parsed) throw new VisitorError("group_not_found", "That conversation was not found.");

  if (parsed.type === GROUP_CHANNEL_TYPE) {
    const groupId = groupIdFromChannelId(parsed.id);
    if (!groupId) throw new VisitorError("group_not_found", "That conversation was not found.");
    const access = await loadGroupForMember(ctx, groupId, "id, church_id, name, status, visibility");
    if (!access.membership) throw new VisitorError("group_not_found", "That conversation was not found.");
    return { kind: "group", cid, channelId: parsed.id, groupId, groupName: access.group.name as string };
  }

  if (parsed.type === DM_CHANNEL_TYPE) {
    const { data } = await ctx.admin
      .from("messaging_dm_channels")
      .select("id, user_low, user_high, state")
      .eq("channel_id", parsed.id)
      .eq("church_id", ctx.church.id)
      .neq("state", "deleted")
      .maybeSingle();
    if (!data || (data.user_low !== ctx.userId && data.user_high !== ctx.userId)) {
      throw new VisitorError("group_not_found", "That conversation was not found.");
    }
    return {
      kind: "direct",
      cid,
      channelId: parsed.id,
      dmRowId: data.id as string,
      otherUserId: (data.user_low === ctx.userId ? data.user_high : data.user_low) as string,
    };
  }

  throw new VisitorError("group_not_found", "That conversation was not found.");
}
