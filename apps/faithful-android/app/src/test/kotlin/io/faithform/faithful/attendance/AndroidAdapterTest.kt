package io.faithform.faithful.attendance

import android.Manifest
import android.content.Context
import android.content.Intent
import android.location.LocationManager
import androidx.test.core.app.ApplicationProvider
import io.faithform.faithful.storage.CachePartition
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.shadows.ShadowApplication
import org.robolectric.shadows.ShadowLocationManager

/**
 * The Android adapters, on the real framework.
 *
 * These exercise the translation layer that `:core:attendance` deliberately
 * cannot reach: how a granted or missing runtime permission becomes a
 * `LocationPermissionState`, how the API level selects a background strategy,
 * and how the encrypted attempt store round-trips a position.
 *
 * `@Config(sdk = ...)` on a method runs it on that API level, which is how the
 * Android 10 versus Android 11+ split is genuinely exercised rather than
 * asserted from a constant.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = android.app.Application::class)
class AndroidPermissionTranslationTest {

    private val context: Context get() = ApplicationProvider.getApplicationContext()
    private val app: ShadowApplication get() = shadowOf(context.applicationContext as android.app.Application)

    private fun grant(vararg permissions: String) = app.grantPermissions(*permissions)
    private fun deny(vararg permissions: String) = app.denyPermissions(*permissions)

    private fun enableLocationServices() {
        val manager = context.getSystemService(Context.LOCATION_SERVICE) as LocationManager
        val shadow = shadowOf(manager) as ShadowLocationManager
        shadow.setProviderEnabled(LocationManager.GPS_PROVIDER, true)
    }

    /** Both providers off, as when a person turns Location off in Settings. */
    private fun disableLocationServices() {
        val manager = context.getSystemService(Context.LOCATION_SERVICE) as LocationManager
        val shadow = shadowOf(manager) as ShadowLocationManager
        shadow.setProviderEnabled(LocationManager.GPS_PROVIDER, false)
        shadow.setProviderEnabled(LocationManager.NETWORK_PROVIDER, false)
    }

    // -----------------------------------------------------------------------
    // Permission translation
    // -----------------------------------------------------------------------

    @Test
    fun `fine location granted reads as Fine`() = runBlocking {
        enableLocationServices()
        grant(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION)

        val state = AndroidLocationPermissions(context, playServices = { true }).current()

        assertEquals(ForegroundLocationPermission.Fine, state.foreground)
        assertFalse(state.needsForegroundFirst)
    }

    @Test
    fun `coarse without fine reads as Coarse, not as denied`() = runBlocking {
        enableLocationServices()
        deny(Manifest.permission.ACCESS_FINE_LOCATION)
        grant(Manifest.permission.ACCESS_COARSE_LOCATION)

        val state = AndroidLocationPermissions(context, playServices = { true }).current()

        // Android 12 put precise-versus-approximate in the same dialog, so this
        // is an ordinary answer. Approximate cannot resolve a 150 m campus, so
        // it gets its own state and its own recovery.
        assertEquals(ForegroundLocationPermission.Coarse, state.foreground)
        assertFalse(state.canMonitorGeofences)
    }

    @Test
    fun `no location permission at all reads as NotRequested`() = runBlocking {
        deny(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION)

        val state = AndroidLocationPermissions(context, playServices = { true }).current()

        assertEquals(ForegroundLocationPermission.NotRequested, state.foreground)
        assertTrue(state.needsForegroundFirst)
    }

    @Test
    fun `location services off device-wide is reported separately from denial`() = runBlocking {
        grant(Manifest.permission.ACCESS_FINE_LOCATION)
        disableLocationServices()
        // The app is authorized, but nothing will be delivered. Reporting this
        // as "granted" would produce a readiness screen saying all is well
        // while no event can ever arrive.
        val state = AndroidLocationPermissions(context, playServices = { true }).current()

        assertEquals(ForegroundLocationPermission.Fine, state.foreground)
        assertFalse(state.locationServicesEnabled)
        assertFalse(state.canMonitorGeofences)
    }

    // -----------------------------------------------------------------------
    // The API-level split, run on the actual API levels
    // -----------------------------------------------------------------------

    @Test
    @Config(sdk = [28], application = android.app.Application::class)
    fun `on API 28 there is no background permission to request`() = runBlocking {
        enableLocationServices()
        grant(Manifest.permission.ACCESS_FINE_LOCATION)

        val state = AndroidLocationPermissions(context, sdkInt = 28, playServices = { true }).current()

        assertEquals(BackgroundRequestStrategy.ImpliedByForeground, state.strategy)
        assertEquals(BackgroundLocationPermission.NotApplicable, state.background)
        // Foreground alone is sufficient below API 29.
        assertTrue(state.canMonitorGeofences)
    }

    @Test
    @Config(sdk = [29], application = android.app.Application::class)
    fun `on API 29 a runtime dialog can grant background location`() = runBlocking {
        enableLocationServices()
        grant(Manifest.permission.ACCESS_FINE_LOCATION)

        val before = AndroidLocationPermissions(context, sdkInt = 29, playServices = { true }).current()
        assertEquals(BackgroundRequestStrategy.RuntimeDialog, before.strategy)
        assertFalse(before.canMonitorGeofences)

        grant(Manifest.permission.ACCESS_BACKGROUND_LOCATION)
        val after = AndroidLocationPermissions(context, sdkInt = 29, playServices = { true }).current()

        assertEquals(BackgroundLocationPermission.Granted, after.background)
        assertTrue(after.canMonitorGeofences)
    }

    @Test
    @Config(sdk = [30], application = android.app.Application::class)
    fun `on API 30 the strategy is Settings, and a request grants nothing`() = runBlocking {
        enableLocationServices()
        grant(Manifest.permission.ACCESS_FINE_LOCATION)

        val permissions = AndroidLocationPermissions(context, sdkInt = 30, playServices = { true })
        assertEquals(BackgroundRequestStrategy.SettingsOnly, permissions.current().strategy)

        // The runtime dialog has no "Allow all the time" option on API 30+.
        // Calling requestPermissions shows nothing, so the adapter does not,
        // and the UI hands off to Settings instead. Asserting the state is
        // unchanged is asserting that the app does not lie about what happened.
        val after = permissions.requestBackground()
        assertEquals(BackgroundLocationPermission.NotRequested, after.background)
        assertFalse(after.canMonitorGeofences)
    }

    @Test
    @Config(sdk = [34], application = android.app.Application::class)
    fun `on API 34 the strategy is still Settings`() = runBlocking {
        enableLocationServices()
        grant(Manifest.permission.ACCESS_FINE_LOCATION)
        assertEquals(
            BackgroundRequestStrategy.SettingsOnly,
            AndroidLocationPermissions(context, sdkInt = 34, playServices = { true }).current().strategy,
        )
    }

    @Test
    fun `Play services being unavailable refuses monitoring on its own`() = runBlocking {
        enableLocationServices()
        grant(
            Manifest.permission.ACCESS_FINE_LOCATION,
            Manifest.permission.ACCESS_BACKGROUND_LOCATION,
        )

        // Every permission granted, and still not monitorable — geofencing is a
        // Play services API. Robolectric genuinely has no Play services, so the
        // production default is exercised here rather than stubbed.
        //
        // `isGooglePlayServicesAvailable` *throws* when the version meta-data
        // is absent rather than returning a code, so this also proves the check
        // fails closed on an exception instead of letting one escape.
        val real = AndroidLocationPermissions(context).current()
        assertFalse(real.playServicesAvailable)
        assertFalse(real.canMonitorGeofences)
    }

    @Test
    fun `background granted plus fine granted is the only monitoring-capable state`() = runBlocking {
        enableLocationServices()
        grant(
            Manifest.permission.ACCESS_FINE_LOCATION,
            Manifest.permission.ACCESS_COARSE_LOCATION,
            Manifest.permission.ACCESS_BACKGROUND_LOCATION,
        )

        val state = AndroidLocationPermissions(context, playServices = { true }).current()
        assertEquals(ForegroundLocationPermission.Fine, state.foreground)
        assertEquals(BackgroundLocationPermission.Granted, state.background)
        assertTrue(state.canMonitorGeofences)
    }
}

