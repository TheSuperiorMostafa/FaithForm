import SwiftUI
import FaithFormKit

/// Give: in the app with Apple Pay, or on the church's own page in Safari.
///
/// ## Which one, and who decides
///
/// `givingRoute(...)` in FaithFormKit, from three facts: whether Apple has
/// approved this church (the server's `applePayApproved`), whether this build
/// can offer Apple Pay (a merchant ID, present only where the entitlement is),
/// and whether this device can pay with it. All three, and the gift happens
/// here — guideline 3.2.1(vi). Anything less, and the person is sent to the
/// church's give page in Safari, which 3.2.2(iv) allows for any nonprofit and
/// which takes no commission. The decision is tested there, not re-derived here.
///
/// ## What the Safari path must never contain
///
/// An amount field, a payment sheet, or a view of a web page inside the app. It
/// shows what the church gives to, read-only, and one button that leaves.
struct GiveTabView: View {
    enum Route: Hashable {
        case amount
        case confirm
        case outcome
        case history
    }

    @Environment(\.faithformTheme) private var theme
    let root: RootModel
    let features: ChurchFeatures
    let isStale: Bool

    @State private var path: [Route] = []

    var body: some View {
        let model = features.giving

        NavigationStack(path: $path) {
            VStack(spacing: 0) {
                if isStale { OfflineBanner(message: L.offlineCached) }
                ScrollView {
                    home(model)
                        .padding(.horizontal, FaithFormTokens.Layout.screenPaddingHorizontal)
                        .padding(.vertical, FaithFormTokens.Spacing.lg)
                }
                .refreshable { await model.refresh() }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
            .background(theme.palette.background)
            .navigationTitle(L.givingTitle)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .principal) {
                    HStack(spacing: FaithFormTokens.Spacing.sm) {
                        if let church = root.selectedChurch {
                            ChurchAvatar(logoUrl: church.logoUrl, name: church.churchName, size: 28)
                            Text(church.churchName)
                                .font(theme.font(FaithFormTokens.Text.titleMedium))
                                .foregroundStyle(theme.palette.contentPrimary)
                                .lineLimit(1)
                        } else {
                            Text(L.givingTitle)
                                .font(theme.font(FaithFormTokens.Text.titleMedium))
                                .foregroundStyle(theme.palette.contentPrimary)
                        }
                    }
                }
            }
            .navigationDestination(for: Route.self) { route in
                destination(route, model: model)
            }
        }
        .task(id: features.key) { await model.load() }
        // A gift interrupted by a kill or a crash is asked about, never started
        // again. Kept apart from `load` because it can poll for a minute or
        // two, and the fund list should not wait on it.
        .task(id: features.key) { await model.resumeInterruptedDonation() }
        .onChange(of: model.donation) { _, phase in
            // A resumed gift has something to say; show it wherever the person
            // is, unless they are already looking at it.
            if case .awaitingConfirmation = phase, path.last != .outcome {
                path.append(.outcome)
            }
        }
    }

    // MARK: - The Give screen

    @ViewBuilder
    private func home(_ model: GivingModel) -> some View {
        if let home = model.listPhase.home {
            switch features.givingRoute(for: home) {
            case .inApp:
                GivingHomeView(
                    phase: model.listPhase,
                    selectedFund: model.selectedFund,
                    onSelect: { fund in
                        if model.selectedFund?.fundId != fund.fundId { model.amountText = "" }
                        model.selectedFund = fund
                        path.append(.amount)
                    },
                    onRetry: { Task { await model.load() } },
                    onHistory: { path.append(.history) }
                )
            case let .web(url):
                WebGivingView(home: home, url: url)
            case .unavailable:
                if home.availability == "available" {
                    // Accepting, yet neither door is open: no approval and no
                    // usable give page. The server never sends that on purpose,
                    // so say gifts cannot be taken here rather than listing funds
                    // a person has no way to give to.
                    EmptyStateView(
                        title: L.givingNotAcceptingTitle,
                        explanation: L.givingNotAcceptingBody,
                        symbol: "heart"
                    )
                } else {
                    // Not accepting, most often. The Kit's own screen says which
                    // empty this is, and offers nothing to tap.
                    GivingHomeView(
                        phase: model.listPhase,
                        selectedFund: nil,
                        onSelect: { _ in },
                        onRetry: { Task { await model.load() } },
                        onHistory: {}
                    )
                }
            }
        } else {
            // Loading, offline, blocked or failed: the Kit's screen draws all
            // of them, and none offers a gift.
            GivingHomeView(
                phase: model.listPhase,
                selectedFund: nil,
                onSelect: { _ in },
                onRetry: { Task { await model.load() } },
                onHistory: {}
            )
        }
    }

    // MARK: - The in-app flow

    @ViewBuilder
    private func destination(_ route: Route, model: GivingModel) -> some View {
        switch route {
        case .amount:
            if let fund = model.selectedFund {
                ScrollView {
                    GivingAmountView(
                        fund: fund,
                        amountText: Bindable(model).amountText,
                        result: model.amountResult,
                        onContinue: { path.append(.confirm) }
                    )
                    .padding(FaithFormTokens.Layout.screenPaddingHorizontal)
                }
                .background(theme.palette.background)
                .navigationTitle(fund.title)
                .navigationBarTitleDisplayMode(.inline)
            }

        case .confirm:
            if let fund = model.selectedFund, case let .valid(cents) = model.amountResult {
                ScrollView {
                    GivingConfirmView(
                        churchName: model.listPhase.home?.churchName ?? "",
                        fundTitle: fund.title,
                        amountCents: cents,
                        currency: fund.currency,
                        onGive: {
                            path.append(.outcome)
                            Task { await model.give() }
                        }
                    )
                    .padding(FaithFormTokens.Layout.screenPaddingHorizontal)
                }
                .background(theme.palette.background)
                .navigationBarTitleDisplayMode(.inline)
            }

        case .outcome:
            ScrollView {
                GivingOutcomeView(
                    phase: model.donation,
                    receipt: model.receipt,
                    pollingExhausted: model.pollingExhausted,
                    onDone: {
                        if case .confirmed = model.donation {
                            // A finished gift starts the next one from the top,
                            // with nothing of this one left in the field.
                            model.amountText = ""
                            path.removeAll()
                        } else if path.count > 1 {
                            // Declined, cancelled or unreachable: back to the
                            // confirmation, where trying again is one tap.
                            path.removeLast()
                        } else {
                            path.removeAll()
                        }
                    }
                )
                .padding(FaithFormTokens.Layout.screenPaddingHorizontal)
            }
            .background(theme.palette.background)
            // No way back while the server is still deciding: leaving would not
            // stop the gift, only the person's view of it. Once polling has
            // given up the screen says the receipt will follow, has no button
            // of its own, and so must let the person leave.
            .navigationBarBackButtonHidden(
                Self.isInFlight(model.donation) && !model.pollingExhausted
            )
            .navigationBarTitleDisplayMode(.inline)

        case .history:
            ScrollView {
                GivingHistoryView(items: model.history, isLoading: model.historyLoading)
                    .padding(FaithFormTokens.Layout.screenPaddingHorizontal)
            }
            .background(theme.palette.background)
            .navigationTitle(L.givingHistoryTitle)
            .navigationBarTitleDisplayMode(.inline)
            .task { await model.loadHistory() }
        }
    }

    nonisolated static func isInFlight(_ phase: DonationPhase) -> Bool {
        switch phase {
        case .preparing, .presenting, .awaitingConfirmation: return true
        default: return false
        }
    }
}

