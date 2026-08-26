package io.faithform.faithful.notifications

import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.os.Build
import androidx.core.app.NotificationManagerCompat

/**
 * Android notification configuration.
 *
 * Channels are the Android-native shape of "what may I send you", and they are
 * deliberately *not* modelled on iOS's flat permission: on Android the person
 * can turn off events while keeping announcements, from system settings, and
 * the app must respect that rather than treating notifications as one switch.
 *
 * Channel ids mirror the server's `topic` values so a preference set in the app
 * and a channel disabled in system settings describe the same thing.
 */
object NotificationChannels {
    const val ANNOUNCEMENTS = "faithful_announcements"
    const val EVENTS = "faithful_events"

    /**
     * Created at first launch, before any permission is requested.
     *
     * Creating a channel is not a prompt and shows nothing — but it must exist
     * before the first notification arrives, or Android silently drops it.
     */
    fun ensureCreated(context: Context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return

        val manager = context.getSystemService(NotificationManager::class.java) ?: return

        val announcements = NotificationChannel(
            ANNOUNCEMENTS,
            context.getString(io.faithform.faithful.R.string.topic_announcements),
            // Default, not high: a church notice is worth seeing, not worth
            // interrupting someone's evening with a heads-up display.
            NotificationManager.IMPORTANCE_DEFAULT
        ).apply {
            description = context.getString(io.faithform.faithful.R.string.channel_announcements_description)
            setShowBadge(true)
        }

        val events = NotificationChannel(
            EVENTS,
            context.getString(io.faithform.faithful.R.string.topic_events),
            NotificationManager.IMPORTANCE_DEFAULT
        ).apply {
            description = context.getString(io.faithform.faithful.R.string.channel_events_description)
            setShowBadge(true)
        }

        manager.createNotificationChannels(listOf(announcements, events))
    }

    /**
     * Whether a channel is currently able to deliver.
     *
     * Distinct from the app-level permission: someone may have granted
     * notifications and then turned this one channel off, and the app must not
     * claim they will hear about events when they will not.
     */
    fun isChannelEnabled(context: Context, channelId: String): Boolean {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            return NotificationManagerCompat.from(context).areNotificationsEnabled()
        }
        val manager = context.getSystemService(NotificationManager::class.java) ?: return false
        val channel = manager.getNotificationChannel(channelId) ?: return false
        return channel.importance != NotificationManager.IMPORTANCE_NONE
    }
}

/**
 * The app-level permission state.
 *
 * `NOT_REQUESTED` and `DENIED` are kept apart because they mean different
 * things to the person: one has never been asked, the other has said no and
 * should not be asked again by the app.
 */
enum class NotificationAuthorization {
    NOT_REQUESTED, GRANTED, DENIED, NOT_REQUIRED
}

/**
 * Requests the runtime permission.
 *
 * Abstracted so the education-then-request sequence can be tested without an
 * Activity, and so no code path can reach the system dialog except through a
 * deliberate call.
 */
interface NotificationPermissionController {
    /** The current state, without prompting. */
    fun status(): NotificationAuthorization

    /**
     * Raises the system dialog. On API < 33 there is no runtime permission, so
     * this reports `NOT_REQUIRED` rather than pretending to ask.
     */
    suspend fun request(): NotificationAuthorization
}

/**
 * Decides whether the app may show the OS prompt.
 *
 * The rule, identical to iOS and to the location flow: education first, an
 * explicit tap second, the system dialog third. Never at launch.
 */
object NotificationPrompting {
    fun mayRequest(
        status: NotificationAuthorization,
        hasSeenEducation: Boolean
    ): Boolean = hasSeenEducation && status == NotificationAuthorization.NOT_REQUESTED

    /**
     * Once denied, the app stops asking and points at system settings instead.
     * Android only shows its dialog once anyway; asking again would be a
     * no-op that looks like a broken button.
     */
    fun shouldDirectToSettings(status: NotificationAuthorization): Boolean =
        status == NotificationAuthorization.DENIED
}
