import Foundation
import Observation

/// What the Give screen is showing.
public enum GivingListPhase: Equatable, Sendable {
    case idle
    case loading
    case loaded(GivingHome)
    /// The church is not available to this account at all.
    case blocked
    case offline
    case failed(String)

    public var home: GivingHome? {
        if case let .loaded(home) = self { return home }
        return nil
    }

    public var funds: [GivingFund] { home?.funds ?? [] }
}

/// The Give screen, and the gift a person is making.
///
/// ## Where the decisions are
///
/// Not here. Amount validation, the state machine, the poll schedule and the
/// redaction all live in `Giving.swift`, which is platform-free and tested. This
/// model sequences them and owns the one thing a view needs: what to draw.
///
/// ## What it never does
///
/// It never decides that a gift succeeded. `phase` only reaches `.confirmed`
/// from ``advanceAfterServer(_:attempt:)``, and the value it passes came from
/// the status route, which reports what a verified Stripe webhook wrote.
@MainActor
@Observable
public final class GivingModel {
    public private(set) var listPhase: GivingListPhase = .idle
    public private(set) var donation: DonationPhase = .idle
    public private(set) var receipt: GivingReceipt?
    public private(set) var history: [DonationStatusResult] = []
    public private(set) var historyLoading = false

    /// True once polling has given up. The gift is still going through; the app
    /// simply stops asking and says so.
    public private(set) var pollingExhausted = false

    public var selectedFund: GivingFund?
    public var amountText: String = ""

    private let client: GivingClient
    private let sheet: any PaymentSheetFacade
    private let store: PendingDonationStore
    private let churchSlug: String
    private let partition: CachePartition
    private let applePayMerchantID: String?
    private let deviceCanUseApplePay: () -> Bool

    public init(
        client: GivingClient,
        sheet: any PaymentSheetFacade,
        store: PendingDonationStore,
        churchSlug: String,
        partition: CachePartition,
        applePayMerchantID: String? = nil,
        deviceCanUseApplePay: @escaping () -> Bool = { false }
    ) {
        self.client = client
        self.sheet = sheet
        self.store = store
        self.churchSlug = churchSlug
        self.partition = partition
        self.applePayMerchantID = applePayMerchantID
        self.deviceCanUseApplePay = deviceCanUseApplePay
    }

    // MARK: - The list

    public func load() async {
        if case .idle = listPhase { listPhase = .loading }
        do {
            let home = try await client.home(churchSlug: churchSlug, partition: partition)
            listPhase = .loaded(home)
            if selectedFund == nil { selectedFund = home.funds.first }
        } catch let error as APIError {
            listPhase = mapped(error)
        } catch {
            listPhase = .offline
        }
    }

    private func mapped(_ error: APIError) -> GivingListPhase {
        switch error.code {
        case .notFound, .blocked: return .blocked
        // There is no distinct transport code: a request that never completed
        // surfaces as `unavailable`, which reads to a person as "offline" and is
        // the state that offers a retry.
        case .unavailable, .internalError: return .offline
        default: return .failed(error.message)
        }
    }

    /// The amount the person has typed, judged against the selected fund.
    public var amountResult: AmountResult? {
        guard let fund = selectedFund else { return nil }
        return validateAmount(
            amountText,
            bounds: AmountBounds(
                minimumCents: fund.minAmountCents,
                maximumCents: fund.maxAmountCents
            )
        )
    }

    // MARK: - Resuming

    /// Picks up a gift that was interrupted.
    ///
    /// Called on launch and on foreground. A phone killed with a payment sheet
    /// open has a persisted attempt, and the honest thing to do is ask the
    /// server what became of it — not to start again, which would charge twice.
    public func resumeInterruptedDonation() async {
        guard let pending = await store.load() else { return }
        guard pending.churchSlug == churchSlug else { return }
        donation = .awaitingConfirmation(pending)
        await pollUntilResolved(pending)
    }

    // MARK: - Giving

