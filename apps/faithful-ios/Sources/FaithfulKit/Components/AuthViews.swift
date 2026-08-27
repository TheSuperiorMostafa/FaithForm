import SwiftUI

/// The signed-out journey: one landing screen, two doors.
///
/// Same editorial shape as `WelcomeView` — a confident sentence, generous
/// space, and only the actions a person can actually take. The primary door is
/// creating an account, because the person most likely to be standing here has
/// never used FaithForm before.
public struct AuthFlowView: View {
    public enum Route: Hashable, Sendable {
        case createAccount
        case signIn
        case resetPassword
    }

    @Environment(\.faithfulTheme) private var theme
    @Bindable private var model: AuthModel
    @State private var path: [Route] = []
    private let hasPendingInvitation: Bool

    public init(model: AuthModel, hasPendingInvitation: Bool = false) {
        self.model = model
        self.hasPendingInvitation = hasPendingInvitation
    }

    public var body: some View {
        NavigationStack(path: $path) {
            landing
                .navigationDestination(for: Route.self) { route in
                    switch route {
                    case .createAccount:
                        SignUpView(model: model, onSwitchToSignIn: {
                            path = [.signIn]
                        })
                    case .signIn:
                        SignInView(model: model, onForgotPassword: {
                            path.append(.resetPassword)
                        })
                    case .resetPassword:
                        ForgotPasswordView(model: model)
                    }
                }
        }
        .onChange(of: path) {
            model.resetForNewScreen()
        }
    }

    private var landing: some View {
        VStack(alignment: .leading, spacing: FaithfulTokens.Spacing.lg) {
            Spacer(minLength: FaithfulTokens.Spacing.xxl)

            VStack(alignment: .leading, spacing: FaithfulTokens.Spacing.md) {
                Text(L.appName)
                    .font(theme.font(FaithfulTokens.Text.displayLarge))
                    .foregroundStyle(theme.palette.contentPrimary)
                Text(L.signInBody)
                    .font(theme.font(FaithfulTokens.Text.body))
                    .foregroundStyle(theme.palette.contentSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }

            if hasPendingInvitation {
                FaithfulCard {
                    Text(L.invitationPendingBanner)
                        .font(theme.font(FaithfulTokens.Text.bodySmall))
                        .foregroundStyle(theme.palette.contentSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }

            // A confirmation link lands here, on the front door, before any
            // screen was chosen. Both of its states are visible in place: the
            // exchange in progress, and the sentence when it could not finish.
            if model.phase == .confirmingEmail {
                FaithfulCard {
                    HStack(spacing: FaithfulTokens.Spacing.sm) {
                        ProgressView()
                        Text(L.authConfirmingEmail)
                            .font(theme.font(FaithfulTokens.Text.bodySmall))
                            .foregroundStyle(theme.palette.contentSecondary)
                    }
                }
            }
            if case let .failed(message) = model.phase {
                FaithfulCard {
                    AuthErrorText(message: message)
                }
            }

            Spacer()

            VStack(spacing: FaithfulTokens.Spacing.md) {
                Button(L.createAccount) { path.append(.createAccount) }
                    .buttonStyle(FaithfulButtonStyle(kind: .primary, theme: theme))
                Button(L.signIn) { path.append(.signIn) }
                    .buttonStyle(FaithfulButtonStyle(kind: .secondary, theme: theme))
            }
        }
        .padding(.horizontal, FaithfulTokens.Layout.screenPaddingHorizontal)
        .padding(.bottom, FaithfulTokens.Spacing.xl)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
        .background(theme.palette.background.ignoresSafeArea())
    }
}

/// Creating an account: name (optional), email, password. The agreement
/// sentence sits above the button — the moment of consent is the moment of
/// commitment, not a settings page later.
struct SignUpView: View {
    @Environment(\.faithfulTheme) private var theme
    @Bindable var model: AuthModel
    let onSwitchToSignIn: @MainActor () -> Void

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: FaithfulTokens.Spacing.lg) {
                if model.phase == .checkEmail {
                    checkEmail
                } else {
                    form
                }
            }
            .padding(.horizontal, FaithfulTokens.Layout.screenPaddingHorizontal)
            .padding(.vertical, FaithfulTokens.Spacing.lg)
            .frame(maxWidth: FaithfulTokens.Layout.contentMaxWidth)
        }
        .background(theme.palette.background.ignoresSafeArea())
        .navigationTitle(L.authCreateTitle)
    }

