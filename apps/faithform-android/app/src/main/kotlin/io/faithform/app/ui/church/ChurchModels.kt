package io.faithform.app.ui.church

import io.faithform.app.contract.ChurchProfile
import io.faithform.app.contract.JoinPolicy
import io.faithform.app.contract.PublicCampus
import io.faithform.app.contract.PublicServiceTime
import io.faithform.app.contract.RelationshipState
import java.net.URI
import java.time.DayOfWeek
import java.time.Instant
import java.time.LocalTime
import java.time.ZoneId
import java.time.ZonedDateTime
import java.time.temporal.ChronoUnit

/** The church profile's state. Every case is one the contract can produce. */
sealed interface ChurchProfilePhase {
    data object Loading : ChurchProfilePhase
    data class Loaded(val profile: ChurchProfile) : ChurchProfilePhase
    data object NotFound : ChurchProfilePhase
    data object Offline : ChurchProfilePhase
    data class Failed(val message: String) : ChurchProfilePhase
}

/**
 * What the Church info page offers right now.
 *
 * A person has exactly one church. They add one, and adding a different one
 * replaces it. Derived from the relationship and the policy rather than
 * stored, so a relationship that changed on the server cannot leave a stale
 * button behind. Mirrors the iOS `ChurchAction` rule for rule.
 */
enum class ChurchAction {
    /** No church yet: "Add church". */
    ADD,

    /** A different church is theirs: "Make this my church", after a confirmation. */
    SWITCH,

    /** This is their church: no primary button, a "Your church" chip, and the footer. */
    CURRENT,

    /** The church adds people by invitation only: an explainer and the invitation entry. */
    INVITATION_REQUIRED,

    /** Blocked: an explainer and nothing to press. */
    UNAVAILABLE,
}

object ChurchActions {

    /**
     * The action for [profile], first match wins:
     *
     * | condition                               | action              |
     * |-----------------------------------------|---------------------|
     * | blocked                                 | UNAVAILABLE         |
     * | following, pending or joined            | CURRENT             |
     * | invite only                             | INVITATION_REQUIRED |
     * | another church is the selected one      | SWITCH              |
     * | otherwise                               | ADD                 |
     *
     * `left`, `unknown` and no state at all are "no relationship".
     */
    fun forProfile(profile: ChurchProfile, hasOtherChurch: Boolean): ChurchAction =
        forState(profile.relationshipState, profile.joinPolicy, hasOtherChurch)

    fun forState(
        state: RelationshipState?,
        policy: JoinPolicy,
        hasOtherChurch: Boolean,
    ): ChurchAction = when {
        state == RelationshipState.BLOCKED -> ChurchAction.UNAVAILABLE
        state == RelationshipState.FOLLOWING ||
            state == RelationshipState.PENDING ||
            state == RelationshipState.JOINED -> ChurchAction.CURRENT
        policy == JoinPolicy.INVITE_ONLY -> ChurchAction.INVITATION_REQUIRED
        hasOtherChurch -> ChurchAction.SWITCH
        else -> ChurchAction.ADD
    }

    /** Whether the account's selected church exists and is not [profileSlug]. */
    fun hasOtherChurch(selectedSlug: String?, profileSlug: String): Boolean =
        !selectedSlug.isNullOrBlank() && selectedSlug != profileSlug

    fun addressLine(campus: PublicCampus): String? =
        joinParts(campus.addressLine1, campus.city, campus.state, campus.postalCode)

    /** The church's own address, when it has one. */
    fun churchAddressLine(profile: ChurchProfile): String? =
        joinParts(profile.address, profile.city, profile.state, profile.postalCode)

    /** "Baptist · Louisville, KY", leaving out whatever is missing. */
    fun detailLine(profile: ChurchProfile): String? {
        val place = joinParts(profile.city, profile.state)
        return listOfNotNull(profile.denomination?.trim()?.takeIf { it.isNotEmpty() }, place)
            .takeIf { it.isNotEmpty() }
            ?.joinToString(" · ")
    }

    /** `about`, falling back to the one-line public summary. */
    fun aboutText(profile: ChurchProfile): String? =
        profile.about?.trim()?.takeIf { it.isNotEmpty() }
            ?: profile.publicSummary?.trim()?.takeIf { it.isNotEmpty() }

    private fun joinParts(vararg parts: String?): String? =
        parts.mapNotNull { it?.trim()?.takeIf { part -> part.isNotEmpty() } }
            .takeIf { it.isNotEmpty() }
            ?.joinToString(", ")
}

// ---------------------------------------------------------------------------
// Service times
// ---------------------------------------------------------------------------

/** A run of service times, under a campus name when the church has several campuses. */
data class ServiceTimeGroup(val campusName: String?, val times: List<PublicServiceTime>)

