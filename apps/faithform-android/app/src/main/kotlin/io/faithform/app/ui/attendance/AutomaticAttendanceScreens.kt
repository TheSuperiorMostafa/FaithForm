package io.faithform.app.ui.attendance

import android.app.Activity
import android.content.Context
import android.content.ContextWrapper
import android.content.Intent
import android.net.Uri
import android.provider.Settings
import android.text.format.DateUtils
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.KeyboardArrowRight
import androidx.compose.material.icons.outlined.CheckCircle
import androidx.compose.material.icons.outlined.ErrorOutline
import androidx.compose.material.icons.outlined.RemoveCircleOutline
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.google.android.gms.common.GoogleApiAvailability
import io.faithform.app.R
import io.faithform.app.attendance.AttendanceFix
import io.faithform.app.attendance.AutomaticAttendanceBlocker
import io.faithform.app.attendance.AutomaticAttendanceStatus
import io.faithform.app.attendance.AutomaticAttendanceStep
import io.faithform.app.attendance.NotificationAccess
import io.faithform.app.attendance.SetupScreen
import io.faithform.app.design.FaithFormTokens
import io.faithform.app.design.LocalFaithFormTheme

/**
 * The automatic-attendance experience.
 *
 * Behavioural parity with the SwiftUI screens — same steps, same order, same
 * rule that nothing here can raise a system dialog on its own — but Android
 * where the platform differs: a separate prominent disclosure before background
 * location, Settings as the place "Allow all the time" lives on Android 11+, a
 * notification permission on Android 13+, and fixes for Play services and for
 * location switched off device-wide.
 *
 * Every decision about what appears is made in `:core:attendance`
 * ([io.faithform.app.attendance.AutomaticAttendanceJourney] and
 * [io.faithform.app.attendance.AutomaticAttendanceStatusResolver]), where it is
 * tested. This file lays out the answer.
 */

// ---------------------------------------------------------------------------
// The flow
// ---------------------------------------------------------------------------

/** The setup journey or the status screen, whichever the model says. */
@Composable
fun AutomaticAttendanceFlow(
    model: AutomaticAttendanceModel,
    modifier: Modifier = Modifier,
) {
    val ui by model.ui.collectAsStateWithLifecycle()
    val context = LocalContext.current

    // Back from any setup screen returns to the status screen, never out of it
    // half-way through a system hand-off.
    if (ui.screen != null) BackHandler { model.leaveSetup() }

    when (ui.screen) {
        SetupScreen.Introduction -> AutomaticAttendanceIntroScreen(
            isWorking = ui.isWorking,
            failed = ui.turnOnFailed,
            onContinue = model::continueIntroduction,
            onNotNow = model::leaveSetup,
            modifier = modifier,
        )

        SetupScreen.ForegroundEducation -> LocationPermissionEducationScreen(
            title = stringResource(R.string.auto_attendance_foreground_title),
            body = stringResource(R.string.auto_attendance_foreground_body),
            actionLabel = stringResource(R.string.auto_attendance_continue),
            isWorking = ui.isWorking,
            onContinue = model::requestForeground,
            onNotNow = model::leaveSetup,
            modifier = modifier,
        )

        SetupScreen.BackgroundDisclosure -> BackgroundLocationDisclosureScreen(
            optionLabel = ui.backgroundOptionLabel,
            isWorking = ui.isWorking,
            onContinue = model::requestBackground,
            onDecline = model::leaveSetup,
            modifier = modifier,
        )

        SetupScreen.NotificationEducation -> LocationPermissionEducationScreen(
            title = stringResource(R.string.auto_attendance_notification_title),
            body = stringResource(R.string.auto_attendance_notification_body),
            actionLabel = stringResource(R.string.auto_attendance_continue),
            isWorking = ui.isWorking,
            onContinue = model::requestNotifications,
            onNotNow = model::leaveSetup,
            modifier = modifier,
        )

        SetupScreen.Status, null -> {
            val status = ui.status
            if (status == null) {
                Column(modifier.fillMaxSize(), verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally) {
                    CircularProgressIndicator()
                }
            } else {
                AutomaticAttendanceStatusScreen(
                    status = status,
                    isWorking = ui.isWorking,
                    onFix = { fix -> perform(fix, model, context) },
                    onConfirmArrival = model::confirmArrival,
                    onTurnOff = model::turnOff,
                    modifier = modifier,
                )
            }
        }
    }
}

