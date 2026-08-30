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
 * Supplied at build time — `-Pfaithful.stagingOrigin=https://…` — and **empty by
 * default**. An empty origin is not a mistake to work around: `AppEnvironment`
 * turns it into a fail-closed state rather than falling back to production,
 * which is what this file used to do.
 */
val stagingOrigin = (project.findProperty("faithful.stagingOrigin") as String?).orEmpty()
val releaseOrigin = (project.findProperty("faithful.releaseOrigin") as String?).orEmpty()

/**
 * The identity provider. Both values are public by design — Supabase publishes
 * them for clients, and neither authorises anything on its own — but they name
 * a particular project, so they stay out of the repository: supplied with
 * `-Pfaithful.supabaseUrl=… -Pfaithful.supabaseAnonKey=…`, or for local work
 * from `local.properties` (gitignored), mirroring iOS's `Local.xcconfig`.
 * Empty fails closed: the sign-in screen renders, and submitting says what is
 * missing rather than spinning.
 */
val localProperties = Properties().apply {
    val file = rootProject.file("local.properties")
    if (file.exists()) file.inputStream().use { stream -> load(stream) }
}

fun configValue(name: String): String =
    (project.findProperty(name) as String?)
        ?: localProperties.getProperty(name).orEmpty()

val supabaseUrl = configValue("faithful.supabaseUrl")
val supabaseAnonKey = configValue("faithful.supabaseAnonKey")

android {
    namespace = "io.faithform.faithful"
    compileSdk = 34

    defaultConfig {
        // Development identifier. The production application id, signing key,
        // and Play listing are external decisions recorded in
        // docs/faithful/P4_EXTERNAL_SETUP_RUNBOOK.md and deliberately not
        // invented here.
        applicationId = "io.faithform.faithful.dev"
        minSdk = 26
        targetSdk = 34
        versionCode = 1
        versionName = "0.1.0"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
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
            // **Deliberately empty.** There is no staging origin in this
            // repository, and a default would be a guess about somebody's
            // infrastructure. A build with this empty fails closed — see
            // `AppEnvironment` — rather than falling back to production.
            buildConfigField("String", "API_ORIGIN", "\"$stagingOrigin\"")
            buildConfigField("String", "ENVIRONMENT_KEY", "\"staging\"")
            buildConfigField("boolean", "ALLOW_DEBUG_CONTROLS", "false")
            buildConfigField("String", "SUPABASE_URL", "\"$supabaseUrl\"")
            buildConfigField("String", "SUPABASE_ANON_KEY", "\"$supabaseAnonKey\"")
        }
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
            // **Deliberately empty**, for the same reason as staging: the
            // production origin is a deployment decision, not a source
            // constant. Supply it with `-Pfaithful.releaseOrigin=…`.
            //
            // This used to hardcode `https://faithform.io`. A release build that
            // points somewhere by default is a release build nobody has to think
            // about pointing, and the one time that matters is the time it is
            // wrong.
            buildConfigField("String", "API_ORIGIN", "\"$releaseOrigin\"")
            buildConfigField("String", "ENVIRONMENT_KEY", "\"production\"")
            buildConfigField("String", "SUPABASE_URL", "\"$supabaseUrl\"")
            buildConfigField("String", "SUPABASE_ANON_KEY", "\"$supabaseAnonKey\"")
            // Debug affordances are compiled out of release rather than hidden.
            buildConfigField("boolean", "ALLOW_DEBUG_CONTROLS", "false")
            // No signingConfig here: release signing comes from the environment
            // at build time so no key or password is ever committed.
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
    implementation(libs.compose.ui.tooling.preview)
    implementation(libs.activity.compose)
    implementation(libs.navigation.compose)
    implementation(libs.lifecycle.runtime.compose)
    implementation(libs.lifecycle.viewmodel.compose)

    implementation(libs.datastore.preferences)
    implementation(libs.security.crypto)
    implementation(libs.okhttp)
    // Geofencing only. No Maps, no Ads, no Analytics, no Play Integrity.
    implementation(libs.play.services.location)
    // Camera frames for QR check-in, and nothing more: no `camera-video`, no
    // `camera-extensions`, and no `ImageCapture` use case anywhere. The
    // decoding itself is in `:core:attendance`, on the JVM, where it is tested
    // against real generated codes.
    // Stripe's own payment sheet. The only place a card number is ever entered
    // is inside Stripe's UI, in Stripe's process boundary — Faithful has no card
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
