package io.faithform.faithful.attendance

import com.google.zxing.BarcodeFormat
import com.google.zxing.EncodeHintType
import com.google.zxing.qrcode.QRCodeWriter
import com.google.zxing.qrcode.decoder.ErrorCorrectionLevel
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The QR decoder, exercised against **real generated codes**.
 *
 * This is the reason the decode lives in a pure-JVM module. An ML Kit or
 * Play-services decoder in `:app` would have been a binary nothing in CI could
 * run, and the honest write-up would have had to admit the decode was untested.
 * Here a test encodes a token, renders it to the same luminance plane a camera
 * would hand over, and decodes it — no emulator, no camera, no device.
 */
class LuminanceQrDecoderTest {

    /**
     * Renders a QR to a Y plane, exactly as `YUV_420_888` delivers one.
     *
     * `rowStride` is a parameter because CameraX pads rows: assuming stride
     * equals width produces a skewed image that silently never decodes, and
     * that is a bug worth having a test for.
     */
    private fun renderYPlane(
        text: String,
        size: Int = 300,
        rowStride: Int = size,
        quietZone: Int = 4,
    ): ByteArray {
        val matrix = QRCodeWriter().encode(
            text,
            BarcodeFormat.QR_CODE,
            size,
            size,
            mapOf(
                EncodeHintType.ERROR_CORRECTION to ErrorCorrectionLevel.M,
                EncodeHintType.MARGIN to quietZone,
            ),
        )

        val plane = ByteArray(rowStride * size)
        for (y in 0 until size) {
            for (x in 0 until size) {
                // A set module is dark. Luminance 0 for black, 255 for white —
                // the same convention a camera's Y plane uses.
                plane[y * rowStride + x] = if (matrix[x, y]) 0 else 255.toByte()
            }
        }
        return plane
    }

    private val token =
        "FF1.aB3dEf9xYz.eyJ2IjoyLCJ0IjoiY2hlY2tpbi5xciIsInMiOiJBQUFBQUFBQUFBQUFBQUFBQUEifQ.c2lnbmF0dXJlLWhlcmU"

    @Test
    fun `a real QR image decodes back to the token that made it`() {
        val decoder = LuminanceQrDecoder()
        val plane = renderYPlane(token)

        // Not a stub, not a mock, not a seam standing in for a decoder. An
        // actual QR symbol, decoded.
        assertEquals(token, decoder.decode(plane, 300, 300))
    }

    @Test
    fun `a padded row stride still decodes`() {
        val decoder = LuminanceQrDecoder()
        // CameraX commonly pads to a multiple of 16 or more. A decoder that
        // assumed stride == width would read every row shifted a little further
        // right than the last, and simply never find a code — with no error to
        // explain it.
        val plane = renderYPlane(token, size = 300, rowStride = 320)

        assertEquals(token, decoder.decode(plane, 300, 300, rowStride = 320))
    }

    @Test
    fun `a frame with no code returns null rather than throwing`() {
        val decoder = LuminanceQrDecoder()
        // A wall, a face, a ceiling. The overwhelmingly common frame.
        val blank = ByteArray(300 * 300) { 200.toByte() }

        assertNull(decoder.decode(blank, 300, 300))
    }

    @Test
    fun `noise returns null rather than a wrong string`() {
        val decoder = LuminanceQrDecoder()
        val noise = ByteArray(300 * 300)
        var seed = 12345L
        for (index in noise.indices) {
            seed = seed * 6364136223846793005L + 1442695040888963407L
            noise[index] = (seed ushr 33).toByte()
        }
        assertNull(decoder.decode(noise, 300, 300))
    }

