import CryptoKit
import Foundation

/// SHA-256, for deriving stable identifiers.
///
/// Used to build idempotency keys from account and occurrence identifiers.
/// **Not a security boundary**: it is a deterministic name, not a secret, and
/// nothing here is presented as authentication. It exists so a key can be
/// regenerated identically after the app is terminated and relaunched, without
/// persisting anything.
///
/// Hashing rather than concatenating keeps a People-adjacent identifier out of
/// a value that travels in a request header, and gives a fixed-length key
/// whatever the inputs.
public enum FaithfulDigest {
    public static func sha256Hex(_ value: String) -> String {
        SHA256.hash(data: Data(value.utf8))
            .map { String(format: "%02x", $0) }
            .joined()
    }
}
