import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import test from "node:test";
import ts from "typescript";

function status(label: string) {
  return {
    autoGoLive: true, previewIngestActive: true, shareLinks: {},
    overview: { phase: "live", recordingIndicator: { label }, recording: null },
  };
}

function harness(initial = "Starting recording…") {
  const path = resolve("components/live-streaming/broadcast/control-center.tsx");
  const localRequire = createRequire(path);
  const cells: { value: unknown }[] = [];
  let cursor = 0;
  const callbacks: (() => Promise<void>)[] = [];
  const effects: (() => (() => void) | void)[] = [];
  const requests: { signal: AbortSignal; resolve: (response: Response) => void; reject: (error: Error) => void }[] = [];
  const react = {
    useState(value: unknown) {
      const i = cursor++;
      cells[i] ??= { value };
      return [cells[i].value, (next: unknown) => { cells[i].value = next; }];
    },
    useRef(value: unknown) {
      const i = cursor++;
      cells[i] ??= { value: { current: value } };
      return cells[i].value;
    },
    useCallback(callback: () => Promise<void>) { callbacks.push(callback); return callback; },
    useEffect(effect: () => (() => void) | void) { effects.push(effect); },
    useMemo(callback: () => unknown) { return callback(); },
    useTransition() { return [false, () => {}]; },
  };
  const placeholders = new Proxy({}, { get: (_object, key) => String(key) });
  const providers: Record<string, unknown> = {
    react,
    "next/navigation": { useRouter: () => ({ refresh() {} }) },
    sonner: { toast: {} },
    "@/lib/stream/streaming-tool-preference": { readStreamingTool: () => null },
    "@/lib/stream/studio-support": { isStudioSupported: () => false },
    "@/components/live-streaming/use-studio-broadcast": { useStudioBroadcast: () => ({}) },
  };
  const source = ts.transpileModule(readFileSync(path, "utf8"), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
  } }).outputText;
  const compiled = { exports: {} as { BroadcastControlCenter: (props: unknown) => unknown } };
  new Function("require", "module", "exports", source)(
    (name: string) => providers[name] ?? (
      name.startsWith("@/components/") || name.startsWith("@/app/") || name === "lucide-react"
        ? placeholders : localRequire(name)
    ), compiled, compiled.exports,
  );
  const saved = Object.fromEntries(["fetch", "document", "window", "setInterval", "clearInterval"].map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  const globals = {
    fetch: (_url: string, options: { signal: AbortSignal }) => new Promise<Response>((resolve, reject) => {
      requests.push({ signal: options.signal, resolve, reject });
    }),
    document: { visibilityState: "visible", addEventListener() {}, removeEventListener() {} },
    window: { location: { search: "" }, localStorage: { getItem: () => null } },
    setInterval: () => 1,
    clearInterval() {},
  };
  for (const [name, value] of Object.entries(globals)) Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });

  function render() {
    cursor = 0;
    compiled.exports.BroadcastControlCenter({
      churchId: "qa-church", initialStatus: status(initial), isAdmin: false, appEnabled: false,
      nextService: null, timeZone: "UTC", settings: {}, platforms: {}, branding: {},
    });
  }
  render();
  let unmount = effects[0]() as () => void;
  const answer = (index: number, label: string, code = 200) => requests[index].resolve(
    new Response(JSON.stringify(status(label)), { status: code, headers: { "Content-Type": "application/json" } }),
  );
  return {
    requests, answer,
    refresh: () => callbacks[0](),
    current: () => (cells[0].value as ReturnType<typeof status>).overview.recordingIndicator.label,
    unmount: () => unmount(),
    remount() { unmount = effects[0]() as () => void; },
    cleanup() {
      unmount();
      for (const [name, descriptor] of Object.entries(saved)) {
        if (descriptor) Object.defineProperty(globalThis, name, descriptor);
        else Reflect.deleteProperty(globalThis, name);
      }
    },
  };
}

test("a delayed starting snapshot cannot replace a newer confirmed recording snapshot", async t => {
  const h = harness(); t.after(h.cleanup);
  const earlier = h.refresh();
  const newer = h.refresh();
  h.answer(1, "Recording"); await newer;
  assert.equal(h.current(), "Recording");
  h.answer(0, "Starting recording…"); await earlier;
  assert.equal(h.current(), "Recording");
});

test("slow polls still update the screen while a subsequent poll is pending", async t => {
  const h = harness(); t.after(h.cleanup);
  const earlier = h.refresh();
  const newer = h.refresh();
  h.answer(0, "Recording"); await earlier;
  assert.equal(h.current(), "Recording", "polling must not starve updates when requests take longer than the interval");
  h.answer(1, "Recording needs attention"); await newer;
  assert.equal(h.current(), "Recording needs attention");
});

test("failed or aborted polls retain the last confirmed state and allow the next poll", async t => {
  const h = harness("Recording"); t.after(h.cleanup);
  const refused = h.refresh(); h.answer(0, "Starting recording…", 503); await refused;
  const failed = h.refresh(); h.requests[1].reject(new Error("synthetic network failure")); await failed;
  const aborted = h.refresh(); h.requests[2].reject(new DOMException("Aborted", "AbortError")); await aborted;
  assert.equal(h.current(), "Recording");
  const recovered = h.refresh(); h.answer(3, "Recording needs attention"); await recovered;
  assert.equal(h.current(), "Recording needs attention");
});

test("unmount aborts every pending poll and ignores late responses even after remount", async t => {
  const h = harness("Recording"); t.after(h.cleanup);
  const earlier = h.refresh();
  const newer = h.refresh();
  h.unmount();
  assert.ok(h.requests.every(request => request.signal.aborted));
  await h.refresh(); assert.equal(h.requests.length, 2, "unmounted screen must not start another request");
  h.remount();
  h.answer(0, "Starting recording…"); h.answer(1, "Recording needs attention");
  await Promise.all([earlier, newer]);
  assert.equal(h.current(), "Recording");
  const current = h.refresh(); h.answer(2, "Current recording"); await current;
  assert.equal(h.current(), "Current recording");
});
