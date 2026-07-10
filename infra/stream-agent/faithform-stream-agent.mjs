#!/usr/bin/env node
/**
 * FaithForm streaming PC agent.
 *
 * 1. Pair once with FAITHFORM_PAIRING_CODE
 * 2. Leave running on the OBS computer
 * 3. FaithForm Go Live sends start/stop commands via polling
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import OBSWebSocket from "obs-websocket-js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = join(__dirname, ".faithform-agent.json");
const APP_URL = process.env.FAITHFORM_APP_URL?.trim() || "https://faithform.io";
const POLL_MS = Number(process.env.FAITHFORM_POLL_MS ?? "3000");

function loadConfig() {
  if (!existsSync(CONFIG_PATH)) return null;
  return JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
}

function saveConfig(config) {
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
}

async function register() {
  const pairingCode = process.env.FAITHFORM_PAIRING_CODE?.trim();
  if (!pairingCode) {
    throw new Error(
      "Set FAITHFORM_PAIRING_CODE from the FaithForm Live Streaming page.",
    );
  }

  const res = await fetch(`${APP_URL}/api/stream/encoder/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      pairingCode,
      label: process.env.FAITHFORM_DEVICE_LABEL ?? "Streaming PC",
      encoderType: "obs",
      obsWebsocketHost: process.env.OBS_WEBSOCKET_HOST ?? "127.0.0.1",
      obsWebsocketPort: Number(process.env.OBS_WEBSOCKET_PORT ?? "4455"),
      obsWebsocketPassword: process.env.OBS_WEBSOCKET_PASSWORD ?? "",
    }),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error ?? "Registration failed");
  }

  const config = {
    deviceSecret: data.deviceSecret,
    churchId: data.churchId,
    ingestServerUrl: data.ingestServerUrl,
    streamKey: data.streamKey,
    obsWebsocketHost: process.env.OBS_WEBSOCKET_HOST ?? "127.0.0.1",
    obsWebsocketPort: Number(process.env.OBS_WEBSOCKET_PORT ?? "4455"),
    obsWebsocketPassword: process.env.OBS_WEBSOCKET_PASSWORD ?? "",
  };

  saveConfig(config);
  console.log("Paired successfully. Agent config saved.");
  return config;
}

async function ensureObsConnected(obs, config) {
  if (obs.identified) return;
  await obs.connect(
    `ws://${config.obsWebsocketHost}:${config.obsWebsocketPort}`,
    config.obsWebsocketPassword || undefined,
  );
}

async function applyObsStreamSettings(obs, ingestServerUrl, streamKey) {
  await obs.call("SetStreamServiceSettings", {
    streamServiceType: "rtmp_custom",
    streamServiceSettings: {
      server: ingestServerUrl,
      key: streamKey,
      use_auth: false,
    },
  });
}

async function executeCommand(obs, config, message) {
  const payload = message.payload ?? {};
  const ingestServerUrl = payload.ingestServerUrl ?? config.ingestServerUrl;
  const streamKey = payload.streamKey ?? config.streamKey;

  if (!ingestServerUrl || !streamKey) {
    throw new Error("Missing ingest server URL or stream key.");
  }

  await ensureObsConnected(obs, config);

  if (message.command === "start_stream") {
    await applyObsStreamSettings(obs, ingestServerUrl, streamKey);
    await obs.call("StartStream");
    console.log("OBS stream started.");
    return;
  }

  if (message.command === "stop_stream") {
    await obs.call("StopStream");
    console.log("OBS stream stopped.");
    return;
  }

  throw new Error(`Unknown command: ${message.command}`);
}

async function ackCommand(config, commandId, status, error) {
  await fetch(`${APP_URL}/api/stream/encoder/poll`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.deviceSecret}`,
    },
    body: JSON.stringify({ commandId, status, error }),
  });
}

async function pollLoop(config) {
  const obs = new OBSWebSocket();

  while (true) {
    try {
      const res = await fetch(`${APP_URL}/api/stream/encoder/poll`, {
        headers: {
          Authorization: `Bearer ${config.deviceSecret}`,
        },
        cache: "no-store",
      });

      if (res.status === 401) {
        throw new Error("Device secret rejected. Pair this computer again.");
      }

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error ?? "Poll failed");
      }

      if (data.command && data.commandId) {
        try {
          await executeCommand(obs, config, data);
          await ackCommand(config, data.commandId, "completed");
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "Command failed";
          console.error(message);
          await ackCommand(config, data.commandId, "failed", message);
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Agent error";
      console.error(message);
    }

    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
}

async function main() {
  let config = loadConfig();
  if (!config?.deviceSecret) {
    config = await register();
  }

  console.log(`FaithForm stream agent running for church ${config.churchId}`);
  console.log(`Polling ${APP_URL} every ${POLL_MS}ms`);
  await pollLoop(config);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
