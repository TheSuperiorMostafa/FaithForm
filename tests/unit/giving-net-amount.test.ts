import assert from "node:assert/strict";
import test from "node:test";
import { giftNetAfterFees, totalNetAfterFees } from "@/lib/giving/net-amount";

const covered = {
  amountCents: 2587,
  intendedAmountCents: 2500,
  feeCovered: true,
  netAmountCents: null,
};

test("a covered fee shows the intended gift until Stripe reports the exact net", () => {
  assert.deepEqual(giftNetAfterFees(covered), { cents: 2500, estimated: true });
  assert.deepEqual(giftNetAfterFees({ ...covered, netAmountCents: 2501 }), { cents: 2501, estimated: false });
  assert.deepEqual(giftNetAfterFees({ ...covered, feeCovered: false }), { cents: null, estimated: false });
});

test("zero-dollar legacy gifts do not block totals, while unknown fees remain pending", () => {
  const zeroGift = { ...covered, amountCents: 0, feeCovered: false, intendedAmountCents: null };
  assert.deepEqual(totalNetAfterFees([zeroGift, covered]), { cents: 2500, estimated: true });
  assert.deepEqual(totalNetAfterFees([zeroGift, { ...covered, feeCovered: false }]), { cents: null, estimated: false });
  assert.deepEqual(totalNetAfterFees([zeroGift, { ...covered, netAmountCents: 2501 }]), { cents: 2501, estimated: false });
});
