import type { SupabaseClient } from "@supabase/supabase-js";

import { normalizeTranslationId } from "@/lib/bible/translations";
import type { MobileVisibility } from "@/lib/media/v1/publication";
import { getThemeAsync } from "@/lib/queries/slide-themes";
import { resolveNumberedPassage } from "@/lib/sermon/passages";
import {
  derivePresentationManifest,
  hashPresentationManifest,
  isPresentationShared,
  presentationShareReadiness,
  snapshotTheme,
  type PresentationManifest,
  type PresentationScripturePassage,
  type PresentationScriptureSnapshot,
  type PresentationThemeSnapshot,
  type SimplePassageInput,
} from "@/lib/sermons/v1/presentation-manifest";
import { humanPublicationError } from "@/lib/sermons/v1/publication";
import type { SermonAudience } from "@/lib/sermons/v1/share-rules";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Sermon } from "@/types/sermon";

/**
 * Publishing a sermon's slides to the member app as an immutable version.
 *
 * Each publish inserts a new `sermon_presentation_versions` row. Prior active
 * versions for the same sermon are unpublished — never mutated — so editing the
 * draft cannot change what members already opened (AD-008).
 */

export type PresentationPublicationState =
  | { status: "unpublished" }
  | {
      status: "published";
      visibility: Exclude<MobileVisibility, "none">;
      presentationId: string;
      version: number;
      publishedAt: string;
      contentHash: string;
    };

export type PresentationPublicationResult =
  | {
      ok: true;
      state: PresentationPublicationState;
      markedPublished?: boolean;
    }
  | { ok: false; error: string };

export type ActivePresentationVersion = {
  id: string;
  version: number;
  mobile_visibility: Exclude<MobileVisibility, "none"> | "none";
  published_at: string;
  unpublished_at: string | null;
  content_hash: string;
  page_count: number;
};

const AUDIENCES: ReadonlySet<string> = new Set<SermonAudience>([
  "public",
  "followers",
  "members",
]);

function client(supabase?: SupabaseClient) {
  return supabase ?? createAdminClient();
}

type DbError = { code?: string | null; message?: string | null };

function logDbError(where: string, error: DbError) {
  console.error(`[sermons/presentation] ${where}:`, error.code ?? "", error.message ?? "");
}

function presentationHumanError(error: DbError): string {
  const message = error.message ?? "";
  const missing =
    error.code === "42P01" ||
    error.code === "42703" ||
    error.code === "PGRST204" ||
    error.code === "PGRST202" ||
    /sermon_presentation_versions|relation .* does not exist|could not find the .* column/i.test(
      message,
    );
  if (missing) {
    return "Sharing slides in the FaithForm app isn't set up for your church yet. Please contact FaithForm support.";
  }
  return humanPublicationError(error);
}

async function resolveSimplePassages(
  sermon: Sermon,
): Promise<{
  passages: SimplePassageInput[];
  translation: string;
  scriptureSnapshot: PresentationScriptureSnapshot;
}> {
  const translation = normalizeTranslationId(sermon.translation ?? "KJV") ?? "KJV";
  const refs = (sermon.scripture_refs ?? []).filter(Boolean);
  const passages: SimplePassageInput[] = [];
  const snapshotPassages: PresentationScripturePassage[] = [];
  let translationLabel = translation;

  for (const ref of refs) {
    const resolved = await resolveNumberedPassage(ref, translation);
    if (!resolved.ok) {
      snapshotPassages.push({ ref, text: "" });
      continue;
    }
    translationLabel = resolved.passage.translation;
    passages.push({
      verses: resolved.passage.verses,
      bookName: resolved.passage.bookName,
      chapter: resolved.passage.chapter,
    });
    snapshotPassages.push({
      ref: resolved.passage.ref,
      text: resolved.passage.verses.map((v) => v.plainText).join(" "),
      translation: translationLabel,
    });
  }

  return {
    passages,
    translation: translationLabel,
    scriptureSnapshot: { translation: translationLabel, passages: snapshotPassages },
  };
}

