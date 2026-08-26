package io.faithform.faithful.media

import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.yield
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

// ---------------------------------------------------------------------------
// Doubles
// ---------------------------------------------------------------------------

class FakeGranter(
    var expiresAtEpochMillis: Long = 1_800_000_300_000,
    private val capabilities: List<String> = listOf("cap-1", "cap-2", "cap-3", "cap-4"),
) : PlaybackGranting {
    val calls = mutableListOf<Triple<String, MediaPlaybackKind, String>>()
    var refuse = false
    private var issued = 0

    /**
     * Holds a grant open so a second caller genuinely arrives while the first
     * is still in flight.
     *
     * Without it the two `async` blocks run to completion one after the other
     * on `runBlocking`'s single thread — the first releases the in-flight flag
     * before the second ever reads it, and the test proves nothing about the
     * mutex it claims to be testing.
     */
    var gate: CompletableDeferred<Unit>? = null

    override suspend fun grant(
        churchSlug: String,
        kind: MediaPlaybackKind,
        mediaId: String,
    ): GrantedPlayback {
        calls += Triple(churchSlug, kind, mediaId)
        gate?.await()
        if (refuse) throw PlaybackRefusedException("gone")
        val capability = capabilities[minOf(issued, capabilities.lastIndex)]
        issued++
        return GrantedPlayback(
            capability = capability,
            deliveryUrl = "https://example.test/api/media/v1/recording/grace/r1",
            expiresAtEpochMillis = expiresAtEpochMillis,
            refreshLeadMillis = 60_000,
            startOffsetMillis = 0,
        )
    }
}

class FakePlayer : MediaPlayerFacade {
    val commands = mutableListOf<PlayerCommand>()
    var position = 0L
    private var handler: ((PlayerEvent) -> Unit)? = null

    override suspend fun send(command: PlayerCommand) { commands += command }
    override fun setEventHandler(handler: (PlayerEvent) -> Unit) { this.handler = handler }
    override suspend fun currentPositionMillis(): Long = position

    val capabilitiesUsed: List<String>
        get() = commands.mapNotNull {
            when (it) {
                is PlayerCommand.Load -> it.request.capability
                is PlayerCommand.UpdateCapability -> it.capability
                else -> null
            }
        }

    val loadCount: Int get() = commands.count { it is PlayerCommand.Load }
}

class FakeResumeStore : ResumePositionStore {
    private val entries = mutableMapOf<String, MutableList<ResumePosition>>()
    var clearAllCount = 0
        private set

    override suspend fun position(
        mediaId: String,
        partitionKey: String,
        nowEpochMillis: Long,
    ): ResumePosition? =
        ResumePolicy.prune(entries[partitionKey].orEmpty(), nowEpochMillis)
            .firstOrNull { it.mediaId == mediaId }

    override suspend fun record(
        position: ResumePosition,
        partitionKey: String,
        nowEpochMillis: Long,
    ) {
        val list = entries.getOrPut(partitionKey) { mutableListOf() }
        list.removeAll { it.mediaId == position.mediaId }
        list += position
        entries[partitionKey] = ResumePolicy.prune(list, nowEpochMillis).toMutableList()
    }

    override suspend fun clear(partitionKey: String) { entries.remove(partitionKey) }
    override suspend fun clearAll() { entries.clear(); clearAllCount++ }

    fun all(partitionKey: String): List<ResumePosition> = entries[partitionKey].orEmpty()
}

private const val NOW = 1_800_000_000_000L
private const val PARTITION_A = "test|account-a|grace|1"
private const val PARTITION_B = "test|account-b|grace|1"
private const val PARTITION_BUMPED = "test|account-a|grace|2"

private fun coordinator(
    granter: FakeGranter = FakeGranter(),
    player: FakePlayer = FakePlayer(),
    store: FakeResumeStore = FakeResumeStore(),
    now: () -> Long = { NOW },
) = MediaPlaybackCoordinator(granter, player, store, now)

// ---------------------------------------------------------------------------
// Capability schedule
// ---------------------------------------------------------------------------

class CapabilityScheduleTest {

    @Test
    fun `a schedule refreshes before it expires, not after`() {
        val schedule = CapabilitySchedule(NOW + 300_000, 60_000)
        assertFalse(schedule.isDue(NOW))
        assertFalse(schedule.isDue(NOW + 239_000))
        // A capability that expires mid-segment is a stall the person sees.
        assertTrue(schedule.isDue(NOW + 240_000))
        assertFalse(schedule.isExpired(NOW + 240_000))
        assertTrue(schedule.isExpired(NOW + 300_000))
    }

