package io.faithform.app.host

import io.faithform.app.contract.Bootstrap
import io.faithform.app.contract.ChurchRelationship
import io.faithform.app.contract.RelationshipState
import io.faithform.app.navigation.Destination
import io.faithform.app.navigation.RouteRegistry
import io.faithform.app.navigation.RouteResolution
import io.faithform.app.navigation.SessionSnapshot

/**
 * The tabs a signed-in person can have.
 *
 * One case per destination that has a screen, in the order iOS shows them —
 * `RootTab` in `apps/faithform-ios/App/RootView.swift`. Deliberately not one
 * case per [Destination]: announcements have no tab of their own; sermon notes
 * open inside Services (Watch) beside live and past recordings; and a person
 * has exactly one church, so its page ("Church info") and finding another
 * live under Home rather than in a tab of their own.
 */
enum class HostTab {
    HOME, GROUPS, CHECK_IN, WATCH, GIVE, ACCOUNT;

    /**
     * The destination a tab stands for. Church-scoped ones carry an empty slug
     * here and are re-scoped to the selected church by [HostNavigation.scoped]
     * before anything is resolved — exactly as iOS does.
     */
    val destination: Destination
        get() = when (this) {
            HOME -> Destination.Home
            GROUPS -> Destination.Groups("")
            CHECK_IN -> Destination.CheckIn("")
            WATCH -> Destination.Watch("")
            GIVE -> Destination.Give("")
            ACCOUNT -> Destination.Account
        }
}

/**
 * The decisions the signed-in shell makes, as plain functions.
 *
 * Mirrors `RootModel.availableTabs`, `RootModel.adoptSelection`,
 * `RootModel.scoped` and `RootModel.tab(for:)` on iOS, rule for rule, so the two
 * apps show the same tabs for the same bootstrap. Kept out of Compose so every
 * rule is asserted by a plain JUnit test.
 */
object HostNavigation {

    /**
     * What the route registry needs to know about this session, taken from the
     * server's own answers.
     *
     * `canReadPublishedContent` is the server's verdict, not a state string this
     * app re-interprets — deriving it here would be a second copy of an
     * authorization rule.
     */
    fun snapshot(bootstrap: Bootstrap) = SessionSnapshot(
        isAuthenticated = true,
        capabilities = bootstrap.enabledCapabilities.toSet(),
        churchAccess = bootstrap.relationships.associate { it.churchSlug to it.canReadPublishedContent },
        blockedChurches = bootstrap.relationships
            .filter { it.state == RelationshipState.BLOCKED }
            .map { it.churchSlug }
            .toSet(),
    )

    /**
     * The tabs available *right now*.
     *
     * Each is resolved through [RouteRegistry] against the current bootstrap
     * and the currently selected church: a capability the server switched off,
     * a relationship that was revoked, or a screen this build does not have all
     * remove the tab on the next pass — which is why the list is computed, never
     * stored. A church-scoped tab with no church selected resolves to "no
     * relationship" and does not appear.
     *
     * Services (Watch) holds recordings and messages — worth a tab if either
     * capability resolves, matching iOS `RootModel.availableTabs`.
     */
    fun availableTabs(
        bootstrap: Bootstrap,
        selectedChurchSlug: String?,
        registry: RouteRegistry,
    ): List<HostTab> {
        val session = snapshot(bootstrap)
        return HostTab.entries.filter { tab ->
            when (tab) {
                HostTab.GROUPS -> bootstrap.relationships.firstOrNull { it.churchSlug == selectedChurchSlug }?.groupsEnabled == true && registry.resolve(scoped(tab.destination, selectedChurchSlug), session) is RouteResolution.Allowed
                HostTab.CHECK_IN -> {
                    val allowed = registry.resolve(
                        scoped(tab.destination, selectedChurchSlug),
                        session,
                    ) is RouteResolution.Allowed
                    val church = bootstrap.relationships.firstOrNull {
                        it.churchSlug == selectedChurchSlug
                    }
                    allowed && church?.offersCheckIn != false
                }
                HostTab.WATCH -> {
                    val media = registry.resolve(scoped(tab.destination, selectedChurchSlug), session) is RouteResolution.Allowed
                    val sermons = sermonsAllowed(bootstrap, selectedChurchSlug, registry)
                    media || sermons
                }
                else -> registry.resolve(scoped(tab.destination, selectedChurchSlug), session) is RouteResolution.Allowed
            }
        }.let { tabs -> if (HostTab.GROUPS in tabs) tabs.filter { it != HostTab.ACCOUNT } else tabs }
    }

    /** Older servers omit these additive fields and historically offered both. */
    val ChurchRelationship.offersCheckIn: Boolean
        get() = (automaticCheckInEnabled ?: true) || (codeCheckInEnabled ?: true)

    /**
     * Whether the selected church's sermons may open: the one gate the
     * Services tab's Sermons and Slides panes and a `…/sermons` link all pass.
     */
    fun sermonsAllowed(
        bootstrap: Bootstrap,
        selectedChurchSlug: String?,
        registry: RouteRegistry,
    ): Boolean = selectedChurchSlug != null &&
        registry.resolve(Destination.SermonArchive(selectedChurchSlug), snapshot(bootstrap)) is RouteResolution.Allowed

