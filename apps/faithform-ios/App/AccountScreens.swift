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
                AccountView(
                    dependencies: dependencies,
                    root: root,
                    displayName: bootstrap.profile.displayName,
                    avatarUrl: bootstrap.profile.avatarUrl,
                    showsAutomaticCheckIn: !AppDependencies.attendanceChurches(in: bootstrap).isEmpty
                )
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
            .background(theme.palette.background)
            .navigationTitle(L.tabAccount)
            .navigationBarTitleDisplayMode(.inline)
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
                case .notifications:
                    NotificationSettingsScreen(
                        push: dependencies.push,
                        api: dependencies.api,
                        churches: (root.state.bootstrap?.relationships ?? [])
                            .filter { $0.canReadPublishedContent && $0.state != .blocked && $0.state != .left }
                            .map { (slug: $0.churchSlug, name: $0.churchName) }
                    )
                }
            }
        }
    }
}

enum AccountRoute: Hashable {
    case automaticCheckIn
    case churchAppearance
    case notifications
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
/// Laid out as the rest of the app now is: a hero washed in the person's own
/// photo, then panels. It owns its scroll view and its background so the wash
/// can run edge to edge and up under the title bar — a caller that wrapped it
/// in its own `ScrollView` would cut the header into a card.
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

    @AppStorage("faithform.appearance") private var appearance = "system"
    @State private var editingName = false

    var body: some View {
        ScrollView {
            VStack(spacing: 22) {
                ProfileHeroView(
                    root: root,
                    displayName: displayName,
                    avatarUrl: avatarUrl,
                    subtitle: root.selectedChurch?.churchName ?? "FaithForm account"
                )

                VStack(spacing: 22) {
                    detailsPanel
                    preferencesPanel
                    if root.selectedChurch?.canManageBranding == true { churchToolsPanel }
                    legalPanel
                    exitActions
                }
                .padding(.horizontal, 20)
            }
            .padding(.bottom, 36)
            .frame(maxWidth: FaithFormTokens.Layout.contentMaxWidth)
            .frame(maxWidth: .infinity)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        // The wash is the person's own photo, blurred past recognition, so the
        // header reads as one surface from the status bar down.
        .background(alignment: .top) {
            ProfileAvatarWash(url: avatarUrl)
                .frame(height: 360)
                .ignoresSafeArea(edges: .top)
        }
        .background(theme.palette.background.ignoresSafeArea())
        .sheet(isPresented: $editingName) {
            NameEditorSheet(root: root, current: displayName ?? "")
        }
    }

    // MARK: Panels

    private var detailsPanel: some View {
        GroupPanelView("Your details") {
            Button { editingName = true } label: {
                HStack(spacing: FaithFormTokens.Spacing.md) {
                    Image(systemName: "person.text.rectangle")
                        .font(.system(size: FaithFormTokens.IconSize.sizeMedium))
                        .foregroundStyle(theme.palette.brandAccent)
                        .accessibilityHidden(true)
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Display name")
                            .font(theme.font(FaithFormTokens.Text.caption))
                            .foregroundStyle(theme.palette.contentSecondary)
                        Text(displayName ?? "Add your name")
                            .font(theme.font(FaithFormTokens.Text.body))
                            .foregroundStyle(
                                displayName == nil ? theme.palette.contentSecondary : theme.palette.contentPrimary
                            )
                    }
                    Spacer(minLength: FaithFormTokens.Spacing.md)
                    Text(displayName == nil ? "Add" : "Edit")
                        .font(theme.font(FaithFormTokens.Text.label))
                        .foregroundStyle(theme.palette.brandAccent)
                }
                .frame(minHeight: FaithFormTokens.TouchTarget.recommended)
                .contentShape(Rectangle())
            }
            .buttonStyle(GroupPressStyle())
            .accessibilityLabel("Display name, \(displayName ?? "not set")")
            .accessibilityHint("Opens an editor for the name other people see")
        }
    }

