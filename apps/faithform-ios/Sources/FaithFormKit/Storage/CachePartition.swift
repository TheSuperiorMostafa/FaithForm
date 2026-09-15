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

    /// True when the value may be drawn. Expired entries stay on disk until
    /// eviction so a 304 can still revalidate them, but they are not shown.
    public func isDisplayable(now: Date = Date(), ttl: TimeInterval = 300) -> Bool {
        freshness(now: now, ttl: ttl) != .expired
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
///
/// When a `directory` is supplied, payloads are written through to disk and
/// loaded lazily on miss, so a killed process still has last night's feed.
/// Tokens never live here.
public actor PartitionedCache {
    private struct Key: Hashable { let partition: String; let name: String }
    private struct MemoryEntry {
        var data: Data?
        var storedAt: Date
    }
    private struct DiskIndex: Codable {
        var items: [DiskIndexItem]
    }
    private struct DiskIndexItem: Codable {
        var partition: String
        var name: String
        var storedAt: Date
    }

    private var entries: [Key: MemoryEntry] = [:]
    private let maxEntries: Int
    private let directory: URL?

    public init(maxEntries: Int = 200, directory: URL? = nil) {
        self.maxEntries = maxEntries
        self.directory = directory
        if let directory {
            let files = FileManager.default
            try? files.createDirectory(at: directory, withIntermediateDirectories: true)
            try? files.createDirectory(
                at: directory.appendingPathComponent("data", isDirectory: true),
                withIntermediateDirectories: true
            )
            if let data = try? Data(contentsOf: directory.appendingPathComponent("index.json")),
               let index = try? JSONDecoder().decode(DiskIndex.self, from: data) {
                for item in index.items {
                    entries[Key(partition: item.partition, name: item.name)] =
                        MemoryEntry(data: nil, storedAt: item.storedAt)
                }
            }
        }
    }

    public func store<Value: Codable & Sendable>(
        _ entry: CacheEntry<Value>,
        name: String,
        partition: CachePartition
    ) throws {
        let key = Key(partition: partition.storageKey, name: name)
        let encoded = try JSONEncoder().encode(entry)
        entries[key] = MemoryEntry(data: encoded, storedAt: entry.storedAt)
        writeFile(encoded, for: key)
        persistIndex()
        evictIfNeeded()
    }

    public func load<Value: Codable & Sendable>(
        _ type: Value.Type,
        name: String,
        partition: CachePartition
    ) -> CacheEntry<Value>? {
        let key = Key(partition: partition.storageKey, name: name)
        guard var stored = entries[key] else { return nil }
        if stored.data == nil {
            guard let data = readFile(for: key) else {
                entries.removeValue(forKey: key)
                persistIndex()
                return nil
            }
            stored.data = data
            entries[key] = stored
        }
        guard let data = stored.data else { return nil }
        return try? JSONDecoder().decode(CacheEntry<Value>.self, from: data)
    }

    /// Drops one partition — used when a church relationship is revoked.
    public func purge(partition: CachePartition) {
        removeMatching { $0.partition == partition.storageKey }
    }

    /// Drops everything belonging to an account, across every church and
    /// authorization version. This is what sign-out and account removal call.
    public func purgeAccount(environment: String, accountId: String) {
        let prefix = "\(environment)|\(accountId)|"
        removeMatching { $0.partition.hasPrefix(prefix) }
    }

    /// Drops everything that is not the anonymous public partition.
    public func purgeAllPrivate() {
        removeMatching { !$0.partition.contains("|anonymous|") }
    }

    public func purgeAll() {
        removeMatching { _ in true }
    }

    public func count() -> Int { entries.count }

    private func evictIfNeeded() {
        guard entries.count > maxEntries else { return }
        let ordered = entries.sorted { $0.value.storedAt < $1.value.storedAt }
        for (key, _) in ordered.prefix(entries.count - maxEntries) {
            removeFile(for: key)
            entries.removeValue(forKey: key)
        }
        persistIndex()
    }

    private func removeMatching(_ predicate: (Key) -> Bool) {
        let doomed = entries.keys.filter(predicate)
        for key in doomed {
            removeFile(for: key)
            entries.removeValue(forKey: key)
        }
        persistIndex()
    }

    private func persistIndex() {
        guard let directory else { return }
        let index = DiskIndex(
            items: entries.map { key, value in
                DiskIndexItem(partition: key.partition, name: key.name, storedAt: value.storedAt)
            }
        )
        guard let data = try? JSONEncoder().encode(index) else { return }
        let url = directory.appendingPathComponent("index.json")
        try? data.write(to: url, options: .atomic)
    }

    private func dataURL(for key: Key) -> URL? {
        directory?
            .appendingPathComponent("data", isDirectory: true)
            .appendingPathComponent(diskFileName(partition: key.partition, name: key.name))
    }

    private func writeFile(_ data: Data, for key: Key) {
        guard let url = dataURL(for: key) else { return }
        try? data.write(to: url, options: .atomic)
    }

    private func readFile(for key: Key) -> Data? {
        guard let url = dataURL(for: key) else { return nil }
        return try? Data(contentsOf: url)
    }

    private func removeFile(for key: Key) {
        guard let url = dataURL(for: key) else { return }
        try? FileManager.default.removeItem(at: url)
    }
}

private func diskFileName(partition: String, name: String) -> String {
    var hash: UInt64 = 5381
    for byte in "\(partition)\u{0}\(name)".utf8 {
        hash = hash &* 33 &+ UInt64(byte)
    }
    return String(format: "%016llx", hash)
}
