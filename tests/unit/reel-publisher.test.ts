import assert from "node:assert/strict";
import test from "node:test";

import {
  createFacebookReelsClient,
  ReelProviderError,
  type ReelProvider,
  type ReelVideoStatus,
} from "@/lib/integrations/facebook-reels";
import {
  advanceReelPost,
  startReelPost,
  type ReelPostInsert,
  type ReelPostPatch,
  type ReelPostRepo,
  type ReelPostRow,
  type ReelPostStatus,
  type ReelPublisherDeps,
} from "@/lib/sermon-media/reel-publisher";

const TOKEN = "EAAB-secret-page-token-123";
const PAGE = "1234567890";
const VIDEO = "555";
const FILE = new Uint8Array(Array.from({ length: 100 }, (_, i) => i));

// ---------------------------------------------------------------------------
// In-memory repo with compare-and-set updates and a step lock
// ---------------------------------------------------------------------------

function memoryRepo() {
  const rows = new Map<string, ReelPostRow>();
  const locks = new Set<string>();
  const history: ReelPostStatus[] = [];
  let next = 1;
  const repo: ReelPostRepo = {
    async load(id) {
      const row = rows.get(id);
      return row ? { ...row } : null;
    },
    async update(id, patch: ReelPostPatch, expected) {
      const row = rows.get(id);
      if (!row || row.status !== expected) return null;
      const updated = { ...row, ...patch };
      rows.set(id, updated);
      if (patch.status && patch.status !== row.status) history.push(patch.status);
      return { ...updated };
    },
    async acquireStepLock(id) {
      if (locks.has(id)) return false;
      locks.add(id);
      return true;
    },
    async releaseStepLock(id) {
      locks.delete(id);
    },
    async insertOnce(input: ReelPostInsert) {
      for (const row of rows.values()) {
        if (row.render_id === input.render_id && row.page_id === input.page_id && row.status !== "failed") {
          return { row: { ...row }, created: false };
        }
      }
      const row = makeRow({ id: `post-${next++}`, render_id: input.render_id, page_id: input.page_id, caption: input.caption });
      rows.set(row.id, row);
      return { row: { ...row }, created: true };
    },
  };
  return { repo, rows, locks, history };
}

function makeRow(overrides: Partial<ReelPostRow> = {}): ReelPostRow {
  return {
    id: "post-1",
    church_id: "church-1",
    render_id: "render-1",
    page_id: PAGE,
    caption: "Sunday clip",
    status: "starting",
    provider_video_id: null,
    provider_post_id: null,
    permalink: null,
    last_error_code: null,
    last_error: null,
    check_attempts: 0,
    finish_attempts: 0,
    finish_requested_at: null,
    posted_at: null,
    last_checked_at: null,
    ...overrides,
  };
}

const INSERT: ReelPostInsert = {
  church_id: "church-1",
  clip_id: "clip-1",
  render_id: "render-1",
  page_id: PAGE,
  caption: "Sunday clip",
  approved_by: "user-1",
  approved_at: "2026-11-18T10:00:00.000Z",
  posted_by: "user-1",
};

// ---------------------------------------------------------------------------
// Scriptable fake provider
// ---------------------------------------------------------------------------

const UPLOADED: ReelVideoStatus = {
  video_status: "upload_complete",
  uploading_phase: { status: "complete", bytes_transfered: 100 },
  processing_phase: { status: "not_started" },
  publishing_phase: { status: "not_started" },
};
const PROCESSING: ReelVideoStatus = {
  video_status: "processing",
  uploading_phase: { status: "complete", bytes_transfered: 100 },
  processing_phase: { status: "in_progress" },
  publishing_phase: { status: "in_progress" },
};
const PUBLISHED: ReelVideoStatus = {
  video_status: "ready",
  uploading_phase: { status: "complete", bytes_transfered: 100 },
  processing_phase: { status: "complete" },
  publishing_phase: { status: "complete", publish_status: "published" },
};
const partial = (bytes: number): ReelVideoStatus => ({
  video_status: "uploading",
  uploading_phase: { status: "in_progress", bytes_transfered: bytes },
  publishing_phase: { status: "not_started" },
});

