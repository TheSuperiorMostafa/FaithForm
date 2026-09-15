import java.util.Properties

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.compose.compiler)
    alias(libs.plugins.kotlin.serialization)
}

/**
 * Where a staging or release build points.
 *
 * **Release defaults to `https://faithform.io`; staging has no default.**
 *
 * This file used to leave both empty, so that a build nobody had pointed would
 * show the "FaithForm isn't set up" screen instead of reaching production. That
 * protected against the wrong thing. A staging build silently writing to real
 * churches is the danger, and staging still has no default. A *release* build
 * has exactly one correct origin, and leaving it blank did not make anyone
 * think harder about it — it made it possible to upload an app to Google Play
 * that could do nothing but apologise.
 *
 * Both are overridable with `-Pfaithform.releaseOrigin=…` /
 * `-Pfaithform.stagingOrigin=…`, and both are checked below: a shippable build
 * with a blank or non-https origin now fails at configuration time, before a
 * line compiles, rather than producing an APK that fails closed on a phone.
 */
val stagingOrigin = (project.findProperty("faithform.stagingOrigin") as String?).orEmpty().trim()
val releaseOrigin = ((project.findProperty("faithform.releaseOrigin") as String?)
    ?.takeIf { it.isNotBlank() } ?: "https://faithform.io").trim()

/**
 * The identity provider. Both values are public by design — Supabase publishes
 * them for clients, and neither authorises anything on its own — but they name
 * a particular project, so they stay out of the repository: supplied with
 * `-Pfaithform.supabaseUrl=… -Pfaithform.supabaseAnonKey=…`, or for local work
 * from `local.properties` (gitignored), mirroring iOS's `Local.xcconfig`.
 *
 * In a debug build, empty still fails closed at runtime: the sign-in screen
 * renders and submitting says what is missing. A staging or release build with
 * either one empty does not configure at all — see [requireShippable].
 */
val localProperties = Properties().apply {
    val file = rootProject.file("local.properties")
    if (file.exists()) file.inputStream().use { stream -> load(stream) }
}

fun configValue(name: String): String =
    ((project.findProperty(name) as String?)
        ?: localProperties.getProperty(name).orEmpty()).trim()

val supabaseUrl = configValue("faithform.supabaseUrl")
val supabaseAnonKey = configValue("faithform.supabaseAnonKey")

/**
 * Whether this invocation will produce an installable artifact of [buildType].
 *
 * Read from the requested task names, which Gradle knows before configuration
 * and which are part of the configuration-cache key, so the answer can never be
 * stale. `./gradlew test` and `:app:assembleDebug` configure every build type
 * too; they must keep working on a CI runner with no `local.properties`, so
 * they are not shippable requests. `assembleRelease`, `bundleRelease`,
 * `installStaging` and a bare `assemble`/`bundle`/`build` are.
 */
fun producesArtifact(buildType: String): Boolean =
    gradle.startParameter.taskNames
        .map { it.substringAfterLast(':').lowercase() }
        .any { task ->
            task in setOf("assemble", "bundle", "build") ||
                (listOf("assemble", "bundle", "package", "install", "publish", "upload")
                    .any { task.startsWith(it) } && task.contains(buildType))
        }

/**
 * Refuses to configure a shippable build that could only fail closed.
 *
 * The runtime check in `AppEnvironment` is still there and still right for a
 * developer's debug build. For an artifact headed to testers or to Play, the
 * same mistake is caught here instead — with a message naming the missing
 * property — because an APK that opens to "isn't set up" has already been
 * uploaded by the time anyone sees that screen.
 */
fun requireShippable(buildType: String, origin: String, originProperty: String) {
    if (!producesArtifact(buildType)) return
    val problems = buildList {
        if (origin.isBlank()) add("$originProperty is empty")
        else if (!origin.startsWith("https://")) add("$originProperty must be an https origin")
        if (supabaseUrl.isBlank()) add("faithform.supabaseUrl is empty")
        if (supabaseAnonKey.isBlank()) add("faithform.supabaseAnonKey is empty")
    }
    if (problems.isNotEmpty()) {
        throw GradleException(
            "FaithForm $buildType build is not configured: ${problems.joinToString("; ")}. " +
                "Pass -P<name>=<value>, or set the Supabase values in local.properties.",
        )
    }
}

requireShippable("release", releaseOrigin, "faithform.releaseOrigin")
requireShippable("staging", stagingOrigin, "faithform.stagingOrigin")

/**
 * The upload key, from the environment and nowhere else.
 *
 * Google Play App Signing holds the real app-signing key; what a build signs
 * with is the *upload* key, which Play can reset if it is lost. Its path and
 * passwords come from four environment variables so that none of them can be
 * committed, echoed into a build log by a `-P` flag, or left in
 * `gradle.properties`:
 *
 *   FAITHFORM_UPLOAD_KEYSTORE           absolute path to the .jks / .keystore
 *   FAITHFORM_UPLOAD_KEYSTORE_PASSWORD
 *   FAITHFORM_UPLOAD_KEY_ALIAS
 *   FAITHFORM_UPLOAD_KEY_PASSWORD
 *
 * All four or nothing. With none set, `bundleRelease` still succeeds and
 * produces an **unsigned** bundle — useful on CI, not accepted by Play — and
 * says so in the build output rather than silently.
 */