    /** Whether live/past media may open for the selected church. */
    fun mediaAllowed(
        bootstrap: Bootstrap,
        selectedChurchSlug: String?,
        registry: RouteRegistry,
    ): Boolean = selectedChurchSlug != null &&
        registry.resolve(Destination.Watch(selectedChurchSlug), snapshot(bootstrap)) is RouteResolution.Allowed

    /** Re-scopes a church-scoped destination to [slug]; anything else is unchanged. */
    fun scoped(destination: Destination, slug: String?): Destination {
        slug ?: return destination
        return when (destination) {
            is Destination.Groups -> Destination.Groups(slug)
            is Destination.CheckIn -> Destination.CheckIn(slug)
            is Destination.Watch -> Destination.Watch(slug)
            is Destination.Give -> Destination.Give(slug)
            is Destination.Announcements -> Destination.Announcements(slug)
            is Destination.SermonArchive -> Destination.SermonArchive(slug)
            is Destination.Church -> Destination.Church(slug)
            else -> destination
        }
    }

    /**
     * Which tab a destination lands on. Announcements have no tab; sermons open
     * inside Services, which `AppViewModel.sermonsRequested` asks it to do. A
     * church or discovery link lands on Home, where the church's page and the
     * search for another now live.
     */
    fun tabFor(destination: Destination): HostTab? = when (destination) {
        is Destination.Home -> HostTab.HOME
        is Destination.ChurchDiscovery, is Destination.Church -> HostTab.HOME
        is Destination.SermonArchive -> HostTab.WATCH
        is Destination.Groups -> HostTab.GROUPS
        is Destination.CheckIn -> HostTab.CHECK_IN
        is Destination.Watch -> HostTab.WATCH
        is Destination.Give -> HostTab.GIVE
        is Destination.Account, is Destination.AccountPrivacy -> HostTab.ACCOUNT
        is Destination.Announcements -> null
    }

    /**
     * Which church the church-scoped tabs are about, after a bootstrap.
     *
     * In order: the server's stored preference, when it still names a readable
     * church — it is the choice the person made, on any device; then the church
     * already selected here, if it is still readable; then the first readable
     * church. A church that was left, blocked or revoked is never kept selected,
     * because every church-scoped tab would then refuse it.
     */
    fun adoptSelection(
        bootstrap: Bootstrap,
        serverPreference: String?,
        current: String?,
    ): ChurchRelationship? {
        val readable = bootstrap.relationships.filter { it.canReadPublishedContent }
        return readable.firstOrNull { it.churchSlug == serverPreference }
            ?: readable.firstOrNull { it.churchSlug == current }
            ?: readable.firstOrNull()
    }

    /**
     * Where a `faithform://` link should take a signed-in person, or null to do
     * nothing at all.
     *
     * Parsed links arrive here already typed. A church-scoped link must name a
     * church this account can read — it then becomes the selected church — and
     * every link must clear the same registry the tabs use. An unknown link, an
     * unbuilt feature and a church with no relationship all resolve to null: no
     * error screen, no half-navigation, no prompt.
     */
    fun resolveLink(
        destination: Destination,
        bootstrap: Bootstrap,
        registry: RouteRegistry,
    ): LinkTarget? {
        val church = destination.churchSlug?.let { slug ->
            bootstrap.relationships.firstOrNull { it.churchSlug == slug && it.canReadPublishedContent }
                ?: return null
        }
        if (destination is Destination.Groups && church?.groupsEnabled != true) return null
        if (destination is Destination.CheckIn && church?.offersCheckIn == false) return null
        if (registry.resolve(destination, snapshot(bootstrap)) !is RouteResolution.Allowed) return null
        val tab = tabFor(destination) ?: return null
        return LinkTarget(tab = tab, churchSlug = church?.churchSlug, destination = destination)
    }

    /**
     * Which pane of Services to show, given what the registry allows.
     *
     * A requested pane that is switched off falls back to one that is on.
     * Matches iOS `WatchTabView.effectiveSection`.
     */
    enum class WatchPane {
        MEDIA, SERMONS, SLIDES
    }

    fun effectiveWatchPane(
        requested: WatchPane,
        showsMedia: Boolean,
        showsSermons: Boolean,
    ): WatchPane = when (requested) {
        WatchPane.MEDIA -> if (showsMedia || !showsSermons) WatchPane.MEDIA else WatchPane.SERMONS
        WatchPane.SERMONS -> if (showsSermons || !showsMedia) WatchPane.SERMONS else WatchPane.MEDIA
        WatchPane.SLIDES -> if (showsSermons) WatchPane.SERMONS else WatchPane.MEDIA
    }
}

/** A link that cleared every gate: the tab to show, and the church to select first. */
data class LinkTarget(val tab: HostTab, val churchSlug: String?, val destination: Destination)
