import Foundation
import Observation

/// Where the sign-in flow currently is. Every case is a real state: working
/// disables the form, checkEmail is signup's "confirm first" outcome,
/// confirmingEmail is a confirmation link being exchanged, and failed carries
/// the sentence to show — never a provider string.
public enum AuthPhase: Equatable, Sendable {
    case idle
    case working
    case checkEmail
    case confirmingEmail
    case failed(String)
}

/// Creating an account and signing in.
///
/// The model validates locally, calls the identity provider through
/// `SessionAuthenticating`, and hands a finished `StoredSession` to
/// `onAuthenticated` — adopting it into the keychain and reloading the app is
/// the composition root's job, not a form's. Cancelling is nothing more than
/// leaving: no state below this survives dismissal.
@Observable
@MainActor
public final class AuthModel {
    public var name: String = ""
    public var email: String = ""
    public var password: String = ""

    public private(set) var phase: AuthPhase = .idle
    /// Set after a reset email was requested; the same sentence whether or not
    /// the address has an account, so the form cannot test addresses.
    public private(set) var resetNoticeVisible = false

    /// The address "check your email" is about.
    ///
    /// Captured when signup succeeded rather than read from `email`, which stays
    /// editable: a screen that says where a link was sent must keep saying the
    /// address it was actually sent to.
    public private(set) var confirmationEmail = ""
    /// Set after a confirmation email was sent again, so the screen can
    /// acknowledge the tap rather than looking inert.
    public private(set) var resendNoticeVisible = false
    /// Resending has its **own** in-flight flag rather than borrowing `phase`.
    /// `phase` is what decides whether the check-your-email screen is showing
    /// at all, so moving it to `.working` for a resend would replace that
    /// screen with the signup form mid-tap.
    public private(set) var isResending = false
    /// Likewise its own error: a rate-limited resend is a note on this screen,
    /// not a failed signup.
    public private(set) var resendError: String?

    private let auth: SessionAuthenticating?
    private let onAuthenticated: @MainActor (StoredSession, _ displayName: String?) async -> Void

    public init(
        auth: SessionAuthenticating?,
        onAuthenticated: @escaping @MainActor (StoredSession, _ displayName: String?) async -> Void
    ) {
        self.auth = auth
        self.onAuthenticated = onAuthenticated
    }

