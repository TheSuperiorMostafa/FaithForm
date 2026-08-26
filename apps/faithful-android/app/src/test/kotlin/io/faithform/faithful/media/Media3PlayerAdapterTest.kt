package io.faithform.faithful.media

import androidx.media3.common.PlaybackException
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * The one thing `:app` still decides: which Media3 constants the pure mapping
 * mirrors.
 *
 * ## Why this is not a Robolectric test
 *
 * It was, and it hung the runner outright. Robolectric instruments the
 * classpath, and instrumenting Media3's `exoplayer` and `exoplayer-hls`
 * artifacts does not finish in any reasonable time — a genuine cost of the
 * dependency, discovered by running it rather than by reading about it.
 *
 * The response was to move the remaining decisions out of `:app` instead of
 * working around the runner:
 *
 *  * **What a request carries** is now `CapabilityHeaders` in `:core:media`,
 *    asserted on the JVM.
 *  * **What a failure means** is `PlayerFailureMapping.fromPlayerError`, over
 *    plain integers, also on the JVM.
 *
 * What is left in `:app` is a translation with one job: pull an error code and
 * an HTTP status out of a Media3 exception. The integers it hands over must
 * match the library's, and that is what this asserts — `PlaybackException`'s
 * codes are compile-time constants, so reading them needs no Android runtime.
 *
 * A renumber upstream therefore fails here, loudly, rather than silently
 * changing what a person is told when a sermon stops.
 */
class Media3ErrorCodeMirrorTest {

    @Test
    fun `every mirrored code matches the library`() {
        assertEquals(
            PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_FAILED,
            PlayerFailureMapping.ERROR_IO_NETWORK_CONNECTION_FAILED,
        )
        assertEquals(
            PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_TIMEOUT,
            PlayerFailureMapping.ERROR_IO_NETWORK_CONNECTION_TIMEOUT,
        )
        assertEquals(
            PlaybackException.ERROR_CODE_IO_BAD_HTTP_STATUS,
            PlayerFailureMapping.ERROR_IO_BAD_HTTP_STATUS,
        )
        assertEquals(
            PlaybackException.ERROR_CODE_IO_FILE_NOT_FOUND,
            PlayerFailureMapping.ERROR_IO_FILE_NOT_FOUND,
        )
        assertEquals(
            PlaybackException.ERROR_CODE_IO_NO_PERMISSION,
            PlayerFailureMapping.ERROR_IO_NO_PERMISSION,
        )
        assertEquals(
            PlaybackException.ERROR_CODE_PARSING_CONTAINER_UNSUPPORTED,
            PlayerFailureMapping.ERROR_PARSING_CONTAINER_UNSUPPORTED,
        )
        assertEquals(
            PlaybackException.ERROR_CODE_PARSING_MANIFEST_UNSUPPORTED,
            PlayerFailureMapping.ERROR_PARSING_MANIFEST_UNSUPPORTED,
        )
        assertEquals(
            PlaybackException.ERROR_CODE_DECODER_INIT_FAILED,
            PlayerFailureMapping.ERROR_DECODER_INIT_FAILED,
        )
        assertEquals(
            PlaybackException.ERROR_CODE_DECODING_FAILED,
            PlayerFailureMapping.ERROR_DECODING_FAILED,
        )
    }

    @Test
    fun `an HTTP status wins over the error code`() {
        // A bad-status error carrying a 403 must read as unavailable, not as
        // the generic "bad status" the code alone would suggest.
        assertEquals(
            PlayerFailure.UNAVAILABLE,
            PlayerFailureMapping.fromPlayerError(
                PlaybackException.ERROR_CODE_IO_BAD_HTTP_STATUS,
                403,
            ),
        )
        assertEquals(
            PlayerFailure.NETWORK,
            PlayerFailureMapping.fromPlayerError(
                PlaybackException.ERROR_CODE_IO_BAD_HTTP_STATUS,
                503,
            ),
        )
    }

    @Test
    fun `an unrecognised code is unknown rather than assumed harmless`() {
        assertEquals(
            PlayerFailure.UNKNOWN,
            PlayerFailureMapping.fromPlayerError(PlaybackException.ERROR_CODE_UNSPECIFIED, null),
        )
    }
}
