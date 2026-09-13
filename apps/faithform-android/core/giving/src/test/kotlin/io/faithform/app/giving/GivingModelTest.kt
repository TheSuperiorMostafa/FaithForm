package io.faithform.app.giving

import io.faithform.app.network.ApiClient
import io.faithform.app.network.ApiEnvironment
import io.faithform.app.network.HttpRequest
import io.faithform.app.network.HttpResponse
import io.faithform.app.network.HttpTransport
import io.faithform.app.network.ProjectionCache
import io.faithform.app.network.TokenProvider
import io.faithform.app.storage.CachePartition
import io.faithform.app.storage.PartitionedCache
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The Give tab end to end against a scripted server and a scripted payment
 * sheet: what is sent, what is persisted before it is sent, and that nothing
 * but the server's own status ever produces a thank-you.
 */
private fun envelope(data: String) =
    """{"ok":true,"data":$data,
       "meta":{"apiVersion":"1.0","apiMajor":1,"requestId":"r","minimumSupportedClientBuild":1}}"""

private fun failure(code: String) =
    """{"ok":false,"error":{"code":"$code","message":"Server sentence.","retryable":false},
       "meta":{"apiVersion":"1.0","apiMajor":1,"requestId":"r","minimumSupportedClientBuild":1}}"""

private const val HOME = """{"availability":"available","churchName":"Grace Chapel","funds":[
    {"fundId":"general","title":"General","description":"Where it's needed most","suggestedAmounts":[2500,5000],
     "minAmountCents":100,"maxAmountCents":1000000,"currency":"cad","publicationVersion":1},
    {"fundId":"missions","title":"Missions","description":null,"suggestedAmounts":[],
     "minAmountCents":500,"maxAmountCents":50000,"currency":"cad","publicationVersion":1}],
    "recurringAvailable":false,"givingVersion":3,"applePayApproved":false,"webGiveUrl":"https://grace.example/give"}"""

private const val SESSION = """{"attemptId":"a-1","status":"initiated","clientSecret":"pi_123_secret_456",
    "publishableKey":"pk_test_abcdef","stripeAccountId":"acct_1234567","merchantName":"Grace Chapel",
    "amountCents":2500,"currency":"cad","fundTitle":"General"}"""

private fun status(value: String) = """{"attemptId":"attempt-0001","status":"$value","amountCents":2500,
    "currency":"cad","fundTitle":"General","confirmed":${value == "succeeded"},"occurredAt":"2026-09-13T15:00:00Z"}"""

private const val RECEIPT = """{"attemptId":"attempt-0001","amountCents":2500,"currency":"cad",
    "fundTitle":"General","churchName":"Grace Chapel","paidAt":"2026-09-13T15:00:01Z","giftType":"one_time"}"""

/** Answers by route, so polling order does not have to be scripted request by request. */
private class GivingServer : HttpTransport {
    val received = mutableListOf<HttpRequest>()
    var home: HttpResponse = HttpResponse(200, envelope(HOME), mapOf("ETag" to "\"g3\""))
    var donate: HttpResponse = HttpResponse(200, envelope(SESSION), emptyMap())
    val statuses = ArrayDeque<HttpResponse>()
    var receipt: HttpResponse = HttpResponse(200, envelope(RECEIPT), emptyMap())
    var history: HttpResponse = HttpResponse(200, envelope("""{"items":[${status("refunded")}],"nextCursor":null}"""), emptyMap())

    override suspend fun perform(request: HttpRequest): HttpResponse {
        received += request
        val url = request.url
        return when {
            url.endsWith("/funds") -> home
            url.endsWith("/donate") -> donate
            "/status/" in url -> statuses.removeFirstOrNull() ?: throw java.io.IOException("no status scripted")
            "/receipt/" in url -> receipt
            "/history" in url -> history
            else -> error("unexpected $url")
        }
    }

    fun count(fragment: String) = received.count { fragment in it.url }
}

private class ScriptedSheet(var outcome: SheetOutcome = SheetOutcome.COMPLETED) : PaymentSheetFacade {
    val presented = mutableListOf<PaymentSheetRequest>()
    override suspend fun present(request: PaymentSheetRequest): SheetOutcome {
        presented += request
        return outcome
    }
}

