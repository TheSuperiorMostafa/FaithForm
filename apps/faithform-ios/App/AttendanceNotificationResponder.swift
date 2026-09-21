import Foundation
import UserNotifications
import UIKit
import FaithFormKit

/// Where a tap on an automatic check-in notification lands.
///
/// Translates one response into one intent and hands it to the service —
/// nothing here decides whether anyone is checked in. The attempt a "Check in"
/// acts on is read back from the Keychain, so a notification is not a way in:
/// one that names a church with no arrival waiting does nothing.
///
/// Set as `UNUserNotificationCenter`'s delegate while the app launches, because
/// "Check in" runs without opening the app and may be what launched it.
final class AttendanceNotificationResponder: NSObject, UNUserNotificationCenterDelegate, @unchecked Sendable {
    private let service: AutomaticAttendanceService

    init(service: AutomaticAttendanceService) {
        self.service = service
    }

    /// The question and the answer are shown even while FaithForm is open —
    /// someone on another tab still needs to be asked.
    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification
    ) async -> UNNotificationPresentationOptions {
        if AttendanceNotificationContent.isAttendanceIdentifier(notification.request.identifier) {
            return [.banner, .list, .sound]
        }
        // A push from the server — an announcement, a service going live, a
        // message. Shown while the app is open too: the person is looking at
        // one church's feed, and this may be another church entirely.
        return notification.request.content.userInfo["faithform"] != nil
            ? [.banner, .list, .sound]
            : []
    }

    /// Returns only once the work is done: the system keeps the app running
    /// until then, which is the execution time a background "Check in" needs
    /// for one fix and one request.
    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse
    ) async {
        let content = response.notification.request.content
        guard let action = AttendanceNotificationContent.action(
            actionIdentifier: response.actionIdentifier,
            categoryIdentifier: content.categoryIdentifier,
            userInfo: content.userInfo
        ) else {
            // Not a check-in question, so it is a push carrying a deep link —
            // and a link is all it carries. It goes through the same
            // fail-closed router as a tapped `faithform://` URL, which decides
            // whether this account may open it; the payload authorizes nothing.
            // The URL is read here and only the URL crosses to the main actor:
            // the payload itself is `[AnyHashable: Any]`, which is not Sendable.
            if let url = Self.deepLink(in: content.userInfo) {
                await Self.open(url)
            }
            return
        }

        await service.handleNotification(action)

        switch action {
        case let .checkIn(slug, opensApp) where opensApp:
            await Self.openCheckIn(churchSlug: slug)
        case let .open(slug):
            await Self.openCheckIn(churchSlug: slug)
        default:
            break
        }
    }

    /// The `faithform://` link a push carried, if it carried one.
    private static func deepLink(in userInfo: [AnyHashable: Any]) -> URL? {
        guard
            let payload = userInfo["faithform"] as? [String: Any],
            let link = payload["deepLink"] as? String
        else { return nil }
        return URL(string: link)
    }

    @MainActor
    private static func open(_ url: URL) {
        NotificationCenter.default.post(name: .faithformDeepLink, object: nil, userInfo: ["url": url])
    }

    /// The Check in tab for that church, through the same fail-closed router as
    /// every other link.
    @MainActor
    private static func openCheckIn(churchSlug: String) {
        guard let url = URL(string: "faithform://church/\(churchSlug)/check-in") else { return }
        NotificationCenter.default.post(name: .faithformDeepLink, object: nil, userInfo: ["url": url])
    }
}

/// Keep an arrival's short network operation alive if the phone locks during
/// it. iOS owns the deadline; persisted attempts recover if time expires.
@MainActor
final class AttendanceExecutionLease {
    private var identifier: UIBackgroundTaskIdentifier = .invalid

    init() {
        identifier = UIApplication.shared.beginBackgroundTask(withName: "Attendance check-in") { [weak self] in
            self?.end()
        }
    }

    func end() {
        guard identifier != .invalid else { return }
        UIApplication.shared.endBackgroundTask(identifier)
        identifier = .invalid
    }
}
