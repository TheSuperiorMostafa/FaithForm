import SwiftUI

/// The welcome screen someone sees with no church yet.
///
/// Two doors and nothing else. Editorial rather than dense: one confident
/// sentence, generous space, and the two things a person can actually do.
public struct WelcomeView: View {
    @Environment(\.faithfulTheme) private var theme
    private let onFindChurch: @MainActor () -> Void
    private let onHaveInvitation: @MainActor () -> Void

    public init(
        onFindChurch: @escaping @MainActor () -> Void,
        onHaveInvitation: @escaping @MainActor () -> Void
    ) {
        self.onFindChurch = onFindChurch
        self.onHaveInvitation = onHaveInvitation
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: FaithfulTokens.Spacing.lg) {
            Spacer(minLength: FaithfulTokens.Spacing.xxl)

            VStack(alignment: .leading, spacing: FaithfulTokens.Spacing.md) {
                Text(L.welcomeTitle)
                    .font(theme.font(FaithfulTokens.Text.displayLarge))
                    .foregroundStyle(theme.palette.contentPrimary)
                Text(L.welcomeBody)
                    .font(theme.font(FaithfulTokens.Text.body))
                    .foregroundStyle(theme.palette.contentSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }

            Spacer()

            VStack(spacing: FaithfulTokens.Spacing.md) {
                Button(L.findAChurch, action: onFindChurch)
                    .buttonStyle(FaithfulButtonStyle(kind: .primary, theme: theme))
                Button(L.haveInvitation, action: onHaveInvitation)
                    .buttonStyle(FaithfulButtonStyle(kind: .secondary, theme: theme))
            }
        }
        .padding(.horizontal, FaithfulTokens.Layout.screenPaddingHorizontal)
        .padding(.bottom, FaithfulTokens.Spacing.xl)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
        .background(theme.palette.background)
    }
}

/// Why location is being asked for, before the OS is allowed to ask.
///
/// Declining leads somewhere useful rather than to a dead end — the secondary
/// action is a real alternative, not a dismissal.
public struct LocationEducationView: View {
    @Environment(\.faithfulTheme) private var theme
    private let onContinue: @MainActor () -> Void
    private let onSkip: @MainActor () -> Void

    public init(
        onContinue: @escaping @MainActor () -> Void,
        onSkip: @escaping @MainActor () -> Void
    ) {
        self.onContinue = onContinue
        self.onSkip = onSkip
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: FaithfulTokens.Spacing.lg) {
            Text(L.locationEducationTitle)
                .font(theme.font(FaithfulTokens.Text.displayMedium))
                .foregroundStyle(theme.palette.contentPrimary)
            Text(L.locationEducationBody)
                .font(theme.font(FaithfulTokens.Text.body))
                .foregroundStyle(theme.palette.contentSecondary)
                .fixedSize(horizontal: false, vertical: true)

            Spacer()

            Button(L.locationContinue, action: onContinue)
                .buttonStyle(FaithfulButtonStyle(kind: .primary, theme: theme))
            Button(L.locationSkip, action: onSkip)
                .buttonStyle(FaithfulButtonStyle(kind: .quiet, theme: theme))
        }
        .padding(FaithfulTokens.Layout.screenPaddingHorizontal)
        .background(theme.palette.background)
        .accessibilityElement(children: .contain)
    }
}

/// One church in a result list.
public struct ChurchResultCard: View {
    @Environment(\.faithfulTheme) private var theme
    private let church: DiscoveredChurch
    private let onOpen: @MainActor () -> Void

    public init(church: DiscoveredChurch, onOpen: @escaping @MainActor () -> Void) {
        self.church = church
        self.onOpen = onOpen
    }

    public var body: some View {
        Button(action: onOpen) {
            FaithfulCard {
                VStack(alignment: .leading, spacing: FaithfulTokens.Spacing.xs) {
                    Text(church.name)
                        .font(theme.font(FaithfulTokens.Text.titleMedium))
                        .foregroundStyle(theme.palette.contentPrimary)

                    if let summary = church.publicSummary, !summary.isEmpty {
                        Text(summary)
                            .font(theme.font(FaithfulTokens.Text.bodySmall))
                            .foregroundStyle(theme.palette.contentSecondary)
                            .lineLimit(2)
                    }

                    HStack(spacing: FaithfulTokens.Spacing.sm) {
                        if let place = placeLine {
                            Text(place)
                                .font(theme.font(FaithfulTokens.Text.caption))
                                .foregroundStyle(theme.mutedContent)
                        }
                        if let distance = church.distanceKm {
                            StatusChip(String(format: L.distanceAway, String(format: "%.1f", distance)))
                        }
                    }
                }
            }
        }
        .buttonStyle(.plain)
        // One element with one combined label, so VoiceOver reads a church as a
        // church rather than as four disconnected fragments.
        .accessibilityElement(children: .combine)
    }

