package io.faithform.app.navigation

import org.junit.Assert.*
import org.junit.Test

class ChatNotificationLinkTest {
    @Test fun `provider channel hints round trip without becoming authorization`() {
        val cid = "ff_group:grp_1234567890abcdef1234567890abcdef"
        assertEquals(cid, ChatNotificationLink.parse(requireNotNull(ChatNotificationLink.make(cid))))
        assertEquals("ff_dm:dm_abc", ChatNotificationLink.parse("faithform://messages?cid=ff_dm%3Adm_abc"))
    }
    @Test fun `foreign schemes malformed ids and ambiguous queries are ignored`() {
        listOf("https://messages?cid=ff_dm%3Adm_abc", "faithform://messages?cid=ff_dm%3Adm_abc&cid=ff_dm%3Adm_other",
            "faithform://messages?cid=messaging%3Aother", "faithform://messages/other?cid=ff_dm%3Adm_abc",
            "faithform://messages?cid=%", "faithform://messages?cid=ff_dm%3Adm_abc#other").forEach { assertNull(it, ChatNotificationLink.parse(it)) }
        assertNull(ChatNotificationLink.make("ff_group:../../private"))
    }
}
