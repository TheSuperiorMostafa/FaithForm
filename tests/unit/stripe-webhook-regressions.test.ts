import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

for (const [scenario, description] of [
  ["church-lookup-error", "church lookup failures retry without losing a donation"],
  ["payment-projection-error", "returned payment projection errors retry and repair the mobile attempt"],
  ["payment-projection-throw", "thrown payment projection errors retry and repair the mobile attempt"],
  ["unknown-church", "unknown connected accounts remain acknowledged without recording a gift"],
  ["mismatched-church", "mismatched church metadata remains acknowledged without recording a gift"],
  ["refund-order", "a refund before payment projection retries and later wins"],
  ["subscription-error", "subscription update failures remain retryable"],
  ["subscription-insert-race", "subscription insert-race update failures remain retryable"],
  ["pause-collection", "collection pauses remain visible and resuming clears the pause"],
  ["refund-rpc-error", "refund attempt projection failures remain retryable"],
  ["dispute-rpc-error", "closed-dispute attempt projection failures remain retryable"],
  ["dispute-projection-read-error", "dispute attempt lookup failures remain retryable"],
  ["refund-error", "refund write failures remain retryable"],
  ["partial-refund", "partial refunds leave donation state unchanged"],
  ["cross-church-refund", "refund state cannot mutate another church's donation"],
  ["dispute-before-donation", "a dispute before payment projection remains retryable"],
  ["dispute-error", "dispute update failures remain retryable"],
  ["dispute-closed-lost", "lost disputes update donation and mobile attempt"],
  ["dispute-closed-won", "won disputes restore donation and mobile attempt"],
  ["stale-refund", "older refunds cannot overwrite newer donation state"],
  ["equal-time-refund", "equal timestamp refund events retain existing update semantics"],
]) {
  test(description, () => {
    const result = spawnSync(process.execPath, ["tests/fixtures/stripe-webhook-regressions.mjs", scenario], {
      encoding: "utf8",
    });
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /Passed /);
  });
}
