package io.faithform.faithful.ui.discovery

import io.faithform.faithful.contract.DiscoveredChurch

/**
 * Where the onboarding flow currently is. Each state is one the contract can
 * actually produce — none of them renders invented content.
 */
sealed interface DiscoveryPhase {
    data object Idle : DiscoveryPhase
    data object Searching : DiscoveryPhase
    data class Results(val churches: List<DiscoveredChurch>, val usedLocation: Boolean) : DiscoveryPhase
    data object Empty : DiscoveryPhase
    data object Offline : DiscoveryPhase
    data class Failed(val message: String) : DiscoveryPhase
}

/**
 * How the person answered the location prompt.
 *
 * `Unavailable` is distinct from `Denied`: a device with location services off
 * system-wide was never asked, and telling someone they declined would be wrong.
 */
enum class LocationAuthorization {
    NOT_DETERMINED, AUTHORIZED_WHEN_IN_USE, DENIED, RESTRICTED, UNAVAILABLE
}

/**
 * Supplies a single foreground fix.
 *
 * Foreground only, and deliberately so: this interface has no way to express a
 * background or always-on request, so no caller can accidentally make one.
 * Prompts 7–8 own automatic-attendance permissions.
 */
interface LocationProvider {
    suspend fun authorizationStatus(): LocationAuthorization
    /** Requests ACCESS_COARSE/FINE_LOCATION while in use. Never background. */
    suspend fun requestWhenInUse(): LocationAuthorization
    /** One fix, for one query. Nothing is retained. */
    suspend fun currentCoordinate(): Pair<Double, Double>
}