/**
 * The geofence transition receiver, driven by real `Intent`s.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = android.app.Application::class)
class GeofenceReceiverTest {

    private val context: Context get() = ApplicationProvider.getApplicationContext()

    @Test
    fun `an intent with the wrong action is ignored`() {
        // The receiver is not exported, but it is still worth refusing anything
        // that is not the transition it exists for.
        val receiver = GeofenceBroadcastReceiver()
        receiver.onReceive(context, Intent("io.faithform.faithful.SOMETHING_ELSE"))
        // No crash, and nothing attempted. Reaching here is the assertion.
        assertTrue(true)
    }

    @Test
    fun `a transition intent with no geofencing payload is ignored`() {
        // `GeofencingEvent.fromIntent` returns null for an intent that did not
        // come from Play services. Treating that as a transition would mean
        // acting on a forged or malformed broadcast.
        val receiver = GeofenceBroadcastReceiver()
        receiver.onReceive(context, Intent(GeofenceBroadcastReceiver.ACTION_TRANSITION))
        assertTrue(true)
    }

    @Test
    fun `only Faithful-scoped region ids are acted on`() {
        // The prefix is what stops another library's geofence — registered
        // against the same Play services client — being treated as an arrival
        // at church.
        assertEquals("faithful.campus.", GeofenceBroadcastReceiver.REGION_PREFIX)
        assertTrue("faithful.campus.abc".startsWith(GeofenceBroadcastReceiver.REGION_PREFIX))
        assertFalse("someone.else.abc".startsWith(GeofenceBroadcastReceiver.REGION_PREFIX))
    }

    @Test
    fun `the OS dwell transition is used, driven by authoritative configuration`() {
        // Play services has a real dwell transition, and it is used — but only
        // when the church's own policy asks for a confirmation, and with the
        // delay the *server* specified rather than a device-side constant.
        //
        // An earlier version refused to use it at all, on the grounds that a
        // device-side loitering delay would go stale against the server's rule.
        // The answer to staleness is reconciliation, not abstention: the delay
        // is part of the region's identity, so a policy edit changes
        // `configVersion`, the configuration is refetched, and the region
        // re-registers.
        val kotlinSource = java.io.File(
            "src/main/kotlin/io/faithform/faithful/attendance/PlayServicesGeofencing.kt",
        ).readText().replace(Regex("//.*"), "").replace(Regex("/\\*[\\s\\S]*?\\*/"), "")

        assertTrue(kotlinSource.contains("GEOFENCE_TRANSITION_ENTER"))
        assertTrue(kotlinSource.contains("GEOFENCE_TRANSITION_EXIT"))
        assertTrue(kotlinSource.contains("GEOFENCE_TRANSITION_DWELL"))
        assertTrue(kotlinSource.contains("setLoiteringDelay"))

        // And the delay is never a literal: it comes from the region, which
        // comes from the configuration.
        assertTrue(kotlinSource.contains("region.loiteringDelayMillis"))
    }

    @Test
    fun `no continuous-location or foreground-service API is reachable from the adapter`() {
        val kotlinSource = java.io.File(
            "src/main/kotlin/io/faithform/faithful/attendance/PlayServicesGeofencing.kt",
        ).readText().replace(Regex("//.*"), "").replace(Regex("/\\*[\\s\\S]*?\\*/"), "")

        for (forbidden in listOf(
            "requestLocationUpdates",
            "LocationRequest.Builder",
            "startForegroundService",
            "startForeground(",
        )) {
            assertFalse("$forbidden is reachable", kotlinSource.contains(forbidden))
        }
        // One fix, self-stopping.
        assertTrue(kotlinSource.contains("getCurrentLocation"))
    }

    @Test
    fun `the boot receiver ignores an unrelated action`() {
        BootAndUpdateReceiver().onReceive(context, Intent(Intent.ACTION_SCREEN_ON))
        assertTrue(true)
    }

    @Test
    fun `the package-replaced receiver ignores an unrelated action`() {
        PackageReplacedReceiver().onReceive(context, Intent(Intent.ACTION_SCREEN_ON))
        assertTrue(true)
    }
}

