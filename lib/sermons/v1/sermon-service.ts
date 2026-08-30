import { createAdminClient } from "@/lib/supabase/admin";
import { VisitorError } from "@/lib/faithful/errors";
import { resolveRelationshipState } from "@/lib/mobile/v1/discovery-service";

/**
 * The Faithful sermon surface: the notes a church chose to hand out.
 *
 * Deliberately a much smaller projection than the Sermon Builder's own row. A
 * sermon record carries the preacher's manuscript, the style notes they wrote
 * for themselves, the audience they aimed at and the model that drafted it —
 * none of which a congregation should read. What is offered here is the
 * outline, which is the shape a sermon was meant to be followed by, and the
 * discussion questions, which exist to be handed out.
 *
 * As with media, every filter is re-applied on every call and the projections
 * live in SQL (`mobile_sermon_*`, migration 0068), so a filter cannot be
 * forgotten at a second call site.
 */

const NOT_FOUND = "church_not_found" as const;

async function requireChurchSlug(slug: string): Promise<void> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("churches")
    .select("id")
    .eq("slug", slug)
    .maybeSingle();
  // A hidden church, an unknown slug and a blocked visitor must be one answer.
  if (!data) throw new VisitorError(NOT_FOUND, "Church not found.");
}

export type SermonPointDto = {
  title: string;
  summary: string;
  scripture: string | null;
};

export type SermonOutlineDto = {
  intro: string | null;
  points: SermonPointDto[];
  application: string | null;
  closing: string | null;
};

export type SermonQuestionDto = {
  category: string;
  question: string;
};

export type SermonListItemDto = {
  sermonId: string;
  title: string;
  summary: string | null;
  publishedAt: string;
  /** The day it was preached, when the church recorded one. */
  preachedOn: string | null;
  scriptureRefs: string[];
  seriesName: string | null;
  publicationVersion: number;
  churchSlug: string;
  churchName: string;
  churchTimezone: string;
};

export type SermonDetailDto = SermonListItemDto & {
  outline: SermonOutlineDto | null;
  discussionQuestions: SermonQuestionDto[];
};

function text(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Reads the outline through an explicit allowlist.
 *
 * The column is free-form JSONB written by a generator, so "return what is
 * there" would mean shipping whatever a future prompt happens to add to it.
 * Only these four fields — and only `title`, `summary` and `scripture` within a
 * point — ever reach a phone.
 */
function projectOutline(raw: unknown): SermonOutlineDto | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const source = raw as Record<string, unknown>;

  const points = Array.isArray(source.points)
    ? source.points.flatMap((entry): SermonPointDto[] => {
        if (!entry || typeof entry !== "object") return [];
        const point = entry as Record<string, unknown>;
        const title = text(point.title);
        // A point with no heading is a formatting artefact, not a point.
        if (!title) return [];
        return [
          {
            title,
            summary: text(point.summary) ?? text(point.body) ?? "",
            scripture: text(point.scripture),
          },
        ];
      })
    : [];

  const intro = text(source.intro);
  const application = text(source.application);
  const closing = text(source.closing);

  // An outline that survived the allowlist with nothing in it is not an
  // outline; returning null lets the app show its "notes only" state rather
  // than an empty scaffold.
  if (!intro && !application && !closing && points.length === 0) return null;

  return { intro, points, application, closing };
}

/**
 * Discussion questions as the builder stores them: `{ questions: [...] }`, or a
 * bare array from an older asset. Anything else is treated as absent.
 */
function projectQuestions(raw: unknown): SermonQuestionDto[] {
  const list = Array.isArray(raw)
    ? raw
    : raw && typeof raw === "object" && Array.isArray((raw as Record<string, unknown>).questions)
      ? ((raw as Record<string, unknown>).questions as unknown[])
      : [];

  return list.flatMap((entry): SermonQuestionDto[] => {
    if (typeof entry === "string") {
      const question = text(entry);
      return question ? [{ category: "general", question }] : [];
    }
    if (!entry || typeof entry !== "object") return [];
    const row = entry as Record<string, unknown>;
    const question = text(row.question);
    if (!question) return [];
    return [{ category: text(row.category) ?? "general", question }];
  });
}

function projectListItem(
  row: Record<string, unknown>,
  churchSlug: string,
): SermonListItemDto {
  return {
    sermonId: row.id as string,
    title: row.title as string,
    summary: (row.summary as string | null) ?? null,
    publishedAt: row.published_at as string,
    preachedOn: (row.preached_on as string | null) ?? null,
    scriptureRefs: (row.scripture_refs as string[] | null) ?? [],
    seriesName: (row.series_name as string | null) ?? null,
    publicationVersion: Number(row.publication_version ?? 1),
    churchSlug,
    churchName: row.church_name as string,
    churchTimezone: (row.church_timezone as string) ?? "America/New_York",
  };
}

async function sermonVersion(
  churchSlug: string,
  relationshipState: string | null,
): Promise<number> {
  const admin = createAdminClient();
  const { data } = await admin.rpc("mobile_sermon_version", {
    p_church_slug: churchSlug,
    p_relationship_state: relationshipState,
  });
  return Number(data ?? 0);
}

export type SermonCursor = { publishedAt: string; id: string };

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
  await requireChurchSlug(input.churchSlug);
  const relationshipState = await resolveRelationshipState(
    input.userId,
    input.churchSlug,
  );

  const admin = createAdminClient();
  // One more than the page, so "is there another page" needs no second query.
  const overfetch = input.limit + 1;

  const [{ data }, version] = await Promise.all([
    admin.rpc("mobile_sermon_archive", {
      p_church_slug: input.churchSlug,
      p_relationship_state: relationshipState,
      p_query: input.query,
      p_cursor_published: input.cursor?.publishedAt ?? null,
      p_cursor_id: input.cursor?.id ?? null,
      p_limit: overfetch,
    }),
    sermonVersion(input.churchSlug, relationshipState),
  ]);

  const rows = (data ?? []) as Record<string, unknown>[];
  const page = rows.slice(0, input.limit);
  const last = page.at(-1);

  return {
    version,
    items: page.map((row) => projectListItem(row, input.churchSlug)),
    nextCursor:
      rows.length > input.limit && last
        ? {
            publishedAt: last.cursor_published as string,
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
  await requireChurchSlug(input.churchSlug);
  const relationshipState = await resolveRelationshipState(
    input.userId,
    input.churchSlug,
  );

  const admin = createAdminClient();
  const { data } = await admin.rpc("mobile_sermon_detail", {
    p_church_slug: input.churchSlug,
    p_relationship_state: relationshipState,
    p_sermon_id: input.sermonId,
  });

  const row = ((data ?? []) as Record<string, unknown>[])[0];
  if (!row) return null;

  return {
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
export const __testing = { projectOutline, projectQuestions };
