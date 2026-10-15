import { UPLOAD_BUDGET_BYTES } from "@/lib/sites/downscale-image";
import { randomUUID } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ARTWORK_BUCKET, ARTWORK_CROPS, ARTWORK_SPECS, artworkStoragePath } from "@/lib/media/artwork";
import { normalizeSiteImage } from "@/lib/security/validate-image";
import { ensureMediaSeries } from "@/lib/stream/media-library";

import { readScheduledDetails, ScheduledDetailsError } from "@/lib/stream/scheduled-details-input";

/** Only accepts local uploads, normalizing the same crops used by recordings. */
export async function scheduledDetailsPatch(form: FormData, churchId: string, db: SupabaseClient) {
  const details = readScheduledDetails(form);
  let seriesId = details.seriesId;
  if (seriesId && seriesId !== "__new__") {
    const { data, error } = await db.from("media_series").select("id")
      .eq("id", seriesId).eq("church_id", churchId).maybeSingle();
    if (error || !data) throw new ScheduledDetailsError("Choose a series belonging to this church.");
  }

  const artwork: {
    artworkUrl?: string | null;
    artworkPosterUrl?: string | null;
    artworkWideUrl?: string | null;
    artworkBannerUrl?: string | null;
  } = {};
  const file = form.get("artwork");
  if (file instanceof File && file.size > 0) {
    if (file.size > UPLOAD_BUDGET_BYTES) throw new ScheduledDetailsError("Choose a smaller image (under 3.4MB after resizing).");
    const source = Buffer.from(await file.arrayBuffer());
    // Decode all shapes before storing anything so invalid images leave no objects.
    const normalized = await Promise.all(ARTWORK_CROPS.map(async (crop) => {
      const image = await normalizeSiteImage(source, { output: ARTWORK_SPECS[crop].output });
      if (!image) throw new ScheduledDetailsError("Choose a JPG, PNG, or another supported image.");
      return { crop, image };
    }));
    for (const { crop, image } of normalized) {
      const path = artworkStoragePath(churchId, crop, `${randomUUID()}.${image.ext}`);
      const { error } = await db.storage.from(ARTWORK_BUCKET).upload(path, image.buffer, {
        contentType: image.contentType, upsert: false,
      });
      if (error) throw new ScheduledDetailsError("That image could not be uploaded. Please try again.");
      const { data } = db.storage.from(ARTWORK_BUCKET).getPublicUrl(path);
      if (crop === "poster") artwork.artworkPosterUrl = data.publicUrl;
      if (crop === "wide") artwork.artworkUrl = artwork.artworkWideUrl = data.publicUrl;
      if (crop === "banner") artwork.artworkBannerUrl = data.publicUrl;
    }
  } else if (form.get("remove_artwork") === "on") {
    artwork.artworkUrl = artwork.artworkPosterUrl = artwork.artworkWideUrl = artwork.artworkBannerUrl = null;
  }

  if (seriesId === "__new__") {
    const series = await ensureMediaSeries(churchId, details.newSeriesName, db);
    if (!series) throw new ScheduledDetailsError("We couldn't create that series. Please try again.");
    seriesId = series.id;
  }
  return { title: details.title, seriesId, ...artwork };
}
