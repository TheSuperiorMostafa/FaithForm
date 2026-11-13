import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import test from "node:test";
import ts from "typescript";
import type { RecordingTagsField, RecordingTagsValue } from "@/components/media/recording-tags-field";

type Element = { props: Record<string, unknown> };
function find(node: unknown, match: (element: Element) => boolean): Element | undefined {
  if (Array.isArray(node)) return node.map(child => find(child, match)).find(Boolean);
  if (!node || typeof node !== "object" || !("props" in node)) return;
  const element = node as Element;
  return match(element) ? element : find(element.props.children, match);
}

function field(initial: RecordingTagsValue, maxLength = 80) {
  const state = { value: initial, error: null as string | null, prevented: 0 };
  const path = resolve("components/media/recording-tags-field.tsx"), localRequire = createRequire(path);
  const source = ts.transpileModule(readFileSync(path, "utf8"), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
  } }).outputText;
  const compiled = { exports: {} as { RecordingTagsField: typeof RecordingTagsField } };
  new Function("require", "module", "exports", source)((name: string) => name === "react"
    ? { useState: () => [state.error, (error: string | null) => { state.error = error; }] }
    : name.startsWith("@/components/") ? new Proxy({}, { get: () => () => null }) : localRequire(name), compiled, compiled.exports);
  const render = () => compiled.exports.RecordingTagsField({ id: "test-tags", name: "topics", label: "Topics", addLabel: "Add topic", placeholder: "Topic", value: state.value, onChange(value) { state.value = value; }, maxLength });
  function enter(composing = false, keyCode = 13) {
    const input = find(render(), element => element.props.id === "test-tags")!;
    (input.props.onKeyDown as (event: unknown) => void)({ key: "Enter", keyCode, nativeEvent: { isComposing: composing }, preventDefault() { state.prevented++; } });
  }
  return { state, render, enter };
}

test("Enter adds one whole comma-containing entry, preserves case, and prevents form submission", () => {
  const editor = field({ items: ["Hope"], draft: " Grace, mercy " });
  editor.enter();
  assert.deepEqual(editor.state.value, { items: ["Hope", "Grace, mercy"], draft: "" });
  assert.equal(editor.state.prevented, 1);
  editor.enter();
  assert.equal(editor.state.prevented, 2, "an empty Enter must not submit the containing publish form");
});

test("IME confirmation Enter and Safari keyCode229 leave composition intact", () => {
  const editor = field({ items: [], draft: "希望" });
  editor.enter(true); editor.enter(false, 229);
  assert.deepEqual(editor.state.value, { items: [], draft: "希望" });
  assert.equal(editor.state.prevented, 0);
  editor.enter();
  assert.deepEqual(editor.state.value.items, ["希望"]);
});

test("duplicates converge and labelled 44px removal keeps the pending draft", () => {
  const editor = field({ items: ["Hope", "Grace"], draft: " Hope " });
  editor.enter();
  assert.deepEqual(editor.state.value.items, ["Hope", "Grace"]);
  editor.state.value.draft = "Keep this entry";
  const remove = find(editor.render(), element => element.props["aria-label"] === "Remove Hope")!;
  assert.match(String(remove.props.className), /min-h-11/);
  (remove.props.onClick as () => void)();
  assert.deepEqual(editor.state.value, { items: ["Grace"], draft: "Keep this entry" });
});

test("limits retain a rejected draft with recovery feedback instead of silently dropping it", () => {
  const editor = field({ items: Array.from({ length: 20 }, (_, i) => `Topic ${i}`), draft: "One more" });
  editor.enter();
  assert.equal(editor.state.value.items.length, 20);
  assert.equal(editor.state.value.draft, "One more");
  assert.match(editor.state.error ?? "", /up to 20 entries/);
  assert.ok(find(editor.render(), element => element.props.role === "alert"));
  const long = field({ items: [], draft: "x".repeat(121) }, 120);
  long.enter();
  assert.equal(long.state.value.draft.length, 121);
  assert.match(long.state.error ?? "", /120 characters/);
});
