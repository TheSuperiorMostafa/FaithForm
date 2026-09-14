import SwiftUI

/// Published slide decks for a church.
///
/// Mirrors `SermonListView`: the model owns load/search/paging; this view only
/// draws. Under Messages' Notes | Slides control, pass `showTitle: false`.
public struct PresentationListView: View {
    @Environment(\.faithformTheme) private var theme
    private let model: PresentationModel
    private let onOpen: @MainActor (PresentationListItem) -> Void
    private let showTitle: Bool

    public init(
        model: PresentationModel,
        onOpen: @escaping @MainActor (PresentationListItem) -> Void,
        showTitle: Bool = true
    ) {
        self.model = model
        self.onOpen = onOpen
        self.showTitle = showTitle
    }

    public var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: FaithFormTokens.Spacing.lg) {
                switch model.phase {
                case .idle, .loading:
                    ProgressView().accessibilityLabel(L.mediaLoading)

                case .blocked:
                    SermonMessage(
                        title: L.presentationsBlockedTitle,
                        message: L.presentationsBlockedBody
                    )

                case .offline:
                    SermonMessage(
                        title: L.presentationsOfflineTitle,
                        message: L.presentationsOfflineBody,
                        actionTitle: L.presentationsRetry
                    ) {
                        Task { await model.refresh() }
                    }

                case .failed(let message):
                    SermonMessage(
                        title: message,
                        message: "",
                        actionTitle: L.presentationsRetry
                    ) {
                        Task { await model.refresh() }
                    }

                case let .loaded(items, _):
                    if showTitle {
                        Text(L.presentationsTitle)
                            .font(theme.font(FaithFormTokens.Text.titleMedium))
                            .foregroundStyle(theme.palette.contentPrimary)
                    }

                    FaithFormSearchField(
                        placeholder: L.presentationsSearchLabel,
                        text: Bindable(model).searchTerm,
                        onSubmit: { Task { await model.search(model.searchTerm) } },
                        onClear: { Task { await model.searchTextChanged() } }
                    )

                    if items.isEmpty {
                        Text(
                            model.submittedQuery.isEmpty
                                ? L.presentationsEmpty
                                : L.presentationsEmptySearch
                        )
                        .font(theme.font(FaithFormTokens.Text.body))
                        .foregroundStyle(theme.palette.contentSecondary)
                    } else {
                        ForEach(items, id: \.presentationId) { item in
                            Button { onOpen(item) } label: {
                                PresentationCard(item: item)
                            }
                            .buttonStyle(.plain)
                            .onAppear {
                                if item.presentationId == items.last?.presentationId {
                                    Task { await model.loadMore() }
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

struct PresentationCard: View {
    @Environment(\.faithformTheme) private var theme
    let item: PresentationListItem

    var body: some View {
        FaithFormCard {
            VStack(alignment: .leading, spacing: FaithFormTokens.Spacing.sm) {
                let meta = [
                    item.seriesName,
                    String(format: L.presentationsPageCount, item.pageCount),
                ].compactMap { $0 }.filter { !$0.isEmpty }

                if !meta.isEmpty {
                    Text(meta.joined(separator: " · "))
                        .font(theme.font(FaithFormTokens.Text.caption))
                        .foregroundStyle(theme.palette.contentSecondary)
                }

                Text(item.title)
                    .font(theme.font(FaithFormTokens.Text.titleMedium))
                    .foregroundStyle(theme.palette.contentPrimary)
                    .multilineTextAlignment(.leading)
                    .fixedSize(horizontal: false, vertical: true)

                if !item.scriptureRefs.isEmpty {
                    Text(item.scriptureRefs.joined(separator: " · "))
                        .font(theme.font(FaithFormTokens.Text.bodySmall))
                        .foregroundStyle(theme.palette.brandAccent)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isButton)
    }
}

/// Full-screen horizontal slide pager over semantic pages.
public struct PresentationViewer: View {
    @Environment(\.faithformTheme) private var theme
    let model: PresentationDetailModel

    public init(model: PresentationDetailModel) {
        self.model = model
    }

    public var body: some View {
        Group {
            switch model.phase {
            case .loading:
                ProgressView()
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .accessibilityLabel(L.mediaLoading)

            case .unavailable:
                SermonMessage(
                    title: L.presentationsUnavailableTitle,
                    message: L.presentationsUnavailableBody
                )
                .padding(FaithFormTokens.Spacing.xl)

            case .offline:
                SermonMessage(
                    title: L.presentationsOfflineTitle,
                    message: L.presentationsOfflineBody,
                    actionTitle: L.presentationsRetry
                ) {
                    Task { await model.load() }
                }
                .padding(FaithFormTokens.Spacing.xl)

            case .failed(let message):
                SermonMessage(
                    title: message,
                    message: "",
                    actionTitle: L.presentationsRetry
                ) {
                    Task { await model.load() }
                }
                .padding(FaithFormTokens.Spacing.xl)

            case let .loaded(detail):
                TabView {
                    ForEach(Array(detail.pages.enumerated()), id: \.element.id) { index, page in
                        SlidePageView(
                            page: page,
                            theme: detail.theme,
                            index: index,
                            total: detail.pages.count
                        )
                    }
                }
                .tabViewStyle(.page(indexDisplayMode: .automatic))
                .background(slideBackground(detail.theme))
                .navigationTitle(detail.title)
                .navigationBarTitleDisplayMode(.inline)
            }
        }
        .task { await model.load() }
    }

    private func slideBackground(_ snapshot: PresentationTheme?) -> Color {
        if let hex = snapshot?.bg, let color = Color(hex: hex) { return color }
        return theme.palette.brandPrimary
    }
}

private struct SlidePageView: View {
    let page: PresentationPage
    let theme: PresentationTheme?
    let index: Int
    let total: Int

    var body: some View {
        let textColor = Color(hex: theme?.text) ?? .white
        let accent = Color(hex: theme?.accent) ?? Color(red: 0.77, green: 0.63, blue: 0.35)
        let italicScripture = theme?.italicRef ?? true

        VStack(alignment: .leading, spacing: FaithFormTokens.Spacing.lg) {
            Spacer(minLength: FaithFormTokens.Spacing.xl)

            if let title = page.title, !title.isEmpty {
                Text(title)
                    .font(.system(size: 28, weight: .semibold))
                    .foregroundStyle(textColor)
                    .shadow(color: theme?.textShadow == true ? .black.opacity(0.35) : .clear, radius: 2, y: 1)
                    .fixedSize(horizontal: false, vertical: true)
            }

            if let scripture = page.scripture, !scripture.isEmpty {
                Text(scripture)
                    .font(
                        italicScripture
                            ? .system(size: 18, weight: .medium).italic()
                            : .system(size: 18, weight: .medium)
                    )
                    .foregroundStyle(accent)
                    .fixedSize(horizontal: false, vertical: true)
            }

            if let body = page.body, !body.isEmpty {
                Text(body)
                    .font(.system(size: 20, weight: .regular))
                    .foregroundStyle(textColor.opacity(0.92))
                    .fixedSize(horizontal: false, vertical: true)
            }

            Spacer()

            Text("\(index + 1) / \(total)")
                .font(.caption)
                .foregroundStyle(textColor.opacity(0.6))
                .accessibilityHidden(true)
        }
        .padding(FaithFormTokens.Spacing.xl)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(accessibilityReading)
    }

    private var accessibilityReading: String {
        let parts = page.readingOrder.filter { !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
        if !parts.isEmpty { return parts.joined(separator: ". ") }
        return [page.title, page.scripture, page.body]
            .compactMap { $0 }
            .filter { !$0.isEmpty }
            .joined(separator: ". ")
    }
}

private extension Color {
    init?(hex: String?) {
        guard var hex else { return nil }
        hex = hex.trimmingCharacters(in: CharacterSet.alphanumerics.inverted)
        var int: UInt64 = 0
        guard Scanner(string: hex).scanHexInt64(&int) else { return nil }
        let r, g, b: UInt64
        switch hex.count {
        case 6: (r, g, b) = (int >> 16, int >> 8 & 0xFF, int & 0xFF)
        case 8: (r, g, b) = (int >> 16 & 0xFF, int >> 8 & 0xFF, int & 0xFF)
        default: return nil
        }
        self.init(.sRGB, red: Double(r) / 255, green: Double(g) / 255, blue: Double(b) / 255, opacity: 1)
    }
}
