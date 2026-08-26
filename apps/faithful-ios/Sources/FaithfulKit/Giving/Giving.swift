import Foundation

/// Giving, decided in plain Swift.
///
/// Everything that determines what a person is charged, what they are told, and
/// what happens when their phone dies mid-payment is here, where `swift test`
/// reaches it. The Stripe payment sheet is behind ``PaymentSheetFacade`` and
/// holds no decisions of its own.
///
/// ## The one rule this file exists to enforce
///
/// **A payment sheet completing is not a receipt.** The sheet reports that an
/// SDK finished. Only the server, having been told by a verified Stripe webhook,
/// can say a gift happened. ``DonationPhase`` makes that structural rather than
/// a convention someone can forget.

// ---------------------------------------------------------------------------
// Amounts
// ---------------------------------------------------------------------------

/// Why an amount cannot be given. Each maps to one sentence the person reads.
public enum AmountProblem: Equatable, Sendable {
    case empty
    case notANumber
    case belowMinimum
    case aboveMaximum
}

public enum AmountResult: Equatable, Sendable {
    case valid(cents: Int)
    case invalid(AmountProblem)
}

/// The bounds a fund carries. Mirrors `GivingFund` without depending on it, so
/// the rules can be exercised without building a whole contract value.
public struct AmountBounds: Equatable, Sendable {
    public let minimumCents: Int
    public let maximumCents: Int

    public init(minimumCents: Int, maximumCents: Int) {
        self.minimumCents = minimumCents
        self.maximumCents = maximumCents
    }
}

/// Validates a typed amount against a fund's own bounds.
///
/// Client-side, and deliberately **not** authoritative: the server re-checks
/// against the same fund row, and the SQL that creates the attempt checks it a
/// third time. This exists so a person is told before they reach a payment
/// sheet, not so the server can trust it.
///
/// Accepts what a person actually types — a currency symbol, thousands
/// separators, a comma decimal — because rejecting `1,000` as "not a number" is
/// a bug that reads as the app being broken.
public func validateAmount(_ raw: String, bounds: AmountBounds) -> AmountResult {
    var cleaned = raw.trimmingCharacters(in: .whitespacesAndNewlines)
    cleaned = cleaned.replacingOccurrences(of: "$", with: "")
    cleaned = cleaned.replacingOccurrences(of: " ", with: "")
    if cleaned.isEmpty { return .invalid(.empty) }

    // A comma is a thousands separator when digits follow in threes, and a
    // decimal separator otherwise. Both are common; guessing wrong charges the
    // wrong amount, so the shape decides rather than a locale assumption.
    let groupedPattern = try? NSRegularExpression(pattern: "^\\d{1,3}(,\\d{3})+$")
    let isGrouped =
        groupedPattern?.firstMatch(
            in: cleaned,
            range: NSRange(cleaned.startIndex..., in: cleaned)
        ) != nil

    let normalised: String
    if cleaned.contains(".") {
        normalised = cleaned.replacingOccurrences(of: ",", with: "")
    } else if isGrouped {
        normalised = cleaned.replacingOccurrences(of: ",", with: "")
    } else {
        normalised = cleaned.replacingOccurrences(of: ",", with: ".")
    }

    guard let value = Decimal(string: normalised, locale: Locale(identifier: "en_US_POSIX")),
          value > 0
    else {
        return .invalid(.notANumber)
    }

    // Rounded rather than truncated: 50.005 is a person meaning half a cent more,
    // not a person meaning less than they typed.
    var scaled = value * 100
    var rounded = Decimal()
    NSDecimalRound(&rounded, &scaled, 0, .plain)

    let asDouble = NSDecimalNumber(decimal: rounded).doubleValue
    guard asDouble <= Double(Int.max) else { return .invalid(.aboveMaximum) }
    let cents = NSDecimalNumber(decimal: rounded).intValue

    if cents < bounds.minimumCents { return .invalid(.belowMinimum) }
    if cents > bounds.maximumCents { return .invalid(.aboveMaximum) }
    return .valid(cents: cents)
}

