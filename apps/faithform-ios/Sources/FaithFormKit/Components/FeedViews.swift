import SwiftUI

/// A banner-first announcement card.
///
/// The church's banner leads, uncropped at the 1200 × 630 it is generated at:
/// the title and date are part of the artwork, so trimming its edges trims the
/// words. Nothing is laid over it except two small glass chips in its corners.
/// The title, time and place sit below on a solid surface — readable at any
/// contrast setting — beside a tear-off date tile that says when at a glance.
public struct AnnouncementCard: View {
    @Environment(\.faithformTheme) private var theme
    private let item: FeedItem
    private let now: Date
    private let onOpen: @MainActor () -> Void
    @State private var opens = 0

    public init(item: FeedItem, now: Date = Date(), onOpen: @escaping @MainActor () -> Void) {
        self.item = item
        self.now = now
        self.onOpen = onOpen
    }

    public var body: some View {
        let shape = RoundedRectangle(cornerRadius: FaithFormTokens.Radius.xl, style: .continuous)

        Button {
            opens += 1
            onOpen()
        } label: {
            VStack(alignment: .leading, spacing: 0) {
                AnnouncementBanner(item: item, moment: moment)
                details
            }
            .background(theme.palette.surface)
            .clipShape(shape)
            .overlay(shape.strokeBorder(theme.palette.border, lineWidth: FaithFormTokens.BorderWidth.hairline))
            .shadow(
                color: theme.usesDecorativeShadow
                    ? theme.palette.brandPrimary.opacity(FaithFormTokens.Elevation.card.opacity)
                    : .clear,
                radius: FaithFormTokens.Elevation.card.blur,
                y: FaithFormTokens.Elevation.card.y
            )
            .modifier(AnnouncementTransitionSource(id: item.id))
        }
        .buttonStyle(PressableCardStyle(reduceMotion: theme.reduceMotion))
        #if os(iOS)
        .sensoryFeedback(.impact(weight: .light), trigger: opens)
        #endif
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(accessibilityDescription))
    }

    private var moment: AnnouncementMoment {
        AnnouncementTiming.moment(of: item, now: now)
    }

    private var details: some View {
        HStack(alignment: .top, spacing: FaithFormTokens.Spacing.md) {
            if let tile = FeedFormatting.tile(item) {
                AnnouncementDateTile(month: tile.month, day: tile.day)
            }

            VStack(alignment: .leading, spacing: FaithFormTokens.Spacing.sm) {
                Text(item.title)
                    .font(theme.font(FaithFormTokens.Text.titleLarge))
                    .foregroundStyle(theme.palette.contentPrimary)
                    .multilineTextAlignment(.leading)
                    .lineLimit(2)

                VStack(alignment: .leading, spacing: FaithFormTokens.Spacing.xs) {
                    AnnouncementMetaRow(symbol: "clock", text: FeedFormatting.timeLine(item))
                    if let location = item.location, !location.isEmpty {
                        AnnouncementMetaRow(symbol: "mappin.and.ellipse", text: location)
                    }
                }

                if !item.body.isEmpty {
                    Text(item.body)
                        .font(theme.font(FaithFormTokens.Text.bodySmall))
                        .foregroundStyle(theme.palette.contentSecondary)
                        .multilineTextAlignment(.leading)
                        .lineLimit(2)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(FaithFormTokens.Spacing.base)
    }

    private var accessibilityDescription: String {
        [
            FeedFormatting.momentLabel(moment),
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

public enum AnnouncementArtwork {
    /// Announcement graphics are generated at 1200 × 630.
    public static let aspectRatio: CGFloat = 1200.0 / 630.0
}

/// The banner across the top of a card, at the shape it was made.
struct AnnouncementBanner: View {
    @Environment(\.faithformTheme) private var theme
    let item: FeedItem
    let moment: AnnouncementMoment

    var body: some View {
        Color.clear
            .aspectRatio(AnnouncementArtwork.aspectRatio, contentMode: .fit)
            .frame(maxWidth: .infinity)
            .overlay { artwork }
            .clipped()
            .overlay(alignment: .top) { badges }
    }

    @ViewBuilder
    private var artwork: some View {
        if let url = item.posterUrl.flatMap(URL.init(string:)) {
            PosterImage(url: url) { phase in
                switch phase {
                case let .success(image):
                    image
                        .resizable()
                        .scaledToFill()
                case .failure:
                    // A banner that will not load falls back to the designed
                    // placeholder rather than a broken box.
                    AnnouncementPlaceholderArt(item: item)
                case .loading:
                    Rectangle()
                        .fill(theme.palette.skeletonBase)
                        .skeletonShimmer()
                }
            }
        } else {
            AnnouncementPlaceholderArt(item: item)
        }
    }

    private var badges: some View {
        HStack(alignment: .top) {
            if let label = FeedFormatting.momentLabel(moment) {
                AnnouncementGlassChip(
                    text: label,
                    dot: moment == .happeningNow ? theme.palette.live : theme.palette.brandAccent
                )
            }
            Spacer(minLength: 0)
            if item.isPinned {
                AnnouncementGlassPin()
            }
        }
        .padding(FaithFormTokens.Spacing.md)
    }
}

/// Stands in for a banner when an announcement has none, so every card keeps
/// the same rhythm: the brand's gradient, a soft glow, and one glyph.
public struct AnnouncementPlaceholderArt: View {
    @Environment(\.faithformTheme) private var theme
    @Environment(\.colorScheme) private var colorScheme
    private let item: FeedItem
    private let glyphSize: CGFloat?

    /// - Parameter glyphSize: nil draws the colour alone, for use as a backdrop.
    public init(item: FeedItem, glyphSize: CGFloat? = 28) {
        self.item = item
        self.glyphSize = glyphSize
    }

    public var body: some View {
        ZStack {
            LinearGradient(colors: baseColors, startPoint: .topLeading, endPoint: .bottomTrailing)

            GeometryReader { geo in
                Circle()
                    .fill(theme.palette.brandAccent.opacity(0.55))
                    .frame(width: geo.size.width * 0.7, height: geo.size.width * 0.7)
                    .blur(radius: geo.size.width * 0.16)
                    .position(x: geo.size.width * 0.95, y: 0)
                Circle()
                    .fill(Color.white.opacity(0.12))
                    .frame(width: geo.size.width * 0.5, height: geo.size.width * 0.5)
                    .blur(radius: geo.size.width * 0.12)
                    .position(x: geo.size.width * 0.05, y: geo.size.height)
            }

            if let glyphSize {
                Image(systemName: item.isEvent ? "calendar" : "megaphone.fill")
                    .font(.system(size: glyphSize, weight: .semibold))
                    .foregroundStyle(.white)
                    .padding(glyphSize * 0.7)
                    .background(Circle().fill(Color.white.opacity(0.14)))
                    .overlay(Circle().strokeBorder(Color.white.opacity(0.28), lineWidth: 1))
            }
        }
        .clipped()
        .accessibilityHidden(true)
    }

    private var baseColors: [Color] {
        // The dark palette's primary is gold, and a gold-on-gold gradient reads
        // as a flat block; dark mode builds from its own surfaces instead.
        colorScheme == .dark
            ? [theme.palette.surfaceRaised, theme.palette.surfaceSunken]
            : [theme.palette.brandPrimary, theme.palette.brandPrimary.opacity(0.82)]
    }
}

/// "SEP" over "20", like a page torn from a desk calendar.
struct AnnouncementDateTile: View {
    @Environment(\.faithformTheme) private var theme
    let month: String
    let day: String

    private static let monthRole = FaithFormTokens.TextRole(
        size: 11, lineHeight: 14, weight: .bold, tracking: 0.8, isDisplay: true
    )
    private static let dayRole = FaithFormTokens.TextRole(
        size: 24, lineHeight: 28, weight: .bold, tracking: -0.3, isDisplay: true
    )

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: FaithFormTokens.Radius.md, style: .continuous)

        VStack(spacing: 0) {
            Text(month)
                .font(theme.font(Self.monthRole))
                .tracking(Self.monthRole.tracking)
                .foregroundStyle(theme.palette.contentOnAccent)
                .lineLimit(1)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 3)
                .background(theme.palette.brandAccent)
            Text(day)
                .font(theme.font(Self.dayRole))
                .foregroundStyle(theme.palette.contentPrimary)
                .lineLimit(1)
                .frame(maxWidth: .infinity)
                .padding(.vertical, FaithFormTokens.Spacing.xs + 2)
        }
        .frame(width: 52)
        .background(theme.palette.surfaceRaised)
        .clipShape(shape)
        .overlay(shape.strokeBorder(theme.palette.border, lineWidth: FaithFormTokens.BorderWidth.hairline))
        // The card's own label already says the date in full.
        .accessibilityHidden(true)
    }
}

/// One line of "when" or "where" under a card's title.
struct AnnouncementMetaRow: View {
    @Environment(\.faithformTheme) private var theme
    /// Grows with the glyph, so a large text size cannot push the icon into
    /// the words beside it.
    @ScaledMetric(relativeTo: .footnote) private var iconWidth: CGFloat = FaithFormTokens.IconSize.sizeSmall
    let symbol: String
    let text: String

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 6) {
            Image(systemName: symbol)
                .font(.footnote.weight(.semibold))
                .foregroundStyle(theme.palette.brandAccent)
                .frame(width: iconWidth)
                .accessibilityHidden(true)
            Text(text)
                .font(theme.font(FaithFormTokens.Text.bodySmall))
                .foregroundStyle(theme.palette.contentSecondary)
                .lineLimit(1)
        }
    }
}

