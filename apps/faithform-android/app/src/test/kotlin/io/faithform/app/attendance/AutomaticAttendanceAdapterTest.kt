package io.faithform.app.attendance

import android.Manifest
import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.test.core.app.ApplicationProvider
import androidx.work.Configuration
import androidx.work.NetworkType
import androidx.work.WorkInfo
import androidx.work.WorkManager
import androidx.work.testing.SynchronousExecutor
import androidx.work.testing.WorkManagerTestInitHelper
import io.faithform.app.contract.MobileErrorCode
import io.faithform.app.network.ApiClient
import io.faithform.app.network.ApiEnvironment
import io.faithform.app.network.HttpRequest
import io.faithform.app.network.HttpResponse
import io.faithform.app.network.HttpTransport
import io.faithform.app.network.TokenProvider
import io.faithform.app.storage.CachePartition
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config

private fun envelope(data: String) =
    """{"ok":true,"data":$data,"meta":{"apiVersion":"1.0","apiMajor":1,"requestId":"r","minimumSupportedClientBuild":1}}"""

private fun failure(code: String, retryable: Boolean = false) =
    """{"ok":false,"error":{"code":"$code","message":"No.","retryable":$retryable},"meta":{"apiVersion":"1.0","apiMajor":1,"requestId":"r","minimumSupportedClientBuild":1}}"""

/** A scripted server: the next response for whichever path fragment matches. */
private class Server : HttpTransport {
    val received = mutableListOf<HttpRequest>()
    private val routes = LinkedHashMap<String, ArrayDeque<HttpResponse>>()

    fun on(fragment: String, status: Int, body: String?, headers: Map<String, String> = emptyMap()) {
        routes.getOrPut(fragment) { ArrayDeque() }.add(HttpResponse(status, body, headers))
    }

    override suspend fun perform(request: HttpRequest): HttpResponse {
        received += request
        val queue = routes.entries.firstOrNull { request.url.contains(it.key) }?.value
        return queue?.removeFirstOrNull() ?: throw java.io.IOException("offline")
    }
}

private object Token : TokenProvider {
    override suspend fun validAccessToken() = "token"
    override suspend fun invalidate() = Unit
}

private fun api(server: Server) = ApiClient(ApiEnvironment("test", "https://example.test"), 1, server, Token)

private const val CONFIG = """{"configuration":{"churchSlug":"grace","regions":[{"regionId":"faithform.campus.a","campusName":"Main","latitude":38.25,"longitude":-85.75,"radiusMeters":150}],"windows":[],"sources":{"geofence":true,"qr":true,"manual":true},"requiresConfirmation":false,"minDwellSeconds":0,"maxLocationAccuracyM":100,"configVersion":1009,"expiresAt":"2030-01-01T00:00:00Z"},"refusalReason":null,"message":null}"""

// ---------------------------------------------------------------------------
// What goes to the server
// ---------------------------------------------------------------------------

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = android.app.Application::class)
class AttendanceApiTest {

    @Test
    fun `the occurrence lookup names the campus and carries no position`() = runBlocking {
        val server = Server()
        server.on("/occurrence", 200, envelope("""{"occurrence":{"occurrenceId":"occ-9","label":"Sunday","churchSlug":"grace","localServiceDate":"2026-09-13","timezone":"UTC","startsAt":"x","endsAt":"x","checkinOpensAt":"x","checkinClosesAt":"x","status":"scheduled"}}"""))

        val id = ApiAttendanceSubmitter(api(server)).eligibleOccurrenceId("grace", "faithform.campus.a")

        assertEquals("occ-9", id)
        val request = server.received.single()
        assertEquals("GET", request.method)
        assertEquals(
            "https://example.test/api/mobile/v1/attendance/grace/occurrence?regionId=faithform.campus.a",
            request.url,
        )
        assertNull(request.body)
    }

    @Test
    fun `no relationship and an inactive account are answers, not outages`() = runBlocking {
        for (code in listOf("not_found", "account_inactive")) {
            val server = Server()
            server.on("/occurrence", if (code == "not_found") 404 else 403, failure(code))
            try {
                ApiAttendanceSubmitter(api(server)).eligibleOccurrenceId("grace", null)
                fail("$code returned normally")
            } catch (refused: TerminalAttendanceFailure) {
                assertEquals(EvidenceRefusal.NotEnrolled, refused.refusal)
            }
        }
    }

