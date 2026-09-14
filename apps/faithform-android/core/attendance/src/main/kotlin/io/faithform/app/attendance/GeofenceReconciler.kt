package io.faithform.app.attendance

import io.faithform.app.contract.GeofenceConfiguration
import io.faithform.app.storage.CachePartition
import java.time.Instant
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
     * the church's own `minDwellSeconds`, never below
     * [MINIMUM_ARRIVAL_DWELL_SECONDS].
     *
     * **Part of the region's identity on purpose.** A church editing its dwell
     * policy changes `configVersion`, the configuration is refetched, this
     * value differs, and the reconciler re-registers — which is what keeps the
     * device's loitering delay from going stale against the server's rule.
     * Leaving it out of the comparison would let the two drift silently.
     */
    val loiteringDelayMillis: Int = 0,
    /**
     * The church this campus belongs to.
     *
     * Needed because a transition arrives with nothing but a region id, often
     * in a process that has just been started for it, and the evidence flow
     * must know which church to ask before it can ask anything. Part of the
     * identity too: a campus that moved to another church is a different
     * registration, not the same one.
     */
    val churchSlug: String? = null,
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

    /**
     * A check-in window is opening.
     *
     * Android re-registers every region here. Registration carries an initial
     * trigger, so a person who arrived early — before the window opened, when
     * their dwell found nothing to attend — gets a fresh dwell transition now,
     * without the app polling or holding the GPS while it waited.
     */
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

    /**
     * The app process was started by the person opening the app.
     *
     * Play services offers no way to read back what it holds, and several
     * things clear it silently — a force-stop, Play services' data being
     * cleared — so the first foreground of a process re-registers rather than
     * trusting the mirror. One batched call; cheap, and self-healing.
     */
    Launch,

    /**
     * Play services reported geofencing unavailable, its data was cleared, or
     * location was switched back on. The system dropped every registration.
     */
    ServicesReset,
    Teardown,
}

