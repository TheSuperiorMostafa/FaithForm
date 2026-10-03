package io.faithform.app.attendance

import android.app.PendingIntent
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import androidx.test.core.app.ApplicationProvider
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.shadows.ShadowPendingIntent

/**
 * The Android integration surface, on the real framework.
 *
 * `:app` previously had no test sources at all, so `:app:test` reported
 * `NO-SOURCE` — the adapters, the receivers and the manifest were verified only
 * by reading. Robolectric runs the actual framework on the JVM, so the merged
 * manifest, the `PendingIntent` flags and the receivers' exported state are
 * asserted against what the system would really see.
 *
 * This is deliberately **not** the pure-JVM decision layer under another name.
 * Every assertion here is about Android behaviour that `:core:attendance`
 * cannot reach.
 */
@RunWith(RobolectricTestRunner::class)
// A plain `Application`, not `FaithFormApplication`.
//
// The real one builds the whole container on create, including
// `EncryptedSharedPreferences` — and there is no `AndroidKeyStore` provider on
// a JVM, so every test in the class would die in `onCreate` before asserting
// anything. The manifest, the receivers and the `PendingIntent` are properties
// of the *package*, not of the application object, so substituting it removes
// an obstacle without weakening what is being checked.
@Config(sdk = [34], application = android.app.Application::class)
class ManifestAndReceiverTest {

    private val context: Context get() = ApplicationProvider.getApplicationContext()

    // -----------------------------------------------------------------------
    // The merged manifest
    // -----------------------------------------------------------------------

    @Test
    fun `the merged manifest declares exactly the permissions this feature needs`() {
        val info = context.packageManager.getPackageInfo(
            context.packageName,
            PackageManager.GET_PERMISSIONS,
        )
        val declared = info.requestedPermissions.orEmpty()
            .filter { it.startsWith("android.permission.") }
            .sorted()

        // Read from the *merged* manifest, so a permission pulled in by a
        // library — Play services, say — would fail this too.
        //
        // Every declared sensitive permission has an explicit opt-in feature.
        assertEquals(
            listOf(
                "android.permission.ACCESS_BACKGROUND_LOCATION",
                // Nearby churches and opt-in automatic attendance.
                "android.permission.ACCESS_COARSE_LOCATION",
                "android.permission.ACCESS_FINE_LOCATION",
                "android.permission.ACCESS_NETWORK_STATE",
                // Prompt 8. Requested only after an explicit tap on "Scan the
                // code" — asserted by `CameraPermissionTest`, which proves
                // nothing else can reach `requestPermission`.
                "android.permission.CAMERA",
                "android.permission.INTERNET",
                "android.permission.POST_NOTIFICATIONS",
                "android.permission.RECEIVE_BOOT_COMPLETED",
                "android.permission.WAKE_LOCK",
            ),
            declared,
        )
    }

    @Test
    fun `opt-in background attendance and notifications have their required permissions`() {
        val declared = context.packageManager
            .getPackageInfo(context.packageName, PackageManager.GET_PERMISSIONS)
            .requestedPermissions.orEmpty().toSet()

        for (deferred in listOf(
            // Background attendance requires the Play declaration and review video.
            "android.permission.ACCESS_BACKGROUND_LOCATION",
            "android.permission.RECEIVE_BOOT_COMPLETED",
            // Runtime permission is prompted only from the notification education view.
            "android.permission.POST_NOTIFICATIONS",
        )) {
            assertTrue("$deferred is missing", deferred in declared)
        }
    }

    @Test
    fun `no foreground-service or tracking permission was merged in`() {
        val declared = context.packageManager
            .getPackageInfo(context.packageName, PackageManager.GET_PERMISSIONS)
            .requestedPermissions.orEmpty().toSet()

        for (forbidden in listOf(
            "android.permission.FOREGROUND_SERVICE",
            "android.permission.FOREGROUND_SERVICE_LOCATION",
            "android.permission.ACTIVITY_RECOGNITION",
            "com.google.android.gms.permission.AD_ID",
            "android.permission.ACCESS_LOCATION_EXTRA_COMMANDS",
            // Prompt 8. FaithForm reads a string off a screen: it never opens
            // the photo library, never saves a frame, and CameraX must not
            // merge a media permission in on its behalf.
            "android.permission.READ_MEDIA_IMAGES",
            "android.permission.READ_MEDIA_VIDEO",
            "android.permission.READ_EXTERNAL_STORAGE",
            "android.permission.WRITE_EXTERNAL_STORAGE",
            "android.permission.RECORD_AUDIO",
        )) {
            assertFalse("$forbidden was merged in", forbidden in declared)
        }
    }

