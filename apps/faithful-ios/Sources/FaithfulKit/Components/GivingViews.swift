import SwiftUI

/// The Give experience.
///
/// Nothing here can start a payment or ask the server for anything on its own:
/// each view reports an intent upward, and `GivingModel` is the only thing that
/// calls the client. That is what keeps "opening a screen does not present a
/// payment sheet" a property of the structure rather than a rule someone has to
/// remember.

// MARK: - Money

/// Formats cents for display, in the gift's own currency.
///
/// Never rounds and never abbreviates. `$1.2K` on a receipt is not a number a
/// person can check against their bank.
func formatGivingAmount(cents: Int, currency: String) -> String {
    let formatter = NumberFormatter()
    formatter.numberStyle = .currency
    formatter.currencyCode = currency.uppercased()
    formatter.maximumFractionDigits = cents % 100 == 0 ? 0 : 2
    formatter.minimumFractionDigits = cents % 100 == 0 ? 0 : 2
    return formatter.string(from: NSNumber(value: Double(cents) / 100))
        ?? "\(Double(cents) / 100)"
}

// MARK: - Giving home

/// The Give screen: what a church has opened, and what a person may put in.
public struct GivingHomeView: View {
    @Environment(\.faithfulTheme) private var theme
    private let phase: GivingListPhase
    private let selectedFund: GivingFund?
    private let onSelect: @MainActor (GivingFund) -> Void
    private let onRetry: @MainActor () -> Void
    private let onHistory: @MainActor () -> Void

    public init(
        phase: GivingListPhase,
        selectedFund: GivingFund?,
        onSelect: @escaping @MainActor (GivingFund) -> Void,
        onRetry: @escaping @MainActor () -> Void,
        onHistory: @escaping @MainActor () -> Void
    ) {
        self.phase = phase
        self.selectedFund = selectedFund
        self.onSelect = onSelect
        self.onRetry = onRetry
        self.onHistory = onHistory
    }

    public var body: some View {
        switch phase {
        case .idle, .loading:
            ProgressView(L.givingLoading)
                .frame(maxWidth: .infinity)
                .padding(FaithfulTokens.Spacing.xl)

        case .blocked:
            // The same answer a blocked visitor gets everywhere. Nothing about
            // giving, because there is nothing about this church to say.
            EmptyStateView(title: L.givingBlockedTitle, explanation: L.givingEmptyBody)

        case .offline:
            VStack(spacing: FaithfulTokens.Spacing.md) {
                EmptyStateView(title: L.givingOfflineTitle, explanation: L.givingOfflineBody)
                Button(L.givingRetry, action: onRetry)
                    .buttonStyle(FaithfulButtonStyle(kind: .secondary, theme: theme))
            }

        case let .failed(message):
            VStack(spacing: FaithfulTokens.Spacing.md) {
                EmptyStateView(title: L.givingFailedTitle, explanation: message)
                Button(L.givingRetry, action: onRetry)
                    .buttonStyle(FaithfulButtonStyle(kind: .secondary, theme: theme))
            }

        case let .loaded(home):
            loaded(home)
        }
    }

