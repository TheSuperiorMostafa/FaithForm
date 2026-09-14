import SwiftUI
import FaithFormKit

/// Home: the selected church's feed, and every way to change which church
/// that is.
///
/// ## Why the church switcher lives here
///
/// It used to be its own tab. Six tabs is one more than an iPhone shows — the
/// sixth and fifth collapse into a "More" list, which would have hidden Account,
/// and with it sign-out and account deletion, one level down behind a generic
/// label. Of the six, Church was the one that is not a destination: nobody opens
/// the app to look at a list of their churches, they open it to see what one of
/// them posted. So the switcher became a toolbar button on the feed it
/// switches, and finding another church a button on that list — five tabs, and
/// the church a person is looking at is one tap from the control that changes
/// it.
struct HomeTabView: View {
    enum Route: Hashable {
        /// Your churches, with a way to find another.
        case churches
        /// Search and nearby, then a church's profile.
        case search
        case announcement(FeedItem)
    }

    @Environment(\.faithformTheme) private var theme
    let dependencies: AppDependencies
    let root: RootModel
    let bootstrap: Bootstrap
    let isStale: Bool
    let discovery: DiscoveryModel

    @State private var path: [Route] = []

    var body: some View {
        NavigationStack(path: $path) {
            VStack(spacing: 0) {
                if isStale { OfflineBanner(message: L.offlineCached) }
                content
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
            .background(theme.palette.background)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button { path.append(.churches) } label: {
                        Label(L.switchChurch, systemImage: "building.2")
                    }
                }
            }
            .navigationDestination(for: Route.self) { route in
                switch route {
                case .churches:
                    ChurchesScreen(
                        root: root,
                        bootstrap: bootstrap,
                        onSelected: { path.removeAll() },
                        onFindAnother: { path.append(.search) }
                    )
                case .search:
                    DiscoverySearchView(dependencies: dependencies, root: root, discovery: discovery)
                case let .announcement(item):
                    AnnouncementDetailView(item: item)
                }
            }
        }
    }

    @ViewBuilder
    private var content: some View {
        if let church = root.selectedChurch, let features = root.features {
            HomeFeedView(
                model: features.feed,
                churchName: church.churchName,
                churchSlug: church.churchSlug,
                isJoinPending: church.state == .pending,
                onOpenItem: { path.append(.announcement($0)) },
                // Notes otherwise hide behind Watch's segmented control.
                onOpenSermonNotes: sermonNotesAction(churchSlug: church.churchSlug)
            )
            // Keyed by the container, so a church switch starts this church's
            // load rather than finishing the last one's.
            .task(id: features.key) {
                await features.feed.load(churchSlug: features.churchSlug, partition: features.partition)
            }
        } else {
            ScrollView {
                VStack(spacing: FaithFormTokens.Spacing.lg) {
                    EmptyStateView(title: L.noChurchTitle, explanation: L.noChurchBody, symbol: "building.2")
                    Button(L.findAChurch) {
                        // With churches that cannot be read right now, the list
                        // says why for each; with none at all, straight to search.
                        path.append(bootstrap.relationships.isEmpty ? .search : .churches)
                    }
                    .buttonStyle(FaithFormButtonStyle(kind: .primary, theme: theme))
                }
                .padding(FaithFormTokens.Spacing.lg)
            }
            .navigationTitle(L.homeTitle)
        }
    }

    /// Home's door to sermon notes: nil (no card) unless the registry allows
    /// them for this church, and then the same link a `…/sermons` URL follows.
    private func sermonNotesAction(churchSlug: String) -> (@MainActor () -> Void)? {
        guard root.isAllowed(.sermonArchive(churchSlug: churchSlug)),
              let link = WatchTabView.sermonsLink(churchSlug: churchSlug)
        else { return nil }
        let root = root
        return { root.open(link) }
    }
}

// MARK: - Your churches

/// Every church this account has a relationship with, and the way to add one.
///
/// Multi-church by design: an account is never bound to one congregation.
struct ChurchesScreen: View {
    @Environment(\.faithformTheme) private var theme
    let root: RootModel
    let bootstrap: Bootstrap
    let onSelected: @MainActor () -> Void
    let onFindAnother: @MainActor () -> Void

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: FaithFormTokens.Spacing.lg) {
                ChurchSwitcherView(
                    relationships: bootstrap.relationships,
                    selectedSlug: root.selectedChurch?.churchSlug,
                    onSelect: {
                        root.selectChurch($0)
                        onSelected()
                    }
                )
                // Offered only when discovery is, like every other door in the
                // app: a switched-off capability is not a button that fails.
                if root.isAllowed(.churchDiscovery) {
                    Button(L.addAnotherChurch, action: onFindAnother)
                        .buttonStyle(FaithFormButtonStyle(kind: .secondary, theme: theme))
                }
            }
            .padding(FaithFormTokens.Spacing.lg)
        }
        .background(theme.palette.background)
        .navigationTitle(L.yourChurches)
        .navigationBarTitleDisplayMode(.inline)
    }
}

// MARK: - One announcement

/// An announcement or event, in full.
///
/// The card in the feed clips the body to three lines; this is where the rest
/// is. Same rules as the card: the poster is given room and never has text laid
/// over it, and times are in the church's zone, not the phone's.
struct AnnouncementDetailView: View {
    @Environment(\.faithformTheme) private var theme
    let item: FeedItem

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: FaithFormTokens.Spacing.lg) {
                if let poster = item.posterUrl, let url = URL(string: poster) {
                    AsyncImage(url: url) { phase in
                        switch phase {
                        case let .success(image):
                            image.resizable().aspectRatio(contentMode: .fit)
                        case .failure:
                            EmptyView()
                        default:
                            Rectangle()
                                .fill(theme.palette.skeletonBase)
                                .aspectRatio(16.0 / 9.0, contentMode: .fit)
                        }
                    }
                    .frame(maxWidth: .infinity)
                    .clipShape(RoundedRectangle(cornerRadius: FaithFormTokens.Radius.lg, style: .continuous))
                    .accessibilityLabel(Text(item.posterAltText ?? ""))
                    .accessibilityHidden(item.posterAltText == nil)
                }

                VStack(alignment: .leading, spacing: FaithFormTokens.Spacing.sm) {
                    if item.isPinned { StatusChip(L.pinnedLabel, tone: .live) }
                    Text(item.title)
                        .font(theme.font(FaithFormTokens.Text.displayMedium))
                        .foregroundStyle(theme.palette.contentPrimary)
                        .fixedSize(horizontal: false, vertical: true)
                    Text(FeedFormatting.whenLine(item))
                        .font(theme.font(FaithFormTokens.Text.label))
                        .foregroundStyle(theme.palette.brandAccent)
                    if let location = item.location, !location.isEmpty {
                        Text(location)
                            .font(theme.font(FaithFormTokens.Text.caption))
                            .foregroundStyle(theme.mutedContent)
                    }
                }

                if !item.body.isEmpty {
                    Text(item.body)
                        .font(theme.font(FaithFormTokens.Text.body))
                        .foregroundStyle(theme.palette.contentPrimary)
                        .fixedSize(horizontal: false, vertical: true)
                        .textSelection(.enabled)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, FaithFormTokens.Layout.screenPaddingHorizontal)
            .padding(.vertical, FaithFormTokens.Spacing.lg)
        }
        .background(theme.palette.background)
        .navigationTitle(item.churchName)
        .navigationBarTitleDisplayMode(.inline)
    }
}
