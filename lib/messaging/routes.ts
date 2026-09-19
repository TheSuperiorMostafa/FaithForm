import { VisitorError } from "@/lib/faithform/errors";
import { requireActiveAccount } from "@/lib/faithform/account";
import { DM_CHANNEL_TYPE, GROUP_CHANNEL_TYPE, groupIdFromChannelId, parseCid } from "@/lib/messaging/ids";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Where a chat notification lands.
 *
 * A push names a conversation (`cid`) and perhaps a message; it is a hint,
 * never an authority. This re-derives, now, whether the person may still open
 * that conversation — an active member of the group, or one of the two people
 * in a direct conversation, with a usable relationship to its church — and
 * answers where to go. Anything else is `not_found`, and the app says the
 * conversation is no longer available rather than opening what the
 * notification claimed.
 */

export type ChatRoute = {
  kind: "group" | "direct";
  churchSlug: string;
  groupId: string | null;
  cid: string;
  messageId: string | null;
};

export async function resolveChatRoute(userId: string, cid: string, messageId: string | null): Promise<ChatRoute> {
  const account = await requireActiveAccount(userId);
  const parsed = parseCid(cid);
  if (!parsed) throw new VisitorError("group_not_found", "That conversation is no longer available.");
  const admin = createAdminClient();
  const safeMessage = messageId && /^[A-Za-z0-9_-]{1,128}$/.test(messageId) ? messageId : null;

  let churchId: string | null = null;
  let groupId: string | null = null;

  if (parsed.type === GROUP_CHANNEL_TYPE) {
    groupId = groupIdFromChannelId(parsed.id);
    if (!groupId) throw new VisitorError("group_not_found", "That conversation is no longer available.");
    const { data: group } = await admin
      .from("groups")
      .select("church_id, status")
      .eq("id", groupId)
      .neq("status", "deleted")
      .maybeSingle();
    if (!group) throw new VisitorError("group_not_found", "That conversation is no longer available.");
    const { data: membership } = await admin.rpc("group_membership_for_account", {
      p_group_id: groupId,
      p_account_id: account.id,
    });
    const member = Array.isArray(membership) ? membership[0] : membership;
    if (!member?.id || member.status !== "active") {
      throw new VisitorError("group_not_found", "That conversation is no longer available.");
    }
    churchId = group.church_id as string;
  } else if (parsed.type === DM_CHANNEL_TYPE) {
    const { data } = await admin
      .from("messaging_dm_channels")
      .select("church_id, user_low, user_high, state")
      .eq("channel_id", parsed.id)
      .neq("state", "deleted")
      .maybeSingle();
    if (!data || (data.user_low !== userId && data.user_high !== userId)) {
      throw new VisitorError("group_not_found", "That conversation is no longer available.");
    }
    churchId = data.church_id as string;
  }

  const { data: church } = await admin.from("churches").select("slug").eq("id", churchId!).maybeSingle();
  const { data: relationship } = await admin
    .from("visitor_church_relationships")
    .select("state")
    .eq("account_id", account.id)
    .eq("church_id", churchId!)
    .maybeSingle();
  if (!church?.slug || !relationship || !["following", "pending", "joined"].includes(relationship.state as string)) {
    throw new VisitorError("group_not_found", "That conversation is no longer available.");
  }

  return {
    kind: parsed.type === GROUP_CHANNEL_TYPE ? "group" : "direct",
    churchSlug: church.slug as string,
    groupId,
    cid,
    messageId: safeMessage,
  };
}
