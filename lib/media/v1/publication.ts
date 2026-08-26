import type { SupabaseClient } from "@supabase/supabase-js";

import { createAdminClient } from "@/lib/supabase/admin";
import {
  renditionIdentityUnchanged,
  verdictIsFresh,
  verifyRecording,
  type RecordingRendition,
} from "@/lib/media/v1/rendition-check";
import {
  isTransientRefusal,
  staffExplanation,
  type RenditionReason,
} from "@/lib/media/v1/rendition";

/**
 * Publishing to Faithful, from the dashboard.
 *
 * The dashboard is where publishing decisions are made, and this is the only
 * module that makes them. Faithful reads a projection; it never writes one.
 *
 * Two rules shape everything here:
 *
 *  1. **Nothing is inferred.** Not from a provider URL, not from a filename,
 *     not from a webhook, and not from the fact that a stream ended. A recording
 *     becomes visible because a named human pressed a button, and the audit row
 *     records which human and when.
 *
 *  2. **Publishing one thing publishes one thing.** Publishing a live service
 *     does not publish its future recording; the recording does not exist yet,
 *     and when it does it arrives `ready` and invisible like every other.
 */

export type MobileVisibility = "none" | "public" | "followers" | "members";

/**
 * How many unverified recordings one dashboard listing will probe.
 *
 * Each probe is two bounded range requests against storage. A church with four
 * years of services must not turn opening the media page into a scan of all of
 * them, so the newest few are proved and the rest wait their turn.
 */
const MAX_PROBES_PER_LISTING = 8;

export const MOBILE_VISIBILITIES: MobileVisibility[] = [
  "none",
  "public",
  "followers",
  "members",
];

/**
 * What a staff member sees next to an item.
 *
 * Deliberately more states than the two the database stores, because "not
 * visible" has several very different causes and telling them apart is the
 * difference between a pastor waiting patiently and a pastor filing a bug.
 */
export type MediaPublicationState =
  /** Never published. The default for everything. */
  | "draft"
  /** Published and scheduled, but its start is still ahead. */
  | "scheduled"
  /** On air right now. */
  | "live"
  /** The service ended; no recording has landed yet. */
  | "awaiting_recording"
  /** The file is still being written or uploaded. Cannot be published. */
  | "processing"
  /** A playable file exists and nobody has published it. */
  | "ready"
  /**
   * A file exists, and Faithful cannot play it on both platforms.
   *
   * Its own state rather than a variant of `ready`, because the action is
   * completely different: `ready` needs a decision, this needs a different file.
   */
  | "needs_conversion"
  /** Not yet probed. Cannot be published until it has been. */
  | "unverified"
  /** Visible in Faithful. */
  | "published"
  /** Was visible; a staff member took it down. */
  | "unpublished"
  /** Taken down *and* barred from issuing further playback capabilities. */
  | "revoked"
  | "cancelled";

export type PublishableItem = {
  kind: "live" | "recording";
  id: string;
  title: string;
  /** When the service happened or is scheduled for. */
  occurredAt: string;
  durationSeconds: number | null;
  state: MediaPublicationState;
  visibility: MobileVisibility;
  posterUrl: string | null;
  summary: string | null;
  publishedAt: string | null;
  unpublishedAt: string | null;
  revokedAt: string | null;
  publicationVersion: number;
  /** Whether this item is in a state a human is allowed to publish. */
  canPublish: boolean;
  /**
   * Whether Faithful can actually play it, proven from the object's own bytes.
   *
   * Always true for a live event: there is no stored file to verify, and a live
   * stream's eligibility is the session check that was already there.
   */
  mobilePlayable: boolean;
  /** Machine-readable. For support and for the state above; never for a visitor. */
  renditionReason: string | null;
  /** What a staff member reads. Names no codec, brand, bucket or path. */
  renditionExplanation: string | null;
  renditionVerifiedAt: string | null;
};

