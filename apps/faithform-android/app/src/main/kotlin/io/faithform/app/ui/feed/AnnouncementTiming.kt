package io.faithform.app.ui.feed

import io.faithform.app.contract.FeedItem
import java.time.Duration
import java.time.Instant
import java.time.LocalDate
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.ZoneOffset
import java.time.ZonedDateTime
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import java.time.temporal.ChronoUnit
import java.util.Locale

/** Where an announcement sits in time. Mirrors `AnnouncementMoment` on iOS. */
enum class AnnouncementMoment {
    /** Started, and its end time is still ahead. */
    HAPPENING_NOW,
    TODAY,
    TOMORROW,
    /** Two or more days away. */
    UPCOMING,
    /** Over, or begun on an earlier day with no end time to say otherwise. */
    PAST,
}

/** The feed's groups, in the order they are shown. */
enum class FeedSection { PINNED, TODAY, THIS_WEEK, LATER }

data class FeedSectionGroup(val section: FeedSection, val items: List<FeedItem>)

/** What "Add to Calendar" hands the calendar app. */
data class CalendarSpan(
    val beginMillis: Long,
    val endMillis: Long,
    val allDay: Boolean,
    /** The church's zone for a timed item; UTC for an all-day one. */
    val timeZone: String,
)

/**
 * Wall-clock times are read in the church's zone, as everywhere else in the
 * app. The one exception is the *date* of an all-day item: the dashboard
 * stores it as midnight UTC on the calendar date, so it is read in UTC. Read
 * in New York instead, every all-day event landed on the evening before.
 */
object AnnouncementTiming {

    /**
     * The contract's instants, with a `Z` or a `+00:00` offset.
     *
     * `Instant.parse` only accepts the first before Android 14's java.time,
     * and the server passes Postgres's `+00:00` straight through — so an older
     * phone would have dropped the time from every card.
     */
    fun parseInstant(value: String?): Instant? = value?.let {
        runCatching { OffsetDateTime.parse(it, DateTimeFormatter.ISO_OFFSET_DATE_TIME).toInstant() }.getOrNull()
    }

    fun start(item: FeedItem): Instant? = parseInstant(item.startAt)

    fun end(item: FeedItem): Instant? = parseInstant(item.endAt)

    fun churchZone(item: FeedItem): ZoneId =
        runCatching { ZoneId.of(item.churchTimezone) }.getOrElse { ZoneId.systemDefault() }

    /** The zone an item's calendar date is read in. */
    fun dateZone(item: FeedItem): ZoneId = if (item.allDay) ZoneOffset.UTC else churchZone(item)

    fun date(item: FeedItem): LocalDate? = start(item)?.atZone(dateZone(item))?.toLocalDate()

    /** Whole days from the church's today to the item's date; negative once passed. */
    fun dayOffset(item: FeedItem, now: Instant = Instant.now()): Long? {
        val day = date(item) ?: return null
        val today = now.atZone(churchZone(item)).toLocalDate()
        return ChronoUnit.DAYS.between(today, day)
    }

    fun moment(item: FeedItem, now: Instant = Instant.now()): AnnouncementMoment {
        val end = end(item)
        if (end != null) {
            if (!end.isAfter(now)) return AnnouncementMoment.PAST
            val start = start(item)
            if (start != null && !start.isAfter(now)) return AnnouncementMoment.HAPPENING_NOW
        }
        val offset = dayOffset(item, now) ?: return AnnouncementMoment.UPCOMING
        return when {
            offset == 0L -> AnnouncementMoment.TODAY
            offset == 1L -> AnnouncementMoment.TOMORROW
            offset < 0L -> AnnouncementMoment.PAST
            else -> AnnouncementMoment.UPCOMING
        }
    }

    fun section(item: FeedItem, now: Instant = Instant.now()): FeedSection {
        if (item.isPinned) return FeedSection.PINNED
        return when (moment(item, now)) {
            // The feed keeps something begun yesterday for a day; it belongs
            // with today's items rather than in a group of its own.
            AnnouncementMoment.HAPPENING_NOW, AnnouncementMoment.TODAY, AnnouncementMoment.PAST -> FeedSection.TODAY
            AnnouncementMoment.TOMORROW -> FeedSection.THIS_WEEK
            AnnouncementMoment.UPCOMING ->
                if ((dayOffset(item, now) ?: Long.MAX_VALUE) < 7) FeedSection.THIS_WEEK else FeedSection.LATER
        }
    }

