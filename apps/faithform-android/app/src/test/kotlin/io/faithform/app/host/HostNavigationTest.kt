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
    automaticCheckInEnabled: Boolean? = null,
    codeCheckInEnabled: Boolean? = null,
) = ChurchRelationship(
    churchSlug = slug,
    churchName = slug.replaceFirstChar { it.uppercase() },
    logoUrl = null,
    automaticCheckInEnabled = automaticCheckInEnabled,
    codeCheckInEnabled = codeCheckInEnabled,
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
        "announcements", "watch", "give", "checkIn", "sermons", "groups",
    ),
)

class HostTabsTest {
    @Test fun `groups replaces account in the bar only when enabled for this church`() {
        val enabled = bootstrap(capabilities = listOf("account", "discovery", "groups", "watch", "attendance", "giving"), relationships = listOf(relationship("grace").copy(groupsEnabled = true)))
        assertEquals(listOf(HostTab.HOME, HostTab.GROUPS, HostTab.CHECK_IN, HostTab.WATCH, HostTab.GIVE), HostNavigation.availableTabs(enabled, "grace", shippedRegistry))
        assertEquals(HostTab.ACCOUNT, HostNavigation.resolveLink(Destination.Account, enabled, shippedRegistry)?.tab)
        val disabled = enabled.copy(relationships = listOf(relationship("grace").copy(groupsEnabled = false)))
        assertFalse(HostTab.GROUPS in HostNavigation.availableTabs(disabled, "grace", shippedRegistry))
        assertNull(HostNavigation.resolveLink(Destination.Groups("grace"), disabled, shippedRegistry))
    }
    @Test fun `group invitation credentials reject paths queries and malformed tokens`() {
        assertEquals("abcdefghijklmnop", io.faithform.app.navigation.GroupInvitationLink.token("faithform://group-invite/abcdefghijklmnop"))
        listOf("https://group-invite/abcdefghijklmnop", "faithform://group-invite/short", "faithform://group-invite/abcdefghijklmnop?extra=1", "faithform://group-invite/abcdefghijklmnop/extra").forEach { assertNull(io.faithform.app.navigation.GroupInvitationLink.token(it)) }
    }


    @Test
    fun `every capability on, with a church selected, shows the five tabs in iOS order`() {
        assertEquals(
            listOf(HostTab.HOME, HostTab.CHECK_IN, HostTab.WATCH, HostTab.GIVE, HostTab.ACCOUNT),
            HostNavigation.availableTabs(bootstrap(), "grace", shippedRegistry),
        )
    }

    @Test
    fun `there is no church tab — a person has one church, and its page lives under Home`() {
        assertEquals(
            listOf("HOME", "GROUPS", "CHECK_IN", "WATCH", "GIVE", "ACCOUNT"),
            HostTab.entries.map { it.name },
        )
    }

    @Test
    fun `a capability the server withholds removes exactly its tab`() {
        for ((capability, tab) in listOf(
            "attendance" to HostTab.CHECK_IN,
            "giving" to HostTab.GIVE,
        )) {
            val withoutIt = bootstrap(capabilities = bootstrap().enabledCapabilities - capability)
            val tabs = HostNavigation.availableTabs(withoutIt, "grace", shippedRegistry)
            assertTrue("$tab survived without $capability", tab !in tabs)
            assertEquals("$capability removed more than its tab", 4, tabs.size)
        }
        // Discovery no longer has a tab of its own to take away.
        val withoutDiscovery = bootstrap(capabilities = bootstrap().enabledCapabilities - "discovery")
        assertEquals(5, HostNavigation.availableTabs(withoutDiscovery, "grace", shippedRegistry).size)
        // Services stays when only watch is off, because messages (sermons) still resolve.
        val withoutWatch = bootstrap(capabilities = bootstrap().enabledCapabilities - "watch")
        assertTrue(HostTab.WATCH in HostNavigation.availableTabs(withoutWatch, "grace", shippedRegistry))
        val withoutBoth = bootstrap(capabilities = bootstrap().enabledCapabilities - "watch" - "sermons")
        assertTrue(HostTab.WATCH !in HostNavigation.availableTabs(withoutBoth, "grace", shippedRegistry))
    }

