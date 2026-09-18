import SwiftUI
import EventKit
import EventKitUI
import FaithFormKit

/// An announcement or event, in full.
///
/// The banner is shown whole — its title and date are part of the artwork —
/// with a blurred glow of its own colours behind it. Below it come the two
/// things someone opens an announcement to learn, when and where, then a way
/// to keep it, then the rest of what the church wrote. Times are in the
/// church's zone, never the phone's.
struct AnnouncementDetailView: View {
    @Environment(\.faithformTheme) private var theme
    @Environment(\.openURL) private var openURL
    let item: FeedItem

    @State private var isAddingToCalendar = false
    /// Once the banner has scrolled up under the navigation bar, the bar
    /// takes its normal background and the title, so nothing scrolls under a
    /// bare back button.
    @State private var heroIsUnderBar = false

    var body: some View {
        GeometryReader { outer in
            let barBottom = outer.safeAreaInsets.top
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    AnnouncementDetailHero(item: item, topInset: barBottom)
                        .onGeometryChange(for: Bool.self) { proxy in
                            proxy.frame(in: .global).maxY < barBottom
                        } action: { isUnder in
                            heroIsUnderBar = isUnder
                        }
                    content
                }
            }
            // The glow runs to the top of the screen; `topInset` keeps the
            // banner itself clear of the bar.
            .ignoresSafeArea(.container, edges: .top)
        }
        .background(theme.palette.background.ignoresSafeArea())
        .navigationTitle(heroIsUnderBar ? item.title : "")
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(heroIsUnderBar ? .visible : .hidden, for: .navigationBar)
        .animation(theme.animation(FaithFormTokens.Motion.standard), value: heroIsUnderBar)
        .sheet(isPresented: $isAddingToCalendar) {
            AddToCalendarSheet(item: item) { isAddingToCalendar = false }
                .ignoresSafeArea()
        }
    }

    private var content: some View {
        VStack(alignment: .leading, spacing: FaithFormTokens.Spacing.lg) {
            header
            whenAndWhere
            actions
            if !item.body.isEmpty {
                about
            }
        }
        .padding(.horizontal, FaithFormTokens.Layout.screenPaddingHorizontal)
        .padding(.bottom, FaithFormTokens.Spacing.xxl)
        .frame(maxWidth: FaithFormTokens.Layout.contentMaxWidth, alignment: .leading)
        .frame(maxWidth: .infinity)
    }

    // MARK: - Header

    private var header: some View {
        VStack(alignment: .leading, spacing: FaithFormTokens.Spacing.sm) {
            let moment = AnnouncementTiming.moment(of: item)
            let momentLabel = FeedFormatting.momentLabel(moment)
            if momentLabel != nil || item.isPinned {
                HStack(spacing: FaithFormTokens.Spacing.sm) {
                    if let momentLabel {
                        StatusChip(momentLabel, tone: moment == .happeningNow ? .live : .neutral)
                    }
                    if item.isPinned {
                        StatusChip(L.pinnedLabel)
                    }
                }
            }

            Text(item.title)
                .font(theme.font(FaithFormTokens.Text.displayMedium))
                .foregroundStyle(theme.palette.contentPrimary)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityAddTraits(.isHeader)

            Text(byline)
                .font(theme.font(FaithFormTokens.Text.caption))
                .foregroundStyle(theme.mutedContent)
        }
    }

    private var byline: String {
        [item.churchName, FeedFormatting.postedLine(item)]
            .compactMap { $0 }
            .joined(separator: " · ")
    }

    // MARK: - When and where

    private var whenAndWhere: some View {
        let when = FeedFormatting.detailWhen(item)
        let shape = RoundedRectangle(cornerRadius: FaithFormTokens.Radius.xl, style: .continuous)

        return VStack(spacing: 0) {
            DetailInfoRow(symbol: "calendar", title: when.date, subtitle: when.time)

            if let location = item.location, !location.isEmpty {
                Rectangle()
                    .fill(theme.palette.divider)
                    .frame(height: FaithFormTokens.BorderWidth.hairline)
                    .padding(.leading, FaithFormTokens.Spacing.base + 42 + FaithFormTokens.Spacing.md)

                Button {
                    openDirections(to: location)
                } label: {
                    DetailInfoRow(
                        symbol: "mappin.and.ellipse",
                        title: location,
                        subtitle: L.announcementDirections,
                        accessory: "arrow.up.right"
                    )
                }
                .buttonStyle(.plain)
                .accessibilityHint(Text(L.announcementDirectionsHint))
            }
        }
        .background(shape.fill(theme.palette.surface))
        .overlay(shape.strokeBorder(theme.palette.border, lineWidth: FaithFormTokens.BorderWidth.hairline))
    }

    private func openDirections(to location: String) {
        var components = URLComponents(string: "https://maps.apple.com/")
        components?.queryItems = [URLQueryItem(name: "q", value: location)]
        if let url = components?.url { openURL(url) }
    }

    // MARK: - Actions

    /// One wide call to action and a compact share beside it. Two equal
    /// halves squeezed "Add to Calendar" onto two lines.
    private var actions: some View {
        HStack(spacing: FaithFormTokens.Spacing.md) {
            Button {
                isAddingToCalendar = true
            } label: {
                Label(L.announcementAddToCalendar, systemImage: "calendar.badge.plus")
            }
            .buttonStyle(FaithFormButtonStyle(kind: .primary, theme: theme))

            ShareLink(item: shareText, subject: Text(item.title)) {
                Image(systemName: "square.and.arrow.up")
                    .font(.system(size: FaithFormTokens.IconSize.sizeMedium, weight: .semibold))
                    .foregroundStyle(theme.palette.contentPrimary)
                    .frame(width: shareButtonSize, height: shareButtonSize)
                    .background(
                        RoundedRectangle(cornerRadius: FaithFormTokens.Radius.control, style: .continuous)
                            .fill(theme.palette.background)
                    )
                    .overlay(
                        RoundedRectangle(cornerRadius: FaithFormTokens.Radius.control, style: .continuous)
                            .strokeBorder(theme.palette.brandPrimary.opacity(0.45), lineWidth: theme.borderWidth)
                    )
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(Text(L.announcementShare))
        }
    }

    @ScaledMetric(relativeTo: .body) private var shareButtonSize: CGFloat = FaithFormTokens.TouchTarget.recommended

    private var shareText: String {
        let when = FeedFormatting.detailWhen(item)
        return [
            item.title,
            [when.date, when.time].compactMap { $0 }.joined(separator: " · "),
            item.location,
            item.churchName,
        ]
        .compactMap { $0 }
        .filter { !$0.isEmpty }
        .joined(separator: "\n")
    }

    // MARK: - About

    private var about: some View {
        VStack(alignment: .leading, spacing: FaithFormTokens.Spacing.sm) {
            Text(L.announcementDetails)
                .font(theme.font(FaithFormTokens.Text.label))
                .tracking(1.0)
                .textCase(.uppercase)
                .foregroundStyle(theme.mutedContent)
                .accessibilityAddTraits(.isHeader)

            Text(Self.linked(item.body))
                .font(theme.font(FaithFormTokens.Text.body))
                .foregroundStyle(theme.palette.contentPrimary)
                .tint(theme.palette.brandPrimary)
                .lineSpacing(3)
                .fixedSize(horizontal: false, vertical: true)
                .textSelection(.enabled)
        }
    }

    /// Web addresses and phone numbers in what the church wrote, made tappable
    /// and underlined — the link colour alone is too close to the text's.
    static func linked(_ text: String) -> AttributedString {
        var attributed = AttributedString(text)
        let types: NSTextCheckingResult.CheckingType = [.link, .phoneNumber]
        guard let detector = try? NSDataDetector(types: types.rawValue) else { return attributed }

        let whole = NSRange(text.startIndex..., in: text)
        for match in detector.matches(in: text, range: whole) {
            guard
                let stringRange = Range(match.range, in: text),
                let range = Range(stringRange, in: attributed)
            else { continue }

            let url: URL?
            if let link = match.url, ["http", "https", "mailto"].contains(link.scheme?.lowercased() ?? "") {
                url = link
            } else if let phone = match.phoneNumber {
                url = URL(string: "tel:" + phone.filter { $0.isNumber || $0 == "+" })
            } else {
                url = nil
            }
            guard let url else { continue }
            attributed[range].link = url
            attributed[range].underlineStyle = .single
        }
        return attributed
    }
}

