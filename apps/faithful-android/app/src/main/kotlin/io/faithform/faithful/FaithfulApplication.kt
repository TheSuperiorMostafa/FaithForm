package io.faithform.faithful

import android.app.Application
import io.faithform.faithful.notifications.NotificationChannels
import io.faithform.faithful.session.AppContainer

/**
 * The composition root.
 *
 * Dependencies are constructed once here and passed down explicitly. No
 * service locator and no reflective injection: the graph is small, and being
 * able to read it top to bottom is worth more than the ceremony of a framework.
 */
class FaithfulApplication : Application() {
    /** Null when this build has no usable configuration. See [environment]. */
    var container: AppContainer? = null
        private set

    lateinit var environment: AppEnvironment
        private set

    override fun onCreate() {
        super.onCreate()

        // Resolved before anything is constructed. A build with no origin builds
        // no graph at all — there is nothing for a screen to accidentally use,
        // and no network call is attempted.
        environment = AppEnvironmentLoader.load(
            environmentKey = BuildConfig.ENVIRONMENT_KEY,
            apiOrigin = BuildConfig.API_ORIGIN,
            clientBuild = BuildConfig.VERSION_CODE,
            allowDebugControls = BuildConfig.ALLOW_DEBUG_CONTROLS
        )

        val configured = environment as? AppEnvironment.Configured ?: return

        container = AppContainer(
            context = this,
            apiOrigin = configured.apiOrigin,
            environmentKey = configured.environmentKey,
            clientBuild = configured.clientBuild,
            allowDebugControls = configured.allowsDebugControls,
            supabaseUrl = BuildConfig.SUPABASE_URL,
            supabaseAnonKey = BuildConfig.SUPABASE_ANON_KEY
        )

        // Channels must exist before the first notification arrives or Android
        // silently drops it. Creating one is not a prompt and shows nothing.
        NotificationChannels.ensureCreated(this)
    }
}