    @Test
    fun `a lead of zero still leaves a floor`() {
        val schedule = CapabilitySchedule(NOW, 0)
        assertTrue(schedule.refreshAtEpochMillis() < NOW)
    }
}

class CapabilityRefreshTest {

    @Test
    fun `two callers noticing at once produce one request`() = runBlocking {
        val granter = FakeGranter()
        val session = coordinator(granter = granter)
        session.start("grace", MediaPlaybackKind.RECORDING, "r1", PARTITION_A)
        assertEquals(1, granter.calls.size)

        // A scheduled refresh and a 401 from a segment, at the same moment.
        // The gate keeps the first suspended until the second has had its turn.
        val gate = CompletableDeferred<Unit>()
        granter.gate = gate

        val first = async { session.refreshIfNeeded(force = true) }
        yield()
        val second = async { session.refreshIfNeeded(force = true) }
        yield()
        gate.complete(Unit)
        listOf(first, second).awaitAll()

        // **The TOCTOU that produced eight concurrent geofence submissions in
        // Prompt 7.** The flag is claimed under a mutex before any suspension.
        assertEquals("a refresh raced itself", 2, granter.calls.size)
    }

    @Test
    fun `a refresh swaps the capability without reloading`() = runBlocking {
        val player = FakePlayer()
        val session = coordinator(player = player)
        session.start("grace", MediaPlaybackKind.RECORDING, "r1", PARTITION_A)
        session.refreshIfNeeded(force = true)

        // Exactly one load. A reload would restart the sermon.
        assertEquals(1, player.loadCount)
        assertEquals(listOf("cap-1", "cap-2"), player.capabilitiesUsed)
    }

    @Test
    fun `a refresh is not attempted before it is due`() = runBlocking {
        val granter = FakeGranter(expiresAtEpochMillis = NOW + 300_000)
        val session = coordinator(granter = granter)
        session.start("grace", MediaPlaybackKind.RECORDING, "r1", PARTITION_A)

        assertTrue(session.refreshIfNeeded())
        assertEquals("a refresh ran early", 1, granter.calls.size)
    }
}

// ---------------------------------------------------------------------------
// Revocation
// ---------------------------------------------------------------------------

class RevocationTest {

    @Test
    fun `a refused refresh stops playback and does not reuse the old capability`() = runBlocking {
        val granter = FakeGranter()
        val player = FakePlayer()
        val session = coordinator(granter = granter, player = player)
        session.start("grace", MediaPlaybackKind.RECORDING, "r1", PARTITION_A)

        granter.refuse = true
        assertFalse(session.refreshIfNeeded(force = true))
        assertEquals(PlaybackSessionState.Failed(PlayerFailure.UNAVAILABLE), session.currentState())
        assertTrue(player.commands.contains(PlayerCommand.Stop))
        // **Not retried, and not fallen back.** A church that revoked something
        // meant it, and the segments already buffered are not a licence.
        assertEquals(listOf("cap-1"), player.capabilitiesUsed)
    }

    @Test
    fun `a start that is refused fails without touching the player`() = runBlocking {
        val granter = FakeGranter().apply { refuse = true }
        val player = FakePlayer()
        val session = coordinator(granter = granter, player = player)

        session.start("grace", MediaPlaybackKind.RECORDING, "r1", PARTITION_A)

        assertEquals(PlaybackSessionState.Failed(PlayerFailure.UNAVAILABLE), session.currentState())
        assertTrue(player.commands.isEmpty())
    }

    @Test
    fun `an unavailable failure retries once through a fresh capability`() = runBlocking {
        val granter = FakeGranter()
        val player = FakePlayer()
        val session = coordinator(granter = granter, player = player)
        session.start("grace", MediaPlaybackKind.RECORDING, "r1", PARTITION_A)

        // An expired capability and a revoked one look identical from the
        // transport's point of view, so one refresh is attempted.
        session.handle(PlayerEvent.Failed(PlayerFailure.UNAVAILABLE))
        assertEquals(2, granter.calls.size)
        assertTrue(player.commands.contains(PlayerCommand.Play))

        granter.refuse = true
        session.handle(PlayerEvent.Failed(PlayerFailure.UNAVAILABLE))
        assertEquals(PlaybackSessionState.Failed(PlayerFailure.UNAVAILABLE), session.currentState())
    }

