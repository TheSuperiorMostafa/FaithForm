package io.faithform.faithful.ui.church

import io.faithform.faithful.contract.ChurchProfile
import io.faithform.faithful.contract.JoinPolicy
import io.faithform.faithful.contract.PublicCampus
import io.faithform.faithful.contract.PublicServiceTime
import io.faithform.faithful.contract.RelationshipState
import io.faithform.faithful.storage.CachePartition
import kotlinx.serialization.Serializable

/** The church profile's state. Every case is one the contract can produce. */
sealed interface ChurchProfilePhase {
    data object Loading : ChurchProfilePhase
    data class Loaded(val profile: ChurchProfile) : ChurchProfilePhase
    data object NotFound : ChurchProfilePhase
    data object Offline : ChurchProfilePhase
    data class Failed(val message: String) : ChurchProfilePhase
}

/**
 * What the primary action on a profile should do right now.
 *
 * Derived from the policy and the caller's relationship rather than stored, so
 * a relationship that changed on the server cannot leave a stale button behind.
 * Mirrors the iOS `ChurchAction` exactly — same rules, arrived at from the same
 * specification.
 */
enum class ChurchAction {
    FOLLOW, REQUEST_TO_JOIN, JOIN_IMMEDIATELY, INVITATION_REQUIRED, PENDING, LEAVE, UNAVAILABLE
}

object ChurchActions {
    fun forProfile(profile: ChurchProfile): ChurchAction = when (profile.relationshipState) {
        RelationshipState.BLOCKED -> ChurchAction.UNAVAILABLE
        RelationshipState.PENDING -> ChurchAction.PENDING
        RelationshipState.JOINED -> ChurchAction.LEAVE
        RelationshipState.FOLLOWING -> when (profile.joinPolicy) {
            JoinPolicy.OPEN -> ChurchAction.JOIN_IMMEDIATELY
            JoinPolicy.APPROVAL_REQUIRED -> ChurchAction.REQUEST_TO_JOIN
            JoinPolicy.INVITE_ONLY -> ChurchAction.INVITATION_REQUIRED
            else -> ChurchAction.LEAVE
        }
        else -> when (profile.joinPolicy) {
            JoinPolicy.INVITE_ONLY -> ChurchAction.INVITATION_REQUIRED
            else -> ChurchAction.FOLLOW
        }
    }

    fun addressLine(campus: PublicCampus): String? {
        val parts = listOfNotNull(
            campus.addressLine1, campus.city, campus.state, campus.postalCode
        ).filter { it.isNotBlank() }
        return parts.takeIf { it.isNotEmpty() }?.joinToString(", ")
    }

    /** `dayOfWeek` is 0-based from Sunday, matching `church_service_times`. */
    fun serviceLine(service: PublicServiceTime, dayNames: List<String>): String {
        val index = service.dayOfWeek.coerceIn(0, 6)
        // Times arrive as HH:mm:ss; the seconds are never meaningful here.
        val time = service.startTime.take(5)
        return "${dayNames[index]} $time · ${service.label}"
    }
}

// ---------------------------------------------------------------------------
// Church chooser
// ---------------------------------------------------------------------------

@Serializable
data class ChooserChurch(
    val slug: String,
    val name: String,
    val logoUrl: String? = null,
    val state: RelationshipState
)

@Serializable
data class ChooserPage(val items: List<ChooserChurch>)

@Serializable
data class SelectChurchRequestBody(val churchSlug: String?)

@Serializable
data class SelectChurchReply(
    val selectedChurchSlug: String? = null,
    val authorizationVersion: Int
)

sealed interface ChooserPhase {
    data object Loading : ChooserPhase
    data class Loaded(val churches: List<ChooserChurch>) : ChooserPhase
    data object Empty : ChooserPhase
    data object Offline : ChooserPhase
    data class Failed(val message: String) : ChooserPhase
}

data class SwitchResult(val selectedSlug: String?, val partition: CachePartition)

/**
 * Which churches may actually be switched to.
 *
 * `blocked` and `left` are shown so their absence is not mysterious, but they
 * are not selectable — and the server checks again regardless, because a
 * chooser entry is not authorization.
 */
fun ChooserChurch.isSelectable(): Boolean =
    state != RelationshipState.BLOCKED && state != RelationshipState.LEFT
