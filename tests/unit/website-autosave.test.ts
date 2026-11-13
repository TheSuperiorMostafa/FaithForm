import assert from "node:assert/strict";
import test from "node:test";
import { AutosaveQueue, type SaveResult } from "../../components/website-admin/autosave-queue";
import { flushWebsiteEdits, registerWebsiteEditor } from "../../components/website-admin/editor-save-guard";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

const ok = { ok: true } as const;

test("rapid changes save serially and the newest complete draft wins", async () => {
  const first = deferred<SaveResult>();
  const writes: string[] = [];
  const queue = new AutosaveQueue<string>(async value => {
    writes.push(value);
    return writes.length === 1 ? first.promise : ok;
  }, () => {});
  queue.enqueue("first", 60_000);
  const flushing = queue.flush();
  await Promise.resolve();
  queue.enqueue("second", 60_000);
  queue.enqueue("last", 60_000);
  assert.deepEqual(writes, ["first"]);
  first.resolve(ok);
  assert.deepEqual(await flushing, ok);
  assert.deepEqual(writes, ["first", "last"]);
  assert.equal(queue.hasUnsavedChanges, false);
  queue.stop();
});

test("a rejected edit stays dirty and can be retried without another keystroke", async () => {
  const writes: string[] = [];
  const queue = new AutosaveQueue<string>(async value => {
    writes.push(value);
    return writes.length === 1 ? { ok: false, error: "Try again." } : ok;
  }, () => {});
  queue.enqueue("church photo", 60_000);
  assert.equal((await queue.flush()).ok, false);
  assert.equal(queue.hasUnsavedChanges, true);
  assert.deepEqual(await queue.flush(), ok);
  assert.deepEqual(writes, ["church photo", "church photo"]);
  assert.equal(queue.hasUnsavedChanges, false);
  queue.stop();
});

test("an old save finishes before a reset, and adopting the reset never rewrites it", async () => {
  const first = deferred<SaveResult>();
  const writes: string[] = [];
  const queue = new AutosaveQueue<string>(async value => {
    writes.push(value);
    return first.promise;
  }, () => {});
  queue.enqueue("old hand edit", 60_000);
  const resetting = (async () => {
    await queue.flush();
    writes.push("reset override");
    queue.adoptSaved();
  })();
  await Promise.resolve();
  assert.deepEqual(writes, ["old hand edit"]);
  first.resolve(ok);
  await resetting;
  assert.deepEqual(writes, ["old hand edit", "reset override"]);
  assert.equal(queue.hasUnsavedChanges, false);
  queue.stop();
});

test("navigation waits for every editor and stays put if any save fails", async () => {
  let reject = true;
  const details = new AutosaveQueue<string>(async () => ok, () => {});
  const design = new AutosaveQueue<string>(async () => reject ? { ok: false, error: "Could not save the colour." } : ok, () => {});
  const unregisterDetails = registerWebsiteEditor(details);
  const unregisterDesign = registerWebsiteEditor(design);
  try {
    details.enqueue("new church name", 60_000);
    design.enqueue("new colour", 60_000);
    assert.equal(await flushWebsiteEdits(), false);
    assert.equal(details.hasUnsavedChanges, false);
    assert.equal(design.hasUnsavedChanges, true);
    reject = false;
    assert.equal(await flushWebsiteEdits(), true);
  } finally {
    unregisterDetails();
    unregisterDesign();
    details.stop();
    design.stop();
  }
});

test("a thrown request remains retryable and a newer edit replaces its retry", async () => {
  const writes: string[] = [];
  const queue = new AutosaveQueue<string>(async value => {
    writes.push(value);
    if (writes.length === 1) throw new TypeError("Failed to fetch");
    return ok;
  }, () => {}, [60_000]);
  queue.enqueue("first", 60_000);
  assert.equal((await queue.flush()).ok, false);
  queue.enqueue("newer", 60_000);
  assert.deepEqual(await queue.flush(), ok);
  assert.deepEqual(writes, ["first", "newer"]);
  queue.stop();
});

test("leaving during an upload also drains the form save caused by its URL", async () => {
  const uploaded = deferred<SaveResult>();
  const writes: string[] = [];
  let uploading = true;
  const form = new AutosaveQueue<string>(async value => { writes.push(value); return ok; }, () => {});
  const unregisterForm = registerWebsiteEditor(form);
  const unregisterUpload = registerWebsiteEditor({
    get hasUnsavedChanges() { return uploading; },
    flush: () => uploaded.promise,
  });
  try {
    let navigated = false;
    const leaving = flushWebsiteEdits().then(saved => { navigated = saved; });
    await Promise.resolve();
    assert.equal(navigated, false);
    form.enqueue("https://example.test/new-photo.webp", 60_000);
    uploading = false;
    uploaded.resolve(ok);
    await leaving;
    assert.equal(navigated, true);
    assert.deepEqual(writes, ["https://example.test/new-photo.webp"]);
  } finally {
    unregisterForm();
    unregisterUpload();
    form.stop();
  }
});

test("manual sermon creation can wait for uploads while other navigation stays blocked", async () => {
  const uploaded = deferred<SaveResult>();
  let uploading = true;
  const newSermon = {
    hasUnsavedChanges: true,
    flush: async (): Promise<SaveResult> => ({ ok: false, error: "Choose Add sermon first." }),
  };
  const unregisterSermon = registerWebsiteEditor(newSermon);
  const unregisterUpload = registerWebsiteEditor({
    get hasUnsavedChanges() { return uploading; },
    flush: () => uploaded.promise,
  });
  try {
    const adding = flushWebsiteEdits(newSermon);
    uploading = false;
    uploaded.resolve(ok);
    assert.equal(await adding, true);
    assert.equal(await flushWebsiteEdits(), false);
  } finally {
    unregisterSermon();
    unregisterUpload();
  }
});
