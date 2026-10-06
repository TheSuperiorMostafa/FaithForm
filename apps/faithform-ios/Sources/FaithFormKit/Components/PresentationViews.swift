import SwiftUI

/// Published slide decks for a church.
///
/// Mirrors `SermonListView`: the model owns load/search/paging; this view only
/// draws. Under Services' Sermons | Slides control, pass `showTitle: false`.
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
                    PresentationListSkeleton()

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

                case let .loaded(items, isStale):
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

                    if isStale {
                        OfflineBanner(message: L.offlineCached)
                    }

                    if items.isEmpty {
                        EmptyStateView(
                            title: model.submittedQuery.isEmpty ? L.presentationsEmpty : L.presentationsEmptySearch,
                            explanation: "",
                            symbol: model.submittedQuery.isEmpty ? "rectangle.on.rectangle" : "magnifyingglass"
                        )
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
                            PresentationCardSkeleton()
                                .skeletonShimmer()
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
                ZStack {
                    SlideDeckBackground(
                        snapshot: item.theme,
                        fallback: theme.palette.brandPrimary
                    )
                    LinearGradient(
                        colors: [
                            Color.black.opacity(item.thumbnailUrl != nil || item.theme?.imageUrl != nil ? 0.35 : 0.10),
                            Color.black.opacity(item.thumbnailUrl != nil || item.theme?.imageUrl != nil ? 0.65 : 0.35),
                        ],
                        startPoint: .top,
                        endPoint: .bottom
                    )
                    VStack(spacing: FaithFormTokens.Spacing.xs) {
                        Spacer()
                        Text(item.title)
                            .font(.system(size: 16, weight: .bold))
                            .foregroundStyle(Color(hex: item.theme?.text) ?? .white)
                            .multilineTextAlignment(.center)
                            .lineLimit(2)
                            .shadow(color: item.theme?.textShadow == true ? Color.black.opacity(0.7) : Color.black.opacity(0.3), radius: 2, y: 1)
                            .padding(.horizontal, FaithFormTokens.Spacing.md)

                        let ref = item.scriptureRefs.first ?? item.seriesName
                        if let ref, !ref.isEmpty {
                            Text(ref)
                                .font(
                                    item.theme?.italicRef ?? true
                                        ? .system(size: 12, weight: .medium).italic()
                                        : .system(size: 12, weight: .medium)
                                )
                                .foregroundStyle(Color(hex: item.theme?.accent) ?? theme.palette.brandAccent)
                                .lineLimit(1)
                                .shadow(color: Color.black.opacity(0.5), radius: 2, y: 1)
                        }
                        Spacer()
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)

                    VStack {
                        Spacer()
                        HStack {
                            Spacer()
                            HStack(spacing: 4) {
                                Image(systemName: "rectangle.inset.filled.and.person.filled")
                                    .font(.system(size: 10, weight: .semibold))
                                Text(String(format: L.presentationsPageCount, item.pageCount))
                                    .font(.system(size: 11, weight: .semibold))
                            }
                            .foregroundStyle(.white)
                            .padding(.horizontal, 8)
                            .padding(.vertical, 4)
                            .background(Capsule().fill(Color.black.opacity(0.65)))
                            .overlay(Capsule().strokeBorder(Color.white.opacity(0.2), lineWidth: 0.5))
                            .padding(FaithFormTokens.Spacing.sm)
                        }
                    }
                }
                .aspectRatio(16.0 / 9.0, contentMode: .fit)
                .clipShape(RoundedRectangle(cornerRadius: FaithFormTokens.Radius.sm, style: .continuous))

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
    let model: PresentationDetailModel

    public init(model: PresentationDetailModel) {
        self.model = model
    }

    public var body: some View {
        Group {
            switch model.phase {
            case .loading:
                SlideSkeleton()

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
                let pages = PresentationReadingPages.expand(detail.pages)
                if pages.isEmpty {
                    SermonMessage(
                        title: L.presentationsEmpty,
                        message: ""
                    )
                    .padding(FaithFormTokens.Spacing.xl)
                } else {
                    TabView {
                        ForEach(Array(pages.enumerated()), id: \.element.id) { index, page in
                            Color.clear
                                .overlay {
                                    SlidePageView(
                                        page: page,
                                        theme: detail.theme,
                                        index: index,
                                        total: pages.count
                                    )
                                }
                                .clipShape(Rectangle())
                                .contentShape(Rectangle())
                        }
                    }
                    #if os(iOS)
                    .tabViewStyle(.page(indexDisplayMode: .automatic))
                    #endif
                    .clipShape(Rectangle())
                    .navigationTitle(detail.title)
                    #if os(iOS)
                    .navigationBarTitleDisplayMode(.inline)
                    #endif
                }
            }
        }
        .task { await model.load() }
    }
}

