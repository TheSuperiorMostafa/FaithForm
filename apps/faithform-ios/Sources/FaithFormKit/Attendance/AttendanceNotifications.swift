import Foundation

/// The local notifications automatic check-in sends.
///
/// Three, and only these: the question ("Are you at Grace Community? Tap to
/// check in"), the answer ("You're checked in at Grace Community"), and — only
/// after the person tapped to check in — the refusal. Local notifications need
/// no push entitlement and no server.
///
/// **What a notification never carries.** No coordinate, no region, no
/// occurrence, no account. The payload names a church slug so the tap can be
/// routed; the attempt it acts on is read back from the Keychain, so a
/// notification is not a way in — a forged one finds nothing to confirm.
public protocol AttendanceNotifying: Actor {
    func authorizationStatus() async -> NotificationAuthorization
    /// Raises the system prompt. Only ever called from the education screen
    /// shown while turning automatic check-in on.
    func requestAuthorization() async -> NotificationAuthorization

    /// Schedules — or reschedules — the question for one church. One per
    /// church: scheduling again replaces the previous one.
    func scheduleArrivalPrompt(churchSlug: String, churchName: String, at: Date) async
    func cancelArrivalPrompt(churchSlug: String) async
    /// Removes every pending and delivered attendance notification. Turning
    /// the feature off and signing out both call it.
    func cancelAll() async

    func postCheckedIn(churchSlug: String, churchName: String) async
    func postNotCheckedIn(churchSlug: String, churchName: String) async
}

/// What a person did with an attendance notification.
public enum AttendanceNotificationAction: Equatable, Sendable {
    /// "Check in", or a tap on the question itself — its body says "Tap to
    /// check in", so a tap is exactly that.
    case checkIn(churchSlug: String, opensApp: Bool)
    /// "Not now". The arrival is closed and nothing is sent.
    case notNow(churchSlug: String)
    /// A tap on "You're checked in" or on a refusal. Opens the app; decides
    /// nothing.
    case open(churchSlug: String)
}

/// Identifiers, payloads and copy, as plain values so each is testable.
public enum AttendanceNotificationContent {
    public static let arrivalCategory = "faithform.attendance.arrival"
    public static let resultCategory = "faithform.attendance.result"
    public static let checkInAction = "faithform.attendance.check-in"
    public static let notNowAction = "faithform.attendance.not-now"

    /// The system's own identifiers, spelled out so this file needs no
    /// framework to parse a response.
    public static let systemDefaultAction = "com.apple.UNNotificationDefaultActionIdentifier"
    public static let systemDismissAction = "com.apple.UNNotificationDismissActionIdentifier"

    private static let prefix = "faithform.attendance."

    public static func arrivalIdentifier(churchSlug: String) -> String {
        prefix + "arrival." + churchSlug
    }

    public static func resultIdentifier(churchSlug: String) -> String {
        prefix + "result." + churchSlug
    }

    public static func isAttendanceIdentifier(_ identifier: String) -> Bool {
        identifier.hasPrefix(prefix)
    }

    /// The whole payload: which church. Nothing about where, when or who.
    public static func userInfo(churchSlug: String) -> [String: [String: String]] {
        ["faithform": ["attendanceChurch": churchSlug]]
    }

    public static func churchSlug(from userInfo: [AnyHashable: Any]) -> String? {
        guard let payload = userInfo["faithform"] as? [String: Any],
              let slug = payload["attendanceChurch"] as? String,
              !slug.isEmpty
        else { return nil }
        return slug
    }

    public static func arrivalTitle(churchName: String) -> String {
        String(format: L.autoAttendancePromptTitle, displayName(churchName))
    }

    public static var arrivalBody: String { L.autoAttendancePromptBody }

    public static func checkedInTitle(churchName: String) -> String {
        String(format: L.autoAttendanceCheckedInTitle, displayName(churchName))
    }

    public static func notCheckedInTitle(churchName: String) -> String {
        String(format: L.autoAttendanceNotCheckedInTitle, displayName(churchName))
    }

    public static var notCheckedInBody: String { L.autoAttendanceNotCheckedInBody }

    private static func displayName(_ name: String) -> String {
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? L.autoAttendanceYourChurch : trimmed
    }

    /// Turns a notification response into an intent, or nil for anything that
    /// is not ours.
    public static func action(
        actionIdentifier: String,
        categoryIdentifier: String,
        userInfo: [AnyHashable: Any]
    ) -> AttendanceNotificationAction? {
        guard let slug = churchSlug(from: userInfo) else { return nil }

        switch (categoryIdentifier, actionIdentifier) {
        case (arrivalCategory, checkInAction):
            return .checkIn(churchSlug: slug, opensApp: false)
        case (arrivalCategory, systemDefaultAction):
            return .checkIn(churchSlug: slug, opensApp: true)
        case (arrivalCategory, notNowAction):
            return .notNow(churchSlug: slug)
        case (resultCategory, systemDefaultAction):
            return .open(churchSlug: slug)
        default:
            // A swipe to dismiss decides nothing: the arrival stays
            // confirmable in the app until it expires.
            return nil
        }
    }
}

