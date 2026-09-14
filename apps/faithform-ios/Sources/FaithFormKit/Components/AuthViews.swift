import SwiftUI

/// The signed-out journey: one landing screen, then the doors that get someone in.
///
/// The landing is the first thing anyone who downloads FaithForm sees, so it
/// does the three jobs a front door has to: say whose app this is (the mark),
/// what it promises (one sentence), and what it actually does (the four things a
/// churchgoer gets in 1.0) — then gets out of the way. Invite-first: the primary
/// door is "I have a link", then create account, then sign in. Doors stay pinned
/// within thumb reach.
public struct AuthFlowView: View {
    public enum Route: Hashable, Sendable {
        case createAccount
        case signIn
        case resetPassword
        case haveLink
    }

    @Environment(\.faithformTheme) private var theme
    @Bindable private var model: AuthModel
    @Bindable private var onboarding: OnboardingModel
    @State private var path: [Route] = []
    /// The first frame fades the page in once. A return from a pushed screen
    /// must not replay it, so it is state rather than a transition.
    @State private var hasAppeared = false
    private let hasPendingInvitation: Bool
    private let churchContext: PendingChurchContext?
    private let onClearChurchContext: (@MainActor () -> Void)?

    public init(
        model: AuthModel,
        onboarding: OnboardingModel,
        hasPendingInvitation: Bool = false,
        churchContext: PendingChurchContext? = nil,
        onClearChurchContext: (@MainActor () -> Void)? = nil
    ) {
        self.model = model
        self.onboarding = onboarding
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
                    case .haveLink:
                        HaveLinkEntryView(onboarding: onboarding) {
                            path = []
                        }
                    }
                }
        }
        .onChange(of: path) {
            model.resetForNewScreen()
        }
    }

    private var landing: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: FaithFormTokens.Spacing.xl) {
                // A link that named a church replaces the product's promise with
                // that church. Someone who scanned a bulletin QR code came for
                // their church, not for FaithForm, and the front door should say
                // so — the mark stays, small, so they still know whose app this is.
                if let churchContext {
                    VStack(alignment: .leading, spacing: FaithFormTokens.Spacing.lg) {
                        LandingLockup(markHeight: FaithFormTokens.IconSize.sizeHero)
                        ChurchContextHeader(context: churchContext)
                    }
                } else {
                    VStack(alignment: .leading, spacing: FaithFormTokens.Spacing.lg) {
                        LandingLockup(markHeight: FaithFormTokens.Spacing.xxl)
                        VStack(alignment: .leading, spacing: FaithFormTokens.Spacing.md) {
                            Text(L.landingHeadline)
                                .font(theme.font(FaithFormTokens.Text.displayLarge))
                                .foregroundStyle(theme.palette.contentPrimary)
                                .fixedSize(horizontal: false, vertical: true)
                                .accessibilityAddTraits(.isHeader)
                            Text(L.signInBody)
                                .font(theme.font(FaithFormTokens.Text.body))
                                .foregroundStyle(theme.palette.contentSecondary)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                    }
                }

                // The generic "you have an invitation" banner is redundant once
                // the header names the church the invitation is *for*.
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
                // Above the feature list, so neither is ever scrolled out of view.
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

                LandingFeatures()
            }
            .padding(.horizontal, FaithFormTokens.Layout.screenPaddingHorizontal)
            .padding(.top, FaithFormTokens.Spacing.xl)
            .padding(.bottom, FaithFormTokens.Spacing.lg)
            .frame(maxWidth: FaithFormTokens.Layout.contentMaxWidth, alignment: .leading)
            .frame(maxWidth: .infinity)
            .opacity(hasAppeared ? 1 : 0)
            .offset(y: hasAppeared || theme.reduceMotion ? 0 : FaithFormTokens.Spacing.md)
        }
        // Scrolls only when it has to: a small phone, or a large Dynamic Type
        // size. On a phone where it all fits it sits still.
        .scrollBounceBehavior(.basedOnSize)
        // **The two doors never scroll away.** Whatever the text size, create
        // account and sign in are pinned where a thumb already is, and the page
        // above scrolls beneath them.
        .safeAreaInset(edge: .bottom, spacing: 0) {
            landingActions
        }
        .background { LandingBackdrop() }
        .onAppear {
            guard !hasAppeared else { return }
            withAnimation(theme.animation(FaithFormTokens.Motion.slow)) { hasAppeared = true }
        }
    }

    private var landingActions: some View {
        VStack(spacing: FaithFormTokens.Spacing.md) {
            // Invite-first: most churchgoers arrive with a link. Once a church
            // is already named (or a token is held), jump straight to account doors.
            if churchContext == nil, !hasPendingInvitation {
                Button(L.haveInvitation) { path.append(.haveLink) }
                    .buttonStyle(FaithFormButtonStyle(kind: .primary, theme: theme))
                Button(L.createAccount) { path.append(.createAccount) }
                    .buttonStyle(FaithFormButtonStyle(kind: .secondary, theme: theme))
                Button(L.signIn) { path.append(.signIn) }
                    .buttonStyle(FaithFormButtonStyle(kind: .quiet, theme: theme))
            } else {
                Button(L.createAccount) { path.append(.createAccount) }
                    .buttonStyle(FaithFormButtonStyle(kind: .primary, theme: theme))
                Button(L.signIn) { path.append(.signIn) }
                    .buttonStyle(FaithFormButtonStyle(kind: .secondary, theme: theme))
            }
            // A link can be forwarded, mistyped, or simply not meant for the
            // person holding it. Disowning the church has to be one tap away, or
            // the branding becomes a trap.
            if churchContext != nil, let onClearChurchContext {
                Button(L.churchContextNotYours, action: onClearChurchContext)
                    .buttonStyle(FaithFormButtonStyle(kind: .quiet, theme: theme))
            }

            // The documents a person is about to agree to, readable before they
            // tap either door rather than only on the form that asks for consent.
            HStack(spacing: FaithFormTokens.Spacing.base) {
                Link(L.privacyPolicy, destination: LegalLinks.privacyPolicy)
                Link(L.termsOfService, destination: LegalLinks.termsOfService)
            }
            .font(theme.font(FaithFormTokens.Text.caption))
            .tint(theme.mutedContent)
            .frame(minHeight: FaithFormTokens.TouchTarget.minimum)
        }
        .padding(.horizontal, FaithFormTokens.Layout.screenPaddingHorizontal)
        .padding(.top, FaithFormTokens.Spacing.base)
        .frame(maxWidth: FaithFormTokens.Layout.contentMaxWidth)
        .frame(maxWidth: .infinity)
        .background {
            // Solid, so text scrolling beneath the buttons never shows through
            // them; the hairline says where the page ends and the doors begin.
            theme.palette.background
                .overlay(alignment: .top) {
                    Rectangle()
                        .fill(theme.palette.divider)
                        .frame(height: FaithFormTokens.BorderWidth.hairline)
                }
                .ignoresSafeArea(edges: .bottom)
        }
    }
}