    private var preferencesPanel: some View {
        GroupPanelView(L.preferencesSection) {
            VStack(alignment: .leading, spacing: FaithFormTokens.Spacing.sm) {
                Text("Appearance")
                    .font(theme.font(FaithFormTokens.Text.bodySmall))
                    .foregroundStyle(theme.palette.contentSecondary)
                Picker("Appearance", selection: $appearance) {
                    Text("System").tag("system")
                    Text("Light").tag("light")
                    Text("Dark").tag("dark")
                }
                .pickerStyle(.segmented)
            }

            Divider().overlay(theme.palette.divider)
            NavigationLink(value: AccountRoute.notifications) {
                HStack(spacing: FaithFormTokens.Spacing.md) {
                    Image(systemName: "bell")
                        .font(.system(size: FaithFormTokens.IconSize.sizeMedium))
                        .foregroundStyle(theme.palette.brandAccent)
                        .accessibilityHidden(true)
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Notifications")
                            .font(theme.font(FaithFormTokens.Text.body))
                            .foregroundStyle(theme.palette.contentPrimary)
                        Text("Announcements, events and services going live")
                            .font(theme.font(FaithFormTokens.Text.caption))
                            .foregroundStyle(theme.palette.contentSecondary)
                    }
                    Spacer(minLength: FaithFormTokens.Spacing.md)
                    Image(systemName: "chevron.right")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(theme.palette.contentSecondary)
                        .accessibilityHidden(true)
                }
                .frame(minHeight: FaithFormTokens.TouchTarget.recommended)
                .contentShape(Rectangle())
            }
            .buttonStyle(GroupPressStyle())

            if showsAutomaticCheckIn {
                Divider().overlay(theme.palette.divider)
                AutomaticCheckInRow(model: dependencies.attendanceModel)
            }
        }
    }

    private var churchToolsPanel: some View {
        GroupPanelView(L.churchToolsSection) {
            NavigationLink(value: AccountRoute.churchAppearance) {
                HStack(spacing: FaithFormTokens.Spacing.md) {
                    Image(systemName: "paintpalette")
                        .font(.system(size: FaithFormTokens.IconSize.sizeMedium))
                        .foregroundStyle(theme.palette.brandAccent)
                        .accessibilityHidden(true)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(L.churchAppearanceTitle)
                            .font(theme.font(FaithFormTokens.Text.body))
                            .foregroundStyle(theme.palette.contentPrimary)
                        Text(L.churchAppearanceRowBody)
                            .font(theme.font(FaithFormTokens.Text.caption))
                            .foregroundStyle(theme.palette.contentSecondary)
                    }
                    Spacer(minLength: FaithFormTokens.Spacing.md)
                    Image(systemName: "chevron.right")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(theme.palette.contentSecondary)
                        .accessibilityHidden(true)
                }
                .frame(minHeight: FaithFormTokens.TouchTarget.recommended)
                .contentShape(Rectangle())
            }
            .buttonStyle(GroupPressStyle())
        }
    }

    private var legalPanel: some View {
        GroupPanelView(L.legalSection) { LegalLinksView() }
    }

    private var exitActions: some View {
        VStack(alignment: .leading, spacing: FaithFormTokens.Spacing.md) {
            Button(L.signOut) { Task { await root.signOut() } }
                .buttonStyle(FaithFormButtonStyle(kind: .secondary, theme: theme))
            AccountDeletionControl(root: root)
        }
    }
}

/// The header: the photo, the name, and the one tap that changes either.
///
/// The avatar *is* the control. A row of "Change photo / Remove" buttons under
/// a picture is the shape of a settings form; tapping the picture is the shape
/// of every app people already use, and it leaves the header to be a header.
private struct ProfileHeroView: View {
    @Environment(\.faithformTheme) private var theme
    let root: RootModel
    let displayName: String?
    let avatarUrl: String?
    let subtitle: String

    @State private var draft: PhotoDraft?
    @State private var picking = false
    @State private var loading = false
    @State private var removing = false
    @State private var failed = false
    @State private var confirmRemoval = false

    private var hasPhoto: Bool { avatarUrl != nil }
    private var busy: Bool { loading || removing }