    /** Pinned, today, the rest of the week, later — the server's order inside each. */
    fun sections(items: List<FeedItem>, now: Instant = Instant.now()): List<FeedSectionGroup> {
        val grouped = items.groupBy { section(it, now) }
        return FeedSection.entries.mapNotNull { section ->
            grouped[section]?.takeIf { it.isNotEmpty() }?.let { FeedSectionGroup(section, it) }
        }
    }

    fun calendarSpan(item: FeedItem): CalendarSpan? {
        val start = start(item) ?: return null
        if (item.allDay) {
            // CalendarContract keeps all-day events at midnight UTC on their
            // date — which is exactly how the dashboard stored this one.
            val day = start.atZone(ZoneOffset.UTC).toLocalDate().atStartOfDay(ZoneOffset.UTC).toInstant()
            return CalendarSpan(day.toEpochMilli(), day.plus(1, ChronoUnit.DAYS).toEpochMilli(), true, "UTC")
        }
        val end = end(item)?.takeIf { it.isAfter(start) } ?: start.plus(Duration.ofHours(1))
        return CalendarSpan(start.toEpochMilli(), end.toEpochMilli(), false, churchZone(item).id)
    }
}

/** Text for the card and the detail. The strings that need resources are passed in. */
object AnnouncementFormatting {

    /** The date tile: "SEP" over "20". */
    fun tile(item: FeedItem, locale: Locale = Locale.getDefault()): Pair<String, String>? {
        val date = AnnouncementTiming.start(item)?.atZone(AnnouncementTiming.dateZone(item)) ?: return null
        val month = DateTimeFormatter.ofPattern("MMM", locale).format(date).trimEnd('.').uppercase(locale)
        return month to date.dayOfMonth.toString()
    }

    /** "Sunday · 6:30 – 7:00 AM", "Sunday · All day", or both dates across several days. */
    fun timeLine(item: FeedItem, allDay: String, locale: Locale = Locale.getDefault()): String {
        val start = AnnouncementTiming.start(item) ?: return ""
        val weekday = DateTimeFormatter.ofPattern("EEEE", locale)
            .format(start.atZone(AnnouncementTiming.dateZone(item)))
        if (item.allDay) return "$weekday · $allDay"

        val zone = AnnouncementTiming.churchZone(item)
        val startLocal = start.atZone(zone)
        val end = AnnouncementTiming.end(item)?.takeIf { it.isAfter(start) }?.atZone(zone)
            ?: return "$weekday · ${time(startLocal, locale)}"
        if (startLocal.toLocalDate() == end.toLocalDate()) {
            return "$weekday · ${time(startLocal, locale)} – ${time(end, locale)}"
        }
        return "${dayAndTime(startLocal, locale)} – ${dayAndTime(end, locale)}"
    }

    data class When(val date: String, val time: String?)

    /**
     * The detail's "When": the date, then the time. The church's zone is named
     * only when the phone is somewhere with a different offset.
     */
    fun detailWhen(
        item: FeedItem,
        allDay: String,
        locale: Locale = Locale.getDefault(),
        deviceZone: ZoneId = ZoneId.systemDefault(),
        now: Instant = Instant.now(),
    ): When {
        val start = AnnouncementTiming.start(item) ?: return When("", null)
        val zone = AnnouncementTiming.dateZone(item)
        val sameYear = start.atZone(zone).year == now.atZone(zone).year
        val dateFormat = DateTimeFormatter.ofPattern(if (sameYear) "EEEE, MMMM d" else "EEEE, MMMM d, yyyy", locale)

        if (item.allDay) return When(dateFormat.format(start.atZone(zone)), allDay)

        val startLocal = start.atZone(zone)
        val suffix = if (zone.rules.getOffset(start) == deviceZone.rules.getOffset(start)) {
            ""
        } else {
            " " + DateTimeFormatter.ofPattern("zzz", locale).format(startLocal)
        }
        val end = AnnouncementTiming.end(item)?.takeIf { it.isAfter(start) }?.atZone(zone)
        return when {
            end == null -> When(dateFormat.format(startLocal), time(startLocal, locale) + suffix)
            startLocal.toLocalDate() == end.toLocalDate() ->
                When(dateFormat.format(startLocal), "${time(startLocal, locale)} – ${time(end, locale)}$suffix")
            else -> When("${dayAndTime(startLocal, locale)} – ${dayAndTime(end, locale)}$suffix", null)
        }
    }

    private fun time(value: ZonedDateTime, locale: Locale): String =
        DateTimeFormatter.ofLocalizedTime(FormatStyle.SHORT).withLocale(locale).format(value)

    private fun dayAndTime(value: ZonedDateTime, locale: Locale): String =
        DateTimeFormatter.ofPattern("EEE, MMM d", locale).format(value) + ", " + time(value, locale)
}
