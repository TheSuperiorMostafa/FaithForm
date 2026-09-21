#!/usr/bin/env node
/**
 * Proves an APNs configuration is real, without needing a phone.
 *
 * The useful trick: send to a device token that cannot exist. Apple has to
 * authenticate the request before it can decide the token is wrong, so the
 * reply separates the two failures that otherwise look identical from a
 * server that is simply silent:
 *
 *   BadDeviceToken          the key, the team and the topic are all accepted —
 *                           only the made-up token is wrong. **This is a pass.**
 *   InvalidProviderToken    the .p8, the Key ID or the Team ID disagree
 *   TopicDisallowed / BadTopic
 *                           the topic is not a bundle id this key may address,
 *                           usually a missing Push capability on the App ID
 *   MissingTopic            APNS_TOPIC is unset
 *
 * With `--token <hex>` it sends a real notification to a real device instead,
 * which is the end-to-end check once an iPhone has registered.
 *
 *   node --env-file=.env.local scripts/verify-apns.mjs
 *   node --env-file=.env.local scripts/verify-apns.mjs --token 9f3c…
 *   node --env-file=.env.local scripts/verify-apns.mjs --production
 *
 * Nothing here prints a key, a signed token, or a device token.
 */

import { createPrivateKey, createSign } from "node:crypto";
import http2 from "node:http2";

const args = process.argv.slice(2);
const deviceToken = args[args.indexOf("--token") + 1];
const wantsDevice = args.includes("--token");
const production = args.includes("--production");

const SANDBOX = "https://api.sandbox.push.apple.com";
const PRODUCTION = "https://api.push.apple.com";

function env(name) {
  const value = process.env[name]?.trim();
  return value && value.length > 0 ? value : undefined;
}

function redact(value) {
  if (!value) return "(unset)";
  if (value.length <= 8) return "(set)";
  return `${value.slice(0, 4)}… (${value.length} chars)`;
}

const keyId = env("APNS_KEY_ID");
const teamId = env("APNS_TEAM_ID");
const topic = env("APNS_TOPIC");
const privateKeyRaw = env("APNS_PRIVATE_KEY");
const host = production ? PRODUCTION : (env("APNS_HOST") ?? SANDBOX);

console.log("APNs configuration");
console.log(`  APNS_KEY_ID      ${keyId ?? "(unset)"}`);
console.log(`  APNS_TEAM_ID     ${teamId ?? "(unset)"}`);
console.log(`  APNS_TOPIC       ${topic ?? "(unset)"}`);
console.log(`  APNS_PRIVATE_KEY ${redact(privateKeyRaw)}`);
console.log(`  host             ${host}${production ? "  (--production)" : ""}`);
console.log("");

const missing = [
  ["APNS_KEY_ID", keyId],
  ["APNS_TEAM_ID", teamId],
  ["APNS_TOPIC", topic],
  ["APNS_PRIVATE_KEY", privateKeyRaw],
].filter(([, value]) => !value).map(([name]) => name);

if (missing.length > 0) {
  console.error(`Not configured. Set: ${missing.join(", ")}`);
  console.error("Pass the file with --env-file=.env.local, or export them first.");
  process.exit(1);
}

// The same normalisation the server does: secret stores escape newlines more
// often than not, and a key that survived intact must keep working too.
const pem = privateKeyRaw.includes("\\n") ? privateKeyRaw.replace(/\\n/g, "\n") : privateKeyRaw;

let key;
try {
  key = createPrivateKey({ key: pem, format: "pem" });
} catch {
  console.error("APNS_PRIVATE_KEY is not a PEM private key.");
  console.error("It should be the whole .p8 file, including the BEGIN and END lines.");
  process.exit(1);
}
if (key.asymmetricKeyType !== "ec") {
  console.error(`Expected an EC (ES256) key from Apple; this is ${key.asymmetricKeyType}.`);
  process.exit(1);
}

const base64url = (input) => Buffer.from(input).toString("base64url");
const header = base64url(JSON.stringify({ alg: "ES256", kid: keyId }));
const claims = base64url(JSON.stringify({ iss: teamId, iat: Math.floor(Date.now() / 1000) }));
const signature = createSign("SHA256")
  .update(`${header}.${claims}`)
  .sign({ key, dsaEncoding: "ieee-p1363" })
  .toString("base64url");
