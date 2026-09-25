"use server";

import { revalidatePath } from "next/cache";
import { logActivity } from "@/lib/activity/log";
import { getChapterForTranslation } from "@/lib/bible/chapter";
import { getBooks } from "@/lib/bible/api";
import { getBooksTranslationId } from "@/lib/bible/translations";
import type { TranslationBookChapter, TranslationBooks } from "@/lib/bible/types";
import { requireChurchAuth } from "@/lib/auth/church";
import { toUserError } from "@/lib/errors/user-error";
import { featureActionError } from "@/lib/features/guard";
import {
  deleteSeries,
  deleteSermon,
  verifySeriesAccess,
  verifySermonAccess,
} from "@/lib/queries/sermons";
import {
  buildPresentSlides,
  type PresentSlides,
} from "@/lib/sermon-builder/present-slides";
import {
  getActivePresentationVersion,
  publishPresentationToFaithForm,
  unpublishPresentationFromFaithForm,
} from "@/lib/sermons/v1/presentation";
import {
  publishSermonToFaithForm,
  unpublishSermonFromFaithForm,
} from "@/lib/sermons/v1/publication";
import { isSermonShared, ONLY_ADMINS_CAN_SHARE } from "@/lib/sermons/v1/share-rules";
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
      return { error: "We couldn't find that sermon. It may already have been deleted." };
    }
    if (sermon.status !== "draft") {
      // A sermon that has been in the app is a publishing record, so only an
      // admin (the people who can publish) may delete it, and only once it is
      // out of the app: deleting never silently pulls something off members'
      // phones. Its earlier slide versions go with it (on delete cascade).
      if (!auth.isAdmin) {
        return { error: "Only church admins can delete a sermon that was published to the app." };
      }
      const presentation = await getActivePresentationVersion({
        churchId: auth.churchId,
        sermonId,
      });
      if (isSermonShared(sermon) || presentation) {
        return { error: "This sermon is still in the app. Remove it from the app first, then delete it." };
      }
    }

    await deleteSermon(sermonId);
    revalidatePath("/dashboard/sermon-builder");
    return {};
  } catch (e) {
    return { error: toUserError(e, "We couldn't delete this sermon.") };
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
      return { error: "We couldn't find that series. It may already have been deleted." };
    }

    await deleteSeries(seriesId);
    revalidatePath("/dashboard/sermon-builder");
    return {};
  } catch (e) {
    return { error: toUserError(e, "We couldn't delete this series.") };
  }
}

/**
 * The slides for Present mode, built from the same page model as the app and
 * the PowerPoint export. Read-only, but it looks scripture up on our key, so it
 * carries the same feature gate as the Bible lookups above.
 */
export async function getSermonSlidesAction(
  sermonId: string,
): Promise<
  | { ok: true; slides: PresentSlides }
  | { ok: false; error: string }
> {
  try {
    const auth = await requireChurchAuth();

    const denied = await featureActionError("sermon_builder");
    if (denied) return { ok: false, error: denied };

    const supabase = createClient();
    const sermon = await verifySermonAccess(supabase, sermonId, auth.churchId);
    if (!sermon) {
      return { ok: false, error: "We couldn't find that sermon. Refresh the page and try again." };
    }

    return { ok: true, slides: await buildPresentSlides(sermon) };
  } catch (e) {
    return { ok: false, error: toUserError(e, "We couldn't load the slides.") };
  }
}

const SERMON_NOT_FOUND =
  "We couldn't find that sermon. Refresh the page and try again.";

const APP_UPDATE_FAILED =
  "We couldn't update the app just now. Please try again.";

const MEMBER_APP_OFF =
  "The app is switched off for your church, so nothing can be published there. Turn it on in Settings, or contact FaithForm support.";

/**
 * Shares a sermon's notes in the FaithForm app, or updates how it is shared.
 *
 * Church admins only, and deliberately not the sermon's own author: putting
 * something in front of a congregation is a publishing decision, not an
 * authoring one. What members see is a projection — the outline and the
 * discussion questions — never the manuscript or the preacher's style notes.
 * Sharing is also what marks the sermon published in the builder.
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
      return { error: ONLY_ADMINS_CAN_SHARE };
    }

    const denied = await featureActionError("sermon_builder");
    if (denied) return { error: denied };

    const appDenied = await featureActionError("member_app");
    if (appDenied) return { error: MEMBER_APP_OFF };

    const supabase = createClient();
    const sermon = await verifySermonAccess(supabase, input.sermonId, auth.churchId);
    if (!sermon) return { error: SERMON_NOT_FOUND };

    const result = await publishSermonToFaithForm({
      churchId: auth.churchId,
      sermonId: input.sermonId,
      visibility: input.visibility,
      summary: input.summary ?? null,
      preachedOn: input.preachedOn ?? null,
    });

    if (!result.ok) return { error: result.error };

    if (result.markedPublished) {
      // The same entry `updateSermon` writes for "Mark published", so the
      // activity feed and hours saved count a shared sermon exactly once.
      await logActivity({
        churchId: auth.churchId,
        automationType: "Sermon Published",
        taskName: sermon.title,
        triggerSource: `sermon_module:publish:${input.sermonId}`,
      });
    }

    revalidatePath("/dashboard/sermon-builder");
    revalidatePath(`/dashboard/sermon-builder/${input.sermonId}`);
    return {
      publishedAt:
        result.state.status === "published" ? result.state.publishedAt : undefined,
    };
  } catch (e) {
    console.error("[sermon-builder] share failed", e);
    return { error: APP_UPDATE_FAILED };
  }
}

/**
 * Takes a sermon back out of the FaithForm app.
 *
 * Not gated on the Sermon Builder feature. Removing something from a
 * congregation's phones only ever reduces what is exposed, and an account whose
 * feature was switched off is exactly the one that must still be able to. (The
 * mobile service also stops serving sermon notes while the feature is off —
 * the two are independent on purpose.)
 */
