import Foundation
import UIKit
import UserNotifications
import FaithFormKit

/// The system side of push: permission, APNs registration, and the token.
///
/// `PushLifecycleModel` decides *when* any of this may happen — education
/// first, an explicit tap second, the system prompt third — and this file is
/// only the part that cannot be tested without a device. Everything here is
/// deliberately dumb: no policy, no state beyond what iOS hands back.

// MARK: - Permission and registration

/// `NotificationAuthorizing`, against the real notification centre.
///
/// `.badge` is asked for along with alerts and sound because a church's
/// announcement arriving while the app is closed should be countable; the
/// attendance notifier asks for less, since a check-in question badges nothing.
/// The centre is reached through `current()` in each call rather than stored:
/// `UNUserNotificationCenter` is not `Sendable`, and this type is handed to a
/// model that is.
struct SystemNotificationAuthorizer: NotificationAuthorizing {
    func status() async -> NotificationAuthorization {
        Self.map(await UNUserNotificationCenter.current().notificationSettings().authorizationStatus)
    }

    func requestAuthorization() async -> NotificationAuthorization {
        _ = try? await UNUserNotificationCenter.current()
            .requestAuthorization(options: [.alert, .sound, .badge])
        return await status()
    }

    /// Registration is what produces a token; it is not permission, and iOS
    /// requires it on the main actor.
    @MainActor
    func registerForRemoteNotifications() async {
        UIApplication.shared.registerForRemoteNotifications()
    }

    static func map(_ status: UNAuthorizationStatus) -> NotificationAuthorization {
        switch status {
        case .notDetermined: return .notDetermined
        case .denied: return .denied
        case .authorized: return .authorized
        case .provisional: return .provisional
        case .ephemeral: return .ephemeral
        @unknown default: return .denied
        }
    }
}

// MARK: - The token, and the gap between UIKit and the object graph

/// Holds the APNs token until something is listening for it.
///
/// The app delegate is built by UIKit, before `AppDependencies` exists and
/// without any way to be handed it — the same problem `CoreLocationAdapter`
/// has with a region crossing that launches the app, and the same answer: the
/// arrival is kept, and delivered as soon as a handler attaches. Without that,
/// a token issued during launch is a token nobody registers.
actor DeviceTokenInbox: DeviceTokenObserving {
    private var pending: String?
    private var handler: (@Sendable (String) async -> Void)?
    private var failureHandler: (@Sendable () async -> Void)?
    private var failed = false

    func onRegistrationFailed(_ handler: @escaping @Sendable () async -> Void) async {
        failureHandler = handler
        if failed { await handler() }
    }

    func registrationFailed() async {
        failed = true
        await failureHandler?()
    }

    func onTokenChanged(_ handler: @escaping @Sendable (String) async -> Void) async {
        self.handler = handler
        if let pending {
            self.pending = nil
            await handler(pending)
        }
    }

    /// Called by the app delegate. Never logged: a device token is a
    /// credential for addressing this phone.
    func receive(_ token: String) async {
        failed = false
        guard let handler else {
            pending = token
            return
        }
        await handler(token)
    }
}

/// The application delegate, for the two APNs callbacks that exist nowhere in
/// SwiftUI. It does nothing else — launch composition stays in `AppDependencies`.
final class PushApplicationDelegate: NSObject, UIApplicationDelegate {
    /// Shared because UIKit owns the delegate's construction. The inbox holds
    /// no policy and no account state — only the most recent token, until the
    /// graph is ready to take it.
    static let tokens = DeviceTokenInbox()

    /// The provisioning profile, not the backend URL or build optimization,
    /// determines which APNs environment issued this device's token. Store
    /// builds have no embedded profile and use production APNs.
    static var apnsEnvironment: String {
        guard let url = Bundle.main.url(forResource: "embedded", withExtension: "mobileprovision"),
              let data = try? Data(contentsOf: url),
              let start = data.range(of: Data("<?xml".utf8)),
              let end = data.range(of: Data("</plist>".utf8)),
              let profile = try? PropertyListSerialization.propertyList(
                from: data.subdata(in: start.lowerBound..<end.upperBound), options: [], format: nil
              ) as? [String: Any],
              let entitlements = profile["Entitlements"] as? [String: Any],
              let environment = entitlements["aps-environment"] as? String
        else {
            #if targetEnvironment(simulator)
            return "development"
            #else
            return "production"
            #endif
        }
        return environment == "development" ? "development" : "production"
    }

    func application(
        _ application: UIApplication,
        didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data
    ) {
        let token = apnsTokenHex(deviceToken)
        Task { await Self.tokens.receive(token) }
    }

    func application(
        _ application: UIApplication,
        didFailToRegisterForRemoteNotificationsWithError error: Error
    ) {
        // Expected on a simulator and whenever the device is offline, so this
        // is a note rather than anything a person is shown. The next launch
        // registers again.
        FaithFormLog(category: "push").event("apns_registration_failed")
        Task { await Self.tokens.registrationFailed() }
    }
}
