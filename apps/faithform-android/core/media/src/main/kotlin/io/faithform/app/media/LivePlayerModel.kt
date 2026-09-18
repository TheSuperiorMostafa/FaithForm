package io.faithform.app.media

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

/** Whether the service someone is watching is still on, as the church says. */
enum class LiveAvailability {
    /** Still live, and still this service. */
    LIVE,
    /** Ended, taken down, or replaced by another service. */
    ENDED,
    /** Could not tell — offline, or the server did not answer. */
    UNKNOWN,
}

/**
 * The full-screen live player: one service, playing now, and staying that way.
 *
 * Mirrors `LivePlayerModel.swift`.
 *
 * ## What it adds to [MediaDetailModel]
 *
 * A recording that fails can say so and wait for the person to press Play. A
 * live service fails in ways that fix themselves — the encoder is still
 * connecting when someone taps Watch, a church's uplink drops for ten seconds,
 * the phone moves from Wi-Fi to cellular — and nobody sitting in a service
 * should have to keep tapping Retry through that. So this model:
 *
 *  * **starts playing as soon as the screen opens.** Tapping "Watch live" was
 *    the request to watch; a second button would only ask it again;
 *  * **reconnects** after a transient failure, with backoff, for as long as the
 *    church still lists the service as live;
 *  * **asks** whether a failure means the service is over, rather than guessing
 *    from a status code;
 *  * **notices when a service ends** while it plays. The relay's playlist simply
 *    stops growing, so without asking, the picture would freeze into
 *    "buffering" for good.
 *
 * Every call is expected on one thread (the main one, where the view model
 * scope runs), like the rest of the Watch models.
 */
