#!/usr/bin/env node
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const directory = join(process.cwd(), "supabase", "migrations");
const files = readdirSync(directory)
  .filter((file) => /^\d{4}_.+\.sql$/.test(file))
  .sort();

const failures = [];
const knownLegacyDuplicatePrefixes = new Set(["0003", "0010", "0011", "0019"]);
const grouped = new Map();
for (const file of files) {
  const prefix = file.slice(0, 4);
  grouped.set(prefix, [...(grouped.get(prefix) ?? []), file]);
}

for (const [prefix, samePrefixFiles] of grouped) {
  if (samePrefixFiles.length > 1 && !knownLegacyDuplicatePrefixes.has(prefix)) {
    failures.push(`new duplicate migration prefix ${prefix}`);
  }
}

const securityFile = "0050_security_baseline.sql";
if (!files.includes(securityFile)) failures.push(`${securityFile} is missing`);
else {
  const sql = readFileSync(join(directory, securityFile), "utf8");

  // Feature migrations keep landing after the baseline, and refusing them
  // outright would only push schema changes into hand-run scripts nothing
  // verifies. What actually has to hold is that none of them reopen what the
  // baseline closed: migrations apply in filename order, so anything sorting
  // after it would get the last word on policies, grants and RLS.
  const loosening =
    /\b(create\s+policy|drop\s+policy|grant\s|revoke\s|enable\s+row\s+level\s+security|disable\s+row\s+level\s+security|security\s+definer)/i;
  for (const later of files.filter((file) => file > securityFile)) {
    if (loosening.test(readFileSync(join(directory, later), "utf8"))) {
      failures.push(
        `${later} sorts after ${securityFile} and changes policies, grants or RLS — fold that part into the baseline`,
      );
    }
  }
  if (/\bdrop\s+(table|schema)\b/i.test(sql)) {
    failures.push(`${securityFile} contains a destructive table/schema drop`);
  }
  for (const required of [
    "consume_donor_portal_token",
    "consume_api_rate_limit",
    "claim_stripe_webhook_event",
    "claim_donation_receipt",
    "Tenant admins can upload church logos",
    'credential_mode":"capability_v1',
  ]) {
    if (!sql.includes(required)) failures.push(`${securityFile} lacks ${required}`);
  }
}

if (failures.length) {
  for (const failure of failures) console.error(`FAIL ${failure}`);
  process.exit(1);
}
console.log(
  `Verified the additive ${securityFile} after ${files.length - 1} legacy migrations.`,
);
console.log(
  "Known duplicate legacy prefixes remain a deployed-state reconciliation gate: 0003, 0010, 0011, 0019.",
);