    @Test
    fun `check-in stays for either enabled method and disappears when both are off`() {
        for (church in listOf(
            relationship("grace", automaticCheckInEnabled = true, codeCheckInEnabled = false),
            relationship("grace", automaticCheckInEnabled = false, codeCheckInEnabled = true),
            relationship("grace"), // Cached bootstrap from an older server.
        )) {
            assertTrue(
                HostTab.CHECK_IN in HostNavigation.availableTabs(
                    bootstrap(relationships = listOf(church)),
                    "grace",
                    shippedRegistry,
                ),
            )
        }

        val neither = bootstrap(
            relationships = listOf(
                relationship("grace", automaticCheckInEnabled = false, codeCheckInEnabled = false),
            ),
        )
        assertFalse(HostTab.CHECK_IN in HostNavigation.availableTabs(neither, "grace", shippedRegistry))
        assertNull(
            HostNavigation.resolveLink(
                Destination.CheckIn("grace"),
                neither,
                shippedRegistry,
            ),
        )
    }

    @Test
    fun `church-scoped tabs need a church, and a readable one`() {
        val none = HostNavigation.availableTabs(bootstrap(relationships = emptyList()), null, shippedRegistry)
        assertEquals(listOf(HostTab.HOME, HostTab.ACCOUNT), none)

        val revoked = bootstrap(relationships = listOf(relationship("grace", canRead = false)))
        assertEquals(
            listOf(HostTab.HOME, HostTab.ACCOUNT),
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
    fun `after adding a church, the new one is selected — the old one was released`() {
        val replaced = bootstrap(
            relationships = listOf(
                relationship("grace", RelationshipState.LEFT, canRead = false),
                relationship("hope", RelationshipState.FOLLOWING),
            ),
        )
        // Even a stale preference or a stale local selection cannot keep the
        // released church selected.
        assertEquals("hope", HostNavigation.adoptSelection(replaced, serverPreference = "grace", current = "grace")?.churchSlug)
        assertEquals("hope", HostNavigation.adoptSelection(replaced, serverPreference = "hope", current = "grace")?.churchSlug)
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
    fun `church and discovery links land on Home, where the church's page and search now live`() {
        assertEquals(LinkTarget(HostTab.HOME, "hope", Destination.Church("hope")), target("faithform://church/hope"))
        assertEquals(LinkTarget(HostTab.HOME, null, Destination.ChurchDiscovery), target("faithform://discover"))
        assertEquals(HostTab.HOME, HostNavigation.tabFor(Destination.Church("anywhere")))
        assertEquals(HostTab.HOME, HostNavigation.tabFor(Destination.ChurchDiscovery))
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
    fun `Watch never opens on a half that is switched off`() {
        assertEquals(
            HostNavigation.WatchPane.SERMONS,
            HostNavigation.effectiveWatchPane(HostNavigation.WatchPane.SERMONS, true, true),
        )
        assertEquals(
            HostNavigation.WatchPane.MEDIA,
            HostNavigation.effectiveWatchPane(HostNavigation.WatchPane.MEDIA, true, true),
        )
        assertEquals(
            HostNavigation.WatchPane.SERMONS,
            HostNavigation.effectiveWatchPane(HostNavigation.WatchPane.SLIDES, true, true),
        )
        assertEquals(
            HostNavigation.WatchPane.MEDIA,
            HostNavigation.effectiveWatchPane(HostNavigation.WatchPane.SERMONS, true, false),
        )
        assertEquals(
            HostNavigation.WatchPane.MEDIA,
            HostNavigation.effectiveWatchPane(HostNavigation.WatchPane.SLIDES, true, false),
        )
        assertEquals(
            HostNavigation.WatchPane.SERMONS,
            HostNavigation.effectiveWatchPane(HostNavigation.WatchPane.MEDIA, false, true),
        )
        assertEquals(
            HostNavigation.WatchPane.SERMONS,
            HostNavigation.effectiveWatchPane(HostNavigation.WatchPane.SLIDES, false, true),
        )
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
