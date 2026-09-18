package io.faithform.app.ui.schedule

import io.faithform.app.contract.FeedItem
import io.faithform.app.contract.MobileErrorCode
import io.faithform.app.contract.SchedulePage
import io.faithform.app.network.ApiClient
import io.faithform.app.network.ApiException
import io.faithform.app.network.MobileSuccess
import io.faithform.app.network.ProjectionCache
import io.faithform.app.storage.CachePartition
import io.faithform.app.storage.Freshness
import java.time.Instant
import java.time.YearMonth
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import kotlin.coroutines.cancellation.CancellationException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.serialization.builtins.ListSerializer

/** Mirrors iOS `SchedulePhase`. */
sealed interface SchedulePhase {
    data object Loading : SchedulePhase
    data class Loaded(val items: List<FeedItem>, val isStale: Boolean) : SchedulePhase
    data object Empty : SchedulePhase
    data object OfflineNoCache : SchedulePhase
    data object Blocked : SchedulePhase
    data class Failed(val message: String) : SchedulePhase
}

/**
 * The Home Schedule calendar for one church.
 *
 * Loads every published event overlapping the visible month window, cached and
 * revalidated the same way as [io.faithform.app.ui.feed.FeedModel].
 */
class ScheduleModel(
    private val api: ApiClient,
    private val cache: ProjectionCache,
    private val churchSlug: String,
    private val partition: CachePartition,
    private val clock: () -> Long = System::currentTimeMillis,
) {
    private val _phase = MutableStateFlow<SchedulePhase>(SchedulePhase.Loading)
    val phase: StateFlow<SchedulePhase> = _phase.asStateFlow()

    private val _displayedMonth = MutableStateFlow(YearMonth.now())
    val displayedMonth: StateFlow<YearMonth> = _displayedMonth.asStateFlow()

    private val _churchTimezone = MutableStateFlow(DEFAULT_TIMEZONE)
    val churchTimezone: StateFlow<String> = _churchTimezone.asStateFlow()

    private var etag: String? = null
    private val itemsSerializer = ListSerializer(FeedItem.serializer())

    suspend fun load() {
        loadMonth(_displayedMonth.value)
    }

    suspend fun refresh() {
        loadMonth(_displayedMonth.value)
    }

    suspend fun showMonth(month: YearMonth) {
        _displayedMonth.value = month
        loadMonth(month)
    }

    suspend fun showPreviousMonth() {
        showMonth(_displayedMonth.value.minusMonths(1))
    }

    suspend fun showNextMonth() {
        showMonth(_displayedMonth.value.plusMonths(1))
    }

    private suspend fun loadMonth(month: YearMonth) {
        val zone = runCatching { ZoneId.of(_churchTimezone.value) }.getOrElse { ZoneId.of(DEFAULT_TIMEZONE) }
        val window = ScheduleCalendar.monthWindow(month, zone)
        val cacheName = "schedule|${window.from}|${window.to}"

        cache.load(cacheName, partition, itemsSerializer)?.let { cached ->
            etag = cached.etag
            _phase.value = if (cached.value.isEmpty()) {
                SchedulePhase.Empty
            } else {
                SchedulePhase.Loaded(cached.value, isStale = false)
            }
        } ?: run {
            _phase.value = SchedulePhase.Loading
        }

        try {
            val response = api.send(
                path = "api/mobile/v1/schedule/$churchSlug",
                serializer = MobileSuccess.serializer(SchedulePage.serializer()),
                query = mapOf("from" to window.from, "to" to window.to),
                ifNoneMatch = etag,
            )

            if (response.notModified) {
                (_phase.value as? SchedulePhase.Loaded)?.let {
                    _phase.value = it.copy(isStale = false)
                    return
                }
                cache.load(cacheName, partition, itemsSerializer)?.let { cached ->
                    _phase.value = if (cached.value.isEmpty()) SchedulePhase.Empty else SchedulePhase.Loaded(cached.value, isStale = false)
                }
                return
            }

            val page = response.value ?: return
            etag = response.etag
            page.items.firstOrNull()?.churchTimezone?.takeIf { it.isNotBlank() }?.let {
                _churchTimezone.value = it
            }

            cache.store(cacheName, partition, itemsSerializer, page.items, response.etag)
            _phase.value = if (page.items.isEmpty()) {
                SchedulePhase.Empty
            } else {
                SchedulePhase.Loaded(page.items, isStale = false)
            }
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (error: ApiException) {
            when {
                error.code == MobileErrorCode.BLOCKED -> {
                    cache.purge(partition)
                    _phase.value = SchedulePhase.Blocked
                }
                _phase.value is SchedulePhase.Loaded -> Unit
                error.code == MobileErrorCode.UNAVAILABLE || error.retryable ->
                    _phase.value = SchedulePhase.OfflineNoCache
                else -> _phase.value = SchedulePhase.Failed(error.displayMessage)
            }
        } catch (_: Exception) {
            if (_phase.value !is SchedulePhase.Loaded) {
                _phase.value = SchedulePhase.OfflineNoCache
            }
        }
    }

    private companion object {
        const val DEFAULT_TIMEZONE = "America/New_York"
        const val TTL_MILLIS = 300_000L
    }
}

object ScheduleCalendar {
    data class Window(val from: String, val to: String)

    private val instantFormatter = DateTimeFormatter.ISO_INSTANT

    fun monthWindow(month: YearMonth, zone: ZoneId): Window {
        val start = month.atDay(1).atStartOfDay(zone).toInstant()
        val end = month.plusMonths(1).atDay(1).atStartOfDay(zone).toInstant()
        return Window(from = instantFormatter.format(start), to = instantFormatter.format(end))
    }

    fun monthTitle(month: YearMonth): String =
        month.atDay(1).format(DateTimeFormatter.ofPattern("MMMM yyyy"))

    fun eventOverlaps(item: FeedItem, day: java.time.LocalDate, zone: ZoneId): Boolean {
        val start = runCatching { Instant.parse(item.startAt).atZone(zone) }.getOrNull() ?: return false
        val dayStart = day.atStartOfDay(zone)
        val dayEnd = day.plusDays(1).atStartOfDay(zone)

        val end = item.endAt?.let { runCatching { Instant.parse(it).atZone(zone) }.getOrNull() }
            ?: if (item.allDay) {
                start.plusDays(2)
            } else {
                start.plusDays(1)
            }

        return start.isBefore(dayEnd) && end.isAfter(dayStart)
    }

    fun eventsOn(day: java.time.LocalDate, items: List<FeedItem>, zone: ZoneId): List<FeedItem> =
        items.filter { eventOverlaps(it, day, zone) }
            .sortedWith(compareByDescending<FeedItem> { it.isPinned }.thenBy { it.startAt })

    fun daysWithEvents(items: List<FeedItem>, zone: ZoneId): Set<java.time.LocalDate> {
        val days = mutableSetOf<java.time.LocalDate>()
        for (item in items) {
            val start = runCatching { Instant.parse(item.startAt).atZone(zone) }.getOrNull() ?: continue
            val end = item.endAt?.let { runCatching { Instant.parse(it).atZone(zone) }.getOrNull() }
                ?: if (item.allDay) start.plusDays(2) else start.plusDays(1)
            var cursor = start.toLocalDate()
            val last = end.toLocalDate()
            while (!cursor.isAfter(last)) {
                days.add(cursor)
                cursor = cursor.plusDays(1)
            }
        }
        return days
    }
}
