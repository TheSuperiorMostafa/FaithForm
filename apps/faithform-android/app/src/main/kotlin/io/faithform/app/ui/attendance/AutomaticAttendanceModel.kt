package io.faithform.app.ui.attendance

import android.Manifest
import android.content.Context
import android.os.Build
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.google.android.gms.common.ConnectionResult
import com.google.android.gms.common.GoogleApiAvailability
import io.faithform.app.attendance.AndroidAttendanceNotifier
import io.faithform.app.attendance.AttendanceAccountSnapshot
import io.faithform.app.attendance.AutomaticAttendanceJourney
import io.faithform.app.attendance.AutomaticAttendanceRuntime
import io.faithform.app.attendance.AutomaticAttendanceStatus
import io.faithform.app.attendance.AutomaticAttendanceStatusResolver
import io.faithform.app.attendance.ChurchName
import io.faithform.app.attendance.ForegroundLocationPermission
import io.faithform.app.attendance.NotificationAccess
import io.faithform.app.attendance.ReconcileTrigger
import io.faithform.app.attendance.SetupScreen
import io.faithform.app.attendance.TurnOnResult
import io.faithform.app.contract.Bootstrap
import io.faithform.app.contract.RelationshipState
import io.faithform.app.host.ActivityResultRelay
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.withContext
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/** Everything the automatic check-in screens render. */
data class AutomaticAttendanceUi(
    /** The setup screen on show, or null for the status screen. */
    val screen: SetupScreen? = null,
    val status: AutomaticAttendanceStatus? = null,
    val isWorking: Boolean = false,
    /** Turning on could not reach the server. */
    val turnOnFailed: Boolean = false,
    /** The system's own words for "Allow all the time", when it has them. */
    val backgroundOptionLabel: String? = null,
)

/**
 * The automatic check-in screens' state, and every action on them.
 *
 * Decisions are not made here: which screen follows which is
 * [AutomaticAttendanceJourney], what the status says is
 * [AutomaticAttendanceStatusResolver], and what turning on or off does is the
 * engine. This holds the result and raises the dialogs — only ever from a tap.
 */
