import SwiftUI

/// A poster-first announcement card.
///
/// Artwork is given room and left alone: no scrim across the whole image, no
/// text laid over the subject. Where a caption is needed it sits *below* the
/// poster on a solid surface, which keeps it readable at any contrast setting
/// and means the artwork is never obscured to make type legible.
public struct AnnouncementCard: View {
    @Environment(\.faithfulTheme) private var theme
    private let item: FeedItem
    private let onOpen: @MainActor () -> Void

    public init(item: FeedItem, onOpen: @escaping @MainActor () -> Void) {
        self.item = item
        self.onOpen = onOpen
    }

    public var body: some View {
        Button(action: onOpen) {
            VStack(alignment: .leading, spacing: 0) {
                if let poster = item.posterUrl, let url = URL(string: poster) {
                    posterImage(url)
                }
                textBlock
            }
            .background(
                RoundedRectangle(cornerRadius: FaithfulTokens.Radius.lg, style: .continuous)
                    .fill(theme.palette.surface)
            )
            .overlay(
                RoundedRectangle(cornerRadius: FaithfulTokens.Radius.lg, style: .continuous)
                    .strokeBorder(theme.palette.border, lineWidth: FaithfulTokens.BorderWidth.hairline)
            )
            .clipShape(RoundedRectangle(cornerRadius: FaithfulTokens.Radius.lg, style: .continuous))
            .shadow(
                color: theme.usesDecorativeShadow
                    ? theme.palette.brandPrimary.opacity(FaithfulTokens.Elevation.card.opacity)
                    : .clear,
                radius: FaithfulTokens.Elevation.card.blur,
                y: FaithfulTokens.Elevation.card.y
            )
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(accessibilityDescription))
    }

    private func posterImage(_ url: URL) -> some View {
        AsyncImage(url: url) { phase in
            switch phase {
            case let .success(image):
                image
                    .resizable()
                    // Fill the frame and crop, rather than letterboxing: a
                    // poster with bars around it looks like a mistake.
                    .aspectRatio(contentMode: .fill)
            case .failure:
                // A failed image falls back to the text-only treatment rather
                // than leaving a broken box.
                Color.clear
            default:
                Rectangle().fill(theme.palette.skeletonBase)
            }
        }
        .frame(maxWidth: .infinity)
        .aspectRatio(16.0 / 9.0, contentMode: .fit)
        .clipped()
        // The alt text is the image's accessible description; without one the
        // image is decorative rather than mislabelled.
        .accessibilityLabel(Text(item.posterAltText ?? ""))
        .accessibilityHidden(item.posterAltText == nil)
    }

    private var textBlock: some View {
        VStack(alignment: .leading, spacing: FaithfulTokens.Spacing.xs) {
            if item.isPinned {
                StatusChip(L.pinnedLabel, tone: .live)
            }
            Text(item.title)
                .font(theme.font(FaithfulTokens.Text.titleLarge))
                .foregroundStyle(theme.palette.contentPrimary)
                .multilineTextAlignment(.leading)

            Text(FeedFormatting.whenLine(item))
                .font(theme.font(FaithfulTokens.Text.label))
                .foregroundStyle(theme.palette.brandAccent)

            if !item.body.isEmpty {
                Text(item.body)
                    .font(theme.font(FaithfulTokens.Text.bodySmall))
                    .foregroundStyle(theme.palette.contentSecondary)
                    .lineLimit(3)
            }

            if let location = item.location, !location.isEmpty {
                Text(location)
                    .font(theme.font(FaithfulTokens.Text.caption))
                    .foregroundStyle(theme.mutedContent)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(FaithfulTokens.Spacing.base)
    }

    private var accessibilityDescription: String {
        [
            item.isPinned ? L.pinnedLabel : nil,
            item.title,
            FeedFormatting.whenLine(item),
            item.location,
            item.posterAltText,
        ]
        .compactMap { $0 }
        .filter { !$0.isEmpty }
        .joined(separator: ", ")
    }
}

/// Date and time rendering.
///
/// Always in the *church's* timezone, never the device's: "Sunday at 10" means
/// the church's Sunday, and someone travelling must not see it shifted.
public enum FeedFormatting {
    public static func whenLine(_ item: FeedItem) -> String {
        guard let start = FaithfulInstant.parse(item.startAt) else {
            return ""
        }
        let zone = TimeZone(identifier: item.churchTimezone) ?? .current

        let formatter = DateFormatter()
        formatter.timeZone = zone
        formatter.dateFormat = "EEEE d MMMM, h:mm a"
        let startText = formatter.string(from: start)

        guard
            item.isEvent,
            let endRaw = item.endAt,
            let end = FaithfulInstant.parse(endRaw)
        else {
            return startText
        }

        let endFormatter = DateFormatter()
        endFormatter.timeZone = zone
        // Same day shows a time range; a multi-day event shows both dates.
        endFormatter.dateFormat = Calendar.current.isDate(start, inSameDayAs: end)
            ? "h:mm a"
            : "EEEE d MMMM, h:mm a"

        return "\(startText) – \(endFormatter.string(from: end))"
    }
}

/// Parses the contract's RFC 3339 instants.
///
/// Constructed per call rather than shared: `ISO8601DateFormatter` is not
/// `Sendable`, and a shared mutable one is exactly the kind of latent data race
/// Swift 6 exists to catch.
///
/// Both forms are accepted because the server may or may not include fractional
/// seconds, and a client that rejected one of them would silently drop items.
public enum FaithfulInstant {
    public static func parse(_ value: String) -> Date? {
        let withFraction = ISO8601DateFormatter()
        withFraction.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = withFraction.date(from: value) { return date }

        let plain = ISO8601DateFormatter()
        plain.formatOptions = [.withInternetDateTime]
        return plain.date(from: value)
    }

    /// The inverse. Used by tests to build a server-shaped instant, and by
    /// nothing in production — the app reads instants, it does not mint them.
    public static func format(_ date: Date) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        return formatter.string(from: date)
    }
}

/// The Home feed.
public struct HomeFeedView: View {
    @Environment(\.faithfulTheme) private var theme
    private let model: FeedModel
    private let churchName: String
    private let churchSlug: String
    private let onOpenItem: @MainActor (FeedItem) -> Void

