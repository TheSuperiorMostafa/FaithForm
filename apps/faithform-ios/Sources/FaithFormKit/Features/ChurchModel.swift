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

/// What the church page offers right now, derived from the church's policy,
/// the caller's relationship with it, and whether the account already has a
/// *different* church.
///
/// One church per account: adding a church makes it the only one, so the
/// choice is never follow-versus-join — it is "add", "replace the one you
/// have", or nothing at all. Derived rather than stored, so a relationship
/// that changed on the server cannot leave a stale button behind.
public enum ChurchAction: Equatable, Sendable {
    /// No church yet: "Add church".
    case add
    /// Another church is this account's church: "Make this my church", after
    /// a confirmation that names the one being replaced.
    case replace
    /// This is already the account's church. No primary button; the page
    /// offers changing or removing it instead.
    case current
    /// The church adds people by invitation only.
    case invitationRequired
    /// Blocked. Explained, never actionable.
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
            if error.isCancellation { return }
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
            if error.isCancellation { return }
            if case .loaded = phase { return }
            phase = .offline
        }
    }

    /// The action the church page offers. First match wins:
    ///
    /// | Condition                             | Action               |
    /// |---------------------------------------|----------------------|
    /// | blocked                               | `unavailable`        |
    /// | following, pending or joined          | `current`            |
    /// | the church is invite-only             | `invitationRequired` |
    /// | the account has a different church    | `replace`            |
    /// | otherwise                             | `add`                |
    ///
    /// `left`, an unrecognised state and no state at all are "no relationship".
    public static func action(for profile: ChurchProfile, hasOtherChurch: Bool) -> ChurchAction {
        switch profile.relationshipState {
        case .some(.blocked):
            return .unavailable
        case .some(.following), .some(.pending), .some(.joined):
            return .current
        default:
            break
        }
        if profile.joinPolicy == .inviteOnly { return .invitationRequired }
        return hasOtherChurch ? .replace : .add
    }

    /// Makes this church the account's only church. The server releases any
    /// other church and selects this one; it is idempotent for the church the
    /// account already has.
    ///
    /// Returns whether the server agreed, so the host can move on only then.
    @discardableResult
    public func add(slug: String) async -> Bool {
        await perform(
            slug: slug,
            path: "api/mobile/v1/churches/\(slug)/follow",
            method: .post,
            refreshAfter: true
        )
    }

    /// Removes this church. The account has no church afterwards.
    ///
    /// The profile is deliberately not re-fetched: the host reloads the
    /// account next, which ends on first-run, and a church that is not listed
    /// publicly would answer "not found" for the instant in between.
    @discardableResult
    public func remove(slug: String) async -> Bool {
        await perform(
            slug: slug,
            path: "api/mobile/v1/churches/\(slug)/follow",
            method: .delete,
            refreshAfter: false
        )
    }

    private func perform(
        slug: String,
        path: String,
        method: APIClient.Method,
        refreshAfter: Bool
    ) async -> Bool {
        isActing = true
        actionError = nil
        defer { isActing = false }

        struct RelationshipReply: Decodable, Sendable {
            let churchSlug: String
            let state: String?
        }

        do {
            _ = try await api.send(path, method: method, as: RelationshipReply.self)
            if refreshAfter {
                // The reply is not trusted as the new truth: the profile is
                // re-fetched so what is shown is what the server would serve.
                etag = nil
                await refresh(slug: slug)
            }
            return true
        } catch let error as APIError {
            if error.isCancellation { return false }
            actionError = error.displayMessage
            return false
        } catch {
            actionError = nil
            return false
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
        if case .loaded = phase { return }
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
            if error.isCancellation { return }
            phase = error.retryable ? .offline : .failed(error.displayMessage)
        } catch {
            if error.isCancellation { return }
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
                phase = .loading
                await load()
            }
            return nil
        } catch {
            return nil
        }
    }
}