class AutomaticAttendanceModel(
    private val context: Context,
    private val runtime: AutomaticAttendanceRuntime,
    private val notificationDialog: ActivityResultRelay<String, Boolean>,
    private val environmentKey: String,
    private val accountId: () -> String?,
    /**
     * Consent was recorded or withdrawn, which moves the account's
     * authorization version: the shell reloads its bootstrap so every other
     * screen partitions against the new one.
     */
    private val onAuthorizationChanged: () -> Unit = {},
) : ViewModel() {

    private val _ui = MutableStateFlow(AutomaticAttendanceUi())
    val ui: StateFlow<AutomaticAttendanceUi> = _ui.asStateFlow()

    private var snapshot: AttendanceAccountSnapshot? = null
    private var launched = false
    private var syncJob: Job? = null

    init {
        viewModelScope.launch {
            runtime.engine.record.collect { refreshStatus() }
        }
    }

    // -----------------------------------------------------------------------
    // The shell
    // -----------------------------------------------------------------------

    /**
     * The signed-in shell rendered with this bootstrap and selection.
     *
     * The first call in a process is a launch, which re-registers everything;
     * after that a different selected church or authorization version says
     * which trigger it is, and anything else is a no-op.
     */
    fun onShell(bootstrap: Bootstrap, selectedChurchSlug: String?) {
        val account = accountId() ?: return
        val next = snapshotOf(environmentKey, account, bootstrap, selectedChurchSlug)
        val previous = snapshot
        if (previous == next && launched) return
        snapshot = next

        val trigger = when {
            !launched || previous == null -> ReconcileTrigger.Launch
            previous.accountId != next.accountId -> ReconcileTrigger.AccountChanged
            previous.authorizationVersion != next.authorizationVersion -> ReconcileTrigger.AuthorizationVersionChanged
            previous.churches.firstOrNull() != next.churches.firstOrNull() -> ReconcileTrigger.ChurchChanged
            else -> ReconcileTrigger.ConfigurationRefreshed
        }
        launched = true
        sync(trigger)
    }

    /** The app came back to the foreground — possibly from Settings. */
    fun onForeground() {
        if (!launched) return
        sync(ReconcileTrigger.PermissionChanged)
    }

    private fun sync(trigger: ReconcileTrigger) {
        val current = snapshot ?: return
        syncJob?.cancel()
        syncJob = viewModelScope.launch {
            io { runtime.engine.sync(current, trigger) }
            refreshStatus()
        }
    }

    // -----------------------------------------------------------------------
    // The journey
    // -----------------------------------------------------------------------

    /** "Turn on automatic check-in", or any fix that means starting again. */
    fun begin() {
        _ui.value = _ui.value.copy(screen = SetupScreen.Introduction, turnOnFailed = false)
    }

    /**
     * "Continue setup": the feature is on, but setup was left before a
     * permission was asked for. Picks up at the first screen still missing,
     * without recording consent a second time.
     */
    fun continueSetup() {
        viewModelScope.launch { advance(SetupScreen.Introduction) }
    }

    /** "Not now" on any setup screen. Whatever was granted stays granted. */
    fun leaveSetup() {
        _ui.value = _ui.value.copy(screen = null, isWorking = false)
        viewModelScope.launch { refreshStatus() }
    }

    /** The introduction's "Continue": consent first, then the permissions. */
    fun continueIntroduction() {
        val current = snapshot ?: return
        working(true)
        viewModelScope.launch {
            when (io { runtime.engine.turnOn(current) }) {
                is TurnOnResult.On -> {
                    onAuthorizationChanged()
                    advance(SetupScreen.Introduction)
                }
                // No church here offers it: consent was withdrawn again, and
                // the status screen says why — with no location prompt.
                is TurnOnResult.NotOffered -> {
                    onAuthorizationChanged()
                    _ui.value = _ui.value.copy(screen = null, isWorking = false)
                    refreshStatus()
                }
                TurnOnResult.Offline, TurnOnResult.Failed ->
                    _ui.value = _ui.value.copy(isWorking = false, turnOnFailed = true)
            }
        }
    }

    /** The foreground education's button: the system dialog, then onwards. */
    fun requestForeground() {
        working(true)
        viewModelScope.launch {
            runtime.permissions.requestForeground()
            io { runtime.engine.reconcile(ReconcileTrigger.PermissionChanged) }
            advance(SetupScreen.ForegroundEducation)
        }
    }

    /**
     * The prominent disclosure's "Continue".
     *
     * Android 10 answers in a dialog; Android 11 and later open this app's
     * location page in Settings, and the answer arrives on return.
     */
    fun requestBackground() {
        working(true)
        viewModelScope.launch {
            runtime.permissions.requestBackground()
            io { runtime.engine.reconcile(ReconcileTrigger.PermissionChanged) }
            advance(SetupScreen.BackgroundDisclosure)
        }
    }

    fun requestNotifications() {
        working(true)
        viewModelScope.launch {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                notificationDialog.request(Manifest.permission.POST_NOTIFICATIONS)
                runtime.requestHistory.markRequested(Manifest.permission.POST_NOTIFICATIONS)
            }
            advance(SetupScreen.NotificationEducation)
        }
    }

    /** Opens the disclosure from the status screen's "Allow all the time". */
    fun showBackgroundDisclosure() {
        _ui.value = _ui.value.copy(screen = SetupScreen.BackgroundDisclosure)
    }

    /** "Use precise location": Android 12+ upgrades approximate from the same dialog. */
    fun requestPrecise() = requestForegroundInPlace()

    /** "Allow location" after a re-askable denial. */
    fun requestForegroundInPlace() {
        working(true)
        viewModelScope.launch {
            runtime.permissions.requestForeground()
            io { runtime.engine.reconcile(ReconcileTrigger.PermissionChanged) }
            working(false)
            refreshStatus()
        }
    }

    fun tryAgain() {
        working(true)
        viewModelScope.launch {
            io { runtime.engine.reconcile(ReconcileTrigger.ConfigurationRefreshed) }
            working(false)
            refreshStatus()
        }
    }

    /** "Check in" on the status screen's question. */
    fun confirmArrival() {
        working(true)
        runtime.notifier.checking()
        runtime.scheduler.confirmWhenOnline()
        viewModelScope.launch {
            working(false)
            refreshStatus()
        }
    }

    fun turnOff() {
        working(true)
        viewModelScope.launch {
            io { runtime.engine.turnOff() }
            io { runtime.configurationSource.clear() }
            onAuthorizationChanged()
            _ui.value = _ui.value.copy(screen = null, isWorking = false)
            refreshStatus()
        }
    }

    // -----------------------------------------------------------------------
    // Internals
    // -----------------------------------------------------------------------

    private suspend fun advance(after: SetupScreen) {
        val permissions = runtime.permissions.current()
        val next = AutomaticAttendanceJourney.next(after, permissions, notificationAccess())
        _ui.value = _ui.value.copy(
            screen = next.takeUnless { it == SetupScreen.Status },
            isWorking = false,
        )
        refreshStatus()
    }

    /**
     * The engine reads and writes the encrypted store and waits on the network,
     * so it never runs on the main thread. Dialogs stay there: a permission
     * launcher must be started from it.
     */
    private suspend fun <T> io(block: suspend () -> T): T = withContext(Dispatchers.IO) { block() }

    private fun working(value: Boolean) {
        _ui.value = _ui.value.copy(isWorking = value)
    }

    suspend fun refreshStatus() {
        val record = runtime.engine.record.value
        val permissions = runtime.permissions.current()
        val status = AutomaticAttendanceStatusResolver.resolve(
            record = record,
            permissions = permissions,
            notifications = notificationAccess(),
            requiresConfirmation = runtime.engine.anyChurchRequiresConfirmation(),
            nextService = runtime.engine.upcoming(),
            playServicesResolvable = playServicesResolvable(),
        )
        _ui.value = _ui.value.copy(
            status = status,
            backgroundOptionLabel = runtime.permissions.backgroundOptionLabel(),
        )
    }

    private fun notificationAccess(): NotificationAccess = AndroidAttendanceNotifier.access(
        context,
        requested = runtime.requestHistory.hasRequested(Manifest.permission.POST_NOTIFICATIONS),
    )

    private fun playServicesResolvable(): Boolean = runCatching {
        val availability = GoogleApiAvailability.getInstance()
        val code = availability.isGooglePlayServicesAvailable(context)
        code != ConnectionResult.SUCCESS && availability.isUserResolvableError(code)
    }.getOrDefault(false)

    companion object {
        /**
         * The churches automatic check-in may watch: every church this account
         * can read and has not left, the selected one first.
         */
        fun snapshotOf(
            environment: String,
            accountId: String,
            bootstrap: Bootstrap,
            selectedChurchSlug: String?,
        ): AttendanceAccountSnapshot {
            val readable = bootstrap.relationships.filter {
                it.canReadPublishedContent &&
                    it.state != RelationshipState.BLOCKED &&
                    it.state != RelationshipState.LEFT
            }
            val ordered = readable.sortedBy { if (it.churchSlug == selectedChurchSlug) 0 else 1 }
            return AttendanceAccountSnapshot(
                environment = environment,
                accountId = accountId,
                authorizationVersion = bootstrap.profile.authorizationVersion,
                consent = bootstrap.profile.autoAttendanceConsent.wire,
                churches = ordered.map { ChurchName(it.churchSlug, it.churchName) },
            )
        }

        /** Whether the foreground state means the dialog can still be raised. */
        fun canAskForeground(state: ForegroundLocationPermission): Boolean =
            state == ForegroundLocationPermission.NotRequested || state == ForegroundLocationPermission.Denied
    }
}