val uploadKeystore = providers.environmentVariable("FAITHFORM_UPLOAD_KEYSTORE").orNull
val uploadKeystorePassword = providers.environmentVariable("FAITHFORM_UPLOAD_KEYSTORE_PASSWORD").orNull
val uploadKeyAlias = providers.environmentVariable("FAITHFORM_UPLOAD_KEY_ALIAS").orNull
val uploadKeyPassword = providers.environmentVariable("FAITHFORM_UPLOAD_KEY_PASSWORD").orNull
val uploadSigningValues = listOf(uploadKeystore, uploadKeystorePassword, uploadKeyAlias, uploadKeyPassword)
val hasUploadSigning = uploadSigningValues.all { !it.isNullOrBlank() }

val shipping = producesArtifact("release") || producesArtifact("staging")
if (shipping && !hasUploadSigning && uploadSigningValues.any { !it.isNullOrBlank() }) {
    // Half a signing configuration is a typo, not a choice. Building unsigned
    // anyway would fail later, at upload, with a far less useful message. A
    // debug build does not sign with the upload key, so it is not held to it.
    throw GradleException(
        "FaithForm upload signing is partially configured: set all four of " +
            "FAITHFORM_UPLOAD_KEYSTORE, FAITHFORM_UPLOAD_KEYSTORE_PASSWORD, " +
            "FAITHFORM_UPLOAD_KEY_ALIAS and FAITHFORM_UPLOAD_KEY_PASSWORD, or none.",
    )
}
if (shipping && !hasUploadSigning) {
    logger.lifecycle(
        "FaithForm: FAITHFORM_UPLOAD_* is not set, so this release/staging artifact is UNSIGNED. " +
            "Google Play will not accept it until it is signed with the upload key.",
    )
}

