package io.faithform.faithful.attendance

import java.security.MessageDigest
import kotlin.math.min
import kotlin.math.pow
import kotlin.random.Random

/**
 * What a geofence transition can become.
 *
 * **The operating system's callback is evidence, not attendance.** A device
 * crossing a circle drawn round a building is a reason to *ask* the server
 * whether that counts; it is never the answer. Nothing here marks anyone
 * present, and only [Counted] — which is produced solely from a server verdict
 * — reads as success.
 *
 * The case set is identical to `EvidencePhase` in `EvidenceMachine.swift`. The
 * platforms gather signals differently; what a signal *means* is the same, and
 * both produce the same canonical request.
 */
sealed interface EvidencePhase {
    data object Idle : EvidencePhase
    data class Entered(val regionId: String, val atEpochMillis: Long) : EvidencePhase

    /**
     * Re-checking authorization and configuration before anything is sent.
     * Always passed through after a transition, because the event may have
     * arrived against a configuration that has since expired or been revoked.
     */
    data class Reauthorizing(val regionId: String) : EvidencePhase

    data class AwaitingDwell(val occurrenceId: String, val sinceEpochMillis: Long) : EvidencePhase
    data class Confirming(val occurrenceId: String) : EvidencePhase
    data class Retrying(
        val occurrenceId: String?,
        val attempt: Int,
        val nextAttemptAtEpochMillis: Long,
    ) : EvidencePhase

    /** The server counted it, or had already counted it. The only success. */
    data class Counted(val occurrenceId: String, val alreadyCounted: Boolean) : EvidencePhase

    /** Terminal, and never retried: an answer, not an outage. */
    data class Refused(val reason: EvidenceRefusal) : EvidencePhase

    /** Left the region before dwell completed. Not a failure. */
    data object Abandoned : EvidencePhase

    /**
     * Backing off after refusals, until [untilEpochMillis].
     *
     * **Deliberately not [Refused].** This occurrence is still available; the
     * device is simply not going to submit again this instant. A meaningful
     * trigger — a verified exit, a materially better fix, a configuration
     * change — proceeds immediately regardless.
     */
    data class Holding(
        val occurrenceId: String,
        val untilEpochMillis: Long,
        val reason: HoldReason,
    ) : EvidencePhase

    // `Holding` is explicitly *not* terminal: the occurrence remains available
    // and the hold lifts on its own.
    val isTerminal: Boolean
        get() = this is Counted || this is Refused || this is Abandoned

    /** Deliberately narrow. Everything else is progress or an explanation. */
    val isSuccess: Boolean
        get() = this is Counted
}

/** Why an attempt will never succeed as-is. Every case fails closed. */
enum class EvidenceRefusal(val wire: String) {
    NotEnrolled("not_enrolled"),
    Blocked("blocked"),
    NoPeopleLink("no_people_link"),
    ConsentRequired("consent_required"),
    ConsentRevoked("consent_revoked"),
    WrongChurch("wrong_church"),
    NoOpenOccurrence("no_open_occurrence"),
    WindowClosed("window_closed"),
    InsufficientAccuracy("insufficient_accuracy"),
    OutsideRegion("outside_region"),
    GeofenceDisabled("geofence_disabled"),
    Cancelled("cancelled"),
    Expired("expired"),
    Unknown("unknown");

    /**
     * Whether losing this means the device should stop monitoring entirely, as
     * opposed to simply not counting this one event.
     */
    val requiresTeardown: Boolean
        get() = this in setOf(
            NotEnrolled, Blocked, NoPeopleLink,
            ConsentRequired, ConsentRevoked, GeofenceDisabled, WrongChurch,
        )

