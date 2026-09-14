package io.faithform.app.attendance

import android.content.SharedPreferences
import io.faithform.app.contract.AttendanceConsentRequest
import io.faithform.app.contract.AttendanceConsentResult
import io.faithform.app.contract.AttendanceResult
import io.faithform.app.contract.EligibleOccurrence
import io.faithform.app.contract.GeofenceConfigResponse
import io.faithform.app.contract.MobileErrorCode
import io.faithform.app.network.ApiClient
import io.faithform.app.network.ApiException
import io.faithform.app.network.FaithFormJson
import io.faithform.app.network.MobileSuccess
import io.faithform.app.storage.CachePartition
import java.net.URLEncoder
import java.time.Instant
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

/**
 * The automatic-attendance routes, and nothing else.
 *
 * Each class translates between the pure model in `:core:attendance` and
 * `/api/mobile/v1/attendance/…`. None of them decides whether anyone attended:
 * the server resolves the occurrence from its own clock, bands the position
 * against the campus it holds, measures the dwell between its own timestamps,
 * and says `counted` or does not.
 */

/**
 * Submits geofence evidence.
 *
 * Deliberately a separate file from `ApiCheckInSubmitter`: the QR path has no
 * field that could carry a position, and the privacy sweep holds it to that.
 * This one exists to carry exactly one position — the fix taken when the
 * person had stayed — and its body is written out field by field below.
 */
class ApiAttendanceSubmitter(
    private val api: ApiClient,
    private val json: Json = Json { encodeDefaults = false; explicitNulls = false },
) : AttendanceSubmitter {

    override suspend fun eligibleOccurrenceId(churchSlug: String, regionId: String?): String? {
        val result = call {
            api.send(
                path = "api/mobile/v1/attendance/${encode(churchSlug)}/occurrence",
                serializer = MobileSuccess.serializer(OccurrenceReply.serializer()),
                // The campus the phone reported, so a church with several
                // campuses answers for this one. No position is sent here.
                query = regionId?.let { mapOf("regionId" to it) } ?: emptyMap(),
            )
        }
        return result.value?.occurrence?.occurrenceId
    }

    override suspend fun submit(evidence: AttendanceEvidence, idempotencyKey: String): AttendanceOutcome {
        val body = json.encodeToString(GeofenceAttemptBody.serializer(), GeofenceAttemptBody.from(evidence))
        val result = call {
            api.send(
                path = "api/mobile/v1/attendance/attempt",
                serializer = MobileSuccess.serializer(AttendanceResult.serializer()),
                method = "POST",
                body = body,
                idempotencyKey = idempotencyKey,
            )
        }
        // A 200 with no body is not a verdict. Retried, never counted.
        val value = result.value ?: throw TransientAttendanceFailure("empty response")
        return AttendanceOutcome(
            // `wire`: an outcome this build does not know arrives as `unknown`,
            // which the coordinator treats as a refusal — never as a count.
            outcome = value.outcome.wire,
            message = value.message,
            occurrenceId = value.occurrenceId,
            confirmationNotBeforeEpochMillis = value.confirmationNotBefore?.let(::epochMillis),
            detectionId = value.detectionId,
        )
    }

    @Serializable
    private data class OccurrenceReply(val occurrence: EligibleOccurrence? = null)
}

/**
 * The request body for a geofence attempt.
 *
 * Written by hand, like the scan body, so what leaves the phone is exactly
 * this list: the occurrence the server named, the phase, when it was observed,
 * one fix with its accuracy, the attempt or detection it belongs to, and the
 * campus and configuration version. No device identifier, no speed, no
 * altitude, no history.
 */
