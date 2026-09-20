package io.faithform.app.ui.groups

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import io.faithform.app.contract.*
import io.faithform.app.network.ApiClient
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import kotlinx.serialization.json.*

@Composable fun GroupInvitationScreen(api: ApiClient, token: String, onDismiss: () -> Unit, onJoined: (String) -> Unit) {
    val store = remember(token) { GroupsStore(api, "") }; val scope = rememberCoroutineScope()
    var preview by remember(token) { mutableStateOf<GroupInvitationPreview?>(null) }; var accepted by remember(token) { mutableStateOf(false) }; var retry by remember { mutableIntStateOf(0) }
    LaunchedEffect(token, retry) { try { store.error = null; preview = store.send("api/mobile/v1/group-invitations/preview", buildJsonObject { put("token", token) }) } catch (e: CancellationException) { throw e } catch (e: Exception) { store.error = GroupsStore.message(e) } }
    GroupFormSheet("You’re invited", onDismiss) {
        preview?.let { invitation ->
            Box(Modifier.fillMaxWidth().height(190.dp), contentAlignment = Alignment.Center) {
                GroupAvatarBackdrop(invitation.coverImageUrl, Modifier.matchParentSize())
                GroupAvatar(invitation.coverImageUrl, invitation.groupName, 104.dp)
            }
            Text(if (accepted) "Welcome to the group." else "There’s a place for you.", style = MaterialTheme.typography.headlineLarge)
            Text(invitation.groupName, style = MaterialTheme.typography.titleLarge)
            Text("You’re invited to join ${invitation.churchName}’s group. You’ll need to belong to this church in the app before joining.")
            Button(enabled = !store.busy, onClick = {
                if (accepted) onJoined(invitation.churchSlug)
                else scope.launch { store.action("Welcome to the group!") { val result = store.send<GroupJoinResult>("api/mobile/v1/group-invitations/accept", buildJsonObject { put("token", token) }); if (result.outcome !in listOf("joined", "already_member")) throw IllegalStateException(GroupsStore.outcomeMessage(result.outcome)); accepted = true } }
            }, modifier = Modifier.fillMaxWidth()) { Text(if (accepted) "Go to my groups" else if (store.busy) "Joining…" else "Accept invitation") }
        } ?: if (store.error == null) CircularProgressIndicator() else TextButton(onClick = { retry++ }) { Text("Try again") }
        GroupFeedback(store)
    }
}
