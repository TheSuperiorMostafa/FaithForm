import Foundation
import Observation

/// The app-level notification permission state.
///
/// `provisional` is kept distinct because iOS treats it as granted-but-quiet:
/// notifications arrive in the notification centre without alerting. Telling
/// someone they are "on" when they will never hear one would be wrong.
public enum NotificationAuthorization: Equatable, Sendable {
    case notDetermined
    case denied
    case authorized
    case provisional
    case ephemeral
}

/// Wraps `UNUserNotificationCenter`.
///
/// Abstracted so the education-then-request sequence is testable without a
/// device, and so nothing can reach the system prompt except a deliberate call.
public protocol NotificationAuthorizing: Sendable {
    func status() async -> NotificationAuthorization
    /// Raises the system prompt. Only ever called after the education screen.
    func requestAuthorization() async -> NotificationAuthorization
    /// Registers with APNs. Separate from permission: registration is what
    /// produces a device token, and it is pointless before authorization.
    func registerForRemoteNotifications() async
}

/// Reports device tokens as APNs issues and rotates them.
public protocol DeviceTokenObserving: Sendable {
    /// Raw APNs token bytes, hex-encoded by the caller.
    func onTokenChanged(_ handler: @escaping @Sendable (String) async -> Void) async
}

/// The registration this app publishes to the server.
///
/// `installId` is generated once and persisted, so the same physical install is
/// recognisable across token rotations and across accounts — which is what lets
/// the server retire a row rather than orphan it.
public struct DeviceRegistration: Codable, Sendable, Equatable {
    public let installId: String
    public let platform: String
    public let provider: String
    public let providerToken: String
    public let appVersion: String?
    public let clientBuild: Int?
    public let osVersion: String?
    public let locale: String?

    public init(
        installId: String,
        providerToken: String,
        appVersion: String? = nil,
        clientBuild: Int? = nil,
        osVersion: String? = nil,
        locale: String? = nil
    ) {
        self.installId = installId
        self.platform = "ios"
        self.provider = "apns"
        self.providerToken = providerToken
        self.appVersion = appVersion
        self.clientBuild = clientBuild
        self.osVersion = osVersion
        self.locale = locale
    }
}

/// Decides whether the app may raise the OS prompt.
///
/// The rule, identical to location and to Android: education first, an explicit
/// tap second, the system prompt third. Never at launch.
public enum NotificationPrompting {
    public static func mayRequest(
        status: NotificationAuthorization,
        hasSeenEducation: Bool
    ) -> Bool {
        hasSeenEducation && status == .notDetermined
    }

    /// iOS shows its prompt once. After a denial the only thing that changes it
    /// is Settings, so offering the button again would be a broken affordance.
    public static func shouldDirectToSettings(_ status: NotificationAuthorization) -> Bool {
        status == .denied
    }

    /// Whether the app should register for remote notifications at all.
    /// Provisional counts: those notifications are delivered, just quietly.
    public static func shouldRegisterForRemote(_ status: NotificationAuthorization) -> Bool {
        status == .authorized || status == .provisional || status == .ephemeral
    }
}

/// Hex-encodes the raw token bytes APNs hands back.
///
/// A named function rather than an inline loop because getting this wrong
/// produces a token that looks plausible and never delivers.
public func apnsTokenHex(_ data: Data) -> String {
    data.map { String(format: "%02x", $0) }.joined()
}

/// Owns the device-token lifecycle.
///
/// Registration, rotation, and retirement all funnel through here, so there is
/// exactly one place that talks to the server about this device — and exactly
/// one place that must never log a token.
@Observable
@MainActor
public final class PushLifecycleModel {
    public private(set) var status: NotificationAuthorization = .notDetermined
    public private(set) var hasSeenEducation = false
    public private(set) var lastRegisteredToken: String?
    public private(set) var registrationError: String?

    private let api: APIClient
    private let authorizer: NotificationAuthorizing
    private let installId: String
    private let clientBuild: Int
    private let appVersion: String?
    private let osVersion: String?
    private let locale: String?

    public init(
        api: APIClient,
        authorizer: NotificationAuthorizing,
        installId: String,
        clientBuild: Int,
        appVersion: String? = nil,
        osVersion: String? = nil,
        locale: String? = nil
    ) {
        self.api = api
        self.authorizer = authorizer
        self.installId = installId
        self.clientBuild = clientBuild
        self.appVersion = appVersion
        self.osVersion = osVersion
        self.locale = locale
    }

    /// Reads the current state without prompting. Safe to call at launch.
    public func refreshStatus() async {
        status = await authorizer.status()
    }

    /// Shows the education screen. Does not prompt.
    public func beginEducation() async {
        hasSeenEducation = true
        await refreshStatus()
    }

    /// The affirmative action on the education screen — the only path to the
    /// system prompt.
    public func confirmEnable() async {
        guard NotificationPrompting.mayRequest(status: status, hasSeenEducation: hasSeenEducation)
        else {
            // Already decided. Re-prompting would be a no-op that looks broken.
            return
        }

        status = await authorizer.requestAuthorization()

        if NotificationPrompting.shouldRegisterForRemote(status) {
            await authorizer.registerForRemoteNotifications()
        }
    }

    /// Called by the app delegate when APNs issues or rotates a token.
    ///
    /// Idempotent: the same token registering twice is a no-op, so a relaunch
    /// does not produce a redundant round trip.
    public func handleToken(_ token: String) async {
        guard token != lastRegisteredToken else { return }

        do {
            _ = try await api.send(
                "api/mobile/v1/devices",
                method: .post,
                body: DeviceRegistration(
                    installId: installId,
                    providerToken: token,
                    appVersion: appVersion,
                    clientBuild: clientBuild,
                    osVersion: osVersion,
                    locale: locale
                ),
                as: DeviceInstallation.self
            )
            lastRegisteredToken = token
            registrationError = nil
        } catch let error as APIError {
            // The token is never included in the message — the error is about
            // this device, not about its credential.
            registrationError = error.displayMessage
        } catch {
            registrationError = nil
        }
    }

    /// Sign-out and account removal. Retires this install server-side and drops
    /// the local copy, so a subsequent account on the same phone starts clean.
    public func retire() async {
        defer { lastRegisteredToken = nil }
        _ = try? await api.send(
            "api/mobile/v1/devices",
            method: .delete,
            query: ["installId": installId],
            as: RetireReply.self
        )
    }

    struct RetireReply: Decodable, Sendable { let retired: Bool }
}

/// Resolves a notification into a destination, then lets the router decide.
///
/// The payload is a hint. It carries a deep link and nothing authoritative, so
/// this parses the link and hands it to the same fail-closed router every other
/// link goes through — a notification is not a privileged way in.
public enum NotificationRouting {
    public static func destination(
        from userInfo: [AnyHashable: Any],
        registry: RouteRegistry,
        session: RouteRegistry.SessionSnapshot
    ) -> RouteResolution {
        guard
            let payload = userInfo["faithful"] as? [String: Any],
            let link = payload["deepLink"] as? String,
            let url = URL(string: link)
        else {
            return .rejected(.notImplemented)
        }
        return registry.resolve(url: url, session: session)
    }
}
