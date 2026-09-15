package io.faithform.app.giving

import io.faithform.app.contract.DonationSession
import io.faithform.app.contract.DonationStatus
import io.faithform.app.contract.MobileErrorCode
import io.faithform.app.network.ApiException
import io.faithform.app.storage.CacheEntry
import io.faithform.app.storage.CachePartition
import io.faithform.app.storage.Freshness
import java.util.UUID
import kotlin.coroutines.cancellation.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.sync.Mutex

/**
 * Where the pending attempt lives between an interruption and a resume.
 *
 * An interface so a test can drive it and so the app can choose a store that
 * survives a process kill. It holds an id, a slug, a fund and an amount — no
 * client secret, no payment intent, nothing a person would mind being read.
 */
interface PendingDonationStore {
    suspend fun save(attempt: DonationAttempt)
    suspend fun load(): DonationAttempt?
    suspend fun clear()
}

/**
 * The Give tab, and the gift a person is making.
 *
 * Mirrors `GivingModel.swift`.
 *
 * ## Where the decisions are
 *
 * Not here. Amount validation, the state machine, the poll schedule and what
 * the screen shows all live in `Giving.kt` and [GivingScreenState], which are
 * platform-free and tested. This class sequences them.
 *
 * ## What it never does
 *
 * It never decides that a gift succeeded. `donation` reaches
 * [DonationPhase.Confirmed] only through [advanceAfterServer], with a status the
 * server read from a verified Stripe webhook.
 *
 * ## Google Pay
 *
 * Off in v1: every sheet is presented with `allowGooglePay = false`. Turning it
 * on needs the church's Stripe account configured for it and the Google Pay API
 * terms accepted for the app — both external — and then only this line changes.
 */