/** One button, one action. Settings pages open here; everything else is the model's. */
private fun perform(fix: AttendanceFix, model: AutomaticAttendanceModel, context: Context) {
    when (fix) {
        AttendanceFix.None -> Unit
        AttendanceFix.TurnOn -> model.begin()
        AttendanceFix.ContinueSetup -> model.continueSetup()
        AttendanceFix.RequestForeground -> model.requestForegroundInPlace()
        AttendanceFix.RequestPrecise -> model.requestPrecise()
        AttendanceFix.AllowBackground -> model.showBackgroundDisclosure()
        AttendanceFix.RequestNotifications -> model.requestNotifications()
        AttendanceFix.TryAgain -> model.tryAgain()
        AttendanceFix.OpenAppSettings -> open(
            context,
            Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", context.packageName, null)),
        )
        AttendanceFix.OpenLocationSettings -> open(context, Intent(Settings.ACTION_LOCATION_SOURCE_SETTINGS))
        AttendanceFix.OpenNotificationSettings -> open(
            context,
            Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, context.packageName),
        )
        AttendanceFix.ResolvePlayServices -> context.findActivity()?.let { activity ->
            runCatching { GoogleApiAvailability.getInstance().makeGooglePlayServicesAvailable(activity) }
        }
    }
}

private fun open(context: Context, intent: Intent) {
    runCatching { context.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
}

private tailrec fun Context.findActivity(): Activity? = when (this) {
    is Activity -> this
    is ContextWrapper -> baseContext.findActivity()
    else -> null
}

// ---------------------------------------------------------------------------
// Introduction
// ---------------------------------------------------------------------------

@Composable
fun AutomaticAttendanceIntroScreen(
    isWorking: Boolean,
    failed: Boolean,
    onContinue: () -> Unit,
    onNotNow: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val theme = LocalFaithFormTheme.current
    val fill = Modifier
        .fillMaxWidth()
        .heightIn(min = FaithFormTokens.TouchTarget.recommended)

    Column(
        modifier = modifier
            .fillMaxSize()
            .background(theme.palette.background)
            .verticalScroll(rememberScrollState())
            .padding(FaithFormTokens.Layout.screenPaddingHorizontal),
        verticalArrangement = Arrangement.spacedBy(FaithFormTokens.Spacing.lg),
    ) {
        Spacer(Modifier.size(FaithFormTokens.Spacing.base))

        Text(
            text = stringResource(R.string.auto_attendance_intro_title),
            style = MaterialTheme.typography.displayLarge,
            color = theme.palette.contentPrimary,
            modifier = Modifier.semantics { heading() },
        )
        Text(
            text = stringResource(R.string.auto_attendance_intro_body),
            style = MaterialTheme.typography.bodyLarge,
            color = theme.palette.contentSecondary,
        )

        // The privacy explanation sits on the same screen as the offer, not
        // behind a link: someone deciding whether to share their location
        // deserves to read what happens to it in the same breath.
        SurfaceCard {
            Text(
                text = stringResource(R.string.auto_attendance_privacy_title),
                style = MaterialTheme.typography.titleMedium,
                color = theme.palette.contentPrimary,
                modifier = Modifier.semantics { heading() },
            )
            PrivacyPoint(stringResource(R.string.auto_attendance_privacy_point_one))
            PrivacyPoint(stringResource(R.string.auto_attendance_privacy_point_two))
            PrivacyPoint(stringResource(R.string.auto_attendance_privacy_point_three))
            PrivacyPoint(stringResource(R.string.auto_attendance_privacy_point_four))
        }

        if (failed) {
            Text(
                text = stringResource(R.string.error_title),
                style = MaterialTheme.typography.bodyMedium,
                color = theme.palette.destructive,
                modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite },
            )
        }

        Button(onClick = onContinue, enabled = !isWorking, modifier = fill) {
            if (isWorking) {
                WorkingIndicator(stringResource(R.string.auto_attendance_saving))
            } else {
                Text(stringResource(R.string.auto_attendance_continue))
            }
        }
        TextButton(onClick = onNotNow, enabled = !isWorking, modifier = fill) {
            Text(stringResource(R.string.auto_attendance_not_now))
        }

        Spacer(Modifier.size(FaithFormTokens.Spacing.xl))
    }
}