// ---------------------------------------------------------------------------
// The logical attempt
// ---------------------------------------------------------------------------

/// One donation a person started, identified by something that survives.
///
/// The id is generated once, when the person commits to an amount, and is
/// **persisted before any network call**. That ordering is the whole defence: a
/// phone killed between generating an id and sending it has nothing to retry,
/// and a phone killed after sending has an id that will find the intent it
/// already created rather than making a second one.
public struct DonationAttempt: Equatable, Sendable, Codable {
    public let clientAttemptID: String
    public let churchSlug: String
    public let fundID: String
    public let amountCents: Int

    public init(clientAttemptID: String, churchSlug: String, fundID: String, amountCents: Int) {
        self.clientAttemptID = clientAttemptID
        self.churchSlug = churchSlug
        self.fundID = fundID
        self.amountCents = amountCents
    }

    /// A fresh id, long enough that two are never the same and short enough for
    /// the contract's own bound.
    public static func newAttemptID() -> String {
        UUID().uuidString.replacingOccurrences(of: "-", with: "").lowercased()
    }
}

/// What went wrong, in this app's own vocabulary.
///
/// Deliberately small, and deliberately not Stripe's. A provider error message
/// is written for a developer, can name an acquirer or an issuer decline code,
/// and is never shown or logged.
public enum GivingFailure: Equatable, Sendable {
    case paymentDeclined
    case network
    case churchNotAccepting
    case notAllowed
    case unavailable
}

/// Where a person's donation has got to.
///
/// `confirmed` is reachable only from a server response, never from the payment
/// sheet — see ``advanceAfterSheet(_:attempt:failure:)``.
public enum DonationPhase: Equatable, Sendable {
    case idle
    case preparing
    case presenting(DonationAttempt)
    /// The sheet finished and the server has not confirmed. The screen a person
    /// waits on — not a success, and the wording must never suggest it is.
    case awaitingConfirmation(DonationAttempt)
    /// The server says the gift succeeded. The only state that shows a receipt.
    case confirmed(attemptID: String)
    /// The person dismissed the sheet. Not a failure; nothing was charged.
    case cancelled(DonationAttempt)
    case failed(GivingFailure, DonationAttempt?)
}

/// What the payment sheet reported. Three outcomes, and nothing about money.
public enum SheetOutcome: Equatable, Sendable {
    case completed
    case cancelled
    case failed
}

/// The state after a payment sheet closes.
///
/// **`.completed` maps to `.awaitingConfirmation`, never to `.confirmed`.** This
/// is the single most important function in the module: Stripe's own
/// documentation is explicit that the sheet's completion means the payment was
/// submitted, and that final state comes from a webhook. A version of this that
/// returned `.confirmed` would show a receipt for a gift that could still fail,
/// and would do so most often for exactly the payments that need review.
public func advanceAfterSheet(
    _ outcome: SheetOutcome,
    attempt: DonationAttempt,
    failure: GivingFailure = .paymentDeclined
) -> DonationPhase {
    switch outcome {
    case .completed: return .awaitingConfirmation(attempt)
    case .cancelled: return .cancelled(attempt)
    case .failed: return .failed(failure, attempt)
    }
}

/// The state after the server reports what it knows.
///
/// `initiated` and `requiresAction` keep a person waiting rather than telling
/// them anything: the first means nothing has happened yet, and the second means
/// the bank is still asking. Neither is an outcome.
public func advanceAfterServer(
    _ status: DonationStatus,
    attempt: DonationAttempt
) -> DonationPhase {
    switch status {
    case .succeeded:
        return .confirmed(attemptID: attempt.clientAttemptID)
    case .failed:
        return .failed(.paymentDeclined, attempt)
    case .cancelled:
        return .cancelled(attempt)
    case .refunded, .disputed:
        // A refund or a dispute after the fact is a history state, not something
        // that happens while a person watches a spinner. They resolve as
        // themselves in history and end this flow.
        return .confirmed(attemptID: attempt.clientAttemptID)
    default:
        // Includes `initiated`, `requiresAction`, `processing`, and any value a
        // newer server introduces. A released app that guessed here would be
        // wrong exactly when the server had something new to say.
        return .awaitingConfirmation(attempt)
    }
}

