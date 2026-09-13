package io.faithform.app.media

import io.faithform.app.network.ApiClient
import io.faithform.app.network.ApiEnvironment
import io.faithform.app.network.HttpResponse
import io.faithform.app.network.ProjectionCache
import io.faithform.app.network.RecordingTransport
import io.faithform.app.network.TokenProvider
import io.faithform.app.storage.CachePartition
import io.faithform.app.storage.PartitionedCache
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

/**
 * The media client against a scripted server: the routes iOS calls, the ETag
 * discipline, the search that is never cached, and the capability that is
 * never cached either.
 */
internal fun envelope(data: String): String =
    """{"ok":true,"data":$data,
       "meta":{"apiVersion":"1.0","apiMajor":1,"requestId":"r","minimumSupportedClientBuild":1}}"""

internal fun failure(code: String, retryable: Boolean = false): String =
    """{"ok":false,"error":{"code":"$code","message":"Server sentence.","retryable":$retryable},
       "meta":{"apiVersion":"1.0","apiMajor":1,"requestId":"r","minimumSupportedClientBuild":1}}"""

internal object Tokens : TokenProvider {
    override suspend fun validAccessToken() = "access-1"
    override suspend fun invalidate() = Unit
}

internal val PARTITION = CachePartition("test", "account-a", "grace", 3)

internal const val LIVE_NONE = """{"live":null,"mediaVersion":4}"""
internal const val LIVE_ON = """{"live":{"state":"live","mediaId":"live-1","kind":"live","title":"Sunday service",
    "startsAt":"2026-09-13T15:00:00Z","countdownEnabled":false,"posterUrl":null,"publicationVersion":1,
    "churchSlug":"grace","churchName":"Grace Chapel","churchTimezone":"America/Chicago"},"mediaVersion":4}"""

internal fun archiveItem(id: String, title: String = "Sermon $id") = """{"mediaId":"$id","kind":"recording",
    "title":"$title","summary":null,"publishedAt":"2026-09-01T00:00:00Z","recordedAt":"2026-08-31T15:00:00Z",
    "durationSeconds":2400,"posterUrl":null,"seriesName":"Acts","speakers":["Pastor Ann"],"publicationVersion":1,
    "churchSlug":"grace","churchName":"Grace Chapel","churchTimezone":"America/Chicago"}"""

internal fun archivePage(vararg ids: String, next: String? = null) =
    """{"items":[${ids.joinToString(",") { archiveItem(it) }}],"nextCursor":${next?.let { "\"$it\"" } ?: "null"},"mediaVersion":4}"""

internal const val DETAIL = """{"mediaId":"r1","kind":"recording","title":"The road to Emmaus","summary":"Luke 24",
    "publishedAt":"2026-09-01T00:00:00Z","recordedAt":"2026-08-31T15:00:00Z","durationSeconds":2400,
    "startOffsetSeconds":12,"posterUrl":null,"seriesName":"Luke","speakers":["Pastor Ann"],"chapters":[],"topics":[],
    "publicationVersion":2,"churchSlug":"grace","churchName":"Grace Chapel","churchTimezone":"America/Chicago"}"""

internal fun api(transport: RecordingTransport) = ApiClient(
    environment = ApiEnvironment("test", "https://faithform.test"),
    clientBuild = 1,
    transport = transport,
    tokens = Tokens,
)

class MediaClientTest {

    private val cache = ProjectionCache(PartitionedCache(), clock = { 1_000L })

    private fun ok(data: String, etag: String? = null) =
        HttpResponse(200, envelope(data), etag?.let { mapOf("ETag" to it) } ?: emptyMap())

    @Test
    fun `live, archive and detail call the same routes iOS calls`() = runTest {
        val transport = RecordingTransport(mutableListOf(ok(LIVE_NONE), ok(archivePage("r1")), ok(DETAIL)))
        val client = MediaClient(api(transport), cache)

        client.live("grace", PARTITION)
        client.archive("grace", query = null, cursor = null, partition = PARTITION)
        client.detail("grace", "r1", PARTITION)

        assertEquals(
            listOf(
                "https://faithform.test/api/mobile/v1/media/grace/live",
                "https://faithform.test/api/mobile/v1/media/grace/archive",
                "https://faithform.test/api/mobile/v1/media/grace/item/r1",
            ),
            transport.received.map { it.url },
        )
        assertTrue(transport.received.all { it.method == "GET" })
    }

    @Test
    fun `a stored projection is revalidated with its ETag and kept on a 304`() = runTest {
        val transport = RecordingTransport(
            mutableListOf(ok(DETAIL, etag = "\"d2\""), HttpResponse(304, null, emptyMap())),
        )
        val client = MediaClient(api(transport), cache)

        val first = client.detail("grace", "r1", PARTITION)
        val second = client.detail("grace", "r1", PARTITION)

        assertNull(transport.received[0].headers["If-None-Match"])
        assertEquals("\"d2\"", transport.received[1].headers["If-None-Match"])
        assertEquals(first, second)
    }

