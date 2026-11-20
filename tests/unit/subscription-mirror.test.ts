import assert from "node:assert/strict";
import { test } from "node:test";
import { subscriptionMirrorPatch } from "@/lib/giving/subscription-mirror";

const now = new Date("2026-11-20T12:00:00.000Z");

test("a cancelled gift is saved as canceled and not paused", () => {
  const patch = subscriptionMirrorPatch("cancel", { status: "canceled", pause_collection: null }, { now });
  assert.deepEqual(patch, { status: "canceled", paused_at: null, updated_at: now.toISOString() });
});

test("a paused gift records when it was paused", () => {
  const patch = subscriptionMirrorPatch(
    "pause",
    { status: "active", pause_collection: { behavior: "void", resumes_at: null } },
    { now },
  );
  assert.equal(patch.status, "active");
  assert.equal(patch.paused_at, now.toISOString());
});

test("a resumed gift clears the pause", () => {
  const patch = subscriptionMirrorPatch("resume", { status: "active", pause_collection: null }, { now });
  assert.equal(patch.paused_at, null);
});

test("only an amount change writes the amount", () => {
  const sub = { status: "active", pause_collection: null } as const;
  assert.equal(subscriptionMirrorPatch("update_amount", sub, { now, newAmountCents: 500 }).amount_cents, 500);
  assert.equal("amount_cents" in subscriptionMirrorPatch("cancel", sub, { now, newAmountCents: 500 }), false);
});

test("an unknown Stripe status falls back to active", () => {
  const patch = subscriptionMirrorPatch(
    "resume",
    { status: "something_new" as never, pause_collection: null },
    { now },
  );
  assert.equal(patch.status, "active");
});
