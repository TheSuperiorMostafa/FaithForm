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
    @Environment(\.faithfulTheme) private var theme
    private let live: LiveMedia
    private let onWatch: @MainActor () -> Void

    public init(live: LiveMedia, onWatch: @escaping @MainActor () -> Void) {
        self.live = live
        self.onWatch = onWatch
    }

    public var body: some View {
        FaithfulCard {
            VStack(alignment: .leading, spacing: FaithfulTokens.Spacing.md) {
                HStack(spacing: FaithfulTokens.Spacing.sm) {
                    if live.state == "live" {
                        // A filled dot, not an animation: reduced motion turns
                        // a pulsing indicator into a distraction someone cannot
                        // switch off.
                        Circle()
                            .fill(theme.palette.brandPrimary)
                            .frame(width: 8, height: 8)
                    }
                    Text(badgeText)
                        .font(theme.font(FaithfulTokens.Text.caption))
                        .foregroundStyle(theme.palette.brandPrimary)
                }

                Text(live.title)
                    .font(theme.font(FaithfulTokens.Text.displayLarge))
                    .foregroundStyle(theme.palette.contentPrimary)
                    .fixedSize(horizontal: false, vertical: true)

                Text(subtitle)
                    .font(theme.font(FaithfulTokens.Text.body))
                    .foregroundStyle(theme.palette.contentSecondary)
                    .fixedSize(horizontal: false, vertical: true)

                if live.state == "live" {
                    Button(L.mediaWatchLive, action: onWatch)
                        .buttonStyle(FaithfulButtonStyle(kind: .primary, theme: theme))
                }
            }
        }
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
            guard let start = FaithfulInstant.parse(live.startsAt) else { return live.churchName }
            return MediaFormatting.when(start, timezone: live.churchTimezone)
        }
    }
}

// MARK: - Archive

public struct MediaArchiveList: View {
    @Environment(\.faithfulTheme) private var theme
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
            VStack(alignment: .leading, spacing: FaithfulTokens.Spacing.lg) {
                switch model.phase {
                case .idle, .loading:
                    ProgressView().accessibilityLabel(L.mediaLoading)

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

                case let .loaded(live, items, _):
                    // The hero exists only when there is something live.
                    if let live { LiveNowHero(live: live) { onWatchLive(live) } }

                    Text(L.mediaArchiveTitle)
                        .font(theme.font(FaithfulTokens.Text.titleMedium))
                        .foregroundStyle(theme.palette.contentPrimary)

                    TextField(L.mediaSearchLabel, text: $model.searchTerm)
                        .textFieldStyle(.roundedBorder)
                        .accessibilityLabel(L.mediaSearchLabel)
                        .onSubmit { Task { await model.search(model.searchTerm) } }

                    if items.isEmpty {
                        Text(
                            model.searchTerm.isEmpty
                                ? L.mediaArchiveEmpty
                                : L.mediaArchiveEmptySearch
                        )
                        .font(theme.font(FaithfulTokens.Text.body))
                        .foregroundStyle(theme.palette.contentSecondary)
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
                            ProgressView().accessibilityLabel(L.mediaLoading)
                        }
                    }
                }
            }
            .padding(.horizontal, FaithfulTokens.Layout.screenPaddingHorizontal)
            .padding(.vertical, FaithfulTokens.Spacing.xl)
        }
        .background(theme.palette.background)
        .task { await model.load() }
        .refreshable { await model.refresh() }
    }
}

/// One recording, poster-first.
struct ArchiveCard: View {
    @Environment(\.faithfulTheme) private var theme
    let item: ArchiveItem

