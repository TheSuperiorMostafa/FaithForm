import Foundation
import Observation

/// Where the sign-in flow currently is. Every case is a real state: working
/// disables the form, checkEmail is signup's "confirm first" outcome, and
/// failed carries the sentence to show — never a provider string.
public enum AuthPhase: Equatable, Sendable {
    case idle
    case working
    case checkEmail
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
    }
}
