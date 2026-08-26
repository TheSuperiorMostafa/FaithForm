package io.faithform.faithful.contract

import java.io.File
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Decodes the same golden fixtures as the TypeScript and Swift suites.
 *
 * The directory is resolved from the module location rather than copied into
 * resources, so all three languages read the exact same bytes and cannot drift.
 */
private val fixtures: File = File("../../../../contracts/faithful/v1/fixtures")
    .canonicalFile

private val json = Json {
    ignoreUnknownKeys = true
    explicitNulls = false
}

private fun fixture(name: String): String =
    File(fixtures, "$name.json").readText()

@kotlinx.serialization.Serializable
private data class SuccessOf<T>(val ok: Boolean, val data: T, val meta: Meta)

@kotlinx.serialization.Serializable
private data class FailureOf(val ok: Boolean, val error: ErrorBody, val meta: Meta)

class ContractTest {

    @Test
    fun `fixture directory resolves`() {
        assertTrue("fixtures not found at ${fixtures.path}", fixtures.isDirectory)
    }

    @Test
    fun `every bootstrap fixture decodes`() {
        for (name in listOf(
            "bootstrap-first-run",
            "bootstrap-multi-church",
            "bootstrap-blocked-relationship",
            "bootstrap-deletion-requested",
            "bootstrap-additive-unknown-fields"
        )) {
            val decoded = json.decodeFromString<SuccessOf<Bootstrap>>(fixture(name))
            assertTrue(name, decoded.ok)
            assertEquals(name, 1, decoded.meta.apiMajor)
            assertTrue(name, decoded.meta.requestId.isNotEmpty())
        }
    }

    @Test
    fun `a first-time account with no churches is valid`() {
        val bootstrap = json.decodeFromString<SuccessOf<Bootstrap>>(fixture("bootstrap-first-run")).data
        assertTrue(bootstrap.relationships.isEmpty())
        assertNull(bootstrap.profile.selectedChurchSlug)
        assertNull(bootstrap.profile.displayName)
        assertEquals(ConsentState.UNSET, bootstrap.profile.autoAttendanceConsent)
    }

    @Test
    fun `multi-church bootstrap keeps relationships independent`() {
        val bootstrap = json.decodeFromString<SuccessOf<Bootstrap>>(fixture("bootstrap-multi-church")).data
        assertEquals(2, bootstrap.relationships.size)
        assertEquals(RelationshipState.JOINED, bootstrap.relationships[0].state)
        assertEquals(RelationshipState.FOLLOWING, bootstrap.relationships[1].state)
        assertTrue(bootstrap.relationships.all { it.canReadPublishedContent })
    }

    @Test
    fun `a blocked relationship cannot read published content`() {
        val bootstrap = json.decodeFromString<SuccessOf<Bootstrap>>(fixture("bootstrap-blocked-relationship")).data
        val relationship = bootstrap.relationships.single()
        assertEquals(RelationshipState.BLOCKED, relationship.state)
        assertFalse(relationship.canReadPublishedContent)
    }

    @Test
    fun `unknown additive fields at any depth are ignored`() {
        val bootstrap = json.decodeFromString<SuccessOf<Bootstrap>>(
            fixture("bootstrap-additive-unknown-fields")
        ).data
        assertEquals("Sam", bootstrap.profile.displayName)
        assertTrue(bootstrap.enabledCapabilities.contains("future_capability"))
    }

    @Test
    fun `every error fixture maps to a typed code`() {
        val expectations = mapOf(
            "error-validation" to MobileErrorCode.INVALID_REQUEST,
            "error-unauthenticated" to MobileErrorCode.UNAUTHENTICATED,
            "error-session-expired" to MobileErrorCode.SESSION_EXPIRED,
            "error-forbidden" to MobileErrorCode.FORBIDDEN,
            "error-blocked" to MobileErrorCode.BLOCKED,
            "error-conflict" to MobileErrorCode.CONFLICT,
            "error-rate-limited" to MobileErrorCode.RATE_LIMITED,
            "error-invitation-expired" to MobileErrorCode.INVITATION_EXPIRED,
            "error-stale-version" to MobileErrorCode.STALE_VERSION,
            "error-client-unsupported" to MobileErrorCode.CLIENT_VERSION_UNSUPPORTED,
            "error-invalid-cursor" to MobileErrorCode.INVALID_CURSOR,
            "error-payload-too-large" to MobileErrorCode.PAYLOAD_TOO_LARGE
        )
        for ((name, code) in expectations) {
            val failure = json.decodeFromString<FailureOf>(fixture(name))
            assertEquals(name, code, failure.error.code)
            assertTrue(name, failure.meta.requestId.isNotEmpty())
        }
    }

