package io.faithform.app.sermons

import io.faithform.app.contract.PresentationPage

/** Display-only pagination: the published manifest remains authoritative. */
object PresentationReadingPages {
    fun expand(pages: List<PresentationPage>): List<PresentationPage> = pages.flatMap { page ->
        val body = page.body
        if (page.kind != "scripture" || body == null) listOf(page) else {
            val marked = Regex("[\\[(]\\d+[\\])]").findAll(body).toList()
            val starts = if (marked.size > 1 && body.substring(0, marked.first().range.first).isBlank())
                marked.map { it.range.first } else plainVerseStarts(body, page.scripture.orEmpty())
            if (starts.size < 2) listOf(page) else starts.mapIndexed { index, start ->
                val end = starts.getOrNull(index + 1) ?: body.length
                page.copy(id = "${page.id}:verse:$index", body = body.substring(start, end).trim())
            }
        }
    }

    private fun plainVerseStarts(body: String, reference: String): List<Int> {
        val range = Regex(":(\\d+)[–-](\\d+)\\s*$").find(reference) ?: return emptyList()
        val from = range.groupValues[1].toIntOrNull() ?: return emptyList()
        val to = range.groupValues[2].toIntOrNull() ?: return emptyList()
        if (to <= from || to - from >= 64 || (from > 1 && !body.startsWith("$from "))) return emptyList()
        val starts = mutableListOf(0)
        for (number in (from + 1)..to) {
            val found = Regex("(?<=\\s)$number\\s+").findAll(body).toList()
            if (found.size != 1 || found.first().range.first <= starts.last()) return emptyList()
            starts.add(found.first().range.first)
        }
        return starts
    }
}
