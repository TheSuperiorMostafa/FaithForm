package io.faithform.app.host

import io.faithform.app.AppEnvironment
import io.faithform.app.AppEnvironmentLoader
import io.faithform.app.navigation.Destination
import io.faithform.app.navigation.RouteRegistry
import io.faithform.app.navigation.RouteResolution
import io.faithform.app.navigation.SessionSnapshot
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * What the **app** composes, as opposed to what a core module computes.
 *
 * Plain JUnit, for the reason `:app` learned the hard way with Media3 and again
 * with Stripe: instrumenting a large classpath is slow at best and hangs at
 * worst, and the response is to keep decisions out of `:app` rather than to work
 * around the runner. What is left here reads compile-time values and the source
 * that ships.
 */
class AppEnvironmentTest {

    private fun load(
        key: String = "staging",
        origin: String = "https://staging.example.test",
        build: Int = 1,
        debug: Boolean = false,
    ) = AppEnvironmentLoader.load(key, origin, build, debug)

    @Test
    fun `a configured build resolves to its own origin`() {
        val environment = load() as AppEnvironment.Configured
        assertEquals("staging", environment.environmentKey)
        assertEquals("https://staging.example.test", environment.apiOrigin)
        assertEquals(1, environment.clientBuild)
        assertFalse(environment.allowsDebugControls)
    }

    @Test
    fun `a missing origin fails closed rather than falling back to production`() {
        // **The loader never guesses.** The release build type now supplies
        // `https://faithform.io` at build time and a shippable build refuses to
        // configure without an origin (see `ReleaseBuildTest`), but this runtime
        // check stays independent of that: whatever reaches the phone empty
        // fails closed here rather than falling back to production.
        val result = load(origin = "") as AppEnvironment.Unconfigured
        assertTrue(result.reason.contains("API_ORIGIN"))
        assertFalse("the reason named a fallback", result.reason.contains("faithform.io"))
    }

    @Test
    fun `whitespace is the same as missing`() {
        assertTrue(load(origin = "   ") is AppEnvironment.Unconfigured)
    }

    @Test
    fun `cleartext is refused outside development`() {
        for (key in listOf("staging", "production")) {
            assertTrue(
                "$key accepted an http origin",
                load(key = key, origin = "http://example.test") is AppEnvironment.Unconfigured,
            )
        }
        // A developer pointing an emulator at a laptop is the one legitimate case.
        assertTrue(
            load(key = "development", origin = "http://10.0.2.2:3000")
                is AppEnvironment.Configured,
        )
    }

    @Test
    fun `a client build that cannot be read is not defaulted`() {
        // The server refuses builds it no longer supports. Guessing one would
        // make an unsupported build look supported.
        assertTrue(load(build = 0) is AppEnvironment.Unconfigured)
        assertTrue(load(build = -3) is AppEnvironment.Unconfigured)
    }

    @Test
    fun `an unrecognised scheme is refused`() {
        assertTrue(load(origin = "ftp://example.test") is AppEnvironment.Unconfigured)
        assertTrue(load(origin = "example.test") is AppEnvironment.Unconfigured)
    }

    @Test
    fun `both platforms make the same decisions about the same inputs`() {
        // The Swift suite drives these exact cases. A platform that disagreed
        // would point one app somewhere the other refused.
        val cases = listOf(
            Triple("staging", "", false),
            Triple("staging", "http://example.test", false),
            Triple("production", "http://example.test", false),
            Triple("development", "http://localhost:3000", true),
            Triple("production", "https://example.test", true),
        )
        for ((key, origin, shouldConfigure) in cases) {
            val configured = load(key = key, origin = origin) is AppEnvironment.Configured
            assertEquals("$key + $origin", shouldConfigure, configured)
        }
    }
}

class AppNavigationTest {

    /** Mirrors what `MainActivity` registers. */
    private val implemented = setOf(
        "home", "account", "accountPrivacy", "discover", "church",
        "announcements", "watch", "give", "checkIn", "sermons",
    )

    private val registry = RouteRegistry(implemented = implemented)

    private fun session(
        capabilities: Set<String>,
        access: Map<String, Boolean> = mapOf("grace" to true),
        blocked: Set<String> = emptySet(),
    ) = SessionSnapshot(
        isAuthenticated = true,
        capabilities = capabilities,
        churchAccess = access,
        blockedChurches = blocked,
    )

    @Test
    fun `sermons has a screen and opens when the server enables it`() {
        // Prompt 10, built at last: `SermonScreens` is the screen behind this
        // and `ENABLED_CAPABILITIES` publishes `sermons`.
        assertTrue("sermons" in implemented)
        val resolution = registry.resolve(
            Destination.SermonArchive("grace"),
            session(setOf("sermons")),
        )
        assertTrue(resolution is RouteResolution.Allowed)
    }

    @Test
    fun `sermons still closes for a church whose server withholds the capability`() {
        // Having a screen is not the same as being switched on: a church on an
        // older server, or one with the feature off, must still be refused.
        val resolution = registry.resolve(
            Destination.SermonArchive("grace"),
            session(setOf("watch")),
        )
        assertTrue(resolution is RouteResolution.Rejected)
    }

    @Test
    fun `a capability the server has not enabled closes the route`() {
        // The gate that was working on the wrong input: attendance and giving
        // were built and never listed in ENABLED_CAPABILITIES.
        val without = registry.resolve(Destination.Give("grace"), session(setOf("account")))
        assertTrue(without is RouteResolution.Rejected)

        val with = registry.resolve(Destination.Give("grace"), session(setOf("giving")))
        assertTrue(with is RouteResolution.Allowed)
    }

