import assert from "node:assert/strict";
import test from "node:test";

import {
  createFacebookReelsClient,
  FACEBOOK_REELS_GRAPH_VERSION,
  interpretStatus,
  normalizeReelPermalink,
  ReelProviderError,
  resolveReelsGraphVersion,
  validateReelMedia,
  type ReelMediaProbe,
} from "@/lib/integrations/facebook-reels";
import { GRAPH } from "@/lib/integrations/facebook-token";

const TOKEN = "EAAB-secret-page-token-123";
const PAGE = "1234567890";

type Call = { url: string; init: RequestInit };

function stubFetch(
  respond: (url: URL, init: RequestInit) => Response | Promise<Response>,
) {
  const calls: Call[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input);
    calls.push({ url, init });
    return respond(new URL(url), init);
  }) as typeof fetch;
  return { fetchImpl, calls };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const graphError = (code: number, status = 400, type = "GraphMethodException") =>
  json({ error: { message: `Error with token ${TOKEN}`, code, type } }, status);

function client(fetchImpl: typeof fetch) {
  return createFacebookReelsClient({
    fetch: fetchImpl,
    graphVersion: "v27.0",
    pageId: PAGE,
    pageToken: TOKEN,
    timeoutMs: 1000,
  });
}

async function rejects(promise: Promise<unknown>): Promise<ReelProviderError> {
  try {
    await promise;
  } catch (error) {
    assert.ok(error instanceof ReelProviderError, "expected a ReelProviderError");
    assert.ok(!error.message.includes(TOKEN), "token leaked into message");
    assert.ok(!error.message.includes("http"), "URL leaked into message");
    assert.match(error.code, /^[a-z0-9_]{1,60}$/);
    return error;
  }
  assert.fail("expected the call to throw");
}

test("Reels use their own Graph version, overridable by env, without moving the shared one", () => {
  assert.equal(FACEBOOK_REELS_GRAPH_VERSION, "v27.0");
  assert.equal(GRAPH, "https://graph.facebook.com/v21.0");
  assert.equal(resolveReelsGraphVersion({}), "v27.0");
  assert.equal(resolveReelsGraphVersion({ FACEBOOK_REELS_GRAPH_VERSION: "v28.0" }), "v28.0");
  assert.equal(resolveReelsGraphVersion({ FACEBOOK_REELS_GRAPH_VERSION: "nonsense/../" }), "v27.0");
});

test("start, upload and finish send the documented requests", async () => {
  const { fetchImpl, calls } = stubFetch((url) => {
    if (url.hostname === "rupload.facebook.com") return json({ success: true });
    if (url.pathname.endsWith("/video_reels")) {
      return calls.at(-1)!.init.body!.toString().includes("upload_phase=start")
        ? json({ video_id: "555", upload_url: "https://rupload.facebook.com/video-upload/v27.0/555" })
        : json({ success: true, post_id: "999" });
    }
    return json({});
  });
  const reels = client(fetchImpl);

  const started = await reels.startUpload();
  assert.deepEqual(started, { videoId: "555", uploadUrl: "https://rupload.facebook.com/video-upload/v27.0/555" });
  assert.equal(calls[0].url, `https://graph.facebook.com/v27.0/${PAGE}/video_reels`);
  const startBody = new URLSearchParams(String(calls[0].init.body));
  assert.equal(startBody.get("upload_phase"), "start");
  assert.equal(startBody.get("access_token"), TOKEN);

  await reels.uploadBinary({
    uploadUrl: started.uploadUrl,
    videoId: "555",
    body: new Uint8Array([1, 2, 3]),
    fileSize: 10,
    offset: 7,
  });
  const headers = calls[1].init.headers as Record<string, string>;
  assert.equal(headers.Authorization, `OAuth ${TOKEN}`);
  assert.equal(headers.offset, "7");
  assert.equal(headers.file_size, "10");
  assert.ok(!calls[1].url.includes(TOKEN));

  const finished = await reels.finish({ videoId: "555", description: "Grace & truth" });
  assert.deepEqual(finished, { postId: "999" });
  const finishBody = new URLSearchParams(String(calls[2].init.body));
  assert.equal(finishBody.get("upload_phase"), "finish");
  assert.equal(finishBody.get("video_state"), "PUBLISHED");
  assert.equal(finishBody.get("video_id"), "555");
  assert.equal(finishBody.get("description"), "Grace & truth");
});

