import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import test from "node:test";
import ts from "typescript";

type Element = { type: unknown; key?: string; props: Record<string, unknown> };
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
const photo = new File(["safe fixture"], "qa.png", { type: "image/png" });
const area = { x: 0, y: 0, width: 100, height: 100 };
function harness() {
  const path = resolve("components/media/artwork-field.tsx"), localRequire = createRequire(path);
  const state = {
    uploads: [] as FormData[], clears: 0, changes: 0, pending: false,
    downscale: (async () => photo) as (file: File) => Promise<File>,
    upload: (async () => ({ ok: true, url: "https://example.invalid/new.png" })) as (data: FormData) => Promise<{ ok: true; url: string } | { ok: false; error: string }>,
    clear: async (): Promise<{ ok: boolean; error?: string }> => ({ ok: true }),
    confirm: async () => true,
  };
  const cells: unknown[] = [], work: Promise<unknown>[] = [], cleanups: (() => void)[] = [];
  let cursor = 0;
  const react = {
    useRef(initial: unknown) { return cells[cursor++] ??= { current: initial }; },
    useState(initial: unknown) {
      const i = cursor++; cells[i] ??= { value: initial };
      const cell = cells[i] as { value: unknown };
      return [cell.value, (value: unknown) => { cell.value = value; }];
    },
    useEffect(effect: () => undefined | (() => void), deps: unknown[]) {
      const i = cursor++, old = cells[i] as unknown[] | undefined;
      if (!old || deps.some((dep, j) => dep !== old[j])) {
        cells[i] = deps;
        const cleanup = effect(); if (cleanup) cleanups.push(cleanup);
      }
    },
    useTransition() {
      cursor++;
      return [state.pending, (callback: () => unknown) => {
        state.pending = true;
        work.push(Promise.resolve(callback()).finally(() => { state.pending = false; }));
      }];
    },
  };
  const placeholders = new Proxy({}, { get: (_obj, key) => String(key) });
  const providers: Record<string, unknown> = {
    react,
    "@/app/dashboard/live-streaming/media/actions": {
      uploadMediaArtwork: (data: FormData) => { state.uploads.push(data); return state.upload(data); },
      clearMediaArtwork: () => { state.clears++; return state.clear(); },
    },
    "@/components/ui/confirm-dialog": { confirmAction: () => state.confirm() },
    "@/lib/sites/downscale-image": { downscaleForUpload: (file: File) => state.downscale(file), UPLOAD_BUDGET_BYTES: 12_000_000 },
  };
  const compiled = { exports: {} as { ArtworkField: (props: Record<string, unknown>) => Element } };
  const source = ts.transpileModule(readFileSync(path, "utf8"), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
  } }).outputText;
  new Function("require", "module", "exports", source)(
    (name: string) => providers[name] ?? (name.startsWith("@/components/") || name === "lucide-react" ? placeholders : localRequire(name)),
    compiled, compiled.exports,
  );
  const props = { target: { kind: "item", id: "recording-a" }, crop: "wide", value: "https://example.invalid/old.png", onChanged: () => { state.changes++; } };
  const render = () => {
    cursor = 0;
    const wrapper = compiled.exports.ArtworkField(props);
    const tree = (wrapper.type as (props: unknown) => unknown)(wrapper.props);
    return {
      wrapper,
      tree,
      image: find(tree, el => el.type === "img")?.props.src,
      error: find(tree, el => el.props.role === "alert")?.props.children,
      change() {
        const input = find(tree, el => el.type === "input")!;
        const event = { target: { files: [photo], value: "qa.png" } };
        (input.props.onChange as (event: unknown) => void)(event);
        assert.equal(event.target.value, "");
      },
      crop() { return find(tree, el => el.type === "ImageCropper"); },
      confirmCrop() { const crop = find(tree, el => el.type === "ImageCropper")!; (crop.props.onConfirm as (area: unknown) => void)(area); },
      remove() { return (find(tree, el => typeof el.props.onClick === "function" && el.props.variant === "ghost")!.props.onClick as () => void)(); },
    };
  };
  const settle = async () => { for (let i = 0; i < 15; i++) await Promise.resolve(); };
  return { state, props, render, settle, async finish() { await settle(); await Promise.all(work); }, unmount() { cleanups.forEach(fn => fn()); } };
}

test("unreadable image shows recovery, retains existing artwork and accepts a retry", async () => {
  const h = harness(); h.state.downscale = async () => { throw new Error("private decode detail"); };
  h.render().change(); await h.finish();
  assert.match(String(h.render().error), /couldn't open/);
  assert.equal(h.render().image, h.props.value); assert.equal(h.state.uploads.length, 0);
  h.state.downscale = async () => photo;
  h.render().change(); await h.finish(); assert.ok(h.render().crop());
});

test("rapid crop confirmations upload once, show confirmed replacement before refresh, and target the correct recording", async () => {
  const h = harness(), response = deferred<{ ok: true; url: string }>(); h.state.upload = () => response.promise;
  h.render().change(); await h.settle(); const crop = h.render(); crop.confirmCrop(); crop.confirmCrop();
  assert.equal(h.state.uploads.length, 1);
  assert.equal(h.state.uploads[0].get("targetId"), "recording-a");
  assert.equal(h.state.uploads[0].get("crop"), "wide");
  assert.equal(h.render().image, h.props.value, "old image remains until the save is confirmed");
  response.resolve({ ok: true, url: "https://example.invalid/confirmed.png" }); await h.finish();
  assert.equal(h.render().image, "https://example.invalid/confirmed.png"); assert.equal(h.state.changes, 1);
});

test("rejected upload reports recovery without discarding the old image; retry can save", async () => {
  const h = harness(); h.state.upload = async () => { throw new Error("network"); };
  h.render().change(); await h.settle(); h.render().confirmCrop(); await h.finish();
  assert.match(String(h.render().error), /Refresh to check/); assert.equal(h.render().image, h.props.value);
  assert.equal(h.state.changes, 0);
  h.state.upload = async () => ({ ok: true, url: "https://example.invalid/retried.png" });
  h.render().change(); await h.settle(); h.render().confirmCrop(); await h.finish();
  assert.equal(h.render().image, "https://example.invalid/retried.png");
});

test("clear failure retains the photo and cancellation permits another attempt", async () => {
  const h = harness(); h.state.confirm = async () => false;
  await h.render().remove(); await h.finish(); assert.equal(h.state.clears, 0);
  h.state.confirm = async () => true; h.state.clear = async () => { throw new Error("network"); };
  await h.render().remove(); await h.finish();
  assert.match(String(h.render().error), /couldn't confirm/); assert.equal(h.render().image, h.props.value);
  h.state.clear = async () => ({ ok: true });
  await h.render().remove(); await h.finish(); assert.equal(h.render().image, undefined);
});

test("different recordings use distinct editor identities and old async completions cannot refresh a new target", async () => {
  const h = harness(), first = h.render().wrapper.key;
  h.props.target.id = "recording-b"; assert.notEqual(h.render().wrapper.key, first);
  const response = deferred<{ ok: true; url: string }>(); h.state.upload = () => response.promise;
  h.render().change(); await h.settle(); h.render().confirmCrop(); h.unmount();
  response.resolve({ ok: true, url: "https://example.invalid/late.png" }); await h.finish();
  assert.equal(h.state.changes, 0);
});
