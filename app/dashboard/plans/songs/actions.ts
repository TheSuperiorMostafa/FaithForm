"use server";

import { revalidatePath } from "next/cache";
import { requireChurchAuth, type ChurchAuth } from "@/lib/auth/church";
import { toUserError, UserFacingError } from "@/lib/errors/user-error";
import { featureActionError } from "@/lib/features/guard";
import { assertId, cleanText, NOT_FOUND, requireText } from "@/lib/service-plans/server";
import { normalizeCcli, normalizeKey, normalizeTempo, parseSongFile } from "@/lib/service-plans/songs/parsers";
import { mapSongAttachment, songIdentities } from "@/lib/service-plans/songs/queries";
import { songSource } from "@/lib/service-plans/songs/source";
import { STARTER_HYMNS } from "@/lib/service-plans/songs/starter-hymns";
import {
  SONG_FILE_FORMATS,
  type ImportPreviewSong,
  type ImportSongInput,
  type SongAttachment,
  type SongFileFormat,
  type SongPickerOption,
} from "@/lib/service-plans/songs/types";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Song Library server actions. Each one is a public POST endpoint, so each
 * checks the caller (signed in, Service Plans feature) before anything else,
 * then writes with the service role scoped to the caller's church.
 */

type Fail = { ok: false; error: string };
type Ok<T = object> = { ok: true } & T;
type Admin = ReturnType<typeof createAdminClient>;

const BUCKET = "song-files";

async function planner(): Promise<{ auth: ChurchAuth; admin: Admin }> {
  const auth = await requireChurchAuth();
  const denied = await featureActionError("service_plans");
  if (denied) throw new UserFacingError(denied);
  return { auth, admin: createAdminClient() };
}

function failed(error: unknown, fallback: string): Fail {
  return { ok: false, error: toUserError(error, fallback) };
}

function revalidateSongs(songId?: string) {
  revalidatePath("/dashboard/plans/songs");
  if (songId) revalidatePath(`/dashboard/plans/songs/${songId}`);
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export type SongInput = {
  title?: string;
  author?: string | null;
  ccliNumber?: string | null;
  copyright?: string | null;
  defaultKey?: string | null;
  tempo?: number | string | null;
  tags?: string[] | string | null;
};

export type ArrangementInput = {
  name?: string;
  key?: string | null;
  bpm?: number | string | null;
  lengthSeconds?: number | null;
  sectionOrder?: string[];
  chartText?: string | null;
  lyrics?: string | null;
};

function cleanList(value: unknown, maxItems: number, maxLength: number): string[] {
  const parts = Array.isArray(value) ? value : typeof value === "string" ? value.split(",") : [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of parts) {
    if (typeof part !== "string") continue;
    const text = part.trim().slice(0, maxLength);
    if (!text || seen.has(text.toLowerCase())) continue;
    seen.add(text.toLowerCase());
    out.push(text);
    if (out.length >= maxItems) break;
  }
  return out;
}

/** Long text keeps its inner spacing (chord charts line up by spaces). */
function cleanLong(value: unknown, what: string): string | null {
  if (typeof value !== "string") return null;
  const text = value.replace(/\r\n?/g, "\n").replace(/\s+$/, "");
  if (!text.trim()) return null;
  if (text.length > 100_000) throw new UserFacingError(`The ${what} is too long. Keep it under 100,000 characters.`);
  return text;
}

function cleanCcli(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).replace(/\s+/g, "");
  if (!text) return null;
  if (!/^[0-9]{1,10}$/.test(text)) throw new UserFacingError("A CCLI song number is digits only, like 22025.");
  return text;
}

function cleanBpm(value: unknown, what: string): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 20 || n > 300) {
    throw new UserFacingError(`${what} is beats per minute, a whole number from 20 to 300.`);
  }
  return n;
}

function songRow(input: SongInput) {
  return {
    title: requireText(input.title, 200, "song"),
    author: cleanText(input.author, 300),
    ccli_number: cleanCcli(input.ccliNumber),
    copyright: cleanText(input.copyright, 500),
    default_key: cleanText(input.defaultKey, 8),
    tempo: cleanBpm(input.tempo, "Tempo"),
    tags: cleanList(input.tags, 20, 40),
  };
}

