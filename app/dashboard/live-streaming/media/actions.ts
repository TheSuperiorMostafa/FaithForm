"use server";

import { randomUUID } from "crypto";
import { revalidatePath } from "next/cache";

import { getChurchAuth } from "@/lib/auth/church";
import { featureActionError } from "@/lib/features/guard";
import {
  ARTWORK_BUCKET,
  artworkStoragePath,
  getArtworkSpec,
  type ArtworkCrop,
} from "@/lib/media/artwork";
import { normalizeSiteImage } from "@/lib/security/validate-image";
import {
  clearSeriesItemArtwork,
  ensureMediaSeries,
  setMediaSeriesArtwork,
  updateMediaItem,
  type MediaVisibility,
} from "@/lib/stream/media-library";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export type MediaActionResult = { ok: true } | { ok: false; error: string };

async function requireAdmin(): Promise<
  { ok: true; churchId: string } | { ok: false; error: string }
> {
  const denied = await featureActionError("live_stream");
  if (denied) return { ok: false, error: denied };

  const auth = await getChurchAuth(createClient());
  if (!auth) return { ok: false, error: "You must be signed in." };
  if (!auth.isAdmin) {
    return { ok: false, error: "Only a church admin can edit media." };
  }
  return { ok: true, churchId: auth.churchId };
}

function revalidate(recordingId?: string) {
  revalidatePath("/dashboard/live-streaming/media");
  if (recordingId) {
    revalidatePath(`/dashboard/live-streaming/media/${recordingId}`);
  }
}

export async function updateMediaDetails(input: {
  recordingId: string;
  title: string;
  visibility: MediaVisibility;
  speakers: string[];
  chapters: string[];
  topics: string[];
}): Promise<MediaActionResult> {
  const guard = await requireAdmin();
  if (!guard.ok) return guard;

  const clean = (values: string[]) =>
    Array.from(
      new Set(values.map((value) => value.trim()).filter(Boolean)),
    ).slice(0, 20);

  const result = await updateMediaItem(guard.churchId, input.recordingId, {
    title: input.title,
    visibility: input.visibility,
    speakers: clean(input.speakers),
    chapters: clean(input.chapters),
    topics: clean(input.topics),
  });

  if (!result.ok) return { ok: false, error: result.error ?? "Could not save." };

  revalidate(input.recordingId);
  return { ok: true };
}

/**
 * Puts a recording in a series, creating the series on first use so a church
 * never has to set one up before it can file something into it.
 */
