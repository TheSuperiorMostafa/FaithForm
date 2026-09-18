import { createAdminClient } from "@/lib/supabase/admin";
import { VisitorError } from "@/lib/faithform/errors";
import { isChurchFeatureEnabled } from "@/lib/features/access";
import { resolvePublishedContentRelationshipState } from "@/lib/mobile/v1/discovery-service";
import type {
  PresentationManifest,
  PresentationPage,
  PresentationThemeSnapshot,
} from "@/lib/sermons/v1/presentation-manifest";

/**
 * The FaithForm presentation surface: published slide decks, never the live
 * sermon draft. Visibility rules match sermon notes (relationship +
 * mobile_visibility); capability reuses `sermons` because both live under the
 * same church feature and destination family.
 */

const NOT_FOUND = "church_not_found" as const;
const UNAVAILABLE_MESSAGE = "Sermon presentations are unavailable right now.";

type RpcError = { code?: string | null; message?: string | null };

function unavailable(where: string, error: RpcError): never {
  console.error(
    `[presentations/v1] ${where} failed:`,
    error.code ?? "",
    error.message ?? "",
  );
  throw new VisitorError("unavailable", UNAVAILABLE_MESSAGE);
}

async function requireChurch(slug: string): Promise<{ id: string }> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("churches")
    .select("id")
    .eq("slug", slug)
    .maybeSingle();
  if (error) unavailable("church lookup", error);
  if (!data) throw new VisitorError(NOT_FOUND, "Church not found.");
  return { id: data.id as string };
}

/**
 * Presentations are a Sermon Builder output delivered through the member app.
 * Either feature off means the archive is empty rather than unmanageable.
 */
async function presentationsEnabledFor(churchId: string): Promise<boolean> {
  const [builder, memberApp] = await Promise.all([
    isChurchFeatureEnabled(churchId, "sermon_builder"),
    isChurchFeatureEnabled(churchId, "member_app"),
  ]);
  return builder && memberApp;
}

export type PresentationListItemDto = {
  presentationId: string;
  sermonId: string;
  version: number;
  title: string;
  publishedAt: string;
  pageCount: number;
  contentHash: string;
  scriptureRefs: string[];
  seriesName: string | null;
  churchSlug: string;
  churchName: string;
  churchTimezone: string;
  theme?: PresentationThemeSnapshot | null;
  thumbnailUrl?: string | null;
};

export type PresentationDetailDto = PresentationListItemDto & {
  pages: PresentationPage[];
  theme: PresentationThemeSnapshot | null;
  renditions: { slides: Array<{ pageId: string; imagePath?: string; imageUrl?: string }>; pdfPath?: string };
};

function utcInstant(value: unknown): string {
  if (typeof value !== "string") return String(value ?? "");
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString();
}

function projectListItem(
  row: Record<string, unknown>,
  churchSlug: string,
  extra?: { theme: PresentationThemeSnapshot | null; thumbnailUrl: string | null },
): PresentationListItemDto {
  const theme = (row.theme_snapshot as PresentationThemeSnapshot | null) ?? extra?.theme ?? null;
  const renditions = row.renditions as { slides?: Array<{ imageUrl?: string }> } | null;
  const thumbnailUrl =
    (row.thumbnail_url as string | null) ??
    renditions?.slides?.[0]?.imageUrl ??
    extra?.thumbnailUrl ??
    theme?.imageUrl ??
    null;

  return {
    presentationId: row.id as string,
    sermonId: row.sermon_id as string,
    version: Number(row.version ?? 1),
    title: row.title as string,
    publishedAt: utcInstant(row.published_at),
    pageCount: Number(row.page_count ?? 0),
    contentHash: (row.content_hash as string) ?? "",
    scriptureRefs: (row.scripture_refs as string[] | null) ?? [],
    seriesName: (row.series_name as string | null) ?? null,
    churchSlug,
    churchName: row.church_name as string,
    churchTimezone: (row.church_timezone as string) ?? "America/New_York",
    theme: theme ?? null,
    thumbnailUrl: thumbnailUrl ?? null,
  };
}

function projectPages(manifest: unknown): PresentationPage[] {
  const pages = (manifest as PresentationManifest | null)?.pages;
  if (!Array.isArray(pages)) return [];
  return pages.filter(
    (p): p is PresentationPage =>
      Boolean(p) &&
      typeof p === "object" &&
      typeof (p as PresentationPage).id === "string" &&
      typeof (p as PresentationPage).kind === "string" &&
      Array.isArray((p as PresentationPage).readingOrder),
  );
}

