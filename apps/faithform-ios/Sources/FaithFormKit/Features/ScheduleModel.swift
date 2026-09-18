import Foundation
import Observation

/// The Home Schedule pane's state.
public enum SchedulePhase: Equatable, Sendable {
    case loading
    case loaded(items: [FeedItem], isStale: Bool)
    case empty
    case offlineNoCache
    case blocked
    case failed(String)
}

@Observable
@MainActor
public final class ScheduleModel {
    public private(set) var phase: SchedulePhase = .loading
    public private(set) var isRefreshing = false
    public private(set) var displayedMonth: Date = Date()
    public private(set) var churchTimezone: String = "America/New_York"

    private let api: APIClient
    private let cache: PartitionedCache
    private var etag: String?
    private var partition: CachePartition?
    private var churchSlug: String = ""

    public init(api: APIClient, cache: PartitionedCache) {
        self.api = api
        self.cache = cache
    }

    public func load(
        churchSlug: String,
        churchTimezone: String,
        partition: CachePartition
    ) async {
        self.churchSlug = churchSlug
        if !churchTimezone.isEmpty {
            self.churchTimezone = churchTimezone
        }
        self.partition = partition
        await loadMonth(displayedMonth)
    }

    public func refresh(churchSlug: String) async {
        self.churchSlug = churchSlug
        await loadMonth(displayedMonth)
    }

    public func showMonth(_ month: Date) async {
        displayedMonth = month
        await loadMonth(month)
    }

    public func showPreviousMonth() async {
        guard let previous = ScheduleCalendar.shiftMonth(displayedMonth, by: -1, timezone: churchTimezone) else { return }
        await showMonth(previous)
    }

    public func showNextMonth() async {
        guard let next = ScheduleCalendar.shiftMonth(displayedMonth, by: 1, timezone: churchTimezone) else { return }
        await showMonth(next)
    }

    private func loadMonth(_ month: Date) async {
        guard let partition else { return }
        let window = ScheduleCalendar.monthWindow(month, timezone: churchTimezone)
        let cacheName = "schedule|\(window.from)|\(window.to)"

        if let cached = await cache.load([FeedItem].self, name: cacheName, partition: partition) {
            phase = cached.value.isEmpty
                ? .empty
                : .loaded(items: cached.value, isStale: false)
            etag = cached.etag
        } else {
            phase = .loading
        }

        isRefreshing = true
        defer { isRefreshing = false }

        do {
            let response = try await api.send(
                "api/mobile/v1/schedule/\(churchSlug)",
                query: ["from": window.from, "to": window.to],
                ifNoneMatch: etag,
                as: SchedulePage.self
            )

            if response.notModified {
                if case let .loaded(items, _) = phase {
                    phase = .loaded(items: items, isStale: false)
                } else if let cached = await cache.load([FeedItem].self, name: cacheName, partition: partition) {
                    phase = cached.value.isEmpty ? .empty : .loaded(items: cached.value, isStale: false)
                }
                return
            }

            guard let page = response.value else { return }
            etag = response.etag
            if let timezone = page.items.first?.churchTimezone, !timezone.isEmpty {
                churchTimezone = timezone
            }

            try? await cache.store(
                CacheEntry(value: page.items, etag: response.etag, storedAt: Date()),
                name: cacheName,
                partition: partition
            )

            phase = page.items.isEmpty ? .empty : .loaded(items: page.items, isStale: false)
        } catch let error as APIError {
            if error.isCancellation { return }
            switch error.code {
            case .blocked:
                await cache.purge(partition: partition)
                phase = .blocked
            case .unavailable:
                if case let .loaded(items, _) = phase {
                    phase = .loaded(items: items, isStale: true)
                    return
                }
                phase = .offlineNoCache
            default:
                if case .loaded = phase { return }
                phase = .failed(error.displayMessage)
            }
        } catch {
            if error.isCancellation { return }
            if case let .loaded(items, _) = phase {
                phase = .loaded(items: items, isStale: true)
                return
            }
            phase = .offlineNoCache
        }
    }
}

/// Month boundaries and day matching in the church's timezone.
public enum ScheduleCalendar {
    public struct Window: Sendable {
        public let from: String
        public let to: String
    }

    public static func monthWindow(_ month: Date, timezone: String) -> Window {
        let zone = TimeZone(identifier: timezone) ?? .current
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = zone

        let components = calendar.dateComponents([.year, .month], from: month)
        let start = calendar.date(from: components) ?? month
        let end = calendar.date(byAdding: .month, value: 1, to: start) ?? start

        return Window(
            from: FaithFormInstant.format(start),
            to: FaithFormInstant.format(end)
        )
    }

