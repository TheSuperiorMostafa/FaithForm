package io.faithform.app.notifications

import android.app.PendingIntent
import android.content.Intent
import android.net.Uri
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import io.faithform.app.MainActivity
import io.faithform.app.R
import io.faithform.app.session.AppContainer

class FaithFormMessagingService : FirebaseMessagingService() {
    override fun onNewToken(token: String) {
        // Never log or place a provider token in intents, notifications, or ordinary preferences.
        PushWork.enqueue(applicationContext)
    }

    override fun onMessageReceived(message: RemoteMessage) {
        val container = AppContainer.from(applicationContext) ?: return
        if (container.sessionStore.current() == null || !NotificationManagerCompat.from(this).areNotificationsEnabled()) return
        NotificationChannels.ensureCreated(this)
        val isChat = message.data["sender"] == "stream.chat"
        val chatLink = if (isChat) message.data["cid"]?.let(io.faithform.app.navigation.ChatNotificationLink::make) else null
        val topic = if (isChat) "groups" else message.data["topic"]
        val channel = when (topic) {
            "events" -> NotificationChannels.EVENTS
            "groups" -> NotificationChannels.GROUPS
            else -> NotificationChannels.ANNOUNCEMENTS
        }
        if (!NotificationChannels.isChannelEnabled(this, channel)) return
        val link = chatLink ?: message.data["deepLink"]?.takeIf { Uri.parse(it).scheme == "faithform" }
        val intent = Intent(this, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP
            link?.let { data = Uri.parse(it) }
        }
        val id = (message.data["correlationId"] ?: message.data["message_id"] ?: message.messageId ?: link ?: "faithform").hashCode()
        val pending = PendingIntent.getActivity(this, id, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val notice = NotificationCompat.Builder(this, channel)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(message.notification?.title ?: message.data["title"] ?: getString(R.string.app_name))
            .setContentText(message.notification?.body ?: message.data["body"] ?: if (isChat) getString(R.string.notification_chat_body) else null)
            .setContentIntent(pending).setAutoCancel(true).setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
            .build()
        try { NotificationManagerCompat.from(this).notify(id, notice) } catch (_: SecurityException) { /* Permission revoked mid-delivery. */ }
    }
}