    @Test
    fun `a network failure is not retried as though it were a revocation`() = runBlocking {
        val granter = FakeGranter()
        val session = coordinator(granter = granter)
        session.start("grace", MediaPlaybackKind.RECORDING, "r1", PARTITION_A)

        session.handle(PlayerEvent.Failed(PlayerFailure.NETWORK))

        // Spending a capability refresh on a dead connection helps nobody.
        assertEquals(1, granter.calls.size)
        assertEquals(PlaybackSessionState.Failed(PlayerFailure.NETWORK), session.currentState())
    }
}

// ---------------------------------------------------------------------------
// Error mapping
// ---------------------------------------------------------------------------

class PlayerFailureMappingTest {

    @Test
    fun `401 and 403 are one answer`() {
        assertEquals(PlayerFailure.UNAVAILABLE, PlayerFailureMapping.fromStatus(401))
        assertEquals(PlayerFailure.UNAVAILABLE, PlayerFailureMapping.fromStatus(403))
        assertEquals(PlayerFailure.UNAVAILABLE, PlayerFailureMapping.fromStatus(404))
    }

    @Test
    fun `transient statuses are network failures`() {
        for (status in listOf(408, 429, 500, 502, 503, 504)) {
            assertEquals("$status", PlayerFailure.NETWORK, PlayerFailureMapping.fromStatus(status))
        }
    }

    @Test
    fun `unsupported media is distinct from unavailable`() {
        assertEquals(PlayerFailure.UNSUPPORTED, PlayerFailureMapping.fromStatus(415))
        assertEquals(PlayerFailure.UNSUPPORTED, PlayerFailureMapping.fromStatus(416))
    }
}

// ---------------------------------------------------------------------------
// Resume positions
// ---------------------------------------------------------------------------

class ResumePolicyTest {

    @Test
    fun `a live edge is never a resume point`() {
        assertFalse(MediaPlaybackKind.LIVE.isResumable)
        assertFalse(ResumePolicy.shouldStore(MediaPlaybackKind.LIVE, 600_000, null))
        assertTrue(ResumePolicy.shouldStore(MediaPlaybackKind.RECORDING, 600_000, null))
    }

    @Test
    fun `a live stream is not seekable`() {
        assertFalse(MediaPlaybackKind.LIVE.isSeekable)
        assertTrue(MediaPlaybackKind.RECORDING.isSeekable)
    }

    @Test
    fun `a glance is not a position, and neither is the end`() {
        assertFalse(ResumePolicy.shouldStore(MediaPlaybackKind.RECORDING, 5_000, 3_600_000))
        assertTrue(ResumePolicy.shouldStore(MediaPlaybackKind.RECORDING, 600_000, 3_600_000))
        // Resuming at 99% shows someone the credits.
        assertFalse(ResumePolicy.shouldStore(MediaPlaybackKind.RECORDING, 3_595_000, 3_600_000))
    }

    @Test
    fun `the store is bounded and drops stale entries`() {
        val entries = (0 until 50).map {
            ResumePosition("r$it", "grace", 100_000, NOW + it * 1000L)
        }
        val pruned = ResumePolicy.prune(entries, NOW + 100_000)
        // A hundred positions is a record of what someone watched all year.
        assertEquals(ResumePolicy.MAX_ENTRIES, pruned.size)
        assertEquals("r49", pruned.first().mediaId)

        val ancient = ResumePosition("old", "grace", 100_000, NOW - ResumePolicy.MAX_AGE_MILLIS - 1)
        assertTrue(ResumePolicy.prune(listOf(ancient), NOW).isEmpty())
    }
}

class ResumeIsolationTest {

    @Test
    fun `positions are isolated between accounts and authorization versions`() = runBlocking {
        val store = FakeResumeStore()
        store.record(ResumePosition("r1", "grace", 300_000, NOW), PARTITION_A, NOW)

        assertTrue(store.position("r1", PARTITION_A, NOW) != null)
        // Another account on the same device sees nothing.
        assertNull(store.position("r1", PARTITION_B, NOW))
        // And an authorization change — a revoked relationship, a sign-out —
        // moves the partition, so the old positions are unreachable.
        assertNull(store.position("r1", PARTITION_BUMPED, NOW))
    }

