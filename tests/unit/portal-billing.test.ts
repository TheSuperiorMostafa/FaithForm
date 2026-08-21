import assert from "node:assert/strict";
import test from "node:test";
import {
  createAuthorizedBillingPortal,
  type BillingPortalDependencies,
} from "@/lib/giving/portal-billing";

const session = {
  churchId: "church-a",
  donorId: "donor-a",
  sessionId: "session-a",
};

function mockDependencies(
  overrides: Partial<BillingPortalDependencies> = {},
): BillingPortalDependencies {
  return {
    loadChurch: async (slug) => ({
      churchId: "church-a",
      slug,
      stripeAccountId: "acct_authorized",
    }),
    loadActiveCustomerId: async (churchId, donorId) =>
      churchId === "church-a" && donorId === "donor-a"
        ? "cus_authorized"
        : null,
    createPortal: async (accountId, customerId) =>
      `https://billing.invalid/${accountId}/${customerId}`,
    ...overrides,
  };
}

test("valid verified donor session creates a portal with the authorized customer", async () => {
  const url = await createAuthorizedBillingPortal(
    "grace",
    session,
    mockDependencies(),
  );
  assert.equal(
    url,
    "https://billing.invalid/acct_authorized/cus_authorized",
  );
});

test("another church's donor session cannot create a portal", async () => {
  let stripeCalled = false;
  const url = await createAuthorizedBillingPortal(
    "other",
    session,
    mockDependencies({
      loadChurch: async () => ({
        churchId: "church-b",
        slug: "other",
        stripeAccountId: "acct_other",
      }),
      createPortal: async () => {
        stripeCalled = true;
        return "unexpected";
      },
    }),
  );
  assert.equal(url, null);
  assert.equal(stripeCalled, false);
});

test("a donor without an exact active customer relationship is rejected", async () => {
  const url = await createAuthorizedBillingPortal(
    "grace",
    session,
    mockDependencies({ loadActiveCustomerId: async () => null }),
  );
  assert.equal(url, null);
});
