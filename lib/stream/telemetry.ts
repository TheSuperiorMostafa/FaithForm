/**
 * Structured, low-overhead timing for the live-streaming path.
 *
 * Emits one single-line JSON record per stream request so logs stay grep-able
 * in Vercel. Deliberately records only identifiers and durations — never
 * request bodies, SDP, playlists, tokens, secrets, or viewer-identifying data.
 *
 * High-volume routes (HLS segment proxying) should pass a `sampleRate` so a
 * busy service does not emit one log line per media segment per viewer.
 */

export type StreamErrorCategory =
  | "auth"
  | "config"
  | "upstream_unreachable"
  | "upstream_status"
  | "client_abort"
  | "timeout"
  | "bad_request"
  | "internal";

export type StreamOutcome = "ok" | "error" | "aborted";

type Primitive = string | number | boolean | null | undefined;

export type StreamLogFields = {
  route: string;
  churchId?: string;
  requestId?: string;
  /** 0..1 — fraction of successful requests to log. Errors always log. */
  sampleRate?: number;
  [key: string]: Primitive;
};

export type StreamTimer = {
  /** Record a named checkpoint, in ms since the timer started. */
  mark: (name: string) => void;
  /** Emit the record. Safe to call once; later calls are ignored. */
  end: (
    outcome: StreamOutcome,
    extra?: { category?: StreamErrorCategory } & Record<string, Primitive>,
  ) => void;
  requestId: string;
};

function newRequestId(): string {
  return globalThis.crypto?.randomUUID?.().slice(0, 8) ?? "unknown";
}

export function startStreamTimer(fields: StreamLogFields): StreamTimer {
  const startedAt = performance.now();
  const marks: Record<string, number> = {};
  const { sampleRate = 1, ...rest } = fields;
  const requestId = fields.requestId ?? newRequestId();
  let ended = false;

  const round = (ms: number) => Math.round(ms * 10) / 10;

  return {
    requestId,
    mark(name: string) {
      marks[`t_${name}_ms`] = round(performance.now() - startedAt);
    },
    end(outcome, extra) {
      if (ended) return;
      ended = true;

      // Errors are always logged; successes may be sampled on hot paths.
      if (outcome === "ok" && sampleRate < 1 && Math.random() >= sampleRate) {
        return;
      }

      const record = {
        msg: "stream",
        outcome,
        ...rest,
        requestId,
        ...marks,
        total_ms: round(performance.now() - startedAt),
        ...extra,
      };

      const line = JSON.stringify(record);
      if (outcome === "error") {
        console.error(line);
      } else {
        console.info(line);
      }
    },
  };
}

/** True when a thrown value is a client/server abort rather than a real fault. */
export function isAbortError(error: unknown): boolean {
  return (
    error instanceof DOMException
      ? error.name === "AbortError"
      : error instanceof Error && error.name === "AbortError"
  );
}