@Composable
private fun PrivacyPoint(text: String) {
    val theme = LocalFaithFormTheme.current
    Row(
        horizontalArrangement = Arrangement.spacedBy(FaithFormTokens.Spacing.sm),
        verticalAlignment = Alignment.Top,
    ) {
        // Decorative: the sentence carries the meaning, so TalkBack reads the
        // text and never announces a bullet.
        Spacer(
            Modifier
                .padding(top = 7.dp)
                .size(6.dp)
                .clip(CircleShape)
                .background(theme.palette.brandPrimary)
                .clearAndSetSemantics { },
        )
        Text(
            text = text,
            style = MaterialTheme.typography.bodyLarge,
            color = theme.palette.contentSecondary,
        )
    }
}

// ---------------------------------------------------------------------------
// Permission education
// ---------------------------------------------------------------------------

/**
 * Why a permission is needed, shown *before* the system dialog.
 *
 * One component for the foreground and notification steps: they differ in
 * copy, not in structure, and two near-identical screens would drift.
 */
@Composable
fun LocationPermissionEducationScreen(
    title: String,
    body: String,
    actionLabel: String,
    isWorking: Boolean,
    onContinue: () -> Unit,
    onNotNow: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val theme = LocalFaithFormTheme.current
    val fill = Modifier
        .fillMaxWidth()
        .heightIn(min = FaithFormTokens.TouchTarget.recommended)

    Column(
        modifier = modifier
            .fillMaxSize()
            .background(theme.palette.background)
            .verticalScroll(rememberScrollState())
            .padding(FaithFormTokens.Layout.screenPaddingHorizontal),
        verticalArrangement = Arrangement.spacedBy(FaithFormTokens.Spacing.lg),
    ) {
        Spacer(Modifier.size(FaithFormTokens.Spacing.xl))

        Text(
            text = title,
            style = MaterialTheme.typography.displayLarge,
            color = theme.palette.contentPrimary,
            modifier = Modifier.semantics { heading() },
        )
        Text(text = body, style = MaterialTheme.typography.bodyLarge, color = theme.palette.contentSecondary)

        Spacer(Modifier.size(FaithFormTokens.Spacing.lg))

        Button(onClick = onContinue, enabled = !isWorking, modifier = fill) {
            if (isWorking) WorkingIndicator(actionLabel) else Text(actionLabel)
        }
        TextButton(onClick = onNotNow, enabled = !isWorking, modifier = fill) {
            Text(stringResource(R.string.auto_attendance_not_now))
        }

        Spacer(Modifier.size(FaithFormTokens.Spacing.xl))
    }
}

/**
 * Google Play's prominent disclosure for background location.
 *
 * Shown immediately before the request, never folded into another screen, and
 * says the three things the User Data policy asks for in the person's own
 * terms: **what** is collected (precise location), **why** (to check them in
 * when they arrive at church for a service, even when the app is closed or not
 * in use), and that it is **not shared**. Declining is a full-width button of
 * equal standing, not a link, and leaves the rest of the app exactly as it was.
 *
 * On Android 11 and later the next screen is Settings, so the disclosure also
 * says which option to choose — in the system's own words where it has them.
 */
