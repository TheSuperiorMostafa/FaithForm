package io.faithform.app.attendance

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

private val FINE_AND_ALWAYS = LocationPermissionState(
    foreground = ForegroundLocationPermission.Fine,
    background = BackgroundLocationPermission.Granted,
    strategy = BackgroundRequestStrategy.SettingsOnly,
)

private val NOTHING_YET = LocationPermissionState(
    foreground = ForegroundLocationPermission.NotRequested,
    background = BackgroundLocationPermission.NotRequested,
    strategy = BackgroundRequestStrategy.SettingsOnly,
)

private fun record(enabled: Boolean = true, refusal: String? = null) = AutomaticAttendanceRecord(
    enabled = enabled,
    serverConsent = if (enabled) "granted" else "unset",
    accountId = "acct-1",
    environment = "test",
    churches = listOf(ChurchName("grace", "Grace Church")),
    monitoring = if (enabled) 1 else 0,
    monitoringRefusal = refusal,
)

// ---------------------------------------------------------------------------
// The setup journey
// ---------------------------------------------------------------------------

class JourneyTest {

    @Test
    fun `the journey always starts with what the feature does and does not do`() {
        for (state in listOf(NOTHING_YET, FINE_AND_ALWAYS)) {
            assertEquals(
                SetupScreen.Introduction,
                AutomaticAttendanceJourney.next(null, state, NotificationAccess.NotRequested),
            )
        }
    }

    @Test
    fun `from nothing granted it is introduction, location, disclosure, notifications`() {
        val afterIntro = AutomaticAttendanceJourney.next(
            SetupScreen.Introduction, NOTHING_YET, NotificationAccess.NotRequested,
        )
        assertEquals(SetupScreen.ForegroundEducation, afterIntro)

        // Foreground granted: the prominent disclosure comes before background.
        val foregroundOnly = NOTHING_YET.copy(foreground = ForegroundLocationPermission.Fine)
        assertEquals(
            SetupScreen.BackgroundDisclosure,
            AutomaticAttendanceJourney.next(SetupScreen.ForegroundEducation, foregroundOnly, NotificationAccess.NotRequested),
        )

        assertEquals(
            SetupScreen.NotificationEducation,
            AutomaticAttendanceJourney.next(SetupScreen.BackgroundDisclosure, FINE_AND_ALWAYS, NotificationAccess.NotRequested),
        )
        assertEquals(
            SetupScreen.Status,
            AutomaticAttendanceJourney.next(SetupScreen.NotificationEducation, FINE_AND_ALWAYS, NotificationAccess.Denied),
        )
    }

    @Test
    fun `granted steps are skipped, never shown again`() {
        assertEquals(
            SetupScreen.Status,
            AutomaticAttendanceJourney.next(SetupScreen.Introduction, FINE_AND_ALWAYS, NotificationAccess.Granted),
        )
        // Below Android 13 there is no notification step at all.
        assertEquals(
            SetupScreen.Status,
            AutomaticAttendanceJourney.next(SetupScreen.Introduction, FINE_AND_ALWAYS, NotificationAccess.NotRequired),
        )
    }

    @Test
    fun `a declined dialog goes to the status screen, not back to its explanation`() {
        // Foreground declined.
        assertEquals(
            SetupScreen.Status,
            AutomaticAttendanceJourney.next(
                SetupScreen.ForegroundEducation,
                NOTHING_YET.copy(foreground = ForegroundLocationPermission.Denied),
                NotificationAccess.NotRequested,
            ),
        )
        // Approximate chosen: not Fine, so no background request follows.
        assertEquals(
            SetupScreen.Status,
            AutomaticAttendanceJourney.next(
                SetupScreen.ForegroundEducation,
                NOTHING_YET.copy(foreground = ForegroundLocationPermission.Coarse),
                NotificationAccess.NotRequested,
            ),
        )
        // "Allow all the time" not chosen in Settings.
        assertEquals(
            SetupScreen.Status,
            AutomaticAttendanceJourney.next(
                SetupScreen.BackgroundDisclosure,
                FINE_AND_ALWAYS.copy(background = BackgroundLocationPermission.Denied),
                NotificationAccess.NotRequested,
            ),
        )
    }

