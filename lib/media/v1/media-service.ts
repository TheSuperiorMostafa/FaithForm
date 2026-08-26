import { createAdminClient } from "@/lib/supabase/admin";
import { VisitorError } from "@/lib/faithful/errors";
import { getVisitorAccount } from "@/lib/faithful/account";
import { resolveRelationshipState } from "@/lib/mobile/v1/discovery-service";
import {
  issueMediaCapability,
  mediaPlaybackConfigured,
  type MediaKind,
} from "@/lib/media/v1/playback-capability";
import {
  renditionIdentityUnchanged,
  type ObjectIdentity,
} from "@/lib/media/v1/rendition-check";

/**
 * The Faithful media surface: what a church has published, and permission to
 * watch it.
 *
 * Every function here re-derives authorization from the caller's own
 * relationship on every call. Nothing is decided from a cached list, a
 * client-supplied state, or the fact that an id was returned once before — a
 * relationship revoked a second ago changes what all of this returns.
 *
 * The projections themselves are SQL (`mobile_media_*` in migration 0060), for
 * the same reason Prompt 5 put the announcement feed there: a filter written in
 * TypeScript is a filter somebody can forget to apply at a second call site.
 */

/** What a `blocked` caller and a caller for a church that does not exist share. */
const NOT_FOUND = "church_not_found" as const;

async function requireChurchSlug(slug: string): Promise<void> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("churches")
    .select("id")
    .eq("slug", slug)
    .maybeSingle();
  // A hidden church, an unknown slug and a blocked visitor must be one answer.
  // Distinguishing them turns this into a church-existence oracle.
  if (!data) throw new VisitorError(NOT_FOUND, "Church not found.");
}

// ---------------------------------------------------------------------------
// Live now
// ---------------------------------------------------------------------------

export type LiveMediaState = "live" | "upcoming" | "recent_ended";

export type LiveMediaDto = {
  state: LiveMediaState;
  mediaId: string;
  kind: "live";
  title: string;
  startsAt: string;
  countdownEnabled: boolean;
  posterUrl: string | null;
  publicationVersion: number;
  churchSlug: string;
  churchName: string;
  churchTimezone: string;
};

/**
 * What this church is showing right now, or null.
 *
 * **Null is the common answer and it matters.** A home screen must not carry an
 * empty "Live" area on a Tuesday, so "nothing published" comes back as no
 * object rather than as an object with a falsy flag the client might still
 * render a frame around.
 */
export async function getLiveMedia(input: {
  userId: string | null;
  churchSlug: string;
}): Promise<{ live: LiveMediaDto | null; version: number }> {
  await requireChurchSlug(input.churchSlug);
  const relationshipState = await resolveRelationshipState(input.userId, input.churchSlug);

  const admin = createAdminClient();
  const [{ data }, version] = await Promise.all([
    admin.rpc("mobile_media_live", {
      p_church_slug: input.churchSlug,
      p_relationship_state: relationshipState,
    }),
    mediaVersion(input.churchSlug, relationshipState),
  ]);

  const row = ((data ?? []) as Record<string, unknown>[])[0];
  if (!row) return { live: null, version };

  return {
    version,
    live: {
      state: row.state as LiveMediaState,
      mediaId: row.event_id as string,
      kind: "live",
      title: row.title as string,
      startsAt: row.starts_at as string,
      countdownEnabled: Boolean(row.countdown_enabled),
      posterUrl: (row.poster_url as string | null) ?? null,
      publicationVersion: Number(row.publication_version ?? 1),
      churchSlug: input.churchSlug,
      churchName: row.church_name as string,
      churchTimezone: (row.church_timezone as string) ?? "America/New_York",
    },
  };
}

// ---------------------------------------------------------------------------
// The archive
// ---------------------------------------------------------------------------

export type ArchiveItemDto = {
  mediaId: string;
  kind: "recording";
  title: string;
  summary: string | null;
  publishedAt: string;
  recordedAt: string;
  durationSeconds: number | null;
  posterUrl: string | null;
  seriesName: string | null;
  speakers: string[];
  publicationVersion: number;
  churchSlug: string;
  churchName: string;
  churchTimezone: string;
};