function arrangementRow(input: ArrangementInput) {
  const length = input.lengthSeconds;
  if (length !== null && length !== undefined && (!Number.isInteger(length) || length < 0 || length > 7200)) {
    throw new UserFacingError("Length must be between 0:00 and 2:00:00.");
  }
  return {
    name: requireText(input.name, 80, "arrangement"),
    key: cleanText(input.key, 8),
    bpm: cleanBpm(input.bpm, "BPM"),
    length_seconds: length ?? null,
    section_order: cleanList(input.sectionOrder, 50, 40),
    chart_text: cleanLong(input.chartText, "chord chart"),
    lyrics: cleanLong(input.lyrics, "lyrics"),
  };
}

async function assertSong(admin: Admin, churchId: string, songId: unknown): Promise<{ id: string; title: string }> {
  const { data, error } = await admin
    .from("songs")
    .select("id, title")
    .eq("church_id", churchId)
    .eq("id", assertId(songId))
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new UserFacingError(NOT_FOUND);
  return { id: data.id as string, title: data.title as string };
}

async function assertArrangement(
  admin: Admin,
  churchId: string,
  arrangementId: unknown,
): Promise<{ id: string; songId: string; name: string }> {
  const { data, error } = await admin
    .from("song_arrangements")
    .select("id, song_id, name")
    .eq("church_id", churchId)
    .eq("id", assertId(arrangementId))
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new UserFacingError(NOT_FOUND);
  return { id: data.id as string, songId: data.song_id as string, name: data.name as string };
}

// ---------------------------------------------------------------------------
// Songs
// ---------------------------------------------------------------------------

export async function createSongAction(input: SongInput): Promise<Ok<{ id: string }> | Fail> {
  try {
    const { auth, admin } = await planner();
    const row = songRow(input);
    const { data, error } = await admin
      .from("songs")
      .insert({ ...row, church_id: auth.churchId, source: "manual" })
      .select("id")
      .single();
    if (error) throw error;
    const songId = data.id as string;
    const { error: arrangementError } = await admin.from("song_arrangements").insert({
      church_id: auth.churchId,
      song_id: songId,
      name: "Default",
      key: row.default_key,
      bpm: row.tempo,
    });
    if (arrangementError) throw arrangementError;
    revalidateSongs();
    return { ok: true, id: songId };
  } catch (error) {
    return failed(error, "We couldn't add that song.");
  }
}

export async function updateSongAction(songId: string, input: SongInput): Promise<Ok | Fail> {
  try {
    const { auth, admin } = await planner();
    const song = await assertSong(admin, auth.churchId, songId);
    const { error } = await admin
      .from("songs")
      .update(songRow(input))
      .eq("church_id", auth.churchId)
      .eq("id", song.id);
    if (error) throw error;
    revalidateSongs(song.id);
    return { ok: true };
  } catch (error) {
    return failed(error, "We couldn't save the song.");
  }
}

/** Takes a song out of the library. Plans that used it keep their items. */
export async function archiveSongAction(songId: string): Promise<Ok | Fail> {
  try {
    const { auth, admin } = await planner();
    const song = await assertSong(admin, auth.churchId, songId);
    const { error } = await admin
      .from("songs")
      .update({ archived_at: new Date().toISOString() })
      .eq("church_id", auth.churchId)
      .eq("id", song.id);
    if (error) throw error;
    revalidateSongs(song.id);
    return { ok: true };
  } catch (error) {
    return failed(error, "We couldn't remove that song.");
  }
}

export async function restoreSongAction(songId: string): Promise<Ok | Fail> {
  try {
    const { auth, admin } = await planner();
    const song = await assertSong(admin, auth.churchId, songId);
    const { error } = await admin
      .from("songs")
      .update({ archived_at: null })
      .eq("church_id", auth.churchId)
      .eq("id", song.id);
    if (error) throw error;
    revalidateSongs(song.id);
    return { ok: true };
  } catch (error) {
    return failed(error, "We couldn't bring that song back.");
  }
}

// ---------------------------------------------------------------------------
// Arrangements
// ---------------------------------------------------------------------------

