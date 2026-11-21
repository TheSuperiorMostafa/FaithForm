import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { UserFacingError } from "@/lib/errors/user-error";
import type {
  SongArrangement,
  SongAttachment,
  SongAttachmentKind,
  SongDetail,
  SongListRow,
  SongPickerOption,
  SongSourceKind,
  SongUsage,
  UsageReportRow,
} from "@/lib/service-plans/songs/types";
import { shiftYmd } from "@/lib/utils/dates";

/**
 * Reads for the Song Library. Each takes the client to read with (the
 * signed-in user's on pages, where RLS decides; the service role inside a
 * server action that has already checked the caller) and filters by church on
 * every query, so a service-role read can never cross churches.
 *
 * "Used" means a live (not deleted) plan item pointing at the song, in a dated
 * plan (not a template).
 */

type Row = Record<string, unknown>;
type PageResult = { data: Row[] | null; error: { message: string } | null };

function fail(context: string, error: { message: string } | null): void {
  if (error) {
    console.error(`song library ${context}:`, error.message);
    throw new UserFacingError("We couldn't load your song library. Please try again.");
  }
}

/** PostgREST returns at most 1,000 rows a request; read every page. */
async function fetchAll(context: string, page: (from: number, to: number) => PromiseLike<PageResult>): Promise<Row[]> {
  const size = 1000;
  const rows: Row[] = [];
  for (let from = 0; from < 100_000; from += size) {
    const { data, error } = await page(from, from + size - 1);
    fail(context, error);
    rows.push(...(data ?? []));
    if (!data || data.length < size) break;
  }
  return rows;
}

function chunks<T>(list: T[], size = 100): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);
const num = (v: unknown): number | null => (typeof v === "number" ? v : null);
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

type UseRow = {
  songId: string;
  planId: string;
  arrangementId: string | null;
  key: string | null;
  position: string;
  date: string;
  serviceTypeId: string;
  planTitle: string | null;
};

/** Dated plans of the church, by id. */
async function datedPlans(
  client: SupabaseClient,
  churchId: string,
  range?: { from: string; to: string },
): Promise<Map<string, Row>> {
  const rows = await fetchAll("plans", (from, to) => {
    let query = client
      .from("plans")
      .select("id, plan_date, service_type_id, title")
      .eq("church_id", churchId)
      .eq("is_template", false);
    if (range) query = query.gte("plan_date", range.from).lte("plan_date", range.to);
    return query.order("id").range(from, to);
  });
  return new Map(rows.map((r) => [r.id as string, r]));
}

/** Song uses in dated plans; one song's when `songId` is given. */
async function songUses(client: SupabaseClient, churchId: string, songId?: string): Promise<UseRow[]> {
  const [items, plans] = await Promise.all([
    fetchAll("song uses", (from, to) => {
      let query = client
        .from("plan_items")
        .select("song_id, plan_id, arrangement_id, song_key, position")
        .eq("church_id", churchId)
        .not("song_id", "is", null)
        .is("deleted_at", null);
      if (songId) query = query.eq("song_id", songId);
      return query.order("id").range(from, to);
    }),
    datedPlans(client, churchId),
  ]);
  return items.flatMap((item) => {
    const plan = plans.get(item.plan_id as string);
    if (!plan || !plan.plan_date) return [];
    return [
      {
        songId: item.song_id as string,
        planId: item.plan_id as string,
        arrangementId: str(item.arrangement_id),
        key: str(item.song_key),
        position: item.position as string,
        date: plan.plan_date as string,
        serviceTypeId: plan.service_type_id as string,
        planTitle: str(plan.title),
      },
    ];
  });
}

/** Every song in the library with when it was last sung and how often. */
export async function listSongs(client: SupabaseClient, churchId: string, today: string): Promise<SongListRow[]> {
  const [songs, uses] = await Promise.all([
    fetchAll("songs", (from, to) =>
      client
        .from("songs")
        .select("id, title, author, ccli_number, default_key, tags")
        .eq("church_id", churchId)
        .is("archived_at", null)
        .order("id")
        .range(from, to),
    ),
    songUses(client, churchId),
  ]);

  const yearAgo = shiftYmd(today, -365);
  const stats = new Map<string, { last: string | null; next: string | null; plans: Set<string> }>();
  for (const use of uses) {
    const s = stats.get(use.songId) ?? { last: null, next: null, plans: new Set<string>() };
    if (use.date <= today) {
      if (!s.last || use.date > s.last) s.last = use.date;
      if (use.date > yearAgo) s.plans.add(use.planId);
    } else if (!s.next || use.date < s.next) {
      s.next = use.date;
    }
    stats.set(use.songId, s);
  }

  return songs
    .map((row) => {
      const s = stats.get(row.id as string);
      return {
        id: row.id as string,
        title: row.title as string,
        author: str(row.author),
        ccliNumber: str(row.ccli_number),
        defaultKey: str(row.default_key),
        tags: strings(row.tags),
        lastUsed: s?.last ?? null,
        nextScheduled: s?.next ?? null,
        timesUsed12Months: s?.plans.size ?? 0,
      };
    })
    .sort((a, b) => a.title.localeCompare(b.title, "en", { sensitivity: "base" }));
}

