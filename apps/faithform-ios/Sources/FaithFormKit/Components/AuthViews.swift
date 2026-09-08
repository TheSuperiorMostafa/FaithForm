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

    @Environment(\.faithformTheme) private var theme
    @Bindable private var model: AuthModel
    @State private var path: [Route] = []
    private let hasPendingInvitation: Bool
    private let churchContext: PendingChurchContext?
    private let onClearChurchContext: (@MainActor () -> Void)?

    public init(
        model: AuthModel,
        hasPendingInvitation: Bool = false,
        churchContext: PendingChurchContext? = nil,
        onClearChurchContext: (@MainActor () -> Void)? = nil
    ) {
        self.model = model
        self.hasPendingInvitation = hasPendingInvitation
        self.churchContext = churchContext
        self.onClearChurchContext = onClearChurchContext
    }

    public var body: some View {
        NavigationStack(path: $path) {
            landing
                .navigationDestination(for: Route.self) { route in
                    switch route {
                    case .createAccount:
                        SignUpView(
                            model: model,
                            churchContext: churchContext,
                            onSwitchToSignIn: { path = [.signIn] }
                        )
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
        VStack(alignment: .leading, spacing: FaithFormTokens.Spacing.lg) {
            Spacer(minLength: FaithFormTokens.Spacing.xxl)

            // A link that named a church replaces the product's own name with
            // it. Someone who scanned a bulletin QR code came for their church,
            // not for FaithForm, and the front door should say so.
            if let churchContext {
                ChurchContextHeader(context: churchContext)
            } else {
                VStack(alignment: .leading, spacing: FaithFormTokens.Spacing.md) {
                    Text(L.appName)
                        .font(theme.font(FaithFormTokens.Text.displayLarge))
                        .foregroundStyle(theme.palette.contentPrimary)
                    Text(L.signInBody)
                        .font(theme.font(FaithFormTokens.Text.body))
                        .foregroundStyle(theme.palette.contentSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }

            // The generic "you have an invitation" banner is redundant once the
            // header names the church the invitation is *for*.
            if hasPendingInvitation, churchContext == nil {
                FaithFormCard {
                    Text(L.invitationPendingBanner)
                        .font(theme.font(FaithFormTokens.Text.bodySmall))
                        .foregroundStyle(theme.palette.contentSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }

            // A confirmation link lands here, on the front door, before any
            // screen was chosen. Both of its states are visible in place: the
            // exchange in progress, and the sentence when it could not finish.
            if model.phase == .confirmingEmail {
                FaithFormCard {
                    HStack(spacing: FaithFormTokens.Spacing.sm) {
                        ProgressView()
                        Text(L.authConfirmingEmail)
                            .font(theme.font(FaithFormTokens.Text.bodySmall))
                            .foregroundStyle(theme.palette.contentSecondary)
                    }
                }
            }
            if case let .failed(message) = model.phase {
                FaithFormCard {
                    AuthErrorText(message: message)
                }
            }

            Spacer()

            VStack(spacing: FaithFormTokens.Spacing.md) {
                Button(L.createAccount) { path.append(.createAccount) }
                    .buttonStyle(FaithFormButtonStyle(kind: .primary, theme: theme))
                Button(L.signIn) { path.append(.signIn) }
                    .buttonStyle(FaithFormButtonStyle(kind: .secondary, theme: theme))
                // A link can be forwarded, mistyped, or simply not meant for
                // the person holding it. Disowning the church has to be one tap
                // away, or the branding becomes a trap.
                if churchContext != nil, let onClearChurchContext {
                    Button(L.churchContextNotYours, action: onClearChurchContext)
                        .buttonStyle(FaithFormButtonStyle(kind: .quiet, theme: theme))
                }
            }
        }
        .padding(.horizontal, FaithFormTokens.Layout.screenPaddingHorizontal)
        .padding(.bottom, FaithFormTokens.Spacing.xl)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
        .background(theme.palette.background.ignoresSafeArea())
    }
}

/// Creating an account: name (optional), email, password. The agreement
/// sentence sits above the button — the moment of consent is the moment of
/// commitment, not a settings page later.
struct SignUpView: View {
    @Environment(\.faithformTheme) private var theme
    @Bindable var model: AuthModel
    var churchContext: PendingChurchContext?
    let onSwitchToSignIn: @MainActor () -> Void

    /// "Join Grace Community" rather than "Create your account", when a link
    /// said which church this is for.
    private var title: String {
        guard let churchContext else { return L.authCreateTitle }
        return String(format: L.churchContextJoinTitle, churchContext.churchName)
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: FaithFormTokens.Spacing.lg) {
                if model.phase == .checkEmail {
                    CheckEmailView(model: model, onSignIn: onSwitchToSignIn)
                } else {
                    form
                }
            }
            .padding(.horizontal, FaithFormTokens.Layout.screenPaddingHorizontal)
            .padding(.vertical, FaithFormTokens.Spacing.lg)
            .frame(maxWidth: FaithFormTokens.Layout.contentMaxWidth)
        }
        .background(theme.palette.background.ignoresSafeArea())
        .navigationTitle(model.phase == .checkEmail ? L.authCheckEmailTitle : title)
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
            .font(theme.font(FaithFormTokens.Text.caption))
            .foregroundStyle(theme.mutedContent)
            .fixedSize(horizontal: false, vertical: true)

        Button {
            Task { await model.createAccount() }
        } label: {
            workingLabel(L.createAccount)
        }
        .buttonStyle(FaithFormButtonStyle(kind: .primary, theme: theme))
        .disabled(model.phase == .working)

        Button(L.authSignInTitle, action: onSwitchToSignIn)
            .buttonStyle(FaithFormButtonStyle(kind: .quiet, theme: theme))
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
    @Environment(\.faithformTheme) private var theme
    @Bindable var model: AuthModel
    let onForgotPassword: @MainActor () -> Void

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: FaithFormTokens.Spacing.lg) {
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
                .buttonStyle(FaithFormButtonStyle(kind: .primary, theme: theme))
                .disabled(model.phase == .working)

                Button(L.authForgotPassword, action: onForgotPassword)
                    .buttonStyle(FaithFormButtonStyle(kind: .quiet, theme: theme))
            }
            .padding(.horizontal, FaithFormTokens.Layout.screenPaddingHorizontal)
            .padding(.vertical, FaithFormTokens.Spacing.lg)
            .frame(maxWidth: FaithFormTokens.Layout.contentMaxWidth)
        }
        .background(theme.palette.background.ignoresSafeArea())
        .navigationTitle(L.authSignInTitle)
    }
}

/// A forgotten password is a normal Tuesday, not an error state. The reply is
/// identical whether or not the address has an account.
struct ForgotPasswordView: View {
    @Environment(\.faithformTheme) private var theme
    @Bindable var model: AuthModel

    var body: some View {
        VStack(alignment: .leading, spacing: FaithFormTokens.Spacing.lg) {
            Text(L.authResetBody)
                .font(theme.font(FaithFormTokens.Text.body))
                .foregroundStyle(theme.palette.contentSecondary)
                .fixedSize(horizontal: false, vertical: true)

            AuthField(label: L.authEmailLabel, text: $model.email, content: .email)

            if model.resetNoticeVisible {
                Text(L.authResetSent)
                    .font(theme.font(FaithFormTokens.Text.bodySmall))
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
            .buttonStyle(FaithFormButtonStyle(kind: .primary, theme: theme))
            .disabled(model.phase == .working || model.resetNoticeVisible)

            Spacer()
        }
        .padding(.horizontal, FaithFormTokens.Layout.screenPaddingHorizontal)
        .padding(.vertical, FaithFormTokens.Spacing.lg)
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
    @Environment(\.faithformTheme) private var theme
    let label: String
    var hint: String?
    @Binding var text: String
    var content: AuthFieldContent = .plain

    private var isSecure: Bool {
        content == .password || content == .newPassword
    }

    var body: some View {
        VStack(alignment: .leading, spacing: FaithFormTokens.Spacing.xs) {
            Text(label)
                .font(theme.font(FaithFormTokens.Text.label))
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
            .font(theme.font(FaithFormTokens.Text.body))
            .foregroundStyle(theme.palette.contentPrimary)
            .padding(.horizontal, FaithFormTokens.Spacing.base)
            .frame(minHeight: FaithFormTokens.TouchTarget.recommended)
            // Outlined on the page background, the way the web's input is.
            // The old filled `surfaceSunken` box read as disabled next to the
            // website's bordered fields, and lost its edge entirely on a card.
            .background(
                RoundedRectangle(cornerRadius: FaithFormTokens.Radius.control, style: .continuous)
                    .fill(theme.palette.background)
            )
            .overlay(
                RoundedRectangle(cornerRadius: FaithFormTokens.Radius.control, style: .continuous)
                    .strokeBorder(
                        theme.palette.border,
                        lineWidth: FaithFormTokens.BorderWidth.standard
                    )
            )
            .accessibilityLabel(Text(label))

            if let hint {
                Text(hint)
                    .font(theme.font(FaithFormTokens.Text.caption))
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
    @Environment(\.faithformTheme) private var theme
    let message: String

    var body: some View {
        Text(message)
            .font(theme.font(FaithFormTokens.Text.bodySmall))
            .foregroundStyle(theme.palette.destructive)
            .fixedSize(horizontal: false, vertical: true)
            .accessibilityAddTraits(.isStaticText)
    }
}

/// Redeeming an invitation — from the welcome flow, from an invite-only
/// church's profile, or after a deep link arrived signed out.
public struct InvitationEntryView: View {
    @Environment(\.faithformTheme) private var theme
    @Bindable private var model: OnboardingModel
    @State private var raw: String
    private let onAccepted: @MainActor () -> Void

    public init(model: OnboardingModel, onAccepted: @escaping @MainActor () -> Void) {
        self.model = model
        self.onAccepted = onAccepted
        _raw = State(initialValue: model.pendingInvitationToken ?? "")
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: FaithFormTokens.Spacing.lg) {
            Text(L.invitationBody)
                .font(theme.font(FaithFormTokens.Text.body))
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
            .buttonStyle(FaithFormButtonStyle(kind: .primary, theme: theme))
            .disabled(model.invitationPhase == .working || raw.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)

            Spacer()
        }
        .padding(.horizontal, FaithFormTokens.Layout.screenPaddingHorizontal)
        .padding(.vertical, FaithFormTokens.Spacing.lg)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(theme.palette.background.ignoresSafeArea())
        .navigationTitle(L.invitationTitle)
    }
}

/// The church a link named, at the top of the signed-out screens.
///
/// Logo when the church has one, a building glyph when it does not — never an
/// empty box and never a stretched placeholder, because a church without a
/// logo is the common case, not a broken one.
struct ChurchContextHeader: View {
    @Environment(\.faithformTheme) private var theme
    let context: PendingChurchContext

    var body: some View {
        VStack(alignment: .leading, spacing: FaithFormTokens.Spacing.md) {
            HStack(spacing: FaithFormTokens.Spacing.base) {
                logo
                VStack(alignment: .leading, spacing: FaithFormTokens.Spacing.xs) {
                    Text(context.isInvitation ? L.churchContextInvited : L.churchContextContinue)
                        .font(theme.font(FaithFormTokens.Text.label))
                        .foregroundStyle(theme.mutedContent)
                    Text(context.churchName)
                        .font(theme.font(FaithFormTokens.Text.titleLarge))
                        .foregroundStyle(theme.palette.contentPrimary)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }

            Text(
                context.isInvitation
                    ? L.churchContextInvitedBody
                    : L.churchContextContinueBody
            )
            .font(theme.font(FaithFormTokens.Text.body))
            .foregroundStyle(theme.palette.contentSecondary)
            .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
    }

    @ViewBuilder
    private var logo: some View {
        let side = FaithFormTokens.TouchTarget.recommended + FaithFormTokens.Spacing.base
        RoundedRectangle(cornerRadius: FaithFormTokens.Radius.lg, style: .continuous)
            .fill(theme.palette.surface)
            .frame(width: side, height: side)
            .overlay {
                if let logoUrl = context.logoUrl, let url = URL(string: logoUrl) {
                    AsyncImage(url: url) { image in
                        image.resizable().scaledToFit()
                    } placeholder: {
                        buildingGlyph
                    }
                    .padding(FaithFormTokens.Spacing.xs)
                } else {
                    buildingGlyph
                }
            }
            .overlay {
                RoundedRectangle(cornerRadius: FaithFormTokens.Radius.lg, style: .continuous)
                    .strokeBorder(theme.palette.border, lineWidth: 1)
            }
            .accessibilityHidden(true)
    }

    private var buildingGlyph: some View {
        Image(systemName: "building.2")
            .font(.system(size: FaithFormTokens.IconSize.sizeLarge))
            .foregroundStyle(theme.palette.brandPrimary)
    }
}

/// What stands between creating an account and using it.
///
/// A confirmation wall is the highest-abandonment screen in any signup, and the
/// reason is nearly always the same: the email has not arrived and the screen
/// offers nothing to do about it. So this one names the exact address, says how
/// long to wait, and puts the three real ways forward on it — open the mail app,
/// send it again, or use a different address — instead of a single button back
/// to a sign-in that cannot work yet.
struct CheckEmailView: View {
    @Environment(\.faithformTheme) private var theme
    @Bindable var model: AuthModel
    let onSignIn: @MainActor () -> Void

    var body: some View {
        VStack(spacing: FaithFormTokens.Spacing.lg) {
            icon

            VStack(spacing: FaithFormTokens.Spacing.sm) {
                Text(L.authCheckEmailTitle)
                    .font(theme.font(FaithFormTokens.Text.titleLarge))
                    .foregroundStyle(theme.palette.contentPrimary)

                Text(String(format: L.authCheckEmailSentTo, model.confirmationEmail))
                    .font(theme.font(FaithFormTokens.Text.body))
                    .foregroundStyle(theme.palette.contentSecondary)
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)

                Text(L.authCheckEmailBody)
                    .font(theme.font(FaithFormTokens.Text.bodySmall))
                    .foregroundStyle(theme.palette.contentSecondary)
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .accessibilityElement(children: .combine)

            Text(L.authCheckEmailHint)
                .font(theme.font(FaithFormTokens.Text.caption))
                .foregroundStyle(theme.mutedContent)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)

            if model.resendNoticeVisible {
                Label(L.authCheckEmailResent, systemImage: "checkmark.circle.fill")
                    .font(theme.font(FaithFormTokens.Text.bodySmall))
                    .foregroundStyle(theme.palette.successContent)
            }

            if let resendError = model.resendError {
                AuthErrorText(message: resendError)
            }

            actions
        }
        .frame(maxWidth: .infinity)
        .padding(.top, FaithFormTokens.Spacing.lg)
    }

    private var icon: some View {
        ZStack {
            // Composed from tokens rather than a magic 96: the hero glyph plus
            // two steps of padding on each side.
            let side = FaithFormTokens.IconSize.sizeHero + FaithFormTokens.Spacing.xl * 2
            Circle()
                .fill(theme.palette.surface)
                .frame(width: side, height: side)
            Image(systemName: "envelope.badge")
                .font(.system(size: FaithFormTokens.IconSize.sizeHero))
                .foregroundStyle(theme.palette.brandPrimary)
        }
        .accessibilityHidden(true)
    }

    @ViewBuilder
    private var actions: some View {
        VStack(spacing: FaithFormTokens.Spacing.md) {
            #if os(iOS)
            // Straight to the inbox. `message://` is the documented way to open
            // Mail; a device without it simply does not offer the button rather
            // than presenting one that does nothing.
            if let mail = URL(string: "message://"), UIApplication.shared.canOpenURL(mail) {
                Button {
                    UIApplication.shared.open(mail)
                } label: {
                    Label(L.authCheckEmailOpenMail, systemImage: "envelope.open")
                }
                    .buttonStyle(FaithFormButtonStyle(kind: .primary, theme: theme))
            }
            #endif

            Button {
                Task { await model.resendConfirmation() }
            } label: {
                if model.isResending {
                    ProgressView()
                } else {
                    Label(L.authCheckEmailResend, systemImage: "arrow.clockwise")
                }
            }
            .buttonStyle(FaithFormButtonStyle(kind: .secondary, theme: theme))
            .disabled(model.isResending)

            Button(L.authSignInTitle, action: onSignIn)
                .buttonStyle(FaithFormButtonStyle(kind: .quiet, theme: theme))

            Button(L.authCheckEmailChangeAddress) { model.startOver() }
                .buttonStyle(FaithFormButtonStyle(kind: .quiet, theme: theme))
        }
    }
}