private class MemoryStore : PendingDonationStore {
    var saved: DonationAttempt? = null
    /** What was stored at the moment `donate` left the phone. */
    var savedWhenDonateSent: DonationAttempt? = null
    override suspend fun save(attempt: DonationAttempt) { saved = attempt }
    override suspend fun load(): DonationAttempt? = saved
    override suspend fun clear() { saved = null }
}

private object Tokens : TokenProvider {
    override suspend fun validAccessToken() = "access-1"
    override suspend fun invalidate() = Unit
}

class GivingModelTest {

    private val server = GivingServer()
    private val sheet = ScriptedSheet()
    private val store = MemoryStore()
    private val sleeps = mutableListOf<Long>()

    private fun model(): GivingModel {
        val recordingServer = object : HttpTransport {
            override suspend fun perform(request: HttpRequest): HttpResponse {
                if (request.url.endsWith("/donate")) store.savedWhenDonateSent = store.saved
                return server.perform(request)
            }
        }
        val api = ApiClient(ApiEnvironment("test", "https://faithform.test"), 1, recordingServer, Tokens)
        return GivingModel(
            client = GivingClient(api, ProjectionCache(PartitionedCache())),
            sheet = sheet,
            store = store,
            churchSlug = "grace",
            partition = CachePartition("test", "account-a", "grace", 1),
            newAttemptId = { "attempt-0001" },
            sleep = { sleeps += it },
        )
    }

    private suspend fun readyToGive(amount: String = "25"): GivingModel = model().apply {
        load()
        updateAmount(amount)
    }

    @Test
    fun `funds load with the first one selected and descriptions intact`() = runTest {
        val model = model()
        model.load()

        val state = model.state.value
        assertEquals("general", state.selectedFund?.fundId)
        assertEquals("Where it's needed most", state.selectedFund?.description)
        assertEquals("https://faithform.test/api/mobile/v1/giving/grace/funds", server.received.single().url)
    }

    @Test
    fun `a completed sheet waits for the server, and only the server says thank you`() = runTest {
        server.statuses += HttpResponse(200, envelope(status("processing")), emptyMap())
        server.statuses += HttpResponse(200, envelope(status("succeeded")), emptyMap())
        val model = readyToGive()

        model.give()

        val state = model.state.value
        assertEquals(DonationPhase.Confirmed("attempt-0001"), state.donation)
        assertEquals("Grace Chapel", state.receipt?.churchName)
        assertEquals(2, server.count("/status/"))
        assertEquals(listOf(1_000L, 1_000L), sleeps)
        // Resolved, so nothing is left to resume.
        assertNull(store.saved)
    }

    @Test
    fun `the attempt is persisted before the request that could create an intent`() = runTest {
        server.statuses += HttpResponse(200, envelope(status("succeeded")), emptyMap())
        val model = readyToGive()
        model.give()

        assertEquals("attempt-0001", store.savedWhenDonateSent?.clientAttemptId)
        val body = server.received.first { it.url.endsWith("/donate") }.body!!
        assertEquals(
            """{"churchSlug":"grace","fundId":"general","amountCents":2500,"clientAttemptId":"attempt-0001"}""",
            body,
        )
    }

    @Test
    fun `the sheet is told the server's currency and never offers Google Pay in v1`() = runTest {
        sheet.outcome = SheetOutcome.CANCELLED
        val model = readyToGive()
        model.give()

        val request = sheet.presented.single()
        assertEquals("CAD", request.currencyCode)
        assertEquals(PaymentSheetRequest.DEFAULT_COUNTRY_CODE, request.countryCode)
        assertFalse(request.allowGooglePay)
        assertEquals("acct_1234567", request.stripeAccountId)
    }

    @Test
    fun `a sheet that never completed charges nothing and leaves nothing to resume`() = runTest {
        for (outcome in listOf(SheetOutcome.CANCELLED, SheetOutcome.FAILED)) {
            sheet.outcome = outcome
            val model = readyToGive()
            model.give()
            assertNull("$outcome left a pending attempt", store.saved)
            assertEquals("$outcome polled", 0, server.count("/status/"))
            assertFalse(model.state.value.donation is DonationPhase.Confirmed)
        }
    }