data class ReconcileOutcome(
    val added: List<String> = emptyList(),
    val removed: List<String> = emptyList(),
    val updated: List<String> = emptyList(),
    val monitoring: Int = 0,
    /**
     * The refusal for the **primary** church — the one the person has
     * selected — or a device condition that stops every church at once.
     */
    val refusal: String? = null,
    val droppedForCapacity: List<String> = emptyList(),
    /** Every church that refused, by slug. Empty when a device condition stopped everything. */
    val refusals: Map<String, String> = emptyMap(),
    /** Churches whose configuration could not be fetched and had nothing usable cached. */
    val unavailable: Set<String> = emptySet(),
) {
    val changedAnything: Boolean
        get() = added.isNotEmpty() || removed.isNotEmpty() || updated.isNotEmpty()

    /**
     * Why [churchSlug] cannot be monitored right now, or null when it can.
     *
     * A device condition applies to every church; a server refusal applies to
     * the church that gave it. With one church this is exactly [refusal].
     */
    fun refusalFor(churchSlug: String): String? {
        refusals[churchSlug]?.let { return it }
        if (churchSlug in unavailable) return "configuration_unavailable"
        return refusal?.takeIf { it in DEVICE_REFUSALS }
    }

    companion object {
        val Idle = ReconcileOutcome()

        /** Conditions of this phone, not of any church. */
        val DEVICE_REFUSALS = setOf(
            "disabled",
            "play_services_unavailable",
            "location_unavailable",
            "needs_full_accuracy",
            "needs_foreground_permission",
            "needs_background_permission",
        )
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
 * The ceiling across **every** church this person is opted in at. When the
 * churches together offer more, [GeofenceReconciler.prioritise] decides which
 * are kept.
 */
const val ANDROID_GEOFENCE_LIMIT = 100

/**
 * The cap per church.
 *
 * Deliberately the *lower* of the two platform limits, so both apps monitor the
 * identical set for the same church. A congregation with 25 campuses should not
 * see different behaviour depending on which phone they carry, and a support
 * conversation should not have to begin by asking which one it is.
 */
const val MONITORED_REGION_LIMIT = 20

/**
 * How many churches' configurations are consulted at most.
 *
 * Five churches of twenty campuses already reach [ANDROID_GEOFENCE_LIMIT]; past
 * ten, every foreground would cost another round of configuration requests for
 * churches that could not be monitored anyway.
 */
const val MAX_MONITORED_CHURCHES = 10

/**
 * The shortest dwell before a transition is treated as an arrival.
 *
 * A church that sets no dwell still should not have someone driving past
 * during a service window counted as attending, and nothing about that pass
 * should leave the phone. A minute is shorter than finding a seat and longer
 * than a drive-by; the church's own `minDwellSeconds` applies whenever it is
 * longer.
 */
const val MINIMUM_ARRIVAL_DWELL_SECONDS = 60

/**
 * The single owner of what this device is monitoring.
 *
 * Mirrors `GeofenceReconciler.swift` in behaviour and in vocabulary. The
 * implementations differ where the platforms differ — Android adds
 * [ReconcileTrigger.BootOrUpdate] because geofences do not survive a reboot,
 * and can watch several churches because it has room for 100 regions — but the
 * rules about *when* to add, update and remove are identical, and both are
 * verified by tests that mirror each other.
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
    private var churchSlugs: List<String> = emptyList()
    private var enabled = false

    /** The last configuration each church made available, for the evidence flow and the status screen. */
    @Volatile
    private var configurations: Map<String, GeofenceConfiguration> = emptyMap()

    /** Which church each region registered by the last pass belongs to. */
    @Volatile
    private var regionChurches: Map<String, String> = emptyMap()

    @Volatile
    var lastOutcome: ReconcileOutcome = ReconcileOutcome.Idle
        private set

    fun isEnabled(): Boolean = enabled

    /** The churches bound, in priority order. The first is the one the person has selected. */
    fun boundChurches(): List<String> = churchSlugs

    /** The last configuration [churchSlug] made available, if any. */
    fun configuration(churchSlug: String): GeofenceConfiguration? = configurations[churchSlug]

    /**
     * The church a region belongs to.
     *
     * From the last pass when there has been one in this process, and from what
     * the system was last asked to register when there has not — a transition
     * usually arrives in a process started just for it.
     */
    suspend fun churchFor(regionId: String): String? =
        regionChurches[regionId]
            ?: monitor.monitoredRegions().firstOrNull { it.identifier == regionId }?.churchSlug

    /** Binds to one church. See the list form. */
    suspend fun bind(partition: CachePartition, churchSlug: String?, enabled: Boolean) =
        bind(partition, listOfNotNull(churchSlug), enabled)

    /**
     * Binds to an identity: an environment, an account, an authorization
     * version, and the churches this person may be checked in at, in priority
     * order.
     *
     * A different environment, account or authorization version is a different
     * identity, and so is **losing** a church: everything monitored under the
     * previous identity is removed before anything new is registered. Gaining a
     * church, or selecting a different one, only changes what the next pass
     * wants — tearing down every other church's regions for that would reset
     * transitions for places the person has not left.
     */
    suspend fun bind(
        partition: CachePartition,
        churchSlugs: List<String>,
        enabled: Boolean,
    ) = mutex.withLock {
        val ordered = churchSlugs.distinct()
        val previous = this.partition
        val identityChanged = previous == null && this.churchSlugs.isNotEmpty() ||
            previous != null && accountKey(previous) != accountKey(partition) ||
            !ordered.toSet().containsAll(this.churchSlugs.toSet())

        if (identityChanged) {
            // Never carry regions across an identity boundary: a region left
            // monitoring for a church the person left would wake the app into
            // an evidence flow it has no authority to complete.
            monitor.stopMonitoringAll()
            lastOutcome = ReconcileOutcome.Idle
            configurations = emptyMap()
            regionChurches = emptyMap()
        }

        this.partition = partition
        this.churchSlugs = ordered
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

    /**
     * [onlyIfMonitoring] is for the reconciliation path, which runs on every
     * foreground whether or not the feature was ever on: with nothing
     * registered there is nothing to remove, and no reason to call into Play
     * services to remove it. An explicit [teardown] always asks the system.
     */
    private suspend fun teardownLocked(
        refusal: String = "disabled",
        onlyIfMonitoring: Boolean = false,
    ): ReconcileOutcome {
        val existing = monitor.monitoredRegions().map { it.identifier }.sorted()
        if (!onlyIfMonitoring || existing.isNotEmpty()) monitor.stopMonitoringAll()
        enabled = false
        regionChurches = emptyMap()
        lastOutcome = ReconcileOutcome(removed = existing, refusal = refusal)
        return lastOutcome
    }

    private suspend fun stopWith(
        refusal: String,
        refusals: Map<String, String> = emptyMap(),
    ): ReconcileOutcome {
        val existing = monitor.monitoredRegions().map { it.identifier }.sorted()
        monitor.stopMonitoringAll()
        regionChurches = emptyMap()
        lastOutcome = ReconcileOutcome(removed = existing, refusal = refusal, refusals = refusals)
        return lastOutcome
    }

    /**
     * The single funnel.
     *
     * [focusChurch] names the church a region event belongs to, so only that
     * church's configuration is force-refreshed on the event: the others are
     * not what woke the phone, and refetching them would cost a request each.
     */
    suspend fun reconcile(
        trigger: ReconcileTrigger,
        focusChurch: String? = null,
    ): ReconcileOutcome = mutex.withLock {
        // Asked for by name, a teardown always asks the system: a fence that
        // fired for a feature that is off exists whatever the mirror says.
        if (trigger == ReconcileTrigger.Teardown) return@withLock teardownLocked()

        val base = partition
        val slugs = churchSlugs
        if (!enabled || base == null || slugs.isEmpty()) {
            return@withLock teardownLocked(onlyIfMonitoring = true)
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
        val now = clock()
        val states = LinkedHashMap<String, GeofenceConfigurationState>()
        for (slug in slugs.take(MAX_MONITORED_CHURCHES)) {
            val force = when (trigger) {
                ReconcileTrigger.RegionEvent -> focusChurch == null || focusChurch == slug
                // Asked for because something the cache cannot know may have
                // changed: a reboot, a reset, a window opening, or the server
                // refusing an attempt — which is how a church switching
                // automatic check-in off reaches the phone before the cached
                // copy expires.
                ReconcileTrigger.BootOrUpdate,
                ReconcileTrigger.ServicesReset,
                ReconcileTrigger.WindowBoundary,
                ReconcileTrigger.ConfigurationRefreshed,
                -> true
                else -> false
            }
            states[slug] = source.currentConfiguration(
                churchSlug = slug,
                partition = base.copy(churchSlug = slug),
                nowEpochMillis = now,
                forceRefresh = force,
            )
        }

        val available = LinkedHashMap<String, GeofenceConfiguration>()
        val refusals = LinkedHashMap<String, String>()
        val unavailable = LinkedHashSet<String>()
        for ((slug, result) in states) {
            when (result) {
                is GeofenceConfigurationState.Available -> available[slug] = result.configuration
                is GeofenceConfigurationState.Refused -> refusals[slug] = result.reason
                GeofenceConfigurationState.Unavailable -> unavailable += slug
            }
        }
        configurations = configurations.filterKeys { it in unavailable } + available

        val primary = slugs.first()
        val primaryRefusal = when (states[primary]) {
            is GeofenceConfigurationState.Refused -> refusals[primary]
            GeofenceConfigurationState.Unavailable -> "configuration_unavailable"
            else -> null
        }

        if (available.isEmpty() && unavailable.isEmpty()) {
            return@withLock stopWith(primaryRefusal ?: refusals.values.first(), refusals)
        }

        return@withLock apply(available, unavailable, refusals, primaryRefusal, trigger, now)
    }

    private suspend fun apply(
        available: Map<String, GeofenceConfiguration>,
        unavailable: Set<String>,
        refusals: Map<String, String>,
        primaryRefusal: String?,
        trigger: ReconcileTrigger,
        now: Long,
    ): ReconcileOutcome {
        val actualSet = monitor.monitoredRegions()

        // Offline for a church is not a reason to stop watching it: leave what
        // is registered for it exactly as it is, and decide again next time.
        val retained = actualSet.filter { it.churchSlug != null && it.churchSlug in unavailable }

        val prioritised = prioritise(available, churchSlugs.firstOrNull(), now)
        val selection = selectAcrossChurches(
            prioritised,
            limit = ANDROID_GEOFENCE_LIMIT - retained.size,
        )
        val desired = retained + selection.regions
        val dropped = selection.dropped

        // Nothing usable anywhere and nothing to keep: the single-church
        // "offline leaves a working setup alone" rule.
        if (available.isEmpty()) {
            val refusedRegions = actualSet
                .filter { it.churchSlug != null && it.churchSlug in refusals }
                .map { it.identifier }
                .sorted()
            if (refusedRegions.isNotEmpty()) monitor.stopMonitoring(refusedRegions)
            regionChurches = actualSet
                .filterNot { it.identifier in refusedRegions }
                .mapNotNull { region -> region.churchSlug?.let { region.identifier to it } }
                .toMap()
            lastOutcome = ReconcileOutcome(
                removed = refusedRegions,
                monitoring = actualSet.size - refusedRegions.size,
                refusal = primaryRefusal ?: "configuration_unavailable",
                refusals = refusals,
                unavailable = unavailable,
            )
            return lastOutcome
        }

        val actualById = actualSet.associateBy { it.identifier }
        val desiredById = desired.associateBy { it.identifier }

        val removed = actualById.keys.filterNot { desiredById.containsKey(it) }.sorted()
        if (removed.isNotEmpty()) monitor.stopMonitoring(removed)

        // After a reboot the system holds nothing, and after a window boundary
        // the initial trigger has to fire again, so these register everything
        // the pass wants whatever the mirror says. The comparison still decides
        // what reads as an addition.
        val reregisterAll = trigger in REREGISTER_TRIGGERS

        val toAdd = mutableListOf<MonitoredRegion>()
        val added = mutableListOf<String>()
        val updated = mutableListOf<String>()

        for (region in desired) {
            val existing = if (trigger == ReconcileTrigger.BootOrUpdate) {
                null
            } else {
                actualById[region.identifier]
            }
            when {
                existing == null -> {
                    toAdd += region
                    added += region.identifier
                }
                // A moved or resized campus is a re-registration. An identical
                // one is left alone, which is what keeps this idempotent.
                existing != region || reregisterAll -> {
                    toAdd += region
                    updated += region.identifier
                }
            }
        }

        // Batched: `addGeofences` takes a list, and one call for twenty regions
        // is one round trip through the system service rather than twenty.
        if (toAdd.isNotEmpty()) monitor.startMonitoring(toAdd)

        regionChurches = desired
            .mapNotNull { region -> region.churchSlug?.let { region.identifier to it } }
            .toMap()

        lastOutcome = ReconcileOutcome(
            added = added.sorted(),
            removed = removed,
            updated = updated.sorted(),
            monitoring = desired.size,
            refusal = primaryRefusal,
            droppedForCapacity = dropped.sorted(),
            refusals = refusals,
            unavailable = unavailable,
        )
        return lastOutcome
    }

    private fun accountKey(partition: CachePartition): String =
        partition.copy(churchSlug = null).storageKey

    /** The regions chosen across churches, and every region left out for capacity. */
    data class Selection(val regions: List<MonitoredRegion>, val dropped: List<String>)

    companion object {
        /** Triggers after which the system may hold nothing, or must fire its initial trigger again. */
        val REREGISTER_TRIGGERS = setOf(
            ReconcileTrigger.BootOrUpdate,
            ReconcileTrigger.Launch,
            ReconcileTrigger.ServicesReset,
            ReconcileTrigger.WindowBoundary,
        )

        /**
         * Which regions to monitor for one church when it offers more than the cap.
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
            val loitering = loiteringDelayMillis(configuration)

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
                        churchSlug = configuration.churchSlug,
                    )
                }
        }

        /**
         * How long the phone must stay before the system reports a dwell.
         *
         * Every region gets one, because nothing is sent before the phone has
         * stayed: an entry alone costs no fix and no request.
         *
         * * **A church that wants confirmation** has its `minDwellSeconds`
         *   measured by the *server*, between the `detected` submission and the
         *   `confirm` — so the phone waits only [MINIMUM_ARRIVAL_DWELL_SECONDS]
         *   before `detected`, and the church's dwell is not served twice.
         * * **A church that chose no wait** is counted on `detected`, so the
         *   phone's dwell is the only one. It is the church's own
         *   `minDwellSeconds` (zero, from the server, for "no wait"), never
         *   below the floor that keeps a drive-by from being counted.
         *
         * Derived from authoritative configuration and part of the region's
         * identity, so a policy change re-registers.
         */
        fun loiteringDelayMillis(configuration: GeofenceConfiguration): Int {
            val seconds = if (configuration.requiresConfirmation) {
                MINIMUM_ARRIVAL_DWELL_SECONDS
            } else {
                configuration.minDwellSeconds.coerceAtLeast(MINIMUM_ARRIVAL_DWELL_SECONDS)
            }
            return seconds * 1000
        }

        /**
         * The order churches claim capacity in, when together they offer more
         * than [ANDROID_GEOFENCE_LIMIT].
         *
         * 1. The church the person has selected.
         * 2. Then the church whose next check-in window opens soonest — a
         *    window already open counts as now — because that is the next
         *    place this person could be checked in.
         * 3. Then by slug, so the order is total and reproducible.
         *
         * Deliberately never by distance, for the same reason as within a
         * church: the set must not depend on where the phone happens to be.
         */
        fun prioritise(
            configurations: Map<String, GeofenceConfiguration>,
            primary: String?,
            nowEpochMillis: Long,
        ): List<GeofenceConfiguration> =
            configurations.entries
                .sortedWith(
                    compareBy<Map.Entry<String, GeofenceConfiguration>> { if (it.key == primary) 0 else 1 }
                        .thenBy { nextWindowOpening(it.value, nowEpochMillis) }
                        .thenBy { it.key },
                )
                .map { it.value }

        /** Across churches in priority order, each within its own cap, together within [limit]. */
        fun selectAcrossChurches(
            prioritised: List<GeofenceConfiguration>,
            limit: Int = ANDROID_GEOFENCE_LIMIT,
        ): Selection {
            val chosen = mutableListOf<MonitoredRegion>()
            val dropped = mutableListOf<String>()
            val seen = HashSet<String>()
            for (configuration in prioritised) {
                val candidates = selectRegions(configuration)
                val selectedIds = candidates.map { it.identifier }.toSet()
                // Regions the per-church cap or bad geometry excluded.
                dropped += configuration.regions.map { it.regionId }.filterNot { it in selectedIds }
                for (region in candidates) {
                    if (!seen.add(region.identifier)) continue
                    if (chosen.size < limit.coerceAtLeast(0)) chosen += region else dropped += region.identifier
                }
            }
            return Selection(chosen, dropped)
        }

        /**
         * When [configuration]'s next check-in window opens, as epoch millis.
         *
         * A window that is open now answers now; no window at all sorts last.
         * Unparseable instants are ignored rather than trusted.
         */
        fun nextWindowOpening(configuration: GeofenceConfiguration, nowEpochMillis: Long): Long =
            configuration.windows
                .mapNotNull { window ->
                    val opens = parseInstant(window.checkinOpensAt) ?: return@mapNotNull null
                    val closes = parseInstant(window.checkinClosesAt) ?: return@mapNotNull null
                    when {
                        closes <= nowEpochMillis -> null
                        opens <= nowEpochMillis -> nowEpochMillis
                        else -> opens
                    }
                }
                .minOrNull() ?: Long.MAX_VALUE

        fun parseInstant(value: String?): Long? =
            value?.let { runCatching { Instant.parse(it).toEpochMilli() }.getOrNull() }
    }
}