@Composable
fun BackgroundLocationDisclosureScreen(
    optionLabel: String?,
    isWorking: Boolean,
    onContinue: () -> Unit,
    onDecline: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val theme = LocalFaithFormTheme.current
    val fill = Modifier
        .fillMaxWidth()
        .heightIn(min = FaithFormTokens.TouchTarget.recommended)

    Column(
        modifier = modifier
            .fillMaxSize()
            .background(theme.palette.background)
            .verticalScroll(rememberScrollState())
            .padding(FaithFormTokens.Layout.screenPaddingHorizontal),
        verticalArrangement = Arrangement.spacedBy(FaithFormTokens.Spacing.lg),
    ) {
        Spacer(Modifier.size(FaithFormTokens.Spacing.base))

        Text(
            text = stringResource(R.string.auto_attendance_disclosure_title),
            style = MaterialTheme.typography.displayLarge,
            color = theme.palette.contentPrimary,
            modifier = Modifier.semantics { heading() },
        )
        Text(
            text = stringResource(R.string.auto_attendance_disclosure_body),
            style = MaterialTheme.typography.bodyLarge,
            color = theme.palette.contentPrimary,
        )

        SurfaceCard {
            PrivacyPoint(stringResource(R.string.auto_attendance_disclosure_point_use))
            PrivacyPoint(stringResource(R.string.auto_attendance_disclosure_point_share))
            PrivacyPoint(stringResource(R.string.auto_attendance_disclosure_point_off))
        }

        Text(
            text = optionLabel?.let { stringResource(R.string.auto_attendance_settings_hint, it) }
                ?: stringResource(R.string.auto_attendance_settings_hint_default),
            style = MaterialTheme.typography.bodyMedium,
            color = theme.palette.contentSecondary,
        )

        Button(onClick = onContinue, enabled = !isWorking, modifier = fill) {
            if (isWorking) WorkingIndicator() else Text(stringResource(R.string.auto_attendance_continue))
        }
        OutlinedButton(onClick = onDecline, enabled = !isWorking, modifier = fill) {
            Text(stringResource(R.string.auto_attendance_disclosure_decline))
        }

        Spacer(Modifier.size(FaithFormTokens.Spacing.xl))
    }
}

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

