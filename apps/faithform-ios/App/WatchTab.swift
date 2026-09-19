import AVFoundation
import SwiftUI
import FaithFormKit

/// Which pane of the Services tab is showing.
///
/// Held by `RootModel` rather than by the tab, so a `faithform://church/x/sermons`
/// link can land on sermons rather than on the recordings beside them.
enum WatchSection: Hashable {
    case media
    case sermons
    case slides
}

/// Services: live and past recordings, sermons, and slides.
///
/// ## Why these share a tab
///
/// A sixth tab would push Account into "More" (see `HomeTabView`). Watch and
/// sermons are two ways into the same Sunday, so they sit here as one row.
struct WatchTabView: View {
    enum Route: Hashable {
        case recording(mediaId: String)
        case sermon(sermonId: String)
        case presentation(presentationId: String)
    }

    @Environment(\.faithformTheme) private var theme
    let root: RootModel
    let features: ChurchFeatures
    let isStale: Bool

    @State private var path: [Route] = []

    var body: some View {
        let showsMedia = root.isAllowed(.watch(churchSlug: features.churchSlug))
        let showsSermons = root.isAllowed(.sermonArchive(churchSlug: features.churchSlug))
        let section = Self.effectiveSection(
            requested: root.watchSection,
            showsMedia: showsMedia,
            showsSermons: showsSermons
        )
        let watchSelection = Binding(
            get: { section },
            set: { root.watchSection = $0 }
        )

        NavigationStack(path: $path) {
            VStack(spacing: 0) {
                if isStale { OfflineBanner(message: L.offlineCached) }

                if showsMedia && showsSermons {
                    FaithFormPillSwitcher(
                        selection: watchSelection,
                        options: [
                            .init(.media, title: L.mediaTabTitle),
                            .init(.sermons, title: L.sermonsTitle),
                        ],
                        accessibilityLabel: L.tabWatch
                    )
                    .padding(.horizontal, FaithFormTokens.Layout.screenPaddingHorizontal)
                    .padding(.vertical, FaithFormTokens.Spacing.sm)
                }

                switch section {
                case .media:
                    MediaArchiveList(
                        model: features.media,
                        onOpen: { path.append(.recording(mediaId: $0.mediaId)) },
                        // Full screen and playing, exactly as from Home.
                        onWatchLive: { root.watchLive($0) },
                        // "Today's service has ended" becomes its replay.
                        onOpenRecording: { path.append(.recording(mediaId: $0)) }
                    )
                case .sermons, .slides:
                    SermonListView(
                        model: features.sermons,
                        presentations: features.presentations,
                        onOpenNotes: { path.append(.sermon(sermonId: $0)) },
                        onOpenSlides: { path.append(.presentation(presentationId: $0)) },
                        showTitle: false
                    )
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
            .background(theme.palette.background)
            .navigationTitle(L.tabWatch)
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
                            Text(L.tabWatch)
                                .font(theme.font(FaithFormTokens.Text.titleMedium))
                                .foregroundStyle(theme.palette.contentPrimary)
                        }
                    }
                }
            }
            .navigationDestination(for: Route.self) { route in
                switch route {
                case let .recording(mediaId):
                    RecordingScreen(features: features, mediaId: mediaId)
                case let .sermon(sermonId):
                    SermonScreen(features: features, sermonId: sermonId)
                case let .presentation(presentationId):
                    PresentationScreen(features: features, presentationId: presentationId)
                }
            }
        }
    }

    /// The pane to draw, given what the registry allows.
    ///
    /// A requested pane that is switched off falls back to one that is on, so a
    /// stale choice — or a deep link to sermons a church has since turned off —
    /// never opens an empty half.
    nonisolated static func effectiveSection(
        requested: WatchSection,
        showsMedia: Bool,
        showsSermons: Bool
    ) -> WatchSection {
        switch requested {
        case .media:
            return showsMedia || !showsSermons ? .media : .sermons
        case .sermons:
            return showsSermons || !showsMedia ? .sermons : .media
        case .slides:
            if showsSermons { return .sermons }
            return showsMedia ? .media : .sermons
        }
    }

    /// The link a `…/sermons` URL follows.
    ///
    /// Through `RootModel.open` rather than setting the tab by hand, so the
    /// destination lands exactly where the link does — same registry answer,
    /// same pane.
    nonisolated static func sermonsLink(churchSlug: String) -> URL? {
        URL(string: "\(DeepLinkParser.scheme)://church/\(churchSlug)/sermons")
    }
}

// MARK: - Detail hosts

private enum OnceModelLoading {
    case detail
    case slides
}

/// Builds a detail model once, the first time its screen appears.
///
/// A model created in a view's initializer is created again on every render of
/// the screen that pushed it — and a playback model rebuilt mid-sermon loses
/// its state. `@State` holding an optional, filled on first appearance, makes it
/// exactly once per push.
private struct OnceModel<Model: AnyObject, Content: View>: View {
    let make: @MainActor () -> Model
    var onCreate: (@MainActor (Model) async -> Void)? = nil
    var loading: OnceModelLoading = .detail
    @ViewBuilder let content: (Model) -> Content

    @State private var model: Model?

