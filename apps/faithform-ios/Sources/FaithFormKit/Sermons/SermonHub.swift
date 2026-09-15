import Foundation

/// One Sunday in the member app: notes, slides, or both.
///
/// The server publishes those as two archives. The list joins them so a person
/// never has to guess which pane a sermon lives in.
public struct SermonHubItem: Hashable, Identifiable, Sendable {
    public var id: String { sermonId }
    public let sermonId: String
    public let title: String
    public let summary: String?
    public let publishedAt: String
    public let preachedOn: String?
    public let scriptureRefs: [String]
    public let seriesName: String?
    public let churchTimezone: String
    public let notes: SermonListItem?
    public let slides: PresentationListItem?

    public var hasNotes: Bool { notes != nil }
    public var hasSlides: Bool { slides != nil }
}

public struct SermonHubMonthGroup: Identifiable, Sendable {
    public let id: Int
    public let title: String?
    public let items: [SermonHubItem]
}

public enum SermonHub {
    /// Notes-first, then any deck whose sermon was never published as notes.
    /// Newest day first so a slides-only Sunday still sits with that week.
    public static func merge(
        notes: [SermonListItem],
        slides: [PresentationListItem]
    ) -> [SermonHubItem] {
        let deckBySermon = Dictionary(
            slides.map { ($0.sermonId, $0) },
            uniquingKeysWith: { first, _ in first }
        )
        var seen: Set<String> = []
        var hubs: [SermonHubItem] = []
        hubs.reserveCapacity(notes.count + slides.count)

        for item in notes {
            seen.insert(item.sermonId)
            hubs.append(
                SermonHubItem(
                    sermonId: item.sermonId,
                    title: item.title,
                    summary: item.summary,
                    publishedAt: item.publishedAt,
                    preachedOn: item.preachedOn,
                    scriptureRefs: item.scriptureRefs,
                    seriesName: item.seriesName,
                    churchTimezone: item.churchTimezone,
                    notes: item,
                    slides: deckBySermon[item.sermonId]
                )
            )
        }

        for deck in slides where !seen.contains(deck.sermonId) {
            seen.insert(deck.sermonId)
            hubs.append(
                SermonHubItem(
                    sermonId: deck.sermonId,
                    title: deck.title,
                    summary: nil,
                    publishedAt: deck.publishedAt,
                    preachedOn: nil,
                    scriptureRefs: deck.scriptureRefs,
                    seriesName: deck.seriesName,
                    churchTimezone: deck.churchTimezone,
                    notes: nil,
                    slides: deck
                )
            )
        }

        return hubs.sorted(by: newerFirst)
    }

    /// Consecutive month runs, matching `SermonDates.groupedByMonth`.
    public static func groupedByMonth(
        _ items: [SermonHubItem],
        locale: Locale = .autoupdatingCurrent
    ) -> [SermonHubMonthGroup] {
        var calendar = locale.calendar
        calendar.timeZone = SermonDates.utc
        let titleStyle = Date.FormatStyle(
            locale: locale,
            calendar: calendar,
            timeZone: SermonDates.utc,
            capitalizationContext: .standalone
        )
        .month(.wide)
        .year()

        struct MonthKey: Equatable {
            let era: Int
            let year: Int
            let month: Int
        }

        var groups: [(key: MonthKey?, title: String?, items: [SermonHubItem])] = []
        for item in items {
            let anchor = SermonDates.displayDay(
                preachedOn: item.preachedOn,
                publishedAt: item.publishedAt,
                churchTimezone: item.churchTimezone
            )?.anchor
            let key = anchor.map { date -> MonthKey in
                let parts = calendar.dateComponents([.era, .year, .month], from: date)
                return MonthKey(era: parts.era ?? 0, year: parts.year ?? 0, month: parts.month ?? 0)
            }
            if let last = groups.indices.last, groups[last].key == key {
                groups[last].items.append(item)
            } else {
                groups.append((key, anchor?.formatted(titleStyle), [item]))
            }
        }
        return groups.enumerated().map { index, group in
            SermonHubMonthGroup(id: index, title: group.title, items: group.items)
        }
    }

    private static func newerFirst(_ lhs: SermonHubItem, _ rhs: SermonHubItem) -> Bool {
        let left = SermonDates.displayDay(
            preachedOn: lhs.preachedOn,
            publishedAt: lhs.publishedAt,
            churchTimezone: lhs.churchTimezone
        )
        let right = SermonDates.displayDay(
            preachedOn: rhs.preachedOn,
            publishedAt: rhs.publishedAt,
            churchTimezone: rhs.churchTimezone
        )
        switch (left, right) {
        case let (l?, r?) where l != r:
            return l > r
        default:
            return lhs.publishedAt > rhs.publishedAt
        }
    }
}

extension SermonDay: Comparable {
    public static func < (lhs: SermonDay, rhs: SermonDay) -> Bool {
        (lhs.year, lhs.month, lhs.day) < (rhs.year, rhs.month, rhs.day)
    }
}