function client(supabase?: SupabaseClient) {
  return supabase ?? createAdminClient();
}

// ---------------------------------------------------------------------------
// Poster selection
// ---------------------------------------------------------------------------

export type PosterChoice = { url: string; label: string; source: string };

/**
 * The posters a church may choose from.
 *
 * "Authorized existing assets" is taken literally: the linked event's artwork,
 * the church's cover image, and the church's logo. No uploader is added and no
 * external URL is accepted, because a poster field that takes any URL is an
 * open redirect and an image-hotlink vector on every visitor's phone.
 */
export async function listPosterChoices(
  churchId: string,
  options?: { streamEventId?: string | null; supabase?: SupabaseClient },
): Promise<PosterChoice[]> {
  const db = client(options?.supabase);
  const choices: PosterChoice[] = [];

  const { data: church } = await db
    .from("churches")
    .select("cover_image_url, logo_url")
    .eq("id", churchId)
    .maybeSingle();

  if (options?.streamEventId) {
    const { data: event } = await db
      .from("stream_events")
      .select("artwork_url")
      .eq("id", options.streamEventId)
      .eq("church_id", churchId)
      .maybeSingle();
    const artwork = (event?.artwork_url as string | null) ?? null;
    if (artwork) choices.push({ url: artwork, label: "Service artwork", source: "event" });
  }

  const cover = (church?.cover_image_url as string | null) ?? null;
  if (cover) choices.push({ url: cover, label: "Church cover image", source: "church_cover" });

  const logo = (church?.logo_url as string | null) ?? null;
  if (logo) choices.push({ url: logo, label: "Church logo", source: "church_logo" });

  return choices;
}

/**
 * Refuses a poster the church does not already own.
 *
 * Validated against the church's own rows on every write rather than trusted
 * from the form, because the form is a client and the whole point of the
 * restriction is that a client cannot choose an arbitrary URL.
 */
export async function resolvePoster(
  churchId: string,
  requested: string | null | undefined,
  options?: { streamEventId?: string | null; supabase?: SupabaseClient },
): Promise<{ ok: true; url: string | null } | { ok: false }> {
  if (!requested) return { ok: true, url: null };
  const allowed = await listPosterChoices(churchId, options);
  return allowed.some((choice) => choice.url === requested)
    ? { ok: true, url: requested }
    : { ok: false };
}

// ---------------------------------------------------------------------------
// Audit
// ---------------------------------------------------------------------------

export type PublicationAction =
  | "published"
  | "unpublished"
  | "visibility_changed"
  | "revoked"
  | "poster_changed";

export type AuditEntry = {
  id: string;
  action: PublicationAction;
  previousVisibility: MobileVisibility | null;
  newVisibility: MobileVisibility | null;
  actorUserId: string | null;
  createdAt: string;
};

async function writeAudit(
  input: {
    churchId: string;
    kind: "live" | "recording";
    id: string;
    action: PublicationAction;
    previousVisibility: MobileVisibility | null;
    newVisibility: MobileVisibility | null;
    actorUserId: string;
  },
  supabase?: SupabaseClient,
): Promise<void> {
  // Append-only. A correction is another row, never an edit: "it was published
  // for three hours on Sunday" is a question a church may need to answer long
  // after someone took it down.
  await client(supabase)
    .from("stream_media_publication_audit")
    .insert({
      church_id: input.churchId,
      stream_event_id: input.kind === "live" ? input.id : null,
      stream_recording_id: input.kind === "recording" ? input.id : null,
      action: input.action,
      previous_visibility: input.previousVisibility,
      new_visibility: input.newVisibility,
      actor_user_id: input.actorUserId,
    });
}

