import Foundation

/// Watching a service, with every decision out of AVFoundation's way.
///
/// The framework part of a player is small: give it an asset, tell it to play,
/// listen for state. Everything that could be *wrong* is here instead, in plain
/// Swift with no `AVFoundation` import — when to refresh a capability, what an
/// error means to a person, whether a position is worth remembering, and what
/// happens when a church takes something down mid-sermon.
///
/// The adapter is `AVPlayerAdapter`, and it makes no decisions.

// MARK: - What is being played

public enum MediaPlaybackKind: String, Equatable, Sendable, Codable {
    case live
    case recording

    /// Whether scrubbing makes sense.
    ///
    /// A live stream has a moving edge and a playlist window a few seconds
    /// wide; offering a scrubber over it promises something the format cannot
    /// deliver.
    public var isSeekable: Bool { self == .recording }

    /// Whether a position is worth remembering.
    ///
    /// **Never for live.** "Resume where you left off" at a live edge means
    /// resuming at a moment that no longer exists, and the next segment window
    /// will not contain it.
    public var isResumable: Bool { self == .recording }
}

/// How the bytes arrive.
///
/// Distinct from `MediaPlaybackKind`, which says *what* is being watched. A
/// live service is always HLS; the archive is progressive today because the
/// relay writes one MP4 per service and nothing packages a VOD playlist.
///
/// The player is told rather than left to infer it from the URL, because the
/// recording delivery path has no file extension to infer from.
public enum RenditionKind: String, Equatable, Sendable, Codable {
    case hls
    case progressive
}

/// One thing to play, and permission to play it.
public struct PlaybackRequest: Equatable, Sendable {
    public let url: URL
    /// Sent as `Authorization: Bearer` on **every** request the player makes,
    /// including each segment. Never appended to `url`.
    public let capability: String
    public let kind: MediaPlaybackKind
    public let renditionKind: RenditionKind
    /// Where a trimmed recording actually begins inside the stored file.
    public let startOffsetSeconds: Double
    /// Where this person had got to, relative to `startOffsetSeconds`.
    public let resumeSeconds: Double

    public init(
        url: URL,
        capability: String,
        kind: MediaPlaybackKind,
        renditionKind: RenditionKind = .progressive,
        startOffsetSeconds: Double = 0,
        resumeSeconds: Double = 0
    ) {
        self.url = url
        self.capability = capability
        self.kind = kind
        self.renditionKind = renditionKind
        self.startOffsetSeconds = startOffsetSeconds
        self.resumeSeconds = resumeSeconds
    }
}

// MARK: - The façade

public enum PlayerCommand: Equatable, Sendable {
    case load(PlaybackRequest)
    case play
    case pause
    case seek(seconds: Double)
    case stop
    /// Swaps the capability without interrupting playback. The loader uses the
    /// new one on the next request it makes.
    case updateCapability(String)
}

/// Why playback stopped, in terms a person can act on.
///
/// **Deliberately coarse.** An `AVPlayer` error carries a domain, an OSStatus,
/// a failing URL and sometimes an upstream response body — none of which
/// belongs on a screen or in a log, and all of which would describe the
/// delivery architecture to anyone reading it.
public enum PlayerFailure: String, Equatable, Sendable {
    /// The network went away. Recoverable by itself.
    case network
    /// The server refused. From a phone's point of view this is one thing:
    /// the church took it down, revoked it, or the relationship changed.
    case unavailable
    /// The file or stream could not be decoded on this device.
    case unsupported
    case unknown
}

public enum PlayerEvent: Equatable, Sendable {
    case buffering
    case readyToPlay(durationSeconds: Double?)
    case playing
    case paused
    case ended
    case progress(seconds: Double, durationSeconds: Double?)
    case failed(PlayerFailure)
}

/// The exact slice of AVFoundation this feature needs.
///
/// **Why a façade rather than `AVPlayer` directly.** `AVPlayer` cannot be
/// exercised on a test runner: `swift test` runs on macOS, there is no iOS
/// media stack, and no simulator vends real segments. Without a seam, the
/// *decisions* — refresh timing, error mapping, resume bounds, revocation
/// handling — would be reachable only on a device, which is exactly the code
/// most likely to be subtly wrong.
public protocol MediaPlayerFacade: Actor {
    func send(_ command: PlayerCommand) async
    func setEventHandler(_ handler: @Sendable @escaping (PlayerEvent) -> Void) async
    /// Current position, relative to the start of the trimmed recording.
    func currentPositionSeconds() async -> Double
}

// MARK: - Mapping a transport failure