    var body: some View {
        FaithfulCard {
            VStack(alignment: .leading, spacing: FaithfulTokens.Spacing.sm) {
                Text(item.title)
                    .font(theme.font(FaithfulTokens.Text.titleMedium))
                    .foregroundStyle(theme.palette.contentPrimary)
                    .fixedSize(horizontal: false, vertical: true)

                if let series = item.seriesName {
                    Text(series)
                        .font(theme.font(FaithfulTokens.Text.caption))
                        .foregroundStyle(theme.palette.contentSecondary)
                }

                Text(metadata)
                    .font(theme.font(FaithfulTokens.Text.caption))
                    .foregroundStyle(theme.palette.contentSecondary)
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(item.title). \(metadata)")
        .accessibilityAddTraits(.isButton)
    }

    private var metadata: String {
        var parts: [String] = []
        if let recorded = FaithfulInstant.parse(item.recordedAt) {
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
    @Environment(\.faithfulTheme) private var theme
    private let model: MediaDetailModel

    public init(model: MediaDetailModel) {
        self.model = model
    }

    public var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: FaithfulTokens.Spacing.lg) {
                switch model.phase {
                case .loading:
                    ProgressView().accessibilityLabel(L.mediaLoading)

                case .unavailable:
                    MediaMessage(
                        title: L.mediaUnavailableTitle,
                        message: L.mediaUnavailableBody
                    )

                case .offline:
                    MediaMessage(title: L.mediaOfflineTitle, message: L.mediaOfflineBody)

                case .loaded(let detail):
                    Text(detail.title)
                        .font(theme.font(FaithfulTokens.Text.displayLarge))
                        .foregroundStyle(theme.palette.contentPrimary)
                        .fixedSize(horizontal: false, vertical: true)

                    Text(detailMetadata(detail))
                        .font(theme.font(FaithfulTokens.Text.caption))
                        .foregroundStyle(theme.palette.contentSecondary)

                    if let summary = detail.summary, !summary.isEmpty {
                        Text(summary)
                            .font(theme.font(FaithfulTokens.Text.body))
                            .foregroundStyle(theme.palette.contentSecondary)
                            .fixedSize(horizontal: false, vertical: true)
                    }

                    PlaybackControls(model: model)
                }
            }
            .padding(.horizontal, FaithfulTokens.Layout.screenPaddingHorizontal)
            .padding(.vertical, FaithfulTokens.Spacing.xl)
        }
        .background(theme.palette.background)
        .task { await model.load() }
        // The position is saved on the way out, because there may be no later
        // opportunity — iOS can suspend without warning.
        .onDisappear { Task { await model.stop() } }
    }

    private func detailMetadata(_ detail: MediaDetail) -> String {
        var parts: [String] = [detail.churchName]
        if let recorded = FaithfulInstant.parse(detail.recordedAt) {
            parts.append(MediaFormatting.when(recorded, timezone: detail.churchTimezone))
        }
        if let duration = detail.durationSeconds, duration > 0 {
            parts.append(MediaFormatting.duration(seconds: duration))
        }
        return parts.joined(separator: " · ")
    }
}

struct PlaybackControls: View {
    @Environment(\.faithfulTheme) private var theme
    let model: MediaDetailModel

    var body: some View {
        VStack(alignment: .leading, spacing: FaithfulTokens.Spacing.md) {
            if let message = model.failureMessage {
                Text(message)
                    .font(theme.font(FaithfulTokens.Text.body))
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
                .buttonStyle(FaithfulButtonStyle(kind: .primary, theme: theme))

            case .preparing, .buffering:
                HStack(spacing: FaithfulTokens.Spacing.sm) {
                    ProgressView()
                    Text(L.mediaBuffering)
                        .font(theme.font(FaithfulTokens.Text.body))
                        .foregroundStyle(theme.palette.contentSecondary)
                }
                .accessibilityElement(children: .combine)

            case .playing:
                Button(L.mediaPause) { Task { await model.pause() } }
                    .buttonStyle(FaithfulButtonStyle(kind: .primary, theme: theme))

            case .paused:
                Button(L.mediaPlay) { Task { await model.play(kind: .recording) } }
                    .buttonStyle(FaithfulButtonStyle(kind: .primary, theme: theme))
            }
        }
    }
}

// MARK: - Shared

struct MediaMessage: View {
    @Environment(\.faithfulTheme) private var theme
    let title: String
    // Named `message` rather than `body`: `body` is `View`'s own requirement,
    // and a stored property by that name shadows it into a compile error.
    let message: String
    var actionTitle: String? = nil
    var action: (@MainActor () -> Void)? = nil

    var body: some View {
        FaithfulCard {
            VStack(alignment: .leading, spacing: FaithfulTokens.Spacing.md) {
                Text(title)
                    .font(theme.font(FaithfulTokens.Text.titleMedium))
                    .foregroundStyle(theme.palette.contentPrimary)
                    .fixedSize(horizontal: false, vertical: true)

                if !message.isEmpty {
                    Text(message)
                        .font(theme.font(FaithfulTokens.Text.body))
                        .foregroundStyle(theme.palette.contentSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                }

                if let actionTitle, let action {
                    Button(actionTitle, action: action)
                        .buttonStyle(FaithfulButtonStyle(kind: .quiet, theme: theme))
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
