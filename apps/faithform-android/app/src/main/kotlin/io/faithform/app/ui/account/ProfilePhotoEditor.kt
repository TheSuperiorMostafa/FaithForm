package io.faithform.app.ui.account

import android.graphics.Bitmap
import android.graphics.Canvas as BitmapCanvas
import android.graphics.Matrix
import android.graphics.Paint
import android.graphics.Rect as AndroidRect
import android.graphics.RectF
import android.graphics.drawable.BitmapDrawable
import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.animate
import androidx.compose.animation.core.spring
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.gestures.detectTransformGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.automirrored.outlined.RotateRight
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathFillType
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.clipPath
import androidx.compose.ui.graphics.drawscope.clipRect
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.CustomAccessibilityAction
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.customActions
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import coil.imageLoader
import coil.request.CachePolicy
import coil.request.ImageRequest
import coil.size.Scale
import io.faithform.app.design.FaithFormTokens
import io.faithform.app.design.LocalFaithFormTheme
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.ByteArrayOutputStream
import kotlin.math.max
import kotlin.math.roundToInt

// MARK: - Crop geometry

/**
 * The crop maths, kept out of the composable so it can be reasoned about — and
 * tested — without a screen.
 *
 * The model is the one the Photos app uses and that `benedom/SwiftyCrop`
 * writes down (https://github.com/benedom/SwiftyCrop), and it is the same model
 * the iOS editor runs, so a crop framed on a phone lands identically on a
 * tablet or on the other platform: the photo is laid out **aspect-fit** inside
 * the editor, a fixed mask sits centred on top, and [scale] starts at whatever
 * makes the photo just cover that mask. Pan is measured in **pixels** and
 * clamped to the overhang on each axis.
 *
 * The version this replaces stored pan as a fraction (-1..1) of the overhang.
 * At 1x the overhang on the fitting axis is *zero*, so that axis had nothing to
 * be a fraction of: the first pixel of a drag divided by ~0, slammed to the
 * limit, and the photo jumped to a corner.
 */
