package io.faithform.faithful.attendance

import io.faithform.faithful.contract.AttendanceSourceAvailability
import io.faithform.faithful.contract.GeofenceConfiguration
import io.faithform.faithful.contract.GeofenceRegion
import io.faithform.faithful.storage.CachePartition
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

// ---------------------------------------------------------------------------
// Doubles
// ---------------------------------------------------------------------------

/**
 * A geofencing stand-in that records what was asked of it.
 *
 * The point of the abstraction: every API-level branch, every permission state
 * and every capacity case below runs under `gradle :core:attendance:test` on a
 * plain JVM — no emulator, no Play services, no movement.
 */
class FakeMonitor : RegionMonitoring {
    var regions: MutableSet<MonitoredRegion> = mutableSetOf()
    val startCalls = mutableListOf<List<String>>()
    val stopCalls = mutableListOf<List<String>>()

    override suspend fun monitoredRegions(): Set<MonitoredRegion> = regions.toSet()

    override suspend fun startMonitoring(regions: List<MonitoredRegion>) {
        startCalls += regions.map { it.identifier }
        // A re-registration replaces by identifier, exactly as the system does.
        for (region in regions) {
            this.regions.removeAll { it.identifier == region.identifier }
            this.regions += region
        }
    }

    override suspend fun stopMonitoring(identifiers: List<String>) {
        stopCalls += identifiers
        regions.removeAll { it.identifier in identifiers }
    }

    override suspend fun stopMonitoringAll() {
        if (regions.isNotEmpty()) stopCalls += regions.map { it.identifier }
        regions.clear()
    }
}

class FakePermissions(
    var state: LocationPermissionState = LocationPermissionState(
        foreground = ForegroundLocationPermission.Fine,
        background = BackgroundLocationPermission.Granted,
        strategy = BackgroundRequestStrategy.SettingsOnly,
    ),
) : LocationPermissions {
    /** Every prompt raised, in order. The heart of "never prompt at launch". */
    val prompts = mutableListOf<String>()

    var foregroundAnswer: ForegroundLocationPermission = ForegroundLocationPermission.Fine
    var backgroundAnswer: BackgroundLocationPermission = BackgroundLocationPermission.Granted

    override suspend fun current(): LocationPermissionState = state

    override suspend fun requestForeground(): LocationPermissionState {
        prompts += "foreground"
        state = state.copy(foreground = foregroundAnswer)
        return state
    }

    override suspend fun requestBackground(): LocationPermissionState {
        prompts += "background"
        // On API 30+ a runtime request grants nothing — the person must use
        // Settings — so the fake models that rather than pretending.
        if (state.strategy == BackgroundRequestStrategy.SettingsOnly) return state
        state = state.copy(background = backgroundAnswer)
        return state
    }
}

class ScriptedSource(var state: GeofenceConfigurationState) : ConfigurationSource {
    val calls = mutableListOf<Triple<String, String, Boolean>>()

    override suspend fun currentConfiguration(
        churchSlug: String,
        partition: CachePartition,
        nowEpochMillis: Long,
        forceRefresh: Boolean,
    ): GeofenceConfigurationState {
        calls += Triple(churchSlug, partition.storageKey, forceRefresh)
        return state
    }

    fun forcedCount(): Int = calls.count { it.third }
}

class ScriptedSubmitter : AttendanceSubmitter {
    val sent = mutableListOf<Pair<AttendanceEvidence, String>>()
    var occurrenceId: String? = "occ-1"
    var occurrenceThrows: Exception? = null
    var answers: MutableList<Result<AttendanceOutcome>> = mutableListOf()

    override suspend fun eligibleOccurrenceId(churchSlug: String): String? {
        occurrenceThrows?.let { throw it }
        return occurrenceId
    }

    override suspend fun submit(
        evidence: AttendanceEvidence,
        idempotencyKey: String,
    ): AttendanceOutcome {
        sent += evidence to idempotencyKey
        val answer = if (answers.size > 1) answers.removeAt(0) else answers.firstOrNull()
        return (answer ?: Result.success(COUNTED)).getOrThrow()
    }

    fun keys() = sent.map { it.second }
    fun phases() = sent.map { it.first.phase }
}

class MemoryStore : AttendanceAttemptStore {
    private val items = mutableMapOf<String, LogicalAttempt>()
    var opens = 0
        private set
    var closes = 0
        private set

    override suspend fun current(
        partition: CachePartition,
        nowEpochMillis: Long,
    ): LogicalAttempt? {
        val attempt = items[partition.storageKey] ?: return null
        if (attempt.isExpired(nowEpochMillis)) {
            items.remove(partition.storageKey)
            return null
        }
        return attempt
    }

    override suspend fun openIfAbsent(
        candidate: LogicalAttempt,
        partition: CachePartition,
        nowEpochMillis: Long,
    ): LogicalAttempt {
        val existing = current(partition, nowEpochMillis)
        if (existing != null &&
            existing.covers(candidate.churchSlug, candidate.occurrenceId, nowEpochMillis)
        ) {
            return existing
        }
        opens++
        items[partition.storageKey] = candidate
        return candidate
    }

    override suspend fun update(attempt: LogicalAttempt, partition: CachePartition) {
        items[partition.storageKey] = attempt
    }

    override suspend fun close(partition: CachePartition) {
        if (items.remove(partition.storageKey) != null) closes++
    }

    fun count() = items.size
    fun peek(partition: CachePartition) = items[partition.storageKey]
}

class FakeSampler(var sample: LocationSample? = SAMPLE) : LocationSampling {
    override suspend fun requestOneShotLocation(timeoutMillis: Long): LocationSample? = sample
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

val SAMPLE = LocationSample(
    latitude = 38.2527,
    longitude = -85.7585,
    accuracyMeters = 12f,
    capturedAtEpochMillis = 1_800_000_000_000,
)

val COUNTED = AttendanceOutcome("counted", "You're checked in.", "occ-1")
val ALREADY = AttendanceOutcome("already_counted", "Already checked in.", "occ-1")
val PENDING = AttendanceOutcome("pending_confirmation", "Nearly there.", "occ-1")

/** `pending_confirmation` with the server's instant and its detection. */
fun pendingUntil(epochMillis: Long, detectionId: String? = "detection-1") =
    PENDING.copy(
        confirmationNotBeforeEpochMillis = epochMillis,
        detectionId = detectionId,
    )
val REJECTED = AttendanceOutcome("rejected", "Not counted.", "occ-1")

val PARTITION = CachePartition(
    environment = "test", accountId = "acct-1", churchSlug = "grace", authorizationVersion = 7,
)

fun region(id: String, lat: Double = 38.2527, lon: Double = -85.7585, radius: Int = 150) =
    GeofenceRegion(
        regionId = id, campusName = "Main",
        latitude = lat, longitude = lon, radiusMeters = radius,
    )

fun configuration(
    regions: List<GeofenceRegion> = listOf(region("faithful.campus.a")),
    version: Int = 7003,
) = GeofenceConfiguration(
    churchSlug = "grace",
    regions = regions,
    windows = emptyList(),
    sources = AttendanceSourceAvailability(geofence = true, qr = false, manual = true),
    requiresConfirmation = true,
    minDwellSeconds = 120,
    maxLocationAccuracyM = 100,
    configVersion = version,
    expiresAt = "2026-08-30T13:30:00Z",
)

// ---------------------------------------------------------------------------
// Permissions — the API-level branches
// ---------------------------------------------------------------------------

class PermissionModelTest {

    @Test
    fun `background strategy differs by API level`() {
        // API 26-28: no such permission exists.
        assertEquals(BackgroundRequestStrategy.ImpliedByForeground, BackgroundRequestStrategy.forSdk(26))
        assertEquals(BackgroundRequestStrategy.ImpliedByForeground, BackgroundRequestStrategy.forSdk(28))

        // Android 10: a runtime dialog can grant "Allow all the time".
        assertEquals(BackgroundRequestStrategy.RuntimeDialog, BackgroundRequestStrategy.forSdk(29))

        // Android 11+: the dialog offers no such option; Settings is the only
        // route. An app that just calls requestPermissions here appears to do
        // nothing at all.
        assertEquals(BackgroundRequestStrategy.SettingsOnly, BackgroundRequestStrategy.forSdk(30))
        assertEquals(BackgroundRequestStrategy.SettingsOnly, BackgroundRequestStrategy.forSdk(34))
        assertEquals(BackgroundRequestStrategy.SettingsOnly, BackgroundRequestStrategy.forSdk(35))
    }

    @Test
    fun `below API 29 foreground permission is enough to monitor`() {
        val state = LocationPermissionState(
            foreground = ForegroundLocationPermission.Fine,
            background = BackgroundLocationPermission.NotApplicable,
            strategy = BackgroundRequestStrategy.ImpliedByForeground,
        )
        assertTrue(state.canMonitorGeofences)
    }

    @Test
    fun `on API 29 plus background must be granted separately`() {
        val notRequested = LocationPermissionState(
            foreground = ForegroundLocationPermission.Fine,
            background = BackgroundLocationPermission.NotRequested,
            strategy = BackgroundRequestStrategy.SettingsOnly,
        )
        assertFalse(notRequested.canMonitorGeofences)

        assertTrue(
            notRequested.copy(background = BackgroundLocationPermission.Granted).canMonitorGeofences,
        )
    }

    @Test
    fun `coarse-only permission cannot monitor a campus`() {
        // Android 12 put precise-versus-approximate in the same dialog, so this
        // is an ordinary answer. Approximate is city-block accurate; a campus
        // radius is 150 m.
        val coarse = LocationPermissionState(
            foreground = ForegroundLocationPermission.Coarse,
            background = BackgroundLocationPermission.Granted,
            strategy = BackgroundRequestStrategy.SettingsOnly,
        )
        assertFalse(coarse.canMonitorGeofences)
    }

