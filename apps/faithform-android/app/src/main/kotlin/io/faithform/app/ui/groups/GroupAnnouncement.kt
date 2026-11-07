package io.faithform.app.ui.groups

import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.CheckCircle
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

@Serializable
data class SendAnnouncementData(
    val sent: Boolean,
    val recipientCount: Int,
    val groupName: String
)

@Composable
fun GroupAnnouncementSheet(
    store: GroupsStore,
    groupId: String,
    groupName: String,
    onDismiss: () -> Unit
) {
    var title by remember { mutableStateOf("") }
    var message by remember { mutableStateOf("") }
    var sending by remember { mutableStateOf(false) }
    var sent by remember { mutableStateOf(false) }
    var recipientCount by remember { mutableIntStateOf(0) }
    val scope = rememberCoroutineScope()
    val path = "${store.path}/$groupId/announcements"
    
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp)
    ) {
        Text("Send Announcement", style = MaterialTheme.typography.headlineSmall)
        
        if (sent) {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(vertical = 32.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(12.dp)
            ) {
                Icon(
                    Icons.Outlined.CheckCircle,
                    contentDescription = null,
                    modifier = Modifier.size(64.dp),
                    tint = MaterialTheme.colorScheme.primary
                )
                Text(
                    "Announcement queued",
                    style = MaterialTheme.typography.titleLarge,
                    fontWeight = FontWeight.Bold
                )
                Text(
                    "Queued for $recipientCount ${if (recipientCount == 1) "member" else "members"}",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
            
            Button(
                onClick = onDismiss,
                modifier = Modifier.fillMaxWidth()
            ) {
                Text("Done")
            }
        } else {
            Text(
                "Send a message to all members of $groupName",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
            
            GroupFeedback(store)
            OutlinedTextField(
                value = title,
                onValueChange = { title = it.take(100) },
                label = { Text("Title") },
                modifier = Modifier.fillMaxWidth(),
                enabled = !sending
            )
            
            OutlinedTextField(
                value = message,
                onValueChange = { message = it.take(500) },
                label = { Text("Message") },
                minLines = 5,
                maxLines = 10,
                modifier = Modifier.fillMaxWidth(),
                enabled = !sending,
                supportingText = { Text("${message.length}/500") }
            )
            
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(12.dp)
            ) {
                OutlinedButton(
                    onClick = onDismiss,
                    modifier = Modifier.weight(1f),
                    enabled = !sending
                ) {
                    Text("Cancel")
                }
                
                Button(
                    onClick = {
                        scope.launch {
                            store.error = null
                            sending = true
                            try {
                                val response = store.send<SendAnnouncementData>(
                                    path,
                                    buildJsonObject {
                                        put("title", title)
                                        put("message", message)
                                    },
                                    "POST"
                                )
                                recipientCount = response.recipientCount
                                sent = true
                            } catch (e: Exception) {
                                store.error = e.message ?: "Failed to send announcement"
                            } finally {
                                sending = false
                            }
                        }
                    },
                    modifier = Modifier.weight(1f),
                    enabled = title.isNotEmpty() && message.isNotEmpty() && !sending
                ) {
                    if (sending) CircularProgressIndicator(modifier = Modifier.size(20.dp))
                    else Text("Send to Members")
                }
            }
        }
    }
}
