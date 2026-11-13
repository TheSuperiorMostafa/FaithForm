import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import test from "node:test";
import ts from "typescript";
import type { RecordingReview } from "@/components/live-streaming/recordings/recording-review";
import { createRecordingTagsValue, recordingTagItems, type RecordingTagsValue } from "@/components/media/recording-tags-field";

type Props = Parameters<typeof RecordingReview>[0];
type Element = { props: Record<string, unknown> };
function find(node: unknown, predicate: (element: Element) => boolean): Element | undefined {
  if (Array.isArray(node)) return node.map(child => find(child, predicate)).find(Boolean);
  if (!node || typeof node !== "object" || !("props" in node)) return;
  const element = node as Element;
  return predicate(element) ? element : find(element.props.children, predicate);
}
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
const settle = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };

// Invoke handlers from the real component. Only React's render scheduling,
// confirmation UI, router and server-action I/O are substituted. The fake
// transition records its boundary so a confirmation inside it fails this test.
function harness(recordingPatch: Partial<Props["recording"]> = {}) {
  const props: Props = {
    recording: {
      id: "qa-recording", title: "QA recording", description: null, speaker: null, chapters: [], topics: [],
      seriesId: null, seriesName: null, recordedAt: "2026-11-13T10:00:00Z", createdAt: "2026-11-13T10:00:00Z",
      durationSec: 120, fullDurationSec: 120, trimStartSec: 0, trimEndSec: null, status: "ready", sourceKind: "file",
      phase: { phase: "ready_to_publish", label: "Ready to publish", detail: null },
      posterUrl: null, autoPosterUrl: null, chosenPosterUrl: null, hasCustomArtwork: false,
      app: { published: false, visibility: null, publishedAt: null },
      website: { published: false, publishedAt: null, listed: true },
      eventId: null, sessionId: null, segmentCount: 0, canPublish: true, publishBlockedReason: null, watchUrl: null,
    },
    playback: null, series: [], thumbnails: [],
    settings: { autoPublish: false, defaultVisibility: "public", defaultSeriesId: null, publishToWebsite: true, notifyOnLive: false, notifyOnPublish: false },
    isAdmin: true, appEnabled: false, timeZone: "UTC", stats: null,
  };
  Object.assign(props.recording, recordingPatch);
  const state = {
    dialog: deferred<boolean>(), dialogs: 0, transitions: 0, insideTransition: false, dialogInTransition: false,
    saves: [] as Record<string, unknown>[], publishes: [] as Record<string, unknown>[],
    errors: [] as string[], successes: [] as string[], refreshes: 0,
    saveResult: { ok: true } as { ok: boolean; error?: string },
    publish: async () => ({ ok: true, data: { app: { published: false }, website: { published: true } } }),
  };
  const cells: unknown[] = [], work: Promise<unknown>[] = [];
  let cursor = 0;
  const react = {
    useRef(initial: unknown) { return cells[cursor++] ??= { current: initial }; },
    useState(initial: unknown) {
      const index = cursor++; cells[index] ??= { value: initial };
      const cell = cells[index] as { value: unknown };
      return [cell.value, (value: unknown) => { cell.value = typeof value === "function" ? value(cell.value) : value; }];
    },
    useTransition() {
      cursor++;
      return [state.insideTransition, (callback: () => unknown) => {
        state.transitions++; state.insideTransition = true;
        work.push(Promise.resolve(callback()).finally(() => { state.insideTransition = false; }));
      }];
    },
  };
  const providers: Record<string, unknown> = {
    react,
    "@/components/media/recording-tags-field": { createRecordingTagsValue, recordingTagItems },
    "next/navigation": { useRouter: () => ({ refresh() { state.refreshes++; }, push() {} }) },
    sonner: { toast: { error(message: string) { state.errors.push(message); }, success(message: string) { state.successes.push(message); } } },
    "@/components/ui/confirm-dialog": { confirmAction: () => {
      state.dialogs++; state.dialogInTransition ||= state.insideTransition; return state.dialog.promise;
    } },
    "@/app/dashboard/live-streaming/recording-actions": {
      saveRecordingDetailsAction: async (input: Record<string, unknown>) => { state.saves.push(input); return state.saveResult; },
      publishRecordingAction: async (input: Record<string, unknown>) => { state.publishes.push(input); return state.publish(); },
    },
  };
  const placeholders = new Proxy({}, { get: () => () => null });
  const path = resolve("components/live-streaming/recordings/recording-review.tsx"), localRequire = createRequire(path);
  const source = ts.transpileModule(readFileSync(path, "utf8"), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
  } }).outputText;
  const compiled = { exports: {} as { RecordingReview: (props: Props) => unknown } };
  new Function("require", "module", "exports", source)(
    (name: string) => providers[name] ?? (name.startsWith("@/components/") ? placeholders : localRequire(name)),
    compiled, compiled.exports,
  );
  const render = () => {
    cursor = 0;
    const tree = compiled.exports.RecordingReview(props);
    const primary = find(tree, element => element.props.size === "lg" && typeof element.props.onClick === "function")!;
    return { primary, click: primary.props.onClick as () => Promise<void> | void,
      editTitle(title: string) { (find(tree, element => typeof element.props.onTitleChange === "function")!.props.onTitleChange as (value: string) => void)(title); },
      editTags(values: { speakers: RecordingTagsValue; chapters: RecordingTagsValue; topics: RecordingTagsValue }) {
        const fields = find(tree, element => typeof element.props.onSpeakersChange === "function")!;
        for (const [key, value] of Object.entries(values)) {
          const callback = { speakers: "onSpeakersChange", chapters: "onChaptersChange", topics: "onTopicsChange" }[key as keyof typeof values];
          (fields.props[callback] as (value: RecordingTagsValue) => void)(value);
        }
      } };
  };
  return { state, render, async finish() { await settle(); await Promise.all(work); } };
}

