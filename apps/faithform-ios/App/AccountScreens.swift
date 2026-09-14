import SwiftUI
import UIKit
import FaithFormKit

// MARK: - Account tab

struct AccountTabView: View {
    @Environment(\.faithformTheme) private var theme
    let dependencies: AppDependencies
    let root: RootModel
    let bootstrap: Bootstrap
    let isStale: Bool

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                if isStale { OfflineBanner(message: L.offlineCached) }
                ScrollView {
                    AccountView(
                        dependencies: dependencies,
                        root: root,
                        displayName: bootstrap.profile.displayName,
                        showsAutomaticCheckIn: !AppDependencies.attendanceChurches(in: bootstrap).isEmpty
                    )
                    .padding(FaithFormTokens.Spacing.lg)
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
            .background(theme.palette.background)
            .navigationTitle(L.tabAccount)
            .navigationDestination(for: AccountRoute.self) { route in
                switch route {
                case .automaticCheckIn:
                    AutomaticCheckInScreen(
                        model: dependencies.attendanceModel,
                        church: root.selectedChurch.map {
                            AttendanceChurch(slug: $0.churchSlug, name: $0.churchName)
                        }
                    )
                }
            }
        }
    }
}

enum AccountRoute: Hashable {
    case automaticCheckIn
}

/// Automatic check-in, from Account: the whole journey on one pushed page.
///
/// Setup steps replace the status in place and end back on it, so there is no
/// sheet to lose track of. Nothing is requested until a button on the page is
/// tapped.
struct AutomaticCheckInScreen: View {
    @Environment(\.faithformTheme) private var theme
    @Environment(\.openURL) private var openURL
    @Environment(\.dismiss) private var dismiss
    let model: AutomaticAttendanceModel
    let church: AttendanceChurch?

    var body: some View {
        AutomaticAttendanceFlowView(
            model: model,
            onOpenSettings: {
                if let url = URL(string: UIApplication.openSettingsURLString) { openURL(url) }
            },
            onClose: { dismiss() }
        )
        .navigationTitle(L.autoAttendanceTitle)
        .navigationBarTitleDisplayMode(.inline)
        .task {
            await model.select(church: church)
            await model.refresh()
        }
        // Leaving part-way is "Not now" on that step.
        .onDisappear {
            if model.step.isSetup, !model.isWorking { Task { await model.notNow() } }
        }
    }
}

/// The Account row: what automatic check-in is doing, one tap from its page.
private struct AutomaticCheckInRow: View {
    @Environment(\.faithformTheme) private var theme
    let model: AutomaticAttendanceModel

    var body: some View {
        NavigationLink(value: AccountRoute.automaticCheckIn) {
            HStack(spacing: FaithFormTokens.Spacing.md) {
                Image(systemName: "location.circle")
                    .font(.system(size: FaithFormTokens.IconSize.sizeMedium))
                    .foregroundStyle(theme.palette.brandPrimary)
                    .accessibilityHidden(true)
                Text(L.autoAttendanceTitle)
                    .font(theme.font(FaithFormTokens.Text.body))
                    .foregroundStyle(theme.palette.contentPrimary)
                Spacer(minLength: FaithFormTokens.Spacing.md)
                StatusChip(
                    model.isEnabled ? L.autoAttendanceOn : L.autoAttendanceOff,
                    tone: model.isEnabled ? (model.step == .ready ? .success : .warning) : .neutral
                )
                Image(systemName: "chevron.right")
                    .foregroundStyle(theme.palette.contentSecondary)
                    .accessibilityHidden(true)
            }
            .frame(minHeight: FaithFormTokens.TouchTarget.recommended)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .task { await model.refresh() }
    }
}

/// Who is signed in, and every way to leave: sign out, delete the account, and
/// the documents that say what happens to their information.
///
/// Used by the Account tab and by the first-run flow, so a person with no
/// church yet has exactly the same controls as one with five.
struct AccountView: View {
    @Environment(\.faithformTheme) private var theme
    let dependencies: AppDependencies
    let root: RootModel
    let displayName: String?
    /// Only with a church to be checked in at. The first-run flow has none, so
    /// it offers nothing that would lead to a location prompt.
    var showsAutomaticCheckIn = false

