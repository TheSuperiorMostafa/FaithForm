package io.faithform.faithful.attendance

import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

/**
 * One check-in attempt from a code.
 *
 * Notice the absence: no occurrence, no church, no member, no position, no
 * device identifier. **The occurrence comes out of the code, server-side.** A
 * scanner has no idea which service it is looking at and must not be allowed to
 * claim one — otherwise scanning the 9 a.m. code while naming the 11 a.m.
 * service would be a request the server had to think about.
 */
data class CheckInSubmission(
    val qrToken: String?,
    val shortCode: String?,
    /** A fresh random identity for this scan. Recorded, never authority. */
    val scanAttemptId: String,
) {
    companion object {
        fun scanned(token: String, attemptId: String) =
            CheckInSubmission(qrToken = token, shortCode = null, scanAttemptId = attemptId)

        fun typed(code: String, attemptId: String) =
            CheckInSubmission(qrToken = null, shortCode = code, scanAttemptId = attemptId)
    }
}

/** What the server said. Mirrors the contract's `AttendanceResult`. */
data class CheckInServerResult(
    val outcome: String,
    val message: String,
)

/**
 * Submits a scanned or typed code.
 *
 * Separate from the geofence submitter because the two carry different things:
 * a geofence attempt carries a position and a dwell, a scan carries a code and
 * nothing else. Folding them together would mean a scan path that *could* send
 * coordinates, and the cheapest way to guarantee it never does is for the type
 * not to have the field.
 */
interface CheckInCodeSubmitting {
    /** @throws CheckInTransportException when nothing was decided. */
    suspend fun submit(submission: CheckInSubmission, idempotencyKey: String): CheckInServerResult
}

/**
 * The request never reached a verdict.
 *
 * Distinct from a refusal on purpose. A refusal is an answer; this is the
 * absence of one, and the person must be told nothing was recorded rather than
 * shown a tick.
 */
class CheckInTransportException(message: String) : Exception(message)

/**
 * Drives one scan from the button to the server's verdict.
 *
 * ## The permission rule, and where it is enforced
 *
 * The camera is asked for in exactly one place: [beginScanning], reachable only
 * from an explicit "Scan" action. Not at launch, not during onboarding, not
 * while browsing a feed, and not when enabling automatic attendance. Nothing
 * else in these modules holds a [QrScanningFacade], and
 * `tests/security/checkin-privacy.test.ts` sweeps the native sources to keep it
 * that way.
 *
 * ## What happens to a frame
 *
 * Nothing. [QrScanningFacade] cannot return an image — it hands back decoded
 * strings — so there is no buffer to write, no file to leave behind, and no
 * media permission to ask for. The session stops the instant a usable code is
 * read, before the request is even sent.
 */
