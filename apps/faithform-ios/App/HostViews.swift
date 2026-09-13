import SwiftUI
import FaithFormKit

/// The screens the host adds on top of the library's feature views.
///
/// Deliberately thin. Each one composes what `FaithFormKit` already provides and
/// adds only what a *host* has to decide: which church is selected, what the
/// environment is, and what to say when a person has no church yet.
///
/// The tabs themselves are in `HomeTab`, `CheckInTab`, `WatchTab`, `GiveTab`
/// and `AccountScreens`; what they share per church is in `FeatureModels`.

// MARK: - Not configured

/// What a build with no origin shows.
///
/// A developer sees exactly which key is missing. A person sees a sentence that
/// does not blame them and does not pretend the app is loading. This is the
/// visible half of failing closed — the other half is that no network call was
/// attempted at all.
struct UnconfiguredView: View {
    @Environment(\.faithformTheme) private var theme
    let reason: String

    var body: some View {
        VStack(spacing: FaithFormTokens.Spacing.md) {
            EmptyStateView(title: L.notConfiguredTitle, explanation: L.notConfiguredBody, symbol: "gearshape")
            // Shown only where debug affordances are compiled in. A church would
            // never see a configuration key name.
            #if DEBUG
            Text(reason)
                .font(theme.font(FaithFormTokens.Text.caption))
                .foregroundStyle(theme.palette.contentSecondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal, FaithFormTokens.Spacing.xl)
            #endif
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(theme.palette.background)
    }
}

// MARK: - Church switching

struct ChurchSwitcherView: View {
    @Environment(\.faithformTheme) private var theme
    let relationships: [ChurchRelationship]
    let selectedSlug: String?
    let onSelect: (ChurchRelationship) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: FaithFormTokens.Spacing.md) {
            if relationships.isEmpty {
                EmptyStateView(title: L.noChurchTitle, explanation: L.noChurchBody, symbol: "building.2")
            } else {
                ForEach(relationships, id: \.churchSlug) { relationship in
                    Button {
                        onSelect(relationship)
                    } label: {
                        FaithFormCard {
                            VStack(alignment: .leading, spacing: FaithFormTokens.Spacing.xs) {
                                Text(relationship.churchName)
                                    .font(theme.font(FaithFormTokens.Text.titleMedium))
                                    .foregroundStyle(theme.palette.contentPrimary)
                                // A church a person cannot read from is still
                                // listed — leaving it out would look like the
                                // church vanished — but it says why.
                                if !relationship.canReadPublishedContent {
                                    Text(L.churchNoAccess)
                                        .font(theme.font(FaithFormTokens.Text.caption))
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
