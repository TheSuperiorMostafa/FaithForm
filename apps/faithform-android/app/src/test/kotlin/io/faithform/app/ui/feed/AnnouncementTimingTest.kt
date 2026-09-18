package io.faithform.app.ui.feed

import io.faithform.app.contract.AnnouncementVisibility
import io.faithform.app.contract.FeedItem
import java.time.Instant
import java.time.ZoneId
import java.util.Locale
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The same rules as `AnnouncementTimingTests.swift`: the church's today, an
 * all-day date read in UTC, and the feed's groups.
 */
class AnnouncementTimingTest {

    /** 11:00 on Saturday 19 September 2026 in New York. */
    private val now = Instant.parse("2026-09-19T15:00:00Z")

    private fun item(
        id: String = "a",
        startAt: String,
        endAt: String? = null,
        allDay: Boolean = false,
        isPinned: Boolean = false,
    ) = FeedItem(
        id = id, title = "T", body = "", startAt = startAt, endAt = endAt, allDay = allDay,
        location = null, posterUrl = null, posterAltText = null, isPinned = isPinned,
        visibility = AnnouncementVisibility.FOLLOWERS, publicationVersion = 1, publishedAt = null,
        isEvent = endAt != null, churchSlug = "grace", churchName = "Grace",
        churchTimezone = "America/New_York",
    )

    @Test
    fun `the server's +00 offset parses as well as Z`() {
        // Postgres writes +00:00, and Instant.parse rejects it before Android 14.
        assertEquals(now, AnnouncementTiming.parseInstant("2026-09-19T15:00:00+00:00"))
        assertEquals(now, AnnouncementTiming.parseInstant("2026-09-19T15:00:00Z"))
        assertEquals(now, AnnouncementTiming.parseInstant("2026-09-19T15:00:00.000Z"))
        assertEquals(null, AnnouncementTiming.parseInstant("not a date"))
    }

    @Test
    fun `an event under way is happening now, and one that has ended is past`() {
        val walk = item(startAt = "2026-09-19T14:30:00Z", endAt = "2026-09-19T15:30:00Z")
        assertEquals(AnnouncementMoment.HAPPENING_NOW, AnnouncementTiming.moment(walk, now))

        val breakfast = item(startAt = "2026-09-19T12:00:00Z", endAt = "2026-09-19T13:00:00Z")
        assertEquals(AnnouncementMoment.PAST, AnnouncementTiming.moment(breakfast, now))
    }

    @Test
    fun `today and tomorrow are the church's days, not UTC's`() {
        // 01:00 UTC on the 20th is still the evening of the 19th in New York.
        assertEquals(AnnouncementMoment.TODAY, AnnouncementTiming.moment(item(startAt = "2026-09-20T01:00:00Z"), now))
        assertEquals(AnnouncementMoment.TOMORROW, AnnouncementTiming.moment(item(startAt = "2026-09-20T14:00:00Z"), now))
        assertEquals(AnnouncementMoment.UPCOMING, AnnouncementTiming.moment(item(startAt = "2026-09-25T14:00:00Z"), now))
    }

    @Test
    fun `an all-day date is read in UTC, where the dashboard stored it`() {
        // Midnight UTC on the 20th. Read in New York it would be the 19th.
        val picnic = item(startAt = "2026-09-20T00:00:00Z", allDay = true)
        assertEquals(1L, AnnouncementTiming.dayOffset(picnic, now))
        assertEquals("20", AnnouncementFormatting.tile(picnic, Locale.US)?.second)
        assertTrue(formatWhen(picnic).startsWith("Sunday"))
        assertEquals("Sunday · All day", AnnouncementFormatting.timeLine(picnic, "All day", Locale.US))
    }

    @Test
    fun `sections are pinned, today, this week, later, each in the server's order`() {
        val groups = AnnouncementTiming.sections(
            listOf(
                item(id = "pinned-later", startAt = "2026-10-30T14:00:00Z", isPinned = true),
                item(id = "now", startAt = "2026-09-19T14:30:00Z", endAt = "2026-09-19T15:30:00Z"),
                item(id = "tonight", startAt = "2026-09-19T23:00:00Z"),
                item(id = "sunday", startAt = "2026-09-20T14:00:00Z"),
                item(id = "friday", startAt = "2026-09-25T22:00:00Z"),
                item(id = "next-month", startAt = "2026-10-04T14:00:00Z"),
            ),
            now,
        )

        assertEquals(
            listOf(FeedSection.PINNED, FeedSection.TODAY, FeedSection.THIS_WEEK, FeedSection.LATER),
            groups.map { it.section },
        )
        assertEquals(listOf("pinned-later"), groups[0].items.map { it.id })
        assertEquals(listOf("now", "tonight"), groups[1].items.map { it.id })
        assertEquals(listOf("sunday", "friday"), groups[2].items.map { it.id })
        assertEquals(listOf("next-month"), groups[3].items.map { it.id })
    }

    @Test
    fun `a timed item goes to the calendar in the church's zone, an hour long without an end`() {
        val span = AnnouncementTiming.calendarSpan(item(startAt = "2026-09-20T14:00:00Z"))
        assertNotNull(span)
        assertFalse(span!!.allDay)
        assertEquals(Instant.parse("2026-09-20T14:00:00Z").toEpochMilli(), span.beginMillis)
        assertEquals(Instant.parse("2026-09-20T15:00:00Z").toEpochMilli(), span.endMillis)
        assertEquals("America/New_York", span.timeZone)
    }

    @Test
    fun `an all-day item goes to the calendar as its date at midnight UTC`() {
        val span = AnnouncementTiming.calendarSpan(item(startAt = "2026-09-20T00:00:00Z", allDay = true))!!
        assertTrue(span.allDay)
        assertEquals(Instant.parse("2026-09-20T00:00:00Z").toEpochMilli(), span.beginMillis)
        assertEquals(Instant.parse("2026-09-21T00:00:00Z").toEpochMilli(), span.endMillis)
    }

    @Test
    fun `the detail names the zone only when the phone's offset differs`() {
        val service = item(startAt = "2026-09-20T14:00:00Z", endAt = "2026-09-20T15:00:00Z")

        val home = AnnouncementFormatting.detailWhen(service, "All day", Locale.US, ZoneId.of("America/Detroit"), now)
        assertFalse(home.time!!.contains("EDT"))

        val away = AnnouncementFormatting.detailWhen(service, "All day", Locale.US, ZoneId.of("America/Los_Angeles"), now)
        assertTrue(away.time!!.contains("EDT"))
        assertTrue(away.time!!.contains("10:00"))
        assertEquals("Sunday, September 20", away.date)
    }

    @Test
    fun `the card's time line leads with the weekday`() {
        val line = AnnouncementFormatting.timeLine(
            item(startAt = "2026-09-20T14:00:00Z", endAt = "2026-09-20T15:30:00Z"),
            "All day",
            Locale.US,
        )
        assertTrue(line, line.startsWith("Sunday · "))
        assertTrue(line, line.contains("10:00"))
        assertTrue(line, line.contains("11:30"))
    }
}