    @Test
    fun `only the private messaging service is declared by the app`() {
        val services = context.packageManager
            .getPackageInfo(context.packageName, PackageManager.GET_SERVICES)
            .services.orEmpty()

        // A permanent foreground service is the shape this feature exists to
        // avoid. The system does the monitoring and wakes a receiver.
        val own = services.filter { it.name.startsWith("io.faithform.app") }
        assertEquals(listOf("io.faithform.app.notifications.FaithFormMessagingService"), own.map { it.name })
        assertFalse(own.single().exported)
    }

    // -----------------------------------------------------------------------
    // Receiver registration
    // -----------------------------------------------------------------------

    @Test
    fun `geofence and package receivers are private and boot is system guarded`() {
        val receivers = context.packageManager.getPackageInfo(context.packageName, PackageManager.GET_RECEIVERS).receivers.orEmpty()
        val geofence = receivers.single { it.name == GeofenceBroadcastReceiver::class.java.name }
        val update = receivers.single { it.name == PackageReplacedReceiver::class.java.name }
        val boot = receivers.single { it.name == BootAndUpdateReceiver::class.java.name }
        assertFalse(geofence.exported)
        assertFalse(update.exported)
        assertTrue(boot.exported)
        assertEquals("android.permission.RECEIVE_BOOT_COMPLETED", boot.permission)
        assertFalse(boot.directBootAware)
    }

    @Test
    fun `only unlocked boot and package update resolve to the restore receivers`() {
        for (action in listOf(Intent.ACTION_BOOT_COMPLETED, Intent.ACTION_MY_PACKAGE_REPLACED)) {
            val matches = context.packageManager.queryBroadcastReceivers(Intent(action), 0)
            assertTrue("$action has no restore receiver", matches.any { it.activityInfo.packageName == context.packageName })
        }
        val locked = context.packageManager.queryBroadcastReceivers(Intent(Intent.ACTION_LOCKED_BOOT_COMPLETED), 0)
        assertTrue(locked.none { it.activityInfo.name.startsWith("io.faithform.app") })
    }

    // -----------------------------------------------------------------------
    // The PendingIntent
    // -----------------------------------------------------------------------

    @Test
    fun `the geofence PendingIntent is mutable, updating, and explicitly targeted`() {
        val monitor = PlayServicesRegionMonitoring(
            context,
            mirrorPreferences = context.getSharedPreferences("mirror_pi", Context.MODE_PRIVATE),
        )
        val pending = monitor.pendingIntentForTest()

        val shadow = org.robolectric.Shadows.shadowOf(pending) as ShadowPendingIntent

        // Explicit component: Play services may add the transition extras, but
        // cannot redirect the intent anywhere else.
        val intent = shadow.savedIntent
        assertEquals(
            GeofenceBroadcastReceiver::class.java.name,
            intent.component?.className,
        )
        assertEquals(GeofenceBroadcastReceiver.ACTION_TRANSITION, intent.action)

        // FLAG_MUTABLE is required from API 31 *and* by the geofencing API,
        // which fills in the extras. An immutable intent silently delivers
        // nothing at all.
        val flags = shadow.flags
        assertTrue("FLAG_MUTABLE missing", flags and PendingIntent.FLAG_MUTABLE != 0)
        assertTrue("FLAG_IMMUTABLE set", flags and PendingIntent.FLAG_IMMUTABLE == 0)
        // Both addGeofences and removeGeofences must address the same intent.
        assertTrue(
            "FLAG_UPDATE_CURRENT missing",
            flags and PendingIntent.FLAG_UPDATE_CURRENT != 0,
        )
        assertTrue(shadow.isBroadcastIntent)
    }

    @Test
    @Config(sdk = [30], application = android.app.Application::class)
    fun `on API 30 the PendingIntent omits FLAG_MUTABLE, which did not exist`() {
        val monitor = PlayServicesRegionMonitoring(
            context,
            mirrorPreferences = context.getSharedPreferences("mirror_pi", Context.MODE_PRIVATE),
        )
        val shadow = org.robolectric.Shadows.shadowOf(monitor.pendingIntentForTest())
                as ShadowPendingIntent

        // FLAG_MUTABLE arrived in API 31. Setting it below that is not merely
        // pointless — the constant's bit is undefined there.
        assertTrue(shadow.flags and PendingIntent.FLAG_UPDATE_CURRENT != 0)
        assertEquals(
            GeofenceBroadcastReceiver::class.java.name,
            shadow.savedIntent.component?.className,
        )
    }

    @Test
    fun `the same PendingIntent is returned for add and remove`() {
        val monitor = PlayServicesRegionMonitoring(
            context,
            mirrorPreferences = context.getSharedPreferences("mirror_pi", Context.MODE_PRIVATE),
        )
        // A different request code or a different intent would mean
        // `removeGeofences` addressed a registration that does not exist, and
        // the geofences would quietly survive a teardown.
        assertEquals(monitor.pendingIntentForTest(), monitor.pendingIntentForTest())
    }
}
