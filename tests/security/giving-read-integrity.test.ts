import assert from "node:assert/strict";
import test from "node:test";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  getDonationById,
  getDonorGiftsForYear,
  getFailedSubscriptions,
  getChurchAddressLine,
  getChurchBySlug,
  getChurchGivingProfile,
  getGivingByFund,
  getGivingFunds,
  getStatementDonors,
  getSubscriptionById,
} from "../../lib/queries/giving";

type Page = {
  data: Record<string, unknown>[] | null;
  error: { message: string } | null;
};

function clientWithPages(...pages: Page[]) {
  const ranges: Array<[number, number]> = [];
  const builder = {
    select: () => builder,
    eq: () => builder,
    gte: () => builder,
    lt: () => builder,
    order: () => builder,
    range: (from: number, to: number) => {
      ranges.push([from, to]);
      const page = pages.shift();
      assert.ok(page, "unexpected extra giving query");
      return Promise.resolve(page);
    },
  };
  return {
    client: { from: () => builder } as unknown as SupabaseClient,
    ranges,
  };
}

function clientWithReads(...responses: Array<{ data: Record<string, unknown> | null; error: { code?: string; message: string } | null }>) {
  const next = () => {
    const response = responses.shift();
    assert.ok(response, "unexpected extra giving read");
    return Promise.resolve(response);
  };
  const builder = {
    select: () => builder,
    eq: () => builder,
    in: () => builder,
    order: next,
    maybeSingle: next,
  };
  return { from: () => builder } as unknown as SupabaseClient;
}

test("a donor statement includes gifts beyond the first Supabase page", async () => {
  const first = Array.from({ length: 1000 }, (_, index) => ({
    id: `gift-${index}`,
    amount_cents: 100,
    created_at: "2026-09-27T12:00:00Z",
    giving_funds: null,
  }));
  const db = clientWithPages(
    { data: first, error: null },
    { data: [{ ...first[0], id: "gift-1000" }], error: null },
  );

  const gifts = await getDonorGiftsForYear("church-a", "donor-a", 2026, db.client);
  assert.equal(gifts.length, 1001);
  assert.equal(gifts.at(-1)?.id, "gift-1000");
  assert.deepEqual(db.ranges, [[0, 999], [1000, 1999]]);
});

test("a failed statement read rejects instead of producing a partial PDF total", async () => {
  const db = clientWithPages(
    { data: Array.from({ length: 1000 }, (_, id) => ({ id: String(id) })), error: null },
    { data: null, error: { message: "connection lost" } },
  );
  await assert.rejects(
    getDonorGiftsForYear("church-a", "donor-a", 2026, db.client),
    /giving read failed: connection lost/,
  );
});

test("fund totals include every page and reject failed reads", async () => {
  const row = { amount_cents: 100, fund_id: "fund-a", giving_funds: { id: "fund-a", name: "General" } };
  const db = clientWithPages(
    { data: Array.from({ length: 1000 }, () => row), error: null },
    { data: [row], error: null },
  );
  const totals = await getGivingByFund("church-a", "ytd", db.client);
  assert.equal(totals[0]?.totalCents, 100100);
  assert.equal(totals[0]?.giftCount, 1001);

  const failed = clientWithPages({ data: null, error: { message: "read failed" } });
  await assert.rejects(getGivingByFund("church-a", "month", failed.client), /giving read failed/);
});

test("the church-wide statement export reads all donors and rejects a partial list", async () => {
  const donors = Array.from({ length: 1000 }, (_, index) => ({
    id: `donor-${index}`,
    name: null,
    email: `donor-${index}@example.invalid`,
  }));
  const complete = clientWithPages(
    { data: donors, error: null },
    { data: [{ id: "donor-1000", name: null, email: "last@example.invalid" }], error: null },
  );
  assert.equal((await getStatementDonors("church-a", complete.client)).length, 1001);

  const partial = clientWithPages(
    { data: donors, error: null },
    { data: null, error: { message: "connection lost" } },
  );
  await assert.rejects(getStatementDonors("church-a", partial.client), /giving read failed/);
});

test("failed Giving lookups cannot masquerade as no funds or no gifts", async () => {
  const failure = { data: null, error: { message: "connection lost" } };
  await assert.rejects(getGivingFunds("church-a", clientWithReads(failure)), /giving funds read failed/);
  await assert.rejects(getFailedSubscriptions("church-a", clientWithReads(failure)), /failed recurring gifts read failed/);

  const church = { data: { stripe_account_id: "acct_test" }, error: null };
  await assert.rejects(
    getDonationById("church-a", "gift-a", clientWithReads(church, failure)),
    /gift read failed/,
  );
  await assert.rejects(
    getSubscriptionById("church-a", "sub-a", clientWithReads(church, failure)),
    /recurring gift read failed/,
  );
});

test("a church read retries only for absent color columns", async () => {
  const failure = { data: null, error: { code: "08006", message: "connection lost" } };
  await assert.rejects(getChurchBySlug("qa", clientWithReads(failure)), /church giving profile read failed/);
  await assert.rejects(getChurchGivingProfile("church-a", clientWithReads(failure)), /church giving profile read failed/);
  await assert.rejects(getChurchAddressLine("church-a", clientWithReads(failure)), /church address read failed/);

  const missingColors = { data: null, error: { code: "42703", message: "giving_primary_color does not exist" } };
  const profile = { data: { id: "church-a", name: "QA Church", slug: "qa" }, error: null };
  assert.equal((await getChurchBySlug("qa", clientWithReads(missingColors, profile)))?.churchName, "QA Church");

  const denied = { data: null, error: { code: "42501", message: "permission denied for giving_primary_color" } };
  await assert.rejects(getChurchBySlug("qa", clientWithReads(denied)), /church giving profile read failed/);
});
