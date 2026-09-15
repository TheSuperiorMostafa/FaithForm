package io.faithform.app.sermons

import io.faithform.app.contract.PresentationListItem
import io.faithform.app.contract.SermonListItem
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class SermonHubTest {

    private fun notes(id: String, preachedOn: String = "2026-09-13") = SermonListItem(
        sermonId = id,
        title = "Sermon $id",
        summary = null,
        publishedAt = "2026-09-13T14:03:22Z",
        preachedOn = preachedOn,
        scriptureRefs = emptyList(),
        seriesName = null,
        publicationVersion = 1,
        churchSlug = "grace",
        churchName = "Grace Chapel",
        churchTimezone = "America/Chicago",
    )

    private fun slides(id: String, sermonId: String) = PresentationListItem(
        presentationId = id,
        sermonId = sermonId,
        version = 1,
        title = "Deck $id",
        publishedAt = "2026-09-13T15:00:00Z",
        pageCount = 8,
        contentHash = "h",
        scriptureRefs = emptyList(),
        seriesName = null,
        churchSlug = "grace",
        churchName = "Grace Chapel",
        churchTimezone = "America/Chicago",
    )

    @Test
    fun `notes and slides for the same sermon become one row`() {
        val hubs = SermonHub.merge(notes = listOf(notes("a")), slides = listOf(slides("p1", "a")))
        assertEquals(1, hubs.size)
        assertTrue(hubs[0].hasNotes)
        assertTrue(hubs[0].hasSlides)
        assertEquals("p1", hubs[0].slides?.presentationId)
    }

    @Test
    fun `a deck without notes still appears`() {
        val hubs = SermonHub.merge(notes = emptyList(), slides = listOf(slides("p2", "b")))
        assertEquals(listOf("b"), hubs.map { it.sermonId })
        assertFalse(hubs[0].hasNotes)
        assertTrue(hubs[0].hasSlides)
    }
}
