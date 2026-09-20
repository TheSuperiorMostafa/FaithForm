package io.faithform.app.ui.groups

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.ExperimentalAnimationApi
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.KeyboardArrowRight
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.listSaver
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshots.SnapshotStateList
import androidx.compose.runtime.toMutableStateList
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import io.faithform.app.contract.GroupDetail
import io.faithform.app.contract.GroupSummary
import io.faithform.app.design.FaithFormTokens
import io.faithform.app.design.LocalFaithFormTheme
import kotlinx.coroutines.CancellationException

/**
 * Every group surface is its own entry on a back stack.
 *
 * Sections used to swap inside one screen, so opening a group changed its
 * content with no transition and "back" meant whichever section happened to be
 * showing. A stack gives each screen a slide transition and a back arrow that
 * returns where the person came from: list → chat → group info → events or
 * members.
 */
sealed interface GroupRoute {
    val groupId: String

    data class Chat(override val groupId: String) : GroupRoute
    data class Info(override val groupId: String, val fromChat: Boolean) : GroupRoute
    data class Events(override val groupId: String) : GroupRoute
    data class Members(override val groupId: String) : GroupRoute

    companion object {
        /**
         * A joined group opens straight into its conversation, because that is
         * what people come back for. Everyone else meets the group first.
         */
        fun opening(group: GroupSummary): GroupRoute =
            if (group.membershipState == "member" && group.chat != null) Chat(group.id)
            else Info(group.id, fromChat = false)
    }
}

/**
 * Routes carry ids rather than loaded models so the whole stack can be saved
 * and restored: a rotation used to keep the open group, and it still does.
 */
private fun GroupRoute.encode(): String = when (this) {
    is GroupRoute.Chat -> "chat|$groupId"
    is GroupRoute.Info -> "info|$groupId|$fromChat"
    is GroupRoute.Events -> "events|$groupId"
    is GroupRoute.Members -> "members|$groupId"
}

private fun decodeGroupRoute(value: String): GroupRoute {
    val parts = value.split('|')
    val id = parts.getOrElse(1) { "" }
    return when (parts.firstOrNull()) {
        "chat" -> GroupRoute.Chat(id)
        "events" -> GroupRoute.Events(id)
        "members" -> GroupRoute.Members(id)
        else -> GroupRoute.Info(id, fromChat = parts.getOrNull(2)?.toBoolean() ?: false)
    }
}

@Composable fun rememberGroupStack(partitionKey: String): SnapshotStateList<GroupRoute> =
    rememberSaveable(partitionKey, saver = listSaver<SnapshotStateList<GroupRoute>, String>(
        save = { it.map(GroupRoute::encode) },
        restore = { saved -> saved.map(::decodeGroupRoute).toMutableStateList() },
    )) { mutableStateListOf() }

/**
 * Loads a group's detail for a screen that was reached by id, so events and
 * members survive a rotation without the group list having to hand them a
 * model they can no longer be given.
 */
@Composable fun GroupDetailGate(store: GroupsStore, groupId: String, content: @Composable (GroupDetail) -> Unit) {
    var detail by remember(groupId) { mutableStateOf<GroupDetail?>(null) }
    var reload by remember(groupId) { mutableIntStateOf(0) }
    LaunchedEffect(groupId, reload) {
        try { detail = store.read("${store.path}/$groupId") }
        catch (e: CancellationException) { throw e }
        catch (e: Exception) { detail = null; store.error = GroupsStore.message(e) }
    }
    val loaded = detail
    if (loaded != null) content(loaded)
    else Column(Modifier.fillMaxWidth().padding(20.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
        GroupFeedback(store)
        if (store.error == null) CircularProgressIndicator() else Button(onClick = { reload++ }) { Text("Try again") }
    }
}

/** Slides a pushed screen in from the trailing edge, and back out on a pop. */
@OptIn(ExperimentalAnimationApi::class)
@Composable fun GroupStack(stack: List<GroupRoute>, popping: Boolean, content: @Composable (GroupRoute) -> Unit) {
    val duration = LocalFaithFormTheme.current.durationMillis(FaithFormTokens.Motion.STANDARD_MS)
    AnimatedContent(
        targetState = stack.last(),
        transitionSpec = {
            val direction = if (popping) -1 else 1
            (slideInHorizontally(tween(duration)) { width -> direction * width } + fadeIn(tween(duration)))
                .togetherWith(slideOutHorizontally(tween(duration)) { width -> -direction * width / 4 } + fadeOut(tween(duration)))
        },
        label = "group-stack",
    ) { route -> content(route) }
}

/**
 * One tile per destination, so events and members are places you go rather
 * than tabs buried inside the group's story.
 */
@Composable fun GroupActionTile(icon: ImageVector, title: String, detail: String, onClick: () -> Unit, modifier: Modifier = Modifier) {
    val theme = LocalFaithFormTheme.current
    Surface(
        onClick = onClick,
        shape = RoundedCornerShape(20.dp),
        color = theme.palette.surface,
        tonalElevation = 1.dp,
        modifier = modifier.heightIn(min = 104.dp),
    ) {
        Column(
            Modifier.padding(vertical = 14.dp, horizontal = 8.dp).fillMaxWidth(),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(8.dp, Alignment.CenterVertically),
        ) {
            Surface(shape = CircleShape, color = theme.palette.surfaceSunken) {
                Icon(icon, null, Modifier.padding(11.dp).size(22.dp), tint = theme.palette.brandAccent)
            }
            Text(title, style = MaterialTheme.typography.labelLarge, fontWeight = FontWeight.SemiBold, color = theme.palette.contentPrimary)
            Text(detail, style = MaterialTheme.typography.labelSmall, color = theme.palette.contentSecondary, textAlign = TextAlign.Center)
        }
    }
}

/** A list-shaped action, used for the leader tools so they share one rhythm. */
@Composable fun GroupActionRow(icon: ImageVector, title: String, detail: String? = null, onClick: () -> Unit) {
    val theme = LocalFaithFormTheme.current
    Surface(onClick = onClick, color = theme.palette.surface, modifier = Modifier.fillMaxWidth()) {
        Row(
            Modifier.fillMaxWidth().heightIn(min = FaithFormTokens.TouchTarget.recommended).padding(vertical = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            Surface(shape = RoundedCornerShape(11.dp), color = theme.palette.surfaceSunken) {
                Icon(icon, null, Modifier.padding(8.dp).size(18.dp), tint = theme.palette.brandAccent)
            }
            Text(title, style = MaterialTheme.typography.bodyMedium, color = theme.palette.contentPrimary, modifier = Modifier.weight(1f))
            if (detail != null) Text(detail, style = MaterialTheme.typography.labelMedium, color = theme.palette.contentSecondary)
            Box { Icon(Icons.AutoMirrored.Outlined.KeyboardArrowRight, null, tint = theme.palette.contentSecondary) }
        }
    }
}
