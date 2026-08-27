package io.faithform.faithful.network

import io.faithform.faithful.contract.ErrorBody
import io.faithform.faithful.contract.FieldIssue
import io.faithform.faithful.contract.Meta
import io.faithform.faithful.contract.MobileErrorCode
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

/**
 * The wire envelope, mirrored from `lib/mobile/v1/envelope.ts`.
 *
 * `ignoreUnknownKeys` is the whole forward-compatibility story: a server that
 * adds a field cannot break a build already on a phone. It is set once, here,
 * so no call site can accidentally opt out of it.
 */
val FaithfulJson: Json = Json {
    ignoreUnknownKeys = true
    explicitNulls = false
    coerceInputValues = false
}

@Serializable
data class MobileSuccess<T>(
    val ok: Boolean,
    val data: T,
    val meta: Meta
)

@Serializable
data class MobileFailure(
    val ok: Boolean,
    val error: ErrorBody,
    val meta: Meta
)

/**
 * A failure that already carries the server-assigned request id — the only
 * thing worth quoting in a support conversation.
 */
data class ApiException(
    val code: MobileErrorCode,
    val displayMessage: String,
    val retryable: Boolean = false,
    val retryAfterSeconds: Int? = null,
    val requestId: String? = null,
    val fields: List<FieldIssue>? = null
) : Exception(displayMessage) {

    companion object {
        fun offline() = ApiException(
            code = MobileErrorCode.UNAVAILABLE,
            displayMessage = "You appear to be offline.",
            retryable = true
        )

        fun transport() = ApiException(
            code = MobileErrorCode.UNAVAILABLE,
            displayMessage = "FaithForm could not reach the server.",
            retryable = true
        )

        /**
         * Decodes an error body. An unparseable body still becomes a safe typed
         * error rather than surfacing raw bytes to the person.
         */
        fun from(body: String?, status: Int, requestId: String?): ApiException {
            if (body != null) {
                runCatching { FaithfulJson.decodeFromString<MobileFailure>(body) }
                    .getOrNull()
                    ?.let { failure ->
                        return ApiException(
                            code = failure.error.code,
                            displayMessage = failure.error.message,
                            retryable = failure.error.retryable,
                            retryAfterSeconds = failure.error.retryAfterSeconds,
                            requestId = failure.meta.requestId,
                            fields = failure.error.fields
                        )
                    }
            }
            return ApiException(
                code = if (status >= 500) MobileErrorCode.UNAVAILABLE else MobileErrorCode.INTERNAL_ERROR,
                displayMessage = "Something went wrong.",
                retryable = status >= 500,
                requestId = requestId
            )
        }
    }
}
