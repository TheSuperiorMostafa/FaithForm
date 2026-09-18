import SwiftUI

/// The Watch experience.
///
/// Nothing here can start playback or ask the server for anything on its own:
/// each view reports an intent upward, and `MediaModel` / `MediaDetailModel`
/// are the only things that call the client. That is what keeps "a screen
/// appearing does not acquire a capability" a property of the structure rather
/// than a rule someone has to remember.

// MARK: - Live hero

/// The card at the top of the church screen when something is on.
///
/// **Rendered only when there is something to render.** The caller passes an
/// optional and this view does not exist when it is nil — there is no empty
/// "Live" area, no placeholder, and no grey box on a Tuesday.
public struct LiveNowHero: View {
    @Environment(\.faithformTheme) private var theme
    private let live: LiveMedia
    private let onWatch: @MainActor () -> Void

    public init(live: LiveMedia, onWatch: @escaping @MainActor () -> Void) {
        self.live = live
        self.onWatch = onWatch
    }

    public var body: some View {
        ZStack(alignment: .bottomLeading) {
            LinearGradient(
                colors: [theme.palette.brandPrimary, theme.palette.brandAccent],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )

            if let poster = live.posterUrl.flatMap(URL.init(string:)) {
                AsyncImage(url: poster) { phase in
                    if case let .success(image) = phase {
                        image
                            .resizable()
                            .scaledToFill()
                    }
                }
                .overlay {
                    LinearGradient(
                        colors: [.black.opacity(0.08), .black.opacity(0.82)],
                        startPoint: .top,
                        endPoint: .bottom
                    )
                }
            }

            VStack(alignment: .leading, spacing: FaithFormTokens.Spacing.md) {
                HStack(spacing: FaithFormTokens.Spacing.sm) {
                    if live.state == "live" {
                        // A filled dot, not an animation: reduced motion turns
                        // a pulsing indicator into a distraction someone cannot
                        // switch off.
                        Circle()
                            .fill(.red)
                            .frame(width: 8, height: 8)
                    }
                    Text(badgeText)
                        .font(theme.font(FaithFormTokens.Text.caption))
                        .fontWeight(.bold)
                        .foregroundStyle(.white)
                }
                .padding(.horizontal, FaithFormTokens.Spacing.sm)
                .padding(.vertical, FaithFormTokens.Spacing.xs)
                .background(.black.opacity(0.34), in: Capsule())

                Text(live.title)
                    .font(theme.font(FaithFormTokens.Text.displayLarge))
                    .foregroundStyle(.white)
                    .fixedSize(horizontal: false, vertical: true)

                Text(subtitle)
                    .font(theme.font(FaithFormTokens.Text.body))
                    .foregroundStyle(.white.opacity(0.82))
                    .fixedSize(horizontal: false, vertical: true)

                if live.state == "live" {
                    Button(action: onWatch) {
                        HStack(spacing: FaithFormTokens.Spacing.sm) {
                            Image(systemName: "play.fill")
                            Text(L.mediaWatchLive)
                                .fontWeight(.semibold)
                        }
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, FaithFormTokens.Spacing.sm)
                        .foregroundStyle(theme.palette.brandPrimary)
                        .background(.white, in: RoundedRectangle(cornerRadius: FaithFormTokens.Radius.md))
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(FaithFormTokens.Spacing.lg)
        }
        .frame(maxWidth: .infinity, minHeight: 210, alignment: .bottomLeading)
        .clipped()
        .clipShape(RoundedRectangle(cornerRadius: FaithFormTokens.Radius.lg))
        .shadow(color: theme.palette.brandPrimary.opacity(0.2), radius: 18, y: 8)
        // One element to VoiceOver: a card read as five fragments is a card
        // nobody listens to twice.
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(badgeText). \(live.title). \(subtitle)")
    }

    private var badgeText: String {
        switch live.state {
        case "live": return L.mediaLiveNowBadge
        case "upcoming": return L.mediaLiveUpcoming
        default: return L.mediaLiveEnded
        }
    }

    private var subtitle: String {
        switch live.state {
        case "recent_ended":
            return L.mediaLiveEndedBody
        default:
            guard let start = FaithFormInstant.parse(live.startsAt) else { return live.churchName }
            return MediaFormatting.when(start, timezone: live.churchTimezone)
        }
    }
}

// MARK: - Archive

public struct MediaArchiveList: View {
    @Environment(\.faithformTheme) private var theme
    @Bindable private var model: MediaModel

    private let onOpen: @MainActor (ArchiveItem) -> Void
    private let onWatchLive: @MainActor (LiveMedia) -> Void

    public init(
        model: MediaModel,
        onOpen: @escaping @MainActor (ArchiveItem) -> Void,
        onWatchLive: @escaping @MainActor (LiveMedia) -> Void
    ) {
        self.model = model
        self.onOpen = onOpen
        self.onWatchLive = onWatchLive
    }

    public var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: FaithFormTokens.Spacing.lg) {
                switch model.phase {
                case .idle, .loading:
                    MediaListSkeleton()

                case .blocked:
                    MediaMessage(
                        title: L.mediaBlockedTitle,
                        message: L.mediaUnavailableBody
                    )

                case .offline:
                    MediaMessage(
                        title: L.mediaOfflineTitle,
                        message: L.mediaOfflineBody,
                        actionTitle: L.mediaRetry
                    ) {
                        Task { await model.refresh() }
                    }

                case .failed(let message):
                    MediaMessage(title: message, message: "", actionTitle: L.mediaRetry) {
                        Task { await model.refresh() }
                    }

                case let .loaded(live, items, isStale):
                    if isStale {
                        OfflineBanner(message: L.offlineCached)
                    }
                    if let live {
                        LiveNowHero(live: live) { onWatchLive(live) }
                    }

                    let searching = !model.searchTerm.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                    if live == nil && items.isEmpty && !searching {
                        EmptyStateView(
                            title: L.mediaServicesEmptyTitle,
                            explanation: L.mediaServicesEmptyBody,
                            symbol: "video"
                        )
                    } else {
                        Text(L.mediaArchiveTitle)
                            .font(theme.font(FaithFormTokens.Text.titleMedium))
                            .foregroundStyle(theme.palette.contentPrimary)

                        FaithFormSearchField(
                            placeholder: L.mediaSearchLabel,
                            text: $model.searchTerm,
                            onSubmit: { Task { await model.search(model.searchTerm) } }
                        )

                        if items.isEmpty {
                            EmptyStateView(
                                title: searching ? L.mediaArchiveEmptySearch : L.mediaArchiveEmpty,
                                explanation: searching ? "" : L.mediaArchiveEmptyBody,
                                symbol: searching ? "magnifyingglass" : "film"
                            )
                        } else {
                            ForEach(items, id: \.mediaId) { item in
                                Button { onOpen(item) } label: {
                                    ArchiveCard(item: item)
                                }
                                .buttonStyle(.plain)
                                .onAppear {
                                    if item.mediaId == items.last?.mediaId {
                                        Task { await model.loadMore() }
                                    }
                                }
                            }

                            if model.isLoadingMore {
                                MediaCardSkeleton()
                                    .skeletonShimmer()
                            }
                        }
                    }
                }
            }
            .padding(.horizontal, FaithFormTokens.Layout.screenPaddingHorizontal)
            .padding(.vertical, FaithFormTokens.Spacing.xl)
        }
        .background(theme.palette.background)
        // A service can begin while this tab is sitting in the saved tab stack.
        // Revalidate whenever it appears instead of honoring the ordinary
        // five-minute list cache for the time-sensitive live state.
        .task { await model.refresh() }
        .refreshable { await model.refresh() }
        .refreshesLiveStatus(model)
    }
}

