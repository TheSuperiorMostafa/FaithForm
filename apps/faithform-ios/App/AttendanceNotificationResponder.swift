import Foundation
import UserNotifications
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
        AttendanceNotificationContent.isAttendanceIdentifier(notification.request.identifier)
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
        ) else { return }

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

    /// The Check in tab for that church, through the same fail-closed router as
    /// every other link.
    @MainActor
    private static func openCheckIn(churchSlug: String) {
        guard let url = URL(string: "faithform://church/\(churchSlug)/check-in") else { return }
        NotificationCenter.default.post(name: .faithformDeepLink, object: nil, userInfo: ["url": url])
    }
}
