package io.faithform.faithful.giving

import io.faithform.faithful.contract.DonationStatus
import io.faithform.faithful.contract.DonationStatusResult
import io.faithform.faithful.contract.GivingFund
import io.faithform.faithful.contract.GivingHome
import io.faithform.faithful.contract.GivingReceipt

/**
 * What the Give screen is showing.
 *
 * Every rule about which affordance appears lives here, on the JVM, so the
 * Compose screen is a rendering of a decision rather than the place the decision
 * is made — the same arrangement `MediaScreenState` uses.
 */
sealed interface GivingListPhase {
    data object Idle : GivingListPhase
    data object Loading : GivingListPhase
    data class Loaded(val home: GivingHome) : GivingListPhase
    /** The church is not available to this account at all. */
    data object Blocked : GivingListPhase
    data object Offline : GivingListPhase
    data class Failed(val message: String) : GivingListPhase
}

/** Which empty state to show. Three genuinely different sentences. */
enum class GivingEmptyReason {
    /** The church has opened no funds. */
    NOTHING_PUBLISHED,
    /** The church cannot take money yet — Stripe is not ready, or giving is off. */
    NOT_ACCEPTING,
}

data class GivingScreenState(
    val phase: GivingListPhase = GivingListPhase.Idle,
    val selectedFundId: String? = null,
    val amountText: String = "",
    val donation: DonationPhase = DonationPhase.Idle,
    val receipt: GivingReceipt? = null,
    val history: List<DonationStatusResult> = emptyList(),
    val historyLoading: Boolean = false,
    /** True once polling gave up. The gift is still going through. */
    val pollingExhausted: Boolean = false,
) {
    val home: GivingHome? get() = (phase as? GivingListPhase.Loaded)?.home
    val funds: List<GivingFund> get() = home?.funds ?: emptyList()
    val churchName: String? get() = home?.churchName

    val selectedFund: GivingFund?
        get() = funds.firstOrNull { it.fundId == selectedFundId } ?: funds.firstOrNull()

    val showsRetry: Boolean
        get() = phase is GivingListPhase.Offline || phase is GivingListPhase.Failed

    /**
     * Said only when it is true.
     *
     * A church that runs no recurring gifts should not be advertised as
     * offering them, and Faithful gives one-time either way.
     */
    val showsRecurringNote: Boolean get() = home?.recurringAvailable == true

    val emptyReason: GivingEmptyReason?
        get() = when {
            phase !is GivingListPhase.Loaded -> null
            home?.availability != "available" -> GivingEmptyReason.NOT_ACCEPTING
            funds.isEmpty() -> GivingEmptyReason.NOTHING_PUBLISHED
            else -> null
        }

    /** The typed amount, judged against the selected fund. */
    val amountResult: AmountResult?
        get() = selectedFund?.let { validateAmount(amountText, it) }

    /** Whether the person may move on to the confirm screen. */
    val canContinue: Boolean get() = amountResult is AmountResult.Valid

    /**
     * Whether to say something about the amount yet.
     *
     * An empty field is not an error to shout at someone before they have typed
     * anything.
     */
    val amountProblem: AmountProblem?
        get() = when (val result = amountResult) {
            is AmountResult.Invalid ->
                if (result.problem == AmountProblem.EMPTY && amountText.isEmpty()) null
                else result.problem
            else -> null
        }

    /** Whether a payment sheet may be presented. Never true at launch. */
    val canPresentSheet: Boolean
        get() = canContinue && donation !is DonationPhase.Presenting &&
            donation !is DonationPhase.AwaitingConfirmation
}

/**
 * The truthful label for a state in history.
 *
 * A refunded or disputed gift says so. Hiding them would leave a person looking
 * at a list that disagrees with their bank.
 */
enum class HistoryLabel { PROCESSING, SUCCEEDED, FAILED, CANCELLED, REFUNDED, DISPUTED }

fun historyLabel(status: String): HistoryLabel = when (DonationStatus.fromWire(status)) {
    DonationStatus.SUCCEEDED -> HistoryLabel.SUCCEEDED
    DonationStatus.FAILED -> HistoryLabel.FAILED
    DonationStatus.CANCELLED -> HistoryLabel.CANCELLED
    DonationStatus.REFUNDED -> HistoryLabel.REFUNDED
    DonationStatus.DISPUTED -> HistoryLabel.DISPUTED
    // Initiated, requires action, processing, and anything a newer server adds.
    else -> HistoryLabel.PROCESSING
}

/**
 * Formats cents for display, in the gift's own currency.
 *
 * Never rounds and never abbreviates. `$1.2K` on a receipt is not a number a
 * person can check against their bank.
 */
fun formatGivingAmount(cents: Int, currency: String): String {
    val whole = cents / 100
    val remainder = cents % 100
    val symbol = if (currency.equals("usd", ignoreCase = true)) "$" else "${currency.uppercase()} "
    return if (remainder == 0) {
        "$symbol$whole"
    } else {
        "$symbol$whole.${remainder.toString().padStart(2, '0')}"
    }
}