    companion object {
        fun fromServer(reason: String): EvidenceRefusal =
            entries.firstOrNull { it.wire == reason } ?: Unknown

        /**
         * Maps the reconciler's vocabulary onto this one.
         *
         * Two deliberately different sets: the reconciler reports why it cannot
         * *monitor*, this reports why an attempt cannot *count*. Most overlap,
         * but the device conditions have no server equivalent and passing them
         * through [fromServer] would silently produce [Unknown] — losing the
         * reason the UI needs to explain itself. The iOS implementation has the
         * identical mapping, and both were added after a test caught the loss.
         */
        fun fromReconcile(reason: String): EvidenceRefusal = when (reason) {
            "needs_full_accuracy" -> InsufficientAccuracy
            "needs_background_permission",
            "needs_foreground_permission",
            "location_unavailable",
            "play_services_unavailable",
            "configuration_unavailable" -> Cancelled
            "disabled" -> ConsentRequired
            else -> fromServer(reason)
        }
    }
}

/**
 * One position reading, reduced to what the server may receive.
 *
 * Deliberately not an Android `Location`: that carries speed, bearing,
 * altitude, provider name and extras this feature has no business handling, and
 * holding the framework type would let one of them reach a log by accident.
 */
data class LocationSample(
    val latitude: Double,
    val longitude: Double,
    val accuracyMeters: Float,
    val capturedAtEpochMillis: Long,
    /**
     * `Location.isFromMockProvider`. Reported to the server as **one signal
     * among several** and never as the sole decision rule — a rooted developer
     * phone is not automatically dishonest, and a determined spoof does not set
     * this flag at all. iOS has no equivalent and none is invented for it.
     */
    val isFromMockProvider: Boolean = false,
) {
    /** Android reports 0 accuracy when it has none. */
    val isUsable: Boolean
        get() = accuracyMeters > 0f &&
            accuracyMeters.isFinite() &&
            kotlin.math.abs(latitude) <= 90 &&
            kotlin.math.abs(longitude) <= 180
}

/**
 * The canonical request both platforms produce.
 *
 * Field-for-field identical to `AttendanceEvidence` in Swift, so the server
 * sees one shape and neither platform can drift into sending something the
 * other cannot.
 */
data class AttendanceEvidence(
    val occurrenceId: String,
    val phase: String,
    /** Sent on `detected`, making the server-side detection idempotent. */
    val attemptId: String? = null,
    /** Sent on `confirm`. The server re-checks every binding. */
    val detectionId: String? = null,
    val regionId: String? = null,
    val configVersion: Int? = null,
    val observedAtEpochMillis: Long,
    val accuracyMeters: Double?,
    val dwellSeconds: Int?,
    val latitude: Double?,
    val longitude: Double?,
    val mockLocationReported: Boolean?,
) {
    companion object {
        fun from(
            occurrenceId: String,
            phase: String,
            sample: LocationSample?,
            dwellSeconds: Int?,
            observedAtEpochMillis: Long,
            attemptId: String? = null,
            detectionId: String? = null,
            regionId: String? = null,
            configVersion: Int? = null,
        ): AttendanceEvidence {
            val usable = sample?.takeIf { it.isUsable }
            return AttendanceEvidence(
                occurrenceId = occurrenceId,
                phase = phase,
                attemptId = attemptId,
                detectionId = detectionId,
                regionId = regionId,
                configVersion = configVersion,
                observedAtEpochMillis = observedAtEpochMillis,
                accuracyMeters = usable?.accuracyMeters?.toDouble(),
                dwellSeconds = dwellSeconds,
                latitude = usable?.latitude,
                longitude = usable?.longitude,
                // Only reported when there is a reading to report it about.
                mockLocationReported = usable?.isFromMockProvider,
            )
        }
    }
}

/**
 * One logical check-in workflow.
 *
 * **Why this exists, and what it replaced.** The first version derived the
 * idempotency key from `(account, occurrence, phase)` alone. It was
 * deterministic and needed no storage, which looked like a virtue — and it was
 * wrong in a way that broke the feature for exactly the people most likely to
 * need it.
 *
 * `record_attendance` checks idempotency *before* validation and replays the
 * earlier result. So a first entry with a poor fix — indoors, cold GPS, a phone
 * still waking — is rejected `outside_region` and cached under that key. The
 * visitor walks inside, the fix sharpens, the system delivers another
 * transition, and the server replays the refusal. **Forever.** They could sit
 * through the whole service and never be counted, with nothing on the device or
 * the dashboard to explain it.
 *
 * A *logical attempt* is one workflow: opened when a genuinely new eligible
 * entry begins, carrying a random id, and **closed** on any terminal state. A
 * later entry opens a new one, gets a new key, and is validated fresh.
 *
 * Mirrors `LogicalAttempt` in Swift field for field.
 */
