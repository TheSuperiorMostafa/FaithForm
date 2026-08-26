package io.faithform.faithful.giving

import io.faithform.faithful.contract.DonationStatus
import io.faithform.faithful.contract.GivingFund

/**
 * Giving, decided on the JVM.
 *
 * Everything that determines what a person is charged, what they are told, and
 * what happens when their phone dies mid-payment is here, where a test can drive
 * it. The Stripe payment sheet is behind [PaymentSheetFacade] and holds no
 * decisions of its own.
 *
 * ## The one rule this file exists to enforce
 *
 * **A payment sheet completing is not a receipt.** The sheet reports that an SDK
 * finished. Only the server, having been told by a verified Stripe webhook, can
 * say a gift happened. [DonationPhase] makes that distinction structural rather
 * than a convention someone can forget.
 */

// ---------------------------------------------------------------------------
// Amounts
// ---------------------------------------------------------------------------

/** Why an amount cannot be given. Each maps to one sentence the person reads. */
enum class AmountProblem { EMPTY, NOT_A_NUMBER, BELOW_MINIMUM, ABOVE_MAXIMUM }

sealed interface AmountResult {
    data class Valid(val cents: Int) : AmountResult
    data class Invalid(val problem: AmountProblem) : AmountResult
}

/**
 * Validates a typed amount against the fund's own bounds.
 *
 * Client-side, and deliberately **not** authoritative: the server re-checks
 * against the same fund row, and the SQL that creates the attempt checks it a
 * third time. This exists so a person is told before they reach a payment sheet,
 * not so the server can trust it.
 *
 * Accepts what a person actually types — a currency symbol, thousands
 * separators, a comma decimal — because rejecting "1,000" as "not a number" is
 * a bug that reads as the app being broken.
 */
fun validateAmount(raw: String, fund: GivingFund): AmountResult {
    val cleaned = raw.trim().removePrefix("$").replace(" ", "")
    if (cleaned.isEmpty()) return AmountResult.Invalid(AmountProblem.EMPTY)

    // A comma is a thousands separator when digits follow in threes, and a
    // decimal separator otherwise. Both are common; guessing wrong charges the
    // wrong amount, so the shape decides rather than a locale assumption.
    val normalised = when {
        cleaned.contains('.') -> cleaned.replace(",", "")
        Regex("^\\d{1,3}(,\\d{3})+$").matches(cleaned) -> cleaned.replace(",", "")
        else -> cleaned.replace(',', '.')
    }

    val value = normalised.toBigDecimalOrNull()
        ?: return AmountResult.Invalid(AmountProblem.NOT_A_NUMBER)
    if (value.signum() <= 0) return AmountResult.Invalid(AmountProblem.NOT_A_NUMBER)

    val cents = value.movePointRight(2).toBigInteger().let {
        if (it > Int.MAX_VALUE.toBigInteger()) Int.MAX_VALUE else it.toInt()
    }

    return when {
        cents < fund.minAmountCents -> AmountResult.Invalid(AmountProblem.BELOW_MINIMUM)
        cents > fund.maxAmountCents -> AmountResult.Invalid(AmountProblem.ABOVE_MAXIMUM)
        else -> AmountResult.Valid(cents)
    }
}

// ---------------------------------------------------------------------------
// The logical attempt
// ---------------------------------------------------------------------------

/**
 * One donation a person started, identified by something that survives.
 *
 * The id is generated once, when the person commits to an amount, and is
 * **persisted before any network call**. That ordering is the whole defence: a
 * phone killed between generating an id and sending it has nothing to retry, and
 * a phone killed after sending has an id that will find the intent it already
 * created rather than making a second one.
 */
data class DonationAttempt(
    val clientAttemptId: String,
    val churchSlug: String,
    val fundId: String,
    val amountCents: Int,
)

/**
 * Where a person's donation has got to.
 *
 * `Confirmed` is reachable only from a server response, never from the payment
 * sheet — see [advanceAfterSheet].
 */
