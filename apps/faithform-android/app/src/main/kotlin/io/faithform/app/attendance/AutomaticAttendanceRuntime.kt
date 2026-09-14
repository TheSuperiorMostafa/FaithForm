package io.faithform.app.attendance

import android.content.Context
import android.content.SharedPreferences
import io.faithform.app.host.ActivityResultRelay
import io.faithform.app.network.ApiClient
import io.faithform.app.session.SessionGateway

/**
 * Automatic attendance, assembled.
 *
 * Every piece is an adapter over a decision in `:core:attendance`, wired once
 * per process. Built lazily by the container, because a boot broadcast or a
 * worker may start the process, and nothing else in the app needs any of it.
 *
 * **Storage.** The record, the transition inbox, the open attempt and the
 * configuration cache all live in the container's `EncryptedSharedPreferences`,
 * so sign-out's purge removes them with the session. The region mirror has its
 * own encrypted file, because it must survive long enough for the teardown
 * that removes the regions it describes.
 */
class AutomaticAttendanceRuntime(
    context: Context,
    api: ApiClient,
    secureStore: SharedPreferences,
    private val sessions: SessionGateway,
    private val environmentKey: String,
    /** The same relay "Churches near me" uses; one dialog at a time either way. */
    locationDialogs: ActivityResultRelay<Array<String>, Map<String, Boolean>>,
    /** `shouldShowRequestPermissionRationale`, from whichever Activity is attached. */
    rationale: () -> ((String) -> Boolean)?,
) {
    private val appContext = context.applicationContext

    val requestHistory = PermissionRequestHistory(secureStore)

    val permissions = AndroidLocationPermissions(
        context = appContext,
        requester = object : AndroidLocationPermissions.PermissionRequester {
            override suspend fun request(permissions: Array<String>): Map<String, Boolean> =
                locationDialogs.request(permissions)

            override fun shouldShowRationale(permission: String): Boolean =
                rationale()?.invoke(permission) ?: false
        },
        history = requestHistory,
    )

    val scheduler = WorkManagerAttendanceScheduler(appContext)
    val notifier = AndroidAttendanceNotifier(appContext)
    val configurationSource = ApiGeofenceConfigurationSource(api, secureStore)
    private val attempts = EncryptedAttendanceAttemptStore(secureStore)

    val reconciler = GeofenceReconciler(
        monitor = PlayServicesRegionMonitoring(appContext),
        permissions = permissions,
        source = configurationSource,
    )

    val coordinator = AutomaticAttendanceCoordinator(
        reconciler = reconciler,
        submitter = ApiAttendanceSubmitter(api),
        sampler = PlayServicesLocationSampling(appContext),
        store = attempts,
        permissions = permissions,
    )

    val engine = AutomaticAttendanceEngine(
        coordinator = coordinator,
        reconciler = reconciler,
        records = EncryptedAutomaticAttendanceRecordStore(secureStore),
        inbox = EncryptedTransitionInbox(secureStore),
        attempts = attempts,
        notifier = notifier,
        scheduler = scheduler,
        consent = ApiAttendanceConsentClient(api),
        identity = {
            sessions.current()?.let { AttendanceIdentity(environmentKey, it.accountId) }
        },
    )

    /** Sign-out: every region, every attempt, every scheduled job, every notification. */
    suspend fun signOut() {
        engine.signOut()
        configurationSource.clear()
    }
}