data class ProfileCrop(
    /** The photo as laid out on screen before zoom: aspect-fit, in pixels. */
    val imageSize: Size = Size.Zero,
    /** The crop window, centred in the same space. */
    val maskSize: Size = Size.Zero,
    /** 1 is not the floor — [minimumScale] is. */
    val scale: Float = 1f,
    /** Pan in pixels, positive meaning the photo moved right and down. */
    val offset: Offset = Offset.Zero,
) {
    /**
     * The smallest zoom that still covers the mask. Below it the crop would
     * include pixels the photo does not have, so it is the floor, not 1.
     */
    val minimumScale: Float
        get() = if (imageSize.width <= 0f || imageSize.height <= 0f) {
            1f
        } else {
            max(maskSize.width / imageSize.width, maskSize.height / imageSize.height)
        }

    /** Relative to the floor, so "6x" means the same detail whatever the shape. */
    val maximumScale: Float get() = minimumScale * 6f

    /** How far the photo may travel before an edge would enter the mask. */
    val panLimit: Offset
        get() = Offset(
            max(0f, (imageSize.width * scale - maskSize.width) / 2f),
            max(0f, (imageSize.height * scale - maskSize.height) / 2f),
        )

    /**
     * [scale] inside its range, then [offset] inside the overhang that scale
     * leaves. Order matters: zooming out shrinks the overhang, and the pan has
     * to follow it in or the mask shows a corner.
     */
    fun clamped(): ProfileCrop {
        val zoomed = copy(scale = scale.coerceIn(minimumScale, maximumScale))
        val limit = zoomed.panLimit
        return zoomed.copy(
            offset = Offset(
                zoomed.offset.x.coerceIn(-limit.x, limit.x),
                zoomed.offset.y.coerceIn(-limit.y, limit.y),
            ),
        )
    }

    /**
     * Where 0 is fully zoomed out and 1 fully in. Used by the double tap and by
     * the accessibility zoom actions.
     */
    val zoomFraction: Float
        get() {
            val span = maximumScale - minimumScale
            return if (span <= 0f) 0f else ((scale - minimumScale) / span).coerceIn(0f, 1f)
        }

    fun withZoomFraction(fraction: Float): ProfileCrop =
        copy(scale = minimumScale + (maximumScale - minimumScale) * fraction.coerceIn(0f, 1f))

    /**
     * Soft limits, for the length of a gesture only.
     *
     * The photo may be dragged past its edge and pinched below the floor, but
     * each further pixel of travel moves it less than the last, so it feels
     * tethered rather than stuck. [clamped] is what pulls it home when the
     * fingers lift, and the spring that runs it is what makes it read as
     * elastic rather than as a snap.
     */
    fun rubberBanded(): ProfileCrop {
        val zoomed = copy(scale = bandBetween(scale, minimumScale, maximumScale))
        val limit = zoomed.panLimit
        return zoomed.copy(
            offset = Offset(
                band(offset.x, limit.x, max(40f, maskSize.width * 0.3f)),
                band(offset.y, limit.y, max(40f, maskSize.height * 0.3f)),
            ),
        )
    }

    /** Linear blend, so the spring back can be run as one animated fraction. */
    fun lerpTo(target: ProfileCrop, fraction: Float): ProfileCrop = copy(
        scale = scale + (target.scale - scale) * fraction,
        offset = Offset(
            offset.x + (target.offset.x - offset.x) * fraction,
            offset.y + (target.offset.y - offset.y) * fraction,
        ),
    )


    /**
     * The region of the *original* photo the mask is showing, in its own pixels.
     *
     * `factor` converts screen pixels back to source pixels. Because the layout
     * was aspect-fit, width and height share one factor; taking the smaller of
     * the two is only defensive against a rounding difference.
     */
    fun cropRect(sourceWidth: Int, sourceHeight: Int): AndroidRect {
        if (imageSize.width <= 0f || imageSize.height <= 0f || scale <= 0f ||
            sourceWidth <= 0 || sourceHeight <= 0
        ) {
            return AndroidRect(0, 0, 0, 0)
        }
        val factor = minOf(sourceWidth / imageSize.width, sourceHeight / imageSize.height)
        val width = maskSize.width * factor / scale
        val height = maskSize.height * factor / scale
        val left = sourceWidth / 2f - width / 2f - offset.x * factor / scale
        val top = sourceHeight / 2f - height / 2f - offset.y * factor / scale

        // Rounded outward then trimmed to the bitmap: a rect a hair outside it
        // would make Bitmap.createBitmap throw rather than crop.
        val rect = AndroidRect(
            kotlin.math.floor(left).toInt(),
            kotlin.math.floor(top).toInt(),
            kotlin.math.ceil(left + width).toInt(),
            kotlin.math.ceil(top + height).toInt(),
        )
        return AndroidRect(
            rect.left.coerceIn(0, sourceWidth),
            rect.top.coerceIn(0, sourceHeight),
            rect.right.coerceIn(0, sourceWidth),
            rect.bottom.coerceIn(0, sourceHeight),
        )
    }

    companion object {
        /**
         * Asymptotic give: travel past [limit] approaches `limit + give` but
         * never reaches it, so there is always resistance and never a wall.
         */
        private fun band(value: Float, limit: Float, give: Float): Float {
            val overshoot = kotlin.math.abs(value) - limit
            if (overshoot <= 0f || give <= 0f) return value
            val damped = (1f - 1f / (overshoot / give + 1f)) * give
            return (if (value < 0f) -1f else 1f) * (limit + damped)
        }

        /** The same curve for zoom, bounded on both sides rather than around zero. */
        private fun bandBetween(value: Float, lower: Float, upper: Float): Float = when {
            value < lower -> lower - band(lower - value, 0f, lower * 0.35f)
            value > upper -> upper + band(value - upper, 0f, upper * 0.25f)
            else -> value
        }

        /**
         * Lays a photo out aspect-fit inside the editor and centres a mask of
         * [aspect] in it, leaving [inset] pixels of room for the controls that
         * float over the edges.
         */
        fun fitting(
            imageWidth: Int,
            imageHeight: Int,
            containerWidth: Float,
            containerHeight: Float,
            aspect: Float = 1f,
            inset: Float = 0f,
        ): ProfileCrop {
            if (imageWidth <= 0 || imageHeight <= 0 || containerWidth <= 0f || containerHeight <= 0f) {
                return ProfileCrop()
            }
            val fit = minOf(containerWidth / imageWidth, containerHeight / imageHeight)
            val imageSize = Size(imageWidth * fit, imageHeight * fit)

            val availableWidth = max(80f, containerWidth - inset * 2f)
            val availableHeight = max(80f, containerHeight - inset * 2f)
            val maskWidth = minOf(availableWidth, availableHeight * aspect)
            val maskSize = Size(maskWidth, maskWidth / aspect)

            return ProfileCrop(imageSize, maskSize, 1f, Offset.Zero).clamped()
        }
    }
}

