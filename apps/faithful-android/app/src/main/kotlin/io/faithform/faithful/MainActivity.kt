package io.faithform.faithful

import android.Manifest
import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import io.faithform.faithful.design.FaithfulTheme
import io.faithform.faithful.navigation.RouteRegistry
import io.faithform.faithful.ui.FaithfulApp
import io.faithform.faithful.ui.UnconfiguredScreen
import io.faithform.faithful.ui.discovery.AndroidLocationProvider
import kotlin.coroutines.resume
import kotlinx.coroutines.suspendCancellableCoroutine

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

    private var appViewModel: AppViewModel? = null

    /**
     * The one runtime dialog discovery can raise, owned by the Activity
     * because launchers must be registered before START. The provider awaits
     * the person's answer through [pendingPermissionReply].
     */
    private var pendingPermissionReply: ((Map<String, Boolean>) -> Unit)? = null

    private val locationPermissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) { grants ->
        pendingPermissionReply?.invoke(grants)
        pendingPermissionReply = null
    }

    private suspend fun requestLocationPermissions(): Map<String, Boolean> =
        suspendCancellableCoroutine { continuation ->
            pendingPermissionReply = { grants ->
                if (continuation.isActive) continuation.resume(grants)
            }
            continuation.invokeOnCancellation { pendingPermissionReply = null }
            locationPermissionLauncher.launch(
                arrayOf(
                    Manifest.permission.ACCESS_FINE_LOCATION,
                    Manifest.permission.ACCESS_COARSE_LOCATION
                )
            )
        }

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

        val viewModel = AppViewModel(
            api = container.apiClient,
            sessions = container.sessionStore,
            cache = container.cache,
            environmentKey = container.environmentKey
        )
        appViewModel = viewModel
        val locationProvider = AndroidLocationProvider(
            context = applicationContext,
            requestPermissions = ::requestLocationPermissions
        )

        // A link that arrives with a cold start is handled the same way as one
        // that arrives later: parsed, authorized, then acted on.
        intent?.dataString?.let(viewModel::handleDeepLink)

        setContent {
            FaithfulTheme {
                FaithfulApp(
                    viewModel = viewModel,
                    container = container,
                    locationProvider = locationProvider,
                    registry = registry
                )
            }
        }

        viewModel.load()
    }

    /**
     * The `singleTask` half of deep linking: a link into a running app arrives
     * here rather than through a fresh `onCreate`, and is handled identically
     * — parsed, authorized, then acted on.
     */
    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        intent.dataString?.let { appViewModel?.handleDeepLink(it) }
    }
}
