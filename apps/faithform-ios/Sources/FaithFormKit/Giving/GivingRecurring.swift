import Foundation

/// Recurring giving, decided in plain Swift.
///
/// The same arrangement as `Giving.swift`, and for the same reason: everything
/// that decides what a person is charged, what they are told, and what happens
/// when their phone dies mid-payment lives here, where `swift test` reaches it.
///
/// ## The rule this file exists to enforce
///
/// **A payment sheet completing is not a gift that renews.** The sheet reports
/// that an SDK finished confirming the first invoice. Only the server, told by
/// a verified Stripe webhook, knows the subscription became active — so
/// ``RecurringPhase`` has a state for "started, not yet confirmed" and the
/// wording for it never claims more than that.
///
/// ## Why this is stricter than a one-time gift
///
/// A duplicated one-time gift is one wrong charge and a refund conversation. A
/// duplicated subscription is a wrong charge **every month**, and nobody
/// notices until a bank statement arrives. So the attempt id is generated and
/// persisted before the network call, exactly as `DonationAttempt` is, and the
/// same id is re-sent after every interruption.

// ---------------------------------------------------------------------------
// Cadence
// ---------------------------------------------------------------------------

/// How often a recurring gift is charged, as this app offers it.
///
/// Weekly and monthly only. `GivingInterval` — the wire enum — also carries
/// `year`, because a gift started on the church's web page can be annual and
/// must still be listable; it is simply not something the app offers to start.
/// A person wanting to give yearly is better served by the church's own page
/// than by a picker with a rarely-right third option on it.
public enum RecurringCadence: String, CaseIterable, Equatable, Sendable, Codable {
    case week
    case month

    /// The wire value. Deliberately the same strings the contract's
    /// `GivingInterval` uses, so no mapping table can drift.
    public var wireValue: String { rawValue }

    public var title: String {
        switch self {
        case .week: return L.givingCadenceWeekly
        case .month: return L.givingCadenceMonthly
        }
    }

    /// How an amount reads at this cadence — "$25 every month".
    public func amountPhrase(_ formattedAmount: String) -> String {
        switch self {
        case .week: return L.givingEveryWeekAmount(formattedAmount)
        case .month: return L.givingEveryMonthAmount(formattedAmount)
        }
    }
}

/// Renders any interval the server can send, including one this build predates.
///
/// A released app must be able to *list* a gift whose cadence it does not offer
/// — an annual gift started on the web, or a cadence a later server adds. An
/// unknown value reads as itself rather than as a crash or a silent omission,
/// because a recurring charge a person cannot see is a recurring charge they
/// cannot stop.
public func recurringIntervalTitle(_ raw: String) -> String {
    switch GivingInterval(rawValue: raw) {
    case .week: return L.givingCadenceWeekly
    case .month: return L.givingCadenceMonthly
    case .year: return L.givingCadenceYearly
    case let .unknown(value): return value
    }
}

// ---------------------------------------------------------------------------
// The logical attempt
// ---------------------------------------------------------------------------

/// One recurring gift a person started, identified by something that survives.
///
/// Carries the cadence as well as the fund and amount, because resuming has to
/// re-send exactly what was sent — the server keys the attempt on the id, and a
/// resumed request that disagreed about the cadence would be a different gift
/// wearing the same id.
public struct RecurringAttempt: Equatable, Sendable, Codable {
    public let clientAttemptID: String
    public let churchSlug: String
    public let fundID: String
    public let amountCents: Int
    public let cadence: RecurringCadence

    public init(
        clientAttemptID: String,
        churchSlug: String,
        fundID: String,
        amountCents: Int,
        cadence: RecurringCadence
    ) {
        self.clientAttemptID = clientAttemptID
        self.churchSlug = churchSlug
        self.fundID = fundID
        self.amountCents = amountCents
        self.cadence = cadence
    }

    /// A fresh id, long enough that two are never the same and short enough for
    /// the contract's own bound.
    public static func newAttemptID() -> String {
        UUID().uuidString.replacingOccurrences(of: "-", with: "").lowercased()
    }
}

// ---------------------------------------------------------------------------
// The state machine
// ---------------------------------------------------------------------------

/// Where starting a recurring gift has got to.
///
/// `started` is the end of what this app can know on its own: the first payment
/// was submitted and the subscription exists. Whether it is *active* is the
/// webhook's to say, and the list on the Give screen is where that answer
/// shows up.
public enum RecurringPhase: Equatable, Sendable {
    case idle
    case preparing
    case presenting(RecurringAttempt)
    /// The sheet finished. The gift is started and the server has not confirmed
    /// the first payment — the wording must never say "active".
    case started(RecurringAttempt)
    /// The person dismissed the sheet. Nothing was charged and nothing renews:
    /// a subscription whose first invoice is unpaid is `incomplete`, and Stripe
    /// expires it rather than charging later.
    case cancelled(RecurringAttempt)
    case failed(RecurringFailure, RecurringAttempt?)
}

/// What went wrong, in this app's own vocabulary — never Stripe's.
///
/// `noEmail` is the one a person can act on, and it exists because a church's
/// donor record is keyed by email and a renewal receipt has to go somewhere.
public enum RecurringFailure: Equatable, Sendable {
    case paymentDeclined
    case network
    case churchNotAccepting
    case notAllowed
    case noEmail
    case unavailable
}

/// The state after the payment sheet closes on a recurring gift.
///
/// **`.completed` maps to `.started`, never to anything that claims the gift is
/// active.** Same rule as `advanceAfterSheet` for a one-time gift, and the same
/// reason: the sheet reports that an SDK finished, and a subscription's real
/// state arrives by webhook.
public func advanceRecurringAfterSheet(
    _ outcome: SheetOutcome,
    attempt: RecurringAttempt,
    failure: RecurringFailure = .paymentDeclined
) -> RecurringPhase {
    switch outcome {
    case .completed: return .started(attempt)
    case .cancelled: return .cancelled(attempt)
    case .failed: return .failed(failure, attempt)
    }
}

/// Whether a recurring gift the server listed is one a person can stop.
///
/// Everything the projection returns is stoppable — it omits cancelled gifts
/// entirely. This exists so a newer server adding a state cannot produce a row
/// with a Stop button that does nothing: an unrecognised status reads as not
/// stoppable, and the row still lists so the gift is never invisible.
public func recurringGiftIsStoppable(_ raw: String) -> Bool {
    switch RecurringGiftStatus(rawValue: raw) {
    case .active, .trialing, .pastDue, .paused, .unpaid: return true
    case .unknown: return false
    }
}

/// What a listed gift's state says to the person who started it.
///
/// `active` and `trialing` say nothing at all: a gift that is simply working
/// does not need a label, and a row of green badges makes the one row that
/// *does* need attention harder to find. Only the states that want something
/// from a person get words.
public func recurringGiftNotice(_ raw: String) -> String? {
    switch RecurringGiftStatus(rawValue: raw) {
    case .active, .trialing: return nil
    case .pastDue, .unpaid: return L.givingRecurringPaymentProblem
    case .paused: return L.givingRecurringPaused
    case .unknown: return nil
    }
}
