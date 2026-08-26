package io.faithform.faithful.attendance

import android.Manifest
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.location.LocationManager
import android.os.Build
import androidx.core.content.ContextCompat
import com.google.android.gms.common.ConnectionResult
import com.google.android.gms.common.GoogleApiAvailability
import com.google.android.gms.location.Geofence
import com.google.android.gms.location.GeofencingClient
import com.google.android.gms.location.GeofencingRequest
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withTimeoutOrNull
import kotlin.coroutines.resume

/**
 * The only file in Faithful that touches Play services location.
 *
 * **It contains no decisions.** Every rule about when to ask, what to register
 * and what a transition means lives in `:core:attendance`, which is pure JVM and
 * is therefore exercised by `gradle :core:attendance:test` with no emulator and
 * no movement. This file only translates.
 *
 * **What is deliberately absent:** `requestLocationUpdates`, any foreground
 * service, any periodic poll, and any `WorkManager` job that samples position.
 * The system does the monitoring and wakes a receiver; the app asks for one fix
 * when that happens and nothing else. A forbidden-symbol sweep asserts none of
 * the continuous APIs appears anywhere in the app.
 */
/**
 * The exact slice of `GeofencingClient` this feature uses.
 *
 * **Why a façade.** `GeofencingClient` cannot run under Robolectric — Play
 * services genuinely is not there — so without a seam the registration path is
 * reachable only on a device with Play services installed. That is the code
 * whose failure modes matter most: a rejected task, a cancelled one, a partial
 * failure mid-reconciliation.
 *
 * This tests **that Faithful calls Play services correctly and handles every
 * result**. It does not test Play services.
 */
interface GeofencingFacade {
    /** Mirrors `addGeofences`. Returns what the task resolved to. */
    suspend fun addGeofences(request: GeofencingRequest, pendingIntent: PendingIntent): TaskResult

    suspend fun removeGeofences(requestIds: List<String>): TaskResult

    suspend fun removeGeofences(pendingIntent: PendingIntent): TaskResult

    sealed interface TaskResult {
        data object Success : TaskResult
        /** The task failed. The reason is never surfaced or logged. */
        data class Failure(val kind: String) : TaskResult
        data object Cancelled : TaskResult
    }
}

/** The production façade. One call each, and no decisions. */
class PlayServicesGeofencingFacade(context: Context) : GeofencingFacade {
    private val client: GeofencingClient = LocationServices.getGeofencingClient(context)

    override suspend fun addGeofences(
        request: GeofencingRequest,
        pendingIntent: PendingIntent,
    ): GeofencingFacade.TaskResult = await { client.addGeofences(request, pendingIntent) }

    override suspend fun removeGeofences(requestIds: List<String>): GeofencingFacade.TaskResult =
        await { client.removeGeofences(requestIds) }

    override suspend fun removeGeofences(
        pendingIntent: PendingIntent,
    ): GeofencingFacade.TaskResult = await { client.removeGeofences(pendingIntent) }

    private suspend fun await(
        start: () -> com.google.android.gms.tasks.Task<Void>,
    ): GeofencingFacade.TaskResult = suspendCancellableCoroutine { continuation ->
        try {
            start()
                .addOnSuccessListener { continuation.resume(GeofencingFacade.TaskResult.Success) }
                // The exception is never logged: a geofence failure carries the
                // request ids, and a region id plus a failure is a location fact
                // about this person. Only the class name travels.
                .addOnFailureListener {
                    continuation.resume(
                        GeofencingFacade.TaskResult.Failure(it::class.java.simpleName),
                    )
                }
                .addOnCanceledListener {
                    continuation.resume(GeofencingFacade.TaskResult.Cancelled)
                }
        } catch (_: SecurityException) {
            // The permission was revoked between the check and the call.
            continuation.resume(GeofencingFacade.TaskResult.Failure("SecurityException"))
        }
    }
}

/**
 * Whether this app may register a geofence right now.
 *
 * Top-level so it can be the injectable default: below API 29 there is no
 * separate background permission, and above it both are required.
 */
fun hasGeofencePermissions(context: Context): Boolean {
    val fine = ContextCompat.checkSelfPermission(
        context, Manifest.permission.ACCESS_FINE_LOCATION,
    ) == PackageManager.PERMISSION_GRANTED

    val background = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
        ContextCompat.checkSelfPermission(
            context, Manifest.permission.ACCESS_BACKGROUND_LOCATION,
        ) == PackageManager.PERMISSION_GRANTED
    } else {
        true
    }

    return fine && background
}

