package io.faithform.app.ui.church

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import io.faithform.app.contract.ChurchProfile
import io.faithform.app.contract.MobileErrorCode
import io.faithform.app.network.ApiClient
import io.faithform.app.network.ApiException
import io.faithform.app.network.MobileSuccess
import io.faithform.app.network.ProjectionCache
import io.faithform.app.storage.CachePartition
import kotlin.coroutines.cancellation.CancellationException
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.receiveAsFlow
import kotlinx.coroutines.launch
import kotlinx.serialization.Serializable

/** Something the Church info page did that the screens around it must follow. */
sealed interface ChurchProfileEvent {
    /** This church is now the account's only church. */
    data object Added : ChurchProfileEvent

    /** The account no longer has a church. */
    data object Removed : ChurchProfileEvent
}

/**
 * One church's page, and the two things a person can do about it: make it
 * their church, or stop having it as their church.
 *
 * Mirrors the iOS `ChurchProfileModel` — same states, same rule that a reply
 * is never trusted as the new truth: after adding, the profile is re-fetched
 * so what is shown is what the server would serve.
 *
 * Cached first, so a church the person has already opened does not flash
 * a skeleton while the network confirms it.
 */
class ChurchProfileViewModel(
    private val api: ApiClient,
    private val cache: ProjectionCache,
    private val slug: String,
    private val partition: CachePartition,
    private val clock: () -> Long = System::currentTimeMillis,
) : ViewModel() {

    private val _phase = MutableStateFlow<ChurchProfilePhase>(ChurchProfilePhase.Loading)
    val phase: StateFlow<ChurchProfilePhase> = _phase.asStateFlow()

    private val _isActing = MutableStateFlow(false)
    val isActing: StateFlow<Boolean> = _isActing.asStateFlow()

    private val _isRefreshing = MutableStateFlow(false)
    val isRefreshing: StateFlow<Boolean> = _isRefreshing.asStateFlow()

    private val _actionError = MutableStateFlow<String?>(null)
    val actionError: StateFlow<String?> = _actionError.asStateFlow()

    /**
     * One-shot outcomes. A channel rather than state, so a rotation cannot
     * replay "added" and navigate twice.
     */
    private val _events = Channel<ChurchProfileEvent>(Channel.BUFFERED)
    val events: Flow<ChurchProfileEvent> = _events.receiveAsFlow()

    private var etag: String? = null

    @Serializable
    private data class RelationshipReply(
        val churchSlug: String? = null,
        val state: String? = null
    )

    fun load() {
        viewModelScope.launch { refresh() }
    }

    /** Pull to refresh: the same fetch, with the indicator held while it runs. */
    fun pullToRefresh() {
        if (_isRefreshing.value) return
        viewModelScope.launch {
            _isRefreshing.value = true
            try {
                refresh()
            } finally {
                _isRefreshing.value = false
            }
        }
    }

    private suspend fun refresh() {
        cache.load(cacheName, partition, ChurchProfile.serializer())?.let { cached ->
            if (cached.isDisplayable(clock())) {
                etag = cached.etag
                _phase.value = ChurchProfilePhase.Loaded(cached.value)
            }
        }
        try {
            val response = api.send(
                path = "api/mobile/v1/churches/$slug/profile",
                serializer = MobileSuccess.serializer(ChurchProfile.serializer()),
                ifNoneMatch = etag,
            )
            if (response.notModified) return
            val profile = response.value ?: return
            etag = response.etag
            cache.store(cacheName, partition, ChurchProfile.serializer(), profile, response.etag)
            _phase.value = ChurchProfilePhase.Loaded(profile)
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (error: ApiException) {
            _phase.value = when {
                // A hidden church and an unknown slug are indistinguishable by
                // design; the app must not imply the difference either.
                error.code == MobileErrorCode.NOT_FOUND -> ChurchProfilePhase.NotFound
                error.retryable -> keepLoadedOr(ChurchProfilePhase.Offline)
                else -> keepLoadedOr(ChurchProfilePhase.Failed(error.displayMessage))
            }
        } catch (error: Exception) {
            _phase.value = keepLoadedOr(ChurchProfilePhase.Offline)
        }
    }

    private val cacheName get() = "profile-$slug"

    private fun keepLoadedOr(fallback: ChurchProfilePhase): ChurchProfilePhase =
        _phase.value as? ChurchProfilePhase.Loaded ?: fallback

    /**
     * Makes this the account's only church — `POST …/follow`. Any other church
     * is released and this one selected, server-side, in the same request.
     */
    fun add() = perform("POST", ChurchProfileEvent.Added)

    /** Leaves the account with no church — `DELETE …/follow`. */
    fun remove() = perform("DELETE", ChurchProfileEvent.Removed)

    private fun perform(method: String, success: ChurchProfileEvent) {
        if (_isActing.value) return
        viewModelScope.launch {
            _isActing.value = true
            _actionError.value = null
            try {
                api.send(
                    path = "api/mobile/v1/churches/$slug/follow",
                    serializer = MobileSuccess.serializer(RelationshipReply.serializer()),
                    method = method
                )
                // After a removal the page is about to be left for first run;
                // re-fetching it could only flash "not found" for a church that
                // is not listed publicly.
                if (success == ChurchProfileEvent.Added) refresh()
                _events.send(success)
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (error: ApiException) {
                _actionError.value = error.displayMessage
            } catch (error: Exception) {
                _actionError.value = ApiException.transport().displayMessage
            } finally {
                _isActing.value = false
            }
        }
    }
}