/// The mark and the name, side by side.
///
/// Read as one element: VoiceOver hears "FaithForm" once, not a picture
/// followed by the same word.
private struct LandingLockup: View {
    @Environment(\.faithformTheme) private var theme
    let markHeight: CGFloat

    var body: some View {
        HStack(spacing: FaithFormTokens.Spacing.md) {
            FaithFormMark()
                .frame(height: markHeight)
            Text(L.appName)
                .font(theme.font(FaithFormTokens.Text.titleLarge))
                .foregroundStyle(theme.palette.contentPrimary)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(L.appName))
    }
}

/// What the app does, in three lines.
///
/// One composition: feed, services, and giving — enough to promise the product
/// without a dense feature grid on the front door.
private struct LandingFeatures: View {
    @Environment(\.faithformTheme) private var theme

    private struct Row: Identifiable {
        let symbol: String
        let title: String
        let detail: String
        var id: String { symbol }
    }

    private var rows: [Row] {
        [
            Row(symbol: "megaphone", title: L.landingFeedTitle, detail: L.landingFeedBody),
            Row(symbol: "play.rectangle", title: L.landingWatchTitle, detail: L.landingWatchBody),
            Row(symbol: "heart", title: L.landingGiveTitle, detail: L.landingGiveBody),
        ]
    }

    var body: some View {
        FaithFormCard {
            VStack(alignment: .leading, spacing: FaithFormTokens.Spacing.base) {
                ForEach(rows) { row in
                    HStack(alignment: .top, spacing: FaithFormTokens.Spacing.base) {
                        Image(systemName: row.symbol)
                            .font(.system(size: FaithFormTokens.IconSize.sizeMedium, weight: .semibold))
                            .foregroundStyle(theme.palette.brandPrimary)
                            .frame(
                                width: FaithFormTokens.TouchTarget.minimum,
                                height: FaithFormTokens.TouchTarget.minimum
                            )
                            .background(
                                RoundedRectangle(cornerRadius: FaithFormTokens.Radius.md, style: .continuous)
                                    .fill(theme.palette.brandAccent.opacity(0.16))
                            )
                            .accessibilityHidden(true)

                        VStack(alignment: .leading, spacing: FaithFormTokens.Spacing.xs) {
                            Text(row.title)
                                .font(theme.font(FaithFormTokens.Text.titleMedium))
                                .foregroundStyle(theme.palette.contentPrimary)
                            Text(row.detail)
                                .font(theme.font(FaithFormTokens.Text.bodySmall))
                                .foregroundStyle(theme.palette.contentSecondary)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                    }
                    .accessibilityElement(children: .combine)
                }
            }
        }
    }
}

/// The ground behind the front door: the page colour, warmed at the top by the
/// brand gold, with the mark set large and faint in the corner.
///
/// Decoration only — hidden from VoiceOver, and the watermark is dropped under
/// Increase Contrast, where anything behind text should get out of the way.
private struct LandingBackdrop: View {
    @Environment(\.faithformTheme) private var theme