/** Where automatic check-in stands, and what — if anything — to do about it. */
@Composable
fun AutomaticAttendanceStatusScreen(
    status: AutomaticAttendanceStatus,
    isWorking: Boolean,
    onFix: (AttendanceFix) -> Unit,
    onConfirmArrival: () -> Unit,
    onTurnOff: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val theme = LocalFaithFormTheme.current
    val context = LocalContext.current
    val fill = Modifier
        .fillMaxWidth()
        .heightIn(min = FaithFormTokens.TouchTarget.recommended)
    val copy = copyFor(status)

    Column(
        modifier = modifier
            .fillMaxSize()
            .background(theme.palette.background)
            .verticalScroll(rememberScrollState())
            .padding(
                horizontal = FaithFormTokens.Layout.screenPaddingHorizontal,
                vertical = FaithFormTokens.Layout.screenPaddingVertical,
            )
            .widthIn(max = FaithFormTokens.Layout.contentMaxWidth),
        verticalArrangement = Arrangement.spacedBy(FaithFormTokens.Spacing.base),
    ) {
        SurfaceCard(
            // One announcement rather than fragments, so TalkBack reads the
            // state as a sentence.
            modifier = Modifier.semantics(mergeDescendants = true) {
                liveRegion = LiveRegionMode.Polite
            },
        ) {
            Text(
                text = stringResource(copy.title),
                style = MaterialTheme.typography.titleLarge,
                color = theme.palette.contentPrimary,
                modifier = Modifier.semantics { heading() },
            )
            Text(
                text = stringResource(copy.body),
                style = MaterialTheme.typography.bodyLarge,
                color = theme.palette.contentSecondary,
            )
            if (status.isOn) {
                watchingLine(status)?.let {
                    Text(it, style = MaterialTheme.typography.bodyMedium, color = theme.palette.contentSecondary)
                }
                if (status.monitoring > 0) {
                    Text(
                        text = if (status.monitoring == 1) {
                            stringResource(R.string.auto_attendance_watching, 1)
                        } else {
                            stringResource(R.string.auto_attendance_watching_plural, status.monitoring)
                        },
                        style = MaterialTheme.typography.labelSmall,
                        color = theme.mutedContent,
                    )
                }
            }
        }

        // A church asked this person to confirm. Only ever a server's
        // `pending_confirmation`, never a guess.
        val pendingChurch = status.pendingChurchName?.takeIf { status.pendingConfirmation != null }
        if (pendingChurch != null) {
            val name = pendingChurch.ifBlank { stringResource(R.string.auto_attendance_your_church) }
            val due = System.currentTimeMillis() >= (status.pendingConfirmation?.notBeforeEpochMillis ?: 0L)
            SurfaceCard {
                Text(
                    text = stringResource(R.string.auto_attendance_prompt_title, name),
                    style = MaterialTheme.typography.titleMedium,
                    color = theme.palette.contentPrimary,
                )
                Text(
                    // Before the server's instant the person is asked to stay a
                    // moment; after it, to tap.
                    text = stringResource(
                        if (due) R.string.auto_attendance_prompt_body else R.string.auto_attendance_pending_waiting_body,
                    ),
                    style = MaterialTheme.typography.bodyMedium,
                    color = theme.palette.contentSecondary,
                )
                Button(onClick = onConfirmArrival, enabled = !isWorking, modifier = fill) {
                    Text(stringResource(R.string.auto_attendance_prompt_action_check_in))
                }
            }
        }

        if (copy.fixLabel != null && status.fix != AttendanceFix.None) {
            Button(onClick = { onFix(status.fix) }, enabled = !isWorking, modifier = fill) {
                if (isWorking) WorkingIndicator() else Text(stringResource(copy.fixLabel))
            }
        }

        // Only a server verdict, and `already_counted` reads as success
        // because it is one.
        status.lastCheckIn?.let { last ->
            SurfaceCard(modifier = Modifier.semantics(mergeDescendants = true) { }) {
                Text(
                    text = stringResource(R.string.auto_attendance_recent_title),
                    style = MaterialTheme.typography.labelSmall,
                    color = theme.mutedContent,
                )
                Text(
                    text = stringResource(R.string.auto_attendance_recent_counted, last.churchName),
                    style = MaterialTheme.typography.titleMedium,
                    color = theme.palette.contentPrimary,
                )
                Text(
                    text = listOfNotNull(
                        last.serviceLabel,
                        DateUtils.getRelativeDateTimeString(
                            context,
                            last.atEpochMillis,
                            DateUtils.MINUTE_IN_MILLIS,
                            DateUtils.WEEK_IN_MILLIS,
                            0,
                        ).toString(),
                    ).joinToString(" · "),
                    style = MaterialTheme.typography.bodySmall,
                    color = theme.palette.contentSecondary,
                )
            }
        }

        status.nextService?.let { next ->
            SurfaceCard(modifier = Modifier.semantics(mergeDescendants = true) { }) {
                Text(
                    text = if (next.checkInOpen) {
                        stringResource(R.string.auto_attendance_service_open, next.label)
                    } else {
                        stringResource(R.string.auto_attendance_next_service, next.label)
                    },
                    style = MaterialTheme.typography.titleMedium,
                    color = theme.palette.contentPrimary,
                )
                Text(
                    text = listOfNotNull(
                        next.churchName.takeIf { it.isNotBlank() },
                        DateUtils.formatDateTime(
                            context,
                            if (next.checkInOpen) next.startsAtEpochMillis else next.checkInOpensAtEpochMillis,
                            DateUtils.FORMAT_SHOW_WEEKDAY or DateUtils.FORMAT_SHOW_TIME or DateUtils.FORMAT_ABBREV_WEEKDAY,
                        ),
                    ).joinToString(" · "),
                    style = MaterialTheme.typography.bodySmall,
                    color = theme.palette.contentSecondary,
                )
            }

            // A church that does not offer it is named, rather than silently
            // left out of "Watching for".
            for (church in status.unavailableAt) {
                Text(
                    text = stringResource(R.string.auto_attendance_not_at_this_church, church.name),
                    style = MaterialTheme.typography.bodySmall,
                    color = theme.palette.contentSecondary,
                )
            }
        }

        if (status.canTurnOff) {
            HealthCard(status = status, isWorking = isWorking, onFix = onFix)
        }

        // One tap, as on iPhone: nothing is lost that turning on again
        // would not restore.
        if (status.canTurnOff) {
            OutlinedButton(
                onClick = onTurnOff,
                enabled = !isWorking,
                modifier = fill,
            ) { Text(stringResource(R.string.auto_attendance_disable)) }
        }

        Spacer(Modifier.size(FaithFormTokens.Spacing.lg))
    }
}

/**
 * Each thing the feature depends on, whether it is in place, and the one fix
 * for it. The person sees exactly which switch is off rather than a single
 * "not working".
 */
