package io.faithform.faithful.ui.discovery

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import io.faithform.faithful.contract.DiscoveryPage
import io.faithform.faithful.network.ApiClient
import io.faithform.faithful.network.ApiException
import io.faithform.faithful.network.MobileSuccess
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.serialization.builtins.serializer
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/**
 * Mirrors the iOS DiscoveryModel's behaviour exactly — arrived at from the same
 * specification, not shared code.
 */
class DiscoveryViewModel(
    private val api: ApiClient,
    private val location: LocationProvider
) : ViewModel() {

    private val _phase = MutableStateFlow<DiscoveryPhase>(DiscoveryPhase.Idle)
    val phase: StateFlow<DiscoveryPhase> = _phase.asStateFlow()

    private val _locationAuthorization = MutableStateFlow(LocationAuthorization.NOT_DETERMINED)
    val locationAuthorization: StateFlow<LocationAuthorization> = _locationAuthorization.asStateFlow()

    /** True once the education screen has been seen. The OS is never asked first. */
    private val _hasSeenLocationEducation = MutableStateFlow(false)
    val hasSeenLocationEducation: StateFlow<Boolean> = _hasSeenLocationEducation.asStateFlow()

    private val _query = MutableStateFlow("")
    val query: StateFlow<String> = _query.asStateFlow()

    fun updateQuery(value: String) { _query.value = value }

    /** Manual search. Requires no location permission at all. */
    fun search() {
        viewModelScope.launch {
            _phase.value = DiscoveryPhase.Searching
            runCatching {
                api.send(
                    path = "api/mobile/v1/churches/search",
                    serializer = MobileSuccess.serializer(DiscoveryPage.serializer()),
                    query = _query.value.trim().takeIf { it.isNotEmpty() }
                        ?.let { mapOf("q" to it) } ?: emptyMap(),
                    authenticated = false
                )
            }.onSuccess { result ->
                val items = result.value?.items.orEmpty()
                _phase.value = if (items.isEmpty()) DiscoveryPhase.Empty
                else DiscoveryPhase.Results(items, usedLocation = false)
            }.onFailure { error ->
                _phase.value = classify(error)
            }
        }
    }

    /**
     * Shows the education screen. The runtime permission dialog comes only from
     * [confirmNearby], after an explicit tap.
     */
    fun beginNearbyFlow() {
        viewModelScope.launch {
            _hasSeenLocationEducation.value = true
            _locationAuthorization.value = location.authorizationStatus()
        }
    }

    fun confirmNearby() {
        viewModelScope.launch {
            val status = location.requestWhenInUse()
            _locationAuthorization.value = status

            if (status != LocationAuthorization.AUTHORIZED_WHEN_IN_USE) {
                // Declining is a first-class outcome: fall back to manual search
                // rather than leaving the person at a dead end.
                search()
                return@launch
            }

            _phase.value = DiscoveryPhase.Searching
            runCatching {
                val (latitude, longitude) = location.currentCoordinate()
                api.send(
                    path = "api/mobile/v1/churches/nearby",
                    serializer = MobileSuccess.serializer(DiscoveryPage.serializer()),
                    method = "POST",
                    // In a body, never a query string: coordinates in a URL end
                    // up in access logs and Referer headers.
                    body = Json.encodeToString(
                        JsonObject.serializer(),
                        buildJsonObject {
                            put("latitude", latitude)
                            put("longitude", longitude)
                            put("radiusKm", 40.0)
                            put("limit", 20)
                        }
                    ),
                    authenticated = false
                )
            }.onSuccess { result ->
                val items = result.value?.items.orEmpty()
                _phase.value = if (items.isEmpty()) DiscoveryPhase.Empty
                else DiscoveryPhase.Results(items, usedLocation = true)
            }.onFailure { error ->
                _phase.value = classify(error)
            }
        }
    }

    private fun classify(error: Throwable): DiscoveryPhase = when {
        error is ApiException && error.retryable -> DiscoveryPhase.Offline
        error is ApiException -> DiscoveryPhase.Failed(error.displayMessage)
        else -> DiscoveryPhase.Offline
    }
}