    var body: some View {
        ZStack(alignment: .topTrailing) {
            theme.palette.background
            LinearGradient(
                colors: [theme.palette.brandAccent.opacity(0.14), theme.palette.background.opacity(0)],
                startPoint: .top,
                endPoint: .center
            )
            if !theme.increaseContrast {
                // Large and faint behind the top of the page, so the brand fills
                // the front door without competing with the headline over it.
                FaithFormMark()
                    .frame(height: 280)
                    .opacity(0.05)
                    .rotationEffect(.degrees(-8))
                    .offset(x: 96, y: -24)
            }
        }
        .ignoresSafeArea()
        .accessibilityHidden(true)
    }
}

/// Shared chrome for every signed-out form: brand atmosphere stays visible so
/// Create, Sign in, Have link, and Reset feel like FaithForm — not empty sheets.
private struct AuthShell<Content: View>: View {
    @Environment(\.faithformTheme) private var theme
    let title: String
    var subtitle: String? = nil
    var churchContext: PendingChurchContext? = nil
    @ViewBuilder var content: () -> Content

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: FaithFormTokens.Spacing.lg) {
                LandingLockup(markHeight: FaithFormTokens.IconSize.sizeLarge)

                if let churchContext {
                    ChurchContextHeader(context: churchContext)
                }

                VStack(alignment: .leading, spacing: FaithFormTokens.Spacing.sm) {
                    Text(title)
                        .font(theme.font(FaithFormTokens.Text.displayMedium))
                        .foregroundStyle(theme.palette.contentPrimary)
                        .fixedSize(horizontal: false, vertical: true)
                        .accessibilityAddTraits(.isHeader)
                    if let subtitle, !subtitle.isEmpty {
                        Text(subtitle)
                            .font(theme.font(FaithFormTokens.Text.body))
                            .foregroundStyle(theme.palette.contentSecondary)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }

                content()
            }
            .padding(.horizontal, FaithFormTokens.Layout.screenPaddingHorizontal)
            .padding(.top, FaithFormTokens.Spacing.lg)
            .padding(.bottom, FaithFormTokens.Spacing.xl)
            .frame(maxWidth: FaithFormTokens.Layout.contentMaxWidth, alignment: .leading)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .scrollBounceBehavior(.basedOnSize)
        .background { LandingBackdrop() }
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(.hidden, for: .navigationBar)
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
        Group {
            if model.phase == .checkEmail {
                AuthShell(title: L.authCheckEmailTitle, churchContext: churchContext) {
                    CheckEmailView(model: model, onSignIn: onSwitchToSignIn)
                }
            } else {
                AuthShell(
                    title: title,
                    subtitle: L.authCreateBody,
                    churchContext: churchContext
                ) {
                    form
                }
            }
        }
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

        Text(LegalLinks.termsNotice())
            .font(theme.font(FaithFormTokens.Text.caption))
            .foregroundStyle(theme.mutedContent)
            .tint(theme.palette.brandPrimary)
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
            ProgressView().tint(theme.palette.contentOnAccent)
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
        AuthShell(title: L.authSignInTitle, subtitle: L.authSignInBody) {
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
                    ProgressView().tint(theme.palette.contentOnAccent)
                } else {
                    Text(L.signIn)
                }
            }
            .buttonStyle(FaithFormButtonStyle(kind: .primary, theme: theme))
            .disabled(model.phase == .working)

            Button(L.authForgotPassword, action: onForgotPassword)
                .buttonStyle(FaithFormButtonStyle(kind: .quiet, theme: theme))
        }
    }
}

/// A forgotten password is a normal Tuesday, not an error state. The reply is
/// identical whether or not the address has an account.
struct ForgotPasswordView: View {
    @Environment(\.faithformTheme) private var theme
    @Bindable var model: AuthModel