class LivePlayerModel(
    private val detail: MediaDetailModel,
    private val availability: suspend () -> LiveAvailability,
    private val scope: CoroutineScope,
    private val sleep: suspend (Long) -> Unit = { delay(it) },
) {
    enum class Phase {
        /** Asking for permission and loading the first segments. */
        CONNECTING,
        PLAYING,
        PAUSED,
        /** A transient failure; trying again without being asked. */
        RECONNECTING,
        /** The church ended the service or took it down. */
        ENDED,
        /** Refused while the church still lists it: this account may not watch. */
        UNAVAILABLE,
        /** Stopped reconnecting. The person can try again. */
        FAILED,
    }

    private val _phase = MutableStateFlow(Phase.CONNECTING)
    val phase: StateFlow<Phase> = _phase.asStateFlow()

    /**
     * Whether it has stopped trying: the service ended, was refused, or
     * reconnecting gave up. Only the person can start it again.
     */
    val isTerminal: Boolean
        get() = _phase.value == Phase.ENDED || _phase.value == Phase.UNAVAILABLE || _phase.value == Phase.FAILED

    private var attempts = 0
    private var refusals = 0
    private var stallRestarts = 0
    private var stopped = false
    private var resumesOnForeground = false
    private var recovery: Job? = null
    private var monitor: Job? = null
    private var watchdog: Job? = null

    /** Plays from the live edge. Called once, when the screen appears. */
    suspend fun start() {
        stopped = false
        attempts = 0
        refusals = 0
        stallRestarts = 0
        _phase.value = Phase.CONNECTING
        startMonitoring()
        playFromLiveEdge()
    }

    /** After giving up, or after a refusal: the person asked to try again. */
    suspend fun retry() = start()

    /** Every player event arrives here, so the phase follows the player. */
    suspend fun handle(event: PlayerEvent) {
        detail.handle(event)
        sync()
    }

    suspend fun pause() {
        if (_phase.value != Phase.PLAYING) return
        detail.pause()
        sync()
    }

    /**
     * Resumes **at the live edge**, not where it paused. The relay keeps a few
     * seconds of stream; a service paused for longer has no "where it paused"
     * left, and one paused briefly is better caught up than left behind.
     */
    suspend fun resume() {
        if (_phase.value != Phase.PAUSED) return
        _phase.value = Phase.CONNECTING
        playFromLiveEdge()
    }

    /**
     * The app left the foreground. Paused deliberately, and remembered: there
     * is no background playback service, so it cannot keep going behind.
     */
    suspend fun enterBackground() {
        if (stopped || isTerminal) return
        resumesOnForeground = _phase.value != Phase.PAUSED
        if (_phase.value == Phase.PLAYING) {
            detail.pause()
            sync()
        }
    }

    /** Back in front: rejoin the service where it now is. */
    suspend fun enterForeground() {
        if (!resumesOnForeground || stopped || isTerminal) return
        resumesOnForeground = false
        _phase.value = Phase.CONNECTING
        playFromLiveEdge()
    }

    /** The screen went away. Nothing is retried or polled after this. */
    suspend fun stop() {
        stopped = true
        recovery?.cancel()
        recovery = null
        monitor?.cancel()
        monitor = null
        disarmWatchdog()
        detail.stop()
    }

    // -----------------------------------------------------------------------
    // Following the player
    // -----------------------------------------------------------------------

    private suspend fun playFromLiveEdge() {
        if (stopped) return
        restartAtLiveEdge()
        sync()
    }

    /**
     * A fresh grant and a new item at the live edge.
     *
     * The grant is a network round trip, and the service can end or the screen
     * close while it is in flight. Whatever it started is then stopped again,
     * so nothing plays behind an "ended" message or a closed screen.
     */
    private suspend fun restartAtLiveEdge() {
        detail.restart()
        if (stopped || isTerminal) detail.stop()
    }

    private fun sync() {
        if (stopped || isTerminal) return
        when (detail.state.value.playback) {
            PlaybackSessionState.Idle -> Unit
            PlaybackSessionState.Preparing, PlaybackSessionState.Buffering -> {
                _phase.value = if (attempts > 0 || stallRestarts > 0) Phase.RECONNECTING else Phase.CONNECTING
                armWatchdog()
            }
            PlaybackSessionState.Playing -> {
                _phase.value = Phase.PLAYING
                // Healthy again: the next failure starts a fresh budget.
                attempts = 0
                refusals = 0
                stallRestarts = 0
                disarmWatchdog()
            }
            PlaybackSessionState.Paused -> {
                _phase.value = Phase.PAUSED
                disarmWatchdog()
            }
            // A live playlist never ends on its own — the server strips ENDLIST —
            // so an ending here is the service really ending.
            PlaybackSessionState.Ended -> {
                _phase.value = Phase.ENDED
                disarmWatchdog()
            }
            is PlaybackSessionState.Failed -> recoverIfNeeded()
        }
    }

    // -----------------------------------------------------------------------
    // Noticing a stall
    // -----------------------------------------------------------------------

    /**
     * Starts the clock on "Connecting", unless it is already running — a
     * buffering spell that keeps bouncing between states is still one spell.
     */
    private fun armWatchdog() {
        if (watchdog != null || stopped) return
        watchdog = scope.launch {
            sleep(STALL_TIMEOUT_MILLIS)
            stalled()
        }
    }

    private fun disarmWatchdog() {
        watchdog?.cancel()
        watchdog = null
    }

    /**
     * Stuck without an error: rejoin the live edge from a fresh grant, a few
     * times, then say so and offer Try again.
     *
     * The job forgets itself first, so a restart that buffers again can arm a
     * new clock — and so disarming from inside the restart cannot cancel it
     * half way through.
     */
    private suspend fun stalled() {
        watchdog = null
        val phase = _phase.value
        if (stopped || isTerminal || recovery?.isActive == true) return
        if (phase != Phase.CONNECTING && phase != Phase.RECONNECTING) return

        if (availability() == LiveAvailability.ENDED) return finish(Phase.ENDED)
        if (stopped) return
        if (stallRestarts >= MAX_STALL_RESTARTS) return finish(Phase.FAILED)
        stallRestarts++
        _phase.value = Phase.RECONNECTING
        restartAtLiveEdge()
        sync()
    }

    private fun recoverIfNeeded() {
        // The recovery loop restarts playback itself; a stall clock running
        // alongside it would restart it twice.
        disarmWatchdog()
        if (recovery?.isActive == true || stopped) return
        recovery = scope.launch { recover() }
    }

    /**
     * Tries again for as long as that can help, then says why it stopped.
     *
     * A loop rather than a chain of jobs: a restart can fail before it returns
     * (a refused grant), and that failure is the next iteration.
     */
    private suspend fun recover() {
        while (!stopped) {
            val failure = (detail.state.value.playback as? PlaybackSessionState.Failed)?.failure ?: return
            if (failure == PlayerFailure.UNAVAILABLE) refusals++

            if (availability() == LiveAvailability.ENDED) {
                finish(Phase.ENDED)
                return
            }
            if (stopped) return

            when {
                // This stream cannot be decoded here; waiting will not change that.
                failure == PlayerFailure.UNSUPPORTED -> return finish(Phase.FAILED)
                // Refused twice while the church still lists it as live: this
                // account may not watch it, and asking again will not change it.
                refusals > 1 -> return finish(Phase.UNAVAILABLE)
                attempts >= MAX_ATTEMPTS -> return finish(Phase.FAILED)
            }

            attempts++
            _phase.value = Phase.RECONNECTING
            sleep(RETRY_DELAYS_MILLIS[minOf(attempts, RETRY_DELAYS_MILLIS.size) - 1])
            if (stopped) return

            restartAtLiveEdge()
            if (detail.state.value.playback is PlaybackSessionState.Failed) continue
            sync()
            return
        }
    }

    /**
     * Stops trying and says why. The phase is set first, so nothing the player
     * reports while it is being stopped can overwrite it — and the monitor is
     * cancelled last, because this may be running *inside* the monitor.
     */
    private suspend fun finish(terminal: Phase) {
        _phase.value = terminal
        // Never this coroutine: stalled() lets go of the watchdog before it
        // can call here.
        disarmWatchdog()
        detail.stop()
        monitor?.cancel()
        monitor = null
    }

    // -----------------------------------------------------------------------
    // Noticing the end
    // -----------------------------------------------------------------------

    private fun startMonitoring() {
        monitor?.cancel()
        monitor = scope.launch {
            while (isActive) {
                sleep(MONITOR_INTERVAL_MILLIS)
                if (stopped || isTerminal) return@launch
                if (availability() == LiveAvailability.ENDED) {
                    if (!stopped) finish(Phase.ENDED)
                    return@launch
                }
            }
        }
    }

    companion object {
        /** Between reconnection attempts; the last repeats. */
        val RETRY_DELAYS_MILLIS = listOf(1_000L, 2_000L, 4_000L, 8_000L)

        /** Consecutive failed attempts before giving up — a couple of minutes. */
        const val MAX_ATTEMPTS = 18

        /** How often the church is asked whether the service is still on. */
        const val MONITOR_INTERVAL_MILLIS = 30_000L

        /**
         * How long "Connecting" may last before it is treated as a stall. A
         * player can stall without reporting an error — retrying segments it
         * cannot get while one frame sits on screen — so a stall is noticed by
         * time, not by an error.
         */
        const val STALL_TIMEOUT_MILLIS = 20_000L

        /** Consecutive stalls rejoined at the live edge before giving up. */
        const val MAX_STALL_RESTARTS = 3
    }
}