    @Test
    fun `foreground must be resolved before background is asked`() {
        val state = LocationPermissionState(
            foreground = ForegroundLocationPermission.NotRequested,
            background = BackgroundLocationPermission.NotRequested,
            strategy = BackgroundRequestStrategy.SettingsOnly,
        )
        // Android rejects a background request outright without foreground.
        assertTrue(state.needsForegroundFirst)
        assertFalse(state.copy(foreground = ForegroundLocationPermission.Fine).needsForegroundFirst)
    }

    @Test
    fun `location services off or Play services missing both refuse`() {
        val base = LocationPermissionState(
            foreground = ForegroundLocationPermission.Fine,
            background = BackgroundLocationPermission.Granted,
            strategy = BackgroundRequestStrategy.SettingsOnly,
        )
        assertTrue(base.canMonitorGeofences)
        assertFalse(base.copy(locationServicesEnabled = false).canMonitorGeofences)
        assertFalse(base.copy(playServicesAvailable = false).canMonitorGeofences)
    }

    @Test
    fun `permanently denied is distinct from denied`() {
        // Asking again does nothing after "Don't ask again", so the only honest
        // action is a Settings link — different copy, different button.
        assertNotEquals(
            ForegroundLocationPermission.Denied,
            ForegroundLocationPermission.PermanentlyDenied,
        )
    }

    @Test
    fun `an OS permission is not server consent`() {
        val permitted = LocationPermissionState(
            foreground = ForegroundLocationPermission.Fine,
            background = BackgroundLocationPermission.Granted,
            strategy = BackgroundRequestStrategy.SettingsOnly,
        )

        // Permission granted, consent withdrawn: not operational.
        assertFalse(
            AutomaticAttendanceSettings(enabled = true, serverConsent = "revoked")
                .isOperational(permitted),
        )
        // Consent granted, permission missing: also not operational.
        assertFalse(
            AutomaticAttendanceSettings(enabled = true, serverConsent = "granted")
                .isOperational(permitted.copy(background = BackgroundLocationPermission.Denied)),
        )
        // Both, plus the person's own toggle.
        assertTrue(
            AutomaticAttendanceSettings(enabled = true, serverConsent = "granted")
                .isOperational(permitted),
        )
        assertFalse(
            AutomaticAttendanceSettings(enabled = false, serverConsent = "granted")
                .isOperational(permitted),
        )
    }

    @Test
    fun `nothing is requested until the person asks`() = runTest {
        val permissions = FakePermissions(
            LocationPermissionState(
                foreground = ForegroundLocationPermission.NotRequested,
                background = BackgroundLocationPermission.NotRequested,
                strategy = BackgroundRequestStrategy.SettingsOnly,
            ),
        )
        val monitor = FakeMonitor()
        val reconciler = GeofenceReconciler(monitor, permissions, ScriptedSource(GeofenceConfigurationState.Unavailable))

        // Everything an app does on launch and while browsing.
        reconciler.bind(PARTITION, "grace", enabled = false)
        reconciler.reconcile(ReconcileTrigger.Foreground)
        permissions.current()

        assertTrue("a prompt was raised before the person agreed", permissions.prompts.isEmpty())
    }

    @Test
    fun `the progression is foreground then background, never the reverse`() = runTest {
        val permissions = FakePermissions(
            LocationPermissionState(
                foreground = ForegroundLocationPermission.NotRequested,
                background = BackgroundLocationPermission.NotRequested,
                strategy = BackgroundRequestStrategy.RuntimeDialog,
            ),
        )

        permissions.requestForeground()
        assertEquals(listOf("foreground"), permissions.prompts)
        assertFalse(permissions.state.needsForegroundFirst)

        permissions.requestBackground()
        assertEquals(listOf("foreground", "background"), permissions.prompts)
        assertTrue(permissions.state.canMonitorGeofences)
    }

    @Test
    fun `on Android 11 plus a background request grants nothing`() = runTest {
        val permissions = FakePermissions(
            LocationPermissionState(
                foreground = ForegroundLocationPermission.Fine,
                background = BackgroundLocationPermission.NotRequested,
                strategy = BackgroundRequestStrategy.SettingsOnly,
            ),
        )

        val after = permissions.requestBackground()

        // The runtime dialog has no "Allow all the time" option on API 30+.
        // The app must educate and send the person to Settings; claiming the
        // request did something would be a lie in the UI.
        assertEquals(BackgroundLocationPermission.NotRequested, after.background)
        assertFalse(after.canMonitorGeofences)
    }
}

// ---------------------------------------------------------------------------
// Reconciliation
// ---------------------------------------------------------------------------

class ReconcilerTest {
    private fun make(
        monitor: FakeMonitor = FakeMonitor(),
        permissions: FakePermissions = FakePermissions(),
        source: ScriptedSource = ScriptedSource(GeofenceConfigurationState.Available(configuration())),
    ) = Triple(GeofenceReconciler(monitor, permissions, source), monitor, source)

    @Test
    fun `registers exactly what the server authorizes`() = runTest {
        val (reconciler, monitor, _) = make(
            source = ScriptedSource(
                GeofenceConfigurationState.Available(
                    configuration(listOf(region("a"), region("b", lat = 39.0))),
                ),
            ),
        )
        reconciler.bind(PARTITION, "grace", enabled = true)

        val outcome = reconciler.reconcile(ReconcileTrigger.OptIn)

        assertEquals(listOf("a", "b"), outcome.added)
        assertEquals(2, outcome.monitoring)
        assertEquals(2, monitor.regions.size)
    }

    @Test
    fun `reconciling twice changes nothing the second time`() = runTest {
        val (reconciler, monitor, _) = make()
        reconciler.bind(PARTITION, "grace", enabled = true)
        reconciler.reconcile(ReconcileTrigger.OptIn)
        val startsBefore = monitor.startCalls.size

        for (trigger in listOf(
            ReconcileTrigger.Foreground,
            ReconcileTrigger.PermissionChanged,
            ReconcileTrigger.ConfigurationRefreshed,
        )) {
            val outcome = reconciler.reconcile(trigger)
            assertFalse("$trigger re-registered", outcome.changedAnything)
        }
        assertEquals(startsBefore, monitor.startCalls.size)
    }

    @Test
    fun `a moved campus is re-registered and an unchanged one is left alone`() = runTest {
        val source = ScriptedSource(
            GeofenceConfigurationState.Available(
                configuration(listOf(region("a"), region("b", lat = 39.0))),
            ),
        )
        val (reconciler, _, _) = make(source = source)
        reconciler.bind(PARTITION, "grace", enabled = true)
        reconciler.reconcile(ReconcileTrigger.OptIn)

        source.state = GeofenceConfigurationState.Available(
            configuration(listOf(region("a", lat = 40.0), region("b", lat = 39.0))),
        )
        val outcome = reconciler.reconcile(ReconcileTrigger.ConfigurationRefreshed)

        assertEquals(listOf("a"), outcome.updated)
        assertTrue(outcome.added.isEmpty())
        assertTrue(outcome.removed.isEmpty())
    }

    @Test
    fun `a region the server withdrew is removed`() = runTest {
        val source = ScriptedSource(
            GeofenceConfigurationState.Available(
                configuration(listOf(region("a"), region("b", lat = 39.0))),
            ),
        )
        val (reconciler, monitor, _) = make(source = source)
        reconciler.bind(PARTITION, "grace", enabled = true)
        reconciler.reconcile(ReconcileTrigger.OptIn)

        source.state = GeofenceConfigurationState.Available(configuration(listOf(region("a"))))
        val outcome = reconciler.reconcile(ReconcileTrigger.ConfigurationRefreshed)

        assertEquals(listOf("b"), outcome.removed)
        assertEquals(1, monitor.regions.size)
    }

    @Test
    fun `capacity is bounded and the selection is deterministic`() = runTest {
        val many = (0 until 35).map {
            region(String.format("faithful.campus.%02d", it), lat = 38.0 + it / 100.0)
        }
        val (reconciler, _, _) = make(
            source = ScriptedSource(GeofenceConfigurationState.Available(configuration(many))),
        )
        reconciler.bind(PARTITION, "grace", enabled = true)

        val outcome = reconciler.reconcile(ReconcileTrigger.OptIn)

        assertEquals(MONITORED_REGION_LIMIT, outcome.monitoring)
        assertEquals(20, MONITORED_REGION_LIMIT)
        assertEquals(15, outcome.droppedForCapacity.size)
        // Android permits 100, but the shared cap keeps both platforms on the
        // same set for the same church.
        assertEquals(100, ANDROID_GEOFENCE_LIMIT)
        assertTrue(MONITORED_REGION_LIMIT <= ANDROID_GEOFENCE_LIMIT)

        // The same configuration selects the same 20 every time, on every
        // device. A proximity rule would not, and could not be reproduced.
        val again = GeofenceReconciler.selectRegions(configuration(many))
        assertEquals(outcome.added, again.map { it.identifier })
    }

    @Test
    fun `invalid geometry is dropped rather than registered`() {
        val selected = GeofenceReconciler.selectRegions(
            configuration(
                listOf(
                    region("good"),
                    region("bad-lat", lat = 91.0),
                    region("bad-lon", lon = 181.0),
                    region("bad-radius", radius = 0),
                ),
            ),
        )
        assertEquals(listOf("good"), selected.map { it.identifier })
    }

    @Test
    fun `losing background permission removes every region`() = runTest {
        val permissions = FakePermissions()
        val (reconciler, monitor, _) = make(permissions = permissions)
        reconciler.bind(PARTITION, "grace", enabled = true)
        reconciler.reconcile(ReconcileTrigger.OptIn)
        assertEquals(1, monitor.regions.size)

        permissions.state = permissions.state.copy(background = BackgroundLocationPermission.Denied)
        val outcome = reconciler.reconcile(ReconcileTrigger.PermissionChanged)

        assertEquals("needs_background_permission", outcome.refusal)
        assertTrue(monitor.regions.isEmpty())
    }