// MARK: - Rendering

/** Square avatars are never shown larger than a header; a cover is a banner. */
private fun outputSize(aspect: Float): IntSize =
    if (aspect == 1f) IntSize(512, 512) else IntSize(1280, (1280f / aspect).roundToInt())

/**
 * Cuts [crop] out of [image] and encodes the JPEG that gets uploaded. Returns
 * null when the geometry has not been measured yet, rather than a blank square.
 *
 * [maxBytes] is honoured by stepping the quality down rather than by refusing
 * the photo. A 1280-wide cover at quality 90 can land over the server's budget,
 * and the old code answered that by silently reporting a save failure on a crop
 * that was perfectly fine.
 */
fun cropProfilePhoto(
    image: Bitmap,
    crop: ProfileCrop,
    aspect: Float = 1f,
    maxBytes: Int = 1_000_000,
): ByteArray? {
    val source = crop.clamped().cropRect(image.width, image.height)
    if (source.width() < 1 || source.height() < 1) return null

    val output = outputSize(aspect)
    val bitmap = Bitmap.createBitmap(output.width, output.height, Bitmap.Config.ARGB_8888)
    return try {
        BitmapCanvas(bitmap).apply {
            // Opaque output, so a photo with alpha lands on white, not black.
            drawColor(android.graphics.Color.WHITE)
            drawBitmap(
                image,
                source,
                RectF(0f, 0f, output.width.toFloat(), output.height.toFloat()),
                Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG),
            )
        }
        var encoded: ByteArray? = null
        for (quality in intArrayOf(90, 80, 70, 60, 45)) {
            encoded = ByteArrayOutputStream().use { stream ->
                check(bitmap.compress(Bitmap.CompressFormat.JPEG, quality, stream))
                stream.toByteArray()
            }
            if (encoded.size <= maxBytes) break
        }
        encoded
    } finally {
        bitmap.recycle()
    }
}

// MARK: - Picking

/**
 * The picker, and the editor it opens. [content] draws whatever opens it — on
 * the Account screen that is the avatar itself, not a row of buttons under it.
 */
@Composable
fun ProfilePhotoPicker(
    onSave: (ByteArray?, (String?) -> Unit) -> Unit,
    content: @Composable (open: () -> Unit, busy: Boolean, failed: Boolean) -> Unit,
) {
    val context = LocalContext.current
    var selectedUri by remember { mutableStateOf<String?>(null) }
    var bitmap by remember { mutableStateOf<Bitmap?>(null) }
    var loading by remember { mutableStateOf(false) }
    var failed by remember { mutableStateOf(false) }

    val picker = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri ->
        if (uri != null) {
            selectedUri = uri.toString()
            failed = false
        }
    }

    LaunchedEffect(selectedUri) {
        val uri = selectedUri ?: return@LaunchedEffect
        loading = true
        try {
            // Coil bounds decoding and applies EXIF orientation, including Android 8/9.
            val result = context.imageLoader.execute(
                ImageRequest.Builder(context)
                    .data(Uri.parse(uri)).size(2048).scale(Scale.FIT).allowHardware(false)
                    .memoryCachePolicy(CachePolicy.DISABLED).diskCachePolicy(CachePolicy.DISABLED).build(),
            )
            bitmap = (result.drawable as? BitmapDrawable)?.bitmap
            failed = bitmap == null
            if (failed) selectedUri = null
        } catch (error: Exception) {
            if (error is kotlinx.coroutines.CancellationException) throw error
            failed = true
            selectedUri = null
        } finally {
            loading = false
        }
    }

    content(
        {
            picker.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly))
        },
        loading,
        failed,
    )

    bitmap?.let { source ->
        key(selectedUri) {
            ProfilePhotoCropper(
                source = source,
                onDismiss = { bitmap = null; selectedUri = null },
                onSave = onSave,
            )
        }
    }
}

// MARK: - The editor

/**
 * Full-screen, black, and edge to edge: a photo editor, not a form.
 *
 * The photo fills the screen under floating controls, the mask is a hole cut in
 * a scrim rather than a framed thumbnail, and every adjustment is a gesture
 * first — drag to move, pinch to zoom, double tap to fill. Past an edge the
 * photo keeps following with resistance and springs back when the fingers lift,
 * so the limits are something you feel rather than hit.
 */
