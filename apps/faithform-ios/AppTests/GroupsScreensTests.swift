import Testing
import Foundation
import SwiftUI
import UIKit
@testable import FaithForm
import FaithFormKit

@MainActor @Suite("Groups screens", .serialized)
struct GroupsScreensTests {
    @Test func invitationLinksAreStrict() throws {
        #expect(GroupInvitationLink.token(from: try #require(URL(string: "faithform://group-invite/abcdefghijklmnop"))) == "abcdefghijklmnop")
        for raw in ["faithform://group-invite/short", "faithform://group-invite/abcdefghijklmnop?extra=1", "faithform://group-invite/abcdefghijklmnop/extra", "https://group-invite/abcdefghijklmnop"] {
            #expect(GroupInvitationLink.token(from: try #require(URL(string: raw))) == nil)
        }
    }
    @Test func groupsRenderInLightAndDark() async throws {
        let group = GroupSummary(id: "00000000-0000-4000-8000-000000000001", name: "The Table", type: .init(id: "bible", name: "Life group", icon: "users"), memberCount: 14, capacity: 20, enrollment: "open", visibility: "discoverable", status: "active", scheduleText: "Tuesdays at 6:30 pm", meetingDays: [2], membershipState: "member", groupRole: "member", joinAction: "leave", isYouth: false, version: 1)
        let home = try JSONEncoder().encode(MyGroups(items: [group], directMessagesEnabled: true, messagingAvailable: false))
        let filters = Data("{\"types\":[],\"campuses\":[],\"days\":[]}".utf8)
        func envelope(_ value: Data) -> Data { Data("{\"ok\":true,\"data\":\(String(decoding: value, as: UTF8.self)),\"meta\":{\"apiVersion\":\"2026-08-24\",\"apiMajor\":1,\"requestId\":\"groups-test\",\"minimumSupportedClientBuild\":1}}".utf8) }
        let scene = try #require(UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first)
        let directory = URL(fileURLWithPath: NSTemporaryDirectory()).appendingPathComponent("groups-shots")
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        for scheme in [ColorScheme.light, .dark] {
            let api = APIClient(configuration: .init(environment: APIEnvironment(key: "groups-test", baseURL: URL(string: "https://example.invalid")!), clientBuild: 1), transport: StubTransport([.init(status: 200, body: envelope(home)), .init(status: 200, body: envelope(filters))]), tokens: GroupTestTokens())
            let model = GroupsModel(api: api, churchSlug: "grace")
            let window = UIWindow(windowScene: scene); window.frame = scene.screen.bounds
            window.overrideUserInterfaceStyle = scheme == .dark ? .dark : .light
            window.rootViewController = UIHostingController(rootView: GroupsTabView(model: model).faithformTheme().environment(\.colorScheme, scheme))
            window.makeKeyAndVisible()
            let deadline = ContinuousClock.now.advanced(by: .seconds(20))
            while model.home == nil && model.error == nil && ContinuousClock.now < deadline {
                try await Task.sleep(for: .milliseconds(100))
            }
            try await Task.sleep(for: .milliseconds(300))
            #expect(model.home?.items.first?.name == "The Table")
            #expect(model.error == nil)
            let picture = UIGraphicsImageRenderer(bounds: window.bounds).image { _ in window.drawHierarchy(in: window.bounds, afterScreenUpdates: true) }
            try #require(picture.pngData()).write(to: directory.appendingPathComponent(scheme == .dark ? "groups-dark.png" : "groups-light.png"))
            let preferences = try JSONEncoder().encode(MessagingPreferences(level: "mentions", groups: []))
            let blocks = try JSONEncoder().encode(ChatBlockList(items: []))
            let preferencesAPI = APIClient(configuration: .init(environment: APIEnvironment(key: "groups-test", baseURL: URL(string: "https://example.invalid")!), clientBuild: 1), transport: StubTransport([.init(status: 200, body: envelope(preferences)), .init(status: 200, body: envelope(blocks))]), tokens: GroupTestTokens())
            let preferencesModel = GroupsModel(api: preferencesAPI, churchSlug: "grace")
            window.rootViewController = UIHostingController(rootView: GroupPreferencesView(model: preferencesModel).faithformTheme().environment(\.colorScheme, scheme))
            try await Task.sleep(for: .seconds(1))
            #expect(preferencesModel.error == nil)
            let preferencesPicture = UIGraphicsImageRenderer(bounds: window.bounds).image { _ in window.drawHierarchy(in: window.bounds, afterScreenUpdates: true) }
            try #require(preferencesPicture.pngData()).write(to: directory.appendingPathComponent(scheme == .dark ? "notifications-dark.png" : "notifications-light.png"))
            window.isHidden = true
        }
    }
}
private actor GroupTestTokens: TokenProviding {
    func validAccessToken() async throws -> String { "groups-test" }
    func invalidate() async {}
}
