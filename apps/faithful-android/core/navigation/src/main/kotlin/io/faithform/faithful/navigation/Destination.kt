package io.faithform.faithful.navigation

/**
 * Every place the app can go.
 *
 * The full information architecture is declared here so later prompts add a
 * *screen* rather than restructuring the app root. Being in this list says
 * nothing about being reachable — [RouteRegistry] decides that.
 */
sealed interface Destination {
    val requiredCapability: String
    val requiresAuthentication: Boolean get() = true
    val churchSlug: String? get() = null

    data object Home : Destination {
        override val requiredCapability = "account"
    }
    data object Account : Destination {
        override val requiredCapability = "account"
    }
    data object AccountPrivacy : Destination {
        override val requiredCapability = "account"
    }
    data object ChurchDiscovery : Destination {
        override val requiredCapability = "discovery"
        override val requiresAuthentication = false
    }
    data class Church(val slug: String) : Destination {
        override val requiredCapability = "discovery"
        override val requiresAuthentication = false
        override val churchSlug get() = slug
    }
    data class Announcements(val slug: String) : Destination {
        override val requiredCapability = "announcements"
        override val churchSlug get() = slug
    }
    data class Watch(val slug: String) : Destination {
        override val requiredCapability = "watch"
        override val churchSlug get() = slug
    }
    data class SermonArchive(val slug: String) : Destination {
        override val requiredCapability = "sermons"
        override val churchSlug get() = slug
    }
    data class Give(val slug: String) : Destination {
        override val requiredCapability = "giving"
        override val churchSlug get() = slug
    }

    /**
     * The check-in scanner (Prompt 8).
     *
     * **Arriving here starts nothing.** The screen opens idle, with the camera
     * untouched and the typed-code field ready; the camera is requested only if
     * the person then taps "Scan the code". A deep link that could raise a
     * camera prompt would be a permission request triggered by whoever sent the
     * link, which is exactly the shape this app refuses everywhere else.
     */
    data class CheckIn(val slug: String) : Destination {
        override val requiredCapability = "attendance"
        override val churchSlug get() = slug
    }
}

/**
 * Parses `faithful://` links into typed destinations.
 *
 * Anything unrecognised returns null rather than a best guess: a link is
 * untrusted input that arrives before the app has decided anything about the
 * person holding it, so it must fail closed.
 */
object DeepLinkParser {
    const val SCHEME = "faithful"
    private val SLUG = Regex("^[a-z0-9][a-z0-9-]{0,119}$")

    fun parse(raw: String): Destination? {
        val withoutScheme = raw.substringAfter("://", missingDelimiterValue = "")
            .takeIf { raw.startsWith("$SCHEME://", ignoreCase = true) }
            ?: return null

        val segments = withoutScheme
            .substringBefore('?')
            .substringBefore('#')
            .split('/')
            .filter { it.isNotEmpty() }

        if (segments.isEmpty()) return null
        val root = segments.first().lowercase()
        val rest = segments.drop(1)

        return when (root) {
            "home" -> if (rest.isEmpty()) Destination.Home else null
            "discover" -> if (rest.isEmpty()) Destination.ChurchDiscovery else null
            "account" -> when {
                rest.isEmpty() -> Destination.Account
                rest == listOf("privacy") -> Destination.AccountPrivacy
                else -> null
            }
            "church" -> {
                val slug = rest.firstOrNull()?.takeIf { SLUG.matches(it) } ?: return null
                val leaf = rest.drop(1)
                when {
                    leaf.isEmpty() -> Destination.Church(slug)
                    leaf.size > 1 -> null
                    else -> when (leaf[0].lowercase()) {
                        "announcements" -> Destination.Announcements(slug)
                        "watch" -> Destination.Watch(slug)
                        "sermons" -> Destination.SermonArchive(slug)
                        "give" -> Destination.Give(slug)
                        "check-in" -> Destination.CheckIn(slug)
                        else -> null
                    }
                }
            }
            else -> null
        }
    }
}

enum class RouteRejection {
    NOT_IMPLEMENTED, REQUIRES_SIGN_IN, CAPABILITY_UNAVAILABLE, NO_RELATIONSHIP, BLOCKED
}

sealed interface RouteResolution {
    data class Allowed(val destination: Destination) : RouteResolution
    data class Rejected(val reason: RouteRejection) : RouteResolution
}

data class SessionSnapshot(
    val isAuthenticated: Boolean,
    val capabilities: Set<String>,
    val churchAccess: Map<String, Boolean> = emptyMap(),
    val blockedChurches: Set<String> = emptySet()
)

/**
 * Decides what is actually reachable right now.
 *
 * Four independent gates: a screen exists, the server reports the capability,
 * the session permits it, and — for church-scoped destinations — the account
 * holds a usable relationship. Identical rules to the iOS registry, arrived at
 * from the same specification rather than shared code.
 */
class RouteRegistry(
    private val implemented: Set<String> = setOf("home", "account")
) {
    private fun identity(destination: Destination): String = when (destination) {
        is Destination.Home -> "home"
        is Destination.Account -> "account"
        is Destination.AccountPrivacy -> "accountPrivacy"
        is Destination.ChurchDiscovery -> "discover"
        is Destination.Church -> "church"
        is Destination.Announcements -> "announcements"
        is Destination.Watch -> "watch"
        is Destination.SermonArchive -> "sermons"
        is Destination.CheckIn -> "checkIn"
        is Destination.Give -> "give"
    }

    fun resolve(destination: Destination, session: SessionSnapshot): RouteResolution {
        if (identity(destination) !in implemented) {
            return RouteResolution.Rejected(RouteRejection.NOT_IMPLEMENTED)
        }
        if (destination.requiresAuthentication && !session.isAuthenticated) {
            return RouteResolution.Rejected(RouteRejection.REQUIRES_SIGN_IN)
        }
        if (destination.requiredCapability !in session.capabilities) {
            return RouteResolution.Rejected(RouteRejection.CAPABILITY_UNAVAILABLE)
        }
        destination.churchSlug?.let { slug ->
            if (slug in session.blockedChurches) {
                return RouteResolution.Rejected(RouteRejection.BLOCKED)
            }
            if (session.churchAccess[slug] != true) {
                return RouteResolution.Rejected(RouteRejection.NO_RELATIONSHIP)
            }
        }
        return RouteResolution.Allowed(destination)
    }

    /** Parsed and authorized in one step, before any state changes. */
    fun resolve(url: String, session: SessionSnapshot): RouteResolution {
        val destination = DeepLinkParser.parse(url)
            ?: return RouteResolution.Rejected(RouteRejection.NOT_IMPLEMENTED)
        return resolve(destination, session)
    }
}
