package io.faithform.app.ui.groups

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import io.faithform.app.contract.*
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import kotlinx.serialization.json.*

@Composable fun GroupPreferences(store: GroupsStore, groupId: String? = null, onDismiss: () -> Unit) {
    val scope = rememberCoroutineScope()
    var level by remember { mutableStateOf("all") }
    var blocked by remember { mutableStateOf<List<ChatBlockedPerson>>(emptyList()) }
    var loaded by remember { mutableStateOf(false) }
    LaunchedEffect(groupId) { try { val prefs = store.read<MessagingPreferences>("${store.messagingPath}/preferences"); level = if (groupId == null) prefs.level else prefs.groups.firstOrNull { it.groupId == groupId }?.level ?: "default"; blocked = store.read<ChatBlockList>("${store.messagingPath}/blocks").items; loaded = true } catch (e: CancellationException) { throw e } catch (e: Exception) { store.error = GroupsStore.message(e) } }
    GroupFormSheet("Your notifications", onDismiss) {
        Text("Take part at your own pace. You can always read messages in the app.", style = MaterialTheme.typography.bodyMedium)
        if (loaded) {
            val options = listOfNotNull(if (groupId != null) "default" to "Use church preference" else null, "all" to "All messages", "mentions" to "Mentions only", (if (groupId == null) "off" else "muted") to "Nothing for now")
            options.forEach { (value, title) -> Row(verticalAlignment = Alignment.CenterVertically) { RadioButton(level == value, { level = value }); Text(title) } }
            Button(enabled = !store.busy, onClick = { scope.launch { if (store.action("Preference saved.") { val path = if (groupId == null) "${store.messagingPath}/preferences" else "${store.path}/$groupId/notifications"; store.send<MessagingPreferences>(path, buildJsonObject { put("level", level) }, "PUT") }) onDismiss() } }, modifier = Modifier.fillMaxWidth()) { Text("Save preference") }
            if (groupId == null) {
                Text("People you’ve blocked", style = MaterialTheme.typography.titleMedium)
                if (blocked.isEmpty()) Text("No blocked people", style = MaterialTheme.typography.bodyMedium)
                blocked.forEach { person -> Row(verticalAlignment = Alignment.CenterVertically) { Text(person.name, modifier = Modifier.weight(1f)); TextButton(enabled = !store.busy, onClick = { scope.launch { store.action("Person unblocked.") { val response = store.api.send("${store.messagingPath}/blocks", io.faithform.app.network.MobileSuccess.serializer(ChatBlockList.serializer()), method = "DELETE", query = mapOf("chatUserId" to person.chatUserId)); blocked = response.value?.items ?: blocked } } }) { Text("Unblock") } } }
            }
        } else CircularProgressIndicator()
        GroupFeedback(store)
    }
}
@Composable fun GroupSafety(store: GroupsStore, cid: String, userId: String, name: String, messageId: String? = null, onDismiss: () -> Unit) {
    val scope = rememberCoroutineScope()
    var reason by remember { mutableStateOf("inappropriate") }
    var details by remember { mutableStateOf("") }
    var reasonsOpen by remember { mutableStateOf(false) }
    var confirm by remember { mutableStateOf(false) }
    GroupFormSheet("Report or block", onDismiss) {
        Text("Help keep this a welcoming space. Reports go privately to your church’s moderation team.", style = MaterialTheme.typography.bodyMedium)
        Text("Report $name", style = MaterialTheme.typography.titleMedium)
        Box { OutlinedButton(onClick = { reasonsOpen = true }, modifier = Modifier.fillMaxWidth()) { Text("Reason: ${reason.replace('_', ' ').replaceFirstChar { it.uppercase() }}") }; DropdownMenu(reasonsOpen, { reasonsOpen = false }) { listOf("spam", "harassment", "hate", "sexual", "violence", "self_harm", "inappropriate", "other").forEach { value -> DropdownMenuItem(text = { Text(value.replace('_', ' ').replaceFirstChar { it.uppercase() }) }, onClick = { reason = value; reasonsOpen = false }) } } }
        OutlinedTextField(details, { details = it.take(1000) }, label = { Text("Anything else we should know?") }, minLines = 3, modifier = Modifier.fillMaxWidth())
        Button(enabled = !store.busy, onClick = { scope.launch { if (store.action("Thank you. Your report has been received.") { store.send<ChatReportResult>("${store.messagingPath}/reports", buildJsonObject { put("cid", cid); put("reportedChatUserId", userId); messageId?.let { put("messageId", it) }; put("reason", reason); put("details", details) }) }) onDismiss() } }, modifier = Modifier.fillMaxWidth()) { Text("Send confidential report") }
        HorizontalDivider()
        Text("Blocking prevents direct messages between you. You can unblock this person in your messaging preferences.", style = MaterialTheme.typography.bodyMedium)
        OutlinedButton(enabled = !store.busy, onClick = { confirm = true }, modifier = Modifier.fillMaxWidth()) { Text("Block this person", color = MaterialTheme.colorScheme.error) }
        GroupFeedback(store)
    }
    if (confirm) AlertDialog(onDismissRequest = { confirm = false }, title = { Text("Block $name?") }, text = { Text("Neither of you will be able to message the other directly.") }, dismissButton = { TextButton(onClick = { confirm = false }) { Text("Cancel") } }, confirmButton = { TextButton(enabled = !store.busy, onClick = { scope.launch { if (store.action("Person blocked.") { store.send<ChatBlockList>("${store.messagingPath}/blocks", buildJsonObject { put("chatUserId", userId) }) }) onDismiss(); confirm = false } }) { Text("Block person") } })
}
@Composable fun GroupRequests(store: GroupsStore, groupId: String, onDismiss: () -> Unit) {
    val scope = rememberCoroutineScope()
    var items by remember { mutableStateOf<List<GroupJoinRequestItem>>(emptyList()) }
    var cursor by remember { mutableStateOf<String?>(null) }
    var loaded by remember { mutableStateOf(false) }
    suspend fun load(more: Boolean = false) { try { val page = store.read<GroupJoinRequestPage>("${store.path}/$groupId/requests", if (more) mapOf("cursor" to (cursor ?: "")) else emptyMap()); items = if (more) items + page.items else page.items; cursor = page.nextCursor; loaded = true } catch (e: CancellationException) { throw e } catch (e: Exception) { store.error = GroupsStore.message(e) } }
    LaunchedEffect(groupId) { load() }
    GroupFormSheet("Join requests", onDismiss) {
        GroupFeedback(store)
        if (!loaded) CircularProgressIndicator()
        else if (items.isEmpty()) GroupEmpty("All caught up", "New requests to join this group will appear here.")
        items.forEach { request -> GroupPanel(request.name) { request.message?.let { Text(it, style = MaterialTheme.typography.bodyMedium) }; Row(horizontalArrangement = Arrangement.SpaceBetween, modifier = Modifier.fillMaxWidth()) { listOf("decline" to "Decline", "approve" to "Welcome in").forEach { (decision, title) -> TextButton(enabled = !store.busy, onClick = { scope.launch { store.action(if (decision == "approve") "Member welcomed!" else "Request declined.") { val result = store.send<GroupCommandResult>("${store.path}/$groupId/requests/${request.requestId}", buildJsonObject { put("decision", decision) }); if (result.outcome !in listOf("approved", "declined", "already_decided")) throw IllegalStateException(GroupsStore.outcomeMessage(result.outcome)); load() } } }) { Text(title) } } } } }
        if (cursor != null) TextButton(onClick = { scope.launch { load(true) } }) { Text("More requests") }
    }
}
