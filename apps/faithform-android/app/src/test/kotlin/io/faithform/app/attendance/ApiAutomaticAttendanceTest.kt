package io.faithform.app.attendance

import io.faithform.app.contract.AttendanceSourceAvailability
import io.faithform.app.contract.GeofenceConfigResponse
import io.faithform.app.contract.GeofenceConfiguration
import io.faithform.app.network.*
import io.faithform.app.storage.CachePartition
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.*
import org.junit.Assert.*
import org.junit.Test

class ApiAutomaticAttendanceTest {
    private val sent = mutableListOf<HttpRequest>()
    private val replies = ArrayDeque<String>()
    private val api = ApiClient(ApiEnvironment("test", "https://example.test"), 1,
        object : HttpTransport {
            override suspend fun perform(request: HttpRequest): HttpResponse {
                sent += request
                return HttpResponse(200, """{"ok":true,"data":${replies.removeFirst()},"meta":{"apiVersion":"1.0","apiMajor":1,"requestId":"r","minimumSupportedClientBuild":1}}""", emptyMap())
            }
        }, object : TokenProvider {
            override suspend fun validAccessToken() = "test-only"
            override suspend fun invalidate() = Unit
        })

    @Test fun `the entered campus scopes occurrence lookup`() = runTest {
        replies += """{"occurrence":null}"""
        assertNull(ApiAutomaticAttendance(api).eligibleOccurrenceId("grace", "faithform.campus.north"))
        assertEquals("https://example.test/api/mobile/v1/attendance/grace/occurrence?regionId=faithform.campus.north", sent.single().url)
    }

    @Test fun `confirmation keeps server capability and logical attempt identity`() = runTest {
        replies += """{"outcome":"pending_confirmation","message":"Wait","occurrenceId":"occ","confirmationNotBefore":"2026-09-30T16:00:00Z","detectionId":"server-detection"}"""
        val result = ApiAutomaticAttendance(api).submit(AttendanceEvidence("occ", "confirm", "attempt", "server-detection", "faithform.campus.north", 7,
            1_790_784_000_000, 15.0, 60, 38.0, -85.0, false), "logical-key")
        val request = sent.single()
        assertEquals("logical-key", request.headers["Idempotency-Key"])
        val body = FaithFormJson.parseToJsonElement(requireNotNull(request.body)).jsonObject
        assertEquals("server-detection", body.getValue("detectionId").jsonPrimitive.content)
        assertEquals("faithform.campus.north", body.getValue("regionId").jsonPrimitive.content)
        assertEquals(7, body.getValue("configVersion").jsonPrimitive.int)
        assertEquals("geofence", body.getValue("source").jsonPrimitive.content)
        assertEquals(java.time.Instant.parse("2026-09-30T16:00:00Z").toEpochMilli(), result.confirmationNotBeforeEpochMillis)
    }

    @Test fun `an expired configuration never grants authority`() = runTest {
        val configuration = GeofenceConfiguration("grace", emptyList(), emptyList(), AttendanceSourceAvailability(true, true, true), true, 60, 100, 1, "2020-01-01T00:00:00Z")
        replies += FaithFormJson.encodeToString(GeofenceConfigResponse.serializer(), GeofenceConfigResponse(configuration))
        val state = ApiAutomaticAttendance(api).currentConfiguration("grace", CachePartition("test", "person", "grace", 1), System.currentTimeMillis(), true)
        assertEquals(GeofenceConfigurationState.Unavailable, state)
        assertEquals("GET", sent.single().method)
    }
}