    @Test
    fun `a device that cannot run the feature goes straight to the status screen`() {
        for (state in listOf(
            NOTHING_YET.copy(playServicesAvailable = false),
            NOTHING_YET.copy(locationServicesEnabled = false),
        )) {
            assertEquals(
                SetupScreen.Status,
                AutomaticAttendanceJourney.next(SetupScreen.Introduction, state, NotificationAccess.NotRequested),
            )
        }
    }

    @Test
    fun `a permanent denial is not asked again from the journey`() {
        assertEquals(
            SetupScreen.Status,
            AutomaticAttendanceJourney.next(
                SetupScreen.Introduction,
                NOTHING_YET.copy(foreground = ForegroundLocationPermission.PermanentlyDenied),
                NotificationAccess.NotRequested,
            ),
        )
        assertEquals(
            SetupScreen.Status,
            AutomaticAttendanceJourney.next(
                SetupScreen.Introduction,
                FINE_AND_ALWAYS.copy(background = BackgroundLocationPermission.PermanentlyDenied),
                NotificationAccess.NotRequested,
            ),
        )
    }

    @Test
    fun `on Android 10 and below the disclosure still comes before the request`() {
        val android10 = NOTHING_YET.copy(
            foreground = ForegroundLocationPermission.Fine,
            strategy = BackgroundRequestStrategy.RuntimeDialog,
        )
        assertEquals(
            SetupScreen.BackgroundDisclosure,
            AutomaticAttendanceJourney.next(SetupScreen.ForegroundEducation, android10, NotificationAccess.NotRequired),
        )
        // Below API 29 foreground is enough: no disclosure, no request.
        val legacy = android10.copy(
            background = BackgroundLocationPermission.NotApplicable,
            strategy = BackgroundRequestStrategy.ImpliedByForeground,
        )
        assertEquals(
            SetupScreen.Status,
            AutomaticAttendanceJourney.next(SetupScreen.ForegroundEducation, legacy, NotificationAccess.NotRequired),
        )
    }
}

// ---------------------------------------------------------------------------
// Permission state to what the status screen shows and offers
// ---------------------------------------------------------------------------

class StatusResolverTest {

    private fun resolve(
        record: AutomaticAttendanceRecord = record(),
        permissions: LocationPermissionState = FINE_AND_ALWAYS,
        notifications: NotificationAccess = NotificationAccess.Granted,
        requiresConfirmation: Boolean = false,
        resolvable: Boolean = false,
    ) = AutomaticAttendanceStatusResolver.resolve(
        record, permissions, notifications, requiresConfirmation, playServicesResolvable = resolvable,
    )

    @Test
    fun `on, with everything in place, offers turn off and no fix`() {
        val status = resolve()
        assertTrue(status.isOn)
        assertEquals(AttendanceFix.None, status.fix)
        assertTrue(status.canTurnOff)
        assertEquals(1, status.monitoring)
    }

    @Test
    fun `off is off, whatever location was granted for something else`() {
        for (permissions in listOf(
            FINE_AND_ALWAYS,
            NOTHING_YET,
            NOTHING_YET.copy(foreground = ForegroundLocationPermission.Coarse),
            FINE_AND_ALWAYS.copy(background = BackgroundLocationPermission.Denied),
            FINE_AND_ALWAYS.copy(locationServicesEnabled = false),
        )) {
            val status = resolve(record = record(enabled = false), permissions = permissions)
            assertEquals("$permissions", AutomaticAttendanceStep.NotStarted, status.step)
            assertEquals(AttendanceFix.TurnOn, status.fix)
            assertFalse(status.canTurnOff)
            // Nothing about notifications is asked while the feature is off.
            assertEquals(AttendanceFix.None, status.notificationFix)
        }
    }

