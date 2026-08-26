package io.faithform.faithful.contract

import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Decodes the Prompt 5 additions to the contract.
 *
 * These use inline fixtures rather than the shared golden files because they
 * exercise field-level shapes the golden set does not yet carry; the shared
 * fixtures remain the cross-language parity gate in [ContractTest].
 */
private val feedJson = Json {
    ignoreUnknownKeys = true
    explicitNulls = false
}

@kotlinx.serialization.Serializable
private data class FeedSuccess<T>(val ok: Boolean, val data: T, val meta: Meta)

private const val FEED_META =
    """"meta":{"apiVersion":"2026-08-24","apiMajor":1,"requestId":"r-1","minimumSupportedClientBuild":1}"""

class FeedContractTest {

    @Test
    fun `a discovered church decodes, with and without a distance`() {
        val withDistance = """
        {"ok":true,"data":{"items":[{"slug":"grace","name":"Grace","logoUrl":null,"publicSummary":null,
        "denomination":null,"city":"Louisville","state":"KY","postalCode":null,"joinPolicy":"open",
        "publicProfileVersion":1,"distanceKm":2.4,"campusName":"East"}],"nextCursor":null},$FEED_META}
        """.trimIndent()

        val page = feedJson.decodeFromString<FeedSuccess<DiscoveryPage>>(withDistance).data
        assertEquals(1, page.items.size)
        assertEquals(2.4, page.items[0].distanceKm!!, 0.001)
        assertEquals(JoinPolicy.OPEN, page.items[0].joinPolicy)

        val withoutDistance = withDistance.replace("\"distanceKm\":2.4", "\"distanceKm\":null")
        val manual = feedJson.decodeFromString<FeedSuccess<DiscoveryPage>>(withoutDistance).data
        assertNull(manual.items[0].distanceKm)
    }

    @Test
    fun `an announcement and an event both decode`() {
        val announcement = """
        {"ok":true,"data":{"items":[{"id":"a-1","title":"Notice","body":"Text","startAt":"2026-08-30T14:00:00Z",
        "endAt":null,"location":null,"posterUrl":null,"posterAltText":null,"isPinned":false,
        "visibility":"followers","publicationVersion":3,"publishedAt":null,"isEvent":false,
        "churchSlug":"grace","churchName":"Grace","churchTimezone":"America/New_York"}],
        "nextCursor":null,"feedVersion":3},$FEED_META}
        """.trimIndent()

        val page = feedJson.decodeFromString<FeedSuccess<FeedPage>>(announcement).data
        assertFalse(page.items[0].isEvent)
        assertNull(page.items[0].endAt)
        assertEquals(AnnouncementVisibility.FOLLOWERS, page.items[0].visibility)
        assertEquals(3, page.feedVersion)

        val event = announcement
            .replace("\"endAt\":null", "\"endAt\":\"2026-08-30T16:00:00Z\"")
            .replace("\"isEvent\":false", "\"isEvent\":true")
        val eventPage = feedJson.decodeFromString<FeedSuccess<FeedPage>>(event).data
        assertTrue(eventPage.items[0].isEvent)
        assertEquals("2026-08-30T16:00:00Z", eventPage.items[0].endAt)
    }

    @Test
    fun `a poster-bearing item carries alt text alongside its artwork`() {
        val withPoster = """
        {"ok":true,"data":{"items":[{"id":"a-2","title":"T","body":"","startAt":"2026-08-30T14:00:00Z",
        "endAt":null,"location":null,"posterUrl":"https://cdn.invalid/p.png",
        "posterAltText":"A hand-lettered invitation","isPinned":true,"visibility":"public",
        "publicationVersion":1,"publishedAt":null,"isEvent":false,"churchSlug":"grace",
        "churchName":"Grace","churchTimezone":"America/New_York"}],"nextCursor":null,"feedVersion":1},$FEED_META}
        """.trimIndent()

        val item = feedJson.decodeFromString<FeedSuccess<FeedPage>>(withPoster).data.items.single()
        assertEquals("https://cdn.invalid/p.png", item.posterUrl)
        // Artwork without alt text would be unreadable to a screen reader.
        assertEquals("A hand-lettered invitation", item.posterAltText)
        assertTrue(item.isPinned)
    }

    @Test
    fun `a text-only item is valid and carries no poster`() {
        val textOnly = """
        {"ok":true,"data":{"items":[{"id":"a-3","title":"T","body":"Just words","startAt":"2026-08-30T14:00:00Z",
        "endAt":null,"location":null,"posterUrl":null,"posterAltText":null,"isPinned":false,
        "visibility":"members","publicationVersion":1,"publishedAt":null,"isEvent":false,
        "churchSlug":"grace","churchName":"Grace","churchTimezone":"America/New_York"}],
        "nextCursor":null,"feedVersion":1},$FEED_META}
        """.trimIndent()

        val item = feedJson.decodeFromString<FeedSuccess<FeedPage>>(textOnly).data.items.single()
        assertNull(item.posterUrl)
        assertEquals(AnnouncementVisibility.MEMBERS, item.visibility)
    }

