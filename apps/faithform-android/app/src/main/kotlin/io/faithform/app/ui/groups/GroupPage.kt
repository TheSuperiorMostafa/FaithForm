package io.faithform.app.ui.groups

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import io.faithform.app.ui.components.FaithFormPillSwitcher
import io.faithform.app.ui.components.FaithFormPillOption
import io.faithform.app.ui.components.FaithFormSearchField
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import android.content.Intent
import io.faithform.app.contract.*
import io.faithform.app.design.LocalFaithFormTheme
import io.faithform.app.ui.host.TabScreen
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import kotlinx.serialization.json.*

/**
 * The conversation is the group's front door.
 *
 * It is pushed from the list like any other screen, and its title bar is the
 * way into the group itself — tapping it pushes group info, so back from there
 * returns to the conversation instead of replacing it.
 */
@Composable fun GroupChatScreen(store: GroupsStore, chat: GroupChatConnection, groupId: String, onOpenInfo: () -> Unit, onBack: () -> Unit) {
    var preferences by remember { mutableStateOf(false) }
    // The list already holds everything this screen needs; a restored stack
    // that no longer has it falls back to the group's own detail.
    val cached = store.home?.items.orEmpty().firstOrNull { it.id == groupId } ?: store.discovered.firstOrNull { it.id == groupId }
    var fetched by remember(groupId) { mutableStateOf<GroupSummary?>(null) }
    LaunchedEffect(groupId, cached) {
        if (cached == null) {
            try { fetched = store.read<GroupDetail>("${store.path}/$groupId").group }
            catch (e: CancellationException) { throw e }
            catch (e: Exception) { store.error = GroupsStore.message(e) }
        }
    }
    // A leave action can happen one level deeper in group info. The shared
    // home list is refreshed, so pop this stale chat immediately when the
    // membership disappears instead of leaving a live composer behind.
    LaunchedEffect(store.home?.items, groupId) {
        val current = store.home?.items?.firstOrNull { it.id == groupId }
        if (store.home != null && current?.membershipState != "member") onBack()
    }
    val group = cached ?: fetched
    if (preferences) GroupPreferences(store, groupId, onDismiss = { preferences = false })
    if (group == null) {
        TabScreen(title = "Conversation", onBack = onBack) { modifier ->
            Column(modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) { GroupFeedback(store); if (store.error == null) CircularProgressIndicator() }
        }
        return
    }
    TabScreen(
        title = group.name,
        subtitle = "${group.memberCount} members",
        avatarUrl = group.coverImageUrl,
        showAvatar = true,
        onBack = onBack,
        onTitleClick = onOpenInfo,
        titleClickLabel = "Open group info, events and members",
        actions = { IconButton(onClick = { preferences = true }) { Icon(Icons.Outlined.NotificationsNone, "Group notifications") } },
    ) { modifier ->
        Box(modifier) {
            val conversation = group.chat
            if (conversation == null) GroupEmpty("No conversation yet", "This group's conversation isn't open. You'll find everything else in group info.")
            else GroupConversation(
                store,
                chat,
                conversation.cid,
                readOnly = conversation.state != "ready" || (conversation.postingPolicy == "leaders" && group.groupRole == "member"),
                showHeader = false,
                onBack = onBack,
            )
        }
    }
}

/**
 * Everything the group *is*: who it's for, when it meets, who leads it — plus
 * the doors to its gatherings and its people, which are their own screens
 * rather than sections of this one.
 */
