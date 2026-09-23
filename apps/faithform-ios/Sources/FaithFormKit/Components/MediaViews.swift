import SwiftUI

/// The Watch experience.
///
/// Nothing here can start playback or ask the server for anything on its own:
/// each view reports an intent upward, and `MediaModel` / `MediaDetailModel`
/// are the only things that call the client. That is what keeps "a screen
/// appearing does not acquire a capability" a property of the structure rather
/// than a rule someone has to remember.

// MARK: - Live hero

/// The service card at the top of Home and Services when something is on.
///
/// **Rendered only when there is something to render.** The caller passes an
/// optional and this view does not exist when it is nil — no empty "Live" area
/// on a Tuesday.
///
/// One picture of the service — the frame FaithForm captured from the stream —
/// with the state laid over it, and one obvious action: watch it live, or watch
/// the replay once it is published.
public struct LiveNowHero: View {
    @Environment(\.faithformTheme) private var theme
    private let live: LiveMedia
    private let onWatch: @MainActor () -> Void
    private let onWatchReplay: (@MainActor (String) -> Void)?

    public init(
        live: LiveMedia,
        onWatch: @escaping @MainActor () -> Void,
        onWatchReplay: (@MainActor (String) -> Void)? = nil
    ) {
        self.live = live
        self.onWatch = onWatch
        self.onWatchReplay = onWatchReplay
    }

    public var body: some View {
        Group {
            if let action {
                Button(action: action) { card }
                    .buttonStyle(PressScaleStyle())
            } else {
                card
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(stateLabel). \(live.title). \(subtitle)")
        .accessibilityHint(action == nil ? "" : actionLabel)
    }

    private var isLive: Bool { live.state == "live" }
    private var replayId: String? { live.state == "recent_ended" ? live.replayMediaId : nil }

    private var action: (@MainActor () -> Void)? {
        if isLive { return onWatch }
        if let replayId, let onWatchReplay { return { onWatchReplay(replayId) } }
        return nil
    }

    private var card: some View {
        VStack(alignment: .leading, spacing: 0) {
            StreamThumbnail(url: live.posterUrl, showsGlyph: action == nil)
                .overlay {
                    LinearGradient(
                        colors: [.black.opacity(0.0), .black.opacity(0.35)],
                        startPoint: .center,
                        endPoint: .bottom
                    )
                }
                .overlay(alignment: .topLeading) {
                    badge.padding(FaithFormTokens.Spacing.md)
                }
                .overlay {
                    if action != nil { PlayGlyph(size: 60) }
                }

            VStack(alignment: .leading, spacing: FaithFormTokens.Spacing.xs) {
                Text(live.title)
                    .font(theme.font(FaithFormTokens.Text.titleLarge))
                    .foregroundStyle(theme.palette.contentPrimary)
                    .lineLimit(2)
                    .fixedSize(horizontal: false, vertical: true)
                Text(subtitle)
                    .font(theme.font(FaithFormTokens.Text.bodySmall))
                    .foregroundStyle(theme.palette.contentSecondary)
                    .lineLimit(2)
                    .fixedSize(horizontal: false, vertical: true)
                if action != nil {
                    Text(actionLabel)
                        .font(theme.font(FaithFormTokens.Text.label))
                        .foregroundStyle(isLive ? theme.palette.live : theme.palette.brandPrimary)
                        .padding(.top, FaithFormTokens.Spacing.xs)
                }
            }
            .padding(FaithFormTokens.Spacing.base)
        }
        .background(theme.palette.surface)
        .clipShape(RoundedRectangle(cornerRadius: FaithFormTokens.Radius.xl, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: FaithFormTokens.Radius.xl, style: .continuous)
                .strokeBorder(theme.palette.border, lineWidth: FaithFormTokens.BorderWidth.hairline)
        )
        .shadow(color: .black.opacity(0.08), radius: 16, y: 6)
    }

    @ViewBuilder
    private var badge: some View {
        if isLive {
            LiveBadge()
        } else {
            Text(stateLabel)
                .font(.system(size: 12, weight: .bold))
                .foregroundStyle(.white)
                .padding(.horizontal, 9)
                .padding(.vertical, 5)
                .background(.black.opacity(0.55), in: RoundedRectangle(cornerRadius: 6, style: .continuous))
        }
    }

    private var stateLabel: String {
        switch live.state {
        case "live": return L.mediaLiveNowBadge
        case "upcoming": return L.mediaLiveUpcoming
        default: return replayId != nil ? L.mediaReplayAvailable : L.mediaLiveEnded
        }
    }

    private var actionLabel: String {
        isLive ? L.mediaWatchLive : L.mediaWatchReplay
    }

    private var subtitle: String {
        switch live.state {
        case "live":
            return "\(L.mediaWatchingLive) · \(live.churchName)"
        case "recent_ended":
            return replayId != nil ? live.churchName : L.mediaLiveEndedBody
        default:
            guard let start = FaithFormInstant.parse(live.startsAt) else { return live.churchName }
            return MediaFormatting.when(start, timezone: live.churchTimezone)
        }
    }
}

/// A gentle press, so a card feels like the button it is.
struct PressScaleStyle: ButtonStyle {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed && !reduceMotion ? 0.98 : 1)
            .animation(.easeOut(duration: 0.12), value: configuration.isPressed)
    }
}

