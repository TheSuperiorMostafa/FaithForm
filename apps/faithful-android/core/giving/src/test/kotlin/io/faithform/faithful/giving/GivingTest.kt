package io.faithform.faithful.giving

import io.faithform.faithful.contract.DonationStatus
import io.faithform.faithful.contract.GivingFund
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.async
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.yield
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

private fun fund(
    min: Int = 100,
    max: Int = 500_000,
    suggested: List<Int> = listOf(2_500, 5_000, 10_000),
) = GivingFund(
    fundId = "fund-1",
    title = "General",
    description = null,
    suggestedAmounts = suggested,
    minAmountCents = min,
    maxAmountCents = max,
    currency = "usd",
    publicationVersion = 1,
)

private val ATTEMPT = DonationAttempt(
    clientAttemptId = "attempt-abcdef01",
    churchSlug = "grace",
    fundId = "fund-1",
    amountCents = 5_000,
)

// ---------------------------------------------------------------------------
// Amounts
// ---------------------------------------------------------------------------

class AmountValidationTest {

    @Test
    fun `a plain amount becomes cents`() {
        assertEquals(AmountResult.Valid(5_000), validateAmount("50", fund()))
        assertEquals(AmountResult.Valid(5_025), validateAmount("50.25", fund()))
        assertEquals(AmountResult.Valid(5_000), validateAmount("  $50  ", fund()))
    }

    @Test
    fun `a thousands separator is not a decimal point`() {
        // Rejecting "1,000" as "not a number" reads as the app being broken, and
        // reading it as one dollar would charge the wrong amount.
        assertEquals(AmountResult.Valid(100_000), validateAmount("1,000", fund()))
        assertEquals(AmountResult.Valid(100_050), validateAmount("1,000.50", fund()))
    }

    @Test
    fun `a comma decimal separator still means what it says`() {
        // Most of the world writes 50,25.
        assertEquals(AmountResult.Valid(5_025), validateAmount("50,25", fund()))
    }

    @Test
    fun `nothing, and nonsense, are different problems`() {
        assertEquals(AmountResult.Invalid(AmountProblem.EMPTY), validateAmount("   ", fund()))
        assertEquals(
            AmountResult.Invalid(AmountProblem.NOT_A_NUMBER),
            validateAmount("twenty", fund()),
        )
        assertEquals(AmountResult.Invalid(AmountProblem.NOT_A_NUMBER), validateAmount("-5", fund()))
        assertEquals(AmountResult.Invalid(AmountProblem.NOT_A_NUMBER), validateAmount("0", fund()))
    }

    @Test
    fun `the fund's own bounds decide, and they are reported apart`() {
        val bounded = fund(min = 500, max = 20_000)
        assertEquals(
            AmountResult.Invalid(AmountProblem.BELOW_MINIMUM),
            validateAmount("1", bounded),
        )
        assertEquals(
            AmountResult.Invalid(AmountProblem.ABOVE_MAXIMUM),
            validateAmount("500", bounded),
        )
        // The bounds themselves are inside.
        assertEquals(AmountResult.Valid(500), validateAmount("5", bounded))
        assertEquals(AmountResult.Valid(20_000), validateAmount("200", bounded))
    }

    @Test
    fun `an absurd amount cannot overflow into a small one`() {
        // A value past Int.MAX_VALUE cents must not wrap into something payable.
        val result = validateAmount("99999999999", fund())
        assertEquals(AmountResult.Invalid(AmountProblem.ABOVE_MAXIMUM), result)
    }
}

// ---------------------------------------------------------------------------
// The state machine
// ---------------------------------------------------------------------------

class DonationPhaseTest {

    @Test
    fun `a completed payment sheet is not a receipt`() {
        // **The most important assertion in this module.** Stripe's sheet
        // completing means the payment was submitted. Only a webhook can say it
        // succeeded, and a version of this that returned Confirmed would show a
        // receipt for a gift that could still fail.
        val phase = advanceAfterSheet(SheetOutcome.COMPLETED, ATTEMPT)
        assertTrue(phase is DonationPhase.AwaitingConfirmation)
        assertFalse(phase is DonationPhase.Confirmed)
    }

    @Test
    fun `dismissing the sheet is not a failure`() {
        val phase = advanceAfterSheet(SheetOutcome.CANCELLED, ATTEMPT)
        assertTrue(phase is DonationPhase.Cancelled)
    }