    var body: some View {
        AuthShell(title: L.authResetTitle, subtitle: L.authResetBody) {
            AuthField(label: L.authEmailLabel, text: $model.email, content: .email)

            if model.resetNoticeVisible {
                HStack(alignment: .top, spacing: FaithFormTokens.Spacing.sm) {
                    Image(systemName: "checkmark.circle.fill")
                        .foregroundStyle(theme.palette.success)
                    Text(L.authResetSent)
                        .font(theme.font(FaithFormTokens.Text.bodySmall))
                        .foregroundStyle(theme.palette.contentSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .accessibilityElement(children: .combine)
            }

            if case let .failed(message) = model.phase {
                AuthErrorText(message: message)
            }

            Button {
                Task { await model.sendReset() }
            } label: {
                if model.phase == .working {
                    ProgressView().tint(theme.palette.contentOnAccent)
                } else {
                    Text(L.authResetSend)
                }
            }
            .buttonStyle(FaithFormButtonStyle(kind: .primary, theme: theme))
            .disabled(model.phase == .working || model.resetNoticeVisible)
        }
    }
}

/// What a field holds, in platform-neutral terms. The iOS build maps this to
/// content types and keyboards so autofill offers the right thing; the macOS
/// test build compiles the same view with no UIKit in sight.
public enum AuthFieldContent {
    case name
    case email
    case password
    case newPassword
    case plain
}

/// One labelled input, styled from tokens. Secure fields never autofill a
/// stranger's saved password into the wrong box because content types are
/// declared honestly.
public struct AuthField: View {
    @Environment(\.faithformTheme) private var theme
    let label: String
    var hint: String?
    @Binding var text: String
    var content: AuthFieldContent

    public init(
        label: String,
        hint: String? = nil,
        text: Binding<String>,
        content: AuthFieldContent = .plain
    ) {
        self.label = label
        self.hint = hint
        self._text = text
        self.content = content
    }

    private var isSecure: Bool {
        content == .password || content == .newPassword
    }

    public var body: some View {
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
                    .fill(theme.palette.surface)
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

public struct AuthErrorText: View {
    @Environment(\.faithformTheme) private var theme
    let message: String

    public init(message: String) {
        self.message = message
    }

    public var body: some View {
        Text(message)
            .font(theme.font(FaithFormTokens.Text.bodySmall))
            .foregroundStyle(theme.palette.destructive)
            .fixedSize(horizontal: false, vertical: true)
            .accessibilityAddTraits(.isStaticText)
    }
}

/// Holding an invitation before sign-in: paste, name the church, then create
/// or sign in on the branded landing. The token is not spent until a session
/// exists — same path a deep link takes when the person is signed out.
public struct HaveLinkEntryView: View {
    @Environment(\.faithformTheme) private var theme
    @Bindable private var onboarding: OnboardingModel
    @State private var raw: String = ""
    @State private var working = false
    @State private var errorMessage: String?
    private let onHeld: @MainActor () -> Void

    public init(onboarding: OnboardingModel, onHeld: @escaping @MainActor () -> Void) {
        self.onboarding = onboarding
        self.onHeld = onHeld
    }

    public var body: some View {
        AuthShell(title: L.invitationTitle, subtitle: L.invitationBody) {
            AuthField(label: L.invitationFieldLabel, hint: L.invitationHint, text: $raw)

            if let errorMessage {
                AuthErrorText(message: errorMessage)
            }

            Button {
                Task { await holdAndContinue() }
            } label: {
                if working {
                    ProgressView().tint(theme.palette.contentOnAccent)
                } else {
                    Text(L.haveLinkContinue)
                }
            }
            .buttonStyle(FaithFormButtonStyle(kind: .primary, theme: theme))
            .disabled(working || raw.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
        }
    }

    private func holdAndContinue() async {
        working = true
        errorMessage = nil
        let token = onboarding.normalize(raw)
        guard token.count >= 16, token.count <= 512 else {
            errorMessage = L.invitationErrorInvalid
            working = false
            return
        }
        onboarding.hold(invitationToken: token)
        await onboarding.resolveChurchContext(invitationToken: token)
        working = false
        onHeld()
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
                    .foregroundStyle(theme.palette.success)
            }

            if let resendError = model.resendError {
                AuthErrorText(message: resendError)
            }

            actions
        }
        .frame(maxWidth: .infinity)
    }

    private var icon: some View {
        ZStack {
            // Composed from tokens rather than a magic 96: the hero glyph plus
            // two steps of padding on each side.
            let side = FaithFormTokens.IconSize.sizeHero + FaithFormTokens.Spacing.xl * 2
            Circle()
                .fill(theme.palette.surface)
                .overlay(
                    Circle().strokeBorder(theme.palette.border, lineWidth: FaithFormTokens.BorderWidth.hairline)
                )
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