const err = (kind: ReelProviderError["kind"], code: string, retryAfterSec?: number) =>
  new ReelProviderError({ kind, code, message: `Plain message for ${code}`, retryAfterSec });

type Script = {
  verify?: () => { id: string; name: string | null };
  start?: () => { videoId: string; uploadUrl: string };
  upload?: (input: { offset: number; bytes: Uint8Array }) => void;
  finish?: () => { postId: string | null };
  status?: () => ReelVideoStatus;
  permalink?: () => string | null;
};

function fakeProvider(script: Script = {}) {
  const calls = { verify: 0, start: 0, upload: [] as Array<{ offset: number; length: number; first: number }>, finish: 0, status: 0, permalink: 0 };
  const provider: ReelProvider = {
    pageId: PAGE,
    async verifyPage() {
      calls.verify += 1;
      return script.verify ? script.verify() : { id: PAGE, name: "Grace Church" };
    },
    async startUpload() {
      calls.start += 1;
      return script.start ? script.start() : { videoId: VIDEO, uploadUrl: `https://rupload.facebook.com/video-upload/v27.0/${VIDEO}` };
    },
    async uploadBinary(input) {
      const bytes = input.body instanceof Uint8Array ? input.body : await readAll(input.body);
      calls.upload.push({ offset: input.offset, length: bytes.byteLength, first: bytes[0] });
      assert.equal(input.fileSize, FILE.byteLength);
      script.upload?.({ offset: input.offset, bytes });
    },
    async finish() {
      calls.finish += 1;
      return script.finish ? script.finish() : { postId: "999_555" };
    },
    async getStatus() {
      calls.status += 1;
      return script.status ? script.status() : PUBLISHED;
    },
    async getPermalink() {
      calls.permalink += 1;
      return script.permalink ? script.permalink() : "https://www.facebook.com/reel/555";
    },
  };
  return { provider, calls };
}

async function readAll(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  const reader = stream.getReader();
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.byteLength, 0));
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.byteLength;
  }
  return out;
}

function chunkedStream(bytes: Uint8Array, size = 30): ReadableStream<Uint8Array> {
  let at = 0;
  return new ReadableStream({
    pull(controller) {
      if (at >= bytes.byteLength) return controller.close();
      controller.enqueue(bytes.slice(at, at + size));
      at += size;
    },
  });
}

