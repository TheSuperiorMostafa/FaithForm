package io.faithform.app.session

import android.content.Context
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import io.faithform.app.navigation.AuthCallbackLink
import io.faithform.app.network.ApiClient
import io.faithform.app.network.ApiEnvironment
import io.faithform.app.network.CodeVerifierStore
import io.faithform.app.network.HttpTransport
import io.faithform.app.network.OkHttpTransport
import io.faithform.app.network.SupabaseAuthClient
import io.faithform.app.network.SupabaseAuthConfig
import io.faithform.app.FaithFormApplication
import io.faithform.app.attendance.AutomaticAttendanceCoordinator
import io.faithform.app.storage.PartitionedCache

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

    val transport: HttpTransport = OkHttpTransport()

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
                // Confirmation emails return to this app's own callback — the
                // contract constant, never a value a request or link supplied.
                // Without it the identity provider falls back to its Site URL,
                // which is the church dashboard, not this app.
                signUpRedirect = AuthCallbackLink.CANONICAL
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

    val apiClient = ApiClient(
        environment = ApiEnvironment(environmentKey, apiOrigin),
        clientBuild = clientBuild,
        transport = transport,
        tokens = sessionStore
    )

    /** Caches hold projections only. Credentials are never written here. */
    val cache = PartitionedCache()

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
