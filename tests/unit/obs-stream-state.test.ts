import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
// The optional OBS agent is shipped as plain JavaScript.
import { observeObsStreamState } from "../../infra/stream-agent/obs-stream-state.mjs";

test("only a confirmed OBS stop ends the service, including when OBS is remotely controlled", async () => {
  const obs = new EventEmitter();
  const reports: string[] = [];
  const tracker = observeObsStreamState(obs, async (id: string) => { reports.push(id); });
  tracker.setSession("service-1");
  for (const outputState of ["OBS_WEBSOCKET_OUTPUT_STARTING", "OBS_WEBSOCKET_OUTPUT_RECONNECTING", "OBS_WEBSOCKET_OUTPUT_STOPPING"]) {
    obs.emit("StreamStateChanged", { outputState, outputActive: false });
  }
  assert.deepEqual(reports, []);
  obs.emit("StreamStateChanged", { outputState: "OBS_WEBSOCKET_OUTPUT_STOPPED", outputActive: false });
  await tracker.flush();
  assert.deepEqual(reports, ["service-1"]);
});

test("failed stop reports retry with the original session, never the following service", async () => {
  const obs = new EventEmitter();
  const reports: string[] = [];
  let failing = true;
  const tracker = observeObsStreamState(obs, async (id: string) => {
    reports.push(id);
    if (failing) throw new Error("network unavailable");
  });
  tracker.setSession("service-1");
  obs.emit("StreamStateChanged", { outputState: "OBS_WEBSOCKET_OUTPUT_STOPPED" });
  await new Promise(resolve => setImmediate(resolve));
  tracker.setSession("service-2");
  failing = false;
  await tracker.flush();
  assert.deepEqual(reports, ["service-1", "service-1"]);
});

test("a stopped OBS without a known paired service does not close another encoder's broadcast", async () => {
  const obs = new EventEmitter();
  const tracker = observeObsStreamState(obs, async () => { assert.fail("unexpected stop report"); });
  obs.emit("StreamStateChanged", { outputState: "OBS_WEBSOCKET_OUTPUT_STOPPED" });
  await tracker.flush();
});
