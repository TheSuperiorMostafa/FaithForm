import Foundation
import Observation

/// First-run decisions and invitation redemption.
///
/// The route itself — welcome, chooser, or home — is **computed server-side**
/// by `GET /api/mobile/v1/onboarding`, never inferred here from an empty list,
/// so both platforms agree on the rule. This model fetches that answer and
/// carries the one credential-ish thing the flow holds: an unredeemed
/// invitation token, kept across sign-in and posted only afterwards.
@Observable
@MainActor
public final class OnboardingModel {
    public enum InvitationPhase: Equatable, Sendable {
        case idle
        case working
        case failed(String)
    }

    public private(set) var state: OnboardingState?
    public private(set) var invitationPhase: InvitationPhase = .idle

    /// A token that arrived — by deep link or paste — before it could be used.
    /// Held in memory only: an invitation is not worth persisting past the
    /// launch that received it.
    public private(set) var pendingInvitationToken: String?

    private let api: APIClient
    /// One idempotency key per token, stable across retries of the same
    /// attempt. A single-use invitation must not be burned by a retry that
    /// never saw its response — the key is what lets the server say "already
    /// done" instead of "already used".
    private var idempotencyKeys: [String: String] = [:]

    public init(api: APIClient) {
        self.api = api
    }

    /// Asks the server where first-run stands. Returns nil on failure — the
    /// caller falls back to showing home, because refusing the whole app over
    /// a routing hint would be the worse failure.
    @discardableResult
    public func refresh() async -> OnboardingState? {
        do {
            let response = try await api.send(
                "api/mobile/v1/onboarding",
                as: OnboardingState.self
            )
            state = response.value
            return response.value
        } catch {
            state = nil
            return nil
        }
    }

    public func hold(invitationToken: String) {
        pendingInvitationToken = normalize(invitationToken)
    }

    public func clearPendingInvitation() {
        pendingInvitationToken = nil
    }

    /// Accepts what a person pasted: a bare token, or the full invitation link
    /// their church sent. Extracting here means the screen can say "paste your
    /// invitation link" and mean it.
    public func normalize(_ raw: String) -> String {
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        if let url = URL(string: trimmed), let token = InvitationLink.token(from: url) {
            return token
        }
        // Links from the dashboard end in /invite/<token>; take the last path
        // piece when it plausibly is one.
        if trimmed.contains("/"), let last = trimmed.split(separator: "/").last,
           last.count >= 16 {
            return String(last)
        }
        return trimmed
    }

    /// Redeems an invitation. On success the relationship exists server-side;
    /// the caller reloads bootstrap so what is shown is what the server holds.
    public func acceptInvitation(_ raw: String) async -> Bool {
        let token = normalize(raw)

        guard token.count >= 16, token.count <= 512 else {
            invitationPhase = .failed(L.invitationErrorInvalid)
            return false
        }

        let key: String
        if let existing = idempotencyKeys[token] {
            key = existing
        } else {
            key = UUID().uuidString
            idempotencyKeys[token] = key
        }

        struct AcceptRequest: Encodable, Sendable { let token: String }
        struct AcceptReply: Decodable, Sendable {
            let churchSlug: String?
            let state: String?
        }

        invitationPhase = .working
        do {
            _ = try await api.send(
                "api/mobile/v1/invitations/accept",
                method: .post,
                body: AcceptRequest(token: token),
                idempotencyKey: key,
                as: AcceptReply.self
            )
            invitationPhase = .idle
            if pendingInvitationToken == token { pendingInvitationToken = nil }
            return true
        } catch let error as APIError {
            invitationPhase = .failed(Self.invitationMessage(for: error))
            return false
        } catch {
            invitationPhase = .failed(L.authErrorOffline)
            return false
        }
    }

    static func invitationMessage(for error: APIError) -> String {
        switch error.code {
        case .invitationExpired: return L.invitationErrorExpired
        case .notFound, .invalidRequest: return L.invitationErrorInvalid
        case .blocked: return L.blockedBody
        case .unavailable: return L.authErrorOffline
        default: return error.displayMessage
        }
    }

    /// Records acceptance of the current policy versions.
    ///
    /// Called only when the profile carries **no** accepted version — the
    /// person was just shown the agreement sentence on the account screen, so
    /// recording it is stating a fact. A *changed* version is deliberately not
    /// auto-accepted here: agreeing to terms someone has never seen is not
    /// something a client does on their behalf.
    public func recordInitialConsent(for bootstrap: Bootstrap) async {
        guard bootstrap.profile.termsVersion == nil
            || bootstrap.profile.privacyVersion == nil else { return }

        struct ConsentRequest: Encodable, Sendable {
            let termsVersion: String
            let privacyVersion: String
        }
        struct ConsentReply: Decodable, Sendable { let termsVersion: String? }

        _ = try? await api.send(
            "api/mobile/v1/account/consent",
            method: .post,
            body: ConsentRequest(
                termsVersion: bootstrap.requiredTermsVersion,
                privacyVersion: bootstrap.requiredPrivacyVersion
            ),
            as: ConsentReply.self
        )
    }
}
