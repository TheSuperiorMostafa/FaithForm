import { getLinkedServices, type LinkedServiceDto } from "@/lib/sermons/v1/service-links";
import { createAdminClient } from "@/lib/supabase/admin";
import { VisitorError } from "@/lib/faithform/errors";
import { isChurchFeatureEnabled } from "@/lib/features/access";
import { resolvePublishedContentRelationshipState } from "@/lib/mobile/v1/discovery-service";
import {
  projectOutline,
  projectQuestions,
  type SermonOutlineDto,
  type SermonQuestionDto,
} from "@/lib/sermons/v1/projection";
import { getThemeAsync } from "@/lib/queries/slide-themes";
import {
  snapshotTheme,
  type PresentationThemeSnapshot,
} from "@/lib/sermons/v1/presentation-manifest";

export type {
  SermonOutlineDto,
  SermonPointDto,
  SermonQuestionDto,
} from "@/lib/sermons/v1/projection";

/**
 * The FaithForm sermon surface: the notes a church chose to hand out.
 *
 * Deliberately a much smaller projection than the Sermon Builder's own row. A
 * sermon record carries the preacher's manuscript, the style notes they wrote
 * for themselves, the audience they aimed at and the model that drafted it —
 * none of which a congregation should read. What is offered here is the
 * outline, which is the shape a sermon was meant to be followed by, and the
 * discussion questions, which exist to be handed out.
 *
 * As with media, every filter is re-applied on every call and the projections
 * live in SQL (`mobile_sermon_*`, migrations 0068 and 0075), so a filter cannot
 * be forgotten at a second call site.
 *
 * ## Failures are failures
 *
 * A projection that errors — most often a database that has not run the
 * migration, so the function does not exist — is reported as `unavailable`,
 * never as an empty page. An empty page reads as "your church has shared no
 * sermon notes", which is a claim about the church, and a false one.
 */

const NOT_FOUND = "church_not_found" as const;
const UNAVAILABLE_MESSAGE = "Sermon notes are unavailable right now.";

type RpcError = { code?: string | null; message?: string | null };

function unavailable(where: string, error: RpcError): never {
  console.error(
    `[sermons/v1] ${where} failed:`,
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
  // A hidden church, an unknown slug and a blocked visitor must be one answer.
  if (!data) throw new VisitorError(NOT_FOUND, "Church not found.");
  return { id: data.id as string };
}

/**
 * Sermon notes are a Sermon Builder output. When a church no longer has the
 * Sermon Builder, its dashboard section — and with it the button to take a
 * sermon out of the app — is locked, so the app stops showing them too rather
 * than leaving notes nobody can manage. Switching the feature back on restores
 * exactly what was shared.
 */
async function sermonsEnabledFor(churchId: string): Promise<boolean> {
  return isChurchFeatureEnabled(churchId, "sermon_builder");
}

export type SermonListItemDto = {
  sermonId: string;
  title: string;
  summary: string | null;
  /** When it was first shared, as an RFC 3339 UTC instant. */
  publishedAt: string;
  /**
   * The day it was preached: the date recorded when sharing, else the sermon's
   * own date in the builder. The list is ordered by this.
   */
  preachedOn: string | null;
  scriptureRefs: string[];
  seriesName: string | null;
  publicationVersion: number;
  churchSlug: string;
  churchName: string;
  churchTimezone: string;
  theme?: PresentationThemeSnapshot | null;
  thumbnailUrl?: string | null;
};

export type SermonDetailDto = SermonListItemDto & {
  linkedServices?: LinkedServiceDto[];
  outline: SermonOutlineDto | null;
  discussionQuestions: SermonQuestionDto[];
};

/**
 * PostgREST returns `timestamptz` as `2026-09-13T14:03:22.123456+00:00`. The
 * contract promises a UTC instant ending in `Z`, and a strict client parser
 * rejects the other form, so it is normalised here once.
 */
function utcInstant(value: unknown): string {
  if (typeof value !== "string") return String(value ?? "");
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString();
}

function projectListItem(
  row: Record<string, unknown>,
  churchSlug: string,
  extra?: { theme: PresentationThemeSnapshot | null; thumbnailUrl: string | null },
): SermonListItemDto {
  const theme = (row.theme_snapshot as PresentationThemeSnapshot | null) ?? extra?.theme ?? null;
  const thumbnailUrl =
    (row.thumbnail_url as string | null) ??
    extra?.thumbnailUrl ??
    theme?.imageUrl ??
    null;

  return {
    sermonId: row.id as string,
    title: row.title as string,
    summary: (row.summary as string | null) ?? null,
    publishedAt: utcInstant(row.published_at),
    preachedOn: (row.preached_on as string | null) ?? null,
    scriptureRefs: (row.scripture_refs as string[] | null) ?? [],
    seriesName: (row.series_name as string | null) ?? null,
    publicationVersion: Number(row.publication_version ?? 1),
    churchSlug,
    churchName: row.church_name as string,
    churchTimezone: (row.church_timezone as string) ?? "America/New_York",
    theme: theme ?? null,
    thumbnailUrl: thumbnailUrl ?? null,
  };
}

async function sermonVersion(
  churchSlug: string,
  relationshipState: string | null,
): Promise<number> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("mobile_sermon_version", {
    p_church_slug: churchSlug,
    p_relationship_state: relationshipState,
  });
  if (error) unavailable("mobile_sermon_version", error);
  return Number(data ?? 0);
}

