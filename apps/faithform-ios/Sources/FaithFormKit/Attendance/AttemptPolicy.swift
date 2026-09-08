import Foundation

/// Why a new logical attempt may begin.
///
/// A geofence callback on its own is **not** a reason. The OS re-delivers, a
/// phone at a boundary oscillates, and a stale callback can arrive minutes
/// late; treating each one as a fresh workflow is how a device ends up
/// submitting the same doomed evidence over and over.
public enum AttemptTrigger: Equatable, Sendable {
    /// The first entry seen for this occurrence.
    case firstEntry
    /// A verified exit followed by a re-entry — the person actually left and
    /// came back, which is genuinely new information.
    case exitThenReentry
    /// This fix is materially better than the one that was refused. A cold GPS
    /// sharpening as someone walks inside is exactly the case that used to be
    /// locked out.
    case improvedAccuracy(previousMeters: Double, currentMeters: Double)
    /// The cooldown elapsed. Time alone is a weak signal, but a real one: the
    /// person may simply have moved.
    case cooldownElapsed
    /// The server's configuration changed — a policy edit, a moved campus, a
    /// restored consent. Whatever refused before may not refuse now.
    case configurationChanged
}

/// What the attempt policy decided.
public enum AttemptDecision: Equatable, Sendable {
    /// Open a new logical attempt and submit.
    case proceed(AttemptTrigger)
    /// Not yet. `nextEligibleAt` is when it will be worth trying again.
    ///
    /// **Never permanent.** There is no case here that means "this occurrence
    /// is finished for you" other than an actual count.
    case waitUntil(Date, reason: HoldReason)
    /// Already counted. Nothing further is needed for this occurrence.
    case alreadySettled
}

public enum HoldReason: String, Equatable, Sendable {
    /// Backing off after a refusal. Exponential, capped at `maxCooldown`.
    case cooldown
    /// The token bucket is empty. At most one refill interval away.
    case throttled
    /// Nothing has changed since the last refusal, and the cooldown is running.
    case noNewSignal
}

/// The anti-flapping state for one occurrence.
///
/// **This replaces a hard cap of five refused attempts, which was the original
/// bug wearing a larger number.** Five poor readings on arrival — indoors,
/// phone cold, walking past a wall — would permanently prevent that person
/// being counted at that service, which is precisely the failure the logical
/// attempt was introduced to remove.
///
/// What replaces it:
///
/// - **Exponential cooldown**, so a flapping boundary costs one submission and
///   then progressively fewer.
/// - **A continuously refilling token bucket**, so a pathological burst is
///   throttled without any individual attempt being forbidden. An earlier
///   version used a 12-per-rolling-hour budget, which was the same lockout
///   again: spend it in two minutes and the next attempt is an hour away —
///   longer than the service. A bucket's worst case is one token, not a window.
/// - **`nextEligibleAt`**, never `ineligible`. The occurrence stays open, and
///   `maxLocalHold` states the bound explicitly.
/// - **Meaningful triggers** that bypass the cooldown, because a materially
///   better fix or a configuration change is new information and waiting on it
///   would be the lockout again.
///
/// Server rate limiting and the unique counted fact remain authoritative; none
/// of this is a correctness guard.
public struct AttemptPolicy: Equatable, Sendable {
    /// A **continuously refilling token bucket**, not a windowed budget.
    ///
    /// A previous version allowed 12 submissions per rolling hour. That was a
    /// lockout in disguise: spend them in the first two minutes and the next
    /// one is up to an hour away — longer than the service the person is
    /// sitting in.
    ///
    /// A bucket refills continuously, so the worst case is the time for **one**
    /// token, not for a window to slide.
    public static let bucketCapacity = 12.0

    /// One token a minute. Geofence responsiveness is around two minutes on
    /// Android, so this is comfortably above the rate real events arrive at,
    /// and it makes the empty-bucket wait exactly one minute.
    public static let tokenRefillInterval: TimeInterval = 60

    /// Doubling, from 30 s, capped at 10 minutes. Well below a service.
    public static let baseCooldown: TimeInterval = 30
    public static let maxCooldown: TimeInterval = 10 * 60

    /// **The explicit bound on any local hold.**
    ///
    /// Whatever combination of cooldown and throttle applies, the device will
    /// be eligible again within this. Ten minutes is the cooldown ceiling; the
    /// bucket's worst case is one minute, so the cooldown is always the binding
    /// constraint and this number is the honest maximum.
    public static let maxLocalHold: TimeInterval = maxCooldown

    /// An accuracy improvement worth retrying on. A fix that went from ±120 m
    /// to ±15 m is a different observation, not a repeat of the same one.
    public static let materialAccuracyRatio = 2.0
    public static let materialAccuracyDelta: Double = 25

    public private(set) var refusals: Int
    /// Tokens remaining, and when that figure was accurate.
    public private(set) var tokens: Double
    public private(set) var tokensAt: Date?
    public private(set) var lastRefusalAt: Date?
    public private(set) var lastAccuracyMeters: Double?
    public private(set) var lastConfigVersion: Int?
    public private(set) var sawExit: Bool
    public private(set) var settled: Bool