    @Test
    fun `a session records a position on pause`() = runBlocking {
        val store = FakeResumeStore()
        val player = FakePlayer().apply { position = 400_000 }
        val session = coordinator(player = player, store = store)

        session.start("grace", MediaPlaybackKind.RECORDING, "r1", PARTITION_A)
        session.handle(PlayerEvent.ReadyToPlay(3_600_000))
        session.pause()

        assertEquals(400_000L, store.position("r1", PARTITION_A, NOW)?.millis)
    }

    @Test
    fun `a live session records nothing at all`() = runBlocking {
        val store = FakeResumeStore()
        val player = FakePlayer().apply { position = 900_000 }
        val session = coordinator(player = player, store = store)

        session.start("grace", MediaPlaybackKind.LIVE, "e1", PARTITION_A)
        session.pause()

        assertTrue(store.all(PARTITION_A).isEmpty())
    }

    @Test
    fun `a session resumes from a stored position`() = runBlocking {
        val store = FakeResumeStore()
        store.record(ResumePosition("r1", "grace", 725_000, NOW), PARTITION_A, NOW)
        val player = FakePlayer()
        val session = coordinator(player = player, store = store)

        session.start("grace", MediaPlaybackKind.RECORDING, "r1", PARTITION_A)

        val loaded = player.commands.filterIsInstance<PlayerCommand.Load>().first()
        assertEquals(725_000L, loaded.request.resumeMillis)
    }

    @Test
    fun `a capability is never written to the resume store`() = runBlocking {
        val store = FakeResumeStore()
        val player = FakePlayer().apply { position = 300_000 }
        val session = coordinator(player = player, store = store)

        session.start("grace", MediaPlaybackKind.RECORDING, "r1", PARTITION_A)
        session.handle(PlayerEvent.ReadyToPlay(3_600_000))
        session.pause()

        // Asserted on the *type*, which is the real guarantee: a
        // `ResumePosition` has four fields and none of them is a credential.
        val fields = ResumePosition::class.java.declaredFields.map { it.name }
        for (forbidden in listOf("capability", "token", "authorization", "url", "signature")) {
            assertFalse(forbidden, fields.contains(forbidden))
        }
        assertTrue(store.all(PARTITION_A).isNotEmpty())
    }
}

// ---------------------------------------------------------------------------
// Lifecycle and audio focus
// ---------------------------------------------------------------------------

class MediaLifecycleTest {

    @Test
    fun `going to the background saves the position immediately`() = runBlocking {
        val store = FakeResumeStore()
        val player = FakePlayer().apply { position = 512_000 }
        val session = coordinator(player = player, store = store)

        session.start("grace", MediaPlaybackKind.RECORDING, "r1", PARTITION_A)
        // There may be no later opportunity: Android can stop the process
        // without warning.
        session.enterBackground()

        assertEquals(512_000L, store.position("r1", PARTITION_A, NOW)?.millis)
    }

    @Test
    fun `coming back refreshes a capability that expired while stopped`() = runBlocking {
        val granter = FakeGranter(expiresAtEpochMillis = NOW - 3_600_000)
        val session = coordinator(granter = granter)

        session.start("grace", MediaPlaybackKind.RECORDING, "r1", PARTITION_A)
        granter.expiresAtEpochMillis = NOW + 300_000
        session.enterForeground()

        // The first thing the person sees must not be a failure.
        assertEquals(2, granter.calls.size)
    }

    @Test
    fun `stopping clears the session so nothing leaks into the next one`() = runBlocking {
        val session = coordinator()
        session.start("grace", MediaPlaybackKind.RECORDING, "r1", PARTITION_A)
        session.stop()

        assertEquals(PlaybackSessionState.Idle, session.currentState())
        assertNull(session.currentSchedule())
        assertFalse(session.refreshIfNeeded(force = true))
    }

    @Test
    fun `a seek is refused on a live stream`() = runBlocking {
        val player = FakePlayer()
        val session = coordinator(player = player)
        session.start("grace", MediaPlaybackKind.LIVE, "e1", PARTITION_A)

        session.seek(60_000)

        // A live playlist window is a few seconds wide; a scrubber over it
        // promises something the format cannot deliver.
        assertTrue(player.commands.none { it is PlayerCommand.Seek })
    }
}

class AudioFocusPolicyTest {

    @Test
    fun `a transient loss pauses, and regaining resumes`() {
        assertEquals(
            AudioFocusAction.PAUSE,
            AudioFocusPolicy.action(AudioFocusChange.LOST_TRANSIENT, wasPlaying = true),
        )
        assertEquals(
            AudioFocusAction.RESUME,
            AudioFocusPolicy.action(AudioFocusChange.GAINED, wasPlaying = true),
        )
    }