test("an upload URL off Meta's hosts is ignored so the token is never sent elsewhere", async () => {
  const { fetchImpl, calls } = stubFetch((url) =>
    url.pathname.endsWith("/video_reels")
      ? json({ video_id: "555", upload_url: "https://evil.example.com/upload" })
      : json({ success: true }),
  );
  const reels = client(fetchImpl);
  const started = await reels.startUpload();
  assert.equal(started.uploadUrl, "https://rupload.facebook.com/video-upload/v27.0/555");
  await reels.uploadBinary({ uploadUrl: "https://evil.example.com/x", videoId: "555", body: new Uint8Array(1), fileSize: 1, offset: 0 });
  assert.equal(new URL(calls[1].url).hostname, "rupload.facebook.com");
});

test("GET calls keep the token out of the URL", async () => {
  const { fetchImpl, calls } = stubFetch(() => json({ id: PAGE, name: "Grace Church" }));
  await client(fetchImpl).verifyPage();
  assert.ok(!calls[0].url.includes(TOKEN));
  assert.equal((calls[0].init.headers as Record<string, string>).Authorization, `OAuth ${TOKEN}`);
});

test("verifyPage rejects a Page that answers with a different id", async () => {
  const { fetchImpl } = stubFetch(() => json({ id: "999999", name: "Other Page" }));
  const error = await rejects(client(fetchImpl).verifyPage());
  assert.equal(error.kind, "terminal");
  assert.equal(error.code, "page_changed");
});

test("errors are classified by Meta code without leaking the token", async () => {
  const cases: Array<[Response, string, string]> = [
    [graphError(613), "retryable", "rate_limited"],
    [graphError(368), "terminal", "blocked"],
    [graphError(190, 400, "OAuthException"), "auth", "reconnect_required"],
    [graphError(463), "auth", "reconnect_required"],
    [graphError(200, 403), "terminal", "permission_missing"],
    [graphError(100), "terminal", "invalid_request"],
    [graphError(6000), "terminal", "upload_failed"],
    [graphError(4), "retryable", "throttled"],
    [json({ error: { code: 2, message: "temp" } }, 500), "retryable", "facebook_unavailable"],
  ];
  for (const [response, kind, code] of cases) {
    const { fetchImpl } = stubFetch(() => response);
    const error = await rejects(client(fetchImpl).startUpload());
    assert.equal(error.kind, kind, code);
    assert.equal(error.code, code);
  }
});

test("6000 during upload is a resumable interruption", async () => {
  const { fetchImpl } = stubFetch(() => graphError(6000));
  const error = await rejects(
    client(fetchImpl).uploadBinary({ videoId: "555", body: new Uint8Array(1), fileSize: 1, offset: 0 }),
  );
  assert.equal(error.kind, "retryable");
  assert.equal(error.code, "upload_interrupted");
});

test("network failure, timeout or 5xx on finish is ambiguous; on start it is retryable", async () => {
  const network = stubFetch(() => {
    throw new TypeError(`fetch failed https://graph.facebook.com/?access_token=${TOKEN}`);
  });
  assert.equal((await rejects(client(network.fetchImpl).finish({ videoId: "5", description: "" }))).kind, "ambiguous");
  assert.equal((await rejects(client(network.fetchImpl).startUpload())).kind, "retryable");

  const server = stubFetch(() => json({ error: { code: 1, message: "unknown" } }, 503));
  const finishError = await rejects(client(server.fetchImpl).finish({ videoId: "5", description: "" }));
  assert.equal(finishError.kind, "ambiguous");
  assert.equal(finishError.code, "finish_unconfirmed");

  const unconfirmed = stubFetch(() => json({}));
  assert.equal((await rejects(client(unconfirmed.fetchImpl).finish({ videoId: "5", description: "" }))).kind, "ambiguous");

  const slow = stubFetch(
    (_url, init) =>
      new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(new Error("aborted")));
      }),
  );
  const slowClient = createFacebookReelsClient({ fetch: slow.fetchImpl, graphVersion: "v27.0", pageId: PAGE, pageToken: TOKEN, timeoutMs: 20 });
  assert.equal((await rejects(slowClient.finish({ videoId: "5", description: "" }))).kind, "ambiguous");
  const timeout = await rejects(slowClient.getStatus("5"));
  assert.equal(timeout.kind, "retryable");
  assert.equal(timeout.code, "timeout");
});

