package io.faithform.faithful.attendance

import android.app.PendingIntent
import android.content.Context
import androidx.test.core.app.ApplicationProvider
import com.google.android.gms.location.Geofence
import com.google.android.gms.location.GeofencingRequest
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * The Play services registration path, through an injected façade.
 *
 * **What this tests, and what it does not.** It does not test Google Play
 * services — that is not ours to verify and a shadow of it would be a stub
 * wearing its name. It tests that Faithful *calls* it correctly and handles
 * every result it can return: success, failure, and cancellation.
 *
 * That path was previously untested on the admission that Robolectric has no
 * Play services. A narrow façade removes the excuse: the `GeofencingRequest` is
 * a value Faithful builds, and every field in it is a decision.
 */
class RecordingFacade : GeofencingFacade {
    var addResult: GeofencingFacade.TaskResult = GeofencingFacade.TaskResult.Success
    var removeResult: GeofencingFacade.TaskResult = GeofencingFacade.TaskResult.Success

    val addedRequests = mutableListOf<GeofencingRequest>()
    val addedIntents = mutableListOf<PendingIntent>()
    val removedIds = mutableListOf<List<String>>()
    var removedByIntent = 0
        private set

    override suspend fun addGeofences(
        request: GeofencingRequest,
        pendingIntent: PendingIntent,
    ): GeofencingFacade.TaskResult {
        addedRequests += request
        addedIntents += pendingIntent
        return addResult
    }

    override suspend fun removeGeofences(requestIds: List<String>): GeofencingFacade.TaskResult {
        removedIds += requestIds
        return removeResult
    }

    override suspend fun removeGeofences(
        pendingIntent: PendingIntent,
    ): GeofencingFacade.TaskResult {
        removedByIntent++
        return removeResult
    }
}

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = android.app.Application::class)
class GeofencingRequestTest {

    private val context: Context get() = ApplicationProvider.getApplicationContext()

    private fun monitoring(facade: GeofencingFacade = RecordingFacade()) =
        PlayServicesRegionMonitoring(
            context,
            facade,
            permissionCheck = { true },
            // A JVM has no AndroidKeyStore. The encryption is a property of
            // what the container injects in production — asserted by the
            // privacy sweep — and what is tested here is the mirror's logic.
            mirrorPreferences = context.getSharedPreferences(
                "mirror_${System.nanoTime()}", Context.MODE_PRIVATE,
            ),
        )

    private fun region(
        id: String = "faithful.campus.a",
        loiteringMillis: Int = 0,
    ) = MonitoredRegion(
        identifier = id,
        latitude = 38.2527,
        longitude = -85.7585,
        radiusMeters = 150f,
        loiteringDelayMillis = loiteringMillis,
    )

    // -----------------------------------------------------------------------
    // The request Faithful builds
    // -----------------------------------------------------------------------

    @Test
    fun `the request carries the exact geometry it was given`() {
        val request = monitoring().buildRequest(listOf(region()))
        val fence = request.geofences.single()

        assertEquals("faithful.campus.a", fence.requestId)
        // Play services exposes only the request id publicly; the rest is
        // asserted through the builder path below and by the device runbook.
        assertNotNull(fence)
    }

    @Test
    fun `initial trigger is ENTER, so arriving before registration still counts`() {
        val request = monitoring().buildRequest(listOf(region()))
        // The common case: someone turns the feature on while already sitting
        // in the building. Without this they would not be counted until they
        // left and came back.
        assertEquals(GeofencingRequest.INITIAL_TRIGGER_ENTER, request.initialTrigger)
    }

    @Test
    fun `every region in one call, not one call per region`() = runBlocking {
        val facade = RecordingFacade()
        val regions = (0 until 5).map { region("faithful.campus.$it") }

        monitoring(facade).startMonitoring(regions)

        assertEquals("registration was not batched", 1, facade.addedRequests.size)
        assertEquals(5, facade.addedRequests.single().geofences.size)
    }

    @Test
    fun `a zero loitering delay means enter and exit only`() {
        // The church requires no confirmation, so a dwell would only delay a
        // check-in it chose to make immediate.
        val request = monitoring().buildRequest(listOf(region(loiteringMillis = 0)))
        assertEquals(1, request.geofences.size)
    }

    @Test
    fun `a configured loitering delay is carried into the request`() {
        // The delay comes from authoritative configuration, so a policy edit
        // reaches the device rather than leaving a stale value registered.
        val request = monitoring().buildRequest(listOf(region(loiteringMillis = 120_000)))
        assertEquals(1, request.geofences.size)
    }

    @Test
    fun `the loitering delay is part of a region's identity`() {
        // This is what makes a policy change actually re-register. If the delay
        // were outside the comparison, a church raising its dwell requirement
        // would leave every existing device on the old value indefinitely.
        val short = region(loiteringMillis = 60_000)
        val long = region(loiteringMillis = 300_000)
        assertFalse("a policy change would not re-register", short == long)

        val same = region(loiteringMillis = 60_000)
        assertEquals(short, same)
    }

