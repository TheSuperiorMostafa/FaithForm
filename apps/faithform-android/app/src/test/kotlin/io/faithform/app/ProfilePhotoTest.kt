package io.faithform.app

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import io.faithform.app.ui.account.ProfileCrop
import io.faithform.app.ui.account.cropProfilePhoto
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = android.app.Application::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class ProfilePhotoTest {

    // region Geometry

    @Test fun `a fresh crop covers the mask and starts centred`() {
        // A wide photo in a tall editor: the fit leaves it shorter than a square
        // mask, so the opening zoom has to be above 1 to cover it.
        val crop = ProfileCrop.fitting(2000, 600, 1080f, 1900f, aspect = 1f, inset = 90f)
        assertEquals(Offset.Zero, crop.offset)
        assertEquals(crop.minimumScale, crop.scale, 0.0001f)
        assertTrue(crop.imageSize.width * crop.scale >= crop.maskSize.width - 0.01f)
        assertTrue(crop.imageSize.height * crop.scale >= crop.maskSize.height - 0.01f)
    }

    @Test fun `pan is clamped to the overhang, never past an edge`() {
        val crop = ProfileCrop(
            imageSize = Size(400f, 200f),
            maskSize = Size(200f, 200f),
            scale = 1f,
            offset = Offset(9000f, 9000f),
        ).clamped()
        // 100px of slack across, none at all vertically: the photo is exactly as
        // tall as the mask. The old model divided by that zero.
        assertEquals(100f, crop.offset.x, 0.0001f)
        assertEquals(0f, crop.offset.y, 0.0001f)
    }

    @Test fun `zooming out pulls an extreme pan back inside the photo`() {
        // Floor 0.5x, so the ceiling is 3x and a request for 4x lands there:
        // 400 * 3 = 1200 wide against a 200 mask leaves 500 of slack.
        var crop = ProfileCrop(
            imageSize = Size(400f, 400f),
            maskSize = Size(200f, 200f),
            scale = 4f,
            offset = Offset(900f, 900f),
        ).clamped()
        assertEquals(3f, crop.scale, 0.0001f)
        assertEquals(500f, crop.offset.x, 0.0001f)

        crop = crop.copy(scale = 1f).clamped()
        assertEquals(100f, crop.offset.x, 0.0001f)
        assertEquals(100f, crop.offset.y, 0.0001f)
    }

    @Test fun `the rubber band gives past the edge but never runs free`() {
        val base = ProfileCrop(
            imageSize = Size(400f, 200f),
            maskSize = Size(200f, 200f),
            scale = 1f,
            offset = Offset(300f, 0f),
        )
        val banded = base.rubberBanded()
        // Past the 100px limit it keeps moving, but nowhere near the 300 asked
        // for, and always further out than the hard clamp would allow.
        assertTrue(banded.offset.x > 100f)
        assertTrue(banded.offset.x < 200f)

        // Twice as far past the edge does not move it twice as far.
        val harder = base.copy(offset = Offset(600f, 0f)).rubberBanded()
        assertTrue(harder.offset.x > banded.offset.x)
        assertTrue(harder.offset.x - 100f < (banded.offset.x - 100f) * 2f)

        // And letting go puts it back exactly on the edge.
        assertEquals(100f, banded.clamped().offset.x, 0.0001f)
    }

    @Test fun `a pinch below the floor gives, and springs back to it`() {
        val base = ProfileCrop(
            imageSize = Size(400f, 400f),
            maskSize = Size(200f, 200f),
            scale = 0.2f,
            offset = Offset.Zero,
        )
        val banded = base.rubberBanded()
        assertTrue(banded.scale < base.minimumScale)
        assertTrue(banded.scale > base.minimumScale * 0.6f)
        assertEquals(base.minimumScale, banded.clamped().scale, 0.0001f)
    }

    @Test fun `the spring back interpolates all the way home`() {
        val from = ProfileCrop(
            imageSize = Size(400f, 200f),
            maskSize = Size(200f, 200f),
            scale = 1f,
            offset = Offset(160f, 0f),
        )
        val to = from.clamped()
        assertEquals(from.offset.x, from.lerpTo(to, 0f).offset.x, 0.0001f)
        assertEquals(to.offset.x, from.lerpTo(to, 1f).offset.x, 0.0001f)
        assertTrue(from.lerpTo(to, 0.5f).offset.x in 100f..160f)
    }

    // endregion

    // region Rendering

    @Test fun `dragging right selects the left side and the output is 512 pixels`() {
        val image = Bitmap.createBitmap(1024, 512, Bitmap.Config.ARGB_8888)
        Canvas(image).apply {
            drawColor(Color.RED)
            drawRect(512f, 0f, 1024f, 512f, Paint().apply { color = Color.BLUE })
        }
        // 400x200 on screen, a 200px square mask: 100px of slack each way.
        val base = ProfileCrop(
            imageSize = Size(400f, 200f),
            maskSize = Size(200f, 200f),
            scale = 1f,
            offset = Offset.Zero,
        )

        for ((pan, expectsRed) in listOf(100f to true, -100f to false)) {
            val bytes = cropProfilePhoto(image, base.copy(offset = Offset(pan, 0f)).clamped())!!
            val crop = BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
            assertEquals(512, crop.width)
            assertEquals(512, crop.height)
            val color = crop.getPixel(256, 256)
            if (expectsRed) {
                assertTrue(Color.red(color) > 240 && Color.blue(color) < 15)
            } else {
                assertTrue(Color.blue(color) > 240 && Color.red(color) < 15)
            }
        }
    }

    @Test fun `every clamped extreme stays inside the photo`() {
        val image = Bitmap.createBitmap(300, 900, Bitmap.Config.ARGB_8888).apply { eraseColor(Color.GREEN) }
        val base = ProfileCrop(
            imageSize = Size(120f, 360f),
            maskSize = Size(120f, 120f),
            scale = 4f,
            offset = Offset.Zero,
        )
        for (x in listOf(-5000f, 5000f)) {
            for (y in listOf(-5000f, 5000f)) {
                val bytes = cropProfilePhoto(image, base.copy(offset = Offset(x, y)).clamped())!!
                val crop = BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
                for ((px, py) in listOf(0 to 0, 511 to 0, 0 to 511, 511 to 511)) {
                    val color = crop.getPixel(px, py)
                    assertTrue(Color.green(color) > 240 && Color.red(color) < 15)
                }
            }
        }
    }

    @Test fun `cover crops keep their wide aspect ratio and fit the upload budget`() {
        val image = Bitmap.createBitmap(1200, 1600, Bitmap.Config.ARGB_8888).apply { eraseColor(Color.GREEN) }
        val crop = ProfileCrop.fitting(1200, 1600, 1080f, 1900f, aspect = 16f / 9f, inset = 90f)
        val bytes = cropProfilePhoto(image, crop, aspect = 16f / 9f)!!
        val output = BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
        assertEquals(1280, output.width)
        assertEquals(720, output.height)
        assertTrue(bytes.size <= 1_000_000)
    }

    @Test fun `a crop with no geometry yet renders nothing rather than a blank square`() {
        val image = Bitmap.createBitmap(100, 100, Bitmap.Config.ARGB_8888).apply { eraseColor(Color.GREEN) }
        assertNull(cropProfilePhoto(image, ProfileCrop()))
    }

    // endregion
}