    @Test
    fun `dropping to coarse permission removes every region`() = runTest {
        val permissions = FakePermissions()
        val (reconciler, monitor, _) = make(permissions = permissions)
        reconciler.bind(PARTITION, "grace", enabled = true)
        reconciler.reconcile(ReconcileTrigger.OptIn)

        permissions.state = permissions.state.copy(foreground = ForegroundLocationPermission.Coarse)
        val outcome = reconciler.reconcile(ReconcileTrigger.PermissionChanged)

        assertEquals("needs_full_accuracy", outcome.refusal)
        assertTrue(monitor.regions.isEmpty())
    }

    @Test
    fun `Play services becoming unavailable removes every region`() = runTest {
        val permissions = FakePermissions()
        val (reconciler, monitor, _) = make(permissions = permissions)
        reconciler.bind(PARTITION, "grace", enabled = true)
        reconciler.reconcile(ReconcileTrigger.OptIn)

        permissions.state = permissions.state.copy(playServicesAvailable = false)
        val outcome = reconciler.reconcile(ReconcileTrigger.PermissionChanged)

        assertEquals("play_services_unavailable", outcome.refusal)
        assertTrue(monitor.regions.isEmpty())
    }

    @Test
    fun `every server refusal removes every region`() = runTest {
        val source = ScriptedSource(GeofenceConfigurationState.Available(configuration()))
        val (reconciler, monitor, _) = make(source = source)
        reconciler.bind(PARTITION, "grace", enabled = true)

        for (reason in listOf("consent_required", "no_people_link", "geofence_disabled", "not_enrolled")) {
            source.state = GeofenceConfigurationState.Available(configuration())
            reconciler.reconcile(ReconcileTrigger.ConfigurationRefreshed)

            source.state = GeofenceConfigurationState.Refused(reason)
            val outcome = reconciler.reconcile(ReconcileTrigger.ConfigurationRefreshed)

            assertEquals(reason, outcome.refusal)
            assertTrue("$reason left regions registered", monitor.regions.isEmpty())
        }
    }

    @Test
    fun `switching church clears the previous church first`() = runTest {
        val source = ScriptedSource(
            GeofenceConfigurationState.Available(configuration(listOf(region("grace-a")))),
        )
        val (reconciler, monitor, _) = make(source = source)
        reconciler.bind(PARTITION, "grace", enabled = true)
        reconciler.reconcile(ReconcileTrigger.OptIn)

        source.state = GeofenceConfigurationState.Available(configuration(listOf(region("hope-a"))))
        reconciler.bind(PARTITION, "hope", enabled = true)

        // Binding alone removes them, before any new configuration arrives.
        assertTrue(monitor.regions.isEmpty())

        val outcome = reconciler.reconcile(ReconcileTrigger.ChurchChanged)
        assertEquals(listOf("hope-a"), outcome.added)
    }

    @Test
    fun `an authorization-version bump is a different identity`() = runTest {
        val (reconciler, monitor, _) = make()
        reconciler.bind(PARTITION, "grace", enabled = true)
        reconciler.reconcile(ReconcileTrigger.OptIn)

        reconciler.bind(PARTITION.copy(authorizationVersion = 8), "grace", enabled = true)
        assertTrue(monitor.regions.isEmpty())
    }

    @Test
    fun `signing out removes everything`() = runTest {
        val (reconciler, monitor, _) = make()
        reconciler.bind(PARTITION, "grace", enabled = true)
        reconciler.reconcile(ReconcileTrigger.OptIn)

        reconciler.teardown()
        assertTrue(monitor.regions.isEmpty())
        assertFalse(reconciler.isEnabled())
    }

    @Test
    fun `a reboot re-registers everything, because the system kept nothing`() = runTest {
        val monitor = FakeMonitor()
        val (reconciler, _, _) = make(monitor = monitor)
        reconciler.bind(PARTITION, "grace", enabled = true)
        reconciler.reconcile(ReconcileTrigger.OptIn)

        // Geofences do not survive a reboot: the system holds nothing, and the
        // app must re-register on BOOT_COMPLETED. Simulated exactly.
        monitor.regions.clear()

        val outcome = reconciler.reconcile(ReconcileTrigger.BootOrUpdate)

        assertEquals(listOf("faithful.campus.a"), outcome.added)
        assertEquals(1, monitor.regions.size)
    }

    @Test
    fun `a reboot forces a configuration refresh rather than trusting the cache`() = runTest {
        val source = ScriptedSource(GeofenceConfigurationState.Available(configuration()))
        val (reconciler, _, _) = make(source = source)
        reconciler.bind(PARTITION, "grace", enabled = true)

        reconciler.reconcile(ReconcileTrigger.Foreground)
        assertEquals(0, source.forcedCount())

        // Access may have been revoked while the device was off.
        reconciler.reconcile(ReconcileTrigger.BootOrUpdate)
        assertEquals(1, source.forcedCount())
    }

    @Test
    fun `a region event forces a configuration refresh`() = runTest {
        val source = ScriptedSource(GeofenceConfigurationState.Available(configuration()))
        val (reconciler, _, _) = make(source = source)
        reconciler.bind(PARTITION, "grace", enabled = true)

        reconciler.reconcile(ReconcileTrigger.Foreground)
        assertEquals(0, source.forcedCount())

        reconciler.reconcile(ReconcileTrigger.RegionEvent)
        assertEquals(1, source.forcedCount())
    }

    @Test
    fun `being offline leaves a working setup alone`() = runTest {
        val source = ScriptedSource(GeofenceConfigurationState.Available(configuration()))
        val (reconciler, monitor, _) = make(source = source)
        reconciler.bind(PARTITION, "grace", enabled = true)
        reconciler.reconcile(ReconcileTrigger.OptIn)

        source.state = GeofenceConfigurationState.Unavailable
        val outcome = reconciler.reconcile(ReconcileTrigger.Foreground)

        assertEquals("configuration_unavailable", outcome.refusal)
        // One failed request must not disable a feature that was working.
        assertEquals(1, monitor.regions.size)
    }

    @Test
    fun `concurrent reconciliations do not interleave`() = runTest {
        val monitor = FakeMonitor()
        val (reconciler, _, _) = make(monitor = monitor)
        reconciler.bind(PARTITION, "grace", enabled = true)

        // A boot broadcast arriving while the app foregrounds.
        val results = listOf(
            async { reconciler.reconcile(ReconcileTrigger.OptIn) },
            async { reconciler.reconcile(ReconcileTrigger.Foreground) },
            async { reconciler.reconcile(ReconcileTrigger.BootOrUpdate) },
        ).awaitAll()

        // Exactly one region, however the passes interleaved.
        assertEquals(1, monitor.regions.size)
        assertTrue(results.all { it.refusal == null })
    }
}

// ---------------------------------------------------------------------------
// Evidence and submission
// ---------------------------------------------------------------------------

class EvidenceTestHarness(
    val monitor: FakeMonitor = FakeMonitor(),
    val permissions: FakePermissions = FakePermissions(),
    val source: ScriptedSource = ScriptedSource(
        GeofenceConfigurationState.Available(configuration()),
    ),
    val submitter: ScriptedSubmitter = ScriptedSubmitter(),
    val sampler: FakeSampler = FakeSampler(),
    val store: MemoryStore = MemoryStore(),
    var now: Long = 1_800_000_000_000,
    /** Scripted attempt ids, so a test can name them. */
    val ids: MutableList<String> = mutableListOf(),
) {
    val reconciler = GeofenceReconciler(monitor, permissions, source) { now }
    val coordinator = AutomaticAttendanceCoordinator(
        reconciler, submitter, sampler, store, permissions,
        clock = { now },
        newAttemptId = { ids.removeFirstOrNull() ?: LogicalAttempt.newAttemptId() },
    )

    suspend fun start(): EvidenceTestHarness {
        reconciler.bind(PARTITION, "grace", enabled = true)
        coordinator.bind(
            PARTITION, "acct-1",
            AutomaticAttendanceSettings(
                enabled = true, serverConsent = "granted", churchSlug = "grace",
            ),
        )
        return this
    }
}

class EvidenceTest {
    @Test
    fun `a transition produces one detected attempt with server-checkable evidence`() = runTest {
        val h = EvidenceTestHarness().start()
        h.submitter.answers = mutableListOf(Result.success(PENDING))

        val phase = h.coordinator.handleRegionEntered("faithful.campus.a")

        assertEquals(1, h.submitter.sent.size)
        val evidence = h.submitter.sent[0].first
        assertEquals("detected", evidence.phase)
        assertEquals("occ-1", evidence.occurrenceId)
        // Coordinates are sent so the *server* can band them. The client never
        // computes or claims a distance.
        assertEquals(38.2527, evidence.latitude!!, 0.0001)
        assertEquals(12.0, evidence.accuracyMeters!!, 0.01)
        assertTrue(phase is EvidencePhase.AwaitingDwell)
    }

    @Test
    fun `success is only ever a server verdict`() = runTest {
        val h = EvidenceTestHarness().start()
        h.submitter.answers = mutableListOf(Result.success(COUNTED))

        val phase = h.coordinator.handleRegionEntered("r")
        assertEquals(EvidencePhase.Counted("occ-1", false), phase)
        assertTrue(phase.isSuccess)

        // No other phase reads as success, including the encouraging ones.
        assertFalse(EvidencePhase.Entered("r", 0).isSuccess)
        assertFalse(EvidencePhase.AwaitingDwell("o", 0).isSuccess)
        assertFalse(EvidencePhase.Confirming("o").isSuccess)
        assertFalse(EvidencePhase.Reauthorizing("r").isSuccess)
    }