/// Solid colour, or the theme photo already stored on the published deck.
///
/// Photo themes used to fall through to `bg` only, so a stained-glass or
/// landscape deck opened as a flat navy panel on the phone.
struct SlideDeckBackground: View {
    let snapshot: PresentationTheme?
    let fallback: Color

    var body: some View {
        let fill = Color(hex: snapshot?.bg) ?? fallback
        GeometryReader { geo in
            ZStack {
                fill
                if snapshot?.backgroundType == "image",
                   let raw = snapshot?.imageUrl?.trimmingCharacters(in: .whitespacesAndNewlines),
                   !raw.isEmpty,
                   let url = URL(string: raw) {
                    AsyncImage(url: url) { phase in
                        switch phase {
                        case let .success(image):
                            ZStack {
                                image
                                    .resizable()
                                    .scaledToFill()
                                    .frame(width: geo.size.width, height: geo.size.height)
                                    .clipped()
                                if snapshot?.textShadow == true {
                                    Color.black.opacity(0.25)
                                }
                            }
                        default:
                            Color.clear
                        }
                    }
                    .frame(width: geo.size.width, height: geo.size.height)
                    .clipped()
                    .accessibilityHidden(true)
                }
            }
            .frame(width: geo.size.width, height: geo.size.height)
            .clipped()
        }
    }
}

private struct SlidePageView: View {
    @Environment(\.faithformTheme) private var faithTheme
    let page: PresentationPage
    let theme: PresentationTheme?
    let index: Int
    let total: Int

    var body: some View {
        let textColor = Color(hex: theme?.text) ?? .white
        let accent = Color(hex: theme?.accent) ?? faithTheme.palette.brandAccent
        let italicScripture = theme?.italicRef ?? true
        let textShadow = theme?.textShadow == true ? Color.black.opacity(0.35) : Color.clear

        ZStack {
            SlideDeckBackground(
                snapshot: theme,
                fallback: Color(hex: theme?.bg) ?? .black
            )
            VStack(spacing: 0) {
                Spacer(minLength: FaithFormTokens.Spacing.xxl)

                ViewThatFits(in: .vertical) {
                    ForEach(Array(stride(from: 2.0, through: 0.4, by: -0.1)), id: \.self) { scale in
                        slideText(scale: CGFloat(scale), textColor: textColor, accent: accent,
                                  italicScripture: italicScripture, textShadow: textShadow)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }

                Spacer(minLength: FaithFormTokens.Spacing.xl)

                Text("\(index + 1) / \(total)")
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(textColor.opacity(0.55))
                    .frame(maxWidth: .infinity)
                    .accessibilityHidden(true)
            }
            .padding(.horizontal, FaithFormTokens.Spacing.xxl)
            .padding(.vertical, FaithFormTokens.Spacing.xl)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .compositingGroup()
        .clipped()
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
        .accessibilityLabel(accessibilityReading)
    }

    private func slideText(scale: CGFloat, textColor: Color, accent: Color,
                           italicScripture: Bool, textShadow: Color) -> some View {
        VStack(spacing: FaithFormTokens.Spacing.lg * scale) {
                    if let title = page.title, !title.isEmpty {
                        Text(title)
                            .font(.system(size: 36 * scale, weight: .semibold))
                            .foregroundStyle(textColor)
                            .shadow(color: textShadow, radius: 3, y: 1)
                            .multilineTextAlignment(.center)
                            .fixedSize(horizontal: false, vertical: true)
                    }

                    if let scripture = page.scripture, !scripture.isEmpty {
                        Text(scripture)
                            .font(
                                italicScripture
                                    ? .system(size: 24 * scale, weight: .medium).italic()
                                    : .system(size: 24 * scale, weight: .medium)
                            )
                            .foregroundStyle(accent)
                            .shadow(color: textShadow, radius: 3, y: 1)
                            .multilineTextAlignment(.center)
                            .fixedSize(horizontal: false, vertical: true)
                    }

                    if let body = page.body, !body.isEmpty {
                        Text(body)
                            .font(.system(size: 22 * scale, weight: .regular))
                            .foregroundStyle(textColor.opacity(0.94))
                            .lineSpacing(6 * scale)
                            .shadow(color: textShadow, radius: 3, y: 1)
                            .multilineTextAlignment(.center)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
                .frame(maxWidth: .infinity)

    }

    private var accessibilityReading: String {
        let ordered = page.readingOrder.compactMap { key -> String? in
            switch key {
            case "title": return page.title
            case "scripture": return page.scripture
            case "body": return page.body
            default: return nil
            }
        }
        .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
        .filter { !$0.isEmpty }

        if !ordered.isEmpty { return ordered.joined(separator: ". ") }
        return [page.title, page.scripture, page.body]
            .compactMap { $0 }
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
            .joined(separator: ". ")
    }
}

