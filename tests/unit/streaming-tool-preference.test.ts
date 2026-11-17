import assert from "node:assert/strict";
import test from "node:test";
import { readStreamingTool, streamingToolStorageKey } from "@/lib/stream/streaming-tool-preference";

test("equipment choices stay with their church when an admin switches churches", () => {
  const entries = new Map<string, string>();
  const storage = { getItem: (key: string) => entries.get(key) ?? null };
  entries.set("ff-streaming-tool", "browser");
  assert.equal(readStreamingTool(storage, "church-a"), null, "a legacy global preference has no known owner");
  entries.set(streamingToolStorageKey("church-a"), "obs");
  entries.set(streamingToolStorageKey("church-b"), "atem");
  assert.equal(readStreamingTool(storage, "church-a"), "obs");
  assert.equal(readStreamingTool(storage, "church-b"), "atem");
  entries.set(streamingToolStorageKey("church-a"), "browser");
  assert.equal(readStreamingTool(storage, "church-b"), "atem");
});

test("invalid or unavailable browser storage does not select a camera or another church's tool", () => {
  assert.equal(readStreamingTool({ getItem: () => "invalid" }, "church-a"), null);
  assert.equal(readStreamingTool({ getItem: () => { throw new Error("storage blocked"); } }, "church-a"), null);
});
