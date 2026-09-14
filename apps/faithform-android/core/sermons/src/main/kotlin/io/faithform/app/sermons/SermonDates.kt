package io.faithform.app.sermons

import io.faithform.app.contract.SermonDetail
import io.faithform.app.contract.SermonListItem
import java.time.DateTimeException
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.OffsetDateTime
import java.time.YearMonth
import java.time.ZoneId
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter

/**
 * Which day a sermon belongs to, and which month it is filed under.
 *
 * The archive is ordered newest first by the day a sermon was *preached*: the
 * church's recorded `preachedOn` when there is one, otherwise the day it was
 * published. The screens show that same day, so the order a person sees and
 * the dates they read never disagree. Formatting for a locale happens in `:app`;
 * everything here is locale-free and tested on the JVM.
 */

/**
 * A `preachedOn` calendar date — `YYYY-MM-DD`, no time and no zone — or null.
 *
 * Parsed as a plain [LocalDate] on purpose: shifting a calendar date through a
 * timezone is how "Sunday" becomes "Saturday" for someone west of the church.
 */
fun parsePreachedOn(value: String?): LocalDate? {
    val text = value?.trim()?.takeIf { it.isNotEmpty() } ?: return null
    return try {
        LocalDate.parse(text)
    } catch (_: DateTimeException) {
        null
    }
}

/**
 * A `publishedAt` timestamp, read tolerantly.
 *
 * The contract says RFC 3339 in UTC (`2026-09-13T14:03:22.123Z`), but servers
 * already in the field send `2026-09-13T14:03:22.123456+00:00` — microseconds,
 * and an offset instead of `Z` — sometimes without a fraction, and a database
 * rendering can use a space for the `T` or a bare `+00` offset. All of those
 * name the same instant. A timestamp with no offset at all is read as UTC,
 * which is what the server stores. Anything else is null rather than a crash.
 */
fun parsePublishedAt(value: String?): OffsetDateTime? {
    val text = value?.trim()?.takeIf { it.isNotEmpty() } ?: return null
    parseOffset(text)?.let { return it }

    // `2026-09-13 14:03:22.123456+00` → `2026-09-13T14:03:22.123456+00:00`
    val normalized = text
        .replaceFirst(' ', 'T')
        .replace(Regex("([+-]\\d{2})(\\d{2})$"), "$1:$2")
        .replace(Regex("([+-]\\d{2})$"), "$1:00")
    parseOffset(normalized)?.let { return it }

    return try {
        LocalDateTime.parse(normalized, DateTimeFormatter.ISO_LOCAL_DATE_TIME).atOffset(ZoneOffset.UTC)
    } catch (_: DateTimeException) {
        null
    }
}

private fun parseOffset(text: String): OffsetDateTime? =
    try {
        OffsetDateTime.parse(text, DateTimeFormatter.ISO_OFFSET_DATE_TIME)
    } catch (_: DateTimeException) {
        null
    }

/**
 * The day a sermon is dated by: [preachedOn] when it parses, otherwise the day
 * [publishedAt] fell on in the church's own timezone (UTC when the zone is not
 * one this device knows). Null only when neither can be read.
 */
fun sermonDate(preachedOn: String?, publishedAt: String?, churchTimezone: String?): LocalDate? {
    parsePreachedOn(preachedOn)?.let { return it }
    val published = parsePublishedAt(publishedAt) ?: return null
    val zone = churchTimezone?.let {
        try {
            ZoneId.of(it)
        } catch (_: DateTimeException) {
            null
        }
    } ?: ZoneOffset.UTC
    return published.atZoneSameInstant(zone).toLocalDate()
}

val SermonListItem.preachedDate: LocalDate?
    get() = sermonDate(preachedOn, publishedAt, churchTimezone)

val SermonDetail.preachedDate: LocalDate?
    get() = sermonDate(preachedOn, publishedAt, churchTimezone)

/**
 * One month's run of sermons in the archive. [month] is null for a run whose
 * sermons carry no readable date at all.
 */
data class SermonMonthSection(
    val month: YearMonth?,
    val items: List<SermonListItem>,
) {
    /**
     * Stable and unique within one list even if a month were ever to appear
     * twice (a page boundary, or two servers disagreeing about a day), because
     * a duplicated key in a lazy list is a crash rather than a cosmetic bug.
     */
    val key: String
        get() = "month|${month ?: "undated"}|${items.first().sermonId}"
}

/**
 * The archive split into month headings, **in the order the server sent it**.
 *
 * Consecutive runs, not a global group-by: the server owns the order, pages are
 * appended as they arrive, and regrouping would move a sermon away from where
 * the server put it. An empty list has no sections.
 */
fun sermonMonthSections(items: List<SermonListItem>): List<SermonMonthSection> {
    val sections = mutableListOf<SermonMonthSection>()
    var month: YearMonth? = null
    var run = mutableListOf<SermonListItem>()
    for (item in items) {
        val itemMonth = item.preachedDate?.let(YearMonth::from)
        if (run.isNotEmpty() && itemMonth != month) {
            sections += SermonMonthSection(month, run)
            run = mutableListOf()
        }
        month = itemMonth
        run += item
    }
    if (run.isNotEmpty()) sections += SermonMonthSection(month, run)
    return sections
}