    var body: some View {
        if let model {
            content(model)
        } else {
            // Same skeleton the destination will show while it fetches, so
            // tapping a sermon is not a blank flash then a spinner.
            Group {
                switch loading {
                case .detail:
                    DetailSkeleton()
                        .padding(.horizontal, FaithFormTokens.Layout.screenPaddingHorizontal)
                        .padding(.vertical, FaithFormTokens.Spacing.xl)
                case .slides:
                    SlideSkeleton()
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
            .task {
                let made = make()
                await onCreate?(made)
                model = made
            }
        }
    }
}

/// One past service.
///
/// Upright: the player across the top, the service's details beneath. Turned
/// sideways — or after tapping full screen, which rotates even with rotation
/// lock on — the player fills the screen and everything else steps aside.
struct RecordingScreen: View {
    @State private var showPresentation = false
    let features: ChurchFeatures
    let mediaId: String

    var body: some View {
        OnceModel(
            make: { features.mediaDetail(mediaId: mediaId) },
            onCreate: { model in await Self.connect(model, to: features) }
        ) { model in
            RecordingLayout(model: model, player: features.player.videoPlayer, onOpenPresentation: { showPresentation = true })
                .sheet(isPresented: $showPresentation) {
                    if case let .loaded(detail) = model.phase, let presentation = detail.presentation {
                        ServicePresentationSheet(features: features, presentationId: presentation.presentationId)
                    }
                }
                .navigationBarTitleDisplayMode(.inline)
                // Reclaimed on every appearance, not only the first: the live
                // player may have held the shared player's events in between.
                .task { await Self.connect(model, to: features) }
        }
    }

    /// Routes the player's events to the screen that is showing.
    ///
    /// The player is shared by the church's screens, and only one is ever on
    /// top, so whichever appeared last is the one that hears it buffer, start,
    /// and fail. Without this the model never learns playback started.
    static func connect(_ model: MediaDetailModel, to features: ChurchFeatures) async {
        await features.player.setEventHandler { event in
            Task { @MainActor in await model.handle(event) }
        }
    }
}

struct RecordingLayout: View {
    let model: MediaDetailModel
    let player: AVPlayer
    var onOpenPresentation: (@MainActor () -> Void)? = nil

    var body: some View {
        GeometryReader { geometry in
            let landscape = geometry.size.width > geometry.size.height
            VStack(spacing: 0) {
                // Keep the same stage and AVPlayerLayer in both orientations.
                stage(fullScreen: landscape)
                    .frame(height: landscape ? geometry.size.height : geometry.size.width * 9 / 16)
                if !landscape {
                    if case let .loaded(detail) = model.phase, detail.presentation != nil, let onOpenPresentation {
                        Button(L.mediaOpenPresentation, action: onOpenPresentation)
                            .buttonStyle(.bordered).padding(.top)
                    }
                    MediaDetailScreen(model: model)
                }
            }
            .ignoresSafeArea(edges: landscape ? .all : [])
            .background(landscape ? Color.black : Color.clear)
            .toolbar(landscape ? .hidden : .visible, for: .navigationBar)
            .toolbar(landscape ? .hidden : .visible, for: .tabBar)
            .statusBarHidden(landscape)
            .persistentSystemOverlays(landscape ? .hidden : .automatic)
        }
        .task { await model.load() }
        .onDisappear {
            ScreenOrientation.enterPortrait()
            // Only leaving the player screen ends the session, never hiding
            // its metadata when the phone rotates.
            Task { await model.stop() }
        }
    }

    private func stage(fullScreen: Bool) -> some View {
        let detail: MediaDetail? = {
            if case let .loaded(detail) = model.phase { return detail }
            return nil
        }()
        return RecordingStage(
            model: model,
            player: player,
            posterUrl: detail?.posterUrl,
            startOffset: Double(detail?.startOffsetSeconds ?? 0),
            knownDuration: detail?.durationSeconds.map(Double.init),
            isFullScreen: fullScreen,
            onToggleFullScreen: {
                if fullScreen { ScreenOrientation.enterPortrait() } else { ScreenOrientation.enterLandscape() }
            }
        )
    }
}

/// One sermon's notes.
struct SermonScreen: View {
    let features: ChurchFeatures
    let sermonId: String

    var body: some View {
        OnceModel(make: { features.sermonDetail(sermonId: sermonId) }) { model in
            VStack(spacing: 0) {
                if case let .loaded(detail) = model.phase {
                    RelatedServices(features: features, services: detail.linkedServices ?? [])
                }
                SermonDetailView(model: model)
            }
            .navigationBarTitleDisplayMode(.inline)
            .task {
                while !Task.isCancelled {
                    try? await Task.sleep(for: .seconds(30))
                    if !Task.isCancelled { await model.load() }
                }
            }
        }
    }
}

/// One published slide deck.
struct PresentationScreen: View {
    let features: ChurchFeatures
    let presentationId: String
    var showsLinkedServices = true

    var body: some View {
        OnceModel(
            make: { features.presentationDetail(presentationId: presentationId) },
            loading: .slides
        ) { model in
            VStack(spacing: 0) {
                if showsLinkedServices, case let .loaded(detail) = model.phase {
                    RelatedServices(features: features, services: detail.linkedServices ?? [])
                }
                PresentationViewer(model: model)
            }
            .task {
                while showsLinkedServices && !Task.isCancelled {
                    try? await Task.sleep(for: .seconds(30))
                    if !Task.isCancelled { await model.load() }
                }
            }
        }
    }
}
