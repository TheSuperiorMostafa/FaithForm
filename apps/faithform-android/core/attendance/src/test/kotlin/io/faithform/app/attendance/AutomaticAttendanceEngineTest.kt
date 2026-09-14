package io.faithform.app.attendance

import io.faithform.app.contract.AttendanceSourceAvailability
import io.faithform.app.contract.GeofenceConfiguration
import io.faithform.app.contract.GeofenceRegion
import io.faithform.app.contract.GeofenceWindow
import io.faithform.app.storage.CachePartition
import java.time.Instant
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

// ---------------------------------------------------------------------------
// Doubles
// ---------------------------------------------------------------------------

/** A configuration source that answers per church. */
class ChurchSource(
    val states: MutableMap<String, GeofenceConfigurationState> = mutableMapOf(),
) : ConfigurationSource {
    val calls = mutableListOf<Triple<String, Int, Boolean>>()

    override suspend fun currentConfiguration(
        churchSlug: String,
        partition: CachePartition,
        nowEpochMillis: Long,
        forceRefresh: Boolean,
    ): GeofenceConfigurationState {
        calls += Triple(churchSlug, partition.authorizationVersion, forceRefresh)
        return states[churchSlug] ?: GeofenceConfigurationState.Refused("not_enrolled")
    }
}

/** Counts fixes, because "no location was read" is the assertion that matters. */
class CountingSampler(var sample: LocationSample? = SAMPLE) : LocationSampling {
    var calls = 0
        private set

    override suspend fun requestOneShotLocation(timeoutMillis: Long): LocationSample? {
        calls++
        return sample
    }
}

class MemoryRecords : AutomaticAttendanceRecordStore {
    var record = AutomaticAttendanceRecord()
    var clears = 0

    override suspend fun load() = record
    override suspend fun save(record: AutomaticAttendanceRecord) {
        this.record = record
    }
    override suspend fun clear() {
        clears++
        record = AutomaticAttendanceRecord()
    }
}

class MemoryInbox : TransitionInbox {
    val items = mutableListOf<PendingTransition>()
    override suspend fun append(transition: PendingTransition) {
        items += transition
    }
    override suspend fun all() = items.toList()
    override suspend fun remove(transition: PendingTransition) {
        items.remove(transition)
    }
    override suspend fun clear() = items.clear()
}

class RecordingNotifier : AttendanceNotifier {
    val questions = mutableListOf<String>()
    val checkIns = mutableListOf<Pair<String, String?>>()
    var withdrawals = 0
    var clears = 0

    override fun askToConfirm(churchSlug: String, churchName: String, serviceLabel: String?) {
        questions += churchName
    }
    override fun checkedIn(churchSlug: String, churchName: String, serviceLabel: String?) {
        checkIns += churchName to serviceLabel
    }
    override fun withdrawQuestion() {
        withdrawals++
    }
    override fun clearAll() {
        clears++
    }
}

class RecordingScheduler : AttendanceScheduler {
    var transitions = 0
    var retries = 0
    val prompts = mutableListOf<Long>()
    val confirms = mutableListOf<Long?>()
    val reconciles = mutableListOf<Pair<ReconcileTrigger, Long?>>()
    val rearms = mutableListOf<Long>()
    var revokes = 0
    var cancels = 0

    override fun processTransitions() {
        transitions++
    }
    override fun retryWhenOnline() {
        retries++
    }
    override fun promptAt(epochMillis: Long) {
        prompts += epochMillis
    }
    override fun confirmWhenOnline(atEpochMillis: Long?) {
        confirms += atEpochMillis
    }
    override fun reconcileWhenOnline(trigger: ReconcileTrigger, atEpochMillis: Long?) {
        reconciles += trigger to atEpochMillis
    }
    override fun rearmAt(epochMillis: Long) {
        rearms += epochMillis
    }
    override fun revokeConsentWhenOnline() {
        revokes++
    }
    override fun cancelAll() {
        cancels++
    }
}

class FakeConsent : AttendanceConsentClient {
    var version = 8
    var failure: Exception? = null
    val calls = mutableListOf<Boolean>()

