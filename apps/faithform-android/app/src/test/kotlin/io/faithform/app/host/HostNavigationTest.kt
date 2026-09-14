package io.faithform.app.host

import io.faithform.app.contract.AccountStatus
import io.faithform.app.contract.Bootstrap
import io.faithform.app.contract.ChurchRelationship
import io.faithform.app.contract.ConsentState
import io.faithform.app.contract.JoinPolicy
import io.faithform.app.contract.RelationshipState
import io.faithform.app.contract.VisitorProfile
import io.faithform.app.navigation.DeepLinkParser
import io.faithform.app.navigation.Destination
import io.faithform.app.navigation.RouteRegistry
import io.faithform.app.ui.church.ChooserPhase
import io.faithform.app.ui.church.chooserPhaseFor
import io.faithform.app.ui.church.isSelectable
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Which tabs a signed-in person sees, which church they are about, and where a
 * link may take them — the same rules as `RootModel` on iOS, asserted without a
 * screen.
 */
internal fun relationship(
    slug: String,
    state: RelationshipState = RelationshipState.JOINED,
    canRead: Boolean = true,
) = ChurchRelationship(
    churchSlug = slug,
    churchName = slug.replaceFirstChar { it.uppercase() },
    logoUrl = null,
    state = state,
    joinPolicy = JoinPolicy.OPEN,
    joinedAt = null,
    updatedAt = "2026-09-01T00:00:00Z",
    canReadPublishedContent = canRead,
)

internal fun bootstrap(
    capabilities: List<String> = listOf("account", "discovery", "announcements", "watch", "attendance", "giving", "sermons"),
    relationships: List<ChurchRelationship> = listOf(relationship("grace")),
    selectedChurchSlug: String? = null,
    authorizationVersion: Int = 1,
    status: AccountStatus = AccountStatus.ACTIVE,
) = Bootstrap(
    profile = VisitorProfile(
        displayName = "Sarah",
        status = status,
        termsVersion = "2026-08-01",
        privacyVersion = "2026-08-01",
        autoAttendanceConsent = ConsentState.UNSET,
        communicationPrefs = emptyMap(),
        selectedChurchSlug = selectedChurchSlug,
        authorizationVersion = authorizationVersion,
    ),
    relationships = relationships,
    pendingRequests = emptyList(),
    requiredTermsVersion = "2026-08-01",
    requiredPrivacyVersion = "2026-08-01",
    enabledCapabilities = capabilities,
    serverTime = "2026-09-13T00:00:00Z",
)

/** Exactly what `MainActivity` registers. `AppNavigationTest` holds the same set. */
internal val shippedRegistry = RouteRegistry(
    implemented = setOf(
        "home", "account", "accountPrivacy", "discover", "church",
        "announcements", "watch", "give", "checkIn", "sermons",
    ),
)

class HostTabsTest {

    @Test
    fun `every capability on, with a church selected, shows the six tabs in iOS order`() {
        assertEquals(
            listOf(HostTab.HOME, HostTab.CHURCH, HostTab.CHECK_IN, HostTab.WATCH, HostTab.GIVE, HostTab.ACCOUNT),
            HostNavigation.availableTabs(bootstrap(), "grace", shippedRegistry),
        )
    }

    @Test
    fun `a capability the server withholds removes exactly its tab`() {
        for ((capability, tab) in listOf(
            "attendance" to HostTab.CHECK_IN,
            "giving" to HostTab.GIVE,
            "discovery" to HostTab.CHURCH,
        )) {
            val withoutIt = bootstrap(capabilities = bootstrap().enabledCapabilities - capability)
            val tabs = HostNavigation.availableTabs(withoutIt, "grace", shippedRegistry)
            assertTrue("$tab survived without $capability", tab !in tabs)
            assertEquals("$capability removed more than its tab", 5, tabs.size)
        }
        // Services stays when only watch is off, because messages (sermons) still resolve.
        val withoutWatch = bootstrap(capabilities = bootstrap().enabledCapabilities - "watch")
        assertTrue(HostTab.WATCH in HostNavigation.availableTabs(withoutWatch, "grace", shippedRegistry))
        val withoutBoth = bootstrap(capabilities = bootstrap().enabledCapabilities - "watch" - "sermons")
        assertTrue(HostTab.WATCH !in HostNavigation.availableTabs(withoutBoth, "grace", shippedRegistry))
    }

    @Test
    fun `church-scoped tabs need a church, and a readable one`() {
        val none = HostNavigation.availableTabs(bootstrap(relationships = emptyList()), null, shippedRegistry)
        assertEquals(listOf(HostTab.HOME, HostTab.CHURCH, HostTab.ACCOUNT), none)

        val revoked = bootstrap(relationships = listOf(relationship("grace", canRead = false)))
        assertEquals(
            listOf(HostTab.HOME, HostTab.CHURCH, HostTab.ACCOUNT),
            HostNavigation.availableTabs(revoked, "grace", shippedRegistry),
        )
    }

    @Test
    fun `a blocked church closes every church-scoped tab even if marked readable`() {
        val blocked = bootstrap(relationships = listOf(relationship("grace", RelationshipState.BLOCKED, canRead = true)))
        val tabs = HostNavigation.availableTabs(blocked, "grace", shippedRegistry)
        assertTrue(HostTab.GIVE !in tabs && HostTab.WATCH !in tabs && HostTab.CHECK_IN !in tabs)
    }

