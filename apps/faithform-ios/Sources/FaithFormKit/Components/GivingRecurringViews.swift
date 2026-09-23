import SwiftUI

/// Recurring giving, drawn.
///
/// Same rule as the rest of the Give experience: nothing here starts a payment
/// or asks the server for anything. Each view reports an intent upward and
/// `GivingModel` is the only thing that calls the client — which is what keeps
/// "opening a screen does not present a payment sheet" a property of the
/// structure rather than a rule someone has to remember.
///
/// ## What these screens will not do
///
/// Not one of them nags. There is no "make it monthly?" prompt after a one-time
/// gift, no badge suggesting a person gives too little, no comparison with
/// anyone else, and no default cadence dressed up as a recommendation. A church
/// asking for money has to be more careful than an app selling something, not
/// less, and the interface is where that care is either visible or absent.

// MARK: - Once or regularly

/// The choice between a single gift and a recurring one.
///
/// A segmented control rather than a toggle or a checkbox on the amount screen,
/// because the two are genuinely different things a person is doing — not one
/// thing with a modifier. Both are equally weighted: neither segment is styled
/// as the recommended one.
public struct GivingModeSelector: View {
    public enum Mode: Hashable, Sendable, CaseIterable {
        case once
        case recurring

        var title: String {
            switch self {
            case .once: return L.givingOnceTitle
            case .recurring: return L.givingRecurringTitle
            }
        }
    }

    @Environment(\.faithformTheme) private var theme
    @Binding private var mode: Mode
    @Namespace private var indicator

    public init(mode: Binding<Mode>) {
        self._mode = mode
    }

    public var body: some View {
        HStack(spacing: FaithFormTokens.Spacing.xs) {
            ForEach(Mode.allCases, id: \.self) { candidate in
                segment(candidate)
            }
        }
        .padding(FaithFormTokens.Spacing.xs)
        .background(
            RoundedRectangle(cornerRadius: FaithFormTokens.Radius.pill, style: .continuous)
                .fill(theme.palette.surfaceSunken)
        )
        // One control to VoiceOver, not two buttons that happen to sit together.
        .accessibilityElement(children: .contain)
        .accessibilityLabel(L.givingHowOften)
    }

    @ViewBuilder
    private func segment(_ candidate: Mode) -> some View {
        let isSelected = mode == candidate

        Button {
            // Reduce Motion is honoured by `withAnimation` reading the
            // environment, and the token exists so the duration matches every
            // other transition in the app rather than being chosen here.
            withAnimation(.easeOut(duration: FaithFormTokens.Motion.fast)) {
                mode = candidate
            }
        } label: {
            Text(candidate.title)
                .font(theme.font(FaithFormTokens.Text.titleMedium))
                .foregroundStyle(
                    isSelected ? theme.palette.contentPrimary : theme.palette.contentSecondary
                )
                .frame(maxWidth: .infinity)
                .padding(.vertical, FaithFormTokens.Spacing.md)
                .background {
                    if isSelected {
                        RoundedRectangle(
                            cornerRadius: FaithFormTokens.Radius.pill,
                            style: .continuous
                        )
                        .fill(theme.palette.surface)
                        .matchedGeometryEffect(id: "selected", in: indicator)
                    }
                }
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        // Selection is a *trait*, not a colour. A fill nobody can see is not a
        // selection, and "selected" is what a screen reader needs to hear.
        .accessibilityAddTraits(isSelected ? [.isButton, .isSelected] : .isButton)
    }
}

// MARK: - How often

/// Weekly or monthly.
///
/// Only the two cadences the app offers. A church's annual gift started on its
/// own web page still *lists* — `recurringIntervalTitle` renders it — but
/// offering "every year" here would put a rarely-right third option in front of
/// everyone to serve the few.
public struct GivingCadencePicker: View {
    @Environment(\.faithformTheme) private var theme
    @Binding private var cadence: RecurringCadence