const providerToken = `${header}.${claims}.${signature}`;
console.log("Signed a provider token (ES256, ieee-p1363).");

// A token Apple cannot possibly have issued, unless one is supplied.
const target = wantsDevice ? deviceToken : "0".repeat(64);
if (wantsDevice && !/^[0-9a-fA-F]{64}$/.test(target ?? "")) {
  console.error("--token expects the 64-character hex device token.");
  process.exit(1);
}

const payload = wantsDevice
  ? {
      aps: {
        alert: { title: "FaithForm", body: "Notifications are working." },
        sound: "default",
      },
      faithform: { deepLink: "faithform://home", correlationId: "verify-apns" },
    }
  : { aps: { alert: { title: "verify", body: "verify" } } };

const session = http2.connect(host);
session.on("error", (error) => {
  console.error(`Could not connect to ${host}: ${error.message}`);
  process.exit(1);
});

const request = session.request({
  ":method": "POST",
  ":path": `/3/device/${target}`,
  "apns-topic": topic,
  "apns-push-type": "alert",
  "content-type": "application/json",
  authorization: `bearer ${providerToken}`,
});

let status = 0;
let body = "";
request.on("response", (headers) => {
  status = Number(headers[":status"] ?? 0);
});
request.setEncoding("utf8");
request.on("data", (chunk) => {
  body += chunk;
});
request.on("end", () => {
  session.close();
  const reason = (() => {
    try {
      return JSON.parse(body).reason;
    } catch {
      return undefined;
    }
  })();

  console.log(`APNs replied ${status}${reason ? ` ${reason}` : ""}.`);
  console.log("");

  if (wantsDevice) {
    if (status === 200) {
      console.log("Sent. The notification should be on that device now.");
      process.exit(0);
    }
    console.error(explain(status, reason));
    process.exit(1);
  }

  if (reason === "BadDeviceToken") {
    console.log("PASS — the key, the Team ID and the topic were all accepted.");
    console.log("Only the made-up device token was rejected, which is the point.");
    console.log("");
    console.log("Next: run it again with --token <the device's hex token> to send a real one,");
    console.log(`and with --production once the build is signed for the store (${PRODUCTION}).`);
    process.exit(0);
  }

  console.error(explain(status, reason));
  process.exit(1);
});
request.on("error", (error) => {
  console.error(`Request failed: ${error.message}`);
  process.exit(1);
});
request.end(JSON.stringify(payload));

function explain(status, reason) {
  switch (reason) {
    case "InvalidProviderToken":
    case "ExpiredProviderToken":
      return [
        "FAIL — Apple rejected the credential, not the device.",
        "  * APNS_KEY_ID must be the Key ID of the .p8 (the 10 characters in its filename).",
        "  * APNS_TEAM_ID must be the team the key belongs to, not a personal team.",
        "  * APNS_PRIVATE_KEY must be that same key's file contents.",
        "  * A key deleted in the developer account stays rejected forever; make a new one.",
      ].join("\n");
    case "TopicDisallowed":
    case "BadTopic":
      return [
        "FAIL — the topic is not a bundle id this key may send to.",
        `  * APNS_TOPIC is "${env("APNS_TOPIC")}"; it must be the app's exact bundle id.`,
        "  * The App ID must exist in the developer account with Push Notifications enabled.",
        "  * The key and the App ID must belong to the same team.",
      ].join("\n");
    case "MissingTopic":
      return "FAIL — no apns-topic was sent. Set APNS_TOPIC.";
    case "Unregistered":
      return "That device token is no longer valid for this topic. The app must register again.";
    case "DeviceTokenNotForTopic":
      return [
        "FAIL — that device token belongs to a different app.",
        "  * The token came from a build whose bundle id is not APNS_TOPIC.",
      ].join("\n");
    case "BadDeviceToken":
      return [
        "FAIL — Apple did not recognise that device token for this environment.",
        "  * A token from a development build only works against the sandbox host,",
        "    and a TestFlight or App Store build only against the production host.",
        `  * This ran against ${host}. Try the other one.`,
      ].join("\n");
    default:
      return `FAIL — ${status}${reason ? ` ${reason}` : ""}. See Apple's reason codes for this value.`;
  }
}
