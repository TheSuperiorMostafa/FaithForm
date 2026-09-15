package io.faithform.app.storage

import java.io.File
import java.security.MessageDigest
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

    fun isDisplayable(nowMillis: Long, ttlMillis: Long = PROJECTION_TTL_MILLIS): Boolean =
        freshness(nowMillis, ttlMillis) !is Freshness.Expired

    companion object {
        const val PROJECTION_TTL_MILLIS = 300_000L
    }
}

/**
 * A bounded, partition-aware cache. Eviction is deterministic (oldest first)
 * so behaviour under pressure is testable rather than dependent on system
 * memory conditions.
 *
 * When [directory] is supplied, payloads are written through to disk and
 * loaded lazily on miss, so a killed process still has last night's feed.
 *
 * Tokens never live here. Credential material belongs in the Keystore-backed
 * store, and this class has no API that would accept it.
 */
class PartitionedCache(
    private val maxEntries: Int = 200,
    private val directory: File? = null,
) {
    private data class Key(val partition: String, val name: String)
    private data class Stored(
        val payload: String?,
        val storedAtMillis: Long,
    )

    private val mutex = Mutex()
    private val entries = LinkedHashMap<Key, Stored>()
    private val dataDir: File? = directory?.let { File(it, "data") }

    init {
        directory?.mkdirs()
        dataDir?.mkdirs()
        loadIndex()
    }

    suspend fun store(name: String, partition: CachePartition, payload: String, storedAtMillis: Long) =
        mutex.withLock {
            val key = Key(partition.storageKey, name)
            entries[key] = Stored(payload, storedAtMillis)
            writeFile(key, payload, storedAtMillis)
            persistIndex()
            evictIfNeeded()
        }

    suspend fun load(name: String, partition: CachePartition): String? = mutex.withLock {
        hydrate(Key(partition.storageKey, name))
    }

    /**
     * The payload with the moment it was stored, so a reader can decide how
     * stale it is. The etag is carried inside the payload by whoever wrote it;
     * this layer stores strings and knows nothing about HTTP.
     */
    suspend fun loadEntry(name: String, partition: CachePartition): CacheEntry<String>? = mutex.withLock {
        val key = Key(partition.storageKey, name)
        val stored = entries[key] ?: return@withLock null
        val payload = hydrate(key) ?: return@withLock null
        CacheEntry(value = payload, etag = null, storedAtMillis = stored.storedAtMillis)
    }

    suspend fun purge(partition: CachePartition) = mutex.withLock {
        removeMatching { it.partition == partition.storageKey }
    }

    /** Sign-out and account removal: every church, every authorization version. */
    suspend fun purgeAccount(environment: String, accountId: String) = mutex.withLock {
        val prefix = "$environment|$accountId|"
        removeMatching { it.partition.startsWith(prefix) }
    }

    suspend fun purgeAllPrivate() = mutex.withLock {
        removeMatching { !it.partition.contains("|anonymous|") }
    }

    suspend fun purgeAll() = mutex.withLock { removeMatching { true } }

    suspend fun count(): Int = mutex.withLock { entries.size }

    private fun hydrate(key: Key): String? {
        val stored = entries[key] ?: return null
        stored.payload?.let { return it }
        val payload = readFile(key) ?: run {
            entries.remove(key)
            persistIndex()
            return null
        }
        entries[key] = stored.copy(payload = payload)
        return payload
    }

    private fun evictIfNeeded() {
        if (entries.size <= maxEntries) return
        entries.entries
            .sortedBy { it.value.storedAtMillis }
            .take(entries.size - maxEntries)
            .forEach { entry ->
                deleteFile(entry.key)
                entries.remove(entry.key)
            }
        persistIndex()
    }

    private fun removeMatching(predicate: (Key) -> Boolean) {
        entries.keys.filter(predicate).forEach { key ->
            deleteFile(key)
            entries.remove(key)
        }
        persistIndex()
    }

    private fun loadIndex() {
        val file = File(directory ?: return, "index.tsv")
        if (!file.isFile) return
        file.readLines().drop(1).forEach { line ->
            val parts = line.split('\t')
            if (parts.size >= 3) {
                val storedAt = parts[0].toLongOrNull() ?: return@forEach
                entries[Key(parts[1], parts[2])] = Stored(payload = null, storedAtMillis = storedAt)
            }
        }
    }

    private fun persistIndex() {
        val dir = directory ?: return
        val body = buildString {
            appendLine("FFINDEX1")
            entries.forEach { (key, stored) ->
                append(stored.storedAtMillis).append('\t')
                    .append(key.partition).append('\t')
                    .append(key.name).append('\n')
            }
        }
        val file = File(dir, "index.tsv")
        val tmp = File(dir, "index.tsv.tmp")
        tmp.writeText(body)
        if (!tmp.renameTo(file)) {
            tmp.copyTo(file, overwrite = true)
            tmp.delete()
        }
    }

    private fun writeFile(key: Key, payload: String, storedAtMillis: Long) {
        val dir = dataDir ?: return
        dir.mkdirs()
        File(dir, diskFileName(key)).writeText("$storedAtMillis\n$payload")
    }

    private fun readFile(key: Key): String? {
        val file = File(dataDir ?: return null, diskFileName(key))
        if (!file.isFile) return null
        val text = file.readText()
        val nl = text.indexOf('\n')
        return if (nl >= 0) text.substring(nl + 1) else text
    }

    private fun deleteFile(key: Key) {
        File(dataDir ?: return, diskFileName(key)).delete()
    }

    private fun diskFileName(key: Key): String {
        val md = MessageDigest.getInstance("SHA-256")
        md.update(key.partition.toByteArray(Charsets.UTF_8))
        md.update(0)
        md.update(key.name.toByteArray(Charsets.UTF_8))
        return md.digest().joinToString("") { "%02x".format(it) }
    }
}
