import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

/**
 * Executable tests for Prompt 11's giving model.
 *
 * The properties that matter here are all SQL: which funds a visitor can see,
 * whether one logical attempt can become two charges, whether a webhook's
 * conclusion is the only thing that can say a gift succeeded, and whether one
 * donor's history can ever reach another donor. Source inspection cannot answer
 * any of them.
 *
 * Skips loudly with a reason when no disposable target is configured. A skip is
 * not a pass.
 */

const DATABASE_URL = process.env.FAITHFUL_TEST_DATABASE_URL;

const SKIP_REASON =
  "FAITHFUL_TEST_DATABASE_URL is not set — no disposable Postgres target. " +
  "The giving isolation and idempotency rules are UNOBSERVED until this runs.";

if (/prod/i.test(DATABASE_URL ?? "")) {
  throw new Error("refusing to run giving tests against a production-looking database");
}

type Client = {
  query: (text: string, values?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
  end: () => Promise<void>;
};

type Fixture = { churchId: string; slug: string };

async function connect(): Promise<Client> {
  const { Client: PgClient } = await import("pg");
  const client = new PgClient({ connectionString: DATABASE_URL });
  await client.connect();
  return client as unknown as Client;
}

function run(
  count: number,
  body: (clients: Client[], track: (fixture: Fixture) => void) => Promise<void>,
): () => Promise<void> {
  return async () => {
    const clients: Client[] = [];
    const fixtures: Fixture[] = [];
    try {
      for (let index = 0; index < count; index += 1) clients.push(await connect());
      await body(clients, (fixture) => fixtures.push(fixture));
    } finally {
      for (const fixture of fixtures) {
        try {
          await clients[0].query(`delete from public.churches where id = $1`, [fixture.churchId]);
        } catch {
          // Never let a failed cleanup stop the connections closing.
        }
      }
      for (const client of clients) await client.end().catch(() => {});
    }
  };
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

async function seedChurch(
  client: Client,
  options: { chargesEnabled?: boolean; connected?: boolean } = {},
): Promise<Fixture> {
  const churchId = randomUUID();
  const slug = `give-${churchId.slice(0, 8)}`;
  await client.query(
    `insert into public.churches
       (id, name, slug, timezone, stripe_account_id, stripe_charges_enabled,
        stripe_details_submitted)
     values ($1, 'Giving Test Church', $2, 'America/New_York', $3, $4, $4)`,
    [
      churchId,
      slug,
      (options.connected ?? true) ? `acct_${churchId.slice(0, 12)}` : null,
      options.chargesEnabled ?? true,
    ],
  );
  return { churchId, slug };
}

async function seedAccount(client: Client): Promise<string> {
  const userId = randomUUID();
  const accountId = randomUUID();
  await client.query(`insert into auth.users (id) values ($1)`, [userId]);
  await client.query(
    `insert into public.visitor_accounts (id, user_id) values ($1, $2)`,
    [accountId, userId],
  );
  return accountId;
}

async function seedFund(
  client: Client,
  fixture: Fixture,
  options: {
    name?: string;
    visibility?: string;
    active?: boolean;
    min?: number;
    max?: number;
    suggested?: number[];
    title?: string | null;
  } = {},
): Promise<string> {
  const fundId = randomUUID();
  await client.query(
    `insert into public.giving_funds
       (id, church_id, name, slug, sort_order, is_active,
        mobile_visibility, mobile_title, mobile_suggested_amounts,
        mobile_min_amount_cents, mobile_max_amount_cents,
        mobile_published_at)
     values ($1, $2, $3, $4, 0, $5, $6, $7, $8, $9, $10,
             case when $6 = 'none' then null else now() end)`,
    [
      fundId,
      fixture.churchId,
      options.name ?? "General",
      `fund-${fundId.slice(0, 8)}`,
      options.active ?? true,
      options.visibility ?? "public",
      options.title ?? null,
      options.suggested ?? [2500, 5000],
      options.min ?? 100,
      options.max ?? 500000,
    ],
  );
  return fundId;
}

async function claim(
  client: Client,
  input: {
    accountId: string;
    fixture: Fixture;
    fundId: string;
    attemptId: string;
    amountCents?: number;
  },
): Promise<Record<string, unknown>> {
  const { rows } = await client.query(
    `select * from public.claim_giving_attempt($1, $2, $3, $4, $5)`,
    [
      input.accountId,
      input.fixture.churchId,
      input.fundId,
      input.attemptId,
      input.amountCents ?? 5000,
    ],
  );
  return rows[0];
}

/** Stands in for the Stripe webhook, which is the only writer of these states. */
async function webhookSays(
  client: Client,
  intentId: string,
  status: string,
  donationId: string | null = null,
  eventAt: string | null = null,
): Promise<Record<string, unknown>> {
  const { rows } = await client.query(
    `select * from public.project_giving_attempt_state($1, $2, $3, coalesce($4::timestamptz, now()))`,
    [intentId, status, donationId, eventAt],
  );
  return rows[0];
}

async function seedDonation(
  client: Client,
  fixture: Fixture,
  input: { intentId: string; amountCents?: number; status?: string; fundId?: string },
): Promise<string> {
  const donationId = randomUUID();
  await client.query(
    `insert into public.giving_donations
       (id, church_id, stripe_payment_intent_id, amount_cents, currency, status, gift_type, fund_id)
     values ($1, $2, $3, $4, 'usd', $5, 'one_time', $6)`,
    [
      donationId,
      fixture.churchId,
      input.intentId,
      input.amountCents ?? 5000,
      input.status ?? "succeeded",
      input.fundId ?? null,
    ],
  );
  return donationId;
}

const options = DATABASE_URL ? {} : { skip: SKIP_REASON };

// ---------------------------------------------------------------------------
// What a visitor may see
// ---------------------------------------------------------------------------

test("an unpublished fund is invisible, however active it is", options,
  run(1, async ([client], track) => {
    const fixture = await seedChurch(client);
    track(fixture);
    await seedFund(client, fixture, { visibility: "none" });

    const { rows } = await client.query(
      `select count(*)::int as n from public.mobile_giving_funds($1, 'joined')`,
      [fixture.slug],
    );
    assert.equal(rows[0].n, 0, "an unpublished fund reached a visitor");
  }));

test("an inactive fund is invisible even when published", options,
  run(1, async ([client], track) => {
    const fixture = await seedChurch(client);
    track(fixture);
    await seedFund(client, fixture, { visibility: "public", active: false });

    const { rows } = await client.query(
      `select count(*)::int as n from public.mobile_giving_funds($1, 'joined')`,
      [fixture.slug],
    );
    assert.equal(rows[0].n, 0);
  }));

test("a church that cannot charge shows no funds at all", options,
  run(1, async ([client], track) => {
    // Showing a Give button to a congregation whose church cannot take money is
    // worse than showing nothing: it reads as the church losing their gift.
    const fixture = await seedChurch(client, { chargesEnabled: false });
    track(fixture);
    await seedFund(client, fixture, { visibility: "public" });

    const { rows } = await client.query(
      `select count(*)::int as n from public.mobile_giving_funds($1, 'joined')`,
      [fixture.slug],
    );
    assert.equal(rows[0].n, 0);

    // And the same fund appears the moment Stripe is ready.
    await client.query(
      `update public.churches set stripe_charges_enabled = true where id = $1`,
      [fixture.churchId],
    );
    const after = await client.query(
      `select count(*)::int as n from public.mobile_giving_funds($1, 'joined')`,
      [fixture.slug],
    );
    assert.equal(after.rows[0].n, 1);
  }));

test("a church with no connected account shows no funds", options,
  run(1, async ([client], track) => {
    const fixture = await seedChurch(client, { connected: false, chargesEnabled: true });
    track(fixture);
    await seedFund(client, fixture, { visibility: "public" });

    const { rows } = await client.query(
      `select count(*)::int as n from public.mobile_giving_funds($1, 'joined')`,
      [fixture.slug],
    );
    assert.equal(rows[0].n, 0);
  }));

test("relationship visibility is honoured, and blocked sees nothing", options,
  run(1, async ([client], track) => {
    const fixture = await seedChurch(client);
    track(fixture);
    await seedFund(client, fixture, { name: "Everyone", visibility: "public" });
    await seedFund(client, fixture, { name: "Followers", visibility: "followers" });
    await seedFund(client, fixture, { name: "Members", visibility: "members" });

    const counts: Record<string, number> = {};
    for (const state of ["none", "following", "joined", "blocked"]) {
      const { rows } = await client.query(
        `select count(*)::int as n from public.mobile_giving_funds($1, $2)`,
        [fixture.slug, state],
      );
      counts[state] = rows[0].n as number;
    }

    assert.equal(counts.none, 1, "a stranger saw a restricted fund");
    assert.equal(counts.following, 2);
    assert.equal(counts.joined, 3);
    // The same answer a blocked caller gets everywhere: nothing, rather than an
    // error that would confirm the block.
    assert.equal(counts.blocked, 0);
  }));

test("the visitor-facing title is used, and falls back to the fund's name", options,
  run(1, async ([client], track) => {
    const fixture = await seedChurch(client);
    track(fixture);
    await seedFund(client, fixture, { name: "GEN-01", title: "Where it's needed most" });
    await seedFund(client, fixture, { name: "Missions", title: null });

    const { rows } = await client.query(
      `select title from public.mobile_giving_funds($1, 'joined') order by title`,
      [fixture.slug],
    );
    const titles = rows.map((row) => row.title);
    assert.deepEqual(titles, ["Missions", "Where it's needed most"]);
    // The internal code never reaches a phone.
    assert.ok(!titles.includes("GEN-01"));
  }));

test("one church's funds never appear for another", options,
  run(1, async ([client], track) => {
    const one = await seedChurch(client);
    const two = await seedChurch(client);
    track(one);
    track(two);
    await seedFund(client, one, { name: "One" });
    await seedFund(client, two, { name: "Two" });

    const { rows } = await client.query(
      `select title from public.mobile_giving_funds($1, 'joined')`,
      [one.slug],
    );
    assert.deepEqual(rows.map((row) => row.title), ["One"]);
  }));

// ---------------------------------------------------------------------------
// One logical attempt, one charge
// ---------------------------------------------------------------------------

test("the same client attempt id never becomes two attempts", options,
  run(1, async ([client], track) => {
    const fixture = await seedChurch(client);
    track(fixture);
    const accountId = await seedAccount(client);
    const fundId = await seedFund(client, fixture);
    const attemptId = "attempt-aaaaaaaa";

    const first = await claim(client, { accountId, fixture, fundId, attemptId });
    const second = await claim(client, { accountId, fixture, fundId, attemptId });
    const third = await claim(client, { accountId, fixture, fundId, attemptId });

    assert.equal(first.ok, true);
    assert.equal(first.created, true);
    assert.equal(second.created, false, "a retry created a second attempt");
    assert.equal(third.created, false);
    assert.equal(second.attempt_id, first.attempt_id);
    assert.equal(third.attempt_id, first.attempt_id);

    const { rows } = await client.query(
      `select count(*)::int as n from public.giving_donation_attempts where account_id = $1`,
      [accountId],
    );
    assert.equal(rows[0].n, 1);
  }));

test("two concurrent claims of one attempt produce one row", options,
  run(2, async ([a, b], track) => {
    const fixture = await seedChurch(a);
    track(fixture);
    const accountId = await seedAccount(a);
    const fundId = await seedFund(a, fixture);
    const attemptId = "attempt-bbbbbbbb";

    // A double tap, or a retry racing the original. `on conflict do nothing`
    // plus a read is what makes the loser reuse rather than create.
    const [first, second] = await Promise.all([
      claim(a, { accountId, fixture, fundId, attemptId }),
      claim(b, { accountId, fixture, fundId, attemptId }),
    ]);

    assert.equal(first.ok, true);
    assert.equal(second.ok, true);
    assert.equal(first.attempt_id, second.attempt_id);
    assert.equal(
      [first.created, second.created].filter(Boolean).length,
      1,
      "both claims believed they created the attempt",
    );
  }));

test("the idempotency key is derived by the server, not chosen by a client", options,
  run(1, async ([client], track) => {
    const fixture = await seedChurch(client);
    track(fixture);
    const accountId = await seedAccount(client);
    const fundId = await seedFund(client, fixture);

    const first = await claim(client, { accountId, fixture, fundId, attemptId: "attempt-cccccccc" });
    const second = await claim(client, { accountId, fixture, fundId, attemptId: "attempt-dddddddd" });

    // Two attempts, two keys — a client cannot make them share one.
    assert.notEqual(first.stripe_idempotency_key, second.stripe_idempotency_key);
    assert.match(String(first.stripe_idempotency_key), /^ffg_[0-9a-f]{32}$/);

    // And one attempt keeps its key across retries, so a Stripe-level retry
    // returns the first intent rather than creating a second.
    const retry = await claim(client, { accountId, fixture, fundId, attemptId: "attempt-cccccccc" });
    assert.equal(retry.stripe_idempotency_key, first.stripe_idempotency_key);
  }));

test("a payment intent attaches once and cannot be repointed", options,
  run(1, async ([client], track) => {
    const fixture = await seedChurch(client);
    track(fixture);
    const accountId = await seedAccount(client);
    const fundId = await seedFund(client, fixture);
    const claimed = await claim(client, { accountId, fixture, fundId, attemptId: "attempt-eeeeeeee" });

    const first = await client.query(
      `select * from public.attach_giving_payment_intent($1, $2, $3)`,
      [claimed.attempt_id, accountId, "pi_first"],
    );
    assert.equal(first.rows[0].payment_intent_id, "pi_first");

    // Even a bug that created a second intent cannot silently repoint the
    // attempt at it — which would strand the first charge with nothing tracking
    // it.
    const second = await client.query(
      `select * from public.attach_giving_payment_intent($1, $2, $3)`,
      [claimed.attempt_id, accountId, "pi_second"],
    );
    assert.equal(second.rows[0].payment_intent_id, "pi_first");
  }));

test("another account cannot attach an intent to someone else's attempt", options,
  run(1, async ([client], track) => {
    const fixture = await seedChurch(client);
    track(fixture);
    const mine = await seedAccount(client);
    const theirs = await seedAccount(client);
    const fundId = await seedFund(client, fixture);
    const claimed = await claim(client, { accountId: mine, fixture, fundId, attemptId: "attempt-ffffffff" });

    const { rows } = await client.query(
      `select * from public.attach_giving_payment_intent($1, $2, $3)`,
      [claimed.attempt_id, theirs, "pi_stolen"],
    );
    assert.equal(rows[0].ok, false);
  }));

// ---------------------------------------------------------------------------
// What a client cannot ask for
// ---------------------------------------------------------------------------

test("a fund from another church is refused, not charged", options,
  run(1, async ([client], track) => {
    const one = await seedChurch(client);
    const two = await seedChurch(client);
    track(one);
    track(two);
    const accountId = await seedAccount(client);
    const theirFund = await seedFund(client, two);

    const result = await claim(client, {
      accountId,
      fixture: one,
      fundId: theirFund,
      attemptId: "attempt-11111111",
    });
    assert.equal(result.ok, false);
    assert.equal(result.reason, "fund_not_found");
  }));

test("an unpublished or inactive fund cannot be given to", options,
  run(1, async ([client], track) => {
    const fixture = await seedChurch(client);
    track(fixture);
    const accountId = await seedAccount(client);
    const unpublished = await seedFund(client, fixture, { visibility: "none" });
    const inactive = await seedFund(client, fixture, { active: false });

    const a = await claim(client, { accountId, fixture, fundId: unpublished, attemptId: "attempt-22222222" });
    assert.equal(a.reason, "fund_not_published");

    const b = await claim(client, { accountId, fixture, fundId: inactive, attemptId: "attempt-33333333" });
    assert.equal(b.reason, "fund_inactive");
  }));

test("an amount outside the fund's bounds is refused", options,
  run(1, async ([client], track) => {
    const fixture = await seedChurch(client);
    track(fixture);
    const accountId = await seedAccount(client);
    const fundId = await seedFund(client, fixture, { min: 500, max: 20000 });

    for (const [amount, label] of [[100, "below"], [50000, "above"]] as [number, string][]) {
      const result = await claim(client, {
        accountId,
        fixture,
        fundId,
        attemptId: `attempt-4444444${label[0]}`,
        amountCents: amount,
      });
      assert.equal(result.ok, false, label);
      assert.equal(result.reason, "amount_out_of_range");
    }

    // The bounds themselves are inside.
    const ok = await claim(client, {
      accountId, fixture, fundId, attemptId: "attempt-55555555", amountCents: 500,
    });
    assert.equal(ok.ok, true);
  }));

test("an attempt id cannot be re-aimed at another church", options,
  run(1, async ([client], track) => {
    const one = await seedChurch(client);
    const two = await seedChurch(client);
    track(one);
    track(two);
    const accountId = await seedAccount(client);
    const fundOne = await seedFund(client, one);
    const fundTwo = await seedFund(client, two);

    await claim(client, { accountId, fixture: one, fundId: fundOne, attemptId: "attempt-66666666" });
    const reaimed = await claim(client, {
      accountId, fixture: two, fundId: fundTwo, attemptId: "attempt-66666666",
    });

    // Either a client bug or an attempt to read across a tenant boundary.
    // Neither deserves a payment intent.
    assert.equal(reaimed.ok, false);
    assert.equal(reaimed.reason, "attempt_church_mismatch");
  }));

test("a retry succeeds even after the church unpublishes the fund", options,
  run(1, async ([client], track) => {
    // The money may already be moving. Refusing a retry here would strand a
    // person mid-payment with no way to find out what happened.
    const fixture = await seedChurch(client);
    track(fixture);
    const accountId = await seedAccount(client);
    const fundId = await seedFund(client, fixture);
    await claim(client, { accountId, fixture, fundId, attemptId: "attempt-77777777" });

    await client.query(
      `update public.giving_funds set mobile_visibility = 'none' where id = $1`,
      [fundId],
    );

    const retry = await claim(client, { accountId, fixture, fundId, attemptId: "attempt-77777777" });
    assert.equal(retry.ok, true);
    assert.equal(retry.reason, "existing");

    // But a *new* attempt is refused, because the fund really is unpublished.
    const fresh = await claim(client, { accountId, fixture, fundId, attemptId: "attempt-88888888" });
    assert.equal(fresh.ok, false);
    assert.equal(fresh.reason, "fund_not_published");
  }));

// ---------------------------------------------------------------------------
// Only the webhook decides what happened
// ---------------------------------------------------------------------------

test("an attempt starts initiated and stays there until a webhook says otherwise", options,
  run(1, async ([client], track) => {
    const fixture = await seedChurch(client);
    track(fixture);
    const accountId = await seedAccount(client);
    const fundId = await seedFund(client, fixture);
    const claimed = await claim(client, { accountId, fixture, fundId, attemptId: "attempt-99999999" });

    assert.equal(claimed.status, "initiated");

    const { rows } = await client.query(
      `select status, receipt_available from public.mobile_giving_history($1, $2, 25, null)`,
      [accountId, fixture.slug],
    );
    assert.equal(rows[0].status, "initiated");
    // **No receipt.** A payment sheet closing changes nothing here.
    assert.equal(rows[0].receipt_available, false);
  }));

test("a receipt exists only after a webhook confirms a succeeded donation", options,
  run(1, async ([client], track) => {
    const fixture = await seedChurch(client);
    track(fixture);
    const accountId = await seedAccount(client);
    const fundId = await seedFund(client, fixture);
    const claimed = await claim(client, { accountId, fixture, fundId, attemptId: "attempt-abababab" });
    await client.query(`select * from public.attach_giving_payment_intent($1, $2, 'pi_receipt')`, [
      claimed.attempt_id, accountId,
    ]);

    // Before: nothing.
    const before = await client.query(
      `select count(*)::int as n from public.mobile_giving_receipt($1, $2, $3)`,
      [accountId, fixture.slug, claimed.attempt_id],
    );
    assert.equal(before.rows[0].n, 0);

    const donationId = await seedDonation(client, fixture, { intentId: "pi_receipt", fundId });
    await webhookSays(client, "pi_receipt", "succeeded", donationId);

    const after = await client.query(
      `select * from public.mobile_giving_receipt($1, $2, $3)`,
      [accountId, fixture.slug, claimed.attempt_id],
    );
    assert.equal(after.rows.length, 1);
    assert.equal(after.rows[0].amount_cents, 5000);
    assert.equal(after.rows[0].church_name, "Giving Test Church");
  }));

test("a processing gift has no receipt", options,
  run(1, async ([client], track) => {
    const fixture = await seedChurch(client);
    track(fixture);
    const accountId = await seedAccount(client);
    const fundId = await seedFund(client, fixture);
    const claimed = await claim(client, { accountId, fixture, fundId, attemptId: "attempt-cdcdcdcd" });
    await client.query(`select * from public.attach_giving_payment_intent($1, $2, 'pi_processing')`, [
      claimed.attempt_id, accountId,
    ]);
    await webhookSays(client, "pi_processing", "processing");

    const { rows } = await client.query(
      `select count(*)::int as n from public.mobile_giving_receipt($1, $2, $3)`,
      [accountId, fixture.slug, claimed.attempt_id],
    );
    assert.equal(rows[0].n, 0);
  }));

test("a refund and a dispute cannot be forged, and only the webhook writes them", options,
  run(1, async ([client], track) => {
    const fixture = await seedChurch(client);
    track(fixture);
    const accountId = await seedAccount(client);
    const fundId = await seedFund(client, fixture);
    const claimed = await claim(client, { accountId, fixture, fundId, attemptId: "attempt-efefefef" });
    await client.query(`select * from public.attach_giving_payment_intent($1, $2, 'pi_refund')`, [
      claimed.attempt_id, accountId,
    ]);

    // A status the state machine does not define is refused outright.
    const bogus = await webhookSays(client, "pi_refund", "totally_paid");
    assert.equal(bogus.ok, false);

    const refunded = await webhookSays(client, "pi_refund", "refunded");
    assert.equal(refunded.status, "refunded");

    const disputed = await webhookSays(client, "pi_refund", "disputed");
    assert.equal(disputed.status, "disputed");
  }));

test("a late webhook cannot overwrite a later state", options,
  run(1, async ([client], track) => {
    // Stripe really does deliver out of order. A `payment_intent.processing`
    // arriving after `succeeded` must not walk a confirmed gift backwards.
    const fixture = await seedChurch(client);
    track(fixture);
    const accountId = await seedAccount(client);
    const fundId = await seedFund(client, fixture);
    const claimed = await claim(client, { accountId, fixture, fundId, attemptId: "attempt-01010101" });
    await client.query(`select * from public.attach_giving_payment_intent($1, $2, 'pi_ordered')`, [
      claimed.attempt_id, accountId,
    ]);

    const later = new Date(Date.now()).toISOString();
    const earlier = new Date(Date.now() - 60_000).toISOString();

    await webhookSays(client, "pi_ordered", "succeeded", null, later);
    const stale = await webhookSays(client, "pi_ordered", "processing", null, earlier);
    assert.equal(stale.ok, false, "a late event moved a confirmed gift");

    const { rows } = await client.query(
      `select status from public.giving_donation_attempts where id = $1`,
      [claimed.attempt_id],
    );
    assert.equal(rows[0].status, "succeeded");
  }));

test("a webhook replay is idempotent", options,
  run(1, async ([client], track) => {
    const fixture = await seedChurch(client);
    track(fixture);
    const accountId = await seedAccount(client);
    const fundId = await seedFund(client, fixture);
    const claimed = await claim(client, { accountId, fixture, fundId, attemptId: "attempt-02020202" });
    await client.query(`select * from public.attach_giving_payment_intent($1, $2, 'pi_replay')`, [
      claimed.attempt_id, accountId,
    ]);
    const donationId = await seedDonation(client, fixture, { intentId: "pi_replay", fundId });

    const at = new Date().toISOString();
    for (let index = 0; index < 5; index += 1) {
      await webhookSays(client, "pi_replay", "succeeded", donationId, at);
    }

    const { rows } = await client.query(
      `select count(*)::int as n from public.mobile_giving_history($1, $2, 25, null)`,
      [accountId, fixture.slug],
    );
    // Five deliveries, one gift.
    assert.equal(rows[0].n, 1);
  }));

test("a webhook for an intent nobody claimed changes nothing", options,
  run(1, async ([client], track) => {
    const fixture = await seedChurch(client);
    track(fixture);
    // The web giving flow creates intents with no Faithful attempt behind them.
    // Those must reconcile into `giving_donations` and touch nothing here.
    const result = await webhookSays(client, "pi_from_the_website", "succeeded");
    assert.equal(result.ok, false);
  }));

// ---------------------------------------------------------------------------
// Nobody sees anybody else's giving
// ---------------------------------------------------------------------------

test("one donor's history never includes another's", options,
  run(1, async ([client], track) => {
    const fixture = await seedChurch(client);
    track(fixture);
    const mine = await seedAccount(client);
    const theirs = await seedAccount(client);
    const fundId = await seedFund(client, fixture);

    await claim(client, { accountId: mine, fixture, fundId, attemptId: "attempt-mine0001", amountCents: 1000 });
    await claim(client, { accountId: theirs, fixture, fundId, attemptId: "attempt-thrs0001", amountCents: 9900 });

    const { rows } = await client.query(
      `select amount_cents from public.mobile_giving_history($1, $2, 25, null)`,
      [mine, fixture.slug],
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0].amount_cents, 1000);
  }));

test("a donor's history at one church never includes another church's", options,
  run(1, async ([client], track) => {
    const one = await seedChurch(client);
    const two = await seedChurch(client);
    track(one);
    track(two);
    const accountId = await seedAccount(client);
    const fundOne = await seedFund(client, one);
    const fundTwo = await seedFund(client, two);

    await claim(client, { accountId, fixture: one, fundId: fundOne, attemptId: "attempt-ch1", amountCents: 1000 });
    await claim(client, { accountId, fixture: two, fundId: fundTwo, attemptId: "attempt-ch2", amountCents: 2000 });

    const { rows } = await client.query(
      `select amount_cents from public.mobile_giving_history($1, $2, 25, null)`,
      [accountId, one.slug],
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0].amount_cents, 1000);
  }));