    var body: some View {
        VStack(spacing: 14) {
            Menu {
                Button {
                    picking = true
                } label: {
                    Label(hasPhoto ? "Choose a new photo" : "Choose a photo", systemImage: "photo.on.rectangle")
                }
                if hasPhoto {
                    Button(role: .destructive) { confirmRemoval = true } label: {
                        Label("Remove photo", systemImage: "trash")
                    }
                }
            } label: {
                avatar
            }
            .disabled(busy)
            .accessibilityLabel(hasPhoto ? "Profile photo" : "Add a profile photo")
            .accessibilityHint("Opens choices for changing your photo")

            VStack(spacing: 6) {
                Text(displayName ?? L.yourAccount)
                    .font(theme.font(FaithFormTokens.Text.displayMedium))
                    .foregroundStyle(theme.palette.contentPrimary)
                    .multilineTextAlignment(.center)
                Text(subtitle)
                    .font(theme.font(FaithFormTokens.Text.bodySmall))
                    .foregroundStyle(theme.palette.contentSecondary)
            }
            .accessibilityElement(children: .combine)

            if busy {
                Text(removing ? "Removing photo…" : "Opening photo…")
                    .font(theme.font(FaithFormTokens.Text.caption))
                    .foregroundStyle(theme.palette.contentSecondary)
                    .accessibilityAddTraits(.updatesFrequently)
            }
            if failed {
                Text("Your photo was not changed. Please try again.")
                    .font(theme.font(FaithFormTokens.Text.caption))
                    .foregroundStyle(theme.palette.destructive)
                    .accessibilityAddTraits(.updatesFrequently)
            }
        }
        .padding(.top, 12)
        .padding(.bottom, 4)
        .padding(.horizontal, 20)
        .frame(maxWidth: .infinity)
        .modifier(ProfilePhotoPicker(draft: $draft, failed: $failed, loading: $loading, isPresented: $picking))
        .confirmationDialog("Remove profile photo?", isPresented: $confirmRemoval, titleVisibility: .visible) {
            Button("Remove photo", role: .destructive) {
                Task {
                    removing = true
                    failed = !(await root.updateProfilePhoto(nil))
                    removing = false
                }
            }
        }
        .fullScreenCover(item: $draft) { draft in
            ProfilePhotoCropper(image: draft.image, save: { data in await root.updateProfilePhoto(data) })
        }
    }

    private var avatar: some View {
        ZStack(alignment: .bottomTrailing) {
            ProfileAvatarView(url: avatarUrl, name: displayName, size: 112)
            // The badge says the picture is a button without needing a caption.
            ZStack {
                Circle().fill(theme.palette.brandAccent)
                Image(systemName: hasPhoto ? "pencil" : "plus")
                    .font(.system(size: 14, weight: .bold))
                    .foregroundStyle(theme.palette.brandPrimary)
            }
            .frame(width: 34, height: 34)
            .overlay(Circle().strokeBorder(theme.palette.background, lineWidth: 3))
            .offset(x: 2, y: 2)
        }
        .opacity(busy ? 0.5 : 1)
        .overlay {
            if busy { ProgressView().tint(theme.palette.brandAccent) }
        }
    }
}

/// The person's photo, or their initials on the brand wash. Circular
/// everywhere — a face is not a logo, and the square treatment the Groups
/// screens use for church and group artwork would crop it like one.
struct ProfileAvatarView: View {
    @Environment(\.faithformTheme) private var theme
    let url: String?
    let name: String?
    var size: CGFloat = 112