/** A position in the history: the sort date, then the first-shared instant. */
export type SermonCursor = { preachedOn: string; publishedAt: string; id: string };

export async function getSermonArchivePage(input: {
  userId: string | null;
  churchSlug: string;
  limit: number;
  cursor: SermonCursor | null;
  query: string | null;
}): Promise<{
  items: SermonListItemDto[];
  nextCursor: SermonCursor | null;
  version: number;
}> {
  const church = await requireChurch(input.churchSlug);
  const relationshipState = await resolvePublishedContentRelationshipState(
    input.userId,
    input.churchSlug,
  );

  if (!(await sermonsEnabledFor(church.id))) {
    return { items: [], nextCursor: null, version: 0 };
  }

  const admin = createAdminClient();
  // One more than the page, so "is there another page" needs no second query.
  // The SQL cap is the largest page plus this one row (migration 0075).
  const overfetch = input.limit + 1;

  const [{ data, error }, version] = await Promise.all([
    admin.rpc("mobile_sermon_archive", {
      p_church_slug: input.churchSlug,
      p_relationship_state: relationshipState,
      p_query: input.query,
      p_cursor_preached: input.cursor?.preachedOn ?? null,
      p_cursor_published: input.cursor?.publishedAt ?? null,
      p_cursor_id: input.cursor?.id ?? null,
      p_limit: overfetch,
    }),
    sermonVersion(input.churchSlug, relationshipState),
  ]);
  if (error) unavailable("mobile_sermon_archive", error);

  const rows = (data ?? []) as Record<string, unknown>[];
  const page = rows.slice(0, input.limit);
  const last = page.at(-1);

  const sermonIds = page.map((r) => r.id as string).filter(Boolean);
  const themeMap = new Map<string, { theme: PresentationThemeSnapshot | null; thumbnailUrl: string | null }>();
  if (sermonIds.length > 0) {
    const { data: verRows } = await admin
      .from("sermon_presentation_versions")
      .select("sermon_id, theme_snapshot, renditions")
      .in("sermon_id", sermonIds)
      .neq("mobile_visibility", "none")
      .is("unpublished_at", null)
      .order("version", { ascending: false });
    if (verRows) {
      for (const vr of verRows) {
        if (!themeMap.has(vr.sermon_id as string)) {
          const theme = vr.theme_snapshot as PresentationThemeSnapshot | null;
          const renditions = vr.renditions as { slides?: Array<{ imageUrl?: string }> } | null;
          themeMap.set(vr.sermon_id as string, {
            theme,
            thumbnailUrl: renditions?.slides?.[0]?.imageUrl ?? theme?.imageUrl ?? null,
          });
        }
      }
    }

    const missingIds = sermonIds.filter((id) => !themeMap.has(id));
    if (missingIds.length > 0) {
      const { data: sRows } = await admin
        .from("sermons")
        .select("id, theme_id")
        .in("id", missingIds);
      if (sRows) {
        for (const s of sRows) {
          if (s.theme_id) {
            try {
              const t = await getThemeAsync(s.theme_id);
              if (t) {
                const snap = snapshotTheme(t);
                themeMap.set(s.id as string, {
                  theme: snap,
                  thumbnailUrl: snap?.imageUrl ?? null,
                });
              }
            } catch {
              // Non-fatal if theme not found
            }
          }
        }
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
            preachedOn: String(last.cursor_preached),
            // Kept exactly as the database wrote it: the cursor goes straight
            // back into a comparison, and a reformatted instant could lose
            // the microseconds that separate two rows.
            publishedAt: String(last.cursor_published),
            id: last.cursor_id as string,
          }
        : null,
  };
}

/**
 * One published sermon.
 *
 * Every filter the list applied is applied again rather than assumed from the
 * fact that a list once carried this id: a device holding a stale list must not
 * be able to open a sermon the church has since unpublished.
 */
export async function getSermonDetail(input: {
  userId: string | null;
  churchSlug: string;
  sermonId: string;
}): Promise<SermonDetailDto | null> {
  const church = await requireChurch(input.churchSlug);
  const relationshipState = await resolvePublishedContentRelationshipState(
    input.userId,
    input.churchSlug,
  );

  if (!(await sermonsEnabledFor(church.id))) return null;

  const admin = createAdminClient();
  const { data, error } = await admin.rpc("mobile_sermon_detail", {
    p_church_slug: input.churchSlug,
    p_relationship_state: relationshipState,
    p_sermon_id: input.sermonId,
  });
  if (error) unavailable("mobile_sermon_detail", error);

  const row = ((data ?? []) as Record<string, unknown>[])[0];
  if (!row) return null;

  return {
    linkedServices: await getLinkedServices(input.churchSlug, relationshipState, { sermonId: input.sermonId }),
    ...projectListItem(row, input.churchSlug),
    outline: projectOutline(row.outline),
    discussionQuestions: projectQuestions(row.discussion_questions),
  };
}

/**
 * Exposed for tests only.
 *
 * The two projections are the privacy boundary of this whole feature — they
 * decide what of a preacher's working document a congregation can read — so
 * they are tested directly rather than through a database round trip.
 */
export const __testing = { projectOutline, projectQuestions, utcInstant };
