#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const acceptedHighAdvisories = new Set([
  // image-size has no fixed release. The lockfile applies a reviewed patch
  // that rejects zero/undersized ICNS and ISO-BMFF boxes. Keep the exception
  // narrowly bound to these two advisory IDs until the dependency is replaced.
  "GHSA-5p2g-fcmc-qvqq",
  "GHSA-w3rx-r6r6-pgpr",
]);

function verifyLocalImageSizePatch() {
  const patch = readFileSync("patches/image-size@1.2.1.patch", "utf8");
  const lockfile = readFileSync("pnpm-lock.yaml", "utf8");
  if (
    !patch.includes("boxSize < 8") ||
    !patch.includes("imageHeader[1] < SIZE_HEADER") ||
    !lockfile.includes("image-size@1.2.1:") ||
    !lockfile.includes("patches/image-size@1.2.1.patch")
  ) {
    throw new Error("The accepted image-size advisories are not locally patched.");
  }
}

try {
  verifyLocalImageSizePatch();
} catch {
  console.error("The reviewed image-size security patch is missing from the lockfile.");
  process.exit(1);
}

const audit = spawnSync("pnpm", ["audit", "--prod", "--json"], {
  encoding: "utf8",
  maxBuffer: 20 * 1024 * 1024,
});

if (audit.error) {
  console.error("Production dependency audit could not start.");
  process.exit(1);
}

const jsonStart = audit.stdout.indexOf("{");
if (jsonStart < 0) {
  console.error("Production dependency audit returned no JSON report.");
  process.exit(1);
}

let report;
try {
  report = JSON.parse(audit.stdout.slice(jsonStart));
} catch {
  console.error("Production dependency audit returned malformed JSON.");
  process.exit(1);
}

const unresolved = Object.values(report.advisories ?? {}).filter((advisory) => {
  if (!['high', 'critical'].includes(advisory.severity)) return false;
  return !acceptedHighAdvisories.has(advisory.github_advisory_id);
});

const accepted = Object.values(report.advisories ?? {}).filter((advisory) =>
  acceptedHighAdvisories.has(advisory.github_advisory_id),
);

console.log(
  JSON.stringify(
    {
      vulnerabilities: report.metadata?.vulnerabilities ?? {},
      acceptedPatchedAdvisories: accepted.map((advisory) => ({
        id: advisory.github_advisory_id,
        module: advisory.module_name,
        severity: advisory.severity,
      })),
      unresolvedHighOrCritical: unresolved.map((advisory) => ({
        id: advisory.github_advisory_id,
        module: advisory.module_name,
        severity: advisory.severity,
      })),
    },
    null,
    2,
  ),
);

if (unresolved.length > 0) process.exit(1);