    @Test
    fun `already counted is a success, not an error`() = runTest {
        val h = EvidenceTestHarness().start()
        h.submitter.answers = mutableListOf(Result.success(ALREADY))

        val phase = h.coordinator.handleRegionEntered("r")
        assertEquals(EvidencePhase.Counted("occ-1", true), phase)
        assertTrue(phase.isSuccess)
    }

    @Test
    fun `duplicate transitions produce one logical attempt`() = runTest {
        val h = EvidenceTestHarness().start()
        h.submitter.answers = mutableListOf(Result.success(COUNTED))

        // The system re-delivers, and a person in a doorway crosses repeatedly.
        (0 until 8).map { async { h.coordinator.handleRegionEntered("r") } }.awaitAll()

        assertTrue(
            "sent ${h.submitter.sent.size} attempts",
            h.submitter.phases().count { it == "detected" } <= 1,
        )
    }

    @Test
    fun `sequential re-entries after a count send nothing further`() = runTest {
        val h = EvidenceTestHarness().start()
        h.submitter.answers = mutableListOf(Result.success(COUNTED))

        // The real pattern: someone lingers near the door and the system
        // delivers ENTER again minutes later. The in-flight flag does not help
        // here, because nothing is in flight any more.
        repeat(5) {
            val phase = h.coordinator.handleRegionEntered("r")
            assertTrue(phase.isSuccess)
        }

        assertEquals("re-entry cost ${h.submitter.sent.size} submissions", 1, h.submitter.sent.size)
    }

    @Test
    fun `a different service on the same day is not suppressed`() = runTest {
        val h = EvidenceTestHarness().start()
        h.submitter.answers = mutableListOf(Result.success(COUNTED))

        h.coordinator.handleRegionEntered("r")
        assertEquals(1, h.submitter.sent.size)

        // The evening service. Suppressing this would lose real attendance.
        h.submitter.occurrenceId = "occ-2"
        h.submitter.answers = mutableListOf(Result.success(COUNTED))
        val phase = h.coordinator.handleRegionEntered("r")

        assertEquals(EvidencePhase.Counted("occ-2", false), phase)
        assertEquals(2, h.submitter.sent.size)
    }

    @Test
    fun `the key is derived from the logical attempt, not from the occurrence`() {
        val base = IdempotencyKey.geofence("acct-1", "grace", "occ-1", "aaa", "confirm")

        // Every input changes it.
        assertNotEquals(base, IdempotencyKey.geofence("acct-2", "grace", "occ-1", "aaa", "confirm"))
        assertNotEquals(base, IdempotencyKey.geofence("acct-1", "hope", "occ-1", "aaa", "confirm"))
        assertNotEquals(base, IdempotencyKey.geofence("acct-1", "grace", "occ-2", "aaa", "confirm"))
        assertNotEquals(base, IdempotencyKey.geofence("acct-1", "grace", "occ-1", "bbb", "confirm"))
        assertNotEquals(base, IdempotencyKey.geofence("acct-1", "grace", "occ-1", "aaa", "detected"))

        // And it is stable for identical inputs.
        assertEquals(base, IdempotencyKey.geofence("acct-1", "grace", "occ-1", "aaa", "confirm"))
        assertTrue(base.startsWith("gf-"))
        assertTrue(base.length <= 45)
    }

    @Test
    fun `the key construction matches iOS byte for byte`() {
        // The same person on an iPhone and an Android phone must produce the
        // same key for the same intent. Pinned so a change on one platform
        // cannot silently diverge.
        val key = IdempotencyKey.geofence("acct-1", "grace", "occ-1", "aaa", "confirm")
        val expected = "gf-" + java.security.MessageDigest.getInstance("SHA-256")
            .digest("faithful.geofence.v2|acct-1|grace|occ-1|aaa|confirm".toByteArray())
            .joinToString("") { "%02x".format(it) }
            .take(40)
        assertEquals(expected, key)
    }

    @Test
    fun `an attempt id is random, unguessable and not a tracking identifier`() {
        val ids = (0 until 200).map { LogicalAttempt.newAttemptId() }
        // 128 bits, hex, from SecureRandom.
        assertTrue(ids.all { it.length == 32 })
        assertTrue(ids.all { id -> id.all { it in "0123456789abcdef" } })
        // No collisions, and nothing derived from the account or the device.
        assertEquals(200, ids.toSet().size)
    }

    // -----------------------------------------------------------------
    // 1 & 7 — one attempt, one key
    // -----------------------------------------------------------------

    @Test
    fun `duplicate callbacks reuse one attempt and one key`() = runTest {
        val h = EvidenceTestHarness().start()
        h.submitter.answers = mutableListOf(Result.success(PENDING))

        (0 until 6).map { async { h.coordinator.handleRegionEntered("r") } }.awaitAll()

        assertEquals("opened ${h.store.opens} attempts", 1, h.store.opens)
        assertTrue("used ${h.submitter.keys().toSet().size} keys", h.submitter.keys().toSet().size <= 1)
    }

    @Test
    fun `two simultaneous callbacks create one pending attempt`() = runTest {
        val store = MemoryStore()
        val now = 1_800_000_000_000

        // Straight at the store, so the race is on its own atomicity.
        val opened = (0 until 10).map {
            async {
                store.openIfAbsent(
                    LogicalAttempt.open("grace", "occ-1", now), PARTITION, now,
                )
            }
        }.awaitAll()

        assertEquals(1, opened.map { it.attemptId }.toSet().size)
        assertEquals(1, store.count())
    }

    // -----------------------------------------------------------------
    // 2 & 3 — restart and transient failure reuse the key
    // -----------------------------------------------------------------

    @Test
    fun `a restart during a pending attempt reuses the key`() = runTest {
        val store = MemoryStore()

        val first = EvidenceTestHarness(store = store).start()
        first.submitter.answers = mutableListOf(
            Result.failure(TransientAttendanceFailure("offline")),
        )
        first.coordinator.handleRegionEntered("r")
        val heldKey = first.submitter.keys().first()
        assertNotNull(store.peek(PARTITION))

        // A whole new coordinator, as after the process was killed.
        val second = EvidenceTestHarness(store = store).start()
        second.submitter.answers = mutableListOf(Result.success(COUNTED))
        second.coordinator.flushPending()

        assertEquals("a restart must reuse the key", heldKey, second.submitter.keys().last())
    }

    @Test
    fun `a transient network failure reuses the key`() = runTest {
        val h = EvidenceTestHarness().start()
        h.submitter.answers = mutableListOf(
            Result.failure(TransientAttendanceFailure("offline")),
            Result.success(COUNTED),
        )

        h.coordinator.handleRegionEntered("r")
        h.coordinator.flushPending()

        val keys = h.submitter.keys()
        assertEquals(2, keys.size)
        assertEquals("a retry must reuse the key", keys[0], keys[1])
        assertEquals("a counted attempt must be closed", 0, h.store.count())
    }

    // -----------------------------------------------------------------
    // 4, 5, 6 — THE REGRESSION
    // -----------------------------------------------------------------

    @Test
    fun `a terminally refused attempt is closed`() = runTest {
        val h = EvidenceTestHarness().start()
        h.submitter.answers = mutableListOf(Result.success(REJECTED))

        h.coordinator.handleRegionEntered("r")

        assertEquals("a refused attempt must not stay open", 0, h.store.count())
        assertTrue(h.store.closes >= 1)
    }

    @Test
    fun `an outside_region refusal does NOT poison the rest of the service`() = runTest {
        // The regression this whole redesign exists for.
        //
        // Someone walks up with a cold GPS fix and is refused `outside_region`.
        // They walk inside, the fix sharpens, and the system delivers another
        // transition. Under the old key — derived from the occurrence alone —
        // the server replayed the refusal for the rest of the morning and the
        // person could never be counted.
        val h = EvidenceTestHarness(ids = mutableListOf("attempt-one", "attempt-two")).start()
        h.submitter.answers = mutableListOf(
            Result.success(REJECTED),
            Result.success(COUNTED),
        )

        val firstPhase = h.coordinator.handleRegionEntered("r")
        assertEquals(EvidencePhase.Refused(EvidenceRefusal.Unknown), firstPhase)

        // A verified exit — the person left and came back. A meaningful trigger,
        // so the cooldown is bypassed and a new attempt opens.
        h.coordinator.handleRegionExited("r")
        val secondPhase = h.coordinator.handleRegionEntered("r")

        val keys = h.submitter.keys()
        assertEquals(2, keys.size)
        assertNotEquals("the second entry reused the poisoned key", keys[0], keys[1])

        // It was revalidated and it succeeded.
        assertEquals(EvidencePhase.Counted("occ-1", false), secondPhase)
        assertTrue(secondPhase.isSuccess)
    }

    @Test
    fun `a refused attempt does not settle the occurrence`() = runTest {
        val h = EvidenceTestHarness().start()
        h.submitter.answers = mutableListOf(Result.success(REJECTED))

        h.coordinator.handleRegionEntered("r")

        // A second identical entry is *held*, not resubmitted — the reading has
        // not changed, so sending again would spend a submission on the same
        // doomed evidence.
        val held = h.coordinator.handleRegionEntered("r")
        assertTrue("expected a hold, got $held", held is EvidencePhase.Holding)
        assertEquals(1, h.submitter.sent.size)

        // But it is a hold, not a lockout: an exit and re-entry proceeds.
        h.coordinator.handleRegionExited("r")
        h.coordinator.handleRegionEntered("r")
        assertEquals("the occurrence was locked out", 2, h.submitter.sent.size)
    }