// MARK: - Hero

/// The banner, whole, over a blurred wash of itself.
private struct AnnouncementDetailHero: View {
    @Environment(\.faithformTheme) private var theme
    let item: FeedItem
    /// The status bar and navigation bar, which the banner sits below.
    let topInset: CGFloat

    var body: some View {
        if let url = item.posterUrl.flatMap(URL.init(string:)) {
            PosterImage(url: url) { phase in
                switch phase {
                case let .success(image):
                    layout {
                        image.resizable().scaledToFill()
                    } backdrop: {
                        image.resizable().scaledToFill()
                    }
                case .failure:
                    placeholder
                case .loading:
                    layout {
                        Rectangle()
                            .fill(Color.white.opacity(0.12))
                            .skeletonShimmer(onDark: true)
                    } backdrop: {
                        AnnouncementPlaceholderArt(item: item, glyphSize: nil)
                    }
                }
            }
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(Text(item.posterAltText ?? ""))
            .accessibilityHidden(item.posterAltText == nil)
        } else {
            placeholder
                .accessibilityHidden(true)
        }
    }

    private var placeholder: some View {
        layout {
            AnnouncementPlaceholderArt(item: item, glyphSize: 40)
        } backdrop: {
            AnnouncementPlaceholderArt(item: item, glyphSize: nil)
        }
    }

