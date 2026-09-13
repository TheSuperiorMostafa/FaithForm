import Foundation
import Testing

@testable import FaithFormKit

/// Giving, against the rules rather than against a payment sheet.
///
/// Everything here runs on a plain macOS test runner: no Stripe SDK, no network,
/// no device. That is deliberate — a payment flow whose correctness could only
/// be observed by opening a payment sheet would not be observed at all.

private let bounds = AmountBounds(minimumCents: 100, maximumCents: 500_000)

private let attempt = DonationAttempt(
    clientAttemptID: "attempt-abcdef01",
    churchSlug: "grace",
    fundID: "fund-1",
    amountCents: 5_000
)

// ---------------------------------------------------------------------------
// Amounts
// ---------------------------------------------------------------------------

@Suite("Giving amounts")
struct GivingAmountTests {

    @Test("a plain amount becomes cents")
    func plainAmounts() {
        #expect(validateAmount("50", bounds: bounds) == .valid(cents: 5_000))
        #expect(validateAmount("50.25", bounds: bounds) == .valid(cents: 5_025))
        #expect(validateAmount("  $50  ", bounds: bounds) == .valid(cents: 5_000))
    }

    @Test("a thousands separator is not a decimal point")
    func groupedAmounts() {
        // Rejecting "1,000" as "not a number" reads as the app being broken, and
        // reading it as one dollar would charge the wrong amount.
        #expect(validateAmount("1,000", bounds: bounds) == .valid(cents: 100_000))
        #expect(validateAmount("1,000.50", bounds: bounds) == .valid(cents: 100_050))
    }

    @Test("a comma decimal separator still means what it says")
    func commaDecimal() {
        // Most of the world writes 50,25.
        #expect(validateAmount("50,25", bounds: bounds) == .valid(cents: 5_025))
    }

    @Test("nothing, and nonsense, are different problems")
    func invalidAmounts() {
        #expect(validateAmount("   ", bounds: bounds) == .invalid(.empty))
        #expect(validateAmount("twenty", bounds: bounds) == .invalid(.notANumber))
        #expect(validateAmount("-5", bounds: bounds) == .invalid(.notANumber))
        #expect(validateAmount("0", bounds: bounds) == .invalid(.notANumber))
    }

    @Test("the fund's own bounds decide, and they are reported apart")
    func boundedAmounts() {
        let tight = AmountBounds(minimumCents: 500, maximumCents: 20_000)
        #expect(validateAmount("1", bounds: tight) == .invalid(.belowMinimum))
        #expect(validateAmount("500", bounds: tight) == .invalid(.aboveMaximum))
        // The bounds themselves are inside.
        #expect(validateAmount("5", bounds: tight) == .valid(cents: 500))
        #expect(validateAmount("200", bounds: tight) == .valid(cents: 20_000))
    }

    @Test("an absurd amount cannot overflow into a small one")
    func overflow() {
        #expect(validateAmount("99999999999", bounds: bounds) == .invalid(.aboveMaximum))
        #expect(validateAmount("999999999999999999999", bounds: bounds) == .invalid(.aboveMaximum))
    }

    @Test("both platforms read the same string the same way")
    func parity() {
        // The Kotlin suite asserts these exact pairs. A platform that disagreed
        // would charge two people different amounts for the same typing.
        let cases: [(String, AmountResult)] = [
            ("50", .valid(cents: 5_000)),
            ("50.25", .valid(cents: 5_025)),
            ("1,000", .valid(cents: 100_000)),
            ("50,25", .valid(cents: 5_025)),
            ("twenty", .invalid(.notANumber)),
            ("", .invalid(.empty)),
        ]
        for (input, expected) in cases {
            #expect(validateAmount(input, bounds: bounds) == expected, "\(input)")
        }
    }
}

// ---------------------------------------------------------------------------
// The state machine
// ---------------------------------------------------------------------------

@Suite("Donation phases")
struct DonationPhaseTests {

    @Test("a completed payment sheet is not a receipt")
    func sheetIsNotAReceipt() {
        // **The most important assertion in this module.** Stripe's sheet
        // completing means the payment was submitted. Only a webhook can say it
        // succeeded, and a version of this that returned `.confirmed` would show
        // a receipt for a gift that could still fail.
        let phase = advanceAfterSheet(.completed, attempt: attempt)
        #expect(phase == .awaitingConfirmation(attempt))
        if case .confirmed = phase { Issue.record("the sheet confirmed a gift") }
    }

