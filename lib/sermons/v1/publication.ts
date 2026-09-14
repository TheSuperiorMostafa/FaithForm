import type { SupabaseClient } from "@supabase/supabase-js";

import { createAdminClient } from "@/lib/supabase/admin";
import type { MobileVisibility } from "@/lib/media/v1/publication";
import {
  sermonShareReadiness,
  type SermonAudience,
} from "@/lib/sermons/v1/share-rules";

/**
 * Publishing a sermon's notes to the member app.
 *
 * Kept deliberately close to `lib/media/v1/publication.ts` — same visibility
 * ladder, same "bump the version on every change" rule — but much smaller,
 * because a sermon has no file behind it to prove playable. What it does have
 * is a privacy question media does not: the row holds a manuscript and the
 * preacher's own notes, so publishing exposes a *projection*, never the row.
 * The projection lives in SQL (`mobile_sermon_*`, migrations 0068 and 0075).
 */

export type SermonPublicationState =
  | { status: "unpublished" }
  | {
      status: "published";
      visibility: Exclude<MobileVisibility, "none">;
      /** When it first went into the app — an update never moves this. */
      publishedAt: string;
    };

export type SermonPublicationResult =
  | {
      ok: true;
      state: SermonPublicationState;
      /** True the first time this sermon became published in the builder. */
      markedPublished?: boolean;
    }
  | { ok: false; error: string };

const AUDIENCES: ReadonlySet<string> = new Set<SermonAudience>([
  "public",
  "followers",
  "members",
]);

function client(supabase?: SupabaseClient) {
  return supabase ?? createAdminClient();
}

type DbError = { code?: string | null; message?: string | null };

/**
 * A pastor reads this, not an engineer.
 *
 * The one failure worth naming is a database that has not run the publication
 * migration: the columns are missing, every share fails, and "column
 * mobile_visibility does not exist" tells a church nothing it can act on.
 */
export function humanPublicationError(error: DbError): string {
  const message = error.message ?? "";
  // 42703 is Postgres's undefined column; PGRST204 is PostgREST's "could not
  // find the column in the schema cache". The text checks cover a proxy that
  // passes the message through without the code.
  const missingColumn =
    error.code === "42703" ||
    error.code === "PGRST204" ||
    /column \S*mobile_\w+ does not exist|could not find the 'mobile_\w+' column/i.test(message);
  if (missingColumn) {
    return "Sharing in the FaithForm app isn't set up for your church yet. Please contact FaithForm support.";
  }
  return "We couldn't update the FaithForm app just now. Please try again.";
}

function logDbError(where: string, error: DbError) {
  console.error(`[sermons/publication] ${where}:`, error.code ?? "", error.message ?? "");
}

/**
 * Shares a sermon's notes in the app, or updates how it is shared.
 *
 * Sharing *is* the publish decision: a sermon shared with a congregation is
 * published, so the builder's own status follows rather than being a second
 * gate a pastor has no button for. The first time a sermon goes into the app is
 * kept on every later update — the version rises instead — so re-saving the
 * audience or summary cannot move a sermon in anyone's history.
 */
export async function publishSermonToFaithForm(
  input: {
    churchId: string;
    sermonId: string;
    visibility: Exclude<MobileVisibility, "none">;
    summary?: string | null;
    preachedOn?: string | null;
  },
  supabase?: SupabaseClient,
): Promise<SermonPublicationResult> {
  if (!AUDIENCES.has(input.visibility)) {
    return { ok: false, error: "Choose who can read this sermon." };
  }
  const preachedOn = input.preachedOn?.trim() || null;
  if (preachedOn && !/^\d{4}-\d{2}-\d{2}$/.test(preachedOn)) {
    return { ok: false, error: "Enter the date it was preached as a full date." };
  }

  const db = client(supabase);

  // The tenant predicate is on the statement, not applied afterwards: a sermon
  // id from another church matches nothing rather than being published by a
  // guess.
  const { data: existing, error: readError } = await db
    .from("sermons")
    .select(
      "id, title, scripture_refs, outline, status, published_at, mobile_published_at, mobile_publication_version",
    )
    .eq("id", input.sermonId)
    .eq("church_id", input.churchId)
    .maybeSingle();

  if (readError) {
    logDbError("read before share", readError);
    return { ok: false, error: humanPublicationError(readError) };
  }
  if (!existing) return { ok: false, error: "Sermon not found." };

  const readiness = sermonShareReadiness(existing);
  if (!readiness.ready) {
    return { ok: false, error: `${readiness.title}. ${readiness.message}` };
  }

  const now = new Date().toISOString();
  const publishedAt = (existing.mobile_published_at as string | null) ?? now;
  const markedPublished = existing.status !== "published";

  const patch: Record<string, unknown> = {
    mobile_visibility: input.visibility,
    mobile_published_at: publishedAt,
    // Clearing this is what re-publishing means; leaving it set would keep
    // the sermon filtered out of every projection.
    mobile_unpublished_at: null,
    mobile_summary: input.summary?.trim() || null,
    mobile_preached_on: preachedOn,
    mobile_publication_version:
      Number(existing.mobile_publication_version ?? 1) + 1,
    updated_at: now,
  };
  if (markedPublished) {
    patch.status = "published";
    patch.published_at = (existing.published_at as string | null) ?? now;
  }

  const { error } = await db
    .from("sermons")
    .update(patch)
    .eq("id", input.sermonId)
    .eq("church_id", input.churchId);

  if (error) {
    logDbError("share", error);
    return { ok: false, error: humanPublicationError(error) };
  }

  return {
    ok: true,
    markedPublished,
    state: { status: "published", visibility: input.visibility, publishedAt },
  };
}

/**
 * Takes a sermon back out of the app.
 *
 * `mobile_unpublished_at` is set *and* visibility returns to 'none': either
 * alone would hide it, and setting both means a future change to one filter
 * cannot quietly resurrect it. The builder status is left alone — the sermon
 * was still preached.
 */
export async function unpublishSermonFromFaithForm(
  input: { churchId: string; sermonId: string },
  supabase?: SupabaseClient,
): Promise<SermonPublicationResult> {
  const db = client(supabase);

  const { data: existing, error: readError } = await db
    .from("sermons")
    .select("id, mobile_publication_version")
    .eq("id", input.sermonId)
    .eq("church_id", input.churchId)
    .maybeSingle();

  if (readError) {
    logDbError("read before unshare", readError);
    return { ok: false, error: humanPublicationError(readError) };
  }
  if (!existing) return { ok: false, error: "Sermon not found." };

  const now = new Date().toISOString();
  const { error } = await db
    .from("sermons")
    .update({
      mobile_visibility: "none",
      mobile_unpublished_at: now,
      mobile_publication_version:
        Number(existing.mobile_publication_version ?? 1) + 1,
      updated_at: now,
    })
    .eq("id", input.sermonId)
    .eq("church_id", input.churchId);

  if (error) {
    logDbError("unshare", error);
    return { ok: false, error: humanPublicationError(error) };
  }
  return { ok: true, state: { status: "unpublished" } };
}
