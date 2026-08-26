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
 *   0  every required value is present
 *   1  something required is missing or malformed
 *
 * It makes **no network call**, contacts no provider, and changes nothing.
 * "Configured" is not "working": whether Stripe accepts the key, whether APNs
 * has the certificate, and whether the relay answers are device- and
 * staging-runbook items.
 */

const GROUPS = [
  {
    name: "Core",
    required: true,
    checks: [
      ["NEXT_PUBLIC_SUPABASE_URL", /^https:\/\/[a-z0-9-]+\.supabase\.(co|in)$/i, "a Supabase project URL"],
      ["SUPABASE_SERVICE_ROLE_KEY", /^.{40,}$/, "the service-role key"],
      ["NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", /^.{20,}$/, "the publishable key", "NEXT_PUBLIC_SUPABASE_ANON_KEY"],
    ],
  },
  {
    name: "Giving (Stripe)",
    required: false,
    checks: [
      ["STRIPE_SECRET_KEY", /^sk_(test|live)_[A-Za-z0-9]{10,}$/, "a Stripe secret key"],
      ["NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY", /^pk_(test|live)_[A-Za-z0-9]{10,}$/, "a Stripe publishable key"],
      ["STRIPE_WEBHOOK_SECRET", /^whsec_[A-Za-z0-9]{10,}$/, "a Stripe webhook secret"],
    ],
  },
  {
    name: "Push (APNs / FCM)",
    required: false,
    checks: [
      ["FCM_PROJECT_ID", /^.{3,}$/, "the Firebase project id"],
      ["FCM_CLIENT_EMAIL", /@/, "the Firebase service account"],
      ["FCM_PRIVATE_KEY", /BEGIN PRIVATE KEY/, "the Firebase private key"],
    ],
  },
  {
    name: "Live streaming (relay)",
    required: false,
    checks: [
      ["STREAM_RELAY_WEBHOOK_SECRET", /^.{16,}$/, "the relay webhook secret"],
    ],
  },
  {
    name: "Donor portal",
    required: false,
    checks: [
      ["DONOR_PORTAL_SESSION_SECRET", /^.{32,}$/, "the donor portal session secret"],
    ],
  },
];

/** Values that must never be the placeholder they ship as. */
const PLACEHOLDERS = [/replace-me/i, /^x{4,}$/i, /xxxxxxxx/i, /^changeme/i, /placeholder/i];

let failures = 0;
let warnings = 0;

for (const group of GROUPS) {
  const lines = [];
  let missing = 0;

  for (const [name, pattern, description, ...aliases] of group.checks) {
    const value = [name, ...aliases].map((key) => process.env[key]).find(Boolean);

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
    if (!pattern.test(value)) {
      // The shape, never the value. `sk_live_…` in a terminal is a leaked key.
      lines.push(`  malformed ${name} — does not look like ${description}`);
      missing += 1;
      continue;
    }
    lines.push(`  ok       ${name}`);
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

// Live and test Stripe keys in one environment is a configuration nobody
// intended and the kind that takes a real payment during a rehearsal.
const stripeMode = (key) => (process.env[key] ?? "").split("_")[1];
const modes = new Set(
  ["STRIPE_SECRET_KEY", "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY"]
    .map(stripeMode)
    .filter((mode) => mode === "test" || mode === "live"),
);
if (modes.size > 1) {
  console.log("Stripe: MIXED test and live keys in one environment.");
  console.log("  A rehearsal against this configuration could take a real payment.\n");
  failures += 1;
}

if (failures > 0) {
  console.log(`Not pilot-ready: ${failures} required group(s) incomplete.`);
  process.exit(1);
}

console.log(
  warnings > 0
    ? `Core is ready. ${warnings} optional group(s) not configured — those features stay off.`
    : "Every group is configured.",
);
console.log(
  "\nConfigured is not working. Whether Stripe accepts the key, whether APNs\n" +
  "has the certificate, and whether the relay answers are runbook items —\n" +
  "this command made no network call and changed nothing.",
);
