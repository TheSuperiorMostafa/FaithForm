package io.faithform.app.sermons

import io.faithform.app.contract.PresentationListItem
import io.faithform.app.contract.SermonListItem
import java.time.LocalDate
import java.time.YearMonth

/**
 * One Sunday in the member app: notes, slides, or both.
 *
 * The server publishes those as two archives. The list joins them so a person
 * never has to guess which pane a sermon lives in.
 */
data class SermonHubItem(
    val sermonId: String,
    val title: String,
    val summary: String?,
    val publishedAt: String,
    val preachedOn: String?,
    val scriptureRefs: List<String>,
    val seriesName: String?,
    val churchTimezone: String,
    val notes: SermonListItem?,
    val slides: PresentationListItem?,
) {
    val hasNotes: Boolean get() = notes != null
    val hasSlides: Boolean get() = slides != null
    val preachedDate: LocalDate?
        get() = sermonDate(preachedOn, publishedAt, churchTimezone)
}

data class SermonHubMonthSection(
    val month: YearMonth?,
    val items: List<SermonHubItem>,
) {
    val key: String
        get() = "hub-month|${month ?: "undated"}|${items.first().sermonId}"
}

object SermonHub {
    /**
     * Notes-first, then any deck whose sermon was never published as notes.
     * Newest day first so a slides-only Sunday still sits with that week.
     */
    fun merge(
        notes: List<SermonListItem>,
        slides: List<PresentationListItem>,
    ): List<SermonHubItem> {
        val deckBySermon = LinkedHashMap<String, PresentationListItem>()
        for (deck in slides) {
            deckBySermon.putIfAbsent(deck.sermonId, deck)
        }
        val seen = HashSet<String>()
        val hubs = ArrayList<SermonHubItem>(notes.size + slides.size)
        for (item in notes) {
            seen += item.sermonId
            hubs += SermonHubItem(
                sermonId = item.sermonId,
                title = item.title,
                summary = item.summary,
                publishedAt = item.publishedAt,
                preachedOn = item.preachedOn,
                scriptureRefs = item.scriptureRefs,
                seriesName = item.seriesName,
                churchTimezone = item.churchTimezone,
                notes = item,
                slides = deckBySermon[item.sermonId],
            )
        }
        for (deck in slides) {
            if (!seen.add(deck.sermonId)) continue
            hubs += SermonHubItem(
                sermonId = deck.sermonId,
                title = deck.title,
                summary = null,
                publishedAt = deck.publishedAt,
                preachedOn = null,
                scriptureRefs = deck.scriptureRefs,
                seriesName = deck.seriesName,
                churchTimezone = deck.churchTimezone,
                notes = null,
                slides = deck,
            )
        }
        return hubs.sortedWith(compareByDescending<SermonHubItem> { it.preachedDate }.thenByDescending { it.publishedAt })
    }

    fun monthSections(items: List<SermonHubItem>): List<SermonHubMonthSection> {
        val sections = mutableListOf<SermonHubMonthSection>()
        var month: YearMonth? = null
        var run = mutableListOf<SermonHubItem>()
        for (item in items) {
            val itemMonth = item.preachedDate?.let(YearMonth::from)
            if (run.isNotEmpty() && itemMonth != month) {
                sections += SermonHubMonthSection(month, run)
                run = mutableListOf()
            }
            month = itemMonth
            run += item
        }
        if (run.isNotEmpty()) sections += SermonHubMonthSection(month, run)
        return sections
    }
}
