package io.faithform.faithful.sermons

import io.faithform.faithful.contract.SermonListItem
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class SermonUiStateTest {

    private fun item(id: String) = SermonListItem(
        sermonId = id,
        title = "The Prodigal Son",
        summary = null,
        publishedAt = "2026-08-24T14:03:00Z",
        preachedOn = "2026-08-23",
        scriptureRefs = listOf("Luke 15:11-32"),
        seriesName = "Parables",
        publicationVersion = 1,
        churchSlug = "grace-chapel",
        churchName = "Grace Chapel",
        churchTimezone = "America/New_York",
    )

    @Test
    fun `a church that published nothing is not a search that found nothing`() {
        val published = SermonScreenState(phase = SermonListPhase.Loaded(emptyList()))
        assertTrue(published.showsEmptyState)
        assertFalse(published.emptyIsSearch)

        val searched = published.copy(searchTerm = "grace")
        assertTrue(searched.showsEmptyState)
        assertTrue(searched.emptyIsSearch)
    }

    @Test
    fun `a loading screen shows no empty state`() {
        // Otherwise every cold open flashes "nothing here" before its first page.
        assertFalse(SermonScreenState(phase = SermonListPhase.Loading).showsEmptyState)
        assertFalse(SermonScreenState(phase = SermonListPhase.Idle).showsEmptyState)
    }

    @Test
    fun `another page is only requested for a list that already loaded`() {
        assertFalse(
            SermonScreenState(phase = SermonListPhase.Loading, hasMore = true).canLoadMore,
        )
        assertTrue(
            SermonScreenState(
                phase = SermonListPhase.Loaded(listOf(item("a"))),
                hasMore = true,
            ).canLoadMore,
        )
    }

    @Test
    fun `a page already in flight is not requested twice`() {
        val state = SermonScreenState(
            phase = SermonListPhase.Loaded(listOf(item("a"))),
            hasMore = true,
            isLoadingMore = true,
        )
        assertFalse(state.canLoadMore)
    }

    @Test
    fun `not_found is indistinguishable from blocked, by design`() {
        // The server answers the same for a hidden church, an unknown slug and
        // a blocked visitor. A client that told them apart would be an oracle.
        assertEquals(SermonListPhase.Blocked, sermonListPhaseFor("not_found", ""))
        assertEquals(SermonListPhase.Blocked, sermonListPhaseFor("blocked", ""))
        assertEquals(SermonListPhase.Blocked, sermonListPhaseFor("forbidden", ""))
    }

    @Test
    fun `a sermon taken down after the list was cached reads as unavailable`() {
        assertEquals(SermonDetailPhase.Unavailable, sermonDetailPhaseFor("not_found", ""))
        assertEquals(SermonDetailPhase.Offline, sermonDetailPhaseFor("unavailable", ""))
    }

    @Test
    fun `an unrecognised failure keeps its message rather than being swallowed`() {
        val phase = sermonListPhaseFor("teapot", "Something specific went wrong")
        assertEquals(SermonListPhase.Failed("Something specific went wrong"), phase)
    }
}