sealed interface DonationPhase {
    /** Nothing started. */
    data object Idle : DonationPhase
    /** Asking the server for a session. */
    data object Preparing : DonationPhase
    /** The sheet is on screen. */
    data class Presenting(val attempt: DonationAttempt) : DonationPhase
    /**
     * The sheet finished and the server has not confirmed.
     *
     * The screen a person waits on. It is not a success, and the wording must
     * never suggest it is.
     */
    data class AwaitingConfirmation(val attempt: DonationAttempt) : DonationPhase
    /** The server says the gift succeeded. The only state that shows a receipt. */
    data class Confirmed(val attemptId: String) : DonationPhase
    /** The person dismissed the sheet. Not a failure; nothing was charged. */
    data class Cancelled(val attempt: DonationAttempt) : DonationPhase
    /** Something went wrong, in terms a person can act on. */
    data class Failed(val reason: GivingFailure, val attempt: DonationAttempt?) : DonationPhase
}

/**
 * What went wrong, in this app's own vocabulary.
 *
 * Deliberately small, and deliberately not Stripe's. A provider error message is
 * written for a developer, can name an acquirer, an issuer decline code or a
 * customer id, and is never shown or logged.
 */
enum class GivingFailure {
    /** The card was declined, or the payment could not be completed. */
    PAYMENT_DECLINED,
    /** No network, or the request never completed. Retrying is safe. */
    NETWORK,
    /** The church cannot accept gifts right now. */
    CHURCH_NOT_ACCEPTING,
    /** The fund or amount is no longer allowed. */
    NOT_ALLOWED,
    /** Anything else. */
    UNAVAILABLE,
}

/** What the payment sheet reported. Three outcomes, and nothing about money. */
enum class SheetOutcome { COMPLETED, CANCELLED, FAILED }

/**
 * The state after a payment sheet closes.
 *
 * **`COMPLETED` maps to [DonationPhase.AwaitingConfirmation], never to
 * `Confirmed`.** This is the single most important line in the module: Stripe's
 * own documentation is explicit that the sheet's completion means the payment
 * was submitted, and that final state comes from a webhook. A version of this
 * function that returned `Confirmed` would show a receipt for a gift that could
 * still fail, and would do so most often for exactly the payments that need
 * review.
 */
fun advanceAfterSheet(
    outcome: SheetOutcome,
    attempt: DonationAttempt,
    failure: GivingFailure = GivingFailure.PAYMENT_DECLINED,
): DonationPhase = when (outcome) {
    SheetOutcome.COMPLETED -> DonationPhase.AwaitingConfirmation(attempt)
    SheetOutcome.CANCELLED -> DonationPhase.Cancelled(attempt)
    SheetOutcome.FAILED -> DonationPhase.Failed(failure, attempt)
}

/**
 * The state after the server reports what it knows.
 *
 * `initiated` and `requiresAction` keep a person waiting rather than telling them
 * anything: the first means nothing has happened yet, and the second means the
 * bank is still asking. Neither is an outcome.
 */
fun advanceAfterServer(status: DonationStatus, attempt: DonationAttempt): DonationPhase =
    when (status) {
        DonationStatus.SUCCEEDED -> DonationPhase.Confirmed(attempt.clientAttemptId)
        DonationStatus.FAILED -> DonationPhase.Failed(GivingFailure.PAYMENT_DECLINED, attempt)
        DonationStatus.CANCELLED -> DonationPhase.Cancelled(attempt)
        // A refund or a dispute after the fact is a history state, not something
        // that happens while a person is watching a spinner. Keeping them here
        // as "still waiting" would be wrong, so they resolve as themselves in
        // history and end this flow.
        DonationStatus.REFUNDED, DonationStatus.DISPUTED ->
            DonationPhase.Confirmed(attempt.clientAttemptId)
        DonationStatus.INITIATED,
        DonationStatus.REQUIRES_ACTION,
        DonationStatus.PROCESSING,
        DonationStatus.UNKNOWN -> DonationPhase.AwaitingConfirmation(attempt)
    }

