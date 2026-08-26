package io.faithform.faithful.attendance

import android.content.SharedPreferences
import io.faithform.faithful.storage.CachePartition
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import org.json.JSONObject

/**
 * The open logical attempt, in `EncryptedSharedPreferences`.
 *
 * An attempt holds an attempt id and, briefly, a position — so this is
 * deliberately **not** an ordinary preference file, a DataStore, or the
 * projection cache. Three properties matter:
 *
 *  * **Encrypted at rest**, with a Keystore-backed master key, because the
 *    payload is a position.
 *  * **Partitioned**, so an attempt opened under one account or one
 *    authorization version can never be read back under another.
 *  * **Bounded**, and purged on expiry rather than kept "just in case" — a
 *    store that never empties is a location history by another name.
 *
 * At most one attempt per partition.
 */
class EncryptedAttendanceAttemptStore(
    private val prefs: SharedPreferences,
) : AttendanceAttemptStore {

    private val mutex = Mutex()

    override suspend fun current(
        partition: CachePartition,
        nowEpochMillis: Long,
    ): LogicalAttempt? = mutex.withLock { read(partition, nowEpochMillis) }

    /**
     * Atomic under the mutex: the read and the write happen with nothing else
     * interleaving, which is what makes two simultaneous transitions produce
     * one attempt rather than two with different keys.
     */
    override suspend fun openIfAbsent(
        candidate: LogicalAttempt,
        partition: CachePartition,
        nowEpochMillis: Long,
    ): LogicalAttempt = mutex.withLock {
        val existing = read(partition, nowEpochMillis)
        if (existing != null &&
            existing.covers(candidate.churchSlug, candidate.occurrenceId, nowEpochMillis)
        ) {
            // A duplicate transition joins the attempt already in progress.
            return@withLock existing
        }

        // Either nothing was open, or what was open belongs to a different
        // service. Replacing it is right: the evening service must never
        // inherit the morning's identity.
        write(candidate, partition)
        candidate
    }

    override suspend fun update(attempt: LogicalAttempt, partition: CachePartition) =
        mutex.withLock { write(attempt, partition) }

    override suspend fun close(partition: CachePartition) = mutex.withLock {
        prefs.edit().remove(key(partition)).apply()
    }

    /**
     * Removes every attempt, for every partition.
     *
     * Called on sign-out and on disabling the feature. A partition-scoped close
     * would leave another account's coordinates on the device, which is exactly
     * what must not survive a sign-out.
     */
    suspend fun closeAll() = mutex.withLock {
        val editor = prefs.edit()
        for (existing in prefs.all.keys.filter { it.startsWith(PREFIX) }) {
            editor.remove(existing)
        }
        editor.apply()
    }

    private fun read(partition: CachePartition, nowEpochMillis: Long): LogicalAttempt? {
        val raw = prefs.getString(key(partition), null) ?: return null
        val attempt = runCatching { decode(JSONObject(raw)) }.getOrNull() ?: return null

        // An expired attempt is not returned *and* is purged on the way past:
        // it may hold a position, and holding one past its retention window is
        // exactly what the bound exists to prevent.
        if (attempt.isExpired(nowEpochMillis)) {
            prefs.edit().remove(key(partition)).apply()
            return null
        }
        return attempt
    }

    private fun key(partition: CachePartition) = PREFIX + partition.storageKey

    private fun write(attempt: LogicalAttempt, partition: CachePartition) {
        prefs.edit().putString(key(partition), encode(attempt).toString()).apply()
    }

    private fun encode(attempt: LogicalAttempt) = JSONObject().apply {
        put("attemptId", attempt.attemptId)
        put("churchSlug", attempt.churchSlug)
        put("occurrenceId", attempt.occurrenceId)
        put("openedAt", attempt.openedAtEpochMillis)
        put("expiresAt", attempt.expiresAtEpochMillis)
        put("confirmNotBefore", attempt.confirmationNotBeforeEpochMillis ?: JSONObject.NULL)
        put("detectionId", attempt.detectionId ?: JSONObject.NULL)
        put(
            "queued",
            attempt.queued?.let { queued ->
                JSONObject().apply {
                    put("kind", queued.kind)
                    put("observedAt", queued.observedAtEpochMillis)
                    put("accuracy", queued.accuracyMeters ?: JSONObject.NULL)
                    put("dwell", queued.dwellSeconds ?: JSONObject.NULL)
                    put("lat", queued.latitude ?: JSONObject.NULL)
                    put("lon", queued.longitude ?: JSONObject.NULL)
                    put("retries", queued.retries)
                }
            } ?: JSONObject.NULL,
        )
    }

    private fun decode(json: JSONObject) = LogicalAttempt(
        attemptId = json.getString("attemptId"),
        churchSlug = json.getString("churchSlug"),
        occurrenceId = json.getString("occurrenceId"),
        openedAtEpochMillis = json.getLong("openedAt"),
        expiresAtEpochMillis = json.getLong("expiresAt"),
        confirmationNotBeforeEpochMillis =
            if (json.isNull("confirmNotBefore")) null else json.getLong("confirmNotBefore"),
        detectionId = if (json.isNull("detectionId")) null else json.getString("detectionId"),
        queued = json.optJSONObject("queued")?.let { queued ->
            QueuedSubmission(
                kind = queued.getString("kind"),
                observedAtEpochMillis = queued.getLong("observedAt"),
                accuracyMeters = queued.optDoubleOrNull("accuracy"),
                dwellSeconds = if (queued.isNull("dwell")) null else queued.getInt("dwell"),
                latitude = queued.optDoubleOrNull("lat"),
                longitude = queued.optDoubleOrNull("lon"),
                retries = queued.optInt("retries", 0),
            )
        },
    )

    private fun JSONObject.optDoubleOrNull(name: String): Double? =
        if (isNull(name)) null else getDouble(name)

    private companion object {
        const val PREFIX = "attendance_attempt|"
    }
}
