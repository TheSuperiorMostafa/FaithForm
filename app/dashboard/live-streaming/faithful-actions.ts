"use server";

import { revalidatePath } from "next/cache";

import { getChurchAuth } from "@/lib/auth/church";
import { featureActionError } from "@/lib/features/guard";
import { createClient } from "@/lib/supabase/server";
import {
  listPosterChoices,
  listPublicationAudit,
  listPublishableMedia,
  publishToFaithful,
  unpublishFromFaithful,
  type AuditEntry,
  type MobileVisibility,
  type PosterChoice,
  type PublishableItem,
} from "@/lib/media/v1/publication";
import {
  getArchivePage,
  getLiveMedia,
  type ArchiveItemDto,
  type LiveMediaDto,
} from "@/lib/media/v1/media-service";
import { mediaPlaybackConfigured } from "@/lib/media/v1/playback-capability";

/**
 * Publishing to Faithful, from the dashboard.
 *
 * Every action resolves the church from the caller's own session and requires
 * an **admin**. Publishing to a congregation's phones is a higher bar than
 * editing a title: the same bar as an attendance correction, and for the same
 * reason — it is visible to people outside the building and it is hard to
 * un-see.
 */

export type FaithfulActionResult<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; error: string };

async function requireAdmin(): Promise<
  { ok: true; churchId: string; userId: string } | { ok: false; error: string }
> {
  const denied = await featureActionError("live_stream");
  if (denied) return { ok: false, error: denied };

  const auth = await getChurchAuth(createClient());
  if (!auth) return { ok: false, error: "You must be signed in." };
  if (!auth.isAdmin) {
    return { ok: false, error: "Only a church admin can publish to Faithful." };
  }
  return { ok: true, churchId: auth.churchId, userId: auth.userId };
}

function revalidate() {
  revalidatePath("/dashboard/live-streaming");
  revalidatePath("/dashboard/live-streaming/media");
}

const VISIBILITY_LABELS: Record<Exclude<MobileVisibility, "none">, string> = {
  public: "Anyone using Faithful",
  followers: "People following this church",
  members: "People who have joined this church",
};

export async function getFaithfulPublishingState(): Promise<
  FaithfulActionResult<{
    items: PublishableItem[];
    posters: PosterChoice[];
    playbackConfigured: boolean;
    visibilityLabels: Record<string, string>;
  }>
> {
  const auth = await requireAdmin();
  if (!auth.ok) return auth;

  const [items, posters] = await Promise.all([
    listPublishableMedia(auth.churchId),
    listPosterChoices(auth.churchId),
  ]);

  return {
    ok: true,
    data: {
      items,
      posters,
      // Surfaced so the panel can explain itself rather than failing at the
      // church. The variable name is not shown to a pastor — it is in the
      // operations runbook, where the person who can act on it will look.
      playbackConfigured: mediaPlaybackConfigured(),
      visibilityLabels: VISIBILITY_LABELS,
    },
  };
}

export async function getPosterChoicesFor(
  input: { kind: "live" | "recording"; id: string },
): Promise<FaithfulActionResult<PosterChoice[]>> {
  const auth = await requireAdmin();
  if (!auth.ok) return auth;

  // A recording's own event artwork is a legitimate choice for it, so the
  // linked event is resolved rather than assumed absent.
  let streamEventId: string | null = null;
  if (input.kind === "recording") {
    const admin = (await import("@/lib/supabase/admin")).createAdminClient();
    const { data } = await admin
      .from("stream_recordings")
      .select("stream_event_id")
      .eq("id", input.id)
      .eq("church_id", auth.churchId)
      .maybeSingle();
    streamEventId = (data?.stream_event_id as string | null) ?? null;
  } else {
    streamEventId = input.id;
  }

  return { ok: true, data: await listPosterChoices(auth.churchId, { streamEventId }) };
}