/**
 * How long to wait before asking again.
 *
 * Backs off, and stops. A phone that has polled for two minutes without an
 * answer is not going to be helped by a hundred more requests: it shows the
 * gift as processing, tells the person their receipt will arrive, and stops.
 */
fun nextPollDelayMillis(attempt: Int): Long? = when {
    attempt < 0 -> null
    attempt < 3 -> 1_000L
    attempt < 8 -> 3_000L
    attempt < 20 -> 6_000L
    else -> null
}

// ---------------------------------------------------------------------------
// The payment sheet, behind a seam
// ---------------------------------------------------------------------------

/** Everything the sheet needs. Assembled by the server; never by this app. */
data class PaymentSheetRequest(
    val clientSecret: String,
    val publishableKey: String,
    /** The connected account. An identifier, not a credential. */
    val stripeAccountId: String,
    val merchantName: String,
    /** Only ever true when the server said the platform is configured for it. */
    val allowGooglePay: Boolean,
)

/**
 * The Stripe payment sheet, as this app is allowed to see it.
 *
 * One method, three outcomes, no money. The real implementation lives in `:app`
 * and does nothing but translate; every decision that depends on the result is
 * in this module, where a test can reach it.
 */
interface PaymentSheetFacade {
    suspend fun present(request: PaymentSheetRequest): SheetOutcome
}

/**
 * Whether Google Pay may be offered.
 *
 * Two conditions, both required, and the app's half is the weaker one: a device
 * that reports Google Pay is available proves the wallet exists, not that this
 * church's Stripe account is configured to accept it. So the server's answer is
 * the gate and the device's answer is a veto.
 */
fun googlePayAvailable(serverAllows: Boolean, deviceSupportsWallet: Boolean): Boolean =
    serverAllows && deviceSupportsWallet

/** Which Google Pay environment a wallet must run against. */
enum class WalletEnvironment { TEST, PRODUCTION }

/**
 * Derives the wallet environment from the publishable key.
 *
 * **Not a configuration option.** Google Pay's environment has to match the
 * Stripe key it is used with, and hardcoding `PRODUCTION` — which this adapter
 * did first — makes the sheet refuse against a test-mode key, in exactly the
 * environment where someone is trying to test it. The key already says which
 * mode it is, so it is the thing that decides.
 *
 * An unrecognised prefix resolves to `TEST`: refusing a real payment is
 * recoverable, and taking one against a key nobody could identify is not.
 */
fun walletEnvironment(publishableKey: String): WalletEnvironment =
    if (publishableKey.startsWith("pk_live_")) WalletEnvironment.PRODUCTION
    else WalletEnvironment.TEST

// ---------------------------------------------------------------------------
// What must never be written down
// ---------------------------------------------------------------------------

/**
 * Redacts anything that must not reach a log, a crash report or a cache.
 *
 * Applied to every string this feature logs. A client secret is a bearer
 * credential for one payment; a payment intent id identifies a person's gift.
 * Neither belongs in a log that a support engineer, a crash reporter, or an
 * `adb logcat` on a shared laptop can read.
 */
fun redactForLog(message: String): String =
    message
        .replace(Regex("pi_[A-Za-z0-9]+_secret_[A-Za-z0-9]+"), "[client-secret]")
        .replace(Regex("seti_[A-Za-z0-9]+_secret_[A-Za-z0-9]+"), "[client-secret]")
        .replace(Regex("pi_[A-Za-z0-9]{6,}"), "[payment-intent]")
        .replace(Regex("acct_[A-Za-z0-9]{6,}"), "[account]")
        .replace(Regex("cus_[A-Za-z0-9]{6,}"), "[customer]")
        .replace(Regex("pk_(test|live)_[A-Za-z0-9]{6,}"), "[publishable-key]")
