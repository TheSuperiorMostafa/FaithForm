import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join } from "node:path";
import test from "node:test";

/**
 * Forbidden-symbol and privacy sweeps for mobile giving.
 *
 * The strongest guarantees this feature makes are **absences**: no card field of
 * our own, no client that decides an amount, no Stripe payload crossing to a
 * phone, no second payment authority. An absence cannot be asserted by calling
 * something — it is asserted by reading the source that ships.
 */

function walk(root: string, extensions: Set<string>): string[] {
  const out: string[] = [];
  const visit = (path: string) => {
    let entries: string[];
    try {
      entries = readdirSync(path);
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry === "node_modules" || entry === ".build" || entry === "build") continue;
      const full = join(path, entry);
      const stats = statSync(full);
      if (stats.isDirectory()) visit(full);
      else if (extensions.has(extname(full))) out.push(full);
    }
  };
  visit(root);
  return out;
}

function read(path: string): string {
  return readFileSync(path, "utf8");
}

function stripComments(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/\/.*$/gm, "")
    .replace(/\/\/.*$/gm, "");
}

const NATIVE_EXTENSIONS = new Set([".swift", ".kt"]);
const ALL_NATIVE = walk("apps", NATIVE_EXTENSIONS);
const TEST_PATH = /\/(test|Tests|AppTests|androidTest|src\/test)\//;
const PRODUCTION_NATIVE = ALL_NATIVE.filter((file) => !TEST_PATH.test(file));

const SERVER_GIVING_FILES = [
  "lib/giving/v1/giving-service.ts",
  "lib/giving/v1/payment-provider.ts",
  "lib/giving/v1/publication.ts",
  ...walk("app/api/mobile/v1/giving", new Set([".ts"])),
];

// ---------------------------------------------------------------------------
// Non-vacuity
// ---------------------------------------------------------------------------

test("the sweeps inspect a real tree", () => {
  // The guard against every vacuous-green failure mode: if these collapse, every
  // assertion below becomes meaningless and this fails first.
  assert.ok(ALL_NATIVE.length > 60, `walked only ${ALL_NATIVE.length} native files`);
  assert.ok(PRODUCTION_NATIVE.length > 40, `only ${PRODUCTION_NATIVE.length} production files`);
  assert.ok(SERVER_GIVING_FILES.length >= 8, `only ${SERVER_GIVING_FILES.length} server files`);
  for (const anchor of [
    "apps/faithful-ios/Sources/FaithfulKit/Giving/Giving.swift",
    "apps/faithful-android/core/giving/src/main/kotlin/io/faithform/faithful/giving/Giving.kt",
  ]) {
    assert.ok(PRODUCTION_NATIVE.includes(anchor), `${anchor} is not in the swept set`);
  }
});

// ---------------------------------------------------------------------------
// The client never decides the money
// ---------------------------------------------------------------------------

test("a client cannot name a Stripe account, a currency, or a fee", () => {
  // Comments stripped first: the *next* schema's doc comment legitimately
  // explains why `stripeAccountId` is in the response, and a sweep that read it
  // as a request field would fail on prose rather than on code.
  const contract = stripComments(read("lib/mobile/v1/contract.ts"));
  const request = contract.slice(
    contract.indexOf("export const startDonationRequestSchema"),
    contract.indexOf("export const donationSessionSchema"),
  );
  assert.ok(request.length > 100, "the request schema was renamed and this sweep went stale");

  // Four fields, and none of them is money the server should be choosing.
  for (const forbidden of [
    "stripeAccountId",
    "currency",
    "applicationFee",
    "metadata",
    "customerId",
    "donorEmail",
    "receiptEmail",
  ]) {
    assert.ok(!request.includes(forbidden), `a client may send ${forbidden}`);
  }
  for (const required of ["churchSlug", "fundId", "amountCents", "clientAttemptId"]) {
    assert.ok(request.includes(required), `the request lost ${required}`);
  }
});

