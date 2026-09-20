package io.faithform.app.ui.groups

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.KeyboardArrowRight
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import io.faithform.app.ui.components.FaithFormPillSwitcher
import io.faithform.app.ui.components.FaithFormPillOption
import io.faithform.app.ui.components.FaithFormSearchField
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import io.faithform.app.contract.GroupSummary
import io.faithform.app.design.LocalFaithFormTheme
import io.faithform.app.network.ApiClient
import io.faithform.app.ui.host.TabScreen
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

@Composable fun GroupsHost(api: ApiClient, churchSlug: String, partitionKey: String) {
    val store = remember(partitionKey) { GroupsStore(api, churchSlug) }
    val chat = remember(partitionKey) { GroupChatConnection() }
    val scope = rememberCoroutineScope()
    val stack = rememberGroupStack(partitionKey)
    var popping by remember(partitionKey) { mutableStateOf(false) }
    var section by rememberSaveable(partitionKey) { mutableStateOf("My groups") }
    var query by rememberSaveable(partitionKey) { mutableStateOf("") }
    var category by rememberSaveable(partitionKey) { mutableStateOf("") }
    var preferences by remember { mutableStateOf(false) }
    val theme = LocalFaithFormTheme.current
    DisposableEffect(chat) { onDispose { chat.disconnect() } }
    LaunchedEffect(store) { store.load() }
    if (preferences) GroupPreferences(store, onDismiss = { preferences = false })
    if (stack.isNotEmpty()) {
        val pop: () -> Unit = { popping = true; stack.removeAt(stack.lastIndex) }
        val push: (GroupRoute) -> Unit = { popping = false; stack.add(it) }
        BackHandler(onBack = pop)
        GroupStack(stack, popping) { route ->
            when (route) {
                is GroupRoute.Chat -> GroupChatScreen(store, chat, route.groupId, onOpenInfo = { push(GroupRoute.Info(route.groupId, fromChat = true)) }, onBack = pop)
                is GroupRoute.Info -> GroupInfoScreen(store, route.groupId, route.fromChat, onOpen = push, onBack = pop)
                is GroupRoute.Events -> TabScreen(title = "Gatherings", onBack = pop) { modifier -> Box(modifier) { GroupDetailGate(store, route.groupId) { GroupEvents(store, it) } } }
                is GroupRoute.Members -> TabScreen(title = "Members", onBack = pop) { modifier -> Box(modifier) { GroupDetailGate(store, route.groupId) { GroupMembers(store, it) } } }
            }
        }
        return
    }
    LaunchedEffect(section, query, category) { if (section == "Discover") { delay(250); store.discover(query, category) } }
    LaunchedEffect(store.home?.directMessagesEnabled) { if (store.home?.directMessagesEnabled != true && section == "Messages") section = "My groups" }
    TabScreen(title = "Groups", actions = { IconButton(onClick = { preferences = true }) { Icon(Icons.Outlined.NotificationsNone, "Messaging preferences") } }) { modifier ->
        Column(modifier) {
            val sections = if (store.home?.directMessagesEnabled == true) listOf("My groups", "Discover", "Messages") else listOf("My groups", "Discover")
            FaithFormPillSwitcher(options = sections.map { FaithFormPillOption(it, it) }, selected = section, onSelect = { section = it }, modifier = Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 8.dp))
            if (section == "Messages") GroupMessages(store, chat)
            else LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(20.dp), verticalArrangement = Arrangement.spacedBy(18.dp)) {
                item {
                    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                        Text("LIFE TOGETHER", style = MaterialTheme.typography.labelSmall, color = theme.palette.brandAccent)
                        Text(if (section == "My groups") "You belong here." else "Find your people.", style = MaterialTheme.typography.headlineLarge, fontWeight = FontWeight.SemiBold, color = theme.palette.contentPrimary)
                        Text(if (section == "My groups") "Familiar faces. Meaningful conversations. A place to grow, together." else "There’s a place for you in this community.", style = MaterialTheme.typography.bodyMedium, color = theme.palette.contentSecondary)
                    }
                }
                if (section == "Discover") {
                    item { FaithFormSearchField(query, { query = it }, "Search groups", onSearch = {}) }
                    item { LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) { item { FilterChip(category.isEmpty(), { category = "" }, label = { Text("All groups") }, shape = RoundedCornerShape(50), colors = FilterChipDefaults.filterChipColors(selectedContainerColor = theme.palette.brandAccent, selectedLabelColor = theme.palette.contentOnAccent)) }; items(store.filters?.types.orEmpty(), key = { it.id }) { type -> FilterChip(category == type.id, { category = type.id }, label = { Text(type.name) }, shape = RoundedCornerShape(50), colors = FilterChipDefaults.filterChipColors(selectedContainerColor = theme.palette.brandAccent, selectedLabelColor = theme.palette.contentOnAccent)) } } }
                }
                item { GroupFeedback(store) }
                if (store.loading) item { Row(Modifier.fillMaxWidth().padding(32.dp), horizontalArrangement = Arrangement.Center) { CircularProgressIndicator() } }
                else {
                    val groups = if (section == "Discover") store.discovered else store.home?.items.orEmpty()
                    if (groups.isEmpty()) item { GroupEmpty(if (section == "My groups") "Your next connection starts here" else "No groups found", if (section == "My groups") "Explore groups and find a place that feels like you." else "Try another name or category."); if (section == "My groups") Button(onClick = { section = "Discover" }, modifier = Modifier.fillMaxWidth()) { Text("Discover groups") } }
                    items(groups, key = { it.id }) { group ->
                        if (section == "My groups") GroupConversationRow(group) { popping = false; stack.add(GroupRoute.opening(group)) }
                        else GroupCard(group) { popping = false; stack.add(GroupRoute.opening(group)) }
                    }
                    if (section == "Discover" && store.nextCursor != null) item { TextButton(onClick = { scope.launch { store.discover(query, category, more = true) } }, enabled = !store.loading, modifier = Modifier.fillMaxWidth()) { Text("Show more groups") } }
                }
                item { TextButton(onClick = { scope.launch { store.load(); if (section == "Discover") store.discover(query, category) } }, modifier = Modifier.fillMaxWidth()) { Icon(Icons.Outlined.Refresh, null); Spacer(Modifier.width(8.dp)); Text("Refresh") } }
            }
        }
    }
}
/**
 * Discovery cards lead with the group's square photo rather than a cropped
 * banner, so the logo arrives at the shape it was uploaded in.
 */