    @Test
    fun `malformed geometry is refused before any decoding`() {
        val decoder = LuminanceQrDecoder()
        val plane = ByteArray(100)

        // Each of these would otherwise index past the end of the array inside
        // the decoder — a crash in a camera callback, thirty times a second.
        assertNull(decoder.decode(plane, 0, 10))
        assertNull(decoder.decode(plane, 10, 0))
        assertNull(decoder.decode(plane, -1, 10))
        assertNull(decoder.decode(plane, 10, 10, rowStride = 5))
        assertNull(decoder.decode(plane, 300, 300))
    }

    @Test
    fun `the decoder is reusable across frames`() {
        val decoder = LuminanceQrDecoder()
        val blank = ByteArray(300 * 300) { 200.toByte() }
        val plane = renderYPlane(token)

        // A camera delivers a long run of empty frames and then a code. A
        // decoder that held state from a failure would stop working after the
        // first blank frame, which is every frame before the person raises
        // their phone.
        repeat(5) { assertNull(decoder.decode(blank, 300, 300)) }
        assertEquals(token, decoder.decode(plane, 300, 300))
        repeat(5) { assertNull(decoder.decode(blank, 300, 300)) }
        assertEquals(token, decoder.decode(plane, 300, 300))
    }

    @Test
    fun `a code decoded from one frame does not leak into the next`() {
        val decoder = LuminanceQrDecoder()
        val first = renderYPlane(token)
        val second = renderYPlane("FF1.other.payload.signature")

        assertEquals(token, decoder.decode(first, 300, 300))
        assertEquals("FF1.other.payload.signature", decoder.decode(second, 300, 300))
    }

    @Test
    fun `a token at the contract's maximum length still decodes`() {
        val decoder = LuminanceQrDecoder()
        // The server refuses anything past 1024. A code at the boundary must
        // still be readable, or the boundary is theoretical.
        // 15 + 1005 + 4 = exactly the server's `MAX_TOKEN_LENGTH`.
        val long = "FF1.aB3dEf9xYz." + "A".repeat(1005) + ".sig"
        assertEquals(1024, long.length)

        // 1024 bytes needs roughly a version-25 symbol at medium recovery, so
        // the render has to be large enough that modules survive. A projector
        // showing a real token is displaying far fewer than this.
        val plane = renderYPlane(long, size = 700)
        assertEquals(long, decoder.decode(plane, 700, 700))
    }
}

class ScannedPayloadReaderTest {

    private val token = "FF1.abc12345.eyJ0IjoiY2hlY2tpbi5xciJ9.c2lnbmF0dXJl"

    @Test
    fun `a Faithful token is recognised`() {
        assertEquals(ScannedPayload.CheckInToken(token), ScannedPayloadReader.read(token))
    }

    @Test
    fun `surrounding whitespace is tolerated`() {
        assertEquals(
            ScannedPayload.CheckInToken(token),
            ScannedPayloadReader.read("  $token\n"),
        )
    }

    @Test
    fun `anything else is ignored silently`() {
        for (other in listOf(
            "https://example.org",
            "WIFI:S:Church;T:WPA;P:hunter2;;",
            "BEGIN:VCARD\nEND:VCARD",
            "",
            "FF1",
            "FF1.only.three",
            "FF1..empty.part",
            "FF2.a.b.c",
        )) {
            assertEquals(other, ScannedPayload.Unrecognised, ScannedPayloadReader.read(other))
        }
    }

    @Test
    fun `an oversized payload is refused before it is sent`() {
        val huge = "FF1.a." + "x".repeat(2000) + ".b"
        // The server refuses anything past `MAX_TOKEN_LENGTH`, so sending this
        // would spend one of the person's attempts to learn what is already
        // known here.
        assertEquals(ScannedPayload.Unrecognised, ScannedPayloadReader.read(huge))
    }
}

class ShortCodeEntryTest {

    @Test
    fun `the alphabet matches the server's`() {
        // Drift here would let a client refuse a code the server would have
        // accepted, which reads to the person as a broken code rather than a
        // broken app. `tests/security/checkin-authority.test.ts` asserts the
        // same equality from the other side, for both platforms.
        assertEquals("BCDFGHJKLMNPQRTVWXY3479", ShortCodeEntry.ALPHABET)
        assertEquals(7, ShortCodeEntry.LENGTH)
    }

