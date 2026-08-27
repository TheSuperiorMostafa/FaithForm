plugins {
    alias(libs.plugins.kotlin.jvm)
    alias(libs.plugins.kotlin.serialization)
}

// Pure JVM on purpose: the contract must be verifiable on any runner, with no
// Android SDK and no emulator, because contract parity is the thing CI checks
// on every change.
kotlin { jvmToolchain(17) }

dependencies {
    api(libs.kotlinx.serialization.json)
    testImplementation(libs.junit)
}

tasks.test {
    useJUnit()
    // These tests decode the golden fixtures from the repository rather than a
    // copied resource, so Gradle cannot see them as inputs on its own — and
    // would report a stale PASS after a fixture changed.
    inputs.dir(rootProject.file("../../contracts/faithful/v1/fixtures"))
        .withPathSensitivity(PathSensitivity.RELATIVE)
        .withPropertyName("faithfulContractFixtures")
}