    @Test("dismissing the sheet is not a failure")
    func cancellation() {
        #expect(advanceAfterSheet(.cancelled, attempt: attempt) == .cancelled(attempt))
    }

    @Test("a sheet failure carries a reason a person can act on")
    func failure() {
        #expect(
            advanceAfterSheet(.failed, attempt: attempt, failure: .network)
                == .failed(.network, attempt)
        )
    }

    @Test("only the server can confirm")
    func serverConfirms() {
        #expect(
            advanceAfterServer(.succeeded, attempt: attempt)
                == .confirmed(attemptID: attempt.clientAttemptID)
        )
    }

    @Test("waiting states keep waiting rather than claiming anything")
    func waiting() {
        for status: DonationStatus in [.initiated, .requiresAction, .processing] {
            #expect(
                advanceAfterServer(status, attempt: attempt) == .awaitingConfirmation(attempt),
                "\(status)"
            )
        }
        // And an unrecognised value from a newer server. A released app that
        // guessed here would be wrong exactly when the server had something new.
        let unknown = DonationStatus(rawValue: "settling_tomorrow")
        #expect(advanceAfterServer(unknown, attempt: attempt) == .awaitingConfirmation(attempt))
    }

    @Test("a declined payment is a failure, not a cancellation")
    func declined() {
        #expect(
            advanceAfterServer(.failed, attempt: attempt) == .failed(.paymentDeclined, attempt)
        )
    }

    @Test("polling backs off and then stops")
    func polling() {
        #expect(nextPollDelaySeconds(attempt: 0) == 1)
        #expect(nextPollDelaySeconds(attempt: 3) == 3)
        #expect(nextPollDelaySeconds(attempt: 8) == 6)
        // A phone that has polled for two minutes is not helped by a hundred
        // more requests. It says "processing" and stops.
        #expect(nextPollDelaySeconds(attempt: 20) == nil)
        #expect(nextPollDelaySeconds(attempt: 500) == nil)
    }
}

// ---------------------------------------------------------------------------
// The attempt survives the app
// ---------------------------------------------------------------------------

/// Stands in for the server's attempt claim.
///
/// Models the property that matters and nothing else: one intent per client
/// attempt id, whatever the call pattern.
private actor FakeDonationAPI {
    private(set) var intents: [String: String] = [:]
    private(set) var startCalls = 0
    private var gate: (stream: AsyncStream<Void>, continuation: AsyncStream<Void>.Continuation)?
    private var arrivalTarget: Int?
    private var arrivalWaiter: CheckedContinuation<Void, Never>?

    func openGate() {
        let (stream, continuation) = AsyncStream<Void>.makeStream()
        gate = (stream, continuation)
    }
    func releaseGate() { gate?.continuation.finish() }

    /// Suspends until `start` has been entered `count` times. `async let` creates
    /// a child task; it does not run it, so a test that released a gate in the
    /// next statement could release before anyone arrived — and prove nothing.
    func waitUntilCalls(_ count: Int) async {
        if startCalls >= count { return }
        arrivalTarget = count
        await withCheckedContinuation { arrivalWaiter = $0 }
    }

    func start(_ attempt: DonationAttempt) async -> String {
        startCalls += 1
        if let target = arrivalTarget, startCalls >= target {
            arrivalTarget = nil
            arrivalWaiter?.resume()
            arrivalWaiter = nil
        }
        if let gate { for await _ in gate.stream {} }
        if let existing = intents[attempt.clientAttemptID] { return existing }
        let intent = "pi_\(intents.count + 1)"
        intents[attempt.clientAttemptID] = intent
        return intent
    }
}

/// Stands in for the encrypted store the app keeps the pending attempt in.
private actor FakeAttemptStore {
    private var saved: DonationAttempt?
    func save(_ attempt: DonationAttempt) { saved = attempt }
    func load() -> DonationAttempt? { saved }
}

@Suite("Attempt identity")
struct AttemptIdentityTests {

