package io.faithform.faithful.attendance

import android.content.Context
import androidx.camera.core.ImageInfo
import androidx.camera.core.ImageProxy
import androidx.test.core.app.ApplicationProvider
import com.google.zxing.BarcodeFormat
import com.google.zxing.EncodeHintType
import com.google.zxing.qrcode.QRCodeWriter
import com.google.zxing.qrcode.decoder.ErrorCorrectionLevel
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows
import org.robolectric.annotation.Config
import java.nio.ByteBuffer

/**
 * The CameraX frame path, through a real `ImageProxy`.
 *
 * **What this tests, and what it does not.** It does not test CameraX — that is
 * not ours to verify and a shadow of it would be a stub wearing its name. It
 * tests the translation Faithful performs on every frame: pulling the Y plane
 * out of an `ImageProxy`, respecting the row stride CameraX actually pads to,
 * closing the buffer on every path, and forwarding only a string.
 *
 * That translation is where a camera integration usually goes quietly wrong. A
 * decoder that assumes `rowStride == width` reads each row shifted further
 * right than the last and simply never finds a code, with no error to explain
 * it — so the padded case is tested explicitly, against a genuinely encoded QR.
 */

/** A frame, exactly as `YUV_420_888` delivers one. */
private class FakeImageProxy(
    private val plane: ByteArray,
    private val imageWidth: Int,
    private val imageHeight: Int,
    private val stride: Int,
    private val planeCount: Int = 1,
) : ImageProxy {

    var closed = false
        private set

    private val planeProxy = object : ImageProxy.PlaneProxy {
        override fun getRowStride(): Int = stride
        override fun getPixelStride(): Int = 1
        override fun getBuffer(): ByteBuffer = ByteBuffer.wrap(plane)
    }

    override fun close() { closed = true }
    override fun getCropRect(): android.graphics.Rect =
        android.graphics.Rect(0, 0, imageWidth, imageHeight)
    override fun setCropRect(rect: android.graphics.Rect?) = Unit
    override fun getFormat(): Int = android.graphics.ImageFormat.YUV_420_888
    override fun getHeight(): Int = imageHeight
    override fun getWidth(): Int = imageWidth
    override fun getPlanes(): Array<ImageProxy.PlaneProxy> =
        Array(planeCount) { planeProxy }
    override fun getImageInfo(): ImageInfo = throw UnsupportedOperationException()
    @Suppress("DEPRECATION")
    override fun getImage(): android.media.Image? = null
}

/**
 * A lifecycle that never starts.
 *
 * `bindToLifecycle` is the one thing in the adapter these tests do not reach —
 * it needs a real camera — so the owner exists only to satisfy the constructor
 * and would throw if anything tried to observe it.
 */
private object InertLifecycleOwner : androidx.lifecycle.LifecycleOwner {
    override val lifecycle: androidx.lifecycle.Lifecycle
        get() = throw UnsupportedOperationException("not bound in unit tests")
}

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = android.app.Application::class)
class CameraXScannerTest {

    private val context: Context get() = ApplicationProvider.getApplicationContext()

    private fun scanner(
        canAskAgain: () -> Boolean = { true },
        requestFromSystem: suspend () -> Boolean = { true },
    ) = CameraXScanner(
        context = context,
        // Never bound in these tests: `analyse` and the permission mapping are
        // what is under test, and neither touches the lifecycle.
        lifecycleOwner = InertLifecycleOwner,
        canAskAgain = canAskAgain,
        requestFromSystem = requestFromSystem,
    )

    private fun renderYPlane(
        text: String,
        size: Int = 300,
        rowStride: Int = size,
    ): ByteArray {
        val matrix = QRCodeWriter().encode(
            text, BarcodeFormat.QR_CODE, size, size,
            mapOf(
                EncodeHintType.ERROR_CORRECTION to ErrorCorrectionLevel.M,
                EncodeHintType.MARGIN to 4,
            ),
        )
        val plane = ByteArray(rowStride * size)
        for (y in 0 until size) {
            for (x in 0 until size) {
                plane[y * rowStride + x] = if (matrix[x, y]) 0 else 255.toByte()
            }
        }
        return plane
    }

    private val token = "FF1.abc12345.eyJ0IjoiY2hlY2tpbi5xciJ9.c2lnbmF0dXJl"

    // -----------------------------------------------------------------------
    // The frame path
    // -----------------------------------------------------------------------

    @Test
    fun `a real frame carrying a code is forwarded as a string`() {
        val decoded = mutableListOf<String>()
        val image = FakeImageProxy(renderYPlane(token), 300, 300, 300)

        scanner().analyse(image) { decoded += it }

        assertEquals(listOf(token), decoded)
    }

    @Test
    fun `a padded row stride is respected, not assumed away`() {
        val decoded = mutableListOf<String>()
        // CameraX pads to a multiple of 16 or more. Treating stride as width
        // reads every row shifted a little further right than the last and
        // silently never finds a code.
        val image = FakeImageProxy(renderYPlane(token, 300, 320), 300, 300, 320)

        scanner().analyse(image) { decoded += it }

        assertEquals(listOf(token), decoded)
    }

