import { createAdminClient } from "@/lib/supabase/admin";
import { isChurchFeatureEnabled } from "@/lib/features/access";
import { VisitorError } from "@/lib/faithform/errors";

export type LinkedPresentationDto = { presentationId: string; sermonId: string; title: string };
export type LinkedServiceDto = {
  mediaId: string;
  kind: "live" | "recording";
  title: string;
  startsAt: string;
  posterUrl: string | null;
};

async function enabled(slug: string, feature: "sermon_builder" | "live_stream") {
  const { data, error } = await createAdminClient().from("churches").select("id").eq("slug", slug).maybeSingle();
  if (error) throw new VisitorError("unavailable", "Related service content is unavailable.");
  if (!data) return false;
  const flags = await Promise.all([
    isChurchFeatureEnabled(data.id, feature),
    isChurchFeatureEnabled(data.id, "member_app"),
  ]);
  return flags.every(Boolean);
}

export async function getLinkedPresentation(churchSlug: string, relationship: string | null, kind: "live" | "recording", mediaId: string): Promise<LinkedPresentationDto | null> {
  if (!(await enabled(churchSlug, "sermon_builder"))) return null;
  const { data, error } = await createAdminClient().rpc("mobile_media_presentation", {
    p_church_slug: churchSlug, p_relationship_state: relationship, p_kind: kind, p_media_id: mediaId,
  });
  if (error) throw new VisitorError("unavailable", "Related presentation is unavailable.");
  const row = data?.[0];
  return row ? { presentationId: row.presentation_id, sermonId: row.sermon_id, title: row.title } : null;
}

export async function getLinkedServices(churchSlug: string, relationship: string | null, source: { sermonId: string } | { presentationId: string }): Promise<LinkedServiceDto[]> {
  if (!(await enabled(churchSlug, "live_stream"))) return [];
  const { data, error } = await createAdminClient().rpc("mobile_sermon_services", {
    p_church_slug: churchSlug, p_relationship_state: relationship,
    p_sermon_id: "sermonId" in source ? source.sermonId : null,
    p_presentation_id: "presentationId" in source ? source.presentationId : null,
  });
  if (error) throw new VisitorError("unavailable", "Related services are unavailable.");
  return (data ?? []).map((row: Record<string, unknown>) => ({
    mediaId: row.media_id as string, kind: row.kind as "live" | "recording", title: row.title as string,
    startsAt: new Date(row.starts_at as string).toISOString(), posterUrl: (row.poster_url as string | null) ?? null,
  }));
}
