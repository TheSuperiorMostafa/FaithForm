plugins {
    alias(libs.plugins.android.library)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.compose.compiler)
}

android {
    namespace = "io.faithform.faithful.design"
    compileSdk = 34

    defaultConfig {
        // 26 keeps the app on hardware a congregation plausibly still carries
        // while giving the whole modern crypto and Keystore surface this
        // architecture depends on. Below 26 the Keystore guarantees weaken and
        // adaptive icons are unavailable; the coverage gained is negligible.
        minSdk = 26
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
    buildFeatures { compose = true }
}

dependencies {
    implementation(platform(libs.compose.bom))
    api(libs.compose.ui)
    api(libs.compose.foundation)
    api(libs.compose.material3)
}
