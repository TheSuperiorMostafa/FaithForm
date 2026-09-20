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
import androidx.compose.ui.unit.dp
import android.content.Intent
import io.faithform.app.contract.*
import io.faithform.app.design.LocalFaithFormTheme
import io.faithform.app.ui.host.TabScreen
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import kotlinx.serialization.json.*

@Composable fun GroupPage(store: GroupsStore, chat: GroupChatConnection, groupId: String, onBack: () -> Unit) {
    var editing by remember { mutableStateOf(false) }
    var detail by remember(groupId) { mutableStateOf<GroupDetail?>(null) }
    var tab by remember(groupId) { mutableStateOf("Overview") }
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
    if (confirmingLeave) AlertDialog(onDismissRequest = { confirmingLeave = false }, title = { Text("Leave this group?") }, text = { Text("You will lose access to this group’s conversation. You can ask to join again later.") }, dismissButton = { TextButton(onClick = { confirmingLeave = false }) { Text("Stay") } }, confirmButton = { TextButton(enabled = !store.busy, onClick = { scope.launch { detail?.group?.let { if (store.membership(it)) onBack() }; confirmingLeave = false } }) { Text("Leave group") } })
    if (asking) GroupFormSheet("Ask to join", onDismiss = { asking = false }) {
        Text("Say hello to the leaders. A short introduction can help you feel at home.", style = MaterialTheme.typography.bodyMedium)
        OutlinedTextField(note, { note = it.take(500) }, label = { Text("What brings you here? (optional)") }, minLines = 3, modifier = Modifier.fillMaxWidth())
        GroupFeedback(store)
        Button(enabled = !store.busy, onClick = { scope.launch { detail?.group?.let { if (store.membership(it, note)) { asking = false; reload++ } } } }, modifier = Modifier.fillMaxWidth()) { Text("Send request") }
    }
    TabScreen(title = detail?.group?.name ?: "Group", onBack = onBack, actions = { if (detail?.group?.membershipState == "member") IconButton(onClick = { preferences = true }) { Icon(Icons.Outlined.NotificationsNone, "Group notifications") } }) { modifier ->
        val d = detail
        if (d == null) Column(modifier.padding(20.dp)) { GroupFeedback(store); if (store.error == null) CircularProgressIndicator() else Button(onClick = { reload++ }) { Text("Try again") } }
        else Column(modifier) {
            val tabs = listOfNotNull("Overview", if (d.group.chat != null) "Chat" else null, "Events", if (d.capabilities.canViewMembers) "Members" else null)
            FaithFormPillSwitcher(options = tabs.map { FaithFormPillOption(it, it) }, selected = tab, onSelect = { tab = it }, modifier = Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 12.dp))
            when (tab) {
                "Chat" -> d.group.chat?.let { GroupConversation(store, chat, it.cid, readOnly = it.state != "ready" || (it.postingPolicy == "leaders" && d.group.groupRole == "member"), showHeader = false, onBack = { tab = "Overview" }) }
                "Events" -> GroupEvents(store, d)
                "Members" -> GroupMembers(store, d)
                else -> LazyColumn(contentPadding = PaddingValues(20.dp), verticalArrangement = Arrangement.spacedBy(20.dp)) {
                    item { GroupCover(d.group.coverImageUrl, Modifier.height(190.dp).clip(RoundedCornerShape(22.dp))) }
                    item { Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) { GroupBadge(d.group.type?.name ?: "Community"); if (d.isArchived) GroupBadge("Archived"); if (d.group.isYouth) GroupBadge("Youth group") } }
                    item { Text(d.group.name, style = MaterialTheme.typography.headlineLarge, fontWeight = FontWeight.SemiBold); Spacer(Modifier.height(10.dp)); Text("${d.group.memberCount} members", style = MaterialTheme.typography.bodyMedium, color = theme.palette.contentSecondary) }
                    item { GroupFeedback(store) }
                    d.description?.let { text -> item { Text(text, style = MaterialTheme.typography.bodyLarge, color = theme.palette.contentSecondary) } }
                    item { GroupPanel("When & where") {
                        d.schedules.forEach { Text(it.text, style = MaterialTheme.typography.bodyMedium) }
                        d.location?.let { location -> location.name?.let { Text(it) }; location.address?.let { Text(it, style = MaterialTheme.typography.bodyMedium) }; if (location.membersOnly && location.address == null) Text("The meeting address is shared with members.", style = MaterialTheme.typography.bodySmall); location.onlineMeetingUrl?.let { link -> TextButton(onClick = { uri.openUri(link) }) { Text("Join online meeting") } } } ?: if (d.schedules.isEmpty()) Text("Details will be shared soon.", style = MaterialTheme.typography.bodyMedium) else Unit
                    } }
                    if (d.leaders.isNotEmpty()) item { GroupPanel("Here to welcome you") { d.leaders.forEach { leader -> Row(verticalAlignment = Alignment.CenterVertically) { Icon(Icons.Outlined.AccountCircle, null); Spacer(Modifier.width(12.dp)); Text(leader.name, modifier = Modifier.weight(1f)); Text(leader.groupRole.replaceFirstChar { it.uppercase() }, style = MaterialTheme.typography.labelSmall) } } } }
                    if (d.capabilities.canEditDetails) item { OutlinedButton(onClick = { editing = true }, modifier = Modifier.fillMaxWidth()) { Text("Edit group details") } }
                    if (d.capabilities.canManageRequests) item { OutlinedButton(onClick = { requests = true }, modifier = Modifier.fillMaxWidth()) { Text("Join requests (${d.pendingRequestCount})") } }
                    if (d.capabilities.canInvite) item { OutlinedButton(enabled = !store.busy, onClick = { scope.launch { store.action("Invitation ready to share.") { invite = store.send<GroupInvitation>("${store.path}/$groupId/invitations").url } } }, modifier = Modifier.fillMaxWidth()) { Text("Invite someone") } }
                    invite?.let { url -> item { Button(onClick = { context.startActivity(Intent.createChooser(Intent(Intent.ACTION_SEND).apply { type = "text/plain"; putExtra(Intent.EXTRA_TEXT, url) }, "Share invitation")) }, modifier = Modifier.fillMaxWidth()) { Icon(Icons.Outlined.Share, null); Spacer(Modifier.width(8.dp)); Text("Share invitation") } } }
                    item {
                        when (d.group.joinAction) {
                            "join" -> Button(enabled = !store.busy, onClick = { scope.launch { store.membership(d.group); reload++ } }, modifier = Modifier.fillMaxWidth()) { Text("Join this group") }
                            "request" -> Button(onClick = { asking = true }, modifier = Modifier.fillMaxWidth()) { Text("Ask to join") }
                            "cancel_request" -> Column { Text("Your request is with the group leaders.", style = MaterialTheme.typography.bodyMedium); TextButton(enabled = !store.busy, onClick = { scope.launch { store.membership(d.group); reload++ } }) { Text("Cancel request") } }
                            "leave" -> TextButton(onClick = { confirmingLeave = true }) { Text("Leave group", color = MaterialTheme.colorScheme.error) }
                            else -> Text(if (d.group.joinAction == "full") "This group is currently full." else if (d.group.joinAction == "invitation_required") "Ask a leader for an invitation to join." else "This group isn’t accepting members right now.", style = MaterialTheme.typography.bodyMedium)
                        }
                    }
                    item { TextButton(onClick = { reload++ }) { Text("Refresh details") } }
                }
            }
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
