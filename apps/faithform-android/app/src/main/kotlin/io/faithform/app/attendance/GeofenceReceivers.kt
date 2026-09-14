package io.faithform.app.attendance

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import com.google.android.gms.location.Geofence
import com.google.android.gms.location.GeofenceStatusCodes
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
 * **It does almost nothing, on purpose.** `onReceive` runs on the main thread
 * and `goAsync` buys about ten seconds; a check-in — configuration, occurrence,
 * one fix, one request — does not always fit, and a fix alone may take fifteen.
 * So the transition is written to the encrypted inbox and handed to one-time
 * work, which may run for minutes, wait for a network and retry with backoff.
 * Nothing about the transition goes into the work request itself: WorkManager's
 * database is not encrypted, and a region id with "dwell" is where a person was.
 */
class GeofenceBroadcastReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != ACTION_TRANSITION) return

        val event = GeofencingEvent.fromIntent(intent) ?: return
        if (event.hasError()) {
            // Deliberately not logged. `GeofenceStatusCodes` messages can carry
            // request ids, and a region id plus an error is a location fact.
            //
            // "Not available" is the one error with a remedy: the system has
            // dropped every registration — location was switched off, or Play
            // services' data was cleared — and they must be registered again
            // once that is possible.
            if (event.errorCode == GeofenceStatusCodes.GEOFENCE_NOT_AVAILABLE) {
                AttendanceWakeups.from(context)?.reconcileSoon(ReconcileTrigger.ServicesReset)
            }
            return
        }

        val kind = kindOf(event.geofenceTransition) ?: return
        val identifiers = event.triggeringGeofences
            ?.mapNotNull { it.requestId }
            ?.filter { it.startsWith(REGION_PREFIX) }
            .orEmpty()
        if (identifiers.isEmpty()) return

        val wakeups = AttendanceWakeups.from(context) ?: return
        val pending = goAsync()
        wakeups.recordTransition(kind, identifiers) { pending.finish() }
    }

    companion object {
        const val ACTION_TRANSITION = "io.faithform.app.GEOFENCE_TRANSITION"
        const val REGION_PREFIX = AutomaticAttendanceCoordinator.REGION_ID_PREFIX

        /** The Play services transition constant, as the model names it. */
        fun kindOf(transition: Int): TransitionKind? = when (transition) {
            Geofence.GEOFENCE_TRANSITION_ENTER -> TransitionKind.Enter
            Geofence.GEOFENCE_TRANSITION_DWELL -> TransitionKind.Dwell
            Geofence.GEOFENCE_TRANSITION_EXIT -> TransitionKind.Exit
            else -> null
        }
    }
}

/**
 * Re-registers after a reboot.
 *
 * Geofences do **not** survive a device restart — the app must listen for
 * `BOOT_COMPLETED` and register them again. The reconciliation forces a
 * configuration refresh rather than trusting a cached one: access may have been
 * revoked while the device was off, and silently re-registering regions for a
 * church the person has left would be exactly the fail-open this design
 * refuses. It waits for a network for the same reason, and retries until it
 * has one.
 *
 * Exported, because only an exported receiver hears `BOOT_COMPLETED` — and
 * guarded in the manifest by `RECEIVE_BOOT_COMPLETED`, which only the system
 * holds, so no app can forge a reboot. Not direct-boot aware: the encrypted
 * store is unavailable before first unlock, so `LOCKED_BOOT_COMPLETED` would
 * arrive with nothing it could read.
 */
class BootAndUpdateReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Intent.ACTION_BOOT_COMPLETED) return
        AttendanceWakeups.from(context)?.reconcileSoon(ReconcileTrigger.BootOrUpdate)
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
 * opens the app, which re-registers everything on launch.
 */
class PackageReplacedReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Intent.ACTION_MY_PACKAGE_REPLACED) return
        AttendanceWakeups.from(context)?.reconcileSoon(ReconcileTrigger.BootOrUpdate)
    }
}

/**
 * Re-registers after Google Play services' data is cleared.
 *
 * Clearing it removes every app's geofences without telling any of them. The
 * broadcast is one of the few implicit ones a manifest receiver still gets on
 * Android 8+, and is delivered for a package this app can see — hence the one
 * `<queries>` entry for Play services.
 *
 * Location being switched off is the other way every registration is lost.
 * That arrives as `GEOFENCE_NOT_AVAILABLE` on the transition receiver, and
 * the fences come back on the next launch or the next check-in window,
 * whichever is first — there is no manifest broadcast for location coming
 * back on, and nothing here polls for it.
 *
 * Not exported: the broadcast comes from the system.
 */
class GeofencingResetReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Intent.ACTION_PACKAGE_DATA_CLEARED) return
        if (intent.data?.schemeSpecificPart != PLAY_SERVICES_PACKAGE) return
        AttendanceWakeups.from(context)?.reconcileSoon(ReconcileTrigger.ServicesReset)
    }

    companion object {
        const val PLAY_SERVICES_PACKAGE = "com.google.android.gms"
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
 * re-registers everything whatever it says.
 *
 * It records the loitering delay and the church as well as the circle. Both are
 * part of a region's identity, and a mirror that dropped the delay made every
 * foreground look like a policy change and re-register every region.
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

    suspend fun clear() = mutex.withLock { prefs.edit().remove(KEY).commit(); Unit }

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
                    loiteringDelayMillis = item.optInt("loiter", 0),
                    churchSlug = if (item.isNull("church") || !item.has("church")) null else item.getString("church"),
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
                    .put("loiter", region.loiteringDelayMillis)
                    .put("church", region.churchSlug ?: JSONObject.NULL),
            )
        }
        prefs.edit().putString(KEY, array.toString()).commit()
    }
}