test("permalink tries the video, then the post, and only accepts facebook.com links", async () => {
  const { fetchImpl, calls } = stubFetch((url) =>
    url.pathname.endsWith("/555")
      ? json({ permalink_url: "https://evil.example.com/reel/555" })
      : json({ permalink_url: "https://www.facebook.com/reel/555" }),
  );
  assert.equal(await client(fetchImpl).getPermalink({ videoId: "555", postId: "999" }), "https://www.facebook.com/reel/555");
  assert.equal(calls.length, 2);

  const none = stubFetch(() => graphError(100));
  assert.equal(await client(none.fetchImpl).getPermalink({ videoId: "555", postId: null }), null);

  assert.equal(normalizeReelPermalink("/reel/555"), "https://www.facebook.com/reel/555");
  assert.equal(normalizeReelPermalink("//evil.example.com/x"), null);
  assert.equal(normalizeReelPermalink("http://www.facebook.com/x"), null);
  assert.equal(normalizeReelPermalink("https://facebook.com.evil.example/x"), null);
});

test("interpretStatus maps Meta's phases", () => {
  assert.equal(interpretStatus({ video_status: "uploading", uploading_phase: { status: "in_progress", bytes_transfered: 10 } }), "uploading");
  assert.equal(
    interpretStatus({ video_status: "upload_complete", uploading_phase: { status: "complete" }, publishing_phase: { status: "not_started" } }),
    "uploaded",
  );
  assert.equal(
    interpretStatus({ video_status: "processing", uploading_phase: { status: "completed" }, processing_phase: { status: "in_progress" }, publishing_phase: { status: "in_progress" } }),
    "processing",
  );
  assert.equal(
    interpretStatus({ video_status: "ready", uploading_phase: { status: "complete" }, processing_phase: { status: "complete" }, publishing_phase: { status: "complete", publish_status: "published" } }),
    "published",
  );
  assert.equal(
    interpretStatus({ video_status: "ready", publishing_phase: { status: "complete", publish_status: "draft" } }),
    "processing",
  );
  assert.equal(interpretStatus({ video_status: "ready", processing_phase: { status: "error" } }), "failed");
  assert.equal(interpretStatus({ video_status: "expired" }), "failed");
  assert.equal(interpretStatus({ publishing_phase: { status: "complete", publish_status: "error" } }), "failed");
  assert.equal(interpretStatus({}), "unknown");
  assert.equal(interpretStatus(null), "unknown");
});

const GOOD: ReelMediaProbe = {
  container: "mov,mp4,m4a,3gp,3g2,mj2",
  width: 1080,
  height: 1920,
  fps: 30,
  duration_sec: 45,
  video_codec: "h264",
  pix_fmt: "yuv420p",
  audio_codec: "aac",
  audio_rate: 48000,
  audio_channels: 2,
  faststart: true,
  gop_sec: 2,
};

test("validateReelMedia accepts a spec-conforming Reel", () => {
  assert.deepEqual(validateReelMedia(GOOD), { ok: true, problems: [] });
  assert.equal(validateReelMedia({ ...GOOD, gop_sec: null, video_codec: "hevc" }).ok, true);
  assert.equal(validateReelMedia({ ...GOOD, width: 540, height: 960 }).ok, true);
});

test("validateReelMedia lists each problem in plain language", () => {
  const cases: Array<[Partial<ReelMediaProbe>, RegExp]> = [
    [{ container: "matroska,webm" }, /MP4/],
    [{ width: 1920, height: 1080 }, /vertical/],
    [{ width: 360, height: 640 }, /540/],
    [{ fps: 15 }, /frame rate/],
    [{ fps: 120 }, /frame rate/],
    [{ duration_sec: 2 }, /3 and 90/],
    [{ duration_sec: 120 }, /3 and 90/],
    [{ video_codec: "mpeg4" }, /H\.264/],
    [{ pix_fmt: "yuv444p" }, /yuv420p/],
    [{ audio_codec: "mp3" }, /AAC/],
    [{ audio_rate: 44100 }, /48 kHz/],
    [{ faststart: false }, /fast start/],
    [{ gop_sec: 10 }, /keyframes/],
  ];
  for (const [change, pattern] of cases) {
    const outcome = validateReelMedia({ ...GOOD, ...change });
    assert.equal(outcome.ok, false, JSON.stringify(change));
    assert.equal(outcome.problems.length, 1, JSON.stringify(outcome.problems));
    assert.match(outcome.problems[0], pattern);
  }
});
