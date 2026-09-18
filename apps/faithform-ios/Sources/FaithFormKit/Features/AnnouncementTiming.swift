import Foundation

/// Where an announcement sits in time, for the church that posted it.
///
/// Wall-clock times are read in the church's zone, as everywhere else in the
/// app. The one exception is the *date* of an all-day item: the dashboard
/// stores it as midnight UTC on the calendar date, so it is read in UTC. Read
/// in New York instead, every all-day event landed on the evening before.
public enum AnnouncementMoment: Equatable, Sendable {
    /// Started, and its end time is still ahead.
    case happeningNow
    case today
    case tomorrow
    /// Two or more days away.
    case upcoming
    /// Over, or begun on an earlier day with no end time to say otherwise.
    case past
}

/// The feed's groups, in the order they are shown.
public enum FeedSection: String, CaseIterable, Sendable {
    case pinned
    case today
    case thisWeek
    case later

    public var title: String {
        switch self {
        case .pinned: return L.pinnedLabel
        case .today: return L.announcementToday
        case .thisWeek: return L.announcementThisWeek
        case .later: return L.announcementComingUp
        }
    }
}

public struct FeedSectionGroup: Identifiable, Equatable, Sendable {
    public let section: FeedSection
    public let items: [FeedItem]
    public var id: FeedSection { section }
}

/// The span a calendar app should be given for an item.
public struct AnnouncementCalendarSpan: Equatable, Sendable {
    public let start: Date
    public let end: Date
    public let isAllDay: Bool
    /// Nil for an all-day item, which floats to whatever zone the phone is in.
    public let timeZone: TimeZone?
}

public enum AnnouncementTiming {
    public static func start(of item: FeedItem) -> Date? {
        FaithFormInstant.parse(item.startAt)
    }

    public static func end(of item: FeedItem) -> Date? {
        item.endAt.flatMap(FaithFormInstant.parse)
    }

    public static func churchZone(of item: FeedItem) -> TimeZone {
        TimeZone(identifier: item.churchTimezone) ?? .current
    }

    /// The zone an item's calendar date is read in.
    public static func dateZone(of item: FeedItem) -> TimeZone {
        item.allDay ? .gmt : churchZone(of: item)
    }

    /// Whole days from the church's today to the item's date. Negative once
    /// that date has passed.
    public static func dayOffset(of item: FeedItem, now: Date = Date()) -> Int? {
        guard let start = start(of: item) else { return nil }

        let itemDay = calendar(in: dateZone(of: item)).dateComponents([.year, .month, .day], from: start)
        let today = calendar(in: churchZone(of: item)).dateComponents([.year, .month, .day], from: now)

        let utc = calendar(in: .gmt)
        guard let from = utc.date(from: today), let to = utc.date(from: itemDay) else { return nil }
        return utc.dateComponents([.day], from: from, to: to).day
    }

    public static func moment(of item: FeedItem, now: Date = Date()) -> AnnouncementMoment {
        if let end = end(of: item) {
            if end <= now { return .past }
            if let start = start(of: item), start <= now { return .happeningNow }
        }
        switch dayOffset(of: item, now: now) {
        case .some(0): return .today
        case .some(1): return .tomorrow
        case let .some(offset) where offset < 0: return .past
        default: return .upcoming
        }
    }

    /// Pinned first, then today, the rest of the week, and later — keeping the
    /// server's order inside each group, which is already soonest first.
    public static func sections(_ items: [FeedItem], now: Date = Date()) -> [FeedSectionGroup] {
        var grouped: [FeedSection: [FeedItem]] = [:]
        for item in items {
            grouped[section(of: item, now: now), default: []].append(item)
        }
        return FeedSection.allCases.compactMap { section in
            guard let members = grouped[section], !members.isEmpty else { return nil }
            return FeedSectionGroup(section: section, items: members)
        }
    }

    public static func section(of item: FeedItem, now: Date = Date()) -> FeedSection {
        if item.isPinned { return .pinned }
        switch moment(of: item, now: now) {
        // The feed keeps something begun yesterday for a day; it belongs with
        // today's items rather than in a group of its own.
        case .happeningNow, .today, .past:
            return .today
        case .tomorrow:
            return .thisWeek
        case .upcoming:
            return (dayOffset(of: item, now: now) ?? .max) < 7 ? .thisWeek : .later
        }
    }

    /// What "Add to Calendar" hands the system: the church's own times for a
    /// timed item, and the bare date for an all-day one.
    public static func calendarSpan(
        for item: FeedItem,
        deviceCalendar: Calendar = .current
    ) -> AnnouncementCalendarSpan? {
        guard let start = start(of: item) else { return nil }

        if item.allDay {
            let day = calendar(in: .gmt).dateComponents([.year, .month, .day], from: start)
            let localDay = deviceCalendar.date(from: day) ?? start
            return AnnouncementCalendarSpan(start: localDay, end: localDay, isAllDay: true, timeZone: nil)
        }

        let end = end(of: item).flatMap { $0 > start ? $0 : nil } ?? start.addingTimeInterval(3600)
        return AnnouncementCalendarSpan(start: start, end: end, isAllDay: false, timeZone: churchZone(of: item))
    }

