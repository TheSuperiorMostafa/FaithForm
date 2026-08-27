package io.faithform.faithful

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import io.faithform.faithful.contract.Bootstrap
import io.faithform.faithful.contract.MobileErrorCode
import io.faithform.faithful.contract.OnboardingState
import io.faithform.faithful.navigation.DeepLinkParser
import io.faithform.faithful.navigation.Destination
import io.faithform.faithful.navigation.InvitationLink
import io.faithform.faithful.network.ApiClient
import io.faithform.faithful.network.ApiException
import io.faithform.faithful.network.MobileSuccess
import io.faithform.faithful.network.SupabaseSession
import io.faithform.faithful.session.SessionGateway
import io.faithform.faithful.session.StoredSession
import io.faithform.faithful.storage.PartitionedCache
import java.util.UUID
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/**
 * What the shell is currently showing.
 *
 * Every case is a real, honest state. There is no case that renders invented
 * content, and `Ready` carries whether it came from a cache so the UI can say so.
 */
sealed interface LaunchPhase {
    data object Loading : LaunchPhase
    data object SignedOut : LaunchPhase

    /**
     * Signed in with no active church relationship. Decided by the **server**
     * (`GET /onboarding`), never inferred here from an empty list, so both
     * platforms agree on the rule.
     */
    data class Onboarding(val bootstrap: Bootstrap) : LaunchPhase
    data class Ready(val bootstrap: Bootstrap, val isStale: Boolean) : LaunchPhase
    data object OfflineNoCache : LaunchPhase
    data class Failed(val message: String) : LaunchPhase
}

/** Where invitation redemption currently stands, for the entry screen. */
sealed interface InvitationPhase {
    data object Idle : InvitationPhase
    data object Working : InvitationPhase
    data class Failed(val code: MobileErrorCode?) : InvitationPhase
}

