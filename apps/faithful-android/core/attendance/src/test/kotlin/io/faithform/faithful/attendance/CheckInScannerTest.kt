package io.faithform.faithful.attendance

import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * A camera stand-in that records every dialog it was asked to raise.
 *
 * The point of the abstraction: "Faithful never asks for the camera until you
 * tap Scan" becomes an assertion on a list rather than something a reviewer has
 * to take on trust.
 */
class FakeCamera(
    private var state: CameraPermissionState = CameraPermissionState.NOT_REQUESTED,
    private val available: Boolean = true,
    private val startThrows: Exception? = null,
) : QrScanningFacade {

    /** Every permission request, in order. **The heart of the prompt rule.** */
    val prompts = mutableListOf<String>()
    var startCount = 0
        private set
    var stopCount = 0
        private set

    /** What the dialog will answer, when it is finally raised. */
    var grantOnRequest: CameraPermissionState = CameraPermissionState.GRANTED

    private var handler: ((String) -> Unit)? = null

    override fun permissionState(): CameraPermissionState = state

    override suspend fun requestPermission(): CameraPermissionState {
        prompts += "camera"
        state = grantOnRequest
        return state
    }

    override suspend fun start(onCode: (String) -> Unit) {
        startThrows?.let { throw it }
        startCount++
        handler = onCode
    }

    override suspend fun stop() {
        stopCount++
        handler = null
    }

    override fun isAvailable(): Boolean = available

    val isRunning: Boolean get() = handler != null

    /** Simulates the image analyser firing. */
    fun emit(code: String) { handler?.invoke(code) }
}

class FakeSubmitter(
    var result: CheckInServerResult = CheckInServerResult("counted", "You're checked in."),
    var error: Exception? = null,
) : CheckInCodeSubmitting {
    val submissions = mutableListOf<CheckInSubmission>()
    val keys = mutableListOf<String>()

    override suspend fun submit(
        submission: CheckInSubmission,
        idempotencyKey: String,
    ): CheckInServerResult {
        submissions += submission
        keys += idempotencyKey
        error?.let { throw it }
        return result
    }
}

private const val TOKEN = "FF1.abc12345.eyJ0IjoiY2hlY2tpbi5xciJ9.c2lnbmF0dXJl"
private const val OTHER_TOKEN = "FF1.abc12345.b3RoZXItcGF5bG9hZA.c2ln"

private fun coordinator(
    camera: FakeCamera,
    submitter: FakeSubmitter,
    now: () -> Long = { 1_800_000_000_000L },
) = CheckInScanCoordinator(camera, submitter, now)

// ---------------------------------------------------------------------------
// The permission rule
// ---------------------------------------------------------------------------

class CameraPermissionTest {

    @Test
    fun `constructing the coordinator prompts for nothing`() {
        val camera = FakeCamera()
        coordinator(camera, FakeSubmitter())

        // Not a formality. This is the whole "never at launch, never during
        // onboarding, never while browsing a feed" requirement: nothing but an
        // explicit action can reach `requestPermission`.
        assertTrue(camera.prompts.isEmpty())
        assertEquals(0, camera.startCount)
    }

    @Test
    fun `the typed fallback never touches the camera`() = runBlocking {
        val camera = FakeCamera()
        val submitter = FakeSubmitter()

        coordinator(camera, submitter).submitTypedCode("BCD4G7J")

        // Someone who will never grant camera access must be able to check in
        // without ever being asked. If typing raised a dialog, "enter the code
        // instead" would be a lie.
        assertTrue(camera.prompts.isEmpty())
        assertEquals(1, submitter.submissions.size)
        assertEquals("BCD4G7J", submitter.submissions[0].shortCode)
    }

    @Test
    fun `Scan raises exactly one dialog and then starts`() = runBlocking {
        val camera = FakeCamera(CameraPermissionState.NOT_REQUESTED)
        val phase = coordinator(camera, FakeSubmitter()).beginScanning()

        assertEquals(listOf("camera"), camera.prompts)
        assertEquals(1, camera.startCount)
        assertEquals(ScanPhase.Scanning, phase)
    }