    private func layout<Art: View, Backdrop: View>(
        @ViewBuilder art: () -> Art,
        @ViewBuilder backdrop: () -> Backdrop
    ) -> some View {
        let shape = RoundedRectangle(cornerRadius: FaithFormTokens.Radius.xl, style: .continuous)

        return Color.clear
            .aspectRatio(AnnouncementArtwork.aspectRatio, contentMode: .fit)
            .overlay { art() }
            .clipShape(shape)
            .overlay(shape.strokeBorder(Color.white.opacity(0.16), lineWidth: FaithFormTokens.BorderWidth.hairline))
            .shadow(color: .black.opacity(theme.usesDecorativeShadow ? 0.3 : 0), radius: 24, y: 14)
            .padding(.horizontal, FaithFormTokens.Layout.screenPaddingHorizontal)
            .padding(.top, topInset + FaithFormTokens.Spacing.sm)
            .padding(.bottom, FaithFormTokens.Spacing.lg)
            .frame(maxWidth: .infinity)
            .background {
                StretchyBackdrop {
                    backdrop()
                        .blur(radius: 44, opaque: true)
                        .saturation(1.2)
                        .overlay { wash }
                }
            }
    }

    /// The page's own colour at the top and bottom, the artwork's between: a
    /// glow around the banner rather than a block behind the bars.
    ///
    /// A dark wash under the bars read beautifully on iOS 26 and not before
    /// it — the older back button keeps the app's navy accent whatever tint
    /// the pushed screen asks for, and navy on a dark wash is barely there.
    /// With the page colour behind it, it reads on every version, in both
    /// appearances.
    private var wash: some View {
        LinearGradient(
            stops: [
                .init(color: theme.palette.background, location: 0),
                .init(color: theme.palette.background.opacity(0.55), location: 0.22),
                .init(color: theme.palette.background.opacity(0.05), location: 0.5),
                .init(color: theme.palette.background.opacity(0.6), location: 0.8),
                .init(color: theme.palette.background, location: 1),
            ],
            startPoint: .top,
            endPoint: .bottom
        )
    }
}

