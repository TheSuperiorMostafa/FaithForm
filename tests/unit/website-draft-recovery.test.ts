import assert from "node:assert/strict";
import test from "node:test";
import { AutosaveQueue, type SaveResult } from "../../components/website-admin/autosave-queue";
import { DraftRecoveryStore, websiteRecoveryKey, isRecoveryRecord, draftRecoveryVersion } from "../../components/website-admin/draft-recovery";

function memoryStorage() {
  const rows = new Map<string, string>();
  return { getItem: (key: string) => rows.get(key) ?? null, setItem: (key: string, value: string) => { rows.set(key, value); }, removeItem: (key: string) => { rows.delete(key); } };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
const scope = { userId: "pastor-a", churchId: "church-a" };
const key = websiteRecoveryKey(scope, "section:welcome");
const ok = { ok: true } as const;

test("Back before the debounce preserves a per-tab draft without starting a late write", async () => {
  const storage = memoryStorage();
  const store = new DraftRecoveryStore<Record<string, unknown>>(storage, key);
  let writes = 0;
  const queue = new AutosaveQueue<Record<string, unknown>>(async () => { writes++; return ok; }, () => {}, undefined, store);
  queue.enqueue({ headline: "Our local church" }, 60_000);
  queue.stop();
  await Promise.resolve();
  assert.equal(writes, 0);
  // A fresh store represents the editor remount after history or refresh.
  const recovered = new DraftRecoveryStore<Record<string, unknown>>(storage, key).read(isRecoveryRecord);
  assert.deepEqual(recovered?.value, { headline: "Our local church" });
  assert.equal(writes, 0, "reading a backup never publishes or autosaves it");
});

test("a failed save survives refresh; a confirmed successful retry removes its recovery", async () => {
  const storage = memoryStorage();
  const store = new DraftRecoveryStore<Record<string, unknown>>(storage, key);
  const first = new AutosaveQueue<Record<string, unknown>>(async () => ({ ok: false, error: "No connection." }), () => {}, undefined, store);
  first.enqueue({ headline: "Keep this wording" }, 60_000);
  assert.equal((await first.flush()).ok, false);
  first.stop();
  const remounted = new DraftRecoveryStore<Record<string, unknown>>(storage, key);
  const recovered = remounted.read(isRecoveryRecord);
  assert.deepEqual(recovered?.value, { headline: "Keep this wording" });
  const retry = new AutosaveQueue<Record<string, unknown>>(async () => ok, () => {}, undefined, remounted);
  retry.enqueue(recovered!.value, 60_000); // Explicit Restore, never automatic.
  await retry.flush();
  assert.equal(new DraftRecoveryStore(storage, key).read(isRecoveryRecord), null);
  retry.stop();
});

test("a late successful response cannot clear a newer draft left by Back", async () => {
  const storage = memoryStorage();
  const store = new DraftRecoveryStore<Record<string, unknown>>(storage, key);
  const request = deferred<SaveResult>();
  let writes = 0;
  const queue = new AutosaveQueue<Record<string, unknown>>(async () => { writes++; return request.promise; }, () => {}, undefined, store);
  queue.enqueue({ headline: "first" }, 60_000);
  const saving = queue.flush();
  await Promise.resolve();
  queue.enqueue({ headline: "newest" }, 60_000);
  queue.stop();
  request.resolve(ok);
  await saving;
  assert.equal(writes, 1, "the unmounted editor must not launch its newer write");
  assert.deepEqual(new DraftRecoveryStore(storage, key).read(isRecoveryRecord)?.value, { headline: "newest" });
});

test("successful server reset clears recovery and never recreates a manual override", async () => {
  const storage = memoryStorage();
  const store = new DraftRecoveryStore<Record<string, unknown>>(storage, key);
  let writes = 0;
  const queue = new AutosaveQueue<Record<string, unknown>>(async () => { writes++; return ok; }, () => {}, undefined, store);
  queue.enqueue({ headline: "old override" }, 60_000);
  queue.adoptSaved();
  queue.stop();
  assert.equal(store.read(isRecoveryRecord), null);
  assert.equal(writes, 0);
});

test("recovery never crosses users, churches, or section/form identity", () => {
  const storage = memoryStorage();
  const original = new DraftRecoveryStore(storage, key);
  original.capture({ headline: "Church A only" });
  for (const otherKey of [
    websiteRecoveryKey({ ...scope, userId: "pastor-b" }, "section:welcome"),
    websiteRecoveryKey({ ...scope, churchId: "church-b" }, "section:welcome"),
    websiteRecoveryKey(scope, "section:about"),
    websiteRecoveryKey(scope, "details"),
  ]) {
    assert.equal(new DraftRecoveryStore(storage, otherKey).read(isRecoveryRecord), null);
    // Even a copied/mis-keyed envelope must not be accepted under another scope.
    storage.setItem(otherKey, storage.getItem(key)!);
    assert.equal(new DraftRecoveryStore(storage, otherKey).read(isRecoveryRecord), null);
  }
});

test("an already-saved revision removes a remounted editor's stale recovery notice", () => {
  const storage = memoryStorage();
  const store = new DraftRecoveryStore(storage, key);
  const acknowledge = store.capture({ headline: "already saved" });
  const remounted = new DraftRecoveryStore(storage, key);
  let removed = false;
  const unsubscribe = remounted.subscribeToRemoval(() => { removed = true; });
  acknowledge();
  assert.equal(removed, true);
  assert.equal(remounted.read(isRecoveryRecord), null);
  unsubscribe();
});

test("unavailable browser storage reports the missing backup without breaking a save", async () => {
  let warnings = 0;
  const store = new DraftRecoveryStore<Record<string, unknown>>(null, key, () => { warnings++; });
  const queue = new AutosaveQueue<Record<string, unknown>>(async () => ok, () => {}, undefined, store);
  queue.enqueue({ headline: "can still save" }, 60_000);
  assert.deepEqual(await queue.flush(), ok);
  assert.equal(warnings, 1);
  queue.stop();
});

test("discard/reset invalidates late uploads, while acknowledging an older text save does not", () => {
  const storage = memoryStorage();
  const store = new DraftRecoveryStore(storage, key);
  const before = draftRecoveryVersion(key);
  const acknowledge = store.capture({ headline: "saved text" });
  acknowledge();
  assert.equal(draftRecoveryVersion(key), before);
  store.clear();
  assert.equal(draftRecoveryVersion(key), before + 1);
});

test("Back immediately after requesting a flush does not start a request after unmount", async () => {
  const store = new DraftRecoveryStore<Record<string, unknown>>(memoryStorage(), key);
  let writes = 0;
  const queue = new AutosaveQueue<Record<string, unknown>>(async () => { writes++; return ok; }, () => {}, undefined, store);
  queue.enqueue({ headline: "last keystroke" }, 60_000);
  const saving = queue.flush();
  queue.stop();
  assert.equal((await saving).ok, false);
  assert.equal(writes, 0);
  assert.deepEqual(store.read(isRecoveryRecord)?.value, { headline: "last keystroke" });
});