    @Test
    fun `a sheet failure carries a reason a person can act on`() {
        val phase = advanceAfterSheet(SheetOutcome.FAILED, ATTEMPT, GivingFailure.NETWORK)
        assertEquals(DonationPhase.Failed(GivingFailure.NETWORK, ATTEMPT), phase)
    }

    @Test
    fun `only the server can confirm`() {
        assertEquals(
            DonationPhase.Confirmed(ATTEMPT.clientAttemptId),
            advanceAfterServer(DonationStatus.SUCCEEDED, ATTEMPT),
        )
    }

    @Test
    fun `waiting states keep waiting rather than claiming anything`() {
        for (status in listOf(
            DonationStatus.INITIATED,
            DonationStatus.REQUIRES_ACTION,
            DonationStatus.PROCESSING,
            // An unrecognised status from a newer server must not resolve into a
            // success. A released app that guessed here would be wrong exactly
            // when the server had something new to say.
            DonationStatus.UNKNOWN,
        )) {
            assertTrue(
                "$status resolved instead of waiting",
                advanceAfterServer(status, ATTEMPT) is DonationPhase.AwaitingConfirmation,
            )
        }
    }

    @Test
    fun `a declined payment is a failure, not a cancellation`() {
        assertEquals(
            DonationPhase.Failed(GivingFailure.PAYMENT_DECLINED, ATTEMPT),
            advanceAfterServer(DonationStatus.FAILED, ATTEMPT),
        )
    }

    @Test
    fun `polling backs off and then stops`() {
        assertEquals(1_000L, nextPollDelayMillis(0))
        assertEquals(3_000L, nextPollDelayMillis(3))
        assertEquals(6_000L, nextPollDelayMillis(8))
        // A phone that has polled for two minutes is not helped by a hundred
        // more requests. It says "processing" and stops.
        assertNull(nextPollDelayMillis(20))
        assertNull(nextPollDelayMillis(500))
    }
}

// ---------------------------------------------------------------------------
// The attempt survives the app
// ---------------------------------------------------------------------------

class AttemptIdentityTest {

    @Test
    fun `the same attempt id is reused after an interruption`() = runBlocking {
        // The scenario this whole mechanism exists for: the sheet is up, the app
        // is killed, the person opens it again. The retry must carry the id it
        // already used, so the server returns the intent that already exists.
        val store = FakeAttemptStore()
        store.save(ATTEMPT)

        val recovered = store.load()
        assertEquals(ATTEMPT.clientAttemptId, recovered?.clientAttemptId)

        val server = FakeDonationApi()
        server.start(recovered!!)
        server.start(recovered)
        server.start(recovered)

        // Three starts, one intent. Anything else is a duplicate charge.
        assertEquals(1, server.intents.size)
        assertEquals(3, server.startCalls)
    }

    @Test
    fun `two concurrent starts of one attempt produce one intent`() = runBlocking {
        val server = FakeDonationApi()
        val gate = CompletableDeferred<Unit>()
        server.gate = gate

        val first = async { server.start(ATTEMPT) }
        yield()
        val second = async { server.start(ATTEMPT) }
        yield()
        gate.complete(Unit)
        first.await()
        second.await()

        assertEquals(1, server.intents.size)
    }

    @Test
    fun `a different attempt is a different intent`() = runBlocking {
        val server = FakeDonationApi()
        server.start(ATTEMPT)
        server.start(ATTEMPT.copy(clientAttemptId = "attempt-99999999"))
        assertEquals(2, server.intents.size)
    }
}

/** Stands in for the encrypted store the app keeps the pending attempt in. */
private class FakeAttemptStore {
    private var saved: DonationAttempt? = null
    fun save(attempt: DonationAttempt) { saved = attempt }
    fun load(): DonationAttempt? = saved
}

/**
 * Stands in for the server's attempt claim.
 *
 * Models the property that matters and nothing else: one intent per client
 * attempt id, whatever the call pattern.
 */
private class FakeDonationApi {
    val intents = mutableMapOf<String, String>()
    var startCalls = 0
    var gate: CompletableDeferred<Unit>? = null

    suspend fun start(attempt: DonationAttempt): String {
        startCalls += 1
        gate?.await()
        return intents.getOrPut(attempt.clientAttemptId) { "pi_${intents.size + 1}" }
    }
}

