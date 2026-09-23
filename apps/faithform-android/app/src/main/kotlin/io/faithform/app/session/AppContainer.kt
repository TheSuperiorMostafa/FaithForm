package io.faithform.app.session

import android.content.Context
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import io.faithform.app.navigation.AuthCallbackLink
import io.faithform.app.network.ApiClient
import io.faithform.app.network.ApiEnvironment
import io.faithform.app.network.CodeVerifierStore
import io.faithform.app.network.HttpTransport
import io.faithform.app.network.OkHttpExchange
import io.faithform.app.network.SupabaseAuthClient
import io.faithform.app.network.SupabaseAuthConfig
import io.faithform.app.FaithFormApplication
import io.faithform.app.attendance.AutomaticAttendanceCoordinator
import io.faithform.app.giving.EncryptedPendingDonationStore
import io.faithform.app.giving.GivingClient
import io.faithform.app.giving.PaymentSheetRequest
import io.faithform.app.giving.PendingDonationStore
import io.faithform.app.giving.SheetOutcome
import io.faithform.app.host.ActivityResultRelay
import io.faithform.app.media.InMemoryResumePositionStore
import io.faithform.app.media.MediaClient
import io.faithform.app.media.ResumePositionStore
import io.faithform.app.network.ProjectionCache
import io.faithform.app.sermons.SermonClient
import io.faithform.app.sermons.PresentationClient
import io.faithform.app.storage.PartitionedCache
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.asSharedFlow
import java.io.File

/**
 * Everything the app needs, built once.
 *
 * The environment is fixed at build time. There is no runtime switch in a
 * release build, so one environment's token or cache can never be used against
 * another — the environment key is part of both the credential storage key and
 * every cache partition.
 */