@Composable fun GroupInfoScreen(store: GroupsStore, groupId: String, fromChat: Boolean, onOpen: (GroupRoute) -> Unit, onBack: () -> Unit) {
    var editing by remember { mutableStateOf(false) }
    var detail by remember(groupId) { mutableStateOf<GroupDetail?>(null) }
    var reload by remember { mutableIntStateOf(0) }
    var confirmingLeave by remember { mutableStateOf(false) }
    var asking by remember { mutableStateOf(false) }
    var note by remember { mutableStateOf("") }
    var requests by remember { mutableStateOf(false) }
    var preferences by remember { mutableStateOf(false) }
    var invite by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    val uri = LocalUriHandler.current
    val theme = LocalFaithFormTheme.current
    LaunchedEffect(groupId, reload) { try { detail = store.read("${store.path}/$groupId") } catch (e: CancellationException) { throw e } catch (e: Exception) { detail = null; store.error = GroupsStore.message(e) } }
    if (preferences) GroupPreferences(store, groupId, onDismiss = { preferences = false })
    if (requests) GroupRequests(store, groupId, onDismiss = { requests = false; reload++ })
    if (editing && detail != null) GroupEdit(store, detail!!, onDismiss = { editing = false }, saved = { reload++ })
    if (confirmingLeave) AlertDialog(onDismissRequest = { confirmingLeave = false }, title = { Text("Leave this group?") }, text = { Text("You will lose access to this group\u2019s conversation. You can ask to join again later.") }, dismissButton = { TextButton(onClick = { confirmingLeave = false }) { Text("Stay") } }, confirmButton = { TextButton(enabled = !store.busy, onClick = { scope.launch { detail?.group?.let { if (store.membership(it)) onBack() }; confirmingLeave = false } }) { Text("Leave group") } })
    if (asking) GroupFormSheet("Ask to join", onDismiss = { asking = false }) {
        Text("Say hello to the leaders. A short introduction can help you feel at home.", style = MaterialTheme.typography.bodyMedium)
        OutlinedTextField(note, { note = it.take(500) }, label = { Text("What brings you here? (optional)") }, minLines = 3, modifier = Modifier.fillMaxWidth())
        GroupFeedback(store)
        Button(enabled = !store.busy, onClick = { scope.launch { detail?.group?.let { if (store.membership(it, note)) { asking = false; reload++ } } } }, modifier = Modifier.fillMaxWidth()) { Text("Send request") }
    }
    TabScreen(
        title = detail?.group?.name ?: "Group",
        onBack = onBack,
        actions = { if (detail?.group?.membershipState == "member") IconButton(onClick = { preferences = true }) { Icon(Icons.Outlined.NotificationsNone, "Group notifications") } },
        // The group's wash runs up behind the title bar so the header is one
        // surface rather than stopping at a seam under it.
        behind = { GroupAvatarBackdrop(detail?.group?.coverImageUrl, Modifier.fillMaxWidth().height(380.dp).align(Alignment.TopCenter)) },
    ) { modifier ->
        val d = detail
        if (d == null) Column(modifier.padding(20.dp)) { GroupFeedback(store); if (store.error == null) CircularProgressIndicator() else Button(onClick = { reload++ }) { Text("Try again") } }
        else LazyColumn(modifier, verticalArrangement = Arrangement.spacedBy(20.dp)) {
            item {
                Box(Modifier.fillMaxWidth()) {
                    Column(Modifier.fillMaxWidth().padding(horizontal = 24.dp, vertical = 24.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(14.dp)) {
                        GroupAvatar(d.group.coverImageUrl, d.group.name, 108.dp)
                        Text(d.group.name, style = MaterialTheme.typography.headlineLarge, fontWeight = FontWeight.SemiBold, textAlign = TextAlign.Center)
                        Text(
                            listOfNotNull(d.group.type?.name ?: "Community", "${d.group.memberCount} members", d.group.scheduleText).joinToString(" \u00b7 "),
                            style = MaterialTheme.typography.bodyMedium,
                            color = theme.palette.contentSecondary,
                            textAlign = TextAlign.Center,
                        )
                        val badges = buildList {
                            if (d.isArchived) add("Archived")
                            if (d.group.isYouth) add("Youth group")
                            when {
                                d.group.membershipState == "member" -> add("Your group")
                                d.group.membershipState == "requested" -> add("Request sent")
                                d.group.enrollment == "open" -> add("Open to join")
                            }
                        }
                        if (badges.isNotEmpty()) Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) { badges.forEach { GroupBadge(it) } }
                    }
                }
            }
            item {
                Row(Modifier.fillMaxWidth().padding(horizontal = 20.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    if (d.group.chat != null && d.group.membershipState == "member") {
                        GroupActionTile(Icons.Outlined.ChatBubbleOutline, "Chat", if (fromChat) "Back to messages" else "Open conversation", onClick = { if (fromChat) onBack() else onOpen(GroupRoute.Chat(d.group.id)) }, modifier = Modifier.weight(1f))
                    }
                    GroupActionTile(Icons.Outlined.CalendarMonth, "Events", if (d.upcomingEvents.isEmpty()) "Nothing planned" else "${d.upcomingEvents.size} coming up", onClick = { onOpen(GroupRoute.Events(groupId)) }, modifier = Modifier.weight(1f))
                    if (d.capabilities.canViewMembers) {
                        GroupActionTile(Icons.Outlined.Groups, "Members", "${d.group.memberCount} people", onClick = { onOpen(GroupRoute.Members(groupId)) }, modifier = Modifier.weight(1f))
                    }
                }
            }
            item { Box(Modifier.padding(horizontal = 20.dp)) { GroupFeedback(store) } }
            d.description?.takeIf { it.isNotBlank() }?.let { text ->
                item { Box(Modifier.padding(horizontal = 20.dp)) { GroupPanel("About this group") { Text(text, style = MaterialTheme.typography.bodyMedium, color = theme.palette.contentSecondary) } } }
            }
            item { Box(Modifier.padding(horizontal = 20.dp)) { GroupPanel("When & where") {
                d.schedules.forEach { Text(it.text, style = MaterialTheme.typography.bodyMedium) }
                d.location?.let { location -> location.name?.let { Text(it) }; location.address?.let { Text(it, style = MaterialTheme.typography.bodyMedium) }; if (location.membersOnly && location.address == null) Text("The meeting address is shared with members.", style = MaterialTheme.typography.bodySmall); location.onlineMeetingUrl?.let { link -> TextButton(onClick = { uri.openUri(link) }) { Text("Join online meeting") } } } ?: if (d.schedules.isEmpty()) Text("Details will be shared soon.", style = MaterialTheme.typography.bodyMedium) else Unit
            } } }
            if (d.leaders.isNotEmpty()) item { Box(Modifier.padding(horizontal = 20.dp)) { GroupPanel("Here to welcome you") { d.leaders.forEach { leader -> Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) { GroupAvatar(leader.avatarUrl, leader.name, 40.dp); Column(Modifier.weight(1f)) { Text(leader.name, fontWeight = FontWeight.SemiBold); Text(leader.groupRole.replaceFirstChar { it.uppercase() }, style = MaterialTheme.typography.labelSmall, color = theme.palette.contentSecondary) } } } } } }
            val canManage = d.capabilities.canEditDetails || d.capabilities.canManageRequests || d.capabilities.canInvite
            if (canManage) item { Box(Modifier.padding(horizontal = 20.dp)) { GroupPanel("Leader tools") {
                if (d.capabilities.canEditDetails) GroupActionRow(Icons.Outlined.Edit, "Edit group details") { editing = true }
                if (d.capabilities.canManageRequests) GroupActionRow(Icons.Outlined.PersonAddAlt, "Join requests", "${d.pendingRequestCount}") { requests = true }
                if (d.capabilities.canInvite) GroupActionRow(Icons.Outlined.Share, "Invite someone") { scope.launch { store.action("Invitation ready to share.") { invite = store.send<GroupInvitation>("${store.path}/$groupId/invitations").url } } }
                invite?.let { url -> GroupActionRow(Icons.Outlined.Link, "Share your invitation") { context.startActivity(Intent.createChooser(Intent(Intent.ACTION_SEND).apply { type = "text/plain"; putExtra(Intent.EXTRA_TEXT, url) }, "Share invitation")) } }
            } } }
            item {
                Box(Modifier.padding(horizontal = 20.dp, vertical = 4.dp)) {
                    when (d.group.joinAction) {
                        "join" -> Button(enabled = !store.busy, onClick = { scope.launch { store.membership(d.group); reload++ } }, modifier = Modifier.fillMaxWidth()) { Text("Join this group") }
                        "request" -> Button(onClick = { asking = true }, modifier = Modifier.fillMaxWidth()) { Text("Ask to join") }
                        "cancel_request" -> Column { Text("Your request is with the group leaders.", style = MaterialTheme.typography.bodyMedium); TextButton(enabled = !store.busy, onClick = { scope.launch { store.membership(d.group); reload++ } }) { Text("Cancel request") } }
                        "leave" -> TextButton(onClick = { confirmingLeave = true }, modifier = Modifier.fillMaxWidth()) { Text("Leave group", color = MaterialTheme.colorScheme.error) }
                        else -> Text(if (d.group.joinAction == "full") "This group is currently full." else if (d.group.joinAction == "invitation_required") "Ask a leader for an invitation to join." else "This group isn\u2019t accepting members right now.", style = MaterialTheme.typography.bodyMedium)
                    }
                }
            }
            item { Spacer(Modifier.height(24.dp)) }
        }
    }
}

