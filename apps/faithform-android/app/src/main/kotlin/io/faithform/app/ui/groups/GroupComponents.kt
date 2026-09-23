package io.faithform.app.ui.groups

import android.os.Build
import androidx.compose.foundation.background
import androidx.compose.foundation.border
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
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.blur
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
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
    val theme = LocalFaithFormTheme.current
    Column(Modifier.fillMaxWidth().padding(vertical = 24.dp, horizontal = 16.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(14.dp)) {
        Box(
            contentAlignment = Alignment.Center,
            modifier = Modifier
                .size(64.dp)
                .background(theme.palette.brandAccent.copy(alpha = 0.14f), RoundedCornerShape(20.dp))
        ) {
            Icon(icon, contentDescription = null, tint = theme.palette.brandAccent, modifier = Modifier.size(28.dp))
        }
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(6.dp)
        ) {
            Text(title, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold, color = theme.palette.contentPrimary, textAlign = androidx.compose.ui.text.style.TextAlign.Center)
            Text(message, style = MaterialTheme.typography.bodyMedium, color = theme.palette.contentSecondary, textAlign = androidx.compose.ui.text.style.TextAlign.Center)
        }
    }
}
/**
 * The group photo is a square logo everywhere it appears — the same crop in a
 * 32dp title bar as in a 108dp header, so it never arrives stretched.
 */
@Composable fun GroupAvatar(url: String?, name: String, size: Dp = 56.dp, modifier: Modifier = Modifier) {
    val theme = LocalFaithFormTheme.current
    val shape = RoundedCornerShape(size * 0.3f)
    Box(
        modifier
            .size(size)
            .clip(shape)
            .background(Brush.linearGradient(listOf(theme.palette.brandAccent.copy(alpha = .32f), theme.palette.brandAccentSoft.copy(alpha = .16f))))
            .border(theme.borderWidth, theme.palette.border, shape),
        contentAlignment = Alignment.Center,
    ) {
        if (url.isNullOrBlank()) {
            Text(
                groupInitials(name),
                style = if (size >= 72.dp) MaterialTheme.typography.headlineMedium else MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.SemiBold,
                color = theme.palette.contentPrimary.copy(alpha = .75f),
            )
        } else {
            AsyncImage(model = url, contentDescription = null, modifier = Modifier.fillMaxSize(), contentScale = ContentScale.Crop)
        }
    }
}

/**
 * The same square photo, blurred far past recognition, so a header carries the
 * group's own colour without ever cropping the logo into a banner. Blur needs
 * API 31, so older devices get the brand wash instead of an unblurred photo.
 */
@Composable fun GroupAvatarBackdrop(url: String?, modifier: Modifier = Modifier) {
    val theme = LocalFaithFormTheme.current
    Box(modifier.fillMaxWidth().background(theme.palette.background)) {
        if (!url.isNullOrBlank() && Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            AsyncImage(model = url, contentDescription = null, contentScale = ContentScale.Crop, modifier = Modifier.matchParentSize().blur(48.dp).alpha(.38f))
        } else {
            Box(Modifier.matchParentSize().background(Brush.verticalGradient(listOf(theme.palette.brandAccent.copy(alpha = .18f), theme.palette.background))))
        }
        Box(Modifier.matchParentSize().background(Brush.verticalGradient(listOf(theme.palette.background.copy(alpha = .1f), theme.palette.background))))
    }
}

fun groupInitials(name: String): String =
    name.split(' ', '-').filter { it.isNotBlank() }.take(2).mapNotNull { it.firstOrNull() }.joinToString("").uppercase().ifEmpty { "\u2022" }
@Composable fun GroupBadge(text: String) { Surface(shape = RoundedCornerShape(50), color = LocalFaithFormTheme.current.palette.surfaceSunken) { Text(text, style = MaterialTheme.typography.labelSmall, modifier = Modifier.padding(horizontal = 9.dp, vertical = 5.dp)) } }
@Composable fun GroupPanel(title: String, content: @Composable ColumnScope.() -> Unit) { Surface(shape = RoundedCornerShape(20.dp), color = LocalFaithFormTheme.current.palette.surface, tonalElevation = 1.dp, modifier = Modifier.fillMaxWidth()) { Column(Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) { Text(title, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold); content() } } }
@OptIn(ExperimentalMaterial3Api::class)
@Composable fun GroupFormSheet(title: String, onDismiss: () -> Unit, content: @Composable ColumnScope.() -> Unit) {
    val theme = LocalFaithFormTheme.current
    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
        containerColor = theme.palette.background,
        contentColor = theme.palette.contentPrimary,
        shape = RoundedCornerShape(topStart = 28.dp, topEnd = 28.dp),
    ) {
        Column(Modifier.fillMaxWidth().imePadding().padding(horizontal = 24.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(title, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f))
                IconButton(onClick = onDismiss) { Icon(Icons.Outlined.Close, "Close") }
            }
            Column(Modifier.weight(1f, fill = false).verticalScroll(rememberScrollState()).padding(top = 16.dp, bottom = 24.dp), verticalArrangement = Arrangement.spacedBy(18.dp), content = content)
        }
    }
}
fun groupDate(value: String): String = runCatching { DateTimeFormatter.ofPattern("MMM d, yyyy · h:mm a").withZone(ZoneId.systemDefault()).format(Instant.parse(value)) }.getOrDefault(value)