    public init(cadence: Binding<RecurringCadence>) {
        self._cadence = cadence
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: FaithFormTokens.Spacing.sm) {
            Text(L.givingHowOften)
                .font(theme.font(FaithFormTokens.Text.label))
                .foregroundStyle(theme.palette.contentSecondary)

            // Wraps rather than scrolls, like the amount chips: an option a
            // person cannot reach is an option that is not there, and at large
            // text sizes a row of them will not fit.
            FlowRow(spacing: FaithFormTokens.Spacing.sm) {
                ForEach(RecurringCadence.allCases, id: \.self) { candidate in
                    Button(candidate.title) {
                        cadence = candidate
                    }
                    .buttonStyle(
                        FaithFormButtonStyle(
                            kind: cadence == candidate ? .primary : .secondary,
                            theme: theme
                        )
                    )
                    .accessibilityAddTraits(
                        cadence == candidate ? [.isButton, .isSelected] : .isButton
                    )
                }
            }
        }
    }
}

// MARK: - Confirming

/// The last screen before a payment sheet, for a gift that repeats.
///
/// Says the cadence in the same breath as the amount — "$25 every month" — so
/// nobody can read the number without the cadence attached. It also says, in
/// plain words, that the first gift is today and that stopping is one tap from
/// this screen. Somebody about to set up a repeating charge deserves to know
/// how to end it **before** they start it, not afterwards.
public struct GivingRecurringConfirmView: View {
    @Environment(\.faithformTheme) private var theme
    private let churchName: String
    private let fundTitle: String
    private let amountCents: Int
    private let currency: String
    private let cadence: RecurringCadence
    private let onStart: @MainActor () -> Void