export async function createArrangementAction(songId: string, input: ArrangementInput): Promise<Ok<{ id: string }> | Fail> {
  try {
    const { auth, admin } = await planner();
    const song = await assertSong(admin, auth.churchId, songId);
    const { count, error: countError } = await admin
      .from("song_arrangements")
      .select("id", { count: "exact", head: true })
      .eq("church_id", auth.churchId)
      .eq("song_id", song.id);
    if (countError) throw countError;
    const { data, error } = await admin
      .from("song_arrangements")
      .insert({ ...arrangementRow(input), church_id: auth.churchId, song_id: song.id, sort_order: count ?? 0 })
      .select("id")
      .single();
    if (error) throw error;
    revalidateSongs(song.id);
    return { ok: true, id: data.id as string };
  } catch (error) {
    return failed(error, "We couldn't add that arrangement.");
  }
}

export async function updateArrangementAction(arrangementId: string, input: ArrangementInput): Promise<Ok | Fail> {
  try {
    const { auth, admin } = await planner();
    const arrangement = await assertArrangement(admin, auth.churchId, arrangementId);
    const { error } = await admin
      .from("song_arrangements")
      .update(arrangementRow(input))
      .eq("church_id", auth.churchId)
      .eq("id", arrangement.id);
    if (error) throw error;
    revalidateSongs(arrangement.songId);
    return { ok: true };
  } catch (error) {
    return failed(error, "We couldn't save the arrangement.");
  }
}

/** Deletes an arrangement and its files. Plan items keep the song. */
export async function deleteArrangementAction(arrangementId: string): Promise<Ok | Fail> {
  try {
    const { auth, admin } = await planner();
    const arrangement = await assertArrangement(admin, auth.churchId, arrangementId);
    const { data: files, error: filesError } = await admin
      .from("song_attachments")
      .select("storage_path")
      .eq("church_id", auth.churchId)
      .eq("arrangement_id", arrangement.id)
      .not("storage_path", "is", null);
    if (filesError) throw filesError;
    const { error } = await admin
      .from("song_arrangements")
      .delete()
      .eq("church_id", auth.churchId)
      .eq("id", arrangement.id);
    if (error) throw error;
    await removeStoredFiles(admin, (files ?? []).map((f) => f.storage_path as string));
    revalidateSongs(arrangement.songId);
    return { ok: true };
  } catch (error) {
    return failed(error, "We couldn't delete that arrangement.");
  }
}

// ---------------------------------------------------------------------------
// Picker search and starter hymns
// ---------------------------------------------------------------------------

export async function searchSongsAction(query: string): Promise<Ok<{ songs: SongPickerOption[] }> | Fail> {
  try {
    const { auth, admin } = await planner();
    const songs = await songSource(admin, auth.churchId).search(typeof query === "string" ? query : "", 25);
    return { ok: true, songs };
  } catch (error) {
    return failed(error, "We couldn't search your songs.");
  }
}

export async function seedStarterHymnsAction(): Promise<Ok<{ added: number }> | Fail> {
  try {
    const { auth, admin } = await planner();
    const existing = new Set((await songIdentities(admin, auth.churchId)).map((s) => s.title.toLowerCase()));
    const hymns = STARTER_HYMNS.filter((h) => !existing.has(h.title.toLowerCase()));
    if (!hymns.length) return { ok: true, added: 0 };
    const rows = hymns.map((h) => ({ id: crypto.randomUUID(), hymn: h }));
    const { error } = await admin.from("songs").insert(
      rows.map(({ id, hymn }) => ({
        id,
        church_id: auth.churchId,
        title: hymn.title,
        author: hymn.author,
        copyright: "Public Domain",
        default_key: hymn.key,
        tags: ["Hymn"],
        source: "starter",
      })),
    );
    if (error) throw error;
    const { error: arrangementError } = await admin.from("song_arrangements").insert(
      rows.map(({ id, hymn }) => ({
        church_id: auth.churchId,
        song_id: id,
        name: "Default",
        key: hymn.key,
        length_seconds: hymn.lengthSeconds,
        section_order: hymn.sectionOrder,
      })),
    );
    if (arrangementError) {
      await admin.from("songs").delete().eq("church_id", auth.churchId).in("id", rows.map((r) => r.id));
      throw arrangementError;
    }
    revalidateSongs();
    return { ok: true, added: rows.length };
  } catch (error) {
    return failed(error, "We couldn't add the starter hymns.");
  }
}

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

const MAX_FILES = 50;
const MAX_FILE_CHARS = 2_000_000;
const MAX_IMPORT_SONGS = 500;