export async function unshareSermonInAppAction(
  sermonId: string,
): Promise<{ error?: string }> {
  try {
    const auth = await requireChurchAuth();
    if (!auth.isAdmin) {
      return { error: ONLY_ADMINS_CAN_SHARE };
    }

    const supabase = createClient();
    const sermon = await verifySermonAccess(supabase, sermonId, auth.churchId);
    if (!sermon) return { error: SERMON_NOT_FOUND };

    const result = await unpublishSermonFromFaithForm({
      churchId: auth.churchId,
      sermonId,
    });
    if (!result.ok) return { error: result.error };

    revalidatePath("/dashboard/sermon-builder");
    revalidatePath(`/dashboard/sermon-builder/${sermonId}`);
    return {};
  } catch (e) {
    console.error("[sermon-builder] unshare failed", e);
    return { error: APP_UPDATE_FAILED };
  }
}

/**
 * Publishes an immutable slide deck version to the FaithForm app.
 *
 * Requires Sermon Builder and Member App. Re-publishing inserts a new version
 * and retires the previous one — drafts never mutate a published snapshot.
 */
export async function sharePresentationInAppAction(input: {
  sermonId: string;
  visibility: "public" | "followers" | "members";
}): Promise<{ error?: string; presentationId?: string; version?: number }> {
  try {
    const auth = await requireChurchAuth();
    if (!auth.isAdmin) {
      return { error: ONLY_ADMINS_CAN_SHARE };
    }

    const denied = await featureActionError("sermon_builder");
    if (denied) return { error: denied };

    const appDenied = await featureActionError("member_app");
    if (appDenied) return { error: MEMBER_APP_OFF };

    const supabase = createClient();
    const sermon = await verifySermonAccess(supabase, input.sermonId, auth.churchId);
    if (!sermon) return { error: SERMON_NOT_FOUND };

    const result = await publishPresentationToFaithForm({
      churchId: auth.churchId,
      sermonId: input.sermonId,
      visibility: input.visibility,
    });

    if (!result.ok) return { error: result.error };

    if (result.markedPublished) {
      await logActivity({
        churchId: auth.churchId,
        automationType: "Sermon Published",
        taskName: sermon.title,
        triggerSource: `sermon_module:publish:${input.sermonId}`,
      });
    }

    revalidatePath("/dashboard/sermon-builder");
    revalidatePath(`/dashboard/sermon-builder/${input.sermonId}`);
    return {
      presentationId:
        result.state.status === "published"
          ? result.state.presentationId
          : undefined,
      version:
        result.state.status === "published" ? result.state.version : undefined,
    };
  } catch (e) {
    console.error("[sermon-builder] presentation share failed", e);
    return { error: APP_UPDATE_FAILED };
  }
}

/**
 * Removes published slides from the app. Not gated on feature flags — taking
 * content down must always remain possible.
 */
export async function unsharePresentationInAppAction(
  sermonId: string,
): Promise<{ error?: string }> {
  try {
    const auth = await requireChurchAuth();
    if (!auth.isAdmin) {
      return { error: ONLY_ADMINS_CAN_SHARE };
    }

    const supabase = createClient();
    const sermon = await verifySermonAccess(supabase, sermonId, auth.churchId);
    if (!sermon) return { error: SERMON_NOT_FOUND };

    const result = await unpublishPresentationFromFaithForm({
      churchId: auth.churchId,
      sermonId,
    });
    if (!result.ok) return { error: result.error };

    revalidatePath("/dashboard/sermon-builder");
    revalidatePath(`/dashboard/sermon-builder/${sermonId}`);
    return {};
  } catch (e) {
    console.error("[sermon-builder] presentation unshare failed", e);
    return { error: APP_UPDATE_FAILED };
  }
}
