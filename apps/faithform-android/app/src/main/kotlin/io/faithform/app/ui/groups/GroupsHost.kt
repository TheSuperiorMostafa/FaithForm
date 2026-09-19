package io.faithform.app.ui.groups

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
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
    var groupId by rememberSaveable(partitionKey) { mutableStateOf<String?>(null) }
    var section by rememberSaveable(partitionKey) { mutableStateOf("My groups") }
    var query by rememberSaveable(partitionKey) { mutableStateOf("") }
    var category by rememberSaveable(partitionKey) { mutableStateOf("") }
    var preferences by remember { mutableStateOf(false) }
    val theme = LocalFaithFormTheme.current
    DisposableEffect(chat) { onDispose { chat.disconnect() } }
    LaunchedEffect(store) { store.load() }
    if (preferences) GroupPreferences(store, onDismiss = { preferences = false })
    val selected = groupId
    if (selected != null) { GroupPage(store, chat, selected, onBack = { groupId = null }); return }
    LaunchedEffect(section, query, category) { if (section == "Discover") { delay(250); store.discover(query, category) } }
    LaunchedEffect(store.home?.directMessagesEnabled) { if (store.home?.directMessagesEnabled != true && section == "Messages") section = "My groups" }
    TabScreen(title = "Groups", actions = { IconButton(onClick = { preferences = true }) { Icon(Icons.Outlined.Tune, "Messaging preferences") } }) { modifier ->
        Column(modifier) {
            val sections = if (store.home?.directMessagesEnabled == true) listOf("My groups", "Discover", "Messages") else listOf("My groups", "Discover")
            Row(Modifier.fillMaxWidth().padding(horizontal = 20.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) { sections.forEach { name -> FilterChip(selected = section == name, onClick = { section = name }, label = { Text(name) }) } }
            if (section == "Messages") GroupMessages(store, chat)
            else LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(20.dp), verticalArrangement = Arrangement.spacedBy(18.dp)) {
                item {
                    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                        Text("LIFE TOGETHER", style = MaterialTheme.typography.labelSmall, color = theme.palette.brandAccent)
                        Text(if (section == "My groups") "You belong here." else "Find your people.", style = MaterialTheme.typography.headlineLarge, fontWeight = FontWeight.SemiBold)
                        Text(if (section == "My groups") "Familiar faces. Meaningful conversations. A place to grow, together." else "There’s a place for you in this community.", style = MaterialTheme.typography.bodyMedium, color = theme.palette.contentSecondary)
                    }
                }
                if (section == "Discover") {
                    item { OutlinedTextField(query, { query = it }, label = { Text("Search groups") }, leadingIcon = { Icon(Icons.Outlined.Search, null) }, singleLine = true, modifier = Modifier.fillMaxWidth(), shape = RoundedCornerShape(14.dp)) }
                    item { LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) { item { FilterChip(category.isEmpty(), { category = "" }, label = { Text("All groups") }) }; items(store.filters?.types.orEmpty(), key = { it.id }) { type -> FilterChip(category == type.id, { category = type.id }, label = { Text(type.name) }) } } }
                }
                item { GroupFeedback(store) }
                if (store.loading) item { Row(Modifier.fillMaxWidth().padding(32.dp), horizontalArrangement = Arrangement.Center) { CircularProgressIndicator() } }
                else {
                    val groups = if (section == "Discover") store.discovered else store.home?.items.orEmpty()
                    if (groups.isEmpty()) item { GroupEmpty(if (section == "My groups") "Your next connection starts here" else "No groups found", if (section == "My groups") "Explore groups and find a place that feels like you." else "Try another name or category."); if (section == "My groups") Button(onClick = { section = "Discover" }, modifier = Modifier.fillMaxWidth()) { Text("Discover groups") } }
                    items(groups, key = { it.id }) { group -> GroupCard(group) { groupId = group.id } }
                    if (section == "Discover" && store.nextCursor != null) item { TextButton(onClick = { scope.launch { store.discover(query, category, more = true) } }, enabled = !store.loading, modifier = Modifier.fillMaxWidth()) { Text("Show more groups") } }
                }
                item { TextButton(onClick = { scope.launch { store.load(); if (section == "Discover") store.discover(query, category) } }, modifier = Modifier.fillMaxWidth()) { Icon(Icons.Outlined.Refresh, null); Spacer(Modifier.width(8.dp)); Text("Refresh") } }
            }
        }
    }
}
@Composable private fun GroupCard(group: GroupSummary, open: () -> Unit) {
    val theme = LocalFaithFormTheme.current
    Surface(color = theme.palette.surface, shape = RoundedCornerShape(22.dp), tonalElevation = 1.dp, modifier = Modifier.fillMaxWidth().clip(RoundedCornerShape(22.dp)).clickable(onClick = open)) {
        Column {
            GroupCover(group.coverImageUrl, Modifier.height(145.dp))
            Column(Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.SpaceBetween) { Text(group.type?.name ?: "Community", style = MaterialTheme.typography.labelSmall, color = theme.palette.contentSecondary); if (group.membershipState == "requested") GroupBadge("Request sent") else if (group.status == "archived") GroupBadge("Archived") else if (group.isYouth) GroupBadge("Youth group") else if (group.enrollment == "open") GroupBadge("Open to join") }
                Text(group.name, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.SemiBold)
                Text("${group.memberCount} members", style = MaterialTheme.typography.bodySmall, color = theme.palette.contentSecondary)
                group.scheduleText?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = theme.palette.contentSecondary) }
                group.nextEvent?.let { HorizontalDivider(); Text("Next: ${groupDate(it.startsAt)}", style = MaterialTheme.typography.labelMedium) }
            }
        }
    }
}
