package io.faithform.app.giving

import android.content.SharedPreferences
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

/**
 * The one gift that may be in flight, kept where a process kill cannot lose it.
 *
 * `GivingModel` saves the attempt **before** asking the server to create a
 * payment intent, and clears it once the server has answered for good. If
 * Android kills the app in between — with Stripe's sheet open, say — the next
 * visit to Give finds the attempt here and asks the server what became of it,
 * instead of starting a second gift that could charge twice.
 *
 * ## What is stored
 *
 * An attempt id, a church slug, a fund id and an amount in cents. No client
 * secret, no payment intent id, no card detail — nothing Stripe issued. The
 * preferences passed in are the container's `EncryptedSharedPreferences`, so
 * even that is encrypted at rest, and sign-out's `purgeEverything` clears it
 * with the session.
 */
class EncryptedPendingDonationStore(
    private val preferences: SharedPreferences,
) : PendingDonationStore {

    @Serializable
    private data class Stored(
        val clientAttemptId: String,
        val churchSlug: String,
        val fundId: String,
        val amountCents: Int,
    )

    private val json = Json { ignoreUnknownKeys = true }

    override suspend fun save(attempt: DonationAttempt) {
        val stored = Stored(attempt.clientAttemptId, attempt.churchSlug, attempt.fundId, attempt.amountCents)
        // `commit`, not `apply`: the point of this write is that it has
        // happened before the network call that follows it.
        preferences.edit().putString(KEY, json.encodeToString(Stored.serializer(), stored)).commit()
    }

    override suspend fun load(): DonationAttempt? {
        val raw = preferences.getString(KEY, null) ?: return null
        val stored = runCatching { json.decodeFromString(Stored.serializer(), raw) }.getOrNull() ?: return null
        return DonationAttempt(stored.clientAttemptId, stored.churchSlug, stored.fundId, stored.amountCents)
    }

    override suspend fun clear() {
        preferences.edit().remove(KEY).commit()
    }

    private companion object {
        const val KEY = "giving.pendingAttempt"
    }
}