// MARK: - Keeping "live" current

extension View {
    /// Keeps `model`'s live state current while this view is on screen.
    ///
    /// A service starts at a set time, very often with the app already open on
    /// Home, and a person should see it appear without having to know to pull
    /// down or relaunch. So while the view is visible and the app is in the
    /// foreground, the live projection is revalidated on a timer — a
    /// conditional request the server answers 304 until something changes —
    /// and once more the moment the app returns to the foreground.
    public func refreshesLiveStatus(
        _ model: MediaModel,
        every interval: Duration = .seconds(30)
    ) -> some View {
        modifier(LiveStatusRefresher(model: model, interval: interval))
    }
}

private struct LiveStatusRefresher: ViewModifier {
    @Environment(\.scenePhase) private var scenePhase
    let model: MediaModel
    let interval: Duration

    func body(content: Content) -> some View {
        content
            // Restarted whenever the app becomes active or inactive, and
            // cancelled when the view leaves the screen, so a phone in a
            // pocket or on another tab does not poll.
            .task(id: scenePhase == .active) {
                guard scenePhase == .active else { return }
                while !Task.isCancelled {
                    try? await Task.sleep(for: interval)
                    if Task.isCancelled { return }
                    await model.refreshLive()
                }
            }
            .onChange(of: scenePhase) { _, phase in
                guard phase == .active else { return }
                Task { await model.refreshLive() }
            }
    }
}

