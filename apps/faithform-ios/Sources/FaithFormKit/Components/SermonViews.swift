import SwiftUI

/// The sermon-notes screens.
///
/// Nothing here fetches on its own: a model is handed in already loaded or
/// loading, exactly as the media screens work. The list is notes a church chose
/// to hand out, so an empty list is a real state and says so rather than
/// inventing rows.

// MARK: - List

public struct SermonListView: View {
    @Environment(\.faithformTheme) private var theme
    private let model: SermonModel
    private let presentations: PresentationModel
    private let onOpenNotes: @MainActor (String) -> Void
    private let onOpenSlides: @MainActor (String) -> Void
    private let showTitle: Bool

    public init(
        model: SermonModel,
        presentations: PresentationModel,
        onOpenNotes: @escaping @MainActor (String) -> Void,
        onOpenSlides: @escaping @MainActor (String) -> Void,
        showTitle: Bool = true
    ) {
        self.model = model
        self.presentations = presentations
        self.onOpenNotes = onOpenNotes
        self.onOpenSlides = onOpenSlides
        self.showTitle = showTitle
    }

    public var body: some View {
        let hubs = SermonHub.merge(notes: model.phase.items, slides: presentations.phase.items)
        let waiting = hubs.isEmpty && (isUnready(model.phase) || isUnready(presentations.phase))
        let empty = hubs.isEmpty && !waiting

        ScrollView {
            LazyVStack(alignment: .leading, spacing: FaithFormTokens.Spacing.lg) {
                if waiting {
                    SermonListSkeleton()
                } else if empty, isBlocked {
                    SermonMessage(title: L.mediaBlockedTitle, message: L.sermonsBlockedBody)
                } else if empty, isOffline {
                    SermonMessage(
                        title: L.sermonsOfflineTitle,
                        message: L.sermonsOfflineBody,
                        actionTitle: L.sermonsRetry
                    ) {
                        Task {
                            await presentations.refresh()
                            await model.refresh()
                        }
                    }
                } else if empty, let message = failureMessage {
                    SermonMessage(
                        title: message,
                        message: "",
                        actionTitle: L.sermonsRetry
                    ) {
                        Task {
                            await presentations.refresh()
                            await model.refresh()
                        }
                    }
                } else {
                    if showTitle {
                        Text(L.sermonsTitle)
                            .font(theme.font(FaithFormTokens.Text.titleMedium))
                            .foregroundStyle(theme.palette.contentPrimary)
                    }

                    FaithFormSearchField(
                        placeholder: L.sermonsSearchLabel,
                        text: Bindable(model).searchTerm,
                        onSubmit: {
                            Task {
                                await presentations.search(model.searchTerm)
                                await model.search(model.searchTerm)
                            }
                        },
                        onClear: {
                            Task {
                                presentations.searchTerm = ""
                                await presentations.searchTextChanged()
                                await model.searchTextChanged()
                            }
                        }
                    )

                    if model.phase.isStale || presentations.phase.isStale {
                        OfflineBanner(message: L.offlineCached)
                    }

                    if hubs.isEmpty {
                        EmptyStateView(
                            title: model.submittedQuery.isEmpty ? L.sermonsEmpty : L.sermonsEmptySearch,
                            explanation: "",
                            symbol: model.submittedQuery.isEmpty ? "book" : "magnifyingglass"
                        )
                    } else {
                        ForEach(SermonHub.groupedByMonth(hubs)) { group in
                            if let title = group.title {
                                Text(title)
                                    .font(theme.font(FaithFormTokens.Text.label))
                                    .foregroundStyle(theme.palette.contentSecondary)
                                    .accessibilityAddTraits(.isHeader)
                            }

                            ForEach(group.items) { hub in
                                SermonHubCard(
                                    hub: hub,
                                    onOpenNotes: {
                                        if let notes = hub.notes { onOpenNotes(notes.sermonId) }
                                    },
                                    onOpenSlides: {
                                        if let slides = hub.slides { onOpenSlides(slides.presentationId) }
                                    }
                                )
                                .onAppear {
                                    if hub.sermonId == hubs.last?.sermonId {
                                        Task {
                                            await model.loadMore()
                                            await presentations.loadMore()
                                        }
                                    }
                                }
                            }
                        }

                        if model.isLoadingMore || presentations.isLoadingMore {
                            SermonHubCardSkeleton()
                                .skeletonShimmer()
                        } else if model.loadMoreFailed || presentations.loadMoreFailed {
                            SermonLoadMoreRetry {
                                Task {
                                    await model.retryLoadMore()
                                    await presentations.retryLoadMore()
                                }
                            }
                        }
                    }
                }
            }
            .padding(.horizontal, FaithFormTokens.Layout.screenPaddingHorizontal)
            .padding(.vertical, FaithFormTokens.Spacing.xl)
        }
        .background(theme.palette.background)
        .refreshable {
            await presentations.refresh()
            await model.refresh()
        }
        .task {
            await presentations.load()
            await model.load()
        }
    }

