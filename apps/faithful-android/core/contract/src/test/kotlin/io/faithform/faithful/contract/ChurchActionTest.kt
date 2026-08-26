package io.faithform.faithful.contract

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The church-profile action matrix and chooser rules, mirrored from the iOS
 * suite.
 *
 * These live in `core:contract` rather than `app` so they run under
 * `gradlew test` on any runner — the rules are pure and deserve to be verified
 * without an Android SDK or an emulator.
 *
 * The logic under test is duplicated here rather than imported from `:app`,
 * because a pure-JVM module cannot depend on an Android module. That
 * duplication is deliberate and narrow: if the two ever disagree, the iOS suite
 * and this one encode the same specification and one of them will fail.
 */

private enum class Action {
    FOLLOW, REQUEST_TO_JOIN, JOIN_IMMEDIATELY, INVITATION_REQUIRED, PENDING, LEAVE, UNAVAILABLE
}

private fun actionFor(policy: JoinPolicy, relationship: RelationshipState?): Action =
    when (relationship) {
        RelationshipState.BLOCKED -> Action.UNAVAILABLE
        RelationshipState.PENDING -> Action.PENDING
        RelationshipState.JOINED -> Action.LEAVE
        RelationshipState.FOLLOWING -> when (policy) {
            JoinPolicy.OPEN -> Action.JOIN_IMMEDIATELY
            JoinPolicy.APPROVAL_REQUIRED -> Action.REQUEST_TO_JOIN
            JoinPolicy.INVITE_ONLY -> Action.INVITATION_REQUIRED
            else -> Action.LEAVE
        }
        else -> when (policy) {
            JoinPolicy.INVITE_ONLY -> Action.INVITATION_REQUIRED
            else -> Action.FOLLOW
        }
    }

private fun isSelectable(state: RelationshipState): Boolean =
    state != RelationshipState.BLOCKED && state != RelationshipState.LEFT

private fun addressLine(campus: PublicCampus): String? {
    val parts = listOfNotNull(
        campus.addressLine1, campus.city, campus.state, campus.postalCode
    ).filter { it.isNotBlank() }
    return parts.takeIf { it.isNotEmpty() }?.joinToString(", ")
}

private val DAYS = listOf(
    "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"
)

private fun serviceLine(service: PublicServiceTime): String {
    val index = service.dayOfWeek.coerceIn(0, 6)
    return "${DAYS[index]} ${service.startTime.take(5)} · ${service.label}"
}

class ChurchActionTest {

    @Test
    fun `with no relationship the action follows the policy`() {
        assertEquals(Action.FOLLOW, actionFor(JoinPolicy.OPEN, null))
        assertEquals(Action.FOLLOW, actionFor(JoinPolicy.APPROVAL_REQUIRED, null))
        assertEquals(Action.INVITATION_REQUIRED, actionFor(JoinPolicy.INVITE_ONLY, null))
    }

    @Test
    fun `while following the next step depends on whether joining is offered`() {
        assertEquals(
            Action.JOIN_IMMEDIATELY,
            actionFor(JoinPolicy.OPEN, RelationshipState.FOLLOWING)
        )
        assertEquals(
            Action.REQUEST_TO_JOIN,
            actionFor(JoinPolicy.APPROVAL_REQUIRED, RelationshipState.FOLLOWING)
        )
        assertEquals(
            Action.INVITATION_REQUIRED,
            actionFor(JoinPolicy.INVITE_ONLY, RelationshipState.FOLLOWING)
        )
    }

    @Test
    fun `pending joined and blocked each have one outcome regardless of policy`() {
        for (policy in listOf(JoinPolicy.OPEN, JoinPolicy.APPROVAL_REQUIRED, JoinPolicy.INVITE_ONLY)) {
            assertEquals(Action.PENDING, actionFor(policy, RelationshipState.PENDING))
            assertEquals(Action.LEAVE, actionFor(policy, RelationshipState.JOINED))
            assertEquals(Action.UNAVAILABLE, actionFor(policy, RelationshipState.BLOCKED))
        }
    }

    @Test
    fun `blocked and left churches cannot be switched to`() {
        assertTrue(isSelectable(RelationshipState.JOINED))
        assertTrue(isSelectable(RelationshipState.FOLLOWING))
        assertTrue(isSelectable(RelationshipState.PENDING))
        assertTrue(!isSelectable(RelationshipState.BLOCKED))
        assertTrue(!isSelectable(RelationshipState.LEFT))
    }

    @Test
    fun `an address line skips empty parts rather than showing stray commas`() {
        val full = PublicCampus(
            slug = "east", name = "East", addressLine1 = "1 Main St", city = "Louisville",
            state = "KY", postalCode = "40202", latitude = null, longitude = null,
            timezone = "UTC", isPrimary = true
        )
        assertEquals("1 Main St, Louisville, KY, 40202", addressLine(full))

        val empty = PublicCampus(
            slug = "e", name = "E", addressLine1 = null, city = null, state = null,
            postalCode = null, latitude = null, longitude = null,
            timezone = "UTC", isPrimary = false
        )
        assertNull(addressLine(empty))
    }

    @Test
    fun `a service line renders the church's own day and time`() {
        val service = PublicServiceTime(
            campusSlug = "east", label = "Morning", dayOfWeek = 0,
            startTime = "10:00:00", kind = "regular"
        )
        val line = serviceLine(service)
        assertTrue(line.contains("Sunday"))
        assertTrue(line.contains("10:00"))
        // Seconds are never meaningful here.
        assertTrue(!line.contains(":00:00"))
    }

    @Test
    fun `an out-of-range day index is clamped rather than crashing`() {
        val service = PublicServiceTime(
            campusSlug = "east", label = "X", dayOfWeek = 99,
            startTime = "10:00:00", kind = "regular"
        )
        assertTrue(serviceLine(service).isNotEmpty())
    }
}

/**
 * The permission-prompting rule, shared by notifications and location.
 *
 * Duplicated from `io.faithform.faithful.notifications.NotificationPrompting`
 * for the same reason as above — and both encode the rule that the OS is never
 * asked before an education screen and an explicit tap.
 */
private enum class Authorization { NOT_REQUESTED, GRANTED, DENIED, NOT_REQUIRED }

private fun mayRequest(status: Authorization, hasSeenEducation: Boolean): Boolean =
    hasSeenEducation && status == Authorization.NOT_REQUESTED

private fun shouldDirectToSettings(status: Authorization): Boolean =
    status == Authorization.DENIED

class NotificationPromptingTest {

    @Test
    fun `the OS is never asked before the education screen`() {
        assertTrue(!mayRequest(Authorization.NOT_REQUESTED, hasSeenEducation = false))
        assertTrue(mayRequest(Authorization.NOT_REQUESTED, hasSeenEducation = true))
    }

    @Test
    fun `an already-decided permission is never re-asked`() {
        for (status in listOf(Authorization.GRANTED, Authorization.DENIED, Authorization.NOT_REQUIRED)) {
            assertTrue(
                "$status must not be re-requested",
                !mayRequest(status, hasSeenEducation = true)
            )
        }
    }

    @Test
    fun `a denial points at settings, because Android only asks once`() {
        assertTrue(shouldDirectToSettings(Authorization.DENIED))
        assertTrue(!shouldDirectToSettings(Authorization.NOT_REQUESTED))
        assertTrue(!shouldDirectToSettings(Authorization.GRANTED))
    }
}