    @Test
    fun `an outage is transient, so the arrival is retried`() = runBlocking {
        val server = Server()
        server.on("/occurrence", 503, failure("unavailable", retryable = true))
        try {
            ApiAttendanceSubmitter(api(server)).eligibleOccurrenceId("grace", null)
            fail("an outage returned normally")
        } catch (_: TransientAttendanceFailure) {
        }
        // And no network at all is transient too.
        try {
            ApiAttendanceSubmitter(api(Server())).eligibleOccurrenceId("grace", null)
            fail("offline returned normally")
        } catch (_: TransientAttendanceFailure) {
        }
    }

    @Test
    fun `a detected attempt sends exactly the observation, and the key in its header`() = runBlocking {
        val server = Server()
        server.on(
            "/attendance/attempt",
            200,
            envelope("""{"outcome":"pending_confirmation","message":"Nearly.","occurrenceId":"occ-b","confirmationNotBefore":"2026-09-13T10:02:00Z","detectionId":"det-1"}"""),
        )
        val evidence = AttendanceEvidence(
            occurrenceId = "occ-1",
            phase = "detected",
            attemptId = "a".repeat(32),
            regionId = "faithform.campus.a",
            configVersion = 1009,
            observedAtEpochMillis = 1_800_000_000_000,
            accuracyMeters = 12.0,
            dwellSeconds = 0,
            latitude = 38.25,
            longitude = -85.75,
            mockLocationReported = false,
        )

        val outcome = ApiAttendanceSubmitter(api(server)).submit(evidence, "gf-key")

        val request = server.received.single()
        assertEquals("POST", request.method)
        assertEquals("gf-key", request.headers["Idempotency-Key"])
        val body = Json.parseToJsonElement(request.body!!).jsonObject
        assertEquals(
            setOf(
                "source", "occurrenceId", "phase", "observedAt", "accuracyMeters", "dwellSeconds",
                "latitude", "longitude", "mockLocationReported", "attemptId", "regionId", "configVersion",
            ),
            body.keys,
        )
        assertEquals("\"geofence\"", body["source"].toString())
        // Nothing that identifies the phone or the person travels in the body.
        for (absent in listOf("deviceId", "memberId", "churchId", "accountId", "speed", "altitude", "bearing")) {
            assertFalse(absent, body.containsKey(absent))
        }

        assertEquals("pending_confirmation", outcome.outcome)
        assertEquals("occ-b", outcome.occurrenceId)
        assertEquals("det-1", outcome.detectionId)
        assertEquals(java.time.Instant.parse("2026-09-13T10:02:00Z").toEpochMilli(), outcome.confirmationNotBeforeEpochMillis)
    }

    @Test
    fun `a scanned code names its source, which the server requires`() = runBlocking {
        val server = Server()
        server.on("/attendance/attempt", 200, envelope("""{"outcome":"counted","message":"In.","occurrenceId":"occ-1"}"""))

        ApiCheckInSubmitter(api(server)).submit(CheckInSubmission.typed("ABC1234", "scan-1"), "key")

        val body = Json.parseToJsonElement(server.received.single().body!!).jsonObject
        assertEquals("\"qr\"", body["source"].toString())
        assertEquals("\"confirm\"", body["phase"].toString())
        assertEquals(setOf("source", "phase", "shortCode", "scanAttemptId"), body.keys)
    }

    @Test
    fun `consent is recorded and withdrawn on its own route`() = runBlocking {
        val server = Server()
        server.on("/attendance/consent", 200, envelope("""{"autoAttendanceConsent":"granted","authorizationVersion":12}"""))
        server.on("/attendance/consent", 200, envelope("""{"autoAttendanceConsent":"revoked","authorizationVersion":13}"""))
        val client = ApiAttendanceConsentClient(api(server))

        assertEquals(ConsentRecorded("granted", 12), client.record(true))
        assertEquals(ConsentRecorded("revoked", 13), client.record(false))
        assertEquals("""{"autoAttendanceConsent":"granted"}""", server.received[0].body)
        assertEquals("""{"autoAttendanceConsent":"revoked"}""", server.received[1].body)
    }
}

// ---------------------------------------------------------------------------
// The configuration cache
// ---------------------------------------------------------------------------

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = android.app.Application::class)
class GeofenceConfigurationSourceTest {
    private val context: Context get() = ApplicationProvider.getApplicationContext()
    private val partition = CachePartition("test", "acct-1", "grace", 9)
    private val now = java.time.Instant.parse("2026-09-13T10:00:00Z").toEpochMilli()