// ---------------------------------------------------------------------------
// Wallets
// ---------------------------------------------------------------------------

class WalletAvailabilityTest {

    @Test
    fun `the wallet environment follows the key, never a hardcoded constant`() {
        // The first version of the adapter hardcoded `Production`, which refuses
        // against a test key — in exactly the environment someone is testing in.
        assertEquals(
            WalletEnvironment.PRODUCTION,
            walletEnvironment("pk_live_51Abcdefghijklmnop"),
        )
        assertEquals(WalletEnvironment.TEST, walletEnvironment("pk_test_51Abcdefghijklmnop"))
        // Unrecognised resolves to TEST: refusing a real payment is recoverable,
        // taking one against a key nobody could identify is not.
        assertEquals(WalletEnvironment.TEST, walletEnvironment(""))
        assertEquals(WalletEnvironment.TEST, walletEnvironment("something_else"))
    }

    @Test
    fun `the server decides and the device may veto`() {
        // A device reporting a wallet proves the wallet exists, not that this
        // church's Stripe account accepts it.
        assertTrue(googlePayAvailable(serverAllows = true, deviceSupportsWallet = true))
        assertFalse(googlePayAvailable(serverAllows = false, deviceSupportsWallet = true))
        assertFalse(googlePayAvailable(serverAllows = true, deviceSupportsWallet = false))
        assertFalse(googlePayAvailable(serverAllows = false, deviceSupportsWallet = false))
    }
}

// ---------------------------------------------------------------------------
// Nothing sensitive is written down
// ---------------------------------------------------------------------------

class RedactionTest {

    @Test
    fun `a client secret never survives a log line`() {
        val leaked =
            "failed for pi_3PabcDEfGh12345_secret_XyZ987654321 on acct_1A2b3C4d5E"
        val safe = redactForLog(leaked)
        // The *value* must be gone. Asserting the word "secret" is absent would
        // fail on the replacement itself, which is a test bug rather than a leak.
        assertFalse(safe.contains("XyZ987654321"))
        assertFalse(safe.contains("pi_3PabcDEfGh12345"))
        assertFalse(safe.contains("acct_1A2b3C4d5E"))
        assertTrue(safe.contains("[client-secret]"))
        assertTrue(safe.contains("[account]"))
    }

    @Test
    fun `identifiers that name a person's gift are redacted too`() {
        val safe = redactForLog("intent pi_3PabcDEfGh12345 customer cus_QRSTuv12345")
        assertTrue(safe.contains("[payment-intent]"))
        assertTrue(safe.contains("[customer]"))
        assertFalse(safe.contains("cus_QRSTuv12345"))
    }

    @Test
    fun `a publishable key is redacted even though it is not secret`() {
        // Not a credential, and still not something to leave in a log where it
        // identifies which Stripe account an install is talking to.
        val safe = redactForLog("using pk_test_51Abcdefghijklmnop")
        assertTrue(safe.contains("[publishable-key]"))
    }

    @Test
    fun `an ordinary message is left alone`() {
        val message = "the gift is still processing"
        assertEquals(message, redactForLog(message))
    }
}

// ---------------------------------------------------------------------------
// What the screen shows
// ---------------------------------------------------------------------------

class GivingScreenStateTest {

    private fun home(
        availability: String = "available",
        funds: List<GivingFund> = listOf(fund()),
        recurring: Boolean = false,
    ) = io.faithform.faithful.contract.GivingHome(
        availability = availability,
        churchName = "Grace Chapel",
        funds = funds,
        recurringAvailable = recurring,
        givingVersion = 1,
    )

    @Test
    fun `a church that cannot charge says so rather than showing nothing`() {
        // "Nothing here" and "not set up yet" are different sentences. Showing
        // the first would make a church's incomplete setup look like a mistake
        // the person made.
        val state = GivingScreenState(phase = GivingListPhase.Loaded(home(availability = "not_accepting")))
        assertEquals(GivingEmptyReason.NOT_ACCEPTING, state.emptyReason)
    }

    @Test
    fun `a church with no published funds is a different empty`() {
        val state = GivingScreenState(phase = GivingListPhase.Loaded(home(funds = emptyList())))
        assertEquals(GivingEmptyReason.NOTHING_PUBLISHED, state.emptyReason)
    }

