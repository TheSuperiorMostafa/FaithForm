"use server";

import { randomUUID } from "crypto";
import { revalidatePath } from "next/cache";

import { getChurchAuth } from "@/lib/auth/church";
import { featureActionError } from "@/lib/features/guard";
import {
  ARTWORK_BUCKET,
  ARTWORK_CROPS,
  ARTWORK_SPECS,
  artworkStoragePath,
  getArtworkSpec,
  type ArtworkCrop,
  type ArtworkSpec,
} from "@/lib/media/artwork";
import { generateEventBackgroundImage, isAiImageConfigured } from "@/lib/ai/image";
import {
  listChurchImageLibrary,
  listStockImages,
  readPickedImage,
  type LibraryImage,
  type StockImage,
} from "@/lib/media/image-library";
import { toUserError } from "@/lib/errors/user-error";
import { normalizeSiteImage } from "@/lib/security/validate-image";
import {
  clearSeriesItemArtwork,
  setMediaSeriesArtwork,
  updateMediaItem,
} from "@/lib/stream/media-library";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { requireScheduledArtworkTarget, setScheduledArtwork } from "@/lib/stream/scheduled-artwork";

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
  revalidatePath("/dashboard/live-streaming/recordings");
  if (recordingId) {
    revalidatePath(`/dashboard/live-streaming/recordings/${recordingId}`);
  }
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
  | { kind: "series"; id: string }
  | { kind: "service"; id: string };

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
  if (!spec) return { ok: false, error: "Choose one of the artwork shapes shown." };

  const targetKind = formData.get("targetKind");
  const targetId = formData.get("targetId");
  if (
    (targetKind !== "item" && targetKind !== "series" && targetKind !== "service") ||
    typeof targetId !== "string" ||
    !targetId
  ) {
    return { ok: false, error: "Nothing to attach that image to." };
  }

  const admin = createAdminClient();
  if (targetKind === "service") {
    try {
      await requireScheduledArtworkTarget(guard.churchId, targetId, admin);
    } catch (error) {
      return { ok: false, error: toUserError(error, "We couldn't check that upcoming service.") };
    }
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

  const source = Buffer.from(await file.arrayBuffer());
  const stored = await storeArtworkCrop(admin, guard.churchId, { kind: targetKind, id: targetId }, spec, source, crop);
  if (!stored.ok) return stored;

  // "Apply this image to all sizes": the other shapes are cut from the same
  // photo, centred, so one upload fills the tile, the wide still and the banner.
  if (formData.get("applyAll") === "1") {
    for (const other of ARTWORK_CROPS) {
      if (other === spec.key) continue;
      const result = await storeArtworkCrop(
        admin, guard.churchId, { kind: targetKind, id: targetId }, ARTWORK_SPECS[other], source, null,
      );
      if (!result.ok) return { ok: false, error: `The ${spec.label.toLowerCase()} image was saved, but the other sizes weren't. ${result.error}` };
    }
  }

  revalidateArtworkTarget({ kind: targetKind, id: targetId });
  return { ok: true, url: stored.url };
}

function revalidateArtworkTarget(target: ArtworkTarget) {
  revalidate(target.kind === "item" ? target.id : undefined);
  if (target.kind === "service") revalidateUpcomingArtwork(target.id);
}

/**
 * Cuts one shape from a source image, stores it and points the target at it.
 * `crop` is the cropper's rectangle in source pixels; null centres the cut.
 */
