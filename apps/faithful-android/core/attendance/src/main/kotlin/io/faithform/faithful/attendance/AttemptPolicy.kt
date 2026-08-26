package io.faithform.faithful.attendance

import kotlin.math.pow

/**
 * Why a new logical attempt may begin.
 *
 * A geofence transition on its own is **not** a reason. The system re-delivers,
 * a phone at a boundary oscillates, and a stale transition can arrive minutes
 * late; treating each as a fresh workflow is how a device ends up submitting
 * the same doomed evidence over and over.
 */
sealed interface AttemptTrigger {
    data object FirstEntry : AttemptTrigger

    /** A verified exit followed by a re-entry — genuinely new information. */
    data object ExitThenReentry : AttemptTrigger

    /**
     * This fix is materially better than the one that was refused. A cold GPS
     * sharpening as someone walks inside is exactly the case that a hard cap
     * used to lock out.
     */
    data class ImprovedAccuracy(val previousMeters: Double, val currentMeters: Double) :
        AttemptTrigger

    /** The cooldown elapsed. A weak signal, but a real one. */
    data object CooldownElapsed : AttemptTrigger

    /** A policy edit, a moved campus, a restored consent. */
    data object ConfigurationChanged : AttemptTrigger
}

sealed interface AttemptDecision {
    data class Proceed(val trigger: AttemptTrigger) : AttemptDecision

    /**
     * Not yet. **Never permanent** — there is no case here meaning "this
     * occurrence is finished for you" other than an actual count.
     */
    data class WaitUntil(val nextEligibleAtEpochMillis: Long, val reason: HoldReason) :
        AttemptDecision

    data object AlreadySettled : AttemptDecision
}

enum class HoldReason {
    /** Backing off after a refusal. Exponential, capped at [AttemptPolicy.MAX_COOLDOWN_MILLIS]. */
    Cooldown,

    /** The token bucket is empty. At most one refill interval away. */
    Throttled,

    /** Nothing has changed since the last refusal, and the cooldown is running. */
    NoNewSignal,
}

/**
 * The anti-flapping state for one occurrence.
 *
 * **This replaces a hard cap of five refused attempts, which was the original
 * bug wearing a larger number.** Five poor readings on arrival — indoors, phone
 * cold, walking past a wall — would permanently prevent that person being
 * counted at that service, which is precisely what the logical attempt was
 * introduced to remove.
 *
 * Mirrors `AttemptPolicy.swift` constant for constant, so a person with an
 * iPhone and a person with a Pixel back off identically.
 */
