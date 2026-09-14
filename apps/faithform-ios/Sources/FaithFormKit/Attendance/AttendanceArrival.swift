import Foundation

/// A church this account may be checked in at automatically.
///
/// The name is kept only so a notification can say where — "Are you at Grace
/// Community?" — after the app was relaunched in the background with no
/// account loaded. It is the church's public name, not anything about the
/// person.
public struct AttendanceChurch: Codable, Hashable, Sendable {
    public let slug: String
    public let name: String?

    public init(slug: String, name: String?) {
        self.slug = slug
        self.name = name
    }
}

/// How a church wants an arrival turned into attendance.
///
/// Taken from the server's `requiresConfirmation`, which is the church's
/// choice rather than this app's.
public enum ArrivalMode: String, Codable, Equatable, Sendable {
    /// Ask the person. A `detected` attempt is sent on arrival so the server's
    /// dwell clock starts then; `confirm` is only ever sent after the person
    /// says yes — a tap on "Are you at …? Tap to check in", or on the in-app
    /// button.
    case confirmation
    /// Check the person in without asking, once they have stayed. Nothing is
    /// sent until the local dwell has passed, because the server counts a
    /// `detected` attempt straight away when no confirmation is required.
    case automatic
}

/// The arrival rules, with no framework in sight.
///
/// Every decision here is a pure function of the server's configuration and a
/// clock, so each one is reachable from a test on a plain macOS runner.
public enum ArrivalPolicy {
    /// The shortest stay this device waits for before checking anyone in
    /// without asking.
    ///
    /// **Why a floor exists at all.** With `requiresConfirmation` off, the
    /// server counts the first `detected` it receives — it enforces no dwell of
    /// its own. A church that also set its dwell to zero would otherwise count
    /// everyone whose car crossed the circle during a service. A minute is well
    /// inside a service and well beyond a drive past.
    public static let minimumAutomaticDwell: TimeInterval = 60

    /// How far ahead an early arrival is still worth holding on to.
    ///
    /// Bounded by the attempt's own lifetime, so nothing waits longer than the
    /// retention rule already allows.
    public static let earlyArrivalHorizon: TimeInterval = pendingAttemptLifetime

    public static func mode(for configuration: GeofenceConfiguration) -> ArrivalMode {
        configuration.requiresConfirmation ? .confirmation : .automatic
    }

    /// How long an automatic arrival waits before anything is submitted.
    public static func automaticDwell(minDwellSeconds: Int) -> TimeInterval {
        max(TimeInterval(max(0, minDwellSeconds)), minimumAutomaticDwell)
    }

    /// The window open at `now`, if the configuration lists one.
    ///
    /// **A display hint, never the occurrence that is submitted.** The server
    /// resolves that from its own clock.
    public static func openWindow(
        in configuration: GeofenceConfiguration,
        now: Date
    ) -> GeofenceWindow? {
        configuration.windows
            .compactMap { window -> (GeofenceWindow, Date, Date)? in
                guard let opens = FaithFormInstant.parse(window.checkinOpensAt),
                      let closes = FaithFormInstant.parse(window.checkinClosesAt)
                else { return nil }
                return (window, opens, closes)
            }
            .filter { $0.1 <= now && now <= $0.2 }
            .sorted { $0.1 < $1.1 }
            .first?.0
    }

    /// The next window that has not opened yet.
    public static func upcomingWindow(
        in configuration: GeofenceConfiguration,
        now: Date
    ) -> (window: GeofenceWindow, opensAt: Date)? {
        configuration.windows
            .compactMap { window -> (GeofenceWindow, Date)? in
                guard let opens = FaithFormInstant.parse(window.checkinOpensAt) else { return nil }
                return (window, opens)
            }
            .filter { $0.1 > now }
            .sorted { $0.1 == $1.1 ? $0.0.occurrenceId < $1.0.occurrenceId : $0.1 < $1.1 }
            .first
            .map { (window: $0.0, opensAt: $0.1) }
    }

    /// For a person who arrived before check-in opened: when they may be
    /// checked in, or nil when no window opens soon enough to wait for.
    ///
    /// The wait is the later of the window opening and the dwell, so arriving
    /// an hour early does not skip the dwell and arriving a minute early does
    /// not skip the window.
    public static func earlyArrival(
        in configuration: GeofenceConfiguration,
        now: Date
    ) -> (window: GeofenceWindow, notBefore: Date, askAt: Date?)? {
        guard let upcoming = upcomingWindow(in: configuration, now: now),
              upcoming.opensAt.timeIntervalSince(now) <= earlyArrivalHorizon
        else { return nil }

        switch mode(for: configuration) {
        case .automatic:
            let dwell = automaticDwell(minDwellSeconds: configuration.minDwellSeconds)
            return (upcoming.window, max(upcoming.opensAt, now.addingTimeInterval(dwell)), nil)
        case .confirmation:
            // `detected` may go as soon as the window opens — it counts
            // nothing, and the server measures the dwell from it. The person is
            // asked once that dwell could have passed, so one tap can finish.
            let ask = upcoming.opensAt.addingTimeInterval(TimeInterval(max(0, configuration.minDwellSeconds)))
            return (upcoming.window, upcoming.opensAt, ask)
        }
    }

    /// The next service to show on the status screen: the open one, else the
    /// next to open. Nil when the configuration lists none.
    public static func nextService(
        in configuration: GeofenceConfiguration,
        now: Date
    ) -> (window: GeofenceWindow, isOpen: Bool)? {
        if let open = openWindow(in: configuration, now: now) { return (open, true) }
        return upcomingWindow(in: configuration, now: now).map { ($0.window, false) }
    }

    /// How urgently a church's regions deserve one of the twenty slots: zero
    /// for a church with check-in open now, otherwise the seconds until its next
    /// window opens, and `.infinity` for a church with nothing scheduled.
    ///
    /// Deterministic in the configuration and the clock — never in where the
    /// person is standing, which would make two phones monitor different sets
    /// and neither reproducible from a bug report.
    public static func priority(
        of configuration: GeofenceConfiguration,
        now: Date
    ) -> TimeInterval {
        if openWindow(in: configuration, now: now) != nil { return 0 }
        guard let upcoming = upcomingWindow(in: configuration, now: now) else { return .infinity }
        return upcoming.opensAt.timeIntervalSince(now)
    }
}
