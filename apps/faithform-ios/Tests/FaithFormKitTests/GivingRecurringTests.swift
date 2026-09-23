import Foundation
import Testing

@testable import FaithFormKit

/// Recurring giving, against the rules rather than against a payment sheet.
///
/// Same arrangement as `GivingTests`: plain macOS runner, no Stripe SDK, no
/// network, no device. The properties here are the ones that would cost a
/// person money if they broke, and every one of them is decidable without
/// charging anybody.

private let attempt = RecurringAttempt(
    clientAttemptID: "attempt-abcdef01",
    churchSlug: "grace",
    fundID: "fund-1",
    amountCents: 2_500,
    cadence: .month
)

private func gift(
    id: String = "sub-1",
    interval: String = "month",
    status: String = "active",
    amountCents: Int = 2_500
) -> RecurringGift {
    RecurringGift(
        subscriptionId: id,
        fundTitle: "General",
        amountCents: amountCents,
        currency: "usd",
        interval: interval,
        status: status,
        startedAt: "2026-03-01T10:00:00Z"
    )
}

// ---------------------------------------------------------------------------
// The attempt
// ---------------------------------------------------------------------------

@Suite("Recurring attempts")
struct RecurringAttemptTests {

    @Test("an attempt round-trips through storage unchanged")
    func codable() throws {
        // Persisted before any network call, so it has to survive being written
        // and read back — including its cadence, which a resumed request must
        // re-send exactly as it was sent.
        let data = try JSONEncoder().encode(attempt)
        #expect(try JSONDecoder().decode(RecurringAttempt.self, from: data) == attempt)
    }

    @Test("two attempt ids are never the same, and both fit the contract's bound")
    func attemptIDs() {
        let ids = (0..<200).map { _ in RecurringAttempt.newAttemptID() }
        #expect(Set(ids).count == ids.count)
        // The contract accepts 8...64. An id outside it would be refused by the
        // server at exactly the moment a person committed to a monthly gift.
        for id in ids { #expect(id.count >= 8 && id.count <= 64) }
    }

    @Test("the cadence a client sends is the one the contract names")
    func wireValues() {
        // A mapping table between these two would eventually disagree, and the
        // disagreement would be a weekly gift charged monthly.
        #expect(RecurringCadence.week.wireValue == GivingInterval.week.rawValue)
        #expect(RecurringCadence.month.wireValue == GivingInterval.month.rawValue)
    }
}

// ---------------------------------------------------------------------------
// The state machine
// ---------------------------------------------------------------------------

@Suite("Recurring phases")
struct RecurringPhaseTests {

    @Test("a completed sheet means started, never active")
    func completedIsNotActive() {
        // The single most important assertion in this file. The sheet finishing
        // means an SDK confirmed the first invoice; whether the subscription is
        // active comes from a webhook, and a phase that claimed otherwise would
        // tell people a gift renews when it may never charge again.
        #expect(advanceRecurringAfterSheet(.completed, attempt: attempt) == .started(attempt))
    }

    @Test("a dismissed sheet is not a failure")
    func cancelled() {
        #expect(advanceRecurringAfterSheet(.cancelled, attempt: attempt) == .cancelled(attempt))
    }

    @Test("a failed sheet carries the attempt, so a retry resumes rather than restarts")
    func failed() {
        #expect(
            advanceRecurringAfterSheet(.failed, attempt: attempt)
                == .failed(.paymentDeclined, attempt)
        )
        #expect(
            advanceRecurringAfterSheet(.failed, attempt: attempt, failure: .network)
                == .failed(.network, attempt)
        )
    }
}

// ---------------------------------------------------------------------------
// What a listed gift says
// ---------------------------------------------------------------------------

@Suite("Listed recurring gifts")
struct RecurringGiftListingTests {

    @Test("every status the server can send is stoppable")
    func stoppable() {
        // The projection omits cancelled gifts, so everything that arrives is
        // something a person can end. A row without a working Stop button is a
        // recurring charge with no way out of it.
        for status in ["active", "trialing", "past_due", "paused", "unpaid"] {
            #expect(recurringGiftIsStoppable(status), "\(status) should be stoppable")
        }
    }

    @Test("a status this build predates offers no button it cannot honour")
    func unknownStatus() {
        // A released app must not draw a Stop button for a state it does not
        // understand — but the row itself still lists, which the card's own
        // rendering guarantees. Invisible is worse than unstoppable.
        #expect(!recurringGiftIsStoppable("some_future_state"))
    }

    @Test("only the states that want something get a notice")
    func notices() {
        // A row of green "active" badges makes the one row that needs attention
        // harder to find, not easier.
        #expect(recurringGiftNotice("active") == nil)
        #expect(recurringGiftNotice("trialing") == nil)
        #expect(recurringGiftNotice("past_due") != nil)
        #expect(recurringGiftNotice("unpaid") != nil)
        #expect(recurringGiftNotice("paused") != nil)
        #expect(recurringGiftNotice("some_future_state") == nil)
    }

    @Test("an interval this build does not offer still reads as something")
    func unknownInterval() {
        // An annual gift started on the church's web page, or a cadence a later
        // server introduces. It renders as itself rather than vanishing.
        #expect(recurringIntervalTitle("year") == L.givingCadenceYearly)
        #expect(recurringIntervalTitle("fortnight") == "fortnight")
        #expect(!recurringIntervalTitle("fortnight").isEmpty)
    }

    @Test("an amount is never abbreviated, at any cadence")
    func amounts() {
        // `$1.2K` on a recurring gift is not a number a person can check
        // against their bank.
        let phrase = RecurringCadence.month.amountPhrase(
            formatGivingAmount(cents: 120_000, currency: "usd")
        )
        #expect(phrase.contains("1,200"))
        #expect(!phrase.localizedCaseInsensitiveContains("K"))
    }

    @Test("gifts are identified by FaithForm's row id, never a provider's")
    func identifiers() {
        // The contract carries no Stripe subscription id at all, so there is no
        // way for one to reach a phone by accident.
        let listed = gift()
        #expect(!listed.subscriptionId.hasPrefix("sub_"))
        let mirror = Mirror(reflecting: listed)
        let names = mirror.children.compactMap(\.label)
        #expect(!names.contains { $0.localizedCaseInsensitiveContains("stripe") })
        #expect(!names.contains { $0.localizedCaseInsensitiveContains("customer") })
        #expect(!names.contains { $0.localizedCaseInsensitiveContains("email") })
    }
}
