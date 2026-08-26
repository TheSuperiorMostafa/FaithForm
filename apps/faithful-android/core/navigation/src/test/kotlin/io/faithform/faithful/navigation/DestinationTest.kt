package io.faithform.faithful.navigation

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test


/**
 * The check-in route (Prompt 8).
 *
 * Deliberately in this file rather than beside the scanner: what matters here
 * is that arriving at the destination is inert, and that is a routing property.
 */
class CheckInRouteTest {

    @Test
    fun `the deep link parses to a check-in destination`() {
        assertEquals(
            Destination.CheckIn("grace-chapel"),
            DeepLinkParser.parse("faithful://church/grace-chapel/check-in"),
        )
    }

    @Test
    fun `check-in needs a signed-in account and the attendance capability`() {
        val destination = Destination.CheckIn("grace-chapel")
        // A code identifies a service. The *person* comes from the session, so
        // an anonymous caller has nothing for the server to count.
        assertTrue(destination.requiresAuthentication)
        assertEquals("attendance", destination.requiredCapability)
        assertEquals("grace-chapel", destination.churchSlug)
    }

    @Test
    fun `an unimplemented check-in route is refused rather than half-opened`() {
        val registry = RouteRegistry(implemented = setOf("home", "account"))
        val resolution = registry.resolve(
            Destination.CheckIn("grace-chapel"),
            SessionSnapshot(
                isAuthenticated = true,
                capabilities = setOf("attendance"),
                churchAccess = mapOf("grace-chapel" to true),
            ),
        )
        assertEquals(RouteResolution.Rejected(RouteRejection.NOT_IMPLEMENTED), resolution)
    }

    @Test
    fun `a malformed check-in link fails closed`() {
        // A link is untrusted input that arrives before the app has decided
        // anything about the person holding it.
        for (bad in listOf(
            "faithful://church/GRACE/check-in",
            "faithful://check-in",
            "faithful://church/grace-chapel/check-in/extra",
            "https://church/grace-chapel/check-in",
        )) {
            assertNull(bad, DeepLinkParser.parse(bad))
        }
    }

    @Test
    fun `empty path segments collapse, on both platforms alike`() {
        // Documented rather than asserted-away. `faithful://church//check-in`
        // does not fail — the parser drops empty segments, so `check-in` is
        // read as the slug and the link resolves to a church page for a church
        // that almost certainly does not exist.
        //
        // That is standard URL path normalisation and both platforms do it
        // identically (Swift's `split` omits empty subsequences by default), so
        // it is a decision rather than an accident. It reaches no camera and no
        // check-in: the worst case is a "church not found" screen.
        assertEquals(Destination.Church("check-in"), DeepLinkParser.parse("faithful://church//check-in"))
    }
}