    @Test("the same attempt id is reused after an interruption")
    func reusedAfterKill() async {
        // The scenario this whole mechanism exists for: the sheet is up, the app
        // is killed, the person opens it again. The retry must carry the id it
        // already used, so the server returns the intent that already exists.
        let store = FakeAttemptStore()
        await store.save(attempt)

        let recovered = await store.load()
        #expect(recovered?.clientAttemptID == attempt.clientAttemptID)

        let api = FakeDonationAPI()
        _ = await api.start(recovered!)
        _ = await api.start(recovered!)
        _ = await api.start(recovered!)

        // Three starts, one intent. Anything else is a duplicate charge.
        #expect(await api.intents.count == 1)
        #expect(await api.startCalls == 3)
    }

    @Test("two concurrent starts of one attempt produce one intent", .timeLimit(.minutes(1)))
    func concurrentStarts() async {
        let api = FakeDonationAPI()
        await api.openGate()

        async let first = api.start(attempt)
        // A rendezvous, not a hope: the second caller only runs once the first is
        // provably inside `start`.
        await api.waitUntilCalls(1)
        async let second = api.start(attempt)
        await api.waitUntilCalls(2)
        await api.releaseGate()
        _ = await (first, second)

        #expect(await api.intents.count == 1)
    }

    @Test("a different attempt is a different intent")
    func distinctAttempts() async {
        let api = FakeDonationAPI()
        _ = await api.start(attempt)
        var other = attempt
        other = DonationAttempt(
            clientAttemptID: "attempt-99999999",
            churchSlug: other.churchSlug,
            fundID: other.fundID,
            amountCents: other.amountCents
        )
        _ = await api.start(other)
        #expect(await api.intents.count == 2)
    }

    @Test("a fresh id is unique and fits the contract's bound")
    func freshIDs() {
        var seen = Set<String>()
        for _ in 0..<200 {
            let id = DonationAttempt.newAttemptID()
            #expect(id.count >= 8 && id.count <= 64)
            #expect(seen.insert(id).inserted, "a duplicate attempt id would merge two gifts")
        }
    }

    @Test("an attempt round-trips through storage unchanged")
    func codable() throws {
        // It is persisted before any network call, so it has to survive being
        // written and read back.
        let data = try JSONEncoder().encode(attempt)
        #expect(try JSONDecoder().decode(DonationAttempt.self, from: data) == attempt)
    }
}

// ---------------------------------------------------------------------------
// Wallets
// ---------------------------------------------------------------------------

@Suite("Apple Pay availability")
struct WalletTests {

    @Test("the server decides, and the device and the entitlement may each veto")
    func availability() {
        #expect(applePayAvailable(serverAllows: true, deviceCanMakePayments: true, merchantID: "merchant.io.faithform"))
        // A device reporting a wallet proves the wallet exists, not that this
        // church's Stripe account accepts it.
        #expect(!applePayAvailable(serverAllows: false, deviceCanMakePayments: true, merchantID: "merchant.io.faithform"))
        #expect(!applePayAvailable(serverAllows: true, deviceCanMakePayments: false, merchantID: "merchant.io.faithform"))
        // And a build with no merchant identifier is not entitled, whatever
        // anyone else says.
        #expect(!applePayAvailable(serverAllows: true, deviceCanMakePayments: true, merchantID: nil))
        #expect(!applePayAvailable(serverAllows: true, deviceCanMakePayments: true, merchantID: ""))
    }
}

// ---------------------------------------------------------------------------
// In the app, in Safari, or not at all
// ---------------------------------------------------------------------------

@Suite("Giving route")
struct GivingRouteTests {
    private let merchant = "merchant.io.faithform.app"
    private let page = "https://faithform.io/give/grace"

