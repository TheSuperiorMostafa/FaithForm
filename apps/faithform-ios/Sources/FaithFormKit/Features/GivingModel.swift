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

    /// Starting a recurring gift: its own phase, deliberately separate from
    /// `donation`. One screen can be waiting on a one-time gift's webhook while
    /// a person starts a recurring one, and a single phase would make the
    /// second overwrite the first's outcome.
    public private(set) var recurring: RecurringPhase = .idle
    public private(set) var recurringGifts: [RecurringGift] = []
    public private(set) var recurringLoading = false
    /// Set when stopping a gift failed. Cleared by the next attempt, so a stale
    /// message cannot outlive the row it was about.
    public private(set) var stopFailed = false
    /// The gift currently being stopped, so its row alone shows progress.
    public private(set) var stoppingID: String?

    /// True once polling has given up. The gift is still going through; the app
    /// simply stops asking and says so.
    public private(set) var pollingExhausted = false

    public var selectedFund: GivingFund?
    public var amountText: String = ""
    /// Which cadence the amount screen is offering. Monthly by default because
    /// that is what most regular giving is, and a default nobody changes should
    /// be the common case rather than the first alphabetically.
    public var cadence: RecurringCadence = .month

    private let client: GivingClient
    private let sheet: any PaymentSheetFacade
    private let store: PendingDonationStore
    private let recurringStore: PendingRecurringStore
    private let churchSlug: String
    private let partition: CachePartition
    private let applePayMerchantID: String?
    private let deviceCanUseApplePay: () -> Bool
    private let now: () -> Date
    private var lastLoadedAt: Date?

    public static let staleAfter: TimeInterval = 5 * 60

    public init(
        client: GivingClient,
        sheet: any PaymentSheetFacade,
        store: PendingDonationStore,
        recurringStore: PendingRecurringStore,
        churchSlug: String,
        partition: CachePartition,
        applePayMerchantID: String? = nil,
        deviceCanUseApplePay: @escaping () -> Bool = { false },
        now: @escaping () -> Date = Date.init
    ) {
        self.client = client
        self.sheet = sheet
        self.store = store
        self.recurringStore = recurringStore
        self.churchSlug = churchSlug
        self.partition = partition
        self.applePayMerchantID = applePayMerchantID
        self.deviceCanUseApplePay = deviceCanUseApplePay
        self.now = now
    }

    // MARK: - The list

    public func load() async {
        if shouldSkipReload { return }
        await reloadHome()
    }

    public func refresh() async {
        await reloadHome()
    }

    private func reloadHome() async {
        if case .idle = listPhase {
            if let cached = await client.cachedHome(churchSlug: churchSlug, partition: partition),
               cached.isDisplayable(now: now()) {
                listPhase = .loaded(cached.value)
                if selectedFund == nil { selectedFund = cached.value.funds.first }
            } else {
                listPhase = .loading
            }
        }
        do {
            let home = try await client.home(churchSlug: churchSlug, partition: partition)
            lastLoadedAt = now()
            listPhase = .loaded(home)
            if selectedFund == nil { selectedFund = home.funds.first }
        } catch {
            if error.isCancellation { return }
            if let api = error as? APIError {
                listPhase = mapped(api)
            } else if case .loaded = listPhase {
                return
            } else {
                listPhase = .offline
            }
        }
    }

    private var shouldSkipReload: Bool {
        guard case .loaded = listPhase, let lastLoadedAt else { return false }
        return now().timeIntervalSince(lastLoadedAt) < Self.staleAfter
    }

    private func mapped(_ error: APIError) -> GivingListPhase {
        switch error.code {
        case .notFound, .blocked: return .blocked
        // There is no distinct transport code: a request that never completed
        // surfaces as `unavailable`, which reads to a person as "offline" and is
        // the state that offers a retry.
        case .unavailable, .internalError:
            if case .loaded = listPhase { return listPhase }
            return .offline
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
            // The server's per-church approval, from the funds response this
            // gift was started from. The host only reaches `give()` through
            // `givingRoute(...) == .inApp`, which already required it — this is
            // the same fact read again rather than a second opinion.
            serverAllows: listPhase.home?.applePayApproved == true,
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

    // MARK: - Recurring giving

    /// Starts a recurring gift, presents the sheet, and stops claiming things.
    ///
    /// The shape is `give()`'s, with one difference at the end: there is no
    /// poll. A one-time gift has a single outcome worth waiting for, so the app
    /// waits. A subscription's outcome is "it renews next month", which no
    /// amount of waiting on this screen establishes — so the sheet closing
    /// moves to `.started`, the list reloads, and the webhook's answer shows up
    /// there as a status rather than as a spinner nobody can outlast.
    public func startRecurring() async {
        guard let fund = selectedFund, case let .valid(cents) = amountResult else { return }

        recurring = .preparing

        let attempt = RecurringAttempt(
            clientAttemptID: RecurringAttempt.newAttemptID(),
            churchSlug: churchSlug,
            fundID: fund.fundId,
            amountCents: cents,
            cadence: cadence
        )
        await recurringStore.save(attempt)

        let session: RecurringGiftSession
        do {
            session = try await client.startRecurringGift(attempt)
        } catch let error as APIError {
            await recurringStore.clear()
            recurring = .failed(recurringFailure(for: error), attempt)
            return
        } catch {
            await recurringStore.clear()
            recurring = .failed(.network, attempt)
            return
        }

        // A resumed attempt whose first invoice is already paid comes back with
        // no secret. There is nothing to confirm and nothing to present: the
        // gift is running, and saying so beats opening an empty sheet.
        guard let clientSecret = session.clientSecret, !clientSecret.isEmpty else {
            await recurringStore.clear()
            recurring = .started(attempt)
            await loadRecurring()
            return
        }

        recurring = .presenting(attempt)

        let allowApplePay = applePayAvailable(
            serverAllows: listPhase.home?.applePayApproved == true,
            deviceCanMakePayments: deviceCanUseApplePay(),
            merchantID: applePayMerchantID
        )

        let outcome = await sheet.present(
            PaymentSheetRequest(
                clientSecret: clientSecret,
                publishableKey: session.publishableKey,
                stripeAccountID: session.stripeAccountId,
                merchantName: session.merchantName,
                allowApplePay: allowApplePay,
                appleMerchantID: applePayMerchantID
            )
        )

        recurring = advanceRecurringAfterSheet(outcome, attempt: attempt)
        await recurringStore.clear()

        if case .completed = outcome {
            // The subscription exists either way; the list is where its real
            // state appears once the webhook has spoken.
            await loadRecurring()
        }
    }

    /// Picks up a recurring gift that was interrupted.
    ///
    /// A phone killed with the sheet open left a subscription whose first
    /// invoice may or may not be paid. Re-sending the same attempt id asks the
    /// server what became of it — and never creates a second one.
    public func resumeInterruptedRecurring() async {
        guard let pending = await recurringStore.load() else { return }
        guard pending.churchSlug == churchSlug else { return }
        await recurringStore.clear()
        await loadRecurring()
    }

    public func loadRecurring() async {
        recurringLoading = true
        defer { recurringLoading = false }
        do {
            recurringGifts = try await client.recurringGifts(churchSlug: churchSlug).items
        } catch {
            if error.isCancellation { return }
            // An empty list rather than a stale one: a gift shown after it was
            // stopped is worse than a list that says nothing.
            recurringGifts = []
        }
    }

    /// Stops one recurring gift, and only reports it stopped when the server did.
    public func stopRecurring(subscriptionID: String) async {
        stopFailed = false
        stoppingID = subscriptionID
        defer { stoppingID = nil }

        do {
            let result = try await client.stopRecurringGift(
                churchSlug: churchSlug,
                subscriptionID: subscriptionID
            )
            guard result.stopped else {
                stopFailed = true
                return
            }
        } catch {
            if error.isCancellation { return }
            stopFailed = true
            return
        }

        // Re-read rather than removing the row locally. The webhook writes the
        // cancellation, and the list is what it writes to; dropping the row
        // here would show "stopped" for a gift the server had not yet stopped.
        await loadRecurring()
    }

    private func recurringFailure(for error: APIError) -> RecurringFailure {
        switch error.code {
        case .notFound: return .notAllowed
        case .conflict:
            // The server says `conflict` both for a church that is not
            // accepting and for an account with no email. They read very
            // differently to a person, and only the message tells them apart.
            return error.message.localizedCaseInsensitiveContains("email")
                ? .noEmail
                : .churchNotAccepting
        case .invalidRequest: return .notAllowed
        case .unavailable, .internalError: return .network
        default: return .unavailable
        }
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
        cadence = .month
        recurring = .idle
        recurringGifts = []
        stopFailed = false
        stoppingID = nil
        await store.clear()
        await recurringStore.clear()
    }
}

/// Where a pending **recurring** attempt lives between an interruption and a
/// resume.
///
/// Separate from ``PendingDonationStore`` rather than generic over both,
/// because the two must never share a slot: a phone killed during a one-time
/// gift and then again during a recurring one has two things to resume, and a
/// single entry would lose one of them — the one that is still charging.
public protocol PendingRecurringStore: Sendable {
    func save(_ attempt: RecurringAttempt) async
    func load() async -> RecurringAttempt?
    func clear() async
}

/// The pending recurring attempt, in the Keychain.
///
/// Same reasoning as ``SecurePendingDonationStore``: not because the attempt is
/// a secret — it holds a fund, an amount and a cadence — but because the
/// Keychain is where this app keeps what must survive a kill **and** disappear
/// on sign-out. A pending gift left in `UserDefaults` would be resumed for
/// whoever signs in next, and this one would set up a monthly charge for them.
public struct SecurePendingRecurringStore: PendingRecurringStore {
    private let store: SecureStoring
    private let key: String

    public init(store: SecureStoring, partition: CachePartition) {
        self.store = store
        // A different prefix from the one-time store's, so the two can never
        // collide. The authorization version is left out for the same reason it
        // is there: a version bump mid-payment must not orphan the one record
        // that lets the app ask what became of the gift.
        self.key = [
            "giving.pending.recurring",
            partition.environment,
            partition.accountId ?? "anonymous",
            partition.churchSlug ?? "-",
        ].joined(separator: "|")
    }

    public func save(_ attempt: RecurringAttempt) async {
        guard let data = try? JSONEncoder.faithform.encode(attempt) else { return }
        try? store.write(data, for: key)
    }

    public func load() async -> RecurringAttempt? {
        guard
            let data = try? store.read(key),
            let attempt = try? JSONDecoder.faithform.decode(RecurringAttempt.self, from: data)
        else { return nil }
        return attempt
    }

    public func clear() async {
        try? store.delete(key)
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

/// The pending attempt, in the Keychain.
///
/// Not because an attempt is a secret — it is not, see above — but because the
/// Keychain is where this app keeps everything that must survive a kill **and**
/// disappear on sign-out: the session, the PKCE verifier and resume positions
/// all live under the same service, and sign-out's `deleteAll` sweeps every one
/// of them. A pending gift left behind in `UserDefaults` would be resumed for
/// whoever signs in next.
///
/// One entry per environment, account and church, so a second account on the
/// same phone can never pick up the first one's gift, and switching churches
/// never resumes a gift to the other.
public struct SecurePendingDonationStore: PendingDonationStore {
    private let store: SecureStoring
    private let key: String

    public init(store: SecureStoring, partition: CachePartition) {
        self.store = store
        // The authorization version is deliberately left out: a version bump
        // mid-payment must not orphan the one record that lets the app ask the
        // server what became of the gift.
        self.key = [
            "giving.pending",
            partition.environment,
            partition.accountId ?? "anonymous",
            partition.churchSlug ?? "-",
        ].joined(separator: "|")
    }

    public func save(_ attempt: DonationAttempt) async {
        guard let data = try? JSONEncoder.faithform.encode(attempt) else { return }
        try? store.write(data, for: key)
    }

    public func load() async -> DonationAttempt? {
        guard
            let data = try? store.read(key),
            let attempt = try? JSONDecoder.faithform.decode(DonationAttempt.self, from: data)
        else { return nil }
        return attempt
    }

    public func clear() async {
        try? store.delete(key)
    }
}