@Composable private fun GroupCard(group: GroupSummary, open: () -> Unit) {
    val theme = LocalFaithFormTheme.current
    Surface(color = theme.palette.surface, shape = RoundedCornerShape(24.dp), tonalElevation = 1.dp, onClick = open, modifier = Modifier.fillMaxWidth()) {
        Column(Modifier.padding(18.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                GroupAvatar(group.coverImageUrl, group.name, 64.dp)
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Text(group.type?.name?.uppercase() ?: "COMMUNITY", style = MaterialTheme.typography.labelSmall, color = theme.palette.brandAccent)
                    Text(group.name, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.SemiBold, maxLines = 2)
                    Text("${group.memberCount} members", style = MaterialTheme.typography.bodySmall, color = theme.palette.contentSecondary)
                }
                val badge = when {
                    group.membershipState == "requested" -> "Request sent"
                    group.status == "archived" -> "Archived"
                    group.membershipState == "member" -> "Your group"
                    group.isYouth -> "Youth group"
                    group.enrollment == "open" -> "Open to join"
                    else -> null
                }
                if (badge != null) GroupBadge(badge)
            }
            group.summary?.takeIf { it.isNotBlank() }?.let { Text(it, style = MaterialTheme.typography.bodyMedium, color = theme.palette.contentSecondary, maxLines = 2) }
            if (group.scheduleText != null || group.locationName != null || group.nextEvent != null) {
                HorizontalDivider(color = theme.palette.divider)
                Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    group.scheduleText?.let { Text(it, style = MaterialTheme.typography.labelMedium, color = theme.palette.contentSecondary) }
                    group.locationName?.let { Text(it, style = MaterialTheme.typography.labelMedium, color = theme.palette.contentSecondary) }
                    group.nextEvent?.let { Text("Next: ${groupDate(it.startsAt)}", style = MaterialTheme.typography.labelMedium, color = theme.palette.contentSecondary) }
                }
            }
        }
    }
}

/**
 * One tap from the list to the conversation, with the group's own square photo
 * so a row is recognisable before its name is read.
 */
@Composable private fun GroupConversationRow(group: GroupSummary, open: () -> Unit) {
    val theme = LocalFaithFormTheme.current
    val subtitle = buildList {
        add("${group.memberCount} members")
        group.scheduleText?.let { add(it) } ?: if (group.chat != null) add("Tap to chat") else Unit
    }.joinToString(" · ")
    Surface(color = theme.palette.surface, shape = RoundedCornerShape(22.dp), tonalElevation = 1.dp, onClick = open, modifier = Modifier.fillMaxWidth()) {
        Row(Modifier.padding(14.dp).fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp)) {
            GroupAvatar(group.coverImageUrl, group.name, 60.dp)
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(5.dp)) {
                Text(group.name, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold, maxLines = 1, color = theme.palette.contentPrimary)
                Text(subtitle, style = MaterialTheme.typography.bodyMedium, color = theme.palette.contentSecondary, maxLines = 2)
            }
            Icon(
                if (group.chat == null) Icons.AutoMirrored.Outlined.KeyboardArrowRight else Icons.Outlined.ChatBubbleOutline,
                null,
                tint = if (group.chat == null) theme.palette.contentSecondary else theme.palette.brandAccent,
            )
        }
    }
}
