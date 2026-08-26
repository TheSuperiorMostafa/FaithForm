plugins {
    alias(libs.plugins.kotlin.jvm)
}

kotlin { jvmToolchain(17) }

/**
 * The media decisions, on the JVM.
 *
 * Pure on purpose, exactly like `:core:attendance`. Every rule about when to
 * refresh a capability, what a failure means, whether a position is worth
 * keeping and what a revocation does runs under
 * `gradlew :core:media:test` with no emulator, no Media3 and no network. The
 * Android adapter lives in `:app` and holds no decisions.
 */
dependencies {
    api(project(":core:contract"))
    api(project(":core:storage"))
    api(libs.kotlinx.coroutines.core)

    testImplementation(libs.junit)
    testImplementation(libs.kotlinx.coroutines.test)
}

tasks.test { useJUnit() }
