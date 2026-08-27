package io.faithform.faithful.ui.discovery

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import androidx.core.content.ContextCompat
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority
import com.google.android.gms.tasks.CancellationTokenSource
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException
import kotlinx.coroutines.suspendCancellableCoroutine

/**
 * One foreground fix, for one query.
 *
 * The [LocationProvider] interface cannot express a background or always-on
 * request, so no caller can accidentally make one. The runtime dialog itself
 * is the Activity's to raise — injected as [requestPermissions] — because a
 * provider that owned an Activity would outlive it.
 */
class AndroidLocationProvider(
    private val context: Context,
    private val requestPermissions: suspend () -> Map<String, Boolean>
) : LocationProvider {

    private fun granted(): Boolean =
        ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION) ==
            PackageManager.PERMISSION_GRANTED ||
            ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_COARSE_LOCATION) ==
            PackageManager.PERMISSION_GRANTED

    override suspend fun authorizationStatus(): LocationAuthorization =
        // Android cannot distinguish "never asked" from "asked and declined"
        // without bookkeeping this feature does not need: either way the
        // education screen comes first and the OS dialog only after its
        // affirmative tap, which is the rule that actually matters.
        if (granted()) LocationAuthorization.AUTHORIZED_WHEN_IN_USE
        else LocationAuthorization.NOT_DETERMINED

    override suspend fun requestWhenInUse(): LocationAuthorization {
        if (granted()) return LocationAuthorization.AUTHORIZED_WHEN_IN_USE
        val grants = requestPermissions()
        return if (grants.any { it.value }) LocationAuthorization.AUTHORIZED_WHEN_IN_USE
        else LocationAuthorization.DENIED
    }

    override suspend fun currentCoordinate(): Pair<Double, Double> {
        if (!granted()) throw SecurityException("location permission not granted")

        val client = LocationServices.getFusedLocationProviderClient(context)
        val cancellation = CancellationTokenSource()

        return suspendCancellableCoroutine { continuation ->
            continuation.invokeOnCancellation { cancellation.cancel() }
            try {
                client.getCurrentLocation(
                    Priority.PRIORITY_BALANCED_POWER_ACCURACY,
                    cancellation.token
                ).addOnSuccessListener { location ->
                    if (location != null) {
                        continuation.resume(location.latitude to location.longitude)
                    } else {
                        continuation.resumeWithException(IllegalStateException("no fix"))
                    }
                }.addOnFailureListener { error ->
                    continuation.resumeWithException(error)
                }
            } catch (error: SecurityException) {
                continuation.resumeWithException(error)
            }
        }
    }
}
