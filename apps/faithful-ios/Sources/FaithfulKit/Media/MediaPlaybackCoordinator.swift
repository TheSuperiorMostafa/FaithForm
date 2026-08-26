import Foundation

/// Acquires and refreshes a playback capability.
///
/// Abstracted so the whole refresh lifecycle — the schedule, the single-flight,
/// the revocation — is testable without a network or a player.
public protocol PlaybackGranting: Actor {
    func grant(
        churchSlug: String,
        kind: MediaPlaybackKind,
        mediaId: String
    ) async throws -> GrantedPlayback
}

public struct GrantedPlayback: Equatable, Sendable {
    public let capability: String
    public let deliveryURL: URL
    public let renditionKind: RenditionKind
    public let expiresAt: Date
    public let refreshLeadSeconds: TimeInterval
    public let startOffsetSeconds: Double

    public init(
        capability: String,
        deliveryURL: URL,
        renditionKind: RenditionKind,
        expiresAt: Date,
        refreshLeadSeconds: TimeInterval,
        startOffsetSeconds: Double
    ) {
        self.capability = capability
        self.deliveryURL = deliveryURL
        self.renditionKind = renditionKind
        self.expiresAt = expiresAt
        self.refreshLeadSeconds = refreshLeadSeconds
        self.startOffsetSeconds = startOffsetSeconds
    }
}

public enum PlaybackSessionState: Equatable, Sendable {
    case idle
    case preparing
    case buffering
    case playing
    case paused
    case ended
    case failed(PlayerFailure)
}