    public init(
        refusals: Int = 0,
        tokens: Double = AttemptPolicy.bucketCapacity,
        tokensAt: Date? = nil,
        lastRefusalAt: Date? = nil,
        lastAccuracyMeters: Double? = nil,
        lastConfigVersion: Int? = nil,
        sawExit: Bool = false,
        settled: Bool = false
    ) {
        self.refusals = refusals
        self.tokens = tokens
        self.tokensAt = tokensAt
        self.lastRefusalAt = lastRefusalAt
        self.lastAccuracyMeters = lastAccuracyMeters
        self.lastConfigVersion = lastConfigVersion
        self.sawExit = sawExit
        self.settled = settled
    }

    /// Exponential, bounded. `2^n * 30 s`, capped at ten minutes.
    public var cooldown: TimeInterval {
        guard refusals > 0 else { return 0 }
        return min(Self.baseCooldown * pow(2, Double(refusals - 1)), Self.maxCooldown)
    }

    public func nextEligibleAt(now: Date) -> Date {
        guard let lastRefusalAt else { return now }
        return lastRefusalAt.addingTimeInterval(cooldown)
    }

    /// Tokens available at `now`, refilled continuously since `tokensAt`.
    public func availableTokens(now: Date) -> Double {
        guard let tokensAt else { return Self.bucketCapacity }
        let elapsed = max(0, now.timeIntervalSince(tokensAt))
        return min(Self.bucketCapacity, tokens + elapsed / Self.tokenRefillInterval)
    }

    /// When the next whole token arrives. **Never more than one refill
    /// interval away**, which is what makes the throttle a delay rather than a
    /// lockout.
    public func nextTokenAt(now: Date) -> Date {
        let available = availableTokens(now: now)
        if available >= 1 { return now }
        return now.addingTimeInterval((1 - available) * Self.tokenRefillInterval)
    }

    /// Whether this reading is materially better than the one that was refused.
    func isImproved(_ accuracyMeters: Double?) -> Bool {
        guard let current = accuracyMeters, current > 0 else { return false }
        guard let previous = lastAccuracyMeters, previous > 0 else {
            // No previous reading to compare against — a first usable fix after
            // an unusable one is an improvement.
            return true
        }
        return current * Self.materialAccuracyRatio <= previous
            || previous - current >= Self.materialAccuracyDelta
    }

    /// Decides whether a new attempt may begin.
    public func decide(
        now: Date,
        accuracyMeters: Double?,
        configVersion: Int?
    ) -> AttemptDecision {
        if settled { return .alreadySettled }
        if refusals == 0 { return .proceed(.firstEntry) }

        // Meaningful signals bypass the cooldown entirely. Making someone with
        // a now-excellent fix wait out a backoff earned by a bad one would be
        // the lockout in slower motion.
        if sawExit { return .proceed(.exitThenReentry) }

        if let configVersion, let lastConfigVersion, configVersion != lastConfigVersion {
            return .proceed(.configurationChanged)
        }

        if isImproved(accuracyMeters) {
            return .proceed(
                .improvedAccuracy(
                    previousMeters: lastAccuracyMeters ?? .infinity,
                    currentMeters: accuracyMeters ?? .infinity
                )
            )
        }

        // The bucket protects the battery and the API. It refills continuously,
        // so an empty one is at most `tokenRefillInterval` from a token — never
        // a window that has to slide past.
        if availableTokens(now: now) < 1 {
            return .waitUntil(nextTokenAt(now: now), reason: .throttled)
        }

        let eligible = nextEligibleAt(now: now)
        if now < eligible { return .waitUntil(eligible, reason: .cooldown) }

        return .proceed(.cooldownElapsed)
    }

    // MARK: - Transitions

    /// Spends a token. Refills first, so the figure recorded is accurate at
    /// `now` rather than at whenever it was last touched.
    public func recordingSubmission(at now: Date) -> AttemptPolicy {
        var next = self
        next.tokens = max(0, availableTokens(now: now) - 1)
        next.tokensAt = now
        next.sawExit = false
        return next
    }

    public func recordingRefusal(at now: Date, accuracyMeters: Double?, configVersion: Int?) -> AttemptPolicy {
        var next = self
        next.refusals += 1
        next.lastRefusalAt = now
        if let accuracyMeters, accuracyMeters > 0 { next.lastAccuracyMeters = accuracyMeters }
        if let configVersion { next.lastConfigVersion = configVersion }
        next.sawExit = false
        return next
    }

    /// A verified exit. The next entry is genuinely new.
    public func recordingExit() -> AttemptPolicy {
        var next = self
        next.sawExit = true
        return next
    }

    /// Counted. The only state that ends an occurrence.
    public func settling() -> AttemptPolicy {
        var next = self
        next.settled = true
        return next
    }
}
