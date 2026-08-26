package io.faithform.faithful.attendance

/**
 * The location permission states this app distinguishes.
 *
 * Android's model is genuinely different from iOS's and is **not** forced into
 * the same shape. Two differences matter enough to be modelled explicitly:
 *
 *  - Foreground and background are **separate runtime permissions**
 *    (`ACCESS_FINE_LOCATION` and `ACCESS_BACKGROUND_LOCATION`), not one
 *    escalating grant.
 *  - Precision is a **separate axis**: a person may grant
 *    `ACCESS_COARSE_LOCATION` only, which is city-block accurate and cannot
 *    resolve a campus.
 */
enum class ForegroundLocationPermission {
    /** Never asked, or asked and dismissed without answering. */
    NotRequested,

    /** `ACCESS_FINE_LOCATION` granted. */
    Fine,

    /**
     * `ACCESS_COARSE_LOCATION` only.
     *
     * Android 12 added the precise/approximate choice to the same dialog, so
     * this is a normal answer rather than an edge case. Geofences registered
     * under coarse-only permission are unreliable and a campus radius is far
     * below the error, so this is treated as its own blocked state with its own
     * recovery, not as a denial.
     */
    Coarse,

    /** Declined. Recoverable by asking again, or in Settings. */
    Denied,

    /**
     * Declined with "Don't ask again", or restricted by policy.
     *
     * `shouldShowRequestPermissionRationale` returning false after a denial is
     * how this is detected. Asking again does nothing, so the only honest
     * action is a Settings link.
     */
    PermanentlyDenied,
}

/** `ACCESS_BACKGROUND_LOCATION`, which is what actually delivers geofence events. */
enum class BackgroundLocationPermission {
    NotRequested,
    Granted,
    Denied,
    PermanentlyDenied,

    /**
     * Below API 29 there is no separate background permission — foreground
     * location implies it. Modelling this rather than pretending the permission
     * exists keeps the API 26–28 branch honest.
     */
    NotApplicable,
}

/**
 * How background location must be requested on this API level.
 *
 * The split is real and is the single most-often-wrong part of Android
 * geofencing:
 *
 *  - **API < 29**: no such permission. Foreground location is enough.
 *  - **API 29 (Android 10)**: `ACCESS_BACKGROUND_LOCATION` can be requested at
 *    runtime, and the system dialog offers "Allow all the time".
 *  - **API 30+ (Android 11+)**: the runtime dialog **does not** offer
 *    "Allow all the time". The request opens no useful dialog; the person must
 *    enable it on a Settings page. An app that just calls `requestPermissions`
 *    here appears to do nothing.
 *
 * Source: developer.android.com/develop/sensors-and-location/location/permissions/background
 * — "On Android 11 (API level 30) and higher, however, the system dialog
 * doesn't include the Allow all the time option. Instead, users must enable
 * background location on a settings page."
 */
enum class BackgroundRequestStrategy {
    /** API < 29. Nothing to request. */
    ImpliedByForeground,

    /** API 29. A runtime request shows a dialog that can grant it. */
    RuntimeDialog,

    /** API 30+. Educate, then send the person to Settings. */
    SettingsOnly;

    companion object {
        fun forSdk(sdkInt: Int): BackgroundRequestStrategy = when {
            sdkInt < 29 -> ImpliedByForeground
            sdkInt == 29 -> RuntimeDialog
            else -> SettingsOnly
        }
    }
}

/**
 * Everything the feature needs to know about permissions, in one snapshot.
 */
data class LocationPermissionState(
    val foreground: ForegroundLocationPermission,
    val background: BackgroundLocationPermission,
    val strategy: BackgroundRequestStrategy,
    /** Location switched off device-wide. Distinct from this app being denied. */
    val locationServicesEnabled: Boolean = true,
    /** Play services present and usable. Geofencing is unavailable without it. */
    val playServicesAvailable: Boolean = true,
) {
    /**
     * Whether the OS will actually deliver geofence transitions.
     *
     * All four conditions, because any one of them failing produces a feature
     * that registers successfully and then never fires — which is worse than
     * one that refuses honestly.
     */
    val canMonitorGeofences: Boolean
        get() = locationServicesEnabled &&
            playServicesAvailable &&
            foreground == ForegroundLocationPermission.Fine &&
            (background == BackgroundLocationPermission.Granted ||
                background == BackgroundLocationPermission.NotApplicable)

    /**
     * Whether foreground must be resolved before background is even asked.
     *
     * Android requires foreground location first; requesting background without
     * it is rejected outright. Modelled so the ordering is a property of the
     * type rather than a comment in a view.
     */
    val needsForegroundFirst: Boolean
        get() = foreground != ForegroundLocationPermission.Fine
}

/**
 * The permission surface, abstracted from `ActivityCompat` and the Android
 * framework.
 *
 * Behind an interface so every branch — Android 10 versus 11+, coarse-only,
 * permanently denied, Play services missing — is exercised by
 * `gradle :core:attendance:test` on a plain JVM with no emulator.
 */
interface LocationPermissions {
    suspend fun current(): LocationPermissionState

    /** Raises the foreground runtime prompt. Never called at launch. */
    suspend fun requestForeground(): LocationPermissionState

    /**
     * Requests background location.
     *
     * On API 30+ this cannot grant anything — the caller must send the person
     * to Settings — so implementations return the unchanged state rather than
     * pretending a dialog appeared.
     */
    suspend fun requestBackground(): LocationPermissionState
}