/** Letters, digits and spaces only: safe inside a PostgREST `or` filter. */
function searchTerm(query: string): string {
  return query
    .slice(0, 100)
    .replace(/[^\p{L}\p{N}\s'-]/gu, " ")
    .replace(/'/g, "_")
    .replace(/\s+/g, " ")
    .trim();
}

/** Songs matching a title, writer or CCLI number, with their arrangements. */
export async function searchSongOptions(
  client: SupabaseClient,
  churchId: string,
  query: string,
  limit = 25,
): Promise<SongPickerOption[]> {
  const term = searchTerm(query);
  let request = client
    .from("songs")
    .select("id, title, author, ccli_number, default_key")
    .eq("church_id", churchId)
    .is("archived_at", null);
  if (term) {
    request = /^\d+$/.test(term)
      ? request.or(`ccli_number.eq.${term},title.ilike.%${term}%`)
      : request.or(`title.ilike.%${term}%,author.ilike.%${term}%`);
  }
  const { data, error } = await request.order("title").limit(Math.min(Math.max(limit, 1), 50));
  fail("song search", error);
  const songs = data ?? [];
  if (!songs.length) return [];

  const { data: arrangements, error: arrangementError } = await client
    .from("song_arrangements")
    .select("id, song_id, name, key, length_seconds, sort_order, created_at")
    .eq("church_id", churchId)
    .in(
      "song_id",
      songs.map((s) => s.id as string),
    )
    .order("sort_order")
    .order("created_at");
  fail("song search arrangements", arrangementError);

  return songs.map((s) => ({
    id: s.id as string,
    title: s.title as string,
    author: str(s.author),
    ccliNumber: str(s.ccli_number),
    defaultKey: str(s.default_key),
    arrangements: (arrangements ?? [])
      .filter((a) => a.song_id === s.id)
      .map((a) => ({
        id: a.id as string,
        name: a.name as string,
        key: str(a.key),
        lengthSeconds: num(a.length_seconds),
      })),
  }));
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "Link";
  }
}

function mapAttachment(row: Row): SongAttachment {
  const url = str(row.url);
  return {
    id: row.id as string,
    arrangementId: row.arrangement_id as string,
    kind: row.kind as SongAttachmentKind,
    name: str(row.file_name) ?? (url ? hostOf(url) : "File"),
    url,
    isFile: Boolean(row.storage_path),
    generated: row.generated_from === "lyrics" || row.generated_from === "chart" ? row.generated_from : null,
    createdAt: row.created_at as string,
  };
}

export { mapAttachment as mapSongAttachment };

/** One song with its arrangements, files and every plan it was in. */
export async function getSongDetail(
  client: SupabaseClient,
  churchId: string,
  songId: string,
): Promise<SongDetail | null> {
  const { data: song, error } = await client
    .from("songs")
    .select("id, title, author, ccli_number, copyright, default_key, tempo, tags, themes, source")
    .eq("church_id", churchId)
    .eq("id", songId)
    .is("archived_at", null)
    .maybeSingle();
  fail("song", error);
  if (!song) return null;

  const [arrangements, uses, types] = await Promise.all([
    client
      .from("song_arrangements")
      .select("id, name, key, bpm, length_seconds, section_order, chart_text, lyrics, sort_order, created_at")
      .eq("church_id", churchId)
      .eq("song_id", songId)
      .order("sort_order")
      .order("created_at"),
    songUses(client, churchId, songId),
    client.from("service_types").select("id, name").eq("church_id", churchId),
  ]);
  fail("song arrangements", arrangements.error);
  fail("service types", types.error);

  const arrangementRows = arrangements.data ?? [];
  const arrangementIds = arrangementRows.map((a) => a.id as string);
  const attachments = arrangementIds.length
    ? await client
        .from("song_attachments")
        .select("id, arrangement_id, kind, storage_path, url, file_name, generated_from, created_at")
        .eq("church_id", churchId)
        .in("arrangement_id", arrangementIds)
        .order("created_at")
    : { data: [] as Row[], error: null };
  fail("song attachments", attachments.error);

  const typeNames = new Map((types.data ?? []).map((t) => [t.id as string, t.name as string]));
  const arrangementNames = new Map(arrangementRows.map((a) => [a.id as string, a.name as string]));

  const mappedArrangements: SongArrangement[] = arrangementRows.map((a) => ({
    id: a.id as string,
    name: a.name as string,
    key: str(a.key),
    bpm: num(a.bpm),
    lengthSeconds: num(a.length_seconds),
    sectionOrder: strings(a.section_order),
    chartText: str(a.chart_text),
    lyrics: str(a.lyrics),
    attachments: (attachments.data ?? []).filter((f) => f.arrangement_id === a.id).map(mapAttachment),
  }));

  const usage: SongUsage[] = uses
    .map((u) => ({
      planId: u.planId,
      serviceTypeId: u.serviceTypeId,
      serviceTypeName: typeNames.get(u.serviceTypeId) ?? "Service",
      date: u.date,
      planTitle: u.planTitle,
      arrangementName: u.arrangementId ? (arrangementNames.get(u.arrangementId) ?? null) : null,
      key: u.key,
    }))
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

  return {
    id: song.id as string,
    title: song.title as string,
    author: str(song.author),
    ccliNumber: str(song.ccli_number),
    copyright: str(song.copyright),
    defaultKey: str(song.default_key),
    tempo: num(song.tempo),
    tags: strings(song.tags),
    themes: strings(song.themes),
    source: song.source as SongSourceKind,
    arrangements: mappedArrangements,
    usage,
  };
}

/** Every song sung between two dates (inclusive), in service order. */
export async function songUsageReport(
  client: SupabaseClient,
  churchId: string,
  range: { from: string; to: string },
): Promise<UsageReportRow[]> {
  const plans = await datedPlans(client, churchId, range);
  const planIds = [...plans.keys()];
  if (!planIds.length) return [];

  const items: Row[] = [];
  for (const ids of chunks(planIds)) {
    const { data, error } = await client
      .from("plan_items")
      .select("plan_id, position, song_id, arrangement_id, song_key")
      .eq("church_id", churchId)
      .in("plan_id", ids)
      .not("song_id", "is", null)
      .is("deleted_at", null);
    fail("usage items", error);
    items.push(...(data ?? []));
  }
  if (!items.length) return [];

  const songIds = [...new Set(items.map((i) => i.song_id as string))];
  const arrangementIds = [...new Set(items.map((i) => i.arrangement_id).filter(Boolean) as string[])];
  const songs = new Map<string, Row>();
  const arrangements = new Map<string, Row>();
  for (const ids of chunks(songIds)) {
    const { data, error } = await client
      .from("songs")
      .select("id, title, author, ccli_number")
      .eq("church_id", churchId)
      .in("id", ids);
    fail("usage songs", error);
    for (const s of data ?? []) songs.set(s.id as string, s);
  }
  for (const ids of chunks(arrangementIds)) {
    const { data, error } = await client
      .from("song_arrangements")
      .select("id, name, key")
      .eq("church_id", churchId)
      .in("id", ids);
    fail("usage arrangements", error);
    for (const a of data ?? []) arrangements.set(a.id as string, a);
  }
  const { data: types, error: typesError } = await client
    .from("service_types")
    .select("id, name")
    .eq("church_id", churchId);
  fail("usage service types", typesError);
  const typeNames = new Map((types ?? []).map((t) => [t.id as string, t.name as string]));

  return items
    .map((item) => {
      const plan = plans.get(item.plan_id as string)!;
      const song = songs.get(item.song_id as string);
      const arrangement = item.arrangement_id ? arrangements.get(item.arrangement_id as string) : undefined;
      return {
        sort: `${plan.plan_date as string}|${plan.service_type_id as string}|${plan.id as string}|${item.position as string}`,
        row: {
          date: plan.plan_date as string,
          serviceType: typeNames.get(plan.service_type_id as string) ?? "Service",
          planTitle: str(plan.title),
          songTitle: (song?.title as string | undefined) ?? "Song",
          author: str(song?.author),
          ccliNumber: str(song?.ccli_number),
          arrangement: str(arrangement?.name),
          key: str(item.song_key) ?? str(arrangement?.key),
        },
      };
    })
    .sort((a, b) => (a.sort < b.sort ? -1 : a.sort > b.sort ? 1 : 0))
    .map((x) => x.row);
}

/** id, lower-case title and CCLI number of every live song: for duplicate checks. */
export async function songIdentities(
  client: SupabaseClient,
  churchId: string,
): Promise<{ id: string; title: string; ccliNumber: string | null }[]> {
  const rows = await fetchAll("song titles", (from, to) =>
    client
      .from("songs")
      .select("id, title, ccli_number")
      .eq("church_id", churchId)
      .is("archived_at", null)
      .order("id")
      .range(from, to),
  );
  return rows.map((r) => ({ id: r.id as string, title: r.title as string, ccliNumber: str(r.ccli_number) }));
}
