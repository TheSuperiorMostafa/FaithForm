import Foundation
import Observation

/// One authenticated church scope. No chat credentials or group data are persisted.
@Observable @MainActor
public final class GroupsModel {
    public let churchSlug: String
    public let api: APIClient
    public private(set) var home: MyGroups?
    public private(set) var discovered: [GroupSummary] = []
    public private(set) var nextCursor: String?
    public private(set) var filters: GroupFilters?
    public private(set) var loading = false
    public private(set) var busy = false
    public var error: String?
    public var feedback: String?
    /// The people this person has blocked, by chat user id.
    ///
    /// The provider's own block applies to direct messages only, so without
    /// this a blocked person's messages still appear in every group both people
    /// are in — and blocking someone who is abusive in a group is exactly what
    /// App Store guideline 1.2 asks an app to offer. The conversation reads
    /// this to hide those messages; the server list is what it is loaded from,
    /// and it is refreshed whenever a block or unblock succeeds.
    public private(set) var blockedChatUserIds: Set<String> = []
    private var searchGeneration = 0

    public init(api: APIClient, churchSlug: String) { self.api = api; self.churchSlug = churchSlug }
    public var path: String { "api/mobile/v1/groups/\(churchSlug)" }
    public var messagingPath: String { "api/mobile/v1/messaging/\(churchSlug)" }

    public func read<T: Decodable & Sendable>(_ route: String, query: [String: String] = [:], as: T.Type) async throws -> T {
        let response = try await api.send(route, query: query, as: T.self)
        guard let value = response.value else { throw APIError(code: .internalError, message: "Please try again.") }
        return value
    }
    public func send<T: Decodable & Sendable>(_ route: String, method: APIClient.Method = .post, body: (any Encodable & Sendable)? = nil, key: String? = nil, as: T.Type) async throws -> T {
        let response = try await api.send(route, method: method, body: body, idempotencyKey: key, as: T.self)
        guard let value = response.value else { throw APIError(code: .internalError, message: "Please try again.") }
        return value
    }
    public func load() async {
        loading = home == nil; error = nil
        defer { loading = false }
        do {
            home = try await read(path, as: MyGroups.self)
            filters = try await read("\(path)/filters", as: GroupFilters.self)
        } catch is CancellationError {} catch { self.error = Self.message(error) }
    }
    public func discover(query: String, type: String = "", more: Bool = false) async {
        searchGeneration += 1; let generation = searchGeneration
        var parameters = ["q": query, "type": type, "limit": "20"]
        if more, let nextCursor { parameters["cursor"] = nextCursor }
        if !more { loading = true }
        error = nil
        do {
            let page = try await read("\(path)/discover", query: parameters, as: GroupDiscoveryPage.self)
            guard generation == searchGeneration, !Task.isCancelled else { return }
            discovered = more ? discovered + page.items.filter { item in !discovered.contains { $0.id == item.id } } : page.items
            nextCursor = page.nextCursor
        } catch is CancellationError {} catch { if generation == searchGeneration { self.error = Self.message(error) } }
        if generation == searchGeneration { loading = false }
    }
    /// Replaces the blocked set from a list the server returned.
    public func applyBlocked(_ list: ChatBlockList) {
        blockedChatUserIds = Set(list.items.map(\.chatUserId))
    }
    /// Loads the blocked set, quietly: a conversation that cannot reach the
    /// list should still open, and it shows every message when it does.
    public func loadBlocked() async {
        do { applyBlocked(try await read("\(messagingPath)/blocks", as: ChatBlockList.self)) }
        catch is CancellationError {} catch {}
    }

    @discardableResult public func perform(_ success: String, operation: () async throws -> Void) async -> Bool {
        guard !busy else { return false }; busy = true; error = nil; feedback = nil
        defer { busy = false }
        do { try await operation(); feedback = success.isEmpty ? nil : success; return true }
        catch is CancellationError { return false }
        catch { self.error = Self.message(error); return false }
    }
    public func changeMembership(_ group: GroupSummary, message: String = "") async -> Bool {
        // Joining has its own “You’re in” card. Leaving uses the shared,
        // lightweight notification acknowledgment shown after the route closes.
        await perform(group.joinAction == "leave" ? "You left the group." : "") {
            let leaving = ["leave", "cancel_request"].contains(group.joinAction)
            let result = try await self.send("\(self.path)/\(group.id)/\(leaving ? "leave" : "join")", body: JoinGroupRequest(message: message), as: GroupJoinResult.self)
            let allowed = ["joined", "already_member", "requested", "already_requested", "left", "request_cancelled", "not_member"]
            guard allowed.contains(result.outcome) else { throw APIError(code: .invalidRequest, message: Self.outcomeMessage(result.outcome)) }
            self.home = try await self.read(self.path, as: MyGroups.self)
        }
    }
    public static func outcomeMessage(_ value: String) -> String {
        switch value {
        case "full": "This group is full. Please check back or find another group."
        case "closed": "This group isn’t accepting new members right now."
        case "invitation_required", "invitation_invalid": "Ask a group leader for a current invitation link."
        case "banned", "requester_unavailable", "not_found": "This action is no longer available. Refresh to see the latest details."
        default: "We couldn’t complete that change. Please refresh and try again."
        }
    }
    public static func message(_ error: Error) -> String { (error as? APIError)?.message ?? "We couldn’t connect. Please try again." }
}
