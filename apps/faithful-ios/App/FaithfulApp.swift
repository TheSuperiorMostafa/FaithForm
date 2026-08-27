import SwiftUI
import FaithfulKit

/// The application.
///
/// Everything below this line already existed as a library. This is the twenty
/// lines that turn it into something a person can install — and the reason it is
/// so short is that composition happens in `AppDependencies` and navigation in
/// `RootView`, neither of which needs to know it is inside an app.
@main
struct FaithfulApp: App {
    @State private var launch: LaunchOutcome

    init() {
        _launch = State(initialValue: LaunchOutcome.resolve())
    }

    var body: some Scene {
        WindowGroup {
            switch launch {
            case let .ready(dependencies):
                RootView(dependencies: dependencies)
                    .faithfulTheme()
                    // A `faithful://` link, handled the same whether it arrives
                    // cold or into a running app. It is parsed and authorized
                    // before anything moves — an unknown or unauthorized link
                    // does nothing at all.
                    .onOpenURL { url in
                        NotificationCenter.default.post(
                            name: .faithfulDeepLink,
                            object: nil,
                            userInfo: ["url": url]
                        )
                    }

            case let .unconfigured(reason):
                // **The fail-closed state.** A build with no origin does not
                // guess at one and does not fall back to production. It says so
                // — to a developer in the reason, and to a person in a sentence
                // that does not blame them.
                UnconfiguredView(reason: reason)
                    .faithfulTheme()
            }
        }
    }
}

/// What `resolve()` decided at launch.
@MainActor
enum LaunchOutcome {
    case ready(AppDependencies)
    case unconfigured(reason: String)

    static func resolve() -> LaunchOutcome {
        switch AppEnvironmentLoader.load(from: Bundle.main.infoDictionary ?? [:]) {
        case let .configured(environment, clientBuild, allowsDebugControls):
            // One keychain service for all credential material — the session
            // and the PKCE verifier — so sign-out's deleteAll sweeps both.
            let keychain = KeychainStore(service: Bundle.main.bundleIdentifier ?? "faithful")
            let session = SessionManager(
                store: keychain,
                refresher: SupabaseSessionRefresher(environment: environment),
                environmentKey: environment.key
            )
            return .ready(
                AppDependencies(
                    environment: environment,
                    clientBuild: clientBuild,
                    allowsDebugControls: allowsDebugControls,
                    session: session,
                    auth: SupabaseAuthLoader.load(
                        environment: environment,
                        flowState: SecureAuthFlowStore(
                            store: keychain,
                            environmentKey: environment.key
                        )
                    )
                )
            )
        case let .unconfigured(reason):
            return .unconfigured(reason: reason)
        }
    }
}

extension Notification.Name {
    static let faithfulDeepLink = Notification.Name("io.faithform.faithful.deepLink")
}
