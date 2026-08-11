#!/usr/bin/env node
/**
 * Proves YouTube accepts the church's real stream key — without airing anything.
 *
 * A YouTube `liveStream` is a long-lived ingest endpoint; only a `liveBroadcast`
 * is per-service and public. Pushing to the ingest stream while no broadcast is
 * bound makes YouTube report it as `active`, and shows nothing to anyone. That
 * is the one part of the live path that cannot be tested against a fake key:
 * connectivity, TLS and the RTMP handshake all answer for an invalid key, but
 * only a valid one proves the publish is accepted.
 *
 * It refuses to run if any broadcast is bound to the stream, since ingesting
 * then could take a broadcast live.
 *
 * Usage:
 *   pnpm verify:youtube-ingest          # 20s of test pattern
 *   SECONDS=45 pnpm verify:youtube-ingest
 *
 * Needs, in the environment or .env.local:
 *   NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY   (to read the stored tokens)
 *   GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET          (or the YOUTUBE_* pair)
 */
import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { promisify } from "node:util";
import { createClient } from "@supabase/supabase-js";
import { google } from "googleapis";

const run = promisify(execFile);

function loadEnvFile(path) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
    if (!process.env[key] && value) process.env[key] = value;
  }
}

loadEnvFile(".env.local");

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey =
  process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
const clientId =
  process.env.YOUTUBE_CLIENT_ID?.trim() || process.env.GOOGLE_CLIENT_ID?.trim();
const clientSecret =
  process.env.YOUTUBE_CLIENT_SECRET?.trim() ||
  process.env.GOOGLE_CLIENT_SECRET?.trim();

if (!supabaseUrl || !supabaseKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SECRET_KEY.");
  process.exit(1);
}
if (!clientId || !clientSecret) {
  console.error(
    "Missing GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET (or the YOUTUBE_* pair).\n" +
      "They live in the Vercel environment; copy them into .env.local to run this.",
  );
  process.exit(1);
}

const seconds = Number(process.env.SECONDS ?? 20);
const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { persistSession: false },
});

const { data: integration, error } = await supabase
  .from("church_integrations")
  .select("access_token, refresh_token, token_expires_at, metadata")
  .eq("provider", "youtube")
  .maybeSingle();

if (error || !integration) {
  console.error("YouTube is not connected for any church.");
  process.exit(1);
}

const streamId = integration.metadata?.live_stream_id;
if (!streamId) {
  console.error(
    "No reusable ingest stream on file. Connect YouTube, or run one service so it is created.",
  );
  process.exit(1);
}

const oauth = new google.auth.OAuth2(clientId, clientSecret);
oauth.setCredentials({
  access_token: integration.access_token,
  refresh_token: integration.refresh_token ?? undefined,
  expiry_date: integration.token_expires_at
    ? new Date(integration.token_expires_at).getTime()
    : undefined,
});
const youtube = google.youtube({ version: "v3", auth: oauth });

// Nothing may be bound, or ingesting could take a real broadcast live.
const parts = ["id", "status", "contentDetails"];
const [active, upcoming] = await Promise.all([
  youtube.liveBroadcasts.list({ part: parts, broadcastStatus: "active" }),
  youtube.liveBroadcasts.list({ part: parts, broadcastStatus: "upcoming" }),
]);
const bound = [...(active.data.items ?? []), ...(upcoming.data.items ?? [])].filter(
  (item) => item.contentDetails?.boundStreamId === streamId,
);

if (bound.length > 0) {
  console.error(
    `Refusing to run: ${bound.length} broadcast(s) are bound to this ingest stream, ` +
      "so pushing to it could take one live. End them first.",
  );
  for (const item of bound) {
    console.error(`  ${item.id}  ${item.status?.lifeCycleStatus}`);
  }
  process.exit(1);
}

const { data: before } = await youtube.liveStreams.list({
  part: ["cdn", "status"],
  id: [streamId],
});
const stream = before.items?.[0];
const ingestion = stream?.cdn?.ingestionInfo;

if (!ingestion?.ingestionAddress || !ingestion?.streamName) {
  console.error("YouTube did not return ingestion details for that stream.");
  process.exit(1);
}

console.log("No broadcast is bound — nothing can become public.");
console.log(`Stream status before : ${stream.status?.streamStatus}`);
console.log(`Pushing ${seconds}s of test pattern to the real ingest endpoint…\n`);

const target = `${ingestion.ingestionAddress.replace(/\/$/, "")}/${ingestion.streamName}`;

try {
  await run("ffmpeg", [
    "-hide_banner", "-loglevel", "error",
    "-re",
    "-f", "lavfi", "-i", `testsrc2=size=1280x720:rate=30`,
    "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000",
    "-c:v", "libx264", "-preset", "veryfast", "-profile:v", "main",
    "-pix_fmt", "yuv420p", "-g", "60",
    "-c:a", "aac", "-b:a", "128k",
    "-shortest", "-t", String(seconds),
    "-f", "flv", target,
  ]);
} catch (err) {
  console.error("ffmpeg failed:", err.stderr || err.message);
  console.error("\nInstall ffmpeg, or run the same push from the relay.");
  process.exit(1);
}

// YouTube takes a moment to reflect ingest state.
await new Promise((resolve) => setTimeout(resolve, 5000));

const { data: after } = await youtube.liveStreams.list({
  part: ["status"],
  id: [streamId],
});
const status = after.items?.[0]?.status;

console.log(`Stream status after  : ${status?.streamStatus}`);
console.log(`Health               : ${status?.healthStatus?.status ?? "n/a"}`);

for (const issue of status?.healthStatus?.configurationIssues ?? []) {
  console.log(`  ${issue.severity}: ${issue.reason} — ${issue.description}`);
}

if (status?.streamStatus === "active") {
  console.log("\nYouTube accepted the church's real stream key and received video.");
} else {
  console.log(
    "\nYouTube did not report the stream active. Check the relay log and the health issues above.",
  );
  process.exit(1);
}
