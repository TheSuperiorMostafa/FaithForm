import assert from "node:assert/strict";
import test from "node:test";

import { inviteNeedsRefresh, inviteUnavailableCode } from "@/lib/onboarding/validate-invite";

const now = Date.parse("2026-09-27T18:00:00Z");

test("a resend keeps a valid invite link until its exact expiry", () => {
  assert.equal(inviteNeedsRefresh("2026-09-27T18:00:01Z", now), false);
  assert.equal(inviteNeedsRefresh("2026-09-27T18:00:00Z", now), true);
  assert.equal(inviteNeedsRefresh("2026-09-27T17:59:59Z", now), true);
});

test("a malformed expiry is never treated as a usable invitation", () => {
  assert.equal(inviteNeedsRefresh("not-a-date", now), true);
});

test("finishing church setup closes every outstanding invitation", () => {
  const invite = {
    acceptedAt: null,
    onboardingCompletedAt: "2026-09-27T17:00:00Z",
    expiresAt: "2026-10-04T18:00:00Z",
  };
  assert.equal(inviteUnavailableCode(invite, now), "already_accepted");
  assert.equal(inviteUnavailableCode({ ...invite, onboardingCompletedAt: null }, now), null);
  assert.equal(inviteUnavailableCode({ ...invite, onboardingCompletedAt: null, expiresAt: "not-a-date" }, now), "expired");
});
