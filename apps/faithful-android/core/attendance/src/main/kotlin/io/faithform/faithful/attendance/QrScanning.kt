package io.faithform.faithful.attendance

import com.google.zxing.BinaryBitmap
import com.google.zxing.DecodeHintType
import com.google.zxing.NotFoundException
import com.google.zxing.PlanarYUVLuminanceSource
import com.google.zxing.common.HybridBinarizer
import com.google.zxing.qrcode.QRCodeReader
import java.security.SecureRandom

/**
 * Scanning a check-in code, with every decision out of the camera's way.
 *
 * ## Why the decoder is here and not in `:app`
 *
 * `:core:attendance` is a pure-JVM module. Putting the QR decode here means it
 * runs under `gradlew :core:attendance:test` against a **real generated QR
 * image**, on an ordinary runner, with no emulator and no camera. The
 * alternative — an ML Kit or Play-services decoder in `:app` — would have been
 * a binary nothing in CI could exercise, and the honest write-up would have had
 * to say the decode was untested.
 *
 * What remains in `:app` is CameraX handing over a byte array. That is a thin
 * seam, and it is the only part of this feature the device runbook has to cover.
 */

// ---------------------------------------------------------------------------
// Permission
// ---------------------------------------------------------------------------

/**
 * The camera permission, as this feature needs to reason about it.
 *
 * Android's runtime permissions have a third state iOS does not: *denied, but
 * asking again would still show a prompt*. Collapsing that into "denied" is how
 * apps end up telling someone to open Settings when a tap would have done.
 */
enum class CameraPermissionState {
    /** **Never been asked.** Where the app must be until "Scan" is tapped. */
    NOT_REQUESTED,

    GRANTED,

    /** Denied once. Asking again still raises the system dialog. */
    DENIED_CAN_ASK_AGAIN,

    /**
     * Denied permanently, or blocked by policy. No dialog will appear, so the
     * only route is app settings.
     */
    DENIED_PERMANENTLY;

    val canScan: Boolean get() = this == GRANTED

    /** Whether asking would actually produce a dialog. */
    val promptWouldAppear: Boolean
        get() = this == NOT_REQUESTED || this == DENIED_CAN_ASK_AGAIN
}

/**
 * The camera, reduced to what scanning needs.
 *
 * **What is deliberately absent:** any member that returns an image, writes a
 * file, or touches the photo library. A QR scan needs a string, so the interface
 * cannot express saving a frame — a stronger guarantee than a rule saying not
 * to.
 */
interface QrScanningFacade {
    fun permissionState(): CameraPermissionState

    /**
     * Raises the camera dialog.
     *
     * **Only ever called from an explicit "Scan" action.** Never at launch,
     * during onboarding, while browsing a feed, or when enabling automatic
     * attendance.
     */
    suspend fun requestPermission(): CameraPermissionState

    /** Starts delivering decoded strings. Idempotent. */
    suspend fun start(onCode: (String) -> Unit)

    /** Stops analysis and releases the camera. */
    suspend fun stop()

    /** Whether this device has a usable camera at all. */
    fun isAvailable(): Boolean
}

// ---------------------------------------------------------------------------
// Decoding
// ---------------------------------------------------------------------------

/**
 * Turns one camera frame's luminance plane into a decoded string.
 *
 * The Y plane of a `YUV_420_888` image is exactly the greyscale bitmap a QR
 * decoder wants, so no colour conversion and no `Bitmap` allocation is needed —
 * which also means no image object is ever created that could be written
 * anywhere.
 *
 * **Nothing is retained.** The reader is reset between frames and the byte array
 * belongs to the caller; this object holds no reference to it after returning.
 */
class LuminanceQrDecoder {
    private val reader = QRCodeReader()
    private val hints = mapOf(DecodeHintType.TRY_HARDER to true)

    /**
     * @param plane the Y plane, row-major
     * @param rowStride bytes per row, which CameraX pads and is *not* always
     *   equal to the width — assuming it is produces a skewed image that
     *   silently never decodes
     */
    fun decode(
        plane: ByteArray,
        width: Int,
        height: Int,
        rowStride: Int = width,
    ): String? {
        if (width <= 0 || height <= 0) return null
        if (rowStride < width) return null
        if (plane.size < rowStride * height) return null

        val source = PlanarYUVLuminanceSource(
            plane, rowStride, height, 0, 0, width, height, false,
        )

        return try {
            reader.decode(BinaryBitmap(HybridBinarizer(source)), hints).text
        } catch (_: NotFoundException) {
            // The overwhelmingly common case: no code in this frame. Not an
            // error, and emphatically not something to log — a log line per
            // frame at thirty frames a second is a battery drain and a way for
            // a payload to reach a log by accident.
            null
        } catch (_: Exception) {
            // A checksum failure or a malformed symbol. Same treatment.
            null
        } finally {
            reader.reset()
        }
    }
}

// ---------------------------------------------------------------------------
// What a scanned string may be
// ---------------------------------------------------------------------------

sealed interface ScannedPayload {
    /** A Faithful check-in capability. **Opaque** to the client. */
    data class CheckInToken(val token: String) : ScannedPayload

