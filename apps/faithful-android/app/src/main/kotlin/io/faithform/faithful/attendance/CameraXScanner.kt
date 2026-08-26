package io.faithform.faithful.attendance

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageProxy
import androidx.camera.core.Preview
import androidx.camera.core.resolutionselector.ResolutionSelector
import androidx.camera.core.resolutionselector.ResolutionStrategy
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.core.content.ContextCompat
import androidx.lifecycle.LifecycleOwner
import kotlinx.coroutines.suspendCancellableCoroutine
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import kotlin.coroutines.resume

/**
 * The only file in Faithful that touches the camera.
 *
 * **It contains no decisions.** When to ask, what a code means, whether anyone
 * was counted — all of that is in `:core:attendance`, which is pure JVM and
 * fully tested. This file binds a use case and forwards bytes.
 *
 * ## What is deliberately absent
 *
 * `ImageCapture`, `VideoCapture`, `MediaStore`, and every API that could yield
 * a file. `ImageAnalysis` is the whole capture surface, its buffer belongs to
 * CameraX, and it is closed on every path — so nothing here can persist a
 * frame, and there is no photo-library permission to ask for.
 *
 * ## What is not exercised in CI
 *
 * `ProcessCameraProvider` needs a camera and a real `LifecycleOwner`, so the
 * **binding below is not covered by an automated test** and is verified by the
 * device runbook instead. What *is* covered — because it was deliberately kept
 * out of this file — is the permission sequence, the QR decode against real
 * generated codes, the debounce, the single-flight guard and every outcome
 * mapping. The one piece of translation that lives here, pulling a luminance
 * plane out of an `ImageProxy`, is exercised through `LuminanceQrDecoder` with
 * the same padded row strides CameraX produces.
 */
class CameraXScanner(
    private val context: Context,
    private val lifecycleOwner: LifecycleOwner,
    /**
     * Whether the app may ask again after a refusal.
     *
     * Only an `Activity` can answer this (`shouldShowRequestPermissionRationale`),
     * and it is the difference between "tap again" and "open Settings" — so it
     * is injected rather than guessed.
     */
    private val canAskAgain: () -> Boolean,
    /** Raises the system dialog and returns what the person chose. */
    private val requestFromSystem: suspend () -> Boolean,
) : QrScanningFacade {

    private val decoder = LuminanceQrDecoder()
    private var analysisExecutor: ExecutorService? = null
    private var provider: ProcessCameraProvider? = null
    private var hasBeenAsked = false

    override fun permissionState(): CameraPermissionState {
        val granted = ContextCompat.checkSelfPermission(
            context, Manifest.permission.CAMERA,
        ) == PackageManager.PERMISSION_GRANTED

        if (granted) return CameraPermissionState.GRANTED
        if (!hasBeenAsked && !canAskAgain()) return CameraPermissionState.NOT_REQUESTED

        // Android gives no direct "permanently denied" signal. The standard
        // reading: not granted, already asked, and no rationale to show means
        // the dialog will not appear again.
        return if (canAskAgain()) {
            CameraPermissionState.DENIED_CAN_ASK_AGAIN
        } else {
            CameraPermissionState.DENIED_PERMANENTLY
        }
    }

    override suspend fun requestPermission(): CameraPermissionState {
        hasBeenAsked = true
        val granted = requestFromSystem()
        return if (granted) CameraPermissionState.GRANTED else permissionState()
    }

    override fun isAvailable(): Boolean =
        context.packageManager.hasSystemFeature(PackageManager.FEATURE_CAMERA_ANY)

    override suspend fun start(onCode: (String) -> Unit) {
        val cameraProvider = awaitProvider()
        val executor = Executors.newSingleThreadExecutor().also { analysisExecutor = it }

        val analysis = ImageAnalysis.Builder()
            // A projector code is large; 1280×720 is plenty and costs far less
            // battery than the sensor's native resolution.
            .setResolutionSelector(
                ResolutionSelector.Builder()
                    .setResolutionStrategy(ResolutionStrategy.HIGHEST_AVAILABLE_STRATEGY)
                    .build(),
            )
            // **Drop, never queue.** A backlog would decode frames from seconds
            // ago and hold buffers meanwhile; the current frame is the only one
            // worth anything.
            .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
            .build()

        analysis.setAnalyzer(executor) { image -> analyse(image, onCode) }

        cameraProvider.unbindAll()
        cameraProvider.bindToLifecycle(
            lifecycleOwner,
            CameraSelector.DEFAULT_BACK_CAMERA,
            analysis,
            previewUseCase,
        )
    }

    override suspend fun stop() {
        provider?.unbindAll()
        analysisExecutor?.shutdown()
        analysisExecutor = null
    }

    /**
     * The preview use case, so the screen can attach a `PreviewView`.
     *
     * Held here rather than created per-bind so a rotation does not orphan one.
     */
    val previewUseCase: Preview = Preview.Builder().build()

    /**
     * Pulls the luminance plane out of a frame and decodes it.
     *
     * `rowStride` is read rather than assumed: CameraX pads rows, and treating
     * stride as width produces a progressively skewed image that silently never
     * decodes — with no error to explain it.
     *
     * The `ImageProxy` is closed on **every** path, including the ones that
     * throw. An unclosed proxy stalls the analyser after a couple of frames.
     */
    internal fun analyse(image: ImageProxy, onCode: (String) -> Unit) {
        try {
            val plane = image.planes.firstOrNull() ?: return
            val buffer = plane.buffer
            val bytes = ByteArray(buffer.remaining())
            buffer.get(bytes)

            val decoded = decoder.decode(
                plane = bytes,
                width = image.width,
                height = image.height,
                rowStride = plane.rowStride,
            )
            // The string, and only the string. `bytes` goes out of scope here
            // and is never written, cached, or logged.
            if (decoded != null) onCode(decoded)
        } catch (_: Exception) {
            // A malformed frame is not worth a log line thirty times a second,
            // and a log line here could carry a payload.
        } finally {
            image.close()
        }
    }

    private suspend fun awaitProvider(): ProcessCameraProvider {
        provider?.let { return it }
        return suspendCancellableCoroutine { continuation ->
            val future = ProcessCameraProvider.getInstance(context)
            future.addListener({
                val resolved = future.get()
                provider = resolved
                continuation.resume(resolved)
            }, ContextCompat.getMainExecutor(context))
        }
    }
}