test("a receipt cannot be fetched by another donor or from another church", options,
  run(1, async ([client], track) => {
    const one = await seedChurch(client);
    const two = await seedChurch(client);
    track(one);
    track(two);
    const mine = await seedAccount(client);
    const theirs = await seedAccount(client);
    const fundId = await seedFund(client, one);
    const claimed = await claim(client, { accountId: mine, fixture: one, fundId, attemptId: "attempt-rcpt0001" });
    await client.query(`select * from public.attach_giving_payment_intent($1, $2, 'pi_isolated')`, [
      claimed.attempt_id, mine,
    ]);
    const donationId = await seedDonation(client, one, { intentId: "pi_isolated", fundId });
    await webhookSays(client, "pi_isolated", "succeeded", donationId);

    // Mine works.
    const ok = await client.query(
      `select count(*)::int as n from public.mobile_giving_receipt($1, $2, $3)`,
      [mine, one.slug, claimed.attempt_id],
    );
    assert.equal(ok.rows[0].n, 1);

    // Another donor, holding the exact attempt id, gets nothing.
    const otherDonor = await client.query(
      `select count(*)::int as n from public.mobile_giving_receipt($1, $2, $3)`,
      [theirs, one.slug, claimed.attempt_id],
    );
    assert.equal(otherDonor.rows[0].n, 0);

    // And the right donor at the wrong church gets nothing.
    const otherChurch = await client.query(
      `select count(*)::int as n from public.mobile_giving_receipt($1, $2, $3)`,
      [mine, two.slug, claimed.attempt_id],
    );
    assert.equal(otherChurch.rows[0].n, 0);
  }));