    @Test
    fun `a flapping boundary is held, never locked out`() = runTest {
        val h = EvidenceTestHarness().start()
        h.submitter.answers = mutableListOf(Result.success(REJECTED))

        // Twenty callbacks in quick succession, as a flapping boundary produces.
        repeat(20) {
            h.coordinator.handleRegionEntered("r")
            h.now += 1000
        }

        assertTrue(
            "a flapping boundary sent ${h.submitter.sent.size} submissions",
            h.submitter.sent.size <= 3,
        )
        // Held, not terminally refused — the occurrence is still available.
        assertFalse(
            "a flapping boundary produced a terminal refusal",
            h.coordinator.phase is EvidencePhase.Refused,
        )
    }

    @Test
    fun `THE REGRESSION - five refusals, then a real re-entry counts`() = runTest {
        val h = EvidenceTestHarness().start()
        h.sampler.sample = SAMPLE.copy(accuracyMeters = 140f)
        h.submitter.answers = mutableListOf(Result.success(REJECTED))

        // Five poor readings, spaced past each cooldown.
        repeat(5) {
            h.coordinator.handleRegionEntered("r")
            h.now += AttemptPolicy.MAX_COOLDOWN_MILLIS + 1
        }
        assertEquals("expected five refusals", 5, h.submitter.sent.size)

        // The person walks inside. The fix sharpens dramatically.
        h.sampler.sample = SAMPLE.copy(accuracyMeters = 8f)
        h.submitter.answers = mutableListOf(Result.success(COUNTED))

        val phase = h.coordinator.handleRegionEntered("r")

        // Validated afresh, and counted.
        assertEquals(EvidencePhase.Counted("occ-1", false), phase)
        val keys = h.submitter.keys()
        assertEquals("an idempotency key was reused across attempts", keys.size, keys.toSet().size)

        // And exactly once: a further entry sends nothing.
        h.coordinator.handleRegionEntered("r")
        assertEquals(6, h.submitter.sent.size)
    }

    // -----------------------------------------------------------------
    // 8 & 9
    // -----------------------------------------------------------------

    @Test
    fun `counted suppresses later submissions for that occurrence`() = runTest {
        val h = EvidenceTestHarness().start()
        h.submitter.answers = mutableListOf(Result.success(COUNTED))

        repeat(5) { assertTrue(h.coordinator.handleRegionEntered("r").isSuccess) }
        assertEquals(1, h.submitter.sent.size)
    }

    @Test
    fun `already counted also suppresses without incrementing anything`() = runTest {
        val h = EvidenceTestHarness().start()
        h.submitter.answers = mutableListOf(Result.success(ALREADY))

        repeat(4) { h.coordinator.handleRegionEntered("r") }
        assertEquals(1, h.submitter.sent.size)
        assertTrue(h.coordinator.phase.isSuccess)
    }

    @Test
    fun `an expired pending attempt is purged and never sent`() = runTest {
        val h = EvidenceTestHarness().start()
        h.submitter.answers = mutableListOf(
            Result.failure(TransientAttendanceFailure("offline")),
        )

        h.coordinator.handleRegionEntered("r")
        assertEquals(1, h.store.count())

        h.now += PENDING_ATTEMPT_LIFETIME_MILLIS + 1
        val phase = h.coordinator.flushPending()

        assertEquals(EvidencePhase.Refused(EvidenceRefusal.Expired), phase)
        assertEquals("an expired attempt must be purged", 0, h.store.count())
        assertEquals("nothing may be sent after expiry", 1, h.submitter.sent.size)
    }

    @Test
    fun `an attempt never inherits another occurrence or church`() = runTest {
        val store = MemoryStore()
        val now = 1_800_000_000_000

        val morning = store.openIfAbsent(LogicalAttempt.open("grace", "occ-1", now), PARTITION, now)
        val evening = store.openIfAbsent(LogicalAttempt.open("grace", "occ-2", now), PARTITION, now)
        assertNotEquals(morning.attemptId, evening.attemptId)

        val other = store.openIfAbsent(LogicalAttempt.open("hope", "occ-2", now), PARTITION, now)
        assertNotEquals(evening.attemptId, other.attemptId)
    }

    @Test
    fun `dwell completes into a counted result`() = runTest {
        val h = EvidenceTestHarness().start()
        h.submitter.answers = mutableListOf(Result.success(PENDING), Result.success(COUNTED))

        h.coordinator.handleRegionEntered("r")
        val phase = h.coordinator.confirmDwell("occ-1", 180)

        assertEquals(EvidencePhase.Counted("occ-1", false), phase)
        assertEquals("confirm", h.submitter.sent[1].first.phase)
        assertEquals(180, h.submitter.sent[1].first.dwellSeconds)
    }

    @Test
    fun `no in-memory timer spans a dwell`() = runTest {
        val h = EvidenceTestHarness().start()
        h.submitter.answers = mutableListOf(Result.success(PENDING))

        val phase = h.coordinator.handleRegionEntered("r")

        // The flow stops at AwaitingDwell and returns. It does not delay and
        // does not hold a `goAsync` receiver open — which has roughly ten
        // seconds regardless, and a coroutine delay would not survive the
        // process being killed.
        assertTrue(phase is EvidencePhase.AwaitingDwell)
        assertEquals(1, h.submitter.sent.size)
    }

    @Test
    fun `a confirmation with no surviving attempt fails safely`() = runTest {
        val h = EvidenceTestHarness().start()
        h.submitter.answers = mutableListOf(Result.success(PENDING))

        h.coordinator.handleRegionEntered("r")
        // The process was killed and the attempt expired before any wake came.
        h.store.close(PARTITION)

        val phase = h.coordinator.confirmDwell("occ-1", 180)

        assertEquals(EvidencePhase.Refused(EvidenceRefusal.Expired), phase)
        // No second submission with a fabricated identity.
        assertEquals(1, h.submitter.sent.size)
    }

    @Test
    fun `a confirmation for a different occurrence is refused`() = runTest {
        val h = EvidenceTestHarness().start()
        h.submitter.answers = mutableListOf(Result.success(PENDING))

        h.coordinator.handleRegionEntered("r")
        val phase = h.coordinator.confirmDwell("occ-999", 180)

        assertEquals(EvidencePhase.Refused(EvidenceRefusal.Expired), phase)
        assertEquals(1, h.submitter.sent.size)
    }

    @Test
    fun `leaving before dwell abandons and purges`() = runTest {
        val h = EvidenceTestHarness().start()
        h.submitter.answers = mutableListOf(Result.success(PENDING))

        h.coordinator.handleRegionEntered("r")
        h.coordinator.handleRegionExited("r")

        assertEquals(EvidencePhase.Abandoned, h.coordinator.phase)
        assertEquals(0, h.store.count())
    }

    @Test
    fun `no open occurrence is a normal refusal, and sends nothing`() = runTest {
        val h = EvidenceTestHarness().start()
        h.submitter.occurrenceId = null

        val phase = h.coordinator.handleRegionEntered("r")

        assertEquals(EvidencePhase.Refused(EvidenceRefusal.NoOpenOccurrence), phase)
        assertTrue(h.submitter.sent.isEmpty())
    }

    @Test
    fun `a revocation between the event and submission fails closed and tears down`() = runTest {
        val h = EvidenceTestHarness().start()
        h.coordinator.enable(
            AutomaticAttendanceSettings(enabled = true, serverConsent = "granted", churchSlug = "grace"),
        )
        assertEquals(1, h.monitor.regions.size)

        // Consent withdrawn on another device between the wake and the send.
        h.source.state = GeofenceConfigurationState.Refused("consent_revoked")
        val phase = h.coordinator.handleRegionEntered("r")

        assertEquals(EvidencePhase.Refused(EvidenceRefusal.ConsentRevoked), phase)
        assertTrue("nothing may be submitted after revocation", h.submitter.sent.isEmpty())
        assertTrue(h.monitor.regions.isEmpty())
    }

    @Test
    fun `an event against an expired configuration reauthorizes before submitting`() = runTest {
        val h = EvidenceTestHarness().start()
        h.submitter.answers = mutableListOf(Result.success(COUNTED))

        h.coordinator.handleRegionEntered("r")

        // The refresh happened before anything was sent — waking on a stale
        // configuration is allowed; acting on one is not.
        assertEquals(1, h.source.forcedCount())
        assertTrue(h.source.calls.first().third)
    }

    @Test
    fun `authority loss tears down and a transient one does not`() {
        for (reason in listOf(
            EvidenceRefusal.NotEnrolled, EvidenceRefusal.Blocked, EvidenceRefusal.NoPeopleLink,
            EvidenceRefusal.ConsentRequired, EvidenceRefusal.ConsentRevoked,
            EvidenceRefusal.GeofenceDisabled, EvidenceRefusal.WrongChurch,
        )) {
            assertTrue("$reason should stop monitoring", reason.requiresTeardown)
        }
        for (reason in listOf(
            EvidenceRefusal.NoOpenOccurrence, EvidenceRefusal.WindowClosed,
            EvidenceRefusal.InsufficientAccuracy, EvidenceRefusal.OutsideRegion,
            EvidenceRefusal.Expired, EvidenceRefusal.Cancelled,
        )) {
            assertFalse("$reason should not stop monitoring", reason.requiresTeardown)
        }
    }

    @Test
    fun `a device condition maps to a real reason rather than unknown`() {
        // Passing these through the server vocabulary silently produced
        // `Unknown`, losing the reason the UI needs. Both platforms map them.
        assertEquals(
            EvidenceRefusal.InsufficientAccuracy,
            EvidenceRefusal.fromReconcile("needs_full_accuracy"),
        )
        assertEquals(
            EvidenceRefusal.Cancelled,
            EvidenceRefusal.fromReconcile("needs_background_permission"),
        )
        assertEquals(
            EvidenceRefusal.ConsentRevoked,
            EvidenceRefusal.fromReconcile("consent_revoked"),
        )
    }

