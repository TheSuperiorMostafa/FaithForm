package io.faithform.app.ui.church

import io.faithform.app.contract.ChurchProfile
import io.faithform.app.contract.ChurchSocialLink
import io.faithform.app.contract.JoinPolicy
import io.faithform.app.contract.PublicCampus
import io.faithform.app.contract.PublicServiceTime
import io.faithform.app.contract.RelationshipState
import java.time.DayOfWeek
import java.time.LocalTime
import java.time.ZoneId
import java.time.ZonedDateTime
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

private fun profile(
    state: RelationshipState? = null,
    policy: JoinPolicy = JoinPolicy.OPEN,
    campuses: List<PublicCampus> = emptyList(),
    serviceTimes: List<PublicServiceTime> = emptyList(),
    address: String? = null,
    city: String? = null,
    region: String? = null,
    phone: String? = null,
    email: String? = null,
    website: String? = null,
    mapsUrl: String? = null,
    denomination: String? = null,
    about: String? = null,
    publicSummary: String? = null,
) = ChurchProfile(
    slug = "grace",
    name = "Grace",
    publicSummary = publicSummary,
    denomination = denomination,
    address = address,
    city = city,
    state = region,
    website = website,
    phone = phone,
    email = email,
    joinPolicy = policy,
    timezone = "America/New_York",
    publicProfileVersion = 1,
    campuses = campuses,
    serviceTimes = serviceTimes,
    relationshipState = state,
    about = about,
    mapsUrl = mapsUrl,
)

private fun campus(
    slug: String,
    name: String = slug.replaceFirstChar { it.uppercase() },
    street: String? = null,
    primary: Boolean = false,
    latitude: Double? = null,
    longitude: Double? = null,
) = PublicCampus(
    slug = slug, name = name, addressLine1 = street, city = "Louisville", state = "KY",
    postalCode = "40202", latitude = latitude, longitude = longitude,
    timezone = "America/New_York", isPrimary = primary,
)

private fun service(day: Int, time: String, label: String = "Worship", campus: String = "") =
    PublicServiceTime(campusSlug = campus, label = label, dayOfWeek = day, startTime = time, kind = "regular")

/** The rules behind the Church info page, against the shipped code. */
class ChurchActionRulesTest {

    @Test
    fun `the primary action follows the table, first match wins`() {
        val none = listOf(null, RelationshipState.LEFT, RelationshipState.UNKNOWN)
        for (state in none) {
            assertEquals(ChurchAction.ADD, ChurchActions.forProfile(profile(state), hasOtherChurch = false))
            assertEquals(ChurchAction.SWITCH, ChurchActions.forProfile(profile(state), hasOtherChurch = true))
            assertEquals(
                ChurchAction.INVITATION_REQUIRED,
                ChurchActions.forProfile(profile(state, JoinPolicy.INVITE_ONLY), hasOtherChurch = true),
            )
            assertEquals(
                ChurchAction.ADD,
                ChurchActions.forProfile(profile(state, JoinPolicy.APPROVAL_REQUIRED), hasOtherChurch = false),
            )
        }
        for (state in listOf(RelationshipState.FOLLOWING, RelationshipState.PENDING, RelationshipState.JOINED)) {
            for (policy in JoinPolicy.entries) {
                assertEquals(ChurchAction.CURRENT, ChurchActions.forProfile(profile(state, policy), hasOtherChurch = true))
            }
        }
        for (policy in JoinPolicy.entries) {
            assertEquals(
                ChurchAction.UNAVAILABLE,
                ChurchActions.forProfile(profile(RelationshipState.BLOCKED, policy), hasOtherChurch = true),
            )
        }
    }

    @Test
    fun `another church means a selected church with a different slug`() {
        assertEquals(false, ChurchActions.hasOtherChurch(null, "grace"))
        assertEquals(false, ChurchActions.hasOtherChurch("", "grace"))
        assertEquals(false, ChurchActions.hasOtherChurch("grace", "grace"))
        assertEquals(true, ChurchActions.hasOtherChurch("hope", "grace"))
    }

    @Test
    fun `the identity line leaves out whatever is missing`() {
        assertEquals("Baptist · Louisville, KY", ChurchActions.detailLine(profile(denomination = "Baptist", city = "Louisville", region = "KY")))
        assertEquals("Louisville", ChurchActions.detailLine(profile(city = "Louisville")))
        assertEquals("Baptist", ChurchActions.detailLine(profile(denomination = " Baptist ")))
        assertNull(ChurchActions.detailLine(profile()))
    }