android {
    namespace = "io.faithform.app"
    // API 36 (Android 16). Google Play requires new apps and updates to target
    // it from 31 August 2026, and a target cannot be higher than what the app
    // compiles against — so both move together, and AGP moved to the 8.13 line
    // because it is the last 8.x release that knows this platform.
    compileSdk = 36

    defaultConfig {
        // Matches the iOS bundle identifier, so one product has one id on both
        // stores. This is no longer an invention: it is the identifier already
        // registered with Apple as BPKHRJ24C7.io.faithform.app. The debug and
        // staging build types suffix it, so all three install side by side.
        //
        // A package name cannot be changed after a Play listing is published,
        // which is the whole reason to settle it before first release rather
        // than after. Signing key and listing remain external decisions,
        // recorded in docs/faithform/P4_EXTERNAL_SETUP_RUNBOOK.md.
        applicationId = "io.faithform.app"
        minSdk = 26
        targetSdk = 36
        versionCode = 1
        versionName = "0.1.0"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }

    signingConfigs {
        if (hasUploadSigning) {
            create("upload") {
                storeFile = file(uploadKeystore!!)
                storePassword = uploadKeystorePassword
                keyAlias = uploadKeyAlias
                keyPassword = uploadKeyPassword
            }
        }
    }

    buildTypes {
        debug {
            applicationIdSuffix = ".debug"
            // The only build type where a non-production origin is permitted.
            buildConfigField("String", "API_ORIGIN", "\"http://10.0.2.2:3000\"")
            buildConfigField("String", "ENVIRONMENT_KEY", "\"development\"")
            buildConfigField("boolean", "ALLOW_DEBUG_CONTROLS", "true")
            buildConfigField("String", "SUPABASE_URL", "\"$supabaseUrl\"")
            buildConfigField("String", "SUPABASE_ANON_KEY", "\"$supabaseAnonKey\"")
        }
        // Parallel to the iOS `Staging` configuration. A pilot build points at
        // a staging deployment and is installable alongside a release build,
        // which is what lets one phone hold both without either overwriting the
        // other's data.
        create("staging") {
            initWith(getByName("release"))
            applicationIdSuffix = ".staging"
            versionNameSuffix = "-staging"
            matchingFallbacks += listOf("release")
            isMinifyEnabled = false
            isShrinkResources = false
            // **Deliberately no default.** There is no staging origin in this
            // repository, and a default would be a guess about somebody's
            // infrastructure. Building a staging artifact without one fails at
            // configuration — see `requireShippable` above.
            buildConfigField("String", "API_ORIGIN", "\"$stagingOrigin\"")
            buildConfigField("String", "ENVIRONMENT_KEY", "\"staging\"")
            buildConfigField("boolean", "ALLOW_DEBUG_CONTROLS", "false")
            buildConfigField("String", "SUPABASE_URL", "\"$supabaseUrl\"")
            buildConfigField("String", "SUPABASE_ANON_KEY", "\"$supabaseAnonKey\"")
            if (hasUploadSigning) signingConfig = signingConfigs.getByName("upload")
        }
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
            // `https://faithform.io` unless overridden — see `releaseOrigin`.
            buildConfigField("String", "API_ORIGIN", "\"$releaseOrigin\"")
            buildConfigField("String", "ENVIRONMENT_KEY", "\"production\"")
            buildConfigField("String", "SUPABASE_URL", "\"$supabaseUrl\"")
            buildConfigField("String", "SUPABASE_ANON_KEY", "\"$supabaseAnonKey\"")
            // Debug affordances are compiled out of release rather than hidden.
            buildConfigField("boolean", "ALLOW_DEBUG_CONTROLS", "false")
            // The upload key when the environment supplies it; otherwise the
            // bundle is built unsigned and the build output says so.
            if (hasUploadSigning) signingConfig = signingConfigs.getByName("upload")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
    buildFeatures {
        compose = true
        buildConfig = true
    }
    testOptions {
        unitTests {
            // Robolectric needs the real resources and the merged manifest —
            // which is the point: the permission list and the receivers'
            // exported state are what these tests assert against.
            isIncludeAndroidResources = true
            isReturnDefaultValues = false
        }
    }
    packaging {
        resources.excludes += "/META-INF/{AL2.0,LGPL2.1}"
    }
}

dependencies {
    implementation(project(":core:contract"))
    implementation(project(":core:network"))
    implementation(project(":core:navigation"))
    implementation(project(":core:storage"))
    implementation(project(":core:design"))
    implementation(project(":core:attendance"))
    implementation(project(":core:media"))
    implementation(project(":core:sermons"))
    implementation(project(":core:giving"))

    implementation(platform(libs.compose.bom))
    implementation(libs.compose.ui)
    implementation(libs.compose.foundation)
    implementation(libs.compose.material3)
    implementation(libs.compose.material.icons.extended)
    implementation(libs.compose.ui.tooling.preview)
    implementation(libs.activity.compose)
    implementation(libs.core.splashscreen)
    implementation(libs.profileinstaller)
    implementation(libs.navigation.compose)
    implementation(libs.lifecycle.runtime.compose)
    implementation(libs.lifecycle.viewmodel.compose)

    implementation(libs.datastore.preferences)
    implementation(libs.security.crypto)
    implementation(libs.okhttp)
    implementation(libs.coil.compose)
    // Geofencing only. No Maps, no Ads, no Analytics, no Play Integrity.
    implementation(libs.play.services.location)
    // Camera frames for QR check-in, and nothing more: no `camera-video`, no
    // `camera-extensions`, and no `ImageCapture` use case anywhere. The
    // decoding itself is in `:core:attendance`, on the JVM, where it is tested
    // against real generated codes.
    // Stripe's own payment sheet. The only place a card number is ever entered
    // is inside Stripe's UI, in Stripe's process boundary — FaithForm has no card
    // field, no card storage screen, and no bank-account screen.
    //
    // Every decision that depends on the sheet's result lives in `:core:giving`,
    // on the JVM. This dependency is here and nowhere else for the same reason
    // Media3 is: a module that cannot be tested without a payment UI would not
    // be tested.
    implementation(libs.stripe.paymentsheet)
    implementation(libs.camera.core)
    implementation(libs.camera.camera2)
    implementation(libs.camera.lifecycle)
    implementation(libs.camera.view)
    // Playback. HLS for live, progressive for the archive. Deliberately no
    // `media3-cast` and no download manager — Prompt 9 excludes both, and an
    // absent dependency cannot be reached by mistake.
    implementation(libs.media3.exoplayer)
    implementation(libs.media3.exoplayer.hls)
    implementation(libs.media3.ui)
    implementation(libs.media3.common)
    implementation(libs.kotlinx.serialization.json)

    testImplementation(libs.junit)
    testImplementation(libs.kotlinx.coroutines.test)
    // A real HTTP server on the loopback, so the OkHttp exchange is proven
    // against bytes on a socket rather than against a scripted transport — the
    // layer a scripted transport stands in for is the one that was missing.
    testImplementation(libs.okhttp.mockwebserver)
    // Robolectric runs the Android framework on the JVM, so the Play services
    // adapter, the three receivers, the encrypted store and the manifest are
    // all exercised by `gradlew :app:testDebugUnitTest` with no emulator.
    testImplementation(libs.robolectric)
    testImplementation(libs.androidx.test.core)
    // The encoder, so a Robolectric test can render a real QR into the exact
    // luminance plane CameraX hands over — padded row stride and all — and
    // prove the adapter's frame translation, not just the decoder's.
    testImplementation(libs.zxing.core)

    androidTestImplementation(platform(libs.compose.bom))
    androidTestImplementation(libs.androidx.test.junit)
    androidTestImplementation(libs.compose.ui.test.junit4)
    debugImplementation(libs.compose.ui.test.manifest)
}