    @Test
    fun `rate limiting carries a retry delay`() {
        val failure = json.decodeFromString<FailureOf>(fixture("error-rate-limited"))
        assertEquals(30, failure.error.retryAfterSeconds)
        assertTrue(failure.error.retryable)
    }

    @Test
    fun `validation failures carry field detail`() {
        val failure = json.decodeFromString<FailureOf>(fixture("error-validation"))
        assertEquals("displayName", failure.error.fields?.first()?.field)
    }

    @Test
    fun `a deprecation notice decodes`() {
        val failure = json.decodeFromString<FailureOf>(fixture("error-with-deprecation"))
        assertNotNull(failure.meta.deprecation)
        assertTrue(failure.meta.deprecation!!.replacement.contains("v2"))
    }

    @Test
    fun `pagination is cursor based and terminates`() {
        val first = json.decodeFromString<SuccessOf<RelationshipPage>>(
            fixture("relationship-page-first")
        ).data
        assertNotNull(first.nextCursor)
        assertEquals(1, first.items.size)

        val last = json.decodeFromString<SuccessOf<RelationshipPage>>(
            fixture("relationship-page-last")
        ).data
        assertNull(last.nextCursor)
        assertTrue(last.items.isEmpty())
    }

    @Test
    fun `an unrecognised enum value decodes to unknown rather than throwing`() {
        assertEquals(RelationshipState.UNKNOWN, RelationshipState.fromWire("some_future_state"))
        assertEquals(MobileErrorCode.UNKNOWN, MobileErrorCode.fromWire("some_future_code"))
        assertEquals(RelationshipState.JOINED, RelationshipState.fromWire("joined"))
    }

    @Test
    fun `no fixture exposes a sensitive field name`() {
        // Asserted against real JSON keys, not substrings: `weeklyEmail` is a
        // notification preference, not an email address.
        val forbidden = setOf(
            "accesstoken", "refreshtoken", "servicerole", "apikey", "secret",
            "clientsecret", "publishkey", "streamkey", "token",
            "memberid", "peopleid", "churchid", "accountid", "userid",
            "email", "phone", "latitude", "longitude",
            "role", "featurepermissions", "stripecustomerid"
        )

        // The one place a coordinate is allowed, matched as a whole path.
        //
        // This guard exists to stop *a person's* data reaching a payload. A
        // campus centre is not that — it is a fact about a building the church
        // publishes itself, and GeofencingClient cannot register a region
        // without a centre and a radius. Scoping the exception to an exact path
        // keeps a latitude attached to an account, a member, or an attendance
        // attempt failing, which is the case that actually matters.
        val campusGeometry = Regex(
            """^[^.]+\.data\.configuration\.regions\[\d+]\.(latitude|longitude)$"""
        )
        val exempted = mutableListOf<String>()

        fun walk(element: JsonElement, path: String, fixtureName: String) {
            when (element) {
                is JsonObject -> element.forEach { (key, child) ->
                    val full = "$path.$key"
                    if (key.lowercase() in forbidden) {
                        if (campusGeometry.matches(full)) {
                            exempted += full
                        } else {
                            assertFalse("fixture $fixtureName exposes field $full", true)
                        }
                    }
                    walk(child, full, fixtureName)
                }
                is JsonArray -> element.forEachIndexed { index, child ->
                    walk(child, "$path[$index]", fixtureName)
                }
                else -> Unit
            }
        }

        val files = fixtures.listFiles { file -> file.name.endsWith(".json") }.orEmpty()
        assertTrue("no fixtures discovered", files.isNotEmpty())
        for (file in files) {
            val stem = file.name.removeSuffix(".json")
            walk(json.parseToJsonElement(file.readText()).jsonObject, stem, file.name)
        }

        // Nothing outside a geofence configuration may rely on the carve-out.
        for (path in exempted) {
            assertTrue("unexpected geometry exemption at $path", path.startsWith("geofence-config-"))
        }
        assertTrue("the geofence fixture should exercise the exemption", exempted.isNotEmpty())

        // And the exemption is narrow.
        assertFalse(campusGeometry.matches("f.data.configuration.regions[0].member.latitude"))
        assertFalse(campusGeometry.matches("f.data.account.latitude"))
        assertFalse(campusGeometry.matches("f.data.configuration.latitude"))
        assertTrue(
            campusGeometry.matches("geofence-config-granted.data.configuration.regions[1].longitude")
        )
    }

    // ------------------------------------------------------------------
    // Geofence configuration — the same bytes TypeScript and Swift decode
    // ------------------------------------------------------------------

