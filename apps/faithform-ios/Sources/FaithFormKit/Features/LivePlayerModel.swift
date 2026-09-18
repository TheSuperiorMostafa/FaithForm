import Foundation
import Observation

/// Whether the service someone is watching is still on, as the church says.
public enum LiveAvailability: Equatable, Sendable {
    /// Still live, and still this service.
    case live
    /// Ended, taken down, or replaced by another service.
    case ended
    /// Could not tell — offline, or the server did not answer.
    case unknown
}

/// The full-screen live player: one service, playing now, and staying that way.
///
/// ## What it adds to `MediaDetailModel`
///
/// A recording that fails can say so and wait for the person to press Play. A
/// live service fails in ways that fix themselves — the encoder is still
/// connecting when someone taps Watch, a church's uplink drops for ten seconds,
/// the phone moves from Wi-Fi to cellular — and nobody sitting in a service
/// should have to keep tapping Retry through that. So this model:
///
///  * **starts playing as soon as the screen opens.** Tapping "Watch live" was
///    the request to watch; a second button would only ask it again;
///  * **reconnects** after a transient failure, with backoff, for as long as
///    the church still lists the service as live;
///  * **asks** whether a failure means the service is over, rather than
///    guessing from a status code;
///  * **notices when a service ends** while it plays. The relay's playlist
///    simply stops growing, so without asking, the picture would freeze into
///    "buffering" for good.
@MainActor
@Observable
public final class LivePlayerModel {
    public enum Phase: Equatable, Sendable {
        /// Asking for permission and loading the first segments.
        case connecting
        case playing
        case paused
        /// A transient failure; trying again without being asked.
        case reconnecting
        /// The church ended the service or took it down.
        case ended
        /// Refused while the church still lists it: this account may not watch.
        case unavailable
        /// Stopped reconnecting. The person can try again.
        case failed
    }

    public private(set) var phase: Phase = .connecting

    /// Between reconnection attempts; the last repeats.
    public nonisolated static let retryDelays: [Duration] = [.seconds(1), .seconds(2), .seconds(4), .seconds(8)]
    /// Consecutive failed attempts before giving up — a couple of minutes.
    public nonisolated static let maxAttempts = 18
    /// How often the church is asked whether the service is still on.
    public nonisolated static let monitorInterval: Duration = .seconds(30)
    /// How long "Connecting" may last before it is treated as a stall.
    ///
    /// A player can stall without ever reporting an error: AVPlayer retries
    /// segments it cannot get indefinitely, holding one frame on screen. That
    /// is exactly how a relay serving expired segments looked — a spinner that
    /// never ended — so a stall is noticed by time, not by an error.
    public nonisolated static let stallTimeout: Duration = .seconds(20)
    /// Consecutive stalls rejoined at the live edge before giving up.
    public nonisolated static let maxStallRestarts = 3

    private let detail: MediaDetailModel
    private let availability: @MainActor () async -> LiveAvailability
    private let sleep: @Sendable (Duration) async throws -> Void

    private var attempts = 0
    private var refusals = 0
    private var stallRestarts = 0
    private var isStopped = false
    private var resumesOnForeground = false
    private var recovery: Task<Void, Never>?
    private var monitor: Task<Void, Never>?
    private var watchdog: Task<Void, Never>?

    public init(
        detail: MediaDetailModel,
        availability: @escaping @MainActor () async -> LiveAvailability,
        sleep: @escaping @Sendable (Duration) async throws -> Void = { try await Task.sleep(for: $0) }
    ) {
        self.detail = detail
        self.availability = availability
        self.sleep = sleep
    }

    /// Plays from the live edge. Called once, when the screen appears.
    public func start() async {
        isStopped = false
        attempts = 0
        refusals = 0
        stallRestarts = 0
        phase = .connecting
        startMonitoring()
        await playFromLiveEdge()
    }

    /// After giving up, or after a refusal: the person asked to try again.
    public func retry() async {
        await start()
    }

    /// Every player event arrives here, so the phase follows the player.
    public func handle(_ event: PlayerEvent) async {
        await detail.handle(event)
        sync()
    }

    public func pause() async {
        guard phase == .playing else { return }
        await detail.pause()
        sync()
    }

    /// Resumes **at the live edge**, not where it paused.
    ///
    /// The relay keeps a few seconds of stream; a service paused for longer
    /// has no "where it paused" left, and one paused briefly is better caught
    /// up than left behind the room.
    public func resume() async {
        guard phase == .paused else { return }
        phase = .connecting
        await playFromLiveEdge()
    }

    /// The app left the foreground.
    ///
    /// iOS suspends an app without background audio, so a live service cannot
    /// keep playing behind it. It is paused deliberately, and remembered.
    public func enterBackground() async {
        guard !isStopped, !isTerminal else { return }
        resumesOnForeground = phase != .paused
        if phase == .playing {
            await detail.pause()
            sync()
        }
    }

    /// Back in the foreground: rejoin the service where it now is, not where
    /// it was when the phone was locked.
    public func enterForeground() async {
        guard resumesOnForeground, !isStopped, !isTerminal else { return }
        resumesOnForeground = false
        phase = .connecting
        await playFromLiveEdge()
    }

