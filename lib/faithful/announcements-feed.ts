import { createAdminClient } from "@/lib/supabase/admin";
import { VisitorError } from "@/lib/faithful/errors";
import { churchSlugSchema } from "@/lib/faithful/schemas";
import type { RelationshipState } from "@/lib/faithful/relationship-state";

/**
 * The published announcement projection Faithful reads.
 *
 * FaithForm remains the only place an announcement is authored or published.
 * This module never writes one; it projects what a *specific relationship* is
 * allowed to see, and the filtering happens in SQL
 * (`mobile_announcement_feed`) rather than by fetching rows and discarding
 * them in application code.
 */

export type FeedItem = {
  id: string;
  title: string;
  body: string;
  startAt: string;
  endAt: string | null;
  location: string | null;
  posterUrl: string | null;
  posterAltText: string | null;
  isPinned: boolean;
  visibility: "public" | "followers" | "members";
  publicationVersion: number;
  publishedAt: string | null;
};

export type FeedCursor = { pinned: boolean; startAt: string; id: string };

export type FeedPage = {
  items: FeedItem[];
  nextCursor: FeedCursor | null;
  /** Highest publication version in the page — drives the feed ETag. */
  maxVersion: number;
};

/**
 * The relationship state a caller with no row at all is treated as.
 * `left` sees exactly what an anonymous visitor sees: public items only.
 */
const NO_RELATIONSHIP: RelationshipState = "left";

function mapItem(row: Record<string, unknown>): FeedItem {
  return {
    id: row.id as string,
    title: (row.title as string) ?? "",
    body: (row.body as string) ?? "",
    startAt: row.start_at as string,
    endAt: (row.end_at as string | null) ?? null,
    location: (row.location as string | null) ?? null,
    posterUrl: (row.poster_url as string | null) ?? null,
    posterAltText: (row.poster_alt_text as string | null) ?? null,
    isPinned: Boolean(row.is_pinned),
    visibility: row.visibility as FeedItem["visibility"],
    publicationVersion: Number(row.publication_version ?? 1),
    publishedAt: (row.published_at as string | null) ?? null,
  };
}

export async function getAnnouncementFeed(input: {
  churchSlug: string;
  relationshipState: RelationshipState | null;
  limit: number;
  cursor: FeedCursor | null;
}): Promise<FeedPage> {
  const slug = churchSlugSchema.safeParse(input.churchSlug);
  if (!slug.success) throw new VisitorError("church_not_found", "Church not found.");

  // A blocked relationship gets nothing at all — not even public items — so a
  // block is felt rather than merely limiting.
  if (input.relationshipState === "blocked") {
    return { items: [], nextCursor: null, maxVersion: 0 };
  }

  const admin = createAdminClient();
  const { data, error } = await admin.rpc("mobile_announcement_feed", {
    p_church_slug: slug.data,
    p_relationship_state: input.relationshipState ?? NO_RELATIONSHIP,
    p_cursor_pinned: input.cursor?.pinned ?? null,
    p_cursor_start: input.cursor?.startAt ?? null,
    p_cursor_id: input.cursor?.id ?? null,
    // One extra row decides whether a next page exists without a count query.
    p_limit: input.limit + 1,
  });

  if (error) throw new VisitorError("unavailable", "Could not load announcements.");

  const rows = (data ?? []) as Record<string, unknown>[];
  const hasMore = rows.length > input.limit;
  const page = hasMore ? rows.slice(0, input.limit) : rows;
  const last = page[page.length - 1];

  const items = page.map(mapItem);

  return {
    items,
    nextCursor:
      hasMore && last
        ? {
            pinned: Boolean(last.cursor_pinned),
            startAt: last.cursor_start as string,
            id: last.cursor_id as string,
          }
        : null,
    maxVersion: items.reduce((max, item) => Math.max(max, item.publicationVersion), 0),
  };
}

/**
 * One announcement, re-authorized on read.
 *
 * This is what a notification tap resolves against. The push payload is only a
 * hint: if the item was edited, unpublished, retargeted, or the relationship
 * was revoked in the meantime, this returns null and the app says so rather
 * than rendering what the notification claimed.
 */
export async function getAnnouncementDetail(input: {
  churchSlug: string;
  announcementId: string;
  relationshipState: RelationshipState | null;
}): Promise<FeedItem | null> {
  const slug = churchSlugSchema.safeParse(input.churchSlug);
  if (!slug.success) return null;

  if (input.relationshipState === "blocked") return null;

  const admin = createAdminClient();
  const { data, error } = await admin.rpc("mobile_announcement_detail", {
    p_church_slug: slug.data,
    p_announcement_id: input.announcementId,
    p_relationship_state: input.relationshipState ?? NO_RELATIONSHIP,
  });

  if (error) throw new VisitorError("unavailable", "Could not load that announcement.");

  const row = ((data ?? []) as Record<string, unknown>[])[0];
  return row ? mapItem(row) : null;
}
