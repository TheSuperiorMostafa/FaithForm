import type { SupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

import { identityMatches, responseIdentity } from "@/lib/media/v1/rendition-check";
import { isRecordingStoragePathForChurch, STREAM_RECORDINGS_BUCKET } from "@/lib/stream/recording-storage";
import { createAdminClient } from "@/lib/supabase/admin";

const NO_STORE = "private, no-cache, no-store, must-revalidate";

function unavailable(status = 403) {
  return NextResponse.json({ error: "Playback unavailable" }, {
    status, headers: { "Cache-Control": NO_STORE },
  });
}

/** A verified public capability still needs current publication on every range. */
export async function webRecordingFileResponse(input: {
  request: Request;
  churchId: string;
  recordingId: string;
  client?: SupabaseClient;
  fetcher?: typeof fetch;
}): Promise<NextResponse> {
  const client = input.client ?? createAdminClient();
  const { data: church, error: churchError } = await client.from("churches")
    .select("slug").eq("id", input.churchId).maybeSingle();
  if (churchError || !church?.slug) return unavailable();
  const { data: published, error: publicationError } = await client.rpc("web_recordings", {
    p_church_slug: church.slug, p_recording_id: input.recordingId, p_limit: 1,
  });
  const row = ((published ?? []) as Array<Record<string, unknown>>).find(
    (item) => item.id === input.recordingId && item.church_id === input.churchId && item.source_kind === "file",
  );
  if (publicationError || !row || typeof row.storage_path !== "string" ||
      !isRecordingStoragePathForChurch(row.storage_path, input.churchId)) return unavailable();

  const { data: verified, error: identityError } = await client.from("stream_recordings")
    .select("storage_path, mobile_rendition_object_etag, mobile_rendition_object_version, mobile_rendition_object_size")
    .eq("id", input.recordingId).eq("church_id", input.churchId).maybeSingle();
  if (identityError || !verified || verified.storage_path !== row.storage_path) return unavailable();
  const identity = {
    etag: verified.mobile_rendition_object_etag as string | null,
    versionId: verified.mobile_rendition_object_version as string | null,
    sizeBytes: verified.mobile_rendition_object_size as number | null,
    windowHash: null,
  };
  // The web projection requires mobile_playable, whose database constraint
  // requires one of these discriminators. Refuse inconsistent legacy rows
  // rather than silently authorizing mutable storage paths without evidence.
  if (identity.etag == null && identity.versionId == null && identity.sizeBytes == null) return unavailable();
  const { data: signed, error: signingError } = await client.storage.from(STREAM_RECORDINGS_BUCKET)
    .createSignedUrl(row.storage_path, 60);
  if (signingError || !signed?.signedUrl) return unavailable(503);
  const headers = new Headers();
  const range = input.request.headers.get("range");
  if (range) headers.set("Range", range);
  if (identity.etag) headers.set("If-Match", identity.etag);
  let upstream: Response;
  try {
    upstream = await (input.fetcher ?? fetch)(signed.signedUrl, {
      headers, cache: "no-store", signal: input.request.signal,
    });
  } catch {
    return unavailable(input.request.signal.aborted ? 499 : 502);
  }
  if (upstream.status === 416) {
    await upstream.body?.cancel();
    const responseHeaders = new Headers({ "Cache-Control": NO_STORE, "Accept-Ranges": "bytes" });
    const contentRange = upstream.headers.get("content-range");
    if (contentRange) responseHeaders.set("Content-Range", contentRange);
    return new NextResponse(null, { status: 416, headers: responseHeaders });
  }
  if (!upstream.ok || !identityMatches(identity, responseIdentity(upstream.headers))) {
    await upstream.body?.cancel();
    return unavailable(upstream.status === 412 || upstream.ok ? 403 : 502);
  }
  const responseHeaders = new Headers({
    "Content-Type": upstream.headers.get("content-type") ?? "video/mp4",
    "Accept-Ranges": "bytes", "Cache-Control": NO_STORE,
    "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer",
  });
  for (const name of ["content-length", "content-range"]) {
    const value = upstream.headers.get(name);
    if (value) responseHeaders.set(name, value);
  }
  return new NextResponse(upstream.body, { status: upstream.status, headers: responseHeaders });
}
