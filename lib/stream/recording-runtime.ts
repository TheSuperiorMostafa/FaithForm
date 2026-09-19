import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { z } from "zod";

import { authenticateRelayRequest } from "@/lib/stream/relay-auth";
import { parseStreamPath } from "@/lib/stream/relay";
import { logRecordingEvent, type LifecycleDeps } from "@/lib/stream/recording-lifecycle";
import { autoPublishRecording } from "@/lib/stream/recording-publication";
import {
  createSupabaseRecordingRepo,
  createSupabaseRecordingStorage,
  recordRelayNonce,
} from "@/lib/stream/recording-repo";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Production wiring for the recording lifecycle: the Supabase repository and
 * storage, and auto-publish through the real publisher.
 */
export function productionLifecycleDeps(client?: SupabaseClient): LifecycleDeps {
  const db = client ?? createAdminClient();
  return {
    repo: createSupabaseRecordingRepo(db),
    storage: createSupabaseRecordingStorage(db),
    autoPublish: async (recording) => {
      await autoPublishRecording(recording, db);
    },
  };
}

const NO_STORE = { "Cache-Control": "no-store" };

/**
 * The one front door for relay callbacks.
 *
 * Authenticate (signature, freshness, single use) → validate (schema) →
 * resolve the church from the MediaMTX path and check it against FaithForm's
 * own mapping → run the handler. A church id that arrives in a body is never
 * trusted: the only church a relay call can act for is the one whose ingest
 * path MediaMTX authorized, and only if FaithForm agrees that church streams.
 *
 * Failures answer with a class, never a reason an attacker could iterate on.
 */
export async function handleRelayCall<S extends z.ZodType<{ path: string }>, R>(
  request: Request,
  options: {
    route: string;
    schema: S;
    allowLegacySecret?: boolean;
    deps?: LifecycleDeps;
  },
  handler: (input: {
    deps: LifecycleDeps;
    churchId: string;
    body: z.infer<S>;
  }) => Promise<R>,
): Promise<NextResponse> {
  const auth = await authenticateRelayRequest(request, {
    route: options.route,
    allowLegacySecret: options.allowLegacySecret ?? false,
    ledger: (input) => recordRelayNonce(input),
  });
  if (!auth.ok) {
    logRecordingEvent(auth.status === 409 ? "webhook_duplicate" : "webhook_rejected", {
      route: options.route,
      status: auth.status,
    });
    return NextResponse.json({ error: auth.error }, { status: auth.status, headers: NO_STORE });
  }

  const parsed = options.schema.safeParse(auth.json);
  if (!parsed.success) {
    logRecordingEvent("webhook_rejected", { route: options.route, status: 400, reason: "schema" });
    return NextResponse.json({ error: "Invalid payload" }, { status: 400, headers: NO_STORE });
  }

  const path = parseStreamPath(parsed.data.path);
  if (!path || path.legacyCredentialInPath) {
    logRecordingEvent("webhook_rejected", { route: options.route, status: 400, reason: "path" });
    return NextResponse.json({ error: "Invalid stream path" }, { status: 400, headers: NO_STORE });
  }

  const deps = options.deps ?? productionLifecycleDeps();
  if (!(await deps.repo.churchHasStreamIngest(path.churchId))) {
    logRecordingEvent("webhook_rejected", { route: options.route, status: 404, reason: "unmapped" });
    return NextResponse.json({ error: "Not found" }, { status: 404, headers: NO_STORE });
  }

  try {
    const result = await handler({ deps, churchId: path.churchId, body: parsed.data });
    return NextResponse.json(result, { headers: NO_STORE });
  } catch (error) {
    // The relay retries a 5xx; the reconciler covers anything that never
    // succeeds. The message stays in the server log, never in the response.
    logRecordingEvent("webhook_failed", {
      route: options.route,
      churchId: path.churchId,
      error: error instanceof Error ? error.message.slice(0, 300) : "unknown",
    });
    return NextResponse.json({ error: "Try again" }, { status: 503, headers: NO_STORE });
  }
}