data class LogicalAttempt(
    /** 128 bits of randomness. Not derived from anything about the person. */
    val attemptId: String,
    val churchSlug: String,
    val occurrenceId: String,
    val openedAtEpochMillis: Long,
    /** Bounded by the same retention rule as the evidence it carries. */
    val expiresAtEpochMillis: Long,
    /** The one submission that could not be sent, if any. */
    val queued: QueuedSubmission? = null,
    /**
     * The earliest instant a `confirm` may succeed, **as the server said**.
     *
     * Persisted, not held in memory, because the wait spans exactly the window
     * where the process is most likely to be killed. Null until a `detected`
     * submission comes back `pending_confirmation`.
     */
    val confirmationNotBeforeEpochMillis: Long? = null,
    /**
     * The **server-issued** detection this attempt opened.
     *
     * Opaque, and the only thing that lets a confirmation be judged: the server
     * measures the dwell between its own `detected_at_server` and `now()`, so
     * nothing the device reports can shorten it.
     */
    val detectionId: String? = null,
) {
    fun isExpired(nowEpochMillis: Long): Boolean = nowEpochMillis >= expiresAtEpochMillis

    /**
     * Whether a confirmation may be attempted now.
     *
     * False before the server's instant, so the client never sends a `confirm`
     * that would predictably be refused for insufficient dwell — which would
     * burn a submission and teach the person nothing.
     */
    /**
     * Whether a confirmation is worth attempting now.
     *
     * **Scheduling only.** The server enforces the same deadline again from its
     * own clock, so this is the client deciding when to bother — not a decision
     * about whether the dwell elapsed. An OS dwell callback schedules an
     * opportunity; it does not prove server dwell elapsed.
     */
    fun mayConfirm(nowEpochMillis: Long): Boolean {
        val notBefore = confirmationNotBeforeEpochMillis ?: return false
        if (detectionId == null) return false
        return nowEpochMillis >= notBefore && !isExpired(nowEpochMillis)
    }

    /**
     * Whether this attempt covers the workflow now beginning.
     *
     * A different occurrence is a different service — the evening one after the
     * morning one — and must never inherit the morning's identity.
     */
    fun covers(churchSlug: String, occurrenceId: String, nowEpochMillis: Long): Boolean =
        this.churchSlug == churchSlug &&
            this.occurrenceId == occurrenceId &&
            !isExpired(nowEpochMillis)

    companion object {
        fun open(
            churchSlug: String,
            occurrenceId: String,
            nowEpochMillis: Long,
            lifetimeMillis: Long = PENDING_ATTEMPT_LIFETIME_MILLIS,
            randomId: () -> String = ::newAttemptId,
        ) = LogicalAttempt(
            attemptId = randomId(),
            churchSlug = churchSlug,
            occurrenceId = occurrenceId,
            openedAtEpochMillis = nowEpochMillis,
            expiresAtEpochMillis = nowEpochMillis + lifetimeMillis,
        )

        /**
         * 128 bits, hex, from a cryptographic source.
         *
         * **Not a tracking identifier.** Scoped to one occurrence, lives at
         * most as long as the retention policy allows, never sent anywhere
         * except folded into an idempotency key, and deleted when the attempt
         * closes. Nothing correlates two of them.
         */
        fun newAttemptId(): String {
            val bytes = ByteArray(16)
            java.security.SecureRandom().nextBytes(bytes)
            return bytes.joinToString("") { "%02x".format(it) }
        }
    }
}

