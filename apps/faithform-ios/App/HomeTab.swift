import SwiftUI
import FaithFormKit

/// Home: the account's church — its feed and schedule — and the door to
/// everything about it.
///
/// ## One church, and where it is changed
///
/// An account has exactly one church. Tapping its name and logo in the header opens
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
        /// Search and nearby, then a church's page.
        case search
        case announcement(FeedItem)
    }

    @Environment(\.faithformTheme) private var theme
    let dependencies: AppDependencies
    let root: RootModel
    let isStale: Bool
    let discovery: DiscoveryModel
    var onOpenAccount: (() -> Void)? = nil

    @State private var path: [Route] = []
    @State private var presentedChurchSlug: String?
    @State private var section: HomeSection = .feed
    /// Shared by the cards and the detail, so a tapped card zooms into it.
    @Namespace private var announcementTransition

    var body: some View {
        NavigationStack(path: $path) {
            VStack(spacing: 0) {
                homeHeader
                if isStale { OfflineBanner(message: L.offlineCached) }
                content
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
            .background(theme.palette.background)
            .environment(\.announcementTransitionNamespace, announcementTransition)
            .navigationTitle(root.selectedChurch?.churchName ?? L.homeTitle)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar(.hidden, for: .navigationBar)
            .navigationDestination(for: Route.self) { route in
                Group {
                    switch route {
                    case .search:
                        DiscoverySearchView(
                            dependencies: dependencies,
                            root: root,
                            discovery: discovery,
                            // A new church replaces this one; Home shows it at once.
                            onChurchChanged: {
                                withAnimation(theme.animation(FaithFormTokens.Motion.standard)) {
                                    path.removeAll()
                                }
                            }
                        )
                    case let .announcement(item):
                        AnnouncementDetailView(item: item)
                            .modifier(AnnouncementZoomDestination(id: item.id, namespace: announcementTransition))
                    }
                }
                .toolbar(.visible, for: .navigationBar)
            }
            .sheet(isPresented: Binding(
                get: { presentedChurchSlug != nil },
                set: { if !$0 { presentedChurchSlug = nil } }
            )) {
                if let slug = presentedChurchSlug {
                    NavigationStack {
                        ChurchProfileHostView(
                            slug: slug,
                            dependencies: dependencies,
                            root: root,
                            onChurchChanged: { presentedChurchSlug = nil },
                            onChangeChurch: changeChurch
                        )
                        .toolbar(.hidden, for: .navigationBar)
                    }
                    .presentationDragIndicator(.visible)
                }
            }

        }
    }

    private var homeHeader: some View {
        HStack(spacing: FaithFormTokens.Spacing.sm) {
            if let church = root.selectedChurch {
                Button { presentedChurchSlug = church.churchSlug } label: {
                    HStack(spacing: FaithFormTokens.Spacing.sm) {
                        ChurchAvatar(logoUrl: church.logoUrl, name: church.churchName, size: 28)
                        Text(church.churchName)
                            .lineLimit(1)
                    }
                    .frame(minHeight: FaithFormTokens.TouchTarget.minimum)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(Text("\(church.churchName), \(L.churchInfo)"))
            } else {
                Text(L.homeTitle)
            }
            Spacer(minLength: 0)
            if let onOpenAccount {
                Button(action: onOpenAccount) {
                    Image(systemName: "person.crop.circle")
                        .font(.title3)
                        .frame(width: 44, height: 44)
                }
                .accessibilityLabel("Account and settings")
            }
        }
        .font(theme.font(FaithFormTokens.Text.titleMedium))
        .foregroundStyle(theme.palette.contentPrimary)
        .padding(.horizontal, FaithFormTokens.Layout.screenPaddingHorizontal)
        .fixedSize(horizontal: false, vertical: true)
    }

    private var attendance: AutomaticAttendanceModel { dependencies.attendanceModel }

    /// The arrival waiting at this church, if automatic check-in is on and the
    /// church offers it. Another church's arrival belongs on that church's Home.
    private func arrival(for slug: String) -> PendingArrival? {
        guard root.selectedChurch?.automaticCheckInEnabled ?? true,
              attendance.isEnabled,
              let pending = attendance.pending,
              pending.churchSlug == slug
        else { return nil }
        return pending
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
                if let pending = arrival(for: church.churchSlug) {
                    // Someone standing in the building shouldn't have to find
                    // the Check in tab to be counted — the question comes to
                    // the screen they are already on.
                    AttendanceArrivalCard(
                        pending: pending,
                        churchName: church.churchName,
                        logoUrl: church.logoUrl,
                        now: attendance.status.now,
                        isWorking: attendance.isWorking,
                        onConfirm: { Task { await attendance.confirmCheckIn() } },
                        onDecline: { Task { await attendance.declineArrival() } }
                    )
                    .padding(.horizontal, FaithFormTokens.Layout.screenPaddingHorizontal)
                    .padding(.top, FaithFormTokens.Spacing.sm)
                    .transition(.move(edge: .top).combined(with: .opacity))
                }

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
                .fixedSize(horizontal: false, vertical: true)
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
            .animation(theme.animation(FaithFormTokens.Motion.slow), value: attendance.pending?.occurrenceId)
            // An arrival on screen counts itself down and turns into "Check in"
            // the moment it is due, rather than waiting for the notification.
            .task(id: attendance.pending?.promptAt) {
                await attendance.holdOpenWhilePending()
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
                    FaithFormCard {
                        VStack(spacing: 16) {
                            ZStack {
                                RoundedRectangle(cornerRadius: 20, style: .continuous)
                                    .fill(theme.palette.brandAccent.opacity(0.12))
                                    .frame(width: 64, height: 64)
                                Image(systemName: "building.2.fill")
                                    .font(.system(size: 28, weight: .medium))
                                    .foregroundStyle(theme.palette.brandAccent)
                            }
                            .accessibilityHidden(true)

                            VStack(spacing: 6) {
                                Text(L.noChurchTitle)
                                    .font(.system(size: 20, weight: .semibold, design: .rounded))
                                    .foregroundStyle(theme.palette.contentPrimary)
                                    .multilineTextAlignment(.center)
                                Text(L.noChurchBody)
                                    .font(.subheadline)
                                    .foregroundStyle(theme.palette.contentSecondary)
                                    .multilineTextAlignment(.center)
                                    .lineSpacing(3)
                            }

                            Button {
                                path.append(.search)
                            } label: {
                                Label(L.findAChurch, systemImage: "magnifyingglass")
                            }
                            .buttonStyle(FaithFormButtonStyle(kind: .primary, theme: theme))
                            .padding(.top, 4)
                        }
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 20)
                    }
                }
                .padding(FaithFormTokens.Spacing.lg)
            }
            .navigationTitle(L.homeTitle)
        }
    }
}