class PlayServicesRegionMonitoring(
    private val context: Context,
    private val facade: GeofencingFacade = PlayServicesGeofencingFacade(context),
    /**
     * The permission gate.
     *
     * Injectable and **replacing**, not augmenting, the framework check: a
     * caller that supplies one is stating the answer, which is what lets a test
     * exercise both sides of the gate. The default is the real check.
     */
    private val permissionCheck: (Context) -> Boolean = ::hasGeofencePermissions,
    /**
     * Where the mirror lives. Injectable because a JVM has no
     * `AndroidKeyStore`, and the mirror's own logic — what is recorded on
     * success, failure and cancellation — is exactly what needs testing.
     */
    mirrorPreferences: android.content.SharedPreferences? = null,
) : RegionMonitoring {

    /**
     * What this app currently believes it has registered.
     *
     * Play services offers **no API to enumerate registered geofences**, which
     * is the single most awkward fact about this integration: the reconciler's
     * whole design is "compare desired against actual", and `actual` cannot be
     * read back from the system. It is mirrored here instead, in the same
     * encrypted store the rest of the feature uses, and treated as authoritative
     * for comparison only.
     *
     * The mirror can drift — a reboot clears the system's geofences without
     * telling us. That is exactly why [ReconcileTrigger.BootOrUpdate] ignores
     * the mirror and re-registers everything: correctness does not depend on
     * the mirror being right, only efficiency does.
     */
    private val mirror = mirrorPreferences
        ?.let { RegionMirror(it) }
        ?: RegionMirror.encrypted(context)

    override suspend fun monitoredRegions(): Set<MonitoredRegion> = mirror.load()

    override suspend fun startMonitoring(regions: List<MonitoredRegion>) {
        if (regions.isEmpty()) return
        // Calling `addGeofences` without permission throws a `SecurityException`
        // the caller would have to catch. Checking first is the honest gate.
        if (!permissionCheck(context)) return

        val request = buildRequest(regions)

        when (facade.addGeofences(request, pendingIntent())) {
            is GeofencingFacade.TaskResult.Success -> mirror.add(regions)
            // **The mirror is not updated on failure or cancellation.** That is
            // the whole point of it being a mirror: it records what the system
            // accepted, so the next reconciliation sees these as missing and
            // registers them again. Recording an optimistic success would make
            // a partial failure permanent and silent.
            is GeofencingFacade.TaskResult.Failure,
            GeofencingFacade.TaskResult.Cancelled,
            -> Unit
        }
    }

    /**
     * The exact `GeofencingRequest` sent to Play services.
     *
     * Internal so a test can assert every field rather than describing them.
     */
    internal fun buildRequest(regions: List<MonitoredRegion>): GeofencingRequest {
        val geofences = regions.map { region ->
            val transitions = if (region.loiteringDelayMillis > 0) {
                // **The OS dwell transition, when the church's policy asks for
                // one.** Play services can tell us the device stayed, which iOS
                // cannot, and using it means the confirmation arrives on a real
                // system callback instead of waiting for the next arbitrary
                // wake.
                //
                // The delay comes from authoritative configuration, and it is
                // part of the region's identity — so a policy edit changes
                // `configVersion`, the configuration is refetched, and the
                // reconciler re-registers rather than leaving a stale delay on
                // the device.
                Geofence.GEOFENCE_TRANSITION_ENTER or
                    Geofence.GEOFENCE_TRANSITION_EXIT or
                    Geofence.GEOFENCE_TRANSITION_DWELL
            } else {
                // The church requires no confirmation, so a dwell would only
                // delay a check-in it chose to make immediate.
                Geofence.GEOFENCE_TRANSITION_ENTER or Geofence.GEOFENCE_TRANSITION_EXIT
            }

            Geofence.Builder()
                .setRequestId(region.identifier)
                .setCircularRegion(region.latitude, region.longitude, region.radiusMeters)
                // The reconciler owns the lifetime, not the system.
                .setExpirationDuration(Geofence.NEVER_EXPIRE)
                .setTransitionTypes(transitions)
                .apply {
                    if (region.loiteringDelayMillis > 0) {
                        setLoiteringDelay(region.loiteringDelayMillis)
                    }
                }
                // Longer responsiveness costs battery less and lets the system
                // batch. A service lasts an hour; two minutes of latency is
                // irrelevant to a check-in and materially cheaper on a phone.
                .setNotificationResponsiveness(NOTIFICATION_RESPONSIVENESS_MILLIS)
                .build()
        }

        return GeofencingRequest.Builder()
            // Fires immediately if the device is *already* inside when the
            // region is registered — the common case: someone turns the feature
            // on while sitting in the building.
            .setInitialTrigger(GeofencingRequest.INITIAL_TRIGGER_ENTER)
            .addGeofences(geofences)
            .build()
    }

    override suspend fun stopMonitoring(identifiers: List<String>) {
        if (identifiers.isEmpty()) return
        facade.removeGeofences(identifiers)
        // Removed from the mirror whatever the task said: if the call failed the
        // region is stale anyway, and the next reconciliation re-adds it.
        // Erring towards "not registered" is the safe direction — it costs a
        // redundant registration, never a silently-live geofence.
        mirror.remove(identifiers)
    }

    override suspend fun stopMonitoringAll() {
        facade.removeGeofences(pendingIntent())
        mirror.clear()
    }

    /**
     * The `PendingIntent` transitions are delivered through.
     *
     * Three things make this safe:
     *
     *  * **An explicit component.** The intent names this app's own receiver,
     *    so it cannot be redirected to another app.
     *  * **`FLAG_MUTABLE` from API 31.** Required by the geofencing API, which
     *    fills in the transition extras. An immutable intent silently delivers
     *    nothing. Paired with the explicit component, mutability lets Play
     *    services add extras but not change the destination.
     *  * **`FLAG_UPDATE_CURRENT`.** `addGeofences` and `removeGeofences` must
     *    receive the *same* PendingIntent to refer to the same registration.
     */
    /**
     * Exposed for the Robolectric suite.
     *
     * The flags and the explicit component are the security properties of this
     * integration, and asserting them needs the real `PendingIntent` the real
     * framework produced — not a description of one.
     */
    internal fun pendingIntentForTest(): PendingIntent = pendingIntent()

    private fun pendingIntent(): PendingIntent {
        val intent = Intent(context, GeofenceBroadcastReceiver::class.java)
            .setAction(GeofenceBroadcastReceiver.ACTION_TRANSITION)

        var flags = PendingIntent.FLAG_UPDATE_CURRENT
        flags = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            flags or PendingIntent.FLAG_MUTABLE
        } else {
            flags
        }

        return PendingIntent.getBroadcast(context, REQUEST_CODE, intent, flags)
    }

    companion object {
        /** Fixed, so `addGeofences` and `removeGeofences` address the same intent. */
        const val REQUEST_CODE = 0x6F17

        const val NOTIFICATION_RESPONSIVENESS_MILLIS = 2 * 60 * 1000
    }
}

