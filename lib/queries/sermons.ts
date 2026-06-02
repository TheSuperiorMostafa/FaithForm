import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import type {
  AIProvider,
  ChurchSettings,
  Sermon,
  SermonAssetKind,
  SermonBuilderMode,
  SermonContent,
  SermonKind,
  SermonOutline,
  SermonSeries,
  SeriesPlan,
} from "@/types/sermon";

function db() {
  return createClient();
}

export async function getChurchAISettings(
  churchId: string,
): Promise<ChurchSettings | null> {
  const supabase = db();
  const { data } = await supabase
    .from("church_settings")
    .select("*")
    .eq("church_id", churchId)
    .maybeSingle();

  return data as ChurchSettings | null;
}

export async function upsertChurchSettings(
  churchId: string,
  patch: Partial<
    Pick<
      ChurchSettings,
      | "ai_provider"
      | "ai_model_override"
      | "default_translation"
      | "preaching_style"
      | "denomination"
      | "sermon_builder_mode"
    >
  >,
) {
  const supabase = db();
  const { data, error } = await supabase
    .from("church_settings")
    .upsert(
      {
        church_id: churchId,
        ...patch,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "church_id" },
    )
    .select()
    .single();

  if (error) throw error;
  return data as ChurchSettings;
}

export type ListSermonsOptions = {
  page?: number;
  pageSize?: number;
};

export type ListSermonsResult = {
  rows: Sermon[];
  total: number;
};

export async function listSermons(
  churchId: string,
  options?: ListSermonsOptions,
): Promise<ListSermonsResult> {
  const page = Math.max(1, options?.page ?? 1);
  const pageSize = Math.max(1, options?.pageSize ?? 10);
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  const supabase = db();
  const { data, error, count } = await supabase
    .from("sermons")
    .select("*", { count: "exact" })
    .eq("church_id", churchId)
    .order("updated_at", { ascending: false })
    .range(from, to);

  if (error) throw error;
  return {
    rows: (data ?? []) as Sermon[],
    total: count ?? 0,
  };
}

export async function deleteSermon(id: string): Promise<void> {
  const supabase = db();
  const { error } = await supabase.from("sermons").delete().eq("id", id);
  if (error) throw error;
}

export async function getSermon(id: string): Promise<Sermon | null> {
  const supabase = db();
  const { data, error } = await supabase
    .from("sermons")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) throw error;
  return data as Sermon | null;
}

export async function createSermon(input: {
  churchId: string;
  userId: string;
  title?: string;
  topic: string;
  scripture_refs: string[];
  audience: string;
  duration_min: number;
  style_notes?: string | null;
  series_id?: string | null;
  kind?: SermonKind;
  theme_id?: string | null;
  translation?: string | null;
}): Promise<Sermon> {
  const supabase = db();
  const { data, error } = await supabase
    .from("sermons")
    .insert({
      church_id: input.churchId,
      created_by: input.userId,
      title: input.title ?? "Untitled Sermon",
      topic: input.topic,
      scripture_refs: input.scripture_refs,
      audience: input.audience,
      duration_min: input.duration_min,
      style_notes: input.style_notes ?? null,
      series_id: input.series_id ?? null,
      kind: input.kind ?? "advanced",
      theme_id: input.theme_id ?? null,
      translation: input.translation ?? null,
      status: "draft",
    })
    .select()
    .single();

  if (error) throw error;
  return data as Sermon;
}

export async function updateSermon(
  id: string,
  patch: Partial<{
    title: string;
    topic: string;
    scripture_refs: string[];
    audience: string;
    duration_min: number;
    style_notes: string | null;
    status: "draft" | "published";
    outline: SermonOutline | null;
    content: SermonContent | null;
    model_used: string | null;
    theme_id: string | null;
    translation: string | null;
  }>,
): Promise<Sermon> {
  const supabase = db();
  const { data, error } = await supabase
    .from("sermons")
    .update({
      ...patch,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .select()
    .single();

  if (error) throw error;
  return data as Sermon;
}

export async function saveAsset(input: {
  sermonId: string;
  kind: SermonAssetKind;
  payload: unknown;
}) {
  const supabase = db();
  const { data, error } = await supabase
    .from("sermon_assets")
    .insert({
      sermon_id: input.sermonId,
      kind: input.kind,
      payload: input.payload,
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function getLatestAsset(
  sermonId: string,
  kind: SermonAssetKind,
) {
  const supabase = db();
  const { data } = await supabase
    .from("sermon_assets")
    .select("*")
    .eq("sermon_id", sermonId)
    .eq("kind", kind)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return data;
}

export async function listSeries(churchId: string): Promise<SermonSeries[]> {
  const supabase = db();
  const { data, error } = await supabase
    .from("sermon_series")
    .select("*")
    .eq("church_id", churchId)
    .order("updated_at", { ascending: false });

  if (error) throw error;
  return (data ?? []) as SermonSeries[];
}

export async function getSeries(id: string): Promise<SermonSeries | null> {
  const supabase = db();
  const { data, error } = await supabase
    .from("sermon_series")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) throw error;
  return data as SermonSeries | null;
}

export async function createSeries(input: {
  churchId: string;
  title: string;
  theme: string;
  description?: string | null;
  weeks_planned: number;
  plan?: SeriesPlan | null;
}): Promise<SermonSeries> {
  const supabase = db();
  const { data, error } = await supabase
    .from("sermon_series")
    .insert({
      church_id: input.churchId,
      title: input.title,
      theme: input.theme,
      description: input.description ?? null,
      weeks_planned: input.weeks_planned,
      plan: input.plan ?? null,
    })
    .select()
    .single();

  if (error) throw error;
  return data as SermonSeries;
}

export async function updateSeries(
  id: string,
  patch: Partial<{
    title: string;
    theme: string;
    description: string | null;
    weeks_planned: number;
    plan: SeriesPlan | null;
  }>,
): Promise<SermonSeries> {
  const supabase = db();
  const { data, error } = await supabase
    .from("sermon_series")
    .update({
      ...patch,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .select()
    .single();

  if (error) throw error;
  return data as SermonSeries;
}

export function sermonToContext(
  sermon: Sermon,
  settings?: ChurchSettings | null,
) {
  return {
    topic: sermon.topic,
    scripture_refs: sermon.scripture_refs,
    audience: sermon.audience,
    duration_min: sermon.duration_min,
    style_notes: sermon.style_notes,
    denomination: settings?.denomination ?? null,
    preaching_style: settings?.preaching_style ?? null,
  };
}

export async function verifySermonAccess(
  supabase: SupabaseClient,
  sermonId: string,
  churchId: string,
): Promise<Sermon | null> {
  const { data } = await supabase
    .from("sermons")
    .select("*")
    .eq("id", sermonId)
    .eq("church_id", churchId)
    .maybeSingle();

  return data as Sermon | null;
}

export type { AIProvider, SermonBuilderMode, SermonKind };
