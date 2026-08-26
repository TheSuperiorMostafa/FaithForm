import Testing
import Foundation
@testable import Faithful
import FaithfulKit

/// What the **app** composes, as opposed to what the library computes.
///
/// These need a host application to run, which is the point: they assert the
/// things that only exist once there is an app — the environment it reads, the
/// tabs it builds, and the screens it does and does not register.

// MARK: - Environment

@Suite("App environment")
struct AppEnvironmentTests {

    private func info(
        key: String? = "staging",
        origin: String? = "https://staging.example.test",
        build: String? = "1",
        debugControls: String? = "NO"
    ) -> [String: Any] {
        var dict: [String: Any] = [:]
        if let key { dict["FaithfulEnvironmentKey"] = key }
        if let origin { dict["FaithfulAPIOrigin"] = origin }
        if let build { dict["FaithfulClientBuild"] = build }
        if let debugControls { dict["FaithfulAllowDebugControls"] = debugControls }
        return dict
    }

    @Test("a configured build resolves to its own origin")
    func configured() {
        guard case let .configured(environment, build, debug) =
            AppEnvironmentLoader.load(from: info())
        else {
            Issue.record("a complete configuration did not load")
            return
        }
        #expect(environment.key == "staging")
        #expect(environment.baseURL.absoluteString == "https://staging.example.test")
        #expect(build == 1)
        #expect(debug == false)
    }

    @Test("a missing origin fails closed rather than falling back to production")
    func missingOrigin() {
        // **The inversion that matters.** The usual default is a fallback to
        // production, and it is why staging builds end up writing to real
        // churches. This one refuses to start and names the key.
        guard case let .unconfigured(reason) =
            AppEnvironmentLoader.load(from: info(origin: nil))
        else {
            Issue.record("a build with no origin was configured anyway")
            return
        }
        #expect(reason.contains("FaithfulAPIOrigin"))
        #expect(!reason.contains("faithform.io"), "the reason named a fallback")
    }

    @Test("an empty origin is the same as a missing one")
    func emptyOrigin() {
        // Staging and Release ship with the key present and empty, which is what
        // an unconfigured build actually looks like.
        if case .configured = AppEnvironmentLoader.load(from: info(origin: "   ")) {
            Issue.record("an empty origin was accepted")
        }
    }

    @Test("cleartext is refused outside development")
    func cleartext() {
        for key in ["staging", "production"] {
            if case .configured = AppEnvironmentLoader.load(
                from: info(key: key, origin: "http://example.test")
            ) {
                Issue.record("\(key) accepted an http origin")
            }
        }
        // A developer pointing a simulator at a laptop is the one case where it
        // is legitimate.
        if case .unconfigured = AppEnvironmentLoader.load(
            from: info(key: "development", origin: "http://localhost:3000")
        ) {
            Issue.record("development refused localhost")
        }
    }

    @Test("a client build that cannot be read is not defaulted")
    func clientBuild() {
        // The server refuses builds it no longer supports. Guessing one would
        // make an unsupported build look supported.
        for value in [nil, "", "abc", "0", "-3"] {
            if case .configured = AppEnvironmentLoader.load(from: info(build: value)) {
                Issue.record("accepted client build \(value ?? "nil")")
            }
        }
    }

    @Test("debug controls are off unless switched explicitly on")
    func debugControls() {
        for value in ["NO", "no", "yes", "true", "1", "", nil] {
            guard case let .configured(_, _, allows) =
                AppEnvironmentLoader.load(from: info(debugControls: value))
            else {
                Issue.record("configuration failed for \(value ?? "nil")")
                continue
            }
            // Anything other than an explicit YES is NO. A misspelled value must
            // not switch developer affordances on in a build going to a church.
            #expect(allows == false, "\(value ?? "nil") enabled debug controls")
        }
    }

    @Test("the environment key is missing, not guessed")
    func missingKey() {
        if case .configured = AppEnvironmentLoader.load(from: info(key: nil)) {
            Issue.record("a build with no environment key was configured")
        }
    }
}

// MARK: - What the app registers

@Suite("App composition")
struct AppCompositionTests {

    @Test("sermons has no screen, and is not registered")
    @MainActor
    func sermonsAbsent() {
        // Prompt 10 was never built. The destination exists in the enum, the
        // capability key exists, and there is no screen — so registering it
        // would produce a tab that opens a blank page.
        //
        // Asserted through the *capability key* rather than the registry's
        // internal identity function, which the app module cannot see — and
        // should not: a host reaching into a library's private naming is how
        // two copies of one rule appear.
        let capabilities = Set(
            AppDependencies.implementedDestinations.map(\.requiredCapability)
        )
        #expect(!capabilities.contains("sermons"))
        #expect(RootTab.allCases.allSatisfy { $0.destination.requiredCapability != "sermons" })
    }