    private fun prefs() = context.getSharedPreferences("config_${System.nanoTime()}", Context.MODE_PRIVATE)

    @Test
    fun `an unexpired configuration is used without a request, and revalidated with its ETag when forced`() = runBlocking {
        val server = Server()
        server.on("/geofence-config", 200, envelope(CONFIG), mapOf("ETag" to "\"v1\""))
        server.on("/geofence-config", 304, null, mapOf("ETag" to "\"v1\""))
        val source = ApiGeofenceConfigurationSource(api(server), prefs())

        val first = source.currentConfiguration("grace", partition, now, forceRefresh = false)
        val second = source.currentConfiguration("grace", partition, now + 1_000, forceRefresh = false)
        assertTrue(first is GeofenceConfigurationState.Available)
        assertEquals(first, second)
        assertEquals(1, server.received.size)

        val forced = source.currentConfiguration("grace", partition, now + 2_000, forceRefresh = true)
        assertEquals(first, forced)
        assertEquals("\"v1\"", server.received[1].headers["If-None-Match"])
    }

    @Test
    fun `offline with an expired copy is unavailable, never the stale copy`() = runBlocking {
        val server = Server()
        server.on("/geofence-config", 200, envelope(CONFIG.replace("2030-01-01T00:00:00Z", "2026-09-13T10:15:00Z")))
        val source = ApiGeofenceConfigurationSource(api(server), prefs())
        source.currentConfiguration("grace", partition, now, forceRefresh = false)

        val later = now + 16 * 60 * 1000L
        assertEquals(GeofenceConfigurationState.Unavailable, source.currentConfiguration("grace", partition, later, false))
    }

    @Test
    fun `a refusal is a refusal, and a different authorization version asks again`() = runBlocking {
        val server = Server()
        server.on("/geofence-config", 200, envelope("""{"configuration":null,"refusalReason":"geofence_disabled","message":"No."}"""))
        server.on("/geofence-config", 200, envelope(CONFIG))
        val source = ApiGeofenceConfigurationSource(api(server), prefs())

        assertEquals(
            GeofenceConfigurationState.Refused("geofence_disabled"),
            source.currentConfiguration("grace", partition, now, false),
        )
        assertTrue(source.currentConfiguration("grace", partition.copy(authorizationVersion = 10), now, false) is GeofenceConfigurationState.Available)
        assertEquals(2, server.received.size)
    }

    @Test
    fun `clearing leaves no church's campuses behind`() = runBlocking {
        val server = Server()
        server.on("/geofence-config", 200, envelope(CONFIG))
        val preferences = prefs()
        val source = ApiGeofenceConfigurationSource(api(server), preferences)
        source.currentConfiguration("grace", partition, now, false)
        assertTrue(preferences.all.keys.any { it.startsWith(ApiGeofenceConfigurationSource.PREFIX) })

        source.clear()

        assertTrue(preferences.all.keys.none { it.startsWith(ApiGeofenceConfigurationSource.PREFIX) })
    }

    @Test
    fun `a lost relationship reads as not enrolled`() = runBlocking {
        val server = Server()
        server.on("/geofence-config", 404, failure(MobileErrorCode.NOT_FOUND.wire))
        val source = ApiGeofenceConfigurationSource(api(server), prefs())
        assertEquals(GeofenceConfigurationState.Refused("not_enrolled"), source.currentConfiguration("grace", partition, now, false))
    }
}

// ---------------------------------------------------------------------------
// What is kept on the phone
// ---------------------------------------------------------------------------

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = android.app.Application::class)
class AttendanceStoresTest {
    private val context: Context get() = ApplicationProvider.getApplicationContext()
    private fun prefs() = context.getSharedPreferences("stores_${System.nanoTime()}", Context.MODE_PRIVATE)

    @Test
    fun `the record round-trips, and holds no position`() = runBlocking {
        val preferences = prefs()
        val store = EncryptedAutomaticAttendanceRecordStore(preferences)
        val record = AutomaticAttendanceRecord(
            enabled = true,
            serverConsent = "granted",
            environment = "test",
            accountId = "acct-1",
            authorizationVersion = 9,
            churches = listOf(ChurchName("grace", "Grace Church"), ChurchName("hope", "Hope")),
            monitoring = 3,
            monitoringRefusal = null,
            lastRefusal = "no_open_occurrence",
            lastCheckIn = LastCheckIn("grace", "Grace Church", "Sunday", 1_800_000_000_000),
            settledOccurrences = listOf("occ-1"),
            notifiedOccurrences = listOf("occ-1"),
            pendingConfirmation = PendingConfirmation("grace", "occ-2", 1_800_000_120_000),
            consentRevocationPending = false,
            unavailableAt = listOf("hope"),
        )

        store.save(record)

        assertEquals(record, EncryptedAutomaticAttendanceRecordStore(preferences).load())
        val raw = preferences.all.values.joinToString()
        for (absent in listOf("latitude", "longitude", "\"lat\"", "\"lon\"", "accuracy")) {
            assertFalse("the record stores $absent", raw.contains(absent))
        }

        store.clear()
        assertEquals(AutomaticAttendanceRecord(), store.load())
    }