    override suspend fun record(granted: Boolean): ConsentRecorded {
        calls += granted
        failure?.let { throw it }
        version++
        return ConsentRecorded(if (granted) "granted" else "revoked", version)
    }
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const val NOW = 1_800_000_000_000L
const val CAMPUS = "faithform.campus.a"

fun iso(epochMillis: Long): String = Instant.ofEpochMilli(epochMillis).toString()

fun window(
    occurrenceId: String = "occ-1",
    label: String = "Sunday Morning",
    opens: Long = NOW - 600_000,
    closes: Long = NOW + 3_600_000,
) = GeofenceWindow(
    occurrenceId = occurrenceId,
    label = label,
    startsAt = iso(opens + 900_000),
    endsAt = iso(closes),
    checkinOpensAt = iso(opens),
    checkinClosesAt = iso(closes),
    timezone = "America/New_York",
)

fun churchConfig(
    slug: String = "grace",
    regions: List<GeofenceRegion> = listOf(region(CAMPUS)),
    requiresConfirmation: Boolean = false,
    minDwellSeconds: Int = 0,
    windows: List<GeofenceWindow> = listOf(window()),
    version: Int = 1008,
) = GeofenceConfiguration(
    churchSlug = slug,
    regions = regions,
    windows = windows,
    sources = AttendanceSourceAvailability(geofence = true, qr = true, manual = true),
    requiresConfirmation = requiresConfirmation,
    minDwellSeconds = minDwellSeconds,
    maxLocationAccuracyM = 100,
    configVersion = version,
    expiresAt = iso(NOW + 900_000),
)

/**
 * The whole engine over doubles, sharing whatever a process restart would
 * share: the records, the inbox, the attempts and what the system registered.
 */
class EngineHarness(
    val records: MemoryRecords = MemoryRecords(),
    val inbox: MemoryInbox = MemoryInbox(),
    val attempts: MemoryStore = MemoryStore(),
    val monitor: FakeMonitor = FakeMonitor(),
    val source: ChurchSource = ChurchSource(
        mutableMapOf("grace" to GeofenceConfigurationState.Available(churchConfig())),
    ),
    val consent: FakeConsent = FakeConsent(),
) {
    var now = NOW
    val permissions = FakePermissions()
    val submitter = ScriptedSubmitter()
    val sampler = CountingSampler()
    val notifier = RecordingNotifier()
    val scheduler = RecordingScheduler()
    var identity: AttendanceIdentity? = AttendanceIdentity("test", "acct-1")

    val reconciler = GeofenceReconciler(monitor, permissions, source) { now }
    val coordinator = AutomaticAttendanceCoordinator(
        reconciler, submitter, sampler, attempts, permissions, clock = { now },
    )
    val engine = AutomaticAttendanceEngine(
        coordinator = coordinator,
        reconciler = reconciler,
        records = records,
        inbox = inbox,
        attempts = attempts,
        notifier = notifier,
        scheduler = scheduler,
        consent = consent,
        identity = { identity },
        clock = { now },
    )

    fun snapshot(
        consentState: String = "unset",
        version: Int = 7,
        churches: List<ChurchName> = listOf(ChurchName("grace", "Grace Church")),
        account: String = "acct-1",
    ) = AttendanceAccountSnapshot("test", account, version, consentState, churches)

    suspend fun on(churches: List<ChurchName> = listOf(ChurchName("grace", "Grace Church"))): EngineHarness {
        val result = engine.turnOn(snapshot(churches = churches))
        assertTrue("could not turn on: $result", result is TurnOnResult.On)
        return this
    }

    suspend fun dwell(region: String = CAMPUS) = engine.recordTransition(TransitionKind.Dwell, listOf(region))
    suspend fun exit(region: String = CAMPUS) = engine.recordTransition(TransitionKind.Exit, listOf(region))

    fun confirming(minDwell: Int = 300) {
        source.states["grace"] = GeofenceConfigurationState.Available(
            churchConfig(requiresConfirmation = true, minDwellSeconds = minDwell),
        )
    }
}

// ---------------------------------------------------------------------------
// Arrival: what starts a check-in, and what does not
// ---------------------------------------------------------------------------

class ArrivalTest {

    @Test
    fun `turning on records consent first and then registers the church`() = runTest {
        val h = EngineHarness().on()

        assertEquals(listOf(true), h.consent.calls)
        assertTrue(h.records.record.enabled)
        assertEquals("granted", h.records.record.serverConsent)
        // The version after the consent bump partitions everything that follows.
        assertEquals(9, h.records.record.authorizationVersion)
        assertTrue(h.source.calls.all { it.second == 9 })
        assertEquals(setOf(CAMPUS), h.monitor.regions.map { it.identifier }.toSet())
        assertEquals(1, h.records.record.monitoring)
    }

    @Test
    fun `an entry alone sends nothing and schedules nothing`() = runTest {
        val h = EngineHarness().on()

        h.engine.recordTransition(TransitionKind.Enter, listOf(CAMPUS))

        assertTrue(h.inbox.items.isEmpty())
        assertEquals(0, h.scheduler.transitions)
        assertTrue(h.submitter.lookups.isEmpty())
        assertEquals(0, h.sampler.calls)
    }

    @Test
    fun `a region that is not ours is ignored`() = runTest {
        val h = EngineHarness().on()

        h.engine.recordTransition(TransitionKind.Dwell, listOf("someone.else.region"))

        assertTrue(h.inbox.items.isEmpty())
        assertEquals(0, h.scheduler.transitions)
    }

