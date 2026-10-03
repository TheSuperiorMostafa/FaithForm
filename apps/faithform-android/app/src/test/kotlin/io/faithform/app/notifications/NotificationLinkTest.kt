package io.faithform.app.notifications

import android.app.Application
import android.content.Intent
import android.net.Uri
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [33], application = Application::class)
class NotificationLinkTest {
    @Test fun `system displayed chat alerts retain their reauthorized routing hint`() {
        val intent = Intent().putExtra("sender", "stream.chat").putExtra("cid", "ff_group:grp_abc")
        assertEquals("faithform://messages?cid=ff_group%3Agrp_abc", notificationLink(intent))
        intent.putExtra("cid", "../../private")
        assertNull(notificationLink(intent))
    }
    @Test fun `foreground URI and ordinary announcement extras retain their destination`() {
        val intent = Intent().putExtra("deepLink", "faithform://home")
        assertEquals("faithform://home", notificationLink(intent))
        intent.data = Uri.parse("faithform://account")
        assertEquals("faithform://account", notificationLink(intent))
    }
}
