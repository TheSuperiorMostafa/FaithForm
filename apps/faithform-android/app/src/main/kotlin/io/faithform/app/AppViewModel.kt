package io.faithform.app

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import io.faithform.app.contract.AccountActionRequest
import io.faithform.app.contract.AccountRequest
import io.faithform.app.contract.AccountRequestKind
import io.faithform.app.contract.Bootstrap
import io.faithform.app.contract.ChurchProfile
import io.faithform.app.contract.InvitationPreview
import io.faithform.app.contract.MobileErrorCode
import io.faithform.app.contract.OnboardingState
import io.faithform.app.contract.SelectChurchRequest
import io.faithform.app.contract.SelectedChurch
import io.faithform.app.host.HostNavigation
import io.faithform.app.host.HostTab
import io.faithform.app.navigation.AuthCallbackLink
import io.faithform.app.navigation.DeepLinkParser
import io.faithform.app.navigation.Destination
import io.faithform.app.navigation.InvitationLink
import io.faithform.app.navigation.RouteRegistry
import io.faithform.app.storage.CachePartition
import kotlinx.coroutines.flow.Flow
import io.faithform.app.network.ApiClient
import io.faithform.app.network.ApiException
import io.faithform.app.network.AuthException
import io.faithform.app.network.MobileSuccess
import io.faithform.app.network.SupabaseAuthClient
import io.faithform.app.network.SupabaseSession
import io.faithform.app.session.AccountSnapshot
import io.faithform.app.session.AccountSnapshotStore
import io.faithform.app.session.SessionGateway
import io.faithform.app.session.StoredSession
import io.faithform.app.storage.PartitionedCache
import io.faithform.app.ui.auth.AuthUiError
import io.faithform.app.ui.auth.authUiError
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

/** Where an email-confirmation callback currently stands, for the front door. */
sealed interface ConfirmationPhase {
    data object Idle : ConfirmationPhase
    data object Working : ConfirmationPhase
    data class Failed(val error: AuthUiError) : ConfirmationPhase
}

/**
 * Where a request to delete the account stands.
 *
 * Google Play requires that an account can be deleted from inside the app, and
 * the previous version of this flow deleted on a single tap, ignored what the
 * server said, and signed the person out as though it had worked either way. A
 * person whose request never reached FaithForm was told nothing and left
 * believing their data was gone.
 *
 * So: nothing is sent until the person has read what happens and confirmed
 * ([Confirming]); the local session is cleared only once the server has
 * recorded the request; and a failure is shown in the dialog with the account
 * still signed in, so they can try again.
 */
sealed interface DeletionPhase {
    data object Idle : DeletionPhase
    data object Confirming : DeletionPhase
    data object Working : DeletionPhase
    /** [message] is the server's own sentence when it gave one; null means it was never reached. */
    data class Failed(val message: String?) : DeletionPhase
}

/**
 * A church identified *before* sign-in.
 *
 * This is what makes the signed-out screens say "Join Grace Community" over the
 * right logo instead of naming the product to someone who came for their
 * church. It arrives from a link — an invitation, or a plain church link — and
 * is resolved against the server, never taken from the URL itself: a link may
 * say which church, and may not say what that church is called.
 *
 * [invitationToken] is present only when the context came from an invitation,
 * and the distinction decides what happens after sign-in. A token is consent
 * already given — the person was invited and tapped the link — so it is
 * redeemed and the relationship exists. A slug carries no authority at all: it
 * opens the church's own screen and lets the person choose, which is the
 * difference between arriving somewhere and being enrolled in it.
 */
data class PendingChurchContext(
    val churchSlug: String,
    val churchName: String,
    val logoUrl: String?,
    val invitationToken: String?
) {
    val isInvitation: Boolean get() = invitationToken != null
}

