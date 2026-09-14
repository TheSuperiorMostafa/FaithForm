package io.faithform.app.attendance

import android.content.SharedPreferences
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import org.json.JSONArray
import org.json.JSONObject

/**
 * The automatic-attendance record, in the encrypted store.
 *
 * Given the container's `EncryptedSharedPreferences`, so sign-out's
 * `purgeEverything` sweeps it with the session. It holds a choice, the
 * account and churches it was made for, the last verdict worth showing, and at
 * most one pending question — never a position.
 */
class EncryptedAutomaticAttendanceRecordStore(
    private val prefs: SharedPreferences,
) : AutomaticAttendanceRecordStore {

    private val mutex = Mutex()

    override suspend fun load(): AutomaticAttendanceRecord = mutex.withLock {
        val raw = prefs.getString(KEY, null) ?: return@withLock AutomaticAttendanceRecord()
        runCatching { decode(JSONObject(raw)) }.getOrDefault(AutomaticAttendanceRecord())
    }

    override suspend fun save(record: AutomaticAttendanceRecord) = mutex.withLock {
        prefs.edit().putString(KEY, encode(record).toString()).commit()
        Unit
    }

    override suspend fun clear() = mutex.withLock {
        prefs.edit().remove(KEY).commit()
        Unit
    }

    private fun encode(record: AutomaticAttendanceRecord) = JSONObject().apply {
        put("enabled", record.enabled)
        put("consent", record.serverConsent)
        put("environment", record.environment ?: JSONObject.NULL)
        put("account", record.accountId ?: JSONObject.NULL)
        put("version", record.authorizationVersion)
        put(
            "churches",
            JSONArray().apply {
                record.churches.forEach { put(JSONObject().put("slug", it.slug).put("name", it.name)) }
            },
        )
        put("monitoring", record.monitoring)
        put("monitoringRefusal", record.monitoringRefusal ?: JSONObject.NULL)
        put("lastRefusal", record.lastRefusal ?: JSONObject.NULL)
        put(
            "lastCheckIn",
            record.lastCheckIn?.let {
                JSONObject()
                    .put("church", it.churchSlug)
                    .put("name", it.churchName)
                    .put("label", it.serviceLabel ?: JSONObject.NULL)
                    .put("at", it.atEpochMillis)
            } ?: JSONObject.NULL,
        )
        put("settled", JSONArray(record.settledOccurrences))
        put("notified", JSONArray(record.notifiedOccurrences))
        put(
            "pending",
            record.pendingConfirmation?.let {
                JSONObject()
                    .put("church", it.churchSlug)
                    .put("occurrence", it.occurrenceId)
                    .put("notBefore", it.notBeforeEpochMillis)
            } ?: JSONObject.NULL,
        )
        put("revokePending", record.consentRevocationPending)
    }

    private fun decode(json: JSONObject) = AutomaticAttendanceRecord(
        enabled = json.optBoolean("enabled", false),
        serverConsent = json.optString("consent", "unset"),
        environment = json.stringOrNull("environment"),
        accountId = json.stringOrNull("account"),
        authorizationVersion = json.optInt("version", 0),
        churches = json.optJSONArray("churches")?.let { array ->
            (0 until array.length()).map {
                val item = array.getJSONObject(it)
                ChurchName(item.getString("slug"), item.getString("name"))
            }
        }.orEmpty(),
        monitoring = json.optInt("monitoring", 0),
        monitoringRefusal = json.stringOrNull("monitoringRefusal"),
        lastRefusal = json.stringOrNull("lastRefusal"),
        lastCheckIn = json.optJSONObject("lastCheckIn")?.let {
            LastCheckIn(
                churchSlug = it.getString("church"),
                churchName = it.getString("name"),
                serviceLabel = it.stringOrNull("label"),
                atEpochMillis = it.getLong("at"),
            )
        },
        settledOccurrences = json.optJSONArray("settled").strings(),
        notifiedOccurrences = json.optJSONArray("notified").strings(),
        pendingConfirmation = json.optJSONObject("pending")?.let {
            PendingConfirmation(
                churchSlug = it.getString("church"),
                occurrenceId = it.getString("occurrence"),
                notBeforeEpochMillis = it.getLong("notBefore"),
            )
        },
        consentRevocationPending = json.optBoolean("revokePending", false),
    )

    private companion object {
        const val KEY = "automatic_attendance.record"
    }
}

/**
 * Transitions waiting for work to handle them, in the encrypted store.
 *
 * A region id and "dwell" together say where someone was, so this is not a
 * work request's input data — WorkManager's database is not encrypted. It is
 * bounded, and emptied as each transition is handled.
 */
class EncryptedTransitionInbox(
    private val prefs: SharedPreferences,
) : TransitionInbox {

    private val mutex = Mutex()

    override suspend fun append(transition: PendingTransition) = mutex.withLock {
        write((read() + transition).takeLast(CAPACITY))
    }

    override suspend fun all(): List<PendingTransition> = mutex.withLock { read() }

    override suspend fun remove(transition: PendingTransition) = mutex.withLock {
        val items = read().toMutableList()
        items.remove(transition)
        write(items)
    }

    override suspend fun clear() = mutex.withLock {
        prefs.edit().remove(KEY).commit()
        Unit
    }

    private fun read(): List<PendingTransition> {
        val raw = prefs.getString(KEY, null) ?: return emptyList()
        return runCatching {
            val array = JSONArray(raw)
            (0 until array.length()).mapNotNull { index ->
                val item = array.getJSONObject(index)
                val kind = TransitionKind.fromWire(item.getString("kind")) ?: return@mapNotNull null
                PendingTransition(kind, item.getString("region"), item.getLong("at"))
            }
        }.getOrDefault(emptyList())
    }

    private fun write(items: List<PendingTransition>) {
        val array = JSONArray()
        items.forEach {
            array.put(JSONObject().put("kind", it.kind.wire).put("region", it.regionId).put("at", it.atEpochMillis))
        }
        // `commit`, not `apply`: this is written from a receiver that is about
        // to return, and the work it schedules must find it.
        prefs.edit().putString(KEY, array.toString()).commit()
    }

    private companion object {
        const val KEY = "automatic_attendance.inbox"

        /** A person is in one place at a time; a long queue is a stale one. */
        const val CAPACITY = 16
    }
}

/**
 * Which runtime permissions this app has already asked for.
 *
 * Android reports "don't ask again" only indirectly: the rationale flag is
 * false both before the first request and after a permanent denial. Knowing
 * that a request was made is what tells the two apart, so the person is sent
 * to Settings instead of tapping a button that silently does nothing.
 */
class PermissionRequestHistory(private val prefs: SharedPreferences) {
    fun hasRequested(permission: String): Boolean = prefs.getBoolean(KEY_PREFIX + permission, false)

    fun markRequested(permission: String) {
        prefs.edit().putBoolean(KEY_PREFIX + permission, true).apply()
    }

    private companion object {
        const val KEY_PREFIX = "permission_requested|"
    }
}

private fun JSONObject.stringOrNull(name: String): String? = if (isNull(name) || !has(name)) null else getString(name)

private fun JSONArray?.strings(): List<String> =
    this?.let { array -> (0 until array.length()).map { array.getString(it) } }.orEmpty()
