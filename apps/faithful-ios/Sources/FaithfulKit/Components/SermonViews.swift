import SwiftUI

/// The sermon-notes screens.
///
/// Nothing here fetches on its own: a model is handed in already loaded or
/// loading, exactly as the media screens work. The list is notes a church chose
/// to hand out, so an empty list is a real state and says so rather than
/// inventing rows.

// MARK: - List

public struct SermonListView: View {
    @Environment(\.faithfulTheme) private var theme
    private let model: SermonModel
    private let onOpen: @MainActor (SermonListItem) -> Void

    public init(
        model: SermonModel,
        onOpen: @escaping @MainActor (SermonListItem) -> Void
    ) {
        self.model = model
        self.onOpen = onOpen
    }

    public var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: FaithfulTokens.Spacing.lg) {
                switch model.phase {
                case .idle, .loading:
                    ProgressView().accessibilityLabel(L.mediaLoading)

                case .blocked:
                    SermonMessage(
                        title: L.mediaBlockedTitle,
                        message: L.sermonsUnavailableBody
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
                    Text(L.sermonsTitle)
                        .font(theme.font(FaithfulTokens.Text.titleMedium))
                        .foregroundStyle(theme.palette.contentPrimary)

                    TextField(L.sermonsSearchLabel, text: Bindable(model).searchTerm)
                        .textFieldStyle(.roundedBorder)
                        .accessibilityLabel(L.sermonsSearchLabel)
                        .onSubmit { Task { await model.search(model.searchTerm) } }

                    if items.isEmpty {
                        // Two different empties: a church that has published
                        // nothing, and a search that found nothing.
                        Text(
                            model.searchTerm.isEmpty
                                ? L.sermonsEmpty
                                : L.sermonsEmptySearch
                        )
                        .font(theme.font(FaithfulTokens.Text.body))
                        .foregroundStyle(theme.palette.contentSecondary)
                    } else {
                        ForEach(items, id: \.sermonId) { item in
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
    }
}

struct SermonCard: View {
    @Environment(\.faithfulTheme) private var theme
    let item: SermonListItem

    var body: some View {
        FaithfulCard {
            VStack(alignment: .leading, spacing: FaithfulTokens.Spacing.sm) {
                if let series = item.seriesName, !series.isEmpty {
                    Text(series)
                        .font(theme.font(FaithfulTokens.Text.label))
                        .foregroundStyle(theme.palette.contentSecondary)
                }

                Text(item.title)
                    .font(theme.font(FaithfulTokens.Text.titleMedium))
                    .foregroundStyle(theme.palette.contentPrimary)
                    .fixedSize(horizontal: false, vertical: true)

                if let summary = item.summary, !summary.isEmpty {
                    Text(summary)
                        .font(theme.font(FaithfulTokens.Text.bodySmall))
                        .foregroundStyle(theme.palette.contentSecondary)
                        .lineLimit(3)
                        .fixedSize(horizontal: false, vertical: true)
                }

                if !item.scriptureRefs.isEmpty {
                    Text(item.scriptureRefs.joined(separator: " · "))
                        .font(theme.font(FaithfulTokens.Text.label))
                        .foregroundStyle(theme.palette.contentSecondary)
                }
            }
        }
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Detail

public struct SermonDetailView: View {
    @Environment(\.faithfulTheme) private var theme
    private let model: SermonDetailModel

    public init(model: SermonDetailModel) {
        self.model = model
    }

    public var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: FaithfulTokens.Spacing.lg) {
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
            .padding(.horizontal, FaithfulTokens.Layout.screenPaddingHorizontal)
            .padding(.vertical, FaithfulTokens.Spacing.xl)
        }
        .background(theme.palette.background)
        .task { await model.load() }
    }

    @ViewBuilder
    private func content(for detail: SermonDetail) -> some View {
        if let series = detail.seriesName, !series.isEmpty {
            Text(series)
                .font(theme.font(FaithfulTokens.Text.label))
                .foregroundStyle(theme.palette.contentSecondary)
        }

        Text(detail.title)
            .font(theme.font(FaithfulTokens.Text.titleLarge))
            .foregroundStyle(theme.palette.contentPrimary)
            .fixedSize(horizontal: false, vertical: true)

        if let summary = detail.summary, !summary.isEmpty {
            Text(summary)
                .font(theme.font(FaithfulTokens.Text.body))
                .foregroundStyle(theme.palette.contentSecondary)
                .fixedSize(horizontal: false, vertical: true)
        }

        if !detail.scriptureRefs.isEmpty {
            SermonSection(title: L.sermonsScriptureLabel) {
                Text(detail.scriptureRefs.joined(separator: " · "))
                    .font(theme.font(FaithfulTokens.Text.body))
                    .foregroundStyle(theme.palette.contentPrimary)
            }
        }

        if let outline = detail.outline {
            SermonSection(title: L.sermonsOutlineLabel) {
                VStack(alignment: .leading, spacing: FaithfulTokens.Spacing.md) {
                    if let intro = outline.intro, !intro.isEmpty {
                        Text(intro)
                            .font(theme.font(FaithfulTokens.Text.body))
                            .foregroundStyle(theme.palette.contentSecondary)
                            .fixedSize(horizontal: false, vertical: true)
                    }

                    ForEach(Array(outline.points.enumerated()), id: \.offset) { index, point in
                        VStack(alignment: .leading, spacing: FaithfulTokens.Spacing.xs) {
                            // Numbered because an outline *is* ordered — the
                            // points were preached in this sequence.
                            Text("\(index + 1). \(point.title)")
                                .font(theme.font(FaithfulTokens.Text.titleMedium))
                                .foregroundStyle(theme.palette.contentPrimary)
                                .fixedSize(horizontal: false, vertical: true)

                            if !point.summary.isEmpty {
                                Text(point.summary)
                                    .font(theme.font(FaithfulTokens.Text.bodySmall))
                                    .foregroundStyle(theme.palette.contentSecondary)
                                    .fixedSize(horizontal: false, vertical: true)
                            }

                            if let scripture = point.scripture, !scripture.isEmpty {
                                Text(scripture)
                                    .font(theme.font(FaithfulTokens.Text.label))
                                    .foregroundStyle(theme.palette.contentSecondary)
                            }
                        }
                    }

                    if let application = outline.application, !application.isEmpty {
                        VStack(alignment: .leading, spacing: FaithfulTokens.Spacing.xs) {
                            Text(L.sermonsApplicationLabel)
                                .font(theme.font(FaithfulTokens.Text.label))
                                .foregroundStyle(theme.palette.contentSecondary)
                            Text(application)
                                .font(theme.font(FaithfulTokens.Text.body))
                                .foregroundStyle(theme.palette.contentPrimary)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                    }

                    if let closing = outline.closing, !closing.isEmpty {
                        Text(closing)
                            .font(theme.font(FaithfulTokens.Text.body))
                            .foregroundStyle(theme.palette.contentSecondary)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
            }
        } else {
            Text(L.sermonsNotesOnly)
                .font(theme.font(FaithfulTokens.Text.bodySmall))
                .foregroundStyle(theme.palette.contentSecondary)
        }

        if !detail.discussionQuestions.isEmpty {
            SermonSection(title: L.sermonsQuestionsLabel) {
                VStack(alignment: .leading, spacing: FaithfulTokens.Spacing.sm) {
                    ForEach(Array(detail.discussionQuestions.enumerated()), id: \.offset) { _, item in
                        Text("• \(item.question)")
                            .font(theme.font(FaithfulTokens.Text.body))
                            .foregroundStyle(theme.palette.contentPrimary)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
            }
        }
    }
}

struct SermonSection<Content: View>: View {
    @Environment(\.faithfulTheme) private var theme
    let title: String
    @ViewBuilder let content: () -> Content

    var body: some View {
        FaithfulCard {
            VStack(alignment: .leading, spacing: FaithfulTokens.Spacing.sm) {
                Text(title)
                    .font(theme.font(FaithfulTokens.Text.label))
                    .foregroundStyle(theme.palette.contentSecondary)
                content()
            }
        }
    }
}

struct SermonMessage: View {
    @Environment(\.faithfulTheme) private var theme
    let title: String
    // Named `message` rather than `body`, which is `View`'s own requirement.
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
                    Button(actionTitle) { action() }
                        .buttonStyle(.borderedProminent)
                }
            }
        }
        .accessibilityElement(children: .combine)
    }
}
