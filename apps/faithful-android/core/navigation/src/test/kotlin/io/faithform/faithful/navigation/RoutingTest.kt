package io.faithform.faithful.navigation

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class RoutingTest {

    private val registry = RouteRegistry()

    private fun snapshot(
        authenticated: Boolean = true,
        capabilities: Set<String> = setOf("account"),
        access: Map<String, Boolean> = emptyMap(),
        blocked: Set<String> = emptySet()
    ) = SessionSnapshot(authenticated, capabilities, access, blocked)

    @Test
    fun `valid links parse to typed destinations`() {
        assertEquals(Destination.Home, DeepLinkParser.parse("faithful://home"))
        assertEquals(Destination.Account, DeepLinkParser.parse("faithful://account"))
        assertEquals(Destination.AccountPrivacy, DeepLinkParser.parse("faithful://account/privacy"))
        assertEquals(Destination.ChurchDiscovery, DeepLinkParser.parse("faithful://discover"))
        assertEquals(Destination.Church("grace-community"), DeepLinkParser.parse("faithful://church/grace-community"))
        assertEquals(Destination.Watch("grace"), DeepLinkParser.parse("faithful://church/grace/watch"))
        assertEquals(Destination.Give("grace"), DeepLinkParser.parse("faithful://church/grace/give"))
    }

    @Test
    fun `unknown malformed and hostile links fail closed`() {
        val bad = listOf(
            "https://faithform.io/church/grace",
            "faithful://",
            "faithful://nope",
            "faithful://church",
            "faithful://church/GRACE",
            "faithful://church/../../etc/passwd",
            "faithful://church/grace/unknown",
            "faithful://church/grace/watch/extra",
            "faithful://account/privacy/extra"
        )
        for (raw in bad) {
            assertNull("should reject $raw", DeepLinkParser.parse(raw))
        }
    }

    @Test
    fun `an unimplemented destination is never offered`() {
        assertEquals(RouteResolution.Allowed(Destination.Home), registry.resolve(Destination.Home, snapshot()))
        assertEquals(RouteResolution.Allowed(Destination.Account), registry.resolve(Destination.Account, snapshot()))

        for (destination in listOf(
            Destination.ChurchDiscovery,
            Destination.Announcements("grace"),
            Destination.Watch("grace"),
            Destination.SermonArchive("grace"),
            Destination.Give("grace")
        )) {
            assertEquals(
                "$destination must not be reachable yet",
                RouteResolution.Rejected(RouteRejection.NOT_IMPLEMENTED),
                registry.resolve(destination, snapshot())
            )
        }
    }

    @Test
    fun `an authenticated destination is refused when signed out`() {
        assertEquals(
            RouteResolution.Rejected(RouteRejection.REQUIRES_SIGN_IN),
            registry.resolve(Destination.Account, snapshot(authenticated = false))
        )
    }

    @Test
    fun `a destination is refused without its capability`() {
        assertEquals(
            RouteResolution.Rejected(RouteRejection.CAPABILITY_UNAVAILABLE),
            registry.resolve(Destination.Home, snapshot(capabilities = emptySet()))
        )
    }

    @Test
    fun `a church destination requires a real relationship`() {
        val full = RouteRegistry(setOf("home", "account", "church"))
        val session = snapshot(
            capabilities = setOf("account", "discovery"),
            access = mapOf("grace" to true)
        )
        assertEquals(
            RouteResolution.Allowed(Destination.Church("grace")),
            full.resolve(Destination.Church("grace"), session)
        )
        assertEquals(
            RouteResolution.Rejected(RouteRejection.NO_RELATIONSHIP),
            full.resolve(Destination.Church("someone-elses"), session)
        )
    }

    @Test
    fun `a blocked church is refused even with a valid link`() {
        val full = RouteRegistry(setOf("home", "account", "church"))
        val session = snapshot(
            capabilities = setOf("account", "discovery"),
            access = mapOf("grace" to false),
            blocked = setOf("grace")
        )
        assertEquals(
            RouteResolution.Rejected(RouteRejection.BLOCKED),
            full.resolve(Destination.Church("grace"), session)
        )
    }

    @Test
    fun `a link is authorized before anything is mutated`() {
        assertEquals(
            RouteResolution.Rejected(RouteRejection.NOT_IMPLEMENTED),
            registry.resolve("faithful://church/grace/give", snapshot())
        )
    }
}
