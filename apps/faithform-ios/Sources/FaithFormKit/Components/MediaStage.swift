import SwiftUI

/// The building blocks of the Watch experience: one picture of the service,
/// one way to say "live", one loading state. Every media surface — the Home
/// card, the Services list, the live player, a replay — draws from these, so
/// they look like one product.

// MARK: - Thumbnail

/// A 16:9 picture of the service.
///
/// The frame FaithForm captured from the stream itself when there is one —
/// what a member will actually see when they tap — and otherwise a quiet,
/// branded placeholder rather than a grey box or a broken image.
public struct StreamThumbnail: View {
    @Environment(\.faithformTheme) private var theme
    private let url: String?

    public init(url: String?) {
        self.url = url
    }

    public var body: some View {
        Color.clear
            .aspectRatio(16.0 / 9.0, contentMode: .fit)
            .overlay { placeholder }
            .overlay {
                if let url, let resolved = URL(string: url) {
                    PosterImage(url: resolved) { phase in
                        if case let .success(image) = phase {
                            image.resizable().scaledToFill()
                        } else {
                            // A real view keeps PosterImage's task mounted.
                            // EmptyView never starts the initial image fetch.
                            Color.clear
                        }
                    }
                }
            }
            .clipped()
            .accessibilityHidden(true)
    }

    private var placeholder: some View {
        ZStack {
            LinearGradient(
                colors: [theme.palette.brandPrimary, theme.palette.brandPrimary.opacity(0.78)],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
            RadialGradient(
                colors: [theme.palette.brandAccent.opacity(0.35), .clear],
                center: .topTrailing,
                startRadius: 0,
                endRadius: 260
            )
            Image(systemName: "play.rectangle.fill")
                .font(.system(size: 40, weight: .regular))
                .foregroundStyle(.white.opacity(0.22))
        }
    }
}

// MARK: - Live badge

/// "● LIVE". Always the word as well as the colour, so it reads without colour.
public struct LiveBadge: View {
    @Environment(\.faithformTheme) private var theme
    private let compact: Bool

    public init(compact: Bool = false) {
        self.compact = compact
    }

    public var body: some View {
        HStack(spacing: 5) {
            Circle()
                .fill(.white)
                .frame(width: 6, height: 6)
            Text(L.mediaLiveShort)
                .font(.system(size: compact ? 11 : 12, weight: .heavy))
                .tracking(0.8)
        }
        .foregroundStyle(.white)
        .padding(.horizontal, compact ? 7 : 9)
        .padding(.vertical, compact ? 3 : 5)
        .background(theme.palette.live, in: RoundedRectangle(cornerRadius: 6, style: .continuous))
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(L.mediaLiveNowBadge)
    }
}

// MARK: - Loading and play

/// The one loading state for video: a spinner in a fixed-size ring, centred on
/// the picture. Never a line of text that reflows the layout around it.
public struct VideoLoadingRing: View {
    public init() {}

    public var body: some View {
        ProgressView()
            .progressViewStyle(.circular)
            .controlSize(.large)
            .tint(.white)
            .frame(width: 64, height: 64)
            .background(.black.opacity(0.45), in: Circle())
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(L.mediaLoadingVideo)
    }
}

/// The big round play button laid over a thumbnail.
public struct PlayGlyph: View {
    private let size: CGFloat

    public init(size: CGFloat = 64) {
        self.size = size
    }

    public var body: some View {
        Image(systemName: "play.fill")
            .font(.system(size: size * 0.38, weight: .bold))
            .foregroundStyle(.white)
            .offset(x: size * 0.04)
            .frame(width: size, height: size)
            .background(.ultraThinMaterial.opacity(0.9), in: Circle())
            .overlay(Circle().strokeBorder(.white.opacity(0.35), lineWidth: 1))
            .shadow(color: .black.opacity(0.25), radius: 12, y: 4)
    }
}

/// "12:04" or "1:02:37", for the scrubber. Spoken forms use `MediaFormatting`.
public enum PlayerClockFormat {
    public static func clock(_ seconds: Double) -> String {
        let total = max(0, Int(seconds.rounded(.down)))
        let h = total / 3600
        let m = (total % 3600) / 60
        let s = total % 60
        return h > 0
            ? String(format: "%d:%02d:%02d", h, m, s)
            : String(format: "%d:%02d", m, s)
    }
}

#if os(iOS)
import AVFoundation
import AVKit
import UIKit

// MARK: - Full screen

/// Rotates the app for full-screen video, whatever the phone's rotation lock
/// says — which is what every video app does, and what "Full screen" means to
/// someone holding a phone upright.
@MainActor
public enum ScreenOrientation {
    public static func enterLandscape() { request(.landscapeRight) }
    public static func enterPortrait() { request(.portrait) }