class AppViewModel(
    private val api: ApiClient,
    private val sessions: SessionGateway,
    private val cache: PartitionedCache,
    private val environmentKey: String,
    private val auth: SupabaseAuthClient? = null,
    /**
     * The same registry `MainActivity` builds, so a deep link and a tab are
     * held to one set of rules. Defaults to the minimum a test needs.
     */
    val registry: RouteRegistry = RouteRegistry(),
    /**
     * Fires whenever any request discovers the session has ended — a 401 from
     * any screen, or a refresh token the identity provider refused. Emitted by
     * `ApiClient` through the container, collected once here.
     */
    sessionEnded: Flow<Unit>? = null,
    private val snapshots: AccountSnapshotStore = AccountSnapshotStore(),
) : ViewModel() {

    private val _state = MutableStateFlow<LaunchPhase>(LaunchPhase.Loading)
    val state: StateFlow<LaunchPhase> = _state.asStateFlow()

    private val _confirmationPhase = MutableStateFlow<ConfirmationPhase>(ConfirmationPhase.Idle)
    val confirmationPhase: StateFlow<ConfirmationPhase> = _confirmationPhase.asStateFlow()

    /** Codes already exchanged (or refused as spent) this launch. The OS can
     * deliver the same intent more than once; a consumed code must be a
     * no-op, never a second exchange. */
    private val consumedCodes = mutableSetOf<String>()

    private val _invitationPhase = MutableStateFlow<InvitationPhase>(InvitationPhase.Idle)
    val invitationPhase: StateFlow<InvitationPhase> = _invitationPhase.asStateFlow()

    /**
     * A token that arrived — by deep link or paste — before it could be used.
     * Held in memory across sign-in and posted only afterwards; an invitation
     * is not worth persisting past the launch that received it.
     */
    private val _pendingInvitationToken = MutableStateFlow<String?>(null)
    val pendingInvitationToken: StateFlow<String?> = _pendingInvitationToken.asStateFlow()

    /**
     * The church this launch is *about*, when a link named one. Held beside the
     * token rather than inside it because a church link carries a context with
     * no token at all.
     */
    private val _churchContext = MutableStateFlow<PendingChurchContext?>(null)
    val churchContext: StateFlow<PendingChurchContext?> = _churchContext.asStateFlow()

    /**
     * The church the church-scoped tabs are about. Chosen by
     * [HostNavigation.adoptSelection] after every bootstrap, and by the person
     * from the Church tab.
     */
    private val _selectedChurchSlug = MutableStateFlow<String?>(null)
    val selectedChurchSlug: StateFlow<String?> = _selectedChurchSlug.asStateFlow()

    private val _selectedTab = MutableStateFlow(HostTab.HOME)
    val selectedTab: StateFlow<HostTab> = _selectedTab.asStateFlow()

    /**
     * True while a request to show sermon notes waits for the Church tab — set
     * by a `faithform://church/<slug>/sermons` link or the entry on Home, after
     * the church is selected, and consumed once by the tab. The Church tab's
     * own sub-page is UI state, so this is how anything outside it asks.
     */
    private val _sermonsRequested = MutableStateFlow(false)
    val sermonsRequested: StateFlow<Boolean> = _sermonsRequested.asStateFlow()

    private val _deletion = MutableStateFlow<DeletionPhase>(DeletionPhase.Idle)
    val deletion: StateFlow<DeletionPhase> = _deletion.asStateFlow()

    /**
     * True from the moment a deletion request is recorded until the person has
     * read, on the sign-in screen, that they were signed out because of it.
     */
    private val _deletionRequested = MutableStateFlow(false)
    val deletionRequested: StateFlow<Boolean> = _deletionRequested.asStateFlow()

    fun dismissDeletionNotice() {
        _deletionRequested.value = false
    }

    /**
     * One idempotency key per confirmed deletion, kept across retries so a
     * request whose response was lost joins the one the server already recorded
     * instead of opening a second.
     */
    private var deletionKey: String? = null

    private var onboardingState: OnboardingState? = null
    private var pendingDestination: Destination? = null
    private var lastBootstrap: Bootstrap? = null

    init {
        when (val session = sessions.current()) {
            null -> _state.value = LaunchPhase.SignedOut
            else -> snapshots.load(environmentKey, session.accountId)?.let { applyCached(it) }
        }
        sessionEnded?.let { events ->
            viewModelScope.launch { events.collect { handleSessionEnded() } }
        }
    }

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

    private var started = false

    /**
     * The first load of this view model's life. An Activity recreated by a
     * rotation calls this again and gets nothing: the state it needs is
     * already here, and a second bootstrap would flash the spinner for no
     * reason.
     */
    fun start() {
        if (started) return
        started = true
        load()
    }

    /** Refreshes in place after something changed — a join, an accepted
     * invitation — without collapsing the UI back to a spinner first. */
    fun reloadQuietly() {
        viewModelScope.launch { loadNow(quiet = true) }
    }

    private suspend fun loadNow(quiet: Boolean) {
        val session = sessions.current()
        if (session == null) {
            _state.value = LaunchPhase.SignedOut
            return
        }

        if (!quiet) {
            when (_state.value) {
                is LaunchPhase.Ready, is LaunchPhase.Onboarding -> Unit
                else -> {
                    val cached = snapshots.load(environmentKey, session.accountId)
                    // The brand dwell lives in `FaithFormApp`, not here: a
                    // returning visit must still restore Home before the
                    // network answers.
                    if (cached != null) applyCached(cached) else _state.value = LaunchPhase.Loading
                }
            }
        }

        val previous = lastBootstrap
            ?: snapshots.load(environmentKey, session.accountId)?.bootstrap

        try {
            val response = api.send(
                path = "api/mobile/v1/account/bootstrap",
                serializer = MobileSuccess.serializer(Bootstrap.serializer())
            )
            val bootstrap = response.value ?: run {
                showOffline(previous)
                return
            }

            lastBootstrap = bootstrap

            // First authenticated use with no recorded policy versions: the
            // person accepted them a moment ago, on the account screen that
            // said so. Recording is stating a fact, not deciding one.
            recordInitialConsent(bootstrap)

            // The server decides whether first-run stands in front of home. A
            // failure falls back to home — a dead app over a routing hint
            // would be the worse failure.
            onboardingState = fetchOnboardingState()

            snapshots.store(
                AccountSnapshot(
                    bootstrap = bootstrap,
                    onboarding = onboardingState,
                    storedAtMillis = System.currentTimeMillis(),
                ),
                environmentKey,
                session.accountId,
            )

            _selectedChurchSlug.value = HostNavigation.adoptSelection(
                bootstrap = bootstrap,
                serverPreference = onboardingState?.selectedChurchSlug
                    ?: bootstrap.profile.selectedChurchSlug,
                current = _selectedChurchSlug.value,
            )?.churchSlug

            if (onboardingState?.needsOnboarding == true) {
                _state.value = LaunchPhase.Onboarding(bootstrap)
            } else {
                _state.value = LaunchPhase.Ready(bootstrap, isStale = false)
                // A link that arrived before the app could act on it — at a
                // cold start, or while signed out — is honoured now, through the
                // same gates a tab passes.
                consumePendingDestination()?.let { openDestination(it, bootstrap) }
            }
        } catch (error: ApiException) {
            _state.value = when {
                error.code == MobileErrorCode.UNAUTHENTICATED ||
                    error.code == MobileErrorCode.SESSION_EXPIRED -> LaunchPhase.SignedOut
                error.retryable -> showOfflinePhase(previous)
                else -> LaunchPhase.Failed(error.displayMessage)
            }
        } catch (error: Exception) {
            _state.value = showOfflinePhase(previous)
        }
    }

    private fun applyCached(snapshot: AccountSnapshot) {
        lastBootstrap = snapshot.bootstrap
        onboardingState = snapshot.onboarding
        _selectedChurchSlug.value = HostNavigation.adoptSelection(
            bootstrap = snapshot.bootstrap,
            serverPreference = snapshot.onboarding?.selectedChurchSlug
                ?: snapshot.bootstrap.profile.selectedChurchSlug,
            current = _selectedChurchSlug.value,
        )?.churchSlug
        _state.value = if (snapshot.onboarding?.needsOnboarding == true) {
            LaunchPhase.Onboarding(snapshot.bootstrap)
        } else {
            LaunchPhase.Ready(snapshot.bootstrap, isStale = !snapshot.isFresh())
        }
    }

    private fun showOffline(previous: Bootstrap?) {
        _state.value = showOfflinePhase(previous)
    }

    private fun showOfflinePhase(previous: Bootstrap?): LaunchPhase =
        if (previous != null) LaunchPhase.Ready(previous, isStale = true)
        else LaunchPhase.OfflineNoCache

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
     * Sets the visitor display name from Account, then refreshes bootstrap so
     * the header shows the name that was just saved.
     */
    fun updateDisplayName(raw: String, onDone: (Boolean) -> Unit = {}) {
        val trimmed = raw.trim()
        if (trimmed.isEmpty()) {
            onDone(false)
            return
        }
        viewModelScope.launch {
            @Serializable
            data class ProfileReply(val displayName: String? = null)
            val ok = runCatching {
                api.send(
                    path = "api/mobile/v1/account/profile",
                    serializer = MobileSuccess.serializer(ProfileReply.serializer()),
                    method = "PATCH",
                    body = json.encodeToString(
                        kotlinx.serialization.json.JsonObject.serializer(),
                        buildJsonObject { put("displayName", trimmed) }
                    )
                )
            }.isSuccess
            if (ok) loadNow(quiet = true)
            onDone(ok)
        }
    }

    /**
     * Parsed and authorized before anything is mutated. An invitation is a
     * credential, not a destination: signed out it is held for after sign-in,
     * signed in it is redeemed on the spot. Every other link is an unknown or
     * a destination, and an unknown is dropped rather than half-navigated.
     */
    fun handleDeepLink(raw: String) {
        // The email-confirmation callback. Exchanged exactly once; with a
        // session already on the device it degrades to a quiet refresh, so a
        // replayed or duplicate link cannot corrupt state.
        val callback = AuthCallbackLink.parse(raw)
        if (callback != null) {
            handleAuthCallback(callback)
            return
        }

        val token = InvitationLink.token(raw)
        if (token != null) {
            _pendingInvitationToken.value = token
            if (sessions.current() != null) {
                viewModelScope.launch {
                    if (acceptInvitationNow(token)) loadNow(quiet = true)
                }
            } else {
                // Signed out. The token cannot be spent yet, but the church it
                // belongs to can be *named* — which is what turns the front
                // door from "FaithForm" into "Join Grace Community" for someone
                // who never asked for a product, only for their church.
                viewModelScope.launch { resolveChurchContextFromInvitation(token) }
            }
            return
        }

        val destination = DeepLinkParser.parse(raw) ?: return

        // Already home: act on it now. Otherwise it waits for the next Ready.
        val ready = _state.value as? LaunchPhase.Ready
        if (ready != null && sessions.current() != null) {
            openDestination(destination, ready.bootstrap)
            return
        }
        pendingDestination = destination

        // Signed out, a church link still carries meaning: it says where the
        // person is heading, and carrying that name through sign-in is the
        // difference between arriving at a church and arriving at a search box.
        if (destination is Destination.Church && sessions.current() == null) {
            viewModelScope.launch { resolveChurchContextFromSlug(destination.slug) }
        }
    }

    /**
     * Goes where a link points, or nowhere.
     *
     * [HostNavigation.resolveLink] applies every gate; a link that fails any of
     * them does nothing at all. One that passes selects its church first, so
     * `faithform://church/grace/give` opens Give *for Grace*, not for whichever
     * church happened to be selected.
     */
    private fun openDestination(destination: Destination, bootstrap: Bootstrap) {
        val target = HostNavigation.resolveLink(destination, bootstrap, registry) ?: return
        target.churchSlug?.let { _selectedChurchSlug.value = it }
        _selectedTab.value = target.tab
        _sermonsRequested.value = target.destination is Destination.SermonArchive
    }

    fun selectTab(tab: HostTab) {
        _selectedTab.value = tab
        // A tab chosen by hand is not a request to open anything inside it.
        _sermonsRequested.value = false
    }

    /**
     * Opens [slug]'s sermon notes from outside the Church tab, through exactly
     * the gates a `…/sermons` link passes.
     */
    fun openSermons(slug: String) {
        val ready = _state.value as? LaunchPhase.Ready ?: return
        openDestination(Destination.SermonArchive(slug), ready.bootstrap)
    }

    /** The Church tab has shown sermon notes; the request is spent. */
    fun consumeSermonsRequest() {
        _sermonsRequested.value = false
    }

    /**
     * Chooses the church the church-scoped tabs are about.
     *
     * Only a church this account can read is selectable — a blocked or left
     * row is shown so its absence is not mysterious, but it cannot be chosen.
     * The choice applies at once and is then recorded on the server as the
     * account's preference, so the same church is selected on the next device.
     * That write is a preference, not authorization: if it fails nothing is
     * undone, and every read still checks access on its own.
     */
    fun selectChurch(slug: String) {
        val ready = _state.value as? LaunchPhase.Ready ?: return
        val relationship = ready.bootstrap.relationships
            .firstOrNull { it.churchSlug == slug && it.canReadPublishedContent } ?: return
        if (_selectedChurchSlug.value == relationship.churchSlug) return
        _selectedChurchSlug.value = relationship.churchSlug

        viewModelScope.launch {
            runCatching {
                api.send(
                    path = "api/mobile/v1/account/selected-church",
                    serializer = MobileSuccess.serializer(SelectedChurch.serializer()),
                    method = "PUT",
                    body = json.encodeToString(
                        SelectChurchRequest.serializer(),
                        SelectChurchRequest(churchSlug = relationship.churchSlug)
                    )
                ).value
            }.getOrNull()?.let { reply ->
                // The server's authorization version is authoritative. If it
                // moved, every partition cached under the old one is stale and
                // must not be read again — so drop them and reload.
                if (reply.authorizationVersion != ready.bootstrap.profile.authorizationVersion) {
                    cache.purgeAllPrivate()
                    loadNow(quiet = true)
                }
            }
        }
    }

    /**
     * The cache partition for [churchSlug] under the current account and
     * authorization version, or null when there is no signed-in bootstrap.
     * Every church-scoped feature reads and writes through this, which is what
     * makes a switched church, a different account or a bumped version
     * unreadable rather than merely hidden.
     */
    fun partition(churchSlug: String?): CachePartition? {
        val bootstrap = when (val current = _state.value) {
            is LaunchPhase.Ready -> current.bootstrap
            is LaunchPhase.Onboarding -> current.bootstrap
            else -> return null
        }
        val accountId = sessions.current()?.accountId ?: return null
        return CachePartition(
            environment = environmentKey,
            accountId = accountId,
            churchSlug = churchSlug,
            authorizationVersion = bootstrap.profile.authorizationVersion
        )
    }

    /**
     * One confirmation link, whatever its state.
     *
     * Signed in already — because the exchange succeeded moments ago, or the
     * person signed in with their password while the email sat unread — the
     * link is spent goodwill, not an error: refresh quietly and move on.
     * Signed out, the code is exchanged for a session through the ordinary
     * completion path. Only failures the provider might still honour —
     * offline, rate-limited — leave the code unconsumed, so the person can
     * simply tap the link again.
     */
    private fun handleAuthCallback(outcome: AuthCallbackLink.Outcome) {
        if (sessions.current() != null) {
            viewModelScope.launch { loadNow(quiet = _state.value is LaunchPhase.Ready) }
            return
        }

        when (outcome) {
            is AuthCallbackLink.Outcome.Failure -> {
                _confirmationPhase.value = ConfirmationPhase.Failed(
                    when (outcome.reason) {
                        AuthCallbackLink.FailureReason.EXPIRED -> AuthUiError.LINK_EXPIRED
                        AuthCallbackLink.FailureReason.INVALID -> AuthUiError.LINK_INVALID
                    }
                )
            }

            is AuthCallbackLink.Outcome.Code -> {
                val client = auth ?: run {
                    _confirmationPhase.value =
                        ConfirmationPhase.Failed(AuthUiError.NOT_CONFIGURED)
                    return
                }
                if (_confirmationPhase.value is ConfirmationPhase.Working) return
                if (outcome.value in consumedCodes) return

                _confirmationPhase.value = ConfirmationPhase.Working
                viewModelScope.launch {
                    try {
                        val session = client.completeEmailConfirmation(outcome.value)
                        consumedCodes.add(outcome.value)
                        _confirmationPhase.value = ConfirmationPhase.Idle
                        completeAuth(session, displayName = null)
                    } catch (error: AuthException) {
                        if (error.kind != AuthException.Kind.OFFLINE &&
                            error.kind != AuthException.Kind.RATE_LIMITED
                        ) {
                            consumedCodes.add(outcome.value)
                        }
                        _confirmationPhase.value = ConfirmationPhase.Failed(authUiError(error.kind))
                    } catch (error: Exception) {
                        _confirmationPhase.value = ConfirmationPhase.Failed(AuthUiError.GENERIC)
                    }
                }
            }
        }
    }

    fun clearConfirmationError() {
        if (_confirmationPhase.value is ConfirmationPhase.Failed) {
            _confirmationPhase.value = ConfirmationPhase.Idle
        }
    }

    fun consumePendingDestination(): Destination? =
        pendingDestination.also { pendingDestination = null }

    /** Redeems what a person pasted — a bare token or the full link. */
    fun acceptInvitation(raw: String) {
        viewModelScope.launch {
            if (acceptInvitationNow(normalizeInvitation(raw))) loadNow(quiet = true)
        }
    }

    /**
     * Holds an invitation for after sign-in and names the church on the front
     * door. Same path a deep link takes when the person is signed out.
     */
    fun holdInvitationLink(raw: String, onDone: (ok: Boolean) -> Unit) {
        viewModelScope.launch {
            val token = normalizeInvitation(raw)
            if (token.length < 16 || token.length > 512) {
                onDone(false)
                return@launch
            }
            _pendingInvitationToken.value = token
            resolveChurchContextFromInvitation(token)
            onDone(true)
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

    /**
     * Names the church behind a held invitation, without spending it.
     *
     * Unauthenticated by design: the whole point is to brand the screens a
     * person sees *before* they have a session. Failure is silent and leaves
     * the context null — an expired link should still lead to a working sign-up
     * screen with the ordinary wording, not a dead end.
     */
    private suspend fun resolveChurchContextFromInvitation(invitationToken: String) {
        val token = normalizeInvitation(invitationToken)
        if (token.length < 16 || token.length > 512) return

        val preview = runCatching {
            api.send(
                path = "api/mobile/v1/invitations/preview",
                serializer = MobileSuccess.serializer(InvitationPreview.serializer()),
                method = "POST",
                body = json.encodeToString(
                    kotlinx.serialization.json.JsonObject.serializer(),
                    buildJsonObject { put("token", token) }
                ),
                authenticated = false
            ).value
        }.getOrNull() ?: return

        _churchContext.value = PendingChurchContext(
            churchSlug = preview.churchSlug,
            churchName = preview.churchName,
            logoUrl = preview.logoUrl,
            invitationToken = token
        )
    }

    /**
     * Names the church behind a plain `faithform://church/<slug>` link.
     *
     * Only a discoverable church resolves here — the public profile endpoint
     * refuses to confirm that an unlisted one exists, and that refusal is the
     * point. An unlisted church reaches this screen through an invitation,
     * where the token is the authority.
     */
    private suspend fun resolveChurchContextFromSlug(churchSlug: String) {
        val profile = runCatching {
            api.send(
                path = "api/mobile/v1/churches/$churchSlug/profile",
                serializer = MobileSuccess.serializer(ChurchProfile.serializer()),
                authenticated = false
            ).value
        }.getOrNull() ?: return

        _churchContext.value = PendingChurchContext(
            churchSlug = profile.slug,
            churchName = profile.name,
            logoUrl = profile.logoUrl,
            invitationToken = null
        )
    }

    /**
     * "Not your church?" — and everything the link brought with it goes, the
     * held token included. A context the person has disowned must not quietly
     * redeem itself the moment they finish signing up.
     */
    fun clearChurchContext() {
        val token = _churchContext.value?.invitationToken
        if (token != null && _pendingInvitationToken.value == token) {
            _pendingInvitationToken.value = null
        }
        _churchContext.value = null
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

            clearLocal()
        }
    }

    /**
     * The session ended somewhere else — a 401 from any screen, or a refresh
     * token the identity provider refused.
     *
     * The same local clean-up as signing out, without the server call: there
     * is no session left to sign out with. The person lands on the sign-in
     * screen rather than on an offline state whose retry could never work.
     */
    private suspend fun handleSessionEnded() {
        if (_state.value is LaunchPhase.SignedOut) return
        clearLocal()
    }

    /** Everything this device holds for the account, gone — in every partition. */
    private suspend fun clearLocal() {
        sessions.purgeEverything()
        cache.purgeAllPrivate()
        snapshots.purgeAll()
        lastBootstrap = null
        onboardingState = null
        pendingDestination = null
        deletionKey = null
        _selectedChurchSlug.value = null
        _selectedTab.value = HostTab.HOME
        _sermonsRequested.value = false
        _deletion.value = DeletionPhase.Idle
        _pendingInvitationToken.value = null
        _churchContext.value = null
        _invitationPhase.value = InvitationPhase.Idle
        _state.value = LaunchPhase.SignedOut
    }

    // -----------------------------------------------------------------------
    // Account deletion
    // -----------------------------------------------------------------------

    /** Opens the confirmation. Nothing is sent. */
    fun beginDeletion() {
        if (_deletion.value !is DeletionPhase.Working) _deletion.value = DeletionPhase.Confirming
    }

    /** "Keep my account". A request already on its way cannot be recalled by a dialog. */
    fun cancelDeletion() {
        if (_deletion.value is DeletionPhase.Working) return
        _deletion.value = DeletionPhase.Idle
        deletionKey = null
    }

    /**
     * Sends the deletion request, and signs out only once it is recorded.
     *
     * `POST api/mobile/v1/account/requests {"kind":"deletion"}` with an
     * idempotency key that survives retries of this confirmation. On success
     * the server marks the account `deletion_requested` and bumps its
     * authorization version, so every cached projection everywhere is stale;
     * this device then purges its session and every private partition.
     *
     * On failure the account stays signed in and the dialog says it was *not*
     * deleted — the one thing a person must never be wrong about here.
     */
    fun confirmDeletion() {
        if (_deletion.value is DeletionPhase.Working) return
        val key = deletionKey ?: UUID.randomUUID().toString().also { deletionKey = it }
        _deletion.value = DeletionPhase.Working

        viewModelScope.launch {
            val failure: DeletionPhase.Failed? = try {
                api.send(
                    path = "api/mobile/v1/account/requests",
                    serializer = MobileSuccess.serializer(AccountRequest.serializer()),
                    method = "POST",
                    body = json.encodeToString(
                        AccountActionRequest.serializer(),
                        AccountActionRequest(kind = AccountRequestKind.DELETION)
                    ),
                    idempotencyKey = key
                ).value ?: throw ApiException.transport()
                null
            } catch (cancelled: kotlinx.coroutines.CancellationException) {
                throw cancelled
            } catch (error: ApiException) {
                DeletionPhase.Failed(if (error.retryable) null else error.displayMessage)
            } catch (_: Exception) {
                DeletionPhase.Failed(null)
            }

            if (failure != null) {
                // A session the server has already ended is handled by the
                // shell's sign-out path; everything else stays on screen.
                if (_state.value !is LaunchPhase.SignedOut) _deletion.value = failure
                return@launch
            }
            clearLocal()
            _deletionRequested.value = true
        }
    }
}
