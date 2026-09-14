import Foundation

/// A calendar day, with no time and no zone attached.
///
/// `preachedOn` is "the Sunday it was preached", not a moment. Turning it into
/// a `Date` at UTC midnight and formatting that in the phone's zone moves every
/// sermon back a day for anyone west of Greenwich — so it stays three numbers
/// until the moment it is drawn.
public struct SermonDay: Hashable, Sendable {
    public let year: Int
    public let month: Int
    public let day: Int

    public init(year: Int, month: Int, day: Int) {
        self.year = year
        self.month = month
        self.day = day
    }

    /// Noon UTC on this Gregorian day. Only ever formatted by a formatter that
    /// is itself pinned to UTC, so the zone cancels out and the day is the day.
    var anchor: Date? {
        SermonDates.utcGregorian.date(
            from: DateComponents(year: year, month: month, day: day, hour: 12)
        )
    }
}

/// The dates on the sermon-notes screens: parsing what the server sends, and
/// grouping and drawing it for the reader's locale.
///
/// Pure and allocation-per-call, like `FaithFormInstant`, so nothing here is a
/// shared mutable formatter.
public enum SermonDates {

    // MARK: Parsing

    /// Parses an instant the way the server has actually sent them.
    ///
    /// The contract says RFC 3339 UTC (`2026-09-13T14:03:22.123Z`), but older
    /// servers passed Postgres through unchanged
    /// (`2026-09-13T14:03:22.123456+00:00`): microseconds, and an offset where
    /// the `Z` should be. `ISO8601DateFormatter` accepts one of those shapes or
    /// the other depending on its options and the OS, so this reads them by
    /// hand: any number of fractional digits or none, and `Z`, `±HH:MM`,
    /// `±HHMM` or `±HH`.
    ///
    /// A timestamp with **no** zone is refused rather than assumed to be UTC:
    /// it is not an instant, and a guessed one draws the wrong day.
    public static func instant(_ raw: String) -> Date? {
        var scanner = Scan(raw.trimmingCharacters(in: .whitespaces))

        guard let year = scanner.digits(4), scanner.take("-"),
              let month = scanner.digits(2), scanner.take("-"),
              let day = scanner.digits(2),
              scanner.take("T") || scanner.take("t") || scanner.take(" "),
              let hour = scanner.digits(2), scanner.take(":"),
              let minute = scanner.digits(2), scanner.take(":"),
              let second = scanner.digits(2)
        else { return nil }

        var fraction = 0.0
        if scanner.take(".") || scanner.take(",") {
            guard let digits = scanner.digitRun(), let value = Double("0.\(digits)") else {
                return nil
            }
            fraction = value
        }

        var offsetSeconds = 0
        if scanner.take("Z") || scanner.take("z") {
            offsetSeconds = 0
        } else if let sign = scanner.sign() {
            guard let hours = scanner.digits(2), hours <= 23 else { return nil }
            var minutes = 0
            if scanner.take(":") {
                guard let value = scanner.digits(2) else { return nil }
                minutes = value
            } else if let value = scanner.digits(2) {
                minutes = value
            }
            guard minutes <= 59 else { return nil }
            offsetSeconds = sign * (hours * 3600 + minutes * 60)
        } else {
            return nil
        }

        guard scanner.isAtEnd,
              (0...23).contains(hour), (0...59).contains(minute),
              // 60 is a leap second; it is read as the last second of the minute.
              (0...60).contains(second),
              let base = validDate(year: year, month: month, day: day, hour: hour, minute: minute, second: min(second, 59))
        else { return nil }

        return base.addingTimeInterval(fraction - Double(offsetSeconds))
    }

    /// Parses `preachedOn` into a calendar day, without passing through a zone.
    ///
    /// `YYYY-MM-DD`, optionally followed by a time — whose date part is the
    /// wall date it was written in, so it is taken literally rather than
    /// converted. An impossible day (February 30th) is nil, not March 2nd.
    public static func calendarDay(_ raw: String) -> SermonDay? {
        var scanner = Scan(raw.trimmingCharacters(in: .whitespaces))
        guard let year = scanner.digits(4), scanner.take("-"),
              let month = scanner.digits(2), scanner.take("-"),
              let day = scanner.digits(2),
              scanner.isAtEnd || scanner.peek("T") || scanner.peek("t") || scanner.peek(" "),
              validDate(year: year, month: month, day: day, hour: 12, minute: 0, second: 0) != nil
        else { return nil }
        return SermonDay(year: year, month: month, day: day)
    }