test("the connected account and the idempotency key are derived server-side", () => {
  const service = stripComments(read("lib/giving/v1/giving-service.ts"));
  // The account comes from the church row, and the key from the attempt row.
  assert.match(service, /resolvedchurch\.stripeAccountId|resolved\.church\.stripeAccountId/i);
  assert.match(service, /claim\.stripe_idempotency_key/);
  // And neither is ever read off the request.
  assert.ok(!/input\.stripeAccountId/.test(service));
  assert.ok(!/input\.idempotencyKey/.test(service));

  const migration = read("supabase/migrations/0063_faithful_giving.sql");
  // Derived in SQL from a value the client never chose.
  assert.match(migration, /'ffg_' \|\| replace\(gen_random_uuid\(\)::text/);
});

test("the amount is bounded in three independent places", () => {
  // The client for the keyboard, the server for the platform, and SQL for the
  // fund. A client that lies gets past none of them.
  const migration = read("supabase/migrations/0063_faithful_giving.sql");
  assert.match(migration, /p_amount_cents < fund\.mobile_min_amount_cents/);
  assert.match(migration, /p_amount_cents > fund\.mobile_max_amount_cents/);

  const service = stripComments(read("lib/giving/v1/giving-service.ts"));
  assert.match(service, /ABSOLUTE_MIN_CENTS/);
  assert.match(service, /ABSOLUTE_MAX_CENTS/);

  for (const native of [
    "apps/faithful-ios/Sources/FaithfulKit/Giving/Giving.swift",
    "apps/faithful-android/core/giving/src/main/kotlin/io/faithform/faithful/giving/Giving.kt",
  ]) {
    assert.match(read(native), /minimumCents|minAmountCents/);
  }
});

// ---------------------------------------------------------------------------
// A payment sheet is not a receipt
// ---------------------------------------------------------------------------

test("no client path can mark a gift succeeded", () => {
  const migration = read("supabase/migrations/0063_faithful_giving.sql");

  // The only writer of a confirmed state is the webhook projection, and it is
  // granted to `service_role` alone.
  assert.match(migration, /create or replace function public\.project_giving_attempt_state/);
  assert.match(
    migration,
    /revoke all on function public\.project_giving_attempt_state[\s\S]{0,200}from public, anon, authenticated/,
  );

  // A receipt requires a succeeded *donation*, not a succeeded attempt alone.
  assert.match(migration, /a\.status = 'succeeded'[\s\S]{0,80}d\.status = 'succeeded'/);

  // And no mobile route writes a status.
  for (const file of walk("app/api/mobile/v1/giving", new Set([".ts"]))) {
    const code = stripComments(read(file));
    assert.ok(!code.includes("project_giving_attempt_state"), `${file} writes a payment state`);
    assert.ok(!code.includes("giving_donations"), `${file} writes a donation`);
  }
});

test("both platforms map a completed sheet to awaiting confirmation", () => {
  // The single most important line on each platform. A version that mapped
  // `completed` to a confirmed state would show a receipt for a gift that could
  // still fail.
  const swift = read("apps/faithful-ios/Sources/FaithfulKit/Giving/Giving.swift");
  assert.match(swift, /case \.completed: return \.awaitingConfirmation\(attempt\)/);

  const kotlin = read(
    "apps/faithful-android/core/giving/src/main/kotlin/io/faithform/faithful/giving/Giving.kt",
  );
  assert.match(kotlin, /SheetOutcome\.COMPLETED -> DonationPhase\.AwaitingConfirmation\(attempt\)/);
});

// ---------------------------------------------------------------------------
// No card data, no second authority
// ---------------------------------------------------------------------------

test("no card number is collected anywhere in the app", () => {
  const forbidden = [
    // iOS
    "STPPaymentCardTextField",
    "STPCardParams",
    "STPPaymentMethodCardParams",
    "cardNumber",
    // Android
    "CardInputWidget",
    "CardMultilineWidget",
    "CardFormView",
    "CardNumberEditText",
    // Both: instrument and bank management, which Faithful does not have.
    "CustomerSheet",
    "FinancialConnections",
    "USBankAccount",
    "STPBankAccount",
  ];
  for (const file of PRODUCTION_NATIVE) {
    const code = stripComments(read(file));
    for (const symbol of forbidden) {
      assert.ok(!code.includes(symbol), `${file} uses ${symbol}`);
    }
  }
});

test("no WebView checkout exists", () => {
  // A payment inside a web view is a payment whose credentials end up in a URL,
  // a cookie jar and a page's history.
  for (const file of PRODUCTION_NATIVE) {
    const code = stripComments(read(file));
    for (const symbol of ["WKWebView", "SFSafariViewController", "WebView", "checkout.stripe.com"]) {
      assert.ok(!code.includes(symbol), `${file} uses ${symbol}`);
    }
  }
});

test("Faithful reuses the existing Stripe authority and creates no second one", () => {
  const provider = stripComments(read("lib/giving/v1/payment-provider.ts"));
  // The platform key, the connected-account call shape and the application fee
  // all come from the modules the web flow already uses.
  assert.match(provider, /from "@\/lib\/stripe\/client"/);
  assert.match(provider, /from "@\/lib\/stripe\/config"/);
  assert.match(provider, /stripeAccount: request\.stripeAccountId/);

  // And no new donation table exists. The projection is `giving_donations`.
  const migration = read("supabase/migrations/0063_faithful_giving.sql");
  // Anchored to the table name itself. `[^;]*` would span from the attempts
  // table's `create` right through its foreign key to `giving_donations` and
  // fail on a reference, which is the opposite of what is being asserted.
  assert.ok(
    !/create table\s+(if not exists\s+)?public\.giving_donations\b/i.test(migration),
    "a second donation table was created",
  );
  assert.match(migration, /create table if not exists public\.giving_donation_attempts/);
});

// ---------------------------------------------------------------------------
// Nothing sensitive crosses to a phone, or into a log
// ---------------------------------------------------------------------------

test("no visitor-facing type carries a donor email, a Stripe id, or a fee", () => {
  const schema = JSON.parse(read("contracts/faithful/v1/schema.json"));
  const visitorFacing = JSON.stringify([
    schema.$defs.GivingFund,
    schema.$defs.GivingHome,
    schema.$defs.DonationStatusResult,
    schema.$defs.GivingHistoryPage,
    schema.$defs.GivingReceipt,
  ]).toLowerCase();

  for (const leak of [
    "donoremail",
    "email",
    "customerid",
    "chargeid",
    "paymentintentid",
    "stripefee",
    "netamount",
    "feecovered",
    "storagepath",
  ]) {
    assert.ok(!visitorFacing.includes(leak), `a visitor-facing type carries ${leak}`);
  }

  // The session is the one type that carries a client secret, and it is
  // never in a list or a history.
  const session = JSON.stringify(schema.$defs.DonationSession).toLowerCase();
  assert.ok(session.includes("clientsecret"));
  assert.ok(!visitorFacing.includes("clientsecret"));
});

test("a receipt makes no tax claim", () => {
  // Nothing in the dashboard records deductibility, a jurisdiction, or an
  // exemption. So the word is "receipt", everywhere.
  const surfaces = [
    "lib/mobile/v1/contract.ts",
    "lib/giving/v1/giving-service.ts",
    "components/giving/faithful-giving-panel.tsx",
    "apps/faithful-ios/Sources/FaithfulKit/Giving/Giving.swift",
    "apps/faithful-android/core/giving/src/main/kotlin/io/faithform/faithful/giving/Giving.kt",
  ];
  for (const file of surfaces) {
    const code = read(file).toLowerCase();
    for (const claim of [
      "tax deductible",
      "tax-deductible",
      "deductible",
      "501(c)",
      "write-off",
      "charitable deduction",
    ]) {
      assert.ok(!code.includes(claim), `${file} makes a tax claim`);
    }
  }
});

test("no fabricated fundraising number exists", () => {
  // No totals, no goals, no donor counts, no progress bars. None of it is
  // supported by canonical data, and all of it would be a number a church would
  // then have to defend.
  const panel = stripComments(read("components/giving/faithful-giving-panel.tsx"));
  for (const symbol of ["goalCents", "raisedCents", "donorCount", "progress", "percentFunded"]) {
    assert.ok(!panel.includes(symbol), `the panel shows ${symbol}`);
  }
  const schema = read("contracts/faithful/v1/schema.json").toLowerCase();
  for (const symbol of ["goalcents", "raisedcents", "donorcount", "totalraised"]) {
    assert.ok(!schema.includes(symbol), `the contract carries ${symbol}`);
  }
});

test("a provider error never reaches a phone or a log", () => {
  const routes = walk("app/api/mobile/v1/giving", new Set([".ts"]));
  for (const file of routes) {
    const code = stripComments(read(file));
    // No Stripe error object, message, decline code or type is ever read.
    for (const leak of ["error.message", "stripeError", "decline_code", "err.raw", "e.message"]) {
      assert.ok(!code.includes(leak), `${file} reads a provider error`);
    }
  }

  const service = stripComments(read("lib/giving/v1/giving-service.ts"));
  // The provider call is wrapped and the caught value is discarded rather than
  // inspected — an error whose message is never read cannot be leaked.
  assert.match(service, /catch \{/);
  assert.ok(!service.includes("catch (error)"), "a provider error is bound and could be logged");
});

test("both platforms redact identifiers before anything is logged", () => {
  for (const [file, symbol] of [
    ["apps/faithful-ios/Sources/FaithfulKit/Giving/Giving.swift", "redactForLog"],
    [
      "apps/faithful-android/core/giving/src/main/kotlin/io/faithform/faithful/giving/Giving.kt",
      "redactForLog",
    ],
  ]) {
    const code = read(file);
    assert.ok(code.includes(symbol), `${file} has no redaction`);
    // Client secrets, intents, accounts and customers are all covered.
    for (const pattern of ["_secret_", "pi_", "acct_", "cus_"]) {
      assert.ok(code.includes(pattern), `${file} does not redact ${pattern}`);
    }
  }
});

test("giving responses are never cached by anything shared", () => {
  // A donation state is the one thing in this API where a stale answer is
  // actively harmful, and a history is not something to leave in a cache.
  for (const file of walk("app/api/mobile/v1/giving", new Set([".ts"]))) {
    const code = read(file);
    if (file.includes("/funds/")) {
      // The fund list is public-ish to a member and revalidates by ETag.
      assert.ok(code.includes("private-revalidate"), `${file} has no cache policy`);
      continue;
    }
    assert.ok(code.includes("private-no-store"), `${file} may be cached`);
  }
});

// ---------------------------------------------------------------------------
// Nothing else moved
// ---------------------------------------------------------------------------

test("the existing web giving flow is untouched", () => {
  // Prompt 11 adds a native path to the same authority. It does not change how
  // the website takes a gift.
  const webIntent = read("app/api/give/create-intent/route.ts");
  assert.match(webIntent, /createConnectedPaymentIntent/);
  assert.ok(!webIntent.includes("claim_giving_attempt"), "the web flow was rerouted");
  assert.ok(!webIntent.includes("giving_donation_attempts"));

  // And the webhook still writes `giving_donations` the way it did.
  const webhooks = read("lib/stripe/webhooks.ts");
  assert.match(webhooks, /async function upsertDonation/);
  assert.match(webhooks, /claimStripeEvent|claim_stripe_webhook_event/);
});

test("the Faithful projection off the webhook cannot fail a church's reconciliation", () => {
  const webhooks = read("lib/stripe/webhooks.ts");
  const projection = webhooks.slice(
    webhooks.indexOf("async function projectFaithfulAttempt"),
    webhooks.indexOf("async function handleSubscription"),
  );
  assert.ok(projection.length > 200, "the projection was renamed and this sweep went stale");
  // Non-fatal on purpose: a failure to update an app's view of an attempt must
  // not fail the webhook and make Stripe redeliver an event that already
  // reconciled the church's financial record correctly.
  assert.match(projection, /catch \{/);
  assert.ok(
    projection.indexOf("await maybeSendDonationReceipt") === -1,
    "the projection runs before the church's own receipt",
  );
});