test("the history projection returns nothing that identifies a donor or a provider", options,
  run(1, async ([client], track) => {
    const fixture = await seedChurch(client);
    track(fixture);
    const accountId = await seedAccount(client);
    const fundId = await seedFund(client, fixture);
    const claimed = await claim(client, { accountId, fixture, fundId, attemptId: "attempt-privacy1" });
    await client.query(`select * from public.attach_giving_payment_intent($1, $2, 'pi_private')`, [
      claimed.attempt_id, accountId,
    ]);
    const donationId = await seedDonation(client, fixture, { intentId: "pi_private", fundId });
    await client.query(
      `update public.giving_donations
          set donor_email = 'someone@example.test', stripe_fee_cents = 175,
              net_amount_cents = 4825, stripe_charge_id = 'ch_secret'
        where id = $1`,
      [donationId],
    );
    await webhookSays(client, "pi_private", "succeeded", donationId);

    const { rows } = await client.query(
      `select * from public.mobile_giving_history($1, $2, 25, null)`,
      [accountId, fixture.slug],
    );
    const columns = Object.keys(rows[0]).join(" ");
    for (const leak of ["email", "stripe", "fee", "net", "customer", "secret", "charge"]) {
      assert.ok(!columns.includes(leak), `the history projection exposes ${leak}`);
    }
    const serialised = JSON.stringify(rows[0]);
    assert.ok(!serialised.includes("someone@example.test"));
    assert.ok(!serialised.includes("ch_secret"));
  }));

