pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    // Deterministic resolution: a module may not introduce its own repository,
    // so what CI builds is what a developer builds.
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
    }
}

rootProject.name = "faithful-android"

// Pure-JVM modules. They hold the contract, the client, the routing rules and
// the cache policy — everything whose correctness does not depend on Android —
// so `gradle :core:contract:test` verifies parity on any runner without an
// Android SDK or an emulator.
include(":core:contract")
include(":core:network")
include(":core:navigation")
include(":core:storage")
// The geofence reconciler and the evidence state machine. Pure JVM on purpose:
// every rule about what to monitor and what an event means is testable by
// `gradle :core:attendance:test` with no emulator, no Play services, and no
// movement. The Android adapters live in `:app` and hold no decisions.
include(":core:attendance")
// The playback coordinator, the capability schedule and the resume policy.
// Pure JVM for the same reason as `:core:attendance`: the decisions are
// testable without Media3, without an emulator, and without a network.
include(":core:media")

// The amount rules, the attempt identity, the payment state machine and the
// failure mapping. Pure JVM for the same reason as the two above, and for one
// more: a payment flow that could only be tested by opening a payment sheet
// would not be tested at all.
include(":core:giving")

// Which empty state the sermon-notes screen shows, what a failure means, and
// when another page may be requested. Pure JVM for the same reason as the
// three above: an archive that could only be tested by scrolling a real list
// would not be tested at all.
include(":core:sermons")

// Android modules.
include(":core:design")
include(":app")