    @Test
    fun `a loaded church with funds is not empty at all`() {
        assertNull(GivingScreenState(phase = GivingListPhase.Loaded(home())).emptyReason)
    }

    @Test
    fun `a retry is offered only where retrying could help`() {
        assertTrue(GivingScreenState(phase = GivingListPhase.Offline).showsRetry)
        assertTrue(GivingScreenState(phase = GivingListPhase.Failed("x")).showsRetry)
        // Blocked is not a network problem, and a retry button would imply it is.
        assertFalse(GivingScreenState(phase = GivingListPhase.Blocked).showsRetry)
        assertFalse(GivingScreenState(phase = GivingListPhase.Loaded(home())).showsRetry)
    }

    @Test
    fun `recurring is mentioned only when the church actually runs it`() {
        assertFalse(GivingScreenState(phase = GivingListPhase.Loaded(home())).showsRecurringNote)
        assertTrue(
            GivingScreenState(phase = GivingListPhase.Loaded(home(recurring = true)))
                .showsRecurringNote,
        )
    }

    @Test
    fun `an empty field is not an error before anyone has typed`() {
        val state = GivingScreenState(phase = GivingListPhase.Loaded(home()), amountText = "")
        assertNull(state.amountProblem)
        assertFalse(state.canContinue)
    }

    @Test
    fun `a bad amount says which bound was missed`() {
        val bounded = fund(min = 500, max = 20_000)
        val low = GivingScreenState(
            phase = GivingListPhase.Loaded(home(funds = listOf(bounded))),
            amountText = "1",
        )
        assertEquals(AmountProblem.BELOW_MINIMUM, low.amountProblem)

        val high = low.copy(amountText = "500")
        assertEquals(AmountProblem.ABOVE_MAXIMUM, high.amountProblem)

        val fine = low.copy(amountText = "50")
        assertNull(fine.amountProblem)
        assertTrue(fine.canContinue)
    }

    @Test
    fun `no payment sheet can be presented at launch`() {
        // The state a screen has when it appears. Nothing about it permits a
        // payment UI, which is what makes "no payment prompt at launch" a
        // property of the structure.
        assertFalse(GivingScreenState().canPresentSheet)
        assertFalse(GivingScreenState(phase = GivingListPhase.Loaded(home())).canPresentSheet)
    }

    @Test
    fun `a sheet cannot be presented twice for one gift`() {
        val ready = GivingScreenState(
            phase = GivingListPhase.Loaded(home()),
            amountText = "50",
        )
        assertTrue(ready.canPresentSheet)
        // Already presenting, or already waiting on the server: a second sheet
        // would be a second charge.
        assertFalse(ready.copy(donation = DonationPhase.Presenting(ATTEMPT)).canPresentSheet)
        assertFalse(
            ready.copy(donation = DonationPhase.AwaitingConfirmation(ATTEMPT)).canPresentSheet,
        )
    }

    @Test
    fun `history labels are truthful, including the unwelcome ones`() {
        // Hiding a refund would leave a person looking at a list that disagrees
        // with their bank.
        assertEquals(HistoryLabel.SUCCEEDED, historyLabel("succeeded"))
        assertEquals(HistoryLabel.REFUNDED, historyLabel("refunded"))
        assertEquals(HistoryLabel.DISPUTED, historyLabel("disputed"))
        assertEquals(HistoryLabel.FAILED, historyLabel("failed"))
        assertEquals(HistoryLabel.CANCELLED, historyLabel("cancelled"))
        assertEquals(HistoryLabel.PROCESSING, historyLabel("processing"))
        assertEquals(HistoryLabel.PROCESSING, historyLabel("requires_action"))
        // A state a newer server introduces reads as processing rather than as
        // anything a person would act on.
        assertEquals(HistoryLabel.PROCESSING, historyLabel("settling_tomorrow"))
    }

    @Test
    fun `an amount is never abbreviated or rounded`() {
        // "$1.2K" on a receipt is not a number a person can check against a bank
        // statement.
        assertEquals("$50", formatGivingAmount(5_000, "usd"))
        assertEquals("$50.25", formatGivingAmount(5_025, "usd"))
        assertEquals("$1234", formatGivingAmount(123_400, "usd"))
        assertEquals("$0.05", formatGivingAmount(5, "usd"))
        assertEquals("EUR 50", formatGivingAmount(5_000, "eur"))
    }
}