export async function listPublicationAudit(
  input: {
    churchId: string;
    kind: "live" | "recording";
    id: string;
    limit?: number;
  },
  supabase?: SupabaseClient,
): Promise<AuditEntry[]> {
  const column = input.kind === "live" ? "stream_event_id" : "stream_recording_id";
  const { data } = await client(supabase)
    .from("stream_media_publication_audit")
    .select("id, action, previous_visibility, new_visibility, actor_user_id, created_at")
    .eq("church_id", input.churchId)
    .eq(column, input.id)
    .order("created_at", { ascending: false })
    .limit(Math.min(50, Math.max(1, input.limit ?? 20)));

  return ((data ?? []) as Record<string, unknown>[]).map((row) => ({
    id: row.id as string,
    action: row.action as PublicationAction,
    previousVisibility: (row.previous_visibility as MobileVisibility | null) ?? null,
    newVisibility: (row.new_visibility as MobileVisibility | null) ?? null,
    actorUserId: (row.actor_user_id as string | null) ?? null,
    createdAt: row.created_at as string,
  }));
}

// ---------------------------------------------------------------------------
// Publish / unpublish / revoke
// ---------------------------------------------------------------------------

export type PublicationResult =
  | { ok: true; state: MediaPublicationState }
  | {
      ok: false;
      reason:
        | "not_found"
        | "not_publishable"
        | "invalid_poster"
        | "unavailable"
        /** Faithful cannot play the file. `explanation` says what to do. */
        | "not_playable"
        /** A concurrent re-probe replaced the verdict. Try again. */
        | "verification_stale"
        /**
         * The object in storage is not the object that was verified.
         *
         * Distinct from `not_playable`, because it is not a statement about the
         * file's encoding: nothing has been read. The row is withdrawn and the
         * next probe says what is there now.
         */
        | "object_changed";
      explanation?: string;
    };

const TABLE = { live: "stream_events", recording: "stream_recordings" } as const;

/**
 * Makes an item visible in Faithful.
 *
 * The publishability check is the important half. A recording that is still
 * `processing` has no playable file behind it, and a cancelled event never
 * happened — publishing either would put a card in front of a congregation that
 * cannot be played. Both are refused here rather than filtered later.
 */
