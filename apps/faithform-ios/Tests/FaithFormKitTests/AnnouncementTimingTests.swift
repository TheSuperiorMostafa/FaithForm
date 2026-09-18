import Foundation
import Testing
@testable import FaithFormKit

@Suite("Announcement timing")
struct AnnouncementTimingTests {

    /// 11:00 on Saturday 19 September 2026 in New York.
    private let now = FaithFormInstant.parse("2026-09-19T15:00:00Z")!

    private func item(
        id: String = "a",
        startAt: String,
        endAt: String? = nil,
        allDay: Bool = false,
        isPinned: Bool = false,
        timezone: String = "America/New_York"
    ) -> FeedItem {
        FeedItem(
            id: id, title: "T", body: "", startAt: startAt, endAt: endAt, allDay: allDay,
            location: nil, posterUrl: nil, posterAltText: nil, isPinned: isPinned,
            visibility: .followers, publicationVersion: 1, publishedAt: nil,
            isEvent: endAt != nil, churchSlug: "grace", churchName: "Grace",
            churchTimezone: timezone
        )
    }

    @Test("an event under way is happening now")
    func happeningNow() {
        let walk = item(startAt: "2026-09-19T14:30:00Z", endAt: "2026-09-19T15:30:00Z")
        #expect(AnnouncementTiming.moment(of: walk, now: now) == .happeningNow)
    }

    @Test("an event that has ended is past, even earlier the same day")
    func endedToday() {
        let breakfast = item(startAt: "2026-09-19T12:00:00Z", endAt: "2026-09-19T13:00:00Z")
        #expect(AnnouncementTiming.moment(of: breakfast, now: now) == .past)
    }

    @Test("today and tomorrow are the church's days, not UTC's")
    func todayAndTomorrow() {
        // 01:00 UTC on the 20th is still the evening of the 19th in New York.
        let evening = item(startAt: "2026-09-20T01:00:00Z")
        #expect(AnnouncementTiming.moment(of: evening, now: now) == .today)

        let sunday = item(startAt: "2026-09-20T14:00:00Z", endAt: "2026-09-20T16:00:00Z")
        #expect(AnnouncementTiming.moment(of: sunday, now: now) == .tomorrow)

        let later = item(startAt: "2026-09-25T14:00:00Z")
        #expect(AnnouncementTiming.moment(of: later, now: now) == .upcoming)
    }

    @Test("an all-day date is read in UTC, where the dashboard stored it")
    func allDayDate() {
        // Midnight UTC on the 20th. Read in New York it would be the 19th.
        let picnic = item(startAt: "2026-09-20T00:00:00Z", allDay: true)
        #expect(AnnouncementTiming.dayOffset(of: picnic, now: now) == 1)
        #expect(AnnouncementTiming.moment(of: picnic, now: now) == .tomorrow)
        #expect(FeedFormatting.tile(picnic)?.day == "20")
        #expect(FeedFormatting.whenLine(picnic).contains("20"))
        #expect(FeedFormatting.whenLine(picnic).contains("Sunday"))
    }

    @Test("sections: pinned, today, this week, later — each in the server's order")
    func sections() {
        let items = [
            item(id: "pinned-later", startAt: "2026-10-30T14:00:00Z", isPinned: true),
            item(id: "now", startAt: "2026-09-19T14:30:00Z", endAt: "2026-09-19T15:30:00Z"),
            item(id: "tonight", startAt: "2026-09-19T23:00:00Z"),
            item(id: "sunday", startAt: "2026-09-20T14:00:00Z"),
            item(id: "friday", startAt: "2026-09-25T22:00:00Z"),
            item(id: "next-month", startAt: "2026-10-04T14:00:00Z"),
        ]

        let groups = AnnouncementTiming.sections(items, now: now)

        #expect(groups.map(\.section) == [.pinned, .today, .thisWeek, .later])
        #expect(groups[0].items.map(\.id) == ["pinned-later"])
        #expect(groups[1].items.map(\.id) == ["now", "tonight"])
        #expect(groups[2].items.map(\.id) == ["sunday", "friday"])
        #expect(groups[3].items.map(\.id) == ["next-month"])
    }

    @Test("empty groups are left out")
    func emptySections() {
        let groups = AnnouncementTiming.sections(
            [item(startAt: "2026-10-04T14:00:00Z")],
            now: now
        )
        #expect(groups.map(\.section) == [.later])
    }

    @Test("a timed item goes to the calendar in the church's zone, an hour long without an end")
    func calendarSpanTimed() throws {
        let service = item(startAt: "2026-09-20T14:00:00Z")
        let span = try #require(AnnouncementTiming.calendarSpan(for: service))
        #expect(span.isAllDay == false)
        #expect(span.start == FaithFormInstant.parse("2026-09-20T14:00:00Z"))
        #expect(span.end == FaithFormInstant.parse("2026-09-20T15:00:00Z"))
        #expect(span.timeZone?.identifier == "America/New_York")
    }

    @Test("an all-day item goes to the calendar on its date, wherever the phone is")
    func calendarSpanAllDay() throws {
        var losAngeles = Calendar(identifier: .gregorian)
        losAngeles.timeZone = TimeZone(identifier: "America/Los_Angeles")!

        let picnic = item(startAt: "2026-09-20T00:00:00Z", allDay: true)
        let span = try #require(AnnouncementTiming.calendarSpan(for: picnic, deviceCalendar: losAngeles))

        #expect(span.isAllDay)
        #expect(span.timeZone == nil)
        #expect(losAngeles.component(.day, from: span.start) == 20)
    }

    @Test("the detail names the zone only when the phone is somewhere else")
    func zoneSuffix() {
        let service = item(startAt: "2026-09-20T14:00:00Z", endAt: "2026-09-20T15:00:00Z")

        let home = FeedFormatting.detailWhen(service, deviceZone: TimeZone(identifier: "America/Detroit")!)
        #expect(home.time?.contains("EDT") == false)

        let away = FeedFormatting.detailWhen(service, deviceZone: TimeZone(identifier: "America/Los_Angeles")!)
        #expect(away.time?.contains("EDT") == true)
        #expect(away.time?.contains("10:00") == true)
    }

    @Test("the card's time line leads with the weekday")
    func timeLine() {
        let service = item(startAt: "2026-09-20T14:00:00Z", endAt: "2026-09-20T15:30:00Z")
        let line = FeedFormatting.timeLine(service)
        #expect(line.hasPrefix("Sunday"))
        #expect(line.contains("10:00"))
        #expect(line.contains("11:30"))
    }
}