class GivingModel(
    private val client: GivingClient,
    private val sheet: PaymentSheetFacade,
    private val store: PendingDonationStore,
    private val churchSlug: String,
    private val partition: CachePartition,
    private val newAttemptId: () -> String = { UUID.randomUUID().toString().replace("-", "") },
    private val sleep: suspend (Long) -> Unit = { delay(it) },
    private val clock: () -> Long = System::currentTimeMillis,
) {
    private val _state = MutableStateFlow(GivingScreenState())
    val state: StateFlow<GivingScreenState> = _state.asStateFlow()

    /** One gift at a time: a double tap on "Give" must not start two. */
    private val giving = Mutex()

    // -----------------------------------------------------------------------
    // The list
    // -----------------------------------------------------------------------

    suspend fun load() {
        if (_state.value.phase is GivingListPhase.Idle) {
            val cached = client.cachedHome(churchSlug, partition)
            val now = clock()
            if (cached != null && cached.isDisplayable(now)) {
                _state.update { current ->
                    current.copy(
                        phase = GivingListPhase.Loaded(cached.value),
                        selectedFundId = current.selectedFundId
                            ?.takeIf { id -> cached.value.funds.any { it.fundId == id } }
                            ?: cached.value.funds.firstOrNull()?.fundId,
                    )
                }
            } else {
                _state.update { it.copy(phase = GivingListPhase.Loading) }
            }
        }
        try {
            val home = client.home(churchSlug, partition)
            _state.update { current ->
                current.copy(
                    phase = GivingListPhase.Loaded(home),
                    // A selection that names a fund which is no longer offered
                    // falls back to the first one rather than surviving.
                    selectedFundId = current.selectedFundId
                        ?.takeIf { id -> home.funds.any { it.fundId == id } }
                        ?: home.funds.firstOrNull()?.fundId,
                )
            }
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (error: ApiException) {
            _state.update { it.copy(phase = givingListPhaseFor(error)) }
        } catch (_: Exception) {
            _state.update { it.copy(phase = GivingListPhase.Offline) }
        }
    }

    fun selectFund(fundId: String) = _state.update { it.copy(selectedFundId = fundId) }

    fun updateAmount(text: String) = _state.update { it.copy(amountText = text) }

    // -----------------------------------------------------------------------
    // Resuming
    // -----------------------------------------------------------------------

    /**
     * Picks up a gift that was interrupted.
     *
     * A phone killed with a payment sheet open has a persisted attempt, and the
     * honest thing to do is ask the server what became of it — not to start
     * again, which could charge twice.
     */
    suspend fun resumeInterruptedDonation() {
        val pending = store.load() ?: return
        if (pending.churchSlug != churchSlug) return
        _state.update { it.copy(donation = DonationPhase.AwaitingConfirmation(pending)) }
        pollUntilResolved(pending)
    }

    // -----------------------------------------------------------------------
    // Giving
    // -----------------------------------------------------------------------

    /**
     * Starts a gift, presents the sheet, and waits for the server.
     *
     * The attempt id is generated and **persisted before the network call**. A
     * phone killed between those two lines has nothing to retry; a phone killed
     * after has an id that finds the intent it already created.
     */
    suspend fun give() {
        if (!giving.tryLock()) return
        try {
            val current = _state.value
            val fund = current.selectedFund ?: return
            val cents = (current.amountResult as? AmountResult.Valid)?.cents ?: return
            if (!current.canPresentSheet) return

            _state.update {
                it.copy(donation = DonationPhase.Preparing, pollingExhausted = false, receipt = null)
            }

            val attempt = DonationAttempt(
                clientAttemptId = newAttemptId(),
                churchSlug = churchSlug,
                fundId = fund.fundId,
                amountCents = cents,
            )
            store.save(attempt)

            val session: DonationSession = try {
                client.startDonation(attempt)
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (error: ApiException) {
                store.clear()
                _state.update { it.copy(donation = DonationPhase.Failed(donationFailureFor(error), attempt)) }
                return
            } catch (_: Exception) {
                store.clear()
                _state.update { it.copy(donation = DonationPhase.Failed(GivingFailure.NETWORK, attempt)) }
                return
            }

            _state.update { it.copy(donation = DonationPhase.Presenting(attempt)) }

            val outcome = sheet.present(paymentSheetRequest(session))
            _state.update { it.copy(donation = advanceAfterSheet(outcome, attempt)) }

            when (outcome) {
                SheetOutcome.COMPLETED -> pollUntilResolved(attempt)
                // Nothing was charged, so the attempt is not worth resuming. The
                // id itself is spent: reusing it would resume an intent the
                // person walked away from.
                SheetOutcome.CANCELLED, SheetOutcome.FAILED -> store.clear()
            }
        } finally {
            giving.unlock()
        }
    }

    /**
     * Asks the server what happened, backing off, and stops rather than asking
     * forever. A failed poll is not a failed gift.
     */
    private suspend fun pollUntilResolved(attempt: DonationAttempt) {
        var round = 0
        while (true) {
            val wait = nextPollDelayMillis(round) ?: break
            sleep(wait)
            round += 1

            val status = try {
                client.status(attempt.churchSlug, attempt.clientAttemptId)
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (_: Exception) {
                continue
            }

            // An unknown wire value resolves to UNKNOWN, which keeps the person
            // waiting rather than resolving into a guess.
            val next = advanceAfterServer(DonationStatus.fromWire(status.status), attempt)
            _state.update { it.copy(donation = next) }

            when (next) {
                is DonationPhase.Confirmed -> {
                    store.clear()
                    // Only now is there anything to show. The receipt route
                    // refuses anything the webhook has not confirmed.
                    val receipt = try {
                        client.receipt(attempt.churchSlug, attempt.clientAttemptId)
                    } catch (cancelled: CancellationException) {
                        throw cancelled
                    } catch (_: Exception) {
                        null
                    }
                    _state.update { it.copy(receipt = receipt) }
                    return
                }
                is DonationPhase.Failed, is DonationPhase.Cancelled -> {
                    store.clear()
                    return
                }
                else -> Unit
            }
        }
        // Out of rounds. The gift is still going through; the app says exactly
        // that rather than pretending either way.
        _state.update { it.copy(pollingExhausted = true) }
    }

    /** "Done" or "Try again" after an outcome: back to the form, amount cleared. */
    fun finishDonation() = _state.update {
        it.copy(donation = DonationPhase.Idle, receipt = null, pollingExhausted = false, amountText = "")
    }

    // -----------------------------------------------------------------------
    // History
    // -----------------------------------------------------------------------

    suspend fun loadHistory() {
        _state.update { it.copy(historyLoading = true) }
        val items = try {
            client.history(churchSlug).items
        } catch (cancelled: CancellationException) {
            _state.update { it.copy(historyLoading = false) }
            throw cancelled
        } catch (_: Exception) {
            emptyList()
        }
        _state.update { it.copy(history = items, historyLoading = false) }
    }

    /**
     * Drops everything held for this church — on sign-out, church switch, and
     * an authorization change. History is never cached, so this clears what the
     * model itself holds, and the pending attempt.
     */
    suspend fun purge() {
        _state.value = GivingScreenState()
        store.clear()
    }

    private fun paymentSheetRequest(session: DonationSession) = PaymentSheetRequest(
        clientSecret = session.clientSecret,
        publishableKey = session.publishableKey,
        stripeAccountId = session.stripeAccountId,
        merchantName = session.merchantName,
        allowGooglePay = false,
        currencyCode = session.currency.uppercase(),
    )
}

/** What a fund-list failure means. Mirrors `GivingModel.mapped` on iOS. */
fun givingListPhaseFor(error: ApiException): GivingListPhase = when (error.code) {
    MobileErrorCode.NOT_FOUND, MobileErrorCode.BLOCKED, MobileErrorCode.FORBIDDEN -> GivingListPhase.Blocked
    // There is no distinct transport code: a request that never completed
    // surfaces as `unavailable`, which reads to a person as offline and is the
    // state that offers a retry.
    MobileErrorCode.UNAVAILABLE, MobileErrorCode.INTERNAL_ERROR -> GivingListPhase.Offline
    else -> GivingListPhase.Failed(error.displayMessage)
}

/** What a failed start means to the person. Mirrors `GivingModel.failure(for:)`. */
fun donationFailureFor(error: ApiException): GivingFailure = when (error.code) {
    MobileErrorCode.NOT_FOUND, MobileErrorCode.INVALID_REQUEST -> GivingFailure.NOT_ALLOWED
    MobileErrorCode.CONFLICT -> GivingFailure.CHURCH_NOT_ACCEPTING
    MobileErrorCode.UNAVAILABLE, MobileErrorCode.INTERNAL_ERROR -> GivingFailure.NETWORK
    else -> GivingFailure.UNAVAILABLE
}