/// One recording, poster-first.
struct ArchiveCard: View {
    @Environment(\.faithformTheme) private var theme
    let item: ArchiveItem

    var body: some View {
        FaithFormCard {
            VStack(alignment: .leading, spacing: FaithFormTokens.Spacing.sm) {
                Text(item.title)
                    .font(theme.font(FaithFormTokens.Text.titleMedium))
                    .foregroundStyle(theme.palette.contentPrimary)
                    .fixedSize(horizontal: false, vertical: true)

                if let series = item.seriesName {
                    Text(series)
                        .font(theme.font(FaithFormTokens.Text.caption))
                        .foregroundStyle(theme.palette.contentSecondary)
                }

                Text(metadata)
                    .font(theme.font(FaithFormTokens.Text.caption))
                    .foregroundStyle(theme.palette.contentSecondary)
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(item.title). \(metadata)")
        .accessibilityAddTraits(.isButton)
    }

    private var metadata: String {
        var parts: [String] = []
        if let recorded = FaithFormInstant.parse(item.recordedAt) {
            parts.append(MediaFormatting.when(recorded, timezone: item.churchTimezone))
        }
        if let duration = item.durationSeconds, duration > 0 {
            parts.append(MediaFormatting.duration(seconds: duration))
        }
        if !item.speakers.isEmpty { parts.append(item.speakers.joined(separator: ", ")) }
        return parts.joined(separator: " · ")
    }
}

// MARK: - Detail

public struct MediaDetailScreen: View {
    @Environment(\.faithformTheme) private var theme
    private let model: MediaDetailModel

    public init(model: MediaDetailModel) {
        self.model = model
    }

    public var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: FaithFormTokens.Spacing.lg) {
                switch model.phase {
                case .loading:
                    DetailSkeleton()

                case .unavailable:
                    MediaMessage(
                        title: L.mediaUnavailableTitle,
                        message: L.mediaUnavailableBody
                    )

                case .offline:
                    MediaMessage(title: L.mediaOfflineTitle, message: L.mediaOfflineBody)

                case .loaded(let detail):
                    Text(detail.title)
                        .font(theme.font(FaithFormTokens.Text.displayLarge))
                        .foregroundStyle(theme.palette.contentPrimary)
                        .fixedSize(horizontal: false, vertical: true)

                    Text(detailMetadata(detail))
                        .font(theme.font(FaithFormTokens.Text.caption))
                        .foregroundStyle(theme.palette.contentSecondary)

                    if let summary = detail.summary, !summary.isEmpty {
                        Text(summary)
                            .font(theme.font(FaithFormTokens.Text.body))
                            .foregroundStyle(theme.palette.contentSecondary)
                            .fixedSize(horizontal: false, vertical: true)
                    }

                    PlaybackControls(model: model)
                }
            }
            .padding(.horizontal, FaithFormTokens.Layout.screenPaddingHorizontal)
            .padding(.vertical, FaithFormTokens.Spacing.xl)
        }
        .background(theme.palette.background)
        .task { await model.load() }
        // The position is saved on the way out, because there may be no later
        // opportunity — iOS can suspend without warning.
        .onDisappear { Task { await model.stop() } }
    }

    private func detailMetadata(_ detail: MediaDetail) -> String {
        var parts: [String] = [detail.churchName]
        if let recorded = FaithFormInstant.parse(detail.recordedAt) {
            parts.append(MediaFormatting.when(recorded, timezone: detail.churchTimezone))
        }
        if let duration = detail.durationSeconds, duration > 0 {
            parts.append(MediaFormatting.duration(seconds: duration))
        }
        return parts.joined(separator: " · ")
    }
}

