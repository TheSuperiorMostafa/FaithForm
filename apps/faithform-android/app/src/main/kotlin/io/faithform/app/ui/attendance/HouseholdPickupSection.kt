package io.faithform.app.ui.attendance

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import io.faithform.app.contract.KidsCheckInData
import io.faithform.app.design.LocalFaithFormTheme
import io.faithform.app.network.ApiClient
import io.faithform.app.network.MobileSuccess
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay

/** Credentials are fetched through guardian authorization and never persisted. */
@Composable
fun HouseholdPickupSection(api: ApiClient, churchSlug: String, modifier: Modifier = Modifier) {
    val theme = LocalFaithFormTheme.current
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    var active by remember(lifecycle) { mutableStateOf(lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED)) }
    var refresh by remember { mutableIntStateOf(0) }
    var data by remember(api, churchSlug) { mutableStateOf<KidsCheckInData?>(null) }
    var loading by remember(api, churchSlug) { mutableStateOf(true) }
    var failed by remember(api, churchSlug) { mutableStateOf(false) }

    DisposableEffect(lifecycle) {
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_START) active = true
            if (event == Lifecycle.Event.ON_STOP) { active = false; data = null }
        }
        lifecycle.addObserver(observer)
        onDispose { lifecycle.removeObserver(observer); data = null }
    }
    LaunchedEffect(api, churchSlug, active, refresh) {
        data = null
        if (!active) return@LaunchedEffect
        // Keep foreground room alerts current, even when a notification is dismissed.
        while (true) {
            loading = data == null; failed = false
            try {
                data = api.send("api/mobile/v1/checkin/$churchSlug/household", MobileSuccess.serializer(KidsCheckInData.serializer())).value
                failed = data == null
            } catch (cancelled: CancellationException) { throw cancelled }
            catch (_: Exception) { data = null; failed = true }
            finally { loading = false }
            delay(30_000)
        }
    }
    Column(
        modifier.fillMaxWidth().background(theme.palette.surface, RoundedCornerShape(16.dp)).padding(20.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text("Kids check-in", style = MaterialTheme.typography.titleMedium, color = theme.palette.contentPrimary)
        when {
            loading -> Text("Loading household pickup codes…", Modifier.heightIn(min = 100.dp), color = theme.palette.contentSecondary)
            failed -> Text("We couldn’t load your pickup codes. Connect to the internet and try again.", color = theme.palette.contentSecondary)
            data?.households?.isEmpty() == true -> Text("No household is linked to your account. Ask the check-in team to confirm your guardian access.", color = theme.palette.contentSecondary)
            else -> data?.households?.forEach { household ->
                Text(household.label, style = MaterialTheme.typography.titleMedium, color = theme.palette.contentPrimary)
                Text("Household pickup code", color = theme.palette.contentSecondary)
                Text(household.pickupCode, style = MaterialTheme.typography.headlineLarge, fontFamily = FontFamily.Monospace, fontWeight = FontWeight.Bold, color = theme.palette.contentPrimary)
                Text("Show this code to the check-in team at pickup. Keep it private.", style = MaterialTheme.typography.bodySmall, color = theme.palette.contentSecondary)
                household.children.forEach { child -> Text("${child.name} · ${child.roomName}", color = theme.palette.contentPrimary) }
                household.alerts.forEach { alert ->
                    Text("Please return to ${alert.roomName} for ${alert.childName}.", fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.error,
                        modifier = Modifier.fillMaxWidth().background(MaterialTheme.colorScheme.errorContainer, RoundedCornerShape(12.dp)).padding(12.dp))
                }
            }
        }
        TextButton(onClick = { refresh++ }, enabled = !loading) { Text("Refresh pickup codes") }
    }
}
