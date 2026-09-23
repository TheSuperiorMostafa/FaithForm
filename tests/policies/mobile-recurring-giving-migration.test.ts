import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/**
 * Migration 0100's guarantees are all about a charge that repeats.
 *
 * A one-time gift's defences fail once and cost a refund. These fail *monthly*,
 * and the person they fail is the one least likely to notice — so the shape of
 * each one is pinned here rather than left to a reviewer's memory.
 */
const sql = readFileSync("supabase/migrations/0100_mobile_recurring_giving.sql", "utf8");
const service = readFileSync("lib/giving/v1/giving-recurring-service.ts", "utf8");
const provider = readFileSync("lib/giving/v1/payment-provider.ts", "utf8");

test("the migration changes no existing table or column", () => {
  // Additive means additive. `giving_subscriptions` and `giving_donors` are
  // financial records the web flow and the webhook both write.
  assert.doesNotMatch(sql, /alter table public\.giving_subscriptions/i);
  assert.doesNotMatch(sql, /alter table public\.giving_donations/i);
  assert.doesNotMatch(sql, /alter table public\.giving_donors/i);
  assert.doesNotMatch(sql, /drop (table|column|function)/i);
  // And nothing backfills money.
  assert.doesNotMatch(sql, /insert into public\.giving_subscriptions/i);
  assert.doesNotMatch(sql, /update public\.giving_subscriptions/i);
});

test("one attempt id can only ever become one subscription", () => {
  // Three layers, and the test names all three because removing any one of
  // them leaves the other two looking sufficient.
  assert.match(sql, /unique \(account_id, client_attempt_id\)/);
  assert.match(sql, /on conflict \(account_id, client_attempt_id\) do nothing/);
  assert.match(
    sql,
    /create unique index if not exists giving_recurring_attempts_subscription_key/,
  );
});

test("attaching a subscription to an attempt is write-once", () => {
  // A bug that created two subscriptions must leave the attempt pointed at the
  // first — the one a person will be told about and a support conversation can
  // find. `and a.stripe_subscription_id is null` is the whole guard.
  assert.match(sql, /and a\.stripe_subscription_id is null/);
});

test("the idempotency key is derived in SQL, never sent by a client", () => {
  assert.match(sql, /'ffr_' \|\| replace\(gen_random_uuid\(\)::text, '-', ''\)/);
  // A client field named anything like a key would be a client choosing it.
  assert.doesNotMatch(sql, /p_idempotency_key/);
});

test("a retry survives the church unpublishing the fund", () => {
  // The existing-attempt read comes before the fund lookup. Reversed, a person
  // whose gift was already created would be refused mid-payment with no way to
  // find out what happened to it.
  const existingRead = sql.indexOf("from public.giving_recurring_attempts a");
  const fundRead = sql.indexOf("from public.giving_funds f");
  assert.ok(existingRead > 0 && fundRead > 0);
  assert.ok(
    existingRead < fundRead,
    "the existing attempt must be read before the fund is checked",
  );
});

test("the same attempt id cannot cross a church boundary", () => {
  assert.match(sql, /attempt_church_mismatch/);
});

test("ownership is the donor link, never an email match", () => {
  // Migration 0063 created `giving_donor_links` precisely so that an account is
  // never matched to a church's donor by email. A projection that reached for
  // an address would undo that in one line.
  assert.match(sql, /from public\.giving_donor_links l/);
  assert.match(sql, /and l\.revoked_at is null/);
  // No `s` flag: the tsconfig target predates it. `[\s\S]` is the same thing.
  assert.doesNotMatch(sql, /giving_donors[\s\S]*email/i);
});

test("the projection returns no provider identifier and no donor identity", () => {
  const projection = sql.slice(
    sql.indexOf("create or replace function public.mobile_giving_recurring("),
    sql.indexOf("create or replace function public.mobile_giving_recurring_owner("),
  );
  assert.ok(projection.length > 0);
  for (const forbidden of [
    "stripe_customer_id",
    "stripe_subscription_id",
    "donor_email",
    "donor_name",
  ]) {
    assert.doesNotMatch(
      projection,
      new RegExp(forbidden),
      `the recurring list must not return ${forbidden}`,
    );
  }
});

test("a cancelled gift is not listed, and every listed one can be stopped", () => {
  assert.match(sql, /s\.status in \('active', 'trialing', 'past_due', 'paused', 'unpaid'\)/);
});

