import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import test, { type TestContext } from "node:test";
import ts from "typescript";

import { UserFacingError, toUserError } from "@/lib/errors/user-error";

type Element = { type: unknown; props: Record<string, unknown> };
const elements = (node: unknown): Element[] => {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!node || typeof node !== "object" || !("props" in node)) return [];
  const element = node as Element;
  return [element, ...elements(element.props.children)];
};
type ExportInput = { signal: AbortSignal; onProgress: (fraction: number) => void };
type ExportResult = { file: Blob; release: () => Promise<void> };
const recordingId = "22222222-2222-4222-8222-222222222222";

function harness(t: TestContext, exporter: (input: ExportInput) => Promise<ExportResult>) {
  const oldWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", { configurable: true, value: { location: { origin: "https://faithform.example.test" } } });
  t.after(() => { if (oldWindow) Object.defineProperty(globalThis, "window", oldWindow); else Reflect.deleteProperty(globalThis, "window"); });
  const cells: { value?: unknown; current?: unknown; deps?: unknown[]; cleanup?: () => void }[] = [];
  let cursor = 0;
  const scheduled: (() => void)[] = [];
  const react = {
    useState(initial: unknown) {
      const cell = cells[cursor++] ??= { value: initial };
      return [cell.value, (next: unknown) => { cell.value = typeof next === "function" ? next(cell.value) : next; }];
    },
    useRef(initial: unknown) { return cells[cursor++] ??= { current: initial }; },
    useCallback(fn: unknown) { const cell = cells[cursor++] ??= { value: fn }; return cell.value; },
    useEffect(run: () => void | (() => void), deps: unknown[]) {
      const index = cursor++, previous = cells[index];
      if (previous && deps.every((dep, i) => Object.is(dep, previous.deps?.[i]))) return;
      previous?.cleanup?.(); cells[index] = { deps };
      scheduled.push(() => { const cleanup = run(); if (typeof cleanup === "function") cells[index].cleanup = cleanup; });
    },
  };
  const providers: Record<string, unknown> = {
    react,
    "@/components/ui/button": { Button: "button", buttonVariants: () => "button" },
    "@/components/ui/dialog": Object.fromEntries(["Dialog", "DialogContent", "DialogDescription", "DialogFooter", "DialogHeader", "DialogTitle"].map(name => [name, name])),
    "@/lib/utils": { cn: (...args: unknown[]) => args.join(" ") },
    "@/lib/errors/user-error": { toUserError, UserFacingError },
    "@/lib/stream/download-recording": { prepareRecordingDownload: exporter },
  };
  const path = "components/live-streaming/recordings/recording-download-button.tsx";
  const require = createRequire(resolve(path));
  const compiled = ts.transpileModule(readFileSync(path, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  const componentModule = { exports: {} as { RecordingDownloadButton: (props: Record<string, unknown>) => unknown } };
  new Function("require", "module", "exports", compiled)((name: string) => providers[name] ?? require(name), componentModule, componentModule.exports);
  let nodes: Element[] = [];
  const render = () => { cursor = 0; nodes = elements(componentModule.exports.RecordingDownloadButton({ recordingId, title: "Sunday service" })); scheduled.splice(0).forEach(run => run()); return nodes; };
  const invoke = (node: Element, handler: string, value?: unknown) => (node.props[handler] as (input?: unknown) => void)(value);
  const start = () => { invoke(nodes.find(n => n.props["aria-label"] === "Download recording: Sunday service")!, "onClick"); render(); };
  const close = () => { invoke(nodes.find(n => n.type === "Dialog")!, "onOpenChange", false); render(); };
  const cleanup = () => { cells.forEach(cell => cell?.cleanup?.()); };
  t.after(cleanup); render();
  return { render, nodes: () => nodes, start, close, invoke };
}
const flush = () => new Promise<void>(resolve => setImmediate(resolve));

test("uploaded-file downloads offer a real Save link with the original filename", async t => {
  t.mock.method(globalThis, "fetch", async (url: RequestInfo | URL, options?: RequestInit) => {
    assert.equal(url, `/api/stream/recordings/${recordingId}/download`);
    assert.equal(options?.credentials, "same-origin"); assert.equal(options?.cache, "no-store");
    return Response.json({ kind: "file", filename: "Sunday service.mov", url: "https://storage.example.test/video?download=Sunday.mov" });
  });
  const h = harness(t, async () => { throw new Error("Files must not be remuxed"); });
  h.start(); await flush(); h.render();
  const save = h.nodes().find(n => n.type === "a" && n.props.download);
  assert.equal(save?.props.download, "Sunday service.mov");
  assert.equal(save?.props.href, "https://storage.example.test/video?download=Sunday.mov");
  assert.equal(h.nodes().find(n => n.props.role === "progressbar")?.props["aria-valuenow"], 100);
});

test("cancel aborts the active export and releases a late result without opening a stale Save link", async t => {
  t.mock.method(globalThis, "fetch", async () => Response.json({ kind: "segments", filename: "service.mp4", totalBytes: 1000, playlistUrl: `/api/stream/recordings/${recordingId}/safe-token/full.m3u8` }));
  let input!: ExportInput, finish!: (result: ExportResult) => void, releases = 0;
  const h = harness(t, received => { input = received; return new Promise(resolve => { finish = resolve; }); });
  h.start(); await flush();
  input.onProgress(0.42); h.render();
  assert.equal(h.nodes().find(n => n.props.role === "progressbar")?.props["aria-valuenow"], 42);
  h.close(); assert.equal(input.signal.aborted, true);
  finish({ file: new Blob(["video"]), release: async () => { releases++; } });
  await flush(); h.render();
  assert.equal(releases, 1);
  assert.equal(h.nodes().some(n => n.type === "a" && n.props.download), false);
});

test("Safari Save keeps its disk-backed file alive through browser handoff and releases it later", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  t.mock.method(globalThis, "fetch", async () => Response.json({ kind: "segments", filename: "service.mp4", totalBytes: 1000, playlistUrl: `/api/stream/recordings/${recordingId}/safe-token/full.m3u8` }));
  let releases = 0;
  const revoked: string[] = [];
  t.mock.method(URL, "revokeObjectURL", (url: string) => { revoked.push(url); });
  const h = harness(t, async () => ({ file: new Blob(["video"], { type: "video/mp4" }), release: async () => { releases++; } }));
  h.start(); await flush(); h.render();
  const save = h.nodes().find(n => n.type === "a" && n.props.download)!;
  assert.match(String(save.props.href), /^blob:/);
  h.invoke(save, "onClick"); h.close();
  assert.equal(releases, 0); assert.deepEqual(revoked, []);
  t.mock.timers.tick(5 * 60_000);
  assert.equal(releases, 1); assert.deepEqual(revoked, [save.props.href]);
});

test("download failures allow retry without rendering raw export errors", async t => {
  t.mock.method(console, "error", () => {});
  t.mock.method(globalThis, "fetch", async () => Response.json({ kind: "segments", filename: "service.mp4", totalBytes: 1000, playlistUrl: `/api/stream/recordings/${recordingId}/safe-token/full.m3u8` }));
  let attempts = 0;
  const h = harness(t, async () => { attempts++; if (attempts === 1) throw new Error("private provider detail"); return { file: new Blob(["video"]), release: async () => {} }; });
  h.start(); await flush(); h.render();
  const alert = h.nodes().find(n => n.props.role === "alert"); assert.ok(alert);
  assert.doesNotMatch(String(alert.props.children), /private provider detail/);
  const retry = h.nodes().find(n => n.type === "button" && n.props.children === "Try again")!;
  h.invoke(retry, "onClick"); await flush(); h.render();
  assert.equal(attempts, 2); assert.ok(h.nodes().some(n => n.type === "a" && n.props.download));
});