async function presentationVersion(
  churchSlug: string,
  relationshipState: string | null,
): Promise<number> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("mobile_presentation_version", {
    p_church_slug: churchSlug,
    p_relationship_state: relationshipState,
  });
  if (error) unavailable("mobile_presentation_version", error);
  return Number(data ?? 0);
}

export type PresentationCursor = { publishedAt: string; id: string };

export async function getPresentationArchivePage(input: {
  userId: string | null;
  churchSlug: string;
  limit: number;
  cursor: PresentationCursor | null;
  query: string | null;
}): Promise<{
  items: PresentationListItemDto[];
  nextCursor: PresentationCursor | null;
  version: number;
}> {
  const church = await requireChurch(input.churchSlug);
  const relationshipState = await resolvePublishedContentRelationshipState(
    input.userId,
    input.churchSlug,
  );

  if (!(await presentationsEnabledFor(church.id))) {
    return { items: [], nextCursor: null, version: 0 };
  }

  const admin = createAdminClient();
  const overfetch = input.limit + 1;

  const [{ data, error }, version] = await Promise.all([
    admin.rpc("mobile_presentation_archive", {
      p_church_slug: input.churchSlug,
      p_relationship_state: relationshipState,
      p_query: input.query,
      p_cursor_published: input.cursor?.publishedAt ?? null,
      p_cursor_id: input.cursor?.id ?? null,
      p_limit: overfetch,
    }),
    presentationVersion(input.churchSlug, relationshipState),
  ]);
  if (error) unavailable("mobile_presentation_archive", error);

  const rows = (data ?? []) as Record<string, unknown>[];
  const page = rows.slice(0, input.limit);
  const last = page.at(-1);

  const ids = page.map((r) => r.id as string).filter(Boolean);
  const themeMap = new Map<string, { theme: PresentationThemeSnapshot | null; thumbnailUrl: string | null }>();
  if (ids.length > 0 && page.some((r) => !r.theme_snapshot)) {
    const { data: verRows } = await admin
      .from("sermon_presentation_versions")
      .select("id, theme_snapshot, renditions")
      .in("id", ids);
    if (verRows) {
      for (const vr of verRows) {
        const theme = vr.theme_snapshot as PresentationThemeSnapshot | null;
        const renditions = vr.renditions as { slides?: Array<{ imageUrl?: string }> } | null;
        themeMap.set(vr.id as string, {
          theme,
          thumbnailUrl: renditions?.slides?.[0]?.imageUrl ?? theme?.imageUrl ?? null,
        });
      }
    }
  }

  return {
    version,
    items: page.map((row) =>
      projectListItem(row, input.churchSlug, themeMap.get(row.id as string)),
    ),
    nextCursor:
      rows.length > input.limit && last
        ? {
            publishedAt: String(last.cursor_published),
            id: last.cursor_id as string,
          }
        : null,
  };
}

export async function getPresentationDetail(input: {
  userId: string | null;
  churchSlug: string;
  presentationId: string;
}): Promise<PresentationDetailDto | null> {
  const church = await requireChurch(input.churchSlug);
  const relationshipState = await resolvePublishedContentRelationshipState(
    input.userId,
    input.churchSlug,
  );

  if (!(await presentationsEnabledFor(church.id))) return null;

  const admin = createAdminClient();
  const { data, error } = await admin.rpc("mobile_presentation_detail", {
    p_church_slug: input.churchSlug,
    p_relationship_state: relationshipState,
    p_presentation_id: input.presentationId,
  });
  if (error) unavailable("mobile_presentation_detail", error);

  const row = ((data ?? []) as Record<string, unknown>[])[0];
  if (!row) return null;

  const renditionsRaw = row.renditions as PresentationDetailDto["renditions"] | null;
  const pages = projectPages(row.manifest);

  return {
    ...projectListItem(row, input.churchSlug),
    pageCount: pages.length || Number(row.page_count ?? 0),
    pages,
    theme: (row.theme_snapshot as PresentationThemeSnapshot | null) ?? null,
    renditions: {
      slides: Array.isArray(renditionsRaw?.slides) ? renditionsRaw.slides : [],
      pdfPath: renditionsRaw?.pdfPath,
    },
  };
}

export const __testing = { projectPages, projectListItem, utcInstant };
