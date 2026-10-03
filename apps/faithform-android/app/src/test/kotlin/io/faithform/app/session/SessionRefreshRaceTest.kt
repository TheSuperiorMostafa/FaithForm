package io.faithform.app.session

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import io.faithform.app.network.AuthException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.async
import kotlinx.coroutines.test.runTest
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.util.UUID

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = android.app.Application::class)
class SessionRefreshRaceTest {
    private fun stored(id: String, expired: Boolean = false) = StoredSession("access-$id", "refresh-$id", if (expired) 0 else Long.MAX_VALUE, id, "development")
    private fun store(refresh: suspend (String) -> StoredSession): AndroidSessionStore {
        val context = ApplicationProvider.getApplicationContext<Context>()
        return AndroidSessionStore(context.getSharedPreferences("session-race-${UUID.randomUUID()}", Context.MODE_PRIVATE), "development", refresh = refresh)
    }

    @Test fun `late refresh cannot reestablish a signedout session`() = runTest {
        val waiting = CompletableDeferred<StoredSession>()
        val begun = CompletableDeferred<Unit>()
        val sessions = store { begun.complete(Unit); waiting.await() }
        sessions.adopt(stored("a", expired = true))
        val result = async { runCatching { sessions.validAccessToken() } }
        begun.await()
        sessions.purgeEverything()
        waiting.complete(stored("a-renewed"))
        assertTrue(result.await().isFailure)
        assertNull(sessions.current())
    }

    @Test fun `late refresh cannot replace a new account`() = runTest {
        val waiting = CompletableDeferred<StoredSession>()
        val begun = CompletableDeferred<Unit>()
        val sessions = store { begun.complete(Unit); waiting.await() }
        sessions.adopt(stored("a", expired = true))
        val result = async { runCatching { sessions.validAccessToken() } }
        begun.await()
        sessions.adopt(stored("b"))
        waiting.complete(stored("a-renewed"))
        assertTrue(result.await().isFailure)
        assertEquals("b", sessions.current()!!.accountId)
    }

    @Test fun `old token rejection does not erase a new session`() = runTest {
        val sessions = store { error("refresh not expected") }
        sessions.adopt(stored("a"))
        sessions.adopt(stored("b"))
        assertFalse(sessions.invalidateIfCurrent("access-a"))
        assertEquals("b", sessions.current()!!.accountId)
        assertTrue(sessions.invalidateIfCurrent("access-b"))
        assertNull(sessions.current())
    }

    @Test fun `old refresh rejection cannot invalidate a new account`() = runTest {
        val waiting = CompletableDeferred<StoredSession>()
        val begun = CompletableDeferred<Unit>()
        val sessions = store { begun.complete(Unit); waiting.await() }
        sessions.adopt(stored("a", expired = true))
        val result = async { runCatching { sessions.validAccessToken() } }
        begun.await()
        sessions.adopt(stored("b"))
        waiting.completeExceptionally(AuthException(AuthException.Kind.INVALID_CREDENTIALS))
        assertTrue(result.await().isFailure)
        assertEquals("b", sessions.current()!!.accountId)
    }
}