@Serializable
internal data class GeofenceAttemptBody(
    // No default: the encoder omits a property equal to its default, and the
    // server requires `source`.
    val source: String,
    val occurrenceId: String,
    val phase: String,
    val observedAt: String,
    val accuracyMeters: Double? = null,
    val dwellSeconds: Int? = null,
    val latitude: Double? = null,
    val longitude: Double? = null,
    val mockLocationReported: Boolean? = null,
    val attemptId: String? = null,
    val detectionId: String? = null,
    val regionId: String? = null,
    val configVersion: Int? = null,
) {
    companion object {
        fun from(evidence: AttendanceEvidence) = GeofenceAttemptBody(
            source = "geofence",
            occurrenceId = evidence.occurrenceId,
            phase = evidence.phase,
            observedAt = Instant.ofEpochMilli(evidence.observedAtEpochMillis).toString(),
            accuracyMeters = evidence.accuracyMeters,
            dwellSeconds = evidence.dwellSeconds,
            latitude = evidence.latitude,
            longitude = evidence.longitude,
            mockLocationReported = evidence.mockLocationReported,
            attemptId = evidence.attemptId,
            detectionId = evidence.detectionId,
            regionId = evidence.regionId,
            configVersion = evidence.configVersion,
        )
    }
}

/** Grants or withdraws the account's consent. */
class ApiAttendanceConsentClient(
    private val api: ApiClient,
    private val json: Json = Json { encodeDefaults = true },
) : AttendanceConsentClient {

    override suspend fun record(granted: Boolean): ConsentRecorded {
        val body = json.encodeToString(
            AttendanceConsentRequest.serializer(),
            AttendanceConsentRequest(autoAttendanceConsent = if (granted) "granted" else "revoked"),
        )
        val result = call {
            api.send(
                path = "api/mobile/v1/attendance/consent",
                serializer = MobileSuccess.serializer(AttendanceConsentResult.serializer()),
                method = "POST",
                body = body,
            )
        }
        val value = result.value ?: throw TransientAttendanceFailure("empty response")
        return ConsentRecorded(value.autoAttendanceConsent, value.authorizationVersion)
    }
}

/**
 * The geofence configuration, revalidated with its ETag and kept encrypted.
 *
 * **Never returns an expired configuration.** A cached one is used only while
 * its `expiresAt` — the server's own, deterministic expiry — is in the future;
 * after that it is revalidated, and the server guarantees a 304 is never
 * served for an expired copy.
 *
 * A refusal is cached too, briefly, so a person who follows ten churches and
 * is linked at one does not cost ten requests on every foreground.
 */
