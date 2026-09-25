import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { normalizeEin } from "@/lib/giving/ein";
import { feeExplanation } from "@/lib/giving/fee-copy";
import {
  depositStatus,
  giftStatus,
  intervalLabel,
  isRefundable,
  recurringStatus,
  requirementTasks,
  UNKNOWN_REQUIREMENT_TASK,
} from "@/lib/giving/labels";
import { detectRangePreset, rangeForPreset, startOfWeek, toDateInput } from "@/lib/giving/periods";
import { recurringErrorMessage, refundErrorMessage } from "@/lib/giving/provider-errors";
import { resolveSetupStep } from "@/lib/giving/setup";
import { sendStatementEmail, statementEmailContent } from "@/lib/giving/statement-email";

const read = (path: string) => readFileSync(path, "utf8");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

// ---------------------------------------------------------------------------
// Plain words for every state
// ---------------------------------------------------------------------------

test("gift statuses are plain words, never the raw value", () => {
  assert.equal(giftStatus("succeeded").label, "Received");
  assert.equal(giftStatus("pending").label, "Pending");
  assert.equal(giftStatus("refunded").label, "Refunded");
  assert.equal(giftStatus("disputed").label, "Questioned by the bank");
  assert.equal(giftStatus("failed").label, "Failed");
  // Something new from the provider is not capitalised and shown.
  assert.equal(giftStatus("requires_capture").label, "Checking");
});

test("recurring gifts use the four canonical states", () => {
  assert.equal(recurringStatus("active").label, "Active");
  assert.equal(recurringStatus("active", "2026-01-01").label, "Paused");
  assert.equal(recurringStatus("paused").label, "Paused");
  assert.equal(recurringStatus("past_due").label, "Payment failed");
  assert.equal(recurringStatus("unpaid").label, "Payment failed");
  assert.equal(recurringStatus("canceled").label, "Cancelled");
  assert.equal(recurringStatus("incomplete_expired").label, "Cancelled");
});

test("intervals read 'Every week', and 'dayly' is gone", () => {
  assert.equal(intervalLabel("day"), "Every day");
  assert.equal(intervalLabel("week"), "Every week");
  assert.equal(intervalLabel("month"), "Every month");
  assert.equal(intervalLabel("year"), "Every year");
  assert.equal(intervalLabel("fortnight"), "Repeats");
  const recurringPage = read("app/dashboard/giving/recurring/page.tsx");
  assert.doesNotMatch(recurringPage, /interval\}ly/);
});

test("deposits say where the money is", () => {
  assert.equal(depositStatus("paid").label, "In your bank");
  assert.equal(depositStatus("in_transit").label, "On the way");
  assert.equal(depositStatus("pending").label, "On the way");
  assert.equal(depositStatus("failed").label, "Failed");
});

test("only a received gift is offered a refund", () => {
  const base = { stripePaymentIntentId: "pi_1" };
  assert.equal(isRefundable({ ...base, status: "succeeded" }), true);
  for (const status of ["pending", "refunded", "disputed", "failed"] as const) {
    assert.equal(isRefundable({ ...base, status }), false, status);
  }
  assert.equal(isRefundable({ status: "succeeded", stripePaymentIntentId: null }), false);
});

test("the payment partner's requirement keys become plain tasks", () => {
  assert.deepEqual(
    requirementTasks([
      "external_account",
      "individual.verification.document",
      "individual.dob.day",
      "company.address.line1",
      "company.address.city",
      "tos_acceptance.date",
      "company.tax_id",
    ]),
    [
      "Add your bank account",
      "Confirm your identity",
      "Add your church's address",
      "Accept the payment terms",
      "Add your church's tax ID (EIN)",
    ],
  );
  assert.deepEqual(requirementTasks(["person_1AbC.verification.document"]), ["Confirm your identity"]);
  assert.deepEqual(requirementTasks(["something.new_from_provider"]), [UNKNOWN_REQUIREMENT_TASK]);
  assert.deepEqual(requirementTasks([]), []);
  // No task ever shows the raw key.
  for (const task of requirementTasks(["representative.address.postal_code", "business_profile.mcc"])) {
    assert.doesNotMatch(task, /[._]/);
  }
});