    @Test
    fun `every confusable pair has one side removed`() {
        for (confusable in listOf("0", "O", "1", "I", "2", "Z", "5", "S", "6", "8", "U")) {
            assertFalse(confusable, ShortCodeEntry.ALPHABET.contains(confusable))
        }
        // No vowels, so the generator cannot produce a word a church would have
        // to explain on a screen at the front of a sanctuary.
        for (vowel in listOf("A", "E", "I", "O", "U")) {
            assertFalse(vowel, ShortCodeEntry.ALPHABET.contains(vowel))
        }
    }

    @Test
    fun `case and separators are forgiven`() {
        assertEquals("BCD4G7J", ShortCodeEntry.normalise("bcd-4g7j"))
        assertEquals("BCD4G7J", ShortCodeEntry.normalise(" BCD 4G7J "))
        assertTrue(ShortCodeEntry.isComplete("bcd-4g7j"))
    }

    @Test
    fun `nothing is substituted`() {
        // Every character a substitution table would map is already absent from
        // the alphabet, so mapping one could only turn a typo into a *different
        // valid code* — checking someone into a service they did not choose.
        assertEquals("", ShortCodeEntry.normalise("OOOOOOO"))
        assertFalse(ShortCodeEntry.isComplete("OOOOOOO"))
        assertFalse(ShortCodeEntry.isComplete("SSSSSSS"))
    }

    @Test
    fun `the field never grows past a code`() {
        assertEquals(7, ShortCodeEntry.normalise("BCDFGHJKLMNPQRTVWXY3479").length)
    }
}

class ScanAttemptIdentityTest {

    @Test
    fun `two scans never share an identity`() {
        val seen = (0 until 500).map { ScanAttemptIdentity.make() }.toSet()
        assertEquals(500, seen.size)
    }

    @Test
    fun `the key follows the attempt, not the code`() {
        val first = ScanAttemptIdentity.make()
        val second = ScanAttemptIdentity.make()

        // **The Prompt 7 lesson, applied.** A key derived from stable inputs —
        // the account, the occurrence, the token — made one early refusal
        // permanent for the rest of the service, because every later attempt
        // replayed it.
        assertEquals(
            ScanAttemptIdentity.idempotencyKey(first),
            ScanAttemptIdentity.idempotencyKey(first),
        )
        assertNotNull(ScanAttemptIdentity.idempotencyKey(second))
        assertFalse(
            ScanAttemptIdentity.idempotencyKey(first) ==
                ScanAttemptIdentity.idempotencyKey(second),
        )
    }
}

class ScanDebounceTest {

    @Test
    fun `the same code is acted on once`() {
        var debounce = ScanDebounce()
        assertTrue(debounce.shouldSubmit("a", 1_000L))
        debounce = debounce.recording("a", 1_000L)
        assertFalse(debounce.shouldSubmit("a", 1_000L))
        assertFalse(debounce.shouldSubmit("a", 5_000L))
    }

    @Test
    fun `a rotated code is acted on immediately`() {
        var debounce = ScanDebounce()
        debounce = debounce.recording("a", 1_000L)
        // The display rotated. Refusing this would make the person wait out a
        // window for nothing.
        assertTrue(debounce.shouldSubmit("b", 1_100L))
    }

    @Test
    fun `the same code becomes actionable again after the window`() {
        var debounce = ScanDebounce()
        debounce = debounce.recording("a", 1_000L)
        assertFalse(debounce.shouldSubmit("a", 1_000L + ScanDebounce.REPEAT_WINDOW_MILLIS - 1))
        assertTrue(debounce.shouldSubmit("a", 1_000L + ScanDebounce.REPEAT_WINDOW_MILLIS))
    }
}
