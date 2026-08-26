import SwiftUI
import FaithfulKit

/// The screens the host adds on top of the library's feature views.
///
/// Deliberately thin. Each one composes what `FaithfulKit` already provides and
/// adds only what a *host* has to decide: which church is selected, what the
/// environment is, and what to say when a person has no church yet.

// MARK: - Not configured

/// What a build with no origin shows.
///
/// A developer sees exactly which key is missing. A person sees a sentence that
/// does not blame them and does not pretend the app is loading. This is the
/// visible half of failing closed — the other half is that no network call was
/// attempted at all.
struct UnconfiguredView: View {
    @Environment(\.faithfulTheme) private var theme
    let reason: String

    var body: some View {
        VStack(spacing: FaithfulTokens.Spacing.md) {
            EmptyStateView(title: L.notConfiguredTitle, explanation: L.notConfiguredBody)
            // Shown only where debug affordances are compiled in. A church would
            // never see a configuration key name.
            #if DEBUG
            Text(reason)
                .font(theme.font(FaithfulTokens.Text.caption))
                .foregroundStyle(theme.palette.contentSecondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal, FaithfulTokens.Spacing.xl)
            #endif
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(theme.palette.background)
    }
}

// MARK: - Home

/// The selected church, and the ways into it.
///
/// Shows what is true and nothing else: no placeholder card for a feature that
/// is off, and no "coming soon".
struct HomeView: View {
    @Environment(\.faithfulTheme) private var theme
    let bootstrap: Bootstrap
    let selectedChurch: ChurchRelationship?
    let onOpen: (RootTab) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: FaithfulTokens.Spacing.lg) {
            if let church = selectedChurch {
                VStack(alignment: .leading, spacing: FaithfulTokens.Spacing.xs) {
                    Text(church.churchName)
                        .font(theme.font(FaithfulTokens.Text.displayLarge))
                        .foregroundStyle(theme.palette.contentPrimary)
                    Text(L.homeSubtitle)
                        .font(theme.font(FaithfulTokens.Text.body))
                        .foregroundStyle(theme.palette.contentSecondary)
                }
                .fixedSize(horizontal: false, vertical: true)
            } else {
                EmptyStateView(title: L.noChurchTitle, explanation: L.noChurchBody)
                Button(L.tabChurch) { onOpen(.church) }
                    .buttonStyle(FaithfulButtonStyle(kind: .primary, theme: theme))
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

// MARK: - Church switching

struct ChurchSwitcherView: View {
    @Environment(\.faithfulTheme) private var theme
    let relationships: [ChurchRelationship]
    let selectedSlug: String?
    let onSelect: (ChurchRelationship) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: FaithfulTokens.Spacing.md) {
            if relationships.isEmpty {
                EmptyStateView(title: L.noChurchTitle, explanation: L.noChurchBody)
            } else {
                ForEach(relationships, id: \.churchSlug) { relationship in
                    Button {
                        onSelect(relationship)
                    } label: {
                        FaithfulCard {
                            VStack(alignment: .leading, spacing: FaithfulTokens.Spacing.xs) {
                                Text(relationship.churchName)
                                    .font(theme.font(FaithfulTokens.Text.titleMedium))
                                    .foregroundStyle(theme.palette.contentPrimary)
                                // A church a person cannot read from is still
                                // listed — leaving it out would look like the
                                // church vanished — but it says why.
                                if !relationship.canReadPublishedContent {
                                    Text(L.churchNoAccess)
                                        .font(theme.font(FaithfulTokens.Text.caption))
                                        .foregroundStyle(theme.palette.contentSecondary)
                                }
                            }
                            .frame(maxWidth: .infinity, alignment: .leading)
                        }
                    }
                    .buttonStyle(.plain)
                    .disabled(!relationship.canReadPublishedContent)
                    .accessibilityElement(children: .combine)
                    .accessibilityAddTraits(
                        relationship.churchSlug == selectedSlug ? [.isButton, .isSelected] : .isButton
                    )
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

// MARK: - Feature entry points

/// Check-in.
///
/// **Opening this starts nothing.** The camera is untouched until someone taps
/// the scanner, which is the rule Prompt 8 established and the reason a deep
/// link to this screen cannot raise a permission prompt.
struct CheckInEntryView: View {
    @Environment(\.faithfulTheme) private var theme
    let churchName: String

    var body: some View {
        VStack(alignment: .leading, spacing: FaithfulTokens.Spacing.md) {
            Text(churchName)
                .font(theme.font(FaithfulTokens.Text.titleMedium))
                .foregroundStyle(theme.palette.contentPrimary)
            Text(L.checkInEntryBody)
                .font(theme.font(FaithfulTokens.Text.body))
                .foregroundStyle(theme.palette.contentSecondary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

struct MediaEntryView: View {
    @Environment(\.faithfulTheme) private var theme
    let churchName: String

    var body: some View {
        VStack(alignment: .leading, spacing: FaithfulTokens.Spacing.md) {
            Text(churchName)
                .font(theme.font(FaithfulTokens.Text.titleMedium))
                .foregroundStyle(theme.palette.contentPrimary)
            Text(L.mediaEntryBody)
                .font(theme.font(FaithfulTokens.Text.body))
                .foregroundStyle(theme.palette.contentSecondary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

struct GivingEntryView: View {
    @Environment(\.faithfulTheme) private var theme
    let churchName: String

    var body: some View {
        VStack(alignment: .leading, spacing: FaithfulTokens.Spacing.md) {
            Text(churchName)
                .font(theme.font(FaithfulTokens.Text.titleMedium))
                .foregroundStyle(theme.palette.contentPrimary)
            Text(L.givingSubtitle)
                .font(theme.font(FaithfulTokens.Text.body))
                .foregroundStyle(theme.palette.contentSecondary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

// MARK: - Account

/// Profile, permissions, privacy and the environment this build points at.
struct AccountView: View {
    @Environment(\.faithfulTheme) private var theme
    let bootstrap: Bootstrap
    let environmentKey: String
    let onSignOut: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: FaithfulTokens.Spacing.lg) {
            VStack(alignment: .leading, spacing: FaithfulTokens.Spacing.xs) {
                Text(bootstrap.profile.displayName ?? L.appName)
                    .font(theme.font(FaithfulTokens.Text.displayLarge))
                    .foregroundStyle(theme.palette.contentPrimary)
                // Which environment this build points at, always visible.
                // A pilot tester holding a staging build and a production build
                // must be able to tell them apart without opening Settings.
                Text(environmentKey)
                    .font(theme.font(FaithfulTokens.Text.caption))
                    .foregroundStyle(theme.palette.contentSecondary)
            }

            Button(L.signOut, action: onSignOut)
                .buttonStyle(FaithfulButtonStyle(kind: .secondary, theme: theme))
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}