async function storeArtworkCrop(
  admin: ReturnType<typeof createAdminClient>,
  churchId: string,
  target: ArtworkTarget,
  spec: ArtworkSpec,
  source: Buffer,
  crop: { x: number; y: number; width: number; height: number } | null,
): Promise<ArtworkUploadResult> {
  const normalized = await normalizeSiteImage(source, {
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
  const path = artworkStoragePath(churchId, spec.key, name);

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
    target.kind === "service"
      ? await setScheduledArtwork(churchId, target.id, spec.key, url, admin)
      : target.kind === "series"
      ? await setMediaSeriesArtwork(churchId, target.id, spec.column, url)
      : await updateMediaItem(churchId, target.id, {
          artwork: { column: spec.column, url },
        });

  if (!written.ok) {
    return { ok: false, error: "The image uploaded but could not be saved." };
  }
  return { ok: true, url };
}

async function requireArtworkTarget(
  churchId: string,
  target: ArtworkTarget,
  admin: ReturnType<typeof createAdminClient>,
): Promise<string | null> {
  if (
    !target ||
    (target.kind !== "item" && target.kind !== "series" && target.kind !== "service") ||
    typeof target.id !== "string" ||
    !target.id
  ) {
    return "Nothing to attach that image to.";
  }
  if (target.kind === "service") {
    try {
      await requireScheduledArtworkTarget(churchId, target.id, admin);
    } catch (error) {
      return toUserError(error, "We couldn't check that upcoming service.");
    }
  }
  return null;
}

export type ArtworkLibraryResult =
  | { ok: true; data: { library: LibraryImage[]; stock: StockImage[] } }
  | { ok: false; error: string };

/** The church's earlier pictures and FaithForm's stock pictures, for the artwork picker. */
export async function listArtworkLibrary(): Promise<ArtworkLibraryResult> {
  const guard = await requireAdmin();
  if (!guard.ok) return guard;
  try {
    const [library, stock] = await Promise.all([
      listChurchImageLibrary(createAdminClient(), guard.churchId),
      listStockImages(),
    ]);
    return { ok: true, data: { library, stock } };
  } catch (error) {
    return { ok: false, error: toUserError(error, "Your pictures couldn't be loaded.") };
  }
}

/**
 * Uses a library or stock picture as artwork: one shape, or every shape when
 * `applyAll` is set. Each shape is cut centred from the picture.
 */
export async function setArtworkFromLibrary(input: {
  target: ArtworkTarget;
  crop: ArtworkCrop;
  pick: { kind: "library" | "stock"; id: string };
  applyAll?: boolean;
}): Promise<ArtworkUploadResult> {
  const guard = await requireAdmin();
  if (!guard.ok) return guard;

  const spec = getArtworkSpec(input.crop);
  if (!spec) return { ok: false, error: "Choose one of the artwork shapes shown." };
  if (input.pick?.kind !== "library" && input.pick?.kind !== "stock") {
    return { ok: false, error: "Choose a picture." };
  }

  const admin = createAdminClient();
  const targetError = await requireArtworkTarget(guard.churchId, input.target, admin);
  if (targetError) return { ok: false, error: targetError };

  const picked = await readPickedImage(admin, guard.churchId, { kind: input.pick.kind, id: String(input.pick.id ?? "") });
  if (!picked.ok) return picked;

  return storeShapes(admin, guard.churchId, input.target, spec, picked.bytes, Boolean(input.applyAll));
}

async function storeShapes(
  admin: ReturnType<typeof createAdminClient>,
  churchId: string,
  target: ArtworkTarget,
  first: ArtworkSpec,
  source: Buffer,
  applyAll: boolean,
): Promise<ArtworkUploadResult> {
  const stored = await storeArtworkCrop(admin, churchId, target, first, source, null);
  if (!stored.ok) return stored;
  if (applyAll) {
    for (const other of ARTWORK_CROPS) {
      if (other === first.key) continue;
      const result = await storeArtworkCrop(admin, churchId, target, ARTWORK_SPECS[other], source, null);
      if (!result.ok) return result;
    }
  }
  revalidateArtworkTarget(target);
  return stored;
}

/**
 * "Create one for me": a fresh background picture made from the title, used
 * for every artwork shape. No words are drawn into it, so each crop stays
 * clean however it is cut.
 */
export async function createArtworkForMe(input: {
  target: ArtworkTarget;
  title: string;
}): Promise<ArtworkUploadResult> {
  const guard = await requireAdmin();
  if (!guard.ok) return guard;

  const admin = createAdminClient();
  const targetError = await requireArtworkTarget(guard.churchId, input.target, admin);
  if (targetError) return { ok: false, error: targetError };

  if (!isAiImageConfigured()) {
    return { ok: false, error: "Making artwork isn't available right now. Upload a picture or choose a stock one instead." };
  }

  const title = String(input.title ?? "").trim().slice(0, 120) || "Sunday message";
  const { data: church } = await admin
    .from("churches")
    .select("name, giving_primary_color")
    .eq("id", guard.churchId)
    .maybeSingle();

  let bytes: Buffer;
  try {
    const generated = await generateEventBackgroundImage({
      title,
      headline: title,
      backgroundTag: "worship",
      imageSubject: null,
      churchName: (church?.name as string | undefined) ?? "",
      primaryColor: (church?.giving_primary_color as string | undefined) || "#002D5F",
      mode: "background",
    });
    bytes = Buffer.from(generated.imageBytes);
  } catch (error) {
    console.error("[media] artwork generation failed:", error instanceof Error ? error.message : error);
    return { ok: false, error: "We couldn't make artwork right now. Please try again, or choose a stock picture." };
  }

  return storeShapes(admin, guard.churchId, input.target, ARTWORK_SPECS.wide, bytes, true);
}

/** Removes one crop. The inheritance chain decides what shows instead. */
export async function clearMediaArtwork(input: {
  target: ArtworkTarget;
  crop: ArtworkCrop;
}): Promise<MediaActionResult> {
  const guard = await requireAdmin();
  if (!guard.ok) return guard;

  const spec = getArtworkSpec(input.crop);
  if (!spec) return { ok: false, error: "Choose one of the artwork shapes shown." };

  const written =
    input.target.kind === "service"
      ? await setScheduledArtwork(guard.churchId, input.target.id, spec.key, null, createAdminClient())
      : input.target.kind === "series"
      ? await setMediaSeriesArtwork(guard.churchId, input.target.id, spec.column, null)
      : await updateMediaItem(guard.churchId, input.target.id, {
          artwork: { column: spec.column, url: null },
        });

  if (!written.ok) return { ok: false, error: toUserError(written.error, "We couldn't remove that image.") };

  revalidate(input.target.kind === "item" ? input.target.id : undefined);
  if (input.target.kind === "service") revalidateUpcomingArtwork(input.target.id);
  return { ok: true };
}

function revalidateUpcomingArtwork(eventId: string) {
  revalidatePath("/dashboard/live-streaming/upcoming");
  revalidatePath(`/dashboard/live-streaming/upcoming/${eventId}`);
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
  if (!spec) return { ok: false, error: "Choose one of the artwork shapes shown." };

  const result = await clearSeriesItemArtwork(guard.churchId, input.seriesId, spec.column);
  if (!result.ok) {
    return { ok: false, error: toUserError(result.error, "We couldn't update that series.") };
  }

  revalidate();
  return { ok: true, count: result.count };
}