    var body: some View {
        VStack(alignment: .leading, spacing: FaithFormTokens.Spacing.lg) {
            VStack(alignment: .leading, spacing: FaithFormTokens.Spacing.xs) {
                Text(displayName ?? L.appName)
                    .font(theme.font(FaithFormTokens.Text.displayLarge))
                    .foregroundStyle(theme.palette.contentPrimary)
                // Which environment this build points at — for the people
                // testing one. A development build compiles debug controls in;
                // a build going to a church never does, and a congregation has
                // no use for the word "production" under their name.
                if dependencies.allowsDebugControls {
                    Text(dependencies.environment.key)
                        .font(theme.font(FaithFormTokens.Text.caption))
                        .foregroundStyle(theme.palette.contentSecondary)
                }
            }

            if showsAutomaticCheckIn {
                AutomaticCheckInRow(model: dependencies.attendanceModel)
            }

            Button(L.signOut) { Task { await root.signOut() } }
                .buttonStyle(FaithFormButtonStyle(kind: .secondary, theme: theme))

            AccountDeletionControl(root: root)

            LegalLinksView()
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

// MARK: - Deleting the account

/// "Delete my account", with the confirmation App Review expects and the
/// failure a person needs.
///
/// ## The sequence
///
/// Tap, then a confirmation that says what happens — the account stops working
/// at once, deletion finishes within 30 days, churches keep their own records,
/// and it cannot be undone. Only a confirmed tap sends the request. On success
/// `RootModel` signs out locally and the root shows a short confirmation; on
/// failure the reason is shown here and the person stays signed in, with the
/// same button ready to try again.
///
/// Reachable from the Account tab, the first-run flow and the "couldn't load
/// your account" screen: guideline 5.1.1(v) is about being able to leave, and
/// neither having no church nor a bootstrap that will not load should be in the
/// way.
struct AccountDeletionControl: View {
    @Environment(\.faithformTheme) private var theme
    let root: RootModel

    @State private var confirming = false

    var body: some View {
        let deletion = root.deletion
        let working = deletion.phase == .working

        VStack(alignment: .leading, spacing: FaithFormTokens.Spacing.xs) {
            Button {
                confirming = true
            } label: {
                if working {
                    HStack(spacing: FaithFormTokens.Spacing.sm) {
                        ProgressView().tint(theme.palette.destructiveContent)
                        Text(L.deleteAccountWorking)
                    }
                } else {
                    Text(L.deleteAccount)
                }
            }
            .buttonStyle(FaithFormButtonStyle(kind: .destructive, theme: theme))
            .disabled(working)
            .accessibilityHint(Text(L.deleteAccountHint))

            Text(L.deleteAccountHint)
                .font(theme.font(FaithFormTokens.Text.caption))
                .foregroundStyle(theme.palette.contentSecondary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .confirmationDialog(
            L.deleteAccountConfirmTitle,
            isPresented: $confirming,
            titleVisibility: .visible
        ) {
            // The system supplies Cancel. The only other choice is the
            // destructive one, named exactly as the button that opened this.
            Button(L.deleteAccount, role: .destructive) {
                Task { await root.deleteAccount() }
            }
        } message: {
            Text(L.deleteAccountConfirmBody)
        }
        .alert(
            L.deleteAccountFailedTitle,
            isPresented: Binding(
                get: { if case .failed = deletion.phase { return true } else { return false } },
                set: { if !$0 { deletion.acknowledgeFailure() } }
            )
        ) {
            // An empty action list gives the system's own OK.
        } message: {
            if case let .failed(message) = deletion.phase {
                Text(message)
            }
        }
    }
}

// MARK: - Legal

/// The Privacy Policy, the Terms, and how account deletion works.
///
/// Opened with `openURL` — in Safari, never in a view inside the app — so the
/// page is the published one, with its address showing. See `LegalLinks`.
struct LegalLinksView: View {
    @Environment(\.faithformTheme) private var theme
    @Environment(\.openURL) private var openURL

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            link(L.privacyPolicy, LegalLinks.privacyPolicy)
            link(L.termsOfService, LegalLinks.termsOfService)
            link(L.accountDeletionHelp, LegalLinks.accountDeletion)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func link(_ title: String, _ url: URL) -> some View {
        Button {
            openURL(url)
        } label: {
            HStack {
                Text(title)
                    .font(theme.font(FaithFormTokens.Text.body))
                    .foregroundStyle(theme.palette.contentPrimary)
                Spacer(minLength: FaithFormTokens.Spacing.md)
                Image(systemName: "arrow.up.right")
                    .foregroundStyle(theme.palette.contentSecondary)
                    .accessibilityHidden(true)
            }
            .frame(minHeight: FaithFormTokens.TouchTarget.recommended)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(.isLink)
    }
}
