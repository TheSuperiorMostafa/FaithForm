package io.faithform.app

import android.app.Application
import io.faithform.app.session.AppContainer

/**
 * The composition root.
 *
 * Dependencies are constructed once here and passed down explicitly. No
 * service locator and no reflective injection: the graph is small, and being
 * able to read it top to bottom is worth more than the ceremony of a framework.
 */
class FaithFormApplication : Application() {
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

        // No notification channels are created in v1. Push arrives in v1.1,
        // together with POST_NOTIFICATIONS in the manifest; creating channels
        // now would list "Announcements" and "Events" in system settings for
        // an app that sends neither. `NotificationChannels.ensureCreated` is
        // ready for that release and goes back here, before the first
        // notification can arrive.
    }
}
