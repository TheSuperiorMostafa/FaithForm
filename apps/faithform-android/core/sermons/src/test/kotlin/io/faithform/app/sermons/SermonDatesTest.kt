package io.faithform.app.sermons

import io.faithform.app.contract.SermonListItem
import java.time.Instant
import java.time.LocalDate
import java.time.YearMonth
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class SermonDatesTest {

    private fun item(
        id: String,
        preachedOn: String? = null,
        publishedAt: String = "2026-09-13T14:03:22.123Z",
        timezone: String = "America/Chicago",
    ) = SermonListItem(
        sermonId = id,
        title = "Sermon $id",
        summary = null,
        publishedAt = publishedAt,
        preachedOn = preachedOn,
        scriptureRefs = emptyList(),
        seriesName = null,
        publicationVersion = 1,
        churchSlug = "grace",
        churchName = "Grace Chapel",
        churchTimezone = timezone,
    )

    @Test
    fun `publishedAt reads the contract's form and every form older servers sent`() {
        val instant = Instant.parse("2026-09-13T14:03:22Z")
        for (text in listOf(
            "2026-09-13T14:03:22Z",
            "2026-09-13T14:03:22+00:00",
            "2026-09-13T09:03:22-05:00",
            "2026-09-13 14:03:22+00",
            "2026-09-13T14:03:22+0000",
            "2026-09-13T14:03:22",
        )) {
            assertEquals(text, instant, parsePublishedAt(text)?.toInstant())
        }
        // Fractions of any length, with `Z` or an offset, name the same second.
        for (text in listOf(
            "2026-09-13T14:03:22.123Z",
            "2026-09-13T14:03:22.123456+00:00",
            "2026-09-13 14:03:22.123456+00",
        )) {
            val parsed = parsePublishedAt(text)?.toInstant()
            assertEquals(text, instant.epochSecond, parsed?.epochSecond)
            assertTrue(text, parsed!!.nano >= 123_000_000)
        }
    }

    @Test
    fun `an unreadable publishedAt is null, not a crash`() {
        for (text in listOf(null, "", "   ", "yesterday", "2026-13-40T00:00:00Z", "2026-09-13")) {
            assertNull("$text", parsePublishedAt(text))
        }
    }

    @Test
    fun `preachedOn is a calendar date and is never shifted through a timezone`() {
        assertEquals(LocalDate.of(2026, 9, 13), parsePreachedOn("2026-09-13"))
        assertNull(parsePreachedOn("13/09/2026"))
        assertNull(parsePreachedOn(null))
        // Preached Sunday; published after midnight UTC. Still Sunday.
        assertEquals(
            LocalDate.of(2026, 9, 13),
            sermonDate("2026-09-13", "2026-09-14T03:00:00Z", "Pacific/Honolulu"),
        )
    }

    @Test
    fun `with no preachedOn the sermon is dated by the church's day it was published`() {
        // 03:00 UTC on 1 September is still 31 August in Chicago.
        assertEquals(LocalDate.of(2026, 8, 31), item("a", publishedAt = "2026-09-01T03:00:00Z").preachedDate)
        // A preachedOn that does not parse falls back rather than hiding the date.
        assertEquals(
            LocalDate.of(2026, 8, 31),
            item("b", preachedOn = "last Sunday", publishedAt = "2026-09-01T03:00:00Z").preachedDate,
        )
        // A zone this device does not know is read as UTC.
        assertEquals(
            LocalDate.of(2026, 9, 1),
            item("c", publishedAt = "2026-09-01T03:00:00Z", timezone = "Mars/Olympus").preachedDate,
        )
        assertNull(item("d", publishedAt = "soon").preachedDate)
    }

    @Test
    fun `the archive is headed by month in the order the server sent it`() {
        val sections = sermonMonthSections(
            listOf(
                item("s1", preachedOn = "2026-09-13"),
                item("s2", preachedOn = "2026-09-06"),
                item("s3", preachedOn = null, publishedAt = "2026-08-30T15:00:00Z"),
                item("s4", preachedOn = "2026-08-23"),
                item("s5", preachedOn = null, publishedAt = "not a date"),
                item("s6", preachedOn = "2025-12-25"),
            ),
        )
        assertEquals(
            listOf(YearMonth.of(2026, 9), YearMonth.of(2026, 8), null, YearMonth.of(2025, 12)),
            sections.map { it.month },
        )
        assertEquals(
            listOf(listOf("s1", "s2"), listOf("s3", "s4"), listOf("s5"), listOf("s6")),
            sections.map { section -> section.items.map { it.sermonId } },
        )
        assertTrue(sermonMonthSections(emptyList()).isEmpty())
    }

    @Test
    fun `a month that appears twice keeps its place and still has a unique key`() {
        // A duplicated key in a lazy list crashes the screen, so this must hold
        // even when two servers disagree about which day a sermon belongs to.
        val sections = sermonMonthSections(
            listOf(
                item("s1", preachedOn = "2026-09-06"),
                item("s2", preachedOn = "2026-08-30"),
                item("s3", preachedOn = "2026-09-01"),
            ),
        )
        assertEquals(3, sections.size)
        assertEquals(sections.size, sections.map { it.key }.toSet().size)
    }
}