    @Test
    fun `a revoked relationship closes every church-scoped route`() {
        val revoked = session(setOf("watch", "giving", "attendance"), access = mapOf("grace" to false))
        for (destination in listOf(
            Destination.Watch("grace"),
            Destination.Give("grace"),
            Destination.CheckIn("grace"),
        )) {
            assertTrue(
                "$destination stayed open after revocation",
                registry.resolve(destination, revoked) is RouteResolution.Rejected,
            )
        }
    }

    @Test
    fun `a blocked church is refused before anything else`() {
        val blocked = session(
            setOf("watch"),
            access = mapOf("grace" to true),
            blocked = setOf("grace"),
        )
        assertTrue(registry.resolve(Destination.Watch("grace"), blocked) is RouteResolution.Rejected)
    }
}

class AppManifestTest {

    /**
     * Comments stripped.
     *
     * The manifest documents at length which permissions are *deliberately
     * absent* — and a sweep that read those explanations as declarations would
     * fail on the prose that exists to reassure a reader. The same mistake the
     * Prompt 9 sweeps made twice.
     */
    private val manifest = File("src/main/AndroidManifest.xml")
        .readText()
        .replace(Regex("<!--[\\s\\S]*?-->"), "")

    @Test
    fun `the manifest declares exactly the permissions the app implements`() {
        // A declared permission is a promise. Each of these names a feature that
        // exists; the absent ones name features that do not.
        for (required in listOf(
            "android.permission.INTERNET",
                "android.permission.WAKE_LOCK",
            "android.permission.CAMERA",
            "android.permission.ACCESS_FINE_LOCATION",
        )) {
            assertTrue("$required is missing", manifest.contains(required))
        }

        for (absent in listOf(
            "READ_MEDIA_IMAGES",
            "READ_EXTERNAL_STORAGE",
            "WRITE_EXTERNAL_STORAGE",
            "RECORD_AUDIO",
            "READ_CONTACTS",
            "FOREGROUND_SERVICE",
            "ACTIVITY_RECOGNITION",
            "AD_ID",
            "QUERY_ALL_PACKAGES",
            // Features that exist in source and are not in v1: automatic
            // attendance (background location, boot re-registration) and push.
            "ACCESS_BACKGROUND_LOCATION",
            "RECEIVE_BOOT_COMPLETED",
            "POST_NOTIFICATIONS",
        )) {
            val permissions = Regex("<uses-permission[^>]*>").findAll(manifest)
                .map { it.value }.filterNot { it.contains("tools:node=\"remove\"") }.joinToString()
            assertFalse("$absent is declared and nothing needs it", permissions.contains(absent))
        }
    }

    @Test
    fun `deep links are custom-scheme only and fail closed`() {
        // An https App Link needs a verified Digital Asset Links file on a
        // domain this repository does not establish. Declaring one anyway would
        // claim a domain the app cannot prove it owns — and Android would hand
        // it a link it could not verify.
        assertTrue(manifest.contains("android:scheme=\"faithform\""))
        assertFalse("an unverified https App Link is declared", manifest.contains("android:scheme=\"https\""))
        assertFalse(manifest.contains("android:autoVerify=\"true\""))
    }

    @Test
    fun `no receiver can be reached by another app, because v1 registers none`() {
        // Automatic attendance is not in v1, so nothing that could be woken by
        // a broadcast is declared. Its receivers return with the feature.
        assertFalse(manifest.contains("<receiver"))
    }

    @Test
    fun `the Open Mail button can see a mail app on Android 11 and later`() {
        // Without a <queries> entry, resolveActivity returns null on API 30+
        // and the button on the check-your-email screen is never shown.
        val queries = manifest.substringAfter("<queries>").substringBefore("</queries>")
        assertTrue(queries.contains("android.intent.action.MAIN"))
        assertTrue(queries.contains("android.intent.category.APP_EMAIL"))
    }

    @Test
    fun `cleartext traffic is off`() {
        assertTrue(manifest.contains("android:usesCleartextTraffic=\"false\""))
        assertTrue(manifest.contains("android:networkSecurityConfig"))
    }

    @Test
    fun `the shipped network security config permits no cleartext and no user CAs`() {
        val main = File("src/main/res/xml/network_security_config.xml").readText()
            .replace(Regex("<!--[\\s\\S]*?-->"), "")
        assertTrue(main.contains("cleartextTrafficPermitted=\"false\""))
        assertFalse("release permits cleartext somewhere", main.contains("cleartextTrafficPermitted=\"true\""))
        assertFalse("release trusts user-installed CAs", main.contains("src=\"user\""))
        assertFalse(main.contains("<domain-config"))
    }

    @Test
    fun `only the debug build may speak cleartext, and only to the emulator host`() {
        val debug = File("src/debug/res/xml/network_security_config.xml").readText()
            .replace(Regex("<!--[\\s\\S]*?-->"), "")
        val domains = Regex("<domain[^>]*>([^<]+)</domain>").findAll(debug).map { it.groupValues[1].trim() }.toList()
        assertEquals(listOf("10.0.2.2"), domains)
        assertTrue(debug.contains("<base-config cleartextTrafficPermitted=\"false\">"))
        // No staging or release source set may carry an override of its own.
        for (variant in listOf("release", "staging")) {
            assertFalse(
                "$variant overrides the network security config",
                File("src/$variant/res/xml/network_security_config.xml").exists(),
            )
        }
    }
}