test("the tables and functions are unreachable from the browser roles", () => {
  assert.match(
    sql,
    /revoke all on table public\.giving_recurring_attempts from public, anon, authenticated/,
  );
  for (const fn of [
    "claim_giving_recurring_attempt",
    "attach_giving_subscription",
    "mobile_giving_recurring",
    "mobile_giving_recurring_owner",
  ]) {
    assert.match(
      sql,
      new RegExp(`revoke all on function public\\.${fn}`),
      `${fn} must be revoked from the browser roles`,
    );
  }
  assert.match(sql, /security definer/);
});

test("stopping a gift is never gated by the giving feature flag", () => {
  // A church turning Giving off must not trap somebody in a recurring charge.
  // Starting one is gated; stopping one never is.
  const cancel = service.slice(service.indexOf("export async function cancelRecurringGift"));
  assert.doesNotMatch(cancel, /isChurchFeatureEnabled/);
});

test("a gift is only reported stopped when the provider accepted it", () => {
  const cancel = service.slice(service.indexOf("export async function cancelRecurringGift"));
  assert.match(cancel, /if \(!stopped\) return \{ ok: false, reason: "unavailable" \};/);
});

test("the donor's email comes from Auth, never from the request body", () => {
  assert.match(service, /getAuthUsersByIds\(\[userId\]\)/);
  // The contract's request carries a fund, an amount, a cadence and an attempt
  // id. An email among them would let somebody attach a gift to another
  // person's donor record.
  const contract = readFileSync("lib/mobile/v1/contract.ts", "utf8");
  const request = contract.slice(
    contract.indexOf("export const startRecurringGiftRequestSchema"),
    contract.indexOf('.meta({ id: "StartRecurringGiftRequest" })'),
  );
  assert.ok(request.length > 0);
  assert.doesNotMatch(request, /email/i);
  assert.doesNotMatch(request, /customer/i);
  assert.doesNotMatch(request, /stripe/i);
});

test("the subscription saves its method, so renewals need nobody's attention", () => {
  assert.match(provider, /save_default_payment_method: "on_subscription"/);
  assert.match(provider, /payment_behavior: "default_incomplete"/);
});

test("every Stripe call in the recurring path carries an idempotency key", () => {
  const recurring = provider.slice(provider.indexOf("async ensureCustomer("));
  const creates = recurring.match(/stripe\.\w+\.create\(/g) ?? [];
  const keys = recurring.match(/idempotencyKey:/g) ?? [];
  assert.ok(creates.length >= 3, "expected customer, price and subscription creates");
  assert.ok(
    keys.length >= creates.length,
    `${creates.length} creates but only ${keys.length} idempotency keys`,
  );
});

test("the Apple Pay button says donate", () => {
  // Apple's own nonprofit fundraising guidance asks for the donate button, and
  // Stripe's default is `.plain`. This is a store-review condition, not taste.
  const adapter = readFileSync(
    "apps/faithform-ios/Sources/FaithFormKit/Giving/StripePaymentSheetAdapter.swift",
    "utf8",
  );
  assert.match(adapter, /buttonType: \.donate/);
});

test("deleting an account stops its recurring gifts first", () => {
  // The one thing a foreign key cannot do. Without this, deletion removes the
  // rows that point at a gift and leaves the card being charged every month,
  // with no account left to see it from.
  const deletion = readFileSync("lib/faithform/account-deletion.ts", "utf8");
  assert.match(deletion, /await stopRecurringGifts\(admin, accountId\);/);

  // Order matters twice over: the donor links are how a gift is found, and the
  // Auth delete is what removes the account that owns them.
  const stop = deletion.indexOf("await stopRecurringGifts(admin, accountId);");
  const revoke = deletion.indexOf("await recordLinkRevocations(admin, accountId);");
  const authDelete = deletion.indexOf("await deleteAuthUser(admin, userId);");
  assert.ok(stop > 0 && revoke > 0 && authDelete > 0);
  assert.ok(stop < revoke, "gifts must be stopped before the donor links are revoked");
  assert.ok(stop < authDelete, "gifts must be stopped before the Auth user is deleted");
});

test("a provider outage never blocks a deletion we promised would happen", () => {
  // Apple's guideline 5.1.1(v) and /account-deletion both promise the account
  // goes. A church whose Stripe account is unreachable is a thing to log.
  const deletion = readFileSync("lib/faithform/account-deletion.ts", "utf8");
  const helper = deletion.slice(
    deletion.indexOf("async function stopRecurringGifts("),
    deletion.indexOf("async function recordLinkRevocations("),
  );
  assert.ok(helper.length > 0);
  assert.match(helper, /try \{/);
  assert.match(helper, /catch \{/);
  assert.doesNotMatch(helper, /throw/);
});