    /// Starts a gift, presents the sheet, and waits for the server.
    ///
    /// The attempt id is generated and **persisted before the network call**. A
    /// phone killed between those two lines has nothing to retry; a phone killed
    /// after has an id that finds the intent it already created.
    public func give() async {
        guard let fund = selectedFund, case let .valid(cents) = amountResult else { return }

        donation = .preparing
        pollingExhausted = false

        let attempt = DonationAttempt(
            clientAttemptID: DonationAttempt.newAttemptID(),
            churchSlug: churchSlug,
            fundID: fund.fundId,
            amountCents: cents
        )
        await store.save(attempt)

        let session: DonationSession
        do {
            session = try await client.startDonation(attempt)
        } catch let error as APIError {
            await store.clear()
            donation = .failed(failure(for: error), attempt)
            return
        } catch {
            await store.clear()
            donation = .failed(.network, attempt)
            return
        }

        donation = .presenting(attempt)

        let allowApplePay = applePayAvailable(
            // The session does not carry a wallet flag today: no Apple merchant
            // identifier is configured, so the answer is false and the code path
            // stays switched off until the external setup is done.
            serverAllows: applePayMerchantID != nil,
            deviceCanMakePayments: deviceCanUseApplePay(),
            merchantID: applePayMerchantID
        )

        let outcome = await sheet.present(
            PaymentSheetRequest(
                clientSecret: session.clientSecret,
                publishableKey: session.publishableKey,
                stripeAccountID: session.stripeAccountId,
                merchantName: session.merchantName,
                allowApplePay: allowApplePay,
                appleMerchantID: applePayMerchantID
            )
        )

        donation = advanceAfterSheet(outcome, attempt: attempt)

        switch outcome {
        case .completed:
            await pollUntilResolved(attempt)
        case .cancelled, .failed:
            // Nothing was charged, so the pending attempt is not worth resuming.
            // The id itself is spent: reusing it would resume an intent the
            // person walked away from.
            await store.clear()
        }
    }

    private func failure(for error: APIError) -> GivingFailure {
        switch error.code {
        case .notFound: return .notAllowed
        case .conflict: return .churchNotAccepting
        case .invalidRequest: return .notAllowed
        case .unavailable, .internalError: return .network
        default: return .unavailable
        }
    }

    // MARK: - Waiting for the server

    /// Asks the server what happened, backing off, and stops rather than asking
    /// forever.
    private func pollUntilResolved(_ attempt: DonationAttempt) async {
        var round = 0
        while let delay = nextPollDelaySeconds(attempt: round) {
            try? await Task.sleep(nanoseconds: UInt64(delay * 1_000_000_000))
            round += 1

            guard !Task.isCancelled else { return }

            let status: DonationStatusResult
            do {
                status = try await client.status(
                    churchSlug: attempt.churchSlug,
                    attemptID: attempt.clientAttemptID
                )
            } catch {
                // A failed poll is not a failed gift. Keep asking.
                continue
            }

            // The wire value is a string so a newer server can add a state
            // without breaking a released app. `DonationStatus` resolves an
            // unknown one to `.unknown`, which keeps the person waiting rather
            // than resolving into a guess.
            let next = advanceAfterServer(
                DonationStatus(rawValue: status.status),
                attempt: attempt
            )
            donation = next

            if case .confirmed = next {
                await store.clear()
                // Only now is there something to show. The receipt route refuses
                // anything the webhook has not confirmed, so this cannot succeed
                // early even if the poll were wrong.
                receipt = try? await client.receipt(
                    churchSlug: attempt.churchSlug,
                    attemptID: attempt.clientAttemptID
                )
                return
            }
            if case .failed = next { await store.clear(); return }
            if case .cancelled = next { await store.clear(); return }
        }

        // Out of rounds. The gift is still going through; the app says exactly
        // that rather than pretending either way.
        pollingExhausted = true
    }

    // MARK: - History

    public func loadHistory() async {
        historyLoading = true
        defer { historyLoading = false }
        do {
            history = try await client.history(churchSlug: churchSlug).items
        } catch {
            history = []
        }
    }

    /// Drops everything held for this church.
    ///
    /// Called on sign-out, church switch, and an authorization-version change.
    /// Giving history is never written to a cache — the routes are `no-store` —
    /// so this clears what the model itself holds.
    public func purge() async {
        history = []
        receipt = nil
        donation = .idle
        listPhase = .idle
        selectedFund = nil
        amountText = ""
        await store.clear()
    }
}

/// Where the pending attempt lives between an interruption and a resume.
///
/// A protocol so a test can drive it, and so the app can choose a store that
/// survives a kill. It holds an id, a slug, a fund and an amount — no client
/// secret, no payment intent, and nothing a person would mind being read.
public protocol PendingDonationStore: Sendable {
    func save(_ attempt: DonationAttempt) async
    func load() async -> DonationAttempt?
    func clear() async
}