/// A small frosted label over artwork. Dark glass whatever the artwork, so
/// white type on it stays readable on a pale banner as well as a dark one.
struct AnnouncementGlassChip: View {
    @Environment(\.faithformTheme) private var theme
    let text: String
    let dot: Color

    var body: some View {
        HStack(spacing: 6) {
            // A filled dot, not a pulse: an animation someone cannot switch off
            // is a distraction under Reduce Motion.
            Circle()
                .fill(dot)
                .frame(width: 7, height: 7)
            Text(text)
                .font(theme.font(FaithFormTokens.Text.label))
                .foregroundStyle(.white)
                .lineLimit(1)
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 5)
        .background(.ultraThinMaterial, in: Capsule())
        .overlay(Capsule().strokeBorder(Color.white.opacity(0.18), lineWidth: 0.5))
        .environment(\.colorScheme, .dark)
    }
}

struct AnnouncementGlassPin: View {
    var body: some View {
        Image(systemName: "pin.fill")
            .font(.footnote.weight(.bold))
            .foregroundStyle(.white)
            .rotationEffect(.degrees(45))
            .frame(width: 30, height: 30)
            .background(.ultraThinMaterial, in: Circle())
            .overlay(Circle().strokeBorder(Color.white.opacity(0.18), lineWidth: 0.5))
            .environment(\.colorScheme, .dark)
            .accessibilityHidden(true)
    }
}

