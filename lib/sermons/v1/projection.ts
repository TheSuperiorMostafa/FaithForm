/**
 * What of a sermon a congregation is allowed to read, as pure functions.
 *
 * Kept free of any database or server import so the dashboard's share card can
 * ask "would the app show anything?" with exactly the rule the mobile service
 * applies — the two cannot drift, because there is only one of each.
 */

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
export function projectOutline(raw: unknown): SermonOutlineDto | null {
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
export function projectQuestions(raw: unknown): SermonQuestionDto[] {
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