class ApiGeofenceConfigurationSource(
    private val api: ApiClient,
    private val prefs: SharedPreferences,
) : ConfigurationSource {

    private val mutex = Mutex()

    override suspend fun currentConfiguration(
        churchSlug: String,
        partition: CachePartition,
        nowEpochMillis: Long,
        forceRefresh: Boolean,
    ): GeofenceConfigurationState = mutex.withLock {
        val key = PREFIX + partition.storageKey
        val cached = read(key)

        if (!forceRefresh && cached != null && cached.isFresh(nowEpochMillis)) {
            return@withLock cached.state()
        }

        val result = try {
            api.send(
                path = "api/mobile/v1/attendance/${encode(churchSlug)}/geofence-config",
                serializer = MobileSuccess.serializer(GeofenceConfigResponse.serializer()),
                // Safe even for an expired copy: the validator covers the
                // expiry, so the server cannot answer 304 to one.
                ifNoneMatch = cached?.etag,
            )
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (error: ApiException) {
            if (error.code == MobileErrorCode.NOT_FOUND || error.code == MobileErrorCode.FORBIDDEN) {
                return@withLock GeofenceConfigurationState.Refused("not_enrolled")
            }
            // Offline, or the server failed. An unexpired copy is still the
            // server's own answer; anything older is not authority.
            return@withLock cached?.takeIf { it.isFresh(nowEpochMillis) }?.state()
                ?: GeofenceConfigurationState.Unavailable
        } catch (_: Exception) {
            return@withLock cached?.takeIf { it.isFresh(nowEpochMillis) }?.state()
                ?: GeofenceConfigurationState.Unavailable
        }

        val response = if (result.notModified) {
            cached?.response ?: return@withLock GeofenceConfigurationState.Unavailable
        } else {
            result.value ?: return@withLock GeofenceConfigurationState.Unavailable
        }

        val entry = CachedConfiguration(response, result.etag ?: cached?.etag, nowEpochMillis)
        prefs.edit().putString(key, FaithFormJson.encodeToString(CachedConfiguration.serializer(), entry)).apply()
        entry.state()
    }

    /** Sign-out and turning the feature off leave no church's campuses behind. */
    fun clear() {
        val editor = prefs.edit()
        prefs.all.keys.filter { it.startsWith(PREFIX) }.forEach { editor.remove(it) }
        editor.apply()
    }

    private fun read(key: String): CachedConfiguration? =
        prefs.getString(key, null)?.let {
            runCatching { FaithFormJson.decodeFromString(CachedConfiguration.serializer(), it) }.getOrNull()
        }

    @Serializable
    internal data class CachedConfiguration(
        val response: GeofenceConfigResponse,
        val etag: String? = null,
        val fetchedAtEpochMillis: Long,
    ) {
        fun isFresh(now: Long): Boolean {
            val configuration = response.configuration
            return if (configuration != null) {
                val expires = GeofenceReconciler.parseInstant(configuration.expiresAt) ?: return false
                now < expires
            } else {
                now - fetchedAtEpochMillis < REFUSAL_LIFETIME_MILLIS
            }
        }

        fun state(): GeofenceConfigurationState {
            response.configuration?.let { return GeofenceConfigurationState.Available(it) }
            return GeofenceConfigurationState.Refused(response.refusalReason ?: "not_enrolled")
        }
    }

    companion object {
        const val PREFIX = "geofence_config|"

        /** How long a refusal is believed without asking again, unless something forces it. */
        const val REFUSAL_LIFETIME_MILLIS = 30L * 60 * 1000
    }
}

/**
 * Maps the network's failures onto the two the coordinator distinguishes.
 *
 * Retryable — offline, a 5xx, rate limited — is transient and queued under the
 * same key. A session that ended is terminal and stops monitoring: nothing can
 * be counted for nobody. Anything else the server refused is terminal for this
 * attempt only.
 */
private suspend fun <T> call(block: suspend () -> T): T = try {
    block()
} catch (cancelled: CancellationException) {
    throw cancelled
} catch (error: ApiException) {
    when {
        error.retryable || error.code == MobileErrorCode.RATE_LIMITED || error.code == MobileErrorCode.UNAVAILABLE ->
            throw TransientAttendanceFailure(error.code.wire)
        error.code == MobileErrorCode.UNAUTHENTICATED || error.code == MobileErrorCode.SESSION_EXPIRED ->
            throw TerminalAttendanceFailure(EvidenceRefusal.NotEnrolled)
        error.code == MobileErrorCode.BLOCKED -> throw TerminalAttendanceFailure(EvidenceRefusal.Blocked)
        // No relationship, blocked or left reads as `not_found`; an inactive
        // account as `account_inactive`. Neither will change on a retry.
        error.code == MobileErrorCode.NOT_FOUND || error.code == MobileErrorCode.FORBIDDEN ||
            error.code == MobileErrorCode.ACCOUNT_INACTIVE ->
            throw TerminalAttendanceFailure(EvidenceRefusal.NotEnrolled)
        else -> throw TerminalAttendanceFailure(EvidenceRefusal.Unknown)
    }
} catch (failure: TransientAttendanceFailure) {
    throw failure
} catch (failure: TerminalAttendanceFailure) {
    throw failure
} catch (_: Exception) {
    throw TransientAttendanceFailure("transport")
}

private fun encode(value: String): String = URLEncoder.encode(value, Charsets.UTF_8.name()).replace("+", "%20")

private fun epochMillis(iso: String): Long? = runCatching { Instant.parse(iso).toEpochMilli() }.getOrNull()
