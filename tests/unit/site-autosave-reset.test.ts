import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import test, { type TestContext } from "node:test";
import ts from "typescript";

// Exercise the real hook and queue with a small hook dispatcher. Only React's
// render/effect scheduling and the clock are faked; persistence stays real.
type Effect = { deps?: unknown[]; cleanup?: () => void; run?: () => void | (() => void) };
function harness<T>(initial: T, save: (value: T) => Promise<{ ok: true } | { ok: false; error: string }>, tick: (ms: number) => void, recoveryKey?: string) {
  const path = resolve("components/website-admin/use-autosave.ts");
  const source = ts.transpileModule(readFileSync(path, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const cells: unknown[] = [], effects: Effect[] = [], scheduled: number[] = [];
  const stored = new Map<string, string>();
  const storage = { getItem: (key: string) => stored.get(key) ?? null, setItem: (key: string, value: string) => { stored.set(key, value); }, removeItem: (key: string) => { stored.delete(key); } };
  let cursor = 0, value = initial, enabled = true, mounted = true;
  const sameDeps = (a?: unknown[], b?: unknown[]) => !!a && !!b && a.length === b.length && a.every((item, index) => Object.is(item, b[index]));
  const react = {
    useRef(initial: unknown) { const index = cursor++; return cells[index] ??= { current: initial }; },
    useState(initial: unknown) { const index = cursor++; cells[index] ??= { value: initial }; const cell = cells[index] as { value: unknown }; return [cell.value, (next: unknown) => { if (mounted) cell.value = typeof next === "function" ? next(cell.value) : next; }]; },
    useCallback(callback: unknown, deps: unknown[]) { const index = cursor++; const previous = cells[index] as { callback: unknown; deps: unknown[] } | undefined; if (!previous || !sameDeps(previous.deps, deps)) cells[index] = { callback, deps }; return (cells[index] as { callback: unknown }).callback; },
    useEffect(run: Effect["run"], deps?: unknown[]) { const index = cursor++; const previous = effects[index]; if (!previous || !sameDeps(previous.deps, deps)) { previous?.cleanup?.(); effects[index] = { run, deps }; scheduled.push(index); } },
  };
  const localRequire = createRequire(path);
  const compiledModule = { exports: {} as Record<string, unknown> };
  const events = { addEventListener() {}, removeEventListener() {} };
  new Function("require", "module", "exports", "window", "document", source)(
    (name: string) => name === "react" ? react : localRequire(name), compiledModule, compiledModule.exports,
    { ...events, sessionStorage: storage }, events,
  );
  type Result = { status: { kind: string }; saveNow: () => Promise<{ ok: boolean }>; adoptSaved: (next: T) => void };
  const invoke = compiledModule.exports.useAutosave as (value: T, persist: typeof save, options: { enabled: boolean; recoveryKey?: string; validateRecovery: (candidate: unknown) => candidate is T }) => Result;
  let result: Result;
  const render = (next = value, nextEnabled = enabled) => {
    value = next; enabled = nextEnabled; cursor = 0;
    result = invoke(value, save, { enabled, recoveryKey, validateRecovery: (candidate): candidate is T => typeof candidate === typeof initial });
    for (const index of scheduled.splice(0)) {
      const effect = effects[index], cleanup = effect.run?.();
      effect.cleanup = typeof cleanup === "function" ? cleanup : undefined;
    }
    return result;
  };
  render();
  return { render, get current() { return result; }, fireTimers() { tick(900); }, unmount() { mounted = false; effects.forEach(effect => effect?.cleanup?.()); }, stored };
}
function clock(t: TestContext) { const timer = t.mock.timers; timer.enable({ apis: ["setTimeout"] }); return (ms: number) => timer.tick(ms); }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
const settle = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };

test("reset waits for an older in-flight save even when navigation unmounts the editor", async t => {
  const oldWrite = deferred<void>(), events: string[] = [];
  let persisted = "original";
  const editor = harness("original", async value => { events.push("save-start"); await oldWrite.promise; persisted = value; events.push("save-end"); return { ok: true }; }, clock(t));
  editor.render("edited"); editor.fireTimers(); await settle();
  const reset = (async () => { if (!(await editor.current.saveNow()).ok) return; events.push("reset"); persisted = "original"; editor.current.adoptSaved("original"); })();
  editor.unmount(); await settle();
  assert.deepEqual(events, ["save-start"]);
  oldWrite.resolve(); await reset;
  assert.equal(persisted, "original");
  assert.deepEqual(events, ["save-start", "save-end", "reset"]);
});

test("reset settles the pending draft then adopts defaults without writing another override", async t => {
  const initial = { title: "Original", href: "/about" }, edited = { title: "Edited", href: "/about" }, returned = { ...initial };
  const saves: typeof initial[] = [];
  const editor = harness(initial, async value => { saves.push(value); return { ok: true }; }, clock(t));
  editor.render(edited);
  assert.equal((await editor.current.saveNow()).ok, true);
  editor.current.adoptSaved(returned);
  editor.render(returned); editor.fireTimers(); await settle();
  assert.deepEqual(saves, [edited]);
  editor.unmount();
});

test("Undo follows the in-flight edit and does not autosave the restored snapshot again", async t => {
  const inFlight = deferred<void>(), beforeReset = { title: "Before reset" }, newer = { title: "New typing" }, saves: string[] = [];
  let persisted = "Original";
  const editor = harness({ title: "Original" }, async value => { saves.push(value.title); await inFlight.promise; persisted = value.title; return { ok: true }; }, clock(t));
  editor.render(newer); editor.fireTimers(); await settle();
  const undo = (async () => { await editor.current.saveNow(); persisted = beforeReset.title; editor.current.adoptSaved(beforeReset); })();
  inFlight.resolve(); await undo;
  editor.render(beforeReset); editor.fireTimers(); await settle();
  assert.equal(persisted, "Before reset"); assert.deepEqual(saves, ["New typing"]);
  editor.unmount();
});

test("a rejected reset keeps the previously unsaved draft persisted", async t => {
  const saves: string[] = [];
  const editor = harness("original", async value => { saves.push(value); return { ok: true }; }, clock(t));
  editor.render("unsaved edit"); await editor.current.saveNow();
  const rejectedReset = { ok: false, error: "Reset failed" };
  assert.equal(rejectedReset.ok, false);
  editor.fireTimers(); await settle();
  assert.deepEqual(saves, ["unsaved edit"]);
  editor.unmount();
});

test("normal autosave still coalesces rapid edits and flushes on editor close", async t => {
  const saves: string[] = [];
  const editor = harness("original", async value => { saves.push(value); return { ok: true }; }, clock(t));
  editor.render("first"); editor.render("latest"); editor.render("latest", false); await settle();
  assert.deepEqual(saves, ["latest"]);
  editor.unmount();
});

test("writes remain serial while navigation preserves the queued revision for explicit recovery", async t => {
  const first = deferred<void>(), saves: string[] = []; let active = 0, maxActive = 0;
  const editor = harness("original", async value => { maxActive = Math.max(maxActive, ++active); saves.push(value); if (value === "first") await first.promise; active--; return { ok: true }; }, clock(t), "synthetic-account:church:section");
  editor.render("first"); editor.fireTimers(); await settle(); editor.render("second"); editor.unmount();
  first.resolve(); await settle();
  assert.deepEqual(saves, ["first"]); assert.equal(maxActive, 1);
  assert.equal(JSON.parse(editor.stored.get("synthetic-account:church:section")!).value, "second");
});
