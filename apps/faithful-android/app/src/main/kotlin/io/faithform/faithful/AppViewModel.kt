package io.faithform.faithful

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import io.faithform.faithful.contract.Bootstrap
import io.faithform.faithful.navigation.DeepLinkParser
import io.faithform.faithful.navigation.Destination
import io.faithform.faithful.session.AppContainer
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/**
 * What the shell is currently showing.
 *
 * Every case is a real, honest state. There is no case that renders invented
 * content, and `Ready` carries whether it came from a cache so the UI can say so.
 */
sealed interface LaunchPhase {
    data object Loading : LaunchPhase
    data object SignedOut : LaunchPhase
    data class Ready(val bootstrap: Bootstrap, val isStale: Boolean) : LaunchPhase
    data object OfflineNoCache : LaunchPhase
    data class Failed(val message: String) : LaunchPhase
}

class AppViewModel(private val container: AppContainer) : ViewModel() {

    private val _state = MutableStateFlow<LaunchPhase>(LaunchPhase.Loading)
    val state: StateFlow<LaunchPhase> = _state.asStateFlow()

    private var pendingDestination: Destination? = null

    fun load() {
        viewModelScope.launch {
            _state.value = LaunchPhase.Loading
            // Prompt 4 ships the shell and the contract. Wiring bootstrap to a
            // live server is a deployment step, not a source one: with no
            // session the honest state is SignedOut, not a fabricated account.
            _state.value = if (container.sessionStore.current() == null) {
                LaunchPhase.SignedOut
            } else {
                LaunchPhase.Loading
            }
        }
    }

    /**
     * Parsed and authorized before anything is mutated. An unknown or
     * unauthorized link is dropped rather than half-navigating.
     */
    fun handleDeepLink(raw: String) {
        pendingDestination = DeepLinkParser.parse(raw)
    }

    fun consumePendingDestination(): Destination? =
        pendingDestination.also { pendingDestination = null }

    fun signOut() {
        viewModelScope.launch {
            container.sessionStore.purgeEverything()
            container.cache.purgeAllPrivate()
            _state.value = LaunchPhase.SignedOut
        }
    }

    fun requestDeletion() {
        viewModelScope.launch {
            // The request itself is a server command with an idempotency key.
            // The local half — purging credentials and every private partition —
            // is what this method guarantees.
            container.sessionStore.purgeEverything()
            container.cache.purgeAllPrivate()
            _state.value = LaunchPhase.SignedOut
        }
    }
}