    public init(
        churchName: String,
        fundTitle: String,
        amountCents: Int,
        currency: String,
        cadence: RecurringCadence,
        onStart: @escaping @MainActor () -> Void
    ) {
        self.churchName = churchName
        self.fundTitle = fundTitle
        self.amountCents = amountCents
        self.currency = currency
        self.cadence = cadence
        self.onStart = onStart
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: FaithFormTokens.Spacing.lg) {
            Text(L.givingConfirmTitle)
                .font(theme.font(FaithFormTokens.Text.displayLarge))
                .foregroundStyle(theme.palette.contentPrimary)
                .fixedSize(horizontal: false, vertical: true)

            FaithFormCard {
                VStack(alignment: .leading, spacing: FaithFormTokens.Spacing.md) {
                    // The amount leads, at display weight and with the cadence
                    // inside the same sentence. A person checking what they are
                    // about to commit to should find it without reading a table.
                    Text(cadence.amountPhrase(
                        formatGivingAmount(cents: amountCents, currency: currency)
                    ))
                    .font(theme.font(FaithFormTokens.Text.displayMedium))
                    .foregroundStyle(theme.palette.contentPrimary)
                    .fixedSize(horizontal: false, vertical: true)

                    Divider().overlay(theme.palette.divider)

                    row(L.givingConfirmChurch, churchName)
                    row(L.givingConfirmFund, fundTitle)
                }
            }

            Text(L.givingRecurringConfirmBody)
                .font(theme.font(FaithFormTokens.Text.bodySmall))
                .foregroundStyle(theme.palette.contentSecondary)
                .fixedSize(horizontal: false, vertical: true)

            Button(L.givingStartRecurring, action: onStart)
                .buttonStyle(FaithFormButtonStyle(kind: .primary, theme: theme))
        }
    }

    private func row(_ label: String, _ value: String) -> some View {
        HStack(alignment: .firstTextBaseline) {
            Text(label)
                .font(theme.font(FaithFormTokens.Text.bodySmall))
                .foregroundStyle(theme.palette.contentSecondary)
            Spacer(minLength: FaithFormTokens.Spacing.md)
            Text(value)
                .font(theme.font(FaithFormTokens.Text.body))
                .foregroundStyle(theme.palette.contentPrimary)
                .multilineTextAlignment(.trailing)
        }
        .fixedSize(horizontal: false, vertical: true)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - What happened

/// The outcome of starting a recurring gift.
///
/// The success wording is deliberately careful: **"we're confirming the first
/// payment"**, not "your gift is active". The sheet closing means an SDK
/// finished; whether the subscription is active is the webhook's to say, and it
/// says it in the list below rather than here.
public struct GivingRecurringOutcomeView: View {
    @Environment(\.faithformTheme) private var theme
    private let phase: RecurringPhase
    private let onDone: @MainActor () -> Void

    public init(phase: RecurringPhase, onDone: @escaping @MainActor () -> Void) {
        self.phase = phase
        self.onDone = onDone
    }

    public var body: some View {
        switch phase {
        case .idle, .preparing, .presenting:
            FaithFormWorkingLabel(L.givingLoading, working: true)
                .font(theme.font(FaithFormTokens.Text.titleMedium))
                .foregroundStyle(theme.palette.contentPrimary)
                .frame(maxWidth: .infinity)
                .padding(FaithFormTokens.Spacing.xl)

        case .started:
            VStack(spacing: FaithFormTokens.Spacing.lg) {
                EmptyStateView(
                    title: L.givingRecurringStartedTitle,
                    explanation: L.givingRecurringStartedBody,
                    symbol: "arrow.clockwise.heart"
                )
                Button(L.givingContinue, action: onDone)
                    .buttonStyle(FaithFormButtonStyle(kind: .primary, theme: theme))
            }

        case let .failed(reason, _):
            VStack(spacing: FaithFormTokens.Spacing.md) {
                EmptyStateView(
                    title: L.givingFailedTitle,
                    explanation: message(for: reason),
                    symbol: "exclamationmark.triangle"
                )
                Button(L.givingRetry, action: onDone)
                    .buttonStyle(FaithFormButtonStyle(kind: .secondary, theme: theme))
            }

        case .cancelled:
            VStack(spacing: FaithFormTokens.Spacing.md) {
                EmptyStateView(
                    title: L.givingCancelledTitle,
                    explanation: L.givingSubtitle,
                    symbol: "xmark.circle"
                )
                Button(L.givingRetry, action: onDone)
                    .buttonStyle(FaithFormButtonStyle(kind: .secondary, theme: theme))
            }
        }
    }

    private func message(for failure: RecurringFailure) -> String {
        switch failure {
        case .paymentDeclined: return L.givingFailedDeclined
        case .network: return L.givingFailedNetwork
        case .churchNotAccepting: return L.givingFailedNotAccepting
        case .notAllowed: return L.givingFailedNotAllowed
        // The one failure here a person can actually do something about, so it
        // says what to do rather than that something went wrong.
        case .noEmail: return L.givingRecurringNeedsEmail
        case .unavailable: return L.givingUnavailableBody
        }
    }
}

// MARK: - The gifts a person already has

/// One recurring gift, and the way to stop it.
///
/// ## Why "Stop this gift" is a plain button and not hidden
///
/// Because a recurring charge somebody cannot find the end of is the single
/// worst thing this feature could ship. It is not behind a swipe, not in an
/// overflow menu, and not two screens deep: it is on the row, labelled in
/// words, and it asks once before it acts.
///
/// It is styled `.secondary` rather than `.destructive` — stopping a gift is
/// not a destructive act and should not be dressed as one. Nothing is deleted
/// and no history changes; the next charge simply does not happen.
public struct RecurringGiftCard: View {
    @Environment(\.faithformTheme) private var theme
    private let gift: RecurringGift
    private let isStopping: Bool
    private let onStop: @MainActor () -> Void

    public init(
        gift: RecurringGift,
        isStopping: Bool,
        onStop: @escaping @MainActor () -> Void
    ) {
        self.gift = gift
        self.isStopping = isStopping
        self.onStop = onStop
    }

    public var body: some View {
        FaithFormCard {
            VStack(alignment: .leading, spacing: FaithFormTokens.Spacing.md) {
                VStack(alignment: .leading, spacing: FaithFormTokens.Spacing.xs) {
                    Text(amountPhrase)
                        .font(theme.font(FaithFormTokens.Text.titleLarge))
                        .foregroundStyle(theme.palette.contentPrimary)
                        .fixedSize(horizontal: false, vertical: true)

                    Text(gift.fundTitle)
                        .font(theme.font(FaithFormTokens.Text.bodySmall))
                        .foregroundStyle(theme.palette.contentSecondary)
                        .fixedSize(horizontal: false, vertical: true)

                    if let started = startedOn {
                        Text(L.givingRecurringStartedOn(started))
                            .font(theme.font(FaithFormTokens.Text.caption))
                            .foregroundStyle(theme.palette.contentMuted)
                    }
                }

                // Only the states that want something from a person get a
                // notice. A row of green "active" badges would make the one row
                // that needs attention harder to find, not easier.
                if let notice = recurringGiftNotice(gift.status) {
                    Label(notice, systemImage: "exclamationmark.circle")
                        .font(theme.font(FaithFormTokens.Text.caption))
                        .foregroundStyle(theme.palette.warning)
                        .fixedSize(horizontal: false, vertical: true)
                }

                if recurringGiftIsStoppable(gift.status) {
                    Button(action: onStop) {
                        FaithFormWorkingLabel(L.givingStopRecurring, working: isStopping)
                    }
                    .buttonStyle(FaithFormButtonStyle(kind: .secondary, theme: theme))
                    .disabled(isStopping)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        // The amount, cadence and fund read as one thing; the button stays its
        // own element so it can still be activated.
        .accessibilityElement(children: .contain)
    }

    /// "$25 every month" for a cadence this build knows, and the server's own
    /// words for one it does not — an annual gift from the church's web page,
    /// or a cadence a later server introduces. Never omitted: a recurring
    /// charge a person cannot see is one they cannot stop.
    private var amountPhrase: String {
        let amount = formatGivingAmount(cents: gift.amountCents, currency: gift.currency)
        switch GivingInterval(rawValue: gift.interval) {
        case .week: return L.givingEveryWeekAmount(amount)
        case .month: return L.givingEveryMonthAmount(amount)
        default: return "\(amount) · \(recurringIntervalTitle(gift.interval))"
        }
    }

    private var startedOn: String? {
        guard let date = SermonDates.instant(gift.startedAt) else { return nil }
        let formatter = DateFormatter()
        formatter.dateStyle = .long
        formatter.timeStyle = .none
        return formatter.string(from: date)
    }
}

/// Every recurring gift a person has at this church.
///
/// Shown on the Give screen itself rather than behind a menu, because the place
/// somebody looks for "what am I already giving" is the giving screen. An empty
/// state says so plainly instead of suggesting they set one up.
public struct RecurringGiftsSection: View {
    @Environment(\.faithformTheme) private var theme
    private let gifts: [RecurringGift]
    private let isLoading: Bool
    private let stoppingID: String?
    private let stopFailed: Bool
    private let onStop: @MainActor (RecurringGift) -> Void

    public init(
        gifts: [RecurringGift],
        isLoading: Bool,
        stoppingID: String?,
        stopFailed: Bool,
        onStop: @escaping @MainActor (RecurringGift) -> Void
    ) {
        self.gifts = gifts
        self.isLoading = isLoading
        self.stoppingID = stoppingID
        self.stopFailed = stopFailed
        self.onStop = onStop
    }

    public var body: some View {
        // Nothing at all while the first load is in flight and there is nothing
        // to show: a heading over an empty space reads as a section that failed.
        if isLoading && gifts.isEmpty {
            EmptyView()
        } else {
            VStack(alignment: .leading, spacing: FaithFormTokens.Spacing.md) {
                Text(L.givingYourRecurring)
                    .font(theme.font(FaithFormTokens.Text.titleMedium))
                    .foregroundStyle(theme.palette.contentPrimary)

                if stopFailed {
                    Text(L.givingStopFailed)
                        .font(theme.font(FaithFormTokens.Text.caption))
                        .foregroundStyle(theme.palette.destructive)
                        .fixedSize(horizontal: false, vertical: true)
                }

                if gifts.isEmpty {
                    Text(L.givingRecurringEmpty)
                        .font(theme.font(FaithFormTokens.Text.bodySmall))
                        .foregroundStyle(theme.palette.contentSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                } else {
                    ForEach(gifts, id: \.subscriptionId) { gift in
                        RecurringGiftCard(
                            gift: gift,
                            isStopping: stoppingID == gift.subscriptionId,
                            onStop: { onStop(gift) }
                        )
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}
