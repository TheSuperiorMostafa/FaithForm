package io.faithform.app.attendance

/**
 * Whether FaithForm may post a notification, as the status screen needs it.
 *
 * Separate from location on purpose: a person may allow location all the time
 * and still decline notifications, in which case check-ins still happen but a
 * church that asks "are you here?" can only ask inside the app.
 */
enum class NotificationAccess {
    /** Below Android 13 there is no runtime permission, and notifications are on. */
    NotRequired,
    Granted,

    /** Never asked. The education screen may be shown. */
    NotRequested,

    /** Declined, or turned off for FaithForm in Settings. Only Settings helps. */
    Denied,
}

/** The one thing to do about the state on screen. Each maps to a single button. */
enum class AttendanceFix {
    None,

    /** Start (or restart) the journey from the introduction. */
    TurnOn,

    /**
     * The feature is on but setup was left before a permission was ever asked
     * for: pick up the journey at the first screen still missing.
     */
    ContinueSetup,

    /** Raise the foreground dialog again: it was declined, not permanently. */
    RequestForeground,

    /** Ask for precise location: Android 12+ lets the dialog upgrade approximate. */
    RequestPrecise,

    /** Only the app's own Settings page can change this. */
    OpenAppSettings,

    /** Location is off for the whole device. */
    OpenLocationSettings,

    /** Show the background disclosure, then hand off to "Allow all the time". */
    AllowBackground,

    /** Play services can be installed, updated or enabled from its own dialog. */
    ResolvePlayServices,

    /** Raise the notification dialog (Android 13+). */
    RequestNotifications,
    OpenNotificationSettings,

    /** Offline or the configuration could not be fetched: try again. */
    TryAgain,
}

/**
 * Everything the automatic check-in status renders.
 *
 * Resolved here, from state, rather than in a composable — so the mapping from
 * every permission state to what the person sees and can do is a table test.
 */
data class AutomaticAttendanceStatus(
    val step: AutomaticAttendanceStep,
    /** What the main action does. [AttendanceFix.None] means no button. */
    val fix: AttendanceFix,
    val notifications: NotificationAccess,
    /** How to fix notifications, when they matter and are off. */
    val notificationFix: AttendanceFix,
    val monitoring: Int,
    val churches: List<ChurchName>,
    val lastCheckIn: LastCheckIn?,
    val nextService: NextService?,
    /** A question waiting for the person, with the church it is about. */
    val pendingConfirmation: PendingConfirmation?,
    val pendingChurchName: String?,
    /** Whether "Turn off" is offered. True whenever the person turned the feature on. */
    val canTurnOff: Boolean,
    /** Churches being watched: every readable church that did not refuse. */
    val watching: List<ChurchName> = churches,
    /** Churches that do not offer automatic check-in, while others may. */
    val unavailableAt: List<ChurchName> = emptyList(),
) {
    val isOn: Boolean get() = step is AutomaticAttendanceStep.Ready
}

object AutomaticAttendanceStatusResolver {

    fun resolve(
        record: AutomaticAttendanceRecord,
        permissions: LocationPermissionState,
        notifications: NotificationAccess,
        requiresConfirmation: Boolean,
        nextService: NextService? = null,
        playServicesResolvable: Boolean = false,
    ): AutomaticAttendanceStatus {
        val notOffered = record.monitoringRefusal?.takeIf {
            !record.enabled && it in AutomaticAttendanceEngine.NOT_OFFERED_REFUSALS
        }
        val step = when (notOffered) {
            // Turning on found no church that offers it, and withdrew consent
            // again. Said plainly, with no permission in sight.
            "geofence_disabled" -> AutomaticAttendanceStep.Blocked(AutomaticAttendanceBlocker.ChurchDisabled)
            "no_campus_configured" -> AutomaticAttendanceStep.Blocked(AutomaticAttendanceBlocker.NoCampus)
            else -> AutomaticAttendanceResolver.resolve(record.settings(), permissions, record.monitoringRefusal)
        }

        val fix = when {
            notOffered != null -> AttendanceFix.TurnOn
            else -> fixForStep(step, permissions, playServicesResolvable)
        }

        val unavailable = record.unavailableAt.toSet()

        return build(record, step, fix, notifications, requiresConfirmation, nextService, unavailable)
    }

    private fun fixForStep(
        step: AutomaticAttendanceStep,
        permissions: LocationPermissionState,
        playServicesResolvable: Boolean,
    ): AttendanceFix = when (step) {
        AutomaticAttendanceStep.NotStarted -> AttendanceFix.TurnOn
        AutomaticAttendanceStep.Ready -> AttendanceFix.None
        is AutomaticAttendanceStep.Blocked -> fixFor(step.blocker, permissions, playServicesResolvable)
        else -> AttendanceFix.None
    }

    private fun build(
        record: AutomaticAttendanceRecord,
        step: AutomaticAttendanceStep,
        fix: AttendanceFix,
        notifications: NotificationAccess,
        requiresConfirmation: Boolean,
        nextService: NextService?,
        unavailable: Set<String>,
    ): AutomaticAttendanceStatus {
        // Notifications only matter once the feature is on. Before that, asking
        // about them would be asking for something with nothing behind it.
        val notificationFix = if (!record.enabled) {
            AttendanceFix.None
        } else {
            when (notifications) {
                NotificationAccess.NotRequested -> AttendanceFix.RequestNotifications
                NotificationAccess.Denied ->
                    // Off is a choice when every church counts on arrival; it is
                    // worth a button only when a church needs to ask.
                    if (requiresConfirmation) AttendanceFix.OpenNotificationSettings else AttendanceFix.None
                else -> AttendanceFix.None
            }
        }

        val pending = record.pendingConfirmation?.takeIf { record.enabled }

        return AutomaticAttendanceStatus(
            step = step,
            fix = fix,
            notifications = notifications,
            notificationFix = notificationFix,
            monitoring = if (step is AutomaticAttendanceStep.Ready) record.monitoring else 0,
            churches = record.churches,
            lastCheckIn = record.lastCheckIn,
            nextService = nextService?.takeIf { step is AutomaticAttendanceStep.Ready },
            pendingConfirmation = pending,
            pendingChurchName = pending?.let { record.churchName(it.churchSlug) },
            canTurnOff = record.enabled,
            watching = record.churches.filterNot { it.slug in unavailable },
            unavailableAt = record.churches.filter { it.slug in unavailable && record.enabled },
        )
    }