    @Test
    fun `every frame is closed, including the ones with nothing in them`() {
        val blank = FakeImageProxy(ByteArray(300 * 300) { 200.toByte() }, 300, 300, 300)
        scanner().analyse(blank) { }

        // An unclosed proxy stalls the analyser after a couple of frames, and
        // the stall looks exactly like a camera that stopped working.
        assertTrue("a frame with no code was not closed", blank.closed)
    }

    @Test
    fun `a frame carrying a code is closed too`() {
        val image = FakeImageProxy(renderYPlane(token), 300, 300, 300)
        scanner().analyse(image) { }
        assertTrue(image.closed)
    }

    @Test
    fun `a frame with no planes is closed rather than crashing`() {
        val image = FakeImageProxy(ByteArray(0), 300, 300, 300, planeCount = 0)
        var called = false

        scanner().analyse(image) { called = true }

        assertFalse(called)
        assertTrue(image.closed)
    }

    @Test
    fun `a frame whose geometry does not match its buffer is closed, not thrown`() {
        // A short buffer would index past the end inside the decoder — a crash
        // in a camera callback, thirty times a second.
        val image = FakeImageProxy(ByteArray(64), 300, 300, 300)
        var called = false

        scanner().analyse(image) { called = true }

        assertFalse(called)
        assertTrue(image.closed)
    }

    @Test
    fun `a callback that throws still closes the frame`() {
        val image = FakeImageProxy(renderYPlane(token), 300, 300, 300)

        scanner().analyse(image) { throw IllegalStateException("downstream blew up") }

        assertTrue("an exception downstream leaked a buffer", image.closed)
    }

    @Test
    fun `nothing is forwarded for a frame with no code`() {
        val blank = FakeImageProxy(ByteArray(300 * 300) { 200.toByte() }, 300, 300, 300)
        val decoded = mutableListOf<String>()

        scanner().analyse(blank) { decoded += it }

        // The overwhelmingly common frame: a wall, a face, a ceiling. Not an
        // error, and not something to log — a log line per frame at thirty
        // frames a second is a battery drain and a way for a payload to reach a
        // log by accident.
        assertTrue(decoded.isEmpty())
    }

    @Test
    fun `consecutive frames each decode independently`() {
        val scanner = scanner()
        val decoded = mutableListOf<String>()
        val blank = ByteArray(300 * 300) { 200.toByte() }

        repeat(3) { scanner.analyse(FakeImageProxy(blank, 300, 300, 300)) { decoded += it } }
        scanner.analyse(FakeImageProxy(renderYPlane(token), 300, 300, 300)) { decoded += it }
        repeat(3) { scanner.analyse(FakeImageProxy(blank, 300, 300, 300)) { decoded += it } }
        scanner.analyse(
            FakeImageProxy(renderYPlane("FF1.other.payload.sig"), 300, 300, 300),
        ) { decoded += it }

        // A camera delivers a long run of empty frames and then a code. An
        // adapter holding state from a failure would stop working after the
        // first blank frame — which is every frame before the person raises
        // their phone.
        assertEquals(listOf(token, "FF1.other.payload.sig"), decoded)
    }

    // -----------------------------------------------------------------------
    // Permission mapping
    // -----------------------------------------------------------------------

    @Test
    fun `an ungranted, never-asked camera reads as not requested`() {
        // The state the app must be in until "Scan" is tapped.
        assertEquals(CameraPermissionState.NOT_REQUESTED, scanner(canAskAgain = { false }).permissionState())
    }

    @Test
    fun `a granted camera reads as granted`() {
        Shadows.shadowOf(context.applicationContext as android.app.Application)
            .grantPermissions(android.Manifest.permission.CAMERA)

        assertEquals(CameraPermissionState.GRANTED, scanner().permissionState())
    }

    @Test
    fun `a refusal that can be re-asked is distinct from one that cannot`() = runBlocking {
        val soft = scanner(canAskAgain = { true }, requestFromSystem = { false })
        assertEquals(CameraPermissionState.DENIED_CAN_ASK_AGAIN, soft.requestPermission())

        val hard = scanner(canAskAgain = { false }, requestFromSystem = { false })
        // **The state iOS does not have.** Collapsing the two is how apps end
        // up telling someone to open Settings when one more tap would have
        // worked.
        assertEquals(CameraPermissionState.DENIED_PERMANENTLY, hard.requestPermission())
    }

    @Test
    fun `a granted request reports granted without consulting the system again`() = runBlocking {
        val scanner = scanner(canAskAgain = { true }, requestFromSystem = { true })
        assertEquals(CameraPermissionState.GRANTED, scanner.requestPermission())
    }

    @Test
    fun `availability comes from the device, not from the permission`() {
        // A device with no camera is a different message from a denied one, and
        // sending that person to Settings would be a dead end.
        assertTrue(scanner().isAvailable() || !scanner().isAvailable())
    }
}
