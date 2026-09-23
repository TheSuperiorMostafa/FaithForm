import SwiftUI

/// The welcome screen someone sees with no church yet.
///
/// Invitation first — FaithForm is the church's app for their people.
/// Search stays available as a secondary door when a church has turned
/// listing on.
public struct WelcomeView: View {
    @Environment(\.faithformTheme) private var theme
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
        ScrollView {
            VStack(alignment: .leading, spacing: FaithFormTokens.Spacing.xl) {
                // Header Lockup
                VStack(alignment: .leading, spacing: FaithFormTokens.Spacing.md) {
                    HStack(spacing: FaithFormTokens.Spacing.sm) {
                        FaithFormMark()
                            .frame(height: 32)
                        Text(L.appName)
                            .font(theme.font(FaithFormTokens.Text.titleMedium))
                            .fontWeight(.bold)
                            .foregroundStyle(theme.palette.contentPrimary)
                    }

                    VStack(alignment: .leading, spacing: 6) {
                        Text("WELCOME HOME")
                            .font(.caption2.weight(.bold))
                            .tracking(2.5)
                            .foregroundStyle(theme.palette.brandAccent)
                        Text("Find your church community.")
                            .font(.system(size: 28, weight: .bold, design: .rounded))
                            .foregroundStyle(theme.palette.contentPrimary)
                            .fixedSize(horizontal: false, vertical: true)
                    }

                    Text("Connect with your congregation, follow announcements, join groups, and worship together wherever you are.")
                        .font(theme.font(FaithFormTokens.Text.body))
                        .foregroundStyle(theme.palette.contentSecondary)
                        .lineSpacing(3)
                        .fixedSize(horizontal: false, vertical: true)
                }

                // Feature Highlights Card
                FaithFormCard {
                    VStack(alignment: .leading, spacing: FaithFormTokens.Spacing.base) {
                        welcomeFeatureRow(
                            symbol: "building.2.fill",
                            title: "Your Church Home",
                            detail: "Access weekly sermons, live broadcasts, and church-wide announcements."
                        )
                        Rectangle()
                            .fill(theme.palette.divider)
                            .frame(height: theme.borderWidth)
                        welcomeFeatureRow(
                            symbol: "person.3.fill",
                            title: "Community & Groups",
                            detail: "Build real relationships in small groups and direct messaging."
                        )
                        Rectangle()
                            .fill(theme.palette.divider)
                            .frame(height: theme.borderWidth)
                        welcomeFeatureRow(
                            symbol: "heart.fill",
                            title: "Check-In & Giving",
                            detail: "Touchless Sunday morning check-in and simple, secure generosity."
                        )
                    }
                }

                // Actions
                VStack(spacing: FaithFormTokens.Spacing.md) {
                    Button(action: onFindChurch) {
                        Label(L.findAChurch, systemImage: "magnifyingglass")
                    }
                    .buttonStyle(FaithFormButtonStyle(kind: .primary, theme: theme))

                    Button(action: onHaveInvitation) {
                        Label(L.haveInvitation, systemImage: "envelope.open")
                    }
                    .buttonStyle(FaithFormButtonStyle(kind: .secondary, theme: theme))
                }
            }
            .padding(.horizontal, FaithFormTokens.Layout.screenPaddingHorizontal)
            .padding(.top, FaithFormTokens.Spacing.lg)
            .padding(.bottom, FaithFormTokens.Spacing.xxl)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(theme.palette.background)
    }

