// Isolated stream-start harness: all platform/recording access is mocked.
import assert from "node:assert/strict";
import path from "node:path";
import Module from "node:module";
import { require as loadTypeScript } from "tsx/cjs/api";
const scenario = process.argv[2];
let active = null;
let providerCalls = 0;
let fault = true;
let handoff = null;
let signCalls = 0;
let legacySource = null;
let operationLease = null;
const event = {
  id: "11111111-1111-4111-8111-111111111111", churchId: "church", title: "Service",
  simulated: true, simulatedSourcePath: "church/video.mp4", status: "scheduled",
  syndicateYoutube: true, syndicateFacebook: false,
};
const db = {
  storage: { from: () => ({ createSignedUrl: async () => {
    signCalls++;
    if (scenario === "signing-failure" && fault) return { data: null, error: { message: "unavailable" } };
    return { data: { signedUrl: "https://signed-video.invalid/source" }, error: null };
  } }) },
  from(table) {
    let operation = "read";
    let value;
    let readsHandoff = false;
    let expectedOperation;
    const query = {
      select: columns => {
        if (table === "stream_events" && columns.includes("stream_simulated_playout_handoffs")) {
          readsHandoff = true;
          assert.ok(columns.includes("stream_simulated_playout_handoffs!stream_simulated_playout_handoffs_event_id_fkey("),
            "PostgREST must choose one of the handoff's two event relationships");
        }
        return query;
      }, order: () => query, limit: () => query,
      eq: (column, filter) => {
        if (column === "operation_id") expectedOperation = filter;
        return query;
      }, in: () => query, not: () => query, gt: () => query, or: () => query,
      insert: row => { operation = "insert"; value = row; return query; },
      update: row => { operation = "update"; value = row; return query; },
      upsert: row => { operation = "upsert"; value = row; return query; },
      maybeSingle: () => Promise.resolve(resolve()), single: () => Promise.resolve(resolve()),
      then: (yes, no) => Promise.resolve(resolve()).then(yes, no),
    };
    function resolve() {
      if (table === "stream_encoder_automation") {
        if (operation === "upsert") return { error: null };
        assert.equal(operation, "update");
        if (value.operation_id === null) {
          if (operationLease === expectedOperation) operationLease = null;
          return { error: null };
        }
        if (operationLease) return { data: null, error: null };
        operationLease = value.operation_id;
        return { data: { church_id: event.churchId }, error: null };
      }
      if (table === "stream_events") {
        if (scenario === "pre-migration") {
          if (readsHandoff) return { error: { code: "PGRST200" } };
          if (operation === "update") {
            legacySource = value.simulated_playout_url;
            return { error: null };
          }
          return { data: legacySource ? [{
            id: event.id, church_id: event.churchId, simulated_playout_url: legacySource,
          }] : [], error: null };
        }
        return { data: [{
          id: event.id, church_id: event.churchId, simulated_source_path: event.simulatedSourcePath,
          stream_session_id: active?.id ?? "session", stream_simulated_playout_handoffs: handoff,
        }], count: 1, error: null };
      }
      if (table === "stream_simulated_playout_handoffs") {
        if (scenario === "pre-migration") return { error: { code: "PGRST205" } };
        if (scenario === "write-failure" && fault) return { data: null, error: { message: "unavailable" } };
        handoff = { ...handoff, ...value };
        return { data: handoff, error: null };
      }
      assert.equal(table, "stream_sessions");
      if (operation === "insert") {
        if (active) return { data: null, error: { code: "23505" } };
        active = {
          ...value, id: "session", created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
          error_message: null, ingest_started_at: null, live_started_at: null, ended_at: null,
        };
      }
      if (operation === "update") active = { ...active, ...value };
      return { data: active ?? (["signing-failure", "write-failure"].includes(scenario) ? { id: "session" } : null), error: null };
    }
    return query;
  },
};
const mocked = new Map([
  ["lib/security/compare-secret", { compareSecret: () => true }],
  ["lib/supabase/admin", { createAdminClient: () => { throw new Error("Real database forbidden"); } }],
  ["lib/integrations/facebook-live", { endFacebookLiveVideo: async () => {} }],
  ["lib/integrations/tokens", { getIntegrationStatus: async () => ({ youtube: { connected: true }, facebook: { connected: false } }) }],
  ["lib/stream/encoder", { getPrimaryEncoderDevice: async () => null, queueStreamCommand: async () => {} }],
  ["lib/stream/relay", {
    getStreamRelaySettings: async () => ({ connected: true, ingestServerUrl: "rtmp://relay.invalid" }),
    ensureStreamRelayCredentials: async () => ({ connected: true }),
  }],
  ["lib/stream/ingest-token", {
    MAX_INGEST_TTL_SEC: 60, signIngestToken: () => "capability",
    buildCapabilityStreamName: () => "church~capability",
  }],
  ["lib/stream/events", {
    getStreamEvent: async () => event,
    updateStreamEvent: async (_id, _church, patch) => { Object.assign(event, patch); },
    createStreamEvent: async () => event, nextWeeklyOccurrence: () => null,
  }],
  ["lib/stream/syndication", {
    clearRelayDestinations: async () => {
      providerCalls++;
      if (scenario === "setup-failure" && fault) throw new Error("Uncertain provider response");
    },
    provisionDestinationsForEvent: async () => {
      providerCalls++;
      await new Promise(resolve => setImmediate(resolve));
      return { destinations: [{ name: "youtube", url: "private-stream-key" }], errors: {} };
    },
    recordSyndicationAttempt: async () => {}, syndicationRetryUntil: () => new Date().toISOString(),
    transitionYouTubeBroadcastLive: async () => ({ ok: true }),
  }],
  ["lib/stream/preview-ingest", { isPreviewIngestActive: async () => false }],
  ["lib/stream/share-links", { getStreamShareLinks: async () => ({}) }],
  ["lib/media/v1/publication", { publishToFaithForm: async () => ({ ok: true }) }],
  ["lib/stream/recording-lifecycle", { ensureRecordingForSession: async () => {}, logRecordingEvent: () => {}, onBroadcastEnded: async () => {} }],
  ["lib/stream/recording-runtime", { productionLifecycleDeps: () => ({}) }],
  ["lib/stream/recording-notifications", { notifyServiceLive: async () => true }],
]);
const originalLoad = Module._load;
Module._load = function(request) {
  return mocked.get(request.replace(/^@\//, "")) ?? originalLoad.apply(this, arguments);
};
const root = process.cwd();
if (scenario.startsWith("route-")) {
  mocked.set("lib/stream/scheduled", { startDueScheduledEvents: async () => {
    if (scenario === "route-fatal") throw new Error("private driver payload");
    return { started: 1, simulated: 0, expired: 0, failed: 1, deferred: 0 };
  } });
  mocked.get("lib/stream/syndication").retryPendingSyndication = async () => ({ retried: 0 });
  mocked.set("lib/stream/simulated", {
    retryPendingSimulatedPlayouts: async () => ({ prepared: 1, failed: 1, deferred: 0 }),
    listPendingSimulatedPlayoutJobs: async () => [{ eventId: "ready-event" }],
  });
  const route = scenario === "route-poll"
    ? "app/api/stream/simulated-playout/route.ts" : "app/api/stream/scheduled-start/route.ts";
  const { GET } = loadTypeScript(path.join(root, route), import.meta.url);
  const response = await GET(new Request("https://faithform-test.invalid/cron"));
  assert.equal(response.status, scenario === "route-poll" ? 503 : 500);
  const body = await response.json();
  assert.equal(body.ok, false);
  assert.equal(JSON.stringify(body).includes("private driver payload"), false);
  if (scenario === "route-poll") assert.equal(body.jobs[0].eventId, "ready-event");
} else if (scenario === "concurrent" || scenario === "setup-failure") {
  const { startLiveBroadcast } = loadTypeScript(path.join(root, "lib/stream/go-live.ts"), import.meta.url);
  if (scenario === "concurrent") {
    const results = await Promise.allSettled([
      startLiveBroadcast("church", null, { eventId: event.id }, db),
      startLiveBroadcast("church", null, { eventId: event.id }, db),
    ]);
    assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
    assert.match(results.find(result => result.status === "rejected").reason.message, /update is already in progress/);
    assert.equal(operationLease, null, "the winning call releases its lease");
    assert.equal(providerCalls, 2, "only the winning claim clears/provisions platforms");
    assert.equal(active.status, "waiting_for_encoder");
    assert.deepEqual(active.destinations_snapshot, [{ name: "youtube", url: "" }]);
  } else {
    await assert.rejects(startLiveBroadcast("church", null, { eventId: event.id }, db), /End this broadcast/);
    assert.equal(active.status, "preparing");
    assert.equal(operationLease, null, "the failed call releases its lease");
    assert.match(active.error_message, /End this broadcast/);
    fault = false;
    await assert.rejects(startLiveBroadcast("church", null, { eventId: event.id }, db), /already in progress/);
    assert.equal(providerCalls, 1, "uncertain provisioning is never retried automatically");
  }
} else if (scenario === "pre-migration") {
  const { retryPendingSimulatedPlayouts, listPendingSimulatedPlayoutJobs, clearSimulatedPlayoutSource } =
    loadTypeScript(path.join(root, "lib/stream/simulated.ts"), import.meta.url);
  const start = { eventId: event.id, churchId: event.churchId, storagePath: event.simulatedSourcePath };
  assert.deepEqual(await retryPendingSimulatedPlayouts(db, [start]), { prepared: 1, failed: 0, deferred: 0 });
  assert.equal((await listPendingSimulatedPlayoutJobs(db))[0].sourceUrl, "https://signed-video.invalid/source");
  await clearSimulatedPlayoutSource(event.id, db);
  assert.deepEqual(await retryPendingSimulatedPlayouts(db), { prepared: 0, failed: 0, deferred: 0 });
  assert.deepEqual(await listPendingSimulatedPlayoutJobs(db), []);
  assert.equal(signCalls, 1, "relay retries must not recreate an acknowledged legacy handoff");
} else {
  const { retryPendingSimulatedPlayouts, listPendingSimulatedPlayoutJobs } = loadTypeScript(path.join(root, "lib/stream/simulated.ts"), import.meta.url);
  assert.deepEqual(await retryPendingSimulatedPlayouts(db), { prepared: 0, failed: 1, deferred: 0 });
  fault = false;
  assert.deepEqual(await retryPendingSimulatedPlayouts(db), { prepared: 1, failed: 0, deferred: 0 });
  assert.deepEqual(await retryPendingSimulatedPlayouts(db), { prepared: 0, failed: 0, deferred: 0 });
  assert.equal(providerCalls, 0, "handoff recovery must not start/provision a broadcast");
  assert.equal(signCalls, 2);
  const jobs = await listPendingSimulatedPlayoutJobs(db);
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].sourceUrl, "https://signed-video.invalid/source");
  handoff.completed_at = new Date().toISOString();
  handoff.source_url = null;
  assert.deepEqual(await retryPendingSimulatedPlayouts(db), { prepared: 0, failed: 0, deferred: 0 });
  assert.deepEqual(await listPendingSimulatedPlayoutJobs(db), []);
}
console.log(`Passed ${scenario}`);