    @ViewBuilder
    private var form: some View {
        AuthField(
            label: L.authNameLabel,
            hint: L.authNameHint,
            text: $model.name,
            content: .name
        )
        AuthField(label: L.authEmailLabel, text: $model.email, content: .email)
        AuthField(
            label: L.authPasswordLabel,
            hint: L.authPasswordHint,
            text: $model.password,
            content: .newPassword
        )

        if case let .failed(message) = model.phase {
            AuthErrorText(message: message)
        }

        Text(L.authTermsNotice)
            .font(theme.font(FaithfulTokens.Text.caption))
            .foregroundStyle(theme.mutedContent)
            .fixedSize(horizontal: false, vertical: true)

        Button {
            Task { await model.createAccount() }
        } label: {
            workingLabel(L.createAccount)
        }
        .buttonStyle(FaithfulButtonStyle(kind: .primary, theme: theme))
        .disabled(model.phase == .working)

        Button(L.authSignInTitle, action: onSwitchToSignIn)
            .buttonStyle(FaithfulButtonStyle(kind: .quiet, theme: theme))
    }

    private var checkEmail: some View {
        VStack(spacing: FaithfulTokens.Spacing.lg) {
            EmptyStateView(title: L.authCheckEmailTitle, explanation: L.authCheckEmailBody)
            Button(L.authSignInTitle, action: onSwitchToSignIn)
                .buttonStyle(FaithfulButtonStyle(kind: .primary, theme: theme))
        }
    }

    @ViewBuilder
    private func workingLabel(_ title: String) -> some View {
        if model.phase == .working {
            ProgressView().tint(theme.palette.contentInverse)
        } else {
            Text(title)
        }
    }
}

/// Signing in: email, password, and a way out of a forgotten password.
struct SignInView: View {
    @Environment(\.faithfulTheme) private var theme
    @Bindable var model: AuthModel
    let onForgotPassword: @MainActor () -> Void

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: FaithfulTokens.Spacing.lg) {
                AuthField(label: L.authEmailLabel, text: $model.email, content: .email)
                AuthField(
                    label: L.authPasswordLabel,
                    text: $model.password,
                    content: .password
                )

                if case let .failed(message) = model.phase {
                    AuthErrorText(message: message)
                }

                Button {
                    Task { await model.signIn() }
                } label: {
                    if model.phase == .working {
                        ProgressView().tint(theme.palette.contentInverse)
                    } else {
                        Text(L.signIn)
                    }
                }
                .buttonStyle(FaithfulButtonStyle(kind: .primary, theme: theme))
                .disabled(model.phase == .working)

                Button(L.authForgotPassword, action: onForgotPassword)
                    .buttonStyle(FaithfulButtonStyle(kind: .quiet, theme: theme))
            }
            .padding(.horizontal, FaithfulTokens.Layout.screenPaddingHorizontal)
            .padding(.vertical, FaithfulTokens.Spacing.lg)
            .frame(maxWidth: FaithfulTokens.Layout.contentMaxWidth)
        }
        .background(theme.palette.background.ignoresSafeArea())
        .navigationTitle(L.authSignInTitle)
    }
}

/// A forgotten password is a normal Tuesday, not an error state. The reply is
/// identical whether or not the address has an account.
struct ForgotPasswordView: View {
    @Environment(\.faithfulTheme) private var theme
    @Bindable var model: AuthModel

    var body: some View {
        VStack(alignment: .leading, spacing: FaithfulTokens.Spacing.lg) {
            Text(L.authResetBody)
                .font(theme.font(FaithfulTokens.Text.body))
                .foregroundStyle(theme.palette.contentSecondary)
                .fixedSize(horizontal: false, vertical: true)

            AuthField(label: L.authEmailLabel, text: $model.email, content: .email)

            if model.resetNoticeVisible {
                Text(L.authResetSent)
                    .font(theme.font(FaithfulTokens.Text.bodySmall))
                    .foregroundStyle(theme.palette.contentSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }

            if case let .failed(message) = model.phase {
                AuthErrorText(message: message)
            }

            Button {
                Task { await model.sendReset() }
            } label: {
                if model.phase == .working {
                    ProgressView().tint(theme.palette.contentInverse)
                } else {
                    Text(L.authResetSend)
                }
            }
            .buttonStyle(FaithfulButtonStyle(kind: .primary, theme: theme))
            .disabled(model.phase == .working || model.resetNoticeVisible)

            Spacer()
        }
        .padding(.horizontal, FaithfulTokens.Layout.screenPaddingHorizontal)
        .padding(.vertical, FaithfulTokens.Spacing.lg)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(theme.palette.background.ignoresSafeArea())
        .navigationTitle(L.authResetTitle)
    }
}

/// What a field holds, in platform-neutral terms. The iOS build maps this to
/// content types and keyboards so autofill offers the right thing; the macOS
/// test build compiles the same view with no UIKit in sight.
enum AuthFieldContent {
    case name
    case email
    case password
    case newPassword
    case plain
}

/// One labelled input, styled from tokens. Secure fields never autofill a
/// stranger's saved password into the wrong box because content types are
/// declared honestly.
struct AuthField: View {
    @Environment(\.faithfulTheme) private var theme
    let label: String
    var hint: String?
    @Binding var text: String
    var content: AuthFieldContent = .plain