export async function publishToFaithful(
  input: {
    churchId: string;
    kind: "live" | "recording";
    id: string;
    visibility: Exclude<MobileVisibility, "none">;
    posterUrl?: string | null;
    summary?: string | null;
    actorUserId: string;
  },
  supabase?: SupabaseClient,
): Promise<PublicationResult> {
  const db = client(supabase);

  // Two shapes rather than one conditional select string: a recording carries a
  // storage path and an event does not, and pretending otherwise makes the
  // column list a lie on one of the two branches.
  //
  // The tenant predicate is on the statement, not applied afterwards: an id
  // from another church matches nothing rather than being published by a guess.
  const existing =
    input.kind === "recording"
      ? (
          await db
            .from("stream_recordings")
            .select(
              "id, status, mobile_visibility, stream_event_id, storage_path, " +
                "mobile_rendition_object_etag, mobile_rendition_object_version, " +
                "mobile_rendition_object_size, mobile_rendition_object_hash",
            )
            .eq("id", input.id)
            .eq("church_id", input.churchId)
            .maybeSingle()
        ).data
      : (
          await db
            .from("stream_events")
            .select("id, status, mobile_visibility")
            .eq("id", input.id)
            .eq("church_id", input.churchId)
            .maybeSingle()
        ).data;

  if (!existing) return { ok: false, reason: "not_found" };

  const row = existing as Record<string, unknown>;
  const status = row.status as string;
  if (input.kind === "live" && (status === "cancelled" || status === "ended")) {
    return { ok: false, reason: "not_publishable" };
  }
  if (input.kind === "recording" && status !== "ready") {
    // `processing` has no file yet. The legacy `published` value from 0034 is
    // also refused: nothing produces it, and treating it as publishable would
    // make a dead status meaningful again.
    return { ok: false, reason: "not_publishable" };
  }

  const poster = await resolvePoster(input.churchId, input.posterUrl, {
    // An event is its own artwork source; a recording borrows its linked event's.
    streamEventId:
      input.kind === "live" ? input.id : ((row.stream_event_id as string | null) ?? null),
    supabase: db,
  });
  if (!poster.ok) return { ok: false, reason: "invalid_poster" };

  const previous = (row.mobile_visibility as MobileVisibility) ?? "none";
  const summary =
    input.summary?.trim() ? input.summary.trim().slice(0, 2000) : null;

  // -----------------------------------------------------------------------
  // A recording is published through the transactional gate.
  //
  // **The eligibility check happens inside the write**, not before it. Probing
  // and then updating would leave a window in which a concurrent re-probe could
  // invalidate the verdict and the publish would still land — and the whole
  // point of this gate is that "published" means "playable".
  // -----------------------------------------------------------------------
  if (input.kind === "recording") {
    const storagePath = row.storage_path as string;

    // ---------------------------------------------------------------------
    // Is the object still the object that was verified?
    //
    // Asked **before** the re-probe, and answered separately from it, because
    // the two say different things. A re-probe of a substituted file could come
    // back playable and publish happily — and the church would have published a
    // recording nobody chose. So a changed object is withdrawn and refused here;
    // the staff member sees the row go back to "checking", and the next probe
    // reports what is actually there.
    //
    // `upload-recording.sh` uploads with `x-upsert: true`, so this is not
    // hypothetical: a re-run of a backfill replaces the object under an
    // unchanged path.
    // ---------------------------------------------------------------------
    const verifiedIdentity = {
      etag: (row.mobile_rendition_object_etag as string | null) ?? null,
      versionId: (row.mobile_rendition_object_version as string | null) ?? null,
      sizeBytes: (row.mobile_rendition_object_size as number | null) ?? null,
      windowHash: (row.mobile_rendition_object_hash as string | null) ?? null,
    };
    const bound =
      verifiedIdentity.windowHash !== null ||
      verifiedIdentity.etag !== null ||
      verifiedIdentity.versionId !== null;

    if (bound) {
      const unchanged = await renditionIdentityUnchanged(storagePath, verifiedIdentity, db);
      if (!unchanged.ok) {
        if (unchanged.reason === "object_changed") {
          await db.rpc("invalidate_recording_rendition", {
            p_recording_id: input.id,
            p_church_id: input.churchId,
            p_reason: "object_changed",
          });
          return {
            ok: false,
            reason: "object_changed",
            explanation: staffExplanation("object_changed"),
          };
        }
        return {
          ok: false,
          reason: "not_playable",
          explanation: staffExplanation(unchanged.reason),
        };
      }
    }

    // Always re-probe at publish time. A verdict from an hour ago is evidence
    // about an hour ago, and a pastor pressing publish is exactly the moment to
    // be sure.
    const rendition = await verifyRecording(
      {
        recordingId: input.id,
        churchId: input.churchId,
        storagePath,
      },
      db,
    );

    if (!rendition.playable) {
      return {
        ok: false,
        reason: "not_playable",
        explanation: staffExplanation(rendition.reason),
      };
    }

    const { data, error } = await db.rpc("publish_recording_to_faithful", {
      p_recording_id: input.id,
      p_church_id: input.churchId,
      p_visibility: input.visibility,
      p_poster_url: poster.url,
      p_summary: summary,
      // The verdict this call is acting on. A concurrent re-probe that replaced
      // it makes the row stop matching, and the caller is told to try again
      // rather than publishing against a verdict that no longer holds.
      p_expected_revision: rendition.revision,
      // The bytes this call is bound to. Not redundant with the revision: the
      // revision proves nothing new was written to the row, the identity proves
      // the row still describes the object in the bucket.
      p_expected_object_hash: rendition.identity.windowHash,
      p_expected_object_etag: rendition.identity.etag,
    });

    if (error) return { ok: false, reason: "unavailable" };
    const outcome = ((data ?? []) as Record<string, unknown>[])[0];

    if (!outcome?.ok) {
      const reason = (outcome?.reason as string) ?? "unavailable";
      if (reason === "verification_stale") {
        return { ok: false, reason: "verification_stale" };
      }
      if (reason === "not_ready" || reason === "not_found") {
        return { ok: false, reason: reason === "not_found" ? "not_found" : "not_publishable" };
      }
      return {
        ok: false,
        reason: "not_playable",
        explanation: staffExplanation(reason as RenditionReason),
      };
    }

    await writeAudit(
      {
        churchId: input.churchId,
        kind: input.kind,
        id: input.id,
        action: previous === "none" ? "published" : "visibility_changed",
        previousVisibility: previous,
        newVisibility: input.visibility,
        actorUserId: input.actorUserId,
      },
      db,
    );

    return { ok: true, state: "published" };
  }

  // -----------------------------------------------------------------------
  // A live event has no stored file to verify.
  //
  // Its eligibility is the session check the live projection already applies:
  // an event whose encoder has gone is not live, whatever the row says.
  // -----------------------------------------------------------------------
  const { error } = await db
    .from(TABLE[input.kind])
    .update({
      mobile_visibility: input.visibility,
      mobile_published_at: new Date().toISOString(),
      // Publishing clears both, so a previously unpublished or revoked item can
      // come back without leaving a stale tombstone that the projections would
      // keep filtering on.
      mobile_unpublished_at: null,
      mobile_revoked_at: null,
      mobile_poster_url: poster.url,
    })
    .eq("id", input.id)
    .eq("church_id", input.churchId);

  if (error) return { ok: false, reason: "unavailable" };

  await writeAudit(
    {
      churchId: input.churchId,
      kind: input.kind,
      id: input.id,
      action: previous === "none" ? "published" : "visibility_changed",
      previousVisibility: previous,
      newVisibility: input.visibility,
      actorUserId: input.actorUserId,
    },
    db,
  );

  return { ok: true, state: "published" };
}