struct PlaybackControls: View {
    @Environment(\.faithformTheme) private var theme
    let model: MediaDetailModel

    var body: some View {
        VStack(alignment: .leading, spacing: FaithFormTokens.Spacing.md) {
            if let message = model.failureMessage {
                Text(message)
                    .font(theme.font(FaithFormTokens.Text.body))
                    .foregroundStyle(theme.palette.contentSecondary)
                    .fixedSize(horizontal: false, vertical: true)
                    // Announced as soon as it appears: someone whose sermon just
                    // stopped is not looking at the screen.
                    .accessibilityAddTraits(.isStaticText)
            }

            switch model.playback {
            case .idle, .ended, .failed:
                Button(L.mediaPlay) {
                    Task { await model.play(kind: .recording) }
                }
                .buttonStyle(FaithFormButtonStyle(kind: .primary, theme: theme))

            case .preparing, .buffering:
                FaithFormWorkingLabel(L.mediaBuffering, working: true)
                    .font(theme.font(FaithFormTokens.Text.body))
                    .foregroundStyle(theme.palette.contentSecondary)

            case .playing:
                Button(L.mediaPause) { Task { await model.pause() } }
                    .buttonStyle(FaithFormButtonStyle(kind: .primary, theme: theme))

            case .paused:
                Button(L.mediaPlay) { Task { await model.play(kind: .recording) } }
                    .buttonStyle(FaithFormButtonStyle(kind: .primary, theme: theme))
            }
        }
    }
}

// MARK: - Shared

struct MediaMessage: View {
    @Environment(\.faithformTheme) private var theme
    let title: String
    // Named `message` rather than `body`: `body` is `View`'s own requirement,
    // and a stored property by that name shadows it into a compile error.
    let message: String
    var actionTitle: String? = nil
    var action: (@MainActor () -> Void)? = nil

    var body: some View {
        FaithFormCard {
            VStack(alignment: .leading, spacing: FaithFormTokens.Spacing.md) {
                Text(title)
                    .font(theme.font(FaithFormTokens.Text.titleMedium))
                    .foregroundStyle(theme.palette.contentPrimary)
                    .fixedSize(horizontal: false, vertical: true)

                if !message.isEmpty {
                    Text(message)
                        .font(theme.font(FaithFormTokens.Text.body))
                        .foregroundStyle(theme.palette.contentSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                }

                if let actionTitle, let action {
                    Button(actionTitle, action: action)
                        .buttonStyle(FaithFormButtonStyle(kind: .quiet, theme: theme))
                }
            }
        }
        .accessibilityElement(children: .contain)
    }
}

public enum MediaFormatting {
    /// A date in **the church's** zone, not the device's.
    ///
    /// "Sunday 10am" means the church's Sunday. A traveller must not see last
    /// week's service shifted onto Saturday.
    public static func when(_ date: Date, timezone: String) -> String {
        let formatter = DateFormatter()
        formatter.timeZone = TimeZone(identifier: timezone) ?? .current
        formatter.dateStyle = .medium
        formatter.timeStyle = .short
        return formatter.string(from: date)
    }

    /// "1h 12m", or "12m". Spoken as well as shown, so no bare colon form.
    public static func duration(seconds: Int) -> String {
        let hours = seconds / 3600
        let minutes = (seconds % 3600) / 60
        if hours > 0 { return "\(hours)h \(minutes)m" }
        return "\(max(1, minutes))m"
    }
}

#if os(iOS)
import AVFoundation
import UIKit

/// The picture of whatever `AVPlayerAdapter` is playing.
///
/// Separated behind `#if os(iOS)` because it is UIKit, and kept deliberately
/// inert, like `CheckInCameraPreview`: it displays a player the adapter drives
/// and owns nothing. It cannot load an item, play, pause, seek or see a
/// capability, so a surface left on screen by a layout mistake cannot start
/// anything — and before the person taps Play it is simply black.
///
/// Letterboxed rather than cropped: a sermon slide with its edges cut off is a
/// slide nobody can read.
public struct MediaVideoSurface: UIViewRepresentable {
    private let player: AVPlayer

    public init(player: AVPlayer) {
        self.player = player
    }