/// Sinks a little under the finger. Reduce Motion keeps the dim and drops the
/// movement.
struct PressableCardStyle: ButtonStyle {
    let reduceMotion: Bool

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed && !reduceMotion ? 0.97 : 1)
            .opacity(configuration.isPressed ? 0.92 : 1)
            .animation(
                reduceMotion
                    ? .easeOut(duration: FaithFormTokens.Motion.reducedMotionDuration)
                    : .spring(response: 0.3, dampingFraction: 0.7),
                value: configuration.isPressed
            )
    }
}

// MARK: - Zoom into the detail

private struct AnnouncementTransitionNamespaceKey: EnvironmentKey {
    static var defaultValue: Namespace.ID? { nil }
}

extension EnvironmentValues {
    /// Set by the screen that pushes an announcement, so a card can zoom into
    /// the detail it opens (iOS 18 and later; a plain push before that).
    public var announcementTransitionNamespace: Namespace.ID? {
        get { self[AnnouncementTransitionNamespaceKey.self] }
        set { self[AnnouncementTransitionNamespaceKey.self] = newValue }
    }
}

struct AnnouncementTransitionSource: ViewModifier {
    @Environment(\.announcementTransitionNamespace) private var namespace
    let id: String

    func body(content: Content) -> some View {
        if let namespace {
            if #available(iOS 18.0, macOS 15.0, *) {
                content.matchedTransitionSource(id: id, in: namespace)
            } else {
                content
            }
        } else {
            content
        }
    }
}