    @Test
    fun `a duckable loss ducks rather than stopping the sermon`() {
        // The difference between a sermon that survives a navigation prompt and
        // one that stops for it.
        assertEquals(
            AudioFocusAction.DUCK,
            AudioFocusPolicy.action(AudioFocusChange.LOST_TRANSIENT_CAN_DUCK, wasPlaying = true),
        )
    }

    @Test
    fun `a permanent loss stops and releases`() {
        assertEquals(
            AudioFocusAction.STOP,
            AudioFocusPolicy.action(AudioFocusChange.LOST, wasPlaying = true),
        )
        // Even when nothing was playing: another app has taken over.
        assertEquals(
            AudioFocusAction.STOP,
            AudioFocusPolicy.action(AudioFocusChange.LOST, wasPlaying = false),
        )
    }

    @Test
    fun `nothing happens when nothing was playing`() {
        for (change in listOf(
            AudioFocusChange.GAINED,
            AudioFocusChange.LOST_TRANSIENT,
            AudioFocusChange.LOST_TRANSIENT_CAN_DUCK,
        )) {
            assertEquals(
                "$change",
                AudioFocusAction.NOTHING,
                AudioFocusPolicy.action(change, wasPlaying = false),
            )
        }
    }
}

// ---------------------------------------------------------------------------
// Screen state
// ---------------------------------------------------------------------------

class MediaScreenStateTest {

    private val card = MediaArchiveCard(
        mediaId = "r1", title = "Hope", summary = null, recordedAt = "2026-08-24T14:00:00Z",
        durationSeconds = 3600, posterUrl = null, seriesName = null,
        speakers = emptyList(), churchTimezone = "America/New_York",
    )

    private val live = MediaLiveCard(
        state = "live", mediaId = "e1", title = "Sunday", startsAt = "2026-08-30T14:00:00Z",
        posterUrl = null, churchName = "Grace", churchTimezone = "America/New_York",
    )

    @Test
    fun `no live area is drawn when nothing is live`() {
        val state = MediaScreenState(MediaListPhase.Loaded(live = null, items = listOf(card)))
        // **The rule that keeps a home screen honest.** No placeholder, no grey
        // box, no "not live right now" strip on a Tuesday.
        assertFalse(state.showsLiveArea)
        assertNull(state.liveCard)
    }

    @Test
    fun `a live area is drawn when something is live`() {
        val state = MediaScreenState(MediaListPhase.Loaded(live = live, items = emptyList()))
        assertTrue(state.showsLiveArea)
        assertTrue(state.liveCard!!.offersWatch)
    }

    @Test
    fun `an upcoming or ended service does not offer a watch button`() {
        assertFalse(live.copy(state = "upcoming").offersWatch)
        assertFalse(live.copy(state = "recent_ended").offersWatch)
        assertTrue(live.copy(state = "recent_ended").hasEnded)
    }

    @Test
    fun `an empty search reads differently from an empty archive`() {
        val empty = MediaScreenState(MediaListPhase.Loaded(live = null, items = emptyList()))
        assertEquals(MediaScreenState.EmptyReason.NOTHING_PUBLISHED, empty.emptyReason)

        // Showing "no recordings" to someone who typed a search reads as though
        // the church has none at all.
        val searched = empty.withSearch("nothing matches this")
        assertEquals(MediaScreenState.EmptyReason.NO_MATCHES, searched.emptyReason)
    }

    @Test
    fun `blocked and offline states offer the right affordances`() {
        val blocked = MediaScreenState(MediaListPhase.Blocked)
        assertFalse(blocked.showsSearch)
        assertFalse(blocked.showsRetry)
        assertNull(blocked.emptyReason)

        val offline = MediaScreenState(MediaListPhase.Offline)
        assertTrue(offline.showsRetry)
        assertFalse(offline.showsSearch)
    }

    @Test
    fun `detail offers play and pause but never both`() {
        val loaded = MediaDetailState(detail = card)
        assertTrue(loaded.offersPlay)
        assertFalse(loaded.offersPause)

        val playing = loaded.copy(playback = PlaybackSessionState.Playing)
        assertFalse(playing.offersPlay)
        assertTrue(playing.offersPause)

        val buffering = loaded.copy(playback = PlaybackSessionState.Buffering)
        assertFalse(buffering.offersPlay)
        assertFalse(buffering.offersPause)
        assertTrue(buffering.isBuffering)
    }