/**
 * Reads the current permission state from the framework.
 *
 * A pure translation of `checkSelfPermission` and the API level into the model
 * `:core:attendance` reasons about. The escalation rules live there.
 */
class AndroidLocationPermissions(
    private val context: Context,
    private val sdkInt: Int = Build.VERSION.SDK_INT,
    /**
     * Supplied by the activity, because `shouldShowRequestPermissionRationale`
     * and the permission launcher both require one. Null in a background
     * context, where nothing may be requested anyway.
     */
    private val requester: PermissionRequester? = null,
    /**
     * Whether Play services is usable.
     *
     * Injectable because `GoogleApiAvailability` reports *unavailable* under
     * Robolectric — correctly, since Play services genuinely is not installed
     * there. Without a seam, every permission test would be asserting around
     * that rather than about the thing under test. The production default is
     * the real check.
     */
    private val playServices: () -> Boolean = {
        // `isGooglePlayServicesAvailable` *throws* when the manifest lacks the
        // Play services version meta-data, rather than returning a code. Any
        // failure to establish availability means the feature cannot work, so
        // this fails closed rather than letting an exception escape into a
        // permission check.
        runCatching {
            GoogleApiAvailability.getInstance().isGooglePlayServicesAvailable(context) ==
                ConnectionResult.SUCCESS
        }.getOrDefault(false)
    },
) : LocationPermissions {

    /** Raises the system dialogs. Implemented by the activity. */
    interface PermissionRequester {
        suspend fun request(permissions: Array<String>): Map<String, Boolean>
        fun shouldShowRationale(permission: String): Boolean
    }

    override suspend fun current(): LocationPermissionState {
        val fine = granted(Manifest.permission.ACCESS_FINE_LOCATION)
        val coarse = granted(Manifest.permission.ACCESS_COARSE_LOCATION)

        val foreground = when {
            fine -> ForegroundLocationPermission.Fine
            // Android 12+ offers "approximate" in the same dialog, so coarse
            // without fine is a normal answer rather than an odd state.
            coarse -> ForegroundLocationPermission.Coarse
            requester?.shouldShowRationale(Manifest.permission.ACCESS_FINE_LOCATION) == true ->
                ForegroundLocationPermission.Denied
            else -> ForegroundLocationPermission.NotRequested
        }

        val background = when {
            sdkInt < Build.VERSION_CODES.Q -> BackgroundLocationPermission.NotApplicable
            granted(Manifest.permission.ACCESS_BACKGROUND_LOCATION) ->
                BackgroundLocationPermission.Granted
            requester?.shouldShowRationale(Manifest.permission.ACCESS_BACKGROUND_LOCATION) == true ->
                BackgroundLocationPermission.Denied
            else -> BackgroundLocationPermission.NotRequested
        }

        return LocationPermissionState(
            foreground = foreground,
            background = background,
            strategy = BackgroundRequestStrategy.forSdk(sdkInt),
            locationServicesEnabled = locationServicesEnabled(),
            playServicesAvailable = playServices(),
        )
    }

    override suspend fun requestForeground(): LocationPermissionState {
        requester?.request(
            arrayOf(
                Manifest.permission.ACCESS_FINE_LOCATION,
                Manifest.permission.ACCESS_COARSE_LOCATION,
            ),
        )
        return current()
    }

    /**
     * Requests background location where the platform allows it.
     *
     * On API 30+ this deliberately does nothing: the runtime dialog has no
     * "Allow all the time" option, so calling `requestPermissions` shows
     * nothing and the person is left staring at an unchanged screen. The UI
     * sends them to Settings instead, which is the only route that works.
     */
    override suspend fun requestBackground(): LocationPermissionState {
        val state = current()
        if (state.strategy == BackgroundRequestStrategy.RuntimeDialog) {
            requester?.request(arrayOf(Manifest.permission.ACCESS_BACKGROUND_LOCATION))
        }
        return current()
    }

    private fun granted(permission: String) =
        ContextCompat.checkSelfPermission(context, permission) == PackageManager.PERMISSION_GRANTED

    private fun locationServicesEnabled(): Boolean {
        val manager = context.getSystemService(Context.LOCATION_SERVICE) as? LocationManager
            ?: return false
        return manager.isProviderEnabled(LocationManager.GPS_PROVIDER) ||
            manager.isProviderEnabled(LocationManager.NETWORK_PROVIDER)
    }

}

