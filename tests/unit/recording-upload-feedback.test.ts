import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import test from "node:test";
import ts from "typescript";

type Element = { type: unknown; props: Record<string, unknown> };
function find(node: unknown, predicate: (el: Element) => boolean): Element | undefined {
  if (Array.isArray(node)) return node.map(child => find(child, predicate)).find(Boolean);
  if (!node || typeof node !== "object" || !("props" in node)) return;
  const el = node as Element;
  return predicate(el) ? el : find(el.props.children, predicate);
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
function harness() {
  const path = resolve("components/live-streaming/recordings/upload-recording.tsx"), localRequire = createRequire(path);
  const file = new File(["safe fixture"], "qa.mp4", { type: "video/mp4" });
  const state = {
    pending: false, prepares: 0, uploads: 0, finishes: 0, pushes: [] as string[], notices: [] as string[],
    upload: async () => ({ error: null }),
    finish: async (): Promise<{ ok: true; recordingId: string } | { ok: false; error: string }> => ({ ok: true, recordingId: "qa-recording" }),
  };
  const cells: unknown[] = [], work: Promise<unknown>[] = [];
  let cursor = 0;
  const react = {
    useRef(initial: unknown) { return cells[cursor++] ??= { current: initial }; },
    useState(initial: unknown) {
      const i = cursor++; cells[i] ??= { value: initial };
      const cell = cells[i] as { value: unknown };
      return [cell.value, (value: unknown) => { cell.value = value; }];
    },
    useTransition() { cursor++; return [state.pending, (callback: () => unknown) => {
      state.pending = true; work.push(Promise.resolve(callback()).finally(() => { state.pending = false; }));
    }]; },
  };
  const placeholders = new Proxy({}, { get: (_obj, key) => String(key) });
  const providers: Record<string, unknown> = {
    react,
    "next/navigation": { useRouter: () => ({ refresh() {}, push(url: string) { state.pushes.push(url); } }) },
    sonner: { toast: { success(text: string) { state.notices.push(text); } } },
    "@/lib/supabase/client": { createClient: () => ({ storage: { from: () => ({ uploadToSignedUrl: async () => { state.uploads++; return state.upload(); } }) } }) },
    "@/app/dashboard/live-streaming/upload-actions": {
      prepareRecordingUpload: async () => { state.prepares++; return { ok: true, recordingId: "qa-recording", path: "qa.mp4", token: "synthetic" }; },
      finishRecordingUpload: async () => { state.finishes++; return state.finish(); },
      cancelRecordingUpload: async () => ({ ok: true }),
    },
  };
  const source = ts.transpileModule(readFileSync(path, "utf8"), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
  } }).outputText;
  const compiled = { exports: {} as { UploadRecording: () => unknown } };
  new Function("require", "module", "exports", source)(
    (name: string) => providers[name] ?? (name.startsWith("@/components/") || name === "lucide-react" ? placeholders : localRequire(name)),
    compiled, compiled.exports,
  );
  const previousDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  Object.defineProperty(globalThis, "document", { configurable: true, value: { createElement() {
    const video = { duration: 6, onloadedmetadata: null as (() => void) | null, onerror: null, removeAttribute() {}, load() {}, set src(_url: string) { queueMicrotask(() => video.onloadedmetadata?.()); } };
    return video;
  } } });
  const render = () => {
    cursor = 0; const tree = compiled.exports.UploadRecording();
    return {
      tree,
      submit() { (find(tree, el => el.type === "form")!.props.onSubmit as (event: unknown) => void)({ preventDefault() {} }); },
      populate() {
        (find(tree, el => el.props.id === "recording-upload-title")!.props.onChange as (event: unknown) => void)({ target: { value: "QA recording" } });
        (find(tree, el => el.props.id === "recording-upload-file")!.props.onChange as (event: unknown) => void)({ target: { files: [file] } });
      },
      busy: find(tree, el => el.type === "form")!.props["aria-busy"],
      status: find(tree, el => el.props.role === "status"),
      error: find(tree, el => el.props.role === "alert")?.props.children,
    };
  };
  const settle = async () => { for (let i = 0; i < 25; i++) await Promise.resolve(); };
  return { state, render, settle, async finish() { await settle(); await Promise.all(work); }, cleanup() {
    if (previousDocument) Object.defineProperty(globalThis, "document", previousDocument); else Reflect.deleteProperty(globalThis, "document");
  } };
}

test("real upload handler announces its busy state and rejects rapid duplicate submissions", async t => {
  const h = harness(); t.after(h.cleanup);
  h.render().populate(); const response = deferred<{ error: null }>(); h.state.upload = () => response.promise;
  const form = h.render(); form.submit(); form.submit(); await h.settle();
  assert.equal(h.state.prepares, 1); assert.equal(h.state.uploads, 1);
  assert.equal(h.render().busy, true); assert.ok(h.render().status);
  response.resolve({ error: null }); await h.finish();
  assert.equal(h.state.finishes, 1); assert.equal(h.render().busy, false);
  assert.deepEqual(h.state.pushes, ["/dashboard/live-streaming/recordings/qa-recording"]);
});

test("finalization failure explains recovery and Finish upload retries without uploading the video twice", async t => {
  const h = harness(); t.after(h.cleanup); h.render().populate();
  h.state.finish = async () => ({ ok: false, error: "Still checking your video. Try again." });
  h.render().submit(); await h.finish(); assert.match(String(h.render().error), /Try again/);
  assert.equal(h.state.pushes.length, 0); assert.equal(h.render().busy, false);
  h.state.finish = async () => ({ ok: true, recordingId: "qa-recording" });
  h.render().submit(); await h.finish();
  assert.equal(h.state.prepares, 1); assert.equal(h.state.uploads, 1); assert.equal(h.state.finishes, 2);
});
