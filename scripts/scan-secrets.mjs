#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const files = execFileSync("git", ["ls-files", "-co", "--exclude-standard"], {
  encoding: "utf8",
})
  .split("\n")
  .filter(Boolean)
  .filter((file) => !file.startsWith(".next/") && file !== ".env.example")
  .filter((file) => !/\.(png|jpe?g|gif|webp|ico|pdf|pptx|zip|woff2?)$/i.test(file));

const patterns = [
  /\bsk_(?:live|test)_[A-Za-z0-9]{20,}\b/g,
  /\bwhsec_[A-Za-z0-9]{20,}\b/g,
  /\b(?:ghp|github_pat)_[A-Za-z0-9_]{20,}\b/g,
  /\bAIza[A-Za-z0-9_-]{30,}\b/g,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g,
];

const findings = [];
for (const file of files) {
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    continue;
  }
  for (const pattern of patterns) {
    pattern.lastIndex = 0;
    if (pattern.test(text)) findings.push(file);
  }
}

if (findings.length) {
  console.error(`Potential secrets found in: ${[...new Set(findings)].join(", ")}`);
  process.exit(1);
}
console.log(`Secret scan passed for ${files.length} repository files.`);
