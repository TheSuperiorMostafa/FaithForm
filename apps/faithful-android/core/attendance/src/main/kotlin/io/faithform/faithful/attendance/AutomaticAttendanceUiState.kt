package io.faithform.faithful.attendance

/**
 * Where the automatic-attendance opt-in currently stands.
 *
 * **Progressive by construction.** The steps are ordered and each is reachable
 * only from the one before, with the education screens as real states rather
 * than a flag someone could forget to check. That is what makes "never prompt
 * at launch" a property of the type: the model starts at [NotStarted], and only
 * an explicit action moves it.
 *
 * Mirrors `AutomaticAttendanceStep` in Swift case for case.
 */
sealed interface AutomaticAttendanceStep {
    /** Never offered. Nothing requested. */
    data object NotStarted : AutomaticAttendanceStep

    /** What automatic attendance is, and what it does with location. */
    data object Introduction : AutomaticAttendanceStep

    /** Why foreground location is needed, before the system dialog. */
    data object ForegroundEducation : AutomaticAttendanceStep

    /**
     * Why background location is needed.
     *
     * On API 30+ this screen's action opens Settings rather than a dialog,
     * because the runtime dialog has no "Allow all the time" option there.
     */
    data object BackgroundEducation : AutomaticAttendanceStep

    /** Waiting for the server to record consent. */
    data object RequestingConsent : AutomaticAttendanceStep

    /** Everything is in place. */
    data object Ready : AutomaticAttendanceStep

    /** A state the person can be told about, and sometimes act on. */
    data class Blocked(val blocker: AutomaticAttendanceBlocker) : AutomaticAttendanceStep
}

/**
 * Why automatic attendance is not currently working.
 *
 * Each maps to different copy and a different action, which is why these are
 * distinct cases rather than one `Failed(String)`. Sending someone to Settings
 * when the real problem is that their church has not enabled the feature would
 * waste their time.
 */
enum class AutomaticAttendanceBlocker {
    /** The foreground dialog was declined. Asking again may still work. */
    ForegroundDenied,

    /** Declined with "Don't ask again". Only Settings will help. */
    ForegroundPermanentlyDenied,

    /** Approximate location only. Cannot resolve a campus-sized region. */
    ApproximateLocationOnly,

    /** Background location missing. On API 30+ this means Settings. */
    NeedsBackgroundPermission,

    /** Location switched off device-wide, for every app. */
    LocationServicesOff,

    /** Play services absent or too old. Geofencing is unavailable. */
    PlayServicesUnavailable,

    /** The church has not confirmed who this person is. */
    NoPeopleLink,

    /** Server consent absent or withdrawn. */
    ConsentMissing,

    /** The church has automatic attendance switched off. */
    ChurchDisabled,

    /** The church has no campus with a position set. */
    NoCampus,

    /** Offline, or the configuration could not be fetched. */
    Unavailable;

    /**
     * Whether a Settings link is worth offering.
     *
     * Deliberately narrow. A church that has not enabled the feature, or a
     * missing People link, cannot be fixed in Android settings, and offering a
     * button that leads nowhere useful is worse than offering none.
     */
    val isRecoverableInSettings: Boolean
        get() = this in setOf(
            ForegroundPermanentlyDenied,
            ApproximateLocationOnly,
            NeedsBackgroundPermission,
            LocationServicesOff,
        )
}

/** A server verdict worth showing. Never a local guess. */
data class RecentCheckIn(
    val label: String,
    val countedAtEpochMillis: Long,
    val alreadyCounted: Boolean,
)

/**
 * Everything the readiness screen renders, resolved from state rather than
 * decided in the view.
 *
 * The title and explanation are resource ids rather than strings so the model
 * stays testable on a plain JVM and no user-facing literal appears in code —
 * the localization gate refuses those.
 */
data class AutomaticAttendanceUiState(
    val step: AutomaticAttendanceStep = AutomaticAttendanceStep.NotStarted,
    val monitoredRegionCount: Int = 0,
    val recentCheckIn: RecentCheckIn? = null,
    val isWorking: Boolean = false,
    val title: String = "",
    val explanation: String = "",
) {
    val isReady: Boolean get() = step is AutomaticAttendanceStep.Ready

    val canSetUp: Boolean
        get() = step is AutomaticAttendanceStep.NotStarted ||
            step is AutomaticAttendanceStep.Introduction ||
            step is AutomaticAttendanceStep.ForegroundEducation ||
            step is AutomaticAttendanceStep.BackgroundEducation ||
            (step as? AutomaticAttendanceStep.Blocked)?.blocker ==
            AutomaticAttendanceBlocker.ConsentMissing

    val canOpenSettings: Boolean
        get() = (step as? AutomaticAttendanceStep.Blocked)?.blocker?.isRecoverableInSettings == true
}