/// Grows with a pull past the top instead of leaving a gap above it.
private struct StretchyBackdrop<Content: View>: View {
    @ViewBuilder let content: Content

    var body: some View {
        GeometryReader { proxy in
            let pull = max(proxy.frame(in: .scrollView).minY, 0)
            content
                .frame(width: proxy.size.width, height: proxy.size.height + pull)
                .clipped()
                .offset(y: -pull)
        }
    }
}

/// One row of the when-and-where card.
private struct DetailInfoRow: View {
    @Environment(\.faithformTheme) private var theme
    let symbol: String
    let title: String
    let subtitle: String?
    var accessory: String?

    var body: some View {
        HStack(spacing: FaithFormTokens.Spacing.md) {
            Image(systemName: symbol)
                .font(.system(size: 18, weight: .semibold))
                .foregroundStyle(theme.palette.brandPrimary)
                .frame(width: 42, height: 42)
                .background(
                    RoundedRectangle(cornerRadius: FaithFormTokens.Radius.md, style: .continuous)
                        .fill(theme.palette.brandAccent.opacity(0.18))
                )
                .accessibilityHidden(true)

            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(theme.font(FaithFormTokens.Text.titleMedium))
                    .foregroundStyle(theme.palette.contentPrimary)
                    .fixedSize(horizontal: false, vertical: true)
                if let subtitle {
                    Text(subtitle)
                        .font(theme.font(FaithFormTokens.Text.bodySmall))
                        .foregroundStyle(theme.palette.contentSecondary)
                }
            }

            Spacer(minLength: 0)

            if let accessory {
                Image(systemName: accessory)
                    .font(.footnote.weight(.bold))
                    .foregroundStyle(theme.mutedContent)
                    .accessibilityHidden(true)
            }
        }
        .padding(FaithFormTokens.Spacing.base)
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Add to Calendar

/// The system's own event editor, filled in.
///
/// Since iOS 17 it runs outside the app, so adding an event needs no calendar
/// permission at all — the person sees their calendars, the app never does.
struct AddToCalendarSheet: UIViewControllerRepresentable {
    let item: FeedItem
    let onDone: @MainActor () -> Void

    func makeUIViewController(context: Context) -> EKEventEditViewController {
        let store = EKEventStore()
        let event = EKEvent(eventStore: store)
        event.title = item.title
        event.location = item.location
        event.notes = item.body.isEmpty ? nil : item.body
        if let span = AnnouncementTiming.calendarSpan(for: item) {
            event.isAllDay = span.isAllDay
            event.timeZone = span.timeZone
            event.startDate = span.start
            event.endDate = span.end
        }

        let controller = EKEventEditViewController()
        controller.eventStore = store
        controller.event = event
        controller.editViewDelegate = context.coordinator
        return controller
    }

    func updateUIViewController(_ controller: EKEventEditViewController, context: Context) {}

    func makeCoordinator() -> Coordinator {
        Coordinator(onDone: onDone)
    }

    final class Coordinator: NSObject, EKEventEditViewDelegate {
        private let onDone: @MainActor () -> Void

        init(onDone: @escaping @MainActor () -> Void) {
            self.onDone = onDone
        }

        // EventKitUI's delegate is not annotated for an actor, but UIKit calls
        // it on the main thread; say so rather than hop.
        func eventEditViewController(
            _ controller: EKEventEditViewController,
            didCompleteWith action: EKEventEditViewAction
        ) {
            let onDone = self.onDone
            MainActor.assumeIsolated { onDone() }
        }
    }
}

/// Zooms from the card that was tapped, on iOS 18 and later.
struct AnnouncementZoomDestination: ViewModifier {
    let id: String
    let namespace: Namespace.ID

    func body(content: Content) -> some View {
        if #available(iOS 18.0, *) {
            content.navigationTransition(.zoom(sourceID: id, in: namespace))
        } else {
            content
        }
    }
}