    @Test
    fun `a dwell checks in at a church that asks for no confirmation, and says so once`() = runTest {
        val h = EngineHarness().on()

        h.dwell()
        assertEquals(1, h.scheduler.transitions)
        assertEquals(WorkResult.Done, h.engine.processTransitions())

        assertEquals(listOf("grace" to CAMPUS), h.submitter.lookups)
        assertEquals(1, h.submitter.sent.size)
        val detected = h.submitter.sent.single().first
        assertEquals("detected", detected.phase)
        // The campus is named on the attempt, and the key is the attempt's.
        assertEquals(CAMPUS, detected.regionId)
        assertTrue(h.submitter.keys().single().startsWith("gf-"))

        assertEquals(listOf("Grace Church" to "Sunday Morning"), h.notifier.checkIns)
        assertNotNull(h.records.record.lastCheckIn)
        assertTrue(h.inbox.items.isEmpty())
    }

    @Test
    fun `a dwell followed by an exit is a pass, and nothing is read or sent`() = runTest {
        val h = EngineHarness().on()

        h.dwell()
        h.exit()
        h.engine.processTransitions()

        assertEquals(0, h.sampler.calls)
        assertTrue(h.submitter.lookups.isEmpty())
        assertTrue(h.submitter.sent.isEmpty())
        assertTrue(h.notifier.checkIns.isEmpty())
    }

    @Test
    fun `outside a check-in window the occurrence is asked for and no location is read`() = runTest {
        val h = EngineHarness().on()
        h.submitter.occurrenceId = null

        h.dwell()
        h.engine.processTransitions()

        // The lookup carries no position; only an occurrence would justify one.
        assertEquals(1, h.submitter.lookups.size)
        assertEquals(0, h.sampler.calls)
        assertTrue(h.submitter.sent.isEmpty())
    }

    @Test
    fun `a relationship that is gone refuses before any location is read`() = runTest {
        val h = EngineHarness().on()
        h.submitter.occurrenceThrows = TerminalAttendanceFailure(EvidenceRefusal.NotEnrolled)

        h.dwell()
        h.engine.processTransitions()

        assertEquals(0, h.sampler.calls)
        assertTrue(h.submitter.sent.isEmpty())
        // The church stops being watched, and a fresh configuration is asked for.
        assertTrue(h.monitor.regions.isEmpty())
        assertTrue(h.scheduler.reconciles.any { it.first == ReconcileTrigger.ConfigurationRefreshed })
        // The person's own choice is untouched.
        assertTrue(h.records.record.enabled)
    }

    @Test
    fun `a counted service costs no location on the next dwell, even in a new process`() = runTest {
        val first = EngineHarness().on()
        first.dwell()
        first.engine.processTransitions()
        assertEquals(1, first.sampler.calls)

        // Re-registered at a window boundary while sitting in church: the
        // system reports the dwell again, in a process started for it.
        val second = EngineHarness(
            records = first.records,
            inbox = first.inbox,
            attempts = first.attempts,
            monitor = first.monitor,
            source = first.source,
        )
        second.dwell()
        second.engine.processTransitions()

        assertEquals(0, second.sampler.calls)
        assertTrue(second.submitter.sent.isEmpty())
        // And the person is not told twice.
        assertTrue(second.notifier.checkIns.isEmpty())
    }

    @Test
    fun `a transition for a feature that is off removes the fences instead`() = runTest {
        val h = EngineHarness()

        h.dwell()

        assertTrue(h.inbox.items.isEmpty())
        assertEquals(ReconcileTrigger.Teardown, h.scheduler.reconciles.single().first)
    }

    @Test
    fun `a transition that waited too long is dropped rather than acted on`() = runTest {
        val h = EngineHarness().on()
        h.dwell()
        h.now += AutomaticAttendanceEngine.INBOX_LIFETIME_MILLIS + 1

        h.engine.processTransitions()

        assertTrue(h.submitter.sent.isEmpty())
        assertTrue(h.inbox.items.isEmpty())
    }

    @Test
    fun `backing off re-arms the fences when the hold lifts, never a lockout`() = runTest {
        val h = EngineHarness().on()
        h.submitter.answers = mutableListOf(Result.success(REJECTED))
        h.dwell()
        h.engine.processTransitions()

        // Same fix accuracy, straight away: held, not refused.
        h.dwell()
        h.engine.processTransitions()

        val hold = h.scheduler.rearms.single()
        assertTrue(hold > h.now)
        assertTrue(hold - h.now <= AttemptPolicy.MAX_LOCAL_HOLD_MILLIS)
    }
}

// ---------------------------------------------------------------------------
// Confirmation versus counting on arrival
// ---------------------------------------------------------------------------

class ConfirmationFlowTest {

