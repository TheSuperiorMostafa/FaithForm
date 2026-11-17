import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

const require = createRequire(import.meta.url);
const { HTML_LIMITED_BOT_UA_RE } = require("next/dist/shared/lib/router/utils/html-bots") as { HTML_LIMITED_BOT_UA_RE: RegExp };
const { shouldServeStreamingMetadata } = require("next/dist/server/lib/streaming-metadata") as { shouldServeStreamingMetadata: (userAgent: string, pattern?: string) => boolean };
const configuration = import(pathToFileURL(resolve("next.config.mjs")).href) as Promise<{ default: { htmlLimitedBots: RegExp } }>;

test("Safari gets blocking metadata while Next's existing crawler handling is preserved", async () => {
  const { default: config } = await configuration;
  assert.ok(config.htmlLimitedBots.source.startsWith(`${HTML_LIMITED_BOT_UA_RE.source}|`), "Update the copied crawler list when upgrading Next.js");
  const pattern = config.htmlLimitedBots.source;
  for (const userAgent of [
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/27.0 Safari/605.1.15",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.1 Safari/605.1.15",
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
    "Mozilla/5.0 (iPad; CPU OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1",
    "Twitterbot/1.0", "facebookexternalhit/1.1", "Slackbot-LinkExpanding 1.0", "Bingbot/2.0", "Applebot/0.1",
  ]) assert.equal(shouldServeStreamingMetadata(userAgent, pattern), false, userAgent);
});

test("Chrome, Firefox, and other browsers keep streaming metadata", async () => {
  const { default: config } = await configuration;
  for (const userAgent of [
    "Mozilla/5.0 AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36",
    "Mozilla/5.0 Gecko/20100101 Firefox/132.0",
    "Mozilla/5.0 (iPhone) AppleWebKit/605.1.15 CriOS/130.0.0.0 Mobile/15E148 Safari/604.1",
    "Mozilla/5.0 (iPhone) AppleWebKit/605.1.15 FxiOS/132.0 Mobile/15E148 Safari/605.1.15",
    "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Version/4.0 Chrome/130.0.0.0 Mobile Safari/537.36",
    "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 SamsungBrowser/26.0 Chrome/122.0.0.0 Mobile Safari/537.36",
    "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Version/4.0 Safari/537.36 Chrome/130.0.0.0",
    "Mozilla/5.0 Version/18.0 Safari/605.1.15 EdgiOS/130.0",
    "Mozilla/5.0 Version/18.0 Safari/605.1.15 OPR/114.0",
    "Mozilla/5.0 AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36 Googlebot/2.1",
  ]) assert.equal(shouldServeStreamingMetadata(userAgent, config.htmlLimitedBots.source), true, userAgent);
});