// ---------------------------------------------------------------------------
// The account-to-donor link is explicit, never inferred
// ---------------------------------------------------------------------------

test("a donor link is only written for a donor of the same church", options,
  run(1, async ([client], track) => {
    const one = await seedChurch(client);
    const two = await seedChurch(client);
    track(one);
    track(two);
    const accountId = await seedAccount(client);

    const donorId = randomUUID();
    await client.query(
      `insert into public.giving_donors (id, church_id, email) values ($1, $2, 'a@example.test')`,
      [donorId, two.churchId],
    );

    // The donor belongs to church two; linking it under church one is refused.
    const wrong = await client.query(`select * from public.link_giving_donor($1, $2, $3)`, [
      accountId, one.churchId, donorId,
    ]);
    assert.equal(wrong.rows[0].ok, false);

    const right = await client.query(`select * from public.link_giving_donor($1, $2, $3)`, [
      accountId, two.churchId, donorId,
    ]);
    assert.equal(right.rows[0].ok, true);
  }));

test("the first gift wins the link, and a second gift does not repoint it", options,
  run(1, async ([client], track) => {
    // Two people sharing an inbox is the case this exists for. If a later gift
    // could repoint the link, one of them would inherit the other's history.
    const fixture = await seedChurch(client);
    track(fixture);
    const accountId = await seedAccount(client);

    const first = randomUUID();
    const second = randomUUID();
    for (const [id, email] of [[first, "first@example.test"], [second, "second@example.test"]]) {
      await client.query(
        `insert into public.giving_donors (id, church_id, email) values ($1, $2, $3)`,
        [id, fixture.churchId, email],
      );
    }

    await client.query(`select * from public.link_giving_donor($1, $2, $3)`, [
      accountId, fixture.churchId, first,
    ]);
    const again = await client.query(`select * from public.link_giving_donor($1, $2, $3)`, [
      accountId, fixture.churchId, second,
    ]);
    assert.equal(again.rows[0].donor_id, first);
  }));

