package io.faithform.app.contract

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The Church info page's action table, mirrored from the iOS suite.
 *
 * These live in `core:contract` rather than `app` so they run under
 * `gradlew test` on any runner — the rules are pure and deserve to be verified
 * without an Android SDK or an emulator. (`app`'s own `ChurchModelsTest`
 * asserts the shipped `ChurchActions` against the same table.)
 *
 * The logic under test is duplicated here rather than imported from `:app`,
 * because a pure-JVM module cannot depend on an Android module. That
 * duplication is deliberate and narrow: if the two ever disagree, the iOS suite
 * and this one encode the same specification and one of them will fail.
 */

private enum class Action { ADD, SWITCH, CURRENT, INVITATION_REQUIRED, UNAVAILABLE }

/** First match wins. `left`, `unknown` and null are "no relationship". */
private fun actionFor(policy: JoinPolicy, relationship: RelationshipState?, hasOtherChurch: Boolean): Action =
    when {
        relationship == RelationshipState.BLOCKED -> Action.UNAVAILABLE
        relationship == RelationshipState.FOLLOWING ||
            relationship == RelationshipState.PENDING ||
            relationship == RelationshipState.JOINED -> Action.CURRENT
        policy == JoinPolicy.INVITE_ONLY -> Action.INVITATION_REQUIRED
        hasOtherChurch -> Action.SWITCH
        else -> Action.ADD
    }

private fun addressLine(campus: PublicCampus): String? {
    val parts = listOfNotNull(
        campus.addressLine1, campus.city, campus.state, campus.postalCode
    ).filter { it.isNotBlank() }
    return parts.takeIf { it.isNotEmpty() }?.joinToString(", ")
}

private val POLICIES = listOf(JoinPolicy.OPEN, JoinPolicy.APPROVAL_REQUIRED, JoinPolicy.INVITE_ONLY, JoinPolicy.UNKNOWN)
private val NO_RELATIONSHIP = listOf(null, RelationshipState.LEFT, RelationshipState.UNKNOWN)

class ChurchActionTest {

    @Test
    fun `with no church yet, an open or approval church offers Add`() {
        for (state in NO_RELATIONSHIP) {
            assertEquals(Action.ADD, actionFor(JoinPolicy.OPEN, state, hasOtherChurch = false))
            assertEquals(Action.ADD, actionFor(JoinPolicy.APPROVAL_REQUIRED, state, hasOtherChurch = false))
            assertEquals(Action.ADD, actionFor(JoinPolicy.UNKNOWN, state, hasOtherChurch = false))
        }
    }

    @Test
    fun `with another church already theirs, the action is Switch`() {
        for (state in NO_RELATIONSHIP) {
            assertEquals(Action.SWITCH, actionFor(JoinPolicy.OPEN, state, hasOtherChurch = true))
            assertEquals(Action.SWITCH, actionFor(JoinPolicy.APPROVAL_REQUIRED, state, hasOtherChurch = true))
        }
    }

    @Test
    fun `an invite-only church needs an invitation whether or not another church is theirs`() {
        for (state in NO_RELATIONSHIP) {
            for (other in listOf(false, true)) {
                assertEquals(Action.INVITATION_REQUIRED, actionFor(JoinPolicy.INVITE_ONLY, state, other))
            }
        }
    }

    @Test
    fun `following, pending and joined are all simply their church`() {
        for (policy in POLICIES) {
            for (state in listOf(RelationshipState.FOLLOWING, RelationshipState.PENDING, RelationshipState.JOINED)) {
                for (other in listOf(false, true)) {
                    assertEquals(Action.CURRENT, actionFor(policy, state, other))
                }
            }
        }
    }

    @Test
    fun `blocked wins over everything`() {
        for (policy in POLICIES) {
            for (other in listOf(false, true)) {
                assertEquals(Action.UNAVAILABLE, actionFor(policy, RelationshipState.BLOCKED, other))
            }
        }
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
}

/**
 * The permission-prompting rule, shared by notifications and location.
 *
 * Duplicated from `io.faithform.app.notifications.NotificationPrompting`
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
