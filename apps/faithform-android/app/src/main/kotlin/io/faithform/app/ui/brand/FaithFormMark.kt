package io.faithform.app.ui.brand

import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawWithCache
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import io.faithform.app.design.LocalFaithFormTheme

/**
 * The FaithForm mark: the F with the gold fold.
 *
 * ## Why drawn, not an image
 *
 * The only raster of the logo is a flattened square on an off-white ground. On
 * the app's own background it shows as a pale box, and in dark mode as a bright
 * one. Drawing the two shapes gives a mark with no box at all, sharp at any
 * size, whose F can follow the palette. No bitmap is ever made.
 *
 * The outlines are the ones the adaptive launcher icon uses
 * (`ic_launcher_foreground.xml`), and the iPhone's `FaithFormMark` draws the
 * same points, so every surface shows the identical mark.
 *
 * ## Why the F follows `contentPrimary`
 *
 * Navy on the dark theme's navy background would disappear. `contentPrimary` is
 * the brand navy in light mode and the warm off-white in dark mode, which keeps
 * the F legible in both while the gold fold stays gold everywhere.
 *
 * Size it by height; the width follows the mark's own proportions. Decorative:
 * it carries no semantics, so whatever places it says what it means.
 */
@Composable
fun FaithFormMark(
    modifier: Modifier = Modifier,
    letterColor: Color = LocalFaithFormTheme.current.palette.contentPrimary,
) {
    Spacer(
        modifier
            .aspectRatio(FaithFormMarkGeometry.ASPECT_RATIO, matchHeightConstraintsFirst = true)
            .drawWithCache {
                val letter = FaithFormMarkGeometry.fit(FaithFormMarkGeometry.LETTER, size.width, size.height).toPath()
                val fold = FaithFormMarkGeometry.fit(FaithFormMarkGeometry.FOLD, size.width, size.height).toPath()
                // The fold's own extent, top edge to point — the same span the
                // launcher icon's gradient and the iOS launch image use.
                val foldBrush = Brush.verticalGradient(
                    colors = listOf(FaithFormMarkGeometry.FOLD_TOP, FaithFormMarkGeometry.FOLD_POINT),
                    startY = FaithFormMarkGeometry.fitY(FaithFormMarkGeometry.FOLD_TOP_Y, size.width, size.height),
                    endY = FaithFormMarkGeometry.fitY(FaithFormMarkGeometry.FOLD_POINT_Y, size.width, size.height),
                )
                onDrawBehind {
                    drawPath(letter, letterColor)
                    drawPath(fold, foldBrush)
                }
            }
    )
}

private fun FloatArray.toPath(): Path = Path().apply {
    moveTo(this@toPath[0], this@toPath[1])
    for (i in 2 until this@toPath.size step 2) lineTo(this@toPath[i], this@toPath[i + 1])
    close()
}

/**
 * The mark's two outlines as numbers, apart from any drawing API so the fitting
 * is testable on the JVM.
 *
 * Coordinates are pixels in the icon artwork's 1024 square, exactly as they
 * appear in `ic_launcher_foreground.xml`. [fit] crops away the icon's padding —
 * a mark set in a layout should not carry it — and scales into a box without
 * distortion, centred when the box is not the mark's shape.
 */
internal object FaithFormMarkGeometry {
    /** The mark's extent inside the 1024-pixel artwork. */
    const val MIN_X = 321f
    const val MIN_Y = 277f
    const val WIDTH = 367f
    const val HEIGHT = 425f
    const val ASPECT_RATIO = WIDTH / HEIGHT

    /** x, y pairs; one closed polygon each. */
    val LETTER = floatArrayOf(
        409f, 277f, 688f, 277f, 688f, 373f, 465f, 373f, 418f, 420f, 418f, 440f,
        595f, 440f, 498f, 537f, 418f, 537f, 418f, 702f, 321f, 702f, 321f, 365f,
    )
    val FOLD = floatArrayOf(
        465f, 373f, 688f, 373f, 688f, 431f, 421f, 698f, 418f, 698f, 418f, 537f,
        498f, 537f, 595f, 440f, 418f, 440f, 418f, 420f,
    )

    /** Sampled from the icon artwork: the fold's top edge and its point. */
    val FOLD_TOP = Color(0xFFEEC683)
    val FOLD_POINT = Color(0xFFB88A46)
    const val FOLD_TOP_Y = 373f
    const val FOLD_POINT_Y = 698f

    private fun scale(width: Float, height: Float) = minOf(width / WIDTH, height / HEIGHT)

    /** Artwork x, y pairs mapped into a [width] × [height] box. */
    fun fit(points: FloatArray, width: Float, height: Float): FloatArray {
        val scale = scale(width, height)
        val originX = (width - WIDTH * scale) / 2
        val originY = (height - HEIGHT * scale) / 2
        return FloatArray(points.size) { i ->
            if (i % 2 == 0) originX + (points[i] - MIN_X) * scale
            else originY + (points[i] - MIN_Y) * scale
        }
    }

    /** One artwork y mapped into the same box, for the gradient's ends. */
    fun fitY(y: Float, width: Float, height: Float): Float {
        val scale = scale(width, height)
        return (height - HEIGHT * scale) / 2 + (y - MIN_Y) * scale
    }
}
