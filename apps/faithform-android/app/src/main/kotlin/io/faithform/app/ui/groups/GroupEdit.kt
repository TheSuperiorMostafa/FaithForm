package io.faithform.app.ui.groups

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import io.faithform.app.contract.GroupDetail
import kotlinx.coroutines.launch
import kotlinx.serialization.json.*

@Composable fun GroupEdit(store: GroupsStore, detail: GroupDetail, onDismiss: () -> Unit, saved: () -> Unit) {
    var name by remember { mutableStateOf(detail.group.name) }; var description by remember { mutableStateOf(detail.description ?: "") }
    var enrollment by remember { mutableStateOf(detail.group.enrollment) }; var capacity by remember { mutableStateOf(detail.group.capacity?.toString() ?: "") }
    var location by remember { mutableStateOf(detail.location?.name ?: "") }; var address by remember { mutableStateOf(detail.location?.address ?: "") }; var url by remember { mutableStateOf(detail.location?.onlineMeetingUrl ?: "") }
    var posting by remember { mutableStateOf(detail.chatPosting ?: detail.group.chat?.postingPolicy ?: "everyone") }; var roster by remember { mutableStateOf(detail.memberListVisibility ?: "members") }; val scope = rememberCoroutineScope()
    GroupFormSheet("Edit group", onDismiss) {
        OutlinedTextField(name, { name = it.take(80) }, label = { Text("Group name") }, modifier = Modifier.fillMaxWidth())
        OutlinedTextField(description, { description = it.take(4000) }, label = { Text("What’s your group about?") }, minLines = 3, modifier = Modifier.fillMaxWidth())
        GroupChoice("Who can join?", enrollment, listOf("open" to "Anyone can join", "approval_required" to "Leader approval", "invitation_only" to "By invitation", "closed" to "Closed for now")) { enrollment = it }
        OutlinedTextField(capacity, { capacity = it.take(6) }, label = { Text("Member limit (optional)") }, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number), modifier = Modifier.fillMaxWidth())
        OutlinedTextField(location, { location = it.take(200) }, label = { Text("Meeting place") }, modifier = Modifier.fillMaxWidth())
        OutlinedTextField(address, { address = it.take(500) }, label = { Text("Address") }, modifier = Modifier.fillMaxWidth())
        OutlinedTextField(url, { url = it.take(2000) }, label = { Text("Online meeting link") }, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri), modifier = Modifier.fillMaxWidth())
        GroupChoice("Who can post?", posting, listOf("everyone" to "All members", "leaders" to "Leaders only")) { posting = it }
        GroupChoice("Who can see the member list?", roster, listOf("members" to "All members", "leaders" to "Leaders only")) { roster = it }
        GroupFeedback(store)
        Button(enabled = !store.busy && name.isNotBlank(), onClick = { scope.launch {
            if (capacity.isNotBlank() && (capacity.toIntOrNull() ?: 0) <= 0) { store.error = "Enter a valid member limit or leave it blank."; return@launch }
            if (store.action("Group details saved.") { store.send<GroupDetail>("${store.path}/${detail.group.id}", buildJsonObject {
                put("expectedVersion", detail.group.version); put("name", name); put("description", description); put("enrollment", enrollment); put("capacity", capacity.toIntOrNull()?.let(::JsonPrimitive) ?: JsonNull)
                put("locationName", location); put("locationAddress", address); put("onlineMeetingUrl", url); put("chatPosting", posting); put("memberListVisibility", roster)
            }, "PATCH") }) { saved(); onDismiss() }
        } }, modifier = Modifier.fillMaxWidth()) { Text(if (store.busy) "Saving…" else "Save changes") }
    }
}
@Composable private fun GroupChoice(title: String, value: String, options: List<Pair<String, String>>, select: (String) -> Unit) {
    var expanded by remember { mutableStateOf(false) }
    Column { Text(title, style = MaterialTheme.typography.labelMedium); Box { OutlinedButton(onClick = { expanded = true }, modifier = Modifier.fillMaxWidth()) { Text(options.firstOrNull { it.first == value }?.second ?: value) }; DropdownMenu(expanded, { expanded = false }) { options.forEach { (key, label) -> DropdownMenuItem(text = { Text(label) }, onClick = { select(key); expanded = false }) } } } }
}