/// How long to wait before asking again.
///
/// Backs off, and stops. A phone that has polled for two minutes without an
/// answer is not going to be helped by a hundred more requests: it shows the
/// gift as processing, tells the person their receipt will arrive, and stops.
public func nextPollDelaySeconds(attempt: Int) -> Double? {
    switch attempt {
    case ..<0: return nil
    case 0..<3: return 1
    case 3..<8: return 3
    case 8..<20: return 6
    default: return nil
    }
}

// ---------------------------------------------------------------------------
// The payment sheet, behind a seam
// ---------------------------------------------------------------------------

/// Everything the sheet needs. Assembled by the server; never by this app.
public struct PaymentSheetRequest: Equatable, Sendable {
    public let clientSecret: String
    public let publishableKey: String
    /// The connected account. An identifier, not a credential.
    public let stripeAccountID: String
    public let merchantName: String
    /// Only ever true when the server said the platform is configured for it.
    public let allowApplePay: Bool
    /// Apple's own merchant identifier, from the app's entitlement.
    public let appleMerchantID: String?

    public init(
        clientSecret: String,
        publishableKey: String,
        stripeAccountID: String,
        merchantName: String,
        allowApplePay: Bool,
        appleMerchantID: String?
    ) {
        self.clientSecret = clientSecret
        self.publishableKey = publishableKey
        self.stripeAccountID = stripeAccountID
        self.merchantName = merchantName
        self.allowApplePay = allowApplePay
        self.appleMerchantID = appleMerchantID
    }
}

/// The Stripe payment sheet, as this app is allowed to see it.
///
/// One method, three outcomes, no money. Every decision that depends on the
/// result is in this module, where a test can reach it.
public protocol PaymentSheetFacade: Actor {
    func present(_ request: PaymentSheetRequest) async -> SheetOutcome
}

/// Whether Apple Pay may be offered.
///
/// Three conditions, all required, and the app's two are the weaker ones: a
/// device that can make payments proves a wallet exists, and a merchant
/// identifier proves this build is entitled — neither proves this church's
/// Stripe account accepts it. So the server's answer is the gate and the
/// device's is a veto.
public func applePayAvailable(
    serverAllows: Bool,
    deviceCanMakePayments: Bool,
    merchantID: String?
) -> Bool {
    guard let merchantID, !merchantID.isEmpty else { return false }
    return serverAllows && deviceCanMakePayments
}

// ---------------------------------------------------------------------------
// What must never be written down
// ---------------------------------------------------------------------------

/// Redacts anything that must not reach a log, a crash report or a cache.
///
/// Applied to every string this feature logs. A client secret is a bearer
/// credential for one payment; a payment intent id identifies a person's gift.
/// Neither belongs anywhere a support engineer or a crash reporter can read it.
public func redactForLog(_ message: String) -> String {
    var result = message
    let patterns: [(String, String)] = [
        ("(pi|seti)_[A-Za-z0-9]+_secret_[A-Za-z0-9]+", "[client-secret]"),
        ("pi_[A-Za-z0-9]{6,}", "[payment-intent]"),
        ("acct_[A-Za-z0-9]{6,}", "[account]"),
        ("cus_[A-Za-z0-9]{6,}", "[customer]"),
        ("pk_(test|live)_[A-Za-z0-9]{6,}", "[publishable-key]"),
    ]
    for (pattern, replacement) in patterns {
        guard let regex = try? NSRegularExpression(pattern: pattern) else { continue }
        result = regex.stringByReplacingMatches(
            in: result,
            range: NSRange(result.startIndex..., in: result),
            withTemplate: replacement
        )
    }
    return result
}