    @Test
    fun `the inbox keeps order, is bounded, and empties`() = runBlocking {
        val inbox = EncryptedTransitionInbox(prefs())
        repeat(20) { inbox.append(PendingTransition(TransitionKind.Dwell, "faithform.campus.$it", it.toLong())) }

        val items = inbox.all()
        assertEquals(16, items.size)
        assertEquals("faithform.campus.4", items.first().regionId)

        inbox.remove(items.first())
        assertEquals(15, inbox.all().size)
        inbox.clear()
        assertTrue(inbox.all().isEmpty())
    }

    @Test
    fun `corrupt stored data is discarded rather than crashing`() = runBlocking {
        val preferences = prefs()
        preferences.edit().putString("automatic_attendance.record", "{").putString("automatic_attendance.inbox", "[").commit()
        assertEquals(AutomaticAttendanceRecord(), EncryptedAutomaticAttendanceRecordStore(preferences).load())
        assertTrue(EncryptedTransitionInbox(preferences).all().isEmpty())
    }

    @Test
    fun `an attempt keeps the campus it opened at`() = runBlocking {
        val store = EncryptedAttendanceAttemptStore(prefs())
        val partition = CachePartition("test", "acct-1", "grace", 9)
        val attempt = LogicalAttempt.open("grace", "occ-1", 1_800_000_000_000, regionId = "faithform.campus.a")
            .copy(detectionId = "det-1", confirmationNotBeforeEpochMillis = 1_800_000_060_000)

        store.update(attempt, partition)

        assertEquals(attempt, store.current(partition, 1_800_000_000_000))
    }

    @Test
    fun `the region mirror keeps the dwell and the church, so a foreground re-registers nothing`() = runBlocking {
        val mirror = RegionMirror(prefs())
        val region = MonitoredRegion("faithform.campus.a", 38.25, -85.75, 150f, loiteringDelayMillis = 60_000, churchSlug = "grace")

        mirror.add(listOf(region))

        assertEquals(setOf(region), mirror.load())
    }

    @Test
    fun `a permission asked for once and still refused reads as permanent`() = runBlocking {
        val app = shadowOf(context.applicationContext as android.app.Application)
        app.denyPermissions(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION)
        val history = PermissionRequestHistory(prefs())

        val before = AndroidLocationPermissions(context, playServices = { true }, history = history).current()
        assertEquals(ForegroundLocationPermission.NotRequested, before.foreground)

        history.markRequested(Manifest.permission.ACCESS_FINE_LOCATION)
        val after = AndroidLocationPermissions(context, playServices = { true }, history = history).current()
        // No rationale and asked before: only Settings will help now.
        assertEquals(ForegroundLocationPermission.PermanentlyDenied, after.foreground)
    }

    @Test
    fun `background location is never requested before foreground`() = runBlocking {
        val app = shadowOf(context.applicationContext as android.app.Application)
        app.denyPermissions(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION)
        val asked = mutableListOf<List<String>>()
        val permissions = AndroidLocationPermissions(
            context,
            requester = object : AndroidLocationPermissions.PermissionRequester {
                override suspend fun request(permissions: Array<String>): Map<String, Boolean> {
                    asked += permissions.toList()
                    return permissions.associateWith { false }
                }
                override fun shouldShowRationale(permission: String) = false
            },
            playServices = { true },
        )

        permissions.requestBackground()
        assertTrue(asked.isEmpty())

        app.grantPermissions(Manifest.permission.ACCESS_FINE_LOCATION)
        permissions.requestBackground()
        assertEquals(listOf(listOf(Manifest.permission.ACCESS_BACKGROUND_LOCATION)), asked)
    }
}

// ---------------------------------------------------------------------------
// Background work and notifications
// ---------------------------------------------------------------------------

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = android.app.Application::class)
class AttendanceWorkTest {
    private val context: Context get() = ApplicationProvider.getApplicationContext()

