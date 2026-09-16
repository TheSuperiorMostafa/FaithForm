package io.faithform.app.attendance

import io.faithform.app.storage.CachePartition
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
     *
     * [regionId] is the campus the phone reported, so a church with several
     * campuses resolves the service at *that* campus. It carries no position,
     * and this is called before any location reading is taken: outside a
     * check-in window the answer is null, and nothing about where the phone is
     * ever leaves it.
     *
     * @throws TerminalAttendanceFailure when this account may not attend here
     *   at all — no relationship, blocked, left, or an inactive account.
     */
    suspend fun eligibleOccurrenceId(churchSlug: String, regionId: String? = null): String?

    suspend fun submit(evidence: AttendanceEvidence, idempotencyKey: String): AttendanceOutcome

    /**
     * Whether this account is already counted at an occurrence, or null when
     * that could not be found out.
     *
     * Asked only after a `confirm` is refused. The server redeems a detection
     * *before* its idempotency replay, so a confirmation whose response was
     * lost is refused `detection_already_used` on retry even though it
     * counted. Reading the status back is what stops that person being told
     * they were not checked in. Mirrors `isCounted(occurrenceId:)` on iPhone.
     */
    suspend fun isCounted(occurrenceId: String): Boolean? = null
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

    /**
     * Closes every attempt in every partition.
     *
     * Turning the feature off and signing out must not leave another church's
     * or another authorization version's coordinates behind.
     */
    suspend fun closeAll() {}
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
    /** The church the person has selected. First among [churchSlugs]. */
    val churchSlug: String? = null,
    /**
     * Every church this person may be checked in at, in priority order.
     *
     * Consent is the account's, not a church's, so someone who belongs to two
     * churches is watched for at both — within the platform's region limit,
     * with the selected church first. Defaults to the one church.
     */
    val churchSlugs: List<String> = listOfNotNull(churchSlug),
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
        val previous = this.partition
        if (previous == null ||
            previous.copy(churchSlug = null).storageKey != partition.copy(churchSlug = null).storageKey ||
            this.accountId != accountId
        ) {
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
            churchSlugs = settings.churchSlugs,
            enabled = settings.enabled && settings.serverConsent == "granted",
        )
    }

    /** Turns the feature on and registers whatever the server authorizes. */
    suspend fun enable(settings: AutomaticAttendanceSettings): ReconcileOutcome {
        this.settings = settings
        val currentPartition = partition ?: return ReconcileOutcome.Idle
        reconciler.bind(
            partition = currentPartition,
            churchSlugs = settings.churchSlugs,
            enabled = settings.enabled && settings.serverConsent == "granted",
        )
        return reconciler.reconcile(ReconcileTrigger.OptIn)
    }

    /** The single funnel every lifecycle trigger goes through. */
    suspend fun reconcile(trigger: ReconcileTrigger): ReconcileOutcome =
        reconciler.reconcile(trigger)

    /**
     * Occurrences this device already knows were counted.
     *
     * Persisted by the app between processes. A geofence wake is usually a
     * fresh process, and without this every re-registration while sitting in
     * church would cost another round trip for an answer already given.
     */
    suspend fun settledOccurrenceIds(): List<String> = mutex.withLock { settledOccurrences.toList() }

    /** Restores [settledOccurrenceIds] from a previous process. Bounded like the live set. */
    suspend fun restoreSettled(occurrenceIds: Collection<String>) {
        for (id in occurrenceIds) markSettled(id)
    }

    /** The partition an attempt at [churchSlug] lives in. */
    private fun partitionFor(base: CachePartition, churchSlug: String): CachePartition =
        base.copy(churchSlug = churchSlug)

    /** Every church whose attempts this coordinator is responsible for. */
    private fun attemptChurches(base: CachePartition): List<String> =
        (settings.churchSlugs + listOfNotNull(settings.churchSlug, base.churchSlug)).distinct()

    /**
     * The open attempt at any bound church, with the partition it lives in.
     *
     * One at a time is the normal case: a person is in one building.
     */
    suspend fun openAttempt(): Pair<LogicalAttempt, CachePartition>? {
        val base = partition ?: return null
        for (church in attemptChurches(base)) {
            val attemptPartition = partitionFor(base, church)
            store.current(attemptPartition, clock())?.let { return it to attemptPartition }
        }
        return null
    }

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
        partition?.let { base ->
            store.close(base)
            for (church in attemptChurches(base)) store.close(partitionFor(base, church))
        }
        settings = settings.copy(enabled = false)
    }

    /**
     * A geofence transition, from the system.
     *
     * The entry point for everything: a foreground callback, a background
     * broadcast, and a process relaunch after being killed all arrive here.
     */
    suspend fun handleRegionEntered(regionId: String): EvidencePhase {
        val basePartition = partition
        val currentAccount = accountId
        if (!settings.enabled || basePartition == null || currentAccount == null) {
            phase = EvidencePhase.Refused(EvidenceRefusal.ConsentRequired)
            return phase
        }

        // A transition carries a region id and nothing else. Which church it
        // belongs to comes from what was registered, never from the event.
        val churchSlug = reconciler.churchFor(regionId)
            ?: settings.churchSlug
            ?: basePartition.churchSlug
        if (churchSlug == null || churchSlug !in attemptChurches(basePartition)) {
            // A region for a church this person is no longer bound to. The next
            // reconciliation removes it; nothing is sent on its behalf.
            phase = EvidencePhase.Refused(EvidenceRefusal.WrongChurch)
            return phase
        }
        val currentPartition = partitionFor(basePartition, churchSlug)

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
            val outcome = reconciler.reconcile(ReconcileTrigger.RegionEvent, focusChurch = churchSlug)
            outcome.refusalFor(churchSlug)?.let {
                if (it == "configuration_unavailable") {
                    // Offline is not a refusal. Nothing was opened, so the
                    // caller retries the whole arrival when the network returns.
                    phase = EvidencePhase.Retrying(null, 1, clock() + RetryPolicy.delayMillis(1))
                    return phase
                }
                return fail(EvidenceRefusal.fromReconcile(it), currentPartition)
            }
            lastConfigVersion = reconciler.configuration(churchSlug)?.configVersion ?: lastConfigVersion

            val reportedRegion = regionId.takeIf { it.startsWith(REGION_ID_PREFIX) }
            val occurrenceId = try {
                submitter.eligibleOccurrenceId(churchSlug, reportedRegion)
            } catch (failure: TerminalAttendanceFailure) {
                // Not a network problem: this account may not attend here.
                return fail(failure.refusal, currentPartition)
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
                    churchSlug = churchSlug,
                    occurrenceId = occurrenceId,
                    nowEpochMillis = clock(),
                    randomId = newAttemptId,
                    regionId = reportedRegion,
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

    /**
     * Leaving before the check-in completes abandons the intent.
     *
     * **Read from the stored attempt, not only from memory.** An exit usually
     * arrives in a process started just for it, where the phase is `Idle`; an
     * attempt waiting on a confirmation must still be closed, or someone who
     * walked out would be asked whether they are at church from their car. An
     * attempt holding a queued submission is left alone: that evidence was
     * gathered after the dwell, while the person was there, and only the
     * network kept it from being sent.
     */
    suspend fun handleRegionExited(regionId: String) {
        // A verified exit is the strongest "something changed" signal there is:
        // the person actually left. Recorded for every occurrence being held,
        // so the next entry proceeds regardless of any cooldown.
        mutex.withLock {
            for (key in policies.keys.toList()) {
                policies[key] = policies[key]!!.recordingExit()
            }
        }

        val base = partition ?: return
        val churchSlug = reconciler.churchFor(regionId) ?: settings.churchSlug ?: base.churchSlug
        val churches = churchSlug?.let { listOf(it) } ?: attemptChurches(base)

        var closed = false
        for (church in churches) {
            val attemptPartition = partitionFor(base, church)
            val attempt = store.current(attemptPartition, clock()) ?: continue
            if (attempt.queued == null) {
                store.close(attemptPartition)
                closed = true
            }
        }

        when (phase) {
            is EvidencePhase.Entered,
            is EvidencePhase.Reauthorizing,
            is EvidencePhase.AwaitingDwell,
            -> phase = EvidencePhase.Abandoned
            else -> if (closed) phase = EvidencePhase.Abandoned
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
            // Which campus woke the phone, and against which configuration.
            // The server records both on the detection and re-checks them if
            // a confirmation names them; neither decides anything on its own.
            regionId = attempt.regionId,
            configVersion = lastConfigVersion,
        )

        var awaiting = occurrenceId
        when (val result = send(detected, attempt, accountId, partition)) {
            is SendOutcome.Refusal -> return fail(result.reason, partition)
            SendOutcome.Transient -> return phase
            is SendOutcome.Answer -> {
                when (result.value.outcome) {
                    "counted", "already_counted" -> return succeed(
                        result.value.occurrenceId ?: occurrenceId,
                        result.value.outcome == "already_counted",
                        partition,
                        also = occurrenceId,
                    )
                    "pending_confirmation" -> {
                        // The occurrence the *server* resolved. At a church
                        // with several campuses it can differ from the one
                        // asked about, and the confirmation must name it.
                        awaiting = result.value.occurrenceId ?: occurrenceId
                        // **Persist when the server said we may come back.**
                        // Stored rather than held in memory because this wait
                        // spans exactly the window where the process is most
                        // likely to be killed.
                        store.update(
                            attempt.copy(
                                occurrenceId = awaiting,
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
        phase = EvidencePhase.AwaitingDwell(awaiting, clock())
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
        partition ?: return phase
        accountId ?: return phase

        val (attempt, _) = openAttempt() ?: return phase
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
        val base = partition ?: return phase
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
        var attempt: LogicalAttempt? = null
        var currentPartition = base
        for (church in attemptChurches(base)) {
            val candidate = partitionFor(base, church)
            val stored = store.current(candidate, clock()) ?: continue
            if (stored.occurrenceId == occurrenceId) {
                attempt = stored
                currentPartition = candidate
                break
            }
        }
        if (attempt == null) {
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
            // The same campus the detection named; the server re-checks it.
            regionId = attempt.regionId,
        )

        return when (val result = send(confirm, attempt, currentAccount, currentPartition)) {
            is SendOutcome.Refusal -> {
                // A refused confirmation may be one that already counted and
                // lost its response. Ask before saying it did not work.
                if (result.reason == EvidenceRefusal.Unknown &&
                    runCatching { submitter.isCounted(occurrenceId) }.getOrNull() == true
                ) {
                    succeed(occurrenceId, alreadyCounted = true, partition = currentPartition)
                } else {
                    fail(result.reason, currentPartition)
                }
            }
            SendOutcome.Transient -> phase
            is SendOutcome.Answer -> {
                when (result.value.outcome) {
                    "counted", "already_counted" ->
                        return succeed(
                            result.value.occurrenceId ?: occurrenceId,
                            result.value.outcome == "already_counted",
                            currentPartition,
                            also = occurrenceId,
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
            // Queued against the attempt, so the retry reuses this key. The
            // retry count survives, so a network that never returns ends in
            // an honest expiry rather than an unbounded loop.
            store.update(
                attempt.copy(
                    queued = QueuedSubmission.from(evidence, retries = attempt.queued?.retries ?: 0),
                ),
                partition,
            )
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
        partition ?: return phase
        val currentAccount = accountId ?: return phase
        if (!settings.enabled) return phase

        val open = openAttempt()
        val attempt = open?.first
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

        val currentPartition = open.second
        val queued = attempt.queued ?: return phase

        if (!RetryPolicy.shouldRetry(queued.retries, isTransient = true)) {
            store.close(currentPartition)
            phase = EvidencePhase.Refused(EvidenceRefusal.Expired)
            return phase
        }

        val retried = attempt.copy(queued = queued.withRetry())
        store.update(retried, currentPartition)

        val evidence = queued.evidence(
            attempt.occurrenceId,
            attemptId = attempt.attemptId,
            detectionId = attempt.detectionId,
            regionId = attempt.regionId,
        )

        when (val result = send(evidence, retried, currentAccount, currentPartition)) {
            is SendOutcome.Answer -> {
                when (result.value.outcome) {
                    "counted", "already_counted" -> return succeed(
                        result.value.occurrenceId ?: attempt.occurrenceId,
                        result.value.outcome == "already_counted",
                        currentPartition,
                        also = attempt.occurrenceId,
                    )
                    "pending_confirmation" -> {
                        // A `detected` that waited for a network is answered
                        // exactly as it would have been at once: the server's
                        // instant and its detection are kept, and the queued
                        // submission is done. Dropping them here left the
                        // attempt unconfirmable and resent the same evidence.
                        val awaiting = result.value.occurrenceId ?: attempt.occurrenceId
                        store.update(
                            retried.copy(
                                queued = null,
                                occurrenceId = awaiting,
                                confirmationNotBeforeEpochMillis =
                                    result.value.confirmationNotBeforeEpochMillis
                                        ?: retried.confirmationNotBeforeEpochMillis
                                        ?: (clock() + FALLBACK_DWELL_MILLIS),
                                detectionId = result.value.detectionId ?: retried.detectionId,
                            ),
                            currentPartition,
                        )
                        phase = EvidencePhase.AwaitingDwell(awaiting, clock())
                        return phase
                    }
                    else -> return fail(EvidenceRefusal.Unknown, currentPartition)
                }
            }
            is SendOutcome.Refusal -> {
                // The retried confirmation is the one most likely to have
                // counted already: its first response is what was lost.
                if (queued.kind == "confirm" && result.reason == EvidenceRefusal.Unknown &&
                    runCatching { submitter.isCounted(attempt.occurrenceId) }.getOrNull() == true
                ) {
                    return succeed(attempt.occurrenceId, alreadyCounted = true, partition = currentPartition)
                }
                return fail(result.reason, currentPartition)
            }
            SendOutcome.Transient -> Unit
        }
        return phase
    }

    /** A server verdict of counted. Closes the attempt and settles the occurrence. */
    private suspend fun succeed(
        occurrenceId: String,
        alreadyCounted: Boolean,
        partition: CachePartition,
        /** The occurrence that was asked about, when the server counted another. */
        also: String? = null,
    ): EvidencePhase {
        phase = EvidencePhase.Counted(occurrenceId, alreadyCounted)
        for (id in listOfNotNull(also, occurrenceId).distinct()) {
            markSettled(id)
            mutex.withLock {
                policies[id] = (policies[id] ?: AttemptPolicy()).settling()
            }
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
        // no business watching at all any more. Consent is the account's, so
        // losing it stops everything; a refusal from one church, when others
        // are still bound, only stops that church, and the reconciliation that
        // produced it has already removed that church's regions.
        if (reason.requiresTeardown &&
            (reason in ACCOUNT_WIDE_REFUSALS || settings.churchSlugs.size <= 1)
        ) {
            reconciler.teardown()
            settings = settings.copy(enabled = false)
        }
        return phase
    }

    companion object {
        /** Every FaithForm region id starts with this; anything else is not ours to report. */
        const val REGION_ID_PREFIX = "faithform.campus."

        /** Refusals about the account rather than about one church. */
        val ACCOUNT_WIDE_REFUSALS = setOf(
            EvidenceRefusal.ConsentRequired,
            EvidenceRefusal.ConsentRevoked,
        )
    }
}
