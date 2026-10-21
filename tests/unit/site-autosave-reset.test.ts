import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import test from "node:test";
import ts from "typescript";

type Effect = { deps?: unknown[]; cleanup?: () => void; run?: () => void | (() => void) };
function harness<T>(initial: T, save: (value: T) => Promise<{ ok: true } | { ok: false; error: string }>) {
  const path = resolve("components/website-admin/use-autosave.ts");
  const source = ts.transpileModule(readFileSync(path, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const cells: unknown[] = [];
  const effects: Effect[] = [];
  const timers = new Map<number, () => void>();
  const scheduled: number[] = [];
  let cursor = 0, nextTimer = 0, value = initial, enabled = true, mounted = true;
  const sameDeps = (a: unknown[] | undefined, b: unknown[] | undefined) => !!a && !!b && a.length === b.length && a.every((item, index) => Object.is(item, b[index]));
  const react = {
    useRef(initial: unknown) { const index = cursor++; return cells[index] ??= { current: initial }; },
    useState(initial: unknown) { const index = cursor++; cells[index] ??= { value: initial }; const cell = cells[index] as { value: unknown }; return [cell.value, (next: unknown) => { if (mounted) cell.value = typeof next === "function" ? next(cell.value) : next; }]; },
    useCallback(callback: unknown, deps: unknown[]) { const index = cursor++; const previous = cells[index] as { callback: unknown; deps: unknown[] } | undefined; if (!previous || !sameDeps(previous.deps, deps)) cells[index] = { callback, deps }; return (cells[index] as { callback: unknown }).callback; },
    useEffect(run: Effect["run"], deps?: unknown[]) { const index = cursor++; const previous = effects[index]; if (!previous || !sameDeps(previous.deps, deps)) { previous?.cleanup?.(); effects[index] = { run, deps }; scheduled.push(index); } },
  };
  const localRequire = createRequire(path);
  const compiledModule = { exports: {} as Record<string, unknown> };
  new Function("require", "module", "exports", "window", "setTimeout", "clearTimeout", source)(
    (name: string) => name === "react" ? react : localRequire(name), compiledModule, compiledModule.exports,
    { addEventListener() {}, removeEventListener() {} },
    (callback: () => void) => { const id = ++nextTimer; timers.set(id, callback); return id; },
    (id: number) => timers.delete(id),
  );
  type Result = { status: { kind: string }; saveNow: () => void; runExclusive: <R extends { ok: boolean }>(action: () => Promise<R>) => Promise<R>; acceptSavedValue: (next: T) => void };
  const invokeAutosave = compiledModule.exports.useAutosave as (value: T, persist: (value: T) => Promise<{ ok: true } | { ok: false; error: string }>, options: { enabled: boolean }) => Result;
  let result: Result;
  const render = (next = value, nextEnabled = enabled) => {
    value = next; enabled = nextEnabled; cursor = 0;
    result = invokeAutosave(value, save, { enabled });
    for (const index of scheduled.splice(0)) {
      const effect = effects[index];
      const cleanup = effect.run?.();
      effect.cleanup = typeof cleanup === "function" ? cleanup : undefined;
    }
    return result;
  };
  render();
  return {
    render,
    get current() { return result; },
    fireTimers() { const entries = [...timers.values()]; timers.clear(); entries.forEach(callback => callback()); },
    unmount() { mounted = false; effects.forEach(effect => effect?.cleanup?.()); },
  };
}
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
const settle = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };

test("reset waits for the older autosave even when navigation unmounts the editor", async () => {
  const oldWrite = deferred<void>();
  const events: string[] = [];
  let persisted = "original";
  const editor = harness("original", async value => {
    events.push("save-start"); await oldWrite.promise; persisted = value; events.push("save-end"); return { ok: true };
  });
  editor.render("edited"); editor.fireTimers();
  const reset = editor.current.runExclusive(async () => {
    events.push("reset"); persisted = "original";
    editor.current.acceptSavedValue("original");
    return { ok: true };
  });
  editor.unmount(); await settle();
  assert.deepEqual(events, ["save-start"], "reset must not race the pending server write");
  oldWrite.resolve(); await reset; await settle();
  assert.equal(persisted, "original");
  assert.deepEqual(events, ["save-start", "save-end", "reset"]);
});

test("reset discards the pending debounce and adopts returned defaults without another save", async () => {
  const initial = { title: "Original", href: "/about" };
  const edited = { title: "Edited", href: "/about" };
  const returned = { ...initial };
  const saves: typeof initial[] = [];
  const editor = harness(initial, async value => { saves.push(value); return { ok: true }; });
  editor.render(edited);
  await editor.current.runExclusive(async () => {
    editor.current.acceptSavedValue(returned);
    return { ok: true };
  });
  editor.render(returned); editor.fireTimers(); await settle();
  assert.deepEqual(saves, []);
});

test("Undo also follows an in-flight edit and does not autosave the accepted snapshot again", async () => {
  const inFlight = deferred<void>();
  const beforeReset = { title: "Before reset" };
  const newerEdit = { title: "New typing" };
  const saves: string[] = [];
  let persisted = "Original";
  const editor = harness({ title: "Original" }, async value => {
    saves.push(value.title); await inFlight.promise; persisted = value.title; return { ok: true };
  });
  editor.render(newerEdit); editor.fireTimers();
  const undo = editor.current.runExclusive(async () => {
    persisted = beforeReset.title;
    editor.current.acceptSavedValue(beforeReset);
    return { ok: true };
  });
  inFlight.resolve(); await undo;
  editor.render(beforeReset); editor.fireTimers(); await settle();
  assert.equal(persisted, "Before reset");
  assert.deepEqual(saves, ["New typing"]);
});

test("a rejected reset preserves and saves the displaced unsaved draft", async () => {
  const saves: string[] = [];
  const editor = harness("original", async value => { saves.push(value); return { ok: true }; });
  editor.render("unsaved edit");
  const result = await editor.current.runExclusive(async () => ({ ok: false, error: "Reset failed" }));
  assert.equal(result.ok, false); await settle();
  assert.deepEqual(saves, ["unsaved edit"]);
});

test("normal autosave still coalesces rapid edits and flushes on close", async () => {
  const saves: string[] = [];
  const editor = harness("original", async value => { saves.push(value); return { ok: true }; });
  editor.render("first"); editor.render("latest");
  editor.render("latest", false); await settle();
  assert.deepEqual(saves, ["latest"]);
});

test("normal writes remain serial and a queued edit survives navigation", async () => {
  const first = deferred<void>();
  let active = 0, maxActive = 0;
  const saves: string[] = [];
  const editor = harness("original", async value => {
    maxActive = Math.max(maxActive, ++active); saves.push(value);
    if (value === "first") await first.promise;
    active--; return { ok: true };
  });
  editor.render("first"); editor.fireTimers();
  editor.render("second"); editor.unmount();
  first.resolve(); await settle();
  assert.deepEqual(saves, ["first", "second"]);
  assert.equal(maxActive, 1);
});
