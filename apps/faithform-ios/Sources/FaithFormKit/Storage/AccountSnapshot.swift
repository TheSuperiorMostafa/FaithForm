import Foundation

/// The last signed-in shell this device painted, kept so a returning visit can
/// open on Home instead of waiting on the network.
///
/// Bootstrap is not a credential — tokens stay in the Keychain — but it is
/// account-scoped, so the file is keyed by environment and account and dropped
/// on sign-out. Church feed rows live in `PartitionedCache`; this is only the
/// shell that decides which tabs exist.
public struct AccountSnapshot: Codable, Sendable {
    public let bootstrap: Bootstrap
    public let onboarding: OnboardingState?
    public let storedAt: Date

    public init(bootstrap: Bootstrap, onboarding: OnboardingState?, storedAt: Date = Date()) {
        self.bootstrap = bootstrap
        self.onboarding = onboarding
        self.storedAt = storedAt
    }

    /// Fresh for five minutes, showable for two weeks, then ignored so a
    /// revoked relationship cannot linger on a phone that has not opened the
    /// app in a long time.
    public func freshness(now: Date = Date()) -> Freshness {
        let age = now.timeIntervalSince(storedAt)
        if age <= 5 * 60 { return .fresh }
        if age <= 14 * 24 * 60 * 60 { return .stale(age: age) }
        return .expired
    }

    public func isDisplayable(now: Date = Date()) -> Bool {
        freshness(now: now) != .expired
    }

    public var isFresh: Bool { freshness() == .fresh }
}

/// Sync file store for [AccountSnapshot]. Launch reads it on the main thread
/// before the first frame so a returning visit never has to wait on an actor.
public final class AccountSnapshotStore: @unchecked Sendable {
    private let directory: URL?
    private let lock = NSLock()

    public init(directory: URL? = nil) {
        self.directory = directory
        if let directory {
            try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        }
    }

    public func load(environment: String, accountId: String) -> AccountSnapshot? {
        lock.lock(); defer { lock.unlock() }
        guard let url = fileURL(environment: environment, accountId: accountId),
              let data = try? Data(contentsOf: url),
              let snapshot = try? JSONDecoder.faithform.decode(AccountSnapshot.self, from: data),
              snapshot.isDisplayable()
        else { return nil }
        return snapshot
    }

    public func store(_ snapshot: AccountSnapshot, environment: String, accountId: String) {
        lock.lock(); defer { lock.unlock() }
        guard let url = fileURL(environment: environment, accountId: accountId),
              let data = try? JSONEncoder.faithform.encode(snapshot)
        else { return }
        let tmp = url.appendingPathExtension("tmp")
        try? data.write(to: tmp, options: .atomic)
        _ = try? FileManager.default.replaceItemAt(url, withItemAt: tmp)
        if !FileManager.default.fileExists(atPath: url.path) {
            try? FileManager.default.moveItem(at: tmp, to: url)
        }
    }

    public func purge(environment: String, accountId: String) {
        lock.lock(); defer { lock.unlock() }
        guard let url = fileURL(environment: environment, accountId: accountId) else { return }
        try? FileManager.default.removeItem(at: url)
    }

    public func purgeAll() {
        lock.lock(); defer { lock.unlock() }
        guard let directory else { return }
        try? FileManager.default.removeItem(at: directory)
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    }

    private func fileURL(environment: String, accountId: String) -> URL? {
        guard let directory else { return nil }
        let safe = "\(environment)-\(accountId)".replacingOccurrences(of: "/", with: "_")
        return directory.appendingPathComponent("\(safe).json")
    }
}
