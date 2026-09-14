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
    private let onOpen: @MainActor (SermonListItem) -> Void
    private let showTitle: Bool

    public init(
        model: SermonModel,
        onOpen: @escaping @MainActor (SermonListItem) -> Void,
        showTitle: Bool = true
    ) {
        self.model = model
        self.onOpen = onOpen
        self.showTitle = showTitle
    }

    public var body: some View {
        ScrollView {
            // Lazy, so "the last row appeared" means the reader scrolled to it
            // rather than that the page was built.
            LazyVStack(alignment: .leading, spacing: FaithFormTokens.Spacing.lg) {
                switch model.phase {
                case .idle, .loading:
                    ProgressView().accessibilityLabel(L.mediaLoading)

                case .blocked:
                    // The whole list refused. Not "the church removed it" —
                    // that is only ever true of one sermon.
                    SermonMessage(
                        title: L.mediaBlockedTitle,
                        message: L.sermonsBlockedBody
                    )

                case .offline:
                    SermonMessage(
                        title: L.sermonsOfflineTitle,
                        message: L.sermonsOfflineBody,
                        actionTitle: L.sermonsRetry
                    ) {
                        Task { await model.refresh() }
                    }

                case .failed(let message):
                    SermonMessage(
                        title: message,
                        message: "",
                        actionTitle: L.sermonsRetry
                    ) {
                        Task { await model.refresh() }
                    }

                case let .loaded(items, _):
                    if showTitle {
                        Text(L.sermonsTitle)
                            .font(theme.font(FaithFormTokens.Text.titleMedium))
                            .foregroundStyle(theme.palette.contentPrimary)
                    }

                    FaithFormSearchField(
                        placeholder: L.sermonsSearchLabel,
                        text: Bindable(model).searchTerm,
                        onSubmit: { Task { await model.search(model.searchTerm) } },
                        onClear: { Task { await model.searchTextChanged() } }
                    )

                    if items.isEmpty {
                        // Two different empties: a church that has published
                        // nothing, and a search that found nothing. Keyed on the
                        // search that ran, not on what is typed now.
                        Text(
                            model.submittedQuery.isEmpty
                                ? L.sermonsEmpty
                                : L.sermonsEmptySearch
                        )
                        .font(theme.font(FaithFormTokens.Text.body))
                        .foregroundStyle(theme.palette.contentSecondary)
                    } else {
                        ForEach(SermonDates.groupedByMonth(items)) { group in
                            if let title = group.title {
                                Text(title)
                                    .font(theme.font(FaithFormTokens.Text.label))
                                    .foregroundStyle(theme.palette.contentSecondary)
                                    .accessibilityAddTraits(.isHeader)
                            }

                            ForEach(group.items, id: \.sermonId) { item in
                                Button { onOpen(item) } label: {
                                    SermonCard(item: item)
                                }
                                .buttonStyle(.plain)
                                .onAppear {
                                    if item.sermonId == items.last?.sermonId {
                                        Task { await model.loadMore() }
                                    }
                                }
                            }
                        }

                        if model.isLoadingMore {
                            ProgressView().accessibilityLabel(L.mediaLoading)
                        } else if model.loadMoreFailed {
                            SermonLoadMoreRetry {
                                Task { await model.retryLoadMore() }
                            }
                        }
                    }
                }
            }
            .padding(.horizontal, FaithFormTokens.Layout.screenPaddingHorizontal)
            .padding(.vertical, FaithFormTokens.Spacing.xl)
        }
        .background(theme.palette.background)
        .refreshable { await model.refresh() }
        .task { await model.load() }
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
/// Notes otherwise sit behind Watch's segmented control, which nobody finds
/// unless they already went looking for a video. The host decides whether it
/// is shown at all, through the registry, like every other door.
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
                    ProgressView().accessibilityLabel(L.mediaLoading)

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