    private static func request(_ mask: UIInterfaceOrientationMask) {
        guard let scene = UIApplication.shared.connectedScenes
            .compactMap({ $0 as? UIWindowScene })
            .first(where: { $0.activationState == .foregroundActive })
        else { return }
        for window in scene.windows {
            window.rootViewController?.setNeedsUpdateOfSupportedInterfaceOrientations()
        }
        scene.requestGeometryUpdate(.iOS(interfaceOrientations: mask)) { _ in }
    }
}

// MARK: - Clock

/// The player's position and length, for the scrubber.
///
/// Observes only. Every command — play, pause, seek — still goes through the
/// playback coordinator, so this cannot start anything.
@MainActor
@Observable
public final class PlayerClock {
    public private(set) var seconds: Double = 0
    public private(set) var duration: Double = 0

    @ObservationIgnored private var token: Any?
    @ObservationIgnored private weak var player: AVPlayer?

    public init() {}

    public func attach(_ player: AVPlayer) {
        detach()
        self.player = player
        token = player.addPeriodicTimeObserver(
            forInterval: CMTime(seconds: 0.25, preferredTimescale: 600),
            queue: .main
        ) { [weak self] time in
            MainActor.assumeIsolated {
                guard let self else { return }
                self.seconds = time.seconds.isFinite ? time.seconds : 0
                let length = self.player?.currentItem?.duration.seconds ?? 0
                self.duration = length.isFinite ? length : 0
            }
        }
    }

    public func detach() {
        if let token, let player { player.removeTimeObserver(token) }
        token = nil
    }
}

// MARK: - Replay stage

/// A past service's player: the picture, and everything laid over it.
///
/// Before the first tap it is the service's thumbnail with a play button.
/// While loading, a centred spinner. While playing, controls that fade after a
/// moment and return on a tap — play and pause, fifteen seconds back and
/// forward, a scrubber with elapsed and remaining time, AirPlay, and full
/// screen. Under VoiceOver the controls never hide.
public struct RecordingStage: View {
    @Environment(\.faithformTheme) private var theme
    @Environment(\.accessibilityVoiceOverEnabled) private var voiceOverEnabled

    private let model: MediaDetailModel
    private let player: AVPlayer
    private let posterUrl: String?
    private let startOffset: Double
    private let knownDuration: Double?
    private let isFullScreen: Bool
    private let onToggleFullScreen: @MainActor () -> Void

    @State private var clock = PlayerClock()
    @State private var controlsVisible = true
    @State private var hideTask: Task<Void, Never>?
    @State private var scrubValue: Double?

    public init(
        model: MediaDetailModel,
        player: AVPlayer,
        posterUrl: String?,
        startOffset: Double,
        knownDuration: Double?,
        isFullScreen: Bool,
        onToggleFullScreen: @escaping @MainActor () -> Void
    ) {
        self.model = model
        self.player = player
        self.posterUrl = posterUrl
        self.startOffset = startOffset
        self.knownDuration = knownDuration
        self.isFullScreen = isFullScreen
        self.onToggleFullScreen = onToggleFullScreen
    }

    public var body: some View {
        ZStack {
            Color.black
            MediaVideoSurface(player: player)
                .accessibilityHidden(true)

            if showsPoster {
                StreamThumbnail(url: posterUrl)
                    .overlay(Color.black.opacity(0.18))
                    .transition(.opacity)
            }

            center

            if showsChrome {
                chrome.transition(.opacity)
            }
        }
        .contentShape(Rectangle())
        .onTapGesture { toggleControls() }
        .animation(theme.animation(FaithFormTokens.Motion.standard), value: showsChrome)
        .animation(theme.animation(FaithFormTokens.Motion.standard), value: showsPoster)
        .onAppear { clock.attach(player) }
        .onDisappear {
            clock.detach()
            hideTask?.cancel()
        }
        .onChange(of: model.playback, initial: true) { _, state in
            if state == .playing { scheduleHide() } else { reveal() }
        }
    }

    // MARK: State

    private var started: Bool {
        switch model.playback {
        case .idle, .ended, .failed: return false
        default: return true
        }
    }

    private var showsPoster: Bool {
        switch model.playback {
        case .idle, .ended: return true
        case .preparing, .buffering: return clock.seconds <= startOffset + 0.1
        case .failed: return clock.seconds <= startOffset + 0.1
        default: return false
        }
    }

    private var showsChrome: Bool {
        guard started else { return false }
        return controlsVisible || voiceOverEnabled || model.playback == .paused
    }

    private var position: Double { max(0, (scrubValue ?? clock.seconds) - (scrubValue == nil ? startOffset : 0)) }

    private var length: Double {
        if let knownDuration, knownDuration > 0 { return knownDuration }
        return max(0, clock.duration - startOffset)
    }

    // MARK: Centre