    @Test
    fun `an already-granted camera is not asked again`() = runBlocking {
        val camera = FakeCamera(CameraPermissionState.GRANTED)
        coordinator(camera, FakeSubmitter()).beginScanning()

        assertTrue(camera.prompts.isEmpty())
        assertEquals(1, camera.startCount)
    }

    @Test
    fun `a soft denial asks again, because Android would still show the dialog`() = runBlocking {
        val camera = FakeCamera(CameraPermissionState.DENIED_CAN_ASK_AGAIN)
        camera.grantOnRequest = CameraPermissionState.GRANTED

        val phase = coordinator(camera, FakeSubmitter()).beginScanning()

        // **The state iOS does not have.** Treating this as permanent would
        // send someone to Settings when one more tap would have worked.
        assertEquals(listOf("camera"), camera.prompts)
        assertEquals(ScanPhase.Scanning, phase)
    }

    @Test
    fun `a hard denial goes to settings without a pointless dialog`() = runBlocking {
        val camera = FakeCamera(CameraPermissionState.DENIED_PERMANENTLY)
        val phase = coordinator(camera, FakeSubmitter()).beginScanning()

        assertTrue(camera.prompts.isEmpty())
        assertEquals(ScanPhase.Blocked(ScanBlock.CAMERA_DENIED_PERMANENTLY), phase)
        assertEquals(0, camera.startCount)
    }

    @Test
    fun `a soft denial that stays denied is reported as re-askable`() = runBlocking {
        val camera = FakeCamera(CameraPermissionState.NOT_REQUESTED)
        camera.grantOnRequest = CameraPermissionState.DENIED_CAN_ASK_AGAIN

        val phase = coordinator(camera, FakeSubmitter()).beginScanning()

        assertEquals(ScanPhase.Blocked(ScanBlock.CAMERA_DENIED_CAN_ASK), phase)
    }

    @Test
    fun `availability is checked before permission`() = runBlocking {
        val camera = FakeCamera(CameraPermissionState.NOT_REQUESTED, available = false)
        val phase = coordinator(camera, FakeSubmitter()).beginScanning()

        assertEquals(ScanPhase.Blocked(ScanBlock.CAMERA_UNAVAILABLE), phase)
        // Asking for a camera that does not exist raises a dialog whose answer
        // changes nothing.
        assertTrue(camera.prompts.isEmpty())
    }

    @Test
    fun `a dismissed dialog leaves the screen idle, not blocked`() = runBlocking {
        val camera = FakeCamera(CameraPermissionState.NOT_REQUESTED)
        camera.grantOnRequest = CameraPermissionState.NOT_REQUESTED

        val phase = coordinator(camera, FakeSubmitter()).beginScanning()

        // Nothing was denied and nothing was granted. Showing "camera denied"
        // would send the person to change a setting they never made.
        assertEquals(ScanPhase.Idle, phase)
        assertEquals(0, camera.startCount)
    }

    @Test
    fun `a camera that fails to start reports unavailable, not denied`() = runBlocking {
        val camera = FakeCamera(
            CameraPermissionState.GRANTED,
            startThrows = IllegalStateException("no camera"),
        )
        assertEquals(
            ScanPhase.Blocked(ScanBlock.CAMERA_UNAVAILABLE),
            coordinator(camera, FakeSubmitter()).beginScanning(),
        )
    }
}

// ---------------------------------------------------------------------------
// Reading codes
// ---------------------------------------------------------------------------

class ScanHandlingTest {

    @Test
    fun `the same code in frame is acted on once`() = runBlocking {
        val camera = FakeCamera(CameraPermissionState.GRANTED)
        val submitter = FakeSubmitter()
        val scanner = coordinator(camera, submitter)
        scanner.beginScanning()

        // An analyser runs on every frame while a code is in view.
        repeat(25) { scanner.handleScanned(TOKEN) }

        assertEquals(1, submitter.submissions.size)
    }

