import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import {
  hasDraftContent,
  localDraftKey,
  parseLocalDraft,
} from "@/lib/sermon-builder/local-draft";
import {
  nextSunday,
  parseSermonDetailTab,
  sermonDisplayStatus,
  toLocalDateString,
} from "@/lib/sermon-builder/sermon-display";
import {
  pickBodyFontSize,
  pickSubtitleFontSize,
} from "@/lib/sermon-builder/slide-text-size";

const read = (path: string) => readFileSync(path, "utf8");

function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? filesUnder(path) : [path];
  });
}

// ---------------------------------------------------------------------------
// The date defaults to the next Sunday
// ---------------------------------------------------------------------------

test("a new sermon is dated the coming Sunday", () => {
  // Thursday 24 September 2026 → Sunday 27 September.
  assert.equal(nextSunday(new Date(2026, 8, 24, 10)), "2026-09-27");
  // Saturday night still means tomorrow.
  assert.equal(nextSunday(new Date(2026, 8, 26, 23, 30)), "2026-09-27");
  // Across a month end.
  assert.equal(nextSunday(new Date(2026, 8, 29)), "2026-10-04");
});

test("on a Sunday, the sermon is for today", () => {
  assert.equal(nextSunday(new Date(2026, 8, 27, 7)), "2026-09-27");
});

test("dates are the viewer's calendar day, not UTC", () => {
  assert.equal(toLocalDateString(new Date(2026, 0, 5, 23, 59)), "2026-01-05");
});

// ---------------------------------------------------------------------------
// Status says what members can see
// ---------------------------------------------------------------------------

test("a sermon in the app reads In the app; anything else reads Draft", () => {
  assert.deepEqual(sermonDisplayStatus({ notesShared: true }), {
    label: "In the app",
    tone: "done",
    inApp: true,
  });
  assert.equal(sermonDisplayStatus({ notesShared: false, slidesShared: true }).label, "In the app");
  // Removed from the app: the builder column still says "published", the
  // badge goes back to Draft.
  assert.deepEqual(sermonDisplayStatus({ notesShared: false, slidesShared: false }), {
    label: "Draft",
    tone: "neutral",
    inApp: false,
  });
});

