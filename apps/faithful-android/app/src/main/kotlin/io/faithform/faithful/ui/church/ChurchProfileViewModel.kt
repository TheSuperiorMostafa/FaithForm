package io.faithform.faithful.ui.church

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import io.faithform.faithful.contract.ChurchProfile
import io.faithform.faithful.contract.MobileErrorCode
import io.faithform.faithful.network.ApiClient
import io.faithform.faithful.network.ApiException
import io.faithform.faithful.network.MobileSuccess
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.serialization.Serializable

/**
 * One church's public profile, and the actions a relationship allows.
 *
 * Mirrors the iOS `ChurchProfileModel` — same states, same rule that a reply
 * is never trusted as the new truth: after any action the profile is
 * re-fetched so what is shown is what the server would serve.
 */
class ChurchProfileViewModel(
    private val api: ApiClient,
    private val slug: String
) : ViewModel() {

    private val _phase = MutableStateFlow<ChurchProfilePhase>(ChurchProfilePhase.Loading)
    val phase: StateFlow<ChurchProfilePhase> = _phase.asStateFlow()

    private val _isActing = MutableStateFlow(false)
    val isActing: StateFlow<Boolean> = _isActing.asStateFlow()

    private val _actionError = MutableStateFlow<String?>(null)
    val actionError: StateFlow<String?> = _actionError.asStateFlow()

    @Serializable
    private data class RelationshipReply(
        val churchSlug: String? = null,
        val state: String? = null
    )

    fun load() {
        viewModelScope.launch { refresh() }
    }

    private suspend fun refresh() {
        try {
            val response = api.send(
                path = "api/mobile/v1/churches/$slug/profile",
                serializer = MobileSuccess.serializer(ChurchProfile.serializer())
            )
            response.value?.let { _phase.value = ChurchProfilePhase.Loaded(it) }
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

    private fun keepLoadedOr(fallback: ChurchProfilePhase): ChurchProfilePhase =
        _phase.value as? ChurchProfilePhase.Loaded ?: fallback

    fun follow() = perform("api/mobile/v1/churches/$slug/follow", "POST")
    fun requestJoin() = perform("api/mobile/v1/churches/$slug/join", "POST")
    fun leave() = perform("api/mobile/v1/churches/$slug/follow", "DELETE")

    private fun perform(path: String, method: String) {
        viewModelScope.launch {
            _isActing.value = true
            _actionError.value = null
            try {
                api.send(
                    path = path,
                    serializer = MobileSuccess.serializer(RelationshipReply.serializer()),
                    method = method
                )
                refresh()
            } catch (error: ApiException) {
                _actionError.value = error.displayMessage
            } catch (error: Exception) {
                _actionError.value = null
            } finally {
                _isActing.value = false
            }
        }
    }
}
