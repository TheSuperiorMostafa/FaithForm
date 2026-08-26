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

  for (const later of files.filter((file) => file > securityFile)) {
    const laterSql = readFileSync(join(directory, later), "utf8");

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
