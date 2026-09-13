package io.faithform.app.network

import io.faithform.app.storage.CacheEntry
import io.faithform.app.storage.CachePartition
import io.faithform.app.storage.PartitionedCache
import kotlinx.serialization.KSerializer
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement

/**
 * Typed projections over the partition-aware cache, with the ETag kept beside
 * each value.
 *
 * `PartitionedCache` stores strings and knows nothing about HTTP. Every iOS
 * client stores a `CacheEntry(value, etag, storedAt)` and revalidates with the
 * etag; this is the same shape on Android, so a feed, an archive or a fund list
 * that has not changed costs a 304 rather than a download.
 *
 * ## What may be stored here
 *
 * Projections only — what a church published, as this account may see it. A
 * playback capability, a donation session's client secret, a donation status
 * and giving history are **never** written here: their routes answer
 * `no-store`, and the clients that read them do not call [store]. The type has
 * no way to tell a credential from a projection, so that rule lives in the
 * clients and is asserted by their tests.
 */
class ProjectionCache(
    private val cache: PartitionedCache,
    private val clock: () -> Long = System::currentTimeMillis,
) {
    @Serializable
    private data class Stored(val etag: String? = null, val value: JsonElement)

    suspend fun <T> load(
        name: String,
        partition: CachePartition,
        serializer: KSerializer<T>,
    ): CacheEntry<T>? {
        val raw = cache.loadEntry(name, partition) ?: return null
        // A payload that no longer decodes — a field this build does not know
        // became required — is a cache miss, not a crash.
        return runCatching {
            val stored = FaithFormJson.decodeFromString(Stored.serializer(), raw.value)
            CacheEntry(
                value = FaithFormJson.decodeFromJsonElement(serializer, stored.value),
                etag = stored.etag,
                storedAtMillis = raw.storedAtMillis,
            )
        }.getOrNull()
    }

    suspend fun <T> store(
        name: String,
        partition: CachePartition,
        serializer: KSerializer<T>,
        value: T,
        etag: String?,
    ) {
        val payload = FaithFormJson.encodeToString(
            Stored.serializer(),
            Stored(etag = etag, value = FaithFormJson.encodeToJsonElement(serializer, value)),
        )
        cache.store(name, partition, payload, clock())
    }

    suspend fun purge(partition: CachePartition) = cache.purge(partition)

    /**
     * Reads one projection the way every FaithForm client does: send the stored
     * validator, keep the stored value on a 304, replace it on a 200.
     *
     * [cacheable] is false for a search or a second page. Those are transient
     * views of the same data, and caching every query a person typed would
     * build a local record of what they searched for — so they are neither
     * read from nor written to the cache.
     *
     * A 304 with nothing stored cannot be recovered by revalidating again, so
     * it is reported as the retryable offline error rather than shown as an
     * empty screen.
     */
    suspend fun <T> revalidate(
        api: ApiClient,
        path: String,
        serializer: KSerializer<T>,
        name: String,
        partition: CachePartition,
        query: Map<String, String> = emptyMap(),
        cacheable: Boolean = true,
        authenticated: Boolean = true,
    ): T {
        val cached = if (cacheable) load(name, partition, serializer) else null
        val response = api.send(
            path = path,
            serializer = MobileSuccess.serializer(serializer),
            query = query,
            ifNoneMatch = cached?.etag,
            authenticated = authenticated,
        )
        if (response.notModified && cached != null) return cached.value
        val value = response.value ?: throw ApiException.transport()
        if (cacheable) store(name, partition, serializer, value, response.etag)
        return value
    }
}
