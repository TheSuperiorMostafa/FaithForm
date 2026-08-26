import Foundation
import Security

/// Where authentication material lives.
///
/// Keychain only. Tokens never touch `UserDefaults`, the response cache, or a
/// file the backup system would sweep up — `kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly`
/// keeps them off a restored backup on a different device entirely.
public protocol SecureStoring: Sendable {
    func read(_ key: String) throws -> Data?
    func write(_ data: Data, for key: String) throws
    func delete(_ key: String) throws
    /// Removes every item this app owns. Used on sign-out and account removal.
    func deleteAll() throws
}

public struct KeychainStore: SecureStoring {
    private let service: String

    public init(service: String) { self.service = service }

    private func baseQuery(_ key: String? = nil) -> [String: Any] {
        var query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service
        ]
        if let key { query[kSecAttrAccount as String] = key }
        return query
    }

    public func read(_ key: String) throws -> Data? {
        var query = baseQuery(key)
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne

        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess else { throw KeychainError(status: status) }
        return item as? Data
    }

    public func write(_ data: Data, for key: String) throws {
        let query = baseQuery(key)
        let attributes: [String: Any] = [
            kSecValueData as String: data,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        ]

        let updateStatus = SecItemUpdate(query as CFDictionary, attributes as CFDictionary)
        if updateStatus == errSecSuccess { return }
        if updateStatus != errSecItemNotFound { throw KeychainError(status: updateStatus) }

        var insert = query
        insert.merge(attributes) { current, _ in current }
        let addStatus = SecItemAdd(insert as CFDictionary, nil)
        guard addStatus == errSecSuccess else { throw KeychainError(status: addStatus) }
    }

    public func delete(_ key: String) throws {
        let status = SecItemDelete(baseQuery(key) as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else {
            throw KeychainError(status: status)
        }
    }

    public func deleteAll() throws {
        let status = SecItemDelete(baseQuery() as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else {
            throw KeychainError(status: status)
        }
    }
}

public struct KeychainError: Error, Sendable {
    public let status: OSStatus
}

/// In-memory double for tests. Deliberately not usable as a real store: it has
/// no persistence, so no test can accidentally validate insecure storage.
public final class InMemorySecureStore: SecureStoring, @unchecked Sendable {
    private var storage: [String: Data] = [:]
    private let lock = NSLock()

    public init() {}

    public func read(_ key: String) throws -> Data? {
        lock.lock(); defer { lock.unlock() }
        return storage[key]
    }
    public func write(_ data: Data, for key: String) throws {
        lock.lock(); defer { lock.unlock() }
        storage[key] = data
    }
    public func delete(_ key: String) throws {
        lock.lock(); defer { lock.unlock() }
        storage.removeValue(forKey: key)
    }
    public func deleteAll() throws {
        lock.lock(); defer { lock.unlock() }
        storage.removeAll()
    }
    public func isEmpty() -> Bool {
        lock.lock(); defer { lock.unlock() }
        return storage.isEmpty
    }
}
