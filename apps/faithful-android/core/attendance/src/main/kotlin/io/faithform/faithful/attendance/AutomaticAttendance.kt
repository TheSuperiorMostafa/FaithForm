package io.faithform.faithful.attendance

import io.faithform.faithful.storage.CachePartition
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

/** What the server decided about one attempt. */
data class AttendanceOutcome(
    val outcome: String,
    val message: String,
    val occurrenceId: String?,
    /**
     * The earliest instant a `confirm` may succeed, from the server.
     *
     * Null on every outcome except `pending_confirmation`. **Scheduling
     * information, not authority** — the server enforces the same deadline
     * again from its own clock.
     */
    val confirmationNotBeforeEpochMillis: Long? = null,
    /** The server-issued detection to present on `confirm`. */
    val detectionId: String? = null,
)

/**
 * Used only when a server predates `confirmationNotBefore`.
 *
 * Deliberately conservative: confirming too early is refused and wastes a
 * submission, whereas confirming late simply costs a little time.
 */
const val FALLBACK_DWELL_MILLIS = 150_000L

/** Raised for a failure the caller should retry; anything else is an answer. */
class TransientAttendanceFailure(message: String) : Exception(message)

/** Raised for a server refusal that must not be retried. */
class TerminalAttendanceFailure(val refusal: EvidenceRefusal) : Exception(refusal.wire)

interface AttendanceSubmitter {
    /**
     * The eligible occurrence right now, resolved by the server from its own
     * clock. The client never picks one from a cached window: a cached window
     * may be stale, and choosing locally would be the client deciding what it
     * is attending.
     */
    suspend fun eligibleOccurrenceId(churchSlug: String): String?

    suspend fun submit(evidence: AttendanceEvidence, idempotencyKey: String): AttendanceOutcome
}

/**
 * Where the open logical attempt lives.
 *
 * Backed by `EncryptedSharedPreferences` on device: it holds an attempt id and,
 * briefly, a position, so it is deliberately not an ordinary preference file or
 * the projection cache.
 *
 * **[openIfAbsent] must be atomic.** It is what makes two simultaneous
 * transitions produce one attempt rather than two with different keys.
 */
interface AttendanceAttemptStore {
    /** The open attempt, if there is one. Expired attempts are not returned. */
    suspend fun current(partition: CachePartition, nowEpochMillis: Long): LogicalAttempt?

    /**
     * Opens [candidate] **only if** no usable attempt is already open for the
     * same church and occurrence, and returns whichever attempt is now open.
     *
     * Returning the *existing* one on a collision is the point: a duplicate
     * transition joins the attempt already in progress instead of starting a
     * second one with a different key.
     */
    suspend fun openIfAbsent(
        candidate: LogicalAttempt,
        partition: CachePartition,
        nowEpochMillis: Long,
    ): LogicalAttempt

    suspend fun update(attempt: LogicalAttempt, partition: CachePartition)

    /** Closes and purges. Called on every terminal outcome and on expiry. */
    suspend fun close(partition: CachePartition)
}

interface LocationSampling {
    /**
     * One fresh fix. Returns null rather than throwing when none arrives in
     * time; the caller submits without coordinates and the server bands that
     * `unknown`, which fails closed.
     */
    suspend fun requestOneShotLocation(timeoutMillis: Long): LocationSample?
}

/** Whether automatic attendance is switched on, as this device last knew. */
data class AutomaticAttendanceSettings(
    /** The person's choice in this app. */
    val enabled: Boolean = false,
    /** What the server last said its consent state was. */
    val serverConsent: String = "unset",
    val churchSlug: String? = null,
) {
    /**
     * All three gates. Deliberately not [enabled] alone: an app toggle that
     * silently means nothing because the server withdrew consent, or because
     * the OS permission was revoked in Settings, would be a lie on screen.
     */
    fun isOperational(permissions: LocationPermissionState): Boolean =
        enabled && serverConsent == "granted" && permissions.canMonitorGeofences
}

/**
 * Drives one geofence transition from callback to server verdict.
 *
 * Mirrors `AutomaticAttendanceCoordinator.swift`. The differences are where the
 * platforms differ; the state machine, the idempotency construction, the retry
 * policy and the canonical request are identical, and the two test suites
 * mirror each other case for case.
 *
 * **Single-flight.** Duplicate transitions are routine — the system re-delivers,
 * and a person in a doorway crosses the boundary repeatedly. A [Mutex] plus an
 * explicit in-flight flag ensures one logical intent at a time.
 *
 * **Never counts locally.** Only a server verdict of `counted` or
 * `already_counted` produces success.
 */