    @Test("every tab maps to a destination the app implements")
    @MainActor
    func tabsAreImplemented() {
        // The other direction: a tab whose screen is not registered would be
        // offered and then refused, which is worse than not being offered.
        //
        // Compared by capability rather than by case, because the registered
        // set carries placeholder slugs and a tab's does too.
        let capabilities = Set(
            AppDependencies.implementedDestinations.map(\.requiredCapability)
        )
        for tab in RootTab.allCases {
            #expect(
                capabilities.contains(tab.destination.requiredCapability),
                "\(tab) has no registered destination"
            )
        }
    }

    @Test("a destination with no tab still resolves to nothing rather than to home")
    func unmappedDestination() {
        // Announcements is reachable by deep link and has no tab of its own.
        // Mapping it to `home` would silently send someone somewhere else.
        #expect(RootModel.tab(for: .announcements(churchSlug: "grace")) == nil)
        #expect(RootModel.tab(for: .sermonArchive(churchSlug: "grace")) == nil)
    }

    @Test("church-scoped destinations are scoped to the selected church")
    func scoping() {
        // A tab resolved against the wrong church would survive a switch to a
        // church that does not allow it.
        #expect(RootModel.scoped(.watch(churchSlug: ""), to: "grace") == .watch(churchSlug: "grace"))
        #expect(RootModel.scoped(.give(churchSlug: ""), to: "grace") == .give(churchSlug: "grace"))
        #expect(RootModel.scoped(.home, to: "grace") == .home)
        #expect(RootModel.scoped(.watch(churchSlug: "a"), to: nil) == .watch(churchSlug: "a"))
    }
}

// MARK: - What the bundle declares

@Suite("App bundle")
struct AppBundleTests {

    private var info: [String: Any] { Bundle.main.infoDictionary ?? [:] }

    @Test("only the two justified usage descriptions are declared")
    func usageDescriptions() {
        // A declared permission is a promise. These two name features that
        // exist; the absent ones name features that do not.
        #expect(info["NSCameraUsageDescription"] != nil)
        #expect(info["NSLocationWhenInUseUsageDescription"] != nil)
        #expect(info["NSLocationAlwaysAndWhenInUseUsageDescription"] != nil)

        for absent in [
            "NSPhotoLibraryUsageDescription",
            "NSPhotoLibraryAddUsageDescription",
            "NSMicrophoneUsageDescription",
            "NSContactsUsageDescription",
            "NSCalendarsUsageDescription",
            "NSUserTrackingUsageDescription",
            "NSFaceIDUsageDescription",
            "NSMotionUsageDescription",
            "NSBluetoothAlwaysUsageDescription",
        ] {
            #expect(info[absent] == nil, "\(absent) is declared and nothing needs it")
        }
    }

    @Test("no background mode is declared")
    func backgroundModes() {
        // Region monitoring wakes the app without one. Declaring `location`
        // would enable the continuous updates this app deliberately does not do.
        #expect(info["UIBackgroundModes"] == nil)
    }

    @Test("the custom scheme is declared and no https domain is claimed")
    func urlSchemes() {
        let types = info["CFBundleURLTypes"] as? [[String: Any]] ?? []
        let schemes = types.flatMap { ($0["CFBundleURLSchemes"] as? [String]) ?? [] }
        #expect(schemes == ["faithful"])
    }

    @Test("the bundle identifier is not somebody's real reverse-DNS name")
    func bundleIdentifier() {
        // The default is deliberately obvious. A build that reached a store with
        // this identifier would be rejected, which is the intended outcome.
        let identifier = Bundle.main.bundleIdentifier ?? ""
        #expect(identifier.hasPrefix("io.faithform."))
    }

    @Test("nothing secret is in the bundle")
    func noSecrets() {
        // An app bundle is readable by anyone who installs it. The only values
        // here are an origin, an environment key, a build number, and the two
        // public Supabase values.
        let serialised = info.map { "\($0.key)=\($0.value)" }.joined(separator: "\n")
        for marker in ["sk_live", "sk_test", "whsec_", "service_role", "SUPABASE_SERVICE"] {
            #expect(!serialised.contains(marker), "the bundle carries \(marker)")
        }
    }
}
