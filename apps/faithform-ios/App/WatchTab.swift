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
        case live(LiveMedia)
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
                        onWatchLive: { path.append(.live($0)) }
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
            .navigationDestination(for: Route.self) { route in
                switch route {
                case let .recording(mediaId):
                    RecordingScreen(features: features, mediaId: mediaId)
                case let .live(live):
                    LiveServiceScreen(features: features, live: live)
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
struct RecordingScreen: View {
    let features: ChurchFeatures
    let mediaId: String

    var body: some View {
        OnceModel(
            make: { features.mediaDetail(mediaId: mediaId) },
            onCreate: { model in await Self.connect(model, to: features) }
        ) { model in
            VStack(spacing: 0) {
                VideoFrame(features: features)
                MediaDetailScreen(model: model)
            }
            .navigationBarTitleDisplayMode(.inline)
        }
    }

    /// Routes the player's events to the screen that is showing.
    ///
    /// The player is shared by the church's screens, and only one is ever on
    /// top, so whichever appeared last is the one that hears it buffer, start,
    /// and fail. Without this the model never learns playback started, and the
    /// button never turns from Play into Pause.
    static func connect(_ model: MediaDetailModel, to features: ChurchFeatures) async {
        await features.player.setEventHandler { event in
            Task { @MainActor in await model.handle(event) }
        }
    }
}

/// A service that is on right now.
///
/// Not `MediaDetailScreen`: a live service has no recording to describe or
/// resume, and that screen's controls always play the recording. This one plays
/// the live edge and nothing else.
struct LiveServiceScreen: View {
    @Environment(\.faithformTheme) private var theme
    let features: ChurchFeatures
    let live: LiveMedia

    var body: some View {
        OnceModel(
            make: { features.mediaDetail(mediaId: live.mediaId) },
            onCreate: { model in await RecordingScreen.connect(model, to: features) }
        ) { model in
            VStack(spacing: 0) {
                VideoFrame(features: features)
                ScrollView {
                    LiveServiceDetails(live: live, model: model)
                        .padding(.horizontal, FaithFormTokens.Layout.screenPaddingHorizontal)
                        .padding(.vertical, FaithFormTokens.Spacing.xl)
                }
            }
            .background(theme.palette.background)
            .navigationBarTitleDisplayMode(.inline)
            // Leaving stops the stream. A live service still playing behind
            // another screen is sound nobody can find the source of.
            .onDisappear { Task { await model.stop() } }
        }
    }
}

private struct LiveServiceDetails: View {
    @Environment(\.faithformTheme) private var theme
    let live: LiveMedia
    let model: MediaDetailModel

    var body: some View {
        VStack(alignment: .leading, spacing: FaithFormTokens.Spacing.lg) {
            Text(L.mediaLiveNowBadge)
                .font(theme.font(FaithFormTokens.Text.caption))
                .foregroundStyle(theme.palette.brandPrimary)
            Text(live.title)
                .font(theme.font(FaithFormTokens.Text.displayLarge))
                .foregroundStyle(theme.palette.contentPrimary)
                .fixedSize(horizontal: false, vertical: true)
            Text(live.churchName)
                .font(theme.font(FaithFormTokens.Text.body))
                .foregroundStyle(theme.palette.contentSecondary)

            if let message = model.failureMessage {
                Text(message)
                    .font(theme.font(FaithFormTokens.Text.body))
                    .foregroundStyle(theme.palette.contentSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }

            switch model.playback {
            case .preparing, .buffering:
                FaithFormWorkingLabel(L.mediaBuffering, working: true)
                    .font(theme.font(FaithFormTokens.Text.body))
                    .foregroundStyle(theme.palette.contentSecondary)
            case .playing:
                Button(L.mediaPause) { Task { await model.pause() } }
                    .buttonStyle(FaithFormButtonStyle(kind: .primary, theme: theme))
            case .idle, .paused, .ended, .failed:
                Button(L.mediaWatchLive) { Task { await model.play(kind: .live) } }
                    .buttonStyle(FaithFormButtonStyle(kind: .primary, theme: theme))
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// The picture, above a recording's or a live service's details.
///
/// 16:9, because that is what a service is filmed in, and pinned above the
/// scrolling text so the video stays in view while a person reads the summary.
/// Black until Play: the surface displays the church's shared player and starts
/// nothing itself.
private struct VideoFrame: View {
    let features: ChurchFeatures

    var body: some View {
        MediaVideoSurface(player: features.player.videoPlayer)
            .aspectRatio(16.0 / 9.0, contentMode: .fit)
            .frame(maxWidth: .infinity)
    }
}

/// One sermon's notes.
struct SermonScreen: View {
    let features: ChurchFeatures
    let sermonId: String

    var body: some View {
        OnceModel(make: { features.sermonDetail(sermonId: sermonId) }) { model in
            SermonDetailView(model: model)
                .navigationBarTitleDisplayMode(.inline)
        }
    }
}

/// One published slide deck.
struct PresentationScreen: View {
    let features: ChurchFeatures
    let presentationId: String

    var body: some View {
        OnceModel(
            make: { features.presentationDetail(presentationId: presentationId) },
            loading: .slides
        ) { model in
            PresentationViewer(model: model)
        }
    }
}