/** A submission that could not be sent, held against its attempt. */
data class QueuedSubmission(
    /** `detected` or `confirm` — the contract's two distinct commands. */
    val kind: String,
    val observedAtEpochMillis: Long,
    val accuracyMeters: Double?,
    val dwellSeconds: Int?,
    val latitude: Double?,
    val longitude: Double?,
    val retries: Int = 0,
) {
    fun withRetry() = copy(retries = retries + 1)

    fun evidence(
        occurrenceId: String,
        attemptId: String? = null,
        detectionId: String? = null,
    ) = AttendanceEvidence(
        occurrenceId = occurrenceId,
        phase = kind,
        attemptId = attemptId,
        detectionId = detectionId,
        observedAtEpochMillis = observedAtEpochMillis,
        accuracyMeters = accuracyMeters,
        dwellSeconds = dwellSeconds,
        latitude = latitude,
        longitude = longitude,
        mockLocationReported = null,
    )

    companion object {
        fun from(evidence: AttendanceEvidence, retries: Int = 0) = QueuedSubmission(
            kind = evidence.phase,
            observedAtEpochMillis = evidence.observedAtEpochMillis,
            accuracyMeters = evidence.accuracyMeters,
            dwellSeconds = evidence.dwellSeconds,
            latitude = evidence.latitude,
            longitude = evidence.longitude,
            retries = retries,
        )
    }
}

/**
 * Idempotency keys, derived from a logical attempt.
 *
 * ```
 * gf-sha256("faithful.geofence.v2|account|church|occurrence|attemptId|kind")[0:40]
 * ```
 *
 * **Each input earns its place:**
 *
 * - `account` — the server scopes attempts by `(occurrence, source, key)`,
 *   which does not include the account. Two people sharing a device must not
 *   collide.
 * - `church` — a defensive tenant boundary.
 * - `occurrence` — two services on one day are two answers.
 * - **`attemptId`** — the fix. One *workflow*, not one occurrence.
 * - `kind` — `detected` and `confirm` are two genuinely independent server
 *   commands, not internal state: the contract defines both and the server
 *   answers each on its own.
 *
 * Byte-for-byte the same construction as `IdempotencyKey.swift`, so the same
 * person on two devices produces the same key for the same intent. The `v2`
 * prefix means a client mid-upgrade cannot collide with an old-scheme key.
 */
object IdempotencyKey {
    fun geofence(
        accountId: String,
        churchSlug: String,
        occurrenceId: String,
        attemptId: String,
        kind: String,
    ): String {
        val material = listOf(
            "faithful.geofence.v2", accountId, churchSlug, occurrenceId, attemptId, kind,
        ).joinToString("|")
        return "gf-" + sha256Hex(material).take(40)
    }

    private fun sha256Hex(value: String): String =
        MessageDigest.getInstance("SHA-256")
            .digest(value.toByteArray(Charsets.UTF_8))
            .joinToString("") { "%02x".format(it) }
}

/** How long an unsent attempt is worth keeping. */
const val PENDING_ATTEMPT_LIFETIME_MILLIS = 2L * 60 * 60 * 1000

/**
 * Bounded exponential backoff with jitter.
 *
 * Jitter matters more than usual: a whole congregation's phones cross the same
 * boundary within a couple of minutes, and undithered backoff would make them
 * retry in lockstep.
 *
 * Applied **only** to transport and 5xx failures. An authorization or
 * validation refusal is an answer and is never retried.
 */
object RetryPolicy {
    const val MAX_ATTEMPTS = 5

    fun delayMillis(attempt: Int, jitter: () -> Double = { Random.nextDouble() }): Long {
        val base = min(2.0.pow(maxOf(0, attempt)) * 2.0, 120.0)
        // Full jitter with a floor, so a tight loop is impossible.
        return ((base / 2 + (base / 2) * jitter()) * 1000).toLong()
    }

    fun shouldRetry(attempt: Int, isTransient: Boolean): Boolean =
        isTransient && attempt < MAX_ATTEMPTS
}