    private var trimmedEmail: String {
        email.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private var trimmedName: String? {
        let value = name.trimmingCharacters(in: .whitespacesAndNewlines)
        return value.isEmpty ? nil : value
    }

    /// The one local rule worth having: don't send a request that cannot
    /// possibly succeed. Everything subtler is the server's call.
    private func validate(forSignUp: Bool) -> String? {
        if trimmedEmail.isEmpty || !trimmedEmail.contains("@") {
            return L.authErrorEmailInvalid
        }
        if password.isEmpty { return L.authErrorPasswordMissing }
        if forSignUp && password.count < 8 { return L.authErrorWeakPassword }
        return nil
    }

    public func createAccount() async {
        guard let auth else {
            phase = .failed(L.authErrorUnconfigured)
            return
        }
        if let problem = validate(forSignUp: true) {
            phase = .failed(problem)
            return
        }

        phase = .working
        do {
            switch try await auth.signUp(email: trimmedEmail, password: password) {
            case let .session(session):
                await onAuthenticated(session, trimmedName)
                phase = .idle
            case .confirmationRequired:
                confirmationEmail = trimmedEmail
                phase = .checkEmail
            }
        } catch let failure as AuthFailure {
            phase = .failed(failure.message)
        } catch {
            phase = .failed(L.authErrorGeneric)
        }
    }

    public func signIn() async {
        guard let auth else {
            phase = .failed(L.authErrorUnconfigured)
            return
        }
        if let problem = validate(forSignUp: false) {
            phase = .failed(problem)
            return
        }

        phase = .working
        do {
            let session = try await auth.signIn(email: trimmedEmail, password: password)
            await onAuthenticated(session, nil)
            phase = .idle
        } catch let failure as AuthFailure {
            phase = .failed(failure.message)
        } catch {
            phase = .failed(L.authErrorGeneric)
        }
    }

    /// Sends the confirmation email again.
    ///
    /// The overwhelmingly common reason someone is stuck on this screen is that
    /// the first email never arrived, so this is the one action worth putting in
    /// front of them. A rate limit is surfaced — tapping twice and being told
    /// nothing would read as a second email that never came — and every other
    /// failure resolves to the notice, because from here the person can only
    /// wait or try a different address either way.
    public func resendConfirmation() async {
        guard let auth, !confirmationEmail.isEmpty, !isResending else { return }

        isResending = true
        resendError = nil
        resendNoticeVisible = false
        defer { isResending = false }

        do {
            try await auth.resendConfirmation(email: confirmationEmail)
            resendNoticeVisible = true
        } catch let failure as AuthFailure where failure.kind == .rateLimited {
            resendError = failure.message
        } catch {
            // Anything else resolves to the notice. From here the person can
            // only wait or use a different address either way, and an error
            // about a send they cannot retry differently is just noise.
            resendNoticeVisible = true
        }
    }

    /// "Use a different address" — back to an empty form, with the address that
    /// did not work cleared rather than left to be corrected character by
    /// character.
    public func startOver() {
        email = ""
        password = ""
        confirmationEmail = ""
        resendNoticeVisible = false
        resendError = nil
        phase = .idle
    }

    /// Codes already exchanged (or refused as spent) this launch. Mail apps
    /// and OS link-resolution can deliver the same URL more than once; a
    /// consumed code must be a no-op, never a second exchange.
    private var consumedCodes: Set<String> = []

    /// One confirmation link, arriving from the composition root.
    ///
    /// Idempotent by construction: a duplicate delivery, a replay after
    /// success, or a tap during an exchange all change nothing. Only failures
    /// the provider might still honour — offline, rate-limited — leave the
    /// code unconsumed so the person can simply tap the link again.
    public func handleConfirmationCallback(_ outcome: AuthCallbackLink.Outcome) async {
        switch outcome {
        case let .code(code):
            guard let auth else {
                phase = .failed(L.authErrorUnconfigured)
                return
            }
            guard phase != .confirmingEmail, !consumedCodes.contains(code) else { return }

            phase = .confirmingEmail
            do {
                let session = try await auth.completeEmailConfirmation(code: code)
                consumedCodes.insert(code)
                await onAuthenticated(session, nil)
                phase = .idle
            } catch let failure as AuthFailure {
                if failure.kind != .offline && failure.kind != .rateLimited {
                    consumedCodes.insert(code)
                }
                phase = .failed(failure.message)
            } catch {
                phase = .failed(L.authErrorGeneric)
            }

        case let .failure(reason):
            phase = .failed(
                reason == .expired ? L.authErrorLinkExpired : L.authErrorLinkInvalid
            )
        }
    }

    public func sendReset() async {
        guard let auth else {
            phase = .failed(L.authErrorUnconfigured)
            return
        }
        guard !trimmedEmail.isEmpty, trimmedEmail.contains("@") else {
            phase = .failed(L.authErrorEmailInvalid)
            return
        }

        phase = .working
        do {
            try await auth.sendPasswordReset(email: trimmedEmail)
            resetNoticeVisible = true
            phase = .idle
        } catch let failure as AuthFailure {
            phase = .failed(failure.message)
        } catch {
            phase = .failed(L.authErrorGeneric)
        }
    }

    /// Moving between screens clears what no longer applies. The email is kept
    /// — retyping it is pure friction — and the password never survives.
    public func resetForNewScreen() {
        password = ""
        phase = .idle
        resetNoticeVisible = false
        resendNoticeVisible = false
        resendError = nil
    }
}
