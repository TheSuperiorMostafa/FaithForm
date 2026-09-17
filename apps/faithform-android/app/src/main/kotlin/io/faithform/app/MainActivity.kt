package io.faithform.app

import android.Manifest
import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.compose.runtime.getValue
import io.faithform.app.attendance.CameraPermissionRequester
import io.faithform.app.design.ChurchBrandPalette
import io.faithform.app.design.ChurchBrandTheme
import io.faithform.app.design.FaithFormTheme
import io.faithform.app.giving.StripePaymentSheetAdapter
import io.faithform.app.navigation.RouteRegistry
import io.faithform.app.session.AppContainer
import io.faithform.app.ui.FaithFormApp
import io.faithform.app.ui.UnconfiguredScreen
import io.faithform.app.ui.discovery.AndroidLocationProvider

/**
 * The single activity.
 *
 * `singleTask` plus `onNewIntent` is the Android-native way to receive a deep
 * link into a running app; this is deliberately not modelled on the iOS
 * lifecycle, which handles the same situation differently.
 *
 * ## What survives a rotation, and what does not
 *
 * This class is rebuilt on every configuration change. Anything that must
 * outlive that — the shell's state, a sign-in in progress, a gift waiting for
 * the server — lives in a ViewModel or in the application container, and is
 * *fetched* here, never constructed here. The previous version built
 * `AppViewModel` directly in `onCreate`: after one rotation the screen observed
 * a brand-new view model while the retained sign-in form still reported to the
 * old one, so signing in after rotating left the person on the sign-in screen.
 *
 * What does belong to one Activity instance is registered here and bound to
 * app-scoped relays: the location permission launcher, the camera permission
 * launcher, and Stripe's payment sheet. Each must be registered before the
 * Activity starts, and each is replaced, not leaked, by the next instance.
 */
class MainActivity : ComponentActivity() {

    /**
     * Every destination with a real screen behind it on Android.
     *
     * The rule this list enforces: a destination is listed only once a screen
     * actually opens behind it. `sermonArchive` was the long-standing exception
     * — declared since Prompt 4 with nothing behind it — and is listed now
     * because `SermonScreens` exists and the server publishes the `sermons`
     * capability. Anything still unbuilt stays out, so the registry resolves it
     * to `NotImplemented` and nothing offers it.
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
            "sermons",
        )
    )

    private var appViewModel: AppViewModel? = null

    /**
     * The one runtime dialog discovery can raise. Registered on this instance;
     * the discovery view model reaches it only through
     * `container.locationPermissions`, so a rotation mid-dialog still answers
     * the request that raised it.
     */
    private val locationPermissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) { grants ->
        (application as FaithFormApplication).container?.locationPermissions?.deliver(grants)
    }

    private val launchLocationDialog: (Array<String>) -> Unit = { permissions ->
        locationPermissionLauncher.launch(permissions)
    }

    /** Registered before START, like every launcher. Used only by the check-in tab. */
    private val cameraPermission = CameraPermissionRequester(this)

    override fun onCreate(savedInstanceState: Bundle?) {
        // Before `super.onCreate`, as the library requires: swaps the starting
        // theme for `Theme.FaithForm`. No keep-on-screen condition — the splash
        // leaves with the first frame, which is `LaunchLoadingView` drawing the
        // same mark in the same place, never a wait on the network.
        installSplashScreen()
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()

        val app = application as FaithFormApplication

        // **The fail-closed state.** A build with no origin built no graph, so
        // there is nothing to hand a screen and nothing to attempt. It says so
        // rather than showing a spinner that will never resolve.
        val container = app.container
        if (container == null) {
            val reason = (app.environment as? AppEnvironment.Unconfigured)?.reason ?: ""
            setContent {
                FaithFormTheme {
                    UnconfiguredScreen(
                        // Shown only where debug affordances are compiled in. A
                        // church would never see a configuration key name.
                        reason = if (BuildConfig.ALLOW_DEBUG_CONTROLS) reason else null
                    )
                }
            }
            return
        }

        container.locationPermissions.attach(launchLocationDialog)
        // Stripe's sheet registers its own launcher and attaches itself to
        // `container.paymentSheets`; it detaches when this instance is destroyed.
        StripePaymentSheetAdapter(this, container.paymentSheets)

        // Retained across configuration changes. The factory runs once per
        // Activity *lifetime*, not once per `onCreate`.
        val viewModel = ViewModelProvider(this, AppViewModelFactory(container, registry))[AppViewModel::class.java]
        appViewModel = viewModel

        // App-scoped: holds the application context and the relay, never this
        // Activity, so the discovery view model that keeps it cannot leak one.
        val locationProvider = AndroidLocationProvider(
            context = applicationContext,
            requestPermissions = {
                container.locationPermissions.request(
                    arrayOf(
                        Manifest.permission.ACCESS_FINE_LOCATION,
                        Manifest.permission.ACCESS_COARSE_LOCATION
                    )
                )
            }
        )

        // A link that arrives with a cold start is handled the same way as one
        // that arrives later: parsed, authorized, then acted on. A recreated
        // Activity re-delivers the same intent, which is why this runs only
        // for a genuinely new launch.
        if (savedInstanceState == null) {
            intent?.dataString?.let(viewModel::handleDeepLink)
        }

        setContent {
            val phase by viewModel.state.collectAsStateWithLifecycle()
            val selectedSlug by viewModel.selectedChurchSlug.collectAsStateWithLifecycle()
            val bootstrap = (phase as? LaunchPhase.Ready)?.bootstrap
            val appTheme = bootstrap?.relationships
                ?.firstOrNull { it.churchSlug == selectedSlug }
                ?.appTheme
            val churchBrand = appTheme?.let { theme ->
                ChurchBrandTheme(
                    light = ChurchBrandPalette(
                        primary = theme.light.primary,
                        accent = theme.light.accent,
                        accentSoft = theme.light.accentSoft,
                        onAccent = theme.light.onAccent,
                    ),
                    dark = ChurchBrandPalette(
                        primary = theme.dark.primary,
                        accent = theme.dark.accent,
                        accentSoft = theme.dark.accentSoft,
                        onAccent = theme.dark.onAccent,
                    ),
                )
            }
            FaithFormTheme(churchBrand = churchBrand) {
                FaithFormApp(
                    viewModel = viewModel,
                    container = container,
                    locationProvider = locationProvider,
                    cameraPermission = cameraPermission
                )
            }
        }

        // The first load of this view model, not of every rotation.
        viewModel.start()
    }

    override fun onDestroy() {
        (application as FaithFormApplication).container?.locationPermissions?.detach(launchLocationDialog)
        super.onDestroy()
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

/**
 * Builds the shell's view model from the container, once per Activity lifetime.
 *
 * The session-ended stream is wired here, so a 401 from any screen — or a
 * refresh token the identity provider refused — signs the person out through
 * the same path, whichever screen discovered it.
 */
class AppViewModelFactory(
    private val container: AppContainer,
    private val registry: RouteRegistry,
) : ViewModelProvider.Factory {
    override fun <T : ViewModel> create(modelClass: Class<T>): T {
        require(modelClass.isAssignableFrom(AppViewModel::class.java)) { "unknown view model $modelClass" }
        @Suppress("UNCHECKED_CAST")
        return AppViewModel(
            api = container.apiClient,
            sessions = container.sessionStore,
            cache = container.cache,
            environmentKey = container.environmentKey,
            auth = container.authClient,
            registry = registry,
            sessionEnded = container.sessionEnded,
            snapshots = container.snapshots,
        ) as T
    }
}