class AutomaticAttendanceCoordinator(
    private val reconciler: GeofenceReconciler,
    private val submitter: AttendanceSubmitter,
    private val sampler: LocationSampling,
    private val store: AttendanceAttemptStore,
    private val permissions: LocationPermissions,
    private val clock: () -> Long = System::currentTimeMillis,
    /** Injectable so a test can name attempt ids and force a collision. */
    private val newAttemptId: () -> String = LogicalAttempt::newAttemptId,
) {
    private val mutex = Mutex()

    @Volatile
    var phase: EvidencePhase = EvidencePhase.Idle
        private set

    @Volatile
    var settings: AutomaticAttendanceSettings = AutomaticAttendanceSettings()
        private set

    private var partition: CachePartition? = null
    private var accountId: String? = null

    /**
     * Set inside the lock, before anything suspends.
     *
     * A mutex serialises the *body*, but the flow suspends on network calls,
     * and holding the lock across them would serialise unrelated callers for
     * seconds. The flag is what actually rejects a duplicate: the same race the
     * iOS implementation had, and the same fix.
     */
    private var isHandlingEvent = false

    /**
     * Occurrences this device has already seen counted.
     *
     * The in-flight flag stops *concurrent* duplicates. It does not stop
     * *sequential* ones — and those are the common case on a real device:
     * someone stands near the door, the system delivers ENTER, then delivers it
     * again minutes later. Without this, every re-entry is another round trip.
     *
     * The server would still refuse to double-count — the idempotency key is
     * identical and the unique fact is absolute — so this is not a correctness
     * guard. It is a "do not wake the radio and the server twenty times for an
     * answer we already have" guard, which on a phone is a battery guard.
     *
     * Bounded and cleared whenever the identity changes, so it can never
     * suppress a legitimate attempt at a different service.
     */
    private val settledOccurrences = LinkedHashSet<String>()

    /**
     * Anti-flapping state per occurrence.
     *
     * **Never a lockout.** An earlier version capped refusals at five and then
     * refused permanently, which was the original bug at a larger number.
     * [AttemptPolicy] replaces the cap with an exponential cooldown, a rolling
     * budget, and triggers that bypass both when something materially changed.
     */
    private val policies = LinkedHashMap<String, AttemptPolicy>()

    /** The accuracy of the most recent fix, so a refusal records what it saw. */
    @Volatile
    private var lastAccuracyMeters: Double? = null

    /** The configuration version a decision was last made against. */
    @Volatile
    var lastConfigVersion: Int? = null

    suspend fun bind(
        partition: CachePartition,
        accountId: String?,
        settings: AutomaticAttendanceSettings,
    ) {
        if (this.partition?.storageKey != partition.storageKey || this.accountId != accountId) {
            // A different identity has different occurrences. Never carry the
            // suppression list across one.
            mutex.withLock {
                settledOccurrences.clear()
                policies.clear()
            }
        }
        this.partition = partition
        this.accountId = accountId
        this.settings = settings
        reconciler.bind(
            partition = partition,
            churchSlug = settings.churchSlug,
            enabled = settings.enabled && settings.serverConsent == "granted",
        )
    }

    /** Turns the feature on and registers whatever the server authorizes. */
    suspend fun enable(settings: AutomaticAttendanceSettings): ReconcileOutcome {
        this.settings = settings
        val currentPartition = partition ?: return ReconcileOutcome.Idle
        reconciler.bind(
            partition = currentPartition,
            churchSlug = settings.churchSlug,
            enabled = settings.enabled && settings.serverConsent == "granted",
        )
        return reconciler.reconcile(ReconcileTrigger.OptIn)
    }

    /** The single funnel every lifecycle trigger goes through. */
    suspend fun reconcile(trigger: ReconcileTrigger): ReconcileOutcome =
        reconciler.reconcile(trigger)

    /**
     * Turns the feature off and leaves nothing behind.
     *
     * Stop monitoring, cancel in-flight work, purge unsent evidence, then
     * record the setting — in that order, so a crash midway cannot leave
     * geofences registered with the feature marked off.
     */
    suspend fun disable() {
        reconciler.teardown()
        mutex.withLock {
            isHandlingEvent = false
            settledOccurrences.clear()
            policies.clear()
        }
        phase = EvidencePhase.Idle
        partition?.let { store.close(it) }
        settings = settings.copy(enabled = false)
    }

    /**
     * A geofence transition, from the system.
     *
     * The entry point for everything: a foreground callback, a background
     * broadcast, and a process relaunch after being killed all arrive here.
     */
    suspend fun handleRegionEntered(regionId: String): EvidencePhase {
        val currentPartition = partition
        val currentAccount = accountId
        if (!settings.enabled || currentPartition == null || currentAccount == null) {
            phase = EvidencePhase.Refused(EvidenceRefusal.ConsentRequired)
            return phase
        }

        // Duplicate transitions are normal, not exceptional. Claimed inside the
        // lock, before anything suspends.
        val claimed = mutex.withLock {
            if (isHandlingEvent) false else { isHandlingEvent = true; true }
        }
        if (!claimed) return phase

        try {
            phase = EvidencePhase.Entered(regionId, clock())

            // The event may have arrived against an expired or revoked
            // configuration. Waking is allowed; acting on it without
            // rechecking is not.
            phase = EvidencePhase.Reauthorizing(regionId)
            val outcome = reconciler.reconcile(ReconcileTrigger.RegionEvent)
            outcome.refusal?.let {
                return fail(EvidenceRefusal.fromReconcile(it), currentPartition)
            }

            val occurrenceId = try {
                submitter.eligibleOccurrenceId(settings.churchSlug.orEmpty())
            } catch (_: Exception) {
                phase = EvidencePhase.Retrying(null, 1, clock() + RetryPolicy.delayMillis(1))
                return phase
            }

            if (occurrenceId == null) {
                // Outside every check-in window. Normal: the person drove past
                // the building on a Tuesday.
                phase = EvidencePhase.Refused(EvidenceRefusal.NoOpenOccurrence)
                return phase
            }

            // Already counted here. Re-entering the building does not need
            // another round trip for an answer we have.
            if (mutex.withLock { occurrenceId in settledOccurrences }) {
                phase = EvidencePhase.Counted(occurrenceId, alreadyCounted = true)
                return phase
            }

            // Take the fix first: whether this attempt may proceed depends on
            // whether the reading is materially better than the one that was
            // refused, and that cannot be known without looking.
            val sample = sampler.requestOneShotLocation(15_000)
            val accuracy = sample?.takeIf { it.isUsable }?.accuracyMeters?.toDouble()
            lastAccuracyMeters = accuracy ?: lastAccuracyMeters

            val policy = mutex.withLock { policies[occurrenceId] } ?: AttemptPolicy()
            when (val decision = policy.decide(clock(), accuracy, lastConfigVersion)) {
                AttemptDecision.AlreadySettled -> {
                    phase = EvidencePhase.Counted(occurrenceId, alreadyCounted = true)
                    return phase
                }
                is AttemptDecision.WaitUntil -> {
                    // **Not a rejection of the occurrence.** The device is
                    // backing off; the next meaningful trigger, or simply this
                    // instant passing, lets it try again.
                    phase = EvidencePhase.Holding(
                        occurrenceId, decision.nextEligibleAtEpochMillis, decision.reason,
                    )
                    return phase
                }
                is AttemptDecision.Proceed -> Unit
            }

            // **Open the logical attempt before anything is submitted.** Two
            // simultaneous transitions both reach here; `openIfAbsent` is
            // atomic, so the second joins the first attempt rather than
            // starting a second one with a different key.
            val attempt = store.openIfAbsent(
                LogicalAttempt.open(
                    churchSlug = settings.churchSlug.orEmpty(),
                    occurrenceId = occurrenceId,
                    nowEpochMillis = clock(),
                    randomId = newAttemptId,
                ),
                currentPartition,
                clock(),
            )

            mutex.withLock { policies[occurrenceId] = policy.recordingSubmission(clock()) }

            return runFlow(attempt, sample, currentAccount, currentPartition)
        } finally {
            mutex.withLock { isHandlingEvent = false }
        }
    }

    /** Leaving before dwell completes abandons the intent. */
    suspend fun handleRegionExited(regionId: String) {
        // A verified exit is the strongest "something changed" signal there is:
        // the person actually left. Recorded for every occurrence being held,
        // so the next entry proceeds regardless of any cooldown.
        mutex.withLock {
            for (key in policies.keys.toList()) {
                policies[key] = policies[key]!!.recordingExit()
            }
        }

        when (phase) {
            is EvidencePhase.Entered,
            is EvidencePhase.Reauthorizing,
            is EvidencePhase.AwaitingDwell,
            -> {
                phase = EvidencePhase.Abandoned
                partition?.let { store.close(it) }
            }
            else -> Unit
        }
    }

    private suspend fun runFlow(
        attempt: LogicalAttempt,
        sample: LocationSample?,
        accountId: String,
        partition: CachePartition,
    ): EvidencePhase {
        val occurrenceId = attempt.occurrenceId

        // Coarse-only permission cannot resolve a campus. Refuse rather than
        // submit a fix that will be banded unusable anyway.
        if (permissions.current().foreground == ForegroundLocationPermission.Coarse) {
            return fail(EvidenceRefusal.InsufficientAccuracy, partition)
        }

        val detected = AttendanceEvidence.from(
            occurrenceId = occurrenceId,
            phase = "detected",
            sample = sample,
            // Sent, but **not used by the server** for a geofence attempt: the
            // dwell is measured between two server timestamps.
            dwellSeconds = 0,
            observedAtEpochMillis = clock(),
            attemptId = attempt.attemptId,
        )

        when (val result = send(detected, attempt, accountId, partition)) {
            is SendOutcome.Refusal -> return fail(result.reason, partition)
            SendOutcome.Transient -> return phase
            is SendOutcome.Answer -> {
                when (result.value.outcome) {
                    "counted", "already_counted" -> return succeed(
                        occurrenceId,
                        result.value.outcome == "already_counted",
                        partition,
                    )
                    "pending_confirmation" -> {
                        // **Persist when the server said we may come back.**
                        // Stored rather than held in memory because this wait
                        // spans exactly the window where the process is most
                        // likely to be killed.
                        store.update(
                            attempt.copy(
                                confirmationNotBeforeEpochMillis =
                                    result.value.confirmationNotBeforeEpochMillis
                                        // An older server sends none; fall back
                                        // rather than confirming blindly.
                                        ?: (clock() + FALLBACK_DWELL_MILLIS),
                                // Without the detection a confirmation has no
                                // identity the server will accept.
                                detectionId = result.value.detectionId,
                            ),
                            partition,
                        )
                    }
                    else -> return fail(EvidenceRefusal.Unknown, partition)
                }
            }
        }

        // Nothing delays here: `confirmIfDue` runs on the next real execution
        // opportunity — an OS dwell transition, another entry, or a foreground.
        phase = EvidencePhase.AwaitingDwell(occurrenceId, clock())
        return phase
    }

    /**
     * Confirms a pending attempt **if the server's instant has passed**.
     *
     * The entry point every legitimate execution opportunity calls: an OS dwell
     * transition, another geofence transition, an app foreground. Safe to call
     * at any time and does nothing when it is not due, so callers need not know
     * the policy.
     */
    suspend fun confirmIfDue(): EvidencePhase {
        if (!settings.enabled) return phase
        val currentPartition = partition ?: return phase
        accountId ?: return phase

        val attempt = store.current(currentPartition, clock()) ?: return phase
        attempt.confirmationNotBeforeEpochMillis ?: return phase

        // Not yet. Sending now would be refused for insufficient dwell, which
        // costs a submission and tells the person nothing.
        if (!attempt.mayConfirm(clock())) return phase

        val elapsedSeconds = ((clock() - attempt.openedAtEpochMillis) / 1000).toInt()
        return confirmDwell(attempt.occurrenceId, maxOf(0, elapsedSeconds))
    }

    /**
     * Completes a dwell the caller has determined is satisfied.
     *
     * **What Android offers, and what this app uses.** Play services *does*
     * have a real dwell transition — `GEOFENCE_TRANSITION_DWELL`, with
     * `setLoiteringDelay` — which is a genuine advantage over iOS, where no
     * such event exists.
     *
     * It is deliberately **not** used here. The server owns the dwell rule,
     * against the occurrence's own `policy_snapshot`, and a church can change
     * `minDwellSeconds` at any time. Registering a device-side loitering delay
     * would put a second copy of that rule on the phone, set at registration
     * time and stale from the moment the policy moved — two authorities that
     * could disagree about the same service.
     *
     * So the device reports elapsed time and the server decides, exactly as on
     * iOS. The cost is that a confirmation needs a later wake — another
     * transition, or the person opening the app — rather than arriving on its
     * own. When neither happens the attempt expires and the person is not
     * counted; nothing pretends otherwise.
     *
     * **There is no in-memory timer**, on either platform. A coroutine delay
     * spanning a dwell would not survive the process being killed, and a
     * `goAsync` receiver has roughly ten seconds regardless.
     */
    suspend fun confirmDwell(occurrenceId: String, dwellSeconds: Int): EvidencePhase {
        val currentPartition = partition ?: return phase
        val currentAccount = accountId ?: return phase
        // **Deliberately not guarded on the in-memory phase.** After a process
        // restart the phase is `Idle` — that is the ordinary case for a
        // background wake, not an edge one — and guarding on it made a
        // persisted attempt unconfirmable forever. The stored attempt *is* the
        // state; memory is only a cache of it.
        //
        // The same logical attempt the `detected` submission opened. If it has
        // gone — expired, or closed by a teardown — this confirmation has no
        // identity and must not invent one.
        val attempt = store.current(currentPartition, clock())
        if (attempt == null || attempt.occurrenceId != occurrenceId) {
            phase = EvidencePhase.Refused(EvidenceRefusal.Expired)
            return phase
        }

        phase = EvidencePhase.Confirming(occurrenceId)

        val sample = sampler.requestOneShotLocation(15_000)
        val confirm = AttendanceEvidence.from(
            occurrenceId = occurrenceId,
            phase = "confirm",
            sample = sample,
            // Reported for the audit. The server ignores it and measures the
            // dwell from its own detection record.
            dwellSeconds = dwellSeconds,
            observedAtEpochMillis = clock(),
            detectionId = attempt.detectionId,
        )

        return when (val result = send(confirm, attempt, currentAccount, currentPartition)) {
            is SendOutcome.Refusal -> fail(result.reason, currentPartition)
            SendOutcome.Transient -> phase
            is SendOutcome.Answer -> {
                when (result.value.outcome) {
                    "counted", "already_counted" ->
                        return succeed(
                            occurrenceId,
                            result.value.outcome == "already_counted",
                            currentPartition,
                        )
                    // Dwell still not satisfied by the server's reckoning.
                    "pending_confirmation" ->
                        phase = EvidencePhase.AwaitingDwell(occurrenceId, clock())
                    else -> return fail(EvidenceRefusal.Unknown, currentPartition)
                }
                phase
            }
        }
    }

    private sealed interface SendOutcome {
        data class Answer(val value: AttendanceOutcome) : SendOutcome
        data class Refusal(val reason: EvidenceRefusal) : SendOutcome
        data object Transient : SendOutcome
    }

    private suspend fun send(
        evidence: AttendanceEvidence,
        attempt: LogicalAttempt,
        accountId: String,
        partition: CachePartition,
    ): SendOutcome {
        // Derived from the *attempt*, not from the occurrence alone. That one
        // change is what stops an early refusal being replayed for the rest of
        // the service.
        val key = IdempotencyKey.geofence(
            accountId = accountId,
            churchSlug = attempt.churchSlug,
            occurrenceId = attempt.occurrenceId,
            attemptId = attempt.attemptId,
            kind = evidence.phase,
        )

        return try {
            val result = submitter.submit(evidence, key)
            if (result.outcome == "rejected") {
                // A rejection is an answer, not an outage, so it is never
                // retried. The reason is not parsed out of the display message
                // — that text is for a person to read.
                SendOutcome.Refusal(EvidenceRefusal.Unknown)
            } else {
                SendOutcome.Answer(result)
            }
        } catch (_: TransientAttendanceFailure) {
            // Queued against the attempt, so the retry reuses this key.
            store.update(attempt.copy(queued = QueuedSubmission.from(evidence)), partition)
            phase = EvidencePhase.Retrying(
                evidence.occurrenceId, 1, clock() + RetryPolicy.delayMillis(1),
            )
            SendOutcome.Transient
        } catch (failure: TerminalAttendanceFailure) {
            SendOutcome.Refusal(failure.refusal)
        } catch (_: Exception) {
            SendOutcome.Refusal(EvidenceRefusal.Unknown)
        }
    }

    /**
     * Retries anything queued. Called on foreground and on connectivity return.
     *
     * The key is re-derived from the stored `attemptId`, so a retry after a
     * process restart is the *same* logical submission and the server
     * recognises it rather than counting a second one.
     */
    suspend fun flushPending(): EvidencePhase {
        val currentPartition = partition ?: return phase
        val currentAccount = accountId ?: return phase
        if (!settings.enabled) return phase

        val attempt = store.current(currentPartition, clock())
        if (attempt == null) {
            // The store purges an expired attempt the moment anything looks at
            // it — the coordinates are past their retention window. So "gone"
            // while a flow was still open means "expired".
            when (phase) {
                is EvidencePhase.Retrying,
                is EvidencePhase.AwaitingDwell,
                is EvidencePhase.Confirming,
                is EvidencePhase.Reauthorizing,
                is EvidencePhase.Entered,
                -> phase = EvidencePhase.Refused(EvidenceRefusal.Expired)
                else -> Unit
            }
            return phase
        }

        val queued = attempt.queued ?: return phase

        if (!RetryPolicy.shouldRetry(queued.retries, isTransient = true)) {
            store.close(currentPartition)
            phase = EvidencePhase.Refused(EvidenceRefusal.Expired)
            return phase
        }

        store.update(attempt.copy(queued = queued.withRetry()), currentPartition)

        val evidence = queued.evidence(
            attempt.occurrenceId,
            attemptId = attempt.attemptId,
            detectionId = attempt.detectionId,
        )

        when (val result = send(evidence, attempt, currentAccount, currentPartition)) {
            is SendOutcome.Answer -> {
                if (result.value.outcome == "counted" || result.value.outcome == "already_counted") {
                    return succeed(
                        attempt.occurrenceId,
                        result.value.outcome == "already_counted",
                        currentPartition,
                    )
                }
            }
            is SendOutcome.Refusal -> return fail(result.reason, currentPartition)
            SendOutcome.Transient -> Unit
        }
        return phase
    }

    /** A server verdict of counted. Closes the attempt and settles the occurrence. */
    private suspend fun succeed(
        occurrenceId: String,
        alreadyCounted: Boolean,
        partition: CachePartition,
    ): EvidencePhase {
        phase = EvidencePhase.Counted(occurrenceId, alreadyCounted)
        markSettled(occurrenceId)
        mutex.withLock {
            policies[occurrenceId] = (policies[occurrenceId] ?: AttemptPolicy()).settling()
        }
        store.close(partition)
        return phase
    }

    /** Bounded: a handful of services, never a growing history. */
    private suspend fun markSettled(occurrenceId: String) = mutex.withLock {
        settledOccurrences += occurrenceId
        while (settledOccurrences.size > 8) {
            settledOccurrences.remove(settledOccurrences.first())
        }
    }

    /**
     * A terminal refusal. **Closes the attempt.**
     *
     * Closing is the whole correction. The next genuine entry opens a new
     * attempt with a new id, so the server validates it fresh instead of
     * replaying this answer — which is what a bad first fix used to earn for
     * the rest of the service.
     *
     * The occurrence is *not* settled: only a count settles it. A refusal is
     * counted instead, so a device wedged at the boundary cannot generate an
     * unbounded stream of attempt rows.
     */
    private suspend fun fail(reason: EvidenceRefusal, partition: CachePartition): EvidencePhase {
        phase = EvidencePhase.Refused(reason)

        store.current(partition, clock())?.let { attempt ->
            mutex.withLock {
                policies[attempt.occurrenceId] =
                    (policies[attempt.occurrenceId] ?: AttemptPolicy()).recordingRefusal(
                        clock(),
                        attempt.queued?.accuracyMeters ?: lastAccuracyMeters,
                        lastConfigVersion,
                    )
                // Bounded: a handful of services, never a growing history.
                while (policies.size > 8) policies.remove(policies.keys.first())
            }
        }

        store.close(partition)

        // A loss of authority is not just this event failing — the device has
        // no business watching at all any more.
        if (reason.requiresTeardown) {
            reconciler.teardown()
            settings = settings.copy(enabled = false)
        }
        return phase
    }
}
