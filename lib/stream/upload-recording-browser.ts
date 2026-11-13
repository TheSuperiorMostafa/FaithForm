import { createClient } from "@supabase/supabase-js";
import { STREAM_RECORDINGS_BUCKET } from "@/lib/stream/recording-storage";

export type RecordingTransferProgress = { loaded: number; total: number };

/** Keep the SDK's signed-upload contract while observing real browser transfer events. */
export function uploadRecordingWithProgress(input: {
  path: string;
  token: string;
  video: Blob;
  onProgress: (progress: RecordingTransferProgress) => void;
}) {
  const progressFetch: typeof fetch = (resource, options) => new Promise((resolve, reject) => {
    const url = typeof resource === "string" ? resource : resource instanceof URL ? resource.href : resource.url;
    if (options?.method !== "PUT" || !(options.body instanceof FormData)) {
      reject(new TypeError("Recording upload request is unavailable."));
      return;
    }
    const xhr = new XMLHttpRequest();
    let loaded = 0;
    let total = input.video.size;
    input.onProgress({ loaded, total });
    xhr.upload.onprogress = event => {
      if (!event.lengthComputable || !Number.isFinite(event.total) || event.total <= 0 || !Number.isFinite(event.loaded)) return;
      total = event.total;
      loaded = Math.min(total, Math.max(loaded, event.loaded));
      input.onProgress({ loaded, total });
    };
    xhr.onload = () => {
      // Sending the final byte is not success until Storage acknowledges it.
      if (xhr.status >= 200 && xhr.status < 300) input.onProgress({ loaded: total, total });
      const headers = new Headers();
      for (const line of xhr.getAllResponseHeaders().trim().split(/[\r\n]+/)) {
        const colon = line.indexOf(":");
        if (colon > 0) headers.append(line.slice(0, colon), line.slice(colon + 1).trim());
      }
      try {
        resolve(new Response(xhr.responseText || null, { status: xhr.status, statusText: xhr.statusText, headers }));
      } catch { reject(new TypeError("Recording upload response is unavailable.")); }
    };
    xhr.onerror = xhr.ontimeout = xhr.onabort = () => reject(new TypeError("Recording upload connection interrupted."));
    xhr.open("PUT", url);
    new Headers(options.headers).forEach((value, key) => xhr.setRequestHeader(key, value));
    xhr.send(options.body);
  });

  // The server has already authorized this exact private object and signed it.
  // No second auth session, cookie store or privileged key is needed here.
  const storage = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY)!,
    { accessToken: async () => null, global: { fetch: progressFetch } },
  ).storage;
  return storage.from(STREAM_RECORDINGS_BUCKET).uploadToSignedUrl(input.path, input.token, input.video, { upsert: false });
}
