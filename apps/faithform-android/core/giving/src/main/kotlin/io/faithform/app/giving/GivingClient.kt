package io.faithform.app.giving

import io.faithform.app.contract.DonationSession
import io.faithform.app.contract.DonationStatusResult
import io.faithform.app.contract.GivingHistoryPage
import io.faithform.app.contract.GivingHome
import io.faithform.app.contract.GivingReceipt
import io.faithform.app.contract.MobileErrorCode
import io.faithform.app.contract.StartDonationRequest
import io.faithform.app.network.ApiClient
import io.faithform.app.network.ApiException
import io.faithform.app.network.FaithFormJson
import io.faithform.app.network.MobileSuccess
import io.faithform.app.network.ProjectionCache
import io.faithform.app.storage.CachePartition
import kotlinx.serialization.KSerializer

/**
 * Reads the giving projections and starts gifts.
 *
 * Mirrors `GivingClient.swift` route for route:
 *
 * | call              | route                                                | cached |
 * |-------------------|------------------------------------------------------|--------|
 * | [home]            | `GET  api/mobile/v1/giving/{slug}/funds`             | yes, ETag |
 * | [startDonation]   | `POST api/mobile/v1/giving/donate`                   | never |
 * | [status]          | `GET  api/mobile/v1/giving/{slug}/status/{attempt}`  | never |
 * | [history]         | `GET  api/mobile/v1/giving/{slug}/history?before`    | never |
 * | [receipt]         | `GET  api/mobile/v1/giving/{slug}/receipt/{attempt}` | never |
 *
 * ## What is cached, and what is not
 *
 * The fund list is a church's published configuration and changes rarely, so it
 * is cached under the caller's partition and revalidated with its ETag. **Nothing
 * else is.** A donation session carries a client secret, a status is the one
 * thing where a stale answer is actively harmful, and a person's giving history
 * is not something to leave in a cache on a shared device. Those routes answer
 * `no-store`, and this client does not second-guess them.
 *
 * ## Why `donate` carries no Idempotency-Key header
 *
 * The server makes a retry safe with `clientAttemptId` in the body instead: an
 * attempt id is persisted before the request and survives an app kill, a sheet
 * that never returned, and a person who comes back an hour later. A header
 * generated per request survives none of those.
 */
class GivingClient(
    private val api: ApiClient,
    private val cache: ProjectionCache,
) {
    suspend fun home(churchSlug: String, partition: CachePartition): GivingHome =
        cache.revalidate(
            api = api,
            path = "api/mobile/v1/giving/$churchSlug/funds",
            serializer = GivingHome.serializer(),
            name = "giving.funds.$churchSlug",
            partition = partition,
        )

    suspend fun cachedHome(churchSlug: String, partition: CachePartition) =
        cache.load("giving.funds.$churchSlug", partition, GivingHome.serializer())

    /** Starts, or resumes, one logical donation. */
    suspend fun startDonation(attempt: DonationAttempt): DonationSession = required(
        api.send(
            path = "api/mobile/v1/giving/donate",
            serializer = MobileSuccess.serializer(DonationSession.serializer()),
            method = "POST",
            body = FaithFormJson.encodeToString(
                StartDonationRequest.serializer(),
                StartDonationRequest(
                    churchSlug = attempt.churchSlug,
                    fundId = attempt.fundId,
                    amountCents = attempt.amountCents,
                    clientAttemptId = attempt.clientAttemptId,
                ),
            ),
        ).value,
    )

    /** What the **server** believes happened. Never cached. */
    suspend fun status(churchSlug: String, attemptId: String): DonationStatusResult =
        get("api/mobile/v1/giving/$churchSlug/status/$attemptId", DonationStatusResult.serializer())

    suspend fun history(churchSlug: String, before: String? = null): GivingHistoryPage = required(
        api.send(
            path = "api/mobile/v1/giving/$churchSlug/history",
            serializer = MobileSuccess.serializer(GivingHistoryPage.serializer()),
            query = before?.let { mapOf("before" to it) } ?: emptyMap(),
        ).value,
    )

    suspend fun receipt(churchSlug: String, attemptId: String): GivingReceipt =
        get("api/mobile/v1/giving/$churchSlug/receipt/$attemptId", GivingReceipt.serializer())

    private suspend fun <T> get(path: String, serializer: KSerializer<T>): T =
        required(api.send(path = path, serializer = MobileSuccess.serializer(serializer)).value)

    /**
     * A response with no body where one was required. These routes are all
     * `no-store`, so a 304 is impossible and a missing value means the transport
     * failed in a way the decoder could not see — reported, not defaulted.
     */
    private fun <T> required(value: T?): T = value ?: throw ApiException(
        code = MobileErrorCode.UNAVAILABLE,
        displayMessage = "Giving is unavailable right now.",
        retryable = true,
    )
}