/**
 * One fresh fix, then nothing.
 *
 * `getCurrentLocation` rather than `requestLocationUpdates`: it delivers a
 * single reading and stops on its own, so there is no subscription to forget to
 * cancel and no way to leave the GPS running.
 */
class PlayServicesLocationSampling(
    private val context: Context,
) : LocationSampling {

    override suspend fun requestOneShotLocation(timeoutMillis: Long): LocationSample? {
        if (ContextCompat.checkSelfPermission(
                context, Manifest.permission.ACCESS_FINE_LOCATION,
            ) != PackageManager.PERMISSION_GRANTED
        ) {
            return null
        }

        val client = LocationServices.getFusedLocationProviderClient(context)

        return withTimeoutOrNull(timeoutMillis) {
            suspendCancellableCoroutine { continuation ->
                try {
                    val task = client.getCurrentLocation(
                        Priority.PRIORITY_HIGH_ACCURACY,
                        null,
                    )
                    task.addOnSuccessListener { location ->
                        continuation.resume(
                            location?.let {
                                LocationSample(
                                    latitude = it.latitude,
                                    longitude = it.longitude,
                                    accuracyMeters = it.accuracy,
                                    capturedAtEpochMillis = it.time,
                                    // Reported to the server as one signal
                                    // among several, never as the decision.
                                    isFromMockProvider =
                                        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                                            it.isMock
                                        } else {
                                            @Suppress("DEPRECATION")
                                            it.isFromMockProvider
                                        },
                                )
                            },
                        )
                    }
                    // Never logged: the failure can carry provider detail.
                    task.addOnFailureListener { continuation.resume(null) }
                } catch (_: SecurityException) {
                    continuation.resume(null)
                }
            }
        }
    }
}
