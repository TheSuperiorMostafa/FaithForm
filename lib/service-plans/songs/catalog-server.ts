import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { UserFacingError } from "@/lib/errors/user-error";
import { catalogFacts, catalogQuery, type CatalogSong } from "@/lib/service-plans/songs/catalog";

/**
 * Reads and facts-only writes for the shared song catalog (0180). Reads work
 * with any signed-in client (RLS: authenticated may read); writes need the
 * service role and are only ever "add this CCLI number if it is missing",
 * never an update, so one church cannot change what others see.
 *
 * Every function here tolerates the catalog not existing yet (the migration
 * applied after this code): searches say so in plain words, and linking or
 * contributing quietly does nothing, so saving a church's own song never
 * fails because of the catalog.
 */

const COLUMNS = "id, ccli_number, title, author, copyright, themes, default_key, tempo, is_public_domain";

type Row = Record<string, unknown>;

function mapCatalogSong(row: Row): CatalogSong {
  return {
    id: row.id as string,
    ccliNumber: (row.ccli_number as string | null) ?? null,
    title: row.title as string,
    author: (row.author as string | null) ?? null,
    copyright: (row.copyright as string | null) ?? null,
    themes: Array.isArray(row.themes) ? (row.themes as string[]) : [],
    defaultKey: (row.default_key as string | null) ?? null,
    tempo: typeof row.tempo === "number" ? row.tempo : null,
    isPublicDomain: row.is_public_domain === true,
  };
}

const UNAVAILABLE = "The song catalog isn't available right now. You can still add the song yourself.";

/** Search by CCLI number (exact) or title and writer words (prefixes). */
export async function searchCatalog(client: SupabaseClient, raw: unknown, limit = 20): Promise<CatalogSong[]> {
  const query = catalogQuery(raw);
  let request;
  if (query.ccli) {
    request = client.from("song_catalog").select(COLUMNS).eq("ccli_number", query.ccli).limit(1);
  } else if (query.tsquery) {
    request = client
      .from("song_catalog")
      .select(COLUMNS)
      .textSearch("search_vector", query.tsquery, { config: "simple" })
      .order("title")
      .limit(limit);
  } else {
    return [];
  }
  const { data, error } = await request;
  if (error) {
    console.error("song catalog search:", error.message);
    throw new UserFacingError(UNAVAILABLE);
  }
  return (data ?? []).map(mapCatalogSong);
}

export async function getCatalogSong(
  client: SupabaseClient,
  id: string,
): Promise<{ song: CatalogSong; publicDomainText: { lyrics: string; sectionOrder: string[] } | null } | null> {
  const { data, error } = await client.from("song_catalog").select(COLUMNS).eq("id", id).maybeSingle();
  if (error) {
    console.error("song catalog read:", error.message);
    throw new UserFacingError(UNAVAILABLE);
  }
  if (!data) return null;
  const song = mapCatalogSong(data);
  if (!song.isPublicDomain) return { song, publicDomainText: null };
  const text = await client
    .from("song_catalog_public_domain_texts")
    .select("lyrics, section_order")
    .eq("catalog_id", id)
    .maybeSingle();
  if (text.error) console.error("song catalog text:", text.error.message);
  return {
    song,
    publicDomainText: text.data
      ? {
          lyrics: text.data.lyrics as string,
          sectionOrder: Array.isArray(text.data.section_order) ? (text.data.section_order as string[]) : [],
        }
      : null,
  };
}

/**
 * Adds a church song's facts (never its lyrics) to the catalog when its CCLI
 * number isn't there yet, then links the church's song to the catalog row.
 * Does nothing for a song without a CCLI number.
 * Best effort: any failure is logged and the church's own save stands.
 */
export async function contributeAndLink(
  admin: SupabaseClient,
  churchId: string,
  song: {
    id: string;
    ccliNumber: string | null;
    title: string;
    author?: string | null;
    copyright?: string | null;
    defaultKey?: string | null;
    tempo?: number | null;
    themes?: string[];
  },
): Promise<void> {
  const facts = catalogFacts(song);
  if (!facts) return;
  try {
    const { error: insertError } = await admin
      .from("song_catalog")
      .upsert(facts, { onConflict: "ccli_number", ignoreDuplicates: true });
    if (insertError) throw insertError;
    const { data, error } = await admin.from("song_catalog").select("id").eq("ccli_number", facts.ccli_number).maybeSingle();
    if (error) throw error;
    const catalogId = (data?.id as string | undefined) ?? null;
    if (!catalogId) return;
    const { error: linkError } = await admin
      .from("songs")
      .update({ catalog_id: catalogId })
      .eq("church_id", churchId)
      .eq("id", song.id);
    if (linkError) throw linkError;
  } catch (error) {
    const message = error && typeof error === "object" && "message" in error ? String(error.message) : String(error);
    console.error("song catalog link:", message);
  }
}

/** Links a song to a catalog row, or unlinks it with null. Best effort, as above. */
export async function linkSongToCatalog(
  admin: SupabaseClient,
  churchId: string,
  songId: string,
  catalogId: string | null,
) {
  const { error } = await admin.from("songs").update({ catalog_id: catalogId }).eq("church_id", churchId).eq("id", songId);
  if (error) console.error("song catalog link:", error.message);
}