// ---------------------------------------------------------------------------
// Dates, tax ID, fees, setup
// ---------------------------------------------------------------------------

test("a church week starts on Sunday", () => {
  // Thursday 24 September 2026 → Sunday 20 September.
  assert.equal(toDateInput(startOfWeek(new Date(2026, 8, 24, 15))), "2026-09-20");
  // A Sunday is its own week start.
  assert.equal(toDateInput(startOfWeek(new Date(2026, 8, 20, 9))), "2026-09-20");
  // Early January can start last year.
  assert.equal(toDateInput(startOfWeek(new Date(2027, 0, 2))), "2026-12-27");
});

test("range chips produce, and recognise, the same dates", () => {
  const now = new Date(2026, 8, 24);
  assert.deepEqual(rangeForPreset("week", now), { dateFrom: "2026-09-20", dateTo: "2026-09-24" });
  assert.deepEqual(rangeForPreset("month", now), { dateFrom: "2026-09-01", dateTo: "2026-09-24" });
  assert.deepEqual(rangeForPreset("year", now), { dateFrom: "2026-01-01", dateTo: "2026-09-24" });
  assert.equal(detectRangePreset("2026-09-01", "2026-09-24", now), "month");
  assert.equal(detectRangePreset("2026-02-01", "2026-03-01", now), "custom");
  assert.equal(detectRangePreset(null, null, now), null);
});

test("a tax ID is nine digits, stored as 12-3456789", () => {
  assert.deepEqual(normalizeEin("123456789"), { ok: true, value: "12-3456789" });
  assert.deepEqual(normalizeEin(" 12 3456789 "), { ok: true, value: "12-3456789" });
  assert.deepEqual(normalizeEin("12-3456789"), { ok: true, value: "12-3456789" });
  assert.deepEqual(normalizeEin(""), { ok: true, value: null });
  assert.equal(normalizeEin("12345").ok, false);
  assert.equal(normalizeEin("12-345678A").ok, false);
});

