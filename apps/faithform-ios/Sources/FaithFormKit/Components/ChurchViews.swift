import SwiftUI

/// Measurements the church info page shares between its pieces.
///
/// Not tokens: these are this page's own shape — the immersive hero and the
/// glass bar that overlaps it — and nothing else in the app draws them.
private enum ChurchInfoMetrics {
    static let cardRadius: CGFloat = 20
    static let glassRadius: CGFloat = 22
    static let tileRadius: CGFloat = 16
    /// How far the quick-action bar rides up over the bottom of the cover.
    static let actionOverlap: CGFloat = 28
    /// Room above the church's name for the status and navigation bars the
    /// cover runs under.
    static let heroTopClearance: CGFloat = 116
    static let heroMinHeight: CGFloat = 340
    /// Once the hero's bottom edge passes this line it is under the bars, and
    /// the bar gets its background and the church's name back.
    static let collapseLine: CGFloat = 110
    static let avatarSize: CGFloat = 76
    static let avatarRing: CGFloat = 3
    static let socialSize: CGFloat = 56
    static let iconTile: CGFloat = 36
    static let dayBadge: CGFloat = 44
    static let aboutLineLimit = 5
    /// The church's name over its cover: the display face, bold.
    static let heroTitle = FaithFormTokens.TextRole(
        size: 34, lineHeight: 40, weight: .bold, tracking: -0.40, isDisplay: true
    )
}