data class AttemptPolicy(
    val refusals: Int = 0,
    /** Tokens remaining, and when that figure was accurate. */
    val tokens: Double = BUCKET_CAPACITY,
    val tokensAtEpochMillis: Long? = null,
    val lastRefusalAtEpochMillis: Long? = null,
    val lastAccuracyMeters: Double? = null,
    val lastConfigVersion: Int? = null,
    val sawExit: Boolean = false,
    val settled: Boolean = false,
) {
    /** Doubling, from 30 s, capped at 10 minutes — well below a service. */
    val cooldownMillis: Long
        get() = if (refusals <= 0) {
            0
        } else {
            minOf(BASE_COOLDOWN_MILLIS * 2.0.pow(refusals - 1).toLong(), MAX_COOLDOWN_MILLIS)
        }

    fun nextEligibleAt(nowEpochMillis: Long): Long =
        lastRefusalAtEpochMillis?.plus(cooldownMillis) ?: nowEpochMillis

    /** Tokens available at [nowEpochMillis], refilled continuously. */
    fun availableTokens(nowEpochMillis: Long): Double {
        val since = tokensAtEpochMillis ?: return BUCKET_CAPACITY
        val elapsed = maxOf(0L, nowEpochMillis - since)
        return minOf(BUCKET_CAPACITY, tokens + elapsed.toDouble() / TOKEN_REFILL_INTERVAL_MILLIS)
    }

    /**
     * When the next whole token arrives.
     *
     * **Never more than one refill interval away**, which is what makes the
     * throttle a delay rather than a lockout.
     */
    fun nextTokenAt(nowEpochMillis: Long): Long {
        val available = availableTokens(nowEpochMillis)
        if (available >= 1.0) return nowEpochMillis
        return nowEpochMillis + ((1.0 - available) * TOKEN_REFILL_INTERVAL_MILLIS).toLong()
    }

    /** Whether this reading is materially better than the one that was refused. */
    fun isImproved(accuracyMeters: Double?): Boolean {
        val current = accuracyMeters?.takeIf { it > 0 } ?: return false
        val previous = lastAccuracyMeters?.takeIf { it > 0 }
            // No previous reading: a first usable fix after an unusable one is
            // an improvement.
            ?: return true
        return current * MATERIAL_ACCURACY_RATIO <= previous ||
            previous - current >= MATERIAL_ACCURACY_DELTA
    }

    fun decide(
        nowEpochMillis: Long,
        accuracyMeters: Double?,
        configVersion: Int?,
    ): AttemptDecision {
        if (settled) return AttemptDecision.AlreadySettled
        if (refusals == 0) return AttemptDecision.Proceed(AttemptTrigger.FirstEntry)

        // Meaningful signals bypass the cooldown entirely. Making someone with a
        // now-excellent fix wait out a backoff earned by a bad one would be the
        // lockout in slower motion.
        if (sawExit) return AttemptDecision.Proceed(AttemptTrigger.ExitThenReentry)

        if (configVersion != null && lastConfigVersion != null && configVersion != lastConfigVersion) {
            return AttemptDecision.Proceed(AttemptTrigger.ConfigurationChanged)
        }

        if (isImproved(accuracyMeters)) {
            return AttemptDecision.Proceed(
                AttemptTrigger.ImprovedAccuracy(
                    previousMeters = lastAccuracyMeters ?: Double.POSITIVE_INFINITY,
                    currentMeters = accuracyMeters ?: Double.POSITIVE_INFINITY,
                ),
            )
        }

        // The bucket protects the battery and the API. It refills continuously,
        // so an empty one is at most `TOKEN_REFILL_INTERVAL_MILLIS` from a
        // token — never a window that has to slide past.
        if (availableTokens(nowEpochMillis) < 1.0) {
            return AttemptDecision.WaitUntil(nextTokenAt(nowEpochMillis), HoldReason.Throttled)
        }

        val eligible = nextEligibleAt(nowEpochMillis)
        if (nowEpochMillis < eligible) {
            return AttemptDecision.WaitUntil(eligible, HoldReason.Cooldown)
        }

        return AttemptDecision.Proceed(AttemptTrigger.CooldownElapsed)
    }

    /**
     * Spends a token. Refills first, so the figure recorded is accurate at
     * [nowEpochMillis] rather than at whenever it was last touched.
     */
    fun recordingSubmission(nowEpochMillis: Long) = copy(
        tokens = maxOf(0.0, availableTokens(nowEpochMillis) - 1.0),
        tokensAtEpochMillis = nowEpochMillis,
        sawExit = false,
    )

    fun recordingRefusal(
        nowEpochMillis: Long,
        accuracyMeters: Double?,
        configVersion: Int?,
    ) = copy(
        refusals = refusals + 1,
        lastRefusalAtEpochMillis = nowEpochMillis,
        lastAccuracyMeters = accuracyMeters?.takeIf { it > 0 } ?: lastAccuracyMeters,
        lastConfigVersion = configVersion ?: lastConfigVersion,
        sawExit = false,
    )

    /** A verified exit. The next entry is genuinely new. */
    fun recordingExit() = copy(sawExit = true)

    /** Counted. The only state that ends an occurrence. */
    fun settling() = copy(settled = true)

    companion object {
        /**
         * A **continuously refilling token bucket**, not a windowed budget.
         *
         * A previous version allowed 12 submissions per rolling hour. That was
         * a lockout in disguise: spend them in the first two minutes and the
         * next one is up to an hour away — longer than the service the person
         * is sitting in. A bucket's worst case is the time for **one** token.
         */
        const val BUCKET_CAPACITY = 12.0

        /**
         * One token a minute. Geofence responsiveness is around two minutes, so
         * this is comfortably above the rate real events arrive at, and it makes
         * the empty-bucket wait exactly one minute.
         */
        const val TOKEN_REFILL_INTERVAL_MILLIS = 60L * 1000

        const val BASE_COOLDOWN_MILLIS = 30L * 1000
        const val MAX_COOLDOWN_MILLIS = 10L * 60 * 1000

        /**
         * **The explicit bound on any local hold.**
         *
         * Whatever combination of cooldown and throttle applies, the device is
         * eligible again within this. Ten minutes is the cooldown ceiling; the
         * bucket's worst case is one minute, so the cooldown is always the
         * binding constraint and this is the honest maximum.
         */
        const val MAX_LOCAL_HOLD_MILLIS = MAX_COOLDOWN_MILLIS

        /**
         * A fix that went from ±120 m to ±15 m is a different observation, not a
         * repeat of the same one.
         */
        const val MATERIAL_ACCURACY_RATIO = 2.0
        const val MATERIAL_ACCURACY_DELTA = 25.0
    }
}