    @ViewBuilder
    private func loaded(_ home: GivingHome) -> some View {
        // Three genuinely different empties, said differently. A church with no
        // funds has not opened any; a church that cannot charge has not finished
        // setting up. Telling a person "nothing here" for both would make one of
        // them look like a mistake they made.
        if home.availability != "available" {
            EmptyStateView(
                title: L.givingNotAcceptingTitle,
                explanation: L.givingNotAcceptingBody
            )
        } else if home.funds.isEmpty {
            EmptyStateView(title: L.givingEmptyTitle, explanation: L.givingEmptyBody)
        } else {
            VStack(alignment: .leading, spacing: FaithfulTokens.Spacing.lg) {
                if let name = home.churchName {
                    VStack(alignment: .leading, spacing: FaithfulTokens.Spacing.xs) {
                        Text(name)
                            .font(theme.font(FaithfulTokens.Text.displayLarge))
                            .foregroundStyle(theme.palette.contentPrimary)
                        Text(L.givingSubtitle)
                            .font(theme.font(FaithfulTokens.Text.body))
                            .foregroundStyle(theme.palette.contentSecondary)
                    }
                    .fixedSize(horizontal: false, vertical: true)
                }

                ForEach(home.funds, id: \.fundId) { fund in
                    GivingFundCard(
                        fund: fund,
                        isSelected: fund.fundId == selectedFund?.fundId,
                        onSelect: { onSelect(fund) }
                    )
                }

                // Said only when it is true. A church that runs no recurring
                // gifts should not be advertised as offering them.
                if home.recurringAvailable {
                    Text(L.givingRecurringElsewhere)
                        .font(theme.font(FaithfulTokens.Text.caption))
                        .foregroundStyle(theme.palette.contentSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                }

                Button(L.givingHistoryTitle, action: onHistory)
                    .buttonStyle(FaithfulButtonStyle(kind: .secondary, theme: theme))
            }
        }
    }
}

/// One published fund.
///
/// Carries a title, a description and suggested amounts — and **no total, no
/// goal and no donor count**, because none of those exist in the canonical data
/// and inventing one would be a number a church would have to defend.
public struct GivingFundCard: View {
    @Environment(\.faithfulTheme) private var theme
    private let fund: GivingFund
    private let isSelected: Bool
    private let onSelect: @MainActor () -> Void

    public init(fund: GivingFund, isSelected: Bool, onSelect: @escaping @MainActor () -> Void) {
        self.fund = fund
        self.isSelected = isSelected
        self.onSelect = onSelect
    }

    public var body: some View {
        Button(action: onSelect) {
            FaithfulCard {
                VStack(alignment: .leading, spacing: FaithfulTokens.Spacing.sm) {
                    Text(fund.title)
                        .font(theme.font(FaithfulTokens.Text.titleMedium))
                        .foregroundStyle(theme.palette.contentPrimary)
                        .fixedSize(horizontal: false, vertical: true)

                    if let description = fund.description, !description.isEmpty {
                        Text(description)
                            .font(theme.font(FaithfulTokens.Text.bodySmall))
                            .foregroundStyle(theme.palette.contentSecondary)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .buttonStyle(.plain)
        // One element to VoiceOver, and the selection is a *trait* rather than a
        // colour — a ring nobody can see is not a selection.
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(isSelected ? [.isButton, .isSelected] : .isButton)
    }
}

// MARK: - Amount

/// Suggested amounts, and a field for anything else.
///
/// The chips are a convenience and never a floor: the field is always present,
/// and the validation message says which bound was missed rather than "invalid".
public struct GivingAmountView: View {
    @Environment(\.faithfulTheme) private var theme
    private let fund: GivingFund
    @Binding private var amountText: String
    private let result: AmountResult?
    private let onContinue: @MainActor () -> Void

    public init(
        fund: GivingFund,
        amountText: Binding<String>,
        result: AmountResult?,
        onContinue: @escaping @MainActor () -> Void
    ) {
        self.fund = fund
        self._amountText = amountText
        self.result = result
        self.onContinue = onContinue
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: FaithfulTokens.Spacing.md) {
            Text(L.givingAmountLabel)
                .font(theme.font(FaithfulTokens.Text.titleMedium))
                .foregroundStyle(theme.palette.contentPrimary)

            if !fund.suggestedAmounts.isEmpty {
                // Wraps rather than scrolls: a chip a person cannot reach is a
                // chip that is not there, and at large text sizes a row of them
                // will not fit.
                FlowRow(spacing: FaithfulTokens.Spacing.sm) {
                    ForEach(fund.suggestedAmounts, id: \.self) { cents in
                        Button(formatGivingAmount(cents: cents, currency: fund.currency)) {
                            amountText = String(format: "%.2f", Double(cents) / 100)
                        }
                        .buttonStyle(FaithfulButtonStyle(kind: .secondary, theme: theme))
                    }
                }
            }

            // `keyboardType` and `roundedBorder` are UIKit-backed and do not
            // exist when this package builds for macOS, which is where
            // `swift test` runs. Guarded rather than dropped, so the iOS build
            // gets the numeric keypad it needs.
            #if os(iOS)
            TextField(L.givingCustomAmount, text: $amountText)
                .keyboardType(.decimalPad)
                .textFieldStyle(.roundedBorder)
                .accessibilityLabel(L.givingCustomAmount)
            #else
            TextField(L.givingCustomAmount, text: $amountText)
                .accessibilityLabel(L.givingCustomAmount)
            #endif

            if let message = validationMessage {
                Text(message)
                    .font(theme.font(FaithfulTokens.Text.caption))
                    .foregroundStyle(theme.palette.destructive)
                    .fixedSize(horizontal: false, vertical: true)
                    // Announced when it appears, rather than found by someone
                    // wondering why the button does nothing.
                    .accessibilityAddTraits(.isStaticText)
            }

            Button(L.givingContinue, action: onContinue)
                .buttonStyle(FaithfulButtonStyle(kind: .primary, theme: theme))
                .disabled(!isValid)
        }
    }

    private var isValid: Bool {
        if case .valid = result { return true }
        return false
    }

    private var validationMessage: String? {
        guard case let .invalid(problem) = result else { return nil }
        // An empty field is not an error a person needs shouting at them before
        // they have typed anything.
        switch problem {
        case .empty: return amountText.isEmpty ? nil : L.givingAmountInvalid
        case .notANumber: return L.givingAmountInvalid
        case .belowMinimum: return L.givingAmountTooLow
        case .aboveMaximum: return L.givingAmountTooHigh
        }
    }
}

/// A wrapping row. Chips must reflow at large text sizes rather than clip.
struct FlowRow: Layout {
    var spacing: CGFloat

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let width = proposal.width ?? .infinity
        var x: CGFloat = 0
        var y: CGFloat = 0
        var rowHeight: CGFloat = 0
        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)
            if x + size.width > width, x > 0 {
                x = 0
                y += rowHeight + spacing
                rowHeight = 0
            }
            x += size.width + spacing
            rowHeight = max(rowHeight, size.height)
        }
        return CGSize(width: proposal.width ?? x, height: y + rowHeight)
    }

