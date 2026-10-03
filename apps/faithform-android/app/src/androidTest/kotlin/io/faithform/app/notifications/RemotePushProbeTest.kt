package io.faithform.app.notifications

import android.app.NotificationManager
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.google.firebase.messaging.FirebaseMessaging
import com.google.android.gms.tasks.Tasks
import io.faithform.app.session.AppContainer
import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.json.JSONObject
import java.io.File
import java.util.concurrent.TimeUnit

/** Explicitly opted-in rehearsal. Provider token remains in app-private storage. */
@RunWith(AndroidJUnit4::class)
class RemotePushProbeTest {
    @Test fun verifyRemoteDelivery() = runBlocking {
        val args = InstrumentationRegistry.getArguments()
        assumeTrue(args.getString("pushProbe") == "true")
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val container = requireNotNull(AppContainer.from(context))
        assertNotNull("Sign in to the authorized test account first", container.sessionStore.current())
        val manager = context.getSystemService(NotificationManager::class.java)
        when (args.getString("pushMode")) {
            "export", "rotate" -> {
                if (args.getString("pushMode") == "rotate") {
                    val previous = Tasks.await(FirebaseMessaging.getInstance().token, 30, TimeUnit.SECONDS)
                    Tasks.await(FirebaseMessaging.getInstance().deleteToken(), 30, TimeUnit.SECONDS)
                    val renewed = Tasks.await(FirebaseMessaging.getInstance().token, 30, TimeUnit.SECONDS)
                    assertTrue("Firebase did not rotate the token", previous != renewed)
                }
                container.push.synchronize()
                assertNull("Device registration did not reach FaithForm", container.push.deliveryError.value)
                val token = Tasks.await(FirebaseMessaging.getInstance().token, 30, TimeUnit.SECONDS)
                File(context.filesDir, "remote-push-private.json").writeText(JSONObject()
                    .put("token", token).put("installId", container.push.installId).toString())
            }
            "clear" -> manager.cancelAll()
            "absent" -> assertTrue("A notification appeared despite the delivery gate", manager.activeNotifications.isEmpty())
            "groups" -> {
                val notice = manager.activeNotifications.firstOrNull { it.notification.channelId == NotificationChannels.GROUPS }
                assertNotNull("The Stream Chat notification did not use the groups channel", notice)
                assertNotNull("The chat alert has no preview", notice!!.notification.extras.getCharSequence("android.text"))
                assertNotNull("The chat alert has no tap action", notice.notification.contentIntent)
            }
            else -> {
                val expected = requireNotNull(args.getString("pushTitle"))
                val notice = manager.activeNotifications.firstOrNull {
                    it.notification.extras.getString("android.title") == expected
                }
                assertNotNull("The remote notification did not appear", notice)
                assertEquals(args.getString("pushChannel"), notice!!.notification.channelId)
                assertNotNull("Notification has no tap action", notice.notification.contentIntent)
                if (args.getString("pushMode") == "tap") notice.notification.contentIntent.send()
            }
        }
    }
}
