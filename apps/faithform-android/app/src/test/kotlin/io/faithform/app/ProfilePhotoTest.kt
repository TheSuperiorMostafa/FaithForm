package io.faithform.app

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
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
    @Test fun cropUsesTheSamePanDirectionAsPreviewAndFillsTheSquare() {
        val image = Bitmap.createBitmap(1024, 512, Bitmap.Config.ARGB_8888)
        Canvas(image).apply {
            drawColor(Color.RED)
            drawRect(512f, 0f, 1024f, 512f, Paint().apply { color = Color.BLUE })
        }
        // Dragging the image right brings its LEFT half into the crop window.
        for ((position, red) in listOf(1f to true, -1f to false)) {
            val bytes = cropProfilePhoto(image, 1f, position, 0f)
            val crop = BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
            assertEquals(512, crop.width); assertEquals(512, crop.height)
            for ((px, py) in listOf(10 to 10, 256 to 256, 500 to 500)) {
                val color = crop.getPixel(px, py)
                if (red) assertTrue(Color.red(color) > 240 && Color.blue(color) < 15)
                else assertTrue(Color.blue(color) > 240 && Color.red(color) < 15)
            }
        }
    }

    @Test fun extremeZoomAndPanNeverExposeEmptyPixels() {
        val image = Bitmap.createBitmap(300, 900, Bitmap.Config.ARGB_8888).apply { eraseColor(Color.GREEN) }
        for (x in listOf(-1f, 1f)) for (y in listOf(-1f, 1f)) {
            val bytes = cropProfilePhoto(image, 4f, x, y)
            val crop = BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
            for ((px, py) in listOf(0 to 0, 511 to 0, 0 to 511, 511 to 511)) {
                val color = crop.getPixel(px, py)
                assertTrue(Color.green(color) > 240 && Color.red(color) < 15)
            }
        }
    }
}
