package io.faithform.app.giving

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import java.io.File
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * The pending gift's store, on real SharedPreferences.
 *
 * The app hands it the container's `EncryptedSharedPreferences`; a Keystore is
 * not available on a JVM, so this exercises the same store against plain
 * preferences — the encryption is the container's, the round trip is this
 * class's.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = android.app.Application::class)
class EncryptedPendingDonationStoreTest {

    private val preferences = ApplicationProvider.getApplicationContext<Context>()
        .getSharedPreferences("pending_donation_test", Context.MODE_PRIVATE)

    @Test
    fun `an attempt survives a new store instance, as it must survive a process kill`() = runTest {
        val attempt = DonationAttempt("attempt-0001", "grace", "general", 2500)
        EncryptedPendingDonationStore(preferences).save(attempt)

        assertEquals(attempt, EncryptedPendingDonationStore(preferences).load())

        EncryptedPendingDonationStore(preferences).clear()
        assertNull(EncryptedPendingDonationStore(preferences).load())
    }

    @Test
    fun `a corrupted entry reads as nothing pending, not a crash`() = runTest {
        preferences.edit().putString("giving.pendingAttempt", "{nope").commit()
        assertNull(EncryptedPendingDonationStore(preferences).load())
    }

    @Test
    fun `nothing Stripe issued is ever written`() {
        val source = File("src/main/kotlin/io/faithform/app/giving/EncryptedPendingDonationStore.kt").readText()
        val stored = source.substringAfter("private data class Stored(").substringBefore(")")
        for (forbidden in listOf("clientSecret", "publishableKey", "stripeAccountId", "paymentIntent")) {
            assertFalse("the pending store keeps $forbidden", stored.contains(forbidden))
        }
    }
}