/**
 * Resolves permission and reconciliation state into a step.
 *
 * Pure, so every combination is a table test rather than something that needs a
 * device to reach. The order matters: device conditions are reported before
 * server ones, because a person with location switched off cannot act on being
 * told their church has not configured a campus.
 */
object AutomaticAttendanceResolver {
    fun resolve(
        settings: AutomaticAttendanceSettings,
        permissions: LocationPermissionState,
        refusal: String?,
    ): AutomaticAttendanceStep {
        if (!permissions.playServicesAvailable) {
            return AutomaticAttendanceStep.Blocked(AutomaticAttendanceBlocker.PlayServicesUnavailable)
        }
        if (!permissions.locationServicesEnabled) {
            return AutomaticAttendanceStep.Blocked(AutomaticAttendanceBlocker.LocationServicesOff)
        }

        when (permissions.foreground) {
            ForegroundLocationPermission.PermanentlyDenied ->
                return AutomaticAttendanceStep.Blocked(
                    AutomaticAttendanceBlocker.ForegroundPermanentlyDenied,
                )
            ForegroundLocationPermission.Denied ->
                return AutomaticAttendanceStep.Blocked(AutomaticAttendanceBlocker.ForegroundDenied)
            ForegroundLocationPermission.Coarse ->
                return AutomaticAttendanceStep.Blocked(
                    AutomaticAttendanceBlocker.ApproximateLocationOnly,
                )
            ForegroundLocationPermission.NotRequested ->
                return if (settings.enabled) {
                    AutomaticAttendanceStep.Blocked(AutomaticAttendanceBlocker.ForegroundDenied)
                } else {
                    AutomaticAttendanceStep.NotStarted
                }
            ForegroundLocationPermission.Fine -> Unit
        }

        if (permissions.background != BackgroundLocationPermission.Granted &&
            permissions.background != BackgroundLocationPermission.NotApplicable
        ) {
            return AutomaticAttendanceStep.Blocked(
                AutomaticAttendanceBlocker.NeedsBackgroundPermission,
            )
        }

        if (!settings.enabled) return AutomaticAttendanceStep.NotStarted
        if (settings.serverConsent != "granted") {
            return AutomaticAttendanceStep.Blocked(AutomaticAttendanceBlocker.ConsentMissing)
        }

        return when (refusal) {
            null -> AutomaticAttendanceStep.Ready
            "no_people_link" -> AutomaticAttendanceStep.Blocked(AutomaticAttendanceBlocker.NoPeopleLink)
            "consent_required", "consent_revoked", "disabled" ->
                AutomaticAttendanceStep.Blocked(AutomaticAttendanceBlocker.ConsentMissing)
            "geofence_disabled" ->
                AutomaticAttendanceStep.Blocked(AutomaticAttendanceBlocker.ChurchDisabled)
            "no_campus_configured" ->
                AutomaticAttendanceStep.Blocked(AutomaticAttendanceBlocker.NoCampus)
            "needs_full_accuracy" ->
                AutomaticAttendanceStep.Blocked(AutomaticAttendanceBlocker.ApproximateLocationOnly)
            "needs_background_permission" ->
                AutomaticAttendanceStep.Blocked(AutomaticAttendanceBlocker.NeedsBackgroundPermission)
            "needs_foreground_permission" ->
                AutomaticAttendanceStep.Blocked(AutomaticAttendanceBlocker.ForegroundDenied)
            "play_services_unavailable" ->
                AutomaticAttendanceStep.Blocked(AutomaticAttendanceBlocker.PlayServicesUnavailable)
            "location_unavailable" ->
                AutomaticAttendanceStep.Blocked(AutomaticAttendanceBlocker.LocationServicesOff)
            else -> AutomaticAttendanceStep.Blocked(AutomaticAttendanceBlocker.Unavailable)
        }
    }
}
