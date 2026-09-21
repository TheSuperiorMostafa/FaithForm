import { createHash } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Group notifications, through the one outbox (0054, 0096).
 *
 * Each is enqueued in the request that caused it and delivered by the same
 * worker, adapters and delivery log as an announcement. The recipients are
 * named, but still re-checked at send time; and each notification is cancelled
 * by the worker if its subject has moved on (the request was already decided,
 * the gathering was reinstated).
 *
 * A push is a hint, never the content: the deep link opens the group, which
 * re-authorizes from scratch.
 */

function dedupe(parts: string): string {
  return createHash("sha256").update(parts, "utf8").digest("hex").slice(0, 40);
}

async function enqueue(
  admin: SupabaseClient,
  input: {
    churchId: string;
    kind: "group_join_requested" | "group_request_approved" | "group_event_cancelled" | "group_message";
    subjectType: "group_join_request" | "group_event" | "group_message";
    subjectId: string;
    accountIds: string[];
    title: string;
    body: string;
    deepLink: string;
    collapseKey: string;
    dedupeKey: string;
  },
): Promise<boolean> {
  const accountIds = [...new Set(input.accountIds)].slice(0, 200);
  if (accountIds.length === 0) return false;
  const { error } = await admin.from("notification_outbox").insert({
    church_id: input.churchId,
    kind: input.kind,
    subject_type: input.subjectType,
    subject_id: input.subjectId,
    target_visibility: "members",
    target_account_ids: accountIds,
    topic: "groups",
    title: input.title.slice(0, 120),
    body: input.body.slice(0, 180),
    deep_link: input.deepLink,
    collapse_key: input.collapseKey,
    dedupe_key: input.dedupeKey,
  });
  // A duplicate key means this notification already exists: success.
  return !error;
}

function firstName(name: string | null | undefined): string {
  const first = (name ?? "").trim().split(/\s+/)[0];
  return first || "Someone";
}

export async function notifyLeadersOfJoinRequest(
  admin: SupabaseClient,
  input: {
    churchId: string;
    churchSlug: string;
    groupId: string;
    groupName: string;
    requestId: string;
    requesterName: string | null;
  },
): Promise<void> {
  const { data } = await admin
    .from("group_memberships")
    .select("account_id")
    .eq("group_id", input.groupId)
    .eq("status", "active")
    .in("group_role", ["leader", "manager"])
    .not("account_id", "is", null)
    .limit(200);
  await enqueue(admin, {
    churchId: input.churchId,
    kind: "group_join_requested",
    subjectType: "group_join_request",
    subjectId: input.requestId,
    accountIds: ((data ?? []) as { account_id: string }[]).map((row) => row.account_id),
    title: input.groupName,
    body: `${firstName(input.requesterName)} asked to join.`,
    deepLink: `faithform://church/${input.churchSlug}/groups/${input.groupId}/requests`,
    collapseKey: `group-requests-${input.groupId}`,
    dedupeKey: dedupe(`group_join_requested:${input.requestId}`),
  });
}

export async function notifyRequestApproved(
  admin: SupabaseClient,
  input: {
    churchId: string;
    churchSlug: string;
    groupId: string;
    groupName: string;
    requestId: string;
    accountId: string;
  },
): Promise<void> {
  await enqueue(admin, {
    churchId: input.churchId,
    kind: "group_request_approved",
    subjectType: "group_join_request",
    subjectId: input.requestId,
    accountIds: [input.accountId],
    title: input.groupName,
    body: "You're in. Say hello to your group.",
    deepLink: `faithform://church/${input.churchSlug}/groups/${input.groupId}`,
    collapseKey: `group-approved-${input.groupId}`,
    dedupeKey: dedupe(`group_request_approved:${input.requestId}`),
  });
}

export async function notifyGatheringCancelled(
  admin: SupabaseClient,
  input: {
    churchId: string;
    churchSlug: string;
    groupId: string;
    groupName: string;
    eventId: string;
    eventVersion: number;
    when: string;
  },
): Promise<void> {
  // The people who planned to come — not the whole group.
  const { data } = await admin
    .from("group_event_rsvps")
    .select("account_id")
    .eq("event_id", input.eventId)
    .in("response", ["going", "maybe"])
    .limit(200);
  await enqueue(admin, {
    churchId: input.churchId,
    kind: "group_event_cancelled",
    subjectType: "group_event",
    subjectId: input.eventId,
    accountIds: ((data ?? []) as { account_id: string }[]).map((row) => row.account_id),
    title: input.groupName,
    body: `${input.when} is cancelled.`,
    deepLink: `faithform://church/${input.churchSlug}/groups/${input.groupId}/events/${input.eventId}`,
    collapseKey: `group-event-${input.eventId}`,
    dedupeKey: dedupe(`group_event_cancelled:${input.eventId}:v${input.eventVersion}`),
  });
}

export async function notifyGroupMessage(
  admin: SupabaseClient,
  input: {
    churchId: string;
    churchSlug: string;
    groupId: string;
    groupName: string;
    messageId: string;
    senderAccountId: string | null;
    senderName: string | null;
    text: string | null;
  },
): Promise<void> {
  const { data } = await admin
    .from("group_memberships")
    .select("account_id")
    .eq("group_id", input.groupId)
    .eq("status", "active")
    .not("account_id", "is", null)
    .limit(200);

  const recipients = ((data ?? []) as { account_id: string }[])
    .map((row) => row.account_id)
    .filter((accountId) => accountId !== input.senderAccountId);

  await enqueue(admin, {
    churchId: input.churchId,
    kind: "group_message",
    subjectType: "group_message",
    subjectId: input.messageId,
    accountIds: recipients,
    title: input.groupName,
    body: `${firstName(input.senderName)}: ${(input.text ?? "New message").trim().slice(0, 160)}`,
    deepLink: `faithform://church/${input.churchSlug}/groups/${input.groupId}`,
    collapseKey: `group-messages-${input.groupId}`,
    dedupeKey: dedupe(`group_message:${input.messageId}`),
  });
}