    private func isUnready(_ phase: SermonListPhase) -> Bool {
        switch phase {
        case .idle, .loading: return true
        default: return false
        }
    }

    private func isUnready(_ phase: PresentationListPhase) -> Bool {
        switch phase {
        case .idle, .loading: return true
        default: return false
        }
    }

    private var isBlocked: Bool {
        switch (model.phase, presentations.phase) {
        case (.blocked, _), (_, .blocked): return true
        default: return false
        }
    }

    private var isOffline: Bool {
        switch (model.phase, presentations.phase) {
        case (.offline, _), (_, .offline): return true
        default: return false
        }
    }

    private var failureMessage: String? {
        if case let .failed(message) = model.phase { return message }
        if case let .failed(message) = presentations.phase { return message }
        return nil
    }
}

/// Where the list stops when a next page failed: says so, and offers the page
/// again. Only a tap retries — the last row reappearing does not.
struct SermonLoadMoreRetry: View {
    @Environment(\.faithformTheme) private var theme
    let action: @MainActor () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: FaithFormTokens.Spacing.sm) {
            Text(L.sermonsLoadMoreFailed)
                .font(theme.font(FaithFormTokens.Text.bodySmall))
                .foregroundStyle(theme.palette.contentSecondary)
                .fixedSize(horizontal: false, vertical: true)
            Button(L.sermonsRetry) { action() }
                .buttonStyle(FaithFormButtonStyle(kind: .secondary, theme: theme))
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .contain)
    }
}

/// The door to sermon notes from a church's Home.
///
/// Notes otherwise sit behind Services. The host decides whether it is shown
/// The host decides whether it is shown at all, through the registry, like
/// every other door.
public struct SermonNotesEntryCard: View {
    @Environment(\.faithformTheme) private var theme
    private let action: @MainActor () -> Void

    public init(action: @escaping @MainActor () -> Void) {
        self.action = action
    }

    public var body: some View {
        Button { action() } label: {
            FaithFormCard {
                HStack(spacing: FaithFormTokens.Spacing.md) {
                    Image(systemName: "text.book.closed")
                        .font(.system(size: FaithFormTokens.IconSize.sizeMedium, weight: .semibold))
                        .foregroundStyle(theme.palette.brandAccent)
                        .accessibilityHidden(true)

                    VStack(alignment: .leading, spacing: FaithFormTokens.Spacing.xs) {
                        Text(L.sermonsTitle)
                            .font(theme.font(FaithFormTokens.Text.titleMedium))
                            .foregroundStyle(theme.palette.contentPrimary)
                        Text(L.sermonsHomeEntryBody)
                            .font(theme.font(FaithFormTokens.Text.bodySmall))
                            .foregroundStyle(theme.palette.contentSecondary)
                            .fixedSize(horizontal: false, vertical: true)
                    }

                    Spacer(minLength: 0)

                    Image(systemName: "chevron.right")
                        .foregroundStyle(theme.palette.contentSecondary)
                        .accessibilityHidden(true)
                }
            }
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isButton)
    }
}