    /// The day a sermon is listed under: the day it was preached, or failing
    /// that the day it was published **in the church's zone** — the same rule
    /// as every other church time in the app, so a Sunday-evening upload does
    /// not read as Monday.
    public static func displayDay(
        preachedOn: String?,
        publishedAt: String,
        churchTimezone: String
    ) -> SermonDay? {
        if let preachedOn, let day = calendarDay(preachedOn) { return day }
        guard let published = instant(publishedAt) else { return nil }
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: churchTimezone) ?? .current
        let parts = calendar.dateComponents([.year, .month, .day], from: published)
        guard let year = parts.year, let month = parts.month, let day = parts.day else { return nil }
        return SermonDay(year: year, month: month, day: day)
    }

    public static func displayDay(for item: SermonListItem) -> SermonDay? {
        displayDay(preachedOn: item.preachedOn, publishedAt: item.publishedAt, churchTimezone: item.churchTimezone)
    }

    public static func displayDay(for detail: SermonDetail) -> SermonDay? {
        displayDay(preachedOn: detail.preachedOn, publishedAt: detail.publishedAt, churchTimezone: detail.churchTimezone)
    }

    // MARK: Formatting

    /// "Sep 13, 2026" / "September 13, 2026", or whatever the reader's locale
    /// and calendar make of that day.
    public static func format(
        _ day: SermonDay,
        style: Date.FormatStyle.DateStyle,
        locale: Locale = .autoupdatingCurrent
    ) -> String {
        guard let anchor = day.anchor else { return "" }
        return anchor.formatted(
            Date.FormatStyle(date: style, time: .omitted, locale: locale, calendar: locale.calendar, timeZone: utc)
        )
    }

    // MARK: Grouping

    /// One month's run of sermons in the history list.
    public struct MonthGroup: Identifiable, Sendable {
        /// Position-based, so a group keeps its identity as later pages append.
        public let id: Int
        /// "September 2026" in the reader's locale; nil for sermons whose date
        /// could not be read, which are listed without a heading.
        public let title: String?
        public let items: [SermonListItem]
    }

    /// Splits the list into consecutive runs by month, **without reordering**.
    ///
    /// The server orders by preached date, and a page appended later can carry
    /// on the last month of the page before, so runs are merged only when they
    /// are adjacent. Months are the reader's calendar's months, not always
    /// Gregorian ones.
    public static func groupedByMonth(
        _ items: [SermonListItem],
        locale: Locale = .autoupdatingCurrent
    ) -> [MonthGroup] {
        var calendar = locale.calendar
        calendar.timeZone = utc
        let titleStyle = Date.FormatStyle(
            locale: locale,
            calendar: calendar,
            timeZone: utc,
            capitalizationContext: .standalone
        )
        .month(.wide)
        .year()

        struct MonthKey: Equatable {
            let era: Int
            let year: Int
            let month: Int
        }

        var groups: [(key: MonthKey?, title: String?, items: [SermonListItem])] = []
        for item in items {
            let anchor = displayDay(for: item)?.anchor
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
            MonthGroup(id: index, title: group.title, items: group.items)
        }
    }

    // MARK: Internals

    static let utc = TimeZone(identifier: "UTC")!

    static var utcGregorian: Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = utc
        return calendar
    }

    /// A UTC date for these fields, or nil when they do not name a real moment.
    /// `Calendar` rolls February 30th over into March; reading the fields back
    /// is what catches it.
    private static func validDate(year: Int, month: Int, day: Int, hour: Int, minute: Int, second: Int) -> Date? {
        let calendar = utcGregorian
        guard (1...12).contains(month), (1...31).contains(day),
              let date = calendar.date(
                  from: DateComponents(year: year, month: month, day: day, hour: hour, minute: minute, second: second)
              )
        else { return nil }
        let back = calendar.dateComponents([.year, .month, .day], from: date)
        guard back.year == year, back.month == month, back.day == day else { return nil }
        return date
    }

    /// A tiny forward-only reader over ASCII.
    private struct Scan {
        private let bytes: [UInt8]
        private var index = 0

        init(_ value: String) { bytes = Array(value.utf8) }

        var isAtEnd: Bool { index == bytes.count }

        func peek(_ character: Character) -> Bool {
            guard index < bytes.count, let ascii = character.asciiValue else { return false }
            return bytes[index] == ascii
        }

        mutating func take(_ character: Character) -> Bool {
            guard peek(character) else { return false }
            index += 1
            return true
        }

        mutating func sign() -> Int? {
            if take("+") { return 1 }
            if take("-") { return -1 }
            return nil
        }

        /// Exactly `count` digits, as a number.
        mutating func digits(_ count: Int) -> Int? {
            guard index + count <= bytes.count else { return nil }
            var value = 0
            for byte in bytes[index..<(index + count)] {
                guard (48...57).contains(byte) else { return nil }
                value = value * 10 + Int(byte - 48)
            }
            index += count
            return value
        }

        /// One or more digits, as written.
        mutating func digitRun() -> String? {
            let start = index
            while index < bytes.count, (48...57).contains(bytes[index]) { index += 1 }
            guard index > start else { return nil }
            return String(decoding: bytes[start..<index], as: UTF8.self)
        }
    }
}
