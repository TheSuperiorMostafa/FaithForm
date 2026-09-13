package io.faithform.app.network

import io.faithform.app.storage.CachePartition
import io.faithform.app.storage.Freshness
import io.faithform.app.storage.PartitionedCache
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.Serializable
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

@Serializable
private data class Projection(val title: String, val version: Int)

private object NoTokens : TokenProvider {
    override suspend fun validAccessToken() = "access-1"
    override suspend fun invalidate() = Unit
}

private fun envelope(data: String) =
    """{"ok":true,"data":$data,
       "meta":{"apiVersion":"1.0","apiMajor":1,"requestId":"r","minimumSupportedClientBuild":1}}"""

/**
 * The typed layer over the partitioned cache: a value and its validator go in
 * together and come out together, in one partition only.
 */
class ProjectionCacheTest {

    private val partition = CachePartition("test", "account-a", "grace", 1)

    @Test
    fun `a value round-trips with its etag and the moment it was stored`() = runTest {
        var now = 5_000L
        val cache = ProjectionCache(PartitionedCache(), clock = { now })

        cache.store("feed", partition, Projection.serializer(), Projection("Harvest supper", 2), "\"v2\"")
        now = 6_000L
        val entry = cache.load("feed", partition, Projection.serializer())!!

        assertEquals(Projection("Harvest supper", 2), entry.value)
        assertEquals("\"v2\"", entry.etag)
        assertEquals(5_000L, entry.storedAtMillis)
        assertEquals(Freshness.Fresh, entry.freshness(nowMillis = 6_000L, ttlMillis = 300_000))
    }

    @Test
    fun `another account, church or authorization version reads nothing`() = runTest {
        val cache = ProjectionCache(PartitionedCache())
        cache.store("feed", partition, Projection.serializer(), Projection("Private notice", 1), "\"v1\"")

        for (other in listOf(
            partition.copy(accountId = "account-b"),
            partition.copy(churchSlug = "other"),
            partition.copy(authorizationVersion = 2),
        )) {
            assertNull("$other read another partition's projection", cache.load("feed", other, Projection.serializer()))
        }
    }

    @Test
    fun `a stored payload that no longer decodes is a miss, not a crash`() = runTest {
        val backing = PartitionedCache()
        backing.store("feed", partition, "{not json", 1L)
        assertNull(ProjectionCache(backing).load("feed", partition, Projection.serializer()))
    }

    @Test
    fun `revalidate keeps the stored value on a 304 and replaces it on a 200`() = runTest {
        val transport = RecordingTransport(
            mutableListOf(
                HttpResponse(200, envelope("""{"title":"One","version":1}"""), mapOf("ETag" to "\"e1\"")),
                HttpResponse(304, null, emptyMap()),
                HttpResponse(200, envelope("""{"title":"Two","version":2}"""), mapOf("ETag" to "\"e2\"")),
            ),
        )
        val api = ApiClient(ApiEnvironment("test", "https://api.example"), 1, transport, NoTokens)
        val cache = ProjectionCache(PartitionedCache())

        val first = cache.revalidate(api, "api/p", Projection.serializer(), "p", partition)
        val second = cache.revalidate(api, "api/p", Projection.serializer(), "p", partition)
        val third = cache.revalidate(api, "api/p", Projection.serializer(), "p", partition)

        assertEquals("One", first.title)
        assertEquals("One", second.title)
        assertEquals("Two", third.title)
        assertEquals(listOf(null, "\"e1\"", "\"e1\""), transport.received.map { it.headers["If-None-Match"] })
        assertEquals("\"e2\"", cache.load("p", partition, Projection.serializer())?.etag)
    }

    @Test
    fun `a 304 with nothing stored is the retryable offline error, not an empty screen`() = runTest {
        val transport = RecordingTransport(mutableListOf(HttpResponse(304, null, emptyMap())))
        val api = ApiClient(ApiEnvironment("test", "https://api.example"), 1, transport, NoTokens)
        val result = runCatching {
            ProjectionCache(PartitionedCache()).revalidate(api, "api/p", Projection.serializer(), "p", partition)
        }
        val error = result.exceptionOrNull() as ApiException
        assertTrue(error.retryable)
    }

    @Test
    fun `an uncacheable read writes nothing`() = runTest {
        val backing = PartitionedCache()
        val transport = RecordingTransport(
            mutableListOf(HttpResponse(200, envelope("""{"title":"Search","version":1}"""), mapOf("ETag" to "\"s\""))),
        )
        val api = ApiClient(ApiEnvironment("test", "https://api.example"), 1, transport, NoTokens)
        ProjectionCache(backing).revalidate(
            api, "api/p", Projection.serializer(), "p", partition, query = mapOf("q" to "lent"), cacheable = false,
        )
        assertEquals(0, backing.count())
    }
}