@Composable
fun ProfilePhotoCropper(
    source: Bitmap,
    onDismiss: () -> Unit,
    /**
     * Reports back `null` when it saved, and otherwise the sentence to show —
     * the server's own, rather than one generic line that hides whether the
     * photo was too large, the account inactive, or storage simply down.
     */
    onSave: (ByteArray?, (String?) -> Unit) -> Unit,
    aspect: Float = 1f,
    circular: Boolean = true,
    title: String = "Your photo",
    footnote: String = "Visible to people you meet in FaithForm.",
) {
    val theme = LocalFaithFormTheme.current
    var turns by remember { mutableStateOf(0) }
    val image = remember(source, turns) {
        if (turns == 0) {
            source
        } else {
            Bitmap.createBitmap(
                source, 0, 0, source.width, source.height,
                Matrix().apply { postRotate(turns * 90f) }, true,
            )
        }
    }

    var crop by remember(image) { mutableStateOf(ProfileCrop()) }
    var canvasSize by remember { mutableStateOf(Size.Zero) }
    var interacting by remember { mutableStateOf(false) }
    var working by remember { mutableStateOf(false) }
    var failure by remember { mutableStateOf<String?>(null) }
    var exporting by remember { mutableStateOf(false) }

    // Room for the floating bars, so the mask is never under one of them.
    val maskInset = with(androidx.compose.ui.platform.LocalDensity.current) { 34.dp.toPx() }

    fun relayout(size: Size) {
        canvasSize = size
        val fresh = ProfileCrop.fitting(image.width, image.height, size.width, size.height, aspect, maskInset)
        crop = if (crop.imageSize == Size.Zero) {
            fresh
        } else {
            // A resize keeps the person's zoom where it can survive.
            fresh.copy(scale = crop.scale, offset = crop.offset).clamped()
        }
    }

    // The fingers lift and the photo springs home. A spring rather than a
    // tween, because the overshoot on the way back is the half of the rubber
    // band that makes it read as elastic rather than as a snap.
    LaunchedEffect(interacting) {
        if (interacting) return@LaunchedEffect
        val from = crop
        val to = from.clamped()
        if (from == to) return@LaunchedEffect
        animate(
            initialValue = 0f,
            targetValue = 1f,
            animationSpec = spring(dampingRatio = 0.72f, stiffness = Spring.StiffnessMediumLow),
        ) { fraction, _ -> crop = from.lerpTo(to, fraction) }
    }

    LaunchedEffect(exporting) {
        if (!exporting) return@LaunchedEffect
        try {
            val snapshot = crop.clamped()
            val data = withContext(Dispatchers.Default) { cropProfilePhoto(image, snapshot, aspect) }
            if (data == null) {
                working = false
                failure = "That photo could not be prepared. Try another one."
            } else {
                onSave(data) { reason ->
                    working = false
                    if (reason == null) onDismiss() else failure = reason
                }
            }
        } catch (error: Exception) {
            if (error is kotlinx.coroutines.CancellationException) throw error
            working = false
            failure = "That photo could not be prepared. Try another one."
        } finally {
            exporting = false
        }
    }

    Dialog(
        onDismissRequest = { if (!working) onDismiss() },
        properties = DialogProperties(usePlatformDefaultWidth = false),
    ) {
        Box(Modifier.fillMaxSize().background(Color.Black)) {
            val currentCrop by rememberUpdatedState(crop)
            Canvas(
                Modifier
                    .fillMaxSize()
                    // Measured here, not inside the draw pass: writing the
                    // geometry while drawing schedules another frame to write
                    // it again, which is a loop on every resize.
                    .onSizeChanged { relayout(Size(it.width.toFloat(), it.height.toFloat())) }
                    // The slider is gone, so zoom and pan need another way in
                    // for anyone who cannot pinch. These are the way in.
                    .semantics {
                        contentDescription = "$title crop. Drag to move, pinch to zoom."
                        customActions = listOf(
                            CustomAccessibilityAction("Zoom in") {
                                crop = crop.withZoomFraction(crop.zoomFraction + 0.15f).clamped(); true
                            },
                            CustomAccessibilityAction("Zoom out") {
                                crop = crop.withZoomFraction(crop.zoomFraction - 0.15f).clamped(); true
                            },
                            CustomAccessibilityAction("Move photo left") {
                                crop = crop.copy(offset = crop.offset.copy(x = crop.offset.x - 60f)).clamped(); true
                            },
                            CustomAccessibilityAction("Move photo right") {
                                crop = crop.copy(offset = crop.offset.copy(x = crop.offset.x + 60f)).clamped(); true
                            },
                            CustomAccessibilityAction("Move photo up") {
                                crop = crop.copy(offset = crop.offset.copy(y = crop.offset.y - 60f)).clamped(); true
                            },
                            CustomAccessibilityAction("Move photo down") {
                                crop = crop.copy(offset = crop.offset.copy(y = crop.offset.y + 60f)).clamped(); true
                            },
                        )
                    }
                    .pointerInput(image, working) {
                        if (working) return@pointerInput
                        detectTapGestures(onDoubleTap = {
                            val next = currentCrop
                            crop = if (next.zoomFraction > 0.05f) {
                                next.copy(scale = next.minimumScale, offset = Offset.Zero).clamped()
                            } else {
                                next.copy(scale = next.minimumScale * 2f).clamped()
                            }
                        })
                    }
                    // Watches only for fingers down and up, consuming nothing,
                    // so the spring back knows when the gesture is over. The
                    // transform detector below never reports an end of its own.
                    .pointerInput(image, working) {
                        if (working) return@pointerInput
                        awaitEachGesture {
                            awaitFirstDown(requireUnconsumed = false)
                            interacting = true
                            do {
                                val event = awaitPointerEvent()
                            } while (event.changes.any { it.pressed })
                            interacting = false
                        }
                    }
                    .pointerInput(image, working) {
                        if (working) return@pointerInput
                        detectTransformGestures(
                            onGesture = { _, pan, zoom, _ ->
                                val start = currentCrop
                                val zoomed = start.copy(scale = start.scale * zoom).rubberBanded()
                                // Pan rides the zoom, so what is under the fingers
                                // stays put instead of sliding towards the centre.
                                val ratio = zoomed.scale / start.scale
                                // Soft while a finger is down: past the edge the
                                // photo keeps following, just less and less.
                                crop = zoomed.copy(
                                    offset = Offset(
                                        start.offset.x * ratio + pan.x,
                                        start.offset.y * ratio + pan.y,
                                    ),
                                ).rubberBanded()
                            },
                        )
                    },
            ) {
                val geometry = currentCrop
                if (geometry.imageSize == Size.Zero) return@Canvas

                val width = geometry.imageSize.width * geometry.scale
                val height = geometry.imageSize.height * geometry.scale
                clipRect {
                    drawImage(
                        image.asImageBitmap(),
                        dstOffset = IntOffset(
                            ((size.width - width) / 2f + geometry.offset.x).roundToInt(),
                            ((size.height - height) / 2f + geometry.offset.y).roundToInt(),
                        ),
                        dstSize = IntSize(width.roundToInt(), height.roundToInt()),
                    )
                    drawCropMask(geometry.maskSize, circular, interacting)
                }
            }

            // Floating chrome: scrims top and bottom so white controls stay
            // legible over a bright photo without plating the whole screen.
            Column(Modifier.fillMaxSize().safeDrawingPadding()) {
                CropperTopBar(
                    title = title,
                    enabled = !working,
                    onClose = onDismiss,
                    onRotate = {
                        turns = (turns + 1) % 4
                        crop = ProfileCrop()
                    },
                )
                Box(Modifier.weight(1f))
                CropperBottomBar(
                    failure = failure,
                    working = working,
                    footnote = footnote,
                    accent = theme.palette.brandAccent,
                    onAccent = theme.palette.brandPrimary,
                    onReset = {
                        crop = ProfileCrop.fitting(
                            image.width, image.height, canvasSize.width, canvasSize.height, aspect, maskInset,
                        )
                    },
                    onUse = {
                        working = true
                        failure = null
                        exporting = true
                    },
                )
            }
        }
    }
}