export type ArchiveCursor = { publishedAt: string; id: string };

export async function getArchivePage(input: {
  userId: string | null;
  churchSlug: string;
  limit: number;
  cursor: ArchiveCursor | null;
  query: string | null;
}): Promise<{ items: ArchiveItemDto[]; nextCursor: ArchiveCursor | null; version: number }> {
  await requireChurchSlug(input.churchSlug);
  const relationshipState = await resolveRelationshipState(input.userId, input.churchSlug);

  const admin = createAdminClient();
  // One more than the page, so "is there another page" needs no second query
  // and no count over a filtered set.
  const overfetch = input.limit + 1;

  const [{ data }, version] = await Promise.all([
    admin.rpc("mobile_media_archive", {
      p_church_slug: input.churchSlug,
      p_relationship_state: relationshipState,
      p_query: input.query,
      p_cursor_published: input.cursor?.publishedAt ?? null,
      p_cursor_id: input.cursor?.id ?? null,
      p_limit: overfetch,
    }),
    mediaVersion(input.churchSlug, relationshipState),
  ]);

  const rows = (data ?? []) as Record<string, unknown>[];
  const page = rows.slice(0, input.limit);
  const last = page.at(-1);

  return {
    version,
    items: page.map((row) => ({
      mediaId: row.id as string,
      kind: "recording" as const,
      title: row.title as string,
      summary: (row.summary as string | null) ?? null,
      publishedAt: row.published_at as string,
      recordedAt: row.recorded_at as string,
      durationSeconds:
        row.duration_sec === null || row.duration_sec === undefined
          ? null
          : Math.round(Number(row.duration_sec)),
      posterUrl: (row.poster_url as string | null) ?? null,
      seriesName: (row.series_name as string | null) ?? null,
      speakers: (row.speakers as string[] | null) ?? [],
      publicationVersion: Number(row.publication_version ?? 1),
      churchSlug: input.churchSlug,
      churchName: row.church_name as string,
      churchTimezone: (row.church_timezone as string) ?? "America/New_York",
    })),
    nextCursor:
      rows.length > input.limit && last
        ? { publishedAt: last.cursor_published as string, id: last.cursor_id as string }
        : null,
  };
}

// ---------------------------------------------------------------------------
// Detail
// ---------------------------------------------------------------------------

export type MediaDetailDto = ArchiveItemDto & {
  chapters: string[];
  topics: string[];
  /** Where the trimmed recording starts inside the stored file. */
  startOffsetSeconds: number;
};

/**
 * One published recording.
 *
 * Every filter the list applied is applied again, rather than being assumed
 * from the fact that a list once contained this id. A device holding a list
 * cached from before an unpublish must not be able to open the detail page by
 * id — which is the whole reason this is a projection call and not a lookup.
 */
export async function getMediaDetail(input: {
  userId: string | null;
  churchSlug: string;
  mediaId: string;
}): Promise<MediaDetailDto | null> {
  await requireChurchSlug(input.churchSlug);
  const relationshipState = await resolveRelationshipState(input.userId, input.churchSlug);

  const admin = createAdminClient();
  const { data } = await admin.rpc("mobile_media_detail", {
    p_church_slug: input.churchSlug,
    p_relationship_state: relationshipState,
    p_recording_id: input.mediaId,
  });

  const row = ((data ?? []) as Record<string, unknown>[])[0];
  if (!row) return null;

  return {
    mediaId: row.id as string,
    kind: "recording",
    title: row.title as string,
    summary: (row.summary as string | null) ?? null,
    publishedAt: row.published_at as string,
    recordedAt: row.recorded_at as string,
    durationSeconds:
      row.duration_sec === null || row.duration_sec === undefined
        ? null
        : Math.round(Number(row.duration_sec)),
    startOffsetSeconds: Math.max(0, Math.round(Number(row.trim_start_sec ?? 0))),
    posterUrl: (row.poster_url as string | null) ?? null,
    seriesName: (row.series_name as string | null) ?? null,
    speakers: (row.speakers as string[] | null) ?? [],
    chapters: (row.chapters as string[] | null) ?? [],
    topics: (row.topics as string[] | null) ?? [],
    publicationVersion: Number(row.publication_version ?? 1),
    churchSlug: input.churchSlug,
    churchName: row.church_name as string,
    churchTimezone: (row.church_timezone as string) ?? "America/New_York",
  };
}