test("recording website confirmation opens before any transition; cancel performs no writes and allows retry", async () => {
  const review = harness(), button = review.render();
  const first = button.click();
  assert.equal(review.state.dialogs, 1);
  assert.equal(review.state.dialogInTransition, false);
  assert.equal(review.state.transitions, 0);
  assert.equal(review.render().primary.props.disabled, true);
  await button.click();
  assert.equal(review.state.dialogs, 1, "rapid duplicate clicks must not replace the pending dialog");
  review.state.dialog.resolve(false); await first; await review.finish();
  assert.equal(review.state.transitions, 0); assert.deepEqual(review.state.publishes, []); assert.deepEqual(review.state.saves, []);
  assert.equal(review.render().primary.props.disabled, false);
  review.state.dialog = deferred<boolean>();
  const retry = review.render().click(); assert.equal(review.state.dialogs, 2);
  review.state.dialog.resolve(false); await retry;
});

test("confirmation starts one write transition and preserves edited details and website-only publication payload", async () => {
  const review = harness();
  review.render().editTitle("Our edited sermon title");
  const button = review.render(), first = button.click();
  const publication = deferred<Awaited<ReturnType<typeof review.state.publish>>>(); review.state.publish = () => publication.promise;
  review.state.dialog.resolve(true); await first; await settle();
  assert.equal(review.state.transitions, 1); assert.equal(review.state.dialogInTransition, false);
  assert.equal(review.state.saves[0].title, "Our edited sermon title");
  assert.deepEqual(review.state.publishes, [{ recordingId: "qa-recording", appVisibility: null, website: true, notifyMembers: false }]);
  await button.click(); assert.equal(review.state.dialogs, 1); assert.equal(review.state.publishes.length, 1);
  publication.resolve({ ok: true, data: { app: { published: false }, website: { published: true } } }); await review.finish();
  assert.equal(review.render().primary.props.disabled, false);
  assert.equal(review.state.successes.length, 1); assert.equal(review.state.refreshes, 1);
});

test("confirmation and publication exceptions release the guard with recoverable feedback and no false success", async () => {
  const review = harness(), first = review.render().click();
  review.state.dialog.reject(new Error("injected confirmation failure")); await first;
  assert.equal(review.state.transitions, 0); assert.equal(review.render().primary.props.disabled, false);
  assert.match(review.state.errors[0], /confirmation could not open.*Try again/);
  review.state.dialog = deferred<boolean>(); review.state.publish = async () => { throw new Error("injected network failure"); };
  const retry = review.render().click(); review.state.dialog.resolve(true); await retry; await review.finish();
  assert.equal(review.state.dialogs, 2); assert.equal(review.state.publishes.length, 1);
  assert.equal(review.render().primary.props.disabled, false); assert.deepEqual(review.state.successes, []);
  assert.match(review.state.errors[1], /couldn't confirm publishing.*entries are still here.*Try again/);
});

test("a details save failure never publishes and leaves the form available for retry", async () => {
  const review = harness(); review.render().editTitle("Keep this title"); review.state.saveResult = { ok: false, error: "Details could not save. Try again." };
  const click = review.render().click(); review.state.dialog.resolve(true); await click; await review.finish();
  assert.deepEqual(review.state.publishes, []); assert.deepEqual(review.state.successes, []);
  assert.equal(review.render().primary.props.disabled, false);
  assert.match(review.state.errors[0], /Details could not save/);
});

test("publishing includes pending tags and every saved speaker even when the options section is folded", async () => {
  const review = harness({ speaker: "Pastor A", speakers: ["Pastor A", "Pastor B"], chapters: ["John 1"], topics: ["Hope"] });
  review.render().editTags({
    speakers: { items: ["Pastor A", "Pastor B"], draft: "Doe, Jane" },
    chapters: { items: ["John 1"], draft: "Romans 8:1, 3" },
    topics: { items: ["Hope"], draft: "Grace, mercy" },
  });
  const click = review.render().click(); review.state.dialog.resolve(true); await click; await review.finish();
  assert.deepEqual(review.state.saves[0].speakers, ["Pastor A", "Pastor B", "Doe, Jane"]);
  assert.deepEqual(review.state.saves[0].chapters, ["John 1", "Romans 8:1, 3"]);
  assert.deepEqual(review.state.saves[0].topics, ["Hope", "Grace, mercy"]);
  assert.equal(review.state.publishes.length, 1);
});
