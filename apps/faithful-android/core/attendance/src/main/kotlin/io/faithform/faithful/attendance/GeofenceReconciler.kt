package io.faithform.faithful.attendance

import io.faithform.faithful.contract.GeofenceConfiguration
import io.faithform.faithful.storage.CachePartition
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

/** A region as the geofencing client holds it. */
data class MonitoredRegion(
    val identifier: String,
    val latitude: Double,
    val longitude: Double,
    val radiusMeters: Float,
    /**
     * How long the device must loiter before the system reports a dwell, from
     * the church's own `minDwellSeconds`.
     *
     * **Part of the region's identity on purpose.** A church editing its dwell
     * policy changes `configVersion`, the configuration is refetched, this
     * value differs, and the reconciler re-registers — which is what keeps the
     * device's loitering delay from going stale against the server's rule.
     * Leaving it out of the comparison would let the two drift silently.
     *
     * Zero when the church requires no confirmation.
     */
    val loiteringDelayMillis: Int = 0,
)

/**
 * The geofence registration surface, abstracted from `GeofencingClient`.
 *
 * The concrete implementation lives in `:app` and holds no decisions.
 */
interface RegionMonitoring {
    suspend fun monitoredRegions(): Set<MonitoredRegion>
    suspend fun startMonitoring(regions: List<MonitoredRegion>)
    suspend fun stopMonitoring(identifiers: List<String>)
    suspend fun stopMonitoringAll()
}

/** Why a reconciliation ran. */
enum class ReconcileTrigger {
    OptIn,
    Foreground,
    ChurchChanged,
    AccountChanged,
    AuthorizationVersionChanged,
    PermissionChanged,
    ConfigurationRefreshed,
    WindowBoundary,
    RegionEvent,

    /**
     * Device rebooted, or the app was updated.
     *
     * Android-only, and not an artificial parity gap: geofences do not survive
     * a reboot and must be re-registered, whereas iOS keeps monitored regions
     * across one. Source: developer.android.com — geofences are "not
     * automatically restored after device reboot", though they *are* restored
     * after a Play services upgrade.
     */
    BootOrUpdate,
    Teardown,
}

data class ReconcileOutcome(
    val added: List<String> = emptyList(),
    val removed: List<String> = emptyList(),
    val updated: List<String> = emptyList(),
    val monitoring: Int = 0,
    val refusal: String? = null,
    val droppedForCapacity: List<String> = emptyList(),
) {
    val changedAnything: Boolean
        get() = added.isNotEmpty() || removed.isNotEmpty() || updated.isNotEmpty()

    companion object {
        val Idle = ReconcileOutcome()
    }
}

/** What a configuration lookup produced. */
sealed interface GeofenceConfigurationState {
    data class Available(val configuration: GeofenceConfiguration) : GeofenceConfigurationState
    data class Refused(val reason: String) : GeofenceConfigurationState
    data object Unavailable : GeofenceConfigurationState
}

interface ConfigurationSource {
    /**
     * The configuration to use now, refreshing when the cached one is absent or
     * expired. Never returns an expired configuration.
     */
    suspend fun currentConfiguration(
        churchSlug: String,
        partition: CachePartition,
        nowEpochMillis: Long,
        forceRefresh: Boolean,
    ): GeofenceConfigurationState
}

/**
 * Android permits 100 geofences per app per device user.
 *
 * Source: developer.android.com/develop/sensors-and-location/location/geofencing
 * — "You can have multiple active geofences, with a limit of 100 per app, per
 * device user."
 *
 * The server caps its response at 20 (Apple's limit), so this is never the
 * binding constraint today — but the client must not depend on that. If the
 * server were ever raised for Android, this is the number that applies.
 */
const val ANDROID_GEOFENCE_LIMIT = 100

/**
 * The shared cap the reconciler actually applies.
 *
 * Deliberately the *lower* of the two platform limits, so both apps monitor the
 * identical set for the same church. A congregation with 25 campuses should not
 * see different behaviour depending on which phone they carry, and a support
 * conversation should not have to begin by asking which one it is.
 */
const val MONITORED_REGION_LIMIT = 20

