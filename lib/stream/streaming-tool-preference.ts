import type { StreamingToolId } from "@/components/live-streaming/encoder-docs-card";

/** Equipment belongs to the church being managed, including admin impersonation. */
export function streamingToolStorageKey(churchId: string): string {
  return `ff-streaming-tool:${churchId}`;
}

export function readStreamingTool(storage: Pick<Storage, "getItem">, churchId: string): StreamingToolId | null {
  try {
    const value = storage.getItem(streamingToolStorageKey(churchId));
    return value === "obs" || value === "atem" || value === "vmix" || value === "other" || value === "browser" || value === "someone_else"
      ? value : null;
  } catch {
    return null;
  }
}
