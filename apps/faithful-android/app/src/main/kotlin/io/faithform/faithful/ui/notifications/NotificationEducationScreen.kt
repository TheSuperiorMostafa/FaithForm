package io.faithform.faithful.ui.notifications

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import io.faithform.faithful.R
import io.faithform.faithful.contract.NotificationPreference
import io.faithform.faithful.contract.NotificationTopic
import io.faithform.faithful.design.FaithfulTokens
import io.faithform.faithful.design.LocalFaithfulTheme
import io.faithform.faithful.notifications.NotificationAuthorization

/**
 * Why notifications are worth allowing, before the system dialog is raised.
 *
 * Behavioural parity with the SwiftUI `NotificationEducationView` — same
 * hierarchy, same two actions, same rule that declining is a real outcome — but
 * Android-native where it matters: the system dialog appears only once, so a
 * denied state points at Settings rather than offering a button that would
 * silently do nothing.
 */
@Composable
fun NotificationEducationScreen(
    status: NotificationAuthorization,
    onEnable: () -> Unit,
    onOpenSettings: () -> Unit,
    onSkip: () -> Unit
) {
    val theme = LocalFaithfulTheme.current
    val fill = Modifier
        .fillMaxWidth()
        .heightIn(min = FaithfulTokens.TouchTarget.recommended)

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(theme.palette.background)
            .padding(FaithfulTokens.Layout.screenPaddingHorizontal),
        verticalArrangement = Arrangement.spacedBy(FaithfulTokens.Spacing.lg)
    ) {
        when (status) {
            NotificationAuthorization.DENIED -> {
                Text(
                    stringResource(R.string.notification_denied_title),
                    style = MaterialTheme.typography.displayMedium,
                    color = theme.palette.contentPrimary
                )
                Text(
                    stringResource(R.string.notification_denied_body),
                    style = MaterialTheme.typography.bodyLarge,
                    color = theme.palette.contentSecondary
                )
                Spacer(Modifier.weight(1f))
                // Asking again is a no-op on Android; Settings is the only
                // thing that can actually change this.
                Button(onClick = onOpenSettings, modifier = fill) {
                    Text(stringResource(R.string.notification_settings_hint))
                }
                OutlinedButton(onClick = onSkip, modifier = fill) {
                    Text(stringResource(R.string.notification_skip))
                }
            }

            NotificationAuthorization.GRANTED, NotificationAuthorization.NOT_REQUIRED -> {
                Text(
                    stringResource(R.string.notifications_on),
                    style = MaterialTheme.typography.displayMedium,
                    color = theme.palette.contentPrimary
                )
                Text(
                    stringResource(R.string.notification_education_body),
                    style = MaterialTheme.typography.bodyLarge,
                    color = theme.palette.contentSecondary
                )
                Spacer(Modifier.weight(1f))
                OutlinedButton(onClick = onSkip, modifier = fill) {
                    Text(stringResource(R.string.notification_skip))
                }
            }

            NotificationAuthorization.NOT_REQUESTED -> {
                Text(
                    stringResource(R.string.notification_education_title),
                    style = MaterialTheme.typography.displayMedium,
                    color = theme.palette.contentPrimary
                )
                Text(
                    stringResource(R.string.notification_education_body),
                    style = MaterialTheme.typography.bodyLarge,
                    color = theme.palette.contentSecondary
                )
                Spacer(Modifier.weight(1f))
                Button(onClick = onEnable, modifier = fill) {
                    Text(stringResource(R.string.notification_enable))
                }
                OutlinedButton(onClick = onSkip, modifier = fill) {
                    Text(stringResource(R.string.notification_skip))
                }
            }
        }
    }
}

/**
 * Per-church, per-topic preferences.
 *
 * These are the app's own switches, distinct from Android's channel settings.
 * Both matter: a channel disabled in system settings silences a topic no matter
 * what this says, so the row explains that rather than quietly disagreeing with
 * the system.
 */
@Composable
fun NotificationPreferencesScreen(
    preferences: List<NotificationPreference>,
    channelEnabled: (NotificationTopic) -> Boolean,
    onToggle: (NotificationPreference, Boolean) -> Unit
) {
    val theme = LocalFaithfulTheme.current

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(theme.palette.background)
            .padding(FaithfulTokens.Layout.screenPaddingHorizontal),
        verticalArrangement = Arrangement.spacedBy(FaithfulTokens.Spacing.md)
    ) {
        preferences.forEach { preference ->
            val label = when (preference.topic) {
                NotificationTopic.EVENTS -> stringResource(R.string.topic_events)
                else -> stringResource(R.string.topic_announcements)
            }
            val silencedBySystem = !channelEnabled(preference.topic)
            val stateWord = if (preference.isEnabled) "on" else "off"

            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .semantics(mergeDescendants = true) {
                        contentDescription = "$label, ${preference.churchSlug}, $stateWord"
                    },
                verticalArrangement = Arrangement.spacedBy(FaithfulTokens.Spacing.xs)
            ) {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .heightIn(min = FaithfulTokens.TouchTarget.recommended),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Column(modifier = Modifier.weight(1f)) {
                        Text(
                            label,
                            style = MaterialTheme.typography.titleMedium,
                            color = theme.palette.contentPrimary
                        )
                        Text(
                            preference.churchSlug,
                            style = MaterialTheme.typography.labelSmall,
                            color = theme.mutedContent
                        )
                    }
                    Switch(
                        checked = preference.isEnabled,
                        onCheckedChange = { onToggle(preference, it) }
                    )
                }

                if (silencedBySystem && preference.isEnabled) {
                    Text(
                        stringResource(R.string.channel_silenced_by_system),
                        style = MaterialTheme.typography.labelSmall,
                        color = theme.palette.warning
                    )
                }
            }
        }
    }
}
