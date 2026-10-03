package io.faithform.app.attendance

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import com.google.android.gms.location.Geofence
import com.google.android.gms.location.GeofencingEvent
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import org.json.JSONArray
import org.json.JSONObject

/**
 * Where geofence transitions arrive.
 *
 * `exported="false"` in the manifest is the security boundary: only the system
 * and Play services can deliver here, so no other app can forge a transition.
 * The receiver itself trusts nothing beyond the request ids — everything that
 * decides whether a transition means attendance happens server-side, after a
 * fresh authorization check.
 *
 * A receiver enqueues bounded WorkManager execution and returns immediately.
 * Only the transition and region identifier enter the work queue; coordinates
 * remain in the encrypted, expiring attempt store. Work reauthorizes before
 * sampling and never starts a persistent location service.
 */
class GeofenceBroadcastReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != ACTION_TRANSITION) return

        val event = GeofencingEvent.fromIntent(intent) ?: return
        if (event.hasError()) {
            // Deliberately not logged. `GeofenceStatusCodes` messages can carry
            // request ids, and a region id plus an error is a location fact.
            return
        }

        val transition = event.geofenceTransition
        val identifiers = event.triggeringGeofences
            ?.mapNotNull { it.requestId }
            ?.filter { it.startsWith(REGION_PREFIX) }
            .orEmpty()

        if (identifiers.isEmpty()) return

        // Persist just the transition and public region id. Location evidence stays encrypted.
        AttendanceWork.enqueue(context, transition, identifiers.first())
    }

    companion object {
        const val ACTION_TRANSITION = "io.faithform.app.GEOFENCE_TRANSITION"
        const val REGION_PREFIX = "faithform.campus."
    }
}

/**
 * Re-registers after a reboot.
 *
 * Geofences do **not** survive a device restart — the app must listen for
 * `BOOT_COMPLETED` and register them again. (They *are* restored after a Play
 * services upgrade, so that case needs nothing.)
 *
 * The reconciliation forces a configuration refresh rather than trusting a
 * cached one: access may have been revoked while the device was off, and
 * silently re-registering regions for a church the person has left would be
 * exactly the fail-open this design refuses.
 */
class BootAndUpdateReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        when (intent.action) {
            Intent.ACTION_BOOT_COMPLETED -> Unit
            else -> return
        }

        AttendanceWork.enqueue(context)

    }
}

/**
 * Re-registers after the app is updated.
 *
 * An update does not always clear geofences, but the mirror and the installed
 * code may now disagree about what should be registered, and reconciliation is
 * idempotent — so running it costs nothing when nothing changed.
 *
 * Note what is *not* handled here: a force-stop. Android delivers no broadcast
 * for it and clears the app's geofences; nothing runs again until the person
 * opens the app. That is documented honestly rather than worked around.
 */
class PackageReplacedReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Intent.ACTION_MY_PACKAGE_REPLACED) return

        AttendanceWork.enqueue(context)

    }
}

/**
 * What this app believes it has registered.
 *
 * Play services offers no way to enumerate registered geofences, so the
 * reconciler's "compare desired against actual" needs a local mirror. Kept in
 * `EncryptedSharedPreferences` because a region set is a list of places this
 * person's church meets — not a secret, but not something to leave in a
 * world-readable preference file either.
 *
 * The mirror is an efficiency aid, never a source of authority: a reboot clears
 * the system's geofences without updating it, which is why boot reconciliation
 * ignores it entirely and re-registers everything.
 */
internal class RegionMirror(private val prefs: SharedPreferences) {
    private val mutex = Mutex()

    companion object {
        private const val KEY = "regions"

        /**
         * The production store: `EncryptedSharedPreferences`, Keystore-backed.
         *
         * Built here rather than inside the class so the mirror's own logic is
         * testable — a JVM has no `AndroidKeyStore`, and a class that
         * constructs one in its initialiser cannot be exercised at all. The
         * privacy sweep asserts this call site remains the encrypted one.
         */
        fun encrypted(context: Context): RegionMirror {
            val key = MasterKey.Builder(context)
                .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
                .build()

            return RegionMirror(
                EncryptedSharedPreferences.create(
                    context,
                    "faithform_geofence_mirror",
                    key,
                    EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
                    EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
                ),
            )
        }
    }

    suspend fun load(): Set<MonitoredRegion> = mutex.withLock { read() }

    suspend fun add(regions: List<MonitoredRegion>) = mutex.withLock {
        val merged = read().associateBy { it.identifier }.toMutableMap()
        for (region in regions) merged[region.identifier] = region
        write(merged.values)
    }

    suspend fun remove(identifiers: List<String>) = mutex.withLock {
        write(read().filterNot { it.identifier in identifiers })
    }

    suspend fun clear() = mutex.withLock { prefs.edit().remove(KEY).apply() }

    private fun read(): Set<MonitoredRegion> {
        val raw = prefs.getString(KEY, null) ?: return emptySet()
        return runCatching {
            val array = JSONArray(raw)
            (0 until array.length()).map { index ->
                val item = array.getJSONObject(index)
                MonitoredRegion(
                    identifier = item.getString("id"),
                    latitude = item.getDouble("lat"),
                    longitude = item.getDouble("lon"),
                    radiusMeters = item.getDouble("r").toFloat(),
                    loiteringDelayMillis = item.optInt("dwell", 0),
                )
            }.toSet()
        }.getOrDefault(emptySet())
    }

    private fun write(regions: Collection<MonitoredRegion>) {
        val array = JSONArray()
        for (region in regions) {
            array.put(
                JSONObject()
                    .put("id", region.identifier)
                    .put("lat", region.latitude)
                    .put("lon", region.longitude)
                    .put("r", region.radiusMeters.toDouble())
                    .put("dwell", region.loiteringDelayMillis),
            )
        }
        prefs.edit().putString(KEY, array.toString()).apply()
    }

}