    @Test("an approved church, an entitled build and a capable device give in the app")
    func inApp() {
        #expect(
            givingRoute(
                applePayApproved: true,
                merchantID: merchant,
                deviceCanMakePayments: true,
                webGiveURL: page
            ) == .inApp
        )
    }

    @Test("a church Apple has not approved always gives in Safari")
    func notApproved() {
        // Guideline 3.2.1(vi). No combination of device and build makes an
        // unapproved church's gift legal inside the app.
        for canPay in [true, false] {
            for merchantID in [merchant, nil] {
                #expect(
                    givingRoute(
                        applePayApproved: false,
                        merchantID: merchantID,
                        deviceCanMakePayments: canPay,
                        webGiveURL: page
                    ) == .web(URL(string: page)!)
                )
            }
        }
    }

    @Test("an approved church in a build that cannot offer Apple Pay gives in Safari, not by card")
    func approvedWithoutApplePay() {
        // The trap this function exists for: approval alone would show Stripe's
        // sheet with cards only, which is an in-app donation without Apple Pay.
        for merchantID in [nil, "", "   "] {
            #expect(
                givingRoute(
                    applePayApproved: true,
                    merchantID: merchantID,
                    deviceCanMakePayments: true,
                    webGiveURL: page
                ) == .web(URL(string: page)!),
                "merchant \(merchantID ?? "nil")"
            )
        }
        #expect(
            givingRoute(
                applePayApproved: true,
                merchantID: merchant,
                deviceCanMakePayments: false,
                webGiveURL: page
            ) == .web(URL(string: page)!)
        )
    }

    @Test("with no way in and no give page, nothing is offered")
    func unavailable() {
        #expect(
            givingRoute(
                applePayApproved: false,
                merchantID: merchant,
                deviceCanMakePayments: true,
                webGiveURL: nil
            ) == .unavailable
        )
        #expect(
            givingRoute(
                applePayApproved: true,
                merchantID: nil,
                deviceCanMakePayments: true,
                webGiveURL: "   "
            ) == .unavailable
        )
    }

    @Test("only an https give page is ever opened")
    func httpsOnly() {
        for bad in ["http://faithform.io/give/grace", "javascript:alert(1)", "faithform://give", "not a url", "https://"] {
            #expect(
                givingRoute(
                    applePayApproved: false,
                    merchantID: nil,
                    deviceCanMakePayments: false,
                    webGiveURL: bad
                ) == .unavailable,
                "\(bad)"
            )
        }
    }

    @Test("the route reads straight off the funds response")
    func fromHome() {
        let approved = makeHome(applePayApproved: true)
        #expect(
            givingRoute(
                applePayApproved: approved.applePayApproved,
                merchantID: merchant,
                deviceCanMakePayments: true,
                webGiveURL: approved.webGiveUrl
            ) == .inApp
        )

        // A church that is not accepting has neither channel, server-side.
        let closed = makeHome(availability: "not_accepting", applePayApproved: false, webGiveUrl: nil)
        #expect(
            givingRoute(
                applePayApproved: closed.applePayApproved,
                merchantID: merchant,
                deviceCanMakePayments: true,
                webGiveURL: closed.webGiveUrl
            ) == .unavailable
        )
    }
}

@Suite("Pending donation store")
struct PendingDonationStoreTests {
    private func partition(account: String = "account-1", church: String = "grace", version: Int = 1) -> CachePartition {
        CachePartition(
            environment: "test",
            accountId: account,
            churchSlug: church,
            authorizationVersion: version
        )
    }

    @Test("an attempt survives being written and read back")
    func roundTrip() async {
        let keychain = InMemorySecureStore()
        let store = SecurePendingDonationStore(store: keychain, partition: partition())
        await store.save(attempt)
        #expect(await store.load() == attempt)

        await store.clear()
        #expect(await store.load() == nil)
        #expect(keychain.isEmpty())
    }

    @Test("another account or another church never sees the attempt")
    func partitioned() async {
        let keychain = InMemorySecureStore()
        await SecurePendingDonationStore(store: keychain, partition: partition()).save(attempt)

        #expect(await SecurePendingDonationStore(store: keychain, partition: partition(account: "account-2")).load() == nil)
        #expect(await SecurePendingDonationStore(store: keychain, partition: partition(church: "hope")).load() == nil)
        // An authorization bump mid-payment must not orphan the only record
        // that lets the app ask what became of the gift.
        #expect(await SecurePendingDonationStore(store: keychain, partition: partition(version: 2)).load() == attempt)
    }

    @Test("sign-out's sweep removes it")
    func purgedOnSignOut() async throws {
        let keychain = InMemorySecureStore()
        let store = SecurePendingDonationStore(store: keychain, partition: partition())
        await store.save(attempt)
        try keychain.deleteAll()
        #expect(await store.load() == nil)
    }
}

// ---------------------------------------------------------------------------
// Nothing sensitive is written down
// ---------------------------------------------------------------------------

@Suite("Giving redaction")
struct GivingRedactionTests {