    @ViewBuilder
    private var center: some View {
        switch model.playback {
        case .idle, .ended:
            Button { Task { await model.play(kind: .recording) } } label: { PlayGlyph(size: isFullScreen ? 80 : 68) }
                .buttonStyle(.plain)
                .accessibilityLabel(L.mediaPlayService)
        case .preparing, .buffering:
            VideoLoadingRing()
        case .failed:
            VStack(spacing: FaithFormTokens.Spacing.md) {
                Text(model.failureMessage ?? L.mediaErrorUnknown)
                    .font(theme.font(FaithFormTokens.Text.bodySmall))
                    .foregroundStyle(.white)
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
                Button { Task { await model.play(kind: .recording) } } label: {
                    Label(L.mediaRetry, systemImage: "arrow.clockwise")
                        .font(.system(size: 15, weight: .semibold))
                        .padding(.horizontal, FaithFormTokens.Spacing.base)
                        .padding(.vertical, FaithFormTokens.Spacing.sm)
                        .background(.white, in: Capsule())
                        .foregroundStyle(.black)
                }
                .buttonStyle(.plain)
            }
            .padding(FaithFormTokens.Spacing.lg)
            .frame(maxWidth: 360)
        case .playing, .paused:
            if showsChrome {
                HStack(spacing: isFullScreen ? 56 : 40) {
                    roundButton("gobackward.15", size: 44, label: L.mediaSkipBack) {
                        Task { await model.seek(to: max(0, position - 15)) }
                    }
                    roundButton(
                        model.playback == .playing ? "pause.fill" : "play.fill",
                        size: isFullScreen ? 76 : 64,
                        label: model.playback == .playing ? L.mediaPause : L.mediaPlay
                    ) {
                        Task {
                            if model.playback == .playing { await model.pause() } else { await model.resume() }
                        }
                    }
                    roundButton("goforward.15", size: 44, label: L.mediaSkipForward) {
                        Task { await model.seek(to: min(length, position + 15)) }
                    }
                }
                .transition(.opacity)
            }
        }
    }

    private func roundButton(
        _ symbol: String,
        size: CGFloat,
        label: String,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: {
            action()
            if model.playback == .playing { scheduleHide() }
        }) {
            Image(systemName: symbol)
                .font(.system(size: size * 0.42, weight: .semibold))
                .foregroundStyle(.white)
                .frame(width: size, height: size)
                .background(.black.opacity(0.38), in: Circle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(label)
    }

    // MARK: Chrome

    private var chrome: some View {
        VStack(spacing: 0) {
            Spacer(minLength: 0)
            VStack(spacing: 2) {
                Slider(
                    value: Binding(
                        get: { min(position, max(length, 1)) },
                        set: { scrubValue = $0 }
                    ),
                    in: 0...max(length, 1),
                    onEditingChanged: { editing in
                        if editing {
                            hideTask?.cancel()
                        } else if let target = scrubValue {
                            Task {
                                await model.seek(to: target)
                                scrubValue = nil
                            }
                            scheduleHide()
                        }
                    }
                )
                .tint(theme.palette.brandAccent)
                .accessibilityLabel(L.mediaPlaybackPosition)
                .accessibilityValue(
                    "\(MediaFormatting.duration(seconds: Int(position))) / \(MediaFormatting.duration(seconds: Int(length)))"
                )

                HStack(spacing: FaithFormTokens.Spacing.md) {
                    Text(PlayerClockFormat.clock(position))
                    Text("/")
                        .foregroundStyle(.white.opacity(0.5))
                    Text(PlayerClockFormat.clock(length))
                        .foregroundStyle(.white.opacity(0.75))
                    Spacer(minLength: 0)
                    VideoAirPlayButton()
                        .frame(width: 36, height: 36)
                    Button(action: onToggleFullScreen) {
                        Image(systemName: isFullScreen
                            ? "arrow.down.right.and.arrow.up.left"
                            : "arrow.up.left.and.arrow.down.right")
                            .font(.system(size: 17, weight: .semibold))
                            .frame(width: 40, height: 40)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(isFullScreen ? L.mediaExitFullScreen : L.mediaFullScreen)
                }
                .font(.system(size: 13, weight: .semibold).monospacedDigit())
                .foregroundStyle(.white)
                .accessibilityElement(children: .contain)
            }
            .padding(.horizontal, isFullScreen ? FaithFormTokens.Spacing.xl : FaithFormTokens.Spacing.md)
            .padding(.bottom, isFullScreen ? FaithFormTokens.Spacing.base : FaithFormTokens.Spacing.xs)
            .background(
                LinearGradient(colors: [.clear, .black.opacity(0.65)], startPoint: .top, endPoint: .bottom)
                    .allowsHitTesting(false)
            )
        }
    }

    // MARK: Controls visibility

    private func toggleControls() {
        guard started else { return }
        if controlsVisible {
            hideTask?.cancel()
            controlsVisible = false
        } else {
            reveal()
            if model.playback == .playing { scheduleHide() }
        }
    }

    private func reveal() {
        hideTask?.cancel()
        controlsVisible = true
    }

    private func scheduleHide() {
        hideTask?.cancel()
        hideTask = Task {
            try? await Task.sleep(for: .seconds(3))
            guard !Task.isCancelled else { return }
            controlsVisible = false
        }
    }
}

/// The system route picker, so a service can go to the living-room TV.
public struct VideoAirPlayButton: UIViewRepresentable {
    public init() {}

    public func makeUIView(context: Context) -> AVRoutePickerView {
        let view = AVRoutePickerView()
        view.tintColor = .white
        view.activeTintColor = .systemBlue
        view.prioritizesVideoDevices = true
        return view
    }

    public func updateUIView(_ uiView: AVRoutePickerView, context: Context) {}
}
#endif