#if canImport(UserNotifications)
import UserNotifications

/// The production notifier. One call per framework operation; the copy and the
/// identifiers come from `AttendanceNotificationContent`.
public actor SystemAttendanceNotifier: AttendanceNotifying {
    private let center: UNUserNotificationCenter

    public init(center: UNUserNotificationCenter = .current()) {
        self.center = center
        center.setNotificationCategories(Self.categories())
    }

    /// The "Check in" and "Not now" buttons.
    ///
    /// "Check in" runs in the background — no unlock and no app launch in
    /// front of the person — which is enough time for one fix and one request.
    public nonisolated static func categories() -> Set<UNNotificationCategory> {
        let checkIn = UNNotificationAction(
            identifier: AttendanceNotificationContent.checkInAction,
            title: L.autoAttendancePromptActionCheckIn,
            options: []
        )
        let notNow = UNNotificationAction(
            identifier: AttendanceNotificationContent.notNowAction,
            title: L.autoAttendanceNotNow,
            options: []
        )
        return [
            UNNotificationCategory(
                identifier: AttendanceNotificationContent.arrivalCategory,
                actions: [checkIn, notNow],
                intentIdentifiers: [],
                options: []
            ),
            UNNotificationCategory(
                identifier: AttendanceNotificationContent.resultCategory,
                actions: [],
                intentIdentifiers: [],
                options: []
            ),
        ]
    }

    public func authorizationStatus() async -> NotificationAuthorization {
        Self.map(await center.notificationSettings().authorizationStatus)
    }

    public func requestAuthorization() async -> NotificationAuthorization {
        _ = try? await center.requestAuthorization(options: [.alert, .sound])
        return await authorizationStatus()
    }

    public func scheduleArrivalPrompt(churchSlug: String, churchName: String, at date: Date) async {
        let content = UNMutableNotificationContent()
        content.title = AttendanceNotificationContent.arrivalTitle(churchName: churchName)
        content.body = AttendanceNotificationContent.arrivalBody
        content.categoryIdentifier = AttendanceNotificationContent.arrivalCategory
        content.userInfo = AttendanceNotificationContent.userInfo(churchSlug: churchSlug)
        content.sound = .default

        // A time-interval trigger rather than a calendar one: the instant is
        // the server's, and it must not move with the device's time zone.
        let interval = max(1, date.timeIntervalSinceNow)
        let request = UNNotificationRequest(
            identifier: AttendanceNotificationContent.arrivalIdentifier(churchSlug: churchSlug),
            content: content,
            trigger: UNTimeIntervalNotificationTrigger(timeInterval: interval, repeats: false)
        )
        // Replaces any earlier question for this church. A failure is not
        // reported: the in-app card asks the same question.
        try? await center.add(request)
    }

    public func cancelArrivalPrompt(churchSlug: String) async {
        let identifier = AttendanceNotificationContent.arrivalIdentifier(churchSlug: churchSlug)
        center.removePendingNotificationRequests(withIdentifiers: [identifier])
        center.removeDeliveredNotifications(withIdentifiers: [identifier])
    }

    public func cancelAll() async {
        let pending = await center.pendingNotificationRequests()
            .map(\.identifier)
            .filter(AttendanceNotificationContent.isAttendanceIdentifier)
        let delivered = await center.deliveredNotifications()
            .map(\.request.identifier)
            .filter(AttendanceNotificationContent.isAttendanceIdentifier)
        center.removePendingNotificationRequests(withIdentifiers: pending)
        center.removeDeliveredNotifications(withIdentifiers: delivered)
    }

    public func postCheckedIn(churchSlug: String, churchName: String) async {
        await post(
            churchSlug: churchSlug,
            title: AttendanceNotificationContent.checkedInTitle(churchName: churchName),
            body: nil
        )
    }

    public func postNotCheckedIn(churchSlug: String, churchName: String) async {
        await post(
            churchSlug: churchSlug,
            title: AttendanceNotificationContent.notCheckedInTitle(churchName: churchName),
            body: AttendanceNotificationContent.notCheckedInBody
        )
    }

    private func post(churchSlug: String, title: String, body: String?) async {
        await cancelArrivalPrompt(churchSlug: churchSlug)
        let content = UNMutableNotificationContent()
        content.title = title
        if let body { content.body = body }
        content.categoryIdentifier = AttendanceNotificationContent.resultCategory
        content.userInfo = AttendanceNotificationContent.userInfo(churchSlug: churchSlug)
        // Silent. Somebody is sitting in a service; the question earned a
        // sound, the answer does not.
        let request = UNNotificationRequest(
            identifier: AttendanceNotificationContent.resultIdentifier(churchSlug: churchSlug),
            content: content,
            trigger: nil
        )
        try? await center.add(request)
    }

    static func map(_ status: UNAuthorizationStatus) -> NotificationAuthorization {
        switch status {
        case .notDetermined: return .notDetermined
        case .denied: return .denied
        case .authorized: return .authorized
        case .provisional: return .provisional
        #if os(iOS)
        case .ephemeral: return .ephemeral
        #endif
        @unknown default: return .denied
        }
    }
}
#endif