    public func makeUIView(context: Context) -> SurfaceView {
        let view = SurfaceView()
        view.playerLayer.player = player
        view.playerLayer.videoGravity = .resizeAspect
        view.backgroundColor = .black
        // Decorative to VoiceOver: the title, the state and the controls beside
        // it carry everything a person needs, and "video" read aloud adds nothing.
        view.isAccessibilityElement = false
        return view
    }

    public func updateUIView(_ uiView: SurfaceView, context: Context) {
        if uiView.playerLayer.player !== player { uiView.playerLayer.player = player }
    }

    public final class SurfaceView: UIView {
        public override class var layerClass: AnyClass { AVPlayerLayer.self }
        var playerLayer: AVPlayerLayer {
            // Safe: `layerClass` guarantees the type.
            layer as! AVPlayerLayer
        }
    }
}

// MARK: - Full-screen live service

import AVKit

/// A live service, full screen, playing.
///
/// What "Watch live" opens, from Home or from Watch: the picture fills the
/// screen (letterboxed, never cropped — a slide with its edges cut off is a
/// slide nobody can read), and it rotates with the phone. Playback starts
/// without a second tap; the model owns that and every retry.
///
/// Controls fade out while the service plays and come back on a tap. They stay
/// put under VoiceOver, where a control that hides itself is a control that
/// cannot be found. A swipe down closes it, as it does for the system's player.
public struct LivePlayerView: View {
    @Environment(\.faithformTheme) private var theme
    @Environment(\.accessibilityVoiceOverEnabled) private var voiceOverEnabled
    private let model: LivePlayerModel
    private let player: AVPlayer
    private let live: LiveMedia
    private let onClose: @MainActor () -> Void

    @State private var controlsVisible = true
    @State private var hideControls: Task<Void, Never>?
    @State private var dragOffset: CGFloat = 0

    public init(
        model: LivePlayerModel,
        player: AVPlayer,
        live: LiveMedia,
        onClose: @escaping @MainActor () -> Void
    ) {
        self.model = model
        self.player = player
        self.live = live
        self.onClose = onClose
    }

    public var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()

            MediaVideoSurface(player: player)
                .ignoresSafeArea()
                .accessibilityHidden(true)

            status

