"use server";

import { revalidatePath } from "next/cache";
import { getBooks, getChapter } from "@/lib/bible/api";
import type { TranslationBookChapter, TranslationBooks } from "@/lib/bible/types";
import { requireChurchAuth } from "@/lib/auth/church";
import { deleteSermon, verifySermonAccess } from "@/lib/queries/sermons";
import { createClient } from "@/lib/supabase/server";

export async function fetchBooksAction(
  translation: string,
): Promise<TranslationBooks> {
  return getBooks(translation);
}

export async function fetchChapterAction(
  translation: string,
  book: string,
  chapter: number,
): Promise<TranslationBookChapter> {
  return getChapter(translation, book, chapter);
}

export async function deleteSermonAction(
  sermonId: string,
): Promise<{ error?: string }> {
  try {
    const auth = await requireChurchAuth();
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