    @Test
    fun `unrecognised codes never reach the server`() = runBlocking {
        val camera = FakeCamera(CameraPermissionState.GRANTED)
        val submitter = FakeSubmitter()
        val scanner = coordinator(camera, submitter)
        scanner.beginScanning()

        scanner.handleScanned("https://example.org")
        scanner.handleScanned("WIFI:S:x;;")

        // A scanner that complained about every poster in frame would be
        // unusable, and each complaint would cost a rate-limit token.
        assertTrue(submitter.submissions.isEmpty())
    }

    @Test
    fun `a code arriving before Scan is ignored`() = runBlocking {
        val submitter = FakeSubmitter()
        coordinator(FakeCamera(), submitter).handleScanned(TOKEN)
        assertTrue(submitter.submissions.isEmpty())
    }

    @Test
    fun `two codes in one frame interval produce one request`() = runBlocking {
        val camera = FakeCamera(CameraPermissionState.GRANTED)
        val submitter = FakeSubmitter()
        val scanner = coordinator(camera, submitter)
        scanner.beginScanning()

        // Two *different* codes, so the debounce does not mask the guard.
        listOf(
            async { scanner.handleScanned(TOKEN) },
            async { scanner.handleScanned(OTHER_TOKEN) },
        ).awaitAll()

        assertEquals(1, submitter.submissions.size)
    }

    @Test
    fun `the camera stops before the request is sent, not after`() = runBlocking {
        val camera = FakeCamera(CameraPermissionState.GRANTED)
        val scanner = coordinator(camera, FakeSubmitter())
        scanner.beginScanning()
        assertTrue(camera.isRunning)

        scanner.handleScanned(TOKEN)

        // A four-second request on a bad connection must not hold the camera
        // open for four seconds — the indicator is on and nothing is scanning.
        assertTrue(camera.stopCount >= 1)
        assertFalse(camera.isRunning)
    }

    @Test
    fun `leaving the screen releases the camera`() = runBlocking {
        val camera = FakeCamera(CameraPermissionState.GRANTED)
        val scanner = coordinator(camera, FakeSubmitter())
        scanner.beginScanning()
        scanner.stopScanning()

        assertEquals(1, camera.stopCount)
        assertEquals(ScanPhase.Idle, scanner.currentPhase())
    }

    @Test
    fun `the analyser callback is a hand-off, not the work`() = runBlocking {
        val camera = FakeCamera(CameraPermissionState.GRANTED)
        val submitter = FakeSubmitter()
        val scanner = coordinator(camera, submitter)

        val delivered = mutableListOf<String>()
        scanner.onCodeFromAnalyser = { delivered += it }
        scanner.beginScanning()

        // CameraX calls the analyser on its own executor and backs frames up if
        // it is blocked, so the callback only hands the string over. Nothing is
        // submitted until a coroutine picks it up.
        camera.emit(TOKEN)
        assertEquals(listOf(TOKEN), delivered)
        assertTrue(submitter.submissions.isEmpty())

        scanner.handleScanned(delivered.single())
        assertEquals(1, submitter.submissions.size)
    }
}

// ---------------------------------------------------------------------------
// Never count locally
// ---------------------------------------------------------------------------

class ScanOutcomeTest {

    @Test
    fun `counted and already-counted are the only successes`() {
        assertTrue(
            CheckInScanCoordinator.outcomeFor(CheckInServerResult("counted", "in")).isSuccess,
        )
        assertTrue(
            CheckInScanCoordinator
                .outcomeFor(CheckInServerResult("already_counted", "already")).isSuccess,
        )
        for (refused in listOf("rejected", "reversed", "pending_confirmation")) {
            assertFalse(
                refused,
                CheckInScanCoordinator.outcomeFor(CheckInServerResult(refused, "no")).isSuccess,
            )
        }
    }

    @Test
    fun `an outcome this build does not know is refused, never assumed`() {
        // A client that treats what it does not understand as a check-in will
        // one day show a tick for an outcome the server invented to mean the
        // opposite.
        assertFalse(
            CheckInScanCoordinator
                .outcomeFor(CheckInServerResult("counted_provisionally", "?")).isSuccess,
        )
    }

