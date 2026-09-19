import { getAnnouncementDetail } from "@/lib/faithform/announcements-feed";
import { publishedContentAccessState } from "@/lib/faithform/relationship-state";
import { isUuid, resolveMemberContext } from "@/lib/groups/context";
import { requireChannelAccess } from "@/lib/messaging/access";
import { getSermonDetail } from "@/lib/sermons/v1/sermon-service";

/**
 * FaithForm things shared into a conversation.
 *
 * A message carries only `{ kind, id }` (see `CARD_KINDS`). The card a reader
 * sees is resolved here, now, for them: the reader must be in the
 * conversation, the item must belong to the same church, and the reader must
 * be allowed to see it through the same projection that shows it anywhere
 * else in the app. A deleted, withdrawn, retargeted or private item resolves
 * to `available: false` — an old message's id is not a way back in.
 */

export const CARD_KINDS = ["group_event", "church_event", "sermon"] as const;
export type CardKind = (typeof CARD_KINDS)[number];

export type ChatCardDto = {
  kind: string;
  id: string;
  available: boolean;
  title: string | null;
  subtitle: string | null;
  imageUrl: string | null;
  startsAt: string | null;
  endsAt: string | null;
  locationName: string | null;
  deepLink: string | null;
};

function unavailable(kind: string, id: string): ChatCardDto {
  return {
    kind,
    id,
    available: false,
    title: null,
    subtitle: null,
    imageUrl: null,
    startsAt: null,
    endsAt: null,
    locationName: null,
    deepLink: null,
  };
}

function formatWhen(startsAt: string, timezone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(startsAt));
}

export async function resolveChatCard(
  userId: string,
  churchSlug: string,
  input: { kind: string; id: string; cid: string },
): Promise<ChatCardDto> {
  const ctx = await resolveMemberContext(userId, churchSlug);
  await requireChannelAccess(ctx, input.cid);
  if (!(CARD_KINDS as readonly string[]).includes(input.kind) || !isUuid(input.id)) {
    return unavailable(input.kind.slice(0, 40), input.id.slice(0, 64));
  }

  if (input.kind === "group_event") {
    const { data } = await ctx.admin
      .from("group_events")
      .select("id, group_id, title, starts_at, ends_at, timezone, location_name, status, groups!inner(name, status, cover_image_url)")
      .eq("id", input.id)
      .eq("church_id", ctx.church.id)
      .maybeSingle();
    if (!data) return unavailable(input.kind, input.id);
    const row = data as unknown as {
      group_id: string;
      title: string;
      starts_at: string;
      ends_at: string;
      timezone: string;
      location_name: string | null;
      status: string;
      groups: { name: string; status: string; cover_image_url: string | null };
    };
    const group = Array.isArray(row.groups) ? row.groups[0] : row.groups;
    // A group's gatherings are for its members.
    const { data: membership } = await ctx.admin.rpc("group_membership_for_account", {
      p_group_id: row.group_id,
      p_account_id: ctx.account.id,
    });
    const member = Array.isArray(membership) ? membership[0] : membership;
    if (!member?.id || member.status !== "active" || group?.status === "deleted") return unavailable(input.kind, input.id);
    return {
      kind: input.kind,
      id: input.id,
      available: true,
      title: row.title,
      subtitle: `${group.name} · ${row.status === "cancelled" ? "Cancelled" : formatWhen(row.starts_at, row.timezone)}`,
      imageUrl: group.cover_image_url,
      startsAt: new Date(row.starts_at).toISOString(),
      endsAt: new Date(row.ends_at).toISOString(),
      locationName: row.location_name,
      deepLink: `faithform://church/${ctx.church.slug}/groups/${row.group_id}/events/${input.id}`,
    };
  }

  if (input.kind === "church_event") {
    const item = await getAnnouncementDetail({
      churchSlug: ctx.church.slug,
      announcementId: input.id,
      relationshipState: publishedContentAccessState(ctx.relationshipState),
    }).catch(() => null);
    if (!item) return unavailable(input.kind, input.id);
    return {
      kind: input.kind,
      id: input.id,
      available: true,
      title: item.title,
      subtitle: item.allDay
        ? new Intl.DateTimeFormat("en-US", { timeZone: ctx.church.timezone, weekday: "short", month: "short", day: "numeric" }).format(new Date(item.startAt))
        : formatWhen(item.startAt, ctx.church.timezone),
      imageUrl: item.posterUrl,
      startsAt: item.startAt,
      endsAt: item.endAt,
      locationName: item.location,
      deepLink: `faithform://church/${ctx.church.slug}/announcements/${input.id}`,
    };
  }

  const sermon = await getSermonDetail({ userId, churchSlug: ctx.church.slug, sermonId: input.id }).catch(() => null);
  if (!sermon) return unavailable(input.kind, input.id);
  return {
    kind: input.kind,
    id: input.id,
    available: true,
    title: sermon.title,
    subtitle: [sermon.seriesName, sermon.scriptureRefs[0]].filter(Boolean).join(" · ") || null,
    imageUrl: sermon.thumbnailUrl ?? null,
    startsAt: null,
    endsAt: null,
    locationName: null,
    deepLink: `faithform://church/${ctx.church.slug}/sermons/${input.id}`,
  };
}