    @Before
    fun work() {
        WorkManagerTestInitHelper.initializeTestWorkManager(
            context,
            Configuration.Builder().setExecutor(SynchronousExecutor()).build(),
        )
    }

    private fun infos(name: String): List<WorkInfo> = WorkManager.getInstance(context).getWorkInfosForUniqueWork(name).get()

    @Test
    fun `sending waits for a network and backs off, and carries no location`() {
        val scheduler = WorkManagerAttendanceScheduler(context)

        scheduler.retryWhenOnline()
        scheduler.confirmWhenOnline(System.currentTimeMillis() + 60_000)
        scheduler.revokeConsentWhenOnline()

        for (name in listOf(
            WorkManagerAttendanceScheduler.NAME_RETRY,
            WorkManagerAttendanceScheduler.NAME_CONFIRM,
            WorkManagerAttendanceScheduler.NAME_REVOKE,
        )) {
            val info = infos(name).single()
            assertEquals(name, NetworkType.CONNECTED, info.constraints.requiredNetworkType)
            assertTrue(info.tags.contains(WorkManagerAttendanceScheduler.TAG))
        }
    }

    @Test
    fun `a transition's work needs no network, so an exit is handled offline`() {
        WorkManagerAttendanceScheduler(context).processTransitions()
        val info = infos(WorkManagerAttendanceScheduler.NAME_TRANSITIONS).single()
        assertEquals(NetworkType.NOT_REQUIRED, info.constraints.requiredNetworkType)
    }

    @Test
    fun `duplicate requests do not stack`() {
        val scheduler = WorkManagerAttendanceScheduler(context)
        val at = System.currentTimeMillis() + 3_600_000
        repeat(3) { scheduler.retryWhenOnline() }
        repeat(3) { scheduler.reconcileWhenOnline(ReconcileTrigger.WindowBoundary, at) }

        assertEquals(1, infos(WorkManagerAttendanceScheduler.NAME_RETRY).count { !it.state.isFinished })
        assertEquals(1, infos(WorkManagerAttendanceScheduler.NAME_WINDOW).count { !it.state.isFinished })
    }

    @Test
    fun `turning off cancels every piece of attendance work`() {
        val scheduler = WorkManagerAttendanceScheduler(context)
        scheduler.retryWhenOnline()
        scheduler.promptAt(System.currentTimeMillis() + 60_000)
        scheduler.reconcileWhenOnline(ReconcileTrigger.WindowBoundary, System.currentTimeMillis() + 3_600_000)

        scheduler.cancelAll()

        val all = WorkManager.getInstance(context).getWorkInfosByTag(WorkManagerAttendanceScheduler.TAG).get()
        assertTrue(all.isNotEmpty())
        assertTrue(all.all { it.state == WorkInfo.State.CANCELLED })
    }

    @Test
    fun `receivers in an unconfigured process do nothing`() {
        // No FaithForm application, as in a build with no configuration.
        GeofenceBroadcastReceiver().onReceive(context, Intent(GeofenceBroadcastReceiver.ACTION_TRANSITION))
        BootAndUpdateReceiver().onReceive(context, Intent(Intent.ACTION_BOOT_COMPLETED))
        GeofencingResetReceiver().onReceive(
            context,
            Intent(Intent.ACTION_PACKAGE_DATA_CLEARED, Uri.parse("package:com.google.android.gms")),
        )
        AttendanceNotificationReceiver().onReceive(context, Intent(AttendanceNotificationReceiver.ACTION_CONFIRM))
        assertTrue(WorkManager.getInstance(context).getWorkInfosByTag(WorkManagerAttendanceScheduler.TAG).get().isEmpty())
    }

    @Test
    fun `the transition constants map to the model and nothing else`() {
        assertEquals(TransitionKind.Enter, GeofenceBroadcastReceiver.kindOf(com.google.android.gms.location.Geofence.GEOFENCE_TRANSITION_ENTER))
        assertEquals(TransitionKind.Dwell, GeofenceBroadcastReceiver.kindOf(com.google.android.gms.location.Geofence.GEOFENCE_TRANSITION_DWELL))
        assertEquals(TransitionKind.Exit, GeofenceBroadcastReceiver.kindOf(com.google.android.gms.location.Geofence.GEOFENCE_TRANSITION_EXIT))
        assertNull(GeofenceBroadcastReceiver.kindOf(99))
    }
}

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = android.app.Application::class)
class AttendanceNotificationsTest {
    private val context: Context get() = ApplicationProvider.getApplicationContext()
    private val manager get() = context.getSystemService(NotificationManager::class.java)