// ---------------------------------------------------------------------------
// Versions
// ---------------------------------------------------------------------------

/**
 * The highest visitor-visible version across this church's published media.
 *
 * Folded into every list and detail ETag, which is what makes a publish or an
 * unpublish invalidate a cached list — while the provider bookkeeping the
 * triggers in 0060 deliberately ignore does not.
 */
async function mediaVersion(
  churchSlug: string,
  relationshipState: string | null,
): Promise<number> {
  const admin = createAdminClient();
  const { data } = await admin.rpc("mobile_media_version", {
    p_church_slug: churchSlug,
    p_relationship_state: relationshipState,
  });
  return Number(data ?? 0);
}

// ---------------------------------------------------------------------------
// Playback
// ---------------------------------------------------------------------------

export type PlaybackGrant = {
  capability: string;
  expiresAt: string;
  /** Where to point the player. Carries **no** capability. */
  deliveryUrl: string;
  kind: MediaKind;
  /** The delivery form. Live is HLS; the archive is progressive today. */
  renditionKind: "hls" | "progressive";
  mediaId: string;
  /** Seconds before expiry at which a client should refresh. */
  refreshAfterSeconds: number;
  /** Where a trimmed recording actually starts. */
  startOffsetSeconds: number;
};

/**
 * Issues a playback capability, or refuses.
 *
 * Refusal is one answer — `not_found` — whether the church is hidden, the slug
 * is unknown, the visitor is blocked, the item was never published, it was
 * unpublished, it was revoked, or a live event's encoder has gone. A caller
 * probing ids learns nothing about which of them exist.
 *
 * **A capability is minted only after the grant function says yes**, and the
 * grant function checks `mobile_revoked_at`, which the list projections do not
 * need to. That is what makes a revocation stop a device that is *already*
 * watching: its next refresh is refused even though its cached list still shows
 * the item.
 */
/**
 * The identity a grant row carries, in the shape the checker compares.
 *
 * Lives here rather than being rebuilt at each call site so the delivery route
 * and the capability issuer cannot drift into comparing different subsets of it.
 */
export function identityFromGrantRow(row: Record<string, unknown>): ObjectIdentity {
  return {
    etag: (row.object_etag as string | null) ?? null,
    versionId: (row.object_version as string | null) ?? null,
    sizeBytes: (row.object_size as number | null) ?? null,
    windowHash: (row.object_hash as string | null) ?? null,
  };
}

