import assert from "node:assert/strict";
import test from "node:test";
import { deliverGroupAnnouncement } from "@/lib/groups/announcement-delivery";

test("an ambiguous send stops the batch and retry uses the same message ID", async () => {
  const messages = new Map<string, string>();
  let disconnect = true;
  const send = async (group: string, payload: { id: string; text: string }) => {
    messages.set(payload.id, payload.text);
    if (group === "second" && disconnect) { disconnect = false; throw new Error("connection lost after provider accepted message"); }
  };
  const first = await deliverGroupAnnouncement("batch", ["first", "second", "third"], "Service moved to 10am", send);
  assert.deepEqual(first, { sent: ["first"], failed: "second" });
  const retry = await deliverGroupAnnouncement("batch", ["second", "third"], "Service moved to 10am", send);
  assert.deepEqual(retry, { sent: ["second", "third"], failed: null });
  assert.equal(messages.size, 3);
  assert.deepEqual([...messages.values()], Array(3).fill("Service moved to 10am"));
});

test("a rejected first group cannot send to later groups", async () => {
  const reached: string[] = [];
  const result = await deliverGroupAnnouncement("batch", ["denied", "later"], "Hello", async id => { reached.push(id); throw new Error("forbidden"); });
  assert.deepEqual(reached, ["denied"]);
  assert.deepEqual(result, { sent: [], failed: "denied" });
});
