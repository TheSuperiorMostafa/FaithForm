package io.faithform.faithful.storage

import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

/**
 * Which bucket a cached value belongs to.
 *
 * A cache entry is valid for one environment, one account, one authorization
 * version and — where church-scoped — one church. Any change yields a different
 * key, so data from a revoked relationship can never be read back.
 */
data class CachePartition(
    val environment: String,
    val accountId: String?,
    val churchSlug: String? = null,
    val authorizationVersion: Int
) {
    val isPublic: Boolean get() = accountId == null

    /** Stable and unambiguous: the separator cannot appear in a slug or a uuid. */
    val storageKey: String
        get() = listOf(
            environment,
            accountId ?: "anonymous",
            churchSlug ?: "-",
            authorizationVersion.toString()
        ).joinToString("|")

    companion object {
        fun publicPartition(environment: String) =
            CachePartition(environment, accountId = null, authorizationVersion = 0)
    }
}

sealed interface Freshness {
    data object Fresh : Freshness
    /** Displayable, but must be labelled with its age. */
    data class Stale(val ageMillis: Long) : Freshness
    data object Expired : Freshness
}

data class CacheEntry<T>(val value: T, val etag: String?, val storedAtMillis: Long) {
    fun freshness(nowMillis: Long, ttlMillis: Long): Freshness {
        val age = nowMillis - storedAtMillis
        return when {
            age <= ttlMillis -> Freshness.Fresh
            age <= ttlMillis * 12 -> Freshness.Stale(age)
            else -> Freshness.Expired
        }
    }
}

/**
 * A bounded, partition-aware cache. Eviction is deterministic (oldest first)
 * so behaviour under pressure is testable rather than dependent on system
 * memory conditions.
 *
 * Tokens never live here. Credential material belongs in the Keystore-backed
 * store, and this class has no API that would accept it.
 */
class PartitionedCache(private val maxEntries: Int = 200) {
    private data class Key(val partition: String, val name: String)
    private data class Stored(val payload: String, val storedAtMillis: Long)

    private val mutex = Mutex()
    private val entries = LinkedHashMap<Key, Stored>()

    suspend fun store(name: String, partition: CachePartition, payload: String, storedAtMillis: Long) =
        mutex.withLock {
            entries[Key(partition.storageKey, name)] = Stored(payload, storedAtMillis)
            if (entries.size > maxEntries) {
                entries.entries
                    .sortedBy { it.value.storedAtMillis }
                    .take(entries.size - maxEntries)
                    .forEach { entries.remove(it.key) }
            }
        }

    suspend fun load(name: String, partition: CachePartition): String? = mutex.withLock {
        entries[Key(partition.storageKey, name)]?.payload
    }

    suspend fun purge(partition: CachePartition) = mutex.withLock {
        entries.keys.filter { it.partition == partition.storageKey }.forEach { entries.remove(it) }
    }

    /** Sign-out and account removal: every church, every authorization version. */
    suspend fun purgeAccount(environment: String, accountId: String) = mutex.withLock {
        val prefix = "$environment|$accountId|"
        entries.keys.filter { it.partition.startsWith(prefix) }.forEach { entries.remove(it) }
    }

    suspend fun purgeAllPrivate() = mutex.withLock {
        entries.keys.filterNot { it.partition.contains("|anonymous|") }.forEach { entries.remove(it) }
    }

    suspend fun purgeAll() = mutex.withLock { entries.clear() }

    suspend fun count(): Int = mutex.withLock { entries.size }
}
