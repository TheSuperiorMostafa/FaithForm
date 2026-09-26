import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/**
 * The group member reconcile read memberships without checking for an error,
 * so a failed read was an empty group and every member was removed from the
 * channel. And its removals ran after identity lookup, provisioning and the
 * add — any of which failing left removed people reading the group.
 */
const file = readFileSync("lib/messaging/sync/handlers.ts", "utf8");
const start = file.indexOf("async function syncGroupMembers(");
const source = file.slice(start, file.indexOf("\nasync function ", start + 1));

test("a failed membership read fails the job instead of emptying the channel", () => {
  assert.match(source, /if \(membershipsError\) throw/);
  assert.ok(source.indexOf("if (membershipsError) throw") < source.indexOf("removeMembers(GROUP_CHANNEL_TYPE"));
});

test("removals are applied before anything that can fail on the way to an add", () => {
  const remove = source.indexOf("removeMembers(GROUP_CHANNEL_TYPE");
  assert.ok(remove > 0);
  assert.ok(remove < source.indexOf("resolveChatIdentities("));
  assert.ok(remove < source.indexOf("provisionChatUsers("));
  assert.ok(remove < source.indexOf("addMembers(GROUP_CHANNEL_TYPE"));
  assert.equal((source.match(/removeMembers\(GROUP_CHANNEL_TYPE, channelId, removals\)/g) ?? []).length, 1);
});