@Composable
private fun HealthCard(
    status: AutomaticAttendanceStatus,
    isWorking: Boolean,
    onFix: (AttendanceFix) -> Unit,
) {
    val theme = LocalFaithFormTheme.current
    val blocker = (status.step as? AutomaticAttendanceStep.Blocked)?.blocker

    SurfaceCard {
        Text(
            text = stringResource(R.string.auto_attendance_health_title),
            style = MaterialTheme.typography.titleMedium,
            color = theme.palette.contentPrimary,
            modifier = Modifier.semantics { heading() },
        )

        HealthRow(
            label = stringResource(R.string.auto_attendance_health_services),
            ok = blocker != AutomaticAttendanceBlocker.LocationServicesOff,
            fix = if (blocker == AutomaticAttendanceBlocker.LocationServicesOff) status.fix else AttendanceFix.None,
            isWorking = isWorking,
            onFix = onFix,
        )
        HealthRow(
            label = stringResource(R.string.auto_attendance_health_precise),
            ok = blocker !in setOf(
                AutomaticAttendanceBlocker.ForegroundDenied,
                AutomaticAttendanceBlocker.ForegroundPermanentlyDenied,
                AutomaticAttendanceBlocker.ApproximateLocationOnly,
            ) && blocker != AutomaticAttendanceBlocker.LocationServicesOff,
            fix = if (blocker in setOf(
                    AutomaticAttendanceBlocker.ForegroundDenied,
                    AutomaticAttendanceBlocker.ForegroundPermanentlyDenied,
                    AutomaticAttendanceBlocker.ApproximateLocationOnly,
                )
            ) status.fix else AttendanceFix.None,
            isWorking = isWorking,
            onFix = onFix,
        )
        HealthRow(
            label = stringResource(R.string.auto_attendance_health_background),
            ok = blocker == null || blocker !in setOf(
                AutomaticAttendanceBlocker.NeedsBackgroundPermission,
                AutomaticAttendanceBlocker.ForegroundDenied,
                AutomaticAttendanceBlocker.ForegroundPermanentlyDenied,
                AutomaticAttendanceBlocker.ApproximateLocationOnly,
                AutomaticAttendanceBlocker.LocationServicesOff,
            ),
            fix = if (blocker == AutomaticAttendanceBlocker.NeedsBackgroundPermission) status.fix else AttendanceFix.None,
            isWorking = isWorking,
            onFix = onFix,
        )
        HealthRow(
            label = stringResource(R.string.auto_attendance_health_notifications),
            ok = status.notifications == NotificationAccess.Granted ||
                status.notifications == NotificationAccess.NotRequired,
            optional = true,
            fix = status.notificationFix,
            isWorking = isWorking,
            onFix = onFix,
        )
        if (status.notificationFix == AttendanceFix.OpenNotificationSettings) {
            Text(
                text = stringResource(R.string.auto_attendance_notifications_off_body),
                style = MaterialTheme.typography.bodySmall,
                color = theme.palette.contentSecondary,
            )
        }
    }
}

@Composable
private fun HealthRow(
    label: String,
    ok: Boolean,
    fix: AttendanceFix,
    isWorking: Boolean,
    onFix: (AttendanceFix) -> Unit,
    optional: Boolean = false,
) {
    val theme = LocalFaithFormTheme.current
    val state = stringResource(
        when {
            ok -> R.string.auto_attendance_health_ok
            optional -> R.string.auto_attendance_off
            else -> R.string.auto_attendance_health_needed
        },
    )
    val icon: ImageVector = when {
        ok -> Icons.Outlined.CheckCircle
        optional -> Icons.Outlined.RemoveCircleOutline
        else -> Icons.Outlined.ErrorOutline
    }
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .heightIn(min = FaithFormTokens.TouchTarget.minimum)
            .semantics(mergeDescendants = true) { contentDescription = "$label, $state" },
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(FaithFormTokens.Spacing.md),
    ) {
        Icon(
            imageVector = icon,
            contentDescription = null,
            tint = when {
                ok -> theme.palette.success
                optional -> theme.mutedContent
                else -> theme.palette.warningContent
            },
            modifier = Modifier.size(FaithFormTokens.IconSize.sizeLarge),
        )
        Column(Modifier.weight(1f)) {
            Text(label, style = MaterialTheme.typography.bodyLarge, color = theme.palette.contentPrimary)
            Text(state, style = MaterialTheme.typography.bodySmall, color = theme.palette.contentSecondary)
        }
        fixLabel(fix)?.let { labelRes ->
            TextButton(onClick = { onFix(fix) }, enabled = !isWorking) { Text(stringResource(labelRes)) }
        }
    }
}

// ---------------------------------------------------------------------------
// The Check in tab's summary
// ---------------------------------------------------------------------------

/**
 * A compact summary at the top of the Check in tab.
 *
 * QR check-in stays exactly where it was underneath: automatic check-in is an
 * addition, and a person whose phone cannot do it still scans the code.
 */
