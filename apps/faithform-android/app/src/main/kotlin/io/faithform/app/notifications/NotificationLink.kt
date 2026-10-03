package io.faithform.app.notifications

import android.content.Intent
import io.faithform.app.navigation.ChatNotificationLink

/** FCM system alerts put data in extras; foreground alerts use the Intent URI. */
internal fun notificationLink(intent: Intent?): String? {
    intent ?: return null
    return intent.dataString ?: intent.getStringExtra("deepLink") ?: if (intent.getStringExtra("sender") == "stream.chat")
        intent.getStringExtra("cid")?.let(ChatNotificationLink::make) else null
}
