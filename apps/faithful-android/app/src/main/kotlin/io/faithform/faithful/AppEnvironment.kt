package io.faithform.faithful

/**
 * Where this build points, resolved once at launch.
 *
 * ## Why it fails closed
 *
 * The origin comes from the build type, and **staging and release ship with it
 * empty**. That is deliberate. A build whose origin is missing does not fall
 * back to production: it produces [Unconfigured], the app shows a state that
 * says so, and the developer sees exactly which value is absent.
 *
 * The usual default is the other way round — a fallback to production — and it
 * is the reason staging builds end up writing to real churches. This file used
 * to be that: `release` hardcoded `https://faithform.io`.
 *
 * Mirrors `AppEnvironment.swift` on iOS, decision for decision.
 */
sealed interface AppEnvironment {
    data class Configured(
        val environmentKey: String,
        val apiOrigin: String,
        val clientBuild: Int,
        val allowsDebugControls: Boolean,
    ) : AppEnvironment

    /** Names the value that is missing. Never a value itself. */
    data class Unconfigured(val reason: String) : AppEnvironment
}

object AppEnvironmentLoader {

    fun load(
        environmentKey: String,
        apiOrigin: String,
        clientBuild: Int,
        allowDebugControls: Boolean,
    ): AppEnvironment {
        if (environmentKey.isBlank()) {
            return AppEnvironment.Unconfigured("ENVIRONMENT_KEY is not set")
        }
        val origin = apiOrigin.trim()
        if (origin.isEmpty()) {
            return AppEnvironment.Unconfigured("API_ORIGIN is not set for $environmentKey")
        }

        val scheme = origin.substringBefore("://", missingDelimiterValue = "").lowercase()
        if (scheme != "https" && scheme != "http") {
            return AppEnvironment.Unconfigured("API_ORIGIN must be http or https")
        }
        // A production or staging build talking over cleartext is a
        // configuration mistake, not a preference. Only a development build may
        // — and the manifest forbids cleartext outside the emulator loopback
        // anyway, so this is the second of two independent refusals.
        if (scheme != "https" && environmentKey != "development") {
            return AppEnvironment.Unconfigured("API_ORIGIN must be https in $environmentKey")
        }

        // A build number that cannot be read is not defaulted: the server
        // refuses builds it no longer supports, and guessing one would make an
        // unsupported build look supported.
        if (clientBuild <= 0) {
            return AppEnvironment.Unconfigured("VERSION_CODE is not a positive integer")
        }

        return AppEnvironment.Configured(
            environmentKey = environmentKey,
            apiOrigin = origin,
            clientBuild = clientBuild,
            allowsDebugControls = allowDebugControls,
        )
    }
}
