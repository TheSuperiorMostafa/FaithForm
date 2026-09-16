package io.faithform.app.attendance

import io.faithform.app.storage.CachePartition
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

// ---------------------------------------------------------------------------
// What the engine is given
// ---------------------------------------------------------------------------

/** The geofence transitions the app acts on. */
enum class TransitionKind(val wire: String) {
    /** Crossed in. Recorded nowhere: an entry alone is not an arrival. */
    Enter("enter"),

    /** Stayed inside for the loitering delay. The only thing that starts a check-in. */
    Dwell("dwell"),

    /** Left. Abandons anything not yet counted. */
    Exit("exit");

    companion object {
        fun fromWire(value: String?): TransitionKind? = entries.firstOrNull { it.wire == value }
    }
}

/**
 * A transition waiting to be handled.
 *
 * Kept in the encrypted store, never in a work request's input: a region id and
 * a transition together are a fact about where a person was.
 */
data class PendingTransition(
    val kind: TransitionKind,
    val regionId: String,
    val atEpochMillis: Long,
)

/** Transitions in the order they arrived. Encrypted and bounded on device. */
interface TransitionInbox {
    suspend fun append(transition: PendingTransition)
    suspend fun all(): List<PendingTransition>
    suspend fun remove(transition: PendingTransition)
    suspend fun clear()
}

/** A church this account belongs to, as the status screen and a notification name it. */
data class ChurchName(val slug: String, val name: String)

/** The last check-in a server counted automatically. Never a local guess. */
data class LastCheckIn(
    val churchSlug: String,
    val churchName: String,
    val serviceLabel: String?,
    val atEpochMillis: Long,
)

/**
 * A detection the server accepted and the church wants confirmed.
 *
 * The person is asked "are you at church?" from [notBeforeEpochMillis] — the
 * server's own instant — and the confirmation carries a fresh fix.
 */
data class PendingConfirmation(
    val churchSlug: String,
    val occurrenceId: String,
    val notBeforeEpochMillis: Long,
)

/**
 * Everything this device keeps about automatic attendance.
 *
 * Encrypted on device, cleared on sign-out, and deliberately small: the choice,
 * who it was made for, what the last pass found, and at most one pending
 * confirmation. No position and no history of transitions.
 */
data class AutomaticAttendanceRecord(
    val enabled: Boolean = false,
    val serverConsent: String = "unset",
    val environment: String? = null,
    val accountId: String? = null,
    val authorizationVersion: Int = 0,
    /** Primary first. */
    val churches: List<ChurchName> = emptyList(),
    val monitoring: Int = 0,
    /** The last reconciliation's refusal for the primary church, or a device condition. */
    val monitoringRefusal: String? = null,
    /** The last evidence refusal, for support; never shown as a failure on its own. */
    val lastRefusal: String? = null,
    val lastCheckIn: LastCheckIn? = null,
    val settledOccurrences: List<String> = emptyList(),
    val notifiedOccurrences: List<String> = emptyList(),
    val pendingConfirmation: PendingConfirmation? = null,
    /** Turned off while offline: the server still has to hear it. */
    val consentRevocationPending: Boolean = false,
    /** Churches that refused automatic check-in on the last pass, while others may still be watched. */
    val unavailableAt: List<String> = emptyList(),
) {
    val primaryChurch: String? get() = churches.firstOrNull()?.slug

    /** The church's name, or blank when this record does not know it — the screen then says "your church". */
    fun churchName(slug: String): String = churches.firstOrNull { it.slug == slug }?.name.orEmpty()

    fun settings(): AutomaticAttendanceSettings = AutomaticAttendanceSettings(
        enabled = enabled,
        serverConsent = serverConsent,
        churchSlug = primaryChurch,
        churchSlugs = churches.map { it.slug },
    )
}

interface AutomaticAttendanceRecordStore {
    suspend fun load(): AutomaticAttendanceRecord
    suspend fun save(record: AutomaticAttendanceRecord)
    suspend fun clear()
}

/**
 * What the notification layer is asked to show.
 *
 * Facts only; the words are the app's, in its string resources. Nothing here
 * carries a position.
 */
interface AttendanceNotifier {
    fun askToConfirm(churchSlug: String, churchName: String, serviceLabel: String?)
    fun checkedIn(churchSlug: String, churchName: String, serviceLabel: String?)

