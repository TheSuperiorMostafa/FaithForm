import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";

/**
 * Found by browsing as a Volunteer (Attendance and Kids Check-in only) on a
 * local stack: every section they could not open showed "You don't have
 * access", yet People sent the whole directory with phones and emails, a
 * family page sent a child's medical notes, a call page its transcript and a
 * sermon page its text — inside the page payload. A layout and its page render
 * side by side, so a `<FeatureGate>` layout hides what is drawn but not what
 * the page fetched. Every page under a gate now stops first.
 */

const ROOT = "app/dashboard";

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (name === "page.tsx") out.push(path);
  }
  return out;
}

function gateFor(pageDir: string): string | null {
  for (let dir = pageDir; dir.startsWith(ROOT); dir = dirname(dir)) {
    const layout = join(dir, "layout.tsx");
    if (existsSync(layout)) {
      const match = /<FeatureGate feature="([a-z_]+)"/.exec(readFileSync(layout, "utf8"));
      if (match) return match[1];
    }
  }
  return null;
}

test("every page that loads data under a feature gate stops before loading it", () => {
  const checked: string[] = [];
  for (const page of walk(ROOT)) {
    const feature = gateFor(dirname(page));
    if (!feature) continue;
    const source = readFileSync(page, "utf8");
    const start = source.indexOf("export default async function");
    if (start < 0) {
      // A synchronous page cannot load anything; today they are all redirects.
      assert.match(source, /redirect\(/, `${page} is synchronous but not a redirect`);
      continue;
    }
    const body = source.slice(source.indexOf("{", source.indexOf(")", start)) + 1);
    const firstStatement = body.trimStart().split("\n")[0];
    assert.equal(
      firstStatement,
      `if (await pageFeatureBlocked("${feature}")) return null;`,
      `${page} must check "${feature}" before anything else`,
    );
    checked.push(page);
  }
  assert.ok(checked.length >= 60, `only ${checked.length} gated pages found`);
});
