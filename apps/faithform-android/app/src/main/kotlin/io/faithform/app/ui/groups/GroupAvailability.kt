package io.faithform.app.ui.groups

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import io.faithform.app.contract.GroupAvailability
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

@Composable
fun GroupAvailabilitySection(store: GroupsStore, groupId: String) {
    var availability by remember(groupId) { mutableStateOf("") }
    var loaded by remember(groupId) { mutableStateOf(false) }
    var failed by remember(groupId) { mutableStateOf(false) }
    var retry by remember { mutableIntStateOf(0) }
    val scope = rememberCoroutineScope()
    val path = "${store.path}/$groupId/availability"
    LaunchedEffect(groupId, retry) {
        failed = false
        try { availability = store.read<GroupAvailability>(path).availability; loaded = true }
        catch (e: CancellationException) { throw e }
        catch (_: Exception) { failed = true }
    }
    GroupPanel("Your availability") {
        Text("Tell your team when you can serve. Group leaders can see your answer.")
        if (!loaded) {
            if (failed) TextButton(onClick = { retry++ }) { Text("Try loading availability again") }
            else CircularProgressIndicator()
        } else {
            OutlinedTextField(availability, { availability = it.take(500) }, label = { Text("When can you serve?") }, placeholder = { Text("For example, Sundays except the first Sunday") }, minLines = 3, modifier = Modifier.fillMaxWidth())
            Spacer(Modifier.height(12.dp))
            Button(enabled = !store.busy, onClick = {
                scope.launch { store.action("Your availability is saved.") {
                    availability = store.send<GroupAvailability>(path, buildJsonObject { put("availability", availability) }, "PUT").availability
                } }
            }) { Text("Save availability") }
        }
    }
}