    @Test
    fun `about falls back to the public summary`() {
        assertEquals("Long", ChurchActions.aboutText(profile(about = "Long", publicSummary = "Short")))
        assertEquals("Short", ChurchActions.aboutText(profile(about = "  ", publicSummary = "Short")))
        assertNull(ChurchActions.aboutText(profile()))
    }
}

class ServiceTimesTest {

    private val zone = ZoneId.of("America/New_York")

    /** Wednesday 16 September 2026, at [time] in the church's zone. */
    private fun wednesdayAt(time: String) =
        ZonedDateTime.of(2026, 9, 16, time.substringBefore(':').toInt(), time.substringAfter(':').toInt(), 0, 0, zone)
            .toInstant()

    @Test
    fun `times parse with or without seconds and never convert zones`() {
        assertEquals(LocalTime.of(9, 0), ServiceTimes.parse("09:00"))
        assertEquals(LocalTime.of(18, 30), ServiceTimes.parse("18:30:00"))
        assertEquals(LocalTime.of(7, 5), ServiceTimes.parse("7:05"))
        assertNull(ServiceTimes.parse("25:00"))
        assertNull(ServiceTimes.parse("soon"))
    }

    @Test
    fun `day zero is Sunday, and out-of-range days are clamped`() {
        assertEquals(DayOfWeek.SUNDAY, ServiceTimes.dayOfWeek(0))
        assertEquals(DayOfWeek.MONDAY, ServiceTimes.dayOfWeek(1))
        assertEquals(DayOfWeek.SATURDAY, ServiceTimes.dayOfWeek(6))
        assertEquals(DayOfWeek.SATURDAY, ServiceTimes.dayOfWeek(99))
    }

    @Test
    fun `the next service is later today when it has not started yet`() {
        val next = ServiceTimes.next(listOf(service(3, "19:00:00"), service(0, "09:00:00")), zone, wednesdayAt("08:00"))!!
        assertEquals(3, next.service.dayOfWeek)
        assertEquals(0, next.daysAway)
        assertEquals(19, next.startsAt.hour)
    }

    @Test
    fun `tomorrow and in several days are counted in calendar days`() {
        val tomorrow = ServiceTimes.next(listOf(service(4, "06:00")), zone, wednesdayAt("23:30"))!!
        assertEquals(1, tomorrow.daysAway)

        val sunday = ServiceTimes.next(listOf(service(0, "10:00")), zone, wednesdayAt("12:00"))!!
        assertEquals(4, sunday.daysAway)
        assertEquals(DayOfWeek.SUNDAY, sunday.startsAt.dayOfWeek)
    }

    @Test
    fun `a service that already started today comes round again next week`() {
        val next = ServiceTimes.next(listOf(service(3, "09:00")), zone, wednesdayAt("09:01"))!!
        assertEquals(7, next.daysAway)
    }

    @Test
    fun `the soonest of several wins, and unreadable times are skipped`() {
        val next = ServiceTimes.next(
            listOf(service(0, "11:00", "Late"), service(0, "09:00", "Early"), service(5, "later"), service(9, "10:00")),
            zone,
            wednesdayAt("12:00"),
        )!!
        assertEquals("Early", next.service.label)
        assertNull(ServiceTimes.next(listOf(service(1, "nope")), zone, wednesdayAt("12:00")))
        assertNull(ServiceTimes.next(emptyList(), zone, wednesdayAt("12:00")))
    }

    @Test
    fun `the church's zone decides what today is`() {
        // 02:00 UTC on Thursday is still Wednesday evening in Louisville.
        val instant = ZonedDateTime.of(2026, 9, 17, 2, 0, 0, 0, ZoneId.of("UTC")).toInstant()
        val next = ServiceTimes.next(listOf(service(3, "23:00")), zone, instant)!!
        assertEquals(0, next.daysAway)
    }

    @Test
    fun `an unknown zone falls back rather than crashing`() {
        assertEquals(ZoneId.of("Europe/London"), ServiceTimes.zone("Europe/London"))
        assertEquals(ZoneId.systemDefault(), ServiceTimes.zone("Not/AZone"))
        assertEquals(ZoneId.systemDefault(), ServiceTimes.zone(null))
    }

    @Test
    fun `church-wide times come first, then one group per campus when there are several`() {
        val groups = ServiceTimes.groups(
            profile(
                campuses = listOf(campus("east", "East"), campus("west", "West")),
                serviceTimes = listOf(
                    service(0, "11:00", campus = "west"),
                    service(0, "09:00", campus = "east"),
                    service(3, "19:00"),
                    service(0, "08:00", campus = "gone"),
                ),
            ),
        )
        assertEquals(listOf(null, "East", "West"), groups.map { it.campusName })
        assertEquals(listOf("08:00", "19:00"), groups[0].times.map { it.startTime })
    }

