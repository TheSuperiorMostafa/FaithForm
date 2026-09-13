plugins {
    alias(libs.plugins.kotlin.jvm)
    alias(libs.plugins.kotlin.serialization)
}

kotlin { jvmToolchain(17) }

dependencies {
    api(project(":core:contract"))
    // The partition-aware cache, so `ProjectionCache` can keep an ETag beside
    // each projection. Pure JVM, like this module.
    api(project(":core:storage"))
    api(libs.kotlinx.coroutines.core)
    implementation(libs.kotlinx.serialization.json)
    testImplementation(libs.junit)
    testImplementation(libs.kotlinx.coroutines.test)
}

tasks.test { useJUnit() }