    static func calendar(in zone: TimeZone) -> Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = zone
        return calendar
    }
}

extension FeedFormatting {
    /// The date tile: "SEP" over "20".
    public static func tile(_ item: FeedItem) -> (month: String, day: String)? {
        guard let start = AnnouncementTiming.start(of: item) else { return nil }
        let zone = AnnouncementTiming.dateZone(of: item)
        return (
            formatter("MMM", zone: zone).string(from: start).uppercased(),
            formatter("d", zone: zone).string(from: start)
        )
    }

    /// The card's line under the title: "Sunday · 6:30 – 7:00 AM",
    /// "Sunday · All day", or both dates for something spanning several days.
    public static func timeLine(_ item: FeedItem) -> String {
        guard let start = AnnouncementTiming.start(of: item) else { return "" }
        let weekday = formatter("EEEE", zone: AnnouncementTiming.dateZone(of: item)).string(from: start)
        if item.allDay {
            return "\(weekday) · \(L.announcementAllDay)"
        }

        let zone = AnnouncementTiming.churchZone(of: item)
        guard let end = AnnouncementTiming.end(of: item), end > start else {
            return "\(weekday) · \(time(start, zone: zone))"
        }
        if AnnouncementTiming.calendar(in: zone).isDate(start, inSameDayAs: end) {
            return "\(weekday) · \(timeRange(start, end, zone: zone))"
        }
        return interval(start, end, template: "EEEMMMdjmm", zone: zone)
    }

    /// The detail screen's "When": the date on one line, the time on the next.
    /// A multi-day item puts its whole range on the first line and has no
    /// second.
    public static func detailWhen(_ item: FeedItem, deviceZone: TimeZone = .current) -> (date: String, time: String?) {
        guard let start = AnnouncementTiming.start(of: item) else { return ("", nil) }
        let dateTemplate = sameYear(start, zone: AnnouncementTiming.dateZone(of: item)) ? "EEEEMMMMd" : "EEEEMMMMdy"

        if item.allDay {
            let date = formatter(dateTemplate, zone: AnnouncementTiming.dateZone(of: item)).string(from: start)
            return (date, L.announcementAllDay)
        }

        let zone = AnnouncementTiming.churchZone(of: item)
        let date = formatter(dateTemplate, zone: zone).string(from: start)
        // Someone travelling sees the church's times; the zone says so. Offsets
        // rather than names, so Detroit and New York are not told apart.
        let suffix = zone.secondsFromGMT(for: start) == deviceZone.secondsFromGMT(for: start)
            ? ""
            : zone.abbreviation(for: start).map { " \($0)" } ?? ""

        guard let end = AnnouncementTiming.end(of: item), end > start else {
            return (date, time(start, zone: zone) + suffix)
        }
        if AnnouncementTiming.calendar(in: zone).isDate(start, inSameDayAs: end) {
            return (date, timeRange(start, end, zone: zone) + suffix)
        }
        return (interval(start, end, template: "EEEMMMdjmm", zone: zone) + suffix, nil)
    }

    /// "Posted 2 days ago", or nil when the server did not say.
    public static func postedLine(_ item: FeedItem, now: Date = Date()) -> String? {
        guard let raw = item.publishedAt, let posted = FaithFormInstant.parse(raw) else { return nil }
        let relative = RelativeDateTimeFormatter()
        relative.unitsStyle = .full
        let when = relative.localizedString(for: min(posted, now), relativeTo: now)
        return String(format: L.announcementPosted, when)
    }

    /// The chip for where an item sits in time, if it earns one.
    public static func momentLabel(_ moment: AnnouncementMoment) -> String? {
        switch moment {
        case .happeningNow: return L.announcementHappeningNow
        case .today: return L.announcementToday
        case .tomorrow: return L.announcementTomorrow
        case .upcoming, .past: return nil
        }
    }

    static func formatter(_ template: String, zone: TimeZone) -> DateFormatter {
        let formatter = DateFormatter()
        formatter.timeZone = zone
        formatter.setLocalizedDateFormatFromTemplate(template)
        return formatter
    }

    private static func time(_ date: Date, zone: TimeZone) -> String {
        let formatter = DateFormatter()
        formatter.timeZone = zone
        formatter.dateStyle = .none
        formatter.timeStyle = .short
        return formatter.string(from: date)
    }

    private static func timeRange(_ start: Date, _ end: Date, zone: TimeZone) -> String {
        let formatter = DateIntervalFormatter()
        formatter.timeZone = zone
        formatter.dateStyle = .none
        formatter.timeStyle = .short
        return formatter.string(from: start, to: end)
    }

    private static func interval(_ start: Date, _ end: Date, template: String, zone: TimeZone) -> String {
        let formatter = DateIntervalFormatter()
        formatter.timeZone = zone
        formatter.dateTemplate = template
        return formatter.string(from: start, to: end)
    }

    private static func sameYear(_ date: Date, zone: TimeZone) -> Bool {
        let calendar = AnnouncementTiming.calendar(in: zone)
        return calendar.component(.year, from: date) == calendar.component(.year, from: Date())
    }
}
