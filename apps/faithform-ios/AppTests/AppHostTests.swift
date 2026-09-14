import Testing
import Foundation
@testable import FaithForm
import FaithFormKit

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
        if let key { dict["FaithFormEnvironmentKey"] = key }
        if let origin { dict["FaithFormAPIOrigin"] = origin }
        if let build { dict["FaithFormClientBuild"] = build }
        if let debugControls { dict["FaithFormAllowDebugControls"] = debugControls }
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
        #expect(reason.contains("FaithFormAPIOrigin"))
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

    @Test("sermon notes are registered, and reached from Watch rather than a tab")
    @MainActor
    func sermonsOnWatch() {
        // Sermon notes have screens now — `SermonListView` and
        // `SermonDetailView` — so the destination is registered. They sit on
        // Watch beside the recordings: a tab of their own would be a sixth.
        //
        // Asserted through the *capability key* rather than the registry's
        // internal identity function, which the app module cannot see — and
        // should not: a host reaching into a library's private naming is how
        // two copies of one rule appear.
        let capabilities = Set(
            AppDependencies.implementedDestinations.map(\.requiredCapability)
        )
        #expect(capabilities.contains("sermons"))
        #expect(RootTab.allCases.allSatisfy { $0.destination.requiredCapability != "sermons" })
        #expect(RootModel.tab(for: .sermonArchive(churchSlug: "grace")) == .watch)
    }

    @Test("Home's sermon-notes card follows the same link a sermons URL does")
    func homeSermonsEntry() throws {
        let link = try #require(WatchTabView.sermonsLink(churchSlug: "grace"))
        #expect(DeepLinkParser.parse(link) == .sermonArchive(churchSlug: "grace"))
        #expect(RootModel.tab(for: .sermonArchive(churchSlug: "grace")) == .watch)
    }

    @Test("the tab bar never needs a More tab")
    func atMostFiveTabs() {
        // An iPhone tab bar shows five. A sixth folds the last two into "More",
        // which would put Account — sign-out and account deletion — one level
        // further down behind a generic label.
        #expect(RootTab.allCases.count <= 5)
        #expect(RootTab.allCases.last == .account)
    }

    @Test("finding and switching churches lands on Home")
    func churchLinksOpenHome() {
        #expect(RootModel.tab(for: .churchDiscovery) == .home)
        #expect(RootModel.tab(for: .church(slug: "grace")) == .home)
    }

    @Test("Watch never opens on a half that is switched off")
    func watchSections() {
        // Both on: whatever was asked for.
        #expect(WatchTabView.effectiveSection(requested: .sermons, showsMedia: true, showsSermons: true) == .sermons)
        #expect(WatchTabView.effectiveSection(requested: .media, showsMedia: true, showsSermons: true) == .media)
        // A sermons link to a church with notes off shows the recordings…
        #expect(WatchTabView.effectiveSection(requested: .sermons, showsMedia: true, showsSermons: false) == .media)
        // …and a server with only notes on shows the notes.
        #expect(WatchTabView.effectiveSection(requested: .media, showsMedia: false, showsSermons: true) == .sermons)
    }

    @Test("the check-in tab polls only for a scan the person started")
    func checkInPolling() {
        // The camera rule, from the host's side: nothing here may run before
        // "Scan the code" was tapped.
        #expect(!CheckInTabView.awaitsScan(.idle))
        #expect(!CheckInTabView.awaitsScan(.requestingPermission))
        #expect(CheckInTabView.awaitsScan(.scanning))
        #expect(CheckInTabView.awaitsScan(.submitting))
        #expect(!CheckInTabView.awaitsScan(.blocked(.cameraDenied)))
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
    }

    @Test("church-scoped destinations are scoped to the selected church")
    func scoping() {
        // A tab resolved against the wrong church would survive a switch to a
        // church that does not allow it.
        #expect(RootModel.scoped(.watch(churchSlug: ""), to: "grace") == .watch(churchSlug: "grace"))
        #expect(RootModel.scoped(.give(churchSlug: ""), to: "grace") == .give(churchSlug: "grace"))
        #expect(
            RootModel.scoped(.sermonArchive(churchSlug: ""), to: "grace")
                == .sermonArchive(churchSlug: "grace")
        )
        #expect(RootModel.scoped(.home, to: "grace") == .home)
        #expect(RootModel.scoped(.watch(churchSlug: "a"), to: nil) == .watch(churchSlug: "a"))
    }
}

