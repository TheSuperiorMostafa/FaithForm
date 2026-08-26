plugins {
    alias(libs.plugins.kotlin.jvm)
}

kotlin { jvmToolchain(17) }

/**
 * The giving decisions, on the JVM.
 *
 * Pure on purpose, exactly like `:core:attendance` and `:core:media`. Amount
 * validation, the attempt identity that survives an app kill, the payment state
 * machine and the failure mapping all run under `gradlew :core:giving:test` with
 * no emulator, no Stripe SDK and no network.
 *
 * **The Stripe SDK is not a dependency here and must not become one.** The
 * payment sheet lives behind `PaymentSheetFacade`, whose only real
 * implementation is in `:app`. That is what makes the decisions testable rather
 * than admitted-as-untestable behind a payment UI.
 */
dependencies {
    api(project(":core:contract"))
    api(project(":core:storage"))
    api(libs.kotlinx.coroutines.core)

    testImplementation(libs.junit)
    testImplementation(libs.kotlinx.coroutines.test)
}

tasks.test { useJUnit() }