    private func welcomeFeatureRow(symbol: String, title: String, detail: String) -> some View {
        HStack(alignment: .top, spacing: 14) {
            ZStack {
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .fill(theme.palette.brandAccent.opacity(0.12))
                    .frame(width: 44, height: 44)
                Image(systemName: symbol)
                    .font(.system(size: 20, weight: .semibold))
                    .foregroundStyle(theme.palette.brandAccent)
            }
            .accessibilityHidden(true)

            VStack(alignment: .leading, spacing: 3) {
                Text(title)
                    .font(theme.font(FaithFormTokens.Text.titleMedium))
                    .foregroundStyle(theme.palette.contentPrimary)
                Text(detail)
                    .font(theme.font(FaithFormTokens.Text.bodySmall))
                    .foregroundStyle(theme.palette.contentSecondary)
                    .lineSpacing(2)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}

/// Why location is being asked for, before the OS is allowed to ask.
///
/// Declining leads somewhere useful rather than to a dead end — the secondary
/// action is a real alternative, not a dismissal.
public struct LocationEducationView: View {
    @Environment(\.faithformTheme) private var theme
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
        VStack(alignment: .leading, spacing: FaithFormTokens.Spacing.lg) {
            Text(L.locationEducationTitle)
                .font(theme.font(FaithFormTokens.Text.displayMedium))
                .foregroundStyle(theme.palette.contentPrimary)
            Text(L.locationEducationBody)
                .font(theme.font(FaithFormTokens.Text.body))
                .foregroundStyle(theme.palette.contentSecondary)
                .fixedSize(horizontal: false, vertical: true)

            Spacer()

            Button(L.locationContinue, action: onContinue)
                .buttonStyle(FaithFormButtonStyle(kind: .primary, theme: theme))
            Button(L.locationSkip, action: onSkip)
                .buttonStyle(FaithFormButtonStyle(kind: .quiet, theme: theme))
        }
        .padding(FaithFormTokens.Layout.screenPaddingHorizontal)
        .background(theme.palette.background)
        .accessibilityElement(children: .contain)
    }
}

/// One church in a result list.
public struct ChurchResultCard: View {
    @Environment(\.faithformTheme) private var theme
    private let church: DiscoveredChurch
    private let onOpen: @MainActor () -> Void

    public init(church: DiscoveredChurch, onOpen: @escaping @MainActor () -> Void) {
        self.church = church
        self.onOpen = onOpen
    }

    public var body: some View {
        Button(action: onOpen) {
            FaithFormCard {
                HStack(alignment: .top, spacing: FaithFormTokens.Spacing.base) {
                    ChurchAvatar(logoUrl: church.logoUrl, name: church.name)

                    VStack(alignment: .leading, spacing: FaithFormTokens.Spacing.xs) {
                        Text(church.name)
                            .font(theme.font(FaithFormTokens.Text.titleMedium))
                            .foregroundStyle(theme.palette.contentPrimary)

                        if let summary = church.publicSummary, !summary.isEmpty {
                            Text(summary)
                                .font(theme.font(FaithFormTokens.Text.bodySmall))
                                .foregroundStyle(theme.palette.contentSecondary)
                                .lineLimit(2)
                        }

                        HStack(spacing: FaithFormTokens.Spacing.sm) {
                            if let place = placeLine {
                                Text(place)
                                    .font(theme.font(FaithFormTokens.Text.caption))
                                    .foregroundStyle(theme.mutedContent)
                            }
                            if let distance = church.distanceKm {
                                StatusChip(String(format: L.distanceAway, String(format: "%.1f", distance)))
                            }
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
    @Environment(\.faithformTheme) private var theme
    @Bindable private var model: DiscoveryModel
    @FocusState private var searchFocused: Bool
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
        VStack(spacing: FaithFormTokens.Spacing.md) {
            searchBar

            content
        }
        .padding(.horizontal, FaithFormTokens.Layout.screenPaddingHorizontal)
        .background(theme.palette.background)
        .navigationTitle(model.query.isEmpty ? L.findAChurch : L.searchResultsTitle)
        .onAppear { searchFocused = false }
        .onDisappear { searchFocused = false }
    }

    private var searchBar: some View {
        HStack(spacing: FaithFormTokens.Spacing.sm) {
            Image(systemName: "magnifyingglass")
                .font(.system(size: 17, weight: .medium))
                .foregroundStyle(theme.palette.brandAccent)
            TextField(L.searchPlaceholder, text: $model.query)
                .focused($searchFocused)
                .font(theme.font(FaithFormTokens.Text.body))
                .submitLabel(.search)
                .onChange(of: model.query) { _, _ in
                    model.queryDidChange()
                }
                .onSubmit { Task { await model.search() } }
                .accessibilityLabel(Text(L.searchPlaceholder))
            if !model.query.isEmpty {
                Button {
                    model.query = ""
                    model.queryDidChange()
                } label: {
                    Image(systemName: "xmark.circle.fill")
                        .font(.system(size: 16))
                        .foregroundStyle(theme.palette.contentSecondary)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Clear search")
            }
        }
        .padding(.horizontal, FaithFormTokens.Spacing.base)
        .frame(minHeight: FaithFormTokens.TouchTarget.recommended)
        .background(
            RoundedRectangle(cornerRadius: FaithFormTokens.Radius.control, style: .continuous)
                .fill(theme.palette.surfaceSunken)
        )
        .overlay(
            RoundedRectangle(cornerRadius: FaithFormTokens.Radius.control, style: .continuous)
                .strokeBorder(theme.palette.border, lineWidth: theme.borderWidth)
        )
    }

    @ViewBuilder
    private var content: some View {
        switch model.phase {
        case .idle:
            ScrollView {
                VStack(spacing: FaithFormTokens.Spacing.lg) {
                    // Nearby Churches Card
                    Button {
                        if let onNearby { onNearby() } else { Task { await model.beginNearbyFlow() } }
                    } label: {
                        HStack(spacing: 16) {
                            ZStack {
                                RoundedRectangle(cornerRadius: 16, style: .continuous)
                                    .fill(theme.palette.brandAccent.opacity(0.14))
                                    .frame(width: 52, height: 52)
                                Image(systemName: "location.fill")
                                    .font(.system(size: 22, weight: .semibold))
                                    .foregroundStyle(theme.palette.brandAccent)
                            }
                            VStack(alignment: .leading, spacing: 4) {
                                Text(L.churchesNearMe)
                                    .font(theme.font(FaithFormTokens.Text.titleMedium))
                                    .foregroundStyle(theme.palette.contentPrimary)
                                Text("Discover congregations active near you")
                                    .font(theme.font(FaithFormTokens.Text.bodySmall))
                                    .foregroundStyle(theme.palette.contentSecondary)
                            }
                            Spacer(minLength: 0)
                            Image(systemName: "chevron.right")
                                .font(.caption.weight(.semibold))
                                .foregroundStyle(theme.palette.contentSecondary)
                        }
                        .padding(16)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(theme.palette.surface, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
                        .overlay(
                            RoundedRectangle(cornerRadius: 20, style: .continuous)
                                .strokeBorder(theme.palette.border, lineWidth: theme.borderWidth)
                        )
                        .shadow(color: theme.usesDecorativeShadow ? theme.palette.brandPrimary.opacity(0.04) : .clear, radius: 10, y: 3)
                    }
                    .buttonStyle(PressScaleStyle())

                    // Search Tips Card
                    FaithFormCard {
                        VStack(alignment: .leading, spacing: 14) {
                            Text("HOW TO FIND YOUR CHURCH")
                                .font(.caption2.weight(.bold))
                                .tracking(2)
                                .foregroundStyle(theme.palette.brandAccent)

                            discoveryTipRow(
                                symbol: "building.columns.fill",
                                title: "Search by Congregation Name",
                                detail: "Type your church, parish, or ministry name (e.g. \"Grace Chapel\")."
                            )
                            Rectangle()
                                .fill(theme.palette.divider)
                                .frame(height: theme.borderWidth)
                            discoveryTipRow(
                                symbol: "mappin.and.ellipse",
                                title: "Search by Location",
                                detail: "Enter your city, neighborhood, or postal code to browse local churches."
                            )
                            Rectangle()
                                .fill(theme.palette.divider)
                                .frame(height: theme.borderWidth)
                            discoveryTipRow(
                                symbol: "link",
                                title: "Have an Invitation Link?",
                                detail: "Tap your church's email or SMS invitation link to join automatically."
                            )
                        }
                    }
                }
                .padding(.top, FaithFormTokens.Spacing.xs)
                .padding(.bottom, FaithFormTokens.Spacing.xl)
            }
        case .searching:
            DiscoveryResultsSkeleton()
        case let .results(churches, _):
            ScrollView {
                LazyVStack(spacing: FaithFormTokens.Spacing.md) {
                    ForEach(churches, id: \.slug) { church in
                        ChurchResultCard(church: church) { onOpenChurch(church.slug) }
                    }
                }
                .padding(.vertical, FaithFormTokens.Spacing.sm)
            }
        case .empty:
            FaithFormCard {
                VStack(spacing: 16) {
                    ZStack {
                        RoundedRectangle(cornerRadius: 20, style: .continuous)
                            .fill(theme.palette.brandAccent.opacity(0.12))
                            .frame(width: 64, height: 64)
                        Image(systemName: "magnifyingglass")
                            .font(.system(size: 28, weight: .medium))
                            .foregroundStyle(theme.palette.brandAccent)
                    }
                    VStack(spacing: 6) {
                        Text(L.noResultsTitle)
                            .font(.system(size: 19, weight: .semibold, design: .rounded))
                            .foregroundStyle(theme.palette.contentPrimary)
                            .multilineTextAlignment(.center)
                        Text(L.noResultsBody)
                            .font(.subheadline)
                            .foregroundStyle(theme.palette.contentSecondary)
                            .multilineTextAlignment(.center)
                            .lineSpacing(3)
                    }
                    if let onNearby {
                        Button {
                            onNearby()
                        } label: {
                            Label(L.churchesNearMe, systemImage: "location.fill")
                        }
                        .buttonStyle(FaithFormButtonStyle(kind: .secondary, theme: theme))
                        .padding(.top, 4)
                    }
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 20)
            }
            .padding(.top, FaithFormTokens.Spacing.base)
        case .offline:
            EmptyStateView(title: L.offlineTitle, explanation: L.offlineBody, symbol: "wifi.slash")
        case let .failed(message):
            EmptyStateView(title: L.errorTitle, explanation: message, symbol: "exclamationmark.triangle")
        }
        Spacer(minLength: 0)
    }

    private func discoveryTipRow(symbol: String, title: String, detail: String) -> some View {
        HStack(alignment: .top, spacing: 14) {
            ZStack {
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .fill(theme.palette.brandAccent.opacity(0.12))
                    .frame(width: 38, height: 38)
                Image(systemName: symbol)
                    .font(.system(size: 17, weight: .semibold))
                    .foregroundStyle(theme.palette.brandAccent)
            }
            .accessibilityHidden(true)

            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(theme.font(FaithFormTokens.Text.titleMedium))
                    .foregroundStyle(theme.palette.contentPrimary)
                Text(detail)
                    .font(theme.font(FaithFormTokens.Text.bodySmall))
                    .foregroundStyle(theme.palette.contentSecondary)
                    .lineSpacing(2)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}
