package io.faithform.faithful.attendance

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * What the check-in screen shows, asserted as data.
 *
 * These rules live outside the Composable precisely so they can be tested and
 * so the iOS/Android parity matrix can compare behaviour rather than compare
 * two people's readings of two layout files.
 */
class CheckInScannerUiStateTest {

    @Test
    fun `the screen starts idle and offers both ways in`() {
        val state = CheckInScannerUiState()

        assertEquals(ScanPhase.Idle, state.phase)
        assertTrue(state.showsScanButton)
        // **Not a fallback that appears after a failure.** Someone who cannot
        // use a camera should not have to be refused once to find the way that
        // works for them.
        assertTrue(state.showsTypedEntry)
        assertFalse(state.canSubmitTypedCode)
        assertNull(state.resultMessage)
        assertFalse(state.isSuccess)
    }

    @Test
    fun `typing is normalised as it goes`() {
        var state = CheckInScannerUiState().withTypedCode("bcd-4g7j")
        assertEquals("BCD4G7J", state.typedCode)
        assertTrue(state.canSubmitTypedCode)

        state = state.withTypedCode("bcd")
        assertFalse(state.canSubmitTypedCode)
    }

    @Test
    fun `the field never grows past a code`() {
        val state = CheckInScannerUiState().withTypedCode("BCDFGHJKLMNPQRTVWXY3479")
        assertEquals(ShortCodeEntry.LENGTH, state.typedCode.length)
    }

    @Test
    fun `a re-askable denial offers another try, not a trip to Settings`() {
        val state = CheckInScannerUiState(
            phase = ScanPhase.Blocked(ScanBlock.CAMERA_DENIED_CAN_ASK),
        )

        // **Android's genuine difference from iOS.** The dialog will appear
        // again, so sending someone to Settings would waste their time.
        assertTrue(state.offersRetryPermission)
        assertFalse(state.offersSettings)
        assertTrue(state.showsScanButton)
    }

    @Test
    fun `a permanent denial offers Settings, and only then`() {
        val state = CheckInScannerUiState(
            phase = ScanPhase.Blocked(ScanBlock.CAMERA_DENIED_PERMANENTLY),
        )
        assertTrue(state.offersSettings)
        assertFalse(state.offersRetryPermission)
    }

    @Test
    fun `an absent camera offers neither, because neither would help`() {
        val state = CheckInScannerUiState(
            phase = ScanPhase.Blocked(ScanBlock.CAMERA_UNAVAILABLE),
        )
        assertFalse(state.offersSettings)
        assertFalse(state.offersRetryPermission)
        // But the typed code is still right there.
        assertTrue(state.showsTypedEntry)
    }

    @Test
    fun `being offline offers neither camera remedy`() {
        val state = CheckInScannerUiState(phase = ScanPhase.Blocked(ScanBlock.OFFLINE))
        assertFalse(state.offersSettings)
        assertFalse(state.offersRetryPermission)
        assertTrue(state.showsTypedEntry)
    }

    @Test
    fun `the scan offer disappears only while the camera is running`() {
        assertFalse(CheckInScannerUiState(phase = ScanPhase.Scanning).showsScanButton)
        assertFalse(CheckInScannerUiState(phase = ScanPhase.Submitting).showsScanButton)
        assertTrue(CheckInScannerUiState(phase = ScanPhase.Idle).showsScanButton)
    }

    @Test
    fun `the typed field is hidden only while a decision is pending`() {
        // Leaving it live during submission would let someone fire a second
        // attempt into a request that has not answered yet.
        assertFalse(CheckInScannerUiState(phase = ScanPhase.Submitting).showsTypedEntry)
        assertFalse(
            CheckInScannerUiState(
                phase = ScanPhase.Finished(ScanOutcome.Counted("in")),
            ).showsTypedEntry,
        )
        assertTrue(CheckInScannerUiState(phase = ScanPhase.Scanning).showsTypedEntry)
    }

    @Test
    fun `success is only ever the server's own verdict`() {
        assertTrue(
            CheckInScannerUiState(
                phase = ScanPhase.Finished(ScanOutcome.Counted("You're checked in.")),
            ).isSuccess,
        )
        assertTrue(
            CheckInScannerUiState(
                phase = ScanPhase.Finished(ScanOutcome.AlreadyCounted("Already in.")),
            ).isSuccess,
        )
        assertFalse(
            CheckInScannerUiState(
                phase = ScanPhase.Finished(ScanOutcome.Refused("No.")),
            ).isSuccess,
        )
        // Reading a code is not a check-in.
        assertFalse(CheckInScannerUiState(phase = ScanPhase.Scanning).isSuccess)
        assertFalse(CheckInScannerUiState(phase = ScanPhase.Submitting).isSuccess)
        assertFalse(CheckInScannerUiState(phase = ScanPhase.Blocked(ScanBlock.OFFLINE)).isSuccess)
    }

    @Test
    fun `the result message is the server's, verbatim`() {
        val state = CheckInScannerUiState(
            phase = ScanPhase.Finished(
                ScanOutcome.Refused("Your church needs to confirm who you are first."),
            ),
        )
        assertEquals("Your church needs to confirm who you are first.", state.resultMessage)
    }
}