    @Test
    fun `polling that runs out says the gift is still going through`() = runTest {
        // Every poll fails: no status is scripted.
        val model = readyToGive()
        model.give()

        val state = model.state.value
        assertTrue(state.donation is DonationPhase.AwaitingConfirmation)
        assertTrue(state.pollingExhausted)
        assertNull(state.receipt)
        // Still pending, so the next launch asks the server again.
        assertEquals("attempt-0001", store.saved?.clientAttemptId)
    }

    @Test
    fun `a church that stopped accepting and a withdrawn fund are different sentences`() = runTest {
        server.donate = HttpResponse(409, failure("conflict"), emptyMap())
        val closed = readyToGive()
        closed.give()
        assertEquals(GivingFailure.CHURCH_NOT_ACCEPTING, (closed.state.value.donation as DonationPhase.Failed).reason)
        assertTrue(sheet.presented.isEmpty())
        assertNull(store.saved)

        server.donate = HttpResponse(404, failure("not_found"), emptyMap())
        val withdrawn = readyToGive()
        withdrawn.give()
        assertEquals(GivingFailure.NOT_ALLOWED, (withdrawn.state.value.donation as DonationPhase.Failed).reason)
    }

    @Test
    fun `an amount outside the fund's bounds never reaches the server`() = runTest {
        val model = readyToGive(amount = "0.50")
        model.give()
        assertEquals(0, server.count("/donate"))
        assertEquals(DonationPhase.Idle, model.state.value.donation)
    }

    @Test
    fun `an interrupted gift is resumed by asking, never by starting again`() = runTest {
        store.saved = DonationAttempt("attempt-0001", "grace", "general", 2500)
        server.statuses += HttpResponse(200, envelope(status("succeeded")), emptyMap())
        val model = model()

        model.resumeInterruptedDonation()

        assertEquals(0, server.count("/donate"))
        assertEquals(DonationPhase.Confirmed("attempt-0001"), model.state.value.donation)
    }

    @Test
    fun `another church's pending gift is not resumed here`() = runTest {
        store.saved = DonationAttempt("attempt-0001", "other-church", "general", 2500)
        model().resumeInterruptedDonation()
        assertTrue(server.received.isEmpty())
        assertEquals("other-church", store.saved?.churchSlug)
    }

    @Test
    fun `a church that is blocked or gone reads as unavailable, no network as offline`() = runTest {
        server.home = HttpResponse(404, failure("not_found"), emptyMap())
        val blocked = model()
        blocked.load()
        assertEquals(GivingListPhase.Blocked, blocked.state.value.phase)

        val offline = GivingModel(
            client = GivingClient(
                ApiClient(ApiEnvironment("test", "https://faithform.test"), 1, object : HttpTransport {
                    override suspend fun perform(request: HttpRequest): HttpResponse = throw java.io.IOException()
                }, Tokens),
                ProjectionCache(PartitionedCache()),
            ),
            sheet = sheet, store = store, churchSlug = "grace",
            partition = CachePartition("test", "account-a", "grace", 1),
        )
        offline.load()
        assertEquals(GivingListPhase.Offline, offline.state.value.phase)
        assertTrue(offline.state.value.showsRetry)
    }

    @Test
    fun `history is the server's, refunds included, and never cached`() = runTest {
        val model = model()
        model.loadHistory()
        model.loadHistory()
        assertEquals(HistoryLabel.REFUNDED, historyLabel(model.state.value.history.single().status))
        // Two reads, two requests, no validator: nothing was kept to revalidate.
        val historyRequests = server.received.filter { "/history" in it.url }
        assertEquals(2, historyRequests.size)
        assertTrue(historyRequests.all { it.headers["If-None-Match"] == null })
    }

    @Test
    fun `finishing returns to a clean form`() = runTest {
        sheet.outcome = SheetOutcome.CANCELLED
        val model = readyToGive()
        model.give()
        model.finishDonation()
        val state = model.state.value
        assertEquals(DonationPhase.Idle, state.donation)
        assertEquals("", state.amountText)
        assertNull(state.receipt)
    }
}