public enum PlayerFailureMapping {
    /// Turns an HTTP status into something a person can be told.
    ///
    /// 401 and 403 are one answer on purpose. A phone cannot usefully
    /// distinguish "your capability expired" from "the church revoked this",
    /// and telling it apart would describe the capability model to anyone
    /// watching the traffic. The client refreshes once on a 401 — that is the
    /// coordinator's job, not this function's — and reports `unavailable` if
    /// the refresh is also refused.
    public static func from(statusCode: Int) -> PlayerFailure {
        switch statusCode {
        case 401, 403, 404, 410: return .unavailable
        case 408, 429, 502, 503, 504: return .network
        case 415, 416: return .unsupported
        default: return statusCode >= 500 ? .network : .unavailable
        }
    }

    /// What the person reads. Never a URL, a status code, or a domain.
    public static func message(for failure: PlayerFailure) -> String {
        switch failure {
        case .network: return L.mediaErrorNetwork
        case .unavailable: return L.mediaErrorUnavailable
        case .unsupported: return L.mediaErrorUnsupported
        case .unknown: return L.mediaErrorUnknown
        }
    }
}

// MARK: - Capability refresh

/// When to renew, and what to do when renewal is refused.
///
/// A capability lasts five minutes. Refreshing on *failure* would mean the
/// person sees a stall every five minutes; refreshing on a schedule means they
/// never do — unless the church has revoked it, which is the one case where
/// stopping is correct.
public struct CapabilitySchedule: Equatable, Sendable {
    public let expiresAt: Date
    public let refreshLeadSeconds: TimeInterval

    public init(expiresAt: Date, refreshLeadSeconds: TimeInterval) {
        self.expiresAt = expiresAt
        self.refreshLeadSeconds = max(5, refreshLeadSeconds)
    }

    public func refreshAt() -> Date {
        expiresAt.addingTimeInterval(-refreshLeadSeconds)
    }

    public func isDue(at now: Date) -> Bool { now >= refreshAt() }

    /// Already unusable. A player holding this will be refused on its next
    /// request, so there is nothing to preserve by waiting.
    public func isExpired(at now: Date) -> Bool { now >= expiresAt }
}

// MARK: - Resume positions

/// One remembered position.
///
/// Bounded and partitioned rather than a viewing history: the store keeps a
/// small number of recent entries, drops anything older than its window, and
/// lives under a cache partition that includes the account and the
/// authorization version — so a sign-out or a revoked relationship takes the
/// whole set with it.
public struct ResumePosition: Equatable, Sendable, Codable {
    public let mediaId: String
    public let churchSlug: String
    public let seconds: Double
    public let updatedAt: Date

    public init(mediaId: String, churchSlug: String, seconds: Double, updatedAt: Date) {
        self.mediaId = mediaId
        self.churchSlug = churchSlug
        self.seconds = seconds
        self.updatedAt = updatedAt
    }
}

public enum ResumePolicy {
    /// At most this many positions are kept, newest first.
    ///
    /// Small on purpose. "The last few things you were watching" is a
    /// convenience; a hundred of them is a record of what someone watched all
    /// year, which is a different thing entirely and one this app has no
    /// business keeping.
    public static let maxEntries = 20

    /// How long a position survives. A month is generously longer than anyone
    /// takes to finish a sermon and short enough that the store empties itself.
    public static let maxAge: TimeInterval = 30 * 24 * 60 * 60

    /// Below this, there is nothing to resume — a person who watched ten
    /// seconds meant to start at the beginning.
    public static let minimumSeconds: Double = 30

    /// How close to the end counts as finished. Resuming someone at 99% means
    /// showing them the credits.
    public static let completionTailSeconds: Double = 30

    /// Whether a position is worth storing at all.
    public static func shouldStore(
        kind: MediaPlaybackKind,
        seconds: Double,
        durationSeconds: Double?
    ) -> Bool {
        // **Never for live.** A live edge is not a durable position.
        guard kind.isResumable else { return false }
        guard seconds >= minimumSeconds else { return false }
        if let durationSeconds, durationSeconds > 0 {
            return seconds <= durationSeconds - completionTailSeconds
        }
        return true
    }

    /// Trims a set to the bound, newest first, dropping anything stale.
    public static func prune(_ entries: [ResumePosition], now: Date) -> [ResumePosition] {
        entries
            .filter { now.timeIntervalSince($0.updatedAt) <= maxAge }
            .sorted { $0.updatedAt > $1.updatedAt }
            .prefix(maxEntries)
            .map { $0 }
    }
}

/// Where remembered positions live.
///
/// **Device-local, and deliberately not synced.** A server-held position would
/// be a per-person, per-recording, cross-device record of what someone watched
/// and how far they got — person-level viewing analytics under another name.
/// The requirement is "resume on the same device", and this is what that means.
public protocol ResumePositionStoring: Actor {
    func position(for mediaId: String, partition: CachePartition, now: Date) async -> ResumePosition?
    func record(_ position: ResumePosition, partition: CachePartition, now: Date) async
    func clear(partition: CachePartition) async
    /// Every partition. Called on sign-out and on any authorization change.
    func clearAll() async
}