export type ImportFileSummary = {
  name: string;
  format: SongFileFormat | null;
  songCount: number;
  warnings: string[];
};

/** Reads files and finds likely duplicates. Saves nothing. */
export async function importPreviewAction(
  files: { name: string; text: string }[],
): Promise<Ok<{ songs: ImportPreviewSong[]; files: ImportFileSummary[] }> | Fail> {
  try {
    const { auth, admin } = await planner();
    if (!Array.isArray(files) || !files.length) throw new UserFacingError("Choose at least one song file.");
    if (files.length > MAX_FILES) throw new UserFacingError(`Choose up to ${MAX_FILES} files at a time.`);

    const library = await songIdentities(admin, auth.churchId);
    const byCcli = new Map(library.filter((s) => s.ccliNumber).map((s) => [s.ccliNumber!, s]));
    const byTitle = new Map(library.map((s) => [s.title.toLowerCase(), s]));
    const seenCcli = new Map<string, string>();
    const seenTitle = new Map<string, string>();

    const songs: ImportPreviewSong[] = [];
    const summaries: ImportFileSummary[] = [];
    for (const file of files) {
      const name = typeof file?.name === "string" ? file.name.slice(0, 255) : "file";
      const text = typeof file?.text === "string" ? file.text : "";
      if (text.length > MAX_FILE_CHARS) {
        summaries.push({ name, format: null, songCount: 0, warnings: ["This file is too large to read."] });
        continue;
      }
      const result = parseSongFile(name, text);
      const room = MAX_IMPORT_SONGS - songs.length;
      const parsed = result.songs.slice(0, Math.max(room, 0));
      const warnings = [...result.warnings];
      if (parsed.length < result.songs.length) {
        warnings.push(`Only ${MAX_IMPORT_SONGS} songs can be imported at once; the rest of this file was left out.`);
      }
      summaries.push({ name, format: result.format, songCount: parsed.length, warnings });
      parsed.forEach((song, i) => {
        const titleKey = song.title.toLowerCase();
        const libraryMatch = (song.ccliNumber && byCcli.get(song.ccliNumber)) || byTitle.get(titleKey);
        let duplicate: ImportPreviewSong["duplicate"] = null;
        if (libraryMatch) {
          duplicate = {
            songId: libraryMatch.id,
            title: libraryMatch.title,
            reason: song.ccliNumber && libraryMatch.ccliNumber === song.ccliNumber ? "ccli" : "title",
            inFile: false,
          };
        } else if (song.ccliNumber && seenCcli.has(song.ccliNumber)) {
          duplicate = { songId: null, title: seenCcli.get(song.ccliNumber)!, reason: "ccli", inFile: true };
        } else if (seenTitle.has(titleKey)) {
          duplicate = { songId: null, title: seenTitle.get(titleKey)!, reason: "title", inFile: true };
        }
        if (song.ccliNumber && !seenCcli.has(song.ccliNumber)) seenCcli.set(song.ccliNumber, song.title);
        if (!seenTitle.has(titleKey)) seenTitle.set(titleKey, song.title);
        songs.push({
          ...song,
          previewId: `${summaries.length - 1}-${i}`,
          fileName: name,
          format: result.format!,
          duplicate,
        });
      });
    }
    return { ok: true, songs, files: summaries };
  } catch (error) {
    return failed(error, "We couldn't read those files.");
  }
}