    @Test
    fun `a different partition never revalidates against another account's copy`() = runTest {
        val transport = RecordingTransport(mutableListOf(ok(DETAIL, etag = "\"d2\""), ok(DETAIL, etag = "\"d2\"")))
        val client = MediaClient(api(transport), cache)

        client.detail("grace", "r1", PARTITION)
        client.detail("grace", "r1", PARTITION.copy(accountId = "account-b"))

        assertNull("account B sent account A's validator", transport.received[1].headers["If-None-Match"])
    }

    @Test
    fun `a search and a second page are neither read from nor written to the cache`() = runTest {
        val transport = RecordingTransport(
            mutableListOf(
                ok(archivePage("r1"), etag = "\"a1\""),
                ok(archivePage("r2"), etag = "\"q1\""),
                ok(archivePage("r3"), etag = "\"c1\""),
                ok(archivePage("r1"), etag = "\"a1\""),
            ),
        )
        val client = MediaClient(api(transport), cache)

        client.archive("grace", null, null, PARTITION)
        client.archive("grace", "grace & truth", null, PARTITION)
        client.archive("grace", null, "cursor/2", PARTITION)
        client.archive("grace", null, null, PARTITION)

        assertEquals(
            "https://faithform.test/api/mobile/v1/media/grace/archive?q=grace%20%26%20truth",
            transport.received[1].url,
        )
        assertNull("a search sent the unfiltered page's validator", transport.received[1].headers["If-None-Match"])
        assertNull(transport.received[2].headers["If-None-Match"])
        // The unfiltered first page still revalidates against its own copy,
        // which the search did not overwrite.
        assertEquals("\"a1\"", transport.received[3].headers["If-None-Match"])
    }

    @Test
    fun `a grant is posted, made absolute on this origin, and never cached`() = runTest {
        val grant = """{"capability":"cap-secret","expiresAt":"2026-09-13T15:05:00Z",
            "deliveryUrl":"/api/media/v1/recording/grace/r1","kind":"recording","renditionKind":"progressive",
            "mediaId":"r1","refreshAfterSeconds":60,"startOffsetSeconds":12}"""
        val backing = PartitionedCache()
        val transport = RecordingTransport(mutableListOf(ok(grant)))
        val client = MediaClient(api(transport), ProjectionCache(backing))

        val granted = client.grant("grace", MediaPlaybackKind.RECORDING, "r1")

        val sent = transport.received.single()
        assertEquals("POST", sent.method)
        assertEquals("https://faithform.test/api/mobile/v1/media/playback", sent.url)
        assertEquals("""{"churchSlug":"grace","kind":"recording","mediaId":"r1"}""", sent.body)
        assertEquals("https://faithform.test/api/media/v1/recording/grace/r1", granted.deliveryUrl)
        assertEquals("cap-secret", granted.capability)
        assertFalse("the capability travelled in the URL", granted.deliveryUrl.contains("cap"))
        assertEquals(RenditionKind.PROGRESSIVE, granted.renditionKind)
        assertEquals(60_000L, granted.refreshLeadMillis)
        assertEquals(12_000L, granted.startOffsetMillis)
        assertEquals(java.time.Instant.parse("2026-09-13T15:05:00Z").toEpochMilli(), granted.expiresAtEpochMillis)
        // Nothing about the grant reached the cache.
        assertEquals(0, backing.count())
    }

    @Test
    fun `a grant pointing at another host is refused rather than played`() = runTest {
        for (url in listOf("https://evil.example/stream.m3u8", "//evil.example/stream", "api/media/v1/relative")) {
            val grant = """{"capability":"c","expiresAt":"2026-09-13T15:05:00Z","deliveryUrl":"$url",
                "kind":"live","renditionKind":"hls","mediaId":"l1","refreshAfterSeconds":60,"startOffsetSeconds":0}"""
            val client = MediaClient(api(RecordingTransport(mutableListOf(ok(grant)))), cache)
            try {
                client.grant("grace", MediaPlaybackKind.LIVE, "l1")
                fail("$url was accepted")
            } catch (_: PlaybackRefusedException) {
            }
        }
    }

    @Test
    fun `a refusal and a dropped connection are different failures`() = runTest {
        val refused = MediaClient(
            api(RecordingTransport(mutableListOf(HttpResponse(404, failure("not_found"), emptyMap())))),
            cache,
        )
        try {
            refused.grant("grace", MediaPlaybackKind.RECORDING, "r1")
            fail("expected a refusal")
        } catch (_: PlaybackRefusedException) {
        }

        val offline = MediaClient(api(RecordingTransport(mutableListOf())), cache)
        try {
            offline.grant("grace", MediaPlaybackKind.RECORDING, "r1")
            fail("expected a transport failure")
        } catch (_: PlaybackTransportException) {
        }
    }
}