async function resolveAdvancedPassages(
  sermon: Sermon,
): Promise<{
  passages: PresentationScripturePassage[];
  scriptureSnapshot: PresentationScriptureSnapshot | null;
}> {
  // Refs only at publish time: the semantic deck does not need live scripture
  // text to be useful, and fetching would couple publication to an external
  // API. Apps render the reference; a later rendition job can enrich text.
  const refs = (sermon.scripture_refs ?? []).filter(Boolean);
  if (refs.length === 0) {
    return { passages: [], scriptureSnapshot: null };
  }
  const passages = refs.map((ref) => ({ ref, text: "" }));
  return {
    passages,
    scriptureSnapshot: { translation: null, passages },
  };
}

async function buildPublishPayload(sermon: Sermon): Promise<{
  manifest: PresentationManifest;
  contentHash: string;
  themeSnapshot: PresentationThemeSnapshot | null;
  scriptureSnapshot: PresentationScriptureSnapshot | null;
}> {
  const isSimple = (sermon.kind ?? "advanced") === "simple";

  let manifest: PresentationManifest;
  let scriptureSnapshot: PresentationScriptureSnapshot | null = null;

  if (isSimple) {
    const resolved = await resolveSimplePassages(sermon);
    scriptureSnapshot = resolved.scriptureSnapshot;
    manifest = derivePresentationManifest(sermon, {
      simplePassages: resolved.passages,
      translation: resolved.translation,
    });
  } else {
    const resolved = await resolveAdvancedPassages(sermon);
    scriptureSnapshot = resolved.scriptureSnapshot;
    manifest = derivePresentationManifest(sermon, {
      advancedPassages: resolved.passages,
    });
  }

  const themeId = sermon.theme_id ?? (isSimple ? "midnight" : null);
  let themeSnapshot: PresentationThemeSnapshot | null = null;
  if (themeId) {
    try {
      themeSnapshot = snapshotTheme(await getThemeAsync(themeId));
    } catch {
      themeSnapshot = null;
    }
  }

  return {
    manifest,
    contentHash: hashPresentationManifest(manifest),
    themeSnapshot,
    scriptureSnapshot,
  };
}

/** The currently shared version for a sermon, if any. */
export async function getActivePresentationVersion(
  input: { churchId: string; sermonId: string },
  supabase?: SupabaseClient,
): Promise<ActivePresentationVersion | null> {
  const db = client(supabase);
  const { data, error } = await db
    .from("sermon_presentation_versions")
    .select(
      "id, version, mobile_visibility, published_at, unpublished_at, content_hash, manifest",
    )
    .eq("sermon_id", input.sermonId)
    .eq("church_id", input.churchId)
    .neq("mobile_visibility", "none")
    .is("unpublished_at", null)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    // Table missing on an unmigrated DB — treat as nothing shared.
    if (
      error.code === "42P01" ||
      error.code === "PGRST205" ||
      /sermon_presentation_versions/i.test(error.message ?? "")
    ) {
      return null;
    }
    logDbError("read active version", error);
    return null;
  }
  if (!data || !isPresentationShared(data)) return null;

  const pages = (data.manifest as PresentationManifest | null)?.pages;
  return {
    id: data.id as string,
    version: Number(data.version),
    mobile_visibility: data.mobile_visibility as ActivePresentationVersion["mobile_visibility"],
    published_at: data.published_at as string,
    unpublished_at: (data.unpublished_at as string | null) ?? null,
    content_hash: data.content_hash as string,
    page_count: Array.isArray(pages) ? pages.length : 0,
  };
}

/**
 * Publishes slides: inserts a new immutable version and retires any prior
 * active version for the sermon.
 */