    @Test
    fun `a church that wants confirmation is asked at the server's instant, and only a tap confirms`() = runTest {
        val h = EngineHarness()
        h.confirming()
        h.on()
        h.submitter.answers = mutableListOf(
            Result.success(pendingUntil(NOW + 300_000, detectionId = "det-1")),
            Result.success(COUNTED),
        )

        h.dwell()
        h.engine.processTransitions()

        assertEquals(listOf(NOW + 300_000), h.scheduler.prompts)
        assertNotNull(h.records.record.pendingConfirmation)
        assertTrue("asked before the instant", h.notifier.questions.isEmpty())
        assertEquals(1, h.submitter.sent.size)

        h.now = NOW + 300_001
        h.engine.askIfStillPending()
        assertEquals(listOf("Grace Church"), h.notifier.questions)
        // Asking sends nothing.
        assertEquals(1, h.submitter.sent.size)

        h.engine.confirmArrival()

        assertEquals(2, h.submitter.sent.size)
        val confirm = h.submitter.sent[1].first
        assertEquals("confirm", confirm.phase)
        assertEquals("det-1", confirm.detectionId)
        assertEquals(CAMPUS, confirm.regionId)
        assertEquals(listOf("Grace Church" to "Sunday Morning"), h.notifier.checkIns)
        assertNull(h.records.record.pendingConfirmation)
    }

    @Test
    fun `the confirmation names the occurrence the server resolved`() = runTest {
        val h = EngineHarness()
        h.confirming()
        h.on()
        h.submitter.answers = mutableListOf(
            Result.success(pendingUntil(NOW + 60_000).copy(occurrenceId = "occ-campus-b")),
            Result.success(COUNTED.copy(occurrenceId = "occ-campus-b")),
        )

        h.dwell()
        h.engine.processTransitions()
        h.now = NOW + 60_001
        h.engine.confirmArrival()

        assertEquals("occ-1", h.submitter.sent[0].first.occurrenceId)
        assertEquals("occ-campus-b", h.submitter.sent[1].first.occurrenceId)
        // The service the server counted is the one settled on this phone.
        assertTrue("occ-campus-b" in h.records.record.settledOccurrences)
    }

    @Test
    fun `a tap before the server's instant schedules the confirmation rather than sending it`() = runTest {
        val h = EngineHarness()
        h.confirming()
        h.on()
        h.submitter.answers = mutableListOf(Result.success(pendingUntil(NOW + 300_000)))
        h.dwell()
        h.engine.processTransitions()

        h.engine.confirmArrival()

        assertEquals(listOf<Long?>(NOW + 300_000), h.scheduler.confirms)
        assertEquals(1, h.submitter.sent.size)
    }

    @Test
    fun `leaving withdraws the question and nothing can confirm afterwards`() = runTest {
        val h = EngineHarness()
        h.confirming()
        h.on()
        h.submitter.answers = mutableListOf(Result.success(pendingUntil(NOW + 60_000)))
        h.dwell()
        h.engine.processTransitions()

        h.exit()
        h.engine.processTransitions()

        assertTrue(h.notifier.withdrawals >= 1)
        assertNull(h.records.record.pendingConfirmation)
        assertEquals(0, h.attempts.count())

        h.now = NOW + 60_001
        h.engine.askIfStillPending()
        h.engine.confirmArrival()
        assertTrue(h.notifier.questions.isEmpty())
        assertEquals(1, h.submitter.sent.size)
    }

    @Test
    fun `leaving is honoured in a process started just for the exit`() = runTest {
        val first = EngineHarness()
        first.confirming()
        first.on()
        first.submitter.answers = mutableListOf(Result.success(pendingUntil(NOW + 60_000)))
        first.dwell()
        first.engine.processTransitions()
        assertEquals(1, first.attempts.count())

        val second = EngineHarness(
            records = first.records,
            inbox = first.inbox,
            attempts = first.attempts,
            monitor = first.monitor,
            source = first.source,
        )
        second.exit()
        second.engine.processTransitions()

        assertEquals(0, second.attempts.count())
        assertNull(second.records.record.pendingConfirmation)
    }

    @Test
    fun `a church that chose no wait is not asked, even if the server wants a second step`() = runTest {
        val h = EngineHarness().on()
        h.submitter.answers = mutableListOf(Result.success(pendingUntil(NOW + 30_000)))

        h.dwell()
        h.engine.processTransitions()

        assertTrue(h.scheduler.prompts.isEmpty())
        assertNull(h.records.record.pendingConfirmation)
        assertEquals(listOf<Long?>(NOW + 30_000), h.scheduler.confirms)
    }