    /** Only after the person tapped Check in and the server still refused. */
    fun notCheckedIn(churchSlug: String, churchName: String)
    fun withdrawQuestion()
    fun clearAll()
}

/**
 * Background work, abstracted from WorkManager.
 *
 * Every request is one-time and unique by name. There is no periodic work: the
 * system's geofencing wakes the app, and each of these runs once for a reason.
 */
interface AttendanceScheduler {
    /** Handle the transition inbox now. No constraints: an exit needs no network. */
    fun processTransitions()

    /** Retry what could not be sent, when a network is available, with backoff. */
    fun retryWhenOnline()

    /** Ask "are you at church?" at the server's instant. */
    fun promptAt(epochMillis: Long)

    /** Send a confirmation, when a network is available, not before [atEpochMillis]. */
    fun confirmWhenOnline(atEpochMillis: Long? = null)

    /** Reconcile, when a network is available, not before [atEpochMillis]. */
    fun reconcileWhenOnline(trigger: ReconcileTrigger, atEpochMillis: Long? = null)

    /**
     * Re-register every fence at [epochMillis], so a person still there when a
     * hold lifts gets their dwell reported again. Separate from the window
     * boundary, which each reconciliation reschedules.
     */
    fun rearmAt(epochMillis: Long)

    /** Tell the server consent was withdrawn, when a network is available. */
    fun revokeConsentWhenOnline()

    /** Cancels everything above. */
    fun cancelAll()
}

/** The server's consent route. */
interface AttendanceConsentClient {
    /**
     * Records the account's choice and returns what the server now holds.
     *
     * @throws TransientAttendanceFailure when the server could not be reached.
     */
    suspend fun record(granted: Boolean): ConsentRecorded
}

data class ConsentRecorded(val consent: String, val authorizationVersion: Int)

/** Who is signed in on this device, from the session store. */
data class AttendanceIdentity(val environment: String, val accountId: String)

/** The account as the signed-in shell last loaded it. */
data class AttendanceAccountSnapshot(
    val environment: String,
    val accountId: String,
    val authorizationVersion: Int,
    val consent: String,
    /** Churches this account may read, the selected one first. */
    val churches: List<ChurchName>,
)

/** The next service at a church being watched, for the status screen. */
data class NextService(
    val churchSlug: String,
    val churchName: String,
    val label: String,
    val startsAtEpochMillis: Long,
    val checkInOpensAtEpochMillis: Long,
    val checkInOpen: Boolean,
)

/** What a piece of background work should tell its scheduler. */
enum class WorkResult { Done, RetryLater }

/** What turning the feature on produced. */
sealed interface TurnOnResult {
    data class On(val outcome: ReconcileOutcome) : TurnOnResult

    /**
     * No church this person can read offers automatic check-in. Consent was
     * withdrawn again and nothing will be asked for.
     */
    data class NotOffered(val reason: String) : TurnOnResult
    data object Offline : TurnOnResult
    data object Failed : TurnOnResult
}

// ---------------------------------------------------------------------------
// The engine
// ---------------------------------------------------------------------------

/**
 * Automatic attendance, from a geofence transition to a notification.
 *
 * The coordinator decides what a transition *means*; this decides what the app
 * *does* about it — which transition starts a check-in, when to ask the person,
 * when to try again, and what to leave behind when the feature is turned off.
 * Pure JVM, like everything else in this module, so every one of those rules is
 * a test rather than a walk to church.
 *
 * ## The rules
 *
 * * **Nothing leaves the phone before a dwell.** An entry records nothing; a
 *   dwell — the device stayed at least the church's `minDwellSeconds`, never
 *   less than [MINIMUM_ARRIVAL_DWELL_SECONDS] — starts the check-in. A drive-by
 *   during a service window costs no fix, no request and no row.
 * * **An exit abandons** anything not yet counted, including a question
 *   already on screen.
 * * **A church that requires confirmation is asked.** When the server answers
 *   `pending_confirmation`, the person is asked "are you at church?" at the
 *   server's instant, and only their tap sends the confirmation. Otherwise the
 *   server counts on the first submission and the person is told they are in.
 * * **Offline waits for a network**, with the same logical attempt and so the
 *   same idempotency key. An arrival whose occurrence could not even be looked
 *   up is kept in the inbox and replayed.
 * * **A check-in window re-arms the fences.** An early arrival's dwell finds no
 *   open occurrence; re-registering at the window's opening makes the system
 *   report the dwell again, without polling.
 *
 * ## Concurrency
 *
 * One [Mutex] around every operation: a worker, a receiver and the screen can
 * all reach this at once, and turning the feature off must never interleave
 * with a check-in that is half sent.
 */