struct SermonHubCard: View {
    @Environment(\.faithformTheme) private var theme
    let hub: SermonHubItem
    let onOpenNotes: () -> Void
    let onOpenSlides: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Button(action: primaryOpen) {
                SermonHubThumbnail(hub: hub)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(primaryLabel)

            VStack(alignment: .leading, spacing: FaithFormTokens.Spacing.sm) {
                let meta = [
                    SermonDates.displayDay(
                        preachedOn: hub.preachedOn,
                        publishedAt: hub.publishedAt,
                        churchTimezone: hub.churchTimezone
                    ).map { SermonDates.format($0, style: .abbreviated) },
                    hub.seriesName,
                ]
                .compactMap { $0 }
                .filter { !$0.isEmpty }

                if !meta.isEmpty {
                    Text(meta.joined(separator: " · "))
                        .font(theme.font(FaithFormTokens.Text.label))
                        .foregroundStyle(theme.palette.contentSecondary)
                }

                Text(hub.title)
                    .font(theme.font(FaithFormTokens.Text.titleMedium))
                    .foregroundStyle(theme.palette.contentPrimary)
                    .fixedSize(horizontal: false, vertical: true)

                if !hub.scriptureRefs.isEmpty {
                    Text(hub.scriptureRefs.joined(separator: " · "))
                        .font(theme.font(FaithFormTokens.Text.label))
                        .foregroundStyle(theme.palette.brandAccent)
                        .fixedSize(horizontal: false, vertical: true)
                }

                HStack(spacing: FaithFormTokens.Spacing.sm) {
                    if hub.hasNotes {
                        SermonHubAction(title: L.sermonsOpenNotes, action: onOpenNotes)
                    }
                    if hub.hasSlides {
                        SermonHubAction(title: L.sermonsOpenSlides, action: onOpenSlides)
                    }
                }
            }
            .padding(FaithFormTokens.Spacing.base)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: FaithFormTokens.Radius.md, style: .continuous)
                .fill(theme.palette.surface)
        )
        .overlay(
            RoundedRectangle(cornerRadius: FaithFormTokens.Radius.md, style: .continuous)
                .strokeBorder(theme.palette.border, lineWidth: FaithFormTokens.BorderWidth.hairline)
        )
        .clipShape(RoundedRectangle(cornerRadius: FaithFormTokens.Radius.md, style: .continuous))
        .accessibilityElement(children: .contain)
    }

    private func primaryOpen() {
        if hub.hasSlides { onOpenSlides() }
        else { onOpenNotes() }
    }

    private var primaryLabel: String {
        hub.hasSlides ? L.sermonsOpenSlides : L.sermonsOpenNotes
    }
}

private struct SermonHubThumbnail: View {
    @Environment(\.faithformTheme) private var theme
    let hub: SermonHubItem

    var body: some View {
        ZStack {
            theme.palette.brandPrimary
            LinearGradient(
                colors: [Color.white.opacity(0.08), Color.black.opacity(0.28)],
                startPoint: .top,
                endPoint: .bottom
            )
            VStack(spacing: FaithFormTokens.Spacing.sm) {
                Text(hub.title)
                    .font(.system(size: 18, weight: .semibold))
                    .foregroundStyle(.white)
                    .multilineTextAlignment(.center)
                    .lineLimit(3)
                    .padding(.horizontal, FaithFormTokens.Spacing.lg)
                if let slides = hub.slides {
                    Text(String(format: L.presentationsPageCount, slides.pageCount))
                        .font(theme.font(FaithFormTokens.Text.caption))
                        .foregroundStyle(theme.palette.brandAccent)
                } else {
                    Image(systemName: "text.book.closed")
                        .font(.system(size: FaithFormTokens.IconSize.sizeMedium, weight: .semibold))
                        .foregroundStyle(theme.palette.brandAccent)
                        .accessibilityHidden(true)
                }
            }
        }
        .aspectRatio(16.0 / 9.0, contentMode: .fit)
        .clipped()
    }
}