    @Test
    fun `a build without a screen shows no tab for it, whatever the server says`() {
        val minimal = RouteRegistry(implemented = setOf("home", "account"))
        assertEquals(listOf(HostTab.HOME, HostTab.ACCOUNT), HostNavigation.availableTabs(bootstrap(), "grace", minimal))
    }
}

class ChurchSelectionTest {

    private val two = bootstrap(relationships = listOf(relationship("grace"), relationship("hope")))

    @Test
    fun `the server's stored preference wins when it is still readable`() {
        assertEquals("hope", HostNavigation.adoptSelection(two, serverPreference = "hope", current = "grace")?.churchSlug)
    }

    @Test
    fun `otherwise the current selection is kept, then the first readable church`() {
        assertEquals("hope", HostNavigation.adoptSelection(two, serverPreference = null, current = "hope")?.churchSlug)
        assertEquals("grace", HostNavigation.adoptSelection(two, serverPreference = "gone", current = "gone")?.churchSlug)
    }

    @Test
    fun `a church that can no longer be read is never kept selected`() {
        val revoked = bootstrap(relationships = listOf(relationship("grace", canRead = false), relationship("hope")))
        assertEquals("hope", HostNavigation.adoptSelection(revoked, serverPreference = "grace", current = "grace")?.churchSlug)
        assertNull(HostNavigation.adoptSelection(bootstrap(relationships = emptyList()), "grace", "grace"))
    }

    @Test
    fun `the chooser shows every relationship truthfully and lets only usable ones be picked`() {
        val phase = chooserPhaseFor(
            listOf(
                relationship("grace"),
                relationship("hope", RelationshipState.PENDING),
                relationship("old", RelationshipState.LEFT, canRead = false),
                relationship("closed", RelationshipState.BLOCKED, canRead = false),
            ),
        ) as ChooserPhase.Loaded
        assertEquals(listOf("grace", "hope", "old", "closed"), phase.churches.map { it.slug })
        assertEquals(RelationshipState.PENDING, phase.churches[1].state)
        assertEquals(listOf(true, true, false, false), phase.churches.map { it.isSelectable() })
        assertEquals(ChooserPhase.Empty, chooserPhaseFor(emptyList()))
    }
}

class DeepLinkTargetTest {

    private val two = bootstrap(relationships = listOf(relationship("grace"), relationship("hope")))

    private fun target(link: String) =
        HostNavigation.resolveLink(DeepLinkParser.parse(link)!!, two, shippedRegistry)

    @Test
    fun `a church-scoped link selects its church, then its tab`() {
        assertEquals(LinkTarget(HostTab.GIVE, "hope", Destination.Give("hope")), target("faithform://church/hope/give"))
        assertEquals(HostTab.WATCH, target("faithform://church/grace/watch")?.tab)
        assertEquals(HostTab.CHECK_IN, target("faithform://church/grace/check-in")?.tab)
        assertEquals(HostTab.WATCH, target("faithform://church/grace/sermons")?.tab)
    }

    @Test
    fun `a sermons link lands on Services and keeps its destination, so the tab can open messages`() {
        assertEquals(
            LinkTarget(HostTab.WATCH, "hope", Destination.SermonArchive("hope")),
            target("faithform://church/hope/sermons"),
        )
    }

    @Test
    fun `sermon notes open from anywhere only for a church the registry allows them for`() {
        assertTrue(HostNavigation.sermonsAllowed(two, "grace", shippedRegistry))
        assertFalse(HostNavigation.sermonsAllowed(two, null, shippedRegistry))
        assertFalse(HostNavigation.sermonsAllowed(two, "stranger", shippedRegistry))
        assertFalse(
            HostNavigation.sermonsAllowed(
                bootstrap(capabilities = bootstrap().enabledCapabilities - "sermons"),
                "grace",
                shippedRegistry,
            ),
        )
        assertFalse(
            HostNavigation.sermonsAllowed(
                bootstrap(relationships = listOf(relationship("grace", RelationshipState.BLOCKED))),
                "grace",
                shippedRegistry,
            ),
        )
    }

    @Test
    fun `account and home links need no church`() {
        assertEquals(LinkTarget(HostTab.ACCOUNT, null, Destination.Account), target("faithform://account"))
        assertEquals(HostTab.ACCOUNT, target("faithform://account/privacy")?.tab)
        assertEquals(HostTab.HOME, target("faithform://home")?.tab)
    }

    @Test
    fun `a church this account has no relationship with goes nowhere`() {
        assertNull(target("faithform://church/stranger/give"))
    }

    @Test
    fun `a switched-off capability or an unreadable church goes nowhere`() {
        val noGiving = bootstrap(capabilities = listOf("account", "discovery"))
        assertNull(HostNavigation.resolveLink(Destination.Give("grace"), noGiving, shippedRegistry))

        val revoked = bootstrap(relationships = listOf(relationship("grace", canRead = false)))
        assertNull(HostNavigation.resolveLink(Destination.Watch("grace"), revoked, shippedRegistry))
    }

    @Test
    fun `announcements have a destination and no tab, so the link does nothing`() {
        assertNull(target("faithform://church/grace/announcements"))
    }

    @Test
    fun `scoping replaces only the church of church-scoped destinations`() {
        assertEquals(Destination.CheckIn("hope"), HostNavigation.scoped(Destination.CheckIn(""), "hope"))
        assertEquals(Destination.SermonArchive("hope"), HostNavigation.scoped(Destination.SermonArchive(""), "hope"))
        assertEquals(Destination.Home, HostNavigation.scoped(Destination.Home, "hope"))
        assertEquals(Destination.Give(""), HostNavigation.scoped(Destination.Give(""), null))
    }
}
