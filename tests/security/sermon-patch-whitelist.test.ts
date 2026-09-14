import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  parseSermonEditorPatch,
  pickSermonUpdatableColumns,
  SERMON_UPDATABLE_COLUMNS,
} from "@/lib/sermon-builder/sermon-patch";

/**
 * `PATCH /api/sermon/[id]` passed its JSON body straight into the update. Any
 * church user could share a sermon in the app without being an admin, move it
 * to another church, or rewrite who created it. These pin both layers of the
 * fix: the route's parser and `updateSermon`'s own column list.
 */

const FORBIDDEN = {
  id: "33333333-3333-4333-8333-333333333333",
  church_id: "44444444-4444-4444-8444-444444444444",
  created_by: "55555555-5555-4555-8555-555555555555",
  created_at: "2020-01-01T00:00:00Z",
  updated_at: "2020-01-01T00:00:00Z",
  kind: "simple",
  series_id: "66666666-6666-4666-8666-666666666666",
  published_at: "2020-01-01T00:00:00Z",
  outline_generated_at: "2020-01-01T00:00:00Z",
  content_generated_at: "2020-01-01T00:00:00Z",
  mobile_visibility: "public",
  mobile_published_at: "2020-01-01T00:00:00Z",
  mobile_unpublished_at: null,
  mobile_summary: "Injected",
  mobile_preached_on: "2020-01-01",
  mobile_publication_version: 999,
};

test("the editor route cannot set id, church_id, created_by or any mobile_* column", () => {
  const parsed = parseSermonEditorPatch({ title: "Grace", ...FORBIDDEN });
  assert.ok(parsed.ok);
  const keys = Object.keys(parsed.ok ? parsed.patch : {});
  assert.deepEqual(keys, ["title"]);
  for (const key of Object.keys(FORBIDDEN)) {
    assert.equal(keys.includes(key), false, `${key} got through`);
  }
});

test("updateSermon's column list drops the same fields whatever a caller passes", () => {
  const picked = pickSermonUpdatableColumns({
    title: "Grace",
    outline: { intro: "x" },
    ...FORBIDDEN,
  });
  assert.deepEqual(Object.keys(picked).sort(), ["outline", "title"]);
  for (const column of SERMON_UPDATABLE_COLUMNS) {
    assert.equal(/^mobile_|^church_id$|^created_by$|^id$/.test(column), false, column);
  }
});

test("the fields the sermon editor actually sends still save", () => {
  // components/sermon-builder/sermon-editor.tsx: title on blur, content on
  // blur, and "Mark published".
  for (const body of [
    { title: "Grace" },
    { content: { intro: "Hi", points: [], illustrations: [], application: "", prayer: "" }, title: "Grace" },
    { status: "published", content: { intro: "Hi" }, title: "Grace" },
  ]) {
    const parsed = parseSermonEditorPatch(body);
    assert.ok(parsed.ok, JSON.stringify(body));
    assert.deepEqual(parsed.ok && parsed.patch, body);
  }
});

test("a known field with the wrong shape is refused, and a sermon cannot be turned back into a draft", () => {
  for (const body of [
    null,
    [],
    "title",
    { title: 42 },
    { scripture_refs: "John 3:16" },
    { scripture_refs: [1] },
    { duration_min: "30" },
    { sermon_date: "last Sunday" },
    { content: "manuscript" },
    { status: "archived" },
    // "draft" is what makes a sermon deletable, including a shared one.
    { status: "draft" },
  ]) {
    assert.equal(parseSermonEditorPatch(body).ok, false, JSON.stringify(body));
  }
});

test("the route and updateSermon both use the whitelist", () => {
  const route = readFileSync("app/api/sermon/[id]/route.ts", "utf8");
  assert.match(route, /parseSermonEditorPatch\(body\)/);
  assert.match(route, /updateSermon\(id, parsed\.patch/);
  assert.doesNotMatch(route, /updateSermon\(id, body\)/);

  const queries = readFileSync("lib/queries/sermons.ts", "utf8");
  const start = queries.indexOf("export async function updateSermon");
  const update = queries.slice(start, queries.indexOf("export async function", start + 1));
  assert.match(update, /pickSermonUpdatableColumns\(/);
  assert.doesNotMatch(update, /\.\.\.patch,/);
});

test("the other sermon write routes build their updates field by field", () => {
  // The same pattern checked everywhere a sermon is written from a request.
  for (const file of [
    "app/api/sermon/simple/route.ts",
    "app/api/sermon/simple/[id]/route.ts",
    "app/api/sermon/outline/route.ts",
    "app/api/sermon/draft/route.ts",
  ]) {
    const source = readFileSync(file, "utf8");
    assert.doesNotMatch(source, /updateSermon\([^,]+,\s*body\)/, file);
    assert.doesNotMatch(source, /\.\.\.body\b/, file);
  }
  // A series id from a request is verified against the caller's church.
  assert.match(readFileSync("app/api/sermon/outline/route.ts", "utf8"), /verifySeriesAccess\(/);
  assert.match(readFileSync("app/api/sermon/series/route.ts", "utf8"), /verifySeriesAccess\(/);
});
