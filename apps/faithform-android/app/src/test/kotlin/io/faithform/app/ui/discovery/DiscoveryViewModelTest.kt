package io.faithform.app.ui.discovery

import io.faithform.app.network.ApiClient
import io.faithform.app.network.ApiEnvironment
import io.faithform.app.network.HttpRequest
import io.faithform.app.network.HttpResponse
import io.faithform.app.network.HttpTransport
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import kotlinx.coroutines.test.resetMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

@OptIn(kotlinx.coroutines.ExperimentalCoroutinesApi::class)
class DiscoveryViewModelTest {
    @Before fun setUp() = Dispatchers.setMain(UnconfinedTestDispatcher())
    @After fun tearDown() = Dispatchers.resetMain()

    private val location = object : LocationProvider {
        override suspend fun authorizationStatus() = error("Public search must not read location authorization")
        override suspend fun requestWhenInUse() = error("Public search must not request location permission")
        override suspend fun currentCoordinate() = error("Public search must not read device coordinates")
    }
    private fun response() = HttpResponse(200, """{"ok":true,"data":{"items":[{"slug":"grace","name":"Grace Community","logoUrl":null,"publicSummary":null,"denomination":null,"city":null,"state":null,"postalCode":null,"joinPolicy":"open","publicProfileVersion":1,"distanceKm":null,"campusName":null}],"nextCursor":null},"meta":{"apiVersion":"1.0","apiMajor":1,"requestId":"r","minimumSupportedClientBuild":1}}""", emptyMap())
    private fun model(transport: HttpTransport) = DiscoveryViewModel(
        ApiClient(ApiEnvironment("development", "https://api.example"), 1, transport, null), location,
    )

    @Test fun `opening discovery reuses the prepared public list without location permission`() = runTest {
        var requests = 0
        val model = model(object : HttpTransport {
            override suspend fun perform(request: HttpRequest): HttpResponse {
                requests += 1
                assertFalse(request.headers.containsKey("Authorization"))
                return response()
            }
        })
        model.prepare()
        model.prepare()
        assertEquals(1, requests)
        val results = model.phase.value as DiscoveryPhase.Results
        assertEquals("grace", results.churches.single().slug)
        assertFalse(results.usedLocation)
    }

    @Test fun `clearing search prevents the pending default list from replacing the idle screen`() = runTest {
        val reply = CompletableDeferred<HttpResponse>()
        val model = model(object : HttpTransport {
            override suspend fun perform(request: HttpRequest) = reply.await()
        })
        model.prepare()
        assertTrue(model.phase.value is DiscoveryPhase.Searching)
        model.updateQuery("")
        reply.complete(response())
        assertEquals(DiscoveryPhase.Idle, model.phase.value)
    }
}