/**
 * Takes an item down.
 *
 * `revoke` is the stronger form: an unpublished item disappears from lists and
 * details, and a revoked one additionally cannot mint another playback
 * capability — which is what stops a device that is *already watching* at its
 * next refresh, roughly a minute later, instead of at the end of the sermon.
 */
export async function unpublishFromFaithful(
  input: {
    churchId: string;
    kind: "live" | "recording";
    id: string;
    revoke?: boolean;
    actorUserId: string;
  },
  supabase?: SupabaseClient,
): Promise<PublicationResult> {
  const db = client(supabase);
  const now = new Date().toISOString();

  const { data: existing } = await db
    .from(TABLE[input.kind])
    .select("id, mobile_visibility")
    .eq("id", input.id)
    .eq("church_id", input.churchId)
    .maybeSingle();

  if (!existing) return { ok: false, reason: "not_found" };

  const { error } = await db
    .from(TABLE[input.kind])
    .update({
      mobile_unpublished_at: now,
      ...(input.revoke ? { mobile_revoked_at: now } : {}),
    })
    .eq("id", input.id)
    .eq("church_id", input.churchId);

  if (error) return { ok: false, reason: "unavailable" };

  await writeAudit(
    {
      churchId: input.churchId,
      kind: input.kind,
      id: input.id,
      action: input.revoke ? "revoked" : "unpublished",
      previousVisibility: (existing.mobile_visibility as MobileVisibility) ?? "none",
      newVisibility: null,
      actorUserId: input.actorUserId,
    },
    db,
  );

  return { ok: true, state: input.revoke ? "revoked" : "unpublished" };
}

// ---------------------------------------------------------------------------
// What the dashboard lists
// ---------------------------------------------------------------------------