/**
 * The mask: a hole cut in a scrim, a hairline ring, and — only while a finger
 * is down — thirds guides inside it. Nothing frames the photo when it is still.
 */
private fun DrawScope.drawCropMask(maskSize: Size, circular: Boolean, showsGuides: Boolean) {
    if (maskSize.width <= 0f || maskSize.height <= 0f) return
    val rect = Rect(
        Offset((size.width - maskSize.width) / 2f, (size.height - maskSize.height) / 2f),
        maskSize,
    )
    val outline = Path().apply {
        if (circular) addOval(rect) else addRoundRect(roundedMask(rect))
    }
    val scrim = Path().apply {
        fillType = PathFillType.EvenOdd
        addRect(Rect(Offset.Zero, size))
        addPath(outline)
    }
    drawPath(scrim, Color.Black.copy(alpha = 0.66f))
    drawPath(outline, Color.White.copy(alpha = 0.9f), style = Stroke(1.5.dp.toPx()))

    if (showsGuides) {
        clipPath(outline) {
            for (step in 1..2) {
                val fraction = step / 3f
                drawLine(
                    Color.White.copy(alpha = 0.4f),
                    Offset(rect.left, rect.top + rect.height * fraction),
                    Offset(rect.right, rect.top + rect.height * fraction),
                    strokeWidth = 1f,
                )
                drawLine(
                    Color.White.copy(alpha = 0.4f),
                    Offset(rect.left + rect.width * fraction, rect.top),
                    Offset(rect.left + rect.width * fraction, rect.bottom),
                    strokeWidth = 1f,
                )
            }
        }
    }
}

