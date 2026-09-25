import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { describeCaptureError } from "@/components/live-streaming/use-studio-broadcast";

const read = (path: string) => readFileSync(path, "utf8");

test("camera failures are explained in words a volunteer can act on", () => {
  const named = (name: string) => Object.assign(new Error("x"), { name });
  assert.match(describeCaptureError(named("NotAllowedError")), /blocked the camera/);
  assert.match(describeCaptureError(named("NotFoundError")), /couldn't find a camera/);
  assert.match(describeCaptureError(named("NotReadableError")), /another app/);
  assert.match(describeCaptureError(new Error("ingest-config")), /streaming service/);
  assert.match(describeCaptureError(new Error("Could not start video source")), /couldn't start this computer's camera/);
});

test("choosing This computer means Go live turns the camera on first", () => {
  const center = read("components/live-streaming/broadcast/control-center.tsx");
  assert.match(center, /STREAMING_TOOL_KEY\) === "browser"/);
  assert.match(center, /get\("source"\) === "computer"/);
  assert.match(center, /if \(useComputer && studioSupported && !studio\.isLive\) \{\s+const started = await studio\.startStudio\(\);\s+if \(!started\) return;/);
  assert.match(center, /Use this computer&apos;s camera/);
  const guide = read("components/live-streaming/setup/streaming-setup-guide.tsx");
  assert.match(guide, /\?source=computer/);
  const hook = read("components/live-streaming/use-studio-broadcast.ts");
  assert.match(hook, /startStudio = useCallback\(async \(\): Promise<boolean>/);
  assert.doesNotMatch(hook, /toast\.error\(\s*error instanceof Error/);
});

test("choosing a sermon theme never reorders the suggested themes", () => {
  const picker = read("components/sermon-builder/theme-picker.tsx");
  const base = picker.slice(picker.indexOf("const baseSuggestedRow"), picker.indexOf("const suggestedRow"));
  assert.doesNotMatch(base, /selectedId/, "the suggested order must not depend on the choice");
  assert.match(picker, /\[\.\.\.baseSuggestedRow, chosen\]/);
});