/** Saves the songs kept in the review, each with a first arrangement. */
export async function importSaveAction(input: ImportSongInput[]): Promise<Ok<{ added: number }> | Fail> {
  try {
    const { auth, admin } = await planner();
    if (!Array.isArray(input) || !input.length) throw new UserFacingError("Choose at least one song to save.");
    if (input.length > MAX_IMPORT_SONGS) throw new UserFacingError(`Save up to ${MAX_IMPORT_SONGS} songs at a time.`);

    const rows = input.flatMap((song) => {
      const title = cleanText(song?.title, 200);
      if (!title) return [];
      // The review already showed these warnings; here they only drop bad values.
      const ignored: string[] = [];
      const key = normalizeKey(typeof song.key === "string" ? song.key : null, ignored);
      const tempo = normalizeTempo(typeof song.tempo === "number" ? song.tempo : null, ignored);
      const format = (SONG_FILE_FORMATS as readonly string[]).includes(song.format) ? song.format : "manual";
      const id = crypto.randomUUID();
      return [
        {
          song: {
            id,
            church_id: auth.churchId,
            title,
            author: cleanText(song.author, 300),
            ccli_number: normalizeCcli(typeof song.ccliNumber === "string" ? song.ccliNumber : null, ignored),
            copyright: cleanText(song.copyright, 500),
            default_key: key,
            tempo,
            tags: cleanList(song.tags, 20, 40),
            themes: cleanList(song.themes, 20, 40),
            source: format,
          },
          arrangement: {
            church_id: auth.churchId,
            song_id: id,
            name: "Default",
            key,
            bpm: tempo,
            section_order: cleanList(song.sectionOrder, 50, 40),
            chart_text: cleanLong(song.chartText, "chord chart"),
            lyrics: cleanLong(song.lyrics, "lyrics"),
          },
        },
      ];
    });
    if (!rows.length) throw new UserFacingError("Each song needs a title.");

    const saved: string[] = [];
    try {
      for (let i = 0; i < rows.length; i += 100) {
        const batch = rows.slice(i, i + 100);
        const { error } = await admin.from("songs").insert(batch.map((r) => r.song));
        if (error) throw error;
        saved.push(...batch.map((r) => r.song.id));
        const { error: arrangementError } = await admin.from("song_arrangements").insert(batch.map((r) => r.arrangement));
        if (arrangementError) throw arrangementError;
      }
    } catch (error) {
      // All or nothing: a half-saved import is harder to review than none.
      for (let i = 0; i < saved.length; i += 100) {
        await admin.from("songs").delete().eq("church_id", auth.churchId).in("id", saved.slice(i, i + 100));
      }
      throw error;
    }
    revalidateSongs();
    return { ok: true, added: rows.length };
  } catch (error) {
    return failed(error, "We couldn't save those songs. Nothing was added.");
  }
}

// ---------------------------------------------------------------------------
// Attachments
// ---------------------------------------------------------------------------

const FILE_TYPES: Record<string, "chart_pdf" | "file"> = {
  "application/pdf": "chart_pdf",
  "image/png": "file",
  "image/jpeg": "file",
  "text/plain": "file",
  "audio/mpeg": "file",
  "audio/mp4": "file",
};