export async function grantPlayback(input: {
  userId: string;
  churchSlug: string;
  kind: MediaKind;
  mediaId: string;
}): Promise<PlaybackGrant | null> {
  if (!mediaPlaybackConfigured()) {
    throw new VisitorError("unavailable", "Playback is unavailable.");
  }

  const account = await getVisitorAccount(input.userId);
  if (!account) throw new VisitorError("account_missing", "No visitor account.");

  const relationshipState = await resolveRelationshipState(input.userId, input.churchSlug);

  const admin = createAdminClient();
  const { data, error } = await admin.rpc("mobile_media_playback_grant", {
    p_church_slug: input.churchSlug,
    p_relationship_state: relationshipState,
    p_kind: input.kind,
    p_media_id: input.mediaId,
  });

  if (error) throw new VisitorError("unavailable", "Playback is unavailable.");
  const row = ((data ?? []) as Record<string, unknown>[])[0];
  if (!row?.ok) return null;

  // -----------------------------------------------------------------------
  // The object is still the object that was verified.
  //
  // `mobile_media_playback_grant` proves the recording *was* verified playable.
  // This proves the bytes at that path are still the bytes that were verified.
  //
  // The earlier version of this check only asked whether something existed at
  // the path, which was strictly weaker than it looked: the relay uploads with
  // `x-upsert: true`, so a replacement lands at the same path and passes an
  // existence check while being an entirely different file. A congregation
  // would have been handed a capability for something nobody verified.
  //
  // On a mismatch the row is **withdrawn**, not merely refused: the recording
  // stops being playable for everyone, the publication version moves, and every
  // cached list and stored ETag is invalidated in the same statement.
  //
  // Deliberately cheap — one signed-URL mint and a one-byte ranged GET —
  // because it runs on every acquisition and every refresh.
  // -----------------------------------------------------------------------
  if (input.kind === "recording") {
    const storagePath = (row.storage_path as string | null) ?? null;
    if (!storagePath) return null;

    const unchanged = await renditionIdentityUnchanged(
      storagePath,
      identityFromGrantRow(row),
      admin,
    );
    if (!unchanged.ok) {
      if (unchanged.reason === "object_changed" || unchanged.reason === "file_missing") {
        await admin.rpc("invalidate_recording_rendition", {
          p_recording_id: input.mediaId,
          p_church_id: row.church_id as string,
          p_reason: unchanged.reason,
        });
      }
      return null;
    }
  }

  const issued = issueMediaCapability({
    accountId: account.id,
    churchSlug: input.churchSlug,
    kind: input.kind,
    mediaId: input.mediaId,
    authorizationVersion: account.authorizationVersion,
  });
  if (!issued) throw new VisitorError("unavailable", "Playback is unavailable.");

  const encodedSlug = encodeURIComponent(input.churchSlug);
  const encodedId = encodeURIComponent(input.mediaId);

  return {
    capability: issued.token,
    expiresAt: issued.expiresAt,
    // **No capability in this URL.** Both native players attach it as a bearer
    // header on every request, including segment requests.
    deliveryUrl:
      input.kind === "live"
        ? `/api/media/v1/live/${encodedSlug}/${encodedId}/index.m3u8`
        : `/api/media/v1/recording/${encodedSlug}/${encodedId}`,
    kind: input.kind,
    // Live is always HLS through the relay proxy. A recording reports the
    // rendition its own verified metadata recorded — `progressive` today,
    // because nothing in this repository packages a VOD playlist.
    renditionKind:
      input.kind === "live"
        ? "hls"
        : ((row.rendition_kind as "hls" | "progressive" | null) ?? "progressive"),
    mediaId: input.mediaId,
    refreshAfterSeconds: 60,
    startOffsetSeconds:
      input.kind === "recording"
        ? Math.max(0, Math.round(Number(row.trim_start_sec ?? 0)))
        : 0,
  };
}

/**
 * Re-checks a presented capability against live authorization.
 *
 * The signature proves the server minted it. This proves the church has not
 * unpublished or revoked the item since, and that the account still holds a
 * relationship that permits it — which a signature can never express.
 */
export async function authorizeDelivery(input: {
  accountId: string;
  churchSlug: string;
  kind: MediaKind;
  mediaId: string;
}): Promise<{
  churchId: string;
  storagePath: string | null;
  /** Which bytes this caller is entitled to. Empty for live. */
  identity: ObjectIdentity;
} | null> {
  const admin = createAdminClient();

  const { data: account } = await admin
    .from("visitor_accounts")
    .select("id, user_id, status")
    .eq("id", input.accountId)
    .maybeSingle();
  if (!account || account.status !== "active") return null;

  const relationshipState = await resolveRelationshipState(
    account.user_id as string,
    input.churchSlug,
  );

  const { data, error } = await admin.rpc("mobile_media_playback_grant", {
    p_church_slug: input.churchSlug,
    p_relationship_state: relationshipState,
    p_kind: input.kind,
    p_media_id: input.mediaId,
  });
  if (error) return null;

  const row = ((data ?? []) as Record<string, unknown>[])[0];
  if (!row?.ok) return null;

  // The grant function already refuses a recording that is not `mobile_playable`,
  // so a delivery request for one that became unplayable mid-playback is
  // refused here on its next range request — not merely at the next refresh.
  //
  // The identity travels with it so the route can prove the bytes it is about to
  // stream are the bytes that were verified, rather than trusting that a path it
  // was handed still points at them.
  return {
    churchId: row.church_id as string,
    storagePath: (row.storage_path as string | null) ?? null,
    identity: identityFromGrantRow(row),
  };
}