function eventState(row: Record<string, unknown>, hasLiveSession: boolean): MediaPublicationState {
  if (row.status === "cancelled") return "cancelled";
  if (row.mobile_revoked_at) return "revoked";
  if (row.mobile_visibility === "none") return "draft";
  if (row.mobile_unpublished_at) return "unpublished";
  if (row.status === "live" && hasLiveSession) return "live";
  if (row.status === "ended") return "awaiting_recording";
  if (row.status === "scheduled") return "scheduled";
  return "published";
}

function recordingState(row: Record<string, unknown>): MediaPublicationState {
  if (row.status === "processing") return "processing";
  if (row.mobile_revoked_at) return "revoked";

  // **Eligibility outranks intent.** A recording a church published and which
  // has since been proved unplayable is not "in Faithful" — the projections
  // stopped serving it the moment the verdict was written — so the dashboard
  // must not keep claiming it is.
  const verified = Boolean(row.mobile_rendition_verified_at);
  if (!row.mobile_playable) {
    if (!verified) return "unverified";
    return isTransientRefusal(row.mobile_rendition_reason as RenditionReason)
      ? "unverified"
      : "needs_conversion";
  }

  if (row.mobile_visibility === "none") return "draft";
  if (row.mobile_unpublished_at) return "unpublished";
  return "published";
}

/**
 * Everything a church could publish, with the state a staff member needs.
 *
 * Bounded: recent events and recent recordings. A church with four years of
 * services does not need all of them on one screen, and an unbounded list of a
 * private bucket's contents is the kind of page that eventually times out.
 */
