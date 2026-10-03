package io.faithform.app.navigation

import java.net.URI
import java.net.URLDecoder
import java.net.URLEncoder

/** A provider channel id is a routing hint, never authorization. */
object ChatNotificationLink {
    private val channel = Regex("^(ff_group|ff_dm):[a-z0-9_]{1,64}$")
    fun make(cid: String): String? = cid.takeIf(channel::matches)?.let {
        "faithform://messages?cid=${URLEncoder.encode(it, "UTF-8")}" }
    fun parse(raw: String): String? = runCatching {
        val uri = URI(raw)
        if (uri.scheme != "faithform" || uri.host != "messages" || !uri.path.isNullOrEmpty() || uri.fragment != null) return null
        val values = uri.rawQuery.orEmpty().split('&').filter { it.substringBefore('=') == "cid" }
        if (values.size != 1) return null
        URLDecoder.decode(values.single().substringAfter('=', ""), "UTF-8").takeIf(channel::matches)
    }.getOrNull()
}
