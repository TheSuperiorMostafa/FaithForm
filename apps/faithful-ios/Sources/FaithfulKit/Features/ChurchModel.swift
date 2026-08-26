import Foundation
import Observation

/// The church profile's state. Every case is one the contract can produce.
public enum ChurchProfilePhase: Equatable, Sendable {
    case loading
    case loaded(ChurchProfile)
    case notFound
    case offline
    case failed(String)
}

/// What the primary action on a profile should do right now, derived from the
/// church's policy and the caller's own relationship.
///
/// Derived rather than stored, so a relationship that changed on the server
/// cannot leave a stale button behind.
public enum ChurchAction: Equatable, Sendable {
    case follow
    case requestToJoin
    case joinImmediately
    case invitationRequired
    case pending
    case leave
    case unavailable
}

@Observable
@MainActor
public final class ChurchProfileModel {
    public private(set) var phase: ChurchProfilePhase = .loading
    public private(set) var isActing = false
    public private(set) var actionError: String?

    private let api: APIClient
    private let cache: PartitionedCache
    private var etag: String?
    private var partition: CachePartition?

    public init(api: APIClient, cache: PartitionedCache) {
        self.api = api
        self.cache = cache
    }

    public func load(slug: String, partition: CachePartition) async {
        self.partition = partition

        if let cached = await cache.load(ChurchProfile.self, name: "profile-\(slug)", partition: partition),
           cached.freshness(now: Date(), ttl: 300) != .expired {
            phase = .loaded(cached.value)
            etag = cached.etag
        }

        await refresh(slug: slug)
    }

    public func refresh(slug: String) async {
        do {
            let response = try await api.send(
                "api/mobile/v1/churches/\(slug)/profile",
                ifNoneMatch: etag,
                as: ChurchProfile.self
            )

            if response.notModified { return }
            guard let profile = response.value else { return }

            etag = response.etag
            phase = .loaded(profile)

            if let partition {
                try? await cache.store(
                    CacheEntry(value: profile, etag: response.etag, storedAt: Date()),
                    name: "profile-\(slug)",
                    partition: partition
                )
            }
        } catch let error as APIError {
            switch error.code {
            case .notFound:
                // A hidden church and an unknown slug are indistinguishable by
                // design; the app must not imply the difference either.
                phase = .notFound
            case .unavailable:
                if case .loaded = phase { return }
                phase = .offline
            default:
                if case .loaded = phase { return }
                phase = .failed(error.displayMessage)
            }
        } catch {
            if case .loaded = phase { return }
            phase = .offline
        }
    }

    /// The action a profile should offer, given the policy and the relationship.
    public static func action(for profile: ChurchProfile) -> ChurchAction {
        switch profile.relationshipState {
        case .some(.blocked):
            return .unavailable
        case .some(.pending):
            return .pending
        case .some(.joined):
            return .leave
        case .some(.following):
            // Already following: the next step depends on whether joining is
            // even offered.
            switch profile.joinPolicy {
            case .open: return .joinImmediately
            case .approvalRequired: return .requestToJoin
            case .inviteOnly: return .invitationRequired
            default: return .leave
            }
        default:
            switch profile.joinPolicy {
            case .inviteOnly: return .invitationRequired
            default: return .follow
            }
        }
    }

    public func follow(slug: String) async {
        await perform(slug: slug, path: "api/mobile/v1/churches/\(slug)/follow", method: .post)
    }

    public func requestJoin(slug: String) async {
        await perform(slug: slug, path: "api/mobile/v1/churches/\(slug)/join", method: .post)
    }

    public func leave(slug: String) async {
        await perform(slug: slug, path: "api/mobile/v1/churches/\(slug)/follow", method: .delete)
    }

    private func perform(slug: String, path: String, method: APIClient.Method) async {
        isActing = true
        actionError = nil
        defer { isActing = false }

        struct RelationshipReply: Decodable, Sendable {
            let churchSlug: String
            let state: String?
        }

        do {
            _ = try await api.send(path, method: method, as: RelationshipReply.self)
            // The reply is not trusted as the new truth: the profile is
            // re-fetched so what is shown is what the server would serve.
            etag = nil
            await refresh(slug: slug)
        } catch let error as APIError {
            actionError = error.displayMessage
        } catch {
            actionError = nil
        }
    }
}

