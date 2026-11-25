package io.faithform.app.ui.schedule

import io.faithform.app.contract.AnnouncementVisibility
import io.faithform.app.contract.FeedItem
import java.time.LocalDate
import java.time.ZoneId
import org.junit.Assert.assertEquals
import org.junit.Test

/** The same rule as `ScheduleOrderingTests` in Swift: a day's list is in date order. */
class ScheduleOrderingTest {

    private fun item(id: String, startAt: String, isPinned: Boolean = false) = FeedItem(
        id = id, title = id, body = "", startAt = startAt, endAt = null, allDay = false,
        location = null, posterUrl = null, posterAltText = null, isPinned = isPinned,
        visibility = AnnouncementVisibility.FOLLOWERS, publicationVersion = 1, publishedAt = null,
        isEvent = true, churchSlug = "grace", churchName = "Grace",
        churchTimezone = "America/New_York",
    )

    @Test
    fun `a day's services and events run earliest first, whatever the pin or offset`() {
        val items = listOf(
            // 15:00Z, though its string sorts before 14:00Z.
            item("late", "2026-10-04T10:00:00-05:00"),
            item("pinned-later", "2026-10-04T18:00:00Z", isPinned = true),
            item("early", "2026-10-04T14:00:00.000Z"),
        )
        val ids = ScheduleCalendar.eventsOn(
            LocalDate.of(2026, 10, 4),
            items,
            ZoneId.of("America/New_York"),
        ).map { it.id }
        assertEquals(listOf("early", "late", "pinned-later"), ids)
    }
}