    @Test
    fun `a network failure is not a check-in`() = runBlocking {
        val camera = FakeCamera(CameraPermissionState.GRANTED)
        val submitter = FakeSubmitter(error = CheckInTransportException("no network"))
        val scanner = coordinator(camera, submitter)
        scanner.beginScanning()

        scanner.handleScanned(TOKEN)

        // **The rule that matters most here.** A phone that read a valid code
        // and lost the network has checked nobody in, and a tick would be a lie
        // the person only discovers when the church's report disagrees.
        assertEquals(ScanPhase.Blocked(ScanBlock.OFFLINE), scanner.currentPhase())
    }

    @Test
    fun `a server refusal shows the server's own message`() = runBlocking {
        val camera = FakeCamera(CameraPermissionState.GRANTED)
        val submitter = FakeSubmitter(
            CheckInServerResult("rejected", "Your church needs to confirm who you are first."),
        )
        val scanner = coordinator(camera, submitter)
        scanner.beginScanning()

        scanner.handleScanned(TOKEN)

        assertEquals(
            ScanPhase.Finished(
                ScanOutcome.Refused("Your church needs to confirm who you are first."),
            ),
            scanner.currentPhase(),
        )
    }

    @Test
    fun `a refused scan does not poison the next one`() = runBlocking {
        val camera = FakeCamera(CameraPermissionState.GRANTED)
        val submitter = FakeSubmitter(CheckInServerResult("rejected", "That code has expired."))
        val scanner = coordinator(camera, submitter)

        scanner.beginScanning()
        scanner.handleScanned(TOKEN)

        submitter.result = CheckInServerResult("counted", "You're checked in.")
        scanner.beginScanning()
        scanner.handleScanned(OTHER_TOKEN)

        assertEquals(2, submitter.keys.size)
        assertFalse(
            "the second attempt replayed the first refusal",
            submitter.keys[0] == submitter.keys[1],
        )
        assertTrue(scanner.currentPhase().let { it is ScanPhase.Finished && it.outcome.isSuccess })
    }
}

// ---------------------------------------------------------------------------
// The typed code
// ---------------------------------------------------------------------------

class TypedCodeTest {

    @Test
    fun `an incomplete code is never sent`() = runBlocking {
        val submitter = FakeSubmitter()
        val scanner = coordinator(FakeCamera(), submitter)

        scanner.submitTypedCode("BCD")
        scanner.submitTypedCode("")
        scanner.submitTypedCode("OOOOOOO")

        // Each would be refused server-side, and each refusal would spend one
        // of the person's ten attempts.
        assertTrue(submitter.submissions.isEmpty())
    }

    @Test
    fun `a typed code carries no token, and a scan carries no code`() = runBlocking {
        val camera = FakeCamera(CameraPermissionState.GRANTED)
        val submitter = FakeSubmitter()
        val scanner = coordinator(camera, submitter)

        scanner.submitTypedCode("bcd-4g7j")
        assertEquals("BCD4G7J", submitter.submissions[0].shortCode)
        assertNull(submitter.submissions[0].qrToken)

        scanner.beginScanning()
        scanner.handleScanned(TOKEN)
        assertEquals(TOKEN, submitter.submissions[1].qrToken)
        assertNull(submitter.submissions[1].shortCode)
    }

    @Test
    fun `a submission carries no location, no church, and no member`() = runBlocking {
        val submitter = FakeSubmitter()
        coordinator(FakeCamera(), submitter).submitTypedCode("BCD4G7J")

        // Asserted on the *type*, which is the real guarantee: there is no
        // field here that could carry a position even by mistake.
        val fields = CheckInSubmission::class.java.declaredFields.map { it.name }
        for (forbidden in listOf(
            "latitude", "longitude", "accuracy", "churchId", "occurrenceId",
            "memberId", "deviceId", "email", "phone",
        )) {
            assertFalse(forbidden, fields.contains(forbidden))
        }
        assertEquals(1, submitter.submissions.size)
    }
}