    @Test
    fun `an unavailable detail shows a message rather than a player`() {
        val state = MediaDetailState(detail = null, isUnavailable = true)
        assertFalse(state.offersPlay)
        assertNull(state.failure)
    }
}

// ---------------------------------------------------------------------------
// What a request carries
// ---------------------------------------------------------------------------

class CapabilityHeadersTest {

    @Test
    fun `a capability becomes a bearer header and nothing else`() {
        val headers = CapabilityHeaders()
        headers.set("FFM1.body.signature")

        assertEquals("Bearer FFM1.body.signature", headers.snapshot()["Authorization"])
        // A data source that also sent a device id, an account id or a church
        // slug would be leaking identity to a relay that has no use for it.
        assertEquals(setOf("Authorization"), headers.snapshot().keys)
    }

    @Test
    fun `a refreshed capability replaces the old one in place`() {
        val headers = CapabilityHeaders()
        headers.set("cap-1")
        headers.set("cap-2")

        assertEquals("Bearer cap-2", headers.snapshot()["Authorization"])
        // One header, not two. A stale one left behind would be sent alongside
        // the new one on every segment.
        assertEquals(1, headers.snapshot().size)
        assertFalse(headers.snapshot().values.any { it.contains("cap-1") })
    }

    @Test
    fun `the view the data source holds is live, not a copy`() {
        val headers = CapabilityHeaders()
        // Media3 is handed this map once. If it were a copy, a refresh would
        // update something the player never reads and playback would die at the
        // old capability's expiry.
        val view = headers.mutableView()
        headers.set("cap-1")

        assertEquals("Bearer cap-1", view["Authorization"])
    }

    @Test
    fun `nothing about a capability can reach a URL through these headers`() {
        val headers = CapabilityHeaders()
        headers.set("cap-1")
        for (value in headers.snapshot().values) {
            assertFalse(value.contains("?"))
            assertFalse(value.contains("&"))
            assertFalse(value.startsWith("http"))
        }
    }
}

// ---------------------------------------------------------------------------
// Rendition form
// ---------------------------------------------------------------------------

class RenditionKindTest {

    @Test
    fun `the wire values match the contract`() {
        assertEquals("hls", RenditionKind.HLS.wire)
        assertEquals("progressive", RenditionKind.PROGRESSIVE.wire)
        assertEquals(RenditionKind.HLS, RenditionKind.fromWire("hls"))
        assertEquals(RenditionKind.PROGRESSIVE, RenditionKind.fromWire("progressive"))
    }

    @Test
    fun `an unknown form falls back rather than failing`() {
        // A released app must not break because the server added a rendition
        // form, and progressive is what every recording is today.
        assertEquals(RenditionKind.PROGRESSIVE, RenditionKind.fromWire("some-future-form"))
        assertEquals(RenditionKind.PROGRESSIVE, RenditionKind.fromWire(null))
    }

    @Test
    fun `the rendition form reaches the player`() = runBlocking {
        val player = FakePlayer()
        val granter = object : PlaybackGranting {
            override suspend fun grant(
                churchSlug: String,
                kind: MediaPlaybackKind,
                mediaId: String,
            ) = GrantedPlayback(
                capability = "cap-1",
                deliveryUrl = "https://example.test/api/media/v1/live/grace/e1/index.m3u8",
                renditionKind = RenditionKind.HLS,
                expiresAtEpochMillis = NOW + 300_000,
                refreshLeadMillis = 60_000,
                startOffsetMillis = 0,
            )
        }
        val session = MediaPlaybackCoordinator(granter, player, FakeResumeStore()) { NOW }

        session.start("grace", MediaPlaybackKind.LIVE, "e1", PARTITION_A)

        // Media3 infers an extractor from the path, and the recording delivery
        // route ends in an id rather than a file extension — so the server
        // saying which form it serves is what keeps the two ends agreeing.
        val loaded = player.commands.filterIsInstance<PlayerCommand.Load>().first()
        assertEquals(RenditionKind.HLS, loaded.request.renditionKind)
    }

    @Test
    fun `a request defaults to progressive`() {
        val request = PlaybackRequest(
            url = "https://example.test/x",
            capability = "cap",
            kind = MediaPlaybackKind.RECORDING,
        )
        assertEquals(RenditionKind.PROGRESSIVE, request.renditionKind)
    }
}
