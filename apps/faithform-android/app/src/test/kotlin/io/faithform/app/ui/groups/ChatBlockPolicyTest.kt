package io.faithform.app.ui.groups

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ChatBlockPolicyTest {
    @Test fun `blocked authors are masked including quotes and previews`() {
        assertTrue(ChatBlockPolicy.hides("blocked", "me", setOf("blocked")))
        assertFalse(ChatBlockPolicy.hides("friend", "me", setOf("blocked")))
    }

    @Test fun `own messages and empty previews stay visible`() {
        assertFalse(ChatBlockPolicy.hides("me", "me", setOf("me")))
        assertFalse(ChatBlockPolicy.hides(null, "me", setOf("blocked")))
    }

    @Test fun `unblocking or changing account partition restores visibility`() {
        assertFalse(ChatBlockPolicy.hides("blocked", "me", emptySet()))
    }
}