    /** Something else: a Wi-Fi code, a URL, a business card. */
    data object Unrecognised : ScannedPayload
}

object ScannedPayloadReader {
    /**
     * The wire format's prefix. Matching it lets the scanner ignore the poster
     * beside the screen without a round trip, and **nothing more** — the token
     * is signed, and only the server can say whether it is real.
     */
    const val TOKEN_PREFIX = "FF1."

    /** Matches `MAX_TOKEN_LENGTH` on the server. */
    const val MAXIMUM_LENGTH = 1024

    fun read(raw: String): ScannedPayload {
        val trimmed = raw.trim()
        if (trimmed.length > MAXIMUM_LENGTH || !trimmed.startsWith(TOKEN_PREFIX)) {
            return ScannedPayload.Unrecognised
        }
        val parts = trimmed.split(".")
        if (parts.size != 4 || parts.any { it.isEmpty() }) return ScannedPayload.Unrecognised
        return ScannedPayload.CheckInToken(trimmed)
    }
}

// ---------------------------------------------------------------------------
// The typed fallback
// ---------------------------------------------------------------------------

/**
 * The short code, mirrored from the server.
 *
 * Duplicated deliberately rather than fetched: this shapes the keyboard and
 * stops a hopeless request before it is sent, and a client that had to ask the
 * server what a code looks like could do neither offline. The server normalises
 * and validates again; this is convenience, never authority.
 */
object ShortCodeEntry {
    const val ALPHABET = "BCDFGHJKLMNPQRTVWXY3479"
    const val LENGTH = 7

    /**
     * Folds case and drops separators. **Substitutes nothing** — every
     * character a substitution table would map is already absent from the
     * alphabet, so mapping one could only turn a typo into a different valid
     * code and check someone into a service they did not choose.
     */
    fun normalise(input: String): String =
        input.uppercase().filter { ALPHABET.contains(it) }.take(LENGTH)

    fun isComplete(input: String): Boolean = normalise(input).length == LENGTH
}

// ---------------------------------------------------------------------------
// Phases
// ---------------------------------------------------------------------------

sealed interface ScanPhase {
    /** Before "Scan" is tapped. **The camera is not running.** */
    data object Idle : ScanPhase
    data object RequestingPermission : ScanPhase
    data object Scanning : ScanPhase
    /** A code is with the server. The camera is already stopped. */
    data object Submitting : ScanPhase
    data class Finished(val outcome: ScanOutcome) : ScanPhase
    data class Blocked(val block: ScanBlock) : ScanPhase
}

sealed interface ScanOutcome {
    val message: String

    data class Counted(override val message: String) : ScanOutcome
    data class AlreadyCounted(override val message: String) : ScanOutcome
    data class Refused(override val message: String) : ScanOutcome

    /**
     * **The only place a scan may be called a success.**
     *
     * Derived from the server's `outcome`, never from having read a code. A
     * phone that scanned a valid code and lost the network has checked nobody
     * in, and saying otherwise is a lie the person discovers when the church's
     * report disagrees with them.
     */
    val isSuccess: Boolean
        get() = this is Counted || this is AlreadyCounted
}

enum class ScanBlock {
    CAMERA_DENIED_CAN_ASK,
    CAMERA_DENIED_PERMANENTLY,
    CAMERA_UNAVAILABLE,
    OFFLINE,
}

/**
 * Whether a decoded string should be acted on.
 *
 * An image analyser runs on every frame — the same code decodes dozens of times
 * a second while it is in view, and a rotating display puts a *new* code up
 * every thirty seconds. Without this, one glance at a projector would spend a
 * person's whole attempt budget in under a second.
 */
data class ScanDebounce(
    private val lastCode: String? = null,
    private val lastAtEpochMillis: Long? = null,
) {
    fun shouldSubmit(code: String, nowEpochMillis: Long): Boolean {
        if (lastCode == null || lastAtEpochMillis == null || lastCode != code) return true
        return nowEpochMillis - lastAtEpochMillis >= REPEAT_WINDOW_MILLIS
    }

    fun recording(code: String, nowEpochMillis: Long): ScanDebounce =
        copy(lastCode = code, lastAtEpochMillis = nowEpochMillis)

    companion object {
        const val REPEAT_WINDOW_MILLIS = 10_000L
    }
}

/**
 * A fresh identity for one scan.
 *
 * **Random, every time.** Prompt 7 learned this the expensive way on the
 * geofence path: an idempotency key derived from stable inputs made a single
 * early refusal permanent for the rest of the service, because every subsequent
 * attempt replayed the refusal instead of being judged.
 */
object ScanAttemptIdentity {
    private val random = SecureRandom()

    fun make(): String {
        val bytes = ByteArray(16)
        random.nextBytes(bytes)
        return "scan-" + bytes.joinToString("") { "%02x".format(it) }
    }

    /** The attempt id *is* the key. A retry reuses it; a new tap makes a new one. */
    fun idempotencyKey(attemptId: String): String = "qr-$attemptId"
}
