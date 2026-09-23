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
///
/// It *does* list the person's existing recurring gifts, with a way to stop
/// them, because none of those three things is one of these. Stopping a gift
/// moves no money and asks for none; it is account management, and a monthly
/// charge somebody can see nowhere and stop nowhere is the outcome this feature
/// most has to avoid.
struct GiveTabView: View {
    enum Route: Hashable {
        case amount
        case confirm
        case outcome
        case history
        /// The recurring counterparts. Separate cases rather than a flag on the
        /// existing ones, so a half-finished one-time gift and a half-finished
        /// recurring one can never be shown the same screen.
        case recurringConfirm
        case recurringOutcome
    }

    @Environment(\.faithformTheme) private var theme
    let root: RootModel
    let features: ChurchFeatures
    let isStale: Bool

    @State private var path: [Route] = []
    @State private var mode: GivingModeSelector.Mode = .once
    /// The gift a person has asked to stop, held only while the alert is up.
    @State private var stopping: RecurringGift?

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
        // What a person already gives, loaded alongside the funds rather than
        // after them: the list is on the same screen, and a section that
        // appears a second late reads as one that failed.
        .task(id: features.key) {
            await model.resumeInterruptedRecurring()
            await model.loadRecurring()
        }
        // Asked once, in words, before anything stops. Not a swipe, not an
        // overflow menu — and the confirming button is the plain one, because
        // stopping a gift destroys nothing.
        .alert(
            stopping.map { L.givingStopRecurringConfirm(giftPhrase($0)) } ?? "",
            isPresented: Binding(
                get: { stopping != nil },
                set: { if !$0 { stopping = nil } }
            ),
            presenting: stopping
        ) { gift in
            Button(L.givingStopRecurringConfirmAction) {
                stopping = nil
                Task { await model.stopRecurring(subscriptionID: gift.subscriptionId) }
            }
            Button(L.givingKeepGiving, role: .cancel) { stopping = nil }
        } message: { _ in
            Text(L.givingStopRecurringBody)
        }
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
                VStack(alignment: .leading, spacing: FaithFormTokens.Layout.sectionGap) {
                    // Only offered when the server says this church can take
                    // one. A selector with a segment that cannot work is worse
                    // than no selector.
                    if home.recurringAvailable {
                        GivingModeSelector(mode: $mode)
                    }

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

                    // Listed whatever the selector says. What somebody already
                    // gives is not a mode they have to switch into to see — and
                    // a recurring charge that is only visible behind a toggle is
                    // a recurring charge somebody will miss.
                    RecurringGiftsSection(
                        gifts: model.recurringGifts,
                        isLoading: model.recurringLoading,
                        stoppingID: model.stoppingID,
                        stopFailed: model.stopFailed,
                        onStop: { stopping = $0 }
                    )
                }
            case let .web(url):
                VStack(alignment: .leading, spacing: FaithFormTokens.Layout.sectionGap) {
                    WebGivingView(home: home, url: url)

                    // Shown here too, and the distinction is the whole reason
                    // it is allowed to be: **stopping a gift is not giving
                    // one.** No amount, no payment sheet, no money moving — so
                    // nothing here is the in-app donation guideline 3.2.1(vi)
                    // reserves for approved nonprofits.
                    //
                    // Leaving it out would mean a person who set up a monthly
                    // gift on this church's own page could see it nowhere and
                    // stop it nowhere, which is the failure this whole feature
                    // exists to avoid.
                    RecurringGiftsSection(
                        gifts: model.recurringGifts,
                        isLoading: model.recurringLoading,
                        stoppingID: model.stoppingID,
                        stopFailed: model.stopFailed,
                        onStop: { stopping = $0 }
                    )
                }
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
                    VStack(alignment: .leading, spacing: FaithFormTokens.Spacing.lg) {
                        if mode == .recurring {
                            GivingCadencePicker(cadence: Bindable(model).cadence)
                        }
                        GivingAmountView(
                            fund: fund,
                            amountText: Bindable(model).amountText,
                            result: model.amountResult,
                            onContinue: {
                                path.append(mode == .recurring ? .recurringConfirm : .confirm)
                            }
                        )
                    }
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

        case .recurringConfirm:
            if let fund = model.selectedFund, case let .valid(cents) = model.amountResult {
                ScrollView {
                    GivingRecurringConfirmView(
                        churchName: model.listPhase.home?.churchName ?? "",
                        fundTitle: fund.title,
                        amountCents: cents,
                        currency: fund.currency,
                        cadence: model.cadence,
                        onStart: {
                            path.append(.recurringOutcome)
                            Task { await model.startRecurring() }
                        }
                    )
                    .padding(FaithFormTokens.Layout.screenPaddingHorizontal)
                }
                .background(theme.palette.background)
                .navigationBarTitleDisplayMode(.inline)
            }

        case .recurringOutcome:
            ScrollView {
                GivingRecurringOutcomeView(
                    phase: model.recurring,
                    onDone: {
                        if case .started = model.recurring {
                            // A finished set-up starts the next one from the
                            // top, with nothing of this one left in the field.
                            model.amountText = ""
                            mode = .once
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
            // No way back while the subscription is being created. Leaving
            // would not stop it, only the person's view of it.
            .navigationBarBackButtonHidden(Self.isRecurringInFlight(model.recurring))
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

    /// How the alert names the gift: the same words its row shows.
    ///
    /// A confirmation that said "stop this gift?" would be asking somebody to
    /// match it against a card the alert is covering.
    private func giftPhrase(_ gift: RecurringGift) -> String {
        let amount = formatGivingAmount(cents: gift.amountCents, currency: gift.currency)
        switch GivingInterval(rawValue: gift.interval) {
        case .week: return L.givingEveryWeekAmount(amount)
        case .month: return L.givingEveryMonthAmount(amount)
        default: return "\(amount) · \(recurringIntervalTitle(gift.interval))"
        }
    }

    nonisolated static func isInFlight(_ phase: DonationPhase) -> Bool {
        switch phase {
        case .preparing, .presenting, .awaitingConfirmation: return true
        default: return false
        }
    }

    /// Whether a recurring gift is mid-creation.
    ///
    /// `started` is **not** in flight: the subscription exists by then and the
    /// screen has a button of its own, so the person must be able to leave.
    nonisolated static func isRecurringInFlight(_ phase: RecurringPhase) -> Bool {
        switch phase {
        case .preparing, .presenting: return true
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
