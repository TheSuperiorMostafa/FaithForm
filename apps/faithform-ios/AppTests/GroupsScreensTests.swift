import Testing
import Foundation
import SwiftUI
import UIKit
@testable import FaithForm
import FaithFormKit

@MainActor @Suite("Groups screens", .serialized)
struct GroupsScreensTests {
    @Test func joinedGroupsOpenChatAndVisitorsSeeOverview() {
        let chat = GroupChatInfo(cid: "ff_group:table", channelType: "ff_group", channelId: "table", state: "ready", postingPolicy: "members")
        func group(membership: String, chat: GroupChatInfo?) -> GroupSummary {
            GroupSummary(id: "table", name: "The Table", memberCount: 14, enrollment: "open", visibility: "discoverable", status: "active", meetingDays: [], membershipState: membership, joinAction: "join", chat: chat, isYouth: false, version: 1)
        }
        #expect(GroupRoute.opening(group(membership: "member", chat: chat)) == .chat(group(membership: "member", chat: chat)))
        #expect(GroupRoute.opening(group(membership: "member", chat: nil)) == .info(groupId: "table", fromChat: false))
        #expect(GroupRoute.opening(group(membership: "none", chat: chat)) == .info(groupId: "table", fromChat: false))
        #expect(GroupRoute.opening(group(membership: "requested", chat: nil)) == .info(groupId: "table", fromChat: false))
    }

    @Test func openingJoinedChatDoesNotRequestOverview() async throws {
        let group = GroupSummary(id: "00000000-0000-4000-8000-000000000001", name: "The Table", memberCount: 14, enrollment: "open", visibility: "discoverable", status: "active", meetingDays: [], membershipState: "member", groupRole: "member", joinAction: "leave", chat: .init(cid: "ff_group:table", channelType: "ff_group", channelId: "table", state: "ready", postingPolicy: "everyone"), isYouth: false, version: 1)
        let transport = StubTransport([])
        let api = APIClient(configuration: .init(environment: APIEnvironment(key: "chat-first", baseURL: URL(string: "https://example.invalid")!), clientBuild: 1), transport: transport, tokens: GroupTestTokens())
        let model = GroupsModel(api: api, churchSlug: "grace")
        let scene = try #require(UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first)
        let window = UIWindow(windowScene: scene); window.frame = scene.screen.bounds
        window.rootViewController = UIHostingController(rootView: NavigationStack {
            GroupChatScreen(model: model, group: group)
        }.environmentObject(GroupChatSession()).faithformTheme())
        window.makeKeyAndVisible()
        defer { window.isHidden = true }
        let deadline = ContinuousClock.now.advanced(by: .seconds(5))
        while await transport.requestCount() == 0 && ContinuousClock.now < deadline {
            try await Task.sleep(for: .milliseconds(50))
        }
        let paths = await transport.received.compactMap { $0.url?.path }
        #expect(paths == ["/api/mobile/v1/messaging/grace/session"])
    }