@Composable
fun AutomaticAttendanceSummaryCard(
    model: AutomaticAttendanceModel,
    onOpen: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val ui by model.ui.collectAsStateWithLifecycle()
    val status = ui.status ?: return
    val theme = LocalFaithFormTheme.current
    val stateLabel = stringResource(stateLabelFor(status))
    val title = stringResource(R.string.auto_attendance_title)

    Column(
        modifier = modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(FaithFormTokens.Radius.lg))
            .background(theme.palette.surface)
            .border(theme.borderWidth, theme.palette.border, RoundedCornerShape(FaithFormTokens.Radius.lg)),
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .heightIn(min = FaithFormTokens.TouchTarget.recommended)
                .clickable(onClick = onOpen)
                .semantics(mergeDescendants = true) { contentDescription = "$title, $stateLabel" }
                .padding(FaithFormTokens.Spacing.base),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(FaithFormTokens.Spacing.md),
        ) {
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(FaithFormTokens.Spacing.xs)) {
                Text(title, style = MaterialTheme.typography.titleMedium, color = theme.palette.contentPrimary)
                Text(
                    text = if (status.isOn) watchingLine(status) ?: stateLabel else stateLabel,
                    style = MaterialTheme.typography.bodySmall,
                    color = theme.palette.contentSecondary,
                )
            }
            Icon(
                Icons.AutoMirrored.Outlined.KeyboardArrowRight,
                contentDescription = null,
                tint = theme.mutedContent,
            )
        }

        val pendingChurch = status.pendingChurchName?.takeIf { status.pendingConfirmation != null }
        if (pendingChurch != null) {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = FaithFormTokens.Spacing.base)
                    .padding(bottom = FaithFormTokens.Spacing.base),
                verticalArrangement = Arrangement.spacedBy(FaithFormTokens.Spacing.sm),
            ) {
                Text(
                    stringResource(
                        R.string.auto_attendance_prompt_title,
                        pendingChurch.ifBlank { stringResource(R.string.auto_attendance_your_church) },
                    ),
                    style = MaterialTheme.typography.bodyLarge,
                    color = theme.palette.contentPrimary,
                )
                Button(
                    onClick = model::confirmArrival,
                    enabled = !ui.isWorking,
                    modifier = Modifier.fillMaxWidth().heightIn(min = FaithFormTokens.TouchTarget.recommended),
                ) { Text(stringResource(R.string.auto_attendance_prompt_action_check_in)) }
            }
        }
    }
}

/**
 * The line under "Automatic check-in" in the summary: "On", what needs doing
 * when it is on but blocked, or "Off".
 */
fun stateLabelFor(status: AutomaticAttendanceStatus): Int = when {
    status.isOn -> R.string.auto_attendance_on
    status.canTurnOff -> copyFor(status).title
    else -> R.string.auto_attendance_off
}

@Composable
private fun watchingLine(status: AutomaticAttendanceStatus): String? {
    if (status.watching.isEmpty()) return null
    return stringResource(R.string.auto_attendance_watching_churches, status.watching.joinToString(", ") { it.name })
}

// ---------------------------------------------------------------------------
// Copy
// ---------------------------------------------------------------------------

/** The title, the explanation and the main button's label for a status. */
data class StatusCopy(val title: Int, val body: Int, val fixLabel: Int?)

/**
 * The words for every step and blocker.
 *
 * A pure mapping, so a test can walk every case and prove none is missing and
 * none offers a button that does nothing.
 */