    private fun allow() {
        shadowOf(context.applicationContext as android.app.Application)
            .grantPermissions(Manifest.permission.POST_NOTIFICATIONS)
    }

    @Test
    fun `the question is quiet, private on the lock screen, and has a Check in action`() {
        allow()
        AndroidAttendanceNotifier(context).askToConfirm("grace", "Grace Church", "Sunday Morning")

        val channel = manager.getNotificationChannel(AndroidAttendanceNotifier.CHANNEL_ID)
        assertNotNull(channel)
        // A phone chiming in a sanctuary is the one thing this must never cause.
        assertEquals(NotificationManager.IMPORTANCE_LOW, channel.importance)

        val posted = shadowOf(manager).getNotification(AndroidAttendanceNotifier.QUESTION_ID)
        assertNotNull(posted)
        assertEquals("Are you at Grace Church?", posted.extras.getString(android.app.Notification.EXTRA_TITLE))
        assertEquals(android.app.Notification.VISIBILITY_PRIVATE, posted.visibility)
        assertNotNull(posted.publicVersion)
        assertFalse(posted.publicVersion.extras.getString(android.app.Notification.EXTRA_TEXT).orEmpty().contains("Grace"))
        assertEquals(listOf("Check in", "Not now"), posted.actions.map { it.title.toString() })
    }

    @Test
    fun `a check-in replaces the question`() {
        allow()
        val notifier = AndroidAttendanceNotifier(context)
        notifier.askToConfirm("grace", "Grace Church", null)
        notifier.checkedIn("grace", "Grace Church", "Sunday Morning")

        assertNull(shadowOf(manager).getNotification(AndroidAttendanceNotifier.QUESTION_ID))
        val posted = shadowOf(manager).getNotification(AndroidAttendanceNotifier.CHECKED_IN_ID)
        assertEquals("You're checked in at Grace Church", posted.extras.getString(android.app.Notification.EXTRA_TITLE))
    }

    @Test
    fun `a refused tap says so, and an unknown church is never named by its slug`() {
        allow()
        AndroidAttendanceNotifier(context).notCheckedIn("grace", "")

        val posted = shadowOf(manager).getNotification(AndroidAttendanceNotifier.CHECKED_IN_ID)
        assertEquals("FaithForm couldn't check you in at your church", posted.extras.getString(android.app.Notification.EXTRA_TITLE))
        assertEquals("You can still check in with the code on screen.", posted.extras.getString(android.app.Notification.EXTRA_TEXT))
    }

    @Test
    fun `not now puts the question away`() {
        allow()
        AndroidAttendanceNotifier(context).askToConfirm("grace", "Grace Church", null)
        AttendanceNotificationReceiver().onReceive(context, Intent(AttendanceNotificationReceiver.ACTION_NOT_NOW))
        assertNull(shadowOf(manager).getNotification(AndroidAttendanceNotifier.QUESTION_ID))
    }

    @Test
    fun `without the permission nothing is posted and no channel is created`() {
        shadowOf(context.applicationContext as android.app.Application)
            .denyPermissions(Manifest.permission.POST_NOTIFICATIONS)

        AndroidAttendanceNotifier(context).checkedIn("grace", "Grace Church", null)

        assertTrue(shadowOf(manager).allNotifications.isEmpty())
        assertNull(manager.getNotificationChannel(AndroidAttendanceNotifier.CHANNEL_ID))
    }

    @Test
    fun `notification access tells never-asked from declined`() {
        shadowOf(context.applicationContext as android.app.Application)
            .denyPermissions(Manifest.permission.POST_NOTIFICATIONS)
        assertEquals(NotificationAccess.NotRequested, AndroidAttendanceNotifier.access(context, requested = false))
        assertEquals(NotificationAccess.Denied, AndroidAttendanceNotifier.access(context, requested = true))
        allow()
        assertEquals(NotificationAccess.Granted, AndroidAttendanceNotifier.access(context, requested = true))
    }

    @Test
    fun `tapping opens that church's Check in tab through the ordinary link`() {
        assertEquals("faithform://church/grace/check-in", AndroidAttendanceNotifier.checkInLink("grace"))
        assertEquals(
            io.faithform.app.navigation.Destination.CheckIn("grace"),
            io.faithform.app.navigation.DeepLinkParser.parse(AndroidAttendanceNotifier.checkInLink("grace")),
        )
    }
}
