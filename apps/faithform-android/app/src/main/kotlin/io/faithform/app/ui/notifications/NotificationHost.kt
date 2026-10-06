package io.faithform.app.ui.notifications

import android.content.Intent
import android.provider.Settings
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.LiveRegionMode
import io.faithform.app.ui.components.skeletonLabel
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.res.stringResource
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.faithform.app.R
import io.faithform.app.contract.*
import io.faithform.app.design.FaithFormTokens
import io.faithform.app.network.FaithFormJson
import io.faithform.app.network.MobileSuccess
import io.faithform.app.notifications.*
import io.faithform.app.session.AppContainer
import io.faithform.app.ui.components.FaithFormOutlinedButton
import io.faithform.app.ui.components.SkeletonBone
import io.faithform.app.ui.components.skeletonShimmer
import kotlinx.coroutines.launch
import kotlinx.serialization.Serializable

@Serializable private data class PreferencesReply(val items: List<NotificationPreference>)

@Composable
fun NotificationHost(container: AppContainer, churchSlug: String?, onClose: () -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val authorization by container.push.authorization.collectAsStateWithLifecycle()
    val deliveryError by container.push.deliveryError.collectAsStateWithLifecycle()
    var preferences by remember(churchSlug) { mutableStateOf<List<NotificationPreference>?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var saving by remember { mutableStateOf(false) }
    val failure = stringResource(R.string.notification_preferences_error)
    fun settings() { context.startActivity(Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, context.packageName)) }
    LaunchedEffect(authorization, churchSlug) {
        if (churchSlug != null && authorization in setOf(NotificationAuthorization.GRANTED, NotificationAuthorization.NOT_REQUIRED)) {
            try {
                val saved = container.apiClient.send("api/mobile/v1/preferences", MobileSuccess.serializer(PreferencesReply.serializer())).value?.items ?: kotlin.error("no_preferences")
                preferences = listOf(NotificationTopic.ANNOUNCEMENTS, NotificationTopic.EVENTS).map { topic ->
                    saved.firstOrNull { it.churchSlug == churchSlug && it.topic == topic } ?: NotificationPreference(churchSlug, topic, true)
                }
            } catch (cancelled: kotlinx.coroutines.CancellationException) { throw cancelled }
            catch (_: Exception) { error = failure }
        }
    }
    if (authorization !in setOf(NotificationAuthorization.GRANTED, NotificationAuthorization.NOT_REQUIRED)) {
        NotificationEducationScreen(authorization,
            onEnable = { scope.launch { container.push.request() } }, onOpenSettings = ::settings, onSkip = onClose)
    } else {
        Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(FaithFormTokens.Layout.screenPaddingHorizontal), verticalArrangement = Arrangement.spacedBy(FaithFormTokens.Spacing.md)) {
            Text(stringResource(R.string.notifications_on), style = MaterialTheme.typography.titleLarge)
            Text(stringResource(R.string.notification_education_body), style = MaterialTheme.typography.bodyMedium)
            deliveryError?.let { Text(it) }
            error?.let { Text(it) }
            FaithFormOutlinedButton(onClick = ::settings, modifier = Modifier.fillMaxWidth()) { Text(stringResource(R.string.notification_settings_hint)) }
            Text("For pop-up alerts, turn on your phone’s pop-up setting for each notification category. Your current sound and mute choices are kept.", style = MaterialTheme.typography.bodySmall)
            listOf("Church announcements" to NotificationChannels.ANNOUNCEMENTS,
                "Church events and live services" to NotificationChannels.EVENTS, "Group messages" to NotificationChannels.GROUPS).forEach { (label, channel) ->
                FaithFormOutlinedButton(onClick = {
                    context.startActivity(Intent(Settings.ACTION_CHANNEL_NOTIFICATION_SETTINGS)
                        .putExtra(Settings.EXTRA_APP_PACKAGE, context.packageName)
                        .putExtra(Settings.EXTRA_CHANNEL_ID, channel))
                }, modifier = Modifier.fillMaxWidth()) { Text(label) }
            }
            val rows = preferences
            if (rows != null) {
                NotificationPreferencesScreen(rows, modifier = Modifier.fillMaxWidth(), channelEnabled = { topic ->
                    NotificationChannels.isChannelEnabled(context, if (topic == NotificationTopic.EVENTS) NotificationChannels.EVENTS else NotificationChannels.ANNOUNCEMENTS)
                }, onToggle = { preference, enabled ->
                    if (!saving) scope.launch {
                        saving = true; error = null
                        try {
                            val request = SetPreferenceRequest(preference.churchSlug, preference.topic, enabled)
                            val saved = container.apiClient.send("api/mobile/v1/preferences", MobileSuccess.serializer(NotificationPreference.serializer()), method = "PUT",
                                body = FaithFormJson.encodeToString(SetPreferenceRequest.serializer(), request)).value ?: kotlin.error("no_preference")
                            preferences = rows.map { if (it.topic == saved.topic) saved else it }
                        } catch (cancelled: kotlinx.coroutines.CancellationException) { throw cancelled }
            catch (_: Exception) { error = failure }
                        finally { saving = false }
                    }
                })
            } else if (churchSlug != null && error == null) {
                NotificationPreferencesSkeleton(churchSlug)
            }
        }
    }
}

/** Same two rows, padding, type heights, and switch geometry as the loaded topic settings. */
@Composable
private fun NotificationPreferencesSkeleton(churchSlug: String) {
    val label = stringResource(R.string.media_loading)
    Column(Modifier.fillMaxWidth()
        .semantics { contentDescription = label; liveRegion = LiveRegionMode.Polite },
        verticalArrangement = Arrangement.spacedBy(FaithFormTokens.Spacing.md)) {
        listOf(R.string.topic_announcements, R.string.topic_events).forEach { title ->
            Row(Modifier.fillMaxWidth().heightIn(min = FaithFormTokens.TouchTarget.recommended), verticalAlignment = androidx.compose.ui.Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text(stringResource(title), style = MaterialTheme.typography.titleMedium)
                    Text(churchSlug, style = MaterialTheme.typography.labelSmall)
                }
                SkeletonBone(Modifier.width(52.dp).then(skeletonLabel()).skeletonShimmer(), height = 32.dp)
            }
        }
    }
}
