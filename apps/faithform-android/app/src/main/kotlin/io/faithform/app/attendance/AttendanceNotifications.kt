package io.faithform.app.attendance

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import io.faithform.app.MainActivity
import io.faithform.app.R

/**
 * Check-in notifications: one question, one confirmation, and nothing else.
 *
 * **Quiet by design.** The channel is created at low importance — shown in the
 * shade and on the status bar, never with a sound or a heads-up — because these
 * arrive during a service, and a phone chiming in a sanctuary is the one thing
 * this feature must never cause. A person can raise it in system settings.
 *
 * **Private on the lock screen.** Both notifications carry a public version
 * that says only that FaithForm has a check-in update: which church someone is
 * at is not something to show a stranger glancing at a locked phone.
 *
 * Created lazily, the first time one is needed, rather than at launch: a
 * channel is a line in system settings, and it should not appear for someone
 * who never turned the feature on.
 */
class AndroidAttendanceNotifier(private val context: Context) : AttendanceNotifier {

    override fun askToConfirm(churchSlug: String, churchName: String, serviceLabel: String?) {
        if (!canPost()) return
        ensureChannel(context)
        val notification = base(churchSlug)
            .setContentTitle(context.getString(R.string.auto_attendance_prompt_title, named(churchName)))
            .setContentText(context.getString(R.string.auto_attendance_prompt_body))
            .setSubText(serviceLabel)
            .addAction(
                0,
                context.getString(R.string.auto_attendance_prompt_action_check_in),
                AttendanceNotificationReceiver.confirmIntent(context),
            )
            .addAction(
                0,
                context.getString(R.string.auto_attendance_not_now),
                AttendanceNotificationReceiver.notNowIntent(context),
            )
            .setCategory(NotificationCompat.CATEGORY_REMINDER)
            // The attempt behind the question lives two hours at most.
            .setTimeoutAfter(PENDING_ATTEMPT_LIFETIME_MILLIS)
            .build()
        post(QUESTION_ID, notification)
    }

    override fun checkedIn(churchSlug: String, churchName: String, serviceLabel: String?) {
        cancel(QUESTION_ID)
        if (!canPost()) return
        ensureChannel(context)
        val notification = base(churchSlug)
            .setContentTitle(context.getString(R.string.auto_attendance_checked_in_title, named(churchName)))
            .setContentText(serviceLabel)
            .setCategory(NotificationCompat.CATEGORY_STATUS)
            .setTimeoutAfter(CHECKED_IN_LIFETIME_MILLIS)
            .build()
        post(CHECKED_IN_ID, notification)
    }

    override fun notCheckedIn(churchSlug: String, churchName: String) {
        cancel(QUESTION_ID)
        if (!canPost()) return
        ensureChannel(context)
        val notification = base(churchSlug)
            .setContentTitle(context.getString(R.string.auto_attendance_not_checked_in_title, named(churchName)))
            .setContentText(context.getString(R.string.auto_attendance_not_checked_in_body))
            .setCategory(NotificationCompat.CATEGORY_STATUS)
            .setTimeoutAfter(CHECKED_IN_LIFETIME_MILLIS)
            .build()
        post(CHECKED_IN_ID, notification)
    }

    /** A church whose name this phone does not know is "your church", never a slug. */
    private fun named(churchName: String): String =
        churchName.ifBlank { context.getString(R.string.auto_attendance_your_church) }

    /** Replaces the question while the confirmation is on its way. */
    fun checking() {
        if (!canPost()) return
        ensureChannel(context)
        val notification = base(null)
            .setContentTitle(context.getString(R.string.auto_attendance_checking))
            .setTimeoutAfter(PENDING_ATTEMPT_LIFETIME_MILLIS)
            .build()
        post(QUESTION_ID, notification)
    }

    override fun withdrawQuestion() = cancel(QUESTION_ID)

    override fun clearAll() {
        cancel(QUESTION_ID)
        cancel(CHECKED_IN_ID)
    }