/// The church info page.
///
/// One view, two doors. From search it is someone deciding on a church — the
/// action is **Add church**, **Make this my church** (replacing the one they
/// have, after saying so), or an invitation. From Home's "Church info" it is
/// the person's own church — no primary action, and a way to change or
/// remove it at the bottom. Which one is decided by
/// `ChurchProfileModel.action(for:hasOtherChurch:)`, never here.
///
/// Everything shown comes from the approved public projection and is managed
/// from the church's dashboard. A section with nothing to say is not drawn.
public struct ChurchProfileView: View {
    @Environment(\.faithformTheme) private var theme
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.openURL) private var openURL

    private let model: ChurchProfileModel
    private let slug: String
    private let hasOtherChurch: Bool
    private let currentChurchName: String?
    private let onChurchAdded: @MainActor () async -> Void
    private let onChurchRemoved: @MainActor () async -> Void
    private let onChangeChurch: (@MainActor () -> Void)?
    private let onAcceptInvitation: @MainActor () -> Void

    @State private var heroCollapsed = false
    @State private var revealed = false
    @State private var confirmingReplace = false
    @State private var confirmingRemoval = false
    /// The server agreed and the host is reloading: the buttons stay
    /// disabled until it has moved on.
    @State private var finishing = false
    @State private var churchesAdded = 0

    /// - Parameters:
    ///   - hasOtherChurch: the account's church exists and is a different one.
    ///     Adding this church then replaces it, after a confirmation.
    ///   - currentChurchName: the account's church, named in that confirmation.
    ///   - onChurchAdded: after the server made this the account's church.
    ///   - onChurchRemoved: after the server removed it.
    ///   - onChangeChurch: opens finding a church. Nil leaves it out.
    ///   - onAcceptInvitation: opens invitation entry, for invite-only churches.
    public init(
        model: ChurchProfileModel,
        slug: String,
        hasOtherChurch: Bool = false,
        currentChurchName: String? = nil,
        onChurchAdded: @escaping @MainActor () async -> Void = {},
        onChurchRemoved: @escaping @MainActor () async -> Void = {},
        onChangeChurch: (@MainActor () -> Void)? = nil,
        onAcceptInvitation: @escaping @MainActor () -> Void
    ) {
        self.model = model
        self.slug = slug
        self.hasOtherChurch = hasOtherChurch
        self.currentChurchName = currentChurchName
        self.onChurchAdded = onChurchAdded
        self.onChurchRemoved = onChurchRemoved
        self.onChangeChurch = onChangeChurch
        self.onAcceptInvitation = onAcceptInvitation
    }

    public var body: some View {
        Group {
            switch model.phase {
            case .loading:
                ScrollView {
                    ChurchProfileSkeleton()
                }
                .scrollDisabled(true)
                .ignoresSafeArea(edges: .top)

            case let .loaded(profile):
                loaded(profile)

            case .notFound:
                // A hidden church and an unknown slug read identically here, on
                // purpose: the screen must not reveal which it was.
                plain {
                    EmptyStateView(title: L.noResultsTitle, explanation: L.noResultsBody, symbol: "magnifyingglass")
                }

            case .offline:
                plain {
                    EmptyStateView(title: L.offlineTitle, explanation: L.offlineBody, symbol: "wifi.slash")
                }

            case let .failed(message):
                plain {
                    VStack(spacing: FaithFormTokens.Spacing.base) {
                        EmptyStateView(title: L.errorTitle, explanation: message, symbol: "exclamationmark.triangle")
                        Button(L.tryAgain) { Task { await model.refresh(slug: slug) } }
                            .buttonStyle(FaithFormButtonStyle(kind: .secondary, theme: theme))
                    }
                }
            }
        }
        .background(theme.palette.background)
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        // Clear over the cover, the usual bar once the cover has scrolled away.
        .toolbarBackground(showsBarBackground ? .visible : .hidden, for: .navigationBar)
        // Light status bar and title over the dark top of the cover, and the
        // page's own again once the bar is back. Named explicitly: nil does
        // not hand the status bar back.
        .toolbarColorScheme(isOverCover ? .dark : colorScheme, for: .navigationBar)
        #endif
    }

    private var isImmersive: Bool {
        switch model.phase {
        case .loading, .loaded: return true
        default: return false
        }
    }

    private var showsBarBackground: Bool { !isImmersive || heroCollapsed }

    /// The bars are over the church's cover, which is dark at the top. The
    /// loading placeholder is not, so it keeps the page's own scheme.
    private var isOverCover: Bool {
        guard case .loaded = model.phase else { return false }
        return !heroCollapsed
    }

    private func plain<Content: View>(@ViewBuilder _ content: () -> Content) -> some View {
        ScrollView {
            content()
                .padding(.horizontal, FaithFormTokens.Layout.screenPaddingHorizontal)
                .padding(.vertical, FaithFormTokens.Spacing.base)
                .frame(maxWidth: FaithFormTokens.Layout.contentMaxWidth)
                .frame(maxWidth: .infinity)
        }
        .refreshable { await model.refresh(slug: slug) }
    }

    // MARK: - Loaded

    private func loaded(_ profile: ChurchProfile) -> some View {
        let action = ChurchProfileModel.action(for: profile, hasOtherChurch: hasOtherChurch)
        let quickActions = ChurchInfo.quickActions(profile)

        return ScrollView {
            VStack(spacing: 0) {
                hero(profile, action: action, overlapsActions: !quickActions.isEmpty)
                    .onGeometryChange(for: Bool.self) { proxy in
                        proxy.frame(in: .scrollView).maxY < ChurchInfoMetrics.collapseLine
                    } action: { collapsed in
                        withAnimation(theme.animation(FaithFormTokens.Motion.standard)) {
                            heroCollapsed = collapsed
                        }
                    }

                sections(profile, action: action, quickActions: quickActions)
            }
        }
        .ignoresSafeArea(edges: .top)
        .refreshable { await model.refresh(slug: slug) }
        .safeAreaInset(edge: .bottom, spacing: 0) {
            if action == .add || action == .replace || action == .invitationRequired {
                actionBar(action)
            }
        }
        .navigationTitle(profile.name)
        .toolbar {
            ToolbarItem(placement: .principal) {
                // The name fades in once the hero that carried it has gone.
                Text(profile.name)
                    .font(theme.font(FaithFormTokens.Text.titleMedium))
                    .foregroundStyle(theme.palette.contentPrimary)
                    .lineLimit(1)
                    .opacity(heroCollapsed ? 1 : 0)
                    .accessibilityHidden(!heroCollapsed)
            }
        }
        .alert(String(format: L.switchConfirmTitle, profile.name), isPresented: $confirmingReplace) {
            Button(L.switchConfirmAction) { Task { await add() } }
            Button(L.cancel, role: .cancel) {}
        } message: {
            Text(String(format: L.switchConfirmBody, currentChurchName ?? L.yourChurch))
        }
        .alert(String(format: L.removeChurchConfirmTitle, profile.name), isPresented: $confirmingRemoval) {
            Button(L.removeChurchConfirmAction, role: .destructive) { Task { await remove() } }
            Button(L.cancel, role: .cancel) {}
        } message: {
            Text(L.removeChurchConfirmBody)
        }
        .sensoryFeedback(.success, trigger: churchesAdded)
        .sensoryFeedback(.warning, trigger: confirmingRemoval) { _, isAsking in isAsking }
        .onAppear {
            guard !revealed else { return }
            revealed = true
        }
    }

    // MARK: Hero

    private func hero(_ profile: ChurchProfile, action: ChurchAction, overlapsActions: Bool) -> some View {
        ChurchHero(coverImageUrl: profile.coverImageUrl, minHeight: ChurchInfoMetrics.heroMinHeight) {
            ChurchHeroIdentity(profile: profile, isCurrent: action == .current)
                .padding(.horizontal, FaithFormTokens.Layout.screenPaddingHorizontal)
                .padding(.top, ChurchInfoMetrics.heroTopClearance)
                .padding(
                    .bottom,
                    overlapsActions
                        ? ChurchInfoMetrics.actionOverlap + FaithFormTokens.Spacing.lg
                        : FaithFormTokens.Spacing.xl
                )
                .frame(maxWidth: FaithFormTokens.Layout.contentMaxWidth, alignment: .leading)
                .frame(maxWidth: .infinity)
        }
    }

    // MARK: Sections

    private func sections(
        _ profile: ChurchProfile,
        action: ChurchAction,
        quickActions: [ChurchInfo.QuickAction]
    ) -> some View {
        let groups = ChurchInfo.serviceGroups(profile)
        let next = ChurchInfo.nextService(
            profile.serviceTimes,
            timeZone: TimeZone(identifier: profile.timezone) ?? .current,
            now: Date()
        )
        let about = ChurchInfo.aboutText(profile)
        let social = ChurchInfo.socialItems(profile)
        let links = ChurchInfo.quickLinkItems(profile)
        let contact = ChurchInfo.contactRows(profile)

        return VStack(alignment: .leading, spacing: FaithFormTokens.Spacing.lg) {
            if !quickActions.isEmpty {
                ChurchQuickActionBar(actions: quickActions) { openURL($0) }
                    .padding(.top, -ChurchInfoMetrics.actionOverlap)
                    .reveal(0, revealed)
            }

            if action == .unavailable {
                ChurchInfoCard {
                    HStack(alignment: .top, spacing: FaithFormTokens.Spacing.md) {
                        Image(systemName: "hand.raised.fill")
                            .foregroundStyle(theme.mutedContent)
                            .accessibilityHidden(true)
                        Text(L.blockedBody)
                            .font(theme.font(FaithFormTokens.Text.bodySmall))
                            .foregroundStyle(theme.palette.contentSecondary)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
                .accessibilityElement(children: .combine)
                .reveal(1, revealed)
            }

            if let next {
                ChurchNextServiceCard(next: next, campusName: campusName(for: next.service, in: profile))
                    .reveal(2, revealed)
            }

            if !groups.isEmpty {
                section(L.serviceTimesTitle) { ChurchServiceTimesCard(groups: groups) }
                    .reveal(3, revealed)
            }

            if let about {
                section(L.aboutTitle) {
                    ChurchInfoCard { ChurchAboutText(text: about) }
                }
                .reveal(4, revealed)
            }

            if !social.isEmpty {
                section(L.connectTitle) { ChurchSocialRow(items: social) { openURL($0) } }
                    .reveal(5, revealed)
            }

            if !links.isEmpty {
                section(L.linksTitle) {
                    ChurchInfoCard(padding: 0) {
                        ChurchRowList(links) { link in
                            ChurchLinkRow(
                                symbol: "link",
                                title: link.label,
                                detail: link.host,
                                trailingSymbol: "arrow.up.right"
                            ) { openURL(link.url) }
                        }
                    }
                }
                .reveal(6, revealed)
            }

            if !profile.campuses.isEmpty {
                section(L.locationsTitle) {
                    VStack(spacing: FaithFormTokens.Spacing.md) {
                        ForEach(profile.campuses, id: \.slug) { campus in
                            ChurchCampusCard(campus: campus) { openURL($0) }
                        }
                    }
                }
                .reveal(7, revealed)
            }

            if !contact.isEmpty {
                section(L.contactTitle) {
                    ChurchInfoCard(padding: 0) {
                        ChurchRowList(contact) { row in
                            ChurchLinkRow(
                                symbol: row.symbol,
                                title: row.value,
                                caption: row.label,
                                trailingSymbol: "chevron.right"
                            ) { openURL(row.url) }
                        }
                    }
                }
                .reveal(8, revealed)
            }

            if action == .current {
                footer
                    .reveal(9, revealed)
            }
        }
        .padding(.horizontal, FaithFormTokens.Layout.screenPaddingHorizontal)
        .padding(.top, quickActions.isEmpty ? FaithFormTokens.Spacing.lg : 0)
        .padding(.bottom, FaithFormTokens.Spacing.xl)
        .frame(maxWidth: FaithFormTokens.Layout.contentMaxWidth)
        .frame(maxWidth: .infinity)
    }

    private func section<Content: View>(
        _ title: String,
        @ViewBuilder content: () -> Content
    ) -> some View {
        VStack(alignment: .leading, spacing: FaithFormTokens.Spacing.sm) {
            Text(title)
                .font(theme.font(FaithFormTokens.Text.label))
                .foregroundStyle(theme.mutedContent)
                .padding(.leading, FaithFormTokens.Spacing.xs)
                .accessibilityAddTraits(.isHeader)
            content()
        }
    }

    /// Named only when there is more than one campus to tell apart.
    private func campusName(for service: PublicServiceTime, in profile: ChurchProfile) -> String? {
        guard profile.campuses.count > 1 else { return nil }
        return profile.campuses.first(where: { $0.slug == service.campusSlug })?.name
    }

    // MARK: Actions

    /// The primary action, pinned to the bottom so it is always in reach while
    /// someone reads about a church they might choose.
    private func actionBar(_ action: ChurchAction) -> some View {
        VStack(spacing: FaithFormTokens.Spacing.sm) {
            if action == .invitationRequired {
                Text(L.inviteOnlyExplainer)
                    .font(theme.font(FaithFormTokens.Text.bodySmall))
                    .foregroundStyle(theme.palette.contentSecondary)
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
                Button(L.haveInvitationLink, action: onAcceptInvitation)
                    .buttonStyle(FaithFormButtonStyle(kind: .secondary, theme: theme))
            } else {
                Button {
                    if action == .replace {
                        confirmingReplace = true
                    } else {
                        Task { await add() }
                    }
                } label: {
                    FaithFormWorkingLabel(
                        action == .replace ? L.makeMyChurch : L.addChurch,
                        working: model.isActing || finishing
                    )
                }
                .buttonStyle(FaithFormButtonStyle(kind: .primary, theme: theme))
                .disabled(model.isActing || finishing)
            }

            actionError
        }
        .padding(.horizontal, FaithFormTokens.Layout.screenPaddingHorizontal)
        .padding(.top, FaithFormTokens.Spacing.md)
        .padding(.bottom, FaithFormTokens.Spacing.sm)
        .frame(maxWidth: FaithFormTokens.Layout.contentMaxWidth)
        .frame(maxWidth: .infinity)
        .background(.bar)
        .overlay(alignment: .top) {
            Rectangle()
                .fill(theme.palette.divider)
                .frame(height: FaithFormTokens.BorderWidth.hairline)
        }
    }

    /// Your own church: change it, or remove it.
    private var footer: some View {
        VStack(spacing: FaithFormTokens.Spacing.sm) {
            if let onChangeChurch {
                Button(L.changeChurch, action: onChangeChurch)
                    .buttonStyle(FaithFormButtonStyle(kind: .secondary, theme: theme))
                    .disabled(model.isActing || finishing)
            }
            Button(role: .destructive) {
                confirmingRemoval = true
            } label: {
                FaithFormWorkingLabel(L.removeChurch, working: model.isActing || finishing)
                    .font(theme.font(FaithFormTokens.Text.titleMedium))
                    .foregroundStyle(theme.palette.destructive)
                    .frame(maxWidth: .infinity, minHeight: FaithFormTokens.TouchTarget.recommended)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .disabled(model.isActing || finishing)

            actionError
        }
        .padding(.top, FaithFormTokens.Spacing.sm)
    }

    @ViewBuilder
    private var actionError: some View {
        if let error = model.actionError {
            Text(error)
                .font(theme.font(FaithFormTokens.Text.caption))
                .foregroundStyle(theme.palette.destructive)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private func add() async {
        guard await model.add(slug: slug) else { return }
        finishing = true
        churchesAdded += 1
        await onChurchAdded()
        finishing = false
    }

    private func remove() async {
        guard await model.remove(slug: slug) else { return }
        finishing = true
        await onChurchRemoved()
        finishing = false
    }
}

// MARK: - Hero identity

/// The church's name, tagline and place, in white over the bottom of its
/// cover, beside its logo.
private struct ChurchHeroIdentity: View {
    @Environment(\.faithformTheme) private var theme
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    let profile: ChurchProfile
    let isCurrent: Bool

    var body: some View {
        let stacked = dynamicTypeSize.isAccessibilitySize
        let identity = stacked
            ? AnyLayout(VStackLayout(alignment: .leading, spacing: FaithFormTokens.Spacing.md))
            : AnyLayout(HStackLayout(alignment: .center, spacing: FaithFormTokens.Spacing.base))
        let details = stacked
            ? AnyLayout(VStackLayout(alignment: .leading, spacing: FaithFormTokens.Spacing.sm))
            : AnyLayout(HStackLayout(alignment: .center, spacing: FaithFormTokens.Spacing.md))
        let place = ChurchInfo.placeLine(profile)

        VStack(alignment: .leading, spacing: FaithFormTokens.Spacing.md) {
            identity {
                ChurchAvatar(
                    logoUrl: profile.logoUrl,
                    name: profile.name,
                    size: ChurchInfoMetrics.avatarSize,
                    style: .ringed(ring: ChurchInfoMetrics.avatarRing)
                )

                VStack(alignment: .leading, spacing: FaithFormTokens.Spacing.xs) {
                    Text(profile.name)
                        .font(theme.font(ChurchInfoMetrics.heroTitle))
                        .foregroundStyle(.white)
                        .fixedSize(horizontal: false, vertical: true)
                    if let tagline = ChurchInfo.nonBlank(profile.tagline) {
                        Text(tagline)
                            .font(theme.font(FaithFormTokens.Text.titleMedium))
                            .foregroundStyle(.white.opacity(0.92))
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
                .shadow(color: .black.opacity(0.35), radius: 6, y: 1)
            }

            if isCurrent || place != nil {
                details {
                    if isCurrent { YourChurchChip() }
                    if let place {
                        Label(place, systemImage: "mappin.and.ellipse")
                            .font(theme.font(FaithFormTokens.Text.bodySmall))
                            .foregroundStyle(.white.opacity(0.88))
                            .shadow(color: .black.opacity(0.35), radius: 6, y: 1)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isHeader)
    }
}

/// "✓ Your church", on glass over the cover.
private struct YourChurchChip: View {
    @Environment(\.faithformTheme) private var theme

    var body: some View {
        Label(L.yourChurch, systemImage: "checkmark.circle.fill")
            .font(theme.font(FaithFormTokens.Text.label))
            .foregroundStyle(.white)
            .padding(.horizontal, FaithFormTokens.Spacing.md)
            .padding(.vertical, 6)
            .background(.ultraThinMaterial, in: Capsule())
            .overlay(Capsule().strokeBorder(Color.white.opacity(0.28), lineWidth: 1))
            .environment(\.colorScheme, .dark)
    }
}

// MARK: - Quick actions

/// Directions, Call, Email and Website on a glass bar that overlaps the
/// cover. Tiles share the width equally; at accessibility text sizes they
/// become a list, so no label is ever squeezed.
private struct ChurchQuickActionBar: View {
    @Environment(\.faithformTheme) private var theme
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    let actions: [ChurchInfo.QuickAction]
    let onOpen: (URL) -> Void

    var body: some View {
        let stacked = dynamicTypeSize.isAccessibilitySize
        let layout = stacked
            ? AnyLayout(VStackLayout(alignment: .leading, spacing: 0))
            : AnyLayout(HStackLayout(alignment: .top, spacing: FaithFormTokens.Spacing.xs))

        layout {
            ForEach(actions) { action in
                Button {
                    onOpen(action.url)
                } label: {
                    tile(action.kind, stacked: stacked)
                }
                .buttonStyle(ChurchTileButtonStyle(reduceMotion: theme.reduceMotion))
                .accessibilityLabel(action.kind.title)
                .accessibilityAddTraits(.isLink)
            }
        }
        .padding(FaithFormTokens.Spacing.sm)
        .background { glass }
    }

    @ViewBuilder
    private func tile(_ kind: ChurchInfo.QuickActionKind, stacked: Bool) -> some View {
        if stacked {
            HStack(spacing: FaithFormTokens.Spacing.md) {
                icon(kind)
                Text(kind.title)
                    .font(theme.font(FaithFormTokens.Text.titleMedium))
                    .foregroundStyle(theme.palette.contentPrimary)
                Spacer(minLength: 0)
            }
            .padding(.horizontal, FaithFormTokens.Spacing.sm)
            .padding(.vertical, FaithFormTokens.Spacing.xs)
            .frame(maxWidth: .infinity, minHeight: FaithFormTokens.TouchTarget.minimum, alignment: .leading)
        } else {
            VStack(spacing: 6) {
                icon(kind)
                Text(kind.title)
                    .font(theme.font(FaithFormTokens.Text.label))
                    .foregroundStyle(theme.palette.contentPrimary)
                    .lineLimit(1)
                    .minimumScaleFactor(0.75)
            }
            .padding(.vertical, FaithFormTokens.Spacing.sm)
            .frame(maxWidth: .infinity, minHeight: 72)
        }
    }

    private func icon(_ kind: ChurchInfo.QuickActionKind) -> some View {
        Image(systemName: kind.symbol)
            .font(.system(size: 17, weight: .semibold))
            .foregroundStyle(theme.palette.brandPrimary)
            .frame(width: 40, height: 40)
            .background(Circle().fill(theme.palette.brandPrimary.opacity(0.12)))
            .accessibilityHidden(true)
    }

    private var glass: some View {
        let shape = RoundedRectangle(cornerRadius: ChurchInfoMetrics.glassRadius, style: .continuous)
        let dark = colorScheme == .dark
        return shape
            .fill(.ultraThinMaterial)
            // A wash of the surface under the glass keeps labels readable where
            // the bar sits over the darkest part of a photograph.
            .overlay(shape.fill(theme.palette.surface.opacity(dark ? 0.4 : 0.6)))
            .overlay(shape.strokeBorder(Color.white.opacity(dark ? 0.12 : 0.7), lineWidth: 1))
            .shadow(
                color: dark || !theme.usesDecorativeShadow ? .clear : Color.black.opacity(0.12),
                radius: 18,
                y: 8
            )
    }
}

/// A tile that dips slightly under the finger.
private struct ChurchTileButtonStyle: ButtonStyle {
    @Environment(\.faithformTheme) private var theme
    let reduceMotion: Bool

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .background(
                RoundedRectangle(cornerRadius: ChurchInfoMetrics.tileRadius, style: .continuous)
                    .fill(theme.palette.brandPrimary.opacity(configuration.isPressed ? 0.08 : 0))
            )
            .contentShape(RoundedRectangle(cornerRadius: ChurchInfoMetrics.tileRadius, style: .continuous))
            .scaleEffect(configuration.isPressed && !reduceMotion ? 0.93 : 1)
            .animation(
                reduceMotion
                    ? .easeOut(duration: FaithFormTokens.Motion.reducedMotionDuration)
                    : .spring(response: 0.28, dampingFraction: 0.7),
                value: configuration.isPressed
            )
    }
}

// MARK: - Next service

/// The one thing most people open a church's page for: when is the next
/// service. Brand-coloured, so it reads as the page's highlight.
private struct ChurchNextServiceCard: View {
    @Environment(\.faithformTheme) private var theme
    @Environment(\.colorScheme) private var colorScheme
    let next: ChurchInfo.NextService
    let campusName: String?

    var body: some View {
        let onAccent = theme.palette.contentOnAccent
        let shape = RoundedRectangle(cornerRadius: ChurchInfoMetrics.cardRadius, style: .continuous)
        let detail = [ChurchInfo.nonBlank(next.service.label), campusName]
            .compactMap { $0 }
            .joined(separator: " · ")

        VStack(alignment: .leading, spacing: FaithFormTokens.Spacing.sm) {
            ViewThatFits(in: .horizontal) {
                HStack(spacing: FaithFormTokens.Spacing.sm) {
                    heading(onAccent)
                    Spacer(minLength: FaithFormTokens.Spacing.sm)
                    relative(onAccent)
                }
                VStack(alignment: .leading, spacing: FaithFormTokens.Spacing.sm) {
                    heading(onAccent)
                    relative(onAccent)
                }
            }

            Text(ChurchInfo.serviceLine(next.service))
                .font(theme.font(FaithFormTokens.Text.displayMedium))
                .foregroundStyle(onAccent)
                .fixedSize(horizontal: false, vertical: true)

            if !detail.isEmpty {
                Text(detail)
                    .font(theme.font(FaithFormTokens.Text.body))
                    .foregroundStyle(onAccent.opacity(0.85))
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(FaithFormTokens.Spacing.lg)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background {
            ZStack(alignment: .topTrailing) {
                LinearGradient(
                    colors: [theme.palette.brandAccent, theme.palette.brandAccentSoft],
                    startPoint: .topLeading,
                    endPoint: .bottomTrailing
                )
                Circle()
                    .fill(Color.white.opacity(0.28))
                    .frame(width: 180, height: 180)
                    .blur(radius: 40)
                    .offset(x: 50, y: -70)
                Image(systemName: "calendar")
                    .font(.system(size: 110, weight: .regular))
                    .foregroundStyle(onAccent.opacity(0.07))
                    .offset(x: 18, y: 26)
                    .accessibilityHidden(true)
            }
        }
        .clipShape(shape)
        .shadow(
            color: colorScheme == .dark || !theme.usesDecorativeShadow
                ? .clear
                : theme.palette.brandAccent.opacity(0.35),
            radius: 16,
            y: 8
        )
        .accessibilityElement(children: .combine)
    }

    private func heading(_ color: Color) -> some View {
        Label(L.nextService, systemImage: "sparkles")
            .font(theme.font(FaithFormTokens.Text.label))
            .foregroundStyle(color.opacity(0.85))
    }

    private func relative(_ color: Color) -> some View {
        Text(ChurchInfo.relativeDay(next.daysUntil))
            .font(theme.font(FaithFormTokens.Text.label))
            .foregroundStyle(color)
            .padding(.horizontal, FaithFormTokens.Spacing.md)
            .padding(.vertical, 5)
            .background(Capsule().fill(color.opacity(0.12)))
    }
}

// MARK: - Service times

private struct ChurchServiceTimesCard: View {
    @Environment(\.faithformTheme) private var theme
    let groups: [ChurchInfo.ServiceGroup]

    var body: some View {
        ChurchInfoCard(padding: 0) {
            VStack(alignment: .leading, spacing: 0) {
                ForEach(Array(groups.enumerated()), id: \.offset) { groupIndex, group in
                    if let title = group.title {
                        Text(title)
                            .font(theme.font(FaithFormTokens.Text.label))
                            .foregroundStyle(theme.palette.brandPrimary)
                            .padding(.horizontal, FaithFormTokens.Spacing.base)
                            .padding(.top, FaithFormTokens.Spacing.base)
                            .padding(.bottom, FaithFormTokens.Spacing.xs)
                            .accessibilityAddTraits(.isHeader)
                    } else if groupIndex > 0 {
                        ChurchRowDivider(leading: ChurchInfoMetrics.dayBadge)
                    }
                    ForEach(Array(group.services.enumerated()), id: \.offset) { index, service in
                        if index > 0 { ChurchRowDivider(leading: ChurchInfoMetrics.dayBadge) }
                        row(service)
                    }
                }
            }
            .padding(.vertical, FaithFormTokens.Spacing.xs)
        }
    }

    private func row(_ service: PublicServiceTime) -> some View {
        HStack(spacing: FaithFormTokens.Spacing.md) {
            Text(Self.shortDay(service.dayOfWeek))
                .font(theme.font(FaithFormTokens.Text.label))
                .foregroundStyle(theme.palette.brandPrimary)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
                .frame(width: ChurchInfoMetrics.dayBadge, height: ChurchInfoMetrics.dayBadge)
                .background(
                    RoundedRectangle(cornerRadius: FaithFormTokens.Radius.md, style: .continuous)
                        .fill(theme.palette.brandAccent.opacity(0.16))
                )
                .accessibilityHidden(true)

            VStack(alignment: .leading, spacing: 2) {
                Text(ChurchInfo.serviceLine(service))
                    .font(theme.font(FaithFormTokens.Text.titleMedium))
                    .foregroundStyle(theme.palette.contentPrimary)
                if let label = ChurchInfo.nonBlank(service.label) {
                    Text(label)
                        .font(theme.font(FaithFormTokens.Text.bodySmall))
                        .foregroundStyle(theme.palette.contentSecondary)
                }
            }
            .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 0)
        }
        .padding(.horizontal, FaithFormTokens.Spacing.base)
        .padding(.vertical, FaithFormTokens.Spacing.sm)
        .frame(minHeight: FaithFormTokens.TouchTarget.minimum)
        .accessibilityElement(children: .combine)
    }

    /// "SUN", from the system's own localized weekday names.
    private static func shortDay(_ dayOfWeek: Int) -> String {
        let symbols = Calendar(identifier: .gregorian).shortWeekdaySymbols
        guard symbols.count == 7 else { return "" }
        return symbols[min(max(dayOfWeek, 0), 6)].uppercased()
    }
}

// MARK: - About

/// Clamped to a few lines, with "Read more" only when there is more.
private struct ChurchAboutText: View {
    @Environment(\.faithformTheme) private var theme
    let text: String

    @State private var expanded = false
    @State private var fullHeight: CGFloat = 0
    @State private var clampedHeight: CGFloat = 0

    var body: some View {
        VStack(alignment: .leading, spacing: FaithFormTokens.Spacing.sm) {
            Text(text)
                .font(theme.font(FaithFormTokens.Text.body))
                .foregroundStyle(theme.palette.contentPrimary)
                .lineLimit(expanded ? nil : ChurchInfoMetrics.aboutLineLimit)
                .fixedSize(horizontal: false, vertical: true)
                .onGeometryChange(for: CGFloat.self) { proxy in
                    proxy.size.height
                } action: { height in
                    if !expanded { clampedHeight = height }
                }
                .background(alignment: .topLeading) {
                    // The whole text, measured and never drawn, to know
                    // whether the clamp hid anything.
                    Text(text)
                        .font(theme.font(FaithFormTokens.Text.body))
                        .fixedSize(horizontal: false, vertical: true)
                        .hidden()
                        .onGeometryChange(for: CGFloat.self) { proxy in
                            proxy.size.height
                        } action: { height in
                            fullHeight = height
                        }
                        .accessibilityHidden(true)
                }

            if expanded || fullHeight > clampedHeight + 1 {
                Button(expanded ? L.showLess : L.readMore) {
                    withAnimation(theme.animation(FaithFormTokens.Motion.standard)) {
                        expanded.toggle()
                    }
                }
                .font(theme.font(FaithFormTokens.Text.titleMedium))
                .foregroundStyle(theme.palette.brandPrimary)
                .frame(minHeight: FaithFormTokens.TouchTarget.minimum)
                .contentShape(Rectangle())
                .buttonStyle(.plain)
            }
        }
    }
}

// MARK: - Connect

/// The church's social profiles: a row of large round buttons in each
/// platform's colour, scrolling sideways past the page margins.
private struct ChurchSocialRow: View {
    @Environment(\.faithformTheme) private var theme
    @Environment(\.colorScheme) private var colorScheme
    let items: [ChurchInfo.SocialItem]
    let onOpen: (URL) -> Void

    var body: some View {
        ScrollView(.horizontal) {
            HStack(alignment: .top, spacing: FaithFormTokens.Spacing.lg) {
                ForEach(items) { item in
                    Button {
                        onOpen(item.url)
                    } label: {
                        button(item)
                    }
                    .buttonStyle(PressableCardStyle(reduceMotion: theme.reduceMotion))
                    .accessibilityElement(children: .ignore)
                    .accessibilityLabel(item.style.title)
                    .accessibilityHint(ChurchInfo.host(of: item.url))
                    .accessibilityAddTraits(.isLink)
                }
            }
            .padding(.vertical, FaithFormTokens.Spacing.sm)
        }
        .scrollIndicators(.hidden)
        .contentMargins(.horizontal, FaithFormTokens.Layout.screenPaddingHorizontal, for: .scrollContent)
        .padding(.horizontal, -FaithFormTokens.Layout.screenPaddingHorizontal)
    }

    private func button(_ item: ChurchInfo.SocialItem) -> some View {
        let color = item.style.colorHex.flatMap { Color(hex: $0) } ?? theme.palette.brandAccent
        let dark = colorScheme == .dark
        return VStack(spacing: FaithFormTokens.Spacing.sm) {
            Image(systemName: item.style.symbol)
                .font(.system(size: 22, weight: .semibold))
                .foregroundStyle(.white)
                .frame(width: ChurchInfoMetrics.socialSize, height: ChurchInfoMetrics.socialSize)
                .background(Circle().fill(color.gradient))
                // Near-black brands would vanish on the dark page without it.
                .overlay(Circle().strokeBorder(Color.white.opacity(dark ? 0.16 : 0), lineWidth: 1))
                .shadow(color: dark ? .clear : color.opacity(0.35), radius: 8, y: 4)
            Text(item.style.title)
                .font(theme.font(FaithFormTokens.Text.label))
                .foregroundStyle(theme.palette.contentSecondary)
                .lineLimit(1)
                .fixedSize()
        }
        .frame(minWidth: ChurchInfoMetrics.socialSize + FaithFormTokens.Spacing.sm)
        .contentShape(Rectangle())
    }
}

// MARK: - Locations

private struct ChurchCampusCard: View {
    @Environment(\.faithformTheme) private var theme
    let campus: PublicCampus
    let onOpen: (URL) -> Void

    var body: some View {
        let directions = ChurchInfo.directionsURL(for: campus)
        let address = ChurchInfo.addressLine(campus)

        Button {
            if let directions { onOpen(directions) }
        } label: {
            ChurchInfoCard {
                HStack(alignment: .center, spacing: FaithFormTokens.Spacing.md) {
                    ChurchIconTile(symbol: "building.columns.fill")

                    VStack(alignment: .leading, spacing: FaithFormTokens.Spacing.xs) {
                        ViewThatFits(in: .horizontal) {
                            HStack(spacing: FaithFormTokens.Spacing.sm) { name; main }
                            VStack(alignment: .leading, spacing: FaithFormTokens.Spacing.xs) { name; main }
                        }
                        if let address {
                            Text(address)
                                .font(theme.font(FaithFormTokens.Text.bodySmall))
                                .foregroundStyle(theme.palette.contentSecondary)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                    }
                    Spacer(minLength: 0)

                    if directions != nil {
                        Image(systemName: "arrow.triangle.turn.up.right.circle.fill")
                            .font(.system(size: 28))
                            .foregroundStyle(theme.palette.brandAccent)
                            .accessibilityHidden(true)
                    }
                }
            }
        }
        .buttonStyle(PressableCardStyle(reduceMotion: theme.reduceMotion))
        .disabled(directions == nil)
        .accessibilityElement(children: .combine)
        .accessibilityHint(directions == nil ? "" : L.announcementDirectionsHint)
    }

    private var name: some View {
        Text(campus.name)
            .font(theme.font(FaithFormTokens.Text.titleMedium))
            .foregroundStyle(theme.palette.contentPrimary)
            .fixedSize(horizontal: false, vertical: true)
    }

    @ViewBuilder
    private var main: some View {
        if campus.isPrimary { StatusChip(L.mainCampus) }
    }
}

// MARK: - Shared pieces

/// The page's card: rounder than the app's default, a soft shadow in light
/// mode and a hairline in dark, where a shadow cannot be seen.
private struct ChurchInfoCard<Content: View>: View {
    @Environment(\.faithformTheme) private var theme
    @Environment(\.colorScheme) private var colorScheme
    private let padding: CGFloat
    private let content: Content

    init(padding: CGFloat = FaithFormTokens.Spacing.base, @ViewBuilder content: () -> Content) {
        self.padding = padding
        self.content = content()
    }

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: ChurchInfoMetrics.cardRadius, style: .continuous)
        let soft = colorScheme == .light && theme.usesDecorativeShadow
        content
            .padding(padding)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(shape.fill(theme.palette.surface))
            .overlay(
                shape.strokeBorder(
                    soft ? Color.clear : theme.palette.border,
                    lineWidth: FaithFormTokens.BorderWidth.hairline
                )
            )
            .shadow(
                color: soft ? theme.palette.brandPrimary.opacity(0.08) : .clear,
                radius: 16,
                y: 6
            )
    }
}

/// Rows in a card, separated by inset dividers.
private struct ChurchRowList<Item: Identifiable, Row: View>: View {
    private let items: [Item]
    private let row: (Item) -> Row

    init(_ items: [Item], @ViewBuilder row: @escaping (Item) -> Row) {
        self.items = items
        self.row = row
    }

    var body: some View {
        VStack(spacing: 0) {
            ForEach(Array(items.enumerated()), id: \.element.id) { index, item in
                if index > 0 { ChurchRowDivider() }
                row(item)
            }
        }
        .padding(.vertical, FaithFormTokens.Spacing.xs)
    }
}

/// A hairline starting where the row's text starts, past its icon.
private struct ChurchRowDivider: View {
    @Environment(\.faithformTheme) private var theme
    var leading: CGFloat = ChurchInfoMetrics.iconTile

    var body: some View {
        Rectangle()
            .fill(theme.palette.divider)
            .frame(height: FaithFormTokens.BorderWidth.hairline)
            .padding(.leading, FaithFormTokens.Spacing.base + leading + FaithFormTokens.Spacing.md)
    }
}

/// A tappable row: icon tile, a title with a caption above or detail below,
/// and a trailing glyph. Read by VoiceOver as one link.
private struct ChurchLinkRow: View {
    @Environment(\.faithformTheme) private var theme
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    let symbol: String
    let title: String
    var caption: String?
    var detail: String?
    let trailingSymbol: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: FaithFormTokens.Spacing.md) {
                ChurchIconTile(symbol: symbol)
                VStack(alignment: .leading, spacing: 2) {
                    if let caption {
                        Text(caption)
                            .font(theme.font(FaithFormTokens.Text.caption))
                            .foregroundStyle(theme.mutedContent)
                    }
                    // Addresses and emails do not break well: one line,
                    // shortened in the middle, unless the reader needs
                    // accessibility sizes — then all of it, wrapped.
                    Text(title)
                        .font(theme.font(FaithFormTokens.Text.titleMedium))
                        .foregroundStyle(theme.palette.contentPrimary)
                        .lineLimit(dynamicTypeSize.isAccessibilitySize ? nil : 1)
                        .truncationMode(.middle)
                        .minimumScaleFactor(0.85)
                    if let detail {
                        Text(detail)
                            .font(theme.font(FaithFormTokens.Text.bodySmall))
                            .foregroundStyle(theme.palette.contentSecondary)
                            .lineLimit(dynamicTypeSize.isAccessibilitySize ? nil : 1)
                            .truncationMode(.middle)
                    }
                }
                Spacer(minLength: FaithFormTokens.Spacing.sm)
                Image(systemName: trailingSymbol)
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(theme.mutedContent)
                    .accessibilityHidden(true)
            }
            .padding(.horizontal, FaithFormTokens.Spacing.base)
            .padding(.vertical, FaithFormTokens.Spacing.sm)
            .frame(minHeight: FaithFormTokens.TouchTarget.recommended)
            .contentShape(Rectangle())
        }
        .buttonStyle(ChurchRowButtonStyle())
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isLink)
    }
}

private struct ChurchRowButtonStyle: ButtonStyle {
    @Environment(\.faithformTheme) private var theme

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .background(theme.palette.surfaceSunken.opacity(configuration.isPressed ? 1 : 0))
    }
}

private struct ChurchIconTile: View {
    @Environment(\.faithformTheme) private var theme
    let symbol: String

    var body: some View {
        Image(systemName: symbol)
            .font(.system(size: 15, weight: .semibold))
            .foregroundStyle(theme.palette.brandPrimary)
            .frame(width: ChurchInfoMetrics.iconTile, height: ChurchInfoMetrics.iconTile)
            .background(
                RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .fill(theme.palette.brandPrimary.opacity(0.1))
            )
            .accessibilityHidden(true)
    }
}

// MARK: - Entrance

private struct Reveal: ViewModifier {
    @Environment(\.faithformTheme) private var theme
    let index: Int
    let revealed: Bool

    func body(content: Content) -> some View {
        // Reduce Motion: no travel and no stagger, only the state change.
        let still = theme.reduceMotion
        content
            .opacity(revealed ? 1 : 0)
            .offset(y: revealed || still ? 0 : 18)
            .animation(
                still
                    ? .easeOut(duration: FaithFormTokens.Motion.reducedMotionDuration)
                    : .spring(response: 0.55, dampingFraction: 0.86).delay(0.05 * Double(index)),
                value: revealed
            )
    }
}

private extension View {
    /// Fades and lifts a section in on first appearance, one after another.
    func reveal(_ index: Int, _ revealed: Bool) -> some View {
        modifier(Reveal(index: index, revealed: revealed))
    }
}