@Composable fun GroupMembers(store: GroupsStore, detail: GroupDetail) {
    var members by remember(detail.group.id) { mutableStateOf<List<GroupMember>>(emptyList()) }
    var cursor by remember { mutableStateOf<String?>(null) }
    var loaded by remember { mutableStateOf(false) }
    var query by remember { mutableStateOf("") }
    var selected by remember { mutableStateOf<GroupMember?>(null) }
    var safety by remember { mutableStateOf<GroupMember?>(null) }
    var removing by remember { mutableStateOf<GroupMember?>(null) }
    var ban by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    suspend fun load(more: Boolean = false) { try { val page = store.read<GroupMemberPage>("${store.path}/${detail.group.id}/members", if (more) mapOf("cursor" to (cursor ?: "")) else emptyMap()); members = if (more) members + page.items else page.items; cursor = page.nextCursor; loaded = true } catch (e: CancellationException) { throw e } catch (e: Exception) { store.error = GroupsStore.message(e); loaded = true } }
    LaunchedEffect(detail.group.id) { load() }
    LazyColumn(contentPadding = PaddingValues(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        item { FaithFormSearchField(query, { query = it }, "Find someone", onSearch = {}) }
        item { GroupFeedback(store) }
        if (!loaded) item { CircularProgressIndicator() }
        items(members.filter { query.isEmpty() || it.name.contains(query, ignoreCase = true) }, key = { it.membershipId }) { member ->
            Row(Modifier.fillMaxWidth().padding(vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Outlined.AccountCircle, null, Modifier.size(36.dp)); Spacer(Modifier.width(12.dp))
                Column(Modifier.weight(1f)) { Text(member.name, fontWeight = FontWeight.SemiBold); Text((if (member.isYou) "You · " else "") + member.groupRole.replaceFirstChar { it.uppercase() }, style = MaterialTheme.typography.bodySmall) }
                if (!member.isYou) Box {
                    IconButton(onClick = { selected = member }) { Icon(Icons.Outlined.MoreHoriz, "Actions for ${member.name}") }
                    DropdownMenu(expanded = selected?.membershipId == member.membershipId, onDismissRequest = { selected = null }) {
                        if (member.chatUserId != null && detail.group.chat != null) DropdownMenuItem(text = { Text("Report or block") }, onClick = { selected = null; safety = member })
                        if (detail.capabilities.canManageRoles) listOf("member", "leader", "manager").filter { it != member.groupRole }.forEach { role -> DropdownMenuItem(text = { Text("Make $role") }, onClick = { selected = null; scope.launch { store.action("Role updated.") { store.send<GroupCommandResult>("${store.path}/${detail.group.id}/members/${member.membershipId}", buildJsonObject { put("groupRole", role) }, "PATCH"); load() } } }) }
                        if (detail.capabilities.canManageMembers) DropdownMenuItem(text = { Text("Remove from group") }, onClick = { selected = null; removing = member; ban = false })
                    }
                }
            }
        }
        if (cursor != null) item { TextButton(onClick = { scope.launch { load(true) } }) { Text("More members") } }
        if (loaded && members.isEmpty()) item { GroupEmpty("No members to show", "People will appear here when they join.") }
    }
    safety?.let { member -> GroupSafety(store, detail.group.chat!!.cid, member.chatUserId!!, member.name, onDismiss = { safety = null }) }
    removing?.let { member -> AlertDialog(onDismissRequest = { removing = null }, title = { Text("Remove ${member.name}?") }, text = { Column { Text("They will lose access to this group and its conversation."); Row(verticalAlignment = Alignment.CenterVertically) { Checkbox(ban, { ban = it }); Text("Prevent rejoining") }; GroupFeedback(store) } }, dismissButton = { TextButton(onClick = { removing = null }) { Text("Cancel") } }, confirmButton = { TextButton(enabled = !store.busy, onClick = { scope.launch { if (store.action("Member removed.") { store.send<GroupCommandResult>("${store.path}/${detail.group.id}/members/${member.membershipId}/remove", buildJsonObject { put("ban", ban) }); load() }) removing = null } }) { Text("Remove") } }) }
}
