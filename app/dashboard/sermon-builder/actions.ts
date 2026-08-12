"use server";

import { revalidatePath } from "next/cache";
import { getChapterForTranslation } from "@/lib/bible/chapter";
import { getBooks } from "@/lib/bible/api";
import { getBooksTranslationId } from "@/lib/bible/translations";
import type { TranslationBookChapter, TranslationBooks } from "@/lib/bible/types";
import { requireChurchAuth } from "@/lib/auth/church";
import { featureActionError } from "@/lib/features/guard";
import {
  deleteSeries,
  deleteSermon,
  verifySeriesAccess,
  verifySermonAccess,
} from "@/lib/queries/sermons";
import { createClient } from "@/lib/supabase/server";

/**
 * A "use server" export is a public POST endpoint, not an internal function.
 * These two read from an upstream Bible API on our key, so without a gate they
 * are an open proxy for anyone who can find the action id.
 */
export async function fetchBooksAction(
  translation: string,
): Promise<TranslationBooks> {
  const denied = await featureActionError("sermon_builder");
  if (denied) throw new Error(denied);

  return getBooks(getBooksTranslationId(translation));
}

export async function fetchChapterAction(
  translation: string,
  book: string,
  chapter: number,
): Promise<TranslationBookChapter> {
  const denied = await featureActionError("sermon_builder");
  if (denied) throw new Error(denied);

  return getChapterForTranslation(translation, book, chapter);
}

export async function deleteSermonAction(
  sermonId: string,
): Promise<{ error?: string }> {
  try {
    const auth = await requireChurchAuth();

    const denied = await featureActionError("sermon_builder");
    if (denied) return { error: denied };

    const supabase = createClient();
    const sermon = await verifySermonAccess(supabase, sermonId, auth.churchId);
    if (!sermon) {
      return { error: "Sermon not found" };
    }
    if (sermon.status !== "draft") {
      return { error: "Only draft sermons can be deleted" };
    }

    await deleteSermon(sermonId);
    revalidatePath("/dashboard/sermon-builder");
    return {};
  } catch (e) {
    return {
      error: e instanceof Error ? e.message : "Could not delete sermon",
    };
  }
}

export async function deleteSeriesAction(
  seriesId: string,
): Promise<{ error?: string }> {
  try {
    const auth = await requireChurchAuth();

    const denied = await featureActionError("sermon_builder");
    if (denied) return { error: denied };

    const supabase = createClient();
    const series = await verifySeriesAccess(supabase, seriesId, auth.churchId);
    if (!series) {
      return { error: "Series not found" };
    }

    await deleteSeries(seriesId);
    revalidatePath("/dashboard/sermon-builder");
    return {};
  } catch (e) {
    return {
      error: e instanceof Error ? e.message : "Could not delete series",
    };
  }
}
