import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";

import { FEATURES, getFeature } from "@/lib/features/catalog";
import { deliverDonationReceipt } from "@/lib/stripe/receipt-delivery";

const read = (path: string) => readFileSync(path, "utf8");

// ---------------------------------------------------------------------------
// Catalog
// ---------------------------------------------------------------------------

test("only the features that send a church's email get an Emails switch", () => {
  const withEmails = FEATURES.filter((feature) => feature.emails)
    .map((feature) => feature.key)
    .sort();
  assert.deepEqual(withEmails, ["announcements", "giving", "website"]);

  assert.equal(
    getFeature("giving").emails,
    "Donation receipts and failed-payment notices",
  );
  assert.equal(getFeature("website").emails, "Contact form notices to your church");
  assert.equal(getFeature("announcements").emails, "The weekly announcement email");
});

test("announcements no longer promises Gmail, since any mailbox works now", () => {
  assert.doesNotMatch(getFeature("announcements").description, /gmail/i);
  assert.match(getFeature("announcements").description, /email/);
});

// ---------------------------------------------------------------------------
// Receipt delivery, against a stand-in for the two RPCs and two reads it makes
// ---------------------------------------------------------------------------

type Call =
  | { kind: "rpc"; name: string; args: Record<string, unknown> }
  | { kind: "from"; table: string };

function fakeClient(rows: {
  claim: { claimed: boolean; claim_token: string | null; attempt: number };
  donation: Record<string, unknown> | null;
  church?: Record<string, unknown> | null;
}) {
  const calls: Call[] = [];

  const client = {
    rpc: async (name: string, args: Record<string, unknown>) => {
      calls.push({ kind: "rpc", name, args });
      if (name === "claim_donation_receipt") {
        return { data: [rows.claim], error: null };
      }
      if (name === "complete_donation_receipt") {
        return { data: true, error: null };
      }
      throw new Error(`unexpected rpc ${name}`);
    },
    from: (table: string) => {
      calls.push({ kind: "from", table });
      const row =
        table === "giving_donations"
          ? rows.donation
          : table === "churches"
            ? (rows.church ?? null)
            : null;
      const query = {
        select: () => query,
        eq: () => query,
        maybeSingle: async () => ({ data: row, error: null }),
      };
      return query;
    },
  };

  return { client: client as unknown as SupabaseClient, calls };
}

const donation = {
  id: "donation-1",
  church_id: "church-a",
  donor_email: "donor@example.org",
  donor_name: "Ruth",
  amount_cents: 5000,
  intended_amount_cents: 5000,
  gift_type: "recurring",
  created_at: "2026-09-13T15:00:00.000Z",
  giving_funds: { name: "General" },
};

const church = { name: "Grace Church", slug: "grace", ein: null };

function completion(calls: Call[]) {
  const call = calls.find(
    (entry) => entry.kind === "rpc" && entry.name === "complete_donation_receipt",
  );
  assert.ok(call && call.kind === "rpc", "the receipt was never completed");
  return call.args;
}

test("with Giving's emails off, a receipt closes as terminal and unsent", async () => {
  const { client, calls } = fakeClient({
    claim: { claimed: true, claim_token: "token-1", attempt: 1 },
    donation,
    church,
  });
  const asked: string[] = [];

  const result = await deliverDonationReceipt("donation-1", client, async (churchId) => {
    asked.push(churchId);
    return false;
  });

  assert.equal(result, "disabled");
  assert.deepEqual(asked, ["church-a"]);
  // Terminal, so the 15-minute retry cron never re-claims it.
  assert.deepEqual(completion(calls), {
    p_donation_id: "donation-1",
    p_claim_token: "token-1",
    p_sent: false,
    p_error_code: "emails_disabled",
    p_next_retry_at: null,
    p_terminal: true,
  });
  // It stopped before loading the church's branding, which only a send needs.
  assert.ok(!calls.some((entry) => entry.kind === "from" && entry.table === "churches"));
});

test("with Giving's emails on, delivery is unchanged: a failed send stays retryable", async () => {
  // No Resend key means the send reports failure without touching the network.
  const savedKey = process.env.RESEND_API_KEY;
  delete process.env.RESEND_API_KEY;
  try {
    const { client, calls } = fakeClient({
      claim: { claimed: true, claim_token: "token-2", attempt: 1 },
      donation,
      church,
    });

    const result = await deliverDonationReceipt("donation-1", client, async () => true);

    assert.equal(result, "deferred");
    const args = completion(calls);
    assert.equal(args.p_sent, false);
    assert.equal(args.p_error_code, "delivery_failed");
    assert.equal(args.p_terminal, false);
    assert.equal(typeof args.p_next_retry_at, "string");
  } finally {
    if (savedKey !== undefined) process.env.RESEND_API_KEY = savedKey;
  }
});

test("a receipt another worker holds is skipped before the switch is even read", async () => {
  const { client, calls } = fakeClient({
    claim: { claimed: false, claim_token: null, attempt: 3 },
    donation,
  });
  let asked = false;

  const result = await deliverDonationReceipt("donation-1", client, async () => {
    asked = true;
    return false;
  });

  assert.equal(result, "skipped");
  assert.equal(asked, false);
  assert.equal(calls.length, 1);
});

// ---------------------------------------------------------------------------
// Wiring at the other send sites
// ---------------------------------------------------------------------------

test("the admin action writes only the Emails column, never the feature switch", () => {
  const actions = read("app/admin/feature-actions.ts");
  const action = actions.slice(
    actions.indexOf("export async function setChurchFeatureEmails"),
  );
  assert.ok(action.length > 200, "setChurchFeatureEmails was renamed");

  assert.match(action, /await requireSuperAdmin\(\)/);
  assert.match(action, /emails_enabled: input\.enabled/);
  // `enabled` itself is never written, so an upsert cannot switch a feature
  // back on (or off) as a side effect.
  // A typed argument named `enabled` is harmless; the unsafe case is an
  // `enabled` property in the database row passed to upsert.
  const upsertRow = action.slice(
    action.indexOf('admin.from("church_features").upsert('),
    action.indexOf('{ onConflict: "church_id,feature_key" }'),
  );
  assert.doesNotMatch(upsertRow, /^\s*enabled:/m);
  assert.doesNotMatch(action, /disabled_reason|disabled_note/);
  assert.match(action, /revalidateTag\(churchFeatureCacheTag\(input\.churchId\)\)/);
});

test("a Visit-form message is stored before the Emails switch can skip its notice", () => {
  const route = read("app/api/sites/contact/route.ts");
  const stored = route.indexOf('.from("site_contact_submissions")');
  const gate = route.indexOf('isChurchFeatureEmailEnabled(target.churchId, "website")');
  const sent = route.indexOf("await sendSiteContactEmail(");

  assert.ok(stored > 0 && gate > 0 && sent > 0);
  assert.ok(stored < gate && gate < sent);
});

test("the failed-payment email asks the Giving switch before sending", () => {
  const webhooks = read("lib/stripe/webhooks.ts");
  const gate = webhooks.indexOf('isChurchFeatureEmailEnabled(churchId, "giving")');
  const sent = webhooks.indexOf("await sendFailedPaymentEmail(");

  assert.ok(gate > 0 && sent > 0);
  assert.ok(gate < sent);
});