    private var placeLine: String? {
        [church.city, church.state].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: ", ")
            .nilIfEmpty
    }
}

extension String {
    var nilIfEmpty: String? { isEmpty ? nil : self }
}

/// The discovery screen: search first, nearby as a deliberate opt-in.
public struct DiscoveryView: View {
    @Environment(\.faithfulTheme) private var theme
    @Bindable private var model: DiscoveryModel
    private let onOpenChurch: @MainActor (String) -> Void
    /// The host decides what "near me" does next — usually showing the
    /// education screen before any OS prompt. Without a host handler the tap
    /// still records that education is due, and nothing prompts.
    private let onNearby: (@MainActor () -> Void)?

    public init(
        model: DiscoveryModel,
        onOpenChurch: @escaping @MainActor (String) -> Void,
        onNearby: (@MainActor () -> Void)? = nil
    ) {
        self.model = model
        self.onOpenChurch = onOpenChurch
        self.onNearby = onNearby
    }

    public var body: some View {
        VStack(spacing: FaithfulTokens.Spacing.base) {
            searchBar

            Button(L.churchesNearMe) {
                if let onNearby {
                    onNearby()
                } else {
                    Task { await model.beginNearbyFlow() }
                }
            }
            .buttonStyle(FaithfulButtonStyle(kind: .secondary, theme: theme))

            content
        }
        .padding(.horizontal, FaithfulTokens.Layout.screenPaddingHorizontal)
        .background(theme.palette.background)
        .navigationTitle(L.searchResultsTitle)
    }

    private var searchBar: some View {
        HStack(spacing: FaithfulTokens.Spacing.sm) {
            Image(systemName: "magnifyingglass")
                .foregroundStyle(theme.mutedContent)
            TextField(L.searchPlaceholder, text: $model.query)
                .font(theme.font(FaithfulTokens.Text.body))
                .submitLabel(.search)
                .onSubmit { Task { await model.search() } }
                .accessibilityLabel(Text(L.searchPlaceholder))
        }
        .padding(.horizontal, FaithfulTokens.Spacing.base)
        .frame(minHeight: FaithfulTokens.TouchTarget.minimum)
        .background(Capsule().fill(theme.palette.surfaceSunken))
    }

    @ViewBuilder
    private var content: some View {
        switch model.phase {
        case .idle:
            EmptyStateView(title: L.searchResultsTitle, explanation: L.searchPlaceholder)
        case .searching:
            // A skeleton that mirrors the real card shape, not a spinner: it
            // tells the eye where the results will land.
            VStack(spacing: FaithfulTokens.Spacing.md) {
                ForEach(0..<3, id: \.self) { _ in SkeletonCard() }
            }
            .accessibilityLabel(Text(L.loadingAccount))
        case let .results(churches, _):
            ScrollView {
                LazyVStack(spacing: FaithfulTokens.Spacing.md) {
                    ForEach(churches, id: \.slug) { church in
                        ChurchResultCard(church: church) { onOpenChurch(church.slug) }
                    }
                }
                .padding(.vertical, FaithfulTokens.Spacing.sm)
            }
        case .empty:
            EmptyStateView(title: L.noResultsTitle, explanation: L.noResultsBody)
        case .offline:
            EmptyStateView(title: L.offlineTitle, explanation: L.offlineBody)
        case let .failed(message):
            EmptyStateView(title: L.errorTitle, explanation: message)
        }
        Spacer(minLength: 0)
    }
}

/// Mirrors the real card's shape so loading does not reflow into results.
public struct SkeletonCard: View {
    @Environment(\.faithfulTheme) private var theme
    @State private var shimmer = false

    public init() {}

    public var body: some View {
        FaithfulCard {
            VStack(alignment: .leading, spacing: FaithfulTokens.Spacing.sm) {
                RoundedRectangle(cornerRadius: FaithfulTokens.Radius.sm)
                    .fill(theme.palette.skeletonBase)
                    .frame(height: 18)
                    .frame(maxWidth: 180)
                RoundedRectangle(cornerRadius: FaithfulTokens.Radius.sm)
                    .fill(theme.palette.skeletonBase)
                    .frame(height: 14)
            }
        }
        .opacity(shimmer ? 0.65 : 1)
        .onAppear {
            // Respects Reduce Motion: with it on, the skeleton simply sits
            // there rather than pulsing.
            guard !theme.reduceMotion else { return }
            withAnimation(.easeInOut(duration: 1.2).repeatForever(autoreverses: true)) {
                shimmer = true
            }
        }
        .accessibilityHidden(true)
    }
}
