import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { listRetellAgents } from "../../lib/integrations/retell-client";

// Retell has removed these; a request to any of them now fails.
// https://docs.retellai.com/deprecation-notice/overview
const REMOVED_RETELL_PATHS = [
  /["'`]\/list-agents\b/,
  /["'`]\/list-chat-agents\b/,
  /["'`]\/get-agent-versions\//,
  /["'`]\/get-chat-agent-versions\//,
  /["'`]\/list-phone-numbers\b/,
  /["'`]\/list-retell-llms\b/,
  /["'`]\/list-conversation-flows\b/,
  /["'`]\/list-chat\b/,
  /["'`]\/v2\/list-calls\b/,
  /["'`]\/publish-agent\//,
  /["'`]\/create-retell-llm\b/,
];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (name === "node_modules" || name.startsWith(".")) return [];
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.(ts|tsx|mjs|js)$/.test(name) ? [full] : [];
  });
}

test("no code calls a Retell endpoint that Retell has removed", () => {
  const root = path.resolve(__dirname, "../..");
  const offenders: string[] = [];
  for (const dir of ["lib", "app", "scripts"]) {
    for (const file of sourceFiles(path.join(root, dir))) {
      const text = readFileSync(file, "utf8");
      if (!text.includes("retell")) continue;
      for (const pattern of REMOVED_RETELL_PATHS) {
        if (pattern.test(text)) offenders.push(`${path.relative(root, file)}: ${pattern}`);
      }
    }
  }
  assert.deepEqual(offenders, []);
});

test("the agent picker pages through POST /v2/list-agents, voice agents only", async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.RETELL_API_KEY;
  process.env.RETELL_API_KEY = "test-key";
  const requests: Array<{ url: string; method?: string; body: unknown }> = [];
  const pages = [
    { items: [{ agent_id: "agent_b", agent_name: "Beta", latest_published_version: 3 }], has_more: true, pagination_key: "k1" },
    { items: [{ agent_id: "agent_a", agent_name: "Alpha" }], has_more: false },
  ];
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    requests.push({ url, method: init?.method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    return new Response(JSON.stringify(pages[requests.length - 1]), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;

  try {
    const agents = await listRetellAgents();
    assert.equal(requests.length, 2);
    for (const request of requests) {
      assert.equal(request.method, "POST");
      assert.match(request.url, /^https:\/\/api\.retellai\.com\/v2\/list-agents\?/);
      assert.deepEqual(request.body, { filter_criteria: { channel: { type: "string", op: "eq", value: "voice" } } });
    }
    assert.equal(new URL(requests[1].url).searchParams.get("pagination_key"), "k1");
    assert.deepEqual(agents, [
      { agentId: "agent_a", agentName: "Alpha", version: null, isPublished: false },
      { agentId: "agent_b", agentName: "Beta", version: 3, isPublished: true },
    ]);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.RETELL_API_KEY;
    else process.env.RETELL_API_KEY = originalKey;
  }
});