// MARK: - Safari

/// A church whose gifts are made on its own give page.
///
/// What it gives to, so a person knows before they leave, and one button that
/// opens the page in Safari through `openURL`. No amount, no fund choice that
/// would pretend to carry over, and no web page inside the app.
struct WebGivingView: View {
    @Environment(\.faithformTheme) private var theme
    @Environment(\.openURL) private var openURL
    let home: GivingHome
    let url: URL

    var body: some View {
        VStack(alignment: .leading, spacing: FaithFormTokens.Spacing.lg) {
            VStack(alignment: .leading, spacing: FaithFormTokens.Spacing.xs) {
                if let name = home.churchName {
                    Text(name)
                        .font(theme.font(FaithFormTokens.Text.displayLarge))
                        .foregroundStyle(theme.palette.contentPrimary)
                }
                Text(L.givingWebBody)
                    .font(theme.font(FaithFormTokens.Text.body))
                    .foregroundStyle(theme.palette.contentSecondary)
            }
            .fixedSize(horizontal: false, vertical: true)

            Button {
                openURL(url)
            } label: {
                Label(L.givingGiveOnline, systemImage: "safari")
            }
            .buttonStyle(FaithFormButtonStyle(kind: .primary, theme: theme))

            // Read-only: the description is how each fund is used, and a person
            // deciding where to give deserves it before they go.
            ForEach(home.funds, id: \.fundId) { fund in
                FaithFormCard {
                    VStack(alignment: .leading, spacing: FaithFormTokens.Spacing.sm) {
                        Text(fund.title)
                            .font(theme.font(FaithFormTokens.Text.titleMedium))
                            .foregroundStyle(theme.palette.contentPrimary)
                            .fixedSize(horizontal: false, vertical: true)
                        if let description = fund.description, !description.isEmpty {
                            Text(description)
                                .font(theme.font(FaithFormTokens.Text.bodySmall))
                                .foregroundStyle(theme.palette.contentSecondary)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                    }
                }
                .accessibilityElement(children: .combine)
            }

            if home.recurringAvailable {
                Text(L.givingRecurringElsewhere)
                    .font(theme.font(FaithFormTokens.Text.caption))
                    .foregroundStyle(theme.palette.contentSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}