    private fun base(churchSlug: String?): NotificationCompat.Builder =
        NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_notification)
            .setAutoCancel(true)
            .setOnlyAlertOnce(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
            .setPublicVersion(
                NotificationCompat.Builder(context, CHANNEL_ID)
                    .setSmallIcon(R.drawable.ic_notification)
                    .setContentTitle(context.getString(R.string.app_name))
                    .setContentText(context.getString(R.string.auto_attendance_notify_public))
                    .build(),
            )
            .setContentIntent(openCheckIn(churchSlug))

    /**
     * Tapping the notification itself opens the Check in tab for that church,
     * through the same deep-link gates as any other link: a church this
     * account can no longer read opens the app and nothing more.
     */
    private fun openCheckIn(churchSlug: String?): PendingIntent {
        val intent = Intent(context, MainActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
        if (churchSlug != null) {
            intent.setAction(Intent.ACTION_VIEW).setData(Uri.parse(checkInLink(churchSlug)))
        }
        return PendingIntent.getActivity(
            context,
            OPEN_REQUEST_CODE,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
    }

    private fun canPost(): Boolean = notificationsAllowed(context)

    private fun post(id: Int, notification: android.app.Notification) {
        if (!canPost()) return
        try {
            NotificationManagerCompat.from(context).notify(id, notification)
        } catch (_: SecurityException) {
            // Revoked between the check and the call. Nothing to show.
        }
    }

    private fun cancel(id: Int) = NotificationManagerCompat.from(context).cancel(id)

    companion object {
        const val CHANNEL_ID = "faithform_attendance"
        const val QUESTION_ID = 7101
        const val CHECKED_IN_ID = 7102
        private const val OPEN_REQUEST_CODE = 7103
        private const val CHECKED_IN_LIFETIME_MILLIS = 6L * 60 * 60 * 1000

        /** The Check in tab for [churchSlug], as a `faithform://` link. */
        fun checkInLink(churchSlug: String): String = "faithform://church/${Uri.encode(churchSlug)}/check-in"

        fun ensureChannel(context: Context) {
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
            val manager = context.getSystemService(NotificationManager::class.java) ?: return
            if (manager.getNotificationChannel(CHANNEL_ID) != null) return
            val channel = NotificationChannel(
                CHANNEL_ID,
                context.getString(R.string.channel_attendance_name),
                NotificationManager.IMPORTANCE_LOW,
            ).apply {
                description = context.getString(R.string.channel_attendance_description)
                setShowBadge(false)
            }
            manager.createNotificationChannel(channel)
        }

        /** Whether a notification posted now would be shown. */
        fun notificationsAllowed(context: Context): Boolean {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
                ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) !=
                PackageManager.PERMISSION_GRANTED
            ) {
                return false
            }
            if (!NotificationManagerCompat.from(context).areNotificationsEnabled()) return false
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                val manager = context.getSystemService(NotificationManager::class.java)
                val channel = manager?.getNotificationChannel(CHANNEL_ID)
                if (channel != null && channel.importance == NotificationManager.IMPORTANCE_NONE) return false
            }
            return true
        }

        /**
         * The notification permission, as the status screen distinguishes it.
         *
         * [requested] tells "never asked" apart from "declined for good": the
         * system reports both as not granted with no rationale.
         */
        fun access(context: Context, requested: Boolean, sdkInt: Int = Build.VERSION.SDK_INT): NotificationAccess {
            if (sdkInt < Build.VERSION_CODES.TIRAMISU) {
                return if (notificationsAllowed(context)) NotificationAccess.NotRequired else NotificationAccess.Denied
            }
            val granted = ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) ==
                PackageManager.PERMISSION_GRANTED
            return when {
                granted && notificationsAllowed(context) -> NotificationAccess.Granted
                granted -> NotificationAccess.Denied
                requested -> NotificationAccess.Denied
                else -> NotificationAccess.NotRequested
            }
        }
    }
}

/**
 * The "Check in" button on the question.
 *
 * Not exported: only this app's own `PendingIntent`, which names this class
 * explicitly and is immutable, can reach it. The tap is handed to work, which
 * may take a fresh fix and wait for a network — longer than a receiver may run.
 */
class AttendanceNotificationReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        when (intent.action) {
            ACTION_CONFIRM -> AttendanceWakeups.from(context)?.personConfirmed()
            // "Not now" only puts the question away. The attempt behind it
            // expires on its own; leaving closes it sooner.
            ACTION_NOT_NOW -> NotificationManagerCompat.from(context).cancel(AndroidAttendanceNotifier.QUESTION_ID)
        }
    }

    companion object {
        const val ACTION_CONFIRM = "io.faithform.app.ATTENDANCE_CONFIRM"
        const val ACTION_NOT_NOW = "io.faithform.app.ATTENDANCE_NOT_NOW"
        private const val REQUEST_CODE = 7104
        private const val NOT_NOW_REQUEST_CODE = 7105

        fun notNowIntent(context: Context): PendingIntent = PendingIntent.getBroadcast(
            context,
            NOT_NOW_REQUEST_CODE,
            Intent(context, AttendanceNotificationReceiver::class.java).setAction(ACTION_NOT_NOW),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )

        fun confirmIntent(context: Context): PendingIntent = PendingIntent.getBroadcast(
            context,
            REQUEST_CODE,
            Intent(context, AttendanceNotificationReceiver::class.java).setAction(ACTION_CONFIRM),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
    }
}
