import type { SupabaseClient } from "@supabase/supabase-js";

import type { ChurchAuth } from "@/lib/auth/church";
import { VisitorError } from "@/lib/faithform/errors";
import { resolveMemberContext } from "@/lib/groups/context";
import { CHAT_TOKEN_TTL_SECONDS } from "@/lib/messaging/config";
import { provisionChatUsers, resolveChatIdentity } from "@/lib/messaging/directory";
import { chatTeamForChurch } from "@/lib/messaging/ids";
import { getChatProvider } from "@/lib/messaging/stream-provider";
import { dedupeKey, syncNow } from "@/lib/messaging/sync/worker";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Chat sessions: the one place a chat credential is minted.
 *
 * A token names exactly one chat identity — derived from the verified
 * sign-in, never from anything the client sends — and lives an hour. What
 * that identity may reach is decided separately, and continuously, by the
 * tenants FaithForm gives it (see `directory.ts`) and the channel memberships
 * the reconciler maintains; a token authorizes nothing by itself. Clients
 * refresh through a token provider that calls back here, so a person who
 * leaves a church is re-derived within the hour even on a connection that
 * never dropped — and immediately, because losing a tenant revokes every
 * token issued before it (`sync/handlers.ts`).
 */

export type ChatSessionDto = {
  appKey: string;
  churchTeam: string;
  chatUserId: string;
  userToken: string;
  expiresAt: string;
  suspended: boolean;
  suspendedUntil: string | null;
};

async function activeRestriction(admin: SupabaseClient, churchId: string, userId: string) {
  const { data } = await admin
    .from("messaging_restrictions")
    .select("ends_at")
    .eq("church_id", churchId)
    .eq("user_id", userId)
    .is("lifted_at", null)
    .maybeSingle();
  if (!data) return null;
  const endsAt = (data.ends_at as string | null) ?? null;
  if (endsAt && Date.parse(endsAt) <= Date.now()) return null;
  return { endsAt };
}

async function mint(admin: SupabaseClient, authUserId: string, churchId: string, as: "member" | "staff"): Promise<ChatSessionDto> {
  const provider = getChatProvider();
  if (!provider) throw new VisitorError("unavailable", "Messages aren't available right now.");

  const identity = await resolveChatIdentity(admin, authUserId);
  const reachable = as === "member" ? identity?.memberChurchIds : identity?.staffChurchIds;
  if (!identity || !reachable?.includes(churchId)) {
    throw new VisitorError("forbidden", "Messages aren't available for this account here.");
  }

  const { data: existing } = await admin
    .from("messaging_user_bindings")
    .select("user_id")
    .eq("user_id", authUserId)
    .maybeSingle();

  try {
    await provisionChatUsers(admin, provider, [identity]);
  } catch {
    throw new VisitorError("unavailable", "Messages are reconnecting. Try again in a moment.");
  }

  if (!existing) {
    // A first chat session: devices, notification choices and blocks made
    // before this person ever opened chat now apply.
    for (const kind of ["user.devices", "user.push", "user.blocks"]) {
      await admin.rpc("enqueue_messaging_sync", {
        p_church_id: churchId,
        p_kind: kind,
        p_subject: authUserId,
        p_payload: {},
        p_delay_seconds: 0,
      });
    }
    // Awaited, with a short budget: a serverless function may stop the moment
    // it responds, and anything unfinished is the scheduled worker's anyway.
    await syncNow(
      ["user.devices", "user.push", "user.blocks"].map((kind) => dedupeKey(kind, authUserId)),
      { budgetMs: 3_000 },
    );
  }

  const restriction = await activeRestriction(admin, churchId, authUserId);
  const expiresAt = Math.floor(Date.now() / 1000) + CHAT_TOKEN_TTL_SECONDS;
  return {
    appKey: provider.appKey,
    churchTeam: chatTeamForChurch(churchId),
    chatUserId: identity.profile.chatUserId,
    userToken: provider.createUserToken(identity.profile.chatUserId, expiresAt),
    expiresAt: new Date(expiresAt * 1000).toISOString(),
    suspended: Boolean(restriction),
    suspendedUntil: restriction?.endsAt ?? null,
  };
}

/** For the app: a member of the church named by slug. */
export async function issueMemberChatSession(userId: string, churchSlug: string): Promise<ChatSessionDto> {
  const ctx = await resolveMemberContext(userId, churchSlug);
  return mint(ctx.admin, userId, ctx.church.id, "member");
}

/**
 * For the dashboard: staff of their own church. Refused while a platform
 * admin is working inside a church — reading a congregation's conversations
 * is not part of helping them configure FaithForm.
 */
export async function issueStaffChatSession(auth: ChurchAuth): Promise<ChatSessionDto> {
  if (auth.impersonation) {
    throw new VisitorError("forbidden", "Messages aren't available while viewing a church as FaithForm staff.");
  }
  return mint(createAdminClient(), auth.userId, auth.churchId, "staff");
}
