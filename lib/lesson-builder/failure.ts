/**
 * Why a lesson from a past sermon failed, for the server log only. People see
 * a plain message; this records the real cause (AI SDK error type, stop
 * reason, token use, which schema fields failed, provider status, database
 * code). It never includes the model's reply or transcript text: AI SDK parse
 * and validation errors embed the whole reply in their message, so only their
 * names and field paths are kept.
 */
export type LessonFailureDetails = {
  stage: string;
  name: string;
  message?: string;
  finishReason?: unknown;
  usage?: unknown;
  cause?: string;
  issues?: string[];
  statusCode?: number;
  code?: string;
};

const MAX_MESSAGE = 300;

type ErrorLike = {
  name?: unknown;
  message?: unknown;
  cause?: unknown;
  finishReason?: unknown;
  usage?: unknown;
  statusCode?: unknown;
  code?: unknown;
  issues?: unknown;
  lastError?: unknown;
};

const asRecord = (value: unknown): ErrorLike | null =>
  value && typeof value === "object" ? (value as ErrorLike) : null;

const nameOf = (value: ErrorLike | null) => (typeof value?.name === "string" ? value.name : "Error");

/** Zod issue paths and codes ("points.0.evidence: too_big"), no values. */
function issuesOf(value: unknown): string[] | undefined {
  for (let current = asRecord(value), depth = 0; current && depth < 4; current = asRecord(current.cause), depth += 1) {
    if (Array.isArray(current.issues)) {
      return current.issues.slice(0, 10).map((issue) => {
        const item = asRecord(issue) as { path?: unknown; code?: unknown } | null;
        const path = Array.isArray(item?.path) ? item.path.join(".") : "";
        return `${path || "(root)"}: ${String(item?.code ?? "invalid")}`;
      });
    }
  }
  return undefined;
}

// Errors whose message contains the model's reply.
const REPLY_IN_MESSAGE = /NoObjectGenerated|JSONParse|TypeValidation/;

export function describeLessonFailure(error: unknown, stage = "unknown"): LessonFailureDetails {
  const outer = asRecord(error);
  // A retried provider call wraps the last real error.
  const err = nameOf(outer) === "AI_RetryError" && outer?.lastError ? asRecord(outer.lastError) : outer;
  if (!err) return { stage, name: typeof error, message: String(error).slice(0, MAX_MESSAGE) };

  const name = nameOf(err);
  const details: LessonFailureDetails = { stage, name };
  if (typeof err.message === "string" && !REPLY_IN_MESSAGE.test(name)) details.message = err.message.slice(0, MAX_MESSAGE);
  if (err.finishReason !== undefined) details.finishReason = err.finishReason;
  if (err.usage !== undefined) details.usage = err.usage;
  if (typeof err.statusCode === "number") details.statusCode = err.statusCode;
  if (typeof err.code === "string") details.code = err.code;
  const cause = asRecord(err.cause);
  if (cause) details.cause = nameOf(cause);
  const issues = issuesOf(err);
  if (issues) details.issues = issues;
  return details;
}

/** Thrown with the stage it happened in, so the route can log where it failed. */
export class LessonStageError extends Error {
  constructor(
    readonly stage: string,
    readonly original: unknown,
  ) {
    super(`lesson from sermon failed at ${stage}`);
    this.name = "LessonStageError";
  }
}
