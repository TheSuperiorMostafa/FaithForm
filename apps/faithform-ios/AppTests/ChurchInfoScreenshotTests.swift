import Testing
import Foundation
import SwiftUI
import UIKit
@testable import FaithForm
import FaithFormKit

/// Renders the church info page from the shipping view, with sample data, for
/// review — the way someone deciding on a church sees it, the way a person
/// sees their own church, in dark mode, scrolled, and at an accessibility
/// text size.
///
/// Gated exactly like `AttendanceScreenshotTests`: only when
/// `FAITHFORM_SCREENSHOTS=1` reaches the host, or the flag file is in the
/// app's temporary directory. The PNGs land under `church-info-shots/` there.
@MainActor
@Suite("Church info screens", .serialized)
struct ChurchInfoScreenshotTests {
    private let directory = URL(fileURLWithPath: NSTemporaryDirectory())
        .appendingPathComponent("church-info-shots")

    @Test("church info page", .enabled(if: AttendanceScreenshotTests.enabled))
    func churchInfo() async throws {
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)

        try await render("01-discovery-replace", relationship: nil, hasOtherChurch: true)
        try await render("02-discovery-add-dark", relationship: nil, hasOtherChurch: false, scheme: .dark)
        try await render("03-your-church", relationship: "joined", hasOtherChurch: false)
        try await render("04-your-church-scrolled", relationship: "joined", hasOtherChurch: false, scrollTo: 520)
        try await render("05-your-church-bottom", relationship: "joined", hasOtherChurch: false, scrollTo: 5000)
        try await render("06-your-church-dark-scrolled", relationship: "joined", hasOtherChurch: false, scheme: .dark, scrollTo: 520)
        try await render(
            "07-accessibility-text",
            relationship: nil, hasOtherChurch: false, dynamicType: .accessibility2
        )
    }

    // MARK: -

    private func render(
        _ name: String,
        relationship: String?,
        hasOtherChurch: Bool,
        scheme: ColorScheme = .light,
        dynamicType: DynamicTypeSize = .large,
        scrollTo offset: CGFloat? = nil
    ) async throws {
        let model = try await loadedModel(relationship: relationship)
        let window = try await show(
            NavigationStack {
                ChurchProfileView(
                    model: model,
                    slug: "grace",
                    hasOtherChurch: hasOtherChurch,
                    currentChurchName: "Riverside Chapel",
                    onChangeChurch: {},
                    onAcceptInvitation: {}
                )
            }
            .environment(\.dynamicTypeSize, dynamicType),
            scheme: scheme
        )
        defer { window.isHidden = true }

        if let offset, let scroll = Self.scrollView(in: window) {
            let maxOffset = max(scroll.contentSize.height - scroll.bounds.height + scroll.adjustedContentInset.bottom, 0)
            scroll.setContentOffset(
                CGPoint(x: 0, y: min(offset, maxOffset) - scroll.adjustedContentInset.top),
                animated: false
            )
            try await Task.sleep(for: .milliseconds(700))
        }
        try snapshot(window, as: name)
    }

    private func loadedModel(relationship: String?) async throws -> ChurchProfileModel {
        let transport = StubTransport([.init(status: 200, body: Self.envelope(Self.profile(relationship: relationship)))])
        let api = APIClient(
            configuration: .init(
                environment: APIEnvironment(key: "shots", baseURL: URL(string: "https://example.invalid")!),
                clientBuild: 1
            ),
            transport: transport,
            tokens: ShotTokens()
        )
        let model = ChurchProfileModel(api: api, cache: PartitionedCache())
        await model.load(
            slug: "grace",
            partition: CachePartition(
                environment: "shots", accountId: "shots", churchSlug: "grace", authorizationVersion: 1
            )
        )
        guard case .loaded = model.phase else {
            Issue.record("sample profile did not load: \(model.phase)")
            throw CancellationError()
        }
        return model
    }

    private static func envelope(_ data: String) -> Data {
        Data("""
        {"ok":true,"data":\(data),"meta":{"apiVersion":"2026-08-24","apiMajor":1,"requestId":"shots","minimumSupportedClientBuild":1}}
        """.utf8)
    }

    private static func profile(relationship: String?) -> String {
        let state = relationship.map { "\"\($0)\"" } ?? "null"
        return """
        {"slug":"grace","name":"Grace Community Church","logoUrl":null,"coverImageUrl":null,
        "publicSummary":"A church for the whole city.","tagline":"Come as you are",
        "denomination":"Non-denominational","address":"1200 Main Street","city":"Louisville",
        "state":"KY","postalCode":"40202","website":"https://www.gracecommunity.example",
        "phone":"+1 (502) 555-0134","email":"hello@gracecommunity.example","joinPolicy":"open",
        "timezone":"America/New_York","publicProfileVersion":4,
        "campuses":[
          {"slug":"downtown","name":"Downtown","addressLine1":"1200 Main Street","city":"Louisville","state":"KY","postalCode":"40202","latitude":38.2527,"longitude":-85.7585,"timezone":"America/New_York","isPrimary":true},
          {"slug":"east","name":"East End","addressLine1":"48 Shelbyville Rd","city":"Louisville","state":"KY","postalCode":"40207","latitude":null,"longitude":null,"timezone":"America/New_York","isPrimary":false}
        ],
        "serviceTimes":[
          {"campusSlug":"","label":"Prayer & Worship Night","dayOfWeek":3,"startTime":"19:00:00","kind":"regular"},
          {"campusSlug":"downtown","label":"Morning Service","dayOfWeek":0,"startTime":"09:00:00","kind":"regular"},
          {"campusSlug":"downtown","label":"Late Service","dayOfWeek":0,"startTime":"11:15:00","kind":"regular"},
          {"campusSlug":"east","label":"Family Service","dayOfWeek":0,"startTime":"10:00:00","kind":"regular"}
        ],
        "relationshipState":\(state),
        "about":"Grace Community is a family of people from every part of Louisville, learning to follow Jesus together. We gather on Sundays downtown and in the East End, meet in homes through the week, and serve our neighbours with a food pantry, a youth mentoring programme and a recovery ministry. Whether you have been in church all your life or are just curious, there is a seat for you — come as you are, and stay for coffee afterwards.",
        "mapsUrl":null,
        "socialLinks":[
          {"platform":"instagram","url":"https://instagram.com/gracecommunity"},
          {"platform":"youtube","url":"https://youtube.com/@gracecommunity"},
          {"platform":"facebook","url":"https://facebook.com/gracecommunity"},
          {"platform":"podcast","url":"https://podcasts.example/grace"},
          {"platform":"tiktok","url":"https://tiktok.com/@gracecommunity"},
          {"platform":"x","url":"https://x.com/gracecommunity"}
        ],
        "quickLinks":[
          {"label":"Plan your visit","url":"https://www.gracecommunity.example/visit"},
          {"label":"Kids & students","url":"https://www.gracecommunity.example/kids"},
          {"label":"Join a small group","url":"https://groups.gracecommunity.example"}
        ]}
        """
    }

    private static func scrollView(in view: UIView) -> UIScrollView? {
        if let scroll = view as? UIScrollView, scroll.contentSize.height > scroll.bounds.height {
            return scroll
        }
        for subview in view.subviews {
            if let found = scrollView(in: subview) { return found }
        }
        return nil
    }

    private func show<V: View>(_ view: V, scheme: ColorScheme) async throws -> UIWindow {
        let scene = try #require(
            UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first
        )
        let window = UIWindow(windowScene: scene)
        window.overrideUserInterfaceStyle = scheme == .dark ? .dark : .light
        window.frame = scene.screen.bounds
        let host = UIHostingController(
            rootView: view
                .faithformTheme()
                .environment(\.colorScheme, scheme)
        )
        window.rootViewController = host
        window.makeKeyAndVisible()
        // Long enough for the staggered entrance to finish.
        try await Task.sleep(for: .milliseconds(2200))
        return window
    }

    private func snapshot(_ window: UIWindow, as name: String) throws {
        let renderer = UIGraphicsImageRenderer(bounds: window.bounds)
        let image = renderer.image { _ in
            window.drawHierarchy(in: window.bounds, afterScreenUpdates: true)
        }
        let data = try #require(image.pngData())
        try data.write(to: directory.appendingPathComponent("\(name).png"))
    }
}

private actor ShotTokens: TokenProviding {
    func validAccessToken() async throws -> String { "shots" }
    func invalidate() async {}
}
