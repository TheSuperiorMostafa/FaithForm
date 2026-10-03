#!/usr/bin/env node
/**
 * Whether this deployment could run a church pilot.
 *
 * Checks that every value the app and the server need is **present and shaped
 * correctly**, and reports what is missing — without printing a single one of
 * them. A readiness command that echoes a webhook secret to a terminal is a
 * readiness command that ends up in a screenshot.
 *
 * Exit codes:
 *   0  every production-required value is present
 *   1  something required is missing or malformed
 *
 * It makes **no network call**, contacts no provider, and changes nothing.
 * "Configured" is not "working": whether Stripe accepts the key, whether APNs
 * has the certificate, and whether the relay answers are device- and
 * staging-runbook items.
 */

import { require as requireTypeScript } from "tsx/cjs/api";

// Use the application's actual validator so this command and deployed requests
// cannot disagree about required configuration or supported Supabase aliases.
const { assertProductionEnv, ProductionEnvError } = requireTypeScript(
  "../lib/env/production.ts",
  import.meta.url,
);
const { readFcmConfig } = requireTypeScript(
  "../lib/faithform/push/provider-auth.ts",
  import.meta.url,
);
const fcmJsonSupplied = Boolean(process.env.FCM_SERVICE_ACCOUNT_JSON?.trim());
const fcm = fcmJsonSupplied ? readFcmConfig() : null;
process.env.NODE_ENV = "production";
let failures = 0;
let warnings = 0;
try {
  assertProductionEnv();
  console.log("Production environment: configured\n");
} catch (error) {
  if (!(error instanceof ProductionEnvError)) throw error;
  console.log("Production environment: BLOCKED");
  for (const name of error.failedChecks) console.log(`  failed   ${name}`);
  console.log("");
  failures += 1;
}

const GROUPS = [
  // Two groups, not one. Reported together they hid a real failure mode: a
  // deployment with the three FCM values set and no APNs key passed the check
  // while every iPhone silently received nothing.
  {
    name: "Push — Android (FCM)",
    required: false,
    // JSON takes precedence even when malformed, matching readFcmConfig.
    values: fcmJsonSupplied ? {
      FCM_PROJECT_ID: fcm?.projectId,
      FCM_CLIENT_EMAIL: fcm?.clientEmail,
      FCM_PRIVATE_KEY: fcm?.privateKeyPem,
    } : undefined,
    checks: [
      ["FCM_PROJECT_ID", /^.{3,}$/, "the Firebase project id"],
      ["FCM_CLIENT_EMAIL", /@/, "the Firebase service account"],
      ["FCM_PRIVATE_KEY", /BEGIN PRIVATE KEY/, "the Firebase private key"],
    ],
  },
  {
    name: "Push — iOS (APNs)",
    required: false,
    checks: [
      ["APNS_KEY_ID", /^[A-Za-z0-9]{8,}$/, "the APNs key id"],
      ["APNS_TEAM_ID", /^[A-Za-z0-9]{8,}$/, "the Apple team id"],
      ["APNS_PRIVATE_KEY", /BEGIN PRIVATE KEY/, "the APNs .p8 key"],
      ["APNS_TOPIC", /^[A-Za-z0-9.-]+$/, "the app bundle id"],
    ],
  },
];

/** Values that must never be the placeholder they ship as. */
const PLACEHOLDERS = [/replace-me/i, /^x{4,}$/i, /xxxxxxxx/i, /^changeme/i, /placeholder/i];

for (const group of GROUPS) {
  const lines = [];
  let missing = 0;

  for (const [name, pattern, description, ...aliases] of group.checks) {
    const value = group.values
      ? group.values[name]
      : [name, ...aliases].map((key) => process.env[key]).find(Boolean);

    if (!value) {
      lines.push(`  missing  ${name} — ${description}`);
      missing += 1;
      continue;
    }
    if (PLACEHOLDERS.some((placeholder) => placeholder.test(value))) {
      // A placeholder that reached an environment is worse than a missing
      // value: it looks configured.
      lines.push(`  PLACEHOLDER ${name} — still the example value`);
      missing += 1;
      continue;
    }
    if (typeof value !== "string" || !pattern.test(value)) {
      // The shape, never the value. `sk_live_…` in a terminal is a leaked key.
      lines.push(`  malformed ${name} — does not look like ${description}`);
      missing += 1;
      continue;
    }
    lines.push(`  ok       ${name}`);
  }

  if (group.values) {
    lines.unshift(fcm ? "  source   FCM_SERVICE_ACCOUNT_JSON" : "  malformed FCM_SERVICE_ACCOUNT_JSON — invalid or incomplete service account");
  }
  const status = missing === 0 ? "ready" : group.required ? "BLOCKED" : "not configured";
  console.log(`${group.name}: ${status}`);
  for (const line of lines) console.log(line);
  console.log("");

  if (missing > 0) {
    if (group.required) failures += 1;
    else warnings += 1;
  }
}

if (failures > 0) {
  console.log(`Not pilot-ready: ${failures} required group(s) incomplete.`);
  process.exit(1);
}

console.log(
  warnings > 0
    ? `Production environment is configured. ${warnings} optional push group(s) not configured — delivery is unavailable for those platforms.`
    : "Every group is configured.",
);
console.log(
  "\nConfigured is not working. Whether Stripe accepts the key, whether APNs\n" +
  "has the certificate, and whether the relay answers are runbook items —\n" +
  "this command made no network call and changed nothing.",
);