test("fee copy is accurate: fees come out of gifts, and the nonprofit rate needs approval", () => {
  const copy = feeExplanation(0);
  const all = [copy.summary, ...copy.details].join(" ");
  assert.doesNotMatch(all, /donors pay .* only/i);
  assert.match(all, /comes out of each gift/);
  assert.match(all, /approved/);
  assert.match(all, /2\.2% \+ 30¢/);
  assert.match(copy.summary, /doesn't take any part/);
  assert.match(feeExplanation(50).summary, /keeps \$0\.50/);
  // The old claim is gone from the giving surfaces.
  // (give-page-header.tsx belongs to the public give page, which is out of scope here.)
  for (const path of walk("components/giving").filter((p) => !p.endsWith("give-page-header.tsx"))) {
    assert.doesNotMatch(read(path), /STRIPE_NONPROFIT_RATE_LABEL|IRS Form 990/, path);
  }
});

test("setup shows the right step, and never the later steps before the bank is connected", () => {
  const base = { chargesEnabled: false, hasEin: false, hasAccount: false };
  assert.equal(resolveSetupStep({ ...base, requested: null }), "details");
  assert.equal(resolveSetupStep({ ...base, hasEin: true, requested: null }), "connect");
  assert.equal(resolveSetupStep({ ...base, hasAccount: true, requested: null }), "connect");
  assert.equal(resolveSetupStep({ ...base, requested: "connect" }), "connect");
  assert.equal(resolveSetupStep({ ...base, requested: "funds" }), "details");
  assert.equal(resolveSetupStep({ ...base, requested: "ready" }), "details");
  const live = { chargesEnabled: true, hasEin: true, hasAccount: true };
  assert.equal(resolveSetupStep({ ...live, requested: null }), null);
  assert.equal(resolveSetupStep({ ...live, requested: "funds" }), "funds");
  assert.equal(resolveSetupStep({ ...live, requested: "ready" }), "ready");
  assert.equal(resolveSetupStep({ ...live, requested: "details" }), null);
});

// ---------------------------------------------------------------------------
// Errors and destructive actions
// ---------------------------------------------------------------------------

test("provider errors become sentences, never the provider's own text", () => {
  const raw = Object.assign(new Error("No such payment_intent: 'pi_123'"), {
    type: "StripeInvalidRequestError",
    code: "resource_missing",
  });
  for (const message of [
    refundErrorMessage(raw),
    recurringErrorMessage("pause", raw),
    recurringErrorMessage("cancel", new Error("boom")),
  ]) {
    assert.doesNotMatch(message, /pi_123|payment_intent|boom|Stripe/);
  }
  assert.match(refundErrorMessage({ code: "charge_already_refunded" }), /already been refunded/);
  assert.match(refundErrorMessage(new Error("x")), /Nothing was refunded/);

  for (const path of [
    "app/api/dashboard/giving/refund/route.ts",
    "app/api/dashboard/giving/subscriptions/[id]/route.ts",
  ]) {
    const source = read(path);
    assert.doesNotMatch(source, /err\.message/, path);
    assert.doesNotMatch(source, /json\(\{ error: message \}/, path);
    // Auth and the feature gate are unchanged.
    assert.match(source, /await requireChurchAdmin\(\)/, path);
    assert.match(source, /featureAccessDenied\("giving"\)/, path);
  }
});

test("giving settings actions never return raw error text, and keep their admin guard", () => {
  const actions = read("app/dashboard/settings/giving-actions.ts");
  assert.doesNotMatch(actions, /error: [a-zA-Z]*[eE]rror\.message/);
  assert.doesNotMatch(actions, /"Forbidden"/);
  const guards = actions.match(/if \(!auth\.isAdmin\)/g) ?? [];
  assert.ok(guards.length >= 10, "every giving settings action checks for an admin");
  // Every write stays scoped to the caller's church.
  assert.doesNotMatch(actions, /\.from\("giving_funds"\)\s*\.update\([^)]*\)\s*\.eq\("id", fundId\);/);
});

test("no window.confirm or window.prompt anywhere in Giving", () => {
  for (const path of [...walk("components/giving"), ...walk("app/dashboard/giving")]) {
    const source = read(path);
    assert.doesNotMatch(source, /window\.(confirm|prompt)\(/, path);
  }
  assert.match(read("components/giving/recurring-actions.tsx"), /confirmAction\(/);
  assert.match(read("components/giving/funds-settings.tsx"), /confirmAction\(/);
  assert.match(read("components/giving/statement-emailer.tsx"), /confirmAction\(/);
  // Recurring actions read the answer and refresh instead of reloading the page.
  const recurring = read("components/giving/recurring-actions.tsx");
  assert.doesNotMatch(recurring, /location\.reload/);
  assert.match(recurring, /router\.refresh\(\)/);
  assert.match(recurring, /res\.ok/);
});

test("the refund confirmation names the amount and donor, and is only for received gifts", () => {
  const refund = read("components/giving/refund-button.tsx");
  assert.match(refund, /Refund \{amount\} to \{donor\}\?/);
  assert.match(refund, /can&apos;t be undone/);
  assert.match(refund, />\s*\{pending && [^}]*\}\s*Refund \{amount\}/);
  assert.match(refund, /if \(!isRefundable\(donation\)\) return null;/);
  assert.match(read("components/giving/gifts-table.tsx"), /isRefundable\(d\)/);
});

test("a deposits load failure is an error, not 'No deposits yet'", () => {
  const page = read("app/dashboard/giving/payouts/page.tsx");
  assert.match(page, /payouts === null \?/);
  assert.match(page, /<ErrorState/);
});

// ---------------------------------------------------------------------------
// The bank connection returns to Giving
// ---------------------------------------------------------------------------

test("onboarding returns to the Giving page, which refreshes the connection", () => {
  const connect = read("lib/stripe/connect.ts");
  assert.match(connect, /refresh_url: `\$\{base\}\/dashboard\/giving\?stripe_refresh=1`/);
  assert.match(connect, /return_url: `\$\{base\}\/dashboard\/giving\?stripe_return=1`/);
  assert.doesNotMatch(connect, /settings\?tab=giving/);
  const page = read("app/dashboard/giving/page.tsx");
  assert.match(page, /stripe_return/);
  assert.match(read("components/giving/stripe-return.tsx"), /syncStripeAccountStatus\(\)/);
  // An old link that still lands on Settings is passed on to Giving.
  const settingsPage = read("app/dashboard/settings/page.tsx");
  assert.match(settingsPage, /redirect\("\/dashboard\/giving\?stripe_return=1"\)/);
  assert.match(settingsPage, /redirect\("\/dashboard\/giving\?stripe_refresh=1"\)/);
});

// ---------------------------------------------------------------------------
// Year-end statement emails
// ---------------------------------------------------------------------------

const statementInput = {
  donorEmail: "maria@example.com",
  donorName: "Maria Lopez",
  churchName: "Grace Church",
  churchSlug: "grace",
  primaryColor: null,
  accentColor: null,
  logoUrl: null,
  year: 2026,
  totalCents: 125000,
  giftCount: 12,
  pdf: Buffer.from("%PDF-1.4 test"),
  idempotencyKey: "giving-statement/church/2026/donor/run",
};

test("a statement email names the year and total, and makes no tax-deduction claim", () => {
  const content = statementEmailContent(statementInput);
  assert.equal(content.subject, "Your 2026 giving statement from Grace Church");
  assert.match(content.text, /\$1,250\.00/);
  assert.doesNotMatch(content.text.toLowerCase(), /deductible|501\(c\)/);
});

test("statement emails attach the PDF, dedupe retries, and report failures without throwing", async () => {
  const saved = process.env.RESEND_API_KEY;
  try {
    delete process.env.RESEND_API_KEY;
    assert.deepEqual(await sendStatementEmail(statementInput, async () => new Response("{}")), {
      sent: false,
    });

    process.env.RESEND_API_KEY = "re_test";
    let captured: { headers: Record<string, string>; body: Record<string, unknown> } | null = null;
    const ok = await sendStatementEmail(statementInput, async (_url, init) => {
      captured = {
        headers: init?.headers as Record<string, string>,
        body: JSON.parse(String(init?.body)),
      };
      return new Response("{}", { status: 200 });
    });
    assert.deepEqual(ok, { sent: true });
    assert.ok(captured);
    const { headers, body } = captured as { headers: Record<string, string>; body: Record<string, unknown> };
    assert.equal(headers["Idempotency-Key"], statementInput.idempotencyKey);
    const attachments = body.attachments as { filename: string; content: string }[];
    assert.equal(attachments[0].filename, "giving-statement-2026.pdf");
    assert.equal(Buffer.from(attachments[0].content, "base64").toString(), "%PDF-1.4 test");

    assert.deepEqual(
      await sendStatementEmail(statementInput, async () => new Response("", { status: 429 })),
      { sent: false, rateLimited: true },
    );
    assert.deepEqual(
      await sendStatementEmail(statementInput, async () => {
        throw new Error("offline");
      }),
      { sent: false },
    );
  } finally {
    if (saved === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = saved;
  }
});

test("the statement email route is admin-only, gated, church-scoped and batched", () => {
  const route = read("app/api/dashboard/giving/statements/email/route.ts");
  assert.match(route, /await requireChurchAdmin\(\)/);
  assert.match(route, /featureAccessDenied\("giving"\)/);
  assert.match(route, /isChurchFeatureEmailEnabled\(auth\.churchId, "giving"\)/);
  assert.match(route, /\.eq\("church_id", auth\.churchId\)\s*\.in\("id", parsed\.data\.donorIds\)/);
  assert.match(route, /\.max\(MAX_BATCH\)/);
  assert.match(route, /parseStatementYear\(/);
  assert.match(route, /if \(!church\?\.ein\)/);
});

test("statements page keeps the year picker first and the ZIP as a second option", () => {
  const page = read("app/dashboard/giving/statements/page.tsx");
  assert.ok(page.indexOf("<YearPicker") < page.indexOf("<StatementEmailer"));
  assert.match(page, /<GenerateStatementsButton/);
  assert.match(read("components/giving/generate-statements-button.tsx"), /variant="outline"/);
});
