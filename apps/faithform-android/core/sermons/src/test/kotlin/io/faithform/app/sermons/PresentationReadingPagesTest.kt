package io.faithform.app.sermons

import io.faithform.app.contract.PresentationPage
import org.junit.Assert.assertEquals
import org.junit.Test

class PresentationReadingPagesTest {
    @Test fun `verses paginate without changing non scripture pages`() {
        val source = PresentationPage("source", "scripture", body = "[1] First verse. [2] Second verse.", scripture = "John 1:1–2", readingOrder = listOf("scripture", "body"))
        val result = PresentationReadingPages.expand(listOf(source))
        assertEquals(listOf("[1] First verse.", "[2] Second verse."), result.map { it.body })
        assertEquals(listOf("source:verse:0", "source:verse:1"), result.map { it.id })
        assertEquals(listOf(source.scripture, source.scripture), result.map { it.scripture })
        val note = source.copy(kind = "content")
        assertEquals(listOf(note), PresentationReadingPages.expand(listOf(note)))
    }
    @Test fun `simple manifests use reference bounded plain markers`() {
        val source = PresentationPage("simple", "scripture", body = "In the beginning. 2 The earth was without form. 3 God said, Let there be light.", scripture = "Genesis 1:1–3", readingOrder = listOf("body"))
        assertEquals(listOf("In the beginning.", "2 The earth was without form.", "3 God said, Let there be light."), PresentationReadingPages.expand(listOf(source)).map { it.body })
        val prose = source.copy(body = "He fasted 40 days. 2 Then he returned.", scripture = "Luke 4:1–2")
        assertEquals(2, PresentationReadingPages.expand(listOf(prose)).size)
        val ambiguous = prose.copy(body = "He had 2 sons. 2 Then he returned.")
        assertEquals(listOf(ambiguous), PresentationReadingPages.expand(listOf(ambiguous)))
    }

}
