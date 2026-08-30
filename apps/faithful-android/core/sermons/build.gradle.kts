plugins {
    alias(libs.plugins.kotlin.jvm)
}

kotlin { jvmToolchain(17) }

/**
 * The sermon-notes decisions, on the JVM.
 *
 * Pure on purpose, exactly like `:core:media`. Which empty state a screen shows,
 * what a failure means and when another page may be asked for are all decided
 * here and run under `gradlew :core:sermons:test` with no emulator and no
 * network. The Composables in `:app` hold no decisions.
 */
dependencies {
    api(project(":core:contract"))
    api(libs.kotlinx.coroutines.core)

    testImplementation(libs.junit)
    testImplementation(libs.kotlinx.coroutines.test)
}

tasks.test { useJUnit() }