/// Drives one viewing session, from tapping play to the church taking it down.
///
/// ## Single-flight refresh
///
/// A capability expires every five minutes. Two things can notice at once — the
/// scheduled refresh and a 401 from a segment — and both will ask for a new one.
/// The in-flight flag is claimed **before any suspension point**, so they
/// produce one request and share its answer. A check that ran after an `await`
/// would let both through, which is the same TOCTOU that produced eight
/// concurrent geofence submissions in Prompt 7 and two simultaneous scans in
/// Prompt 8.
///
/// ## Revocation
///
/// A refused refresh is terminal. The coordinator does not retry it, does not
/// fall back to the old capability, and does not keep playing on the segments
/// already buffered — it stops and says the item is no longer available. That is
/// what "revoke stops playback that is already running" has to mean.
public actor MediaPlaybackCoordinator {
    private let granter: PlaybackGranting
    private let player: MediaPlayerFacade
    private let resumeStore: ResumePositionStoring
    private let now: @Sendable () -> Date

    private var state: PlaybackSessionState = .idle
    private var schedule: CapabilitySchedule?
    private var current: (churchSlug: String, kind: MediaPlaybackKind, mediaId: String)?
    private var partition: CachePartition?
    private var refreshing = false
    private var lastKnownDuration: Double?

    public init(
        granter: PlaybackGranting,
        player: MediaPlayerFacade,
        resumeStore: ResumePositionStoring,
        now: @escaping @Sendable () -> Date = { Date() }
    ) {
        self.granter = granter
        self.player = player
        self.resumeStore = resumeStore
        self.now = now
    }

    public func currentState() -> PlaybackSessionState { state }
    public func currentSchedule() -> CapabilitySchedule? { schedule }

    /// Starts a viewing session.
    ///
    /// The resume position is read **before** the grant, so a refused grant
    /// costs nothing and leaves no partial state. Live never resumes.
    public func start(
        churchSlug: String,
        kind: MediaPlaybackKind,
        mediaId: String,
        partition: CachePartition
    ) async {
        state = .preparing
        self.partition = partition
        current = (churchSlug, kind, mediaId)

        let resume: Double
        if kind.isResumable,
           let stored = await resumeStore.position(for: mediaId, partition: partition, now: now()) {
            resume = stored.seconds
        } else {
            resume = 0
        }

        do {
            let granted = try await granter.grant(
                churchSlug: churchSlug,
                kind: kind,
                mediaId: mediaId
            )
            schedule = CapabilitySchedule(
                expiresAt: granted.expiresAt,
                refreshLeadSeconds: granted.refreshLeadSeconds
            )
            await player.send(.load(PlaybackRequest(
                url: granted.deliveryURL,
                capability: granted.capability,
                kind: kind,
                renditionKind: granted.renditionKind,
                startOffsetSeconds: granted.startOffsetSeconds,
                resumeSeconds: resume
            )))
            state = .buffering
        } catch {
            // Never published, unpublished, revoked, blocked, or the encoder
            // has gone. One answer, because a phone cannot usefully tell them
            // apart and telling them apart would describe the model.
            state = .failed(.unavailable)
        }
    }

    /// Refreshes if the schedule says it is time, or if something demanded it.
    ///
    /// Returns whether playback may continue.
    @discardableResult
    public func refreshIfNeeded(force: Bool = false) async -> Bool {
        guard let current else { return false }
        guard let schedule else { return false }
        guard force || schedule.isDue(at: now()) else { return true }

        // **Claimed before any `await`.** Two callers noticing at once produce
        // one request.
        guard !refreshing else { return true }
        refreshing = true
        defer { refreshing = false }

        do {
            let granted = try await granter.grant(
                churchSlug: current.churchSlug,
                kind: current.kind,
                mediaId: current.mediaId
            )
            self.schedule = CapabilitySchedule(
                expiresAt: granted.expiresAt,
                refreshLeadSeconds: granted.refreshLeadSeconds
            )
            // Swapped without interrupting playback: the loader uses the new
            // one on its next request.
            await player.send(.updateCapability(granted.capability))
            return true
        } catch {
            // Terminal. Not retried, and the old capability is not reused — a
            // church that revoked something meant it.
            await savePosition()
            await player.send(.stop)
            state = .failed(.unavailable)
            return false
        }
    }

    public func handle(_ event: PlayerEvent) async {
        switch event {
        case .buffering:
            state = .buffering
        case .readyToPlay(let duration):
            lastKnownDuration = duration
            state = .paused
        case .playing:
            state = .playing
        case .paused:
            state = .paused
            await savePosition()
        case .ended:
            state = .ended
            // A finished recording is not resumed next time; the policy's
            // completion tail refuses to store a position this close to the end.
            await savePosition()
        case .progress(_, let duration):
            if let duration { lastKnownDuration = duration }
            // A refresh that lands on a progress tick keeps a long sermon
            // playing without the person ever seeing a stall.
            await refreshIfNeeded()
        case .failed(let failure):
            if failure == .unavailable {
                // One retry through a fresh capability: an expired one looks
                // exactly like a revoked one from the transport's point of view,
                // and only the server can tell them apart.
                if await refreshIfNeeded(force: true) {
                    await player.send(.play)
                    return
                }
            }
            await savePosition()
            state = .failed(failure)
        }
    }

    public func play() async {
        await player.send(.play)
    }

    public func pause() async {
        await player.send(.pause)
        await savePosition()
    }

    public func seek(to seconds: Double) async {
        guard current?.kind.isSeekable == true else { return }
        await player.send(.seek(seconds: max(0, seconds)))
    }

    /// The app went to the background.
    ///
    /// The position is saved immediately rather than on the next tick, because
    /// there may not be a next tick — iOS can suspend the process without
    /// warning.
    public func enterBackground() async {
        await savePosition()
    }

    /// The app came back.
    ///
    /// A capability that expired while suspended is refreshed before anything
    /// is asked of the player, so the first thing the person sees is not a
    /// failure.
    public func enterForeground() async {
        guard let schedule else { return }
        if schedule.isExpired(at: now()) || schedule.isDue(at: now()) {
            await refreshIfNeeded(force: true)
        }
    }

    public func stop() async {
        await savePosition()
        await player.send(.stop)
        state = .idle
        current = nil
        schedule = nil
    }

    private func savePosition() async {
        guard let current, let partition else { return }
        let seconds = await player.currentPositionSeconds()
        guard ResumePolicy.shouldStore(
            kind: current.kind,
            seconds: seconds,
            durationSeconds: lastKnownDuration
        ) else { return }

        await resumeStore.record(
            ResumePosition(
                mediaId: current.mediaId,
                churchSlug: current.churchSlug,
                seconds: seconds,
                updatedAt: now()
            ),
            partition: partition,
            now: now()
        )
    }
}
