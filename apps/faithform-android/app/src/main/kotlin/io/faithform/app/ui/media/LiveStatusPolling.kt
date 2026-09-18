package io.faithform.app.ui.media

import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.repeatOnLifecycle
import io.faithform.app.media.MediaListModel
import io.faithform.app.ui.host.SessionModel
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive

/** How often "is the church live yet" is asked while Home or Watch is showing. */
const val LIVE_STATUS_POLL_MILLIS = 30_000L

/**
 * Keeps [list]'s live state current while this is on screen.
 *
 * A service starts at a set time, very often with the app already open on
 * Home, and a person should see it appear without having to know to pull down
 * or relaunch. So while the screen is showing and the app is resumed, the live
 * projection is revalidated on a timer — a conditional request the server
 * answers 304 until something changes. It stops with the screen, and in the
 * background, so a phone in a pocket does not poll. (Coming back to the
 * foreground refreshes at once; the screens' resume effects do that.)
 */
@Composable
fun PollLiveStatus(list: SessionModel<MediaListModel>, intervalMillis: Long = LIVE_STATUS_POLL_MILLIS) {
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    LaunchedEffect(list, lifecycle) {
        lifecycle.repeatOnLifecycle(Lifecycle.State.RESUMED) {
            while (isActive) {
                delay(intervalMillis)
                list.value.refreshLive()
            }
        }
    }
}
