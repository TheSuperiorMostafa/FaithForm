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
                        avatarUrl: bootstrap.profile.avatarUrl,
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
                case .churchAppearance:
                    ChurchAppearanceScreen(root: root)
                }
            }
        }
    }
}

enum AccountRoute: Hashable {
    case automaticCheckIn
    case churchAppearance
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
    var avatarUrl: String? = nil
    /// Only with a church to be checked in at. The first-run flow has none, so
    /// it offers nothing that would lead to a location prompt.
    var showsAutomaticCheckIn = false

    @State private var draftName = ""
    @State private var savingName = false
    @State private var nameSaveFailed = false

    var body: some View {
        VStack(alignment: .leading, spacing: FaithFormTokens.Spacing.xl) {
            identityHeader

            if displayName == nil {
                nameEditor
            }

            if showsAutomaticCheckIn {
                VStack(alignment: .leading, spacing: FaithFormTokens.Spacing.sm) {
                    Text(L.preferencesSection)
                        .font(theme.font(FaithFormTokens.Text.label))
                        .foregroundStyle(theme.mutedContent)
                    AutomaticCheckInRow(model: dependencies.attendanceModel)
                }
            }

            if root.selectedChurch?.canManageBranding == true {
                VStack(alignment: .leading, spacing: FaithFormTokens.Spacing.sm) {
                    Text(L.churchToolsSection)
                        .font(theme.font(FaithFormTokens.Text.label))
                        .foregroundStyle(theme.mutedContent)
                    NavigationLink(value: AccountRoute.churchAppearance) {
                        HStack(spacing: FaithFormTokens.Spacing.md) {
                            Image(systemName: "paintpalette")
                                .foregroundStyle(theme.palette.brandPrimary)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(L.churchAppearanceTitle)
                                    .foregroundStyle(theme.palette.contentPrimary)
                                Text(L.churchAppearanceRowBody)
                                    .font(theme.font(FaithFormTokens.Text.caption))
                                    .foregroundStyle(theme.palette.contentSecondary)
                            }
                            Spacer()
                            Image(systemName: "chevron.right")
                                .foregroundStyle(theme.palette.contentSecondary)
                        }
                        .frame(minHeight: FaithFormTokens.TouchTarget.recommended)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                }
            }

            VStack(alignment: .leading, spacing: FaithFormTokens.Spacing.sm) {
                Text(L.legalSection)
                    .font(theme.font(FaithFormTokens.Text.label))
                    .foregroundStyle(theme.mutedContent)
                LegalLinksView()
            }

            VStack(alignment: .leading, spacing: FaithFormTokens.Spacing.md) {
                Button(L.signOut) { Task { await root.signOut() } }
                    .buttonStyle(FaithFormButtonStyle(kind: .secondary, theme: theme))
                AccountDeletionControl(root: root)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .onAppear {
            if draftName.isEmpty { draftName = displayName ?? "" }
        }
    }

    private var identityHeader: some View {
        HStack(spacing: FaithFormTokens.Spacing.base) {
            accountAvatar
            VStack(alignment: .leading, spacing: FaithFormTokens.Spacing.xs) {
                Text(displayName ?? L.yourAccount)
                    .font(theme.font(FaithFormTokens.Text.displayMedium))
                    .foregroundStyle(theme.palette.contentPrimary)
                if dependencies.allowsDebugControls {
                    Text(dependencies.environment.key)
                        .font(theme.font(FaithFormTokens.Text.caption))
                        .foregroundStyle(theme.palette.contentSecondary)
                }
            }
        }
        .accessibilityElement(children: .combine)
    }

    private var nameEditor: some View {
        VStack(alignment: .leading, spacing: FaithFormTokens.Spacing.sm) {
            Text(L.accountAddNameHint)
                .font(theme.font(FaithFormTokens.Text.bodySmall))
                .foregroundStyle(theme.palette.contentSecondary)
            AuthField(label: L.authNameLabel, text: $draftName, content: .name)
            if nameSaveFailed {
                AuthErrorText(message: L.errorTitle)
            }
            Button {
                Task {
                    savingName = true
                    nameSaveFailed = false
                    let ok = await root.updateDisplayName(draftName)
                    savingName = false
                    if !ok { nameSaveFailed = true }
                }
            } label: {
                FaithFormWorkingLabel(L.accountSaveName, working: savingName)
            }
            .buttonStyle(FaithFormButtonStyle(kind: .primary, theme: theme))
            .disabled(savingName || draftName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
        }
    }

    private var accountAvatar: some View {
        let size = FaithFormTokens.TouchTarget.recommended + FaithFormTokens.Spacing.base
        return Group {
            if let avatarUrl, let url = URL(string: avatarUrl) {
                AsyncImage(url: url) { phase in
                    switch phase {
                    case let .success(image):
                        image.resizable().scaledToFill()
                    default:
                        initialsAvatar
                    }
                }
            } else {
                initialsAvatar
            }
        }
        .frame(width: size, height: size)
        .clipShape(Circle())
        .overlay(Circle().strokeBorder(theme.palette.border, lineWidth: 1))
        .accessibilityHidden(true)
    }

    private var initialsAvatar: some View {
        ZStack {
            theme.palette.surfaceSunken
            if let displayName, !displayName.isEmpty {
                Text(initials(from: displayName))
                    .font(theme.font(FaithFormTokens.Text.titleMedium))
                    .foregroundStyle(theme.palette.brandPrimary)
            } else {
                Image(systemName: "person.fill")
                    .font(.system(size: FaithFormTokens.IconSize.sizeLarge))
                    .foregroundStyle(theme.palette.brandPrimary)
            }
        }
    }

    private func initials(from name: String) -> String {
        let parts = name.split(separator: " ").prefix(2)
        let letters = parts.compactMap { $0.first.map(String.init) }
        return letters.isEmpty ? String(name.prefix(1)).uppercased() : letters.joined().uppercased()
    }
}

private struct ChurchAppearancePreset: Identifiable {
    let id: String
    let name: String
    let primary: String
    let accent: String
}

private struct ChurchAppearanceScreen: View {
    @Environment(\.faithformTheme) private var theme
    @Environment(\.dismiss) private var dismiss
    let root: RootModel

    @State private var primary = "#1A2B4B"
    @State private var accent = "#C19A6B"
    @State private var saving = false
    @State private var message: String?

    private let presets = [
        ChurchAppearancePreset(id: "classic", name: "Classic", primary: "#1A2B4B", accent: "#C19A6B"),
        ChurchAppearancePreset(id: "ocean", name: "Ocean", primary: "#164E63", accent: "#22D3EE"),
        ChurchAppearancePreset(id: "hope", name: "Hope", primary: "#365314", accent: "#A3E635"),
        ChurchAppearancePreset(id: "grace", name: "Grace", primary: "#581C87", accent: "#D8B4FE"),
        ChurchAppearancePreset(id: "warm", name: "Warm", primary: "#7C2D12", accent: "#FDBA74"),
        ChurchAppearancePreset(id: "modern", name: "Modern", primary: "#111827", accent: "#60A5FA")
    ]

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: FaithFormTokens.Spacing.lg) {
                Text(L.churchAppearanceBody)
                    .foregroundStyle(theme.palette.contentSecondary)

                preview

                Text(L.churchAppearancePresets)
                    .font(theme.font(FaithFormTokens.Text.titleMedium))
                LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 12) {
                    ForEach(presets) { preset in
                        Button {
                            primary = preset.primary
                            accent = preset.accent
                            message = nil
                        } label: {
                            HStack {
                                Circle().fill(Color(hexCode: preset.primary)).frame(width: 24, height: 24)
                                Circle().fill(Color(hexCode: preset.accent)).frame(width: 24, height: 24)
                                Text(preset.name).foregroundStyle(theme.palette.contentPrimary)
                                Spacer(minLength: 0)
                            }
                            .padding(12)
                            .background(theme.palette.surface, in: RoundedRectangle(cornerRadius: 12))
                            .overlay(RoundedRectangle(cornerRadius: 12).stroke(theme.palette.border))
                        }
                        .buttonStyle(.plain)
                    }
                }

                VStack(alignment: .leading, spacing: FaithFormTokens.Spacing.sm) {
                    Text(L.churchAppearanceCustom)
                        .font(theme.font(FaithFormTokens.Text.titleMedium))
                    TextField("#1A2B4B", text: $primary)
                        .textInputAutocapitalization(.characters)
                        .padding(12).background(theme.palette.surface, in: RoundedRectangle(cornerRadius: 10))
                    TextField("#C19A6B", text: $accent)
                        .textInputAutocapitalization(.characters)
                        .padding(12).background(theme.palette.surface, in: RoundedRectangle(cornerRadius: 10))
                }

                if let message {
                    Text(message).foregroundStyle(theme.palette.contentSecondary)
                }
                Button {
                    Task {
                        saving = true
                        let ok = await root.updateChurchTheme(
                            primaryColor: validHex(primary),
                            accentColor: validHex(accent)
                        )
                        saving = false
                        message = ok ? L.churchAppearanceSaved : L.churchAppearanceError
                        if ok { dismiss() }
                    }
                } label: {
                    FaithFormWorkingLabel(L.churchAppearanceSave, working: saving)
                }
                .buttonStyle(FaithFormButtonStyle(kind: .primary, theme: theme))
                .disabled(saving || validHex(primary) == nil || validHex(accent) == nil)
            }
            .padding(FaithFormTokens.Spacing.lg)
        }
        .background(theme.palette.background)
        .navigationTitle(L.churchAppearanceTitle)
        .navigationBarTitleDisplayMode(.inline)
        .onAppear {
            if let appTheme = root.selectedChurch?.appTheme {
                primary = appTheme.light.primary
                accent = appTheme.light.accent
            }
        }
    }

    private var preview: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(root.selectedChurch?.churchName ?? L.churchAppearanceTitle)
                .font(theme.font(FaithFormTokens.Text.titleLarge))
                .foregroundStyle(Color(hexCode: primary))
            Text(L.churchAppearancePreview)
                .foregroundStyle(theme.palette.contentSecondary)
            Text(L.churchAppearanceButton)
                .font(theme.font(FaithFormTokens.Text.label))
                .padding(.horizontal, 18).padding(.vertical, 12)
                .background(Color(hexCode: accent), in: RoundedRectangle(cornerRadius: 10))
                .foregroundStyle(Color(hexCode: primary))
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(20)
        .background(theme.palette.surface, in: RoundedRectangle(cornerRadius: 16))
    }

    private func validHex(_ value: String) -> String? {
        let normalized = value.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
        return normalized.range(of: "^#[0-9A-F]{6}$", options: .regularExpression) == nil ? nil : normalized
    }
}

private extension Color {
    init(hexCode: String) {
        let normalized = hexCode.trimmingCharacters(in: .whitespacesAndNewlines)
        let value = UInt64(normalized.dropFirst(), radix: 16) ?? 0x1A2B4B
        self.init(.sRGB, red: Double((value >> 16) & 255) / 255, green: Double((value >> 8) & 255) / 255, blue: Double(value & 255) / 255)
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
                FaithFormWorkingLabel(working ? L.deleteAccountWorking : L.deleteAccount, working: working)
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
