import Foundation
import Observation

/// First-run decisions and invitation redemption.
///
/// The route itself — welcome, chooser, or home — is **computed server-side**
/// by `GET /api/mobile/v1/onboarding`, never inferred here from an empty list,
/// so both platforms agree on the rule. This model fetches that answer and
/// carries the one credential-ish thing the flow holds: an unredeemed
/// invitation token, kept across sign-in and posted only afterwards.
/// A church identified *before* sign-in.
///
/// This is what makes the signed-out screens say "Join Grace Community" over
/// the right logo instead of naming the product to someone who came for their
/// church. It arrives from a link — an invitation, or a plain church link — and
/// is resolved against the server, never taken from the URL itself: a link may
/// say which church, and may not say what that church is called.
public struct PendingChurchContext: Equatable, Sendable {
    public let churchSlug: String
    public let churchName: String
    public let logoUrl: String?
    /// Present only when the context came from an invitation.
    ///
    /// The distinction decides what happens after sign-in. A token is consent
    /// already given — the person was invited and tapped the link — so it is
    /// redeemed and the relationship exists. A slug carries no authority at
    /// all: it opens the church's own screen and lets the person choose, which
    /// is the difference between arriving somewhere and being enrolled in it.
    public let invitationToken: String?

    public var isInvitation: Bool { invitationToken != nil }

    public init(
        churchSlug: String,
        churchName: String,
        logoUrl: String?,
        invitationToken: String?
    ) {
        self.churchSlug = churchSlug
        self.churchName = churchName
        self.logoUrl = logoUrl
        self.invitationToken = invitationToken
    }
}

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

    /// The church this launch is *about*, when a link named one. Held beside
    /// the token rather than inside it because a church link carries a context
    /// with no token at all.
    public private(set) var churchContext: PendingChurchContext?

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

    /// Names the church behind a held invitation, without spending it.
    ///
    /// Unauthenticated by design: the whole point is to brand the screens a
    /// person sees *before* they have a session. Failure is silent and leaves
    /// the context nil — an expired link should still lead to a working sign-up
    /// screen with the ordinary wording, not a dead end.
    public func resolveChurchContext(invitationToken token: String) async {
        let normalized = normalize(token)
        guard normalized.count >= 16, normalized.count <= 512 else { return }

        struct PreviewRequest: Encodable, Sendable { let token: String }
        guard let preview = try? await api.send(
            "api/mobile/v1/invitations/preview",
            method: .post,
            body: PreviewRequest(token: normalized),
            authenticated: false,
            as: InvitationPreview.self
        ).value else { return }

        churchContext = PendingChurchContext(
            churchSlug: preview.churchSlug,
            churchName: preview.churchName,
            logoUrl: preview.logoUrl,
            invitationToken: normalized
        )
    }

    /// Names the church behind a plain `faithful://church/<slug>` link.
    ///
    /// Only a discoverable church resolves here — the public profile endpoint
    /// refuses to confirm that an unlisted one exists, and that refusal is the
    /// point. An unlisted church reaches this screen through an invitation,
    /// where the token is the authority.
    public func resolveChurchContext(churchSlug slug: String) async {
        guard let profile = try? await api.send(
            "api/mobile/v1/churches/\(slug)/profile",
            authenticated: false,
            as: ChurchProfile.self
        ).value else { return }

        churchContext = PendingChurchContext(
            churchSlug: profile.slug,
            churchName: profile.name,
            logoUrl: profile.logoUrl,
            invitationToken: nil
        )
    }

    /// "Not your church?" — and everything the link brought with it goes, the
    /// held token included. A context the person has disowned must not quietly
    /// redeem itself the moment they finish signing up.
    public func clearChurchContext() {
        if let token = churchContext?.invitationToken, pendingInvitationToken == token {
            pendingInvitationToken = nil
        }
        churchContext = nil
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