// MARK: - Archive

public struct MediaArchiveList: View {
    @Environment(\.faithformTheme) private var theme
    @Bindable private var model: MediaModel

    private let onOpen: @MainActor (ArchiveItem) -> Void
    private let onWatchLive: @MainActor (LiveMedia) -> Void
    private let onOpenRecording: (@MainActor (String) -> Void)?

    public init(
        model: MediaModel,
        onOpen: @escaping @MainActor (ArchiveItem) -> Void,
        onWatchLive: @escaping @MainActor (LiveMedia) -> Void,
        onOpenRecording: (@MainActor (String) -> Void)? = nil
    ) {
        self.model = model
        self.onOpen = onOpen
        self.onWatchLive = onWatchLive
        self.onOpenRecording = onOpenRecording
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
                    // A recently ended service can be exposed in both places:
                    // the replay hero and the archive endpoint. The hero is
                    // the primary entry point for that recording, so don't
                    // render the same media item a second time below it.
                    let archiveItems = items.filter { item in
                        item.mediaId != live?.replayMediaId
                    }
                    if isStale {
                        OfflineBanner(message: L.offlineCached)
                    }
                    if let live {
                        LiveNowHero(
                            live: live,
                            onWatch: { onWatchLive(live) },
                            onWatchReplay: onOpenRecording
                        )
                    }

                    let searching = !model.searchTerm.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                    if live == nil && archiveItems.isEmpty && !searching {
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

                        if archiveItems.isEmpty {
                            EmptyStateView(
                                title: searching ? L.mediaArchiveEmptySearch : L.mediaArchiveEmpty,
                                explanation: searching ? "" : L.mediaArchiveEmptyBody,
                                symbol: searching ? "magnifyingglass" : "film"
                            )
                        } else {
                            ForEach(archiveItems, id: \.mediaId) { item in
                                Button { onOpen(item) } label: {
                                    ArchiveCard(item: item)
                                }
                                .buttonStyle(PressScaleStyle())
                                .onAppear {
                                    if item.mediaId == archiveItems.last?.mediaId {
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

/// One past service: its thumbnail, then what it is.
struct ArchiveCard: View {
    @Environment(\.faithformTheme) private var theme
    let item: ArchiveItem

    var body: some View {
        VStack(alignment: .leading, spacing: FaithFormTokens.Spacing.sm) {
            StreamThumbnail(url: item.posterUrl)
                .clipShape(RoundedRectangle(cornerRadius: FaithFormTokens.Radius.lg, style: .continuous))
                .overlay(alignment: .bottomTrailing) {
                    if let duration = item.durationSeconds, duration > 0 {
                        Text(PlayerClockFormat.clock(Double(duration)))
                            .font(.system(size: 12, weight: .semibold).monospacedDigit())
                            .foregroundStyle(.white)
                            .padding(.horizontal, 6)
                            .padding(.vertical, 3)
                            .background(.black.opacity(0.72), in: RoundedRectangle(cornerRadius: 5, style: .continuous))
                            .padding(FaithFormTokens.Spacing.sm)
                    }
                }

            VStack(alignment: .leading, spacing: 2) {
                Text(item.title)
                    .font(theme.font(FaithFormTokens.Text.titleMedium))
                    .foregroundStyle(theme.palette.contentPrimary)
                    .lineLimit(2)
                    .multilineTextAlignment(.leading)
                    .fixedSize(horizontal: false, vertical: true)
                Text(metadata)
                    .font(theme.font(FaithFormTokens.Text.bodySmall))
                    .foregroundStyle(theme.palette.contentSecondary)
                    .lineLimit(2)
            }
        }
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(item.title). \(spokenMetadata)")
        .accessibilityAddTraits(.isButton)
    }

    private var metadata: String {
        var parts: [String] = []
        if let recorded = FaithFormInstant.parse(item.recordedAt) {
            parts.append(MediaFormatting.day(recorded, timezone: item.churchTimezone))
        }
        if !item.speakers.isEmpty { parts.append(item.speakers.joined(separator: ", ")) }
        if let series = item.seriesName { parts.append(series) }
        return parts.joined(separator: " · ")
    }

    private var spokenMetadata: String {
        var parts = [metadata]
        if let duration = item.durationSeconds, duration > 0 {
            parts.append(MediaFormatting.duration(seconds: duration))
        }
        return parts.joined(separator: ". ")
    }
}

// MARK: - Detail

/// A past service's details, beneath its player.
///
/// The player itself — play, pause, scrubbing, full screen — is
/// `RecordingStage`, laid above this by the app, so this is only what the
/// service is: title, when, who, and the church's description.
public struct MediaDetailScreen: View {
    @Environment(\.faithformTheme) private var theme
    private let model: MediaDetailModel

    public init(model: MediaDetailModel) {
        self.model = model
    }

    public var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: FaithFormTokens.Spacing.md) {
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
                        .font(theme.font(FaithFormTokens.Text.titleLarge))
                        .foregroundStyle(theme.palette.contentPrimary)
                        .fixedSize(horizontal: false, vertical: true)

                    Text(detailMetadata(detail))
                        .font(theme.font(FaithFormTokens.Text.bodySmall))
                        .foregroundStyle(theme.palette.contentSecondary)

                    if let series = detail.seriesName {
                        Text(series)
                            .font(theme.font(FaithFormTokens.Text.label))
                            .foregroundStyle(theme.palette.brandPrimary)
                            .padding(.horizontal, FaithFormTokens.Spacing.md)
                            .padding(.vertical, 6)
                            .background(theme.palette.brandAccentSoft, in: Capsule())
                    }

                    if let summary = detail.summary, !summary.isEmpty {
                        Text(summary)
                            .font(theme.font(FaithFormTokens.Text.body))
                            .foregroundStyle(theme.palette.contentPrimary)
                            .fixedSize(horizontal: false, vertical: true)
                            .padding(.top, FaithFormTokens.Spacing.xs)
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, FaithFormTokens.Layout.screenPaddingHorizontal)
            .padding(.vertical, FaithFormTokens.Spacing.lg)
        }
        .background(theme.palette.background)
    }

    private func detailMetadata(_ detail: MediaDetail) -> String {
        var parts: [String] = []
        if let recorded = FaithFormInstant.parse(detail.recordedAt) {
            parts.append(MediaFormatting.day(recorded, timezone: detail.churchTimezone))
        }
        if let duration = detail.durationSeconds, duration > 0 {
            parts.append(MediaFormatting.duration(seconds: duration))
        }
        if !detail.speakers.isEmpty { parts.append(detail.speakers.joined(separator: ", ")) }
        parts.append(detail.churchName)
        return parts.joined(separator: " · ")
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

    /// "Sunday, Sep 20", in the church's zone.
    public static func day(_ date: Date, timezone: String) -> String {
        let formatter = DateFormatter()
        formatter.timeZone = TimeZone(identifier: timezone) ?? .current
        formatter.setLocalizedDateFormatFromTemplate("EEEEMMMd")
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

// MARK: - Live service

import AVKit

/// A live service, playing.
///
/// Upright, it looks like every modern video app: the picture across the top,
/// the service beneath it, a close button above. Turn the phone — or tap full
/// screen, which rotates it even with rotation lock on — and the picture fills
/// the screen. Playback starts without a second tap; the model owns that and
/// every retry. Controls fade while it plays and return on a tap, and stay put
/// under VoiceOver.
public struct LivePlayerView: View {
    @Environment(\.faithformTheme) private var theme
    @Environment(\.accessibilityVoiceOverEnabled) private var voiceOverEnabled
    private let model: LivePlayerModel
    private let player: AVPlayer
    private let live: LiveMedia
    private let onClose: @MainActor () -> Void
    private let onOpenPresentation: (@MainActor () -> Void)?

    @State private var controlsVisible = true
    @State private var hideControls: Task<Void, Never>?
    @State private var dragOffset: CGFloat = 0

    public init(
        model: LivePlayerModel,
        player: AVPlayer,
        live: LiveMedia,
        onClose: @escaping @MainActor () -> Void,
        onOpenPresentation: (@MainActor () -> Void)? = nil
    ) {
        self.model = model
        self.player = player
        self.live = live
        self.onClose = onClose
        self.onOpenPresentation = onOpenPresentation
    }

    public var body: some View {
        GeometryReader { geometry in
            let landscape = geometry.size.width > geometry.size.height
            ZStack {
                Color.black.ignoresSafeArea()
                VStack(alignment: .leading, spacing: 0) {
                    if !landscape { portraitHeader }
                    stage(fullScreen: landscape)
                        .frame(height: landscape ? geometry.size.height : geometry.size.width * 9 / 16)
                    if !landscape { portraitDetails }
                }
                .ignoresSafeArea(edges: landscape ? .all : [])
            }
            .statusBarHidden(landscape || !showsControls)
            .persistentSystemOverlays(landscape ? .hidden : .automatic)
        }
        .offset(y: dragOffset)
        .gesture(
            DragGesture(minimumDistance: 24)
                .onChanged { value in dragOffset = max(0, value.translation.height) }
                .onEnded { value in
                    if value.translation.height > 140 {
                        close()
                    } else {
                        withAnimation(theme.animation(FaithFormTokens.Motion.standard)) { dragOffset = 0 }
                    }
                }
        )
        .animation(theme.animation(FaithFormTokens.Motion.standard), value: showsControls)
        .onChange(of: model.phase, initial: true) { _, phase in
            if phase == .playing { scheduleHide() } else { reveal() }
        }
    }

    private var showsControls: Bool {
        controlsVisible || voiceOverEnabled || model.phase != .playing
    }

    // MARK: Portrait

    private var portraitHeader: some View {
        HStack {
            Button(action: close) {
                Image(systemName: "chevron.down")
                    .font(.system(size: 18, weight: .semibold))
                    .frame(width: 44, height: 44)
                    .background(.white.opacity(0.12), in: Circle())
            }
            .foregroundStyle(.white)
            .accessibilityLabel(L.mediaClosePlayer)
            Spacer()
            VideoAirPlayButton()
                .frame(width: 44, height: 44)
        }
        .padding(.horizontal, FaithFormTokens.Spacing.base)
        .padding(.bottom, FaithFormTokens.Spacing.sm)

    }

    private var portraitDetails: some View {
        VStack(alignment: .leading, spacing: 0) {
            VStack(alignment: .leading, spacing: FaithFormTokens.Spacing.sm) {
                HStack(spacing: FaithFormTokens.Spacing.sm) {
                    LiveBadge()
                    Text(L.mediaWatchingLive)
                        .font(theme.font(FaithFormTokens.Text.label))
                        .foregroundStyle(.white.opacity(0.75))
                }
                Text(live.title)
                    .font(theme.font(FaithFormTokens.Text.displayMedium))
                    .foregroundStyle(.white)
                    .fixedSize(horizontal: false, vertical: true)
                if let onOpenPresentation {
                    Button(action: onOpenPresentation) {
                        Label(L.mediaOpenPresentation, systemImage: "rectangle.stack")
                    }
                    .buttonStyle(.bordered).tint(.white)
                }
                Text(live.churchName)
                    .font(theme.font(FaithFormTokens.Text.body))
                    .foregroundStyle(.white.opacity(0.7))
            }
            .padding(.horizontal, FaithFormTokens.Layout.screenPaddingHorizontal)
            .padding(.top, FaithFormTokens.Spacing.lg)

            Spacer(minLength: 0)
        }
    }

    // MARK: Stage

    private func stage(fullScreen: Bool) -> some View {
        ZStack {
            Color.black
            MediaVideoSurface(player: player)
                .accessibilityHidden(true)

            if model.phase == .connecting && live.posterUrl != nil {
                StreamThumbnail(url: live.posterUrl, showsGlyph: false)
                    .overlay(Color.black.opacity(0.35))
            }

            status

            if showsControls && (model.phase == .playing || model.phase == .paused) {
                overlayControls(fullScreen: fullScreen)
                    .transition(.opacity)
            }
        }
        .contentShape(Rectangle())
        .onTapGesture { toggleControls() }
    }

    @ViewBuilder
    private var status: some View {
        switch model.phase {
        case .connecting, .reconnecting:
            VStack(spacing: FaithFormTokens.Spacing.md) {
                VideoLoadingRing()
                Text(model.phase == .connecting ? L.mediaLiveConnecting : L.mediaLiveReconnecting)
                    .font(theme.font(FaithFormTokens.Text.bodySmall))
                    .foregroundStyle(.white.opacity(0.85))
                    .multilineTextAlignment(.center)
                    .frame(width: 240)
            }
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
                    .font(theme.font(FaithFormTokens.Text.bodySmall))
                    .foregroundStyle(.white.opacity(0.8))
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
            }
            HStack(spacing: FaithFormTokens.Spacing.md) {
                if canRetry {
                    Button { Task { await model.retry() } } label: {
                        Label(L.mediaRetry, systemImage: "arrow.clockwise")
                            .font(.system(size: 15, weight: .semibold))
                            .padding(.horizontal, FaithFormTokens.Spacing.base)
                            .padding(.vertical, FaithFormTokens.Spacing.sm)
                            .background(.white, in: Capsule())
                            .foregroundStyle(.black)
                    }
                    .buttonStyle(.plain)
                }
                Button(action: close) {
                    Text(L.mediaClosePlayer)
                        .font(.system(size: 15, weight: .semibold))
                        .padding(.horizontal, FaithFormTokens.Spacing.base)
                        .padding(.vertical, FaithFormTokens.Spacing.sm)
                        .background(.white.opacity(0.16), in: Capsule())
                        .foregroundStyle(.white)
                }
                .buttonStyle(.plain)
            }
        }
        .padding(FaithFormTokens.Spacing.lg)
        .frame(maxWidth: 380)
    }

    private func overlayControls(fullScreen: Bool) -> some View {
        ZStack {
            LinearGradient(
                colors: [.black.opacity(fullScreen ? 0.5 : 0.25), .clear, .clear, .black.opacity(0.45)],
                startPoint: .top,
                endPoint: .bottom
            )
            .allowsHitTesting(false)

            Button {
                Task {
                    if model.phase == .playing { await model.pause() } else { await model.resume() }
                }
                if model.phase == .playing { scheduleHide() }
            } label: {
                Image(systemName: model.phase == .playing ? "pause.fill" : "play.fill")
                    .font(.system(size: fullScreen ? 32 : 26, weight: .semibold))
                    .foregroundStyle(.white)
                    .frame(width: fullScreen ? 76 : 64, height: fullScreen ? 76 : 64)
                    .background(.black.opacity(0.38), in: Circle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(model.phase == .playing ? L.mediaPause : L.mediaPlay)

            VStack {
                if fullScreen {
                    HStack(spacing: FaithFormTokens.Spacing.md) {
                        Button(action: close) {
                            Image(systemName: "xmark")
                                .font(.system(size: 16, weight: .semibold))
                                .frame(width: 40, height: 40)
                                .background(.black.opacity(0.35), in: Circle())
                        }
                        .foregroundStyle(.white)
                        .accessibilityLabel(L.mediaClosePlayer)
                        LiveBadge()
                        Text(live.title)
                            .font(theme.font(FaithFormTokens.Text.titleMedium))
                            .foregroundStyle(.white)
                            .lineLimit(1)
                        Spacer(minLength: 0)
                        VideoAirPlayButton().frame(width: 40, height: 40)
                    }
                    .padding(.horizontal, FaithFormTokens.Spacing.xl)
                    .padding(.top, FaithFormTokens.Spacing.base)
                } else {
                    HStack {
                        LiveBadge(compact: true)
                        Spacer()
                    }
                    .padding(FaithFormTokens.Spacing.md)
                }
                Spacer()
                HStack {
                    if let onOpenPresentation {
                        Button(action: onOpenPresentation) {
                            Image(systemName: "rectangle.stack").frame(width: 44, height: 44)
                        }
                        .foregroundStyle(.white)
                        .accessibilityLabel(L.mediaOpenPresentation)
                    }
                    Spacer()
                    Button {
                        if fullScreen { ScreenOrientation.enterPortrait() } else { ScreenOrientation.enterLandscape() }
                    } label: {
                        Image(systemName: fullScreen
                            ? "arrow.down.right.and.arrow.up.left"
                            : "arrow.up.left.and.arrow.down.right")
                            .font(.system(size: 17, weight: .semibold))
                            .foregroundStyle(.white)
                            .frame(width: 44, height: 44)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(fullScreen ? L.mediaExitFullScreen : L.mediaFullScreen)
                }
                .padding(.horizontal, fullScreen ? FaithFormTokens.Spacing.xl : FaithFormTokens.Spacing.xs)
                .padding(.bottom, fullScreen ? FaithFormTokens.Spacing.base : 0)
            }
        }
    }

    // MARK: Behaviour

    private func close() {
        ScreenOrientation.enterPortrait()
        onClose()
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
#endif