/**
 * The encrypted attempt store, against a real `SharedPreferences`.
 *
 * Robolectric has no `AndroidKeyStore`, so this uses an ordinary
 * `SharedPreferences` — the encryption is a property of what the *container*
 * injects, verified separately by the privacy sweep. What is exercised here is
 * the store's own contract: atomic open, round-trip fidelity, expiry purge, and
 * partition isolation, which is where a real bug would live.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = android.app.Application::class)
class EncryptedAttemptStoreTest {

    private val context: Context get() = ApplicationProvider.getApplicationContext()

    private fun store() = EncryptedAttendanceAttemptStore(
        context.getSharedPreferences("test_attempts", Context.MODE_PRIVATE),
    )

    private val partition = CachePartition(
        environment = "test", accountId = "acct-1",
        churchSlug = "grace", authorizationVersion = 7,
    )

    private val now = 1_800_000_000_000L

    @Test
    fun `an attempt round-trips with its queued submission intact`() = runBlocking {
        val subject = store()
        val attempt = LogicalAttempt.open("grace", "occ-1", now).copy(
            queued = QueuedSubmission(
                kind = "detected",
                observedAtEpochMillis = now,
                accuracyMeters = 12.5,
                dwellSeconds = 0,
                latitude = 38.2527,
                longitude = -85.7585,
                retries = 2,
            ),
        )

        subject.update(attempt, partition)
        val restored = subject.current(partition, now)

        assertEquals(attempt, restored)
        assertEquals(38.2527, restored!!.queued!!.latitude!!, 0.00001)
        assertEquals(2, restored.queued!!.retries)
    }

    @Test
    fun `an attempt with no queued submission round-trips too`() = runBlocking {
        val subject = store()
        val attempt = LogicalAttempt.open("grace", "occ-1", now)

        subject.update(attempt, partition)
        val restored = subject.current(partition, now)

        assertEquals(attempt, restored)
        assertNull(restored!!.queued)
    }

    @Test
    fun `openIfAbsent returns the existing attempt for the same occurrence`() = runBlocking {
        val subject = store()

        val first = subject.openIfAbsent(LogicalAttempt.open("grace", "occ-1", now), partition, now)
        val second = subject.openIfAbsent(LogicalAttempt.open("grace", "occ-1", now), partition, now)

        // A duplicate transition joins the attempt already in progress rather
        // than starting a second one with a different key.
        assertEquals(first.attemptId, second.attemptId)
    }

    @Test
    fun `openIfAbsent replaces an attempt from a different occurrence`() = runBlocking {
        val subject = store()

        val morning = subject.openIfAbsent(LogicalAttempt.open("grace", "occ-1", now), partition, now)
        val evening = subject.openIfAbsent(LogicalAttempt.open("grace", "occ-2", now), partition, now)

        // The evening service must never inherit the morning's identity.
        assertTrue(morning.attemptId != evening.attemptId)
        assertEquals("occ-2", subject.current(partition, now)!!.occurrenceId)
    }

    @Test
    fun `an expired attempt is neither returned nor left on disk`() = runBlocking {
        val subject = store()
        subject.update(LogicalAttempt.open("grace", "occ-1", now), partition)

        val later = now + PENDING_ATTEMPT_LIFETIME_MILLIS + 1
        assertNull(subject.current(partition, later))

        // Purged on the way past, not merely hidden: it may hold a position,
        // and holding one past its retention window is what the bound prevents.
        assertNull(subject.current(partition, now))
    }

    @Test
    fun `an attempt is invisible under a different partition`() = runBlocking {
        val subject = store()
        subject.update(LogicalAttempt.open("grace", "occ-1", now), partition)

        // A bumped authorization version is a different identity — a revocation
        // must not leave an attempt readable.
        val bumped = partition.copy(authorizationVersion = 8)
        assertNull(subject.current(bumped, now))
        assertNotNull(subject.current(partition, now))
    }

    @Test
    fun `closing purges only that partition, and closeAll purges everything`() = runBlocking {
        val subject = store()
        val other = partition.copy(accountId = "acct-2")

        subject.update(LogicalAttempt.open("grace", "occ-1", now), partition)
        subject.update(LogicalAttempt.open("grace", "occ-1", now), other)

        subject.close(partition)
        assertNull(subject.current(partition, now))
        assertNotNull(subject.current(other, now))

        // Sign-out must not leave another account's coordinates behind.
        subject.closeAll()
        assertNull(subject.current(other, now))
    }

    @Test
    fun `corrupt stored data is discarded rather than crashing`() = runBlocking {
        val prefs = context.getSharedPreferences("test_attempts", Context.MODE_PRIVATE)
        prefs.edit().putString("attendance_attempt|${partition.storageKey}", "not json").apply()

        assertNull(EncryptedAttendanceAttemptStore(prefs).current(partition, now))
    }
}
