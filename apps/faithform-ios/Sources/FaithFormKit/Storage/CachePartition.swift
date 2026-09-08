import Foundation

/// Which bucket a cached value belongs to.
///
/// The identity is the whole point: a cache entry is only valid for one
/// environment, one account, one authorization version and — where the data is
/// church-scoped — one church. Any change to any of those yields a different
/// key, so stale data from a revoked relationship can never be read back.
public struct CachePartition: Hashable, Sendable {
    public let environment: String
    public let accountId: String?
    public let churchSlug: String?
    public let authorizationVersion: Int

    public init(
        environment: String,
        accountId: String?,
        churchSlug: String? = nil,
        authorizationVersion: Int
    ) {
        self.environment = environment
        self.accountId = accountId
        self.churchSlug = churchSlug
        self.authorizationVersion = authorizationVersion
    }

    /// Anonymous, identical for everyone. Never mixed with account data.
    public static func publicPartition(environment: String) -> CachePartition {
        CachePartition(environment: environment, accountId: nil, authorizationVersion: 0)
    }

    public var isPublic: Bool { accountId == nil }

    /// Stable, filesystem-safe, and unambiguous: the separator cannot appear in
    /// a slug or a uuid, so two different partitions cannot collide.
    public var storageKey: String {
        [
            environment,
            accountId ?? "anonymous",
            churchSlug ?? "-",
            String(authorizationVersion)
        ].joined(separator: "|")
    }
}

public struct CacheEntry<Value: Codable & Sendable>: Codable, Sendable {
    public let value: Value
    public let etag: String?
    public let storedAt: Date

    public init(value: Value, etag: String?, storedAt: Date) {
        self.value = value
        self.etag = etag
        self.storedAt = storedAt
    }

    public func freshness(now: Date, ttl: TimeInterval) -> Freshness {
        let age = now.timeIntervalSince(storedAt)
        if age <= ttl { return .fresh }
        // Beyond the hard limit the value is not shown at all, even labelled.
        if age <= ttl * 12 { return .stale(age: age) }
        return .expired
    }
}

public enum Freshness: Sendable, Equatable {
    case fresh
    /// Displayable, but must be labelled with its age rather than presented as current.
    case stale(age: TimeInterval)
    case expired
}

/// A bounded, partition-aware cache.
///
/// Eviction is deterministic (oldest first, by stored time) so behaviour under
/// pressure is testable rather than dependent on system memory conditions.
public actor PartitionedCache {
    private struct Key: Hashable { let partition: String; let name: String }

    private var entries: [Key: (data: Data, storedAt: Date)] = [:]
    private let maxEntries: Int

    public init(maxEntries: Int = 200) { self.maxEntries = maxEntries }

    public func store<Value: Codable & Sendable>(
        _ entry: CacheEntry<Value>,
        name: String,
        partition: CachePartition
    ) throws {
        let key = Key(partition: partition.storageKey, name: name)
        entries[key] = (try JSONEncoder().encode(entry), entry.storedAt)
        evictIfNeeded()
    }

    public func load<Value: Codable & Sendable>(
        _ type: Value.Type,
        name: String,
        partition: CachePartition
    ) -> CacheEntry<Value>? {
        let key = Key(partition: partition.storageKey, name: name)
        guard let stored = entries[key] else { return nil }
        return try? JSONDecoder().decode(CacheEntry<Value>.self, from: stored.data)
    }

    /// Drops one partition — used when a church relationship is revoked.
    public func purge(partition: CachePartition) {
        entries = entries.filter { $0.key.partition != partition.storageKey }
    }

    /// Drops everything belonging to an account, across every church and
    /// authorization version. This is what sign-out and account removal call.
    public func purgeAccount(environment: String, accountId: String) {
        let prefix = "\(environment)|\(accountId)|"
        entries = entries.filter { !$0.key.partition.hasPrefix(prefix) }
    }

    /// Drops everything that is not the anonymous public partition.
    public func purgeAllPrivate() {
        entries = entries.filter { $0.key.partition.contains("|anonymous|") }
    }

    public func purgeAll() { entries.removeAll() }

    public func count() -> Int { entries.count }

    private func evictIfNeeded() {
        guard entries.count > maxEntries else { return }
        let ordered = entries.sorted { $0.value.storedAt < $1.value.storedAt }
        for (key, _) in ordered.prefix(entries.count - maxEntries) {
            entries.removeValue(forKey: key)
        }
    }
}
