package io.faithform.app.ui.groups

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import coil.compose.AsyncImage
import io.faithform.app.design.LocalFaithFormTheme
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter

@Composable fun GroupFeedback(store: GroupsStore) {
    val message = store.error ?: store.feedback
    if (!message.isNullOrBlank()) Surface(color = if (store.error != null) MaterialTheme.colorScheme.errorContainer else MaterialTheme.colorScheme.secondaryContainer, shape = RoundedCornerShape(12.dp), modifier = Modifier.fillMaxWidth().semantics { liveRegion = LiveRegionMode.Polite }) {
        Text(message, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.padding(14.dp))
    }
}
@Composable fun GroupEmpty(title: String, message: String, icon: ImageVector = Icons.Outlined.Groups) {
    Column(Modifier.fillMaxWidth().padding(vertical = 36.dp, horizontal = 16.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(14.dp)) {
        Surface(shape = RoundedCornerShape(22.dp), color = MaterialTheme.colorScheme.surfaceContainer) { Icon(icon, contentDescription = null, modifier = Modifier.padding(20.dp).size(32.dp)) }
        Text(title, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
        Text(message, style = MaterialTheme.typography.bodyMedium, color = LocalFaithFormTheme.current.palette.contentSecondary, textAlign = androidx.compose.ui.text.style.TextAlign.Center)
    }
}
@Composable fun GroupCover(url: String?, modifier: Modifier = Modifier) {
    val theme = LocalFaithFormTheme.current
    Box(modifier.fillMaxWidth().background(Brush.linearGradient(listOf(theme.palette.brandAccent.copy(alpha = .18f), theme.palette.brandAccent.copy(alpha = .06f)))), contentAlignment = Alignment.Center) {
        Icon(Icons.Outlined.Groups, null, Modifier.size(48.dp), tint = theme.palette.contentSecondary.copy(alpha = .55f))
        if (url != null) AsyncImage(model = url, contentDescription = null, modifier = Modifier.fillMaxSize(), contentScale = ContentScale.Crop)
    }
}
@Composable fun GroupBadge(text: String) { Surface(shape = RoundedCornerShape(8.dp), color = MaterialTheme.colorScheme.surfaceContainer) { Text(text, style = MaterialTheme.typography.labelSmall, modifier = Modifier.padding(horizontal = 9.dp, vertical = 5.dp)) } }
@Composable fun GroupPanel(title: String, content: @Composable ColumnScope.() -> Unit) { Surface(shape = RoundedCornerShape(20.dp), color = LocalFaithFormTheme.current.palette.surface, tonalElevation = 1.dp, modifier = Modifier.fillMaxWidth()) { Column(Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) { Text(title, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold); content() } } }
@Composable fun GroupFormSheet(title: String, onDismiss: () -> Unit, content: @Composable ColumnScope.() -> Unit) {
    Dialog(onDismissRequest = onDismiss, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Surface(shape = RoundedCornerShape(24.dp), color = LocalFaithFormTheme.current.palette.background, modifier = Modifier.fillMaxWidth().fillMaxHeight(.92f).padding(12.dp)) {
            Column(Modifier.padding(20.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) { Text(title, style = MaterialTheme.typography.titleLarge, modifier = Modifier.weight(1f)); IconButton(onClick = onDismiss) { Icon(Icons.Outlined.Close, "Close") } }
                Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).imePadding(), verticalArrangement = Arrangement.spacedBy(18.dp), content = content)
            }
        }
    }
}
fun groupDate(value: String): String = runCatching { DateTimeFormatter.ofPattern("MMM d, yyyy · h:mm a").withZone(ZoneId.systemDefault()).format(Instant.parse(value)) }.getOrDefault(value)