    @Test
    fun `every permission problem maps to its own single fix`() {
        val cases = listOf(
            NOTHING_YET.copy(foreground = ForegroundLocationPermission.Denied) to AttendanceFix.RequestForeground,
            NOTHING_YET.copy(foreground = ForegroundLocationPermission.PermanentlyDenied) to AttendanceFix.OpenAppSettings,
            NOTHING_YET.copy(foreground = ForegroundLocationPermission.NotRequested) to AttendanceFix.RequestForeground,
            FINE_AND_ALWAYS.copy(foreground = ForegroundLocationPermission.Coarse) to AttendanceFix.RequestPrecise,
            FINE_AND_ALWAYS.copy(background = BackgroundLocationPermission.NotRequested) to AttendanceFix.AllowBackground,
            FINE_AND_ALWAYS.copy(background = BackgroundLocationPermission.Denied) to AttendanceFix.AllowBackground,
            FINE_AND_ALWAYS.copy(background = BackgroundLocationPermission.PermanentlyDenied) to AttendanceFix.OpenAppSettings,
            FINE_AND_ALWAYS.copy(locationServicesEnabled = false) to AttendanceFix.OpenLocationSettings,
        )
        for ((permissions, fix) in cases) {
            val status = resolve(permissions = permissions)
            assertFalse("$permissions reads as on", status.isOn)
            assertEquals("$permissions", fix, status.fix)
        }
    }

    @Test
    fun `Play services offers its own dialog only when it can actually fix itself`() {
        val missing = FINE_AND_ALWAYS.copy(playServicesAvailable = false)
        assertEquals(AttendanceFix.ResolvePlayServices, resolve(permissions = missing, resolvable = true).fix)
        assertEquals(AttendanceFix.None, resolve(permissions = missing, resolvable = false).fix)
    }

    @Test
    fun `church problems offer no button that leads nowhere`() {
        for (refusal in listOf("no_people_link", "geofence_disabled", "no_campus_configured")) {
            val status = resolve(record = record(refusal = refusal))
            assertFalse(status.isOn)
            assertEquals(refusal, AttendanceFix.None, status.fix)
            // Still the person's choice: they can turn it off.
            assertTrue(status.canTurnOff)
        }
        assertEquals(AttendanceFix.TryAgain, resolve(record = record(refusal = "configuration_unavailable")).fix)
    }

    @Test
    fun `notifications are asked for once on, and sent to Settings only when a church needs to ask`() {
        assertEquals(
            AttendanceFix.RequestNotifications,
            resolve(notifications = NotificationAccess.NotRequested).notificationFix,
        )
        assertEquals(
            AttendanceFix.OpenNotificationSettings,
            resolve(notifications = NotificationAccess.Denied, requiresConfirmation = true).notificationFix,
        )
        // Declining is a real choice when every church counts on arrival.
        assertEquals(
            AttendanceFix.None,
            resolve(notifications = NotificationAccess.Denied, requiresConfirmation = false).notificationFix,
        )
        assertEquals(AttendanceFix.None, resolve(notifications = NotificationAccess.NotRequired).notificationFix)
    }

    @Test
    fun `a pending question is shown only while the feature is on`() {
        val question = PendingConfirmation("grace", "occ-1", 0)
        val on = resolve(record = record().copy(pendingConfirmation = question))
        assertEquals("Grace Church", on.pendingChurchName)

        val off = resolve(record = record(enabled = false).copy(pendingConfirmation = question))
        assertNull(off.pendingConfirmation)
    }

    @Test
    fun `the next service is shown only when check-in is actually on`() {
        val next = NextService("grace", "Grace Church", "Sunday", 0, 0, false)
        assertEquals(next, AutomaticAttendanceStatusResolver.resolve(
            record(), FINE_AND_ALWAYS, NotificationAccess.Granted, false, next,
        ).nextService)
        assertNull(AutomaticAttendanceStatusResolver.resolve(
            record(), FINE_AND_ALWAYS.copy(locationServicesEnabled = false), NotificationAccess.Granted, false, next,
        ).nextService)
    }
}