/** The next time a service starts, in the church's own zone. */
data class NextService(
    val service: PublicServiceTime,
    val startsAt: ZonedDateTime,
    /** Calendar days from today in the church's zone: 0 is today, 1 tomorrow. */
    val daysAway: Int,
)

object ServiceTimes {

    private val TIME = Regex("""^(\d{1,2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?$""")

    /**
     * `HH:mm` or `HH:mm:ss` as a wall-clock time. These are the church's own
     * times — "10:00" is the church's ten o'clock — so no zone is attached and
     * nothing is converted.
     */
    fun parse(raw: String): LocalTime? {
        val match = TIME.matchEntire(raw.trim()) ?: return null
        val hour = match.groupValues[1].toInt()
        val minute = match.groupValues[2].toInt()
        if (hour !in 0..23 || minute !in 0..59) return null
        return LocalTime.of(hour, minute)
    }

    /** `dayOfWeek` is 0-based from Sunday, matching `church_service_times`. */
    fun dayOfWeek(index: Int): DayOfWeek = when (val day = index.coerceIn(0, 6)) {
        0 -> DayOfWeek.SUNDAY
        else -> DayOfWeek.of(day)
    }

    /** The church's zone, or the device's when the server sent one Java does not know. */
    fun zone(timezone: String?): ZoneId =
        timezone?.let { runCatching { ZoneId.of(it) }.getOrNull() } ?: ZoneId.systemDefault()

    /**
     * Church-wide times first (no campus, or a campus the profile does not
     * list), with no heading. With more than one campus, the rest follow
     * grouped under each campus's name, in the profile's campus order. With
     * one campus or none there is nothing to group by, so every time is one
     * list. Each list runs Sunday to Saturday, earliest first.
     */
    fun groups(profile: ChurchProfile): List<ServiceTimeGroup> {
        val campusSlugs = profile.campuses.map { it.slug }.toSet()
        val sorted = profile.serviceTimes.sortedWith(
            compareBy<PublicServiceTime>({ it.dayOfWeek.coerceIn(0, 6) }, { parse(it.startTime) ?: LocalTime.MAX })
        )
        val (churchWide, byCampus) = sorted.partition {
            it.campusSlug.isBlank() || it.campusSlug !in campusSlugs
        }
        if (profile.campuses.size <= 1) {
            return listOf(ServiceTimeGroup(null, sorted)).filter { it.times.isNotEmpty() }
        }
        return buildList {
            if (churchWide.isNotEmpty()) add(ServiceTimeGroup(null, churchWide))
            profile.campuses.forEach { campus ->
                val times = byCampus.filter { it.campusSlug == campus.slug }
                if (times.isNotEmpty()) add(ServiceTimeGroup(campus.name, times))
            }
        }
    }

    /**
     * The soonest service starting at or after [now], computed in [zone] — the
     * zone the church's wall-clock times belong to. A service already started
     * today comes round again next week. Times that cannot be read, and days
     * outside Sunday–Saturday, are skipped rather than guessed at.
     */
    fun next(times: List<PublicServiceTime>, zone: ZoneId, now: Instant): NextService? {
        val here = now.atZone(zone)
        val today = here.toLocalDate()
        return times.mapNotNull { service ->
            if (service.dayOfWeek !in 0..6) return@mapNotNull null
            val time = parse(service.startTime) ?: return@mapNotNull null
            val ahead = (dayOfWeek(service.dayOfWeek).value - here.dayOfWeek.value + 7) % 7
            var date = today.plusDays(ahead.toLong())
            var startsAt = ZonedDateTime.of(date, time, zone)
            if (startsAt.isBefore(here)) {
                date = date.plusDays(7)
                startsAt = ZonedDateTime.of(date, time, zone)
            }
            NextService(service, startsAt, ChronoUnit.DAYS.between(today, date).toInt())
        }.minWithOrNull(compareBy<NextService>({ it.startsAt.toInstant() }, { it.service.label }))
    }
}

// ---------------------------------------------------------------------------
// Links the church controls
// ---------------------------------------------------------------------------

/** The social profiles a church can list. Anything else is a generic link. */
enum class SocialPlatform(
    /** The platform's brand colour; null means "use the church's accent". */
    val brandArgb: Long?,
) {
    INSTAGRAM(0xFFE1306C),
    FACEBOOK(0xFF1877F2),
    YOUTUBE(0xFFFF0000),
    TIKTOK(0xFF111111),
    X(0xFF111111),
    PODCAST(0xFF8E44EF),
    LINK(null);

    companion object {
        fun from(raw: String?): SocialPlatform = when (raw?.trim()?.lowercase()) {
            "instagram" -> INSTAGRAM
            "facebook" -> FACEBOOK
            "youtube" -> YOUTUBE
            "tiktok" -> TIKTOK
            "x" -> X
            "podcast" -> PODCAST
            else -> LINK
        }
    }
}

