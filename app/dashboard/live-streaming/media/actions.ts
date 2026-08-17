"use server";

import { revalidatePath } from "next/cache";

import { getChurchAuth } from "@/lib/auth/church";
import { featureActionError } from "@/lib/features/guard";
import {
  ensureMediaSeries,
  updateMediaItem,
  type MediaVisibility,
} from "@/lib/stream/media-library";
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

function revalidate(recordingId: string) {
  revalidatePath("/dashboard/live-streaming/media");
  revalidatePath(`/dashboard/live-streaming/media/${recordingId}`);
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