    @Test("a client secret never survives a log line")
    func clientSecret() {
        let leaked = "failed for pi_3PabcDEfGh12345_secret_XyZ987654321 on acct_1A2b3C4d5E"
        let safe = redactForLog(leaked)
        // The *value* must be gone. Asserting the word "secret" is absent would
        // fail on the replacement itself, which is a test bug rather than a leak.
        #expect(!safe.contains("XyZ987654321"))
        #expect(!safe.contains("pi_3PabcDEfGh12345"))
        #expect(!safe.contains("acct_1A2b3C4d5E"))
        #expect(safe.contains("[client-secret]"))
        #expect(safe.contains("[account]"))
    }

    @Test("identifiers that name a person's gift are redacted too")
    func identifiers() {
        let safe = redactForLog("intent pi_3PabcDEfGh12345 customer cus_QRSTuv12345")
        #expect(safe.contains("[payment-intent]"))
        #expect(safe.contains("[customer]"))
        #expect(!safe.contains("cus_QRSTuv12345"))
    }

    @Test("a publishable key is redacted even though it is not secret")
    func publishableKey() {
        // Not a credential, and still not something to leave in a log where it
        // identifies which Stripe account an install is talking to.
        #expect(redactForLog("using pk_test_51Abcdefghijklmnop").contains("[publishable-key]"))
    }

    @Test("an ordinary message is left alone")
    func ordinary() {
        let message = "the gift is still processing"
        #expect(redactForLog(message) == message)
    }

    @Test("both platforms redact the same strings")
    func parity() {
        // The Kotlin suite drives these same inputs.
        let inputs = [
            "pi_3PabcDEfGh12345_secret_XyZ987654321",
            "acct_1A2b3C4d5E",
            "cus_QRSTuv12345",
            "pk_test_51Abcdefghijklmnop",
        ]
        for input in inputs {
            #expect(redactForLog(input).hasPrefix("["), "\(input) was not redacted")
        }
    }
}

// ---------------------------------------------------------------------------
// What the screen shows
// ---------------------------------------------------------------------------

private func makeHome(
    availability: String = "available",
    funds: [GivingFund] = [
        GivingFund(
            fundId: "fund-1",
            title: "General",
            description: nil,
            suggestedAmounts: [2_500, 5_000],
            minAmountCents: 100,
            maxAmountCents: 500_000,
            currency: "usd",
            publicationVersion: 1
        )
    ],
    recurring: Bool = false,
    applePayApproved: Bool = false,
    webGiveUrl: String? = "https://faithform.io/give/grace"
) -> GivingHome {
    GivingHome(
        availability: availability,
        churchName: "Grace Chapel",
        funds: funds,
        recurringAvailable: recurring,
        givingVersion: 1,
        applePayApproved: applePayApproved,
        webGiveUrl: webGiveUrl
    )
}

@Suite("Giving screen states")
struct GivingScreenStateTests {

    @Test("an amount is never abbreviated or rounded")
    func formatting() {
        // "$1.2K" on a receipt is not a number a person can check against a bank
        // statement.
        #expect(formatGivingAmount(cents: 5_000, currency: "usd") == "$50")
        #expect(formatGivingAmount(cents: 5_025, currency: "usd") == "$50.25")
        #expect(formatGivingAmount(cents: 5, currency: "usd") == "$0.05")
    }

    @Test("a loaded phase carries its funds and nothing else does")
    func phases() {
        let loaded = GivingListPhase.loaded(makeHome())
        #expect(loaded.funds.count == 1)
        #expect(GivingListPhase.loading.funds.isEmpty)
        #expect(GivingListPhase.blocked.funds.isEmpty)
        #expect(GivingListPhase.offline.home == nil)
    }

    @Test("the three empties are distinguishable from the phase alone")
    func empties() {
        // A church that cannot charge, a church with no funds, and a church a
        // visitor is blocked from are three different sentences.
        let notAccepting = GivingListPhase.loaded(makeHome(availability: "not_accepting"))
        #expect(notAccepting.home?.availability == "not_accepting")

        let noFunds = GivingListPhase.loaded(makeHome(funds: []))
        #expect(noFunds.funds.isEmpty)
        #expect(noFunds.home?.availability == "available")

        #expect(GivingListPhase.blocked.home == nil)
    }

    @Test("recurring is mentioned only when the church actually runs it")
    func recurring() {
        #expect(GivingListPhase.loaded(makeHome()).home?.recurringAvailable == false)
        #expect(GivingListPhase.loaded(makeHome(recurring: true)).home?.recurringAvailable == true)
    }
}