class AppContainer(
    context: Context,
    apiOrigin: String,
    val environmentKey: String,
    clientBuild: Int,
    val allowDebugControls: Boolean,
    supabaseUrl: String = "",
    supabaseAnonKey: String = ""
) {
    /**
     * Keystore-backed. The master key is hardware-protected where the device
     * offers it, and the token never appears in an ordinary preference file.
     */
    private val masterKey = MasterKey.Builder(context)
        .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
        .build()

    val secureStore = EncryptedSharedPreferences.create(
        context,
        "faithform.secure.$environmentKey",
        masterKey,
        EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
        EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
    )

    /**
     * Every request the app makes — the API and the identity provider alike —
     * goes through OkHttp here.
     *
     * This line used to construct a transport with no exchange behind it, so
     * every call threw before leaving the phone and the app said "offline" on
     * a working network. `OkHttpTransport` can no longer be built without one,
     * and `NetworkWiringTest` holds this line to the real exchange.
     */
    val transport: HttpTransport = OkHttpExchange.transport()

    /**
     * The PKCE verifier between signup and the confirmation link's return.
     * Credential material, so it lives in the same encrypted store as the
     * session — and `purgeEverything`'s clear() sweeps it with everything else.
     */
    private val verifierStore = object : CodeVerifierStore {
        private val key = "authflow.$environmentKey"
        override fun save(verifier: String) {
            secureStore.edit().putString(key, verifier).apply()
        }
        override fun load(): String? = secureStore.getString(key, null)
        override fun clear() {
            secureStore.edit().remove(key).apply()
        }
    }

    /**
     * Null when this build has no identity provider configured. The sign-in
     * screen still renders; submitting explains what is missing. Both values
     * are public by design — see `app/build.gradle.kts`.
     */
    val authClient: SupabaseAuthClient? =
        if (supabaseUrl.isBlank() || supabaseAnonKey.isBlank()) null
        else SupabaseAuthClient(
            SupabaseAuthConfig(
                url = supabaseUrl,
                anonKey = supabaseAnonKey,
                // Password-reset emails land on this build's own web origin,
                // so a staging build cannot mail someone a production link.
                resetRedirectOrigin = apiOrigin,
                // Confirmation emails return to this build's own web origin,
                // which hands off to `faithform://auth/callback` from a page
                // rather than from a redirect — a browser will not follow a
                // `302` into a custom scheme, and every confirmation ended on
                // a connection error while this was the scheme itself. Derived
                // from configuration, never from a request or a link; without
                // it the provider falls back to its Site URL, which is the
                // church dashboard, not this app.
                signUpRedirect = AuthCallbackLink.confirmRedirect(apiOrigin)
            ),
            transport,
            verifierStore = verifierStore
        )

    val sessionStore = AndroidSessionStore(
        preferences = secureStore,
        environmentKey = environmentKey,
        refresh = { refreshToken ->
            // The refresher was a stub until sign-in existed; a session that
            // expired now renews instead of dying at its first hour.
            val client = authClient ?: error("no identity provider configured")
            val renewed = client.refresh(refreshToken)
            StoredSession(
                accessToken = renewed.accessToken,
                refreshToken = renewed.refreshToken,
                expiresAtMillis = System.currentTimeMillis() + renewed.expiresInSeconds * 1000,
                accountId = renewed.accountId,
                environmentKey = environmentKey
            )
        }
    )

    /**
     * Every request that discovers the session has ended reports it here, and
     * the shell's view model collects it once — so no screen needs to know how
     * to sign someone out.
     */
    private val sessionEndedEvents = MutableSharedFlow<Unit>(extraBufferCapacity = 1)
    val sessionEnded: SharedFlow<Unit> = sessionEndedEvents.asSharedFlow()

    val apiClient = ApiClient(
        environment = ApiEnvironment(environmentKey, apiOrigin),
        clientBuild = clientBuild,
        transport = transport,
        tokens = sessionStore,
        onSessionEnded = { sessionEndedEvents.tryEmit(Unit) }
    )

    /** Caches hold projections only. Credentials are never written here. */
    val cache = PartitionedCache(directory = File(context.filesDir, "faithform-projections"))

    /** The last signed-in shell, so a returning visit paints Home without waiting. */
    val snapshots = AccountSnapshotStore(File(context.filesDir, "faithform-snapshots"))

    /** The typed, ETag-carrying view of [cache] every feature client reads through. */
    val projections = ProjectionCache(cache)

    val mediaClient = MediaClient(apiClient, projections)
    val sermonClient = SermonClient(apiClient, projections)
    val presentationClient = PresentationClient(apiClient, projections)
    val givingClient = GivingClient(apiClient, projections)

    /**
     * Resume positions, for this process only. See `InMemoryResumePositionStore`
     * for why nothing about viewing is written to disk in v1.
     */
    val resumePositions: ResumePositionStore = InMemoryResumePositionStore()

    /**
     * The one gift that may be mid-flight, kept in the encrypted store so it
     * survives a process kill between "Give" and the server's answer — and is
     * swept by sign-out's `purgeEverything` with everything else.
     */
    val pendingDonations: PendingDonationStore = EncryptedPendingDonationStore(secureStore)

    /**
     * Answers from system UI that outlive the Activity that raised it. Each
     * Activity attaches its own launchers in `onCreate`; the view models hold
     * these relays, never a launcher. See `ActivityResultRelay`.
     */
    val locationPermissions = ActivityResultRelay<Array<String>, Map<String, Boolean>>(unavailable = emptyMap())
    val paymentSheets = ActivityResultRelay<PaymentSheetRequest, SheetOutcome>(unavailable = SheetOutcome.FAILED)

    /**
     * Automatic attendance, or null before the app has been opened once.
     *
     * Built lazily and assigned by the app layer rather than in the constructor,
     * because a broadcast receiver can wake the process before any screen has
     * run — and constructing the whole feature eagerly for every unrelated
     * receiver would be work the device did not need to do.
     */
    @Volatile
    var automaticAttendance: AutomaticAttendanceCoordinator? = null

    companion object {
        /**
         * The container for a receiver that woke a cold process.
         *
         * Receivers are constructed by the system with no reference to the
         * application graph, so this is the one place a lookup is needed. It
         * returns the same instance `FaithFormApplication` built; it never
         * builds a second one.
         */
        /**
         * Null when this build has no usable configuration.
         *
         * A geofence transition arriving in an unconfigured build has nowhere to
         * go, and the honest answer is nothing rather than a graph pointed at a
         * default origin. Callers drop the event; the OS does not retry it, and
         * an unconfigured build was never going to check anyone in anyway.
         */
        fun from(context: Context): AppContainer? =
            (context.applicationContext as FaithFormApplication).container
    }
}
