package io.faithform.faithful.session

import android.content.SharedPreferences
import io.faithform.faithful.network.SingleFlightRefresher
import io.faithform.faithful.network.TokenProvider
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

@Serializable
data class StoredSession(
    val accessToken: String,
    val refreshToken: String,
    val expiresAtMillis: Long,
    val accountId: String,
    val environmentKey: String
) {
    /** Treated as expired slightly early so a request does not race the clock. */
    fun isExpired(nowMillis: Long, leewayMillis: Long = 60_000): Boolean =
        nowMillis + leewayMillis >= expiresAtMillis
}

/**
 * The slice of the session store the app shell depends on — narrow so the
 * first-run logic runs under a plain JVM test with no keystore in sight.
 */
interface SessionGateway {
    fun current(): StoredSession?
    fun adopt(session: StoredSession)
    fun purgeEverything()
}

/**
 * Owns the token lifecycle, backed by EncryptedSharedPreferences.
 *
 * Refresh is single-flight: concurrent callers await the same in-flight
 * refresh, so a burst of parallel requests cannot spend the refresh token
 * several times and invalidate the session.
 */
class AndroidSessionStore(
    private val preferences: SharedPreferences,
    private val environmentKey: String,
    private val now: () -> Long = System::currentTimeMillis,
    private val refresh: suspend (String) -> StoredSession = { error("no refresher configured") }
) : TokenProvider, SessionGateway {

    private val json = Json { ignoreUnknownKeys = true }
    private val key = "session"

    private val refresher = SingleFlightRefresher {
        val current = current() ?: throw IllegalStateException("no session")
        refresh(current.refreshToken).also { adopt(it) }
    }

    override fun current(): StoredSession? {
        val raw = preferences.getString(key, null) ?: return null
        val session = runCatching { json.decodeFromString(StoredSession.serializer(), raw) }.getOrNull()
            ?: return null
        // A session written under a different environment is never used here.
        return session.takeIf { it.environmentKey == environmentKey }
    }

    override fun adopt(session: StoredSession) {
        require(session.environmentKey == environmentKey) {
            "session belongs to a different environment"
        }
        preferences.edit().putString(key, json.encodeToString(StoredSession.serializer(), session)).apply()
    }

    override suspend fun validAccessToken(): String {
        val session = current() ?: throw IllegalStateException("not signed in")
        if (!session.isExpired(now())) return session.accessToken
        return refresher.run().accessToken
    }

    override suspend fun invalidate() {
        preferences.edit().remove(key).apply()
    }

    /** Sign-out and account removal: clears everything this store holds. */
    override fun purgeEverything() {
        preferences.edit().clear().apply()
    }
}
