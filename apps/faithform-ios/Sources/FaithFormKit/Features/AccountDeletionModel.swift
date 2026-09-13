import Foundation
import Observation

/// Deleting an account, from the phone.
///
/// ## Why it is in the app at all
///
/// Apple's guideline 5.1.1(v): an app that lets a person create an account
/// must let them start deleting it from inside the app, not only by email or on
/// a website. This is that path, and it is reachable from every screen a
/// signed-in person can be stuck on — the account tab, the first-run flow, and
/// the "couldn't load your account" state — so nobody needs a church, or a
/// working bootstrap, to leave.
///
/// ## What it sends
///
/// `POST api/mobile/v1/account/requests` with `{ "kind": "deletion" }` and an
/// idempotency key. The server records the request and stops the account
/// working at once; the deletion itself finishes server-side within the
/// window the account-deletion page promises.
///
/// ## Why the key outlives a failure
///
/// The key is minted once per person-initiated deletion and **reused on every
/// retry until one succeeds**. A request whose response was lost on a bad
/// connection did reach the server, and the retry must join it rather than open
/// a second one — which is exactly what the server's per-key lookup does.
///
/// ## What it never does
///
/// Sign out. That is the host's job, and it only happens once this model says
/// the server has the request: a person whose deletion failed must stay signed
/// in, see why, and be able to try again.
@MainActor
@Observable
public final class AccountDeletionModel {
    public enum Phase: Equatable, Sendable {
        case idle
        case working
        case failed(String)
        /// The server has the request. The host signs out from here.
        case requested
    }

    public private(set) var phase: Phase = .idle

    private let api: APIClient
    private let makeIdempotencyKey: @Sendable () -> String
    private var idempotencyKey: String?

    public init(
        api: APIClient,
        makeIdempotencyKey: @escaping @Sendable () -> String = { UUID().uuidString }
    ) {
        self.api = api
        self.makeIdempotencyKey = makeIdempotencyKey
    }

    /// Sends the deletion request. Returns whether the server now has it.
    ///
    /// A second call while one is in flight does nothing and returns false: a
    /// double tap on a confirmation button is one request, not two.
    @discardableResult
    public func requestDeletion() async -> Bool {
        guard phase != .working else { return false }
        phase = .working

        let key = idempotencyKey ?? makeIdempotencyKey()
        idempotencyKey = key

        do {
            let response = try await api.send(
                "api/mobile/v1/account/requests",
                method: .post,
                body: AccountActionRequest(kind: .deletion),
                idempotencyKey: key,
                as: AccountRequest.self
            )
            guard let request = response.value, request.kind == .deletion else {
                // A 2xx with nothing in it is not a request anyone can point to.
                phase = .failed(L.deleteAccountFailedBody)
                return false
            }
            return succeed()
        } catch let error as APIError {
            switch error.code {
            case .accountInactive:
                // The server's word for an account that is already deleted.
                // There is nothing left to request, and staying signed in to a
                // dead account helps nobody.
                return succeed()
            case .unavailable, .internalError:
                // Transport and server faults carry no sentence worth showing;
                // say plainly that nothing happened and a retry is safe.
                phase = .failed(L.deleteAccountFailedBody)
            default:
                phase = .failed(
                    error.displayMessage.isEmpty ? L.deleteAccountFailedBody : error.displayMessage
                )
            }
            return false
        } catch {
            phase = .failed(L.deleteAccountFailedBody)
            return false
        }
    }

    /// The person has read the failure. The key is kept for their next try.
    public func acknowledgeFailure() {
        if case .failed = phase { phase = .idle }
    }

    private func succeed() -> Bool {
        idempotencyKey = nil
        phase = .requested
        return true
    }
}
