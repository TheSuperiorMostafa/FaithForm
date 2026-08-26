package io.faithform.faithful.session

import android.content.Context
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import io.faithform.faithful.network.ApiClient
import io.faithform.faithful.network.ApiEnvironment
import io.faithform.faithful.network.HttpTransport
import io.faithform.faithful.network.OkHttpTransport
import io.faithform.faithful.FaithfulApplication
import io.faithform.faithful.attendance.AutomaticAttendanceCoordinator
import io.faithform.faithful.storage.PartitionedCache

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
    val allowDebugControls: Boolean
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
        "faithful.secure.$environmentKey",
        masterKey,
        EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
        EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
    )

    val sessionStore = AndroidSessionStore(secureStore, environmentKey)

    val transport: HttpTransport = OkHttpTransport()

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
         * returns the same instance `FaithfulApplication` built; it never
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
            (context.applicationContext as FaithfulApplication).container
    }
}