/**
 * The single owner of what this device is monitoring.
 *
 * Mirrors `GeofenceReconciler.swift` in behaviour and in vocabulary. The
 * implementations differ where the platforms differ — Android adds
 * [ReconcileTrigger.BootOrUpdate] because geofences do not survive a reboot —
 * but the rules about *when* to add, update and remove are identical, and both
 * are verified by tests that mirror each other.
 *
 * **Why one owner.** Registration spread across an activity, a receiver, a
 * worker and a view model cannot be reasoned about: they race on launch and the
 * set the system holds drifts from anything intended. Everything funnels
 * through [reconcile].
 *
 * **Single-flight.** A [Mutex] serialises reconciliation, so a boot broadcast
 * arriving while the app is foregrounding produces one pass rather than two
 * interleaved ones.
 */
class GeofenceReconciler(
    private val monitor: RegionMonitoring,
    private val permissions: LocationPermissions,
    private val source: ConfigurationSource,
    private val clock: () -> Long = System::currentTimeMillis,
) {
    private val mutex = Mutex()

    private var partition: CachePartition? = null
    private var churchSlug: String? = null
    private var enabled = false

    @Volatile
    var lastOutcome: ReconcileOutcome = ReconcileOutcome.Idle
        private set

    fun isEnabled(): Boolean = enabled

    /**
     * Binds to an identity. Any change to environment, account, church or
     * authorization version is a different identity, and everything monitored
     * under the previous one is removed before anything new is registered.
     */
    suspend fun bind(partition: CachePartition, churchSlug: String?, enabled: Boolean) = mutex.withLock {
        val identityChanged =
            this.partition?.storageKey != partition.storageKey || this.churchSlug != churchSlug

        if (identityChanged) {
            // Never carry regions across an identity boundary: a region left
            // monitoring for a church the person left would wake the app into
            // an evidence flow it has no authority to complete.
            monitor.stopMonitoringAll()
            lastOutcome = ReconcileOutcome.Idle
        }

        this.partition = partition
        this.churchSlug = churchSlug
        this.enabled = enabled
    }

    /**
     * Removes everything, unconditionally.
     *
     * Logout, leaving a church, being blocked, People-link revocation, consent
     * withdrawal and switching the feature off are the same action here: this
     * app is no longer authorized to watch for this person at this church.
     */
    suspend fun teardown(): ReconcileOutcome = mutex.withLock { teardownLocked() }

    private suspend fun teardownLocked(refusal: String = "disabled"): ReconcileOutcome {
        val existing = monitor.monitoredRegions().map { it.identifier }.sorted()
        monitor.stopMonitoringAll()
        enabled = false
        lastOutcome = ReconcileOutcome(removed = existing, refusal = refusal)
        return lastOutcome
    }

    private suspend fun stopWith(refusal: String): ReconcileOutcome {
        val existing = monitor.monitoredRegions().map { it.identifier }.sorted()
        monitor.stopMonitoringAll()
        lastOutcome = ReconcileOutcome(removed = existing, refusal = refusal)
        return lastOutcome
    }

    suspend fun reconcile(trigger: ReconcileTrigger): ReconcileOutcome = mutex.withLock {
        if (trigger == ReconcileTrigger.Teardown) return@withLock teardownLocked()

        val currentPartition = partition
        val slug = churchSlug
        if (!enabled || currentPartition == null || slug == null) {
            return@withLock teardownLocked()
        }

        // The OS gates before the server does: no point requesting a
        // configuration we could not act on.
        val state = permissions.current()
        if (!state.playServicesAvailable) return@withLock stopWith("play_services_unavailable")
        if (!state.locationServicesEnabled) return@withLock stopWith("location_unavailable")

        when (state.foreground) {
            ForegroundLocationPermission.Coarse -> return@withLock stopWith("needs_full_accuracy")
            ForegroundLocationPermission.Fine -> Unit
            else -> return@withLock stopWith("needs_foreground_permission")
        }

        if (state.background == BackgroundLocationPermission.Denied ||
            state.background == BackgroundLocationPermission.PermanentlyDenied ||
            state.background == BackgroundLocationPermission.NotRequested
        ) {
            return@withLock stopWith("needs_background_permission")
        }

        // A region event may arrive against an expired configuration. That is
        // allowed to wake us; it is never authority. Forcing a refresh is what
        // makes "an expired configuration cannot authorize attendance" true.
        val configuration = source.currentConfiguration(
            churchSlug = slug,
            partition = currentPartition,
            nowEpochMillis = clock(),
            forceRefresh = trigger == ReconcileTrigger.RegionEvent ||
                trigger == ReconcileTrigger.BootOrUpdate,
        )

        return@withLock when (configuration) {
            is GeofenceConfigurationState.Refused -> stopWith(configuration.reason)
            GeofenceConfigurationState.Unavailable -> {
                // Offline with nothing usable. Leave a working setup alone
                // rather than tearing it down on one failed request.
                lastOutcome = ReconcileOutcome(
                    monitoring = monitor.monitoredRegions().size,
                    refusal = "configuration_unavailable",
                )
                lastOutcome
            }
            is GeofenceConfigurationState.Available -> apply(configuration.configuration, trigger)
        }
    }

    private suspend fun apply(
        configuration: GeofenceConfiguration,
        trigger: ReconcileTrigger,
    ): ReconcileOutcome {
        val desired = selectRegions(configuration)
        val dropped = configuration.regions
            .map { it.regionId }
            .filterNot { id -> desired.any { it.identifier == id } }

        // After a reboot the system holds nothing, so everything reads as an
        // addition — which is exactly right, and is why the same comparison
        // handles re-registration without a special path.
        val actual = if (trigger == ReconcileTrigger.BootOrUpdate) {
            emptySet()
        } else {
            monitor.monitoredRegions()
        }
        val actualById = actual.associateBy { it.identifier }
        val desiredById = desired.associateBy { it.identifier }

        val removed = actualById.keys.filterNot { desiredById.containsKey(it) }.sorted()
        if (removed.isNotEmpty()) monitor.stopMonitoring(removed)

        val toAdd = mutableListOf<MonitoredRegion>()
        val added = mutableListOf<String>()
        val updated = mutableListOf<String>()

        for (region in desired) {
            val existing = actualById[region.identifier]
            when {
                existing == null -> {
                    toAdd += region
                    added += region.identifier
                }
                // A moved or resized campus is a re-registration. An identical
                // one is left alone, which is what keeps this idempotent.
                existing != region -> {
                    toAdd += region
                    updated += region.identifier
                }
            }
        }

        // Batched: `addGeofences` takes a list, and one call for twenty regions
        // is one round trip through the system service rather than twenty.
        if (toAdd.isNotEmpty()) monitor.startMonitoring(toAdd)

        lastOutcome = ReconcileOutcome(
            added = added.sorted(),
            removed = removed,
            updated = updated.sorted(),
            monitoring = desired.size,
            refusal = null,
            droppedForCapacity = dropped.sorted(),
        )
        return lastOutcome
    }

    companion object {
        /**
         * Which regions to monitor when the server authorizes more than the cap.
         *
         * **Deterministic, and deliberately not distance-based.** Sorting by
         * proximity would make the set depend on where the person is standing,
         * so two devices would monitor different regions and neither could be
         * reproduced from a bug report. Sorting by region id is stable and
         * identical on both platforms — the iOS implementation makes exactly
         * the same choice, so a church with 25 campuses gets the same 20
         * everywhere.
         *
         * Invalid geometry is dropped rather than clamped: a region the system
         * would reject or silently resize is worse than one region fewer.
         */
        fun selectRegions(configuration: GeofenceConfiguration): List<MonitoredRegion> {
            // The loitering delay comes from authoritative configuration, not
            // from a constant. `requiresConfirmation == false` means the church
            // does not want a dwell at all, so registering one would delay
            // check-ins it had chosen to make immediate.
            val loitering = if (configuration.requiresConfirmation) {
                (configuration.minDwellSeconds.coerceAtLeast(0)) * 1000
            } else {
                0
            }

            return configuration.regions
                .filter { region ->
                    kotlin.math.abs(region.latitude) <= 90 &&
                        kotlin.math.abs(region.longitude) <= 180 &&
                        region.radiusMeters > 0
                }
                .sortedBy { it.regionId }
                .take(MONITORED_REGION_LIMIT)
                .map {
                    MonitoredRegion(
                        identifier = it.regionId,
                        latitude = it.latitude,
                        longitude = it.longitude,
                        radiusMeters = it.radiusMeters.toFloat(),
                        loiteringDelayMillis = loitering,
                    )
                }
        }
    }
}
