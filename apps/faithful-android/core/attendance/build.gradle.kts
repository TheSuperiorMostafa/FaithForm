plugins {
    alias(libs.plugins.kotlin.jvm)
}

kotlin { jvmToolchain(17) }

dependencies {
    // The contract types, so the reconciler works with the same generated
    // `GeofenceConfiguration` the network layer decodes.
    api(project(":core:contract"))
    api(project(":core:storage"))
    api(libs.kotlinx.coroutines.core)
    // The QR decoder. Pure JVM, so the decode lives here rather than in `:app`
    // behind a camera nothing can exercise.
    api(libs.zxing.core)

    testImplementation(libs.junit)
    // The encoder, so a test can produce a real QR image and prove the decoder
    // reads it. Test-only: nothing in the app generates a code.
    testImplementation(libs.zxing.core)
    testImplementation(libs.kotlinx.coroutines.test)
}

tasks.test { useJUnit() }
