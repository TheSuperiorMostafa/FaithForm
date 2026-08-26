import Foundation

/// The open logical attempt, in the Keychain.
///
/// An attempt holds an attempt id and, briefly, a position — so it lives in the
/// same Keychain-backed store as credentials rather than in `UserDefaults` or
/// the projection cache. Partitioned like everything else, so an attempt opened
/// under one account or one authorization version can never be read back under
/// another.
///
/// **Atomicity is the whole contract.** `openIfAbsent` is what makes two
/// simultaneous region callbacks produce one attempt instead of two with
/// different keys. Actor isolation provides it: the read and the write happen
/// with no suspension point between them.
public actor KeychainAttemptStore: AttendanceAttemptStoring {
    private let secureStore: any SecureStoring
    private let encoder = JSONEncoder()
    private let decoder = JSONDecoder()

    public init(secureStore: any SecureStoring) {
        self.secureStore = secureStore
    }

    private func key(_ partition: CachePartition) -> String {
        "faithful.attendance.attempt.\(partition.storageKey)"
    }

    public func current(partition: CachePartition, now: Date) async -> LogicalAttempt? {
        // `read` throws *and* returns an optional, so both have to unwrap.
        guard let stored = (try? secureStore.read(key(partition))) ?? nil,
              let attempt = try? decoder.decode(LogicalAttempt.self, from: stored)
        else { return nil }

        // An expired attempt is not returned *and* is purged on the way past:
        // it may hold a position, and holding one past its retention window is
        // exactly what the bound exists to prevent.
        if attempt.isExpired(now: now) {
            try? secureStore.delete(key(partition))
            return nil
        }
        return attempt
    }

    public func openIfAbsent(
        _ candidate: LogicalAttempt,
        partition: CachePartition,
        now: Date
    ) async -> LogicalAttempt {
        if let existing = await current(partition: partition, now: now),
           existing.covers(
               churchSlug: candidate.churchSlug,
               occurrenceId: candidate.occurrenceId,
               now: now
           ) {
            // A duplicate callback joins the attempt already in progress.
            return existing
        }

        // Either nothing was open, or what was open belongs to a different
        // service. Replacing it is right: the evening service must never
        // inherit the morning's identity.
        await write(candidate, partition: partition)
        return candidate
    }

    public func update(_ attempt: LogicalAttempt, partition: CachePartition) async {
        await write(attempt, partition: partition)
    }

    public func close(partition: CachePartition) async {
        try? secureStore.delete(key(partition))
    }

    private func write(_ attempt: LogicalAttempt, partition: CachePartition) async {
        guard let data = try? encoder.encode(attempt) else { return }
        // A write failure leaves no attempt open, so the next callback opens a
        // fresh one. Losing an id is survivable; inventing one is not.
        try? secureStore.write(data, for: key(partition))
    }
}
