#!/usr/bin/env node
/**
 * Fails when an authenticated server action or route handler can be reached
 * without a feature check.
 *
 * This exists because the feature flags were already correct and still did not
 * work: the catalog, the flags table, `<FeatureGate>` and the API guards were
 * all in place, but twenty-four server actions and eleven route handlers had
 * simply never been wired to them. Nothing was broken — coverage had holes,
 * and holes are invisible until someone finds one.
 *
 * The rule: a file that authenticates a church user is doing something a
 * feature owns, so it must consult the feature layer. Anything that genuinely
 * does not is listed in EXEMPT with the reason, so the exception is a decision
 * on the record rather than a silent omission.
 *
 * Usage:  pnpm check:features
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const APP = join(ROOT, "app");

/** Calling one of these means the file acts on behalf of a signed-in member. */
const AUTH_MARKERS = [
  "requireChurchAuth",
  "getChurchAuth",
  "requireChurchContext",
  "requireChurchAdmin",
];

/** Calling one of these means the file consulted the feature layer. */
const GUARD_MARKERS = [
  "featureAccessDenied",
  "denyUnlessAnyFeature",
  "featureActionError",
  "requireFeatureApi",
  "guardFeature",
  "getFeatureAccess",
  "canAccessFeature",
  "isChurchFeatureEnabled",
];

/**
 * Files that authenticate but correctly own no feature. Each entry is a
 * decision: if you add one, say why in a sentence someone can disagree with.
 */
const EXEMPT = new Map([
  [
    "app/dashboard/support/actions.ts",
    "Support tickets. Contacting us must work when a feature is off — that is usually why they are writing.",
  ],
  [
    "app/api/dashboard/usage/heartbeat/route.ts",
    "Records time-in-app across the whole dashboard; it belongs to no single feature.",
  ],
  [
    "app/api/reports/monthly/[month]/route.ts",
    "Cross-feature monthly roll-up (calls, announcements, attendance, sermons). No single feature owns it, and each source is already gated where it is produced.",
  ],
]);

/**
 * Donor-portal routes are not in this scan at all: they authenticate a donor
 * through getDonorPortalSession, not a church member, so no AUTH_MARKER
 * matches. That is correct rather than an oversight — a donor must always be
 * able to reach and cancel an existing gift, whatever the church's flags say.
 * The two portal routes that do restart money moving (setup-intent, and
 * resume/update_amount in subscription) call isChurchFeatureEnabled inline.
 */

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (entry === "route.ts" || entry === "actions.ts") out.push(full);
  }
  return out;
}

const findings = [];
const staleExemptions = new Set(EXEMPT.keys());

for (const file of walk(APP)) {
  const rel = relative(ROOT, file);

  // The control center is platform-admin surface. Its own guard is
  // requireSuperAdmin, and gating it on a church's flags would mean losing the
  // ability to switch a feature back on.
  if (rel.startsWith("app/admin/")) continue;

  const source = readFileSync(file, "utf8");

  const authenticates = AUTH_MARKERS.some((marker) =>
    new RegExp(`\\b${marker}\\s*\\(`).test(source),
  );
  if (!authenticates) continue;

  if (EXEMPT.has(rel)) {
    staleExemptions.delete(rel);
    continue;
  }

  const guarded = GUARD_MARKERS.some((marker) =>
    new RegExp(`\\b${marker}\\s*\\(`).test(source),
  );

  if (!guarded) findings.push(rel);
}

let failed = false;

if (findings.length > 0) {
  failed = true;
  console.error(
    `\n${findings.length} file(s) authenticate a church member without checking a feature:\n`,
  );
  for (const file of findings) console.error(`  ${file}`);
  console.error(
    "\nAdd a guard from lib/features/guard.ts, or add the file to EXEMPT in" +
      "\nscripts/check-feature-guards.mjs with the reason it owns no feature.\n",
  );
}

// An exemption for a file that no longer authenticates is a stale note, and a
// stale note is how the list stops being read.
if (staleExemptions.size > 0) {
  failed = true;
  console.error("\nEXEMPT lists files that no longer need an exemption:\n");
  for (const file of staleExemptions) console.error(`  ${file}`);
  console.error("");
}

if (failed) process.exit(1);

console.log("Feature guards: every authenticated action and route is covered.");
