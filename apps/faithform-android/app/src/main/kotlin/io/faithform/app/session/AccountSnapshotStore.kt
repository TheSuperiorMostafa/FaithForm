package io.faithform.app.session

import io.faithform.app.contract.Bootstrap
import io.faithform.app.contract.OnboardingState
import io.faithform.app.network.FaithFormJson
import io.faithform.app.storage.Freshness
import java.io.File
import kotlinx.serialization.Serializable

/**
 * The last signed-in shell this device painted, kept so a returning visit can
 * open on Home instead of waiting on the network.
 *
 * Bootstrap is not a credential — tokens stay in EncryptedSharedPreferences —
 * but it is account-scoped, so the file is keyed by environment and account
 * and dropped on sign-out. Church feed rows live in [io.faithform.app.storage.PartitionedCache];
 * this is only the shell that decides which tabs exist.
 */
@Serializable
data class AccountSnapshot(
    val bootstrap: Bootstrap,
    val onboarding: OnboardingState? = null,
    val storedAtMillis: Long,
) {
    fun freshness(nowMillis: Long = System.currentTimeMillis()): Freshness {
        val age = nowMillis - storedAtMillis
        return when {
            age <= FRESH_MS -> Freshness.Fresh
            age <= MAX_AGE_MS -> Freshness.Stale(age)
            else -> Freshness.Expired
        }
    }

    fun isDisplayable(nowMillis: Long = System.currentTimeMillis()): Boolean =
        freshness(nowMillis) !is Freshness.Expired

    fun isFresh(nowMillis: Long = System.currentTimeMillis()): Boolean =
        freshness(nowMillis) is Freshness.Fresh

    companion object {
        const val FRESH_MS = 300_000L
        const val MAX_AGE_MS = 14L * 24 * 60 * 60 * 1000
    }
}

/** Sync file store. Launch reads it before the first frame. */
class AccountSnapshotStore(private val directory: File? = null) {
    init {
        directory?.mkdirs()
    }

    fun load(environment: String, accountId: String): AccountSnapshot? {
        val file = file(environment, accountId) ?: return null
        if (!file.isFile) return null
        return runCatching {
            FaithFormJson.decodeFromString(AccountSnapshot.serializer(), file.readText())
        }.getOrNull()?.takeIf { it.isDisplayable() }
    }

    fun store(snapshot: AccountSnapshot, environment: String, accountId: String) {
        val file = file(environment, accountId) ?: return
        file.parentFile?.mkdirs()
        val tmp = File(file.parentFile, "${file.name}.tmp")
        runCatching {
            tmp.writeText(FaithFormJson.encodeToString(AccountSnapshot.serializer(), snapshot))
            if (!tmp.renameTo(file)) {
                tmp.copyTo(file, overwrite = true)
                tmp.delete()
            }
        }
    }

    fun purge(environment: String, accountId: String) {
        file(environment, accountId)?.delete()
    }

    fun purgeAll() {
        directory?.deleteRecursively()
        directory?.mkdirs()
    }

    private fun file(environment: String, accountId: String): File? {
        val dir = directory ?: return null
        val safe = "$environment-$accountId".replace("/", "_")
        return File(dir, "$safe.json")
    }
}