export async function listPublishableMedia(
  churchId: string,
  options?: { limit?: number; supabase?: SupabaseClient },
): Promise<PublishableItem[]> {
  const db = client(options?.supabase);
  const limit = Math.min(100, Math.max(1, options?.limit ?? 25));

  const [{ data: events }, { data: recordings }, { data: sessions }] = await Promise.all([
    db
      .from("stream_events")
      .select(
        "id, title, starts_at, status, mobile_visibility, mobile_published_at, mobile_unpublished_at, mobile_revoked_at, mobile_publication_version, mobile_poster_url, artwork_url",
      )
      .eq("church_id", churchId)
      .order("starts_at", { ascending: false })
      .limit(limit),
    db
      .from("stream_recordings")
      .select(
        "id, title, created_at, duration_sec, trim_start_sec, trim_end_sec, status, storage_path, mobile_visibility, mobile_published_at, mobile_unpublished_at, mobile_revoked_at, mobile_publication_version, mobile_poster_url, mobile_summary, mobile_playable, mobile_rendition_reason, mobile_rendition_verified_at",
      )
      .eq("church_id", churchId)
      .order("created_at", { ascending: false })
      .limit(limit),
    db
      .from("stream_sessions")
      .select("stream_event_id")
      .eq("church_id", churchId)
      .in("status", ["preparing", "waiting_for_encoder", "live"])
      .not("ingest_started_at", "is", null),
  ]);

  const liveEventIds = new Set(
    ((sessions ?? []) as Record<string, unknown>[])
      .map((row) => row.stream_event_id as string | null)
      .filter((value): value is string => Boolean(value)),
  );

  // -----------------------------------------------------------------------
  // Verify what has not been verified, or whose verdict has gone stale.
  //
  // Bounded on purpose. Opening the media page must not become a scan of a
  // church's whole archive, so a page's worth of unverified rows is probed and
  // the rest keep saying `unverified` until they are next on screen. Publishing
  // re-probes regardless, so nothing can be published on a stale verdict.
  // -----------------------------------------------------------------------
  const needsProbe = ((recordings ?? []) as Record<string, unknown>[])
    .filter(
      (row) =>
        row.status === "ready" &&
        !verdictIsFresh({
          verifiedAt: (row.mobile_rendition_verified_at as string | null) ?? null,
          reason: (row.mobile_rendition_reason as string | null) ?? null,
        }),
    )
    .slice(0, MAX_PROBES_PER_LISTING);

  const probed = new Map<string, RecordingRendition>();
  for (const row of needsProbe) {
    const verdict = await verifyRecording(
      {
        recordingId: row.id as string,
        churchId,
        storagePath: row.storage_path as string,
      },
      db,
    ).catch(() => null);
    if (verdict) probed.set(row.id as string, verdict);
  }

  const liveItems: PublishableItem[] = ((events ?? []) as Record<string, unknown>[]).map(
    (row) => {
      const state = eventState(row, liveEventIds.has(row.id as string));
      return {
        kind: "live" as const,
        id: row.id as string,
        title: (row.title as string) ?? "Service",
        occurredAt: row.starts_at as string,
        durationSeconds: null,
        state,
        visibility: (row.mobile_visibility as MobileVisibility) ?? "none",
        posterUrl:
          (row.mobile_poster_url as string | null) ?? (row.artwork_url as string | null) ?? null,
        summary: null,
        publishedAt: (row.mobile_published_at as string | null) ?? null,
        unpublishedAt: (row.mobile_unpublished_at as string | null) ?? null,
        revokedAt: (row.mobile_revoked_at as string | null) ?? null,
        publicationVersion: Number(row.mobile_publication_version ?? 1),
        canPublish: state !== "cancelled" && row.status !== "ended",
        // A live event has no stored file to verify. Its eligibility is the
        // session check the live projection already applies.
        mobilePlayable: true,
        renditionReason: null,
        renditionExplanation: null,
        renditionVerifiedAt: null,
      };
    },
  );

  const recordingItems: PublishableItem[] = ((recordings ?? []) as Record<string, unknown>[]).map(
    (original) => {
      // A freshly probed verdict replaces what the row held when it was read.
      const fresh = probed.get(original.id as string);
      const row = fresh
        ? {
            ...original,
            mobile_playable: fresh.playable,
            mobile_rendition_reason: fresh.reason,
            mobile_rendition_verified_at: fresh.verifiedAt,
          }
        : original;

      const state = recordingState(row);
      const duration =
        row.trim_end_sec !== null && row.trim_end_sec !== undefined
          ? Number(row.trim_end_sec) - Number(row.trim_start_sec ?? 0)
          : row.duration_sec !== null && row.duration_sec !== undefined
            ? Number(row.duration_sec) - Number(row.trim_start_sec ?? 0)
            : null;

      return {
        kind: "recording" as const,
        id: row.id as string,
        title: ((row.title as string | null) ?? "").trim() || "Service recording",
        occurredAt: row.created_at as string,
        durationSeconds: duration === null ? null : Math.max(0, Math.round(duration)),
        state,
        visibility: (row.mobile_visibility as MobileVisibility) ?? "none",
        posterUrl: (row.mobile_poster_url as string | null) ?? null,
        summary: (row.mobile_summary as string | null) ?? null,
        publishedAt: (row.mobile_published_at as string | null) ?? null,
        unpublishedAt: (row.mobile_unpublished_at as string | null) ?? null,
        revokedAt: (row.mobile_revoked_at as string | null) ?? null,
        publicationVersion: Number(row.mobile_publication_version ?? 1),
        // **The gate, in the dashboard.** A processing recording has no file
        // yet; an unplayable one has a file no phone can decode. Neither may be
        // put in front of a congregation, and the button is absent rather than
        // present-and-failing.
        canPublish: row.status === "ready" && Boolean(row.mobile_playable),
        mobilePlayable: Boolean(row.mobile_playable),
        renditionReason: (row.mobile_rendition_reason as string | null) ?? null,
        renditionExplanation: row.mobile_rendition_reason
          ? staffExplanation(row.mobile_rendition_reason as RenditionReason)
          : null,
        renditionVerifiedAt: (row.mobile_rendition_verified_at as string | null) ?? null,
      };
    },
  );

  return [...liveItems, ...recordingItems].sort(
    (a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime(),
  );
}
