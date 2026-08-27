package io.faithform.faithful.navigation

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * An invitation is a credential, not a destination — parsed by its own rule,
 * failing closed like every other link.
 */
class InvitationLinkTest {

    private val token = "a".repeat(32)

    @Test
    fun `a well-formed invite link yields its token`() {
        assertEquals(token, InvitationLink.token("faithful://invite/$token"))
    }

    @Test
    fun `a trailing slash is tolerated, nothing else is`() {
        assertEquals(token, InvitationLink.token("faithful://invite/$token/"))
    }

    @Test
    fun `everything else is refused`() {
        assertNull(InvitationLink.token("https://invite/$token"))            // wrong scheme
        assertNull(InvitationLink.token("faithful://home"))                   // wrong host
        assertNull(InvitationLink.token("faithful://invite/short"))           // too short
        assertNull(InvitationLink.token("faithful://invite/$token/extra"))    // extra segment
        assertNull(InvitationLink.token("faithful://invite/${"a".repeat(20)}!bad")) // off-alphabet
        assertNull(InvitationLink.token("faithful://invite/"))                // empty
        assertNull(InvitationLink.token("faithful://invite/$token?x=1"))      // query
    }
}