    @Test
    fun `a granted geofence configuration decodes with the geometry an OS region needs`() {
        val decoded = json.decodeFromString<SuccessOf<GeofenceConfigResponse>>(
            fixture("geofence-config-granted")
        )
        val configuration = assertNotNull(decoded.data.configuration).let { decoded.data.configuration!! }

        assertEquals("grace-community", configuration.churchSlug)
        assertEquals(2, configuration.regions.size)

        val region = configuration.regions.first()
        assertTrue(region.regionId.startsWith("faithful.campus."))
        assertTrue(region.radiusMeters > 0)
        // A centre the OS can actually monitor.
        assertTrue(region.latitude != 0.0)
        assertTrue(region.longitude != 0.0)

        assertTrue(configuration.sources.geofence)
        assertTrue(configuration.requiresConfirmation)
        assertEquals(120, configuration.minDwellSeconds)
    }

    @Test
    fun `the geofence expiry lands on a predictable boundary`() {
        val decoded = json.decodeFromString<SuccessOf<GeofenceConfigResponse>>(
            fixture("geofence-config-granted")
        )
        val configuration = decoded.data.configuration!!

        // `expiresAt` is deterministic within an epoch-aligned 15-minute
        // bucket and the current window state. It still depends on `now` —
        // `now` picks the bucket — but it moves only at predictable boundaries
        // rather than on every request. That is what lets the ETag cover it,
        // which stops a client revalidating an expired configuration from being
        // told "not modified" and never receiving a new expiry.
        val boundaries = configuration.windows.flatMap {
            listOf(it.checkinOpensAt, it.checkinClosesAt)
        }
        assertTrue(
            "${configuration.expiresAt} is not a window boundary",
            configuration.expiresAt in boundaries
        )
    }

    @Test
    fun `a refused geofence configuration carries a reason and no geometry`() {
        for (name in listOf("geofence-config-refused-consent", "geofence-config-refused-link")) {
            val decoded = json.decodeFromString<SuccessOf<GeofenceConfigResponse>>(fixture(name))
            assertNull(decoded.data.configuration)
            assertNotNull(decoded.data.refusalReason)
            assertTrue(decoded.data.message!!.isNotEmpty())
        }
    }

    @Test
    fun `every attendance-result variant decodes`() {
        val expected = mapOf(
            "attendance-result-counted" to "counted",
            "attendance-result-already-counted" to "already_counted",
            "attendance-result-pending" to "pending_confirmation",
            "attendance-result-rejected" to "rejected",
        )
        for ((name, outcome) in expected) {
            val decoded = json.decodeFromString<SuccessOf<AttendanceResult>>(fixture(name))
            assertEquals(name, outcome, decoded.data.outcome.wire)
            assertTrue(decoded.data.message.isNotEmpty())
        }
    }

    @Test
    fun `only a counted result carries a countedAt`() {
        for (name in listOf("attendance-result-counted", "attendance-result-already-counted")) {
            assertNotNull(json.decodeFromString<SuccessOf<AttendanceResult>>(fixture(name)).data.countedAt)
        }
        for (name in listOf("attendance-result-pending", "attendance-result-rejected")) {
            assertNull(json.decodeFromString<SuccessOf<AttendanceResult>>(fixture(name)).data.countedAt)
        }
    }

    @Test
    fun `a consent result carries the version to re-partition against`() {
        val granted = json.decodeFromString<SuccessOf<AttendanceConsentResult>>(
            fixture("attendance-consent-granted"),
        )
        val revoked = json.decodeFromString<SuccessOf<AttendanceConsentResult>>(
            fixture("attendance-consent-revoked"),
        )

        assertEquals("granted", granted.data.autoAttendanceConsent)
        assertEquals("revoked", revoked.data.autoAttendanceConsent)
        // A withdrawal moves the version, which invalidates a cached decision.
        assertTrue(revoked.data.authorizationVersion > granted.data.authorizationVersion)
    }

    @Test
    fun `a rejection message is not a spoofing oracle`() {
        val decoded = json.decodeFromString<SuccessOf<AttendanceResult>>(
            fixture("attendance-result-rejected"),
        )
        val message = decoded.data.message.lowercase()
        for (leak in listOf("metre", "meter", "radius", "distance", "accuracy", "dwell", "gps")) {
            assertFalse("rejection leaks $leak", message.contains(leak))
        }
    }

    @Test
    fun `the geofence configuration carries no integrity field`() {
        // The HMAC `integrity` value was removed from the contract: the client
        // holds no key to verify it with, the server never accepted it back,
        // and TLS already authenticates the transport. A field that looks like
        // a security control but checks nothing is worse than no field at all.
        for (name in listOf(
            "geofence-config-granted",
            "geofence-config-refused-consent",
            "geofence-config-refused-link"
        )) {
            assertFalse("$name still carries integrity", fixture(name).contains("integrity"))
        }
    }
}