    @Test
    fun `coarse permission refuses rather than sending an unusable fix`() = runTest {
        val h = EvidenceTestHarness().start()
        h.permissions.state = h.permissions.state.copy(
            foreground = ForegroundLocationPermission.Coarse,
        )

        val phase = h.coordinator.handleRegionEntered("r")

        assertEquals(EvidencePhase.Refused(EvidenceRefusal.InsufficientAccuracy), phase)
        assertTrue(h.submitter.sent.isEmpty())
    }

    @Test
    fun `no usable fix still submits, and the server bands it unknown`() = runTest {
        val h = EvidenceTestHarness().start()
        h.sampler.sample = null
        h.submitter.answers = mutableListOf(Result.success(REJECTED))

        h.coordinator.handleRegionEntered("r")

        val evidence = h.submitter.sent[0].first
        // Nil rather than a guess. The server bands nil `unknown` and refuses.
        assertNull(evidence.latitude)
        assertNull(evidence.longitude)
        assertNull(evidence.accuracyMeters)
    }

    @Test
    fun `an invalid fix is treated as no fix`() {
        val bad = SAMPLE.copy(accuracyMeters = 0f)
        assertFalse(bad.isUsable)

        val evidence = AttendanceEvidence.from("o", "confirm", bad, 0, 0)
        assertNull(evidence.latitude)
    }

    @Test
    fun `a mock-location reading is reported but is not the decision`() = runTest {
        val h = EvidenceTestHarness().start()
        h.sampler.sample = SAMPLE.copy(isFromMockProvider = true)
        h.submitter.answers = mutableListOf(Result.success(COUNTED))

        h.coordinator.handleRegionEntered("r")

        val evidence = h.submitter.sent[0].first
        // Reported as one signal among several. The client does not refuse on
        // it: a developer phone is not automatically dishonest, and a
        // determined spoof does not set this flag at all. The server decides.
        assertEquals(true, evidence.mockLocationReported)
        assertTrue(h.coordinator.phase.isSuccess)
    }

    @Test
    fun `an offline attempt is queued against its attempt and bounded`() = runTest {
        val h = EvidenceTestHarness().start()
        h.submitter.answers = mutableListOf(
            Result.failure(TransientAttendanceFailure("offline")),
        )

        h.coordinator.handleRegionEntered("r")

        val held = h.store.peek(PARTITION)!!
        assertNotNull("a dead zone must not lose the check-in", held.queued)
        // The attempt id bounds the coordinates, not a separate lifetime.
        assertEquals(h.now + PENDING_ATTEMPT_LIFETIME_MILLIS, held.expiresAtEpochMillis)
        assertNotNull(held.queued!!.latitude)
    }

    @Test
    fun `the queued submission carries no key of its own - it is re-derived`() = runTest {
        // A key stored alongside the payload could drift from the attempt it
        // belongs to. Storing only the attempt id and re-deriving means the two
        // cannot disagree.
        val h = EvidenceTestHarness().start()
        h.submitter.answers = mutableListOf(
            Result.failure(TransientAttendanceFailure("offline")),
            Result.success(COUNTED),
        )

        h.coordinator.handleRegionEntered("r")
        val attempt = h.store.peek(PARTITION)!!
        val expected = IdempotencyKey.geofence(
            "acct-1", attempt.churchSlug, attempt.occurrenceId,
            attempt.attemptId, attempt.queued!!.kind,
        )

        h.coordinator.flushPending()

        assertTrue(h.submitter.keys().all { it == expected })
    }

    @Test
    fun `disabling removes regions, cancels work and purges evidence`() = runTest {
        val h = EvidenceTestHarness().start()
        h.coordinator.enable(
            AutomaticAttendanceSettings(enabled = true, serverConsent = "granted", churchSlug = "grace"),
        )
        h.submitter.answers = mutableListOf(Result.failure(TransientAttendanceFailure("offline")))
        h.coordinator.handleRegionEntered("r")
        assertEquals(1, h.store.count())

        h.coordinator.disable()

        assertTrue(h.monitor.regions.isEmpty())
        assertEquals(0, h.store.count())
        assertFalse(h.coordinator.settings.enabled)
    }

    @Test
    fun `backoff is bounded, jittered and never zero`() {
        for (attempt in 0 until 8) {
            val low = RetryPolicy.delayMillis(attempt) { 0.0 }
            val high = RetryPolicy.delayMillis(attempt) { 1.0 }
            assertTrue("attempt $attempt could spin", low > 0)
            assertTrue("attempt $attempt exceeded the ceiling", high <= 120_000)
            assertTrue(low <= high)
        }
        assertTrue(RetryPolicy.delayMillis(3) { 0.0 } > RetryPolicy.delayMillis(0) { 0.0 })
        // A whole congregation must not retry in lockstep.
        assertNotEquals(RetryPolicy.delayMillis(3) { 0.0 }, RetryPolicy.delayMillis(3) { 1.0 })
    }

    @Test
    fun `a terminal refusal is never retried`() {
        assertFalse(RetryPolicy.shouldRetry(0, isTransient = false))
        assertTrue(RetryPolicy.shouldRetry(0, isTransient = true))
        assertFalse(RetryPolicy.shouldRetry(RetryPolicy.MAX_ATTEMPTS, isTransient = true))
    }

    @Test
    fun `both platforms produce the same canonical request`() {
        val evidence = AttendanceEvidence.from(
            occurrenceId = "occ-1",
            phase = "confirm",
            sample = LocationSample(38.2527, -85.7585, 15f, 1_800_000_000_000),
            dwellSeconds = 180,
            observedAtEpochMillis = 1_800_000_000_000,
        )

        // Field-for-field identical to what Swift's `AttendanceEvidence`
        // produces; the iOS suite asserts the mirror of this.
        assertEquals("occ-1", evidence.occurrenceId)
        assertEquals("confirm", evidence.phase)
        assertEquals(180, evidence.dwellSeconds)
        assertEquals(15.0, evidence.accuracyMeters!!, 0.001)
        assertEquals(38.2527, evidence.latitude!!, 0.00001)
        assertEquals(-85.7585, evidence.longitude!!, 0.00001)
        // Android has a mock-location signal; iOS does not, and sends null.
        assertEquals(false, evidence.mockLocationReported)
    }
}

// ---------------------------------------------------------------------------
// Readiness resolution
// ---------------------------------------------------------------------------

class ResolverTest {
    private val ok = LocationPermissionState(
        foreground = ForegroundLocationPermission.Fine,
        background = BackgroundLocationPermission.Granted,
        strategy = BackgroundRequestStrategy.SettingsOnly,
    )
    private val on = AutomaticAttendanceSettings(
        enabled = true, serverConsent = "granted", churchSlug = "grace",
    )

    @Test
    fun `everything in place resolves to ready`() {
        assertEquals(
            AutomaticAttendanceStep.Ready,
            AutomaticAttendanceResolver.resolve(on, ok, refusal = null),
        )
    }

    @Test
    fun `device conditions are reported before server ones`() {
        // Someone with location switched off cannot act on being told their
        // church has not configured a campus, so the device condition wins.
        val step = AutomaticAttendanceResolver.resolve(
            on,
            ok.copy(locationServicesEnabled = false),
            refusal = "no_campus_configured",
        )
        assertEquals(
            AutomaticAttendanceStep.Blocked(AutomaticAttendanceBlocker.LocationServicesOff),
            step,
        )
    }

    @Test
    fun `every permission state maps to a distinct actionable blocker`() {
        val cases = mapOf(
            ok.copy(playServicesAvailable = false) to
                AutomaticAttendanceBlocker.PlayServicesUnavailable,
            ok.copy(locationServicesEnabled = false) to
                AutomaticAttendanceBlocker.LocationServicesOff,
            ok.copy(foreground = ForegroundLocationPermission.PermanentlyDenied) to
                AutomaticAttendanceBlocker.ForegroundPermanentlyDenied,
            ok.copy(foreground = ForegroundLocationPermission.Denied) to
                AutomaticAttendanceBlocker.ForegroundDenied,
            ok.copy(foreground = ForegroundLocationPermission.Coarse) to
                AutomaticAttendanceBlocker.ApproximateLocationOnly,
            ok.copy(background = BackgroundLocationPermission.Denied) to
                AutomaticAttendanceBlocker.NeedsBackgroundPermission,
            ok.copy(background = BackgroundLocationPermission.NotRequested) to
                AutomaticAttendanceBlocker.NeedsBackgroundPermission,
        )

        for ((state, expected) in cases) {
            assertEquals(
                "state $state",
                AutomaticAttendanceStep.Blocked(expected),
                AutomaticAttendanceResolver.resolve(on, state, refusal = null),
            )
        }
    }

    @Test
    fun `below API 29 a NotApplicable background permission is fine`() {
        val legacy = ok.copy(
            background = BackgroundLocationPermission.NotApplicable,
            strategy = BackgroundRequestStrategy.ImpliedByForeground,
        )
        assertEquals(
            AutomaticAttendanceStep.Ready,
            AutomaticAttendanceResolver.resolve(on, legacy, refusal = null),
        )
    }

    @Test
    fun `every server refusal maps to copy the person can act on`() {
        val cases = mapOf(
            "no_people_link" to AutomaticAttendanceBlocker.NoPeopleLink,
            "consent_revoked" to AutomaticAttendanceBlocker.ConsentMissing,
            "geofence_disabled" to AutomaticAttendanceBlocker.ChurchDisabled,
            "no_campus_configured" to AutomaticAttendanceBlocker.NoCampus,
            "configuration_unavailable" to AutomaticAttendanceBlocker.Unavailable,
        )
        for ((refusal, expected) in cases) {
            assertEquals(
                refusal,
                AutomaticAttendanceStep.Blocked(expected),
                AutomaticAttendanceResolver.resolve(on, ok, refusal),
            )
        }
    }