private fun DrawScope.roundedMask(rect: Rect) =
    androidx.compose.ui.geometry.RoundRect(rect, androidx.compose.ui.geometry.CornerRadius(14.dp.toPx()))

@Composable
private fun CropperTopBar(title: String, enabled: Boolean, onClose: () -> Unit, onRotate: () -> Unit) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .background(Brush.verticalGradient(listOf(Color.Black.copy(alpha = 0.72f), Color.Transparent)))
            .padding(horizontal = 12.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        GlassIconButton(Icons.Outlined.Close, "Cancel", enabled, onClose)
        Column(Modifier.weight(1f), horizontalAlignment = Alignment.CenterHorizontally) {
            Text(title, style = MaterialTheme.typography.titleSmall, color = Color.White)
            Text(
                "Drag to move · pinch to zoom",
                style = MaterialTheme.typography.labelSmall,
                color = Color.White.copy(alpha = 0.62f),
            )
        }
        GlassIconButton(Icons.AutoMirrored.Outlined.RotateRight, "Rotate 90 degrees", enabled, onRotate)
    }
}

@Composable
private fun CropperBottomBar(
    failure: String?,
    working: Boolean,
    footnote: String,
    accent: Color,
    onAccent: Color,
    onReset: () -> Unit,
    onUse: () -> Unit,
) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .background(Brush.verticalGradient(listOf(Color.Transparent, Color.Black.copy(alpha = 0.82f))))
            .padding(horizontal = 20.dp)
            .padding(top = 28.dp, bottom = 14.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        AnimatedVisibility(failure != null, enter = fadeIn(), exit = fadeOut()) {
            Text(
                failure.orEmpty(),
                style = MaterialTheme.typography.bodySmall,
                color = Color.White,
                modifier = Modifier
                    .background(Color(0xFFB3261E), RoundedCornerShape(FaithFormTokens.Radius.md))
                    .padding(horizontal = 14.dp, vertical = 10.dp)
                    .semantics { liveRegion = LiveRegionMode.Assertive },
            )
        }

        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            TextButton(
                onClick = onReset,
                enabled = !working,
                modifier = Modifier
                    .background(Color.White.copy(alpha = 0.14f), RoundedCornerShape(FaithFormTokens.Radius.pill))
                    .heightIn(min = FaithFormTokens.TouchTarget.minimum),
            ) { Text("Reset", color = Color.White) }

            Button(
                onClick = onUse,
                enabled = !working,
                shape = RoundedCornerShape(FaithFormTokens.Radius.pill),
                colors = ButtonDefaults.buttonColors(containerColor = accent, contentColor = onAccent),
                modifier = Modifier.weight(1f).heightIn(min = FaithFormTokens.TouchTarget.recommended),
            ) {
                Row(
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    if (working) {
                        CircularProgressIndicator(
                            strokeWidth = 2.dp,
                            color = onAccent,
                            modifier = Modifier.size(FaithFormTokens.IconSize.sizeMedium),
                        )
                    }
                    Text(if (working) "Saving…" else "Use photo")
                }
            }
        }

        Text(
            footnote,
            style = MaterialTheme.typography.labelSmall,
            color = Color.White.copy(alpha = 0.55f),
        )
    }
}

/** A round, frosted button — legible over any photo without a solid plate. */
@Composable
private fun GlassIconButton(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    label: String,
    enabled: Boolean,
    onClick: () -> Unit,
) {
    IconButton(
        onClick = onClick,
        enabled = enabled,
        modifier = Modifier
            .size(FaithFormTokens.TouchTarget.minimum)
            .clip(CircleShape)
            .background(Color.White.copy(alpha = 0.16f))
            .border(1.dp, Color.White.copy(alpha = 0.18f), CircleShape),
    ) {
        Icon(icon, contentDescription = label, tint = Color.White)
    }
}
