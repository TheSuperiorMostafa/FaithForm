package io.faithform.app.ui.discovery

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import io.faithform.app.contract.DiscoveryPage
import io.faithform.app.network.ApiClient
import io.faithform.app.network.ApiException
import io.faithform.app.network.MobileSuccess
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.launch
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import java.util.concurrent.atomic.AtomicInteger

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

    private val typedQueries = MutableSharedFlow<String>(
        extraBufferCapacity = 1,
        onBufferOverflow = kotlinx.coroutines.channels.BufferOverflow.DROP_OLDEST,
    )
    private val searchGeneration = AtomicInteger(0)
    private var loadedQuery: String? = null
    private var nearbyJob: Job? = null

    init {
        viewModelScope.launch { observeSearch() }
    }

    fun updateQuery(value: String) {
        _query.value = value
        typedQueries.tryEmit(value)
    }

    /**
     * Turns typing into requests, for as long as the ViewModel lives. Matches
     * sermon-archive debounce so discovery feels the same as Notes search.
     */
    private suspend fun observeSearch() {
        typedQueries.collectLatest { term ->
            val trimmed = term.trim()
            if (trimmed.isEmpty()) {
                loadedQuery = null
                _phase.value = DiscoveryPhase.Idle
                return@collectLatest
            }
            if (trimmed == loadedQuery && _phase.value is DiscoveryPhase.Results) {
                return@collectLatest
            }
            delay(SEARCH_DEBOUNCE_MILLIS)
            searchNow(trimmed, allowEmpty = false)
        }
    }

    /** Manual search (IME submit). Requires no location permission at all. */
    fun search() {
        nearbyJob?.cancel()
        viewModelScope.launch {
            searchNow(_query.value.trim(), allowEmpty = true)
        }
    }

    private suspend fun searchNow(trimmed: String, allowEmpty: Boolean) {
        // Live typing with nothing left goes idle. An explicit submit (or the
        // "denied location → fall back to search" path) may still ask the API
        // with an empty query for a default list.
        if (trimmed.isEmpty() && !allowEmpty) {
            loadedQuery = null
            _phase.value = DiscoveryPhase.Idle
            return
        }

        val mine = searchGeneration.incrementAndGet()
        _phase.value = DiscoveryPhase.Searching
        try {
            val result = api.send(
                path = "api/mobile/v1/churches/search",
                serializer = MobileSuccess.serializer(DiscoveryPage.serializer()),
                query = trimmed.takeIf { it.isNotEmpty() }?.let { mapOf("q" to it) } ?: emptyMap(),
                authenticated = false
            )
            if (mine != searchGeneration.get()) return
            val items = result.value?.items.orEmpty()
            loadedQuery = trimmed
            _phase.value = if (items.isEmpty()) DiscoveryPhase.Empty
            else DiscoveryPhase.Results(items, usedLocation = false)
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (error: Exception) {
            if (mine != searchGeneration.get()) return
            loadedQuery = null
            _phase.value = classify(error)
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
        nearbyJob?.cancel()
        nearbyJob = viewModelScope.launch {
            val status = location.requestWhenInUse()
            _locationAuthorization.value = status

            if (status != LocationAuthorization.AUTHORIZED_WHEN_IN_USE) {
                // Declining is a first-class outcome: fall back to manual search
                // rather than leaving the person at a dead end.
                searchNow(_query.value.trim(), allowEmpty = true)
                return@launch
            }

            val mine = searchGeneration.incrementAndGet()
            _phase.value = DiscoveryPhase.Searching
            try {
                val (latitude, longitude) = location.currentCoordinate()
                val result = api.send(
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
                if (mine != searchGeneration.get()) return@launch
                loadedQuery = null
                val items = result.value?.items.orEmpty()
                _phase.value = if (items.isEmpty()) DiscoveryPhase.Empty
                else DiscoveryPhase.Results(items, usedLocation = true)
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (error: Exception) {
                if (mine != searchGeneration.get()) return@launch
                _phase.value = classify(error)
            }
        }
    }

    private fun classify(error: Throwable): DiscoveryPhase = when {
        error is ApiException && error.retryable -> DiscoveryPhase.Offline
        error is ApiException -> DiscoveryPhase.Failed(error.displayMessage)
        else -> DiscoveryPhase.Offline
    }

    companion object {
        const val SEARCH_DEBOUNCE_MILLIS = 300L
    }
}