    @Test
    fun `with one campus everything is one list, Sunday first and earliest first`() {
        val groups = ServiceTimes.groups(
            profile(
                campuses = listOf(campus("main")),
                serviceTimes = listOf(service(3, "19:00", campus = "main"), service(0, "11:00"), service(0, "09:00", campus = "main")),
            ),
        )
        assertEquals(1, groups.size)
        assertNull(groups[0].campusName)
        assertEquals(listOf("09:00", "11:00", "19:00"), groups[0].times.map { it.startTime })
        assertEquals(emptyList<ServiceTimeGroup>(), ServiceTimes.groups(profile()))
    }
}

class ChurchLinksTest {

    @Test
    fun `only absolute http and https links are opened`() {
        assertEquals("https://grace.org/give", ChurchLinks.webUrl(" https://grace.org/give "))
        assertEquals("http://grace.org", ChurchLinks.webUrl("http://grace.org"))
        assertNull(ChurchLinks.webUrl("javascript:alert(1)"))
        assertNull(ChurchLinks.webUrl("intent://scan#Intent;end"))
        assertNull(ChurchLinks.webUrl("grace.org"))
        assertNull(ChurchLinks.webUrl(""))
    }

    @Test
    fun `a typed website without a scheme is read as https`() {
        assertEquals("https://grace.org", ChurchLinks.websiteUrl("grace.org"))
        assertEquals("https://grace.org", ChurchLinks.websiteUrl("https://grace.org"))
        assertNull(ChurchLinks.websiteUrl("not a site"))
        assertNull(ChurchLinks.websiteUrl("ftp://grace.org"))
    }

    @Test
    fun `phone numbers keep digits and plus only, and email must look like one`() {
        assertEquals("tel:+15025550100", ChurchLinks.telUri("+1 (502) 555-0100"))
        assertNull(ChurchLinks.telUri("call us"))
        assertEquals("mailto:hello@grace.org", ChurchLinks.mailtoUri(" hello@grace.org "))
        assertNull(ChurchLinks.mailtoUri("hello"))
        assertNull(ChurchLinks.mailtoUri("a@b.org?subject=x"))
    }

    @Test
    fun `host names drop www`() {
        assertEquals("grace.org", ChurchLinks.hostName("https://www.grace.org/about"))
        assertEquals("give.grace.org", ChurchLinks.hostName("https://give.grace.org"))
    }

    @Test
    fun `directions prefer the church's maps link, then its street, then a campus`() {
        assertEquals(
            DirectionsTarget.Link("https://maps.example/grace"),
            ChurchLinks.churchDirections(profile(mapsUrl = "https://maps.example/grace", address = "1 Main St")),
        )
        assertEquals(
            DirectionsTarget.Address("1 Main St, Louisville, KY"),
            ChurchLinks.churchDirections(profile(address = "1 Main St", city = "Louisville", region = "KY")),
        )
        assertEquals(
            DirectionsTarget.Coordinates(38.25, -85.75, "Main"),
            ChurchLinks.churchDirections(
                profile(campuses = listOf(campus("east", street = "2 East St"), campus("main", "Main", primary = true, latitude = 38.25, longitude = -85.75))),
            ),
        )
        // A city alone is not somewhere to drive to.
        assertNull(ChurchLinks.churchDirections(profile(city = "Louisville", campuses = listOf(campus("east")))))
    }

    @Test
    fun `quick actions appear only for what the church filled in, in a fixed order`() {
        val all = ChurchLinks.quickActions(
            profile(address = "1 Main St", phone = "502 555 0100", email = "hi@grace.org", website = "grace.org"),
        )
        assertEquals(
            listOf(
                QuickAction.Directions(DirectionsTarget.Address("1 Main St")),
                QuickAction.Call("tel:5025550100"),
                QuickAction.Email("mailto:hi@grace.org"),
                QuickAction.Website("https://grace.org"),
            ),
            all,
        )
        assertEquals(emptyList<QuickAction>(), ChurchLinks.quickActions(profile()))
    }

    @Test
    fun `social platforms are recognised by name and anything else is a link`() {
        assertEquals(SocialPlatform.INSTAGRAM, SocialPlatform.from("Instagram"))
        assertEquals(SocialPlatform.X, SocialPlatform.from("x"))
        assertEquals(SocialPlatform.PODCAST, SocialPlatform.from("podcast"))
        assertEquals(SocialPlatform.LINK, SocialPlatform.from("threads"))
        assertEquals(SocialPlatform.LINK, SocialPlatform.from(null))
        assertNull(SocialPlatform.LINK.brandArgb)
        assertEquals(0xFFE1306C, SocialPlatform.from(ChurchSocialLink("instagram", "https://i.example").platform).brandArgb)
    }
}
