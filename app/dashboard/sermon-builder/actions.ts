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
import {
  publishSermonToFaithful,
  unpublishSermonFromFaithful,
} from "@/lib/sermons/v1/publication";
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

/**
 * Shares a finished sermon's notes in the member app.
 *
 * Church admins only, and deliberately not the sermon's own author: putting
 * something in front of a congregation is a publishing decision, not an
 * authoring one. What members see is a projection — the outline and the
 * discussion questions — never the manuscript or the preacher's style notes.
 */
export async function shareSermonInAppAction(input: {
  sermonId: string;
  visibility: "public" | "followers" | "members";
  summary?: string | null;
  preachedOn?: string | null;
}): Promise<{ error?: string; publishedAt?: string }> {
  try {
    const auth = await requireChurchAuth();
    if (!auth.isAdmin) {
      return { error: "Only church admins can share sermons in the app." };
    }

    const denied = await featureActionError("sermon_builder");
    if (denied) return { error: denied };

    const supabase = createClient();
    const sermon = await verifySermonAccess(supabase, input.sermonId, auth.churchId);
    if (!sermon) return { error: "Sermon not found" };

    const result = await publishSermonToFaithful({
      churchId: auth.churchId,
      sermonId: input.sermonId,
      visibility: input.visibility,
      summary: input.summary ?? null,
      preachedOn: input.preachedOn ?? null,
    });

    if (!result.ok) return { error: result.error };

    revalidatePath("/dashboard/sermon-builder");
    revalidatePath(`/dashboard/sermon-builder/${input.sermonId}`);
    return {
      publishedAt:
        result.state.status === "published" ? result.state.publishedAt : undefined,
    };
  } catch (e) {
    return {
      error: e instanceof Error ? e.message : "Could not share the sermon",
    };
  }
}

/** Takes a sermon back out of the member app. */
export async function unshareSermonInAppAction(
  sermonId: string,
): Promise<{ error?: string }> {
  try {
    const auth = await requireChurchAuth();
    if (!auth.isAdmin) {
      return { error: "Only church admins can change what the app shows." };
    }

    const denied = await featureActionError("sermon_builder");
    if (denied) return { error: denied };

    const supabase = createClient();
    const sermon = await verifySermonAccess(supabase, sermonId, auth.churchId);
    if (!sermon) return { error: "Sermon not found" };

    const result = await unpublishSermonFromFaithful({
      churchId: auth.churchId,
      sermonId,
    });
    if (!result.ok) return { error: result.error };

    revalidatePath("/dashboard/sermon-builder");
    revalidatePath(`/dashboard/sermon-builder/${sermonId}`);
    return {};
  } catch (e) {
    return {
      error: e instanceof Error ? e.message : "Could not update the sermon",
    };
  }
}
