package io.faithform.app.session

import android.content.SharedPreferences
import io.faithform.app.network.SingleFlightRefresher
import io.faithform.app.network.TokenProvider
import io.faithform.app.network.ApiException
import kotlinx.coroutines.CancellationException
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
    private var revision = 0L

    private val refresher = SingleFlightRefresher {
        val (current, generation) = synchronized(this) {
            (current() ?: throw IllegalStateException("no session")) to revision
        }
        val renewed = try {
            refresh(current.refreshToken)
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (error: Exception) {
            synchronized(this) {
                if (revision != generation) throw ApiException.transport()
            }
            throw error
        }
        synchronized(this) {
            if (revision != generation) throw ApiException.transport()
            adopt(renewed)
        }
        renewed
    }

    @Synchronized override fun current(): StoredSession? {
        val raw = preferences.getString(key, null) ?: return null
        val session = runCatching { json.decodeFromString(StoredSession.serializer(), raw) }.getOrNull()
            ?: return null
        // A session written under a different environment is never used here.
        return session.takeIf { it.environmentKey == environmentKey }
    }

    @Synchronized override fun adopt(session: StoredSession) {
        require(session.environmentKey == environmentKey) {
            "session belongs to a different environment"
        }
        revision++
        preferences.edit().putString(key, json.encodeToString(StoredSession.serializer(), session)).apply()
    }

    override suspend fun validAccessToken(): String {
        val session = current() ?: throw IllegalStateException("not signed in")
        if (!session.isExpired(now())) return session.accessToken
        return refresher.run().accessToken
    }

    override suspend fun invalidate() {
        synchronized(this) {
            revision++
            preferences.edit().remove(key).apply()
        }
    }

    override suspend fun invalidateIfCurrent(accessToken: String): Boolean = synchronized(this) {
        if (current()?.accessToken != accessToken) return@synchronized false
        revision++
        preferences.edit().remove(key).apply()
        true
    }

    /** Sign-out and account removal: clears everything this store holds. */
    @Synchronized override fun purgeEverything() {
        revision++
        preferences.edit().clear().apply()
    }
}