// MARK: - What the bundle declares

@Suite("App bundle")
struct AppBundleTests {

    private var info: [String: Any] { Bundle.main.infoDictionary ?? [:] }

    @Test("only the justified usage descriptions are declared")
    func usageDescriptions() {
        // A declared permission is a promise. Camera and when-in-use location
        // name features that exist in 1.0 — QR check-in and churches near me;
        // the absent ones name features that do not.
        #expect(info["NSCameraUsageDescription"] != nil)
        #expect(info["NSLocationWhenInUseUsageDescription"] != nil)
        // The one exception, and it is never shown: the binary links
        // `requestAlwaysAuthorization` through FaithFormKit's attendance
        // adapter, and App Store Connect refuses an upload that references it
        // without a purpose string (ITMS-90683). See Info.plist.
        #expect(info["NSLocationAlwaysAndWhenInUseUsageDescription"] != nil)

        for absent in [
            // The pre-iOS 11 key. Nothing targets a system that reads it.
            "NSLocationAlwaysUsageDescription",
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

    @Test("the privacy manifest ships, and the build's own tooling does not")
    func bundleContents() throws {
        // The manifest is found by App Store Connect only inside the .app, so
        // "the file exists in the repository" is not the claim that matters.
        let manifestURL = try #require(
            Bundle.main.url(forResource: "PrivacyInfo", withExtension: "xcprivacy"),
            "PrivacyInfo.xcprivacy is not in the app bundle"
        )
        let manifest = try #require(
            try PropertyListSerialization.propertyList(
                from: Data(contentsOf: manifestURL),
                format: nil
            ) as? [String: Any]
        )
        #expect(manifest["NSPrivacyTracking"] as? Bool == false)
        #expect((manifest["NSPrivacyTrackingDomains"] as? [String])?.isEmpty == true)
        let collected = (manifest["NSPrivacyCollectedDataTypes"] as? [[String: Any]] ?? [])
            .compactMap { $0["NSPrivacyCollectedDataType"] as? String }
        for type in [
            "NSPrivacyCollectedDataTypeEmailAddress",
            "NSPrivacyCollectedDataTypeName",
            "NSPrivacyCollectedDataTypeUserID",
            "NSPrivacyCollectedDataTypePreciseLocation",
            "NSPrivacyCollectedDataTypePurchaseHistory",
            "NSPrivacyCollectedDataTypePaymentInfo",
        ] {
            #expect(collected.contains(type), "\(type) is not declared")
        }

        // A Team ID placeholder and a build script are for the people building
        // the app, and used to be copied into it.
        for leftover in ["Local.xcconfig.example", "check-assets.sh"] {
            let path = Bundle.main.bundleURL.appendingPathComponent(leftover).path
            #expect(!FileManager.default.fileExists(atPath: path), "\(leftover) is in the app bundle")
        }
    }

    @Test("a merchant ID reaches the app only through the Apple Pay switch")
    func applePayMerchant() {
        // The host tests run the Debug configuration, which signs with no
        // entitlements and so must never be told a merchant ID: an approved
        // church's gift would otherwise open a sheet this build cannot pay with.
        #expect(info["FaithFormApplePayMerchantID"] != nil, "the key is missing from Info.plist")
        #expect((info["FaithFormApplePayMerchantID"] as? String ?? "").isEmpty)
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
        #expect(schemes == ["faithform"])
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
