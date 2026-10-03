package io.faithform.app.ui.attendance

import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.faithform.app.R
import io.faithform.app.attendance.*
import io.faithform.app.session.AppContainer
import io.faithform.app.ui.components.motionReveal
import kotlinx.coroutines.launch

/** Education, foreground permission, background settings, then authenticated server consent. */
@Composable
fun AutomaticAttendanceHost(container: AppContainer, onChanged: () -> Unit, onClose: () -> Unit) {
    val runtime = container.attendanceRuntime
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val state by runtime.state.collectAsStateWithLifecycle()
    var screen by rememberSaveable { mutableStateOf(if (runtime.coordinator.settings.enabled) "status" else "intro") }
    var awaitingSettings by rememberSaveable { mutableStateOf(false) }
    var working by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val failure = stringResource(R.string.auto_attendance_offline_body)
    fun enable() {
        scope.launch {
            working = true; error = null
            try { runtime.enable(); screen = "status"; onChanged() }
            catch (cancelled: kotlinx.coroutines.CancellationException) { throw cancelled }
            catch (_: Exception) { error = failure; screen = "status" }
            finally { working = false }
        }
    }
    fun settings(forSetup: Boolean) {
        awaitingSettings = forSetup
        val locationServicesOff = (state.step as? AutomaticAttendanceStep.Blocked)?.blocker == AutomaticAttendanceBlocker.LocationServicesOff
        context.startActivity(if (locationServicesOff) Intent(Settings.ACTION_LOCATION_SOURCE_SETTINGS)
            else Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:${context.packageName}")))
    }
    val owner = LocalLifecycleOwner.current
    DisposableEffect(owner, awaitingSettings) {
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_RESUME) scope.launch {
                runtime.refreshStatus()
                if (awaitingSettings && runtime.permissions.current().canMonitorGeofences) {
                    awaitingSettings = false; enable()
                }
            }
        }
        owner.lifecycle.addObserver(observer)
        onDispose { owner.lifecycle.removeObserver(observer) }
    }
    LaunchedEffect(Unit) { runtime.refreshStatus() }
    Column(Modifier.fillMaxSize().motionReveal(screen)) {
        error?.let { Text(it) }
        when (screen) {
            "intro" -> AutomaticAttendanceIntroScreen(
                onContinue = { scope.launch {
                    screen = if (runtime.permissions.current().needsForegroundFirst) "foreground" else "background"
                } }, onNotNow = onClose,
            )
            "foreground" -> LocationPermissionEducationScreen(
                title = stringResource(R.string.auto_attendance_foreground_title),
                body = stringResource(R.string.auto_attendance_foreground_body),
                actionLabel = stringResource(R.string.auto_attendance_continue), isWorking = working,
                onContinue = { scope.launch {
                    working = true
                    val permissions = runtime.permissions.requestForeground()
                    runtime.refreshStatus()
                    working = false
                    screen = if (permissions.foreground == ForegroundLocationPermission.Fine) "background" else "status"
                } }, onNotNow = onClose,
            )
            "background" -> LocationPermissionEducationScreen(
                title = stringResource(R.string.auto_attendance_background_title),
                body = stringResource(R.string.auto_attendance_background_body),
                actionLabel = stringResource(if (hasGeofencePermissions(context)) R.string.auto_attendance_enable
                    else if (Build.VERSION.SDK_INT >= 30) R.string.auto_attendance_open_settings else R.string.auto_attendance_continue),
                isWorking = working,
                onContinue = { scope.launch {
                    val permissions = runtime.permissions.current()
                    if (permissions.canMonitorGeofences) enable()
                    else if (permissions.strategy == BackgroundRequestStrategy.SettingsOnly) settings(true)
                    else if (runtime.permissions.requestBackground().canMonitorGeofences) enable()
                    else { runtime.refreshStatus(); screen = "status" }
                } }, onNotNow = onClose,
            )
            else -> AutomaticAttendanceStatusScreen(
                state = localizedState(state.copy(isWorking = working)),
                enabled = runtime.coordinator.settings.enabled,
                onRetry = { scope.launch {
                    working = true
                    try { runtime.foreground() }
                    catch (cancelled: kotlinx.coroutines.CancellationException) { throw cancelled }
                    catch (_: Exception) { error = failure }
                    finally { working = false }
                } },
                onSetUp = { screen = "intro" },
                onDisable = { scope.launch {
                    working = true
                    if (!runtime.disable()) error = context.getString(R.string.auto_attendance_withdrawal_pending)
                    working = false; onChanged()
                } },
                onOpenSettings = { settings(!runtime.coordinator.settings.enabled) },
            )
        }
    }
}

@Composable
private fun localizedState(state: AutomaticAttendanceUiState): AutomaticAttendanceUiState {
    val pair = when (val step = state.step) {
        AutomaticAttendanceStep.Ready -> R.string.auto_attendance_ready_title to R.string.auto_attendance_ready_body
        is AutomaticAttendanceStep.Blocked -> when (step.blocker) {
            AutomaticAttendanceBlocker.ForegroundDenied, AutomaticAttendanceBlocker.ForegroundPermanentlyDenied -> R.string.auto_attendance_denied_title to R.string.auto_attendance_denied_body
            AutomaticAttendanceBlocker.ApproximateLocationOnly -> R.string.auto_attendance_accuracy_title to R.string.auto_attendance_accuracy_body
            AutomaticAttendanceBlocker.NeedsBackgroundPermission -> R.string.auto_attendance_always_title to R.string.auto_attendance_always_body
            AutomaticAttendanceBlocker.LocationServicesOff -> R.string.auto_attendance_services_off_title to R.string.auto_attendance_services_off_body
            AutomaticAttendanceBlocker.NoPeopleLink -> R.string.auto_attendance_no_link_title to R.string.auto_attendance_no_link_body
            AutomaticAttendanceBlocker.NoCampus -> R.string.auto_attendance_no_campus_title to R.string.auto_attendance_no_campus_body
            AutomaticAttendanceBlocker.ChurchDisabled -> R.string.auto_attendance_church_disabled_title to R.string.auto_attendance_church_disabled_body
            AutomaticAttendanceBlocker.ConsentMissing -> R.string.auto_attendance_consent_missing_title to R.string.auto_attendance_consent_missing_body
            AutomaticAttendanceBlocker.PlayServicesUnavailable -> R.string.auto_attendance_play_services_title to R.string.auto_attendance_play_services_body
            AutomaticAttendanceBlocker.Unavailable -> R.string.auto_attendance_offline_title to R.string.auto_attendance_offline_body
        }
        else -> R.string.auto_attendance_off_title to R.string.auto_attendance_off_body
    }
    return state.copy(title = stringResource(pair.first), explanation = stringResource(pair.second))
}
