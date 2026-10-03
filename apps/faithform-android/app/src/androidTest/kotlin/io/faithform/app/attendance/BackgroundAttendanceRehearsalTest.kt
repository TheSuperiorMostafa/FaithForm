package io.faithform.app.attendance

import android.content.Context
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.work.WorkManager
import com.google.android.gms.location.Geofence
import io.faithform.app.FaithFormApplication
import io.faithform.app.session.AppContainer
import io.faithform.app.session.StoredSession
import kotlinx.coroutines.*
import okhttp3.*
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.util.concurrent.TimeUnit

/** Real WorkManager/HTTP/Keystore/Play registration; coordinates and account are fixture-only. */
@RunWith(AndroidJUnit4::class)
class BackgroundAttendanceRehearsalTest {
    private val origin = "http://10.0.2.2:18765"
    private val http = OkHttpClient()
    private fun control(body: String) { http.newCall(Request.Builder().url("$origin/control").post(body.toRequestBody()).build()).execute().use { assertTrue(it.isSuccessful) } }
    private fun status(): JSONObject = http.newCall(Request.Builder().url("$origin/status").build()).execute().use { JSONObject(requireNotNull(it.body).string()).getJSONObject("data") }
    private suspend fun until(condition: () -> Boolean) = withTimeout(25_000) { while (!condition()) delay(150) }
    private fun graph(context: Context): AppContainer = AppContainer(context, origin, "attendance-rehearsal", 1, true,
        attendanceLocationSampling = object : LocationSampling {
            override suspend fun requestOneShotLocation(timeoutMillis: Long) = LocationSample(60.0, 60.0, 10f, System.currentTimeMillis())
        }).also { graph ->
            graph.sessionStore.adopt(StoredSession("isolated-rehearsal", "isolated-refresh", System.currentTimeMillis()+3_600_000, "rehearsal-account", "attendance-rehearsal"))
            graph.secureStore.edit().putString("attendance.church", "rehearsal").putBoolean("attendance.enabled.rehearsal-account.rehearsal", true).commit()
        }
    private suspend fun rehearsal(block: suspend (Context, AppContainer, (AppContainer) -> Unit) -> Unit) {
        assumeTrue(InstrumentationRegistry.getArguments().getString("attendanceRehearsal") == "true")
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val app = context.applicationContext as FaithFormApplication
        val original = requireNotNull(app.container)
        // Test-only replacement; production has no runtime environment switch.
        val field = FaithFormApplication::class.java.getDeclaredField("container").apply { isAccessible = true }
        val work = WorkManager.getInstance(context)
        original.attendanceRuntime.clear()
        work.cancelAllWorkByTag("faithform.attendance").result.get(10, TimeUnit.SECONDS)
        val fixture = graph(context)
        fixture.secureStore.edit().clear().commit()
        val current = graph(context)
        control("{\"reset\":true}")
        field.set(app, current)
        try {
            assertTrue("The rehearsal requires precise background permission and Location Accuracy", current.attendanceRuntime.restore())
            assertEquals(1, current.attendanceRuntime.reconciler.lastOutcome.monitoring)
            block(context, current) { field.set(app, it) }
        } finally {
            AppContainer.from(context)?.attendanceRuntime?.clear()
            work.cancelAllWorkByTag("faithform.attendance").result.get(10, TimeUnit.SECONDS)
            current.secureStore.edit().clear().commit()
            field.set(app, original)
            original.attendanceRuntime.foreground()
        }
    }
    @Test fun delayedConfirmationSurvivesColdGraph() = runBlocking {
        rehearsal { context, fixture, replace ->
            AttendanceWork.enqueue(context, Geofence.GEOFENCE_TRANSITION_ENTER, "faithform.rehearsal")
            until { status().getInt("detected") == 1 }
            assertEquals(0, status().getInt("confirmed"))
            val deadline = System.currentTimeMillis() + 2_000
            while (System.currentTimeMillis() < deadline) delay(100)
            assertEquals("Confirmed before server dwell", 0, status().getInt("confirmed"))
            // Worker loads a new owner with the same encrypted pending attempt.
            replace(graph(context))
            until { status().getInt("confirmed") == 1 }
            assertEquals(1, status().getInt("detected"))
            assertTrue(AppContainer.from(context)!!.automaticAttendance.phase.isSuccess)
            assertTrue(fixture.secureStore.all.keys.none { it.startsWith("attendance_attempt|") })
        }
    }
    @Test fun exitCancelsBackgroundConfirmation() = runBlocking {
        rehearsal { context, fixture, _ ->
            AttendanceWork.enqueue(context, Geofence.GEOFENCE_TRANSITION_ENTER, "faithform.rehearsal")
            until { status().getInt("detected") == 1 }
            // Wait until the first worker has persisted its server deadline.
            until { fixture.secureStore.all.keys.any { it.startsWith("attendance_attempt|") } }
            AttendanceWork.enqueue(context, Geofence.GEOFENCE_TRANSITION_EXIT, "faithform.rehearsal")
            until { fixture.secureStore.all.keys.none { it.startsWith("attendance_attempt|") } }
            delay(7_000)
            assertEquals(0, status().getInt("confirmed"))
        }
    }
    @Test fun disablingOfflineStopsWorkImmediately() = runBlocking {
        rehearsal { context, fixture, _ ->
            AttendanceWork.enqueue(context, Geofence.GEOFENCE_TRANSITION_ENTER, "faithform.rehearsal")
            until { status().getInt("detected") == 1 }
            until { fixture.secureStore.all.keys.any { it.startsWith("attendance_attempt|") } }
            control("{\"offline\":true}")
            assertFalse(fixture.attendanceRuntime.disable())
            assertFalse(fixture.automaticAttendance.settings.enabled)
            assertEquals(0, fixture.attendanceRuntime.reconciler.lastOutcome.monitoring)
            assertTrue(fixture.secureStore.all.keys.none { it.startsWith("attendance_attempt|") })
            AttendanceWork.enqueue(context, Geofence.GEOFENCE_TRANSITION_DWELL, "faithform.rehearsal")
            delay(7_000)
            assertEquals(0, status().getInt("confirmed"))
            control("{\"offline\":false}")
            fixture.attendanceRuntime.foreground()
            assertFalse(fixture.secureStore.getBoolean("attendance.pendingWithdrawal", false))
        }
    }
}