            if showsControls {
                controls
                    .transition(.opacity)
            }
        }
        .offset(y: dragOffset)
        .contentShape(Rectangle())
        .onTapGesture { toggleControls() }
        .gesture(
            DragGesture(minimumDistance: 24)
                .onChanged { value in dragOffset = max(0, value.translation.height) }
                .onEnded { value in
                    if value.translation.height > 140 {
                        onClose()
                    } else {
                        withAnimation(theme.animation(FaithFormTokens.Motion.standard)) { dragOffset = 0 }
                    }
                }
        )
        .statusBarHidden(!showsControls)
        .persistentSystemOverlays(.hidden)
        .animation(theme.animation(FaithFormTokens.Motion.standard), value: showsControls)
        .onChange(of: model.phase, initial: true) { _, phase in
            if phase == .playing { scheduleHide() } else { reveal() }
        }
    }

    private var showsControls: Bool {
        controlsVisible || voiceOverEnabled || model.phase != .playing
    }

    // MARK: Status

    @ViewBuilder
    private var status: some View {
        switch model.phase {
        case .connecting, .reconnecting:
            VStack(spacing: FaithFormTokens.Spacing.md) {
                ProgressView()
                    .controlSize(.large)
                    .tint(.white)
                Text(model.phase == .connecting ? L.mediaLiveConnecting : L.mediaLiveReconnecting)
                    .font(theme.font(FaithFormTokens.Text.body))
                    .foregroundStyle(.white.opacity(0.9))
                    .multilineTextAlignment(.center)
            }
            .padding(FaithFormTokens.Spacing.lg)
            .accessibilityElement(children: .combine)

        case .ended:
            message(title: L.mediaLiveEnded, body: L.mediaLiveEndedBody, canRetry: false)
        case .unavailable:
            message(title: L.mediaLiveUnavailable, body: nil, canRetry: true)
        case .failed:
            message(title: L.mediaLiveFailed, body: nil, canRetry: true)

        case .playing, .paused:
            EmptyView()
        }
    }

    private func message(title: String, body: String?, canRetry: Bool) -> some View {
        VStack(spacing: FaithFormTokens.Spacing.md) {
            Text(title)
                .font(theme.font(FaithFormTokens.Text.titleMedium))
                .foregroundStyle(.white)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
            if let body {
                Text(body)
                    .font(theme.font(FaithFormTokens.Text.body))
                    .foregroundStyle(.white.opacity(0.8))
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
            }
            HStack(spacing: FaithFormTokens.Spacing.md) {
                if canRetry {
                    Button(L.mediaRetry) { Task { await model.retry() } }
                        .buttonStyle(FaithFormButtonStyle(kind: .primary, theme: theme))
                }
                Button(L.mediaClosePlayer, action: onClose)
                    .buttonStyle(FaithFormButtonStyle(kind: .secondary, theme: theme))
            }
            .fixedSize()
        }
        .padding(FaithFormTokens.Spacing.xl)
        .frame(maxWidth: 420)
    }

    // MARK: Controls

    private var controls: some View {
        VStack {
            HStack(spacing: FaithFormTokens.Spacing.md) {
                Button(action: onClose) {
                    Image(systemName: "xmark")
                        .font(.system(size: 17, weight: .semibold))
                        .frame(width: 44, height: 44)
                        .background(.black.opacity(0.45), in: Circle())
                }
                .foregroundStyle(.white)
                .accessibilityLabel(L.mediaClosePlayer)

                HStack(spacing: FaithFormTokens.Spacing.sm) {
                    Circle()
                        .fill(.red)
                        .frame(width: 8, height: 8)
                    Text(L.mediaLiveNowBadge)
                        .font(theme.font(FaithFormTokens.Text.caption))
                        .fontWeight(.bold)
                }
                .padding(.horizontal, FaithFormTokens.Spacing.sm)
                .padding(.vertical, FaithFormTokens.Spacing.xs)
                .background(.black.opacity(0.45), in: Capsule())
                .foregroundStyle(.white)

                Text(live.title)
                    .font(theme.font(FaithFormTokens.Text.titleMedium))
                    .foregroundStyle(.white)
                    .lineLimit(1)
                    .shadow(color: .black.opacity(0.6), radius: 4)

                Spacer(minLength: 0)

                AirPlayButton()
                    .frame(width: 44, height: 44)
            }
            .padding(.horizontal, FaithFormTokens.Spacing.lg)
            .padding(.top, FaithFormTokens.Spacing.sm)

            Spacer()

            if model.phase == .playing || model.phase == .paused {
                Button {
                    Task {
                        if model.phase == .playing {
                            await model.pause()
                        } else {
                            await model.resume()
                        }
                    }
                } label: {
                    Image(systemName: model.phase == .playing ? "pause.fill" : "play.fill")
                        .font(.system(size: 30, weight: .semibold))
                        .frame(width: 72, height: 72)
                        .background(.black.opacity(0.45), in: Circle())
                }
                .foregroundStyle(.white)
                .accessibilityLabel(model.phase == .playing ? L.mediaPause : L.mediaPlay)
            }

            Spacer()
        }
        .background(
            LinearGradient(
                colors: [.black.opacity(0.55), .clear, .clear, .black.opacity(0.35)],
                startPoint: .top,
                endPoint: .bottom
            )
            .ignoresSafeArea()
            .allowsHitTesting(false)
        )
    }

    private func toggleControls() {
        if controlsVisible {
            hideControls?.cancel()
            controlsVisible = false
        } else {
            reveal()
            if model.phase == .playing { scheduleHide() }
        }
    }

    private func reveal() {
        hideControls?.cancel()
        controlsVisible = true
    }

    private func scheduleHide() {
        hideControls?.cancel()
        hideControls = Task {
            try? await Task.sleep(for: .seconds(3))
            guard !Task.isCancelled else { return }
            controlsVisible = false
        }
    }
}

/// The system's own route picker, so a service can go to the living-room TV.
private struct AirPlayButton: UIViewRepresentable {
    func makeUIView(context: Context) -> AVRoutePickerView {
        let view = AVRoutePickerView()
        view.tintColor = .white
        view.activeTintColor = .systemBlue
        view.prioritizesVideoDevices = true
        return view
    }

    func updateUIView(_ uiView: AVRoutePickerView, context: Context) {}
}
#endif
