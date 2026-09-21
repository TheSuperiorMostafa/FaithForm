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
    private let handleAttendance: @Sendable (AttendanceNotificationAction) async -> Void
    private let openURL: @MainActor @Sendable (URL) -> Void

    convenience init(service: AutomaticAttendanceService) {
        self.init(handleAttendance: { await service.handleNotification($0) }, openURL: Self.open)
    }

    init(
        handleAttendance: @escaping @Sendable (AttendanceNotificationAction) async -> Void,
        openURL: @escaping @MainActor @Sendable (URL) -> Void
    ) {
        self.handleAttendance = handleAttendance
        self.openURL = openURL
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
        return notification.request.content.userInfo["faithform"] != nil || notification.request.content.userInfo["stream"] != nil
            ? [.banner, .list, .sound]
            : []
    }

    /// Use the completion-based API deliberately. The async-to-Objective-C
    /// bridge can finish on a cooperative worker; UIKit's snapshot completion
    /// then asserts because it must run on the main thread. Finish explicitly
    /// on MainActor, after any background check-in work has completed.
    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse,
        withCompletionHandler completionHandler: @escaping @Sendable () -> Void
    ) {
        let content = response.notification.request.content
        receive(
            actionIdentifier: response.actionIdentifier,
            categoryIdentifier: content.categoryIdentifier,
            userInfo: content.userInfo,
            completionHandler: completionHandler
        )
    }

    /// Decode framework objects before crossing actors. Only Sendable intents
    /// and URLs enter the task, never UNNotificationResponse or its dictionary.
    @discardableResult
    func receive(
        actionIdentifier: String,
        categoryIdentifier: String,
        userInfo: [AnyHashable: Any],
        completionHandler: @escaping @Sendable () -> Void
    ) -> Task<Void, Never> {
        let action = AttendanceNotificationContent.action(
            actionIdentifier: actionIdentifier,
            categoryIdentifier: categoryIdentifier,
            userInfo: userInfo
        )
        let url = actionIdentifier == UNNotificationDefaultActionIdentifier
            ? Self.deepLink(in: userInfo) : nil

        return Task {
            if let action {
                await handleAttendance(action)
                switch action {
                case let .checkIn(slug, opensApp) where opensApp:
                    if let link = Self.checkInLink(churchSlug: slug) { await openURL(link) }
                case let .open(slug):
                    if let link = Self.checkInLink(churchSlug: slug) { await openURL(link) }
                default: break
                }
            } else if let url {
                await openURL(url)
            }
            // Every path, including malformed and dismissed notifications,
            // completes exactly once, on the executor UIKit requires.
            await MainActor.run { completionHandler() }
        }
    }

    /// The `faithform://` link a push carried, if it carried one.
    private static func deepLink(in userInfo: [AnyHashable: Any]) -> URL? {
        if let chat = userInfo["stream"] as? [String: String], let cid = chat["cid"] {
            var link = URLComponents()
            link.scheme = "faithform"
            link.host = "messages"
            link.queryItems = [URLQueryItem(name: "cid", value: cid)]
            return link.url
        }
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
    private static func checkInLink(churchSlug: String) -> URL? {
        URL(string: "faithform://church/\(churchSlug)/check-in")
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