    @Test func eventsAndMembersUseThemedScreens() async throws {
        let group = GroupSummary(id: "table", name: "The Table", type: .init(id: "life", name: "Life group", icon: "users"), memberCount: 14, enrollment: "open", visibility: "discoverable", status: "active", scheduleText: "Tuesdays at 6:30 pm", meetingDays: [2], membershipState: "member", groupRole: "leader", joinAction: "leave", chat: .init(cid: "ff_group:table", channelType: "ff_group", channelId: "table", state: "ready", postingPolicy: "everyone"), isYouth: false, version: 1)
        let detail = GroupDetail(
            group: group,
            description: "A midweek table for anyone who would rather share a meal than sit in rows. Bring what you have; there is always enough.",
            leaders: [.init(name: "Jordan Williams", groupRole: "leader"), .init(name: "Sarah Chen", groupRole: "manager")],
            schedules: [.init(text: "Tuesdays at 6:30 pm", frequency: "weekly", dayOfWeek: 2, startTime: "18:30", durationMinutes: 90, timezone: "America/New_York")],
            location: .init(name: "Community kitchen", address: "41 Bridge Street", membersOnly: false),
            upcomingEvents: [.init(id: "dinner", groupId: "table", title: "Dinner around the table", startsAt: "2026-10-08T22:30:00Z", endsAt: "2026-10-09T00:00:00Z", timezone: "America/New_York", isCancelled: false, goingCount: 12)],
            capabilities: .init(canViewMembers: true, canManageMembers: true, canManageRequests: true, canInvite: true, canManageRoles: true, canEditDetails: true, canManageEvents: true, canTakeAttendance: true, canModerateChat: true),
            pendingRequestCount: 2,
            isArchived: false
        )
        let events = GroupEventPage(items: [
            .init(id: "dinner", groupId: group.id, title: "Dinner around the table", startsAt: "2026-10-08T22:30:00Z", endsAt: "2026-10-09T00:00:00Z", timezone: "America/New_York", locationName: "Community kitchen", isCancelled: false, rsvp: "going", goingCount: 12),
            .init(id: "walk", groupId: group.id, title: "Saturday morning walk", startsAt: "2026-10-10T13:00:00Z", endsAt: "2026-10-10T14:00:00Z", timezone: "America/New_York", locationName: "Waterfront Park", isCancelled: false, goingCount: 8)
        ], nextCursor: nil)
        let members = GroupMemberPage(items: [
            .init(membershipId: "1", name: "Jordan Williams", groupRole: "leader", joinedAt: "2026-09-01T12:00:00Z", isYou: true),
            .init(membershipId: "2", name: "Sarah Chen", groupRole: "member", joinedAt: "2026-09-01T12:00:00Z", isYou: false),
            .init(membershipId: "3", name: "Michael Thompson", groupRole: "member", joinedAt: "2026-09-01T12:00:00Z", isYou: false)
        ], nextCursor: nil, total: 14)
        let scene = try #require(UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first)
        let directory = URL(fileURLWithPath: NSTemporaryDirectory()).appendingPathComponent("group-redesign")
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        for scheme in [ColorScheme.light, .dark] {
            for section in ["Info", "Events", "Members"] {
                let body = try section == "Info" ? JSONEncoder().encode(detail) : section == "Events" ? JSONEncoder().encode(events) : JSONEncoder().encode(members)
                let envelope = Data("{\"ok\":true,\"data\":\(String(decoding: body, as: UTF8.self)),\"meta\":{\"apiVersion\":\"2026-08-24\",\"apiMajor\":1,\"requestId\":\"design-test\",\"minimumSupportedClientBuild\":1}}".utf8)
                let transport = StubTransport([.init(status: 200, body: envelope)])
                let api = APIClient(configuration: .init(environment: APIEnvironment(key: "design-test", baseURL: URL(string: "https://example.invalid")!), clientBuild: 1), transport: transport, tokens: GroupTestTokens())
                let model = GroupsModel(api: api, churchSlug: "grace")
                let window = UIWindow(windowScene: scene); window.frame = scene.screen.bounds
                window.overrideUserInterfaceStyle = scheme == .dark ? .dark : .light
                window.rootViewController = UIHostingController(rootView: NavigationStack {
                    Group {
                        if section == "Info" { GroupInfoScreen(model: model, groupId: group.id) }
                        else if section == "Events" { GroupEventsView(model: model, detail: detail) }
                        else { GroupMembersView(model: model, detail: detail) }
                    }
                }.faithformTheme().environment(\.colorScheme, scheme))
                window.makeKeyAndVisible()
                let deadline = ContinuousClock.now.advanced(by: .seconds(5))
                while await transport.requestCount() == 0 && ContinuousClock.now < deadline { try await Task.sleep(for: .milliseconds(50)) }
                try await Task.sleep(for: .milliseconds(500))
                #expect(await transport.requestCount() == 1)
                #expect(model.error == nil)
                let image = UIGraphicsImageRenderer(bounds: window.bounds).image { _ in window.drawHierarchy(in: window.bounds, afterScreenUpdates: true) }
                let output = directory.appendingPathComponent("\(section.lowercased())-\(scheme == .dark ? "dark" : "light").png")
                try #require(image.pngData()).write(to: output)
                print("GROUP_REDESIGN: \(output.path)")
                window.isHidden = true
            }
        }
    }

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