// ---------------------------------------------------------------------------
// Church chooser
// ---------------------------------------------------------------------------

public struct ChooserChurch: Codable, Hashable, Sendable {
    public let slug: String
    public let name: String
    public let logoUrl: String?
    public let state: RelationshipState

    public init(slug: String, name: String, logoUrl: String?, state: RelationshipState) {
        self.slug = slug
        self.name = name
        self.logoUrl = logoUrl
        self.state = state
    }
}

public enum ChooserPhase: Equatable, Sendable {
    case loading
    case loaded([ChooserChurch])
    case empty
    case offline
    case failed(String)
}

/// Switching between the churches an account belongs to.
///
/// The switch is not just a preference write: it changes which cache partition
/// the app reads from, and the previous church's private content becomes
/// unreadable rather than merely hidden.
@Observable
@MainActor
public final class ChurchChooserModel {
    public private(set) var phase: ChooserPhase = .loading
    public private(set) var selectedSlug: String?
    public private(set) var authorizationVersion: Int

    private let api: APIClient
    private let cache: PartitionedCache
    private let environmentKey: String
    private let accountId: String

    public init(
        api: APIClient,
        cache: PartitionedCache,
        environmentKey: String,
        accountId: String,
        authorizationVersion: Int,
        selectedSlug: String?
    ) {
        self.api = api
        self.cache = cache
        self.environmentKey = environmentKey
        self.accountId = accountId
        self.authorizationVersion = authorizationVersion
        self.selectedSlug = selectedSlug
    }

    struct ChooserPage: Decodable, Sendable { let items: [ChooserChurch] }

    public func load() async {
        phase = .loading
        do {
            let response = try await api.send(
                "api/mobile/v1/churches/chooser",
                as: ChooserPage.self
            )
            let items = response.value?.items ?? []
            phase = items.isEmpty ? .empty : .loaded(items)

            // A selection that no longer names an available church is dropped
            // rather than restored: leaving or being blocked must not survive
            // as a usable preference.
            if let selected = selectedSlug, !items.contains(where: { $0.slug == selected }) {
                selectedSlug = nil
            }
        } catch let error as APIError {
            phase = error.retryable ? .offline : .failed(error.displayMessage)
        } catch {
            phase = .offline
        }
    }

    /// The partition for a given church at the current authorization version.
    public func partition(for slug: String?) -> CachePartition {
        CachePartition(
            environment: environmentKey,
            accountId: accountId,
            churchSlug: slug,
            authorizationVersion: authorizationVersion
        )
    }

    public struct SwitchResult: Equatable, Sendable {
        public let selectedSlug: String?
        public let partition: CachePartition
    }

    /// Selects a church.
    ///
    /// Refuses a church the account has no usable relationship with, and
    /// refuses `blocked` outright — a chooser entry is not authorization, and
    /// the server checks again regardless.
    public func select(slug: String) async -> SwitchResult? {
        guard case let .loaded(items) = phase,
              let church = items.first(where: { $0.slug == slug }),
              church.state != .blocked,
              church.state != .left
        else {
            return nil
        }

        struct SelectRequest: Encodable, Sendable { let churchSlug: String? }
        struct SelectReply: Decodable, Sendable {
            let selectedChurchSlug: String?
            let authorizationVersion: Int
        }

        do {
            let response = try await api.send(
                "api/mobile/v1/account/selected-church",
                method: .put,
                body: SelectRequest(churchSlug: slug),
                as: SelectReply.self
            )
            guard let reply = response.value else { return nil }

            // The server's version is authoritative. If it moved, every cached
            // partition below it is stale and must not be read again.
            if reply.authorizationVersion != authorizationVersion {
                authorizationVersion = reply.authorizationVersion
                await cache.purgeAccount(environment: environmentKey, accountId: accountId)
            }

            selectedSlug = reply.selectedChurchSlug
            return SwitchResult(
                selectedSlug: reply.selectedChurchSlug,
                partition: partition(for: reply.selectedChurchSlug)
            )
        } catch let error as APIError {
            // A relationship revoked since the list was fetched: drop it and
            // reload rather than leaving a stale row selectable.
            if error.code == .blocked || error.code == .notFound {
                await load()
            }
            return nil
        } catch {
            return nil
        }
    }
}
