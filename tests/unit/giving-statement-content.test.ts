import assert from "node:assert/strict";
import test from "node:test";
import { statementAcknowledgment, statementFundTotals } from "@/lib/giving/statement-content";
import type { GivingDonationRow } from "@/types/giving";

const gift = (amountCents: number, fundId: string | null, fundName: string | null, fundDesignation: string | null = null) => ({ amountCents, fundId, fundName, fundDesignation }) as GivingDonationRow;

test("fund totals preserve integer cents and separate funds with the same name", () => {
  assert.deepEqual(statementFundTotals([
    gift(101, "a", "Missions"), gift(202, "a", "Missions"), gift(400, "b", "Missions"), gift(50, null, null), gift(75, null, null, "Building"),
  ]), [{ name: "Building", amountCents: 75 }, { name: "General", amountCents: 50 }, { name: "Missions", amountCents: 303 }, { name: "Missions", amountCents: 400 }]);
});

test("the contribution acknowledgment uses the church's real EIN and requested language", () => {
  assert.equal(statementAcknowledgment("Hope Church", "12-3456789"), "Hope Church (EIN 12-3456789) is a tax-exempt organization under Section 501(c)(3). No goods or services were provided in exchange for the contributions listed above, other than intangible religious benefits. Please retain this statement for your tax records. Consult your tax advisor regarding deductibility.");
});

test("without a tax ID the statement does not invent an EIN or exemption claim", () => {
  const text = statementAcknowledgment("Hope Church", null);
  assert.ok(!text.includes("501(c)(3)"));
  assert.ok(!text.includes("EIN"));
  assert.ok(text.includes("intangible religious benefits"));
  assert.deepEqual(statementFundTotals([]), []);
});
