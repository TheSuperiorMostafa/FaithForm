plugins {
    alias(libs.plugins.kotlin.jvm)
}

kotlin { jvmToolchain(17) }

dependencies {
    testImplementation(libs.junit)
    // The auth-callback tests decode the shared contract document, the same
    // bytes the Swift and TypeScript suites read.
    testImplementation(libs.kotlinx.serialization.json)
}

tasks.test {
    useJUnit()
    // The callback tests read the shared contract from the repository rather
    // than a copied resource, so Gradle cannot see it as an input on its own —
    // and would report a stale PASS after the contract changed. Declaring it
    // is what makes "contract freshness" mean anything here.
    inputs.files(rootProject.file("../../contracts/faithful/v1/auth-callback.json"))
        .withPathSensitivity(PathSensitivity.RELATIVE)
        .withPropertyName("faithfulAuthCallbackContract")
}