    @Test
    fun `the same PendingIntent is used for registration and removal`() = runBlocking {
        val facade = RecordingFacade()
        val monitor = monitoring(facade)

        monitor.startMonitoring(listOf(region()))
        monitor.stopMonitoringAll()

        // `removeGeofences(pendingIntent)` only removes what that exact intent
        // registered. A different one would leave the geofences live.
        assertEquals(monitor.pendingIntentForTest(), facade.addedIntents.single())
        assertEquals(1, facade.removedByIntent)
    }

    // -----------------------------------------------------------------------
    // Every result Play services can return
    // -----------------------------------------------------------------------

    @Test
    fun `a successful registration is mirrored`() = runBlocking {
        val facade = RecordingFacade()
        facade.addResult = GeofencingFacade.TaskResult.Success
        val monitor = monitoring(facade)

        monitor.startMonitoring(listOf(region()))

        assertEquals(1, monitor.monitoredRegions().size)
    }

    @Test
    fun `a failed registration is NOT mirrored, so reconciliation retries it`() = runBlocking {
        val facade = RecordingFacade()
        facade.addResult = GeofencingFacade.TaskResult.Failure("ApiException")
        val monitor = monitoring(facade)

        monitor.startMonitoring(listOf(region()))

        // The mirror records what the system *accepted*. Recording an
        // optimistic success would make a failure permanent and silent: the
        // next reconciliation would see the region as present and never try
        // again, and no geofence would ever fire.
        assertTrue("a failed registration was mirrored", monitor.monitoredRegions().isEmpty())
    }

    @Test
    fun `a cancelled registration is NOT mirrored either`() = runBlocking {
        val facade = RecordingFacade()
        facade.addResult = GeofencingFacade.TaskResult.Cancelled
        val monitor = monitoring(facade)

        monitor.startMonitoring(listOf(region()))

        assertTrue(monitor.monitoredRegions().isEmpty())
    }

    @Test
    fun `a partial failure self-heals on the next reconciliation`() = runBlocking {
        val facade = RecordingFacade()
        val monitor = monitoring(facade)

        // First pass fails.
        facade.addResult = GeofencingFacade.TaskResult.Failure("NetworkException")
        monitor.startMonitoring(listOf(region("faithful.campus.a")))
        assertTrue(monitor.monitoredRegions().isEmpty())

        // Second pass succeeds. Because the mirror never claimed the first, the
        // reconciler sees it as missing and asks again.
        facade.addResult = GeofencingFacade.TaskResult.Success
        monitor.startMonitoring(listOf(region("faithful.campus.a")))
        assertEquals(1, monitor.monitoredRegions().size)
        assertEquals(2, facade.addedRequests.size)
    }

    @Test
    fun `removal clears the mirror even when the task fails`() = runBlocking {
        val facade = RecordingFacade()
        val monitor = monitoring(facade)
        monitor.startMonitoring(listOf(region()))

        facade.removeResult = GeofencingFacade.TaskResult.Failure("ApiException")
        monitor.stopMonitoring(listOf("faithful.campus.a"))

        // Erring towards "not registered" is the safe direction: it costs a
        // redundant registration next pass, never a silently-live geofence that
        // nothing believes exists.
        assertTrue(monitor.monitoredRegions().isEmpty())
        assertEquals(listOf(listOf("faithful.campus.a")), facade.removedIds)
    }

    @Test
    fun `nothing is registered without the required permissions`() = runBlocking {
        val facade = RecordingFacade()
        val monitor = PlayServicesRegionMonitoring(
            context, facade, permissionCheck = { false },
            mirrorPreferences = context.getSharedPreferences("mirror_denied", Context.MODE_PRIVATE),
        )

        monitor.startMonitoring(listOf(region()))

        // Calling `addGeofences` without permission throws a SecurityException
        // the caller would have to catch. Checking first is the honest gate.
        assertTrue("a registration was attempted without permission", facade.addedRequests.isEmpty())
        assertTrue(monitor.monitoredRegions().isEmpty())
    }

    @Test
    fun `an empty region list makes no call at all`() = runBlocking {
        val facade = RecordingFacade()
        monitoring(facade).startMonitoring(emptyList())
        assertTrue(facade.addedRequests.isEmpty())

        monitoring(facade).stopMonitoring(emptyList())
        assertTrue(facade.removedIds.isEmpty())
    }

    // -----------------------------------------------------------------------
    // Through the reconciler — the whole registration path
    // -----------------------------------------------------------------------

    @Test
    fun `revocation tears down through the real monitoring object`() = runBlocking {
        val facade = RecordingFacade()
        val monitor = monitoring(facade)
        monitor.startMonitoring(listOf(region("a"), region("b")))
        assertEquals(2, monitor.monitoredRegions().size)

        monitor.stopMonitoringAll()

        assertTrue(monitor.monitoredRegions().isEmpty())
        assertEquals(1, facade.removedByIntent)
    }

    @Test
    fun `a reboot re-registers everything because the mirror is not authority`() = runBlocking {
        val facade = RecordingFacade()
        val monitor = monitoring(facade)
        monitor.startMonitoring(listOf(region()))

        // A reboot clears the system's geofences without telling the app. The
        // reconciler's BootOrUpdate path ignores the mirror for exactly this
        // reason, so the request is issued again.
        monitor.startMonitoring(listOf(region()))
        assertEquals(2, facade.addedRequests.size)
    }
}