    /// The screen went away. Nothing is retried or polled after this.
    public func stop() async {
        isStopped = true
        recovery?.cancel()
        recovery = nil
        monitor?.cancel()
        monitor = nil
        disarmWatchdog()
        await detail.stop()
    }

    /// Whether it has stopped trying: the service ended, was refused, or
    /// reconnecting gave up. Only the person can start it again.
    public var isTerminal: Bool {
        switch phase {
        case .ended, .unavailable, .failed: return true
        default: return false
        }
    }

    // MARK: - Following the player

    private func playFromLiveEdge() async {
        guard !isStopped else { return }
        await restartAtLiveEdge()
        sync()
    }

    /// A fresh grant and a new item at the live edge.
    ///
    /// The grant is a network round trip, and the service can end or the screen
    /// close while it is in flight. Whatever it started is then stopped again,
    /// so nothing plays behind an "ended" message or a closed screen.
    private func restartAtLiveEdge() async {
        await detail.play(kind: .live)
        if isStopped || isTerminal { await detail.stop() }
    }

    private func sync() {
        guard !isStopped, !isTerminal else { return }
        switch detail.playback {
        case .idle:
            break
        case .preparing, .buffering:
            phase = attempts > 0 || stallRestarts > 0 ? .reconnecting : .connecting
            armWatchdog()
        case .playing:
            phase = .playing
            // Healthy again: the next failure starts a fresh budget.
            attempts = 0
            refusals = 0
            stallRestarts = 0
            disarmWatchdog()
        case .paused:
            phase = .paused
            disarmWatchdog()
        case .ended:
            // A live playlist never ends on its own — the server strips
            // ENDLIST — so an ending here is the service really ending.
            phase = .ended
            disarmWatchdog()
        case .failed:
            recoverIfNeeded()
        }
    }

    // MARK: - Noticing a stall

    /// Starts the clock on "Connecting", unless it is already running — a
    /// buffering spell that keeps bouncing between states is still one spell.
    private func armWatchdog() {
        guard watchdog == nil, !isStopped else { return }
        let sleep = self.sleep
        watchdog = Task { [weak self] in
            do { try await sleep(Self.stallTimeout) } catch { return }
            await self?.stalled()
        }
    }

    private func disarmWatchdog() {
        watchdog?.cancel()
        watchdog = nil
    }

    /// Stuck without an error: rejoin the live edge from a fresh grant, a few
    /// times, then say so and offer Try again.
    private func stalled() async {
        watchdog = nil
        guard !isStopped, !isTerminal, recovery == nil,
              phase == .connecting || phase == .reconnecting
        else { return }

        if await availability() == .ended {
            await finish(.ended)
            return
        }
        guard !isStopped else { return }
        guard stallRestarts < Self.maxStallRestarts else {
            await finish(.failed)
            return
        }
        stallRestarts += 1
        phase = .reconnecting
        await restartAtLiveEdge()
        sync()
    }

    private func recoverIfNeeded() {
        // The recovery loop restarts playback itself; a stall timer running
        // alongside it would restart it twice.
        disarmWatchdog()
        guard recovery == nil, !isStopped else { return }
        recovery = Task { [weak self] in
            await self?.recover()
            self?.recovery = nil
        }
    }

    /// Tries again for as long as that can help, then says why it stopped.
    ///
    /// A loop rather than a chain of tasks: a restart can fail before it
    /// returns (a refused grant), and that failure is the next iteration.
    private func recover() async {
        while !isStopped, case let .failed(failure) = detail.playback {
            if failure == .unavailable { refusals += 1 }

            switch await availability() {
            case .ended:
                await finish(.ended)
                return
            case .live, .unknown:
                break
            }
            guard !isStopped else { return }

            if failure == .unsupported {
                // This stream cannot be decoded here; waiting will not change that.
                await finish(.failed)
                return
            }
            if refusals > 1 {
                // Refused twice while the church still lists it as live: this
                // account may not watch it, and asking again will not change it.
                await finish(.unavailable)
                return
            }
            guard attempts < Self.maxAttempts else {
                await finish(.failed)
                return
            }

            attempts += 1
            phase = .reconnecting
            let delay = Self.retryDelays[min(attempts, Self.retryDelays.count) - 1]
            do { try await sleep(delay) } catch { return }
            guard !isStopped else { return }

            await restartAtLiveEdge()
            if case .failed = detail.playback { continue }
            sync()
        }
    }

    private func finish(_ terminal: Phase) async {
        phase = terminal
        monitor?.cancel()
        monitor = nil
        disarmWatchdog()
        await detail.stop()
    }

    // MARK: - Noticing the end

    private func startMonitoring() {
        monitor?.cancel()
        let sleep = self.sleep
        monitor = Task { [weak self] in
            while !Task.isCancelled {
                do { try await sleep(Self.monitorInterval) } catch { return }
                guard let self, !self.isStopped, !self.isTerminal else { return }
                if await self.availability() == .ended {
                    guard !self.isStopped else { return }
                    await self.finish(.ended)
                    return
                }
            }
        }
    }
}