    @Test
    fun `an unrecognised refusal degrades rather than claiming ready`() {
        // A refusal string this build does not know must never read as working.
        val step = AutomaticAttendanceResolver.resolve(on, ok, refusal = "something_new")
        assertEquals(
            AutomaticAttendanceStep.Blocked(AutomaticAttendanceBlocker.Unavailable),
            step,
        )
    }

    @Test
    fun `a Settings link is offered only where Settings would help`() {
        for (blocker in listOf(
            AutomaticAttendanceBlocker.ForegroundPermanentlyDenied,
            AutomaticAttendanceBlocker.ApproximateLocationOnly,
            AutomaticAttendanceBlocker.NeedsBackgroundPermission,
            AutomaticAttendanceBlocker.LocationServicesOff,
        )) {
            assertTrue("$blocker", blocker.isRecoverableInSettings)
        }
        // These cannot be fixed in Android settings; a button would lead nowhere.
        for (blocker in listOf(
            AutomaticAttendanceBlocker.NoPeopleLink,
            AutomaticAttendanceBlocker.ChurchDisabled,
            AutomaticAttendanceBlocker.NoCampus,
            AutomaticAttendanceBlocker.PlayServicesUnavailable,
            AutomaticAttendanceBlocker.Unavailable,
        )) {
            assertFalse("$blocker", blocker.isRecoverableInSettings)
        }
    }

    @Test
    fun `not opted in with no permission asked is NotStarted, not blocked`() {
        val fresh = LocationPermissionState(
            foreground = ForegroundLocationPermission.NotRequested,
            background = BackgroundLocationPermission.NotRequested,
            strategy = BackgroundRequestStrategy.SettingsOnly,
        )
        assertEquals(
            AutomaticAttendanceStep.NotStarted,
            AutomaticAttendanceResolver.resolve(AutomaticAttendanceSettings(), fresh, null),
        )
    }
}


// ---------------------------------------------------------------------------
// Anti-flapping — bounded, never permanent
// ---------------------------------------------------------------------------

class AttemptPolicyTest {
    private val start = 1_800_000_000_000L

    @Test
    fun `five refusals do NOT lock the occurrence out`() {
        // The regression this exists for. A hard cap of five was the original
        // bug at a larger number: five poor readings on arrival — indoors,
        // phone cold — would stop that person being counted at that service.
        var policy = AttemptPolicy()
        repeat(5) { index ->
            policy = policy
                .recordingSubmission(start + index)
                .recordingRefusal(start + index, 120.0, 7003)
        }
        assertEquals(5, policy.refusals)
        assertFalse(policy.settled)

        // A materially better fix proceeds immediately, cooldown or not.
        val decision = policy.decide(start, accuracyMeters = 12.0, configVersion = 7003)
        assertTrue("a sharpened fix was refused: $decision", decision is AttemptDecision.Proceed)
        assertTrue((decision as AttemptDecision.Proceed).trigger is AttemptTrigger.ImprovedAccuracy)
    }

    @Test
    fun `the cooldown is exponential and bounded, never infinite`() {
        var policy = AttemptPolicy()
        var previous = 0L
        repeat(12) {
            policy = policy.recordingRefusal(start, 120.0, 1)
            assertTrue("the cooldown went backwards", policy.cooldownMillis >= previous)
            assertTrue("the cooldown is unbounded", policy.cooldownMillis <= AttemptPolicy.MAX_COOLDOWN_MILLIS)
            previous = policy.cooldownMillis
        }
        assertEquals(AttemptPolicy.MAX_COOLDOWN_MILLIS, previous)
        // Capped well below a service, so a hold can never outlast the window.
        assertTrue(AttemptPolicy.MAX_COOLDOWN_MILLIS <= 10 * 60 * 1000L)
    }

    @Test
    fun `a hold names when it lifts and is never permanent`() {
        val policy = AttemptPolicy()
            .recordingSubmission(start)
            .recordingRefusal(start, 120.0, 1)

        val held = policy.decide(start, 120.0, 1)
        assertTrue(held is AttemptDecision.WaitUntil)
        assertEquals(HoldReason.Cooldown, (held as AttemptDecision.WaitUntil).reason)
        assertTrue(held.nextEligibleAtEpochMillis > start)

        // After the cooldown: proceeds on its own, with no new signal at all.
        val later = start + AttemptPolicy.BASE_COOLDOWN_MILLIS + 1
        val lifted = policy.decide(later, 120.0, 1)
        assertTrue("the hold did not lift: $lifted", lifted is AttemptDecision.Proceed)
        assertEquals(
            AttemptTrigger.CooldownElapsed,
            (lifted as AttemptDecision.Proceed).trigger,
        )
    }

    @Test
    fun `a verified exit bypasses the cooldown entirely`() {
        val policy = AttemptPolicy().recordingRefusal(start, 120.0, 1).recordingExit()
        val decision = policy.decide(start, 120.0, 1)
        assertTrue(decision is AttemptDecision.Proceed)
        assertEquals(AttemptTrigger.ExitThenReentry, (decision as AttemptDecision.Proceed).trigger)
    }

    @Test
    fun `a configuration change bypasses the cooldown`() {
        val policy = AttemptPolicy().recordingRefusal(start, 120.0, 7003)
        val decision = policy.decide(start, 120.0, 7004)
        assertTrue(decision is AttemptDecision.Proceed)
        assertEquals(
            AttemptTrigger.ConfigurationChanged,
            (decision as AttemptDecision.Proceed).trigger,
        )
    }

    @Test
    fun `only a materially better fix counts as improvement`() {
        val policy = AttemptPolicy().recordingRefusal(start, 100.0, 1)

        // Noise is not news.
        assertFalse(policy.isImproved(98.0))
        assertFalse(policy.isImproved(95.0))
        // Halved, or 25 m better, is a different observation.
        assertTrue(policy.isImproved(50.0))
        assertTrue(policy.isImproved(70.0))
        // Worse, absent, or invalid is not better.
        assertFalse(policy.isImproved(200.0))
        assertFalse(policy.isImproved(null))
        assertFalse(policy.isImproved(-1.0))
    }

    @Test
    fun `the token bucket empties under a burst and refills continuously`() {
        var policy = AttemptPolicy()
        repeat(AttemptPolicy.BUCKET_CAPACITY.toInt()) {
            policy = policy.recordingSubmission(start)
        }
        assertTrue(policy.availableTokens(start) < 1.0)

        // It refills continuously — no window has to slide past.
        assertTrue(policy.availableTokens(start + AttemptPolicy.TOKEN_REFILL_INTERVAL_MILLIS) >= 1.0)

        // And it is capped: waiting a day does not bank a day's worth.
        assertEquals(
            AttemptPolicy.BUCKET_CAPACITY,
            policy.availableTokens(start + 24L * 60 * 60 * 1000),
            0.001,
        )
    }

    @Test
    fun `an empty bucket holds for at most one refill interval`() {
        // The replacement for a 12-per-rolling-hour budget, which could hold a
        // device for nearly an hour — longer than the service it was sitting
        // in. A bucket's worst case is one token, not a window.
        var policy = AttemptPolicy()
        repeat(AttemptPolicy.BUCKET_CAPACITY.toInt()) {
            policy = policy.recordingSubmission(start)
        }

        val wait = policy.nextTokenAt(start) - start
        assertTrue(wait > 0)
        assertTrue("an empty bucket held for ${wait}ms", wait <= AttemptPolicy.TOKEN_REFILL_INTERVAL_MILLIS)
        assertEquals(60_000L, AttemptPolicy.TOKEN_REFILL_INTERVAL_MILLIS)
    }

    @Test
    fun `the maximum local hold is explicit, bounded and deterministic`() {
        assertEquals(AttemptPolicy.MAX_COOLDOWN_MILLIS, AttemptPolicy.MAX_LOCAL_HOLD_MILLIS)
        assertEquals(10L * 60 * 1000, AttemptPolicy.MAX_LOCAL_HOLD_MILLIS)
        // The throttle can never be the binding constraint.
        assertTrue(AttemptPolicy.TOKEN_REFILL_INTERVAL_MILLIS < AttemptPolicy.MAX_LOCAL_HOLD_MILLIS)

        // Exhaustively: no state produces a hold beyond the bound.
        var policy = AttemptPolicy()
        repeat(40) { index ->
            val at = start + index
            policy = policy.recordingSubmission(at).recordingRefusal(at, 120.0, 1)

            val decision = policy.decide(at, 120.0, 1)
            if (decision is AttemptDecision.WaitUntil) {
                val wait = decision.nextEligibleAtEpochMillis - at
                assertTrue(
                    "hold of ${wait}ms exceeded the stated bound after $index refusals",
                    wait <= AttemptPolicy.MAX_LOCAL_HOLD_MILLIS,
                )
            }
        }
    }

    @Test
    fun `a valid later signal becomes eligible within the bound`() {
        var policy = AttemptPolicy()
        repeat(30) { index ->
            val at = start + index
            policy = policy.recordingSubmission(at).recordingRefusal(at, 120.0, 1)
        }

        // However badly it has gone, one MAX_LOCAL_HOLD later the device tries
        // again — with no new signal at all.
        val later = start + AttemptPolicy.MAX_LOCAL_HOLD_MILLIS + 60_000
        val decision = policy.decide(later, 120.0, 1)
        assertTrue("still held after the stated maximum: $decision", decision is AttemptDecision.Proceed)
    }