test("the sermon list never shows the raw draft/published value", () => {
  const list = read("components/sermon-builder/sermon-list.tsx");
  assert.doesNotMatch(list, /\{s\.status\}/);
  assert.match(list, /sermonDisplayStatus\(/);
  assert.match(list, /<StatusBadge/);
});

test("removing from the app still leaves the builder's own status alone", () => {
  // Hours saved and the activity feed count the first publish once; the
  // badge is derived instead (see sermonDisplayStatus).
  const publication = read("lib/sermons/v1/publication.ts");
  const unpublish = publication.slice(publication.indexOf("export async function unpublishSermonFromFaithForm"));
  assert.doesNotMatch(unpublish, /status:\s*"draft"/);
});

// ---------------------------------------------------------------------------
// Saving never needs a PowerPoint
// ---------------------------------------------------------------------------

test("the builder saves without downloading, and keeps unsaved work", () => {
  const builder = read("components/sermon-builder/simple-sermon-builder.tsx");
  assert.match(builder, /"Save sermon"/);
  assert.doesNotMatch(builder, /export\/pptx/);
  assert.doesNotMatch(builder, /download PowerPoint/i);
  assert.match(builder, /nextSunday\(\)/);
  // Leave-guard and a local draft.
  assert.match(builder, /beforeunload/);
  assert.match(builder, /confirmAction\(\{\s*title: "Leave without saving\?"/);
  assert.match(builder, /writeLocalDraft\(/);
  assert.match(builder, /clearLocalDraft\(draftKey\)/);
  // The chosen passage is included without pressing Add.
  assert.match(builder, /Your slides will include/);
  assert.match(builder, /Add another passage/);
});

test("a kept draft is validated before it is used", () => {
  assert.equal(parseLocalDraft(null), null);
  assert.equal(parseLocalDraft("{not json"), null);
  assert.equal(parseLocalDraft(JSON.stringify({ title: 3 })), null);

  const draft = parseLocalDraft(
    JSON.stringify({
      title: "Living water",
      sermonDate: "2026-09-27",
      translation: "KJV",
      themeId: "midnight",
      savedAt: "2026-09-25T10:00:00.000Z",
      passages: [
        { ref: "John 4:1-14", book: "John", chapter: 4, verseStart: 1, verseEnd: 14 },
        { ref: "bad", book: "John", chapter: 0, verseStart: 1, verseEnd: 2 },
      ],
      current: { book: "John", chapter: 3, verseStart: "", verseEnd: "" },
    }),
  );
  assert.ok(draft);
  assert.equal(draft.passages.length, 1, "a malformed passage is dropped");
  assert.deepEqual(draft.current, { book: "John", chapter: 3, verseStart: "", verseEnd: "" });
  assert.equal(hasDraftContent(draft), true);
  assert.equal(
    hasDraftContent({ title: "  ", passages: [], current: null }),
    false,
  );
});

test("each sermon keeps its own draft, and a new sermon has one of its own", () => {
  assert.equal(localDraftKey(), "faithform:sermon-draft:new");
  assert.equal(localDraftKey("abc"), "faithform:sermon-draft:abc");
});

// ---------------------------------------------------------------------------
// Detail page
// ---------------------------------------------------------------------------

test("the sermon page opens on Slides and understands ?tab=", () => {
  assert.equal(parseSermonDetailTab(undefined), "slides");
  assert.equal(parseSermonDetailTab("lesson"), "lesson");
  assert.equal(parseSermonDetailTab("social"), "slides", "the old Social posts tab opens Slides");
  assert.equal(parseSermonDetailTab("../etc"), "slides");
});

test("one primary Publish to the app; removing asks first", () => {
  const share = read("components/sermon-builder/share-in-app-card.tsx");
  assert.match(share, /"Publish to the app"/);
  assert.doesNotMatch(share, /Share in the FaithForm app/);
  const remove = share.slice(share.indexOf("export function RemoveFromAppButton"));
  assert.match(remove, /await confirmAction\(\{/);
  assert.match(remove, /destructive: true/);
  // "Preached on" is answered by the sermon date unless changed under More options.
  assert.match(share, /sermon\.mobile_preached_on \?\? sermon\.sermon_date/);
  assert.match(share, /<AdvancedSection title="More options">/);
});

test("regenerating a lesson asks first, because it overwrites", () => {
  const lesson = read("components/sermon-builder/create-lesson-panel.tsx");
  assert.match(lesson, /if \(hasLesson\) \{\s*const ok = await confirmAction/);
});

test("deleting a published sermon is an admin's call, and only once it is out of the app", () => {
  const actions = read("app/dashboard/sermon-builder/actions.ts");
  const del = actions.slice(
    actions.indexOf("export async function deleteSermonAction"),
    actions.indexOf("export async function deleteSeriesAction"),
  );
  assert.match(del, /featureActionError\("sermon_builder"\)/);
  assert.match(del, /verifySermonAccess\(supabase, sermonId, auth\.churchId\)/);
  assert.match(del, /if \(sermon\.status !== "draft"\) \{[\s\S]*if \(!auth\.isAdmin\)/);
  assert.match(del, /isSermonShared\(sermon\) \|\| presentation/);
  assert.doesNotMatch(del, /e\.message/);
});

test("Present renders the same page model as the export and the app", () => {
  const present = read("lib/sermon-builder/present-slides.ts");
  assert.match(present, /derivePresentationManifest\(/);
  assert.match(present, /snapshotTheme\(/);
  const actions = read("app/dashboard/sermon-builder/actions.ts");
  const slides = actions.slice(actions.indexOf("export async function getSermonSlidesAction"));
  assert.match(slides, /featureActionError\("sermon_builder"\)/);
  assert.match(slides, /verifySermonAccess\(supabase, sermonId, auth\.churchId\)/);
});

test("slide text is sized the same on the wall and in PowerPoint", () => {
  assert.equal(pickBodyFontSize("For God so loved the world"), 92);
  assert.equal(pickBodyFontSize(Array.from({ length: 50 }, () => "word").join(" ")), 42);
  assert.equal(pickSubtitleFontSize("John 3:16"), 22);
  const pptx = read("lib/sermon-builder/pptx.ts");
  assert.match(pptx, /from "@\/lib\/sermon-builder\/slide-text-size"/);
});

// ---------------------------------------------------------------------------
// Words a pastor reads
// ---------------------------------------------------------------------------

test("no model ids, tiny labels or raw error text in the sermon screens", () => {
  const files = [
    ...filesUnder("components/sermon-builder"),
    ...filesUnder("app/dashboard/sermon-builder"),
  ].filter((f) => f.endsWith(".tsx"));
  for (const file of files) {
    const source = read(file);
    assert.doesNotMatch(source, /ModelBadge/, `${file} shows a model id`);
    assert.doesNotMatch(source, /text-\[10px\]|text-\[11px\]/, `${file} has a tiny label`);
    assert.doesNotMatch(source, /e(rr)? instanceof Error \? e(rr)?\.message/, `${file} shows raw error text`);
    assert.doesNotMatch(source, /"Failed"|Draft failed \(/, `${file} says "Failed"`);
  }
});

test("sermon API routes answer with plain sentences, not exception text", () => {
  const routes = filesUnder("app/api/sermon").filter((f) => f.endsWith("route.ts"));
  for (const file of routes) {
    const source = read(file);
    assert.doesNotMatch(
      source,
      /\{ error: message \}, \{ status \}/,
      `${file} returns the raw exception message`,
    );
    assert.doesNotMatch(source, /error: error\.message|error: e\.message/, `${file} leaks a database message`);
  }
});

test("every sermon route has a loading skeleton", () => {
  for (const route of [
    "app/dashboard/sermon-builder",
    "app/dashboard/sermon-builder/new",
    "app/dashboard/sermon-builder/[id]",
    "app/dashboard/sermon-builder/[id]/edit",
    "app/dashboard/sermon-builder/[id]/discussion",
    "app/dashboard/sermon-builder/series/new",
    "app/dashboard/sermon-builder/series/[id]",
    "app/dashboard/call-log",
    "app/dashboard/call-log/[id]",
  ]) {
    const skeleton = read(join(route, "loading.tsx"));
    assert.match(skeleton, /SkeletonContainer|SermonBuilderSkeleton/, route);
    assert.doesNotMatch(skeleton, /max-w-(3xl|5xl|6xl)\b[^"]*flex w-full flex-col gap-8|mx-auto/, route);
  }
});