    private var isSecure: Bool {
        content == .password || content == .newPassword
    }

    var body: some View {
        VStack(alignment: .leading, spacing: FaithfulTokens.Spacing.xs) {
            Text(label)
                .font(theme.font(FaithfulTokens.Text.label))
                .foregroundStyle(theme.mutedContent)

            Group {
                if isSecure {
                    SecureField("", text: $text)
                } else {
                    TextField("", text: $text)
                        .autocorrectionDisabled(content == .email || content == .plain)
                }
            }
            .authFieldTraits(content)
            .font(theme.font(FaithfulTokens.Text.body))
            .foregroundStyle(theme.palette.contentPrimary)
            .padding(.horizontal, FaithfulTokens.Spacing.base)
            .frame(minHeight: FaithfulTokens.TouchTarget.recommended)
            .background(
                RoundedRectangle(cornerRadius: FaithfulTokens.Radius.md, style: .continuous)
                    .fill(theme.palette.surfaceSunken)
            )
            .accessibilityLabel(Text(label))

            if let hint {
                Text(hint)
                    .font(theme.font(FaithfulTokens.Text.caption))
                    .foregroundStyle(theme.mutedContent)
            }
        }
    }
}

extension View {
    /// Content type, keyboard and capitalization are UIKit-backed and do not
    /// exist on the macOS test build; behind this guard the view is identical
    /// on both, minus the affordances only a phone keyboard has.
    @ViewBuilder
    func authFieldTraits(_ content: AuthFieldContent) -> some View {
        #if os(iOS)
        switch content {
        case .name:
            self.textContentType(.name)
                .textInputAutocapitalization(.words)
        case .email:
            self.textContentType(.emailAddress)
                .keyboardType(.emailAddress)
                .textInputAutocapitalization(.never)
        case .password:
            self.textContentType(.password)
        case .newPassword:
            self.textContentType(.newPassword)
        case .plain:
            self.textInputAutocapitalization(.never)
        }
        #else
        self
        #endif
    }
}

struct AuthErrorText: View {
    @Environment(\.faithfulTheme) private var theme
    let message: String

    var body: some View {
        Text(message)
            .font(theme.font(FaithfulTokens.Text.bodySmall))
            .foregroundStyle(theme.palette.destructive)
            .fixedSize(horizontal: false, vertical: true)
            .accessibilityAddTraits(.isStaticText)
    }
}

/// Redeeming an invitation — from the welcome flow, from an invite-only
/// church's profile, or after a deep link arrived signed out.
public struct InvitationEntryView: View {
    @Environment(\.faithfulTheme) private var theme
    @Bindable private var model: OnboardingModel
    @State private var raw: String
    private let onAccepted: @MainActor () -> Void

    public init(model: OnboardingModel, onAccepted: @escaping @MainActor () -> Void) {
        self.model = model
        self.onAccepted = onAccepted
        _raw = State(initialValue: model.pendingInvitationToken ?? "")
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: FaithfulTokens.Spacing.lg) {
            Text(L.invitationBody)
                .font(theme.font(FaithfulTokens.Text.body))
                .foregroundStyle(theme.palette.contentSecondary)
                .fixedSize(horizontal: false, vertical: true)

            AuthField(label: L.invitationFieldLabel, text: $raw)

            if case let .failed(message) = model.invitationPhase {
                AuthErrorText(message: message)
            }

            Button {
                Task {
                    if await model.acceptInvitation(raw) { onAccepted() }
                }
            } label: {
                if model.invitationPhase == .working {
                    ProgressView().tint(theme.palette.contentInverse)
                } else {
                    Text(L.acceptInvitation)
                }
            }
            .buttonStyle(FaithfulButtonStyle(kind: .primary, theme: theme))
            .disabled(model.invitationPhase == .working || raw.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)

            Spacer()
        }
        .padding(.horizontal, FaithfulTokens.Layout.screenPaddingHorizontal)
        .padding(.vertical, FaithfulTokens.Spacing.lg)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(theme.palette.background.ignoresSafeArea())
        .navigationTitle(L.invitationTitle)
    }
}