    /**
     * The action for a blocker.
     *
     * Deliberately exact. Sending someone to Settings when the dialog can still
     * be raised wastes a step; offering a Settings button for a church that has
     * not enabled the feature leads nowhere.
     */
    fun fixFor(
        blocker: AutomaticAttendanceBlocker,
        permissions: LocationPermissionState,
        playServicesResolvable: Boolean,
    ): AttendanceFix = when (blocker) {
        AutomaticAttendanceBlocker.ForegroundDenied ->
            // Never asked is not declined: setup was left before the question.
            if (permissions.foreground == ForegroundLocationPermission.NotRequested) {
                AttendanceFix.ContinueSetup
            } else {
                AttendanceFix.RequestForeground
            }
        AutomaticAttendanceBlocker.ForegroundPermanentlyDenied -> AttendanceFix.OpenAppSettings
        AutomaticAttendanceBlocker.ApproximateLocationOnly -> AttendanceFix.RequestPrecise
        AutomaticAttendanceBlocker.NeedsBackgroundPermission -> when (permissions.background) {
            BackgroundLocationPermission.PermanentlyDenied -> AttendanceFix.OpenAppSettings
            BackgroundLocationPermission.NotRequested -> AttendanceFix.ContinueSetup
            else -> AttendanceFix.AllowBackground
        }
        AutomaticAttendanceBlocker.LocationServicesOff -> AttendanceFix.OpenLocationSettings
        AutomaticAttendanceBlocker.PlayServicesUnavailable ->
            if (playServicesResolvable) AttendanceFix.ResolvePlayServices else AttendanceFix.None
        AutomaticAttendanceBlocker.ConsentMissing -> AttendanceFix.TurnOn
        AutomaticAttendanceBlocker.Unavailable -> AttendanceFix.TryAgain
        AutomaticAttendanceBlocker.NoPeopleLink,
        AutomaticAttendanceBlocker.ChurchDisabled,
        AutomaticAttendanceBlocker.NoCampus,
        -> AttendanceFix.None
    }
}

/** The screens of the setup journey, in the only order they can appear. */
enum class SetupScreen {
    /** What it does, what it never does. Continuing records consent. */
    Introduction,

    /** Why location, before the system dialog. */
    ForegroundEducation,

    /**
     * Google Play's prominent disclosure for background location: the data, the
     * purpose, that it is not shared — immediately before the request.
     */
    BackgroundDisclosure,

    /** Why notifications, before the Android 13+ dialog. */
    NotificationEducation,

    /** The status screen. Anything still missing is shown there with its fix. */
    Status,
}

/**
 * Which screen comes next.
 *
 * **Never a loop.** Each education screen appears at most once per pass: once
 * the person has answered a system dialog, whatever they chose is shown on the
 * status screen with the one action that can change it. Being walked back to a
 * screen they just declined would be pressure, and Play's policy on location
 * prompts agrees.
 */
object AutomaticAttendanceJourney {

    fun next(
        after: SetupScreen?,
        permissions: LocationPermissionState,
        notifications: NotificationAccess,
    ): SetupScreen {
        if (after == null) return SetupScreen.Introduction

        // A device that cannot run the feature at all goes straight to the
        // status screen, which says so and offers the fix if there is one.
        if (!permissions.playServicesAvailable || !permissions.locationServicesEnabled) {
            return SetupScreen.Status
        }

        val foregroundDone = permissions.foreground == ForegroundLocationPermission.Fine
        val backgroundDone = permissions.background == BackgroundLocationPermission.Granted ||
            permissions.background == BackgroundLocationPermission.NotApplicable

        return when (after) {
            SetupScreen.Introduction -> when {
                permissions.foreground == ForegroundLocationPermission.PermanentlyDenied -> SetupScreen.Status
                !foregroundDone -> SetupScreen.ForegroundEducation
                else -> afterForeground(backgroundDone, permissions, notifications)
            }
            SetupScreen.ForegroundEducation ->
                if (foregroundDone) afterForeground(backgroundDone, permissions, notifications) else SetupScreen.Status
            SetupScreen.BackgroundDisclosure ->
                if (backgroundDone) afterBackground(notifications) else SetupScreen.Status
            SetupScreen.NotificationEducation -> SetupScreen.Status
            SetupScreen.Status -> SetupScreen.Status
        }
    }

    private fun afterForeground(
        backgroundDone: Boolean,
        permissions: LocationPermissionState,
        notifications: NotificationAccess,
    ): SetupScreen = when {
        backgroundDone -> afterBackground(notifications)
        permissions.background == BackgroundLocationPermission.PermanentlyDenied -> SetupScreen.Status
        else -> SetupScreen.BackgroundDisclosure
    }

    private fun afterBackground(notifications: NotificationAccess): SetupScreen =
        if (notifications == NotificationAccess.NotRequested) SetupScreen.NotificationEducation else SetupScreen.Status
}
