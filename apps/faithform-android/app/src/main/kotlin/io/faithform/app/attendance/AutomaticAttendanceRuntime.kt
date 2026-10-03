package io.faithform.app.attendance

import android.content.Context
import com.google.android.gms.location.Geofence
import io.faithform.app.contract.*
import io.faithform.app.network.FaithFormJson
import io.faithform.app.network.MobileSuccess
import io.faithform.app.session.AppContainer
import io.faithform.app.storage.CachePartition
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

/** App-scoped owner. Restores the same encrypted device choice when a receiver starts a cold process. */
class AutomaticAttendanceRuntime(private val context: Context, private val container: AppContainer,
    locationSampling: LocationSampling = PlayServicesLocationSampling(context)) {
    private val lock = Mutex()
    private val source = ApiAutomaticAttendance(container.apiClient)
    val permissions = AndroidLocationPermissions(context,
        foregroundWasRequested = { container.secureStore.getBoolean("attendance.foregroundRequested", false) },
        recordForegroundRequest = { container.secureStore.edit().putBoolean("attendance.foregroundRequested", true).apply() },
        requester = object : AndroidLocationPermissions.PermissionRequester {
        override suspend fun request(permissions: Array<String>) = container.locationPermissions.request(permissions)
        override fun shouldShowRationale(permission: String) = container.permissionRationale?.invoke(permission) ?: false
    })
    val reconciler = GeofenceReconciler(PlayServicesRegionMonitoring(context, mirrorPreferences = container.secureStore), permissions, source)
    val attempts = EncryptedAttendanceAttemptStore(container.secureStore)
    val coordinator = AutomaticAttendanceCoordinator(reconciler, source, locationSampling, attempts, permissions)
    private var bootstrap: Bootstrap? = null
    private var partition: CachePartition? = null
    private var restoredRegistration = false
    private val _state = MutableStateFlow(AutomaticAttendanceUiState())
    val state = _state.asStateFlow()
    private val prefs get() = container.secureStore
    private fun choiceKey(account: String, slug: String) = "attendance.enabled.$account.$slug"

    suspend fun bind(value: Bootstrap, slug: String?) = lock.withLock { bindLocked(value, slug) }
    private suspend fun bindLocked(value: Bootstrap, slug: String?) {
        val session = container.sessionStore.current() ?: return
        if (partition?.accountId == session.accountId && bootstrap != null && value.profile.authorizationVersion < bootstrap!!.profile.authorizationVersion) return
        bootstrap = value
        val church = value.relationships.firstOrNull { it.churchSlug == slug }
        val current = CachePartition(container.environmentKey, session.accountId, slug, value.profile.authorizationVersion)
        partition = current
        prefs.edit().putString("attendance.church", slug).apply()
        coordinator.bind(current, session.accountId, AutomaticAttendanceSettings(
            enabled = church?.automaticCheckInEnabled == true && slug != null && prefs.getBoolean(choiceKey(session.accountId, slug), false),
            serverConsent = value.profile.autoAttendanceConsent.wire, churchSlug = slug,
        ))
        if (coordinator.settings.enabled) {
            // Android clears geofences after a force-stop. The encrypted mirror
            // survives, so the first bind in every process must replace it.
            coordinator.reconcile(if (restoredRegistration) ReconcileTrigger.Foreground else ReconcileTrigger.BootOrUpdate)
            restoredRegistration = reconciler.lastOutcome.refusal == null
            AttendanceWork.scheduleMaintenance(context)
        } else AttendanceWork.cancelMaintenance(context)
        publish()
    }

    /** Fetch authority before background work; a persisted toggle is never enough to act. */
    suspend fun restore(): Boolean = lock.withLock {
        if (container.sessionStore.current() == null) { coordinator.disable(); return@withLock false }
        val slug = prefs.getString("attendance.church", null) ?: return@withLock false
        val value = container.apiClient.send("api/mobile/v1/account/bootstrap", MobileSuccess.serializer(Bootstrap.serializer())).value
            ?: return@withLock false
        bindLocked(value, slug)
        coordinator.settings.isOperational(permissions.current()) && reconciler.lastOutcome.refusal == null
    }

    suspend fun enable() = lock.withLock {
        if (!permissions.current().canMonitorGeofences) { publish(); return@withLock }
        val value = bootstrap ?: return@withLock
        val session = container.sessionStore.current() ?: return@withLock
        val slug = coordinator.settings.churchSlug ?: return@withLock
        _state.value = _state.value.copy(isWorking = true)
        try {
            val consent = writeConsent("granted")
            prefs.edit().putBoolean(choiceKey(session.accountId, slug), true).apply()
            bindLocked(value.copy(profile = value.profile.copy(autoAttendanceConsent = ConsentState.fromWire(consent.autoAttendanceConsent),
                authorizationVersion = consent.authorizationVersion)), slug)
        } finally { publish() }
    }

    suspend fun disable(): Boolean = lock.withLock {
        val session = container.sessionStore.current()
        coordinator.settings.churchSlug?.let { slug ->
            session?.let { prefs.edit().putBoolean(choiceKey(it.accountId, slug), false).apply() }
        }
        // Always stop locally, including when the network cannot save withdrawal yet.
        AttendanceWork.cancelAll(context)
        coordinator.disable()
        attempts.closeAll()
        val saved = runCatching { writeConsent("revoked") }.getOrNull()
        prefs.edit().putBoolean("attendance.pendingWithdrawal", saved == null).apply()
        publish()
        saved != null
    }

    private suspend fun writeConsent(consent: String): AttendanceConsentResult =
        container.apiClient.send("api/mobile/v1/attendance/consent", MobileSuccess.serializer(AttendanceConsentResult.serializer()),
            method = "POST", body = FaithFormJson.encodeToString(AttendanceConsentRequest.serializer(), AttendanceConsentRequest(consent))).value
            ?: error("consent_unavailable")

    suspend fun foreground() {
        if (prefs.getBoolean("attendance.pendingWithdrawal", false) && container.sessionStore.current() != null) {
            if (runCatching { writeConsent("revoked") }.isSuccess) prefs.edit().remove("attendance.pendingWithdrawal").apply()
        }
        if (restore()) lock.withLock { coordinator.flushPending(); coordinator.confirmIfDue(); publish() }
    }

    suspend fun transition(kind: Int, region: String?) {
        if (kind == Geofence.GEOFENCE_TRANSITION_EXIT) {
            lock.withLock {
                region?.let { coordinator.handleRegionExited(it) }
                attempts.closeAll()
                AttendanceWork.cancelConfirmation(context)
                publish()
            }
            return
        }
        if (!restore()) return
        lock.withLock {
            when (kind) {
                Geofence.GEOFENCE_TRANSITION_ENTER -> region?.let { coordinator.handleRegionEntered(it); coordinator.confirmIfDue() }
                Geofence.GEOFENCE_TRANSITION_DWELL -> coordinator.confirmIfDue()
                Geofence.GEOFENCE_TRANSITION_EXIT -> region?.let {
                    coordinator.handleRegionExited(it)
                    partition?.let { current -> attempts.close(current) }
                    AttendanceWork.cancelConfirmation(context)
                }
                0 -> coordinator.reconcile(ReconcileTrigger.BootOrUpdate)
                else -> { coordinator.reconcile(ReconcileTrigger.Foreground); coordinator.flushPending(); coordinator.confirmIfDue() }
            }
            partition?.let { current ->
                attempts.current(current, System.currentTimeMillis())?.confirmationNotBeforeEpochMillis?.let { due ->
                    AttendanceWork.scheduleConfirmation(context, due)
                }
            }
            publish()
        }
    }

    suspend fun clear() = lock.withLock { AttendanceWork.cancelAll(context); coordinator.disable(); attempts.closeAll(); bootstrap = null; partition = null; _state.value = AutomaticAttendanceUiState() }
    suspend fun refreshStatus() = lock.withLock { publish() }
    private suspend fun publish() {
        _state.value = AutomaticAttendanceUiState(
            step = AutomaticAttendanceResolver.resolve(coordinator.settings, permissions.current(), reconciler.lastOutcome.refusal),
            monitoredRegionCount = reconciler.lastOutcome.monitoring,
        )
    }
}