    @Test
    fun `the phone waits only the arrival floor when the server measures the dwell`() {
        val confirming = churchConfig(requiresConfirmation = true, minDwellSeconds = 600)
        val noWait = churchConfig(requiresConfirmation = false, minDwellSeconds = 0)
        val longNoConfirm = churchConfig(requiresConfirmation = false, minDwellSeconds = 300)

        // The server holds the church's ten minutes between detected and
        // confirm, so the phone does not serve them a second time first.
        assertEquals(MINIMUM_ARRIVAL_DWELL_SECONDS * 1000, GeofenceReconciler.loiteringDelayMillis(confirming))
        // No wait still means a minute, so a drive-by is never counted.
        assertEquals(MINIMUM_ARRIVAL_DWELL_SECONDS * 1000, GeofenceReconciler.loiteringDelayMillis(noWait))
        assertEquals(300_000, GeofenceReconciler.loiteringDelayMillis(longNoConfirm))
        assertTrue(GeofenceReconciler.selectRegions(noWait).all { it.loiteringDelayMillis == 60_000 })
    }
}

// ---------------------------------------------------------------------------
// Offline, retry, idempotency
// ---------------------------------------------------------------------------

class OfflineRetryTest {

    @Test
    fun `offline evidence waits for a network and is sent once, under the same key`() = runTest {
        val h = EngineHarness().on()
        h.submitter.answers = mutableListOf(
            Result.failure(TransientAttendanceFailure("offline")),
            Result.success(COUNTED),
        )

        h.dwell()
        assertEquals(WorkResult.RetryLater, h.engine.processTransitions())
        assertEquals(1, h.scheduler.retries)
        assertNotNull(h.attempts.peek(PARTITION.copy(authorizationVersion = 9))?.queued)
        assertTrue(h.notifier.checkIns.isEmpty())

        assertEquals(WorkResult.Done, h.engine.retryPending())
        assertEquals(2, h.submitter.sent.size)
        assertEquals(h.submitter.keys()[0], h.submitter.keys()[1])
        assertEquals(1, h.notifier.checkIns.size)

        // Nothing left to send, however often the work runs.
        h.engine.retryPending()
        h.engine.retryPending()
        assertEquals(2, h.submitter.sent.size)
    }

    @Test
    fun `a retry survives a process restart with the same key`() = runTest {
        val first = EngineHarness().on()
        first.submitter.answers = mutableListOf(Result.failure(TransientAttendanceFailure("offline")))
        first.dwell()
        first.engine.processTransitions()

        val second = EngineHarness(
            records = first.records,
            inbox = first.inbox,
            attempts = first.attempts,
            monitor = first.monitor,
            source = first.source,
        )
        second.submitter.answers = mutableListOf(Result.success(COUNTED))
        second.engine.retryPending()

        assertEquals(first.submitter.keys().single(), second.submitter.keys().single())
        assertEquals(1, second.notifier.checkIns.size)
    }

    @Test
    fun `an arrival whose service could not be looked up is replayed, not lost`() = runTest {
        val h = EngineHarness().on()
        h.submitter.occurrenceThrows = TransientAttendanceFailure("offline")

        h.dwell()
        assertEquals(WorkResult.RetryLater, h.engine.processTransitions())
        assertEquals(1, h.inbox.items.size)
        assertEquals(0, h.sampler.calls)

        h.submitter.occurrenceThrows = null
        h.engine.retryPending()
        assertEquals(1, h.submitter.sent.size)
        assertTrue(h.inbox.items.isEmpty())
    }

    @Test
    fun `a queued detection answered later still leads to a confirmation`() = runTest {
        val h = EngineHarness()
        h.confirming()
        h.on()
        h.submitter.answers = mutableListOf(
            Result.failure(TransientAttendanceFailure("offline")),
            Result.success(pendingUntil(NOW + 60_000, detectionId = "det-late")),
            Result.success(COUNTED),
        )
        h.dwell()
        h.engine.processTransitions()

        h.engine.retryPending()
        assertEquals(listOf(NOW + 60_000), h.scheduler.prompts)

        h.now = NOW + 60_001
        h.engine.confirmArrival()
        assertEquals("det-late", h.submitter.sent.last().first.detectionId)
        assertEquals(1, h.notifier.checkIns.size)
    }

    @Test
    fun `leaving does not discard evidence gathered while the person was there`() = runTest {
        val h = EngineHarness().on()
        h.submitter.answers = mutableListOf(
            Result.failure(TransientAttendanceFailure("offline")),
            Result.success(COUNTED),
        )
        h.dwell()
        h.engine.processTransitions()

        h.exit()
        h.engine.retryPending()

        assertEquals(2, h.submitter.sent.size)
        assertEquals(1, h.notifier.checkIns.size)
    }
}

// ---------------------------------------------------------------------------
// Turning off, signing out, and authority changing elsewhere
// ---------------------------------------------------------------------------

class TurnOffTest {

    @Test
    fun `turning off leaves nothing behind and tells the server`() = runTest {
        val h = EngineHarness()
        h.confirming()
        h.on()
        h.submitter.answers = mutableListOf(Result.success(pendingUntil(NOW + 60_000)))
        h.dwell()
        h.engine.processTransitions()
        h.dwell()

        h.engine.turnOff()

        assertTrue(h.monitor.regions.isEmpty())
        assertEquals(0, h.attempts.count())
        assertTrue(h.inbox.items.isEmpty())
        assertTrue(h.scheduler.cancels >= 1)
        assertTrue(h.notifier.clears >= 1)
        assertEquals(listOf(true, false), h.consent.calls)
        val record = h.records.record
        assertFalse(record.enabled)
        assertEquals("revoked", record.serverConsent)
        assertFalse(record.consentRevocationPending)
        assertNull(record.pendingConfirmation)
    }