    func placeSubviews(
        in bounds: CGRect,
        proposal: ProposedViewSize,
        subviews: Subviews,
        cache: inout ()
    ) {
        var x = bounds.minX
        var y = bounds.minY
        var rowHeight: CGFloat = 0
        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)
            if x + size.width > bounds.maxX, x > bounds.minX {
                x = bounds.minX
                y += rowHeight + spacing
                rowHeight = 0
            }
            subview.place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(size))
            x += size.width + spacing
            rowHeight = max(rowHeight, size.height)
        }
    }
}

// MARK: - Confirm

/// The last screen before a payment sheet.
///
/// Names the church, the fund and the amount, because a person about to pay
/// should be able to check all three without remembering what they tapped.
public struct GivingConfirmView: View {
    @Environment(\.faithfulTheme) private var theme
    private let churchName: String
    private let fundTitle: String
    private let amountCents: Int
    private let currency: String
    private let onGive: @MainActor () -> Void

    public init(
        churchName: String,
        fundTitle: String,
        amountCents: Int,
        currency: String,
        onGive: @escaping @MainActor () -> Void
    ) {
        self.churchName = churchName
        self.fundTitle = fundTitle
        self.amountCents = amountCents
        self.currency = currency
        self.onGive = onGive
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: FaithfulTokens.Spacing.lg) {
            Text(L.givingConfirmTitle)
                .font(theme.font(FaithfulTokens.Text.displayLarge))
                .foregroundStyle(theme.palette.contentPrimary)

            FaithfulCard {
                VStack(alignment: .leading, spacing: FaithfulTokens.Spacing.md) {
                    row(L.givingConfirmChurch, churchName)
                    row(L.givingConfirmFund, fundTitle)
                    row(
                        L.givingConfirmAmount,
                        formatGivingAmount(cents: amountCents, currency: currency)
                    )
                }
            }

            Button(L.givingGiveNow, action: onGive)
                .buttonStyle(FaithfulButtonStyle(kind: .primary, theme: theme))
        }
    }

    private func row(_ label: String, _ value: String) -> some View {
        HStack(alignment: .firstTextBaseline) {
            Text(label)
                .font(theme.font(FaithfulTokens.Text.bodySmall))
                .foregroundStyle(theme.palette.contentSecondary)
            Spacer(minLength: FaithfulTokens.Spacing.md)
            Text(value)
                .font(theme.font(FaithfulTokens.Text.body))
                .foregroundStyle(theme.palette.contentPrimary)
                .multilineTextAlignment(.trailing)
        }
        .fixedSize(horizontal: false, vertical: true)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Outcome

/// What happened, as far as the **server** knows.
///
/// The processing state is not a success and does not read like one. A person
/// waiting here is told to wait; a person whose gift is confirmed is thanked.
public struct GivingOutcomeView: View {
    @Environment(\.faithfulTheme) private var theme
    private let phase: DonationPhase
    private let receipt: GivingReceipt?
    private let pollingExhausted: Bool
    private let onDone: @MainActor () -> Void

    public init(
        phase: DonationPhase,
        receipt: GivingReceipt?,
        pollingExhausted: Bool,
        onDone: @escaping @MainActor () -> Void
    ) {
        self.phase = phase
        self.receipt = receipt
        self.pollingExhausted = pollingExhausted
        self.onDone = onDone
    }

    public var body: some View {
        switch phase {
        case .idle, .preparing, .presenting:
            ProgressView(L.givingLoading)
                .frame(maxWidth: .infinity)
                .padding(FaithfulTokens.Spacing.xl)

        case .awaitingConfirmation:
            VStack(spacing: FaithfulTokens.Spacing.md) {
                ProgressView()
                Text(L.givingProcessingTitle)
                    .font(theme.font(FaithfulTokens.Text.titleMedium))
                    .foregroundStyle(theme.palette.contentPrimary)
                Text(pollingExhausted ? L.givingStillProcessingBody : L.givingProcessingBody)
                    .font(theme.font(FaithfulTokens.Text.bodySmall))
                    .foregroundStyle(theme.palette.contentSecondary)
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .frame(maxWidth: .infinity)
            .padding(FaithfulTokens.Spacing.xl)
            // Announced as it changes, so someone using VoiceOver is not left
            // guessing whether anything is happening.
            .accessibilityElement(children: .combine)

        case .confirmed:
            confirmed

        case let .failed(reason, _):
            VStack(spacing: FaithfulTokens.Spacing.md) {
                EmptyStateView(title: L.givingFailedTitle, explanation: message(for: reason))
                Button(L.givingRetry, action: onDone)
                    .buttonStyle(FaithfulButtonStyle(kind: .secondary, theme: theme))
            }

        case .cancelled:
            VStack(spacing: FaithfulTokens.Spacing.md) {
                EmptyStateView(title: L.givingCancelledTitle, explanation: L.givingSubtitle)
                Button(L.givingRetry, action: onDone)
                    .buttonStyle(FaithfulButtonStyle(kind: .secondary, theme: theme))
            }
        }
    }

    @ViewBuilder
    private var confirmed: some View {
        VStack(spacing: FaithfulTokens.Spacing.lg) {
            Text(L.givingSucceededTitle)
                .font(theme.font(FaithfulTokens.Text.displayLarge))
                .foregroundStyle(theme.palette.contentPrimary)

            // The receipt is the server's, and only exists once the webhook
            // confirmed. When it has not arrived yet the thank-you stands alone
            // rather than showing a receipt this app invented.
            if let receipt {
                FaithfulCard {
                    VStack(alignment: .leading, spacing: FaithfulTokens.Spacing.sm) {
                        Text(L.givingReceiptTitle)
                            .font(theme.font(FaithfulTokens.Text.caption))
                            .foregroundStyle(theme.palette.contentSecondary)
                        Text(formatGivingAmount(
                            cents: receipt.amountCents,
                            currency: receipt.currency
                        ))
                        .font(theme.font(FaithfulTokens.Text.displayLarge))
                        .foregroundStyle(theme.palette.contentPrimary)
                        Text(receipt.fundTitle)
                            .font(theme.font(FaithfulTokens.Text.body))
                            .foregroundStyle(theme.palette.contentSecondary)
                        Text(receipt.churchName)
                            .font(theme.font(FaithfulTokens.Text.bodySmall))
                            .foregroundStyle(theme.palette.contentSecondary)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
                .accessibilityElement(children: .combine)
            }

            Button(L.givingContinue, action: onDone)
                .buttonStyle(FaithfulButtonStyle(kind: .primary, theme: theme))
        }
    }

    private func message(for reason: GivingFailure) -> String {
        switch reason {
        case .paymentDeclined: return L.givingFailedDeclined
        case .network: return L.givingFailedNetwork
        case .churchNotAccepting: return L.givingFailedNotAccepting
        case .notAllowed: return L.givingFailedNotAllowed
        case .unavailable: return L.givingUnavailableBody
        }
    }
}

// MARK: - History

/// This account's own giving at this church.
public struct GivingHistoryView: View {
    @Environment(\.faithfulTheme) private var theme
    private let items: [DonationStatusResult]
    private let isLoading: Bool

    public init(items: [DonationStatusResult], isLoading: Bool) {
        self.items = items
        self.isLoading = isLoading
    }

    public var body: some View {
        if isLoading && items.isEmpty {
            ProgressView(L.givingLoading)
                .frame(maxWidth: .infinity)
                .padding(FaithfulTokens.Spacing.xl)
        } else if items.isEmpty {
            EmptyStateView(title: L.givingHistoryTitle, explanation: L.givingHistoryEmpty)
        } else {
            VStack(alignment: .leading, spacing: FaithfulTokens.Spacing.md) {
                // Said out loud, because a person looking at a giving list should
                // know whose it is.
                Text(L.givingHistoryOnlyYours)
                    .font(theme.font(FaithfulTokens.Text.caption))
                    .foregroundStyle(theme.palette.contentSecondary)

                ForEach(items, id: \.attemptId) { item in
                    FaithfulCard {
                        HStack(alignment: .firstTextBaseline) {
                            VStack(alignment: .leading, spacing: FaithfulTokens.Spacing.xs) {
                                Text(formatGivingAmount(
                                    cents: item.amountCents,
                                    currency: item.currency
                                ))
                                .font(theme.font(FaithfulTokens.Text.titleMedium))
                                .foregroundStyle(theme.palette.contentPrimary)
                                Text(item.fundTitle)
                                    .font(theme.font(FaithfulTokens.Text.bodySmall))
                                    .foregroundStyle(theme.palette.contentSecondary)
                            }
                            Spacer(minLength: FaithfulTokens.Spacing.md)
                            Text(statusLabel(item.status))
                                .font(theme.font(FaithfulTokens.Text.caption))
                                .foregroundStyle(theme.palette.contentSecondary)
                        }
                        .fixedSize(horizontal: false, vertical: true)
                    }
                    .accessibilityElement(children: .combine)
                }
            }
        }
    }

    /// The truthful label for a state, including the ones nobody enjoys.
    ///
    /// A refunded or disputed gift says so. Hiding them would leave a person
    /// looking at a list that disagrees with their bank.
    private func statusLabel(_ status: String) -> String {
        switch DonationStatus(rawValue: status) {
        case .succeeded: return L.givingStatusSucceeded
        case .failed: return L.givingStatusFailed
        case .cancelled: return L.givingStatusCancelled
        case .refunded: return L.givingStatusRefunded
        case .disputed: return L.givingStatusDisputed
        default: return L.givingStatusProcessing
        }
    }
}