    @Test
    fun `onboarding state decodes for a first-run account`() {
        val firstRun = """
        {"ok":true,"data":{"needsOnboarding":true,"hasAnyRelationship":false,"selectedChurchSlug":null,
        "activeChurchCount":0,"requiresChurchChooser":false},$FEED_META}
        """.trimIndent()

        val state = feedJson.decodeFromString<FeedSuccess<OnboardingState>>(firstRun).data
        assertTrue(state.needsOnboarding)
        assertNull(state.selectedChurchSlug)
        assertFalse(state.requiresChurchChooser)
    }

    @Test
    fun `onboarding state decodes when a chooser is required`() {
        val multiChurch = """
        {"ok":true,"data":{"needsOnboarding":false,"hasAnyRelationship":true,"selectedChurchSlug":null,
        "activeChurchCount":3,"requiresChurchChooser":true},$FEED_META}
        """.trimIndent()

        val state = feedJson.decodeFromString<FeedSuccess<OnboardingState>>(multiChurch).data
        assertFalse(state.needsOnboarding)
        assertEquals(3, state.activeChurchCount)
        assertTrue(state.requiresChurchChooser)
    }

    @Test
    fun `a church profile carries campuses, service times and the caller's relationship`() {
        val profile = """
        {"ok":true,"data":{"slug":"grace","name":"Grace","logoUrl":null,"coverImageUrl":null,
        "publicSummary":null,"tagline":null,"denomination":null,"address":null,"city":"Louisville",
        "state":"KY","postalCode":null,"website":null,"phone":null,"email":null,"joinPolicy":"approval_required",
        "timezone":"America/New_York","publicProfileVersion":2,
        "campuses":[{"slug":"east","name":"East","addressLine1":null,"city":null,"state":null,
        "postalCode":null,"latitude":38.25,"longitude":-85.75,"timezone":"America/New_York","isPrimary":true}],
        "serviceTimes":[{"campusSlug":"east","label":"Morning","dayOfWeek":0,"startTime":"10:00:00","kind":"regular"}],
        "relationshipState":"pending"},$FEED_META}
        """.trimIndent()

        val data = feedJson.decodeFromString<FeedSuccess<ChurchProfile>>(profile).data
        assertEquals(JoinPolicy.APPROVAL_REQUIRED, data.joinPolicy)
        assertEquals(RelationshipState.PENDING, data.relationshipState)
        assertEquals(1, data.campuses.size)
        assertTrue(data.campuses[0].isPrimary)
        assertEquals("east", data.serviceTimes[0].campusSlug)
    }

    @Test
    fun `a signed-out profile has no relationship rather than a fabricated one`() {
        val anonymous = """
        {"ok":true,"data":{"slug":"grace","name":"Grace","logoUrl":null,"coverImageUrl":null,
        "publicSummary":null,"tagline":null,"denomination":null,"address":null,"city":null,
        "state":null,"postalCode":null,"website":null,"phone":null,"email":null,"joinPolicy":"open",
        "timezone":"UTC","publicProfileVersion":1,"campuses":[],"serviceTimes":[],
        "relationshipState":null},$FEED_META}
        """.trimIndent()

        val data = feedJson.decodeFromString<FeedSuccess<ChurchProfile>>(anonymous).data
        assertNull(data.relationshipState)
    }

    @Test
    fun `notification preferences and device installations decode`() {
        val preference = """{"churchSlug":"grace","topic":"announcements","isEnabled":false}"""
        val decoded = feedJson.decodeFromString<NotificationPreference>(preference)
        assertEquals(NotificationTopic.ANNOUNCEMENTS, decoded.topic)
        assertFalse(decoded.isEnabled)

        val installation =
            """{"installId":"abcdefgh1234","platform":"android","isEnabled":true,"lastSeenAt":"2026-08-24T10:00:00Z"}"""
        val install = feedJson.decodeFromString<DeviceInstallation>(installation)
        assertEquals(DevicePlatform.ANDROID, install.platform)
        assertTrue(install.isEnabled)
    }

    @Test
    fun `a device installation never carries a provider token`() {
        // Absence at the schema level: the generated type has no such field, so
        // no server change could start returning one to a client.
        val fields = DeviceInstallation::class.java.declaredFields.map { it.name.lowercase() }
        for (forbidden in listOf("providertoken", "token", "accountid")) {
            assertFalse("DeviceInstallation exposes $forbidden", fields.contains(forbidden))
        }
    }

    @Test
    fun `an unrecognised visibility or topic decodes to unknown rather than throwing`() {
        assertEquals(AnnouncementVisibility.UNKNOWN, AnnouncementVisibility.fromWire("some_future"))
        assertEquals(NotificationTopic.UNKNOWN, NotificationTopic.fromWire("some_future"))
        assertEquals(DevicePlatform.UNKNOWN, DevicePlatform.fromWire("web"))
        assertEquals(AnnouncementVisibility.PUBLIC, AnnouncementVisibility.fromWire("public"))
    }
}