    @Test
    fun `turning off offline still stops at once and tells the server later`() = runTest {
        val h = EngineHarness().on()
        h.consent.failure = TransientAttendanceFailure("offline")

        h.engine.turnOff()

        assertTrue(h.monitor.regions.isEmpty())
        assertTrue(h.records.record.consentRevocationPending)
        assertEquals(1, h.scheduler.revokes)

        h.consent.failure = null
        assertEquals(WorkResult.Done, h.engine.revokePendingConsent())
        assertFalse(h.records.record.consentRevocationPending)

        // A bootstrap that still says "granted" does not turn it back on.
        h.engine.sync(h.snapshot(consentState = "granted", version = 9), ReconcileTrigger.Foreground)
        assertFalse(h.records.record.enabled)
        assertTrue(h.monitor.regions.isEmpty())
    }

    @Test
    fun `signing out removes the record, the regions and the work`() = runTest {
        val h = EngineHarness().on()

        h.engine.signOut()

        assertTrue(h.monitor.regions.isEmpty())
        assertEquals(1, h.records.clears)
        assertFalse(h.records.record.enabled)
        assertTrue(h.scheduler.cancels >= 1)
    }

    @Test
    fun `no session on the device means nothing stays registered`() = runTest {
        val h = EngineHarness().on()
        h.identity = null

        h.engine.reconcile(ReconcileTrigger.BootOrUpdate)

        assertTrue(h.monitor.regions.isEmpty())
        assertFalse(h.records.record.enabled)
    }

    @Test
    fun `another account on the device starts from nothing`() = runTest {
        val h = EngineHarness().on()
        h.identity = AttendanceIdentity("test", "acct-2")

        h.engine.reconcile(ReconcileTrigger.Foreground)

        assertTrue(h.monitor.regions.isEmpty())
        assertFalse(h.records.record.enabled)
        assertNull(h.records.record.accountId)
    }

    @Test
    fun `consent withdrawn on another device turns it off here too`() = runTest {
        val h = EngineHarness().on()

        h.engine.sync(h.snapshot(consentState = "revoked", version = 10), ReconcileTrigger.Foreground)

        assertFalse(h.records.record.enabled)
        assertTrue(h.monitor.regions.isEmpty())
        assertEquals("consent_revoked", h.records.record.lastRefusal)
    }

    @Test
    fun `a bootstrap loaded before turning on cannot undo it`() = runTest {
        val h = EngineHarness().on()

        h.engine.sync(h.snapshot(consentState = "unset", version = 7), ReconcileTrigger.Foreground)

        assertTrue(h.records.record.enabled)
        assertEquals(1, h.monitor.regions.size)
    }

    @Test
    fun `turning on offline changes nothing`() = runTest {
        val h = EngineHarness()
        h.consent.failure = TransientAttendanceFailure("offline")

        assertEquals(TurnOnResult.Offline, h.engine.turnOn(h.snapshot()))
        assertFalse(h.records.record.enabled)
        assertTrue(h.monitor.regions.isEmpty())
    }

    @Test
    fun `a church switching automatic check-in off stops monitoring but keeps the choice`() = runTest {
        val h = EngineHarness().on()
        h.source.states["grace"] = GeofenceConfigurationState.Refused("geofence_disabled")

        h.engine.reconcile(ReconcileTrigger.ConfigurationRefreshed)

        assertTrue(h.monitor.regions.isEmpty())
        assertTrue(h.records.record.enabled)
        assertEquals("geofence_disabled", h.records.record.monitoringRefusal)

        // And when the church turns it back on, nobody has to set it up again.
        h.source.states["grace"] = GeofenceConfigurationState.Available(churchConfig())
        h.engine.reconcile(ReconcileTrigger.Foreground)
        assertEquals(1, h.monitor.regions.size)
        assertNull(h.records.record.monitoringRefusal)
    }

    @Test
    fun `a rejected attempt asks for a fresh configuration`() = runTest {
        val h = EngineHarness().on()
        h.submitter.answers = mutableListOf(Result.success(REJECTED))

        h.dwell()
        h.engine.processTransitions()

        assertTrue(h.scheduler.reconciles.any { it.first == ReconcileTrigger.ConfigurationRefreshed })
        assertTrue(h.notifier.checkIns.isEmpty())
        assertTrue(h.records.record.enabled)
    }

