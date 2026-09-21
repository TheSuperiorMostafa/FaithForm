import Foundation
import FaithFormKit

/// The name this installation goes by on the server, for as long as it exists.
///
/// ## Why it is not in the app's own Keychain service
///
/// Sign-out calls `deleteAll` on that service, deliberately: the session, the
/// PKCE verifier, resume positions and any unsent arrival all go at once. An
/// install id kept there would go with them, and the next sign-in would look
/// like a *new* phone — leaving the old row on the server with a token that
/// still addresses this device, which is exactly the orphan
/// `visitor_device_installations` retires rather than accumulates.
///
/// So it lives in a service of its own. It is not a credential and it
/// identifies no person: the server pairs it with whoever is signed in at the
/// time, which is what lets it retire the row rather than lose it.
///
/// Keychain rather than `UserDefaults` because a reinstall should be a new
/// install only when the person chooses it, and because this app declares no
/// identifier storage in `UserDefaults`. It is per-environment, so a staging
/// build on the same phone is a different installation.
enum InstallIdentity {
    private static let service = "io.faithform.app.install"

    static func current(environmentKey: String) -> String {
        let store = KeychainStore(service: service)
        let key = "install-id.\(environmentKey)"
        if
            let data = try? store.read(key),
            let existing = String(data: data, encoding: .utf8),
            !existing.isEmpty
        {
            return existing
        }
        let created = UUID().uuidString
        // A write that fails leaves a usable id for this launch and tries
        // again on the next one. The server treats an unfamiliar install as a
        // new row, which is worth more than refusing to register at all.
        try? store.write(Data(created.utf8), for: key)
        return created
    }
}