export async function setMediaSeries(input: {
  recordingId: string;
  seriesId: string | null;
  newSeriesName?: string;
}): Promise<MediaActionResult> {
  const guard = await requireAdmin();
  if (!guard.ok) return guard;

  let seriesId = input.seriesId;

  if (input.newSeriesName?.trim()) {
    const series = await ensureMediaSeries(
      guard.churchId,
      input.newSeriesName,
    );
    if (!series) {
      return { ok: false, error: "Could not create that series." };
    }
    seriesId = series.id;
  }

  const result = await updateMediaItem(guard.churchId, input.recordingId, {
    seriesId,
  });

  if (!result.ok) return { ok: false, error: result.error ?? "Could not save." };

  revalidate(input.recordingId);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// ARTWORK
// ---------------------------------------------------------------------------

/**
 * Matches the browser-side downscaler's budget with room for the crop fields
 * that ride along in the same Server Action body. Vercel refuses anything over
 * 4.5MB regardless of what Next is configured to accept.
 */
const MAX_ARTWORK_BYTES = 12 * 1024 * 1024;

export type ArtworkTarget =
  | { kind: "item"; id: string }
  | { kind: "series"; id: string };

export type ArtworkUploadResult =
  | { ok: true; url: string }
  | { ok: false; error: string };

/**
 * Stores one crop of one image and points a row at it.
 *
 * The crop rectangle arrives in source-image pixels from the cropper, so the
 * cut is made here against the file the church chose rather than against a
 * downscaled canvas copy the browser made. That is also what strips EXIF,
 * including the GPS coordinates a phone attaches to a photo taken at the
 * church — the same reason `uploadSiteImage` re-encodes every upload.
 *
 * Old files are deliberately left in the bucket. Overwriting in place would
 * fight CDN caching, and deleting the previous object would break any device
 * still holding a list that references it.
 */
export async function uploadMediaArtwork(
  formData: FormData,
): Promise<ArtworkUploadResult> {
  const guard = await requireAdmin();
  if (!guard.ok) return guard;

  const spec = getArtworkSpec(formData.get("crop") as string | null);
  if (!spec) return { ok: false, error: "Unknown artwork shape." };

  const targetKind = formData.get("targetKind");
  const targetId = formData.get("targetId");
  if (
    (targetKind !== "item" && targetKind !== "series") ||
    typeof targetId !== "string" ||
    !targetId
  ) {
    return { ok: false, error: "Nothing to attach that image to." };
  }

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: "Choose an image to upload." };
  }
  if (file.size > MAX_ARTWORK_BYTES) {
    return { ok: false, error: "That image is over 12MB. Please pick a smaller one." };
  }

  const num = (key: string) => {
    const raw = formData.get(key);
    const parsed = typeof raw === "string" ? Number(raw) : NaN;
    return Number.isFinite(parsed) ? parsed : null;
  };

  const cx = num("cropX");
  const cy = num("cropY");
  const cw = num("cropWidth");
  const ch = num("cropHeight");
  const crop =
    cx !== null && cy !== null && cw !== null && ch !== null
      ? { x: cx, y: cy, width: cw, height: ch }
      : null;

  const normalized = await normalizeSiteImage(Buffer.from(await file.arrayBuffer()), {
    crop,
    // Always forced, unlike the website's free-form logo case. A shelf lays
    // tiles out on a fixed ratio, so an image that is a few pixels off the
    // aspect leaves a hairline gap in a row of them.
    output: spec.output,
  });

  if (!normalized) {
    return {
      ok: false,
      error: "That file doesn't look like an image we can use. Try a JPG, PNG, or HEIC photo.",
    };
  }

  const name = `${Date.now().toString(36)}-${randomUUID().slice(0, 8)}.${normalized.ext}`;
  const path = artworkStoragePath(guard.churchId, spec.key, name);
  const admin = createAdminClient();

  const { error: uploadError } = await admin.storage
    .from(ARTWORK_BUCKET)
    .upload(path, normalized.buffer, {
      contentType: normalized.contentType,
      upsert: false,
    });

  if (uploadError) {
    console.error("[media] artwork upload failed:", uploadError.message);
    return { ok: false, error: "That image could not be uploaded. Please try again." };
  }

  const { data } = admin.storage.from(ARTWORK_BUCKET).getPublicUrl(path);
  const url = data.publicUrl;

  const written =
    targetKind === "series"
      ? await setMediaSeriesArtwork(guard.churchId, targetId, spec.column, url)
      : await updateMediaItem(guard.churchId, targetId, {
          artwork: { column: spec.column, url },
        });

  if (!written.ok) {
    return { ok: false, error: "The image uploaded but could not be saved." };
  }

  revalidate(targetKind === "item" ? targetId : undefined);
  return { ok: true, url };
}

/** Removes one crop. The inheritance chain decides what shows instead. */
export async function clearMediaArtwork(input: {
  target: ArtworkTarget;
  crop: ArtworkCrop;
}): Promise<MediaActionResult> {
  const guard = await requireAdmin();
  if (!guard.ok) return guard;

  const spec = getArtworkSpec(input.crop);
  if (!spec) return { ok: false, error: "Unknown artwork shape." };

  const written =
    input.target.kind === "series"
      ? await setMediaSeriesArtwork(guard.churchId, input.target.id, spec.column, null)
      : await updateMediaItem(guard.churchId, input.target.id, {
          artwork: { column: spec.column, url: null },
        });

  if (!written.ok) return { ok: false, error: written.error ?? "Could not save." };

  revalidate(input.target.kind === "item" ? input.target.id : undefined);
  return { ok: true };
}

export type ApplySeriesArtworkResult =
  | { ok: true; count: number }
  | { ok: false; error: string };

/**
 * Makes the series image the one every item in it uses.
 *
 * Implemented by clearing the per-item override rather than copying the series
 * URL onto each row. Copying is what a church would expect and it is the wrong
 * mechanism: it leaves every item stale the next time the series artwork
 * changes, and needs a second pass to undo. Clearing hands the decision back to
 * the inheritance chain permanently, so the next series image is picked up by
 * all of them with no further action.
 */
export async function applySeriesArtworkToItems(input: {
  seriesId: string;
  crop: ArtworkCrop;
}): Promise<ApplySeriesArtworkResult> {
  const guard = await requireAdmin();
  if (!guard.ok) return guard;

  const spec = getArtworkSpec(input.crop);
  if (!spec) return { ok: false, error: "Unknown artwork shape." };

  const result = await clearSeriesItemArtwork(guard.churchId, input.seriesId, spec.column);
  if (!result.ok) {
    return { ok: false, error: result.error ?? "Could not update that series." };
  }

  revalidate();
  return { ok: true, count: result.count };
}