    @Test
    fun `neither an exhausted bucket nor any refusal count settles the occurrence`() {
        var policy = AttemptPolicy()
        repeat(50) {
            policy = policy.recordingSubmission(start).recordingRefusal(start, 120.0, 1)
            assertFalse(policy.settled)
            assertTrue(policy.decide(start, 120.0, 1) !is AttemptDecision.AlreadySettled)
        }
        assertTrue(policy.settling().decide(start, 12.0, 1) is AttemptDecision.AlreadySettled)
    }

    @Test
    fun `only a count settles an occurrence`() {
        var policy = AttemptPolicy()
        repeat(20) {
            policy = policy.recordingRefusal(start, 120.0, 1)
            assertFalse("a refusal settled the occurrence", policy.settled)
            assertTrue(policy.decide(start, 12.0, 1) !is AttemptDecision.AlreadySettled)
        }
        assertTrue(policy.settling().decide(start, 12.0, 1) is AttemptDecision.AlreadySettled)
    }

    @Test
    fun `the constants match the iOS policy exactly`() {
        // A person with an iPhone and a person with a Pixel must back off
        // identically, or a support conversation begins with "which phone".
        assertEquals(12.0, AttemptPolicy.BUCKET_CAPACITY, 0.0)
        assertEquals(60L * 1000, AttemptPolicy.TOKEN_REFILL_INTERVAL_MILLIS)
        assertEquals(30L * 1000, AttemptPolicy.BASE_COOLDOWN_MILLIS)
        assertEquals(10L * 60 * 1000, AttemptPolicy.MAX_COOLDOWN_MILLIS)
        assertEquals(2.0, AttemptPolicy.MATERIAL_ACCURACY_RATIO, 0.0)
        assertEquals(25.0, AttemptPolicy.MATERIAL_ACCURACY_DELTA, 0.0)
    }
}

// ---------------------------------------------------------------------------
// detected → confirm
// ---------------------------------------------------------------------------

class ConfirmationTest {
    private fun harness() = EvidenceTestHarness()

    @Test
    fun `a detected attempt records the server's confirmation instant`() = runTest {
        val h = EvidenceTestHarness().start()
        h.submitter.answers = mutableListOf(
            Result.success(pendingUntil(h.now + 120_000)),
        )

        h.coordinator.handleRegionEntered("r")

        val attempt = h.store.peek(PARTITION)!!
        assertEquals(h.now + 120_000, attempt.confirmationNotBeforeEpochMillis)
        // Persisted, not held in memory: this wait spans exactly the window
        // where the process is most likely to be killed.
        assertFalse(attempt.mayConfirm(h.now))
    }

    @Test
    fun `confirmation cannot happen before the server's instant`() = runTest {
        val h = EvidenceTestHarness().start()
        h.submitter.answers = mutableListOf(
            Result.success(pendingUntil(h.now + 120_000)),
        )
        h.coordinator.handleRegionEntered("r")
        val afterDetected = h.submitter.sent.size

        // Every execution opportunity before the instant does nothing at all.
        repeat(5) {
            h.now += 10_000
            h.coordinator.confirmIfDue()
        }

        assertEquals(
            "a confirm was sent that would be refused for insufficient dwell",
            afterDetected,
            h.submitter.sent.size,
        )
    }

    @Test
    fun `confirmation succeeds after the server's instant`() = runTest {
        val h = EvidenceTestHarness().start()
        h.submitter.answers = mutableListOf(
            Result.success(pendingUntil(h.now + 120_000)),
            Result.success(COUNTED),
        )
        h.coordinator.handleRegionEntered("r")

        h.now += 120_001
        val phase = h.coordinator.confirmIfDue()

        assertEquals(EvidencePhase.Counted("occ-1", false), phase)
        assertEquals(2, h.submitter.sent.size)
        assertEquals("confirm", h.submitter.sent[1].first.phase)
        // The confirm carries fresh evidence and the elapsed dwell.
        assertNotNull(h.submitter.sent[1].first.latitude)
        assertTrue(h.submitter.sent[1].first.dwellSeconds!! >= 120)
    }

    @Test
    fun `a restart preserves the pending detected attempt`() = runTest {
        val store = MemoryStore()
        val first = EvidenceTestHarness(store = store).start()
        first.submitter.answers = mutableListOf(
            Result.success(pendingUntil(first.now + 120_000)),
        )
        first.coordinator.handleRegionEntered("r")

        // A whole new coordinator, as after the process was killed.
        val second = EvidenceTestHarness(store = store).start()
        second.now = first.now + 120_001
        second.submitter.answers = mutableListOf(Result.success(COUNTED))
        val phase = second.coordinator.confirmIfDue()

        assertEquals(EvidencePhase.Counted("occ-1", false), phase)
        // The same logical attempt, so the same key family.
        assertTrue(second.submitter.keys().first().startsWith("gf-"))
    }

    @Test
    fun `a missing confirmation never creates a fact`() = runTest {
        val h = EvidenceTestHarness().start()
        h.submitter.answers = mutableListOf(
            Result.success(pendingUntil(h.now + 120_000)),
        )
        h.coordinator.handleRegionEntered("r")

        // No execution opportunity ever comes. The attempt simply expires.
        h.now += PENDING_ATTEMPT_LIFETIME_MILLIS + 1
        h.coordinator.confirmIfDue()

        assertEquals("a confirm was sent after expiry", 1, h.submitter.sent.size)
        assertFalse(h.coordinator.phase.isSuccess)
        assertNull(h.store.peek(PARTITION))
    }

    @Test
    fun `consent revoked before confirmation fails closed`() = runTest {
        val h = EvidenceTestHarness().start()
        h.submitter.answers = mutableListOf(
            Result.success(pendingUntil(h.now + 120_000)),
            Result.failure(TerminalAttendanceFailure(EvidenceRefusal.ConsentRevoked)),
        )
        h.coordinator.handleRegionEntered("r")

        h.now += 120_001
        val phase = h.coordinator.confirmIfDue()

        assertEquals(EvidencePhase.Refused(EvidenceRefusal.ConsentRevoked), phase)
        // A loss of authority stops the device watching entirely.
        assertTrue(h.monitor.regions.isEmpty())
        assertNull(h.store.peek(PARTITION))
    }

    @Test
    fun `an older server with no confirmation instant still gets a fallback`() = runTest {
        val h = EvidenceTestHarness().start()
        // `confirmationNotBefore` absent, as a pre-Prompt-7 server would send.
        h.submitter.answers = mutableListOf(Result.success(PENDING))
        h.coordinator.handleRegionEntered("r")

        val attempt = h.store.peek(PARTITION)!!
        assertNotNull(attempt.confirmationNotBeforeEpochMillis)
        // Conservative: confirming too early is refused and wastes a
        // submission, whereas confirming late costs only a little time.
        assertEquals(h.now + FALLBACK_DWELL_MILLIS, attempt.confirmationNotBeforeEpochMillis)

        // But without a detection there is nothing the server would accept, so
        // it still never confirms — the fallback is a *deadline*, not an
        // identity, and an older server supplies neither.
        assertNull(attempt.detectionId)
        assertFalse(attempt.mayConfirm(h.now + FALLBACK_DWELL_MILLIS + 1))
    }

    @Test
    fun `a pending response with no detection never confirms`() = runTest {
        val h = EvidenceTestHarness().start()
        h.submitter.answers = mutableListOf(
            Result.success(pendingUntil(h.now + 60_000, detectionId = null)),
        )
        h.coordinator.handleRegionEntered("r")

        h.now += 600_000
        h.coordinator.confirmIfDue()

        // Nothing further was sent: a confirmation without a server-issued
        // detection is one the server will refuse, and guessing an id would be
        // worse than not trying.
        assertEquals(1, h.submitter.sent.size)
    }

    @Test
    fun `the confirm submission carries the server-issued detection`() = runTest {
        val h = EvidenceTestHarness().start()
        h.submitter.answers = mutableListOf(
            Result.success(pendingUntil(h.now + 60_000, detectionId = "det-abc")),
            Result.success(COUNTED),
        )

        h.coordinator.handleRegionEntered("r")
        h.now += 61_000
        h.coordinator.confirmIfDue()

        assertEquals(2, h.submitter.sent.size)
        // `detected` carries the client's attempt id, making the server-side
        // detection idempotent per workflow.
        assertNotNull(h.submitter.sent[0].first.attemptId)
        assertNull(h.submitter.sent[0].first.detectionId)
        // `confirm` carries the detection the server issued.
        assertEquals("det-abc", h.submitter.sent[1].first.detectionId)
    }

    @Test
    fun `the client's dwell figure is reported but never decides`() = runTest {
        val h = EvidenceTestHarness().start()
        h.submitter.answers = mutableListOf(
            Result.success(pendingUntil(h.now + 60_000)),
            Result.success(COUNTED),
        )

        h.coordinator.handleRegionEntered("r")
        h.now += 61_000
        h.coordinator.confirmIfDue()

        // Sent for the audit — but the server measures the dwell between its
        // own `detected_at_server` and `now()`, so this cannot shorten it. An
        // OS dwell callback schedules an opportunity; it does not prove server
        // dwell elapsed.
        assertNotNull(h.submitter.sent[1].first.dwellSeconds)
        assertNotNull(h.submitter.sent[1].first.detectionId)
    }

    @Test
    fun `the confirm command is byte-identical to what iOS produces`() {
        // Both platforms reduce whatever they gathered to this one shape.
        val evidence = AttendanceEvidence.from(
            occurrenceId = "occ-1",
            phase = "confirm",
            sample = LocationSample(38.2527, -85.7585, 15f, 1_800_000_000_000),
            dwellSeconds = 180,
            observedAtEpochMillis = 1_800_000_000_000,
        )
        assertEquals("confirm", evidence.phase)
        assertEquals(180, evidence.dwellSeconds)
        assertEquals(15.0, evidence.accuracyMeters!!, 0.001)
        assertEquals(38.2527, evidence.latitude!!, 0.00001)
    }
}
