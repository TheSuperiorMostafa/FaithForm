import assert from "node:assert/strict";
import test from "node:test";
import { createListItemRegistry } from "@/components/website-admin/section-fields-form";
import { createImageUploadGuard } from "@/components/website-admin/image-upload-field";

test("removing an earlier list row preserves the remaining row's upload identity", () => {
  const rows = createListItemRegistry();
  const first = { title: "First", image: { src: null } };
  const second = { title: "Second", image: { src: null } };
  const firstKey = rows.keyFor(first);
  const secondKey = rows.keyFor(second);
  const remaining = [second];
  assert.equal(rows.keyFor(remaining[0]), secondKey);
  assert.notEqual(rows.keyFor(remaining[0]), firstKey);
  assert.equal(rows.replace(remaining, firstKey, { ...first, image: { src: "first.jpg" } }), null);
  assert.deepEqual(remaining, [second]);
});

test("pending image work updates its row after edits or index changes and never re-adds a removed row", () => {
  const rows = createListItemRegistry();
  const first = { title: "First" };
  const second = { title: "Second" };
  rows.keyFor(first);
  const key = rows.keyFor(second);
  const editedSecond = { title: "Newer text" };
  const edited = rows.replace([first, second], key, editedSecond)!;
  assert.equal(rows.keyFor(edited[1]), key);
  const withoutFirst = edited.slice(1);
  const uploaded = rows.replace(withoutFirst, key, { ...editedSecond, image: { src: "second.jpg" } });
  assert.deepEqual(uploaded, [{ title: "Newer text", image: { src: "second.jpg" } }]);
  assert.equal(rows.replace([], key, { ...second, image: { src: "second.jpg" } }), null);
});

test("list identities stay outside serialized website content and reset for an external replacement", () => {
  const rows = createListItemRegistry();
  const item = { title: "Visible content" };
  const serialized = JSON.stringify(item);
  const key = rows.keyFor(item);
  assert.equal(JSON.stringify(item), serialized);
  const replacement = JSON.parse(serialized);
  assert.notEqual(rows.keyFor(replacement), key);
  assert.equal(rows.replace([replacement], key, { title: "Old upload callback" }), null);
});

test("upload completion after field removal is ignored even if the field later remounts", async () => {
  const guard = createImageUploadGuard();
  const operation = guard.start();
  const writes: string[] = [];
  let finish!: (url: string) => void;
  const upload = new Promise<string>((resolve) => { finish = resolve; });
  const completion = upload.then((url) => { if (guard.isCurrent(operation)) writes.push(url); });
  guard.unmount();
  guard.mount();
  finish("removed-row.jpg");
  await completion;
  assert.deepEqual(writes, []);
  assert.equal(guard.isCurrent(guard.start()), true);
});

test("choosing a newer URL or image invalidates older preparation and upload work", () => {
  const guard = createImageUploadGuard();
  const old = guard.start();
  guard.invalidate();
  assert.equal(guard.isCurrent(old), false);
  const current = guard.start();
  assert.equal(guard.isCurrent(old), false);
  assert.equal(guard.isCurrent(current), true);
});