// ---------------------------------------------------------------------------
// The rest of giving is untouched
// ---------------------------------------------------------------------------

test("publishing a fund to Faithful changes nothing about the fund itself", options,
  run(1, async ([client], track) => {
    const fixture = await seedChurch(client);
    track(fixture);
    const fundId = await seedFund(client, fixture, { visibility: "none", name: "Building" });

    const before = await client.query(
      `select name, slug, is_active, is_default, sort_order from public.giving_funds where id = $1`,
      [fundId],
    );

    await client.query(
      `update public.giving_funds
          set mobile_visibility = 'public', mobile_title = 'New roof',
              mobile_published_at = now()
        where id = $1`,
      [fundId],
    );

    const after = await client.query(
      `select name, slug, is_active, is_default, sort_order from public.giving_funds where id = $1`,
      [fundId],
    );
    assert.deepEqual(after.rows[0], before.rows[0]);
  }));

test("the publication version moves for a visitor-visible change and not otherwise", options,
  run(1, async ([client], track) => {
    const fixture = await seedChurch(client);
    track(fixture);
    const fundId = await seedFund(client, fixture);

    const read = async () =>
      Number(
        (
          await client.query(
            `select mobile_publication_version as v from public.giving_funds where id = $1`,
            [fundId],
          )
        ).rows[0].v,
      );

    const start = await read();

    // Internal bookkeeping a phone cannot see.
    await client.query(`update public.giving_funds set sort_order = 9 where id = $1`, [fundId]);
    await client.query(`update public.giving_funds set is_default = true where id = $1`, [fundId]);
    assert.equal(await read(), start, "an invisible change invalidated every cached screen");

    // Something a visitor reads.
    await client.query(
      `update public.giving_funds set mobile_title = 'Where it helps most' where id = $1`,
      [fundId],
    );
    assert.ok((await read()) > start, "a visible change did not move the version");
  }));

test("no donation row is created by anything in the giving attempt path", options,
  run(1, async ([client], track) => {
    // The webhook is the only writer of `giving_donations`. If a claim ever
    // wrote one, a phone could report a gift the church never received.
    const fixture = await seedChurch(client);
    track(fixture);
    const accountId = await seedAccount(client);
    const fundId = await seedFund(client, fixture);

    const claimed = await claim(client, { accountId, fixture, fundId, attemptId: "attempt-nodonate" });
    await client.query(`select * from public.attach_giving_payment_intent($1, $2, 'pi_none')`, [
      claimed.attempt_id, accountId,
    ]);

    const { rows } = await client.query(
      `select count(*)::int as n from public.giving_donations where church_id = $1`,
      [fixture.churchId],
    );
    assert.equal(rows[0].n, 0);
  }));