function setup(script: Script = {}, row: Partial<ReelPostRow> | null = {}, extra: Partial<ReelPublisherDeps> = {}) {
  const store = memoryRepo();
  if (row) store.rows.set("post-1", makeRow(row));
  const { provider, calls } = fakeProvider(script);
  const reconnects: string[] = [];
  let clock = new Date("2026-11-18T12:00:00.000Z");
  const deps: ReelPublisherDeps = {
    repo: store.repo,
    provider,
    markReconnectRequired: async (reason) => {
      reconnects.push(reason);
    },
    openRender: async () => ({ stream: chunkedStream(FILE), size: FILE.byteLength }),
    now: () => clock,
    ...extra,
  };
  return {
    deps,
    store,
    calls,
    reconnects,
    advanceClock: (sec: number) => {
      clock = new Date(clock.getTime() + sec * 1000);
    },
    row: () => store.rows.get("post-1")!,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test("happy path: verify, start, persist video id, upload, finish once, posted with link", async () => {
  const t = setup();
  const result = await advanceReelPost(t.deps, "post-1");

  assert.deepEqual(result, { status: "posted", done: true, nextCheckInSec: null, outcome: "posted", errorCode: null });
  assert.equal(t.calls.verify, 1);
  assert.equal(t.calls.start, 1);
  assert.deepEqual(t.calls.upload, [{ offset: 0, length: 100, first: 0 }]);
  assert.equal(t.calls.finish, 1);
  assert.deepEqual(t.store.history, ["uploading", "finishing", "processing", "posted"]);
  assert.equal(t.row().provider_video_id, VIDEO);
  assert.equal(t.row().provider_post_id, "999_555");
  assert.equal(t.row().permalink, "https://www.facebook.com/reel/555");
  assert.equal(t.row().finish_attempts, 1);
  assert.ok(t.row().posted_at);
  assert.equal(t.store.locks.size, 0, "lock released");

  // Calling again is a no-op.
  const again = await advanceReelPost(t.deps, "post-1");
  assert.equal(again.outcome, "posted");
  assert.equal(t.calls.start, 1);
  assert.equal(t.calls.finish, 1);
});

test("the video id is persisted before any bytes are sent", async () => {
  const t = setup({
    upload: () => {
      assert.equal(t.row().provider_video_id, VIDEO);
      assert.equal(t.row().status, "uploading");
    },
  });
  await advanceReelPost(t.deps, "post-1");
  assert.equal(t.calls.upload.length, 1);
});

test("still processing after finish waits with a next check", async () => {
  const t = setup({ status: () => PROCESSING });
  const result = await advanceReelPost(t.deps, "post-1");
  assert.equal(result.status, "processing");
  assert.equal(result.outcome, "waiting");
  assert.equal(result.done, false);
  assert.ok(result.nextCheckInSec && result.nextCheckInSec > 0);
  assert.equal(t.row().check_attempts, 1);
  assert.equal(t.calls.finish, 1);

  // Publishing not yet started after a confirmed finish: wait, never re-finish.
  t.advanceClock(3600);
  let finished = false;
  const t2 = setup(
    {
      status: () => (finished ? PUBLISHED : UPLOADED),
      finish: () => {
        finished = true;
        return { postId: null };
      },
    },
    { ...t.row() },
  );
  await advanceReelPost(t2.deps, "post-1");
  assert.equal(t2.calls.finish, 0);
  assert.equal(t2.row().status, "processing");
});

test("double click: insertOnce returns the existing row and no second video is started", async () => {
  const t = setup({ status: () => PROCESSING }, null);
  const first = await startReelPost(t.deps, INSERT);
  const second = await startReelPost(t.deps, INSERT);
  assert.equal(first.created, true);
  assert.equal(second.created, false);
  assert.equal(second.post.id, first.post.id);
  assert.equal(t.calls.start, 1);
  assert.equal(t.calls.finish, 1);
});

test("concurrent advances: the second caller is locked out and does nothing", async () => {
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const t = setup();
  const slowStart = t.deps.provider.startUpload.bind(t.deps.provider);
  t.deps.provider = {
    ...t.deps.provider,
    startUpload: async () => {
      await gate;
      return slowStart();
    },
  };
  const firstRun = advanceReelPost(t.deps, "post-1");
  await new Promise((resolve) => setImmediate(resolve));
  const second = await advanceReelPost(t.deps, "post-1");
  assert.equal(second.outcome, "locked");
  release();
  assert.equal((await firstRun).outcome, "posted");
  assert.equal(t.calls.start, 1);
});

test("lost response on start leaves the post starting with no video id, retryable", async () => {
  // Residual risk: if Meta created the upload session but the answer never
  // reached us, that session is orphaned. It is never finished (so nothing is
  // published) and Meta expires it. The retry below starts a fresh session.
  const t = setup({
    start: () => {
      throw err("retryable", "network_error", 30);
    },
  });
  const result = await advanceReelPost(t.deps, "post-1");
  assert.equal(result.outcome, "retry_later");
  assert.equal(result.status, "starting");
  assert.equal(result.nextCheckInSec, 30);
  assert.equal(t.row().provider_video_id, null);
  assert.equal(t.row().last_error_code, "network_error");
  assert.equal(t.calls.upload.length, 0);
  assert.equal(t.calls.finish, 0);
});

test("ambiguous finish goes to needs_check, then posts when Meta reports it published", async () => {
  let finishCalls = 0;
  const t = setup({
    finish: () => {
      finishCalls += 1;
      throw err("ambiguous", "finish_unconfirmed");
    },
  });
  const first = await advanceReelPost(t.deps, "post-1");
  assert.equal(first.status, "needs_check");
  assert.equal(first.outcome, "waiting");
  assert.equal(t.calls.status, 0);

  const second = await advanceReelPost(t.deps, "post-1");
  assert.equal(second.outcome, "posted");
  assert.equal(finishCalls, 1, "finish is not re-sent blindly");
  assert.equal(t.row().permalink, "https://www.facebook.com/reel/555");
  assert.equal(t.row().last_error_code, null);
});

test("ambiguous finish with Meta still processing stays in needs_check", async () => {
  const t = setup(
    { status: () => PROCESSING },
    { status: "needs_check", provider_video_id: VIDEO, finish_attempts: 1, finish_requested_at: "2026-11-18T11:00:00.000Z" },
  );
  const result = await advanceReelPost(t.deps, "post-1");
  assert.equal(result.status, "needs_check");
  assert.equal(result.outcome, "waiting");
  assert.equal(t.calls.finish, 0);
  assert.equal(t.row().check_attempts, 1);
});

test("unconfirmed finish with upload complete but publishing not started: one re-finish after the grace period", async () => {
  let published = false;
  const t = setup(
    {
      status: () => (published ? PUBLISHED : UPLOADED),
      finish: () => {
        published = true;
        return { postId: null };
      },
    },
    { status: "needs_check", provider_video_id: VIDEO, finish_attempts: 1, finish_requested_at: "2026-11-18T11:58:00.000Z" },
  );

  // Inside the grace period: wait.
  const early = await advanceReelPost(t.deps, "post-1");
  assert.equal(early.status, "needs_check");
  assert.equal(t.calls.finish, 0);

  t.advanceClock(600);
  const late = await advanceReelPost(t.deps, "post-1");
  assert.equal(t.calls.finish, 1);
  assert.equal(t.calls.start, 0, "never a new video");
  assert.equal(late.outcome, "posted");
  assert.equal(t.row().finish_attempts, 2);
});

test("the re-finish is allowed only once", async () => {
  const t = setup(
    {
      status: () => UPLOADED,
      finish: () => {
        throw err("ambiguous", "finish_unconfirmed");
      },
    },
    { status: "needs_check", provider_video_id: VIDEO, finish_attempts: 1, finish_requested_at: "2026-11-18T11:00:00.000Z" },
  );
  await advanceReelPost(t.deps, "post-1");
  assert.equal(t.calls.finish, 1);
  t.advanceClock(7200);
  await advanceReelPost(t.deps, "post-1");
  await advanceReelPost(t.deps, "post-1");
  assert.equal(t.calls.finish, 1);
  assert.equal(t.row().status, "needs_check");
  assert.equal(t.calls.start, 0);
});

test("a row found in finishing (crash mid-finish) is checked, not finished again", async () => {
  const t = setup(
    { status: () => PUBLISHED },
    { status: "finishing", provider_video_id: VIDEO, finish_attempts: 1, finish_requested_at: "2026-11-18T11:59:00.000Z" },
  );
  const result = await advanceReelPost(t.deps, "post-1");
  assert.equal(result.outcome, "posted");
  assert.equal(t.calls.finish, 0);
});

test("interrupted upload resumes from Meta's bytes_transfered", async () => {
  let attempt = 0;
  let status: ReelVideoStatus = partial(0);
  const t = setup({
    upload: ({ offset, bytes }) => {
      attempt += 1;
      if (attempt === 1) {
        status = partial(40);
        throw err("retryable", "upload_interrupted", 30);
      }
      assert.equal(offset, 40);
      assert.equal(bytes.byteLength, 60);
      status = UPLOADED;
    },
    status: () => (attempt >= 2 ? PUBLISHED : status),
  });

  const first = await advanceReelPost(t.deps, "post-1");
  assert.equal(first.outcome, "retry_later");
  assert.equal(first.status, "uploading");
  assert.equal(t.row().provider_video_id, VIDEO);

  const second = await advanceReelPost(t.deps, "post-1");
  assert.equal(second.outcome, "posted");
  assert.equal(t.calls.start, 1);
  assert.deepEqual(
    t.calls.upload.map(({ offset, length, first: firstByte }) => ({ offset, length, firstByte })),
    [
      { offset: 0, length: 100, firstByte: 0 },
      { offset: 40, length: 60, firstByte: 40 },
    ],
  );
  assert.equal(t.calls.finish, 1);
});

test("needs_check with an incomplete upload resumes the upload on the same video", async () => {
  let uploaded = false;
  const t = setup(
    {
      status: () => (uploaded ? PUBLISHED : partial(70)),
      upload: ({ offset }) => {
        assert.equal(offset, 70);
        uploaded = true;
      },
    },
    { status: "needs_check", provider_video_id: VIDEO },
  );
  const result = await advanceReelPost(t.deps, "post-1");
  assert.equal(result.outcome, "posted");
  assert.equal(t.calls.start, 0);
  assert.equal(t.calls.upload.length, 1);
  assert.equal(t.calls.finish, 1);
});

test("613 rate limit keeps the step and asks to retry later", async () => {
  const t = setup({
    finish: () => {
      throw err("retryable", "rate_limited", 3600);
    },
  });
  const result = await advanceReelPost(t.deps, "post-1");
  assert.equal(result.outcome, "retry_later");
  assert.equal(result.nextCheckInSec, 3600);
  assert.equal(result.errorCode, "rate_limited");
  assert.equal(t.row().status, "uploading");
  assert.equal(t.row().finish_attempts, 0, "a refused finish does not use up the attempt");

  // Next run: upload already complete at Meta, so it goes straight to finish.
  let finished = false;
  const t2 = setup(
    {
      status: () => (finished ? PUBLISHED : UPLOADED),
      finish: () => {
        finished = true;
        return { postId: null };
      },
    },
    { ...t.row() },
  );
  t2.store.rows.set("post-1", { ...t.row() });
  const retried = await advanceReelPost(t2.deps, "post-1");
  assert.equal(retried.outcome, "posted");
  assert.equal(t2.calls.upload.length, 0);
  assert.equal(t2.calls.finish, 1);
});

test("368 block fails the post with a plain code", async () => {
  const t = setup({
    start: () => {
      throw err("terminal", "blocked");
    },
  });
  const result = await advanceReelPost(t.deps, "post-1");
  assert.deepEqual(result, { status: "failed", done: true, nextCheckInSec: null, outcome: "failed", errorCode: "blocked" });
  assert.equal(t.row().last_error_code, "blocked");
});

test("Meta reporting a processing error fails the post", async () => {
  const t = setup({ status: () => ({ video_status: "error", processing_phase: { status: "error" } }) });
  const result = await advanceReelPost(t.deps, "post-1");
  assert.equal(result.status, "failed");
  assert.equal(result.errorCode, "processing_failed");
});

test("auth error refreshes the Page token once and continues", async () => {
  const t = setup({
    verify: () => {
      throw err("auth", "reconnect_required");
    },
  });
  const { provider: fresh, calls: freshCalls } = fakeProvider();
  let refreshes = 0;
  t.deps.refreshProvider = async () => {
    refreshes += 1;
    return fresh;
  };
  const result = await advanceReelPost(t.deps, "post-1");
  assert.equal(result.outcome, "posted");
  assert.equal(refreshes, 1);
  assert.equal(freshCalls.start, 1);
  assert.equal(t.reconnects.length, 0);
});

test("auth error that survives a refresh marks reconnect required and fails", async () => {
  const authFail = () => {
    throw err("auth", "reconnect_required");
  };
  const t = setup({ verify: authFail });
  const { provider: stillBad } = fakeProvider({ verify: authFail });
  let refreshes = 0;
  t.deps.refreshProvider = async () => {
    refreshes += 1;
    return stillBad;
  };
  const result = await advanceReelPost(t.deps, "post-1");
  assert.equal(refreshes, 1);
  assert.equal(result.status, "failed");
  assert.equal(result.errorCode, "reconnect_required");
  assert.equal(t.reconnects.length, 1);
  assert.equal(t.row().last_error_code, "reconnect_required");
});

test("auth error with no refresh available goes straight to reconnect_required", async () => {
  const t = setup({
    status: () => {
      throw err("auth", "reconnect_required");
    },
  }, { status: "processing", provider_video_id: VIDEO, finish_attempts: 1 });
  const result = await advanceReelPost(t.deps, "post-1");
  assert.equal(result.errorCode, "reconnect_required");
  assert.equal(t.reconnects.length, 1);
});

test("end to end over stub fetch: replaced Page fails page_changed and no token leaks", async () => {
  const seen: string[] = [];
  const fetchImpl = (async (input: RequestInfo | URL) => {
    seen.push(String(input));
    return new Response(JSON.stringify({ id: "42", name: "Someone else's Page" }), { status: 200 });
  }) as typeof fetch;
  const provider = createFacebookReelsClient({ fetch: fetchImpl, graphVersion: "v27.0", pageId: PAGE, pageToken: TOKEN });
  const t = setup({}, {}, { provider });
  const result = await advanceReelPost(t.deps, "post-1");
  assert.equal(result.status, "failed");
  assert.equal(result.errorCode, "page_changed");
  assert.equal(seen.length, 1, "nothing uploaded to the wrong Page");
  assert.ok(!JSON.stringify(t.row()).includes(TOKEN));
});

test("end to end over stub fetch: happy path and Meta errors never put the token in stored errors", async () => {
  const requests: Array<{ url: string; body: string }> = [];
  let finished = false;
  let failFinishWith613 = true;
  const fetchImpl = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(String(input));
    const body = typeof init.body === "string" || init.body instanceof URLSearchParams ? String(init.body) : "";
    requests.push({ url: url.toString(), body });
    const reply = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
    if (url.hostname === "rupload.facebook.com") {
      if (init.body && !(init.body instanceof Uint8Array)) await readAll(init.body as ReadableStream<Uint8Array>);
      return reply({ success: true });
    }
    if (url.pathname.endsWith(`/${PAGE}`)) return reply({ id: PAGE, name: "Grace Church" });
    if (url.pathname.endsWith("/video_reels")) {
      if (body.includes("upload_phase=start")) {
        return reply({ video_id: VIDEO, upload_url: `https://rupload.facebook.com/video-upload/v27.0/${VIDEO}` });
      }
      if (failFinishWith613) {
        failFinishWith613 = false;
        return reply({ error: { code: 613, message: `Calls limited for token ${TOKEN}` } }, 400);
      }
      finished = true;
      return reply({ success: true });
    }
    if (url.searchParams.get("fields") === "status") {
      return reply({ status: finished ? PUBLISHED : UPLOADED });
    }
    if (url.searchParams.get("fields") === "permalink_url") {
      return reply({ permalink_url: "/reel/555" });
    }
    return reply({ error: { code: 100, message: "unknown" } }, 400);
  }) as typeof fetch;

  const provider = createFacebookReelsClient({ fetch: fetchImpl, graphVersion: "v27.0", pageId: PAGE, pageToken: TOKEN });
  const t = setup({}, {}, { provider });

  const first = await advanceReelPost(t.deps, "post-1");
  assert.equal(first.errorCode, "rate_limited");
  assert.ok(!JSON.stringify(t.row()).includes(TOKEN));
  assert.ok(!(t.row().last_error ?? "").includes("http"));

  const second = await advanceReelPost(t.deps, "post-1");
  assert.equal(second.outcome, "posted");
  assert.equal(t.row().permalink, "https://www.facebook.com/reel/555");
  assert.equal(requests.filter((r) => r.body.includes("upload_phase=start")).length, 1);
  assert.equal(requests.filter((r) => r.body.includes("upload_phase=finish")).length, 2);
  assert.ok(requests.every((r) => !r.url.includes(TOKEN)), "token never in a URL");
});
