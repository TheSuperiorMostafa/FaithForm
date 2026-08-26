package io.faithform.faithful.attendance

/**
 * What the check-in screen shows, as data.
 *
 * Pure and in `:core:attendance` on purpose: the parity check between iOS and
 * Android compares *behaviour*, and behaviour that lives inside a Composable is
 * only comparable by reading it. Every rule about which affordance appears is
 * decided here and asserted by `gradlew :core:attendance:test`.
 */
data class CheckInScannerUiState(
    val phase: ScanPhase = ScanPhase.Idle,
    val typedCode: String = "",
) {
    val isScanning: Boolean get() = phase is ScanPhase.Scanning
    val isSubmitting: Boolean get() = phase is ScanPhase.Submitting

    /** The camera offer is hidden only while the camera is already running. */
    val showsScanButton: Boolean
        get() = phase is ScanPhase.Idle || phase is ScanPhase.Blocked

    /**
     * **Always true.**
     *
     * The typed field is not a fallback that appears once something has failed.
     * Someone whose camera is broken, whose hands shake, or who would simply
     * rather not grant camera access should not have to be refused once before
     * being shown the way that works for them.
     */
    val showsTypedEntry: Boolean
        get() = phase !is ScanPhase.Submitting && phase !is ScanPhase.Finished

    val canSubmitTypedCode: Boolean get() = ShortCodeEntry.isComplete(typedCode)

    /**
     * Settings is offered only where it would help.
     *
     * A re-askable denial needs another tap, not a trip to Settings; a device
     * with no camera cannot be fixed there at all. Offering it everywhere is
     * how apps end up with a button that does nothing.
     */
    val offersSettings: Boolean
        get() = (phase as? ScanPhase.Blocked)?.block == ScanBlock.CAMERA_DENIED_PERMANENTLY

    /** A re-askable denial gets "try again", which actually raises the dialog. */
    val offersRetryPermission: Boolean
        get() = (phase as? ScanPhase.Blocked)?.block == ScanBlock.CAMERA_DENIED_CAN_ASK

    val resultMessage: String?
        get() = (phase as? ScanPhase.Finished)?.outcome?.message

    /** **Only ever the server's own verdict.** */
    val isSuccess: Boolean
        get() = (phase as? ScanPhase.Finished)?.outcome?.isSuccess == true

    fun withTypedCode(input: String): CheckInScannerUiState =
        copy(typedCode = ShortCodeEntry.normalise(input))
}
