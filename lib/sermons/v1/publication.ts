import type { SupabaseClient } from "@supabase/supabase-js";

import { createAdminClient } from "@/lib/supabase/admin";
import type { MobileVisibility } from "@/lib/media/v1/publication";

/**
 * Publishing a sermon's notes to the member app.
 *
 * Kept deliberately close to `lib/media/v1/publication.ts` — same visibility
 * ladder, same "bump the version on every change" rule — but much smaller,
 * because a sermon has no file behind it to prove playable. What it does have
 * is a privacy question media does not: the row holds a manuscript and the
 * preacher's own notes, so publishing exposes a *projection*, never the row.
 * The projection lives in SQL (`mobile_sermon_*`, migration 0068).
 */

export type SermonPublicationState =
  | { status: "unpublished" }
  | { status: "published"; visibility: Exclude<MobileVisibility, "none">; publishedAt: string };

export type SermonPublicationResult =
  | { ok: true; state: SermonPublicationState }
  | { ok: false; error: string };

function client(supabase?: SupabaseClient) {
  return supabase ?? createAdminClient();
}

/**
 * A sermon is publishable only once it is finished.
 *
 * A draft is a work in progress by definition, and the builder's own status
 * field already says so — there is no second notion of "ready" to invent here.
 */
export async function publishSermonToFaithful(
  input: {
    churchId: string;
    sermonId: string;
    visibility: Exclude<MobileVisibility, "none">;
    summary?: string | null;
    preachedOn?: string | null;
  },
  supabase?: SupabaseClient,
): Promise<SermonPublicationResult> {
  const db = client(supabase);

  // The tenant predicate is on the statement, not applied afterwards: a sermon
  // id from another church matches nothing rather than being published by a
  // guess.
  const { data: existing } = await db
    .from("sermons")
    .select("id, status, mobile_visibility, mobile_publication_version")
    .eq("id", input.sermonId)
    .eq("church_id", input.churchId)
    .maybeSingle();

  if (!existing) return { ok: false, error: "Sermon not found." };
  if (existing.status !== "published") {
    return {
      ok: false,
      error: "Finish the sermon before sharing it in the app.",
    };
  }

  const publishedAt = new Date().toISOString();
  const { error } = await db
    .from("sermons")
    .update({
      mobile_visibility: input.visibility,
      mobile_published_at: publishedAt,
      // Clearing this is what re-publishing means; leaving it set would keep
      // the sermon filtered out of every projection.
      mobile_unpublished_at: null,
      mobile_summary: input.summary?.trim() || null,
      mobile_preached_on: input.preachedOn || null,
      mobile_publication_version:
        Number(existing.mobile_publication_version ?? 1) + 1,
      updated_at: publishedAt,
    })
    .eq("id", input.sermonId)
    .eq("church_id", input.churchId);

  if (error) return { ok: false, error: error.message };

  return {
    ok: true,
    state: { status: "published", visibility: input.visibility, publishedAt },
  };
}

/**
 * Takes a sermon back out of the app.
 *
 * `mobile_unpublished_at` is set *and* visibility returns to 'none': either
 * alone would hide it, and setting both means a future change to one filter
 * cannot quietly resurrect it.
 */
export async function unpublishSermonFromFaithful(
  input: { churchId: string; sermonId: string },
  supabase?: SupabaseClient,
): Promise<SermonPublicationResult> {
  const db = client(supabase);

  const { data: existing } = await db
    .from("sermons")
    .select("id, mobile_publication_version")
    .eq("id", input.sermonId)
    .eq("church_id", input.churchId)
    .maybeSingle();

  if (!existing) return { ok: false, error: "Sermon not found." };

  const { error } = await db
    .from("sermons")
    .update({
      mobile_visibility: "none",
      mobile_unpublished_at: new Date().toISOString(),
      mobile_publication_version:
        Number(existing.mobile_publication_version ?? 1) + 1,
      updated_at: new Date().toISOString(),
    })
    .eq("id", input.sermonId)
    .eq("church_id", input.churchId);

  if (error) return { ok: false, error: error.message };
  return { ok: true, state: { status: "unpublished" } };
}