class AutomaticAttendanceEngine(
    private val coordinator: AutomaticAttendanceCoordinator,
    private val reconciler: GeofenceReconciler,
    private val records: AutomaticAttendanceRecordStore,
    private val inbox: TransitionInbox,
    private val attempts: AttendanceAttemptStore,
    private val notifier: AttendanceNotifier,
    private val scheduler: AttendanceScheduler,
    private val consent: AttendanceConsentClient,
    private val identity: () -> AttendanceIdentity?,
    private val clock: () -> Long = System::currentTimeMillis,
) {
    private val mutex = Mutex()

    private val _record = MutableStateFlow(AutomaticAttendanceRecord())

    /** The record as last saved, for the screen. */
    val record: StateFlow<AutomaticAttendanceRecord> = _record.asStateFlow()

    /** Reads the stored record into [record]. Cheap; safe from any thread. */
    suspend fun refresh(): AutomaticAttendanceRecord = mutex.withLock { load() }

    // -----------------------------------------------------------------------
    // From the system
    // -----------------------------------------------------------------------

    /**
     * A transition, straight from the broadcast.
     *
     * Only ours, only one per broadcast — two overlapping campuses of the same
     * church are one arrival — and only a dwell or an exit is kept. Handling
     * happens in [processTransitions], in work that is allowed to take longer
     * than a receiver.
     */
    suspend fun recordTransition(kind: TransitionKind, regionIds: List<String>) {
        val regionId = regionIds.firstOrNull {
            it.startsWith(AutomaticAttendanceCoordinator.REGION_ID_PREFIX)
        } ?: return
        if (kind == TransitionKind.Enter) return

        val keep = mutex.withLock {
            val current = load()
            if (!current.enabled) return@withLock false
            inbox.append(PendingTransition(kind, regionId, clock()))
            true
        }
        if (keep) {
            scheduler.processTransitions()
        } else {
            // A fence fired for a feature that is off. It should not exist; the
            // reconciliation removes it rather than leaving it to fire again.
            scheduler.reconcileWhenOnline(ReconcileTrigger.Teardown)
        }
    }

    /** Handles the inbox in order. Called from background work. */
    suspend fun processTransitions(): WorkResult = mutex.withLock {
        if (!bindLocked()) {
            inbox.clear()
            return@withLock WorkResult.Done
        }

        // Anything already queued goes first, under its own key.
        val queued = coordinator.openAttempt()?.first?.takeIf { it.queued != null }
        if (queued != null) {
            when (val flushed = coordinator.flushPending()) {
                is EvidencePhase.Retrying -> {
                    scheduler.retryWhenOnline()
                    return@withLock WorkResult.RetryLater
                }
                is EvidencePhase.Counted -> onCountedLocked(queued.churchSlug, flushed)
                is EvidencePhase.AwaitingDwell ->
                    onAwaitingConfirmationLocked(queued.churchSlug, flushed.occurrenceId)
                is EvidencePhase.Refused -> onRefusedLocked(flushed.reason)
                else -> Unit
            }
        }

        val pending = inbox.all()
        for ((index, transition) in pending.withIndex()) {
            if (clock() - transition.atEpochMillis > INBOX_LIFETIME_MILLIS) {
                // Its fix would describe somewhere else by now.
                inbox.remove(transition)
                continue
            }

            when (transition.kind) {
                TransitionKind.Enter -> inbox.remove(transition)

                TransitionKind.Exit -> {
                    val church = reconciler.churchFor(transition.regionId)
                    coordinator.handleRegionExited(transition.regionId)
                    val current = load()
                    val question = current.pendingConfirmation
                    if (question != null && (church == null || question.churchSlug == church) &&
                        coordinator.openAttempt()?.first?.occurrenceId != question.occurrenceId
                    ) {
                        notifier.withdrawQuestion()
                        save(current.copy(pendingConfirmation = null))
                    }
                    inbox.remove(transition)
                }

                TransitionKind.Dwell -> {
                    // A dwell already followed by an exit is a pass, not an
                    // arrival: nothing is sent for it.
                    val leftSince = pending.drop(index + 1).any {
                        it.kind == TransitionKind.Exit && it.regionId == transition.regionId
                    }
                    if (leftSince) {
                        inbox.remove(transition)
                        continue
                    }

                    // Bound again from the record before each arrival: a
                    // refusal for one church stops the coordinator in memory,
                    // and must not read as the person having turned it off.
                    if (!bindLocked()) {
                        inbox.clear()
                        break
                    }

                    val church = reconciler.churchFor(transition.regionId)
                        ?: load().primaryChurch
                    when (val phase = coordinator.handleRegionEntered(transition.regionId)) {
                        is EvidencePhase.Retrying -> {
                            // With an occurrence, the evidence is queued on the
                            // attempt and flushes under its key; without one,
                            // nothing was opened and the arrival itself replays.
                            if (phase.occurrenceId != null) inbox.remove(transition)
                            scheduler.retryWhenOnline()
                            persistSettledLocked()
                            return@withLock WorkResult.RetryLater
                        }
                        is EvidencePhase.Counted -> {
                            if (church != null) onCountedLocked(church, phase)
                            inbox.remove(transition)
                        }
                        is EvidencePhase.AwaitingDwell -> {
                            if (church != null) onAwaitingConfirmationLocked(church, phase.occurrenceId)
                            inbox.remove(transition)
                        }
                        is EvidencePhase.Holding -> {
                            // Backing off after refusals. Re-arming at the end
                            // of the hold makes the system report the dwell
                            // again if the person is still there — no timer,
                            // no polling, and never a lockout.
                            scheduler.rearmAt(phase.untilEpochMillis)
                            inbox.remove(transition)
                        }
                        is EvidencePhase.Refused -> {
                            onRefusedLocked(phase.reason)
                            inbox.remove(transition)
                        }
                        else -> inbox.remove(transition)
                    }
                }
            }
        }

        persistSettledLocked()
        WorkResult.Done
    }

    /**
     * Retries anything that could not be sent. Called when a network returns.
     *
     * The same pass as [processTransitions], which flushes a queued submission
     * — a `detected` or a `confirm` — before anything else, under its key.
     */
    suspend fun retryPending(): WorkResult = processTransitions()

    /** The server's instant for a pending confirmation has come: ask the person. */
    suspend fun askIfStillPending() = mutex.withLock {
        if (!bindLocked()) return@withLock
        val current = load()
        val question = current.pendingConfirmation ?: return@withLock
        val open = coordinator.openAttempt()
        if (open == null || open.first.occurrenceId != question.occurrenceId) {
            // Closed by an exit, an expiry or a teardown since it was scheduled.
            notifier.withdrawQuestion()
            save(current.copy(pendingConfirmation = null))
            return@withLock
        }
        if (clock() < question.notBeforeEpochMillis) {
            scheduler.promptAt(question.notBeforeEpochMillis)
            return@withLock
        }
        notifier.askToConfirm(
            churchSlug = question.churchSlug,
            churchName = current.churchName(question.churchSlug),
            serviceLabel = serviceLabel(question.churchSlug, question.occurrenceId),
        )
    }

    /**
     * The person said yes — from the notification, or from the Check in tab.
     *
     * Before the server's instant this schedules the confirmation for then
     * rather than sending one the server would refuse.
     */
    suspend fun confirmArrival(): WorkResult = mutex.withLock {
        if (!bindLocked()) return@withLock WorkResult.Done
        val current = load()
        val open = coordinator.openAttempt()
        if (open == null) {
            notifier.withdrawQuestion()
            save(current.copy(pendingConfirmation = null))
            return@withLock WorkResult.Done
        }
        val attempt = open.first
        val notBefore = attempt.confirmationNotBeforeEpochMillis
        if (attempt.queued == null && notBefore != null && clock() < notBefore) {
            scheduler.confirmWhenOnline(notBefore)
            return@withLock WorkResult.Done
        }

        val phase = if (attempt.queued != null) coordinator.flushPending() else coordinator.confirmIfDue()
        when (phase) {
            is EvidencePhase.Counted -> onCountedLocked(attempt.churchSlug, phase)
            is EvidencePhase.Retrying -> {
                persistSettledLocked()
                return@withLock WorkResult.RetryLater
            }
            is EvidencePhase.AwaitingDwell -> {
                // The server's reckoning of the dwell is not complete yet.
                scheduler.confirmWhenOnline(clock() + CONFIRMATION_RECHECK_MILLIS)
            }
            is EvidencePhase.Refused -> {
                notifier.withdrawQuestion()
                // The person was asked and said yes: they are told it did not
                // work, and that the code on screen still does.
                current.pendingConfirmation?.let { asked ->
                    notifier.notCheckedIn(asked.churchSlug, current.churchName(asked.churchSlug))
                }
                onRefusedLocked(phase.reason)
                save(load().copy(pendingConfirmation = null))
            }
            else -> {
                if (!attempt.mayConfirm(clock()) && attempt.detectionId == null) {
                    // Nothing the server would accept. Let it expire honestly.
                    notifier.withdrawQuestion()
                    save(current.copy(pendingConfirmation = null))
                }
            }
        }
        persistSettledLocked()
        WorkResult.Done
    }

    /** A reconciliation from boot, an update, a window boundary or the screen. */
    suspend fun reconcile(trigger: ReconcileTrigger): WorkResult = mutex.withLock {
        reconcileLocked(trigger)
    }

    // -----------------------------------------------------------------------
    // From the person
    // -----------------------------------------------------------------------

    /**
     * The signed-in shell loaded or changed: a launch, a foreground, a church
     * switch, a new authorization version.
     */
    suspend fun sync(snapshot: AttendanceAccountSnapshot, trigger: ReconcileTrigger): WorkResult =
        mutex.withLock {
            adoptLocked(snapshot)
            reconcileLocked(trigger)
        }

    /**
     * Records consent and turns the feature on.
     *
     * Consent comes before any permission is asked for and before any region is
     * registered: monitoring someone the server would refuse would be collecting
     * location for nothing. The permissions follow on the screens after this;
     * until they are granted the reconciliation reports what is missing.
     */
    suspend fun turnOn(snapshot: AttendanceAccountSnapshot): TurnOnResult = mutex.withLock {
        adoptLocked(snapshot)
        val recorded = try {
            consent.record(granted = true)
        } catch (_: TransientAttendanceFailure) {
            return@withLock TurnOnResult.Offline
        } catch (_: Exception) {
            return@withLock TurnOnResult.Failed
        }

        val current = load()
        val next = current.copy(
            enabled = recorded.consent == "granted",
            serverConsent = recorded.consent,
            authorizationVersion = maxOf(current.authorizationVersion, recorded.authorizationVersion),
            consentRevocationPending = false,
            lastRefusal = null,
        )
        save(next)
        if (!next.enabled) return@withLock TurnOnResult.Failed

        bindLocked()

        // Before any permission is asked for: does any church this person can
        // read offer automatic check-in at all? When none does, the consent
        // just recorded is withdrawn and the journey stops — asking for
        // location that nothing would ever use is the wrong question to put.
        val offers = reconciler.offers()
        val refusedOffers = offers.values.filterIsInstance<GeofenceConfigurationState.Refused>()
        if (offers.isNotEmpty() && refusedOffers.size == offers.size &&
            refusedOffers.all { it.reason in NOT_OFFERED_REFUSALS }
        ) {
            val reason = refusedOffers.first().reason
            tearDownLocally()
            val revoked = try {
                consent.record(granted = false)
            } catch (_: Exception) {
                null
            }
            val latest = load()
            save(
                latest.copy(
                    enabled = false,
                    serverConsent = revoked?.consent ?: latest.serverConsent,
                    authorizationVersion = maxOf(latest.authorizationVersion, revoked?.authorizationVersion ?: 0),
                    consentRevocationPending = revoked == null,
                    monitoring = 0,
                    monitoringRefusal = reason,
                ),
            )
            if (revoked == null) scheduler.revokeConsentWhenOnline()
            return@withLock TurnOnResult.NotOffered(reason)
        }

        val outcome = coordinator.enable(next.settings())
        afterReconcileLocked(outcome, ReconcileTrigger.OptIn)
        TurnOnResult.On(outcome)
    }

    /**
     * Turns the feature off and leaves nothing behind.
     *
     * Local first — stop monitoring, cancel work, purge unsent evidence, clear
     * notifications — so whatever the network does, this device stops. Then the
     * server hears it; offline, that is retried until it does.
     */
    suspend fun turnOff() = mutex.withLock {
        bindLocked()
        tearDownLocally()
        val current = load()
        save(
            current.copy(
                enabled = false,
                monitoring = 0,
                monitoringRefusal = null,
                pendingConfirmation = null,
                consentRevocationPending = true,
            ),
        )
        revokeConsentLocked()
    }

    /** The server still has to hear that consent was withdrawn. */
    suspend fun revokePendingConsent(): WorkResult = mutex.withLock {
        val current = load()
        if (!current.consentRevocationPending || current.enabled) return@withLock WorkResult.Done
        revokeConsentLocked()
    }

    /** Sign-out, or a session that ended: everything goes, the record included. */
    suspend fun signOut() = mutex.withLock {
        tearDownLocally()
        records.clear()
        _record.value = AutomaticAttendanceRecord()
    }

    /** The next service at any church being watched, from the configurations. */
    fun upcoming(): NextService? {
        val now = clock()
        val current = _record.value
        return current.churches.mapNotNull { church ->
            val configuration = reconciler.configuration(church.slug) ?: return@mapNotNull null
            configuration.windows.mapNotNull { window ->
                val opens = GeofenceReconciler.parseInstant(window.checkinOpensAt) ?: return@mapNotNull null
                val closes = GeofenceReconciler.parseInstant(window.checkinClosesAt) ?: return@mapNotNull null
                val starts = GeofenceReconciler.parseInstant(window.startsAt) ?: opens
                if (closes <= now) return@mapNotNull null
                NextService(
                    churchSlug = church.slug,
                    churchName = church.name,
                    label = window.label,
                    startsAtEpochMillis = starts,
                    checkInOpensAtEpochMillis = opens,
                    checkInOpen = opens <= now,
                )
            }.minByOrNull { it.checkInOpensAtEpochMillis }
        }.minByOrNull { it.checkInOpensAtEpochMillis }
    }

    /** Whether any watched church requires the person to confirm. */
    fun anyChurchRequiresConfirmation(): Boolean =
        _record.value.churches.any { reconciler.configuration(it.slug)?.requiresConfirmation == true }

    // -----------------------------------------------------------------------
    // Internals — all called with the mutex held
    // -----------------------------------------------------------------------

    private suspend fun load(): AutomaticAttendanceRecord =
        records.load().also { _record.value = it }

    private suspend fun save(record: AutomaticAttendanceRecord) {
        records.save(record)
        _record.value = record
    }

    /**
     * Binds the coordinator to what is stored and who is signed in.
     *
     * Returns whether the feature is on. A record for a different account, or
     * no session at all, is torn down on the spot: regions must never outlive
     * the person they were registered for.
     */
    private suspend fun bindLocked(): Boolean {
        val who = identity()
        var current = load()
        if (who == null) {
            if (current.enabled || current.accountId != null) {
                tearDownLocally()
                records.clear()
                _record.value = AutomaticAttendanceRecord()
            }
            return false
        }
        if (current.accountId != null &&
            (current.accountId != who.accountId || current.environment != who.environment)
        ) {
            tearDownLocally()
            records.clear()
            current = AutomaticAttendanceRecord()
            _record.value = current
        }

        val base = CachePartition(
            environment = who.environment,
            accountId = who.accountId,
            churchSlug = current.primaryChurch,
            authorizationVersion = current.authorizationVersion,
        )
        coordinator.bind(base, who.accountId, current.settings())
        coordinator.restoreSettled(current.settledOccurrences)
        return current.enabled && current.churches.isNotEmpty()
    }

    private suspend fun adoptLocked(snapshot: AttendanceAccountSnapshot) {
        var current = load()
        if (current.accountId != null &&
            (current.accountId != snapshot.accountId || current.environment != snapshot.environment)
        ) {
            tearDownLocally()
            records.clear()
            current = AutomaticAttendanceRecord()
        }

        // Every consent change bumps the authorization version. A snapshot older
        // than what this device already knows — a bootstrap loaded just before
        // the person turned the feature on — says nothing about consent.
        val snapshotIsCurrent = snapshot.authorizationVersion >= current.authorizationVersion
        current = current.copy(
            environment = snapshot.environment,
            accountId = snapshot.accountId,
            // Versions only move forward, so the partition is never wound back.
            authorizationVersion = maxOf(current.authorizationVersion, snapshot.authorizationVersion),
            serverConsent = if (current.consentRevocationPending || !snapshotIsCurrent) {
                current.serverConsent
            } else {
                snapshot.consent
            },
            churches = snapshot.churches,
        )

        if (current.enabled && snapshotIsCurrent && snapshot.consent != "granted" &&
            !current.consentRevocationPending
        ) {
            // Withdrawn somewhere else — another device, the website. This one
            // stops too, and says so.
            tearDownLocally()
            current = current.copy(
                enabled = false,
                monitoring = 0,
                monitoringRefusal = null,
                pendingConfirmation = null,
                lastRefusal = EvidenceRefusal.ConsentRevoked.wire,
            )
        }
        if (current.consentRevocationPending) scheduler.revokeConsentWhenOnline()
        save(current)
    }

    private suspend fun reconcileLocked(trigger: ReconcileTrigger): WorkResult {
        val enabled = bindLocked()
        if (!enabled) {
            // Bound with the feature off, this removes anything still
            // registered — a fence that outlived a teardown, or a record that
            // was cleared underneath it. An ordinary foreground with nothing
            // registered costs nothing; an explicit teardown always asks the
            // system.
            coordinator.reconcile(trigger)
            if (_record.value.monitoring != 0) save(_record.value.copy(monitoring = 0))
            return WorkResult.Done
        }
        val outcome = coordinator.reconcile(trigger)
        return afterReconcileLocked(outcome, trigger)
    }

    private suspend fun afterReconcileLocked(
        outcome: ReconcileOutcome,
        trigger: ReconcileTrigger,
    ): WorkResult {
        val current = load()
        val readable = current.churches.map { it.slug }.toSet()
        save(
            current.copy(
                monitoring = outcome.monitoring,
                monitoringRefusal = outcome.refusal,
                unavailableAt = outcome.refusals.keys.filter { it in readable },
            ),
        )
        scheduleNextWindowLocked()

        // After a reboot or a reset the system holds nothing. Offline, nothing
        // could be registered; try again when there is a network rather than
        // waiting for the person to open the app.
        if (outcome.refusal == "configuration_unavailable" && trigger in RETRY_WHEN_UNAVAILABLE) {
            return WorkResult.RetryLater
        }
        return WorkResult.Done
    }

    /** Re-arms the fences when the next check-in window opens, at any watched church. */
    private fun scheduleNextWindowLocked() {
        val now = clock()
        val next = _record.value.churches
            .mapNotNull { reconciler.configuration(it.slug) }
            .flatMap { it.windows }
            .mapNotNull { GeofenceReconciler.parseInstant(it.checkinOpensAt) }
            .filter { it > now }
            .minOrNull() ?: return
        scheduler.reconcileWhenOnline(ReconcileTrigger.WindowBoundary, next)
    }

    private suspend fun onCountedLocked(churchSlug: String, phase: EvidencePhase.Counted) {
        val current = load()
        val label = serviceLabel(churchSlug, phase.occurrenceId)
        val alreadyTold = phase.occurrenceId in current.notifiedOccurrences
        val question = current.pendingConfirmation?.takeIf { it.occurrenceId == phase.occurrenceId }

        // A person who answered a question hears the answer even when the
        // server had already counted them: a confirmation whose response was
        // lost, and whose retry found it counted.
        if (!alreadyTold && (!phase.alreadyCounted || question != null)) {
            notifier.checkedIn(churchSlug, current.churchName(churchSlug), label)
        } else if (question != null) {
            notifier.withdrawQuestion()
        }

        save(
            current.copy(
                lastCheckIn = if (phase.alreadyCounted && current.lastCheckIn != null) {
                    current.lastCheckIn
                } else {
                    LastCheckIn(churchSlug, current.churchName(churchSlug), label, clock())
                },
                notifiedOccurrences = (current.notifiedOccurrences + phase.occurrenceId)
                    .distinct().takeLast(BOUNDED_HISTORY),
                pendingConfirmation = if (question != null) null else current.pendingConfirmation,
            ),
        )
        persistSettledLocked()
    }

    private suspend fun onAwaitingConfirmationLocked(churchSlug: String, occurrenceId: String) {
        val attempt = coordinator.openAttempt()?.first ?: return
        val notBefore = attempt.confirmationNotBeforeEpochMillis ?: return
        val requiresPerson = reconciler.configuration(churchSlug)?.requiresConfirmation ?: true

        if (!requiresPerson) {
            // The server wants a second submission after its dwell, but this
            // church does not want the person asked: send it at the instant.
            scheduler.confirmWhenOnline(notBefore)
            return
        }

        save(load().copy(pendingConfirmation = PendingConfirmation(churchSlug, occurrenceId, notBefore)))
        scheduler.promptAt(notBefore)
    }

    /**
     * A refusal, from the server or from a fresh configuration.
     *
     * * **Consent withdrawn** is the person's own choice, made somewhere else —
     *   the feature is off on this device too, and says so.
     * * **Anything about the church** — the People link removed, automatic
     *   check-in switched off, the relationship gone — stops monitoring that
     *   church but leaves the person's choice alone. A fresh configuration is
     *   fetched at once, which removes the regions and puts the reason on the
     *   status screen; when the church sets things right, the next
     *   reconciliation brings them back without asking the person again.
     * * **A rejection** with no reason the phone can read — a rate limit, a
     *   church that has just switched the feature off — gets the same fresh
     *   configuration, so a switched-off church is not left monitored until
     *   its cached copy expires.
     */
    private suspend fun onRefusedLocked(reason: EvidenceRefusal) {
        val current = load()
        if (reason in AutomaticAttendanceCoordinator.ACCOUNT_WIDE_REFUSALS && !coordinator.settings.enabled) {
            scheduler.cancelAll()
            notifier.clearAll()
            inbox.clear()
            save(
                current.copy(
                    enabled = false,
                    serverConsent = if (reason == EvidenceRefusal.ConsentRevoked) "revoked" else current.serverConsent,
                    monitoring = 0,
                    pendingConfirmation = null,
                    lastRefusal = reason.wire,
                    monitoringRefusal = null,
                ),
            )
            return
        }
        save(current.copy(lastRefusal = reason.wire))
        if (reason.requiresTeardown || reason == EvidenceRefusal.Unknown) {
            scheduler.reconcileWhenOnline(ReconcileTrigger.ConfigurationRefreshed)
        }
    }

    private suspend fun persistSettledLocked() {
        val settled = coordinator.settledOccurrenceIds()
        val current = load()
        if (settled != current.settledOccurrences) {
            save(current.copy(settledOccurrences = settled.takeLast(BOUNDED_HISTORY)))
        }
    }

    private suspend fun tearDownLocally() {
        coordinator.disable()
        attempts.closeAll()
        inbox.clear()
        scheduler.cancelAll()
        notifier.clearAll()
    }

    private suspend fun revokeConsentLocked(): WorkResult {
        return try {
            val recorded = consent.record(granted = false)
            val current = load()
            save(
                current.copy(
                    serverConsent = recorded.consent,
                    authorizationVersion = maxOf(current.authorizationVersion, recorded.authorizationVersion),
                    consentRevocationPending = false,
                ),
            )
            WorkResult.Done
        } catch (_: TransientAttendanceFailure) {
            scheduler.revokeConsentWhenOnline()
            WorkResult.RetryLater
        } catch (_: Exception) {
            // Refused for a reason a retry will not fix — a session that
            // ended, an account that is gone. Monitoring already stopped.
            val current = load()
            save(current.copy(consentRevocationPending = false))
            WorkResult.Done
        }
    }

    private fun serviceLabel(churchSlug: String, occurrenceId: String): String? =
        reconciler.configuration(churchSlug)?.windows?.firstOrNull { it.occurrenceId == occurrenceId }?.label

    companion object {
        /** A transition older than this describes somewhere the person may no longer be. */
        const val INBOX_LIFETIME_MILLIS = 2L * 60 * 60 * 1000

        /** How long to wait when the server's dwell is not yet complete at confirmation. */
        const val CONFIRMATION_RECHECK_MILLIS = 30_000L

        /** Settled and notified occurrences kept: a handful of services, never a history. */
        const val BOUNDED_HISTORY = 8

        /** A church's own answer that it does not offer automatic check-in. */
        val NOT_OFFERED_REFUSALS = setOf("geofence_disabled", "no_campus_configured")

        val RETRY_WHEN_UNAVAILABLE = setOf(
            ReconcileTrigger.BootOrUpdate,
            ReconcileTrigger.ServicesReset,
            ReconcileTrigger.WindowBoundary,
            ReconcileTrigger.OptIn,
        )
    }
}
