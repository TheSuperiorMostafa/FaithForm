// swift-tools-version: 6.0
import PackageDescription

/// Faithful (iOS).
///
/// The product is a SwiftUI iOS app; this package holds everything that is not
/// the app target itself, so the contract, networking, storage, session, theme
/// and navigation layers can be built and tested by `swift test` on a plain
/// macOS runner without Xcode project state or a simulator.
///
/// Minimum iOS 17: it is the oldest release with the SwiftUI Observation
/// framework and the `NavigationStack` APIs this architecture depends on, and
/// by the 2026 audience split it still covers the overwhelming majority of
/// devices in use. Raising it to 18 would buy little and exclude working
/// hardware that a church congregation is likely to still be carrying.
let package = Package(
    name: "Faithful",
    platforms: [.iOS(.v17), .macOS(.v14)],
    products: [
        .library(name: "FaithfulKit", targets: ["FaithfulKit"])
    ],
    dependencies: [
        // Stripe's own payment sheet. The only place a card number is ever
        // entered is inside Stripe's UI — Faithful has no card field.
        .package(url: "https://github.com/stripe/stripe-ios.git", from: "23.32.0")
    ],
    targets: [
        .target(
            name: "FaithfulKit",
            dependencies: [
                // iOS only: the SDK does not build for macOS, and `swift test`
                // runs on macOS. Every giving decision lives in `Giving.swift`,
                // which is platform-free and therefore actually tested.
                .product(
                    name: "StripePaymentSheet",
                    package: "stripe-ios",
                    condition: .when(platforms: [.iOS])
                )
            ],
            path: "Sources/FaithfulKit",
            // The String Catalog ships with the library so Bundle.module can
            // find it. English lives in Strings.swift as the development
            // default; the catalog carries every other locale.
            resources: [.process("Resources")],
            swiftSettings: [.swiftLanguageMode(.v6)]
        ),
        .testTarget(
            name: "FaithfulKitTests",
            dependencies: ["FaithfulKit"],
            path: "Tests/FaithfulKitTests",
            swiftSettings: [.swiftLanguageMode(.v6)]
        )
    ]
)