    var body: some View {
        ZStack {
            LinearGradient(
                colors: [theme.palette.brandAccent.opacity(0.34), theme.palette.brandAccentSoft.opacity(0.18)],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
            if let name, !name.isEmpty {
                Text(profileInitials(from: name))
                    .font(.system(size: size * 0.34, weight: .semibold, design: .rounded))
                    .foregroundStyle(theme.palette.contentPrimary.opacity(0.78))
                    .minimumScaleFactor(0.6)
            } else {
                Image(systemName: "person.fill")
                    .font(.system(size: size * 0.36))
                    .foregroundStyle(theme.palette.contentPrimary.opacity(0.55))
            }
            if let url, let imageURL = URL(string: url) {
                AsyncImage(
                    url: imageURL,
                    transaction: Transaction(animation: theme.animation(FaithFormTokens.Motion.standard))
                ) { phase in
                    if let image = phase.image { image.resizable().scaledToFill().transition(.opacity) }
                }
            }
        }
        .frame(width: size, height: size)
        .clipShape(Circle())
        .overlay(Circle().strokeBorder(theme.palette.border, lineWidth: theme.borderWidth))
        .shadow(color: .black.opacity(theme.usesDecorativeShadow ? 0.18 : 0), radius: 18, y: 8)
        .accessibilityHidden(true)
    }
}

/// The same photo, blurred far past recognition, so the header carries the
/// person's own colour without stretching a face into a banner.
private struct ProfileAvatarWash: View {
    @Environment(\.faithformTheme) private var theme
    let url: String?

    var body: some View {
        ZStack {
            theme.palette.background
            if let url, let imageURL = URL(string: url) {
                AsyncImage(url: imageURL) { image in
                    image.resizable().scaledToFill().blur(radius: 52, opaque: false).opacity(0.34)
                } placeholder: { Color.clear }
            } else {
                LinearGradient(
                    colors: [theme.palette.brandAccent.opacity(0.18), theme.palette.background],
                    startPoint: .top,
                    endPoint: .bottom
                )
            }
            LinearGradient(
                colors: [theme.palette.background.opacity(0.1), theme.palette.background],
                startPoint: .top,
                endPoint: .bottom
            )
        }
        .clipped()
        .accessibilityHidden(true)
    }
}

/// Changing the name other people see.
///
/// A sheet rather than a field wired into the page, because the name is now
/// editable whenever — the old screen only offered it while it was still
/// blank, which left no way to fix a typo short of deleting the account.
private struct NameEditorSheet: View {
    @Environment(\.faithformTheme) private var theme
    @Environment(\.dismiss) private var dismiss
    let root: RootModel
    let current: String

    @State private var draft = ""
    @State private var saving = false
    @State private var failed = false

    private var trimmed: String { draft.trimmingCharacters(in: .whitespacesAndNewlines) }

    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: FaithFormTokens.Spacing.lg) {
                Text(L.accountAddNameHint)
                    .font(theme.font(FaithFormTokens.Text.bodySmall))
                    .foregroundStyle(theme.palette.contentSecondary)
                AuthField(label: L.authNameLabel, text: $draft, content: .name)
                if failed { AuthErrorText(message: L.errorTitle) }
                Spacer(minLength: 0)
            }
            .padding(FaithFormTokens.Spacing.lg)
            .background(theme.palette.background)
            .navigationTitle("Your name")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(L.cancel) { dismiss() }.disabled(saving)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(L.accountSaveName) {
                        Task {
                            saving = true
                            failed = false
                            let ok = await root.updateDisplayName(draft)
                            saving = false
                            if ok { dismiss() } else { failed = true }
                        }
                    }
                    .disabled(saving || trimmed.isEmpty || trimmed == current)
                }
            }
            .onAppear { if draft.isEmpty { draft = current } }
            .interactiveDismissDisabled(saving)
        }
        .presentationDetents([.medium])
    }
}

func profileInitials(from name: String) -> String {
    let parts = name.split(whereSeparator: { $0 == " " || $0 == "-" }).prefix(2)
    let letters = parts.compactMap { $0.first.map(String.init) }
    return letters.isEmpty ? String(name.prefix(1)).uppercased() : letters.joined().uppercased()
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

    @State private var primary = "#002D5F"
    @State private var accent = "#C5A059"
    @State private var saving = false
    @State private var message: String?

    private let presets = [
        ChurchAppearancePreset(id: "classic", name: "Classic", primary: "#002D5F", accent: "#C5A059"),
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
                    TextField("#002D5F", text: $primary)
                        .textInputAutocapitalization(.characters)
                        .padding(12).background(theme.palette.surface, in: RoundedRectangle(cornerRadius: 10))
                    TextField("#C5A059", text: $accent)
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
        let value = UInt64(normalized.dropFirst(), radix: 16) ?? 0x002D5F
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
            link(L.contactSupport, LegalLinks.support)
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
