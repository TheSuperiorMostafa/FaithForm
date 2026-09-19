import SwiftUI
import FaithFormKit

/// Home: the account's church — its feed and schedule — and the door to
/// everything about it.
///
/// ## One church, and where it is changed
///
/// An account has exactly one church. The top-right "Church info" button opens
/// that church's page (`ChurchProfileView` in its current-church mode), which
/// is also where it is changed or removed. Changing it walks the same
/// find-a-church search as first run; adding a church there replaces this one
/// and comes straight back here, showing the new church.
///
/// There is no church tab: six tabs is one more than an iPhone shows, and the
/// sixth would push Account — with sign-out and account deletion — behind
/// "More". A church page is somewhere a person visits from their feed, not a
/// destination of its own.
struct HomeTabView: View {
    enum HomeSection: Hashable {
        case feed
        case schedule
    }

    enum Route: Hashable {
        /// The church info page for one church — from the toolbar, the
        /// account's own church.
        case churchInfo(String)
        /// Search and nearby, then a church's page.
        case search
        case announcement(FeedItem)
    }

    @Environment(\.faithformTheme) private var theme
    let dependencies: AppDependencies
    let root: RootModel
    let isStale: Bool
    let discovery: DiscoveryModel

    @State private var path: [Route] = []
    @State private var section: HomeSection = .feed
    /// Shared by the cards and the detail, so a tapped card zooms into it.
    @Namespace private var announcementTransition

    var body: some View {
        NavigationStack(path: $path) {
            VStack(spacing: 0) {
                if isStale { OfflineBanner(message: L.offlineCached) }
                content
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
            .background(theme.palette.background)
            .environment(\.announcementTransitionNamespace, announcementTransition)
            .navigationTitle(root.selectedChurch?.churchName ?? L.homeTitle)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .principal) {
                    HStack(spacing: FaithFormTokens.Spacing.sm) {
                        if let church = root.selectedChurch {
                            ChurchAvatar(logoUrl: church.logoUrl, name: church.churchName, size: 28)
                            Text(church.churchName)
                                .font(theme.font(FaithFormTokens.Text.titleMedium))
                                .foregroundStyle(theme.palette.contentPrimary)
                                .lineLimit(1)
                        } else {
                            Text(L.homeTitle)
                                .font(theme.font(FaithFormTokens.Text.titleMedium))
                                .foregroundStyle(theme.palette.contentPrimary)
                        }
                    }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    if let church = root.selectedChurch {
                        Button { path.append(.churchInfo(church.churchSlug)) } label: {
                            Label(L.churchInfo, systemImage: "info.circle")
                        }
                        .accessibilityLabel(L.churchInfo)
                    }
                }
            }
            .navigationDestination(for: Route.self) { route in
                switch route {
                case let .churchInfo(slug):
                    ChurchProfileHostView(
                        slug: slug,
                        dependencies: dependencies,
                        root: root,
                        onChurchChanged: { path.removeAll() },
                        onChangeChurch: changeChurch
                    )
                case .search:
                    DiscoverySearchView(
                        dependencies: dependencies,
                        root: root,
                        discovery: discovery,
                        // A new church replaces this one; Home shows it at once.
                        onChurchChanged: { path.removeAll() }
                    )
                case let .announcement(item):
                    AnnouncementDetailView(item: item)
                        .modifier(AnnouncementZoomDestination(id: item.id, namespace: announcementTransition))
                }
            }
        }
    }

    /// "Change church" on the church info page opens search. Offered only when
    /// discovery is, like every other door in the app: a switched-off
    /// capability is not a button that fails.
    private var changeChurch: (@MainActor () -> Void)? {
        guard root.isAllowed(.churchDiscovery) else { return nil }
        return { @MainActor in path.append(.search) }
    }

    @ViewBuilder
    private var content: some View {
        if let church = root.selectedChurch, let features = root.features {
            VStack(spacing: 0) {
                if let live = features.media.phase.live, live.state == "live" {
                    // Straight into the picture, full screen and playing.
                    LiveNowHero(live: live) { root.watchLive(live) }
                        .padding(.horizontal, FaithFormTokens.Layout.screenPaddingHorizontal)
                        .padding(.top, FaithFormTokens.Spacing.sm)
                }

                FaithFormPillSwitcher(
                    selection: $section,
                    options: [
                        .init(.feed, title: L.homeSegmentFeed),
                        .init(.schedule, title: L.homeSegmentSchedule),
                    ],
                    accessibilityLabel: L.homeTitle
                )
                .padding(.horizontal, FaithFormTokens.Layout.screenPaddingHorizontal)
                .padding(.vertical, FaithFormTokens.Spacing.sm)

                switch section {
                case .feed:
                    HomeFeedView(
                        model: features.feed,
                        churchName: church.churchName,
                        churchSlug: church.churchSlug,
                        // One church, no membership states: nothing is ever
                        // "waiting to be accepted" any more.
                        isJoinPending: false,
                        onOpenItem: { path.append(.announcement($0)) },
                        onRefresh: { await features.media.refreshLive() }
                    )
                case .schedule:
                    ScheduleView(
                        model: features.schedule,
                        churchName: church.churchName,
                        churchSlug: church.churchSlug,
                        churchTimezone: features.schedule.churchTimezone,
                        isJoinPending: false,
                        onOpenItem: { path.append(.announcement($0)) },
                        onRefresh: { await features.media.refreshLive() }
                    )
                }
            }
            // A service usually starts with the app already open on Home.
            .refreshesLiveStatus(features.media)
            // Keyed by the container, so a church switch starts this church's
            // load rather than finishing the last one's.
            .task(id: features.key) {
                async let feed: Void = features.feed.load(
                    churchSlug: features.churchSlug,
                    partition: features.partition
                )
                async let schedule: Void = features.schedule.load(
                    churchSlug: features.churchSlug,
                    churchTimezone: "America/New_York",
                    partition: features.partition
                )
                async let media: Void = features.media.refresh()
                _ = await (feed, schedule, media)
            }
        } else {
            ScrollView {
                VStack(spacing: FaithFormTokens.Spacing.lg) {
                    EmptyStateView(title: L.noChurchTitle, explanation: L.noChurchBody, symbol: "building.2")
                    Button(L.findAChurch) { path.append(.search) }
                    .buttonStyle(FaithFormButtonStyle(kind: .primary, theme: theme))
                }
                .padding(FaithFormTokens.Spacing.lg)
            }
            .navigationTitle(L.homeTitle)
        }
    }
}