// MARK: - Formatting

/// Date and time rendering.
///
/// Always in the *church's* timezone, never the device's: "Sunday at 10" means
/// the church's Sunday, and someone travelling must not see it shifted.
public enum FeedFormatting {
    public static func whenLine(_ item: FeedItem) -> String {
        guard let start = FaithFormInstant.parse(item.startAt) else {
            return ""
        }
        let zone = TimeZone(identifier: item.churchTimezone) ?? .current

        let formatter = DateFormatter()
        formatter.timeZone = zone
        if item.allDay {
            // Stored as midnight UTC on the date, so read in UTC — in the
            // church's zone it was the evening before.
            formatter.timeZone = AnnouncementTiming.dateZone(of: item)
            formatter.dateFormat = "EEEE d MMMM"
            return formatter.string(from: start)
        }
        formatter.dateFormat = "EEEE d MMMM, h:mm a"
        let startText = formatter.string(from: start)

        guard
            item.isEvent,
            let endRaw = item.endAt,
            let end = FaithFormInstant.parse(endRaw)
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
public enum FaithFormInstant {
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

// MARK: - The feed

/// The Home feed: pinned first, then today, the rest of the week, and later.
public struct HomeFeedView: View {
    @Environment(\.faithformTheme) private var theme
    private let model: FeedModel
    private let churchName: String
    private let churchSlug: String
    private let isJoinPending: Bool
    private let onOpenItem: @MainActor (FeedItem) -> Void
    private let onRefresh: (@MainActor @Sendable () async -> Void)?

    /// - Parameter onRefresh: anything else a pull-down should bring up to
    ///   date — on Home, whether the church has gone live since.
    public init(
        model: FeedModel,
        churchName: String,
        churchSlug: String,
        isJoinPending: Bool = false,
        onOpenItem: @escaping @MainActor (FeedItem) -> Void,
        onRefresh: (@MainActor @Sendable () async -> Void)? = nil
    ) {
        self.model = model
        self.churchName = churchName
        self.churchSlug = churchSlug
        self.isJoinPending = isJoinPending
        self.onOpenItem = onOpenItem
        self.onRefresh = onRefresh
    }

    public var body: some View {
        ScrollView {
            // Lazy, so a banner is only fetched as its card comes near the
            // screen, and the last card appearing really means the reader got
            // there — which is what asks for the next page.
            LazyVStack(alignment: .leading, spacing: 0) {
                if isJoinPending {
                    JoinPendingBanner()
                        .padding(.bottom, FaithFormTokens.Spacing.lg)
                }
                content
            }
            .padding(.horizontal, FaithFormTokens.Layout.screenPaddingHorizontal)
            .padding(.vertical, FaithFormTokens.Spacing.base)
            .frame(maxWidth: FaithFormTokens.Layout.contentMaxWidth)
        }
        .background(theme.palette.background)
        .refreshable {
            async let feed: Void = model.refresh(churchSlug: churchSlug)
            await onRefresh?()
            await feed
        }
    }

    @ViewBuilder
    private var content: some View {
        switch model.phase {
        case .loading:
            FeedSkeleton()

        case let .loaded(items, isStale):
            if isStale {
                OfflineBanner(message: L.offlineCached)
                    .padding(.bottom, FaithFormTokens.Spacing.lg)
            }
            let now = Date()
            let rows = FeedRow.rows(for: AnnouncementTiming.sections(items, now: now))
            ForEach(rows) { row in
                switch row {
                case let .header(section, isFirst):
                    FeedSectionHeader(title: section.title)
                        .padding(.top, isFirst ? 0 : FaithFormTokens.Spacing.sm)
                        .padding(.bottom, FaithFormTokens.Spacing.md)
                case let .item(item):
                    AnnouncementCard(item: item, now: now) { onOpenItem(item) }
                        .padding(.bottom, FaithFormTokens.Spacing.lg)
                        .onAppear {
                            // Cursor pagination triggered by the last row appearing.
                            if item.id == items.last?.id {
                                Task { await model.loadMore(churchSlug: churchSlug) }
                            }
                        }
                }
            }

        case .empty:
            EmptyStateView(title: L.emptyFeedTitle, explanation: L.emptyFeedBody, symbol: "tray")

        case .offlineNoCache:
            EmptyStateView(title: L.offlineTitle, explanation: L.offlineBody, symbol: "wifi.slash")

        case .blocked:
            EmptyStateView(title: L.blockedTitle, explanation: L.blockedBody, symbol: "hand.raised")

        case let .failed(message):
            EmptyStateView(title: L.errorTitle, explanation: message, symbol: "exclamationmark.triangle")
        }
    }
}

/// The feed flattened into one lazy list: a header, its cards, the next header.
private enum FeedRow: Identifiable {
    case header(FeedSection, isFirst: Bool)
    case item(FeedItem)

    var id: String {
        switch self {
        case let .header(section, _): return "section-\(section.rawValue)"
        case let .item(item): return item.id
        }
    }

    static func rows(for groups: [FeedSectionGroup]) -> [FeedRow] {
        groups.enumerated().flatMap { index, group in
            [FeedRow.header(group.section, isFirst: index == 0)] + group.items.map(FeedRow.item)
        }
    }
}

struct FeedSectionHeader: View {
    @Environment(\.faithformTheme) private var theme
    let title: String

    var body: some View {
        Text(title)
            .font(theme.font(FaithFormTokens.Text.label))
            .tracking(1.0)
            .textCase(.uppercase)
            .foregroundStyle(theme.mutedContent)
            .frame(maxWidth: .infinity, alignment: .leading)
            .accessibilityAddTraits(.isHeader)
    }
}

/// Why notifications are worth allowing, before the OS is allowed to ask.
public struct NotificationEducationView: View {
    @Environment(\.faithformTheme) private var theme
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
        VStack(alignment: .leading, spacing: FaithFormTokens.Spacing.lg) {
            Text(L.notificationEducationTitle)
                .font(theme.font(FaithFormTokens.Text.displayMedium))
                .foregroundStyle(theme.palette.contentPrimary)
            Text(L.notificationEducationBody)
                .font(theme.font(FaithFormTokens.Text.body))
                .foregroundStyle(theme.palette.contentSecondary)
                .fixedSize(horizontal: false, vertical: true)

            Spacer()

            Button(L.notificationEnable, action: onEnable)
                .buttonStyle(FaithFormButtonStyle(kind: .primary, theme: theme))
            Button(L.notificationSkip, action: onSkip)
                .buttonStyle(FaithFormButtonStyle(kind: .quiet, theme: theme))
        }
        .padding(FaithFormTokens.Layout.screenPaddingHorizontal)
        .background(theme.palette.background)
    }
}