    public static func shiftMonth(_ month: Date, by delta: Int, timezone: String) -> Date? {
        let zone = TimeZone(identifier: timezone) ?? .current
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = zone
        return calendar.date(byAdding: .month, value: delta, to: month)
    }

    public static func monthTitle(_ month: Date, timezone: String) -> String {
        let zone = TimeZone(identifier: timezone) ?? .current
        let formatter = DateFormatter()
        formatter.timeZone = zone
        formatter.dateFormat = "MMMM yyyy"
        return formatter.string(from: month)
    }

    public static func daysInMonth(_ month: Date, timezone: String) -> [Date] {
        let zone = TimeZone(identifier: timezone) ?? .current
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = zone

        let components = calendar.dateComponents([.year, .month], from: month)
        guard let start = calendar.date(from: components),
              let range = calendar.range(of: .day, in: .month, for: start) else { return [] }

        return range.compactMap { day in
            calendar.date(byAdding: .day, value: day - 1, to: start)
        }
    }

    public static func weekdayHeaders(timezone: String) -> [String] {
        let zone = TimeZone(identifier: timezone) ?? .current
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = zone
        calendar.locale = Locale.current

        let formatter = DateFormatter()
        formatter.timeZone = zone
        formatter.locale = calendar.locale

        return formatter.shortWeekdaySymbols
    }

    public static func leadingBlankDays(_ month: Date, timezone: String) -> Int {
        let zone = TimeZone(identifier: timezone) ?? .current
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = zone
        calendar.firstWeekday = calendar.firstWeekday

        let components = calendar.dateComponents([.year, .month], from: month)
        guard let start = calendar.date(from: components) else { return 0 }
        let weekday = calendar.component(.weekday, from: start)
        return (weekday - calendar.firstWeekday + 7) % 7
    }

    public static func isSameDay(_ lhs: Date, _ rhs: Date, timezone: String) -> Bool {
        let zone = TimeZone(identifier: timezone) ?? .current
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = zone
        return calendar.isDate(lhs, inSameDayAs: rhs)
    }

    public static func dayNumber(_ date: Date, timezone: String) -> String {
        let zone = TimeZone(identifier: timezone) ?? .current
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = zone
        return String(calendar.component(.day, from: date))
    }

    /// Whether an event should appear on a calendar day in the church's zone.
    public static func event(_ item: FeedItem, overlaps day: Date) -> Bool {
        let zone = TimeZone(identifier: item.churchTimezone) ?? .current
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = zone

        guard let start = FaithFormInstant.parse(item.startAt) else { return false }
        let dayStart = calendar.startOfDay(for: day)
        guard let dayEnd = calendar.date(byAdding: .day, value: 1, to: dayStart) else { return false }

        let end: Date
        if let endRaw = item.endAt, let parsed = FaithFormInstant.parse(endRaw) {
            end = parsed
        } else if item.allDay {
            end = calendar.date(byAdding: .day, value: 2, to: start) ?? start
        } else {
            end = calendar.date(byAdding: .day, value: 1, to: start) ?? start
        }

        return start < dayEnd && end > dayStart
    }

    public static func events(on day: Date, in items: [FeedItem]) -> [FeedItem] {
        items.filter { event($0, overlaps: day) }
            .sorted { lhs, rhs in
                if lhs.isPinned != rhs.isPinned { return lhs.isPinned && !rhs.isPinned }
                return lhs.startAt < rhs.startAt
            }
    }

    public static func daysWithEvents(_ items: [FeedItem], timezone: String) -> Set<Date> {
        let zone = TimeZone(identifier: timezone) ?? .current
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = zone

        var days = Set<Date>()
        for item in items {
            guard let start = FaithFormInstant.parse(item.startAt) else { continue }
            let end: Date
            if let endRaw = item.endAt, let parsed = FaithFormInstant.parse(endRaw) {
                end = parsed
            } else if item.allDay {
                end = calendar.date(byAdding: .day, value: 2, to: start) ?? start
            } else {
                end = calendar.date(byAdding: .day, value: 1, to: start) ?? start
            }

            var cursor = calendar.startOfDay(for: start)
            let last = calendar.startOfDay(for: end)
            while cursor <= last {
                days.insert(cursor)
                guard let next = calendar.date(byAdding: .day, value: 1, to: cursor) else { break }
                cursor = next
            }
        }
        return days
    }
}
