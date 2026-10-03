package io.faithform.app.attendance

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import io.faithform.app.contract.Bootstrap
import io.faithform.app.contract.GeofenceConfigResponse
import io.faithform.app.network.ApiException
import io.faithform.app.network.MobileSuccess
import io.faithform.app.session.AppContainer
import kotlinx.coroutines.runBlocking
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.time.Instant

/** Optional configuration and registration probe using an already signed-in emulator. */
@RunWith(AndroidJUnit4::class)
class ReadinessProbeTest {
    @Test fun inspectAuthorizedConfiguration() = runBlocking {
        assumeTrue(InstrumentationRegistry.getArguments().getString("readinessProbe") == "true")
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val container = requireNotNull(AppContainer.from(context))
        val value = requireNotNull(container.apiClient.send("api/mobile/v1/account/bootstrap", MobileSuccess.serializer(Bootstrap.serializer())).value)
        val slug = requireNotNull(container.secureStore.getString("attendance.church", null) ?: value.profile.selectedChurchSlug ?: value.relationships.firstOrNull()?.churchSlug)
        container.attendanceRuntime.bind(value, slug)
        if (InstrumentationRegistry.getArguments().getString("coldRegistration") == "true") {
            org.junit.Assert.assertEquals(1, container.attendanceRuntime.reconciler.lastOutcome.monitoring)
            org.junit.Assert.assertNull(container.attendanceRuntime.reconciler.lastOutcome.refusal)
            org.junit.Assert.assertTrue(container.attendanceRuntime.reconciler.lastOutcome.added.isNotEmpty())
        }
        val report = buildString {
            appendLine("deviceOptIn=${container.attendanceRuntime.coordinator.settings.enabled}")
            appendLine("registeredRegionCount=${container.attendanceRuntime.reconciler.lastOutcome.monitoring}")
            appendLine("newlyRegisteredRegionCount=${container.attendanceRuntime.reconciler.lastOutcome.added.size}")
            appendLine("consent=${value.profile.autoAttendanceConsent.wire}")
            appendLine("churchEnabled=${value.relationships.firstOrNull { it.churchSlug == slug }?.automaticCheckInEnabled}")
            appendLine("permissions=${container.attendanceRuntime.permissions.current()}")
            try {
                val response = container.apiClient.send("api/mobile/v1/attendance/$slug/geofence-config", MobileSuccess.serializer(GeofenceConfigResponse.serializer())).value
                appendLine("refusal=${response?.refusalReason}")
                appendLine("configurationPresent=${response?.configuration != null}")
                appendLine("configurationFresh=${response?.configuration?.let { Instant.parse(it.expiresAt).toEpochMilli() > System.currentTimeMillis() }}")
                appendLine("regionCount=${response?.configuration?.regions?.size}")
                if (InstrumentationRegistry.getArguments().getString("directRegistration") == "true" && container.attendanceRuntime.coordinator.settings.enabled && container.attendanceRuntime.permissions.current().canMonitorGeofences) {
                    response?.configuration?.let { config ->
                        val monitor = PlayServicesRegionMonitoring(context, mirrorPreferences = container.secureStore)
                        try {
                            com.google.android.gms.tasks.Tasks.await(com.google.android.gms.location.LocationServices.getGeofencingClient(context).addGeofences(
                                monitor.buildRequest(GeofenceReconciler.selectRegions(config)), monitor.pendingIntentForTest()), 20, java.util.concurrent.TimeUnit.SECONDS)
                            appendLine("playRegistration=accepted")
                        } catch (e: Exception) {
                            val failure = e.cause ?: e
                            appendLine("playRegistrationFailure=${(failure as? com.google.android.gms.common.api.ApiException)?.statusCode ?: failure::class.java.simpleName}")
                        }
                    }
                }
            } catch (e: ApiException) { appendLine("apiFailure=${e.code};retryable=${e.retryable}") }
            catch (e: Exception) { appendLine("clientFailure=${e::class.java.simpleName}") }
            appendLine("registrationRefusal=${container.attendanceRuntime.reconciler.lastOutcome.refusal}")
        }
        File(context.filesDir, "readiness-probe.txt").writeText(report)
    }
}