function safeFileName(name: unknown): string {
  const base = typeof name === "string" ? (name.split(/[\\/]/).pop() ?? "") : "";
  const cleaned = base
    .normalize("NFKD")
    .replace(/[^\w.-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(-100);
  return cleaned || "file";
}

async function removeStoredFiles(admin: Admin, paths: string[]) {
  if (!paths.length) return;
  const { error } = await admin.storage.from(BUCKET).remove(paths);
  // The rows are gone already; a leftover private file is only storage.
  if (error) console.error("song files remove:", error.message);
}

export async function createAttachmentUploadAction(
  arrangementId: string,
  fileName: string,
  contentType: string,
): Promise<Ok<{ path: string; token: string }> | Fail> {
  try {
    const { auth, admin } = await planner();
    if (!Object.prototype.hasOwnProperty.call(FILE_TYPES, contentType)) {
      throw new UserFacingError("Upload a PDF, a picture (PNG or JPEG), a text file, or MP3 or M4A audio.");
    }
    const arrangement = await assertArrangement(admin, auth.churchId, arrangementId);
    const path = `${auth.churchId}/${arrangement.songId}/${crypto.randomUUID()}-${safeFileName(fileName)}`;
    const { data, error } = await admin.storage.from(BUCKET).createSignedUploadUrl(path, { upsert: false });
    if (error || !data) throw error ?? new Error("Upload unavailable");
    return { ok: true, path: data.path, token: data.token };
  } catch (error) {
    return failed(error, "We couldn't start that upload.");
  }
}

export async function confirmAttachmentAction(input: {
  arrangementId: string;
  path: string;
  fileName: string;
}): Promise<Ok<{ attachment: SongAttachment }> | Fail> {
  try {
    const { auth, admin } = await planner();
    const arrangement = await assertArrangement(admin, auth.churchId, input.arrangementId);
    const folder = `${auth.churchId}/${arrangement.songId}`;
    const path = typeof input.path === "string" ? input.path : "";
    const name = path.slice(folder.length + 1);
    if (!path.startsWith(`${folder}/`) || !name || name.includes("/") || path.length > 500) {
      throw new UserFacingError(NOT_FOUND);
    }
    const { data: listed, error: listError } = await admin.storage.from(BUCKET).list(folder, { search: name, limit: 5 });
    if (listError) throw listError;
    const object = (listed ?? []).find((o) => o.name === name);
    if (!object) throw new UserFacingError("The upload didn't finish. Please try again.");
    const mime = (object.metadata as { mimetype?: string } | null)?.mimetype ?? "";
    const kind = mime === "application/pdf" || /\.pdf$/i.test(name) ? "chart_pdf" : "file";

    const { data, error } = await admin
      .from("song_attachments")
      .insert({
        church_id: auth.churchId,
        arrangement_id: arrangement.id,
        kind,
        storage_path: path,
        file_name: cleanText(input.fileName, 255) ?? name,
      })
      .select("id, arrangement_id, kind, storage_path, url, file_name, created_at")
      .single();
    if (error) throw error;
    revalidateSongs(arrangement.songId);
    return { ok: true, attachment: mapSongAttachment(data) };
  } catch (error) {
    return failed(error, "We couldn't save that file.");
  }
}

export async function addAttachmentLinkAction(
  arrangementId: string,
  url: string,
  label?: string | null,
): Promise<Ok<{ attachment: SongAttachment }> | Fail> {
  try {
    const { auth, admin } = await planner();
    const arrangement = await assertArrangement(admin, auth.churchId, arrangementId);
    let parsed: URL;
    try {
      parsed = new URL(typeof url === "string" ? url.trim() : "");
    } catch {
      throw new UserFacingError("Paste a full link that starts with https://");
    }
    if (parsed.protocol !== "https:" || parsed.href.length > 2048) {
      throw new UserFacingError("Paste a full link that starts with https://");
    }
    const { data, error } = await admin
      .from("song_attachments")
      .insert({
        church_id: auth.churchId,
        arrangement_id: arrangement.id,
        kind: "audio_link",
        url: parsed.href,
        file_name: cleanText(label, 255) ?? parsed.hostname,
      })
      .select("id, arrangement_id, kind, storage_path, url, file_name, created_at")
      .single();
    if (error) throw error;
    revalidateSongs(arrangement.songId);
    return { ok: true, attachment: mapSongAttachment(data) };
  } catch (error) {
    return failed(error, "We couldn't add that link.");
  }
}

async function assertAttachment(admin: Admin, churchId: string, attachmentId: unknown) {
  const { data, error } = await admin
    .from("song_attachments")
    .select("id, arrangement_id, storage_path, url")
    .eq("church_id", churchId)
    .eq("id", assertId(attachmentId))
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new UserFacingError(NOT_FOUND);
  return {
    id: data.id as string,
    arrangementId: data.arrangement_id as string,
    storagePath: (data.storage_path as string | null) ?? null,
    url: (data.url as string | null) ?? null,
  };
}

export async function deleteAttachmentAction(attachmentId: string): Promise<Ok | Fail> {
  try {
    const { auth, admin } = await planner();
    const attachment = await assertAttachment(admin, auth.churchId, attachmentId);
    const { error } = await admin
      .from("song_attachments")
      .delete()
      .eq("church_id", auth.churchId)
      .eq("id", attachment.id);
    if (error) throw error;
    if (attachment.storagePath) await removeStoredFiles(admin, [attachment.storagePath]);
    revalidatePath("/dashboard/plans/songs", "layout");
    return { ok: true };
  } catch (error) {
    return failed(error, "We couldn't delete that file.");
  }
}

/** A link to open the file: a two-minute signed URL for stored files. */
export async function getAttachmentUrlAction(attachmentId: string): Promise<Ok<{ url: string }> | Fail> {
  try {
    const { auth, admin } = await planner();
    const attachment = await assertAttachment(admin, auth.churchId, attachmentId);
    if (attachment.url) return { ok: true, url: attachment.url };
    if (!attachment.storagePath?.startsWith(`${auth.churchId}/`)) throw new UserFacingError(NOT_FOUND);
    const { data, error } = await admin.storage.from(BUCKET).createSignedUrl(attachment.storagePath, 120);
    if (error || !data) throw error ?? new Error("Signed URL unavailable");
    return { ok: true, url: data.signedUrl };
  } catch (error) {
    return failed(error, "We couldn't open that file.");
  }
}
