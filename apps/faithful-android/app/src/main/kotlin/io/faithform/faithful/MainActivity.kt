package io.faithform.faithful

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.runtime.getValue
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.faithform.faithful.design.FaithfulTheme
import io.faithform.faithful.navigation.RouteRegistry
import io.faithform.faithful.ui.FaithfulApp
import io.faithform.faithful.ui.UnconfiguredScreen

/**
 * The single activity.
 *
 * `singleTask` plus `onNewIntent` is the Android-native way to receive a deep
 * link into a running app; this is deliberately not modelled on the iOS
 * lifecycle, which handles the same situation differently.
 */
class MainActivity : ComponentActivity() {

    /**
     * Every destination with a real screen behind it on Android.
     *
     * `sermons` is **absent**: Prompt 10 was never built. The destination exists
     * in the enum, the capability key exists, and there is no screen — so the
     * registry resolves it to `NotImplemented` and nothing offers it. Listing it
     * here to "finish the set" would produce a tab that opens a blank page.
     *
     * Mirrors `AppDependencies.implementedDestinations` on iOS, entry for entry.
     */
    private val registry = RouteRegistry(
        implemented = setOf(
            "home",
            "account",
            "accountPrivacy",
            "discover",
            "church",
            "announcements",
            "watch",
            "give",
            "checkIn",
        )
    )

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()

        val app = application as FaithfulApplication

        // **The fail-closed state.** A build with no origin built no graph, so
        // there is nothing to hand a screen and nothing to attempt. It says so
        // rather than showing a spinner that will never resolve.
        val container = app.container
        if (container == null) {
            val reason = (app.environment as? AppEnvironment.Unconfigured)?.reason ?: ""
            setContent {
                FaithfulTheme {
                    UnconfiguredScreen(
                        // Shown only where debug affordances are compiled in. A
                        // church would never see a configuration key name.
                        reason = if (BuildConfig.ALLOW_DEBUG_CONTROLS) reason else null
                    )
                }
            }
            return
        }

        val viewModel = AppViewModel(container)

        // A link that arrives with a cold start is handled the same way as one
        // that arrives later: parsed, authorized, then acted on.
        intent?.dataString?.let(viewModel::handleDeepLink)

        setContent {
            val state by viewModel.state.collectAsStateWithLifecycle()
            FaithfulTheme {
                FaithfulApp(
                    state = state,
                    registry = registry,
                    onSignOut = viewModel::signOut,
                    onRequestDeletion = viewModel::requestDeletion,
                    onRetry = viewModel::load
                )
            }
        }

        viewModel.load()
    }
}
