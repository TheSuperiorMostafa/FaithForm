package io.faithform.app.host

import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * What a Play-bound build is configured to do, read from the build script that
 * produces it.
 *
 * A build script cannot be instantiated from a unit test, and the behaviour that
 * matters — a release build that refuses to configure without its values — was
 * exercised by hand with `--dry-run` when it was written. What this holds in
 * place are the properties a later edit could quietly undo: the release origin
 * default, the absence of a staging default, where signing material comes from,
 * and that no credential is ever written into the repository.
 */
class ReleaseBuildTest {

    private val script = File("build.gradle.kts").readText()

    /** Code only: the comments explain the old behaviour and name the variables. */
    private val code = script.lines()
        .filterNot { it.trimStart().startsWith("*") || it.trimStart().startsWith("//") || it.trimStart().startsWith("/**") }
        .joinToString("\n")

    @Test
    fun `release points at production unless told otherwise`() {
        assertTrue(
            code.contains("""?.takeIf { it.isNotBlank() } ?: "https://faithform.io").trim()"""),
        )
    }

    @Test
    fun `staging has no default origin`() {
        // A default here would be a guess about somebody's infrastructure, and a
        // staging build that guessed production would write to real churches.
        val staging = code.lines().first { it.contains("val stagingOrigin") }
        assertFalse(staging.contains("https://"))
        assertTrue(staging.contains(".orEmpty()"))
    }

    @Test
    fun `shippable builds are checked at configuration for origin and identity provider`() {
        assertTrue(code.contains("""requireShippable("release", releaseOrigin, "faithform.releaseOrigin")"""))
        assertTrue(code.contains("""requireShippable("staging", stagingOrigin, "faithform.stagingOrigin")"""))
        val check = code.substringAfter("fun requireShippable").substringBefore("\n}\n")
        for (required in listOf("origin.isBlank()", "https://", "supabaseUrl.isBlank()", "supabaseAnonKey.isBlank()", "GradleException")) {
            assertTrue("requireShippable no longer checks $required", check.contains(required))
        }
    }

    @Test
    fun `a debug build and the test task are never held to release configuration`() {
        // CI runs `./gradlew test` and `:app:assembleDebug` with no
        // local.properties. Only a task that produces a release or staging
        // artifact may trip the check.
        val predicate = code.substringAfter("fun producesArtifact").substringBefore("\n\n")
        assertFalse(predicate.contains("\"test\""))
        assertFalse(predicate.contains("\"debug\""))
        assertTrue(predicate.contains("gradle.startParameter.taskNames"))
    }

    @Test
    fun `the upload key comes from four environment variables and nothing else`() {
        val names = Regex("""providers\.environmentVariable\("([A-Z_]+)"\)""")
            .findAll(code).map { it.groupValues[1] }.toList()
        assertEquals(
            listOf(
                "FAITHFORM_UPLOAD_KEYSTORE",
                "FAITHFORM_UPLOAD_KEYSTORE_PASSWORD",
                "FAITHFORM_UPLOAD_KEY_ALIAS",
                "FAITHFORM_UPLOAD_KEY_PASSWORD",
            ),
            names,
        )
        // Signing is attached only when all four are present, so an unsigned
        // bundle is still a successful CI build.
        assertTrue(code.contains("if (hasUploadSigning) signingConfig = signingConfigs.getByName(\"upload\")"))
    }

    @Test
    fun `no password, keystore or key alias is written into the repository`() {
        for (file in listOf(File("build.gradle.kts"), File("../gradle.properties"), File("proguard-rules.pro"))) {
            val text = file.readText()
            assertFalse("${file.name} names a keystore file", Regex("""\.(jks|keystore)"""").containsMatchIn(text))
            assertFalse("${file.name} sets a password", Regex("""(store|key)Password\s*=\s*"""").containsMatchIn(text))
        }
        // And no keystore of any kind sits in the module.
        val keystores = File(".").walkTopDown()
            .onEnter { it.name != "build" }
            .filter { it.extension in setOf("jks", "keystore") }
            .toList()
        assertTrue("keystores in the module: $keystores", keystores.isEmpty())
    }

    @Test
    fun `release is shrunk and its mapping is kept for Play`() {
        val release = code.substringAfter("        release {").substringBefore("\n        }\n")
        assertTrue(release.contains("isMinifyEnabled = true"))
        assertTrue(release.contains("isShrinkResources = true"))
        assertTrue(release.contains("\"proguard-rules.pro\""))
        // Nothing turns off the mapping file AGP embeds in the bundle.
        assertFalse(script.contains("-dontobfuscate"))
        assertFalse(File("proguard-rules.pro").readText().contains("-printmapping /dev/null"))
    }

    @Test
    fun `every FaithForm wire type survives R8`() {
        val rules = File("proguard-rules.pro").readText()
        // Wider than the contract package on purpose: request and reply types
        // also live in network, session, ui and the feature modules.
        assertTrue(rules.contains("-keepclasseswithmembers class io.faithform.app.** {"))
        assertTrue(rules.contains("kotlinx.serialization.KSerializer serializer(...);"))
        assertTrue(rules.contains("-keepattributes *Annotation*, InnerClasses, Signature, EnclosingMethod"))
    }

    @Test
    fun `the app targets and compiles against the API level Play requires`() {
        assertTrue(code.contains("compileSdk = 36"))
        assertTrue(code.contains("targetSdk = 36"))
    }
}
