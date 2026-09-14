package io.faithform.app.ui.brand

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Test
import java.io.File

/**
 * The drawn mark, as numbers.
 *
 * Plain JUnit: the fitting is arithmetic, and the parity with the launcher icon
 * is read from the resource that ships.
 */
class FaithFormMarkTest {

    private val all = FaithFormMarkGeometry.LETTER + FaithFormMarkGeometry.FOLD
    private fun xs(points: FloatArray) = points.filterIndexed { i, _ -> i % 2 == 0 }
    private fun ys(points: FloatArray) = points.filterIndexed { i, _ -> i % 2 == 1 }

    @Test
    fun `the declared bounds are exactly the extent of the two outlines`() {
        // A bound wider than the outlines would pad the mark inside its box; a
        // narrower one would clip it.
        assertEquals(FaithFormMarkGeometry.MIN_X, xs(all).min())
        assertEquals(FaithFormMarkGeometry.MIN_Y, ys(all).min())
        assertEquals(FaithFormMarkGeometry.MIN_X + FaithFormMarkGeometry.WIDTH, xs(all).max())
        assertEquals(FaithFormMarkGeometry.MIN_Y + FaithFormMarkGeometry.HEIGHT, ys(all).max())
    }

    @Test
    fun `a box of the mark's own shape is filled edge to edge`() {
        val height = 96f
        val width = height * FaithFormMarkGeometry.ASPECT_RATIO
        val fitted = FaithFormMarkGeometry.fit(all, width, height)

        assertEquals(0f, xs(fitted).min(), 0.001f)
        assertEquals(0f, ys(fitted).min(), 0.001f)
        assertEquals(width, xs(fitted).max(), 0.001f)
        assertEquals(height, ys(fitted).max(), 0.001f)
    }

    @Test
    fun `a box of another shape keeps the proportions and centres the mark`() {
        // Twice as wide as needed: full height, centred horizontally.
        val wide = FaithFormMarkGeometry.fit(all, 400f, 100f)
        val markWidth = 100f * FaithFormMarkGeometry.ASPECT_RATIO
        assertEquals(0f, ys(wide).min(), 0.001f)
        assertEquals(100f, ys(wide).max(), 0.001f)
        assertEquals((400f - markWidth) / 2, xs(wide).min(), 0.001f)
        assertEquals((400f + markWidth) / 2, xs(wide).max(), 0.001f)

        // Taller than needed: full width, centred vertically.
        val tall = FaithFormMarkGeometry.fit(all, 100f, 400f)
        val markHeight = 100f / FaithFormMarkGeometry.ASPECT_RATIO
        assertEquals(0f, xs(tall).min(), 0.001f)
        assertEquals(100f, xs(tall).max(), 0.001f)
        assertEquals((400f - markHeight) / 2, ys(tall).min(), 0.001f)
        assertEquals((400f + markHeight) / 2, ys(tall).max(), 0.001f)
    }

    @Test
    fun `the gradient ends land on the fold's own top edge and point`() {
        val fold = FaithFormMarkGeometry.fit(FaithFormMarkGeometry.FOLD, 83f, 96f)
        assertEquals(ys(fold).min(), FaithFormMarkGeometry.fitY(FaithFormMarkGeometry.FOLD_TOP_Y, 83f, 96f), 0.001f)
        assertEquals(ys(fold).max(), FaithFormMarkGeometry.fitY(FaithFormMarkGeometry.FOLD_POINT_Y, 83f, 96f), 0.001f)
    }

    @Test
    fun `the drawn mark is the launcher icon's mark, point for point`() {
        val icon = File("src/main/res/drawable/ic_launcher_foreground.xml").readText()
        val paths = pathData(icon)
        assertEquals(2, paths.size)
        assertArrayEquals(FaithFormMarkGeometry.LETTER, paths[0], 0f)
        assertArrayEquals(FaithFormMarkGeometry.FOLD, paths[1], 0f)
    }

    companion object {
        /** Every `android:pathData` of absolute M/L commands, as x, y pairs. */
        fun pathData(xml: String): List<FloatArray> =
            Regex("""android:pathData="([^"]+)"""").findAll(xml).map { match ->
                Regex("""-?\d+(?:\.\d+)?""").findAll(match.groupValues[1])
                    .map { it.value.toFloat() }
                    .toList()
                    .toFloatArray()
            }.toList()
    }
}