/** Where "Directions" should go. */
sealed interface DirectionsTarget {
    /** The church's own maps link. */
    data class Link(val url: String) : DirectionsTarget

    /** A street address for the maps app to search. */
    data class Address(val query: String) : DirectionsTarget

    /** A campus's exact position, labelled with its name. */
    data class Coordinates(val latitude: Double, val longitude: Double, val label: String) : DirectionsTarget
}

/** One of the tiles under the hero. */
sealed interface QuickAction {
    data class Directions(val target: DirectionsTarget) : QuickAction
    data class Call(val uri: String) : QuickAction
    data class Email(val uri: String) : QuickAction
    data class Website(val url: String) : QuickAction
}

/**
 * Turns what a church typed into something safe to hand to another app.
 *
 * Only schemes built here are ever opened — `http`/`https`, `tel:`, `mailto:`
 * and a maps query — so a profile field can never launch an arbitrary intent.
 */
object ChurchLinks {

    /** [raw] when it is an absolute http(s) URL with a host; otherwise null. */
    fun webUrl(raw: String?): String? {
        val trimmed = raw?.trim()?.takeIf { it.isNotEmpty() } ?: return null
        val uri = runCatching { URI(trimmed) }.getOrNull() ?: return null
        val scheme = uri.scheme?.lowercase() ?: return null
        if (scheme != "http" && scheme != "https") return null
        if (uri.host.isNullOrBlank()) return null
        return trimmed
    }

    /**
     * The church's website. Typed by a person, so "gracechurch.org" without
     * a scheme is read as https rather than dropped.
     */
    fun websiteUrl(raw: String?): String? {
        val trimmed = raw?.trim()?.takeIf { it.isNotEmpty() } ?: return null
        webUrl(trimmed)?.let { return it }
        if ("://" in trimmed || trimmed.any { it.isWhitespace() } || '.' !in trimmed) return null
        return webUrl("https://$trimmed")
    }

    /** "gracechurch.org" for "https://www.gracechurch.org/about". */
    fun hostName(url: String): String? =
        runCatching { URI(url).host }.getOrNull()
            ?.removePrefix("www.")
            ?.takeIf { it.isNotBlank() }

    /** `tel:` with digits and `+` only, or null when there is no number to dial. */
    fun telUri(phone: String?): String? {
        val dialable = phone.orEmpty().filter { it.isDigit() || it == '+' }
        if (dialable.count { it.isDigit() } < 3) return null
        return "tel:$dialable"
    }

    fun mailtoUri(email: String?): String? {
        val trimmed = email?.trim()?.takeIf { it.isNotEmpty() } ?: return null
        val at = trimmed.indexOf('@')
        if (at <= 0 || at == trimmed.lastIndex || trimmed.count { it == '@' } != 1) return null
        if (trimmed.any { it.isWhitespace() || it in "?&#/:<>\"" }) return null
        return "mailto:$trimmed"
    }

    /** Directions to one campus: its coordinates when it has them, else its street address. */
    fun campusDirections(campus: PublicCampus): DirectionsTarget? {
        val latitude = campus.latitude
        val longitude = campus.longitude
        if (latitude != null && longitude != null && latitude in -90.0..90.0 && longitude in -180.0..180.0) {
            return DirectionsTarget.Coordinates(latitude, longitude, campus.name)
        }
        if (campus.addressLine1.isNullOrBlank()) return null
        return ChurchActions.addressLine(campus)?.let { DirectionsTarget.Address(it) }
    }

    /**
     * Directions to the church: its own maps link first, then its street
     * address, then the main campus, then any campus that can be found.
     */
    fun churchDirections(profile: ChurchProfile): DirectionsTarget? {
        webUrl(profile.mapsUrl)?.let { return DirectionsTarget.Link(it) }
        if (!profile.address.isNullOrBlank()) {
            ChurchActions.churchAddressLine(profile)?.let { return DirectionsTarget.Address(it) }
        }
        val campuses = profile.campuses.sortedByDescending { it.isPrimary }
        return campuses.firstNotNullOfOrNull { campusDirections(it) }
    }

    /** The tiles under the hero, in order, for only what the church has filled in. */
    fun quickActions(profile: ChurchProfile): List<QuickAction> = listOfNotNull(
        churchDirections(profile)?.let { QuickAction.Directions(it) },
        telUri(profile.phone)?.let { QuickAction.Call(it) },
        mailtoUri(profile.email)?.let { QuickAction.Email(it) },
        websiteUrl(profile.website)?.let { QuickAction.Website(it) },
    )
}