fun copyFor(status: AutomaticAttendanceStatus): StatusCopy {
    val fixLabel = fixLabel(status.fix)
    return when (val step = status.step) {
        AutomaticAttendanceStep.Ready ->
            StatusCopy(R.string.auto_attendance_ready_title, R.string.auto_attendance_ready_body, null)
        is AutomaticAttendanceStep.Blocked -> when (step.blocker) {
            AutomaticAttendanceBlocker.ForegroundDenied,
            AutomaticAttendanceBlocker.ForegroundPermanentlyDenied,
            -> if (status.fix == AttendanceFix.ContinueSetup) {
                StatusCopy(R.string.auto_attendance_needs_permission_title, R.string.auto_attendance_needs_permission_body, fixLabel)
            } else {
                StatusCopy(R.string.auto_attendance_denied_title, R.string.auto_attendance_denied_body, fixLabel)
            }
            AutomaticAttendanceBlocker.ApproximateLocationOnly ->
                StatusCopy(R.string.auto_attendance_accuracy_title, R.string.auto_attendance_accuracy_body, fixLabel)
            AutomaticAttendanceBlocker.NeedsBackgroundPermission ->
                if (status.fix == AttendanceFix.ContinueSetup) {
                    StatusCopy(R.string.auto_attendance_needs_permission_title, R.string.auto_attendance_needs_permission_body, fixLabel)
                } else {
                    StatusCopy(R.string.auto_attendance_always_title, R.string.auto_attendance_always_body, fixLabel)
                }
            AutomaticAttendanceBlocker.LocationServicesOff ->
                StatusCopy(R.string.auto_attendance_services_off_title, R.string.auto_attendance_services_off_body, fixLabel)
            AutomaticAttendanceBlocker.PlayServicesUnavailable ->
                StatusCopy(R.string.auto_attendance_unavailable_title, R.string.auto_attendance_unavailable_body, fixLabel)
            AutomaticAttendanceBlocker.NoPeopleLink ->
                StatusCopy(R.string.auto_attendance_no_link_title, R.string.auto_attendance_no_link_body, null)
            AutomaticAttendanceBlocker.ConsentMissing ->
                StatusCopy(R.string.auto_attendance_consent_missing_title, R.string.auto_attendance_consent_missing_body, fixLabel)
            // A button only while the feature is off, where trying again cannot
            // raise a location prompt; while it is on, nothing here helps.
            AutomaticAttendanceBlocker.ChurchDisabled ->
                StatusCopy(R.string.auto_attendance_church_disabled_title, R.string.auto_attendance_church_disabled_body, fixLabel)
            AutomaticAttendanceBlocker.NoCampus ->
                StatusCopy(R.string.auto_attendance_no_campus_title, R.string.auto_attendance_no_campus_body, fixLabel)
            AutomaticAttendanceBlocker.Unavailable ->
                StatusCopy(R.string.auto_attendance_offline_title, R.string.auto_attendance_offline_body, fixLabel)
        }
        else -> StatusCopy(R.string.auto_attendance_off_title, R.string.auto_attendance_off_body, fixLabel)
    }
}

/** The label for a fix's button, or null when there is no button. */
fun fixLabel(fix: AttendanceFix): Int? = when (fix) {
    AttendanceFix.None -> null
    AttendanceFix.TurnOn -> R.string.auto_attendance_enable
    AttendanceFix.ContinueSetup -> R.string.auto_attendance_continue_setup
    AttendanceFix.RequestForeground -> R.string.auto_attendance_continue_setup
    AttendanceFix.RequestPrecise -> R.string.auto_attendance_continue_setup
    AttendanceFix.OpenAppSettings -> R.string.auto_attendance_open_settings
    AttendanceFix.OpenLocationSettings -> R.string.auto_attendance_location_settings_action
    AttendanceFix.AllowBackground -> R.string.auto_attendance_allow_all_the_time
    AttendanceFix.ResolvePlayServices -> R.string.auto_attendance_play_services_action
    AttendanceFix.RequestNotifications -> R.string.auto_attendance_continue_setup
    AttendanceFix.OpenNotificationSettings -> R.string.auto_attendance_open_settings
    AttendanceFix.TryAgain -> R.string.try_again
}

// ---------------------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------------------

@Composable
private fun SurfaceCard(
    modifier: Modifier = Modifier,
    content: @Composable () -> Unit,
) {
    val theme = LocalFaithFormTheme.current
    Column(
        modifier = modifier
            .fillMaxWidth()
            .background(theme.palette.surface, RoundedCornerShape(FaithFormTokens.Radius.lg))
            .border(theme.borderWidth, theme.palette.border, RoundedCornerShape(FaithFormTokens.Radius.lg))
            .padding(FaithFormTokens.Spacing.base),
        verticalArrangement = Arrangement.spacedBy(FaithFormTokens.Spacing.sm),
    ) { content() }
}

@Composable
private fun WorkingIndicator(label: String? = null) {
    CircularProgressIndicator(
        modifier = Modifier
            .size(20.dp)
            .semantics { label?.let { contentDescription = it } },
        strokeWidth = 2.dp,
    )
}
