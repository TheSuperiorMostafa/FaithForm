import Foundation

/// Where remembered positions live on this device.
///
/// Backed by `SecureStoring` — the Keychain on device — rather than
/// `UserDefaults` or the projection cache. A position is not a secret, but the
/// *set* of them is a record of what this person has been watching, and that
/// belongs somewhere a sign-out can erase completely.
///
/// Three properties the type enforces:
///
///  * **Partitioned**, so a position recorded under one account or one
///    authorization version can never be read back under another.
///  * **Bounded** — at most `ResumePolicy.maxEntries`, nothing older than
///    `ResumePolicy.maxAge` — because a store that never empties is a viewing
///    history by another name.
///  * **Purged**, on sign-out and on any authorization change.
public actor KeychainResumePositionStore: ResumePositionStoring {
    private let store: SecureStoring
    private let prefix = "faithful.resume."

    public init(store: SecureStoring) {
        self.store = store
    }

    public func position(
        for mediaId: String,
        partition: CachePartition,
        now: Date
    ) async -> ResumePosition? {
        // Pruned on read as well as on write: an expired position must not be
        // returned even once, and reading is the moment it is about to be used.
        let entries = ResumePolicy.prune(read(partition), now: now)
        write(entries, partition: partition)
        return entries.first { $0.mediaId == mediaId }
    }

    public func record(
        _ position: ResumePosition,
        partition: CachePartition,
        now: Date
    ) async {
        var entries = read(partition).filter { $0.mediaId != position.mediaId }
        entries.append(position)
        write(ResumePolicy.prune(entries, now: now), partition: partition)
    }

    public func clear(partition: CachePartition) async {
        try? store.delete(key(partition))
    }

    /// Every partition.
    ///
    /// A partition-scoped clear would leave another account's positions on the
    /// device, which is precisely what must not survive a sign-out.
    public func clearAll() async {
        for partition in knownPartitions() {
            try? store.delete(prefix + partition)
        }
        try? store.delete(indexKey)
    }

    // MARK: - Storage

    private var indexKey: String { prefix + "index" }

    private func key(_ partition: CachePartition) -> String {
        prefix + partition.storageKey
    }

    private func read(_ partition: CachePartition) -> [ResumePosition] {
        // `try?` on a throwing function returning `Data?` flattens to one
        // optional, so a single binding is the whole unwrap.
        guard
            let data = try? store.read(key(partition)),
            let decoded = try? JSONDecoder.faithful.decode([ResumePosition].self, from: data)
        else { return [] }
        return decoded
    }

    private func write(_ entries: [ResumePosition], partition: CachePartition) {
        guard let data = try? JSONEncoder.faithful.encode(entries) else { return }
        try? store.write(data, for: key(partition))
        remember(partition.storageKey)
    }

    /// The set of partitions ever written.
    ///
    /// `SecureStoring` cannot enumerate, so `clearAll` needs to know what to
    /// delete. The index holds partition keys — an environment, an account id, a
    /// slug and a version — and is itself deleted by `clearAll`.
    private func knownPartitions() -> [String] {
        guard
            let data = try? store.read(indexKey),
            let decoded = try? JSONDecoder.faithful.decode([String].self, from: data)
        else { return [] }
        return decoded
    }

    private func remember(_ storageKey: String) {
        var known = knownPartitions()
        guard !known.contains(storageKey) else { return }
        known.append(storageKey)
        // Bounded, so a long-lived install cannot grow an unbounded list of
        // every account that ever signed in on this device.
        if known.count > 32 { known = Array(known.suffix(32)) }
        if let data = try? JSONEncoder.faithful.encode(known) {
            try? store.write(data, for: indexKey)
        }
    }
}