    @Test
    fun `the next check-in window re-arms the fences`() = runTest {
        val opens = NOW + 3_600_000
        val h = EngineHarness()
        h.source.states["grace"] = GeofenceConfigurationState.Available(
            churchConfig(windows = listOf(window(opens = opens, closes = opens + 5_400_000))),
        )
        h.on()

        assertTrue(ReconcileTrigger.WindowBoundary to opens in h.scheduler.reconciles)
        val next = h.engine.upcoming()
        assertEquals(opens, next?.checkInOpensAtEpochMillis)
        assertFalse(next!!.checkInOpen)
    }
}

// ---------------------------------------------------------------------------
// Several churches: reconciliation and prioritisation
// ---------------------------------------------------------------------------

class MultiChurchReconcilerTest {
    private val base = PARTITION.copy(churchSlug = null)

    private fun regions(slug: String, count: Int) = (0 until count).map {
        region(String.format("faithform.campus.%s-%02d", slug, it), lat = 38.0 + it / 100.0)
    }

    @Test
    fun `the selected church comes first, then the soonest window, then the name`() {
        val soon = churchConfig(slug = "zion", windows = listOf(window(opens = NOW + 60_000)))
        val later = churchConfig(slug = "abbey", windows = listOf(window(opens = NOW + 86_400_000)))
        val none = churchConfig(slug = "bethel", windows = emptyList())
        val selected = churchConfig(slug = "hope", windows = emptyList())

        val order = GeofenceReconciler.prioritise(
            mapOf("abbey" to later, "bethel" to none, "hope" to selected, "zion" to soon),
            primary = "hope",
            nowEpochMillis = NOW,
        ).map { it.churchSlug }

        assertEquals(listOf("hope", "zion", "abbey", "bethel"), order)
    }

    @Test
    fun `an open window counts as now`() {
        val open = churchConfig(windows = listOf(window(opens = NOW - 60_000, closes = NOW + 60_000)))
        val closed = churchConfig(windows = listOf(window(opens = NOW - 120_000, closes = NOW - 60_000)))
        assertEquals(NOW, GeofenceReconciler.nextWindowOpening(open, NOW))
        assertEquals(Long.MAX_VALUE, GeofenceReconciler.nextWindowOpening(closed, NOW))
    }

    @Test
    fun `churches together never exceed Android's limit, and the lowest priority gives way`() = runTest {
        val slugs = listOf("a", "b", "c", "d", "e", "f")
        val source = ChurchSource(
            slugs.associateWith {
                GeofenceConfigurationState.Available(churchConfig(slug = it, regions = regions(it, 20)))
            }.toMutableMap<String, GeofenceConfigurationState>(),
        )
        val monitor = FakeMonitor()
        val reconciler = GeofenceReconciler(monitor, FakePermissions(), source) { NOW }
        reconciler.bind(base.copy(churchSlug = "c"), slugs.sortedBy { if (it == "c") 0 else 1 }, enabled = true)

        val outcome = reconciler.reconcile(ReconcileTrigger.OptIn)

        assertEquals(ANDROID_GEOFENCE_LIMIT, outcome.monitoring)
        assertEquals(ANDROID_GEOFENCE_LIMIT, monitor.regions.size)
        // The selected church is always whole.
        assertEquals(20, monitor.regions.count { it.churchSlug == "c" })
        // Five others fit; the last by priority is the one left out.
        assertEquals(20, outcome.droppedForCapacity.size)
        assertTrue(outcome.droppedForCapacity.all { it.contains("campus.f-") })
    }

    @Test
    fun `each church keeps the shared cap of twenty`() {
        val selection = GeofenceReconciler.selectAcrossChurches(
            listOf(churchConfig(slug = "big", regions = regions("big", 25))),
        )
        assertEquals(MONITORED_REGION_LIMIT, selection.regions.size)
        assertEquals(5, selection.dropped.size)
    }

    @Test
    fun `leaving a church removes its regions, joining one leaves the others alone`() = runTest {
        val source = ChurchSource(
            mutableMapOf(
                "grace" to GeofenceConfigurationState.Available(churchConfig(slug = "grace", regions = regions("grace", 2))),
                "hope" to GeofenceConfigurationState.Available(churchConfig(slug = "hope", regions = regions("hope", 2))),
            ),
        )
        val monitor = FakeMonitor()
        val reconciler = GeofenceReconciler(monitor, FakePermissions(), source) { NOW }
        reconciler.bind(base, listOf("grace"), enabled = true)
        reconciler.reconcile(ReconcileTrigger.OptIn)

        // Joining another church: nothing already registered is torn down.
        reconciler.bind(base, listOf("grace", "hope"), enabled = true)
        assertTrue(monitor.stopCalls.isEmpty())
        val joined = reconciler.reconcile(ReconcileTrigger.ChurchChanged)
        assertEquals(4, joined.monitoring)
        assertTrue(joined.removed.isEmpty())

        // Selecting the other church reorders; still nothing torn down.
        reconciler.bind(base, listOf("hope", "grace"), enabled = true)
        assertTrue(monitor.stopCalls.isEmpty())

        // Leaving one: everything goes before anything is registered again.
        reconciler.bind(base, listOf("hope"), enabled = true)
        assertTrue(monitor.regions.isEmpty())
        reconciler.reconcile(ReconcileTrigger.ChurchChanged)
        assertTrue(monitor.regions.all { it.churchSlug == "hope" })
    }

