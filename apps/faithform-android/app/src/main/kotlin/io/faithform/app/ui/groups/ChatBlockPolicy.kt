package io.faithform.app.ui.groups

/** The provider prevents direct messages; group content needs local masking too. */
internal object ChatBlockPolicy {
    fun hides(authorId: String?, currentUserId: String?, blockedUserIds: Set<String>): Boolean =
        authorId != null && authorId != currentUserId && authorId in blockedUserIds
}
