package io.faithform.app.attendance

import io.faithform.app.contract.*
import io.faithform.app.network.ApiClient
import io.faithform.app.network.ApiException
import io.faithform.app.network.FaithFormJson
import io.faithform.app.network.MobileSuccess
import io.faithform.app.storage.CachePartition
import kotlinx.coroutines.CancellationException
import kotlinx.serialization.Serializable
import java.time.Instant

/** Every transition reauthorizes against the server; no cached response grants attendance. */
class ApiAutomaticAttendance(private val api: ApiClient) : ConfigurationSource, AttendanceSubmitter {
    private var configVersion: Int? = null
    private var enteredRegion: String? = null

    override suspend fun currentConfiguration(churchSlug: String, partition: CachePartition, nowEpochMillis: Long, forceRefresh: Boolean): GeofenceConfigurationState {
        return try {
            val reply = api.send("api/mobile/v1/attendance/$churchSlug/geofence-config", MobileSuccess.serializer(GeofenceConfigResponse.serializer())).value
                ?: return GeofenceConfigurationState.Unavailable
            val config = reply.configuration
            if (config != null && Instant.parse(config.expiresAt).toEpochMilli() > nowEpochMillis) {
                configVersion = config.configVersion
                GeofenceConfigurationState.Available(config)
            } else if (reply.refusalReason != null) GeofenceConfigurationState.Refused(requireNotNull(reply.refusalReason))
            else GeofenceConfigurationState.Unavailable
        } catch (cancelled: CancellationException) { throw cancelled }
        catch (_: Exception) { GeofenceConfigurationState.Unavailable }
    }

    @Serializable private data class OccurrenceReply(val occurrence: EligibleOccurrence? = null)
    override suspend fun eligibleOccurrenceId(churchSlug: String): String? = eligibleOccurrenceId(churchSlug, null)
    override suspend fun eligibleOccurrenceId(churchSlug: String, regionId: String?): String? {
        enteredRegion = regionId
        return api.send("api/mobile/v1/attendance/$churchSlug/occurrence", MobileSuccess.serializer(OccurrenceReply.serializer()),
            query = regionId?.let { mapOf("regionId" to it) }.orEmpty()).value?.occurrence?.occurrenceId
    }

    override suspend fun submit(evidence: AttendanceEvidence, idempotencyKey: String): AttendanceOutcome {
        val body = AttendanceAttemptRequest(
            occurrenceId = evidence.occurrenceId, source = "geofence", phase = evidence.phase,
            observedAt = Instant.ofEpochMilli(evidence.observedAtEpochMillis).toString(),
            accuracyMeters = evidence.accuracyMeters, dwellSeconds = evidence.dwellSeconds,
            latitude = evidence.latitude, longitude = evidence.longitude, mockLocationReported = evidence.mockLocationReported,
            attemptId = evidence.attemptId, detectionId = evidence.detectionId,
            regionId = evidence.regionId ?: enteredRegion, configVersion = evidence.configVersion ?: configVersion,
        )
        val value = try {
            api.send("api/mobile/v1/attendance/attempt", MobileSuccess.serializer(AttendanceResult.serializer()), method = "POST",
                body = FaithFormJson.encodeToString(AttendanceAttemptRequest.serializer(), body), idempotencyKey = idempotencyKey).value
        } catch (error: ApiException) {
            if (error.retryable) throw TransientAttendanceFailure("temporarily_unavailable")
            throw TerminalAttendanceFailure(EvidenceRefusal.Unknown)
        } ?: throw TransientAttendanceFailure("temporarily_unavailable")
        return AttendanceOutcome(value.outcome.wire, value.message, value.occurrenceId,
            value.confirmationNotBefore?.let { Instant.parse(it).toEpochMilli() }, value.detectionId)
    }
}