export async function publishPresentationToFaithForm(
  input: {
    churchId: string;
    sermonId: string;
    visibility: Exclude<MobileVisibility, "none">;
  },
  supabase?: SupabaseClient,
): Promise<PresentationPublicationResult> {
  if (!AUDIENCES.has(input.visibility)) {
    return { ok: false, error: "Choose who can see these slides." };
  }

  const db = client(supabase);

  const { data: existing, error: readError } = await db
    .from("sermons")
    .select(
      "id, church_id, title, scripture_refs, topic, kind, theme_id, translation, content, outline, status, published_at",
    )
    .eq("id", input.sermonId)
    .eq("church_id", input.churchId)
    .maybeSingle();

  if (readError) {
    logDbError("read sermon before share", readError);
    return { ok: false, error: presentationHumanError(readError) };
  }
  if (!existing) return { ok: false, error: "Sermon not found." };

  const sermon = existing as Sermon;
  const readiness = presentationShareReadiness(sermon);
  if (!readiness.ready) {
    return { ok: false, error: `${readiness.title}. ${readiness.message}` };
  }

  const payload = await buildPublishPayload(sermon);
  if (payload.manifest.pages.length < 1) {
    return {
      ok: false,
      error: "Finish the slides first. There is nothing to publish yet.",
    };
  }

  const { data: latest, error: latestError } = await db
    .from("sermon_presentation_versions")
    .select("version")
    .eq("sermon_id", input.sermonId)
    .eq("church_id", input.churchId)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (latestError) {
    logDbError("read latest version", latestError);
    return { ok: false, error: presentationHumanError(latestError) };
  }

  const nextVersion = Number(latest?.version ?? 0) + 1;
  const now = new Date().toISOString();

  // Retire currently visible versions first so the archive never shows two
  // decks for the same sermon. Prior rows stay intact for audit.
  const { error: retireError } = await db
    .from("sermon_presentation_versions")
    .update({
      mobile_visibility: "none",
      unpublished_at: now,
    })
    .eq("sermon_id", input.sermonId)
    .eq("church_id", input.churchId)
    .is("unpublished_at", null)
    .neq("mobile_visibility", "none");

  if (retireError) {
    logDbError("retire prior versions", retireError);
    return { ok: false, error: presentationHumanError(retireError) };
  }

  const { data: inserted, error: insertError } = await db
    .from("sermon_presentation_versions")
    .insert({
      sermon_id: input.sermonId,
      church_id: input.churchId,
      version: nextVersion,
      content_hash: payload.contentHash,
      manifest: payload.manifest,
      theme_snapshot: payload.themeSnapshot,
      scripture_snapshot: payload.scriptureSnapshot,
      mobile_visibility: input.visibility,
      published_at: now,
      unpublished_at: null,
      renditions: { slides: [] },
      created_at: now,
    })
    .select("id, version, published_at, content_hash")
    .single();

  if (insertError || !inserted) {
    logDbError("insert version", insertError ?? { message: "no row" });
    return {
      ok: false,
      error: presentationHumanError(insertError ?? { message: "insert failed" }),
    };
  }

  const markedPublished = sermon.status !== "published";
  if (markedPublished) {
    const { error: statusError } = await db
      .from("sermons")
      .update({
        status: "published",
        published_at: (sermon.published_at as string | null) ?? now,
        updated_at: now,
      })
      .eq("id", input.sermonId)
      .eq("church_id", input.churchId);

    if (statusError) {
      // Slides are already shared; a builder-status miss is logged, not fatal.
      logDbError("mark sermon published", statusError);
    }
  }

  return {
    ok: true,
    markedPublished,
    state: {
      status: "published",
      visibility: input.visibility,
      presentationId: inserted.id as string,
      version: Number(inserted.version),
      publishedAt: inserted.published_at as string,
      contentHash: inserted.content_hash as string,
    },
  };
}

/**
 * Takes slides out of the app. Sets both filters so a future partial change
 * cannot resurrect them. Existing version rows remain immutable.
 */
export async function unpublishPresentationFromFaithForm(
  input: { churchId: string; sermonId: string },
  supabase?: SupabaseClient,
): Promise<PresentationPublicationResult> {
  const db = client(supabase);

  const { data: existing, error: readError } = await db
    .from("sermons")
    .select("id")
    .eq("id", input.sermonId)
    .eq("church_id", input.churchId)
    .maybeSingle();

  if (readError) {
    logDbError("read before unshare", readError);
    return { ok: false, error: presentationHumanError(readError) };
  }
  if (!existing) return { ok: false, error: "Sermon not found." };

  const now = new Date().toISOString();
  const { error } = await db
    .from("sermon_presentation_versions")
    .update({
      mobile_visibility: "none",
      unpublished_at: now,
    })
    .eq("sermon_id", input.sermonId)
    .eq("church_id", input.churchId)
    .is("unpublished_at", null)
    .neq("mobile_visibility", "none");

  if (error) {
    logDbError("unshare", error);
    return { ok: false, error: presentationHumanError(error) };
  }

  return { ok: true, state: { status: "unpublished" } };
}