class CheckInScanCoordinator(
    private val camera: QrScanningFacade,
    private val submitter: CheckInCodeSubmitting,
    private val clock: () -> Long = System::currentTimeMillis,
) {
    private val mutex = Mutex()

    private var phase: ScanPhase = ScanPhase.Idle
    private var debounce = ScanDebounce()
    private var submitting = false

    fun currentPhase(): ScanPhase = phase

    /**
     * Where the camera dialog lives.
     *
     * The order matters. Availability first, because telling someone to grant
     * access on a device with no camera is a dead end. Then the *current*
     * permission, because a permanently denied one produces no dialog and the
     * person needs app settings rather than a button that appears to do
     * nothing. Only then is permission requested.
     */
    suspend fun beginScanning(): ScanPhase {
        if (!camera.isAvailable()) {
            phase = ScanPhase.Blocked(ScanBlock.CAMERA_UNAVAILABLE)
            return phase
        }

        var state = camera.permissionState()
        if (state.promptWouldAppear) {
            phase = ScanPhase.RequestingPermission
            state = camera.requestPermission()
        }

        when (state) {
            CameraPermissionState.GRANTED -> Unit
            CameraPermissionState.DENIED_PERMANENTLY -> {
                phase = ScanPhase.Blocked(ScanBlock.CAMERA_DENIED_PERMANENTLY)
                return phase
            }
            CameraPermissionState.DENIED_CAN_ASK_AGAIN -> {
                // **Distinct from permanent on purpose.** Android will still
                // show the dialog next time, so the recovery is "try again",
                // not a trip to Settings. Collapsing the two is how apps end up
                // sending people to Settings for nothing.
                phase = ScanPhase.Blocked(ScanBlock.CAMERA_DENIED_CAN_ASK)
                return phase
            }
            CameraPermissionState.NOT_REQUESTED -> {
                // Asked and got no answer — the dialog was dismissed rather
                // than answered. Nothing was denied, so nothing is reported.
                phase = ScanPhase.Idle
                return phase
            }
        }

        return try {
            // The adapter owns the hop off CameraX's analyser executor — the
            // callback must return promptly or frames back up — and calls
            // `handleScanned` from a coroutine. Doing that here would put a
            // scope in a class that has no lifecycle of its own.
            camera.start { code -> onCodeFromAnalyser(code) }
            phase = ScanPhase.Scanning
            phase
        } catch (_: Exception) {
            phase = ScanPhase.Blocked(ScanBlock.CAMERA_UNAVAILABLE)
            phase
        }
    }

    suspend fun stopScanning() {
        camera.stop()
        if (phase is ScanPhase.Scanning) phase = ScanPhase.Idle
    }

    /**
     * Set by the adapter so a decoded string can be delivered from a coroutine.
     *
     * The analyser callback itself does nothing but hand the string over: it
     * runs on CameraX's executor, and blocking it backs up frames.
     */
    var onCodeFromAnalyser: (String) -> Unit = {}

    /**
     * A decoded string arrived.
     *
     * Most of them are noise: the same code re-read many times a second, or
     * something that is not a Faithful code at all. Both are ignored silently —
     * a scanner that complained about every poster in frame would be unusable,
     * and each complaint would cost a rate-limit token.
     */
    suspend fun handleScanned(raw: String): ScanPhase {
        if (phase !is ScanPhase.Scanning) return phase

        val payload = ScannedPayloadReader.read(raw)
        if (payload !is ScannedPayload.CheckInToken) return phase

        val now = clock()
        if (!debounce.shouldSubmit(payload.token, now)) return phase
        debounce = debounce.recording(payload.token, now)

        return submit(CheckInSubmission.scanned(payload.token, ScanAttemptIdentity.make()))
    }

    /**
     * Someone typed the code instead.
     *
     * Deliberately available whether or not the camera was ever started: a
     * person who denied camera access, or whose camera is broken, reaches this
     * without being asked for a permission they are not going to grant.
     */
    suspend fun submitTypedCode(input: String): ScanPhase {
        val normalised = ShortCodeEntry.normalise(input)
        if (!ShortCodeEntry.isComplete(normalised)) return phase
        return submit(CheckInSubmission.typed(normalised, ScanAttemptIdentity.make()))
    }

    private suspend fun submit(submission: CheckInSubmission): ScanPhase {
        // **Claimed under the mutex before any suspension.** Two codes arriving
        // in the same frame interval must produce one request; a check that ran
        // after a suspension point would let both through — the same TOCTOU
        // that produced eight concurrent geofence submissions in Prompt 7.
        val claimed = mutex.withLock {
            if (submitting) false else { submitting = true; true }
        }
        if (!claimed) return phase

        try {
            phase = ScanPhase.Submitting
            // The camera is released before the request, not after it. A scan
            // that takes four seconds on a bad connection should not hold the
            // camera open for four seconds.
            camera.stop()

            phase = try {
                ScanPhase.Finished(
                    outcomeFor(
                        submitter.submit(
                            submission,
                            ScanAttemptIdentity.idempotencyKey(submission.scanAttemptId),
                        ),
                    ),
                )
            } catch (_: CheckInTransportException) {
                // **Not a refusal, and emphatically not a success.**
                ScanPhase.Blocked(ScanBlock.OFFLINE)
            } catch (_: Exception) {
                ScanPhase.Blocked(ScanBlock.OFFLINE)
            }
            return phase
        } finally {
            mutex.withLock { submitting = false }
        }
    }

    companion object {
        /**
         * Maps the server's verdict onto what the person is shown.
         *
         * **`counted` and `already_counted` are the only successes**, and both
         * come from the server. There is no branch here that reaches a success
         * from anything the device observed.
         */
        fun outcomeFor(result: CheckInServerResult): ScanOutcome = when (result.outcome) {
            "counted" -> ScanOutcome.Counted(result.message)
            "already_counted" -> ScanOutcome.AlreadyCounted(result.message)
            // Everything else, **including an outcome added after this build
            // shipped**. A client that treats what it does not understand as a
            // check-in will one day show a tick for an outcome the server
            // invented to mean the opposite.
            else -> ScanOutcome.Refused(result.message)
        }
    }
}