    public init(
        model: FeedModel,
        churchName: String,
        churchSlug: String,
        onOpenItem: @escaping @MainActor (FeedItem) -> Void
    ) {
        self.model = model
        self.churchName = churchName
        self.churchSlug = churchSlug
        self.onOpenItem = onOpenItem
    }

    public var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: FaithfulTokens.Spacing.lg) {
                header
                content
            }
            .padding(.horizontal, FaithfulTokens.Layout.screenPaddingHorizontal)
            .padding(.vertical, FaithfulTokens.Spacing.base)
            .frame(maxWidth: FaithfulTokens.Layout.contentMaxWidth)
        }
        .background(theme.palette.background)
        .refreshable { await model.refresh(churchSlug: churchSlug) }
        .navigationTitle(L.homeTitle)
    }

    private var header: some View {
        Text(churchName)
            .font(theme.font(FaithfulTokens.Text.displayMedium))
            .foregroundStyle(theme.palette.contentPrimary)
    }

    @ViewBuilder
    private var content: some View {
        switch model.phase {
        case .loading:
            ForEach(0..<2, id: \.self) { _ in SkeletonCard() }

        case let .loaded(items, isStale):
            if isStale {
                OfflineBanner(message: L.offlineCached)
            }
            ForEach(items, id: \.id) { item in
                AnnouncementCard(item: item) { onOpenItem(item) }
                    .onAppear {
                        // Cursor pagination triggered by the last row appearing.
                        if item.id == items.last?.id {
                            Task { await model.loadMore(churchSlug: churchSlug) }
                        }
                    }
            }

        case .empty:
            EmptyStateView(title: L.emptyFeedTitle, explanation: L.emptyFeedBody)

        case .offlineNoCache:
            EmptyStateView(title: L.offlineTitle, explanation: L.offlineBody)

        case .blocked:
            EmptyStateView(title: L.blockedTitle, explanation: L.blockedBody)

        case let .failed(message):
            EmptyStateView(title: L.errorTitle, explanation: message)
        }
    }
}

/// Why notifications are worth allowing, before the OS is allowed to ask.
public struct NotificationEducationView: View {
    @Environment(\.faithfulTheme) private var theme
    private let onEnable: @MainActor () -> Void
    private let onSkip: @MainActor () -> Void

    public init(
        onEnable: @escaping @MainActor () -> Void,
        onSkip: @escaping @MainActor () -> Void
    ) {
        self.onEnable = onEnable
        self.onSkip = onSkip
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: FaithfulTokens.Spacing.lg) {
            Text(L.notificationEducationTitle)
                .font(theme.font(FaithfulTokens.Text.displayMedium))
                .foregroundStyle(theme.palette.contentPrimary)
            Text(L.notificationEducationBody)
                .font(theme.font(FaithfulTokens.Text.body))
                .foregroundStyle(theme.palette.contentSecondary)
                .fixedSize(horizontal: false, vertical: true)

            Spacer()

            Button(L.notificationEnable, action: onEnable)
                .buttonStyle(FaithfulButtonStyle(kind: .primary, theme: theme))
            Button(L.notificationSkip, action: onSkip)
                .buttonStyle(FaithfulButtonStyle(kind: .quiet, theme: theme))
        }
        .padding(FaithfulTokens.Layout.screenPaddingHorizontal)
        .background(theme.palette.background)
    }
}