    @Test
    fun `one church offline keeps its regions while another refuses`() = runTest {
        val source = ChurchSource(
            mutableMapOf(
                "grace" to GeofenceConfigurationState.Available(churchConfig(slug = "grace", regions = regions("grace", 1))),
                "hope" to GeofenceConfigurationState.Available(churchConfig(slug = "hope", regions = regions("hope", 1))),
            ),
        )
        val monitor = FakeMonitor()
        val reconciler = GeofenceReconciler(monitor, FakePermissions(), source) { NOW }
        reconciler.bind(base, listOf("grace", "hope"), enabled = true)
        reconciler.reconcile(ReconcileTrigger.OptIn)

        source.states["grace"] = GeofenceConfigurationState.Unavailable
        source.states["hope"] = GeofenceConfigurationState.Refused("no_people_link")
        val outcome = reconciler.reconcile(ReconcileTrigger.Foreground)

        assertEquals(listOf("grace"), monitor.regions.map { it.churchSlug })
        assertEquals("configuration_unavailable", outcome.refusalFor("grace"))
        assertEquals("no_people_link", outcome.refusalFor("hope"))
    }

    @Test
    fun `a device condition is every church's refusal`() {
        val outcome = ReconcileOutcome(refusal = "needs_background_permission")
        assertEquals("needs_background_permission", outcome.refusalFor("grace"))
        assertEquals("needs_background_permission", outcome.refusalFor("hope"))
        // A church refusal is only that church's.
        val church = ReconcileOutcome(refusal = "geofence_disabled", refusals = mapOf("grace" to "geofence_disabled"))
        assertNull(church.refusalFor("hope"))
    }

    @Test
    fun `a region's church is known in a process that never reconciled`() = runTest {
        val source = ChurchSource(
            mutableMapOf("hope" to GeofenceConfigurationState.Available(churchConfig(slug = "hope"))),
        )
        val monitor = FakeMonitor()
        GeofenceReconciler(monitor, FakePermissions(), source) { NOW }.apply {
            bind(base, listOf("hope"), enabled = true)
            reconcile(ReconcileTrigger.OptIn)
        }

        val fresh = GeofenceReconciler(monitor, FakePermissions(), source) { NOW }
        assertEquals("hope", fresh.churchFor(CAMPUS))
        assertNull(fresh.churchFor("faithform.campus.unknown"))
    }

    @Test
    fun `triggers that mean the system may hold nothing register everything again`() = runTest {
        val source = ChurchSource(
            mutableMapOf("grace" to GeofenceConfigurationState.Available(churchConfig())),
        )
        val monitor = FakeMonitor()
        val reconciler = GeofenceReconciler(monitor, FakePermissions(), source) { NOW }
        reconciler.bind(base, listOf("grace"), enabled = true)
        reconciler.reconcile(ReconcileTrigger.OptIn)

        for (trigger in listOf(
            ReconcileTrigger.Launch,
            ReconcileTrigger.WindowBoundary,
            ReconcileTrigger.ServicesReset,
            ReconcileTrigger.BootOrUpdate,
        )) {
            val before = monitor.startCalls.size
            reconciler.reconcile(trigger)
            assertEquals("$trigger did not re-register", before + 1, monitor.startCalls.size)
        }

        // An ordinary foreground is still free.
        val before = monitor.startCalls.size
        reconciler.reconcile(ReconcileTrigger.Foreground)
        assertEquals(before, monitor.startCalls.size)
    }

    @Test
    fun `an explicit refresh does not trust the cached configuration`() = runTest {
        val source = ChurchSource(
            mutableMapOf("grace" to GeofenceConfigurationState.Available(churchConfig())),
        )
        val reconciler = GeofenceReconciler(FakeMonitor(), FakePermissions(), source) { NOW }
        reconciler.bind(base, listOf("grace"), enabled = true)

        reconciler.reconcile(ReconcileTrigger.Foreground)
        reconciler.reconcile(ReconcileTrigger.ConfigurationRefreshed)

        assertEquals(listOf(false, true), source.calls.map { it.third })
    }

    @Test
    fun `a feature that is off and never registered anything costs no system call`() = runTest {
        val monitor = FakeMonitor()
        val reconciler = GeofenceReconciler(monitor, FakePermissions(), ChurchSource()) { NOW }

        reconciler.reconcile(ReconcileTrigger.Foreground)

        assertTrue(monitor.stopCalls.isEmpty())
    }
}