private struct SermonHubAction: View {
    @Environment(\.faithformTheme) private var theme
    let title: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(title)
                .font(theme.font(FaithFormTokens.Text.label))
                .foregroundStyle(theme.palette.contentPrimary)
                .frame(maxWidth: .infinity)
                .padding(.vertical, FaithFormTokens.Spacing.sm)
                .background(
                    Capsule().fill(theme.palette.surfaceSunken)
                )
                .overlay(
                    Capsule().strokeBorder(theme.palette.border, lineWidth: FaithFormTokens.BorderWidth.hairline)
                )
        }
        .buttonStyle(.plain)
        .frame(minHeight: FaithFormTokens.TouchTarget.minimum)
    }
}

struct SermonCard: View {
    @Environment(\.faithformTheme) private var theme
    let item: SermonListItem

    var body: some View {
        FaithFormCard {
            VStack(alignment: .leading, spacing: FaithFormTokens.Spacing.sm) {
                // The day it was preached, then the series it belongs to.
                let meta = [
                    SermonDates.displayDay(for: item).map { SermonDates.format($0, style: .abbreviated) },
                    item.seriesName,
                ]
                .compactMap { $0 }
                .filter { !$0.isEmpty }

                if !meta.isEmpty {
                    Text(meta.joined(separator: " · "))
                        .font(theme.font(FaithFormTokens.Text.label))
                        .foregroundStyle(theme.palette.contentSecondary)
                }

                Text(item.title)
                    .font(theme.font(FaithFormTokens.Text.titleMedium))
                    .foregroundStyle(theme.palette.contentPrimary)
                    .fixedSize(horizontal: false, vertical: true)

                if let summary = item.summary, !summary.isEmpty {
                    Text(summary)
                        .font(theme.font(FaithFormTokens.Text.bodySmall))
                        .foregroundStyle(theme.palette.contentSecondary)
                        .lineLimit(3)
                        .fixedSize(horizontal: false, vertical: true)
                }

                if !item.scriptureRefs.isEmpty {
                    Text(item.scriptureRefs.joined(separator: " · "))
                        .font(theme.font(FaithFormTokens.Text.label))
                        .foregroundStyle(theme.palette.contentSecondary)
                }
            }
        }
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Detail

public struct SermonDetailView: View {
    @Environment(\.faithformTheme) private var theme
    private let model: SermonDetailModel

    public init(model: SermonDetailModel) {
        self.model = model
    }

    public var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: FaithFormTokens.Spacing.lg) {
                switch model.phase {
                case .loading:
                    DetailSkeleton()

                case .unavailable:
                    SermonMessage(
                        title: L.sermonsUnavailableTitle,
                        message: L.sermonsUnavailableBody
                    )

                case .offline:
                    SermonMessage(
                        title: L.sermonsOfflineTitle,
                        message: L.sermonsOfflineBody,
                        actionTitle: L.sermonsRetry
                    ) {
                        Task { await model.load() }
                    }

                case .failed(let message):
                    SermonMessage(title: message, message: "")

                case .loaded(let detail):
                    content(for: detail)
                }
            }
            .padding(.horizontal, FaithFormTokens.Layout.screenPaddingHorizontal)
            .padding(.vertical, FaithFormTokens.Spacing.xl)
        }
        .background(theme.palette.background)
        .task { await model.load() }
    }

    @ViewBuilder
    private func content(for detail: SermonDetail) -> some View {
        if let series = detail.seriesName, !series.isEmpty {
            Text(series)
                .font(theme.font(FaithFormTokens.Text.label))
                .foregroundStyle(theme.palette.contentSecondary)
        }

        Text(detail.title)
            .font(theme.font(FaithFormTokens.Text.titleLarge))
            .foregroundStyle(theme.palette.contentPrimary)
            .fixedSize(horizontal: false, vertical: true)

        if let day = SermonDates.displayDay(for: detail) {
            Text(SermonDates.format(day, style: .long))
                .font(theme.font(FaithFormTokens.Text.label))
                .foregroundStyle(theme.palette.contentSecondary)
        }

        if let summary = detail.summary, !summary.isEmpty {
            Text(summary)
                .font(theme.font(FaithFormTokens.Text.body))
                .foregroundStyle(theme.palette.contentSecondary)
                .fixedSize(horizontal: false, vertical: true)
        }

        if !detail.scriptureRefs.isEmpty {
            SermonSection(title: L.sermonsScriptureLabel) {
                Text(detail.scriptureRefs.joined(separator: " · "))
                    .font(theme.font(FaithFormTokens.Text.body))
                    .foregroundStyle(theme.palette.contentPrimary)
            }
        }

        if let outline = detail.outline {
            SermonSection(title: L.sermonsOutlineLabel) {
                VStack(alignment: .leading, spacing: FaithFormTokens.Spacing.md) {
                    if let intro = outline.intro, !intro.isEmpty {
                        Text(intro)
                            .font(theme.font(FaithFormTokens.Text.body))
                            .foregroundStyle(theme.palette.contentSecondary)
                            .fixedSize(horizontal: false, vertical: true)
                    }

                    ForEach(Array(outline.points.enumerated()), id: \.offset) { index, point in
                        VStack(alignment: .leading, spacing: FaithFormTokens.Spacing.xs) {
                            // Numbered because an outline *is* ordered — the
                            // points were preached in this sequence.
                            Text("\(index + 1). \(point.title)")
                                .font(theme.font(FaithFormTokens.Text.titleMedium))
                                .foregroundStyle(theme.palette.contentPrimary)
                                .fixedSize(horizontal: false, vertical: true)

                            if !point.summary.isEmpty {
                                Text(point.summary)
                                    .font(theme.font(FaithFormTokens.Text.bodySmall))
                                    .foregroundStyle(theme.palette.contentSecondary)
                                    .fixedSize(horizontal: false, vertical: true)
                            }

                            if let scripture = point.scripture, !scripture.isEmpty {
                                Text(scripture)
                                    .font(theme.font(FaithFormTokens.Text.label))
                                    .foregroundStyle(theme.palette.contentSecondary)
                            }
                        }
                    }

                    if let application = outline.application, !application.isEmpty {
                        VStack(alignment: .leading, spacing: FaithFormTokens.Spacing.xs) {
                            Text(L.sermonsApplicationLabel)
                                .font(theme.font(FaithFormTokens.Text.label))
                                .foregroundStyle(theme.palette.contentSecondary)
                            Text(application)
                                .font(theme.font(FaithFormTokens.Text.body))
                                .foregroundStyle(theme.palette.contentPrimary)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                    }

                    if let closing = outline.closing, !closing.isEmpty {
                        Text(closing)
                            .font(theme.font(FaithFormTokens.Text.body))
                            .foregroundStyle(theme.palette.contentSecondary)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
            }
        } else {
            Text(L.sermonsNotesOnly)
                .font(theme.font(FaithFormTokens.Text.bodySmall))
                .foregroundStyle(theme.palette.contentSecondary)
        }

        if !detail.discussionQuestions.isEmpty {
            SermonSection(title: L.sermonsQuestionsLabel) {
                VStack(alignment: .leading, spacing: FaithFormTokens.Spacing.sm) {
                    ForEach(Array(detail.discussionQuestions.enumerated()), id: \.offset) { _, item in
                        Text("• \(item.question)")
                            .font(theme.font(FaithFormTokens.Text.body))
                            .foregroundStyle(theme.palette.contentPrimary)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
            }
        }
    }
}

struct SermonSection<Content: View>: View {
    @Environment(\.faithformTheme) private var theme
    let title: String
    @ViewBuilder let content: () -> Content

    var body: some View {
        FaithFormCard {
            VStack(alignment: .leading, spacing: FaithFormTokens.Spacing.sm) {
                Text(title)
                    .font(theme.font(FaithFormTokens.Text.label))
                    .foregroundStyle(theme.palette.contentSecondary)
                content()
            }
        }
    }
}

struct SermonMessage: View {
    @Environment(\.faithformTheme) private var theme
    let title: String
    // Named `message` rather than `body`, which is `View`'s own requirement.
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
                    Button(actionTitle) { action() }
                        .buttonStyle(.borderedProminent)
                }
            }
        }
        .accessibilityElement(children: .combine)
    }
}