class AppViewModel(
    private val api: ApiClient,
    private val sessions: SessionGateway,
    private val cache: PartitionedCache,
    private val environmentKey: String
) : ViewModel() {

    private val _state = MutableStateFlow<LaunchPhase>(LaunchPhase.Loading)
    val state: StateFlow<LaunchPhase> = _state.asStateFlow()

    private val _invitationPhase = MutableStateFlow<InvitationPhase>(InvitationPhase.Idle)
    val invitationPhase: StateFlow<InvitationPhase> = _invitationPhase.asStateFlow()

    /**
     * A token that arrived — by deep link or paste — before it could be used.
     * Held in memory across sign-in and posted only afterwards; an invitation
     * is not worth persisting past the launch that received it.
     */
    private val _pendingInvitationToken = MutableStateFlow<String?>(null)
    val pendingInvitationToken: StateFlow<String?> = _pendingInvitationToken.asStateFlow()

    private var onboardingState: OnboardingState? = null
    private var pendingDestination: Destination? = null

    /**
     * One idempotency key per token, stable across retries of the same
     * attempt. A single-use invitation must not be burned by a retry that
     * never saw its response.
     */
    private val idempotencyKeys = mutableMapOf<String, String>()

    private val json = Json { ignoreUnknownKeys = true }

    fun load() {
        viewModelScope.launch { loadNow(quiet = false) }
    }

    /** Refreshes in place after something changed — a join, an accepted
     * invitation — without collapsing the UI back to a spinner first. */
    fun reloadQuietly() {
        viewModelScope.launch { loadNow(quiet = true) }
    }

    private suspend fun loadNow(quiet: Boolean) {
        if (!quiet) _state.value = LaunchPhase.Loading

        if (sessions.current() == null) {
            _state.value = LaunchPhase.SignedOut
            return
        }

        try {
            val response = api.send(
                path = "api/mobile/v1/account/bootstrap",
                serializer = MobileSuccess.serializer(Bootstrap.serializer())
            )
            val bootstrap = response.value ?: run {
                _state.value = LaunchPhase.OfflineNoCache
                return
            }

            // First authenticated use with no recorded policy versions: the
            // person accepted them a moment ago, on the account screen that
            // said so. Recording is stating a fact, not deciding one.
            recordInitialConsent(bootstrap)

            // The server decides whether first-run stands in front of home. A
            // failure falls back to home — a dead app over a routing hint
            // would be the worse failure.
            onboardingState = fetchOnboardingState()

            _state.value = if (onboardingState?.needsOnboarding == true) {
                LaunchPhase.Onboarding(bootstrap)
            } else {
                LaunchPhase.Ready(bootstrap, isStale = false)
            }
        } catch (error: ApiException) {
            _state.value = when {
                error.code == MobileErrorCode.UNAUTHENTICATED ||
                    error.code == MobileErrorCode.SESSION_EXPIRED -> LaunchPhase.SignedOut
                error.retryable -> LaunchPhase.OfflineNoCache
                else -> LaunchPhase.Failed(error.displayMessage)
            }
        } catch (error: Exception) {
            _state.value = LaunchPhase.OfflineNoCache
        }
    }

    private suspend fun fetchOnboardingState(): OnboardingState? = runCatching {
        api.send(
            path = "api/mobile/v1/onboarding",
            serializer = MobileSuccess.serializer(OnboardingState.serializer())
        ).value
    }.getOrNull()

    private suspend fun recordInitialConsent(bootstrap: Bootstrap) {
        if (bootstrap.profile.termsVersion != null &&
            bootstrap.profile.privacyVersion != null
        ) {
            return
        }

        @Serializable
        data class ConsentReply(val termsVersion: String? = null)

        runCatching {
            api.send(
                path = "api/mobile/v1/account/consent",
                serializer = MobileSuccess.serializer(ConsentReply.serializer()),
                method = "POST",
                body = json.encodeToString(
                    kotlinx.serialization.json.JsonObject.serializer(),
                    buildJsonObject {
                        put("termsVersion", bootstrap.requiredTermsVersion)
                        put("privacyVersion", bootstrap.requiredPrivacyVersion)
                    }
                )
            )
        }
    }

    /**
     * A fresh sign-in or account. Adopting the session is what flips every
     * subsequent request from anonymous to authenticated; everything after is
     * ordinary loading.
     */
    fun completeAuth(session: SupabaseSession, displayName: String?) {
        viewModelScope.launch {
            sessions.adopt(
                StoredSession(
                    accessToken = session.accessToken,
                    refreshToken = session.refreshToken,
                    expiresAtMillis = System.currentTimeMillis() + session.expiresInSeconds * 1000,
                    accountId = session.accountId,
                    environmentKey = environmentKey
                )
            )

            if (!displayName.isNullOrBlank()) {
                @Serializable
                data class ProfileReply(val displayName: String? = null)
                // Best-effort: the name can be set again later, and failing
                // sign-in over it would be absurd.
                runCatching {
                    api.send(
                        path = "api/mobile/v1/account/profile",
                        serializer = MobileSuccess.serializer(ProfileReply.serializer()),
                        method = "PATCH",
                        body = json.encodeToString(
                            kotlinx.serialization.json.JsonObject.serializer(),
                            buildJsonObject { put("displayName", displayName.trim()) }
                        )
                    )
                }
            }

            // A deep-linked invitation held across sign-in is redeemed the
            // moment it can be — before the first bootstrap, so the church it
            // grants is already there when the app first renders.
            _pendingInvitationToken.value?.let { acceptInvitationNow(it) }

            loadNow(quiet = false)
        }
    }

    /**
     * Parsed and authorized before anything is mutated. An invitation is a
     * credential, not a destination: signed out it is held for after sign-in,
     * signed in it is redeemed on the spot. Every other link is an unknown or
     * a destination, and an unknown is dropped rather than half-navigated.
     */
    fun handleDeepLink(raw: String) {
        val token = InvitationLink.token(raw)
        if (token != null) {
            _pendingInvitationToken.value = token
            if (sessions.current() != null) {
                viewModelScope.launch {
                    if (acceptInvitationNow(token)) loadNow(quiet = true)
                }
            }
            return
        }
        pendingDestination = DeepLinkParser.parse(raw)
    }

    fun consumePendingDestination(): Destination? =
        pendingDestination.also { pendingDestination = null }

    /** Redeems what a person pasted — a bare token or the full link. */
    fun acceptInvitation(raw: String) {
        viewModelScope.launch {
            if (acceptInvitationNow(normalizeInvitation(raw))) loadNow(quiet = true)
        }
    }

    fun normalizeInvitation(raw: String): String {
        val trimmed = raw.trim()
        InvitationLink.token(trimmed)?.let { return it }
        if ("/" in trimmed) {
            val last = trimmed.substringAfterLast('/')
            if (last.length >= 16) return last
        }
        return trimmed
    }

    private suspend fun acceptInvitationNow(raw: String): Boolean {
        val token = normalizeInvitation(raw)
        if (token.length < 16 || token.length > 512) {
            _invitationPhase.value = InvitationPhase.Failed(MobileErrorCode.INVALID_REQUEST)
            return false
        }

        @Serializable
        data class AcceptReply(val churchSlug: String? = null, val state: String? = null)

        _invitationPhase.value = InvitationPhase.Working
        return try {
            api.send(
                path = "api/mobile/v1/invitations/accept",
                serializer = MobileSuccess.serializer(AcceptReply.serializer()),
                method = "POST",
                body = json.encodeToString(
                    kotlinx.serialization.json.JsonObject.serializer(),
                    buildJsonObject { put("token", token) }
                ),
                idempotencyKey = idempotencyKeys.getOrPut(token) { UUID.randomUUID().toString() }
            )
            _invitationPhase.value = InvitationPhase.Idle
            if (_pendingInvitationToken.value == token) _pendingInvitationToken.value = null
            true
        } catch (error: ApiException) {
            _invitationPhase.value = InvitationPhase.Failed(error.code)
            false
        } catch (error: Exception) {
            _invitationPhase.value = InvitationPhase.Failed(MobileErrorCode.UNAVAILABLE)
            false
        }
    }

    fun clearInvitationError() {
        if (_invitationPhase.value is InvitationPhase.Failed) {
            _invitationPhase.value = InvitationPhase.Idle
        }
    }

    fun signOut() {
        viewModelScope.launch {
            // The server side first, best-effort: it bumps the authorization
            // version so anything cached against the old one is detectably
            // stale everywhere, not just on this device.
            @Serializable
            data class SignOutReply(val signedOut: Boolean = false)
            runCatching {
                api.send(
                    path = "api/mobile/v1/account/sign-out",
                    serializer = MobileSuccess.serializer(SignOutReply.serializer()),
                    method = "POST"
                )
            }

            sessions.purgeEverything()
            cache.purgeAllPrivate()
            onboardingState = null
            _pendingInvitationToken.value = null
            _invitationPhase.value = InvitationPhase.Idle
            _state.value = LaunchPhase.SignedOut
        }
    }

    fun requestDeletion() {
        viewModelScope.launch {
            // The server command first, so the deletion request actually
            // exists; then the local half — purging credentials and every
            // private partition — which this method guarantees regardless.
            @Serializable
            data class RequestReply(val id: String? = null)
            runCatching {
                api.send(
                    path = "api/mobile/v1/account/requests",
                    serializer = MobileSuccess.serializer(RequestReply.serializer()),
                    method = "POST",
                    body = json.encodeToString(
                        kotlinx.serialization.json.JsonObject.serializer(),
                        buildJsonObject { put("kind", "deletion") }
                    ),
                    idempotencyKey = UUID.randomUUID().toString()
                )
            }

            sessions.purgeEverything()
            cache.purgeAllPrivate()
            _state.value = LaunchPhase.SignedOut
        }
    }
}