export async function publishMediaToFaithful(input: {
  kind: "live" | "recording";
  id: string;
  visibility: Exclude<MobileVisibility, "none">;
  posterUrl?: string | null;
  summary?: string | null;
}): Promise<FaithfulActionResult<{ state: string }>> {
  const auth = await requireAdmin();
  if (!auth.ok) return auth;

  const result = await publishToFaithful({
    churchId: auth.churchId,
    kind: input.kind,
    id: input.id,
    visibility: input.visibility,
    posterUrl: input.posterUrl ?? null,
    summary: input.summary ?? null,
    actorUserId: auth.userId,
  });

  if (!result.ok) {
    return {
      ok: false,
      error:
        // The eligibility refusal carries its own sentence, written for a
        // pastor: what is wrong and what to do about it, naming no codec.
        result.reason === "not_playable"
          ? (result.explanation ??
            "Faithful can't play this recording. It needs converting first.")
          : // The file in storage is not the file that was checked. Said plainly,
            // because it usually means someone re-ran an upload from the
            // streaming box, and the fix is simply to wait and publish again.
            result.reason === "object_changed"
            ? "This recording's file changed since it was checked. Faithful is checking it again — try publishing in a minute."
            : result.reason === "verification_stale"
            ? "Someone re-checked this recording while you were publishing. Try again."
            : result.reason === "not_publishable"
              ? "This isn't ready to publish yet. A recording has to finish processing first."
              : result.reason === "invalid_poster"
                ? "Choose a poster from this church's own images."
                : result.reason === "not_found"
                  ? "That item is no longer available."
                  : "Could not publish that.",
    };
  }

  revalidate();
  return { ok: true, data: { state: result.state } };
}

export async function unpublishMediaFromFaithful(input: {
  kind: "live" | "recording";
  id: string;
  revoke?: boolean;
}): Promise<FaithfulActionResult<{ state: string }>> {
  const auth = await requireAdmin();
  if (!auth.ok) return auth;

  const result = await unpublishFromFaithful({
    churchId: auth.churchId,
    kind: input.kind,
    id: input.id,
    revoke: input.revoke,
    actorUserId: auth.userId,
  });

  if (!result.ok) {
    return {
      ok: false,
      error:
        result.reason === "not_found"
          ? "That item is no longer available."
          : "Could not change that.",
    };
  }

  revalidate();
  return { ok: true, data: { state: result.state } };
}

export async function getFaithfulPublicationHistory(input: {
  kind: "live" | "recording";
  id: string;
}): Promise<FaithfulActionResult<AuditEntry[]>> {
  const auth = await requireAdmin();
  if (!auth.ok) return auth;

  return {
    ok: true,
    data: await listPublicationAudit({
      churchId: auth.churchId,
      kind: input.kind,
      id: input.id,
    }),
  };
}

/**
 * Exactly what a visitor sees, read through the visitor's own projection.
 *
 * Deliberately **not** a second query shaped like the mobile one: it calls the
 * same `mobile_media_*` functions a phone does, with an anonymous caller. A
 * preview built from a different query is a preview that can be right while the
 * app is wrong, which is worse than no preview at all.
 */
export async function previewFaithfulVisibility(): Promise<
  FaithfulActionResult<{
    slug: string | null;
    live: LiveMediaDto | null;
    archive: ArchiveItemDto[];
  }>
> {
  const auth = await requireAdmin();
  if (!auth.ok) return auth;

  const admin = (await import("@/lib/supabase/admin")).createAdminClient();
  const { data: church } = await admin
    .from("churches")
    .select("slug")
    .eq("id", auth.churchId)
    .maybeSingle();

  const slug = (church?.slug as string | null) ?? null;
  if (!slug) return { ok: true, data: { slug: null, live: null, archive: [] } };

  const [live, archive] = await Promise.all([
    getLiveMedia({ userId: null, churchSlug: slug }),
    getArchivePage({ userId: null, churchSlug: slug, limit: 10, cursor: null, query: null }),
  ]);

  return { ok: true, data: { slug, live: live.live, archive: archive.items } };
}
