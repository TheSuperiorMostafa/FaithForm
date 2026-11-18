import { UserFacingError } from "@/lib/errors/user-error";

const MIB = 1024 * 1024;
const MAX_ASSET_BYTES = 64 * MIB;

function aborted() { return new DOMException("Download cancelled", "AbortError"); }

/**
 * One byte budget for the entire export, independent of garbage collection.
 * Mediabunny's HLS source references can outlive its four-input segment cache;
 * giving each UrlSource a large cache therefore isn't a global memory bound.
 */
/** One init or media segment of a recording: its size, and a range of its bytes. */
export type RecordingAsset = {
  size: () => Promise<number>;
  read: (start: number, end: number) => Promise<Uint8Array>;
};

export function createRecordingSourceLoader(options: { signal: AbortSignal; cacheBytes?: number; fetchFn?: typeof fetch }) {
  const cacheBytes = options.cacheBytes ?? 64 * MIB;
  const request = new AbortController();
  const cache = new Map<string, Uint8Array>();
  const pending = new Map<string, Promise<Uint8Array>>();
  const waiting: (() => void)[] = [];
  let used = 0;
  let running = 0;
  let disposed = false;
  const fetchAsset = options.fetchFn ?? fetch;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    request.abort();
    cache.clear();
    used = 0;
    while (waiting.length) waiting.shift()!();
    options.signal.removeEventListener("abort", dispose);
  };
  options.signal.addEventListener("abort", dispose, { once: true });
  if (options.signal.aborted) dispose();

  const delay = (milliseconds: number) => new Promise<void>((resolve, reject) => {
    if (disposed) { reject(aborted()); return; }
    const onAbort = () => { clearTimeout(timer); reject(aborted()); };
    const timer = setTimeout(() => { request.signal.removeEventListener("abort", onAbort); resolve(); }, milliseconds);
    request.signal.addEventListener("abort", onAbort, { once: true });
  });

  const load = async (url: string): Promise<Uint8Array> => {
    if (disposed) throw aborted();
    const existing = cache.get(url);
    if (existing) { cache.delete(url); cache.set(url, existing); return existing; }
    const inFlight = pending.get(url);
    if (inFlight) return inFlight;
    const task = (async () => {
      while (running >= 2) {
        await new Promise<void>(resolve => waiting.push(resolve));
        if (disposed) throw aborted();
      }
      if (disposed) throw aborted();
      running++;
      try {
        for (let attempt = 0; ; attempt++) {
          try {
            const response = await fetchAsset(url, { credentials: "same-origin", cache: "no-store", signal: request.signal });
            if (!response.ok) {
              await response.body?.cancel().catch(() => {});
              if ((response.status === 429 || response.status >= 500) && attempt < 2) { await delay(250 * 2 ** attempt); continue; }
              throw new UserFacingError("We couldn't read part of this recording. Refresh the page and try again.");
            }
            if (Number(response.headers.get("content-length")) > MAX_ASSET_BYTES || !response.body) {
              await response.body?.cancel();
              throw new UserFacingError("Part of this recording is too large to download here. Contact FaithForm support.");
            }
            const reader = response.body.getReader();
            const chunks: Uint8Array[] = [];
            let length = 0;
            try {
              for (;;) {
                const { done, value } = await reader.read();
                if (done) break;
                length += value.byteLength;
                if (length > MAX_ASSET_BYTES) {
                  await reader.cancel();
                  throw new UserFacingError("Part of this recording is too large to download here. Contact FaithForm support.");
                }
                chunks.push(value);
              }
            } finally { reader.releaseLock(); }
            if (disposed) throw aborted();
            const bytes = new Uint8Array(length);
            let offset = 0;
            for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
            chunks.length = 0;
            if (length <= cacheBytes) {
              while (cache.size && used + length > cacheBytes) {
                const oldest = cache.keys().next().value!;
                used -= cache.get(oldest)!.length;
                cache.delete(oldest);
              }
              cache.set(url, bytes);
              used += length;
            }
            return bytes;
          } catch (error) {
            if (disposed) throw aborted();
            if (error instanceof UserFacingError || attempt >= 2) throw error;
            await delay(250 * 2 ** attempt);
          }
        }
      } finally {
        running--;
        waiting.shift()?.();
      }
    })();
    pending.set(url, task);
    try { return await task; }
    finally { pending.delete(url); }
  };

  // Sizes come from a HEAD request, so laying a take out end to end does not
  // download it twice. A response without Content-Length falls back to the bytes.
  const sizes = new Map<string, Promise<number>>();
  const sizeOf = (url: string) => {
    let known = sizes.get(url);
    if (!known) {
      known = (async () => {
        if (disposed) throw aborted();
        try {
          const response = await fetchAsset(url, { method: "HEAD", credentials: "same-origin", cache: "no-store", signal: request.signal });
          const length = Number(response.headers.get("content-length"));
          if (response.ok && Number.isSafeInteger(length) && length > 0) {
            if (length > MAX_ASSET_BYTES) throw new UserFacingError("Part of this recording is too large to download here. Contact FaithForm support.");
            return length;
          }
        } catch (error) {
          if (disposed) throw aborted();
          if (error instanceof UserFacingError) throw error;
        }
        return (await load(url)).length;
      })();
      sizes.set(url, known);
      known.catch(() => sizes.delete(url));
    }
    return known;
  };

  return {
    assetFor: (url: string): RecordingAsset => ({
      size: () => sizeOf(url),
      // A slice is copied intentionally: long-lived media readers must not
      // retain a view of an entire asset after the shared LRU evicts it.
      read: async (start, end) => (await load(url)).slice(start, end),
    }),
    dispose,
  };
}
