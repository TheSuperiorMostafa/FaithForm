#!/usr/bin/env node
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";

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
  //
  // "Reopen" is the operative word. A later migration that creates its own
  // tables must be able to secure them — a new table with no RLS is worse than
  // one whose policy sorts late. So the rule is object-scoped rather than
  // keyword-scoped: a post-baseline migration may declare policies, grants and
  // RLS only for objects it creates in that same file, and may never name an
  // object the baseline secured.
  const objectsIn = (sqlText, pattern) => {
    const found = new Set();
    for (const match of sqlText.matchAll(pattern)) {
      found.add(match[1].toLowerCase().replace(/^public\./, ""));
    }
    return found;
  };

  // What the baseline secured, derived from the baseline itself so this stays
  // correct if it is ever extended.
  const baselineTables = new Set([
    ...objectsIn(sql, /\b(?:revoke|grant)[^;]*?\bon\s+table\s+((?:public\.)?[a-z_][a-z0-9_]*)/gi),
    ...objectsIn(sql, /\balter\s+table\s+((?:public\.)?[a-z_][a-z0-9_]*)/gi),
    ...objectsIn(sql, /\bcreate\s+policy\s+[^\n]*?\bon\s+((?:public|storage)\.[a-z_][a-z0-9_]*)/gi),
    ...objectsIn(sql, /\bdrop\s+policy\s+[^\n]*?\bon\s+((?:public|storage)\.[a-z_][a-z0-9_]*)/gi),
  ]);
  const baselineFunctions = objectsIn(
    sql,
    /\bcreate\s+(?:or\s+replace\s+)?function\s+((?:public\.)?[a-z_][a-z0-9_]*)/gi,
  );

  const securedStatement =
    /\b(?:create\s+policy|drop\s+policy|alter\s+table|grant|revoke)\b[^;]*?\b(?:on\s+(?:table\s+|function\s+)?)((?:public|storage)\.[a-z_][a-z0-9_]*)/gi;
  const rlsStatement =
    /\b(?:enable|disable)\s+row\s+level\s+security\b/i;

  // Post-baseline files that only ever take access away. A `revoke`, or a
  // `drop policy` of a permissive policy (the only kind this schema has), can
  // narrow what the baseline allowed but can never reopen what it closed —
  // which is the thing this check exists to stop. Folding them into the
  // baseline instead would never reach production: the baseline was applied
  // long ago, and an applied file is not re-run. Each entry is reviewed, and
  // the file is still refused below if it grants, creates a policy, or turns
  // row level security off.
  const narrowingOnly = new Set([
    // Server-only writes to stream_recordings; no anonymous listing of the
    // public church-covers and social-graphics buckets.
    "0107_recording_writes_and_bucket_listing.sql",
    // No direct writes to visitor_accounts by the account holder.
    "0108_presentation_church_and_account_writes.sql",
  ]);
  const narrowingStatement = /^\s*(?:revoke\b|drop\s+policy\b)/i;

  // 0077 gives signed-in callers EXECUTE on the helpers their own row level
  // security calls. A policy's functions run as the querying role, so without
  // it a database built from these files cannot read `church_users` at all
  // (see the file). Exactly these four grants, to exactly that role.
  const helperGrants = new Map([
    [
      "0077_rls_helper_execute_for_signed_in.sql",
      /^\s*grant\s+execute\s+on\s+function\s+public\.(?:user_church_ids\(\)|is_church_admin\(uuid\)|is_church_staff\(uuid\)|current_visitor_account_id\(\))\s+to\s+authenticated\s*$/i,
    ],
  ]);

  // The baseline has already run in deployed databases. This reviewed,
  // additive correction closes direct staff reads that its original policies
  // left open. Pin the exact file so later edits cannot silently widen access.
  const reviewedCorrections = new Map([
    [
      "0110_feature_scoped_sensitive_reads.sql",
      "68f5877a17de0eab91025e57cf719c2cec645909213cf65f302d4328d8049863",
    ],
    // The original support tables expose private fields through browser-wide
    // SELECT grants, and tickets also have broad write grants in some states.
    // Keep only the fields the church Help view needs, retain service writes,
    // and pin every byte of this reviewed correction.
    [
      "0126_support_email_review.sql",
      "752e1fc7a3a3dcc0c8ec0c355a4471b59ffae29b05e06c1d3c2f390647c58dca",
    ],
  ]);

  for (const later of files.filter((file) => file > securityFile)) {
    const laterSql = readFileSync(join(directory, later), "utf8");
    if (reviewedCorrections.has(later)) {
      const actual = createHash("sha256").update(laterSql).digest("hex");
      if (actual !== reviewedCorrections.get(later)) {
        failures.push(`${later} changed after its security review`);
      }
      continue;
    }

    if (narrowingOnly.has(later)) {
      const code = laterSql.replace(/--[^\n]*/g, "");
      if (/\bgrant\b|\bcreate\s+policy\b|\bdisable\s+row\s+level\s+security\b|\bas\s+restrictive\b/i.test(code)) {
        failures.push(`${later} is listed as narrowing-only but widens access`);
      }
    }

    const created = new Set([
      ...objectsIn(
        laterSql,
        /\bcreate\s+table\s+(?:if\s+not\s+exists\s+)?((?:public\.)?[a-z_][a-z0-9_]*)/gi,
      ),
      ...objectsIn(
        laterSql,
        /\bcreate\s+(?:or\s+replace\s+)?function\s+((?:public\.)?[a-z_][a-z0-9_]*)/gi,
      ),
    ]);

    // A post-baseline file may redefine a function the baseline created only
    // by folding it into the baseline, never by shadowing it later.
    for (const fn of created) {
      if (baselineFunctions.has(fn) ) {
        failures.push(
          `${later} redefines ${fn}, which ${securityFile} owns — fold that change into the baseline`,
        );
      }
    }

    for (const match of laterSql.matchAll(securedStatement)) {
      if (narrowingOnly.has(later) && narrowingStatement.test(match[0])) continue;
      if (helperGrants.get(later)?.test(`${match[0]}${laterSql.slice(match.index + match[0].length).split(";")[0]}`)) continue;
      const target = match[1].toLowerCase().replace(/^public\./, "");
      if (baselineTables.has(target)) {
        failures.push(
          `${later} changes policies, grants or RLS on ${target}, which ${securityFile} secured — fold that part into the baseline`,
        );
      } else if (!created.has(target) && !/^storage\./.test(target)) {
        // Adding a nullable column to an existing table is ordinary schema
        // work; re-securing a table this file did not create is not.
        if (!/\balter\s+table\b/i.test(match[0])) {
          failures.push(
            `${later} secures ${target}, which it does not create — fold that part into the baseline`,
          );
        }
      } else if (/^storage\./.test(target)) {
        failures.push(
          `${later} changes storage policies, which ${securityFile} owns — fold that part into the baseline`,
        );
      }
    }

    // Every RLS toggle must name a table the file creates.
    for (const line of laterSql.split(/;\s*\n/)) {
      if (!rlsStatement.test(line)) continue;
      const target = line.match(
        /\balter\s+table\s+((?:public\.)?[a-z_][a-z0-9_]*)/i,
      );
      const name = target?.[1]?.toLowerCase().replace(/^public\./, "");
      if (!name || !created.has(name)) {
        failures.push(
          `${later} toggles row level security on ${name ?? "an unknown table"}, which it does not create`,
        );
      }
      if (name && /disable\s+row\s+level\s+security/i.test(line)) {
        failures.push(`${later} disables row level security on ${name}`);
      }
    }

    // A new SECURITY DEFINER function is allowed, but it must pin search_path
    // and must not be left executable by browsers unless it is a deliberate
    // public projection that says so.
    for (const block of laterSql.split(/\bcreate\s+(?:or\s+replace\s+)?function\b/i).slice(1)) {
      if (!/security\s+definer/i.test(block)) continue;
      if (!/set\s+search_path\s*=/i.test(block)) {
        const named = block.match(/^\s*((?:public\.)?[a-z_][a-z0-9_]*)/i);
        failures.push(
          `${later} defines SECURITY DEFINER ${named?.[1] ?? "function"} without a pinned search_path`,
        );
      }
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
